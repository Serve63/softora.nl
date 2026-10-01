"""Availability is not company evidence, and never authorizes another provider."""
import json
import sys
import types
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_codex_recovery import process_failure, TemporaryResearchFailure, ResearchBackoff

class CapacityTests(unittest.TestCase):
    def failure(self, message, event_type='turn.failed'):
        event = {'type': event_type, 'error': {'message': message}, 'message': message}
        return process_failure(types.SimpleNamespace(returncode=1, stdout=json.dumps(event), stderr=''))

    def test_actual_provider_capacity_error_is_temporary_but_account_limits_are_not(self):
        for message in ('Selected model is at capacity. Please try a different model.',
                        'Stream disconnected before completion', 'Too many requests'):
            self.assertIsInstance(self.failure(message), TemporaryResearchFailure)
        for message in ('You have hit your usage limit', 'insufficient_quota',
                        'Authentication failed', 'The model does not exist', 'unknown failure'):
            self.assertNotIsInstance(self.failure(message), TemporaryResearchFailure)
        self.assertNotIsInstance(self.failure('Selected model is at capacity', 'item.completed'), TemporaryResearchFailure)

    def test_capacity_burst_uses_one_bounded_backoff_and_retries_without_busy_loop(self):
        now = [100.0]
        backoff = ResearchBackoff(lambda: now[0])
        for n in range(10):
            backoff.defer(str(n), TemporaryResearchFailure('bezet'))
        self.assertEqual(backoff.remaining(), 30)
        self.assertEqual(backoff.attempts, 1)
        self.assertFalse(backoff.ready('0'))
        now[0] += 30
        self.assertTrue(backoff.ready('0'))
        for delay in (60, 120, 240, 300, 300):
            backoff.defer('0', TemporaryResearchFailure('bezet'))
            self.assertEqual(backoff.remaining(), delay)
            now[0] += delay
        backoff.succeeded('0')
        backoff.defer('0', TemporaryResearchFailure('bezet'))
        self.assertEqual(backoff.remaining(), 30)
