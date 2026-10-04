import sqlite3
import sys
import tempfile
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


class RobotControllerLabelTests(unittest.TestCase):
    def test_the_dashboard_names_the_robot_controller(self):
        self.assertEqual(activity_labels(True, 'controller_robot', ''), ('Robot Controleur', ''))
        self.assertEqual(activity_labels(True, 'controller_codex_sol_xhigh', 'gpt-6.1-sol')[0], 'Controleur')


if __name__ == '__main__':
    unittest.main()
