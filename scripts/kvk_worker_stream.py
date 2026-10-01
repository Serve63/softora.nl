"""Research and validate each finished company without waiting for its batch peers."""
import time
import kvk_worker_failures as failures
from kvk_worker_queue import isolated
from kvk_codex_recovery import TemporaryResearchFailure, ResearchBackoff
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED


def run(role, runner, apply_lock):
    research = ThreadPoolExecutor(max_workers=10)
    writer = ThreadPoolExecutor(max_workers=1)
    active, writing, window, flags = {}, None, [], []
    refreshed, polled, reported, count = 0.0, 0.0, 0.0, 1
    finished, paths = set(), {}
    prepared = set()
    recovery = ResearchBackoff(lambda: time.monotonic())
    saved = 0
    scope = ''

    def message():
        waiting = len(isolated(role, runner.PENDING))
        parts = [f'{len(active)} van {count} onderzoeken']
        if writing:
            parts.append('1 resultaat wordt gecontroleerd en opgeslagen')
        if scope and (active or writing):
            parts.append(scope)
        if waiting:
            parts.append(f'{waiting} ' + ('bedrijf apart gezet' if waiting == 1 else 'bedrijven apart gezet') + ' voor herstel')
        if recovery.remaining():
            parts.append(f'{recovery.reason}; automatisch opnieuw over {recovery.remaining()} s')
        if saved:
            parts.append(f'{saved} opgeslagen sinds start')
        if not window and not active and not writing:
            parts.append('geen uitvoerbaar onderzoek' if waiting else 'wacht op nieuw werk')
        return '; '.join(parts) + '.'

    def completed(future, path, researched=False):
        nonlocal refreshed
        try:
            result = future.result()
            if result and researched:
                recovery.succeeded(path)
            return result
        except TemporaryResearchFailure as error:
            recovery.defer(path, error)
            print(f'KVK {role} {path.stem}: {error}; nieuwe modelaanvragen wachten {recovery.remaining()}s; opgeslagen antwoorden worden verder verwerkt.', flush=True)
            return False
        except failures.CompanyFailure as error:
            state = failures.record(path, error)
            refreshed = 0.0
            action = "apart gezet voor herstel" if state["needs_review"] else "wordt automatisch opnieuw geprobeerd"
            print(f"KVK {role} {path.stem}: {error}; {action}.", flush=True)
            return False
    try:
        with runner.Heartbeat(role, 'doorlopend', message=message):
            while True:
                if not polled or time.monotonic() - polled >= 5:
                    state = runner.poll_state()['state']['workers'][role]
                    if not state.get('enabled'):
                        return
                    count = max(1, min(10, int(state.get('count') or 1)))
                    polled = time.monotonic()
                if not refreshed or time.monotonic() - refreshed >= 30:
                    packet = runner.next_packet(role, 30)
                    window, flags = (packet[0]['bedrijven'], packet[1]) if packet else ([], [])
                    brief = runner.api_brief(packet[0]) if packet else {}
                    scope = str(packet[0].get('planning_scope') or '') if packet else ''
                    refreshed = time.monotonic()
                    finished.intersection_update(str(c['kvk_nummer']) for c in window)
                for kvk, future in list(active.items()):
                    if future.done():
                        del active[kvk]
                        if completed(future, paths.pop(kvk), researched=True):
                            prepared.add(kvk)
                if writing and writing[1].done():
                    kvk, future, path = writing
                    writing = None
                    if completed(future, path):
                        saved += 1
                        failures.clear(path)
                        prepared.discard(kvk)
                        finished.add(kvk)
                        window = [c for c in window if str(c['kvk_nummer']) != kvk]
                        if len(window) <= count:
                            refreshed = 0.0
                for company in window:
                    kvk = str(company['kvk_nummer'])
                    if kvk in finished or kvk in active or (writing and writing[0] == kvk):
                        continue
                    path = runner.pending_path(role, kvk, flags)
                    if not failures.ready(path) or not recovery.ready(path) or (role == 'searcher' and runner.robot_busy(kvk)):
                        continue
                    if (role == 'searcher' and path.exists()) or (role == 'controller' and kvk in prepared):
                        continue
                    if recovery.remaining() and not (role == 'searcher' and path.with_suffix('.luna.json').exists()):
                        continue
                    if len(active) >= count:
                        break
                    paths[kvk] = path
                    # Controller validation and any model repair use the parallel
                    # research slots, never the single database writer.
                    active[kvk] = research.submit(runner.research_one, role, company, brief, flags, role == 'controller')
                if writing is None:
                    for company in window:
                        kvk = str(company['kvk_nummer'])
                        if kvk in active or kvk in finished:
                            continue
                        path = runner.pending_path(role, kvk, flags)
                        if not failures.ready(path) or not recovery.ready(path) or not path.exists():
                            continue
                        if role == 'controller' and kvk not in prepared:
                            continue
                        def apply(company=company, flags=list(flags), brief=brief):
                            if role == 'searcher':
                                return runner.apply_searcher_head({'bedrijven': [company]}, flags, apply_lock)
                            return runner.apply_result(runner.pending_path(role, company['kvk_nummer'], flags), flags, apply_lock, role)
                        writing = (kvk, writer.submit(apply), path)
                        break
                if time.monotonic() - reported >= 5:
                    runner.report(role, message())
                    reported = time.monotonic()
                futures = list(active.values()) + ([writing[1]] if writing else [])
                if futures:
                    wait(futures, timeout=1, return_when=FIRST_COMPLETED)
                else:
                    time.sleep(1)
    finally:
        research.shutdown(wait=True)
        writer.shutdown(wait=True)
