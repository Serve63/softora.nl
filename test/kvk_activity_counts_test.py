"""Real SQL regression for hourly counters after a producer/model change."""
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from install_kvk_activity_counts import LEGACY_FILTER, patched_source


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


if __name__ == '__main__':
    unittest.main()
