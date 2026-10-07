import sys
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_website_liveness import check_website_status
from install_website_liveness import patch_research, patch_transfer, RESEARCH_OLD, RESEARCH_NEW, FINAL_GATE


class WebsiteGateTests(unittest.TestCase):
    def test_no_website_does_not_make_network_requests(self):
        with patch('kvk_website_liveness.subprocess.run', side_effect=AssertionError('No request')):
            self.assertEqual(check_website_status(''), 'no_website')
            self.assertEqual(check_website_status('https://a.test', 'not_working'), 'not_working')

    def test_only_explicit_live_success_can_be_found(self):
        for result, expected in [('true', 'found'), ('false', 'not_working'), ('null', 'not_working')]:
            with patch('kvk_website_liveness.shutil.which', return_value='node'), patch('kvk_website_liveness.subprocess.run',
                    return_value=SimpleNamespace(returncode=0, stdout='{"https://a.test":{"ok":' + result + '}}')):
                self.assertEqual(check_website_status('https://a.test'), expected)

    def test_unavailable_checker_and_timeout_fail_closed(self):
        for error in [OSError('missing'), subprocess.TimeoutExpired('node', 35)]:
            with patch('kvk_website_liveness.shutil.which', return_value='node'), patch('kvk_website_liveness.subprocess.run', side_effect=error):
                self.assertEqual(check_website_status('https://a.test'), 'not_working')

    def test_installer_preserves_research_and_cannot_leave_the_robot_flag_unguarded(self):
        self.assertEqual(patch_research("def validate():\n" + RESEARCH_OLD), "def validate():\n" + RESEARCH_NEW)
        self.assertEqual(patch_research("def validate():\n" + RESEARCH_NEW), "def validate():\n" + RESEARCH_NEW)
        transfer = '  if (!args.robotAvailable && sourceRows.length) {\n  }\n  const assignedIds = new Set();'
        installed = patch_transfer(transfer)
        self.assertNotIn('!args.robotAvailable &&', installed)
        self.assertIn(FINAL_GATE, installed)
        self.assertEqual(patch_transfer(installed), installed)
        with self.assertRaises(ValueError): patch_research('changed runtime')


if __name__ == '__main__': unittest.main()
