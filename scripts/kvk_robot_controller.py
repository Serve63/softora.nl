#!/usr/bin/env python3
"""Robot Controleur: re-checks unusable verdicts of review grade 1 with the Robot engine plus Sol 6.1.

It takes companies from the same review queue the Controleurs use (review-next, grade 1), in that
order. Each company is researched again in control mode: the model gets the earlier verdict and
searches the whole Searcher route (directories, trade names by address, social profiles), and the
Robot verifies every answer literally, as for the Searcher Robot. A usable result passes the same
contact gate as the Searcher Robot and is written as recovered by control; otherwise the company stays
in the review queue (recover-only) or, with SOFTORA_ROBOT_CONTROL_FINALIZE=1, becomes final (grade 2). It runs instead of the Codex Controleurs when
SOFTORA_CONTROLLER_ENGINE=robot and follows the dashboard's Controleurs switch.
"""
from __future__ import annotations

import fcntl
import json
import os
import sqlite3
import subprocess
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from kvk_api_workers import ROOT, call, report, run_cli, save_result, transient_control_failure
import kvk_robot_v5 as searcher
from kvk_robot_import import contact_problem, import_control_confirmation, import_control_recovery, robot_find

QUEUE = ROOT / 'data' / 'shadow' / 'robot-controller'
DB = ROOT / 'data' / 'nederland_bedrijven.sqlite'
MAX_WORKERS = 32
WORKERS = max(1, min(MAX_WORKERS, int(os.environ.get('SOFTORA_ROBOT_CONTROL_WORKERS') or 8)))
# Recover-only (Servé, 2026-10-04): a usable result is written as recovered, but when nothing is found the
# company stays in the review queue (grade 1) instead of becoming final, so no lead is ever lost.
# SOFTORA_ROBOT_CONTROL_FINALIZE=1 also writes the final grade 2.
FINALIZE = os.environ.get('SOFTORA_ROBOT_CONTROL_FINALIZE', '0') == '1'
POLL_SECONDS = 5
IDLE_SECONDS = 60
REFRESH_SECONDS = 60


def enabled():
    state = call('/poll', {}).get('state', {})
    return bool(state.get('workers', {}).get('controller', {}).get('enabled'))


def review_head(limit):
    """Grade-1 unusable companies in the Controleurs' review order."""
    packet = json.loads(run_cli('contact_research.py', 'review-next', '--review-unusable', '--review-grade', '1',
                                '--limit', str(limit), '--json'))
    return [str(company['kvk_nummer']) for company in packet.get('bedrijven', [])]


def identity_for(kvk):
    with sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True, timeout=30) as db:
        db.row_factory = sqlite3.Row
        row = db.execute('SELECT c.* FROM company_primary p JOIN companies c ON c.id=p.company_id WHERE p.kvk_nummer=?',
                         (kvk,)).fetchone()
    if not row or row['lead_status'] != 'unusable' or int(row['unusable_review_grade'] or 1) != 1:
        return None
    identity = {key: row[key] for key in searcher.FIELDS}
    identity['earlier_reason'] = row['unusable_reason'] or ''
    return identity


def control_outcome(result):
    """('recovered', find) for a usable result that passes the contact gate, else ('confirmed', note)."""
    find = robot_find(result)
    if find:
        return 'recovered', find
    assist = result.get('ai_assist') or {}
    problem = contact_problem(result) if result.get('lead_status') == 'usable' else ''
    note = problem or f"opnieuw gezocht ({assist.get('reason') or result.get('decision') or 'geen contact'})"
    return 'confirmed', note


def research(identity, stop):
    """Re-check one company; False when the dashboard stopped it first."""
    kvk = str(identity['kvk_nummer'])
    folder = QUEUE / kvk
    folder.mkdir(parents=True, exist_ok=True)
    checkpoint = folder / 'completed.json'
    if checkpoint.exists():
        return True
    source = folder / 'input.json'
    save_result(source, [{key: identity[key] for key in searcher.FIELDS}])
    attempt = folder / f'run-{time.time_ns()}'
    command = [str(searcher.PYTHON), str(searcher.ENGINE), '--inputs', str(source), '--run-dir', str(attempt),
               '--workers', '1', '--concurrency', '4']
    # The Searcher Robot's discovery for the same company is reused; the control step searches anew with AI.
    for discovery in sorted([*folder.glob('run-*/discovery.json'), *(searcher.QUEUE / kvk).glob('run-*/discovery.json')],
                            reverse=True):
        try:
            json.loads(discovery.read_text())
        except (ValueError, OSError):
            continue
        command += ['--discovery-json', str(discovery)]
        break
    if stop.is_set():
        return False
    environment = dict(os.environ, ROBOT_AI_JUDGE='0', ROBOT_AI_ASSIST='1', ROBOT_AI_MODE='control')
    with (folder / 'runner.log').open('a') as log:
        child = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log, start_new_session=True, env=environment)
        deadline = time.monotonic() + searcher.COMPANY_TIMEOUT_SECONDS
        try:
            while child.poll() is None:
                if stop.wait(1):
                    searcher.terminate(child)
                    return False
                if time.monotonic() >= deadline:
                    raise searcher.CompanyResearchError(f'Tijdlimiet bereikt bij {kvk}; bewijs en foutlog bewaard.')
            if child.returncode:
                raise searcher.CompanyResearchError(f'Controleproces faalde bij {kvk}; voortgang en foutlog bewaard.')
        finally:
            searcher.terminate(child)
    outcome, detail = control_outcome(searcher.result_for(attempt, kvk))
    if outcome == 'recovered':
        written = import_control_recovery(DB, detail)
    else:
        written = import_control_confirmation(DB, kvk, detail) if FINALIZE else False
    save_result(checkpoint, {'kvk_nummer': kvk, 'run_dir': str(attempt), 'outcome': outcome,
                             'written': bool(written), 'completed_at': time.time()})
    if written:
        searcher.PUBLISHER.request()
    return True


def main():
    QUEUE.mkdir(parents=True, exist_ok=True)
    with (QUEUE / 'runner.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 1
        stop = threading.Event()
        running, window, read_at, failures = {}, [], 0.0, {}
        report('controller', 'Robot Controleur gereed; wacht op handmatige start.', halt=True)
        with ThreadPoolExecutor(WORKERS) as pool:
            while True:
                try:
                    if not enabled():
                        stop.set()
                        wait([future for future, _ in running.values()])
                        time.sleep(POLL_SECONDS)
                        continue
                    stop.clear()
                    for kvk, (future, _identity) in list(running.items()):
                        if future.done():
                            del running[kvk]
                            try:
                                future.result()
                            except searcher.CompanyResearchError as error:
                                failures[kvk] = time.time() + 600  # retried after ten minutes
                                print(f'Robot Controleur herprobeert {kvk}: {error}', flush=True)
                    free = WORKERS - len(running)
                    if free and (not window or time.monotonic() - read_at > REFRESH_SECONDS):
                        # Checked companies stay in the queue in recover-only mode, so read past them.
                        checked = sum(1 for _ in QUEUE.glob('*/completed.json'))
                        window, read_at = review_head(checked + WORKERS * 3), time.monotonic()
                    now = time.time()
                    for kvk in list(window):
                        if free <= 0:
                            break
                        if kvk in running or failures.get(kvk, 0) > now or (QUEUE / kvk / 'completed.json').exists():
                            continue
                        identity = identity_for(kvk)
                        window.remove(kvk)
                        if identity is None:
                            continue
                        running[kvk] = (pool.submit(research, identity, stop), identity)
                        free -= 1
                    if not running:
                        report('controller', 'Robot Controleur: controlewachtrij leeg; wacht op nieuw werk.')
                        window = []
                        time.sleep(IDLE_SECONDS)
                        continue
                    names = ', '.join(identity['bedrijfsnaam'][:40] for identity in running.values())
                    report('controller', f'Robot Controleur · {len(running)} tegelijk: {names}'[:1200], next(iter(running)))
                    wait([future for future, _ in running.values()], timeout=POLL_SECONDS, return_when=FIRST_COMPLETED)
                except Exception as error:
                    print(str(error), flush=True)
                    if transient_control_failure(error):
                        time.sleep(15)
                        continue
                    stop.set()
                    wait([future for future, _ in running.values()])
                    running.clear()
                    try:
                        report('controller', str(error)[:180], halt=True)
                    except Exception:
                        pass
                    time.sleep(10)


if __name__ == '__main__':
    raise SystemExit(main())
