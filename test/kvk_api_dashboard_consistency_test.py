"""Real SQLite regressions for every dashboard movement and concurrent publication."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_dashboard_consistency import capture_snapshot, connection_for, empty_counts, epoch, hourly_activity
from install_kvk_dashboard_consistency import dashboard_source, publisher_source

SCHEMA = '''
CREATE TABLE companies(id INTEGER PRIMARY KEY, kvk_nummer TEXT, actief INTEGER,
 lead_status TEXT, website TEXT DEFAULT '', website_status TEXT DEFAULT '',
 premium_database_transferred_at TEXT DEFAULT '', unusable_review_grade INTEGER DEFAULT 0,
 first_seen_at TEXT DEFAULT '');
CREATE INDEX idx_companies_lead_status ON companies(lead_status);
CREATE INDEX idx_companies_recent_first_seen_active ON companies(first_seen_at) WHERE actief=1 AND first_seen_at<>'';
CREATE TABLE company_primary(company_id INTEGER, kvk_nummer TEXT);
CREATE TABLE contact_research_lane_events(kvk_nummer TEXT, lane TEXT, outcome TEXT,
 model_role TEXT, created_at TEXT);
CREATE TABLE contact_research_bucket_events(id INTEGER PRIMARY KEY, kvk_nummer TEXT,
 lane TEXT, from_bucket TEXT, to_bucket TEXT, created_at TEXT);
CREATE TABLE unusable_review_grade_events(kvk_nummer TEXT, from_grade INTEGER,
 to_grade INTEGER, created_at TEXT);
CREATE INDEX idx_contact_research_lane_events_recent ON contact_research_lane_events(created_at);
CREATE INDEX idx_contact_research_bucket_events_recent ON contact_research_bucket_events(created_at);
CREATE INDEX idx_unusable_review_grade_events_recent ON unusable_review_grade_events(created_at);
'''
NOW = epoch('2026-10-03T15:00:00+02:00')
AT = '2026-10-03T14:59:00+0200'


class DashboardConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.c = sqlite3.connect(':memory:')
        self.c.row_factory = sqlite3.Row
        self.c.executescript(SCHEMA)
        self.addCleanup(self.c.close)

    def company(self, kvk, status='usable', grade=0, transferred='', canonical=True, active=1):
        self.c.execute('INSERT INTO companies(kvk_nummer,actief,lead_status,unusable_review_grade,premium_database_transferred_at) VALUES(?,?,?,?,?)',
                       (kvk, active, status, grade, transferred))
        if canonical:
            self.c.execute('INSERT INTO company_primary VALUES(last_insert_rowid(),?)', (kvk,))

    def lane(self, kvk, outcome='usable', at=AT, lane='initial', role='future_subscription_model'):
        self.c.execute('INSERT INTO contact_research_lane_events VALUES(?,?,?,?,?)', (kvk,lane,outcome,role,at))

    def bucket(self, kvk, old='', new='without_website', at=AT, lane='initial'):
        self.c.execute('INSERT INTO contact_research_bucket_events(kvk_nummer,lane,from_bucket,to_bucket,created_at) VALUES(?,?,?,?,?)',
                       (kvk,lane,old,new,at))

    def grade(self, kvk, old, new, at=AT):
        self.c.execute('INSERT INTO unusable_review_grade_events VALUES(?,?,?,?)', (kvk,old,new,at))

    def test_all_initial_producers_and_website_buckets_count_once(self):
        for kvk, bucket, grade in [('robot','without_website',0),('searcher','with_website',0),
                                   ('rejected','unusable',1),('definitive','unusable',2)]:
            self.company(kvk, 'unusable' if grade else 'usable', grade)
            self.lane(kvk, 'unusable' if grade else 'usable')
            self.bucket(kvk, new=bucket)
            if grade:
                self.grade(kvk, 0, grade)
        counts, events = hourly_activity(self.c, NOW)
        self.assertEqual([counts[k] for k in ('treated','declared_usable','declared_unusable','control_room','usable','with_website','without_website')],
                         [4,2,1,1,2,1,1])
        self.assertEqual(counts['control_room_activity'], {'added':1,'removed':0})
        self.assertEqual(counts['unusable_grade_activity'], {'1':{'added':1,'removed':0},'2':{'added':1,'removed':0}})
        self.assertTrue(events)

    def test_reviews_website_changes_and_gross_control_flows_balance(self):
        self.company('rescued'); self.bucket('rescued','unusable','with_website',lane='unusable_review'); self.grade('rescued',1,0)
        self.company('wrong','unusable',1); self.bucket('wrong','with_website','unusable',lane='approved_review'); self.grade('wrong',0,1)
        self.company('second','unusable',2); self.grade('second',1,2)
        self.company('third','unusable',3); self.grade('third',2,3)
        self.company('reversed'); self.bucket('reversed','unusable','without_website',lane='unusable_review'); self.grade('reversed',3,0)
        self.company('website'); self.bucket('website','without_website','with_website',lane='approved_review')
        counts, _ = hourly_activity(self.c, NOW)
        self.assertEqual(counts['treated'],0)
        self.assertEqual(counts['declared_usable'],1)
        self.assertEqual(counts['declared_unusable'],0)
        self.assertEqual(counts['control_room_activity'], {'added':1,'removed':2})
        self.assertEqual(counts['unusable_grade_activity']['2'], {'added':1,'removed':1})
        self.assertEqual((counts['usable'],counts['with_website'],counts['without_website']), (1,1,0))

    def test_offsets_dst_fractional_seconds_hour_boundary_future_and_canonical_scope(self):
        now = epoch('2026-10-25T02:30:00+01:00')
        for kvk, timestamp, expected in [('inside','2026-10-25T02:30:00.001+0200',1),
                ('boundary','2026-10-25T00:30:00Z',0),('future','2026-10-25T02:30:00.001+01:00',0),
                ('utc','2026-10-25T01:15:00Z',1),('now','2026-10-25T02:30:00+01:00',1)]:
            self.company(kvk); self.lane(kvk,at=timestamp); self.bucket(kvk,at=timestamp)
        for kvk in ('inactive','duplicate'):
            self.company(kvk,canonical=kvk!='duplicate',active=kvk!='inactive')
            self.lane(kvk); self.bucket(kvk)
        counts, _ = hourly_activity(self.c, now)
        self.assertEqual((counts['treated'],counts['without_website']), (3,3))

    def test_transfer_reduces_inventory_without_erasing_research_and_post_transfer_changes(self):
        self.company('transfer', transferred='2026-10-03T14:59:30+02:00')
        self.lane('transfer'); self.bucket('transfer',new='with_website')
        self.bucket('transfer','with_website','without_website','2026-10-03T14:59:40+0200','approved_review')
        counts,_=hourly_activity(self.c,NOW)
        self.assertEqual((counts['treated'],counts['declared_usable'],counts['usable']), (1,1,0))
        self.assertEqual((counts['with_website'],counts['without_website']), (0,0))

    def test_legacy_verification_is_not_a_second_discovery_and_bad_ledgers_fail_closed(self):
        self.company('legacy'); self.bucket('legacy',lane='approved_review')
        self.assertEqual(hourly_activity(self.c,NOW)[0],empty_counts())
        self.company('missing'); self.lane('missing',outcome='unusable')
        with self.assertRaisesRegex(ValueError,'does not balance'):
            hourly_activity(self.c,NOW)

    def test_one_wal_read_prevents_new_rows_from_overtaking_hourly_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'test.sqlite'
            writer=sqlite3.connect(db); self.addCleanup(writer.close)
            writer.execute('PRAGMA journal_mode=WAL'); writer.executescript(SCHEMA)
            measured = datetime.fromtimestamp(NOW, timezone.utc)
            def latest(limit):
                if not writer.execute('SELECT 1 FROM companies').fetchone():
                    writer.execute("INSERT INTO companies(id,kvk_nummer,actief,lead_status) VALUES(1,'robot',1,'usable')")
                    writer.execute("INSERT INTO company_primary VALUES(1,'robot')")
                    at=(measured + timedelta(milliseconds=1)).isoformat()
                    writer.execute("INSERT INTO contact_research_lane_events VALUES('robot','initial','usable','searcher_robot',?)",(at,))
                    writer.execute("INSERT INTO contact_research_bucket_events VALUES(1,'robot','initial','','without_website',?)",(at,))
                    writer.commit()
                with connection_for(db) as c:
                    return [{'contact_checked_at':r[0]} for r in c.execute('SELECT created_at FROM contact_research_lane_events')]
            def totals(c):
                return dict(treated=c.execute('SELECT COUNT(*) FROM companies').fetchone()[0],
                            declared_usable=c.execute('SELECT COUNT(*) FROM companies').fetchone()[0],declared_unusable=0,control_room=0)
            dashboard=SimpleNamespace(DB_PATH=db, company_where=lambda bucket,q:(["lead_status='usable'" if bucket in ('usable','without_website') else '0'],[]),
                review_classification=SimpleNamespace(totals=totals),latest_treated_query=latest,latest_luna_errors_query=lambda limit:[])
            # The second read must have a later API millisecond even on fast machines.
            with patch('kvk_dashboard_consistency.datetime', wraps=datetime) as clock:
                clock.now.return_value = measured
                first=capture_snapshot({'state':{},'companyTotals':{}},dashboard)
            self.assertEqual(first['latestTreated'],[])
            self.assertEqual(first['state']['last_60_minutes']['without_website'],0)
            with patch('kvk_dashboard_consistency.datetime', wraps=datetime) as clock:
                clock.now.return_value = measured + timedelta(milliseconds=2)
                second=capture_snapshot({'state':{},'companyTotals':{}},dashboard)
            self.assertEqual(len(second['latestTreated']),1)
            self.assertEqual(second['state']['last_60_minutes']['without_website'],1)
            self.assertEqual(second['generatedAt'],second['state']['metrics_measured_at'])

    def test_installer_is_idempotent_scoped_and_rejects_drift(self):
        source='''import serve_dashboard as dashboard
def build_snapshot(limit):
    return dashboard.latest_treated_query(10)
PROGRESS_STATE_KEYS = (
    "last_60_minutes",
)
'''
        fixed=publisher_source(source,True)
        self.assertEqual(publisher_source(fixed,True),fixed)
        self.assertIn('"metrics_measured_at"',fixed)
        with self.assertRaises(ValueError):
            publisher_source(source.replace('latest_treated_query','unknown_query'),True)
        with self.assertRaises(ValueError):
            dashboard_source('def db_connection():\n    return None\n')


if __name__ == '__main__':
    unittest.main()
