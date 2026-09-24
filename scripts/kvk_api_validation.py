"""Basic API research contract, independent of legacy prose/keyword checks.

The canonical validator still owns identity, queue order, eligibility, sources,
review grades, locking and writes. This profile replaces the old mandatory
research ladder: the Luna Searcher verifies cited contacts locally before a
result gets here, so only the structural evidence links are enforced.
"""
from urllib.parse import urlsplit
import re

PROFILE = 'api-basic-v1'


def validate_api_evidence(result):
    kvk = str(result.get('kvk_nummer') or '')
    sources = result.get('sources') or []
    evidence = result.get('field_evidence') or {}
    errors = []

    urls = set()
    for source in sources:
        url = str(source.get('url') or '') if isinstance(source, dict) else ''
        parsed = urlsplit(url)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or not str(source.get('note') or '').strip():
            errors.append('bron mist geldige URL of feitelijke notitie')
        else:
            urls.add(url)
    if not urls:
        errors.append('minimaal een geopende bewijsbron vereist')
    if not re.fullmatch(r'\d{8}', kvk):
        errors.append('ongeldig doel-KVK')
    for field in ('telefoonnummer', 'email', 'website'):
        if result.get(field) and not any(url in str(evidence.get(field) or '') for url in urls):
            errors.append(f'{field}: bewijs moet de exacte bron-URL bevatten')
    if errors:
        raise ValueError(f'{kvk}: API-bewijs onvolledig:\n- ' + '\n- '.join(errors))
