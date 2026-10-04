import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_codex_usage import cache_for, codex_usage

LIMITS = {'primary': {'usedPercent': 3, 'windowDurationMins': 10080, 'resetsAt': 1791748901}}


class CodexUsageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cache = cache_for(Path(self.directory.name) / 'nederland_bedrijven.sqlite')

    def test_the_weekly_share_left_is_read_and_cached_for_a_minute(self):
        calls = []
        reader = lambda: calls.append(1) or LIMITS
        usage = codex_usage(self.cache, now=1000.0, reader=reader)
        self.assertEqual((usage['remainingPercent'], usage['usedPercent']), (97.0, 3.0))
        self.assertEqual(codex_usage(self.cache, now=1030.0, reader=reader), usage)
        self.assertEqual(len(calls), 1)
        codex_usage(self.cache, now=1061.0, reader=reader)
        self.assertEqual(len(calls), 2)

    def test_when_codex_cannot_be_asked_the_last_value_stays(self):
        self.assertIsNone(codex_usage(self.cache, now=1000.0, reader=lambda: None))
        codex_usage(self.cache, now=1000.0, reader=lambda: LIMITS)
        stale = codex_usage(self.cache, now=5000.0, reader=lambda: None)
        self.assertEqual(stale['remainingPercent'], 97.0)
        self.assertNotIn('_read_at', stale)


if __name__ == '__main__':
    unittest.main()
