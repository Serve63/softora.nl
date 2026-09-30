"""Mirror current candidate evidence without changing canonical contact decisions."""
from kvk_candidate_identity import dashboard_evidence, review_matches


def enrich_directory_rows(connection, rows):
    for row in rows:
        row['research_dossier'] = {}
        if row.get('unusable_reason') != 'identity_unconfirmed':
            continue
        evidence = dashboard_evidence(connection, row['kvk_nummer'])
        matches = review_matches(evidence)
        if matches:
            row['research_dossier'] = {'identity_status': 'unconfirmed', 'possible_matches': matches}
    return rows
