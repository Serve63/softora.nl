#!/usr/bin/env python3
"""Dashboard-controlled Robot v5 that runs its own round ahead of the Searchers.

Follows the current planning's open companies in order and researches the next
few of them at the same time. Completed evidence is reused on restart; an
interrupted company is retried before taking another. A usable find (phone and
e-mail) goes straight into the database so the Searchers skip it; anything the
Robot did not find is left for the Searchers. No model or paid API is called here.
"""
from __future__ import annotations
import fcntl
import json
import os
import re
import signal
import sqlite3
import subprocess
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from kvk_api_workers import PENDING, ROOT, call, report, run_cli, save_result, transient_control_failure
from kvk_robot_import import import_find, publish_live, robot_find

QUEUE = ROOT / 'data' / 'shadow' / 'robot-v5-dashboard'
DB = ROOT / 'data' / 'nederland_bedrijven.sqlite'
# Robot v7 engine: the v5 evidence gate plus measured recall fixes (search
# retries, reordered-name and free-mail own-site bridges, http sites, stricter
# umbrella/portal/cessation checks). The v5 engine stays available for rollback.
ENGINE_V5 = ROOT / 'experiments' / 'robot-v5-deterministic-20260919' / 'run_shadow.py'
ENGINE_V7 = ROOT / 'experiments' / 'robot-v7-limit-20260930' / 'run_shadow.py'
# SOFTORA_ROBOT_ENGINE only names one of the two installed engines, never a path.
ENGINES = {'v5': ENGINE_V5, 'v7': ENGINE_V7}
ENGINE = ENGINES.get(str(os.environ.get('SOFTORA_ROBOT_ENGINE') or 'v7').strip().lower(), ENGINE_V7)
if not ENGINE.exists():
    ENGINE = ENGINE_V5
PYTHON = ROOT / '.venv-robot-zero' / 'bin' / 'python'
FIELDS = ('id', 'kvk_nummer', 'bedrijfsnaam', 'plaats', 'straatnaam', 'huisnummer', 'postcode', 'vestigingsnummer')
# Each company is its own engine process; a handful run side by side.
WORKERS = max(1, min(8, int(os.environ.get('SOFTORA_ROBOT_WORKERS') or 4)))
# The planning is read once per window instead of once per company; a window
# older than this is read afresh so a changed planning location is followed.
PLANNING_REFRESH_SECONDS = 60
POLL_SECONDS = 5
IMPORT_LOCK = threading.Lock()


def enabled():
    state = call('/poll', {}).get('state', {})
    return bool(state.get('workers', {}).get('robot', {}).get('enabled'))


SEARCHER_WORK = re.compile(r'^contact_agent_results_api_searcher_initial_(\d{8})\.(?:busy|luna\.json|json|recovery\.json)$')


def searcher_claims():
    """Companies a Searcher is researching or has an answer waiting for; the Robot leaves those alone."""
    if not PENDING.is_dir():
        return set()
    return {match.group(1) for match in (SEARCHER_WORK.match(path.name) for path in PENDING.iterdir()) if match}


def completed_kvks():
    return {p.parent.name for p in QUEUE.glob('*/completed.json')}


def identity_for(kvk):
    """The company's identity, or None when it is no longer open for initial research."""
    with sqlite3.connect(f'file:{DB}?mode=ro', uri=True, timeout=30) as db:
        db.row_factory = sqlite3.Row
        row = db.execute('SELECT c.* FROM company_primary p JOIN companies c ON c.id=p.company_id WHERE p.kvk_nummer=?',
                         (kvk,)).fetchone()
    if not row:
        raise RuntimeError('Bedrijf uit de actuele planning is niet meer beschikbaar.')
    if str(row['lead_status'] or '') != 'unresearched':
        return None
    return {key: row[key] for key in FIELDS}


class Planning:
    """The open planning head in order, read once per window rather than per company."""

    def __init__(self, read=None, clock=time.monotonic):
        self.read = read or self.read_planning
        self.clock = clock
        self.window = []
        self.read_at = None

    @staticmethod
    def read_planning(limit):
        packet = json.loads(run_cli('contact_research.py', 'planning-next', '--fast-head',
                                    '--limit', str(limit), '--json'))
        return [str(company['kvk_nummer']) for company in packet.get('bedrijven', [])]

    def take(self, count, busy):
        """Up to `count` open companies from the head, skipping finished, claimed and running ones."""
        skip = completed_kvks() | searcher_claims() | set(busy)
        stale = self.read_at is None or self.clock() - self.read_at > PLANNING_REFRESH_SECONDS
        if stale or sum(kvk not in skip for kvk in self.window) < count:
            # Read current planning afresh; never resume an obsolete location or fixed list.
            self.window = self.read(len(skip) + count + WORKERS * 2)
            self.read_at = self.clock()
        picked = []
        for kvk in self.window:
            if len(picked) >= count:
                break
            if kvk in skip:
                continue
            skip.add(kvk)
            identity = identity_for(kvk)
            if identity is not None:
                picked.append(identity)
        return picked


def terminate(process):
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def research(identity, stop):
    """Run the engine for one company; False when the dashboard stopped it first."""
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
    if stop.is_set():
        return False
    with (folder / 'runner.log').open('a') as log:
        child = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
        try:
            while child.poll() is None:
                if stop.wait(1):
                    terminate(child)
                    return False
            if child.returncode:
                raise RuntimeError(f'Robot v5 stopte bij {kvk}; voortgang en foutlog bewaard.')
        finally:
            terminate(child)
    result_for(attempt, kvk)  # refuses a run that does not describe this company
    totals()  # counts existing checkpoints before this one is added
    save_result(checkpoint, {'kvk_nummer': kvk, 'run_dir': str(attempt), 'completed_at': time.time()})
    with IMPORT_LOCK:
        TOTALS['done'] += 1
    import_completed(checkpoint)
    return True


def result_for(run_dir, kvk):
    results = json.loads((Path(run_dir) / 'terminal-results.json').read_text()).get('results', [])
    item = next((item for item in results if str(item.get('kvk_nummer') or item.get('kvk')) == kvk), None)
    if item is None:
        raise RuntimeError('Robotresultaat bevat niet het verwachte KVK-nummer.')
    return item


class LivePublisher:
    """Hands finds to the live dashboard in the background; bursts collapse into one publish."""

    def __init__(self, publish=None):
        self.publish = publish or (lambda: publish_live(ROOT))
        self.lock = threading.Lock()
        self.running = False
        self.again = False

    def request(self):
        with self.lock:
            if self.running:
                self.again = True
                return
            self.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while True:
            try:
                self.publish()
            except Exception as error:
                print(f'Robot live-publicatie mislukt: {error}', flush=True)
            with self.lock:
                if not self.again:
                    self.running = False
                    return
                self.again = False


PUBLISHER = LivePublisher()


TOTALS = {}  # running counts, read from disk once


def totals():
    with IMPORT_LOCK:
        if not TOTALS:
            done = list(QUEUE.glob('*/completed.json'))
            found = 0
            for path in done:
                try:
                    found += bool(json.loads(path.read_text()).get('imported'))
                except (ValueError, OSError):
                    pass
            TOTALS.update(done=len(done), found=found)
        return TOTALS['done'], TOTALS['found']


def import_completed(checkpoint):
    """Write a finished company's usable find to the database once."""
    totals()
    with IMPORT_LOCK:
        state = json.loads(checkpoint.read_text())
        if 'imported' in state:
            return
        find = robot_find(result_for(state['run_dir'], str(state['kvk_nummer'])))
        state['imported'] = bool(find) and import_find(DB, find)
        save_result(checkpoint, state)
        TOTALS['found'] += bool(state['imported'])
    if state['imported']:
        PUBLISHER.request()


def status(running):
    done, found = totals()
    names = ', '.join(identity['bedrijfsnaam'][:40] for identity in running.values())
    return f'{done} onderzocht · {found} gevonden en in de database · {len(running)} tegelijk: {names}'[:1200]


def main():
    QUEUE.mkdir(parents=True, exist_ok=True)
    with (QUEUE / 'runner.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 1
        stop = threading.Event()
        running = {}  # kvk -> (future, identity)
        planning = Planning()
        initialized = False
        with ThreadPoolExecutor(WORKERS) as pool:
            while True:
                try:
                    if not initialized:
                        report('robot', 'Robot v5 gereed; wacht op handmatige start.', halt=True)
                        initialized = True
                    if not enabled():
                        stop.set()
                        wait([future for future, _ in running.values()])
                        time.sleep(POLL_SECONDS)
                        continue
                    stop.clear()
                    failure = None
                    for kvk, (future, _identity) in list(running.items()):
                        if future.done():
                            del running[kvk]
                            if future.exception() is not None:
                                failure = failure or future.exception()
                    if failure is not None:
                        raise failure
                    if not running:
                        # Results finished before finds were imported are written first.
                        for checkpoint in QUEUE.glob('*/completed.json'):
                            if 'imported' not in json.loads(checkpoint.read_text()):
                                import_completed(checkpoint)
                    free = WORKERS - len(running)
                    if free:
                        for identity in planning.take(free, running):
                            kvk = str(identity['kvk_nummer'])
                            running[kvk] = (pool.submit(research, identity, stop), identity)
                    if not running:
                        report('robot', 'Actuele planning onderzocht; wacht op verwerking van de resultaten.', halt=True)
                        time.sleep(POLL_SECONDS)
                        continue
                    try:
                        report('robot', status({kvk: identity for kvk, (_f, identity) in running.items()}),
                               next(iter(running)))
                    except Exception as error:
                        if not transient_control_failure(error):
                            raise
                        # Running companies continue through a short dashboard hiccup.
                    wait([future for future, _ in running.values()], timeout=POLL_SECONDS, return_when=FIRST_COMPLETED)
                except Exception as error:
                    print(str(error), flush=True)
                    if transient_control_failure(error):
                        # A short dashboard hiccup must not switch the Robot off; running companies continue.
                        time.sleep(15)
                        continue
                    stop.set()
                    wait([future for future, _ in running.values()])
                    running.clear()
                    try:
                        report('robot', str(error)[:180], halt=True)
                    except Exception:
                        pass
                    time.sleep(10)


if __name__ == '__main__':
    raise SystemExit(main())
