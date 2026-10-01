"""Repair hourly dashboard counters in the canonical runtime, with rollback.

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


def patched_source(source):
    functions = [node for node in ast.parse(source).body
                 if isinstance(node, ast.FunctionDef) and node.name == 'recent_dashboard_counts']
    if len(functions) != 1:
        raise ValueError('Canonieke uurtelling gewijzigd; inspecteer voor installatie')
    node = functions[0]
    lines = source.splitlines(keepends=True)
    section = ''.join(lines[node.lineno - 1:node.end_lineno])
    if MARKER in section and LEGACY_FILTER not in section:
        return source
    if (MARKER in section or section.count(LEGACY_FILTER) != 2
            or section.count("AND lane = 'initial'") != 2
            or section.count('FROM contact_research_lane_events') != 2):
        raise ValueError('Canonieke uurtelling gewijzigd; geen installatie uitgevoerd')
    section = section.replace(LEGACY_FILTER, '')
    first_line, rest = section.split('\n', 1)
    section = first_line + '\n' + MARKER + rest
    result = ''.join(lines[:node.lineno - 1]) + section + ''.join(lines[node.end_lineno:])
    compile(result, 'serve_dashboard.py', 'exec')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    target = args.root / 'scripts/serve_dashboard.py'
    before = target.read_text()
    install(target, before, patched_source(before), args.root)


if __name__ == '__main__':
    main()
