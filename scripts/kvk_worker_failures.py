"""Bounded per-company recovery; never turn a rejected answer into contact data."""
import json
import os
import time
from pathlib import Path

MAX_ATTEMPTS = 3
RETRY_DELAYS = (30, 120)


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
    return json.loads(marker.read_text()) if marker.exists() else {}


def ready(path):
    state = read(path)
    return not state.get('needs_review') and time.time() >= state.get('retry_at', 0)


def record(path, error):
    marker = state_path(path)
    state = read(path)
    attempts = state.get('attempts', 0) + 1
    needs_review = not error.retryable or attempts >= MAX_ATTEMPTS
    history = state.get('history', []) + [{'at': time.time(), 'error': str(error), 'answer': error.answer}]
    state = dict(attempts=attempts, needs_review=needs_review, history=history,
                 retry_at=0 if needs_review else time.time() + RETRY_DELAYS[attempts - 1])
    temporary = marker.with_suffix('.json.partial')
    temporary.write_text(json.dumps(state, ensure_ascii=False))
    os.replace(temporary, marker)
    return state


def clear(path):
    state_path(path).unlink(missing_ok=True)
