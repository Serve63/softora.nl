"""Repair dashboard counters and bound directory sync, with rollback.

The committed initial lane is the source of completed research. Model labels
are attribution, not eligibility: changing a model must not hide real work.
This only changes read queries; no worker, evidence or company data is changed.
"""
import argparse
import ast
from pathlib import Path
from install_kvk_api_validation import install


LEGACY_FILTER = "          AND model_role IN ('searcher_luna_max', 'searcher_luna_low', 'searcher_sol_xhigh', 'searcher_api_sol_max', 'searcher_robot')\n"
MARKER = '    # Hourly activity follows committed initial results, independent of model labels.\n'
DIRECTORY_START = '    cursor = max(0, int(after_id or 0))\n'
DIRECTORY_BOUND = '''    # Freeze the upper cursor: ongoing research belongs to the next sync.
    upper = connection.execute("""
        SELECT COALESCE(c.updated_at, '') AS timestamp, c.id AS company_id
        FROM company_primary AS p JOIN companies AS c ON c.id = p.company_id
        WHERE c.actief = 1
        ORDER BY COALESCE(c.updated_at, '') DESC, c.id DESC LIMIT 1
    """).fetchone()
    if upper is None:
        return
    upper_timestamp, upper_id = upper['timestamp'], upper['company_id']
'''
DIRECTORY_ORDER = "            ORDER BY COALESCE(c.updated_at, ''), c.id\n"
DIRECTORY_LIMIT = "              AND (COALESCE(c.updated_at, ''), c.id) <= (?, ?)\n"
DIRECTORY_PARAMS = '            [timestamp, timestamp, cursor, batch_size],\n'


def function_section(source, name):
    functions = [node for node in ast.parse(source).body
                 if isinstance(node, ast.FunctionDef) and node.name == name]
    if len(functions) != 1:
        raise ValueError('Canonieke functie gewijzigd; inspecteer voor installatie')
    node = functions[0]
    lines = source.splitlines(keepends=True)
    return node, lines, ''.join(lines[node.lineno - 1:node.end_lineno])


def replace_section(node, lines, section):
    result = ''.join(lines[:node.lineno - 1]) + section + ''.join(lines[node.end_lineno:])
    compile(result, '<dashboard-runtime>', 'exec')
    return result


def patched_source(source):
    node, lines, section = function_section(source, 'recent_dashboard_counts')
    if MARKER in section and LEGACY_FILTER not in section:
        return source
    if (MARKER in section or section.count(LEGACY_FILTER) != 2
            or section.count("AND lane = 'initial'") != 2
            or section.count('FROM contact_research_lane_events') != 2):
        raise ValueError('Canonieke uurtelling gewijzigd; geen installatie uitgevoerd')
    section = section.replace(LEGACY_FILTER, '')
    first_line, rest = section.split('\n', 1)
    section = first_line + '\n' + MARKER + rest
    return replace_section(node, lines, section)


def patched_directory_source(source):
    node, lines, section = function_section(source, 'incremental_batches')
    edits = (
        (DIRECTORY_START, DIRECTORY_START + DIRECTORY_BOUND),
        (DIRECTORY_ORDER, DIRECTORY_LIMIT + DIRECTORY_ORDER),
        (DIRECTORY_PARAMS, '            [timestamp, timestamp, cursor, upper_timestamp, upper_id, batch_size],\n'),
        ('        cursor = int(rows[-1]["source_company_id"])\n',
         '        cursor = int(rows[-1]["source_company_id"])\n'
         '        if len(rows) < batch_size:\n'
         '            return\n'),
    )
    if all(new in section for old, new in edits):
        return source
    if any(new in section for old, new in edits):
        raise ValueError('Onvolledige sync-installatie; inspecteer eerst')
    for old, new in edits:
        if section.count(old) != 1:
            raise ValueError('Canonieke sync gewijzigd; geen installatie uitgevoerd')
        section = section.replace(old, new, 1)
    return replace_section(node, lines, section)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    plans = []
    for name, patch in (('serve_dashboard.py', patched_source),
                        ('sync_company_directory_online.py', patched_directory_source)):
        target = args.root / 'scripts' / name
        before = target.read_text()
        plans.append((target, before, patch(before)))
    for target, before, after in plans:
        install(target, before, after, args.root)


if __name__ == '__main__':
    main()
