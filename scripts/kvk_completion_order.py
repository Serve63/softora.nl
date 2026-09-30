"""Allow completed API workers to apply within the current bounded queue window."""
import os
from kvk_api_validation import PROFILE


def completion_scope(connection, results, args, api):
    if os.environ.get('SOFTORA_KVK_COMPLETION_ORDER') != '1':
        return None
    if not results or not all(r.get('validation_profile') == PROFILE for r in results):
        return None
    api['assert_official_queue_mode'](args)
    received = [api['clean'](r['kvk_nummer']) for r in results]
    if len(received) != len(set(received)):
        raise ValueError('Dubbele bedrijven in voltooiingsbatch')
    if api['uses_approved_review'](args):
        return None  # Existing approved-review contract stays ordered.
    if api['uses_unusable_review'](args):
        location, _, filters, params = api['review_scope_from_args'](args)
        rows = api['fetch_unusable_review'](connection, 30, filters, params)
    else:
        location = api['assert_results_match_active_location'](connection, results)
        filters, params = api['active_location_filters'](location)
        rows = api['fetch_next'](connection, 30, filters, params, skip_deferred=False)
    eligible = {api['clean'](r['kvk_nummer']) for r in rows}
    if not set(received).issubset(eligible):
        raise ValueError('Resultaat valt buiten actuele open workerwachtrij; mogelijk al verwerkt')
    return location


def completion_draft_rows(connection, results, args, api):
    if os.environ.get('SOFTORA_KVK_COMPLETION_ORDER') != '1':
        return None
    if not results or not all(r.get('validation_profile') == PROFILE for r in results):
        return None
    api['assert_official_queue_mode'](args)
    if api['uses_approved_review'](args):
        return None
    if api['uses_unusable_review'](args):
        location, _, filters, params = api['review_scope_from_args'](args)
        rows = api['fetch_unusable_review'](connection, 30, filters, params)
    else:
        location, _, filters, params = api['planning_scope_from_args'](args)
        rows = api['fetch_next'](connection, 30, filters, params, skip_deferred=False)
    received = [api['clean'](r.get('kvk_nummer') or r.get('kvk')) for r in results]
    eligible = {api['clean'](r['kvk_nummer']): r for r in rows}
    if len(received) != len(set(received)) or not set(received).issubset(eligible):
        raise ValueError('Draft valt buiten actuele open workerwachtrij of bevat dubbele bedrijven')
    return location, [eligible[kvk] for kvk in received]


ANCHOR = '    assert_official_queue_mode(args)\n\n    if uses_approved_review(args):\n'
REPLACEMENT = ('    assert_official_queue_mode(args)\n'
               '    from kvk_completion_order import completion_scope\n'
               '    completed_scope = completion_scope(connection, results, args, globals())\n'
               '    if completed_scope is not None:\n'
               '        return completed_scope\n\n'
               '    if uses_approved_review(args):\n')


DRAFT_ANCHOR = '        ensure_schema(connection)\n        if uses_approved_review(args):\n'
DRAFT_REPLACEMENT = ('        ensure_schema(connection)\n'
    '        from kvk_completion_order import completion_draft_rows\n'
    '        ready_rows = completion_draft_rows(connection, raw_items, args, globals())\n'
    '        if ready_rows is not None:\n'
    '            location, expected_rows = ready_rows\n'
    '        elif uses_approved_review(args):\n')


def patched_source(source):
    if REPLACEMENT not in source:
        if source.count(ANCHOR) != 1:
            raise ValueError('Canonieke planningspoort gewijzigd; installatie gestopt')
        source = source.replace(ANCHOR, REPLACEMENT, 1)
    start = source.index('def command_draft_batch(')
    end = source.find('\ndef ', start + 4)
    end = len(source) if end < 0 else end
    draft = source[start:end]
    if DRAFT_REPLACEMENT not in draft:
        if draft.count(DRAFT_ANCHOR) != 1:
            raise ValueError('Canonieke draftpoort gewijzigd; installatie gestopt')
        draft = draft.replace(DRAFT_ANCHOR, DRAFT_REPLACEMENT, 1)
    source = source[:start] + draft + source[end:]
    compile(source, 'contact_research.py', 'exec')
    return source
