"""Keep isolated company failures out of the executable queue, without changing leads.

The existing failure markers remain the recovery evidence. Only the API worker
compatibility mode uses this queue; native/manual research keeps its strict order.
Selection, precheck, draft and apply all use the same location and row filters.
"""
import json
import os
import re
from pathlib import Path
import kvk_worker_failures as failures

PENDING = Path(__file__).resolve().parents[1] / 'data' / 'kvk_api_pending'


def isolated(role, pending=None):
    pending = Path(pending) if pending is not None else PENDING
    pattern = re.compile(r'contact_agent_results_api_' + re.escape(role)
                         + r'_(?:initial|unusable)_(\d{8})\.failure\.json')
    result = set()
    for marker in pending.glob(f'contact_agent_results_api_{role}_*.failure.json'):
        match = pattern.fullmatch(marker.name)
        if not match:
            continue
        path = marker.with_name(marker.name.replace('.failure.json', '.json'))
        if failures.read(path).get('needs_review') and not failures.ready(path):
            result.add(match.group(1))
    return result


def filters_for(role, filters, params):
    if os.environ.get('SOFTORA_KVK_COMPLETION_ORDER') != '1':
        return filters, params
    excluded = isolated(role)
    if not excluded:
        return filters, params
    # One bound JSON parameter also works when many historical failures exist.
    return ([*(filters or []), 'c.kvk_nummer NOT IN (SELECT value FROM json_each(?))'],
            [*(params or []), json.dumps(sorted(excluded))])


def planning_location(api):
    if os.environ.get('SOFTORA_KVK_COMPLETION_ORDER') != '1' or not isolated('searcher'):
        return None
    import serve_dashboard as dashboard
    state = dashboard.load_json(dashboard.STATE_PATH, {})
    existing = set(state.get('processed_location_codes') or []) | set(state.get('kvk_search_completed_location_codes') or [])
    cached, _, _ = dashboard.load_contact_progress_cache(sorted(existing))
    completed = (set(state.get('contact_search_completed_location_codes') or []) | cached) & existing
    locations = {str(item['woonplaatscode']): item for item in dashboard.load_json(dashboard.LOCATIONS_PATH, [])}
    with api['connect']() as connection:
        for code in dashboard.ordered_location_codes():
            if code not in existing or code in completed:
                continue
            location = locations[code]
            filters, params = api['active_location_filters'](location)
            if api['fetch_next'](connection, 1, filters, params):
                return {'contact_active_location_code': code}, location
    # Isolated rows are still unfinished, never marked completed or unusable.
    return ({'contact_active_location_code': ''},
            {'woonplaatscode': '__worker_queue_empty__', 'woonplaats': 'Geen uitvoerbaar onderzoek'})
