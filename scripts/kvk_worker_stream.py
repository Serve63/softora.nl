"""Research and validate each finished company without waiting for its batch peers."""
import time
import kvk_worker_failures as failures
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED


def run(role, runner, apply_lock):
    research = ThreadPoolExecutor(max_workers=10)
    writer = ThreadPoolExecutor(max_workers=1)
    active, writing, window, flags = {}, None, [], []
    refreshed, polled, reported, count = 0.0, 0.0, 0.0, 1
    finished, paths = set(), {}

    def completed(future, path):
        try:
            return future.result()
        except failures.CompanyFailure as error:
            state = failures.record(path, error)
            action = "apart gezet voor herstel" if state["needs_review"] else "wordt automatisch opnieuw geprobeerd"
            print(f"KVK {role} {path.stem}: {error}; {action}.", flush=True)
            return False
    try:
        with runner.Heartbeat(role, 'doorlopend'):
            while True:
                if time.monotonic() - polled >= 5 or not window:
                    state = runner.poll_state()['state']['workers'][role]
                    if not state.get('enabled'):
                        return
                    count = max(1, min(10, int(state.get('count') or 1)))
                    polled = time.monotonic()
                if time.monotonic() - refreshed >= 30 or len(window) <= count:
                    packet = runner.next_packet(role, 30)
                    window, flags = (packet[0]['bedrijven'], packet[1]) if packet else ([], [])
                    brief = runner.api_brief(packet[0]) if packet else {}
                    refreshed = time.monotonic()
                    finished.intersection_update(str(c['kvk_nummer']) for c in window)
                for kvk, future in list(active.items()):
                    if future.done():
                        del active[kvk]
                        completed(future, paths.pop(kvk))
                if writing and writing[1].done():
                    kvk, future, path = writing
                    writing = None
                    if completed(future, path):
                        failures.clear(path)
                        finished.add(kvk)
                        window = [c for c in window if str(c['kvk_nummer']) != kvk]
                for company in window:
                    kvk = str(company['kvk_nummer'])
                    if kvk in finished or kvk in active or (writing and writing[0] == kvk):
                        continue
                    path = runner.pending_path(role, kvk, flags)
                    if not failures.ready(path) or path.exists() or (role == 'searcher' and runner.robot_busy(kvk)):
                        continue
                    if len(active) >= count:
                        break
                    paths[kvk] = path
                    active[kvk] = research.submit(runner.research_one, role, company, brief, flags, False)
                if writing is None:
                    for company in window:
                        kvk = str(company['kvk_nummer'])
                        if kvk in active or kvk in finished:
                            continue
                        path = runner.pending_path(role, kvk, flags)
                        if not failures.ready(path) or not path.exists():
                            continue
                        def apply(company=company, flags=list(flags), brief=brief):
                            if role == 'searcher':
                                return runner.apply_searcher_head({'bedrijven': [company]}, flags, apply_lock)
                            if not runner.research_one(role, company, brief, flags, True):
                                return False
                            return runner.apply_result(runner.pending_path(role, company['kvk_nummer'], flags), flags, apply_lock, role)
                        writing = (kvk, writer.submit(apply), path)
                        break
                if time.monotonic() - reported >= 5:
                    waiting = sum(not failures.ready(runner.pending_path(role, c['kvk_nummer'], flags)) for c in window)
                    runner.report(role, f'{len(active)} van {count} onderzoeken; {waiting} bedrijven wachten op herstel; andere onderzoeken gaan door.')
                    reported = time.monotonic()
                futures = list(active.values()) + ([writing[1]] if writing else [])
                if futures:
                    wait(futures, timeout=1, return_when=FIRST_COMPLETED)
                else:
                    time.sleep(1)
    finally:
        research.shutdown(wait=True)
        writer.shutdown(wait=True)
