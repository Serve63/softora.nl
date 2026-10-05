import json
import sqlite3
import sys
import threading
import tempfile
import time
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
sys.modules.setdefault('start_database_fill_control', types.SimpleNamespace(post_json=None, resolve_token=None))
import kvk_robot_import as robot_import
from kvk_api_attribution import activity_labels

SCHEMA = '''
CREATE TABLE companies (kvk_nummer TEXT, website TEXT, website_status TEXT, email TEXT,
  telefoonnummer TEXT, lead_status TEXT, contact_status TEXT, contact_checked_at TEXT, operational_status TEXT,
  source_quality TEXT, entity_role TEXT, contact_research_note TEXT, unusable_reason TEXT,
  unusable_review_grade INTEGER, unusable_reviewed_at TEXT, usable_review_state TEXT, usable_reviewed_at TEXT,
  usable_review_outcome TEXT, updated_at TEXT);
CREATE TABLE contact_research_lane_events (kvk_nummer TEXT, lane TEXT, model_role TEXT, outcome TEXT,
  created_at TEXT, PRIMARY KEY(kvk_nummer, lane));
CREATE TABLE contact_research_bucket_events (kvk_nummer TEXT, lane TEXT, model_role TEXT, from_bucket TEXT,
  to_bucket TEXT, created_at TEXT);
CREATE TABLE unusable_review_grade_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kvk_nummer TEXT,
  from_grade INTEGER, to_grade INTEGER, model_role TEXT, created_at TEXT);
CREATE TABLE research_execution_attributions (kvk_nummer TEXT, lane TEXT, created_at TEXT,
  producer_thread_id TEXT, model TEXT, reasoning_effort TEXT, display_label TEXT, input_sha256 TEXT,
  PRIMARY KEY(kvk_nummer, lane, created_at));
'''
FIND = {'kvk': '11111111', 'phone': '073 123 4567', 'email': 'info@zonneveld.nl', 'website': 'https://zonneveld.nl/'}


class RobotControllerWritesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = Path(self.directory.name) / 'bedrijven.sqlite'
        with sqlite3.connect(self.db) as connection:
            connection.executescript(SCHEMA)
            rows = [('11111111', 'unusable', 1), ('11111111', 'unusable', 1), ('22222222', 'unusable', 1),
                    ('33333333', 'unusable', 2), ('44444444', 'unresearched', 1)]
            connection.executemany("INSERT INTO companies(kvk_nummer, lead_status, unusable_review_grade, unusable_reason) "
                                   "VALUES(?, ?, ?, 'missing_phone_and_email')", rows)

    def tearDown(self):
        self.directory.cleanup()

    def query(self, sql, *args):
        with sqlite3.connect(self.db) as connection:
            return connection.execute(sql, args).fetchall()

    def test_a_recovered_company_becomes_usable_on_every_establishment_row(self):
        self.assertTrue(robot_import.import_control_recovery(self.db, FIND, '2026-10-04T15:00:00+02:00'))
        self.assertEqual(self.query("SELECT lead_status, unusable_review_grade, usable_review_outcome, email "
                                    "FROM companies WHERE kvk_nummer='11111111'"),
                         [('usable', 0, 'recovered_by_control', 'info@zonneveld.nl')] * 2)
        self.assertEqual(self.query("SELECT model_role, outcome FROM contact_research_lane_events"),
                         [('controller_robot', 'usable')])
        self.assertEqual(self.query("SELECT from_bucket, to_bucket FROM contact_research_bucket_events"),
                         [('unusable', 'with_website')])
        self.assertEqual(self.query("SELECT from_grade, to_grade, model_role FROM unusable_review_grade_events"),
                         [(1, 0, 'review_grade_1')])
        self.assertEqual(self.query("SELECT display_label FROM research_execution_attributions"), [('Robot Controleur',)])

    def test_a_confirmed_verdict_becomes_final_grade_2(self):
        self.assertTrue(robot_import.import_control_confirmation(self.db, '22222222', 'opnieuw gezocht (ai_incomplete)'))
        self.assertEqual(self.query("SELECT lead_status, unusable_review_grade FROM companies WHERE kvk_nummer='22222222'"),
                         [('unusable', 2)])
        self.assertIn('Robot Controleur', self.query("SELECT contact_research_note FROM companies WHERE kvk_nummer='22222222'")[0][0])
        self.assertEqual(self.query("SELECT from_grade, to_grade FROM unusable_review_grade_events"), [(1, 2)])

    def test_only_grade_1_unusable_companies_are_touched_and_only_once(self):
        self.assertFalse(robot_import.import_control_confirmation(self.db, '33333333'))
        self.assertFalse(robot_import.import_control_recovery(self.db, dict(FIND, kvk='44444444')))
        self.assertTrue(robot_import.import_control_confirmation(self.db, '22222222'))
        self.assertFalse(robot_import.import_control_confirmation(self.db, '22222222'))


class RobotControllerApprovalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = Path(self.directory.name) / 'bedrijven.sqlite'
        with sqlite3.connect(self.db) as connection:
            connection.executescript(SCHEMA.replace('updated_at TEXT);', 'updated_at TEXT, id INTEGER PRIMARY KEY, '
                                                    'actief INTEGER DEFAULT 1, premium_database_transferred_at TEXT DEFAULT \'\');'))
            connection.executemany("INSERT INTO companies(kvk_nummer, lead_status, usable_review_state, website, website_status, "
                                   "unusable_review_grade) VALUES(?, 'usable', 'pending', ?, ?, 0)",
                                   [('11111111', 'https://oud.nl/', 'found'), ('11111111', 'https://oud.nl/', 'found'),
                                    ('22222222', '', 'no_website')])

    def tearDown(self):
        self.directory.cleanup()

    def query(self, sql):
        with sqlite3.connect(self.db) as connection:
            return connection.execute(sql).fetchall()

    def test_a_confirmed_find_is_verified_on_every_row_without_changing_the_classification(self):
        self.assertTrue(robot_import.import_approval_confirmed(self.db, FIND, '2026-10-05T01:00:00+02:00'))
        self.assertEqual(self.query("SELECT lead_status, usable_review_state, email FROM companies WHERE kvk_nummer='11111111'"),
                         [('usable', 'verified', 'info@zonneveld.nl')] * 2)
        self.assertEqual(self.query("SELECT lane, outcome FROM contact_research_lane_events"), [('approved_review', 'usable')])
        self.assertEqual(self.query("SELECT * FROM contact_research_bucket_events"), [])
        self.assertEqual(self.query("SELECT * FROM unusable_review_grade_events"), [])
        self.assertFalse(robot_import.import_approval_confirmed(self.db, FIND))

    def test_an_unconfirmed_find_becomes_definitively_unusable_with_balancing_events(self):
        self.assertTrue(robot_import.import_approval_rejected(self.db, '22222222', 'niets te bevestigen'))
        self.assertEqual(self.query("SELECT lead_status, unusable_reason, unusable_review_grade FROM companies "
                                    "WHERE kvk_nummer='22222222'"), [('unusable', 'identity_unconfirmed', 2)])
        self.assertEqual(self.query("SELECT lane, from_bucket, to_bucket FROM contact_research_bucket_events"),
                         [('approved_review', 'without_website', 'unusable')])
        self.assertEqual(self.query("SELECT from_grade, to_grade FROM unusable_review_grade_events"), [(0, 2)])
        self.assertFalse(robot_import.import_approval_rejected(self.db, '22222222'))


class RobotControllerOutcomeTests(unittest.TestCase):
    def setUp(self):
        import kvk_robot_controller
        self.controller = kvk_robot_controller

    def test_a_usable_result_is_recovered_and_anything_else_confirmed(self):
        usable = {'kvk_nummer': '11111111', 'lead_status': 'usable', 'decision': 'usable', 'phone': '073 123 4567',
                  'email': 'info@zonneveld.nl', 'website': 'https://zonneveld.nl/'}
        self.assertEqual(self.controller.control_outcome(usable)[0], 'recovered')
        nothing = {'kvk_nummer': '11111111', 'decision': 'missing_phone_and_email', 'ai_assist': {'reason': 'ai_incomplete'}}
        self.assertEqual(self.controller.control_outcome(nothing), ('confirmed', 'opnieuw gezocht (ai_incomplete)'))

    def test_the_contact_gate_applies_to_the_controller_too(self):
        jimdo = {'kvk_nummer': '11111111', 'lead_status': 'usable', 'decision': 'usable', 'phone': '073 123 4567',
                 'email': 'datenschutz@jimdo.com', 'website': 'https://zonneveld.nl/'}
        outcome, note = self.controller.control_outcome(jimdo)
        self.assertEqual(outcome, 'confirmed')
        self.assertIn('platform-e-mail', note)


class RobotControllerRecoverOnlyTests(unittest.TestCase):
    def test_recover_only_is_the_default_and_never_finalizes(self):
        import importlib, os
        from unittest.mock import patch
        import kvk_robot_controller
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('SOFTORA_ROBOT_CONTROL_FINALIZE', None)
            self.assertFalse(importlib.reload(kvk_robot_controller).FINALIZE)
        with patch.dict(os.environ, {'SOFTORA_ROBOT_CONTROL_FINALIZE': '1'}):
            self.assertTrue(importlib.reload(kvk_robot_controller).FINALIZE)
        importlib.reload(kvk_robot_controller)
        source = (Path(__file__).parents[1] / 'scripts' / 'kvk_robot_controller.py').read_text()
        self.assertIn("written = import_control_confirmation(DB, kvk, detail) if FINALIZE else False", source)


class RobotControllerModelTests(unittest.TestCase):
    def test_the_controller_can_run_its_own_ai_model(self):
        import importlib, os
        from unittest.mock import patch
        import kvk_robot_controller
        with patch.dict(os.environ, {'SOFTORA_ROBOT_CONTROL_AI_MODEL': 'gpt-6-luna', 'SOFTORA_ROBOT_CONTROL_AI_EFFORT': 'max'}):
            overrides = importlib.reload(kvk_robot_controller).AI_OVERRIDES
        self.assertEqual(overrides, {'ROBOT_AI_MODEL': 'gpt-6-luna', 'ROBOT_AI_EFFORT': 'max', 'ROBOT_AI_EFFORT_AGAIN': 'max'})
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('SOFTORA_ROBOT_CONTROL_AI_MODEL', None)
            os.environ.pop('SOFTORA_ROBOT_CONTROL_AI_EFFORT', None)
            self.assertEqual(importlib.reload(kvk_robot_controller).AI_OVERRIDES, {})
        importlib.reload(kvk_robot_controller)


class RobotControllerOrderTests(unittest.TestCase):
    def test_the_queue_follows_the_location_planning_and_recover_only_checks_are_redone(self):
        import json, kvk_robot_controller as controller
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / 'db.sqlite'
            with sqlite3.connect(db) as connection:
                connection.executescript('CREATE TABLE companies(id INTEGER PRIMARY KEY, kvk_nummer TEXT, actief INTEGER, '
                                         'lead_status TEXT, unusable_review_grade INTEGER, woonplaatscode TEXT, '
                                         'usable_review_state TEXT, premium_database_transferred_at TEXT);'
                                         'CREATE TABLE company_primary(company_id INTEGER, kvk_nummer TEXT);')
                for company_id, kvk, place in ((1, '11111111', 'WP_HELVOIRT'), (2, '22222222', 'WP_ESCH'),
                                               (3, '33333333', 'WP_HELVOIRT'), (4, '44444444', 'WP_ESCH')):
                    connection.execute("INSERT INTO companies VALUES(?,?,1,'unusable',1,?,'','')", (company_id, kvk, place))
                    connection.execute('INSERT INTO company_primary VALUES(?,?)', (company_id, kvk))
                # An unconfirmed usable find in Esch is part of Esch's control; a verified one is not.
                connection.execute("INSERT INTO companies VALUES(5,'55555555',1,'usable',0,'WP_ESCH','pending','')")
                connection.execute("INSERT INTO companies VALUES(6,'66666666',1,'usable',0,'WP_ESCH','verified','')")
                connection.executemany('INSERT INTO company_primary VALUES(?,?)', [(5, '55555555'), (6, '66666666')])
            locations = root / 'locations.json'
            locations.write_text(json.dumps([{'woonplaatscode': 'WP_ESCH'}, {'woonplaatscode': 'WP_HELVOIRT'}]))
            queue = root / 'queue'
            (queue / '22222222').mkdir(parents=True)
            (queue / '22222222' / 'completed.json').write_text(json.dumps({'outcome': 'confirmed', 'written': False}))
            with patch.object(controller, 'DB', db), patch.object(controller, 'LOCATIONS', locations), \
                    patch.object(controller, 'QUEUE', queue):
                self.assertEqual(controller.review_head(4), ['22222222', '44444444', '55555555', '11111111'])
                with patch.object(controller, 'FINALIZE', False):
                    self.assertTrue(controller.checked('22222222'))
                with patch.object(controller, 'FINALIZE', True):
                    self.assertFalse(controller.checked('22222222'))
                    self.assertFalse(controller.checked('44444444'))


class RobotControllerGiveUpTests(unittest.TestCase):
    def test_after_three_technical_failures_the_company_gets_its_final_verdict(self):
        import kvk_robot_controller as controller
        from unittest.mock import patch
        identity = {key: '' for key in controller.searcher.FIELDS}
        identity.update(kvk_nummer='95098747', bedrijfsnaam='J. Pijnenburg Holding B.V.')
        with tempfile.TemporaryDirectory() as directory:
            queue = Path(directory)
            for attempt in range(3):
                (queue / '95098747' / f'run-{attempt}').mkdir(parents=True)
            (queue / '95098747' / 'run-9').mkdir()
            (queue / '95098747' / 'run-9' / 'terminal-results.json').write_text('{}')  # a finished run is no failure
            with patch.object(controller, 'QUEUE', queue), patch.object(controller, 'FINALIZE', True), \
                    patch.object(controller, 'import_control_confirmation', return_value=True) as confirm, \
                    patch.object(controller.searcher, 'PUBLISHER'), \
                    patch.object(controller.subprocess, 'Popen', side_effect=AssertionError('no new run')):
                self.assertEqual(controller.failed_attempts(queue / '95098747'), 3)
                self.assertTrue(controller.research(identity, threading.Event()))
            confirm.assert_called_once()
            self.assertIn('3x technisch mislukt', confirm.call_args.args[2])
            self.assertTrue(json.loads((queue / '95098747' / 'completed.json').read_text())['written'])


class RobotControllerLoopTests(unittest.TestCase):
    def test_the_main_loop_starts_companies_and_reports_them(self):
        import kvk_robot_controller as controller
        from unittest.mock import patch
        messages = []

        def report(role, message, kvk='', halt=False):
            messages.append(message)
            if len(messages) >= 3:
                raise KeyboardInterrupt  # ends the endless loop for this test

        identity = {key: '' for key in controller.searcher.FIELDS}
        identity.update(kvk_nummer='11111111', bedrijfsnaam='Zonneveld')
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(controller, 'QUEUE', Path(directory)), patch.object(controller, 'enabled', return_value=True), \
                patch.object(controller, 'review_head', return_value=['11111111']), \
                patch.object(controller, 'identity_for', return_value=identity), \
                patch.object(controller, 'research', side_effect=lambda *_: time.sleep(0.2) or True), \
                patch.object(controller, 'report', side_effect=report):
            with self.assertRaises(KeyboardInterrupt):
                controller.main()
        self.assertTrue(any('Robot Controleur · 1 tegelijk: Zonneveld' in message for message in messages), messages)


class RobotControllerLabelTests(unittest.TestCase):
    def test_the_dashboard_names_the_robot_controller(self):
        self.assertEqual(activity_labels(True, 'controller_robot', ''), ('Robot Controleur', ''))
        self.assertEqual(activity_labels(True, 'controller_codex_sol_xhigh', 'gpt-6.1-sol')[0], 'Controleur')


if __name__ == '__main__':
    unittest.main()
