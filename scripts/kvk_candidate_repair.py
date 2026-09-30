"""Restore uncertainty lost by an old mapper, without reclassifying or approving a lead."""
import hashlib
import json
from pathlib import Path
from kvk_candidate_identity import from_answer, normalize_matches


def repair(connection, source, backup_path, supplemental_matches=None):
    """Caller owns canonical apply lock + transaction; later research is never overwritten."""
    from contact_research import decode_audit_json, encode_audit_json, now
    source = Path(source)
    marker = json.loads(source.with_name(source.name + '.precheck-ok.json').read_text())
    if marker.get('status') != 'PRECHECK_OK' or marker.get('sha256') != hashlib.sha256(source.read_bytes()).hexdigest():
        raise ValueError('Oorspronkelijk resultaat niet hash-gevalideerd')
    if (marker.get('scope') or {}).get('queue_kind') != 'global_initial':
        raise ValueError('Alleen oorspronkelijke Searcher-resultaten kunnen worden hersteld')
    original = json.loads(source.read_text())
    saved = json.loads(source.with_suffix('.luna.json').read_text())['answer']
    kvk = str(original['kvk_nummer'])
    if str(saved.get('kvk_nummer')) != kvk:
        raise ValueError('Antwoord hoort bij een ander bedrijf')
    row = connection.execute('SELECT c.* FROM companies c JOIN company_primary p ON p.company_id=c.id WHERE p.kvk_nummer=?', (kvk,)).fetchone()
    audit = connection.execute('SELECT * FROM contact_research_audits WHERE kvk_nummer=? ORDER BY id DESC LIMIT 1', (kvk,)).fetchone()
    if not row or not audit or row['unusable_reason'] == 'identity_unconfirmed':
        return False
    attribution = connection.execute('SELECT input_sha256 FROM research_execution_attributions WHERE kvk_nummer=? AND lane=? AND created_at=?', (kvk, 'initial', audit['created_at'])).fetchone()
    if not attribution or attribution[0] != (marker.get('validated_draft') or {}).get('sha256'):
        raise ValueError('Laatste audit hoort niet meer bij dit opgeslagen resultaat')
    if row['lead_status'] != 'unusable' or row['unusable_reviewed_at'] or int(row['unusable_review_grade'] or 0) >= 2 \
            or any(row[field] for field in ('telefoonnummer', 'email', 'website')) \
            or audit['conclusion_note'] != original['conclusion_note']:
        raise ValueError('Bedrijf inmiddels veranderd; historische reparatie gestopt')
    matches = from_answer(dict(row), saved)
    if not matches or saved.get('uitsluiting'):
        raise ValueError('Geen bewezen verloren kandidaatcontext')
    if supplemental_matches:
        matches = normalize_matches(supplemental_matches)
    payload = json.loads(decode_audit_json(audit['route_json']))
    dossier = payload.get('research_dossier') or {}
    if dossier.get('identity_status') or dossier.get('possible_matches'):
        raise ValueError('Bestaand kandidaatoordeel niet overschrijven')
    payload['research_dossier'] = dict(dossier, identity_status='unconfirmed', possible_matches=matches)
    with Path(backup_path).open('x') as backup:
        json.dump({'company': dict(row), 'audit': dict(audit), 'source': str(source)}, backup, ensure_ascii=False)
    connection.execute('UPDATE contact_research_audits SET route_json=? WHERE id=?', (encode_audit_json(payload), audit['id']))
    connection.execute("UPDATE companies SET unusable_reason='identity_unconfirmed', website_status='unknown', updated_at=? WHERE id=?", (now(), row['id']))
    return True
