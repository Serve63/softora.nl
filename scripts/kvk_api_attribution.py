"""Producer attribution for API results and honest dashboard role labels."""
import hashlib
from pathlib import Path
from kvk_api_validation import PROFILE


def execution_for(results, path, is_review=False):
    profiles = [row.get('validation_profile') == PROFILE for row in results]
    if not any(profiles):
        return None
    if not all(profiles):
        raise ValueError('Meng geen API- en native-resultaten in dezelfde batch')
    role = 'controller' if is_review else 'searcher'
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
