"""Read dashboard metrics and recent rows at one SQLite/WAL version and UTC instant."""
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from functools import wraps
import sqlite3
import re

from kvk_robot_control_activity import control_location, latest_controlled, queue_for

_capture = ContextVar('kvk_dashboard_capture', default=None)
USABLE = {'with_website', 'without_website'}


def epoch(value):
    text = re.sub(r'([+-]\d{2})(\d{2})$', r'\1:\2', str(value).replace('Z', '+00:00'))
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        raise ValueError('Dashboard event lacks a timezone')
    return parsed.timestamp()


class BorrowedConnection:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self.connection

    def __exit__(self, *args):
        return False  # A nested reader must never commit the shared read transaction.


def connection_for(path):
    capture = _capture.get()
    if capture:
        return BorrowedConnection(capture[0])
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def empty_counts():
    return dict(found=0, treated=0, usable=0, with_website=0, without_website=0,
                unusable=0, luna_max_found=0, successful_found=0, declared_usable=0,
                declared_unusable=0, control_room=0, unusable_grades={'1': 0, '2': 0},
                unusable_grade_activity={'1': {'added': 0, 'removed': 0},
                                         '2': {'added': 0, 'removed': 0}},
                control_room_activity={'added': 0, 'removed': 0})


def sum_events(events):
    counts = empty_counts()
    for event in events:
        for key, delta in event['delta'].items():
            target = counts
            parts = key.split('.')
            for part in parts[:-1]:
                target = target[part]
            target[parts[-1]] += delta
    counts['usable'] = counts['with_website'] + counts['without_website']
    counts['successful_found'] = counts['declared_usable']
    counts['unusable_grades'] = {grade: flow['added']
                               for grade, flow in counts['unusable_grade_activity'].items()}
    counts['control_room'] = (counts['control_room_activity']['added']
                              - counts['control_room_activity']['removed'])
    if counts['treated'] != (counts['declared_usable'] + counts['declared_unusable']
                             + counts['control_room']):
        raise ValueError('Dashboard hourly classification does not balance')
    return counts


def hourly_activity(connection, now=None):
    now = float(now if now is not None else (_capture.get() or (None, datetime.now(timezone.utc).timestamp()))[1])
    now = int(now * 1000) / 1000  # Match browser/API timestamp precision at the boundaries.
    cutoff = now - 3600
    # Indexed coarse selection; actual membership uses UTC, including fractional
    # seconds, Z, +0200, +02:00 and the repeated hour at the autumn DST change.
    coarse = (datetime.fromtimestamp(cutoff, timezone.utc) - timedelta(days=1)).date().isoformat()
    events = {}

    def add(at, key, delta=1):
        if not cutoff < at <= now or not delta:
            return
        item = events.setdefault(int(at * 1000), {})
        item[key] = item.get(key, 0) + delta

    def rows(table, timestamp='created_at'):
        index = {'contact_research_lane_events': 'idx_contact_research_lane_events_recent',
                 'contact_research_bucket_events': 'idx_contact_research_bucket_events_recent',
                 'unusable_review_grade_events': 'idx_unusable_review_grade_events_recent'}[table]
        return connection.execute(f"""SELECT e.*, c.unusable_review_grade AS current_grade,
            c.premium_database_transferred_at AS transferred_at
            FROM {table} e INDEXED BY {index}
            CROSS JOIN company_primary p ON p.kvk_nummer=e.kvk_nummer
            CROSS JOIN companies c ON c.id=p.company_id AND c.actief=1
            WHERE e.{timestamp}>=?""", (coarse,)).fetchall()

    for row in rows('contact_research_lane_events'):
        if row['lane'] == 'initial' and row['outcome'] in ('usable', 'unusable'):
            at = epoch(row['created_at'])
            add(at, 'treated')
            if row['outcome'] == 'usable':
                add(at, 'luna_max_found')
                add(at, 'declared_usable')

    changes = {}
    for row in rows('contact_research_bucket_events'):
        at = epoch(row['created_at'])
        if not cutoff < at <= now:
            continue
        key = (row['kvk_nummer'], at)
        if 'bucket' in changes.get(key, {}):
            raise ValueError('Duplicate dashboard bucket event')
        changes.setdefault(key, {})['bucket'] = row
        old, new = row['from_bucket'], row['to_bucket']
        legacy_verification = row['lane'] == 'approved_review' and not old and new in USABLE
        transferred = epoch(row['transferred_at']) if row['transferred_at'] else float('inf')
        for bucket, delta in ((old, -1), (new, 1)):
            if bucket == 'unusable' or (bucket in USABLE and at <= transferred):
                if not legacy_verification:
                    add(at, bucket, delta)
        if row['lane'] in ('approved_review', 'unusable_review'):
            if old == 'unusable' and new in USABLE:
                add(at, 'declared_usable')
            elif new == 'unusable' and (old in USABLE or row['lane'] == 'approved_review'):
                add(at, 'declared_usable', -1)

    for row in rows('unusable_review_grade_events'):
        at = epoch(row['created_at'])
        if not cutoff < at <= now:
            continue
        key = (row['kvk_nummer'], at)
        if 'grade' in changes.get(key, {}):
            raise ValueError('Duplicate dashboard grade event')
        changes.setdefault(key, {})['grade'] = row
        old, new = int(row['from_grade']), int(row['to_grade'])
        add(at, 'declared_unusable', int(new >= 2) - int(old >= 2))
        visible = lambda grade: None if grade <= 0 else '1' if grade == 1 else '2'
        if visible(old) != visible(new):
            if visible(old):
                add(at, f'unusable_grade_activity.{visible(old)}.removed')
            if visible(new):
                add(at, f'unusable_grade_activity.{visible(new)}.added')

    for (kvk, at), change in changes.items():
        bucket, grade = change.get('bucket'), change.get('grade')
        if grade is not None:
            before_grade, after_grade = grade['from_grade'], grade['to_grade']
        else:
            # Reconstruct the grade at this event, not the company's grade today.
            later = [(epoch(r['created_at']), r['from_grade']) for r in connection.execute(
                'SELECT created_at,from_grade FROM unusable_review_grade_events WHERE kvk_nummer=?', (kvk,))
                if epoch(r['created_at']) > at]
            before_grade = after_grade = min(later)[1] if later else bucket['current_grade'] or 0
        before = (bucket['from_bucket'] if bucket is not None else 'unusable') == 'unusable' and int(before_grade) < 2
        after = (bucket['to_bucket'] if bucket is not None else 'unusable') == 'unusable' and int(after_grade) < 2
        if before != after:
            add(at, 'control_room_activity.removed' if before else 'control_room_activity.added')

    # Transfers remove unused inventory; they do not undo a research decision.
    for row in connection.execute("""SELECT c.* FROM companies c INDEXED BY idx_companies_lead_status
        JOIN company_primary p ON p.company_id=c.id
        WHERE c.actief=1 AND c.lead_status IN ('usable','unusable')
          AND c.premium_database_transferred_at>=?""", (coarse,)):
        at = epoch(row['premium_database_transferred_at'])
        if not cutoff < at <= now:
            continue
        history = [(epoch(r['created_at']), r['from_bucket'], r['to_bucket']) for r in connection.execute(
            'SELECT * FROM contact_research_bucket_events WHERE kvk_nummer=?', (row['kvk_nummer'],))]
        later = sorted(event for event in history if event[0] > at)
        earlier = sorted(event for event in history if event[0] <= at)
        bucket = later[0][1] if later else earlier[-1][2] if earlier else (
            ('with_website' if str(row['website'] or '').strip() and row['website_status'] not in ('no_website', 'not_working')
             else 'without_website') if row['lead_status'] == 'usable' else '')
        if bucket in USABLE:
            add(at, bucket, -1)

    for row in connection.execute("""SELECT c.first_seen_at FROM companies c INDEXED BY idx_companies_recent_first_seen_active
        CROSS JOIN company_primary p ON p.company_id=c.id
        WHERE c.actief=1 AND c.first_seen_at<>'' AND c.first_seen_at>=?""", (coarse,)):
        add(epoch(row['first_seen_at']), 'found')
    timeline = [{'at': at, 'delta': {key: value for key, value in delta.items() if value}}
                for at, delta in sorted(events.items())]
    return sum_events(timeline), timeline


def capture_snapshot(snapshot, dashboard):
    """Refresh changing data together after the slow national/planning queries."""
    connection = sqlite3.connect(f'file:{dashboard.DB_PATH}?mode=ro', uri=True, timeout=15)
    connection.row_factory = sqlite3.Row
    token = None
    try:
        connection.execute('BEGIN')
        connection.execute('SELECT MAX(id) FROM contact_research_bucket_events').fetchone()
        measured = datetime.now(timezone.utc)
        token = _capture.set((connection, measured.timestamp()))
        state = snapshot['state']
        projections = ','.join(f"SUM(CASE WHEN {' AND '.join(dashboard.company_where(bucket, '')[0])} THEN 1 ELSE 0 END) AS {bucket}"
                               for bucket in ('usable', 'with_website', 'without_website', 'unusable'))
        row = connection.execute('SELECT ' + projections + " FROM companies INDEXED BY idx_companies_lead_status JOIN company_primary p ON p.company_id=companies.id WHERE companies.actief=1 AND companies.lead_status IN ('usable','unusable')").fetchone()
        state.update({key: int(row[key] or 0) for key in row.keys()})
        state.update(dashboard.review_classification.totals(connection))
        state['unusable_grades'] = {'1': state['control_room'], '2': state['declared_unusable']}
        state['successful_found'] = state['declared_usable']
        state['last_60_minutes'], state['last_60_minute_events'] = hourly_activity(connection)
        state['metrics_measured_at'] = measured.isoformat(timespec='milliseconds')
        snapshot['companyTotals'].update({key: state[key] for key in ('usable', 'with_website', 'without_website', 'unusable')})
        snapshot['latestTreated'] = dashboard.latest_treated_query(10)
        snapshot['latestLunaErrors'] = dashboard.latest_luna_errors_query(10)
        snapshot['latestControlled'] = latest_controlled(connection, queue_for(dashboard.DB_PATH), measured.timestamp())
        snapshot['controlLocation'] = control_location(connection, queue_for(dashboard.DB_PATH), measured.timestamp())
        snapshot['generatedAt'] = state['served_at'] = state['metrics_measured_at']
        if state['usable'] != state['with_website'] + state['without_website']:
            raise ValueError('Dashboard available inventory does not balance')
        if any(epoch(row['contact_checked_at']) > measured.timestamp() for row in snapshot['latestTreated']):
            raise ValueError('Dashboard recent row is newer than its metrics')
        return snapshot
    finally:
        if token is not None:
            _capture.reset(token)
        connection.rollback()
        connection.close()


def finalize_snapshot(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        result = function(*args, **kwargs)
        dashboard = function.__globals__['dashboard']
        if isinstance(result, tuple):
            return capture_snapshot(result[0], dashboard), result[1]
        return capture_snapshot(result, dashboard)
    return wrapped
