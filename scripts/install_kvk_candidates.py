"""Install candidate evidence hooks into the canonical runtime; no workers or data writes."""
import argparse
from pathlib import Path
from install_kvk_api_validation import install

RESEARCH_EDITS = (
    ('VALID_UNUSABLE_REASONS = {\n', 'VALID_UNUSABLE_REASONS = {\n    "identity_unconfirmed",\n'),
    ('    field_evidence: dict[str, str] = {}\n    conclusion_note = ""\n',
     '    route_payload = {}\n    field_evidence: dict[str, str] = {}\n    conclusion_note = ""\n'),
    ('        "sources": sources,\n        "field_evidence": field_evidence,\n        "conclusion_note": conclusion_note,\n',
     '        "sources": sources,\n        "field_evidence": field_evidence,\n        "conclusion_note": conclusion_note,\n'
     '        "research_dossier": route_payload.get("research_dossier") or {},\n'),
    ('    if website_status == "unknown":\n',
     '    from kvk_candidate_identity import validate_review\n'
     '    if website_status == "unknown" and not (api_basic and validate_review(result)):\n'),
)

DASHBOARD_EDITS = (
    ('    return latest\n\n\nLUNA_ERROR_FIELD_LABELS',
     '    from kvk_candidate_identity import dashboard_evidence\n'
     '    with db_connection() as connection:\n'
     '        for item in latest:\n'
     '            if item["unusable_reason"] == "identity_unconfirmed":\n'
     '                item.update(dashboard_evidence(connection, item["kvk_nummer"]))\n'
     '    return latest\n\n\nLUNA_ERROR_FIELD_LABELS'),
)

DIRECTORY_EDITS = (
    ('import review_classification\n',
     'import review_classification\nfrom kvk_directory_candidates import enrich_directory_rows\n'),
    ('        payload = [row_payload(row) for row in rows]\n        yield payload\n        cursor =',
     '        payload = enrich_directory_rows(connection, [row_payload(row) for row in rows])\n        yield payload\n        cursor ='),
    ('        payload = [row_payload(row) for row in rows]\n        yield payload\n        timestamp =',
     '        payload = enrich_directory_rows(connection, [row_payload(row) for row in rows])\n        yield payload\n        timestamp ='),
)


def patch(source, edits):
    installed = [new in source for old, new in edits]
    if all(installed):
        return source
    if any(installed):
        raise ValueError('Onvolledige kandidaatinstallatie; inspecteer eerst')
    for old, new in edits:
        if source.count(old) != 1:
            raise ValueError('Canonieke bron gewijzigd; geen installatie uitgevoerd')
        source = source.replace(old, new, 1)
    compile(source, '<candidate-runtime>', 'exec')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    for name in ('kvk_candidate_identity.py', 'kvk_api_validation.py', 'kvk_directory_candidates.py'):
        if (args.root / 'scripts' / name).read_bytes() != Path(__file__).with_name(name).read_bytes():
            raise ValueError('Installeer eerst de kandidaatmodules')
    plans = []
    for name, edits in (('contact_research.py', RESEARCH_EDITS), ('serve_dashboard.py', DASHBOARD_EDITS),
                        ('sync_company_directory_online.py', DIRECTORY_EDITS)):
        target = args.root / 'scripts' / name
        before = target.read_text()
        plans.append((target, before, patch(before, edits)))
    for target, before, after in plans:
        install(target, before, after, args.root)
    print('Kandidaatbewijs: geïnstalleerd')


if __name__ == '__main__':
    main()
