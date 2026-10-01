"""Offline Robot v5 runner checks. Never runs the real engine or touches the company database."""
import json
import sqlite3
import sys
import tempfile
import textwrap
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
sys.modules.setdefault('start_database_fill_control', types.SimpleNamespace(post_json=None, resolve_token=None))
import kvk_robot_v5 as robot

FAKE_ENGINE = textwrap.dedent('''
    import argparse, json, pathlib, time
    parser = argparse.ArgumentParser()
    parser.add_argument('--inputs'); parser.add_argument('--run-dir')
    parser.add_argument('--workers'); parser.add_argument('--concurrency')
    parser.add_argument('--discovery-json')
    args = parser.parse_args()
    identity = json.loads(pathlib.Path(args.inputs).read_text())[0]
    if identity['bedrijfsnaam'] == 'Traag':
        time.sleep(30)
    run = pathlib.Path(args.run_dir); run.mkdir(parents=True)
    result = {'kvk_nummer': identity['kvk_nummer'], 'lead_status': 'usable',
              'phone': '013-1234567', 'email': 'info@voorbeeld.nl', 'website': 'https://voorbeeld.nl'}
    (run / 'terminal-results.json').write_text(json.dumps({'results': [result]}))
''')


class RobotRunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.db = root / 'bedrijven.sqlite'
        with sqlite3.connect(self.db) as db:
            db.executescript('''
                CREATE TABLE companies (id INTEGER PRIMARY KEY, kvk_nummer TEXT, bedrijfsnaam TEXT, plaats TEXT,
                  straatnaam TEXT, huisnummer TEXT, postcode TEXT, vestigingsnummer TEXT, lead_status TEXT);
                CREATE TABLE company_primary (kvk_nummer TEXT PRIMARY KEY, company_id INTEGER);
            ''')
            for index in range(1, 9):
                kvk = f'{index:08}'
                status = 'usable' if index == 3 else 'unresearched'
                db.execute('INSERT INTO companies VALUES (?,?,?,?,?,?,?,?,?)',
                           (index, kvk, f'Bedrijf {index}', 'Haaren', 'Straat', str(index), '5076AA', '', status))
                db.execute('INSERT INTO company_primary VALUES (?,?)', (kvk, index))
        engine = root / 'engine.py'
        engine.write_text(FAKE_ENGINE)
        self.patches = [patch.object(robot, 'QUEUE', root / 'queue'), patch.object(robot, 'DB', self.db),
                        patch.object(robot, 'PENDING', root / 'pending'), patch.object(robot, 'ENGINE', engine),
                        patch.object(robot, 'PYTHON', Path(sys.executable)), patch.object(robot, 'WORKERS', 3)]
        for patcher in self.patches:
            patcher.start()
        robot.QUEUE.mkdir()
        robot.PENDING.mkdir()
        robot.TOTALS.clear()
        self.reads = []

    def tearDown(self):
        for patcher in self.patches:
            patcher.stop()
        robot.TOTALS.clear()
        self.directory.cleanup()

    def planning(self, clock=None):
        def read(limit):
            self.reads.append(limit)
            return [f'{index:08}' for index in range(1, 9)][:limit]
        return robot.Planning(read=read, clock=clock or time.monotonic)

    def test_planning_is_read_once_per_window_not_once_per_company(self):
        planning = self.planning()
        first = planning.take(2, {})
        second = planning.take(1, {kvk['kvk_nummer']: None for kvk in first})
        self.assertEqual([item['kvk_nummer'] for item in first + second], ['00000001', '00000002', '00000004'])
        self.assertEqual(len(self.reads), 1)

    def test_planning_order_skips_finished_claimed_running_and_already_researched_companies(self):
        (robot.QUEUE / '00000001').mkdir()
        (robot.QUEUE / '00000001' / 'completed.json').write_text('{}')
        (robot.PENDING / 'contact_agent_results_api_searcher_initial_00000002.busy').write_text('')
        picked = self.planning().take(3, {'00000004': None})
        # 00000003 is already usable in the database; the Robot never researches it again.
        self.assertEqual([item['kvk_nummer'] for item in picked], ['00000005', '00000006', '00000007'])

    def test_a_stale_window_is_read_afresh_so_a_changed_location_is_followed(self):
        now = [0.0]
        planning = self.planning(clock=lambda: now[0])
        planning.take(1, {})
        now[0] += robot.PLANNING_REFRESH_SECONDS + 1
        planning.take(1, {})
        self.assertEqual(len(self.reads), 2)

    def test_research_writes_a_checkpoint_and_imports_the_find_once(self):
        identity = robot.identity_for('00000001')
        with patch.object(robot, 'import_find', return_value=True) as imported, \
                patch.object(robot.PUBLISHER, 'request') as published:
            self.assertTrue(robot.research(identity, threading.Event()))
            self.assertTrue(robot.research(identity, threading.Event()))
        state = json.loads((robot.QUEUE / '00000001' / 'completed.json').read_text())
        self.assertTrue(state['imported'])
        self.assertEqual(imported.call_count, 1)
        self.assertEqual(published.call_count, 1)
        self.assertEqual(robot.totals(), (1, 1))

    def test_dashboard_stop_ends_a_running_company_without_a_checkpoint(self):
        identity = dict(robot.identity_for('00000001'), bedrijfsnaam='Traag')
        stop = threading.Event()
        threading.Timer(1.5, stop.set).start()
        started = time.monotonic()
        self.assertFalse(robot.research(identity, stop))
        self.assertLess(time.monotonic() - started, 15)
        self.assertFalse((robot.QUEUE / '00000001' / 'completed.json').exists())

    def test_several_companies_run_at_the_same_time(self):
        identities = [dict(robot.identity_for(f'{index:08}'), bedrijfsnaam='Traag') for index in (1, 2, 4)]
        stop = threading.Event()
        threads = [threading.Thread(target=robot.research, args=(identity, stop)) for identity in identities]
        for thread in threads:
            thread.start()
        time.sleep(2)
        busy = sum((robot.QUEUE / identity['kvk_nummer'] / 'runner.log').exists() for identity in identities)
        stop.set()
        for thread in threads:
            thread.join(15)
        self.assertEqual(busy, 3)

    def test_live_publish_bursts_collapse_into_one_follow_up(self):
        calls = []
        release = threading.Event()
        def publish():
            calls.append(1)
            release.wait(5)
        publisher = robot.LivePublisher(publish)
        for _ in range(5):
            publisher.request()
        release.set()
        deadline = time.monotonic() + 5
        while publisher.running and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(len(calls), 2)


    def test_the_engine_setting_only_names_an_installed_engine_never_a_path(self):
        import importlib
        for value in ('/tmp/evil.py', '../../bin/sh', 'v9'):
            with patch.dict('os.environ', {'SOFTORA_ROBOT_ENGINE': value}):
                module = importlib.reload(robot)
                self.assertIn(module.ENGINE, (module.ENGINE_V5, module.ENGINE_V7))
        importlib.reload(robot)


if __name__ == '__main__':
    unittest.main()
