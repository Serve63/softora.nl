"""Producer attribution for API results and honest dashboard role labels."""
import hashlib
import json
import shutil
from pathlib import Path
from kvk_api_validation import PROFILE


def copy_execution_metadata(source, draft):
    """Carry producer metadata to the hash-validated draft without changing its bytes."""
    for suffix in ('.luna.json', '.engine.json'):
        origin, target = Path(source).with_suffix(suffix), Path(draft).with_suffix(suffix)
        if origin.exists():
            shutil.copyfile(origin, target)
        else:
            target.unlink(missing_ok=True)


def engine_for(path):
    """The sidecar next to a result records whether the API or Codex produced it."""
    for suffix in ('.luna.json', '.engine.json'):
        try:
            engine = json.loads(Path(path).with_suffix(suffix).read_text()).get('engine')
        except (OSError, ValueError, AttributeError):
            continue
        if engine:
            return engine
    return 'api'


def execution_for(results, path, is_review=False):
    profiles = [row.get('validation_profile') == PROFILE for row in results]
    if not any(profiles):
        return None
    if not all(profiles):
        raise ValueError('Meng geen API- en native-resultaten in dezelfde batch')
    role = 'controller' if is_review else 'searcher'
    if engine_for(path) == 'codex':
        effort = 'max'  # Older saved results retain their original model label.
        for suffix in ('.luna.json', '.engine.json'):
            try:
                saved = json.loads(Path(path).with_suffix(suffix).read_text())
                if saved.get('model') == 'gpt-6-luna' and saved.get('reasoning_effort') in ('max', 'xhigh'):
                    effort = saved['reasoning_effort']
                    break
            except (OSError, ValueError, AttributeError):
                continue
        label = 'Codex Luna 6 ' + ('Max' if effort == 'max' else effort)
        return {
            'producer_thread_id': 'codex:' + role,
            'model': 'gpt-6-luna', 'reasoning_effort': effort,
            'display_label': label, 'model_role': role + '_codex_luna_' + effort,
            'input_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        }
    return {
        'producer_thread_id': 'api:' + role,
        'model': 'gpt-6-luna', 'reasoning_effort': 'max',
        'display_label': 'Luna 6 Max', 'model_role': role + '_luna_max',
        'input_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
    }


def activity_labels(is_controller, model_role, researcher):
    role = str(model_role or '').lower()
    model = str(researcher or '').strip()
    if is_controller:
        return 'Controleur', model
    if role == 'searcher_robot' or model.lower() == 'robot':
        return 'Robot', ''
    if role.startswith('searcher_'):
        return 'Searcher', model
    return 'Onbekend', model


def patched_dashboard_source(source):
    """Include actual Codex producer roles in the existing recent-activity query."""
    start = source.index('def latest_treated_query(')
    end = source.index('\ndef ', start + 4)
    query = source[start:end]
    for role in ('searcher', 'controller'):
        old = "'" + role + "_luna_max'"
        new = old + ", '" + role + "_codex_luna_max', '" + role + "_codex_luna_xhigh'"
        if new not in query:
            if old not in query:
                raise ValueError('Recent-activity query changed; inspect before installing')
            query = query.replace(old, new)
    result = source[:start] + query + source[end:]
    compile(result, 'serve_dashboard.py', 'exec')
    return result
