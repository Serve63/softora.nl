"""Install recovery-aware worker selection in the canonical runtime, with rollback."""
import argparse
from pathlib import Path
from install_kvk_api_validation import install

LOCATION = 'def active_planning_location() -> tuple[dict[str, Any], dict[str, Any]]:\n'
INITIAL = '''def fetch_next(
    connection: sqlite3.Connection,
    limit: int,
    filters: list[str] | None = None,
    params: list[str] | None = None,
    skip_deferred: bool = False,
) -> list[sqlite3.Row]:
'''
REVIEW = '''def fetch_unusable_review(
    connection: sqlite3.Connection,
    limit: int,
    filters: list[str] | None = None,
    params: list[Any] | None = None,
) -> list[sqlite3.Row]:
'''
EDITS = (
    (LOCATION, LOCATION + '    from kvk_worker_queue import planning_location\n'
     '    executable = planning_location(globals())\n'
     '    if executable is not None:\n'
     '        return executable\n'),
    (INITIAL, INITIAL + '    from kvk_worker_queue import filters_for\n'
     '    filters, params = filters_for("searcher", filters, params)\n'),
    (REVIEW, REVIEW + '    from kvk_worker_queue import filters_for\n'
     '    filters, params = filters_for("controller", filters, params)\n'),
)


def patched_source(source):
    for old, new in EDITS:
        if new in source:
            continue
        if source.count(old) != 1:
            raise ValueError('Canonieke wachtrij gewijzigd; installatie gestopt zonder wijzigingen')
        source = source.replace(old, new, 1)
    compile(source, 'contact_research.py', 'exec')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    for name in ('kvk_worker_queue.py', 'kvk_worker_failures.py'):
        if (args.root / 'scripts' / name).read_bytes() != Path(__file__).with_name(name).read_bytes():
            raise ValueError('Installeer eerst de bijbehorende wachtrijmodules')
    target = args.root / 'scripts/contact_research.py'
    before = target.read_text()
    install(target, before, patched_source(before), args.root)


if __name__ == '__main__':
    main()
