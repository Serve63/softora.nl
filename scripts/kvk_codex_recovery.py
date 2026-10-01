"""Retry temporary Codex availability errors without rejecting company evidence."""
import json
import math


class TemporaryResearchFailure(RuntimeError):
    pass


def process_failure(process):
    # Only provider error events count, never text returned by a website/tool.
    messages = []
    for line in (process.stdout or '').splitlines():
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(event, dict):
            continue
        if event.get('type') == 'error':
            messages.append(str(event.get('message') or ''))
        elif event.get('type') == 'turn.failed':
            error = event.get('error') or {}
            messages.append(str(error.get('message') if isinstance(error, dict) else error))
    message = next((m for m in reversed(messages) if m), '') or (process.stderr or '').strip()[-600:]
    lower = message.lower()
    fatal = ('usage limit', 'insufficient_quota', 'insufficient quota', 'billing',
             'unauthorized', 'authentication', 'invalid api key', 'not supported', 'does not exist')
    temporary = ('at capacity', 'overloaded', 'temporarily unavailable', 'service unavailable',
                 'rate limit', 'too many requests', 'stream disconnected', 'connection reset',
                 'connection closed', 'error sending request', 'timed out', 'request timeout',
                 '502 bad gateway', '503 service unavailable', '504 gateway timeout')
    if not any(term in lower for term in fatal) and any(term in lower for term in temporary):
        reason = 'Codex-model tijdelijk bezet' if any(term in lower for term in ('capacity', 'overload', 'rate limit', 'too many')) else 'Codex-verbinding tijdelijk onderbroken'
        return TemporaryResearchFailure(reason)
    return RuntimeError(f'Codex stopte met code {process.returncode}: {message[:600] or "geen eindantwoord ontvangen"}')


class ResearchBackoff:
    """One backoff per failure wave; completed answers remain independently writable."""
    def __init__(self, now):
        self.now = now
        self.until = 0.0
        self.attempts = 0
        self.paths = {}
        self.reason = ''

    def defer(self, path, error):
        if self.now() >= self.until:
            self.attempts = min(5, self.attempts + 1)
            self.until = self.now() + min(30 * 2 ** (self.attempts - 1), 300)
        self.paths[path] = self.until
        self.reason = str(error)

    def ready(self, path):
        return self.now() >= self.paths.get(path, 0)

    def remaining(self):
        return max(0, math.ceil(self.until - self.now()))

    def succeeded(self, path):
        self.paths.pop(path, None)
        if not self.remaining():
            self.attempts = 0
