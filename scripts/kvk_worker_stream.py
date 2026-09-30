"""Research and validate each finished company without waiting for its batch peers."""
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED


def run(role, runner, apply_lock):
    research = ThreadPoolExecutor(max_workers=10)
    writer = ThreadPoolExecutor(max_workers=1)
    active, writing, window, flags = {}, None, [], []
    refreshed, polled, reported, count = 0.0, 0.0, 0.0, 1
    finished = set()
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
                        future.result()  # Preserve errors and completed peer files.
                if writing and writing[1].done():
                    kvk, future = writing
                    writing = None
                    if future.result():
                        finished.add(kvk)
                        window = [c for c in window if str(c['kvk_nummer']) != kvk]
                for company in window:
                    kvk = str(company['kvk_nummer'])
                    if kvk in finished or kvk in active or (writing and writing[0] == kvk):
                        continue
                    path = runner.pending_path(role, kvk, flags)
                    if path.exists() or (role == 'searcher' and runner.robot_busy(kvk)):
                        continue
                    if len(active) >= count:
                        break
                    active[kvk] = research.submit(runner.research_one, role, company, brief, flags, False)
                if writing is None:
                    for company in window:
                        kvk = str(company['kvk_nummer'])
                        if kvk in active or kvk in finished:
                            continue
                        path = runner.pending_path(role, kvk, flags)
                        if not path.exists():
                            continue
                        def apply(company=company, flags=list(flags), brief=brief):
                            if role == 'searcher':
                                return runner.apply_searcher_head({'bedrijven': [company]}, flags, apply_lock)
                            if not runner.research_one(role, company, brief, flags, True):
                                return False
                            return runner.apply_result(runner.pending_path(role, company['kvk_nummer'], flags), flags, apply_lock, role)
                        writing = (kvk, writer.submit(apply))
                        break
                if time.monotonic() - reported >= 5:
                    runner.report(role, f'{len(active)} van {count} onderzoeken; afgeronde antwoorden direct verwerken.')
                    reported = time.monotonic()
                futures = list(active.values()) + ([writing[1]] if writing else [])
                if futures:
                    wait(futures, timeout=1, return_when=FIRST_COMPLETED)
                else:
                    time.sleep(1)
    finally:
        research.shutdown(wait=True)
        writer.shutdown(wait=True)
