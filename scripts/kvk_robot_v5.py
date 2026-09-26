#!/usr/bin/env python3
"""Dashboard-controlled Robot v5 that runs its own round ahead of the Searchers.

Follows the current planning's open companies in order. Completed evidence is
reused on restart; an interrupted company is retried before taking another.
A usable find (phone and e-mail) goes straight into the database so the
Searchers skip it; anything the Robot did not find is left for the Searchers.
No model or paid API is called here.
"""
from __future__ import annotations
import fcntl
import json
import os
import re
import signal
import sqlite3
import subprocess
import time
from pathlib import Path
from kvk_api_workers import PENDING, ROOT, call, report, run_cli, save_result
from kvk_robot_import import import_find, publish_live, robot_find

QUEUE = ROOT / 'data' / 'shadow' / 'robot-v5-dashboard'
DB = ROOT / 'data' / 'nederland_bedrijven.sqlite'
ENGINE = ROOT / 'experiments' / 'robot-v5-deterministic-20260919' / 'run_shadow.py'
PYTHON = ROOT / '.venv-robot-zero' / 'bin' / 'python'
FIELDS = ('id', 'kvk_nummer', 'bedrijfsnaam', 'plaats', 'straatnaam', 'huisnummer', 'postcode', 'vestigingsnummer')


def enabled():
    state = call('/poll', {}).get('state', {})
    return bool(state.get('workers', {}).get('robot', {}).get('enabled'))


SEARCHER_WORK = re.compile(r'^contact_agent_results_api_searcher_initial_(\d{8})\.(?:busy|luna\.json|json|recovery\.json)$')


def searcher_claims():
    """Companies a Searcher is researching or has an answer waiting for; the Robot leaves those alone."""
    if not PENDING.is_dir():
        return set()
    return {match.group(1) for match in (SEARCHER_WORK.match(path.name) for path in PENDING.iterdir()) if match}


def next_identity():
    # Read current planning afresh; never resume an obsolete location or fixed list.
    completed = {p.parent.name for p in QUEUE.glob('*/completed.json')}
    skip = completed | searcher_claims()
    packet = json.loads(run_cli('contact_research.py', 'planning-next', '--fast-head',
                               '--limit', str(len(skip) + 1), '--json'))
    company = next((c for c in packet.get('bedrijven', []) if str(c['kvk_nummer']) not in skip), None)
    if not company:
        return None
    with sqlite3.connect(f'file:{ROOT / "data/nederland_bedrijven.sqlite"}?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        row = db.execute('SELECT c.* FROM company_primary p JOIN companies c ON c.id=p.company_id WHERE p.kvk_nummer=?',
                         (company['kvk_nummer'],)).fetchone()
        if not row:
            raise RuntimeError('Bedrijf uit de actuele planning is niet meer beschikbaar.')
        return {key: row[key] for key in FIELDS}


def terminate(process):
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def research(identity):
    kvk = str(identity['kvk_nummer'])
    folder = QUEUE / kvk
    folder.mkdir(parents=True, exist_ok=True)
    checkpoint = folder / 'completed.json'
    if checkpoint.exists():
        return True
    source = folder / 'input.json'
    save_result(source, [identity])
    attempt = folder / f'run-{time.time_ns()}'
    command = [str(PYTHON), str(ENGINE), '--inputs', str(source), '--run-dir', str(attempt),
               '--workers', '1', '--concurrency', '4']
    # A complete discovery artifact can be reused after a stopped verification step.
    discoveries = sorted(folder.glob('run-*/discovery.json'), reverse=True)
    for discovery in discoveries:
        try:
            json.loads(discovery.read_text())
        except (ValueError, OSError):
            continue
        command += ['--discovery-json', str(discovery)]
        break
    if not enabled():
        return False
    with (folder / 'runner.log').open('a') as log:
        child = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
        try:
            while child.poll() is None:
                if not enabled():
                    terminate(child)
                    return False
                report('robot', f'Onderzoekt {identity["bedrijfsnaam"][:95]}', kvk)
                time.sleep(5)
            if child.returncode:
                raise RuntimeError(f'Robot v5 stopte bij {kvk}; voortgang en foutlog bewaard.')
        finally:
            terminate(child)
    result_for(attempt, kvk)  # refuses a run that does not describe this company
    save_result(checkpoint, {'kvk_nummer': kvk, 'run_dir': str(attempt), 'completed_at': time.time()})
    import_completed(checkpoint)
    return True


def result_for(run_dir, kvk):
    results = json.loads((Path(run_dir) / 'terminal-results.json').read_text()).get('results', [])
    item = next((item for item in results if str(item.get('kvk_nummer') or item.get('kvk')) == kvk), None)
    if item is None:
        raise RuntimeError('Robotresultaat bevat niet het verwachte KVK-nummer.')
    return item


def import_completed(checkpoint):
    """Write a finished company's usable find to the database once; report the running totals."""
    state = json.loads(checkpoint.read_text())
    if 'imported' not in state:
        find = robot_find(result_for(state['run_dir'], str(state['kvk_nummer'])))
        state['imported'] = bool(find) and import_find(DB, find)
        save_result(checkpoint, state)
        if state['imported']:
            publish_live(ROOT)
    done = list(QUEUE.glob('*/completed.json'))
    found = sum(1 for path in done if json.loads(path.read_text()).get('imported'))
    report('robot', f'{len(done)} onderzocht · {found} gevonden en in de database', str(state['kvk_nummer']))


def main():
    QUEUE.mkdir(parents=True, exist_ok=True)
    with (QUEUE / 'runner.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 1
        initialized = False
        while True:
            try:
                if not initialized:
                    report('robot', 'Robot v5 gereed; wacht op handmatige start.', halt=True)
                    initialized = True
                if not enabled():
                    time.sleep(5)
                    continue
                # Results finished before finds were imported are written first.
                for checkpoint in QUEUE.glob('*/completed.json'):
                    if 'imported' not in json.loads(checkpoint.read_text()):
                        import_completed(checkpoint)
                identity = next_identity()
                if identity is None:
                    report('robot', 'Actuele planning onderzocht; wacht op verwerking van de resultaten.', halt=True)
                    continue
                research(identity)
            except Exception as error:
                print(str(error), flush=True)
                try:
                    report('robot', str(error)[:180], halt=True)
                except Exception:
                    pass
                time.sleep(10)


if __name__ == '__main__':
    raise SystemExit(main())
