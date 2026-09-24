"""Install the versioned API profile into the external canonical Database runtime.

No data writes and no workers are started. Exact anchors fail closed on drift;
the original validator is backed up before the atomic change. Native results
retain their existing profile. Both precheck and validate/apply use this hook.
"""
import argparse
import hashlib
import os
from pathlib import Path

from kvk_api_validation import PROFILE

EDITS = (
    ('    result["bedrijfsnaam"] = row["bedrijfsnaam"]\n',
     '    if raw.get("validation_profile") is not None:\n'
     '        result["validation_profile"] = raw["validation_profile"]\n'
     '    result["bedrijfsnaam"] = row["bedrijfsnaam"]\n'),
    ('def normalize_result(result: dict[str, Any]) -> dict[str, Any]:\n',
     'def normalize_result(result: dict[str, Any]) -> dict[str, Any]:\n'
     '    from kvk_api_validation import PROFILE, validate_api_evidence\n'
     '    profile = result.get("validation_profile")\n'
     '    if profile not in (None, PROFILE):\n'
     '        raise ValueError("Onbekend onderzoekscontract")\n'
     '    api_basic = profile == PROFILE\n'
     '    if api_basic:\n'
     '        validate_api_evidence(result)\n'),
    ('            and not is_fast_lane_no_contact and not terminal_exclusion):\n',
     '            and not is_fast_lane_no_contact and not terminal_exclusion and not api_basic):\n'),
    ('        "contact_research_note": conclusion_note,\n',
     '        "contact_research_note": conclusion_note,\n'
     '        **({"validation_profile": profile} if api_basic else {}),\n'),
    ('    execution = research_execution.producer(getattr(args, "producer_thread_id", ""), Path(args.file),\n'
     '                                            uses_unusable_review(args) or uses_approved_review(args))\n',
     '    from kvk_api_attribution import execution_for\n'
     '    is_review = uses_unusable_review(args) or uses_approved_review(args)\n'
     '    execution = execution_for(results, Path(args.file), is_review)\n'
     '    if execution is None:\n'
     '        execution = research_execution.producer(getattr(args, "producer_thread_id", ""), Path(args.file), is_review)\n'),
    ('                                    "research_execution": execution,\n',
     '                                    "research_execution": execution,\n'
     '                                    "validation_profile": result.get("validation_profile", "native"),\n'),
)


def patched_source(source):
    installed = [new in source for _, new in EDITS]
    if all(installed):
        return source
    if any(installed):
        raise ValueError('Onvolledige API-profielinstallatie; handmatige inspectie vereist')
    for old, new in EDITS:
        if source.count(old) != 1:
            raise ValueError('Canonieke validator gewijzigd; installatie gestopt zonder wijzigingen')
        source = source.replace(old, new, 1)
    source = source.replace("'searcher_sol_xhigh')", "'searcher_sol_xhigh', 'searcher_api_sol_max')")
    compile(source, 'contact_research.py', 'exec')
    return source


DASHBOARD_EDITS = (
    ('                COALESCE(rea.display_label, ra.researcher) AS researcher\n',
     '                COALESCE(rea.display_label, ra.researcher) AS researcher,\n'
     '                (SELECT e.model_role FROM contact_research_lane_events e\n'
     '                 WHERE e.kvk_nummer=a.kvk_nummer AND e.lane=a.activity_lane\n'
     '                   AND e.created_at=a.activity_at ORDER BY e.id DESC LIMIT 1) AS producer_role\n'),
    ('        is_controller_activity = activity_kind == "controller_review"\n',
     '        is_controller_activity = activity_kind == "controller_review"\n'
     '        from kvk_api_attribution import activity_labels\n'
     '        role_label, model_label = activity_labels(is_controller_activity, row["producer_role"], row["researcher"])\n'),
    ('                    "Controleur" if is_controller_activity else "Robot"\n',
     '                    role_label\n'),
    ('                    RESEARCHER_MODEL_LABELS.get(\n'
     '                        clean_text(row["researcher"]), clean_text(row["researcher"])\n'
     '                    )\n'
     '                    or "Luna 5.6 Max"\n',
     '                    RESEARCHER_MODEL_LABELS.get(model_label, model_label)\n'),
)


def patched_dashboard(source):
    installed = [new in source for _, new in DASHBOARD_EDITS]
    if all(installed):
        return source
    if any(installed):
        raise ValueError('Onvolledige dashboardinstallatie')
    for old, new in DASHBOARD_EDITS:
        if source.count(old) != 1:
            raise ValueError('Dashboardbron gewijzigd; installatie gestopt')
        source = source.replace(old, new, 1)
    source = source.replace("'searcher_sol_xhigh'", "'searcher_sol_xhigh', 'searcher_api_sol_max'")
    # Include API Controllers in activity and correction projections, too.
    import re
    source = re.sub(r"(\b(?:\w+\.)?(?:controller_)?model_role)\s*=\s*'controller_luna_max'",
                    r"\1 IN ('controller_luna_max', 'controller_api_sol_max')", source)
    compile(source, 'serve_dashboard.py', 'exec')
    return source


def install(target, before, after, root):
    if before == after:
        return
    backup = root / 'data/runtime_backups' / (target.stem + '-' + hashlib.sha256(before.encode()).hexdigest()[:16] + '.py')
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        backup.write_text(before)
    temporary = target.with_suffix('.py.partial')
    temporary.write_text(after)
    os.chmod(temporary, target.stat().st_mode)
    os.replace(temporary, target)
    print(f'{target.name}: geïnstalleerd; rollback: {backup}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    for name in ('kvk_api_validation.py', 'kvk_api_attribution.py'):
        if (args.root / 'scripts' / name).read_bytes() != Path(__file__).with_name(name).read_bytes():
            raise ValueError('Installeer eerst de bijbehorende API-modules')
    plans = []
    for name, patch in (('contact_research.py', patched_source), ('serve_dashboard.py', patched_dashboard)):
        target = args.root / 'scripts' / name
        before = target.read_text()
        plans.append((target, before, patch(before)))
    # Preflight every target before changing either file.
    for target, before, after in plans:
        install(target, before, after, args.root)
    print(f'{PROFILE}: klaar')


if __name__ == '__main__':
    main()
