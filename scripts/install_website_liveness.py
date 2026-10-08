"""Install the fresh website gate in the existing robot runtime without touching data or starting models."""
import argparse
import shutil
from pathlib import Path
from install_kvk_api_validation import install

RESEARCH_OLD = '''    if lead_status == "usable":
        unusable_reason = ""
    contact_status = "checked" if lead_status == "usable" else "unusable"
'''
RESEARCH_NEW = RESEARCH_OLD.replace('    contact_status =',
    '    from kvk_website_liveness import check_website_status\n'
    '    website_status = check_website_status(website, website_status)\n'
    '    contact_status =')
TRANSFER_OLD = '  if (!args.robotAvailable && sourceRows.length) {'
TRANSFER_NEW = '  if (sourceRows.length) {'
FINAL_ANCHOR = '  const assignedIds = new Set();'
FINAL_GATE = '''  // The actual target can retain a different website from an existing customer.
  // Recheck that final address before any upsert, including --robot-available.
  const finalChecks = await checkWebsites(assignments.map((item) => item.row.website));
  const finalRejected = assignments.filter((item) => finalChecks.get(normalize(item.row.website))?.ok !== true);
  console.log(JSON.stringify({ finalWebsiteGate: 'klaar', rejected: finalRejected.length }));
  const rejectedIds = new Set(finalRejected.map((item) => item.customerId));
  assignments.splice(0, assignments.length, ...assignments.filter((item) => !rejectedIds.has(item.customerId)));

'''


def patch_research(source):
    if RESEARCH_NEW in source:
        return source
    if source.count(RESEARCH_OLD) != 1:
        raise ValueError('Canonieke onderzoekspoort gewijzigd; inspecteer eerst')
    changed = source.replace(RESEARCH_OLD, RESEARCH_NEW, 1)
    compile(changed, 'contact_research.py', 'exec')
    return changed


def patch_transfer(source):
    if TRANSFER_OLD in source:
        source = source.replace(TRANSFER_OLD, TRANSFER_NEW, 1)
    if TRANSFER_NEW not in source or source.count(FINAL_ANCHOR) != 1:
        raise ValueError('Overdrachtspoort gewijzigd; inspecteer eerst')
    if FINAL_GATE not in source:
        source = source.replace(FINAL_ANCHOR, FINAL_GATE + FINAL_ANCHOR, 1)
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    scripts = args.root / 'scripts'
    plans = []
    for name, patch in [('contact_research.py', patch_research), ('transfer_usable_to_premium.js', patch_transfer)]:
        target = scripts / name
        before = target.read_text()
        plans.append((target, before, patch(before)))
    # Do not overwrite unrelated edits in an already running Robot.
    robot = scripts / 'kvk_robot_import.py'
    canonical = Path(__file__).with_name(robot.name).read_text()
    old = robot.read_text()
    if old != canonical:
        unpatched = canonical.replace('from kvk_website_liveness import check_website_status\n', '')
        unpatched = unpatched.replace('    website_status = check_website_status(website)\n', '')
        unpatched = unpatched.replace('(website, website_status,', '(website, "found" if website else "no_website",')
        unpatched = unpatched.replace('_usable_bucket(website, website_status)', '"with_website" if website else "without_website"')
        unpatched = unpatched.replace('        new_status = website_status', '        new_status = "found" if website else "no_website"')
        if old != unpatched:
            raise ValueError('Robot heeft andere wijzigingen; inspecteer eerst')
    plans.append((robot, old, canonical))
    shutil.copy2(Path(__file__).with_name('kvk_website_liveness.py'), scripts / 'kvk_website_liveness.py')
    target = scripts / 'website_liveness.js'
    if target.exists() and not target.is_symlink():
        backup = args.root / 'data/runtime_backups/website_liveness-before-source-gate.js'
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists(): shutil.copy2(target, backup)
    if target.exists() or target.is_symlink(): target.unlink()
    target.symlink_to(Path(__file__).with_name('website_liveness.js').resolve())
    for target, before, after in plans:
        install(target, before, after, args.root)
    print('Websitepoort geïnstalleerd; geen modellen gestart of bedrijfsgegevens gewijzigd.')


if __name__ == '__main__':
    main()
