"""How much of the Codex subscription's weekly limit is left, for the dashboard heading.

The Codex app-server answers account/rateLimits/read for the signed-in account without a model call, so
reading it costs no usage. The answer is cached for a minute next to the database; when Codex cannot be
asked, the last known value stays (with its own measuring time) and nothing breaks.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import time

CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
REFRESH_SECONDS = 60
TIMEOUT_SECONDS = 15


def cache_for(db_path):
    return Path(db_path).parent / 'shadow' / 'codex-usage.json'


def ask_codex(timeout=TIMEOUT_SECONDS):
    """The account's codex rate limits from a short-lived app-server, or None."""
    env = {key: value for key, value in os.environ.items() if key not in ('OPENAI_API_KEY', 'CODEX_API_KEY')}
    try:
        child = subprocess.Popen([CODEX, 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, text=True, env=env)
    except OSError:
        return None
    deadline = time.monotonic() + timeout
    try:
        for message in ({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'softora-usage', 'version': '1'}}},
                        {'jsonrpc': '2.0', 'method': 'initialized'},
                        {'jsonrpc': '2.0', 'id': 2, 'method': 'account/rateLimits/read'}):
            child.stdin.write(json.dumps(message) + '\n')
        child.stdin.flush()
        while time.monotonic() < deadline:
            line = child.stdout.readline()
            if not line:
                return None
            try:
                reply = json.loads(line)
            except ValueError:
                continue
            if reply.get('id') == 2:
                return (reply.get('result') or {}).get('rateLimits')
        return None
    except (OSError, ValueError):
        return None
    finally:
        child.kill()
        child.wait()


def usage_from(limits, measured):
    primary = (limits or {}).get('primary') or {}
    used = primary.get('usedPercent')
    if not isinstance(used, (int, float)):
        return None
    used = max(0.0, min(100.0, float(used)))
    resets = primary.get('resetsAt')
    return {'usedPercent': used, 'remainingPercent': round(100.0 - used, 1),
            'windowMinutes': primary.get('windowDurationMins'),
            'resetsAt': datetime.fromtimestamp(resets, timezone.utc).isoformat(timespec='seconds') if isinstance(resets, (int, float)) else '',
            'measuredAt': datetime.fromtimestamp(measured, timezone.utc).isoformat(timespec='seconds')}


def codex_usage(cache, now=None, reader=ask_codex):
    """The cached usage when it is under a minute old, else a fresh reading (the last one when Codex fails)."""
    now = time.time() if now is None else now
    cache = Path(cache)
    try:
        cached = json.loads(cache.read_text())
    except (OSError, ValueError):
        cached = None
    if cached and now - float(cached.get('_read_at') or 0) < REFRESH_SECONDS:
        return {key: value for key, value in cached.items() if not key.startswith('_')}
    fresh = usage_from(reader(), now)
    if fresh is None:
        return {key: value for key, value in cached.items() if not key.startswith('_')} if cached else None
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache.with_suffix('.tmp')
        temporary.write_text(json.dumps({**fresh, '_read_at': now}))
        temporary.replace(cache)
    except OSError:
        pass
    return fresh
