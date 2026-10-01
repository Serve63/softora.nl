"""Producer attribution for API results and honest dashboard role labels."""
import hashlib
import re
import json
import shutil
import os
from pathlib import Path
from kvk_api_validation import PROFILE


DATA_ROOT = Path(__file__).resolve().parents[1] / "data"


def metadata_path(path, suffix):
    root = os.path.realpath(DATA_ROOT) + os.sep
    resolved = os.path.realpath(Path(path).with_suffix(suffix))
    if not resolved.startswith(root):
        raise ValueError("Producer metadata must remain inside the database data directory")
    return resolved


def copy_execution_metadata(source, draft):
    """Carry producer metadata to the hash-validated draft without changing its bytes."""
    for suffix in ('.luna.json', '.engine.json'):
        origin, target = metadata_path(source, suffix), metadata_path(draft, suffix)
        if os.path.exists(origin):
            shutil.copyfile(origin, target)
        elif os.path.exists(target):
            os.unlink(target)


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


# Codex models whose saved label is trusted; the role keeps the model family so
# counters and filters continue across a version change (Sol 6 -> Sol 6.1).
CODEX_ATTRIBUTED_MODELS = ('gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol')
MODEL_PARTS = re.compile(r'gpt-(\d+(?:\.\d+)?)-([a-z]+)')


def execution_for(results, path, is_review=False):
    profiles = [row.get('validation_profile') == PROFILE for row in results]
    if not any(profiles):
        return None
    if not all(profiles):
        raise ValueError('Meng geen API- en native-resultaten in dezelfde batch')
    role = 'controller' if is_review else 'searcher'
    if engine_for(path) == 'codex':
        effort = 'max'  # Older saved results retain their original model label.
        model = 'gpt-6-luna'
        for suffix in ('.luna.json', '.engine.json'):
            try:
                saved = json.loads(Path(path).with_suffix(suffix).read_text())
                if saved.get('model') in CODEX_ATTRIBUTED_MODELS and saved.get('reasoning_effort') in ('max', 'xhigh'):
                    model = saved['model']
                    effort = saved['reasoning_effort']
                    break
            except (OSError, ValueError, AttributeError):
                continue
        version, family = MODEL_PARTS.fullmatch(model).groups()
        label = 'Codex ' + family.title() + ' ' + version + ' ' + ('Max' if effort == 'max' else effort)
        return {
            'producer_thread_id': 'codex:' + role,
            'model': model, 'reasoning_effort': effort,
            'display_label': label, 'model_role': role + '_codex_' + family + '_' + effort,
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
        if old not in query:
            raise ValueError('Recent-activity query changed; inspect before installing')
        missing = ["'" + role + '_codex_' + family + '_' + effort + "'"
                   for family in ('luna', 'sol') for effort in ('max', 'xhigh')
                   if "'" + role + '_codex_' + family + '_' + effort + "'" not in query]
        if missing:
            query = query.replace(old, old + ', ' + ', '.join(missing))
    result = source[:start] + query + source[end:]
    compile(result, 'serve_dashboard.py', 'exec')
    return result
