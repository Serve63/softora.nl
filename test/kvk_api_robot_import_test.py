import sqlite3
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
# The Robot imports the worker module, which needs the local control helper; tests never call it.
sys.modules.setdefault('start_database_fill_control', types.SimpleNamespace(post_json=None, resolve_token=None))
import kvk_robot_import as robot_import

SCHEMA = '''
CREATE TABLE companies (kvk_nummer TEXT PRIMARY KEY, website TEXT, website_status TEXT, email TEXT,
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
CREATE TABLE research_attribution (kvk_nummer TEXT PRIMARY KEY, researcher TEXT, created_at TEXT);
CREATE TABLE research_execution_attributions (kvk_nummer TEXT, lane TEXT, created_at TEXT,
  producer_thread_id TEXT, model TEXT, reasoning_effort TEXT, display_label TEXT, input_sha256 TEXT,
  PRIMARY KEY(kvk_nummer, lane, created_at));
'''

USABLE = {'kvk_nummer': '17218892', 'lead_status': 'usable', 'phone': '06-11218795',
          'email': 'info@bonnechance.nl', 'website': 'https://bonnechance.nl/'}


class RobotImportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = Path(self.directory.name) / 'bedrijven.sqlite'
        with sqlite3.connect(self.db) as connection:
            connection.executescript(SCHEMA)
            connection.execute("INSERT INTO companies(kvk_nummer, lead_status) VALUES('17218892', 'unresearched')")
            connection.execute("INSERT INTO companies(kvk_nummer, lead_status, email) VALUES('11111111', 'unusable', '')")

    def tearDown(self):
        self.directory.cleanup()

    def row(self, kvk):
        with sqlite3.connect(self.db) as connection:
            connection.row_factory = sqlite3.Row
            return dict(connection.execute('SELECT * FROM companies WHERE kvk_nummer=?', (kvk,)).fetchone())

    def test_only_a_usable_result_with_phone_and_email_is_a_find(self):
        self.assertEqual(robot_import.robot_find(USABLE)['phone'], '06-11218795')
        self.assertIsNone(robot_import.robot_find(dict(USABLE, lead_status='unusable')))
        self.assertIsNone(robot_import.robot_find(dict(USABLE, email='')))
        self.assertIsNone(robot_import.robot_find(dict(USABLE, phone='')))

    def test_a_find_is_written_as_usable_and_attributed_to_the_robot(self):
        self.assertTrue(robot_import.import_find(self.db, robot_import.robot_find(USABLE), '2026-09-27T10:00:00+02:00'))
        row = self.row('17218892')
        self.assertEqual((row['lead_status'], row['telefoonnummer'], row['email'], row['website_status']),
                         ('usable', '06-11218795', 'info@bonnechance.nl', 'found'))
        self.assertEqual(row['contact_checked_at'], '2026-09-27T10:00:00+02:00')
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute('SELECT model_role FROM contact_research_lane_events').fetchone()[0], 'searcher_robot')
            self.assertEqual(connection.execute('SELECT display_label FROM research_execution_attributions').fetchone()[0], 'Robot')

    def test_a_company_the_searchers_already_did_is_never_overwritten(self):
        find = robot_import.robot_find(dict(USABLE, kvk_nummer='11111111'))
        self.assertFalse(robot_import.import_find(self.db, find))
        self.assertEqual(self.row('11111111')['lead_status'], 'unusable')
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM contact_research_lane_events').fetchone()[0], 0)

    def test_importing_the_same_find_twice_changes_nothing_the_second_time(self):
        find = robot_import.robot_find(USABLE)
        self.assertTrue(robot_import.import_find(self.db, find))
        self.assertFalse(robot_import.import_find(self.db, find))


NOTHING_FOUND = {'kvk_nummer': '17218892', 'decision': 'missing_phone_and_email', 'lead_status': 'unusable',
                 'ai_assist': {'reason': 'ai_incomplete'},
                 'proof': [{'url': 'https://drimble.nl/bedrijf/x', 'reason': 'no_contact'}]}


class RobotWritesEveryEstablishmentTests(unittest.TestCase):
    setUp, tearDown = RobotImportTests.setUp, RobotImportTests.tearDown

    def test_a_kvk_with_a_hoofd_and_nevenvestiging_is_written_to_both_rows(self):
        with sqlite3.connect(self.db) as connection:
            connection.execute("DROP TABLE companies")
            connection.execute("""CREATE TABLE companies (kvk_nummer TEXT, website TEXT, website_status TEXT, email TEXT,
              telefoonnummer TEXT, lead_status TEXT, contact_status TEXT, contact_checked_at TEXT, operational_status TEXT,
              source_quality TEXT, entity_role TEXT, contact_research_note TEXT, unusable_reason TEXT,
              unusable_review_grade INTEGER, unusable_reviewed_at TEXT, usable_review_state TEXT, usable_reviewed_at TEXT,
              usable_review_outcome TEXT, updated_at TEXT)""")
            connection.executemany("INSERT INTO companies(kvk_nummer, lead_status) VALUES(?, 'unresearched')",
                                   [('17218892',), ('17218892',), ('22222222',), ('22222222',)])
        self.assertTrue(robot_import.import_find(self.db, robot_import.robot_find(USABLE)))
        self.assertTrue(robot_import.import_verdict(self.db, robot_import.robot_verdict(dict(NOTHING_FOUND, kvk_nummer='22222222'))))
        with sqlite3.connect(self.db) as connection:
            rows = connection.execute("SELECT kvk_nummer, lead_status FROM companies ORDER BY kvk_nummer").fetchall()
        self.assertEqual(rows, [('17218892', 'usable')] * 2 + [('22222222', 'unusable')] * 2)


class RobotContactGateTests(unittest.TestCase):
    def test_a_website_builder_address_is_never_imported_and_goes_to_the_controleurs(self):
        jimdo = dict(USABLE, email='datenschutz@jimdo.com', decision='usable', website='https://vaartbelyn.nl/')
        self.assertIsNone(robot_import.robot_find(jimdo))
        verdict = robot_import.robot_verdict(jimdo)
        self.assertEqual(verdict['reason'], 'identity_unconfirmed')
        self.assertIn('platform-e-mail', verdict['note'])

    def test_a_theme_demo_number_abroad_on_a_dutch_site_is_rejected(self):
        demo = dict(USABLE, phone='+19168752235', website='https://cuisinevanpien.nl/', email='info@cuisinevanpien.nl')
        self.assertIsNone(robot_import.robot_find(demo))
        self.assertIn('buitenlands nummer', robot_import.contact_problem(demo))

    def test_a_foreign_company_with_its_own_foreign_number_still_passes(self):
        africa = dict(USABLE, phone='+256 773 363012', website='https://www.roadtripafrica.com/', email='info@roadtripafrica.com')
        self.assertEqual(robot_import.contact_problem(africa), '')
        self.assertIsNotNone(robot_import.robot_find(africa))
        self.assertIsNotNone(robot_import.robot_find(USABLE))


class RobotVerdictTests(unittest.TestCase):
    setUp, tearDown, row = RobotImportTests.setUp, RobotImportTests.tearDown, RobotImportTests.row

    def test_every_robot_decision_maps_to_a_searcher_reason_and_a_find_is_no_verdict(self):
        expected = {'missing_phone_and_email': 'missing_phone_and_email', 'holding': 'non_specific_entity',
                    'chain': 'chain_branch', 'stopped': 'stopped', 'conflict': 'identity_unconfirmed',
                    'technical_retry': 'missing_phone_and_email', 'no_own_contact': 'no_own_contact'}
        for decision, reason in expected.items():
            self.assertEqual(robot_import.robot_verdict(dict(NOTHING_FOUND, decision=decision))['reason'], reason)
        self.assertIsNone(robot_import.robot_verdict(USABLE))
        holding = dict(NOTHING_FOUND, bedrijfsnaam='Van Gils Beheer B.V.')
        self.assertEqual(robot_import.robot_verdict(holding)['reason'], 'non_specific_entity')
        self.assertIsNone(robot_import.robot_verdict(dict(NOTHING_FOUND, decision='something_new')))

    def test_a_verdict_is_written_as_unusable_for_the_controleurs(self):
        verdict = robot_import.robot_verdict(NOTHING_FOUND)
        self.assertTrue(robot_import.import_verdict(self.db, verdict, '2026-10-04T10:00:00+02:00'))
        row = self.row('17218892')
        self.assertEqual((row['lead_status'], row['unusable_reason'], row['unusable_review_grade']),
                         ('unusable', 'missing_phone_and_email', 1))
        self.assertIn('ai_incomplete', row['contact_research_note'])
        self.assertIn('drimble.nl', row['contact_research_note'])
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute('SELECT outcome FROM contact_research_lane_events').fetchone()[0], 'unusable')
            self.assertEqual(connection.execute('SELECT from_grade, to_grade, model_role FROM unusable_review_grade_events').fetchone(),
                             (0, 1, 'initial_research'))

    def test_a_verdict_never_overwrites_research_and_is_written_once(self):
        self.assertFalse(robot_import.import_verdict(self.db, robot_import.robot_verdict(dict(NOTHING_FOUND, kvk_nummer='11111111'))))
        verdict = robot_import.robot_verdict(NOTHING_FOUND)
        self.assertTrue(robot_import.import_verdict(self.db, verdict))
        self.assertFalse(robot_import.import_verdict(self.db, verdict))

    def test_final_verdicts_are_off_unless_switched_on(self):
        import importlib, os
        from unittest.mock import patch
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('SOFTORA_ROBOT_FINAL_VERDICTS', None)
            self.assertFalse(importlib.reload(robot_import).FINAL_VERDICTS)
        with patch.dict(os.environ, {'SOFTORA_ROBOT_FINAL_VERDICTS': '1'}):
            self.assertTrue(importlib.reload(robot_import).FINAL_VERDICTS)
        importlib.reload(robot_import)


class RobotWritesItsVerdictWhenFinishedTests(unittest.TestCase):
    setUp, tearDown, row = RobotImportTests.setUp, RobotImportTests.tearDown, RobotImportTests.row

    def finish(self, result, final_verdicts):
        import json
        import kvk_robot_v5 as robot
        from unittest.mock import patch
        run = Path(self.directory.name) / 'run'
        run.mkdir()
        (run / 'terminal-results.json').write_text(json.dumps({'results': [result]}))
        checkpoint = Path(self.directory.name) / 'completed.json'
        checkpoint.write_text(json.dumps({'kvk_nummer': '17218892', 'run_dir': str(run)}))
        with patch.object(robot, 'DB', self.db), patch.object(robot, 'totals'), patch.object(robot, 'PUBLISHER'), \
                patch.dict(robot.TOTALS, {'done': 0, 'found': 0}), \
                patch.object(robot.kvk_robot_import, 'FINAL_VERDICTS', final_verdicts):
            robot.import_completed(checkpoint)
        return json.loads(checkpoint.read_text())

    def test_without_final_verdicts_a_company_without_find_stays_for_the_searchers(self):
        state = self.finish(NOTHING_FOUND, False)
        self.assertEqual(self.row('17218892')['lead_status'], 'unresearched')
        self.assertNotIn('verdict_imported', state)

    def test_with_final_verdicts_the_robot_finishes_the_company_for_the_controleurs(self):
        state = self.finish(NOTHING_FOUND, True)
        self.assertTrue(state['verdict_imported'])
        self.assertEqual((self.row('17218892')['lead_status'], self.row('17218892')['unusable_review_grade']), ('unusable', 1))


class RobotLeavesSearcherWorkAloneTests(unittest.TestCase):
    def test_robot_skips_companies_a_searcher_is_busy_with_or_has_an_answer_for(self):
        import kvk_robot_v5 as robot
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            pending = Path(directory)
            for name in ('contact_agent_results_api_searcher_initial_00000001.busy',
                         'contact_agent_results_api_searcher_initial_00000002.luna.json',
                         'contact_agent_results_api_searcher_initial_00000003.rejected-1.json',
                         'contact_agent_results_api_controller_unusable_00000004.json'):
                (pending / name).write_text('{}')
            with patch.object(robot, 'PENDING', pending):
                self.assertEqual(robot.searcher_claims(), {'00000001', '00000002'})
                # Two days later the Searchers are off: their abandoned claims no longer block the Robot.
                self.assertEqual(robot.searcher_claims(now=time.time() + 2 * 24 * 3600), set())


class RobotKeepsRunningTests(unittest.TestCase):
    def test_a_short_dashboard_hiccup_does_not_switch_the_robot_off(self):
        import kvk_robot_v5 as robot
        from unittest.mock import patch
        polls, halted = [], []

        def enabled():
            polls.append(1)
            if len(polls) == 1:
                raise sys.modules['kvk_api_workers'].RemoteFailure('/poll', 503, 'HTTP 503')
            raise KeyboardInterrupt  # ends the endless loop for this test

        def report(role, message, kvk='', halt=False):
            if halt and 'gereed' not in message:
                halted.append(message)

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(robot, 'QUEUE', Path(directory)), patch.object(robot, 'enabled', side_effect=enabled), \
                patch.object(robot, 'report', side_effect=report), patch.object(robot.time, 'sleep'):
            with self.assertRaises(KeyboardInterrupt):
                robot.main()
        self.assertEqual(len(polls), 2)  # it kept going after the hiccup
        self.assertEqual(halted, [])     # and never switched itself off

if __name__ == '__main__':
    unittest.main()
