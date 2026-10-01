"""Bounded per-company recovery; never turn a rejected answer into contact data."""
import json
import os
import time
from pathlib import Path

MAX_ATTEMPTS = 3
RETRY_DELAYS = (30, 120)
MAPPING_VERSION = 2


class CompanyFailure(RuntimeError):
    retryable = True
    answer = None


class InvalidModelAnswer(CompanyFailure):
    def __init__(self, message, answer=None):
        super().__init__(message)
        self.answer = answer


def state_path(path):
    return Path(path).with_suffix('.failure.json')


def read(path):
    marker = state_path(path)
    if not marker.exists():
        return {}
    try:
        state = json.loads(marker.read_text())
        if not isinstance(state, dict):
            raise ValueError('Herstelstatus is geen object')
        return state
    except FileNotFoundError:
        return {}
    except (ValueError, UnicodeError, OSError):
        # One corrupt company's marker must not stop every worker. Preserve it.
        return {'needs_review': True, 'mapping_version': MAPPING_VERSION,
                'history': [{'error': 'Herstelbestand onleesbaar; origineel bewaard.'}]}


def ready(path):
    state = read(path)
    if (state.get('needs_review') and state.get('mapping_version', 1) < MAPPING_VERSION
            and Path(path).with_suffix('.luna.json').is_file()):
        # A new mapper may retry a saved answer once, without another model request.
        return True
    return not state.get('needs_review') and time.time() >= state.get('retry_at', 0)


def record(path, error):
    marker = state_path(path)
    state = read(path)
    attempts = state.get('attempts', 0) + 1
    needs_review = not error.retryable or attempts >= MAX_ATTEMPTS
    history = state.get('history', []) + [{'at': time.time(), 'error': str(error), 'answer': error.answer}]
    state = dict(attempts=attempts, needs_review=needs_review, history=history, mapping_version=MAPPING_VERSION,
                 retry_at=0 if needs_review else time.time() + RETRY_DELAYS[attempts - 1])
    temporary = marker.with_suffix('.json.partial')
    temporary.write_text(json.dumps(state, ensure_ascii=False))
    os.replace(temporary, marker)
    return state


def clear(path):
    state_path(path).unlink(missing_ok=True)
