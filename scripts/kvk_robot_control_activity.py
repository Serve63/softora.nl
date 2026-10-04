"""The Robot Controleur's latest checks, for the dashboard's "Robot Controleur" list.

In recover-only mode a check that finds nothing writes nothing to the database (the company stays in the
review queue), so the dashboard's recent rows never show it. Each check does leave its checkpoint
(completed.json) in the controller queue; this reads the newest ones and joins the company's current row.
Display only: nothing here is business truth, and an unreadable checkpoint is skipped.
"""
from datetime import datetime, timezone
import json
from pathlib import Path

LIMIT = 10
FIELDS = ('kvk_nummer', 'bedrijfsnaam', 'lead_status', 'unusable_reason', 'unusable_review_grade',
          'telefoonnummer', 'email', 'website', 'woonplaats', 'provincie')


def queue_for(db_path):
    return Path(db_path).parent / 'shadow' / 'robot-controller'


def _checkpoints(queue, measured):
    found = []
    for path in queue.glob('*/completed.json'):
        try:
            item = json.loads(path.read_text())
            at = float(item['completed_at'])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if at <= measured and str(item.get('kvk_nummer') or ''):
            found.append((at, str(item['kvk_nummer']), item.get('outcome') == 'recovered' and bool(item.get('written'))))
    return sorted(found, reverse=True)


def latest_controlled(connection, queue, measured, limit=LIMIT):
    """Newest Robot Controleur checks (at most `limit`), each with its company's current data."""
    rows = []
    for at, kvk, recovered in _checkpoints(Path(queue), measured):
        if len(rows) >= limit:
            break
        company = connection.execute(
            'SELECT c.kvk_nummer, c.bedrijfsnaam, c.lead_status, c.unusable_reason, c.unusable_review_grade, '
            'c.telefoonnummer, c.email, c.website, c.plaats AS woonplaats, c.provincie '
            'FROM company_primary p JOIN companies c ON c.id=p.company_id WHERE p.kvk_nummer=?', (kvk,)).fetchone()
        if company is None:
            continue
        row = {key: company[key] if company[key] is not None else '' for key in FIELDS}
        if not recovered:  # nothing found: the company stays in the review queue, so show no contacts
            row.update(telefoonnummer='', email='', website='')
        row.update(contact_checked_at=datetime.fromtimestamp(at, timezone.utc).isoformat(timespec='seconds'),
                   control_outcome='recovered' if recovered else 'checked',
                   found_by_role_label='Robot Controleur', found_by_model_label='')
        rows.append(row)
    return rows


def _places(connection, kvks):
    places = {}
    kvks = list(kvks)
    for start in range(0, len(kvks), 500):
        chunk = kvks[start:start + 500]
        rows = connection.execute(
            'SELECT p.kvk_nummer, c.plaats FROM company_primary p JOIN companies c ON c.id=p.company_id '
            f"WHERE p.kvk_nummer IN ({','.join('?' * len(chunk))})", chunk).fetchall()
        places.update({str(row[0]): str(row[1] or '') for row in rows})
    return places


def control_location(connection, queue, measured):
    """Where the Robot Controleur checks now: the place of its latest check, the share of that place's
    review queue (grade-1 unusable companies plus those it already checked there) it has checked, and how
    many it recovered there. None before its first check."""
    checks = _checkpoints(Path(queue), measured)
    if not checks:
        return None
    places = _places(connection, {kvk for _at, kvk, _recovered in checks})
    place = places.get(checks[0][1], '')
    if not place:
        return None
    checked = {kvk for _at, kvk, _recovered in checks if places.get(kvk) == place}
    recovered = {kvk for _at, kvk, was_recovered in checks if was_recovered and places.get(kvk) == place}
    waiting = {str(row[0]) for row in connection.execute(
        "SELECT p.kvk_nummer FROM company_primary p JOIN companies c ON c.id=p.company_id "
        "WHERE c.plaats=? AND c.lead_status='unusable' AND COALESCE(c.unusable_review_grade, 1)=1", (place,))}
    total = len(waiting | checked)
    percent = int(100 * len(checked) / total) if total else 100
    province = connection.execute(
        'SELECT c.provincie FROM company_primary p JOIN companies c ON c.id=p.company_id WHERE p.kvk_nummer=?',
        (checks[0][1],)).fetchone()
    return {'place': place, 'provincie': str(province[0] or '') if province else '', 'percent': percent,
            'checked': len(checked), 'total': total, 'recovered': len(recovered)}
