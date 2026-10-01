"""Regression: the last rejected company cannot pin a whole location or a full window."""
import contextlib
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import kvk_worker_failures as failures
import kvk_worker_queue as queue
import kvk_worker_stream as stream
from kvk_completion_order import completion_scope, completion_draft_rows
from kvk_api_validation import PROFILE
from install_kvk_worker_queue import patched_source, LOCATION, INITIAL, REVIEW


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.pending = Path(self.temp.name)
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.object(queue, 'PENDING', self.pending))
        self.stack.enter_context(patch.dict(os.environ, {'SOFTORA_KVK_COMPLETION_ORDER': '1'}))
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE companies(id INTEGER, kvk_nummer TEXT, woonplaatscode TEXT, lead_status TEXT)')
        self.db.executemany('INSERT INTO companies VALUES(?,?,?,?)',
                           [(1, '00000001', 'A', 'unresearched'), (2, '00000002', 'B', 'unresearched'),
                            (3, '00000003', 'C', 'unresearched')])
        dashboard = types.SimpleNamespace(STATE_PATH='state', LOCATIONS_PATH='locations',
            load_json=lambda p, d: {'processed_location_codes': ['A', 'B', 'C']} if p == 'state'
                else [{'woonplaatscode': code, 'woonplaats': code} for code in ('A','B','C')],
            load_contact_progress_cache=lambda codes: (set(), {}, {}), ordered_location_codes=lambda: ['A','B','C'])
        self.stack.enter_context(patch.dict(sys.modules, {'serve_dashboard': dashboard}))
        body = '''    filters = list(filters or [])
    filters.append("c.lead_status = 'unresearched'")
    return connection.execute('SELECT c.* FROM companies c WHERE ' + ' AND '.join(filters) + ' ORDER BY c.id LIMIT ?', [*(params or []), limit]).fetchall()
'''
        self.source = 'from __future__ import annotations\n' + LOCATION + "    return {}, {'woonplaatscode': 'A'}\n" + INITIAL + body + REVIEW + body.replace('unresearched', 'unusable')
        self.api = {'sqlite3': sqlite3, 'Any': Any, 'connect': lambda: self.db,
                    'active_location_filters': lambda location: (['c.woonplaatscode = ?'], [location['woonplaatscode']])}
        exec(patched_source(self.source), self.api)
        self.api.update(clean=str, assert_official_queue_mode=lambda a: None,
                        uses_approved_review=lambda a: False, uses_unusable_review=lambda a: False,
                        planning_scope_from_args=lambda a: (self.location(), '', *self.filters()))
        def assert_location(connection, results):
            location = self.location()
            for item in results:
                row = connection.execute('SELECT woonplaatscode FROM companies WHERE kvk_nummer=?', (item['kvk_nummer'],)).fetchone()
                if row is None or row[0] != location['woonplaatscode']:
                    raise ValueError('verkeerde locatie')
            return location
        self.api['assert_results_match_active_location'] = assert_location

    def tearDown(self):
        self.stack.close()
        self.db.close()
        self.temp.cleanup()

    def location(self):
        return self.api['active_planning_location']()[1]

    def filters(self):
        return self.api['active_location_filters'](self.location())

    def isolate(self, kvk, role='searcher'):
        path = self.pending / f'contact_agent_results_api_{role}_initial_{kvk}.json'
        error = failures.CompanyFailure('bewijs geweigerd')
        error.retryable = False
        failures.record(path, error)
        return path

    def test_last_failed_company_advances_executable_location_and_both_write_gates(self):
        path = self.isolate('00000001')
        original = failures.state_path(path).read_bytes()
        self.assertEqual(self.location()['woonplaatscode'], 'B')
        result = {'kvk_nummer': '00000002', 'validation_profile': PROFILE}
        self.assertEqual(completion_scope(self.db, [result], None, self.api)['woonplaatscode'], 'B')
        self.assertEqual(completion_draft_rows(self.db, [result], None, self.api)[1][0]['kvk_nummer'], '00000002')
        for kvk in ('00000001', '00000003', '99999999'):
            with self.subTest(kvk=kvk), self.assertRaises(ValueError):
                completion_scope(self.db, [dict(result, kvk_nummer=kvk)], None, self.api)
        self.assertEqual(failures.state_path(path).read_bytes(), original)
        self.assertEqual(self.db.execute('SELECT lead_status FROM companies WHERE id=1').fetchone()[0], 'unresearched')

    def test_full_window_of_failures_cannot_hide_the_next_company_for_either_role(self):
        for role in ('searcher', 'controller'):
            self.db.execute('DELETE FROM companies')
            status = 'unresearched' if role == 'searcher' else 'unusable'
            for i in range(1, 32):
                self.db.execute('INSERT INTO companies VALUES(?,?,?,?)', (i, f'{i:08}', 'A', status))
                if i <= 30:
                    self.isolate(f'{i:08}', role)
            fetch = self.api['fetch_next' if role == 'searcher' else 'fetch_unusable_review']
            self.assertEqual([r['kvk_nummer'] for r in fetch(self.db, 30, [], [])], ['00000031'])

    def test_all_isolated_is_empty_work_without_marking_any_lead_finished(self):
        for kvk in ('00000001','00000002','00000003'):
            self.isolate(kvk)
        self.assertEqual(self.api['fetch_next'](self.db, 30, *self.filters()), [])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM companies WHERE lead_status='unresearched'").fetchone()[0], 3)

    def test_native_queue_order_stays_strict_and_recovery_restores_original_priority(self):
        path = self.isolate('00000001')
        with patch.dict(os.environ, {'SOFTORA_KVK_COMPLETION_ORDER': '0'}):
            self.assertEqual(self.location()['woonplaatscode'], 'A')
            self.assertEqual(self.api['fetch_next'](self.db, 1, *self.filters())[0]['kvk_nummer'], '00000001')
        self.assertEqual(self.location()['woonplaatscode'], 'B')
        failures.clear(path)
        self.assertEqual(self.location()['woonplaatscode'], 'A')

    def test_old_mapping_failure_rechecks_saved_answer_until_apply_without_new_research(self):
        path = self.isolate('00000001')
        state = failures.read(path)
        state.pop('mapping_version')
        failures.state_path(path).write_text(json.dumps(state))
        path.with_suffix('.luna.json').write_text('{"answer":{"kvk_nummer":"00000001"}}')
        self.assertTrue(failures.ready(path))
        self.assertEqual(self.location()['woonplaatscode'], 'A')
        path.write_text('{}')
        self.assertTrue(failures.ready(path))  # The writer must still be able to pick it up.
        error = failures.CompanyFailure('nog steeds ongeldig')
        error.retryable = False
        failures.record(path, error)
        self.assertFalse(failures.ready(path))
        self.assertEqual(self.location()['woonplaatscode'], 'B')

    def test_corrupt_company_failure_is_preserved_and_cannot_crash_other_work(self):
        path = self.isolate('00000001')
        failures.state_path(path).write_text('{broken')
        self.assertEqual(self.location()['woonplaatscode'], 'B')
        self.assertEqual(failures.state_path(path).read_text(), '{broken')

    def test_install_is_idempotent_and_fails_closed_on_canonical_drift(self):
        installed = patched_source(self.source)
        self.assertEqual(patched_source(installed), installed)
        with self.assertRaises(ValueError):
            patched_source(self.source.replace('def fetch_next(', 'def changed('))

    def test_empty_queue_uses_backoff_and_honest_status_and_stops_from_dashboard(self):
        now = [100.0]
        def sleep(seconds):
            now[0] += seconds
        runner = types.SimpleNamespace(PENDING=self.pending,
            Heartbeat=lambda *a, **kw: contextlib.nullcontext(),
            poll_state=Mock(side_effect=lambda: {'state': {'workers': {'searcher': {'enabled': now[0] < 112, 'count': 10}}}}),
            next_packet=Mock(return_value=None), report=Mock())
        self.isolate('00000001')
        with patch.object(stream, 'time', types.SimpleNamespace(monotonic=lambda: now[0], sleep=sleep)):
            stream.run('searcher', runner, None)
        self.assertEqual(runner.next_packet.call_count, 1)
        message = runner.report.call_args.args[1]
        self.assertIn('geen uitvoerbaar onderzoek', message)
        self.assertIn('1 bedrijf apart gezet', message)
        self.assertNotIn('andere onderzoeken gaan door', message)

    def test_disabled_start_never_fetches_work(self):
        runner = types.SimpleNamespace(PENDING=self.pending,
            Heartbeat=lambda *a, **kw: contextlib.nullcontext(), next_packet=Mock(),
            poll_state=lambda: {'state': {'workers': {'searcher': {'enabled': False}}}})
        stream.run('searcher', runner, None)
        runner.next_packet.assert_not_called()
