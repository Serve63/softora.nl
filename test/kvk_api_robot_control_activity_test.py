import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_robot_control_activity import latest_controlled, queue_for


class LatestControlledTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.queue = queue_for(Path(self.directory.name) / 'nederland_bedrijven.sqlite')
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''CREATE TABLE companies(id INTEGER PRIMARY KEY, kvk_nummer TEXT, bedrijfsnaam TEXT,
            lead_status TEXT, unusable_reason TEXT, unusable_review_grade INTEGER, telefoonnummer TEXT, email TEXT,
            website TEXT, plaats TEXT, provincie TEXT);
            CREATE TABLE company_primary(company_id INTEGER, kvk_nummer TEXT);''')
        for kvk, name, status, email in (('1', 'Teruggevonden BV', 'usable', 'info@terug.nl'),
                                         ('2', 'Leeg BV', 'unusable', 'oud@leeg.nl'), ('3', 'Nieuw BV', 'unusable', '')):
            self.db.execute("INSERT INTO companies(kvk_nummer,bedrijfsnaam,lead_status,unusable_review_grade,email,plaats,provincie) "
                            "VALUES(?,?,?,1,?,'Helvoirt','Noord-Brabant')", (kvk, name, status, email))
            self.db.execute('INSERT INTO company_primary VALUES(last_insert_rowid(),?)', (kvk,))

    def checkpoint(self, kvk, at, outcome='confirmed', written=False):
        folder = self.queue / kvk
        folder.mkdir(parents=True)
        (folder / 'completed.json').write_text(json.dumps(
            {'kvk_nummer': kvk, 'outcome': outcome, 'written': written, 'completed_at': at}))

    def test_newest_checks_first_with_their_outcome_and_only_recovered_contacts(self):
        self.checkpoint('1', 100.0, 'recovered', True)
        self.checkpoint('2', 200.0)
        self.checkpoint('3', 999.0)  # after the measurement: belongs to the next snapshot
        (self.queue / 'kapot').mkdir()
        (self.queue / 'kapot' / 'completed.json').write_text('{')
        rows = latest_controlled(self.db, self.queue, 500.0)
        self.assertEqual([(r['bedrijfsnaam'], r['control_outcome']) for r in rows],
                         [('Leeg BV', 'checked'), ('Teruggevonden BV', 'recovered')])
        self.assertEqual(rows[0]['email'], '')
        self.assertEqual(rows[1]['email'], 'info@terug.nl')
        self.assertEqual(rows[1]['found_by_role_label'], 'Robot Controleur')
        self.assertEqual(rows[1]['woonplaats'], 'Helvoirt')

    def test_at_most_ten_and_an_absent_queue_is_empty(self):
        self.assertEqual(latest_controlled(self.db, self.queue, 500.0), [])
        for index in range(12):
            kvk = '1' if index == 0 else f'x{index}'
            self.checkpoint(kvk, float(index))
        self.assertEqual(len(latest_controlled(self.db, self.queue, 500.0, limit=10)), 1)  # unknown KVKs skipped


if __name__ == '__main__':
    unittest.main()
