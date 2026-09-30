"""Keep unfinished results tied to the exact prompt and model that produced them."""
import hashlib
import json
import shutil
import time
from pathlib import Path


def contract(model, effort, instructions):
    return {'model': model, 'reasoning_effort': effort,
            'instructions_sha256': hashlib.sha256(instructions.encode()).hexdigest()}


def stamp(path, expected):
    Path(path).with_suffix('.contract.json').write_text(json.dumps(expected))


def quarantine_stale(pending, archive, expected_by_role):
    """Called only while worker threads are stopped; preserve every stale sidecar."""
    pending, archive = Path(pending), Path(archive)
    groups = {}
    for path in pending.glob('contact_agent_results_api_*'):
        if not path.is_file():
            continue
        stem = path.name.split('.', 1)[0]
        groups.setdefault(stem, []).append(path)
    moved = []
    for stem, files in groups.items():
        role = 'controller' if stem.startswith('contact_agent_results_api_controller_') else 'searcher'
        marker = pending / (stem + '.contract.json')
        try:
            actual = json.loads(marker.read_text())
        except (OSError, ValueError):
            actual = None
        if actual == expected_by_role[role]:
            continue
        destination = archive / (stem + '-' + str(time.time_ns()))
        destination.mkdir(parents=True)
        for path in files:
            shutil.move(str(path), destination / path.name)
        moved.append(stem)
    return moved
