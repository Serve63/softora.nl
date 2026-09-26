import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import kvk_robot_import as robot_import

SCHEMA = '''
CREATE TABLE companies (kvk_nummer TEXT PRIMARY KEY, website TEXT, website_status TEXT, email TEXT,
  telefoonnummer TEXT, lead_status TEXT, contact_status TEXT, contact_checked_at TEXT, operational_status TEXT,
  source_quality TEXT, entity_role TEXT, contact_research_note TEXT, unusable_reason TEXT,
  unusable_review_grade INTEGER, usable_review_state TEXT, usable_reviewed_at TEXT,
  usable_review_outcome TEXT, updated_at TEXT);
CREATE TABLE contact_research_lane_events (kvk_nummer TEXT, lane TEXT, model_role TEXT, outcome TEXT,
  created_at TEXT, PRIMARY KEY(kvk_nummer, lane));
CREATE TABLE contact_research_bucket_events (kvk_nummer TEXT, lane TEXT, model_role TEXT, from_bucket TEXT,
  to_bucket TEXT, created_at TEXT);
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


if __name__ == '__main__':
    unittest.main()
