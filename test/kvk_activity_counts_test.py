"""Real SQL regression for hourly counters after a producer/model change."""
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from install_kvk_activity_counts import LEGACY_FILTER, patched_source, patched_directory_source


DIRECTORY_SOURCE = '''def incremental_batches(connection, batch_size, after_updated_at, after_id):
    timestamp = str(after_updated_at or "")
    cursor = max(0, int(after_id or 0))
    while True:
        rows = connection.execute(
            """
            SELECT c.id AS source_company_id, c.updated_at AS source_updated_at
            FROM company_primary AS p JOIN companies AS c ON c.id = p.company_id
            WHERE c.actief = 1
              AND (COALESCE(c.updated_at, '') > ?
                OR (COALESCE(c.updated_at, '') = ? AND c.id > ?))
            ORDER BY COALESCE(c.updated_at, ''), c.id
            LIMIT ?
            """,
            [timestamp, timestamp, cursor, batch_size],
        ).fetchall()
        if not rows:
            return
        yield [dict(row) for row in rows]
        timestamp = str(rows[-1]["source_updated_at"] or "")
        cursor = int(rows[-1]["source_company_id"])
'''


SOURCE = '''def recent_dashboard_counts(connection):
    initial_usable = connection.execute("""
        SELECT COUNT(*) FROM contact_research_lane_events
        WHERE created_at >= '2026-10-01T14:00:00+0200'
          AND lane = 'initial'
FILTER          AND outcome = 'usable'
    """).fetchone()[0]
    treated = connection.execute("""
        SELECT COUNT(*) FROM contact_research_lane_events
        WHERE created_at >= '2026-10-01T14:00:00+0200'
          AND lane = 'initial'
FILTER          AND outcome IN ('usable', 'unusable')
    """).fetchone()[0]
    return treated, initial_usable

def unrelated():
    return "searcher_luna_max"
'''.replace('FILTER', LEGACY_FILTER)


class ActivityCountsTests(unittest.TestCase):
    def test_all_committed_initial_producers_count_but_reviews_and_old_events_do_not(self):
        c = sqlite3.connect(':memory:')
        self.addCleanup(c.close)
        c.execute('CREATE TABLE contact_research_lane_events (model_role TEXT, lane TEXT, outcome TEXT, created_at TEXT)')
        roles = ['searcher_codex_sol_xhigh', 'searcher_codex_luna_xhigh',
                 'searcher_luna_max', 'searcher_robot', 'future_producer']
        for role in roles:
            for outcome in ('usable', 'unusable'):
                c.execute('INSERT INTO contact_research_lane_events VALUES (?, ?, ?, ?)',
                          (role, 'initial', outcome, '2026-10-01T14:15:00+0200'))
        for lane, outcome, timestamp in (
            ('unusable_review', 'usable', '2026-10-01T14:15:00+0200'),
            ('approved_review', 'usable', '2026-10-01T14:15:00+0200'),
            ('initial', 'pending', '2026-10-01T14:15:00+0200'),
            ('initial', 'usable', '2026-10-01T13:59:59+0200'),
        ):
            c.execute('INSERT INTO contact_research_lane_events VALUES (?, ?, ?, ?)',
                      (roles[0], lane, outcome, timestamp))
        namespace = {}
        exec(patched_source(SOURCE), namespace)
        self.assertEqual(namespace['recent_dashboard_counts'](c), (10, 5))

    def test_install_is_scoped_idempotent_and_rejects_drift(self):
        fixed = patched_source(SOURCE)
        self.assertEqual(patched_source(fixed), fixed)
        self.assertTrue(fixed.endswith(SOURCE[SOURCE.index('\ndef unrelated'):]))
        for source in (SOURCE.replace(LEGACY_FILTER, '', 1),
                       SOURCE.replace("lane = 'initial'", "lane = 'approved_review'", 1),
                       SOURCE.replace('recent_dashboard_counts', 'renamed')):
            with self.assertRaises(ValueError):
                patched_source(source)

    def test_directory_finishes_during_continuous_writes_and_next_run_catches_up(self):
        c = sqlite3.connect(':memory:')
        self.addCleanup(c.close)
        c.row_factory = sqlite3.Row
        c.executescript('''
            CREATE TABLE companies(id INTEGER PRIMARY KEY, updated_at TEXT, actief INTEGER);
            CREATE TABLE company_primary(company_id INTEGER);
            INSERT INTO companies VALUES (1,'2026-10-01T14:00:00+0200',1),
                (2,'2026-10-01T14:00:00+0200',1), (99,'2026-10-01T16:00:00+0200',0);
            INSERT INTO company_primary VALUES(1),(2),(99);
        ''')
        namespace = {}
        exec(patched_directory_source(DIRECTORY_SOURCE), namespace)
        batches = namespace['incremental_batches'](c, 1, '', 0)
        first = next(batches)
        self.assertEqual(first[0]['source_company_id'], 1)
        c.executescript('''
            INSERT INTO companies VALUES (3,'2026-10-01T14:00:00+0200',1),
                (4,'2026-10-01T14:01:00+0200',1);
            INSERT INTO company_primary VALUES(3),(4);
            UPDATE companies SET updated_at='2026-10-01T14:02:00+0200' WHERE id=1;
        ''')
        last = next(batches)
        self.assertEqual(last[0]['source_company_id'], 2)
        self.assertEqual(list(batches), [], 'New writes cannot extend this sync indefinitely')
        remaining = list(namespace['incremental_batches'](c, 10,
                         last[0]['source_updated_at'], last[0]['source_company_id']))
        self.assertEqual([row['source_company_id'] for batch in remaining for row in batch], [3, 4, 1])
        c.execute('DELETE FROM company_primary')
        self.assertEqual(list(namespace['incremental_batches'](c, 1, '', 0)), [])

    def test_directory_patch_preserves_other_functions_and_rejects_partial_install(self):
        source = DIRECTORY_SOURCE + '\ndef unrelated():\n    return 1\n'
        fixed = patched_directory_source(source)
        self.assertEqual(patched_directory_source(fixed), fixed)
        self.assertTrue(fixed.endswith('\ndef unrelated():\n    return 1\n'))
        with self.assertRaises(ValueError):
            patched_directory_source(fixed.replace('upper_timestamp, upper_id, batch_size', 'batch_size'))
        with self.assertRaises(ValueError):
            patched_directory_source(source.replace('cursor = max(0, int(after_id or 0))', 'cursor = 0'))


if __name__ == '__main__':
    unittest.main()
