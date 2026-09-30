"""Repair only archived Codex attributions proven by source and validated-draft hashes."""
import hashlib
import json
from pathlib import Path


def proven_execution(path):
    path = Path(path)
    marker = json.loads(path.with_name(path.name + '.precheck-ok.json').read_text())
    if marker.get('status') != 'PRECHECK_OK' or marker.get('contract_version') != 2:
        return None
    if marker.get('sha256') != hashlib.sha256(path.read_bytes()).hexdigest():
        return None
    evidence = None
    for suffix in ('.luna.json', '.engine.json'):
        sidecar = path.with_suffix(suffix)
        if sidecar.exists():
            saved = json.loads(sidecar.read_text())
            if saved.get('engine') == 'codex' and saved.get('model') == 'gpt-6-luna' and saved.get('reasoning_effort') in ('max', 'xhigh'):
                evidence = saved
                break
    if evidence is None:
        return None
    scope = marker.get('scope') or {}
    lane = 'approved_review' if scope.get('review_approved') else 'unusable_review' if scope.get('review_unusable') else 'initial'
    role = 'searcher' if lane == 'initial' else 'controller'
    return dict(lane=lane, role=role, effort=evidence['reasoning_effort'],
                digest=marker['validated_draft']['sha256'], source=str(path))


def repair(connection, completed, backup_path):
    """Caller owns transaction and canonical apply lock; save prior rows before changes."""
    changes = []
    for path in sorted(Path(completed).glob('*.json')):
        if not path.with_name(path.name + '.precheck-ok.json').exists():
            continue
        evidence = proven_execution(path)
        if evidence is None:
            continue
        rows = connection.execute('''SELECT * FROM research_execution_attributions
            WHERE lane=? AND input_sha256=? AND producer_thread_id=?''',
            (evidence['lane'], evidence['digest'], 'api:'+evidence['role'])).fetchall()
        for row in rows:
            changes.append(dict(before=list(row), evidence=evidence))
    backup_path = Path(backup_path)
    with backup_path.open('x') as backup:
        json.dump(changes, backup, ensure_ascii=False)
    for change in changes:
        old, e = change['before'], change['evidence']
        label = 'Codex Luna 6 ' + ('Max' if e['effort'] == 'max' else e['effort'])
        connection.execute('''UPDATE research_execution_attributions
            SET producer_thread_id=?, reasoning_effort=?, display_label=?
            WHERE kvk_nummer=? AND lane=? AND created_at=? AND input_sha256=? AND producer_thread_id=?''',
            ('codex:'+e['role'], e['effort'], label, old[0], old[1], old[2], e['digest'], old[3]))
        for table in ('contact_research_lane_events', 'contact_research_bucket_events'):
            connection.execute(f'''UPDATE {table} SET model_role=?
                WHERE kvk_nummer=? AND lane=? AND created_at=? AND model_role=?''',
                (e['role']+'_codex_luna_'+e['effort'], old[0], old[1], old[2], e['role']+'_luna_max'))
    return changes
