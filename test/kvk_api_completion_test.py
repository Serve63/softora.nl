import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import unittest
from unittest.mock import patch
from kvk_completion_order import completion_scope, patched_source, ANCHOR
from kvk_api_validation import PROFILE


class CompletionTests(unittest.TestCase):
    def api(self, review=False):
        return {'assert_official_queue_mode': lambda a: None, 'clean': str,
                'uses_approved_review': lambda a: False, 'uses_unusable_review': lambda a: review,
                'assert_results_match_active_location': lambda c, r: {'id': 1},
                'active_location_filters': lambda l: ('filter', []),
                'review_scope_from_args': lambda a: ({'id': 2}, '', 'filter', []),
                'fetch_next': lambda *a, **kw: [{'kvk_nummer': '1'}, {'kvk_nummer': '2'}],
                'fetch_unusable_review': lambda *a: [{'kvk_nummer': '1'}, {'kvk_nummer': '2'}]}

    def test_ready_peer_can_apply_but_completed_or_unassigned_company_cannot(self):
        with patch.dict(os.environ, {'SOFTORA_KVK_COMPLETION_ORDER': '1'}):
            for review in (False, True):
                result = {'kvk_nummer': '2', 'validation_profile': PROFILE}
                self.assertIsNotNone(completion_scope(None, [result], None, self.api(review)))
                with self.assertRaises(ValueError):
                    completion_scope(None, [dict(result, kvk_nummer='3')], None, self.api(review))
                with self.assertRaises(ValueError):
                    completion_scope(None, [result, result], None, self.api(review))

    def test_native_and_disabled_paths_keep_original_order(self):
        with patch.dict(os.environ, {'SOFTORA_KVK_COMPLETION_ORDER': '0'}):
            self.assertIsNone(completion_scope(None, [{'validation_profile': PROFILE}], None, {}))
        with patch.dict(os.environ, {'SOFTORA_KVK_COMPLETION_ORDER': '1'}):
            self.assertIsNone(completion_scope(None, [{'kvk_nummer': '2'}], None, {}))

    def test_install_is_idempotent_and_rejects_drift(self):
        source = 'def gate():\n' + ANCHOR + '        pass\n'
        installed = patched_source(source)
        self.assertEqual(patched_source(installed), installed)
        with self.assertRaises(ValueError):
            patched_source('changed')
