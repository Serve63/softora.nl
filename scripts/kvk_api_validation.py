"""Basic API research contract, independent of legacy prose/keyword checks.

The canonical validator still owns identity, queue order, eligibility, sources,
review grades, locking and writes. This profile replaces only the old mandatory
negative-research ladder. Missing contacts remain unverified review candidates.
"""
from urllib.parse import urlsplit
import re

PROFILE = 'api-basic-v1'


def validate_api_evidence(result):
    kvk = str(result.get('kvk_nummer') or '')
    routes = result.get('research_route') or result.get('route_notes') or {}
    sources = result.get('sources') or []
    evidence = result.get('field_evidence') or {}
    errors = []

    def fail(message):
        errors.append(message)

    def stage(key, statuses):
        item = routes.get(key) or {}
        if not isinstance(item, dict) or item.get('status') not in statuses or not str(item.get('notes') or '').strip():
            fail(f'{key}: leg de werkelijk uitgevoerde controle en bevinding vast')
            return {}
        return item

    urls = set()
    for source in sources:
        if not isinstance(source, dict):
            fail('bron moet URL en feitelijke notitie bevatten')
            continue
        url = str(source.get('url') or '')
        parsed = urlsplit(url)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or not str(source.get('note') or '').strip():
            fail('bron mist geldige URL of feitelijke notitie')
        else:
            urls.add(url)
    if not urls:
        fail('minimaal een geopende bewijsbron vereist')

    identity = stage('identity', {'checked'})
    stage('entity_match', {'checked'})
    stage('final_crosscheck', {'checked'})
    identity_text = str(identity.get('notes') or '') + ' ' + ' '.join(str(s.get('note') or '') for s in sources if isinstance(s, dict))
    if not re.fullmatch(r'\d{8}', kvk) or kvk not in identity_text:
        fail('identiteitsbewijs moet de koppeling met het doel-KVK uitleggen')
    if not set(identity.get('urls') or []).intersection(urls):
        fail('identiteitscontrole mist verwijzing naar een geopende bewijsbron')

    for field in ('telefoonnummer', 'email', 'website'):
        if result.get(field):
            note = str(evidence.get(field) or '')
            if not any(url in note for url in urls):
                fail(f'{field}: bewijs moet de exacte bron-URL bevatten')

    if not result.get('telefoonnummer') or not result.get('email'):
        search = stage('search_engine', {'checked'})
        query_text = str(search.get('notes') or '')
        if kvk not in query_text:
            fail('zoeknotitie moet de werkelijk gebruikte doel-KVK-query bevatten')
        stage('directories', {'checked', 'not_found', 'blocked'})
        stage('website_basic', {'checked', 'not_found', 'blocked'})
        for field in ('telefoonnummer', 'email'):
            if not result.get(field) and not str(evidence.get(field) or '').strip():
                fail(f'{field}: beschrijf ontbrekend bewijs of de concrete blokkade')
        if result.get('website_status') == 'found':
            deep = stage('website_deep', {'checked', 'not_found', 'blocked'})
            host = (urlsplit(str(result.get('website') or '')).hostname or '').removeprefix('www.')
            visited = list(urls) + list(deep.get('urls') or [])
            if not host or not any((urlsplit(str(url)).hostname or '').removeprefix('www.') == host for url in visited):
                fail('gevonden eigen website moet rechtstreeks zijn gecontroleerd')
    if errors:
        raise ValueError(f'{kvk}: API-bewijs onvolledig:\n- ' + '\n- '.join(errors))
