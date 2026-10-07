"""Fresh, read-only website gate shared by Searcher, Controleur and Robot writes."""
import json
import shutil
import subprocess
from pathlib import Path


def check_website_status(website, status='found'):
    if not website or status != 'found':
        return status if website else 'no_website'
    binary = shutil.which('node')
    if not binary:
        return 'not_working'
    try:
        result = subprocess.run([binary, str(Path(__file__).with_name('website_liveness.js'))],
                                input=json.dumps([website]), capture_output=True, text=True, timeout=35)
        checked = json.loads(result.stdout).get(website.strip(), {}) if result.returncode == 0 else {}
        return 'found' if checked.get('ok') is True else 'not_working'
    except (OSError, ValueError, subprocess.TimeoutExpired):
        # Keep established contacts. An unverified site belongs in without_website
        # and must never enter the mail/design stock as a working homepage.
        return 'not_working'
