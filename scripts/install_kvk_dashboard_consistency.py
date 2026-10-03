"""Install read-only dashboard consistency hooks, with exact anchors and rollback."""
import argparse
from pathlib import Path
from install_kvk_activity_counts import function_section, replace_section
from install_kvk_api_validation import install


def dashboard_source(source):
    node, lines, section = function_section(source, 'db_connection')
    fixed = '''def db_connection() -> sqlite3.Connection:
    from kvk_dashboard_consistency import connection_for
    return connection_for(DB_PATH)'''
    if section.rstrip('\n') != fixed:
        if section.rstrip('\n') != '''def db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection''':
            raise ValueError('Dashboard connection changed; inspect before installation')
        source = replace_section(node, lines, fixed + '\n')
    node, lines, section = function_section(source, 'recent_dashboard_counts')
    fixed = '''def recent_dashboard_counts(connection: sqlite3.Connection) -> dict[str, int]:
    from kvk_dashboard_consistency import hourly_activity
    return hourly_activity(connection)[0]'''
    if section.rstrip('\n') != fixed:
        if ('# Hourly activity follows committed initial results, independent of model labels.' not in section
                or 'review_classification.control_room_activity(connection, cutoff)' not in section):
            raise ValueError('Dashboard hourly query changed; inspect before installation')
        source = replace_section(node, lines, fixed + '\n')
    return source


def publisher_source(source, full=False):
    names = ('build_snapshot',) if full else ('fast_snapshot', 'fast_progress_snapshot')
    for name in names:
        node, lines, section = function_section(source, name)
        marker = '@finalize_snapshot\n'
        if node.decorator_list:
            if len(node.decorator_list) != 1 or lines[node.lineno - 2] != marker:
                raise ValueError('Publisher decorator changed; inspect before installation')
            continue
        if ('dashboard.latest_treated_query(10)' not in section
                or "last_60_minutes" not in section and not full):
            raise ValueError('Publisher changed; inspect before installation')
        source = ''.join(lines[:node.lineno - 1]) + marker + ''.join(lines[node.lineno - 1:])
    anchor = 'import serve_dashboard as dashboard\n'
    imported = 'from kvk_dashboard_consistency import finalize_snapshot\n'
    if imported not in source:
        if source.count(anchor) != 1:
            raise ValueError('Publisher import changed')
        source = source.replace(anchor, anchor + imported, 1)
    if full:
        old = '    "last_60_minutes",\n'
        new = old + '    "last_60_minute_events",\n    "metrics_measured_at",\n'
        if new not in source:
            if source.count(old) != 1:
                raise ValueError('Progress field allowlist changed')
            source = source.replace(old, new, 1)
    else:
        old = '                    if current != last or (rolling and minute != last_minute):\n'
        new = '                    if current != last or minute != last_minute:\n'
        if new not in source:
            if source.count(old) != 1:
                raise ValueError('Publisher heartbeat changed')
            source = source.replace(old, new, 1)
    compile(source, '<kvk-publisher>', 'exec')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    module = Path(__file__).with_name('kvk_dashboard_consistency.py')
    plans = []
    for name, patch in (('serve_dashboard.py', dashboard_source),
                        ('sync_live_dashboard.py', lambda text: publisher_source(text, True)),
                        ('live_progress_sync.py', publisher_source)):
        target = args.root / 'scripts' / name
        before = target.read_text()
        plans.append((target, before, patch(before)))
    target = args.root / 'scripts' / module.name
    if not target.exists():
        target.touch(mode=0o600)
    install(target, target.read_text() if target.exists() else '', module.read_text(), args.root)
    for target, before, after in plans:
        install(target, before, after, args.root)


if __name__ == '__main__':
    main()
