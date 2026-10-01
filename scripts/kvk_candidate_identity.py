"""Preserve possible matches as evidence, never as confirmed company contacts."""
import re
from urllib.parse import urlsplit

FIELDS = ('bedrijfsnaam', 'adres', 'telefoonnummer', 'telefoon_bron_url',
          'email', 'email_bron_url', 'website', 'bron_url', 'onzekerheid')


def http_url(value):
    try:
        parsed = urlsplit(str(value or ''))
        return parsed.scheme in ('http', 'https') and bool(parsed.hostname)
    except ValueError:
        return False


def website_url(value):
    """Accept an ordinary bare domain without asserting ownership or reachability."""
    value = str(value or '').strip()
    if not value:
        return ''
    if re.search(r'\s|[\x00-\x1f\\]', value):
        raise ValueError('Mogelijke website bevat ongeldige tekens')
    parsed = urlsplit(value)
    if not parsed.scheme:
        value = 'https:' + value if value.startswith('//') else 'https://' + value
        parsed = urlsplit(value)
    host = (parsed.hostname or '').encode('idna').decode('ascii')
    if (parsed.scheme not in ('http', 'https') or parsed.username or parsed.password
            or not re.fullmatch(r'(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}', host)):
        raise ValueError('Mogelijke website vereist een http(s)-URL met domeinnaam')
    parsed.port  # Reject malformed ports before storing a candidate link.
    return value


def normalize_matches(values):
    if not isinstance(values, list) or len(values) > 5:
        raise ValueError('mogelijke_matches moet een lijst van maximaal vijf kandidaten zijn')
    matches = []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError('Mogelijke match moet een object zijn')
        item = {key: str(value.get(key) or '').strip()[:1500] for key in FIELDS}
        if not http_url(item['bron_url']) or not item['onzekerheid']:
            raise ValueError('Mogelijke match vereist concrete bron_url en onzekerheid')
        for field in ('telefoonnummer', 'email'):
            if item[field] and not http_url(item[field.replace('nummer', '') + '_bron_url']):
                raise ValueError(f'Mogelijke {field} vereist eigen bron-URL')
        item['website'] = website_url(item['website'])
        matches.append(item)
    return matches


def from_answer(company, answer):
    identity = answer.get('identiteit') or {}
    if identity.get('bevestigd') is True:
        return []
    matches = normalize_matches(answer.get('mogelijke_matches') or [])
    if matches:
        return matches
    # Older answers may describe a candidate without filling any contact field.
    # Preserve the source and uncertainty; do not invent values from prose.
    has_hint = any(answer.get(key) for key in ('telefoonnummer', 'email', 'website')) or answer.get('website_status') == 'found'
    if has_hint and http_url(identity.get('bron_url')) and identity.get('uitleg'):
        item = {key: answer.get(key, '') for key in FIELDS}
        item.update(bedrijfsnaam=company.get('bedrijfsnaam', ''),
                    bron_url=identity['bron_url'], onzekerheid=identity['uitleg'])
        for field in ('telefoonnummer', 'email'):
            if not http_url(item[field.replace('nummer', '') + '_bron_url']):
                item[field] = ''
        return normalize_matches([item])
    return []


def review_matches(result):
    dossier = result.get('research_dossier') or {}
    if not isinstance(dossier, dict) or dossier.get('identity_status') != 'unconfirmed':
        return []
    return normalize_matches(dossier.get('possible_matches') or [])


def validate_review(result):
    matches = review_matches(result)
    if not matches:
        if result.get('unusable_reason') == 'identity_unconfirmed':
            raise ValueError('Identiteit controleren vereist bewaarde kandidaten met bron en onzekerheid')
        return False
    if result.get('lead_status') != 'unusable' or any(result.get(key) for key in ('telefoonnummer', 'email', 'website')):
        raise ValueError('Onbevestigde identiteit mag geen bruikbaar bedrijf of bevestigde contactvelden opleveren')
    if result.get('unusable_reason') != 'identity_unconfirmed' or result.get('website_status') != 'unknown':
        raise ValueError('Onbevestigde identiteit vereist identity_unconfirmed en website_status unknown')
    return True


def verify_api_dossier(row, required=False):
    """Distinguish API candidate evidence from a native sealed dossier receipt."""
    from kvk_api_validation import PROFILE, validate_api_evidence
    if required or row.get('validation_profile') != PROFILE:
        return False
    dossier = row.get('research_dossier')
    if not isinstance(dossier, dict):
        return False
    if dossier:
        if not set(dossier) <= {'identity_status', 'possible_matches'}:
            return False  # Native versioned receipts still go through hash verification.
        if dossier.get('identity_status') == 'unconfirmed':
            if not validate_review(row):
                raise ValueError('Ongeldig kandidaatdossier')
        elif dossier.get('identity_status') not in (None, '', 'confirmed') or dossier.get('possible_matches', []) != []:
            raise ValueError('Ongeldig kandidaatdossier')
    validate_api_evidence(row)
    return True


def preserve_candidates(result, company, answer):
    matches = from_answer(company, answer)
    if not matches or answer.get('uitsluiting'):
        return
    result.update(telefoonnummer='', email='', website='', website_status='unknown',
                  lead_status='unusable', unusable_reason='identity_unconfirmed',
                  research_dossier={'identity_status': 'unconfirmed', 'possible_matches': matches})
    note = 'Mogelijke match gevonden; identiteit nog niet bevestigd. Zie bewaarde kandidaten en bronnen.'
    result['field_evidence'] = {key: note for key in ('telefoonnummer', 'email', 'website')}
    result['route_notes']['website_basic'].update(status='blocked', notes=note)
    for item in matches:
        for field in ('bron_url', 'telefoon_bron_url', 'email_bron_url', 'website'):
            url = item[field]
            if url and not any(source['url'] == url for source in result['sources']):
                result['sources'].append({'url': url, 'label': 'Mogelijke match', 'note': item['onzekerheid']})


def prior_dossier(route_payload):
    """Use the existing audit JSON as the single source for controller evidence."""
    dossier = route_payload.get('research_dossier') or {}
    return dossier if isinstance(dossier, dict) else {}


def dashboard_evidence(connection, kvk):
    from contact_research import decode_audit_json
    import json
    row = connection.execute('SELECT route_json FROM contact_research_audits WHERE kvk_nummer=? ORDER BY id DESC LIMIT 1', (kvk,)).fetchone()
    if not row:
        return {}
    payload = json.loads(decode_audit_json(row[0]) or '{}')
    return {'research_dossier': prior_dossier(payload)}
