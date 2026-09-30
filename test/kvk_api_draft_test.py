import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from kvk_api_attribution import execution_for, copy_execution_metadata, patched_dashboard_source


class DraftAttributionTest(unittest.TestCase):
    def test_real_apply_entrypoint_preserves_both_producers(self):
        for review, suffix in ((False, '.luna.json'), (True, '.engine.json')):
            with self.subTest(review=review), tempfile.TemporaryDirectory() as folder:
                source, draft = Path(folder)/'source.json', Path(folder)/'draft.json'
                source.write_text('{}'); draft.write_text('[{"validation_profile":"api-basic-v1"}]')
                source.with_suffix(suffix).write_text(json.dumps(dict(engine='codex', model='gpt-6-luna', reasoning_effort='xhigh')))
                digest = hashlib.sha256(draft.read_bytes()).hexdigest()
                precheck = types.ModuleType('contact_agent_precheck')
                precheck.validated_draft_path = lambda path: draft
                research = types.ModuleType('contact_research')
                research.build_parser = lambda: types.SimpleNamespace(parse_args=lambda args: args)
                calls = []
                research.command_validate = lambda args: calls.append('validate')
                def apply(args):
                    self.assertEqual(calls, ['validate'])
                    execution = execution_for(json.loads(draft.read_text()), Path(args[1]), review)
                    self.assertEqual(execution['display_label'], 'Codex Luna 6 xhigh')
                    self.assertEqual(execution['model_role'], ('controller' if review else 'searcher')+'_codex_luna_xhigh')
                    self.assertEqual(execution['input_sha256'], digest)
                    return 0
                research.command_apply = apply
                spec = importlib.util.spec_from_file_location('draft_entrypoint', Path(__file__).resolve().parents[1]/'scripts/contact_validate_apply.py')
                module = importlib.util.module_from_spec(spec)
                with patch('kvk_api_attribution.DATA_ROOT', Path(folder)), patch.dict(sys.modules, contact_agent_precheck=precheck, contact_research=research), patch.object(sys, 'argv', ['apply', str(source)] + (['--review-unusable'] if review else [])):
                    spec.loader.exec_module(module)
                    self.assertEqual(module.main(), 0)

    def test_missing_source_metadata_cannot_reuse_stale_draft_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            source, draft = Path(folder)/'source.json', Path(folder)/'draft.json'
            source.write_text('{}'); draft.write_text('{}')
            draft.with_suffix('.engine.json').write_text('{"engine":"codex"}')
            with patch("kvk_api_attribution.DATA_ROOT", Path(folder)):
                copy_execution_metadata(source, draft)
            self.assertFalse(draft.with_suffix('.engine.json').exists())

    def test_metadata_cannot_write_outside_data_root(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch('kvk_api_attribution.DATA_ROOT', Path(folder)/'data'):
                with self.assertRaises(ValueError):
                    copy_execution_metadata(Path(folder)/'source.json', Path(folder)/'outside.json')

    def test_repair_requires_hash_bound_explicit_metadata(self):
        from kvk_attribution_repair import proven_execution
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'result.json'
            path.write_text('{}')
            marker = dict(status='PRECHECK_OK', contract_version=2,
                          sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                          validated_draft={'sha256': 'validated-hash'}, scope={})
            path.with_name(path.name+'.precheck-ok.json').write_text(json.dumps(marker))
            self.assertIsNone(proven_execution(path))
            path.with_suffix('.engine.json').write_text(json.dumps(dict(engine='codex', model='gpt-6-luna', reasoning_effort='xhigh')))
            self.assertEqual(proven_execution(path)['effort'], 'xhigh')
            path.write_text('{"changed":true}')
            self.assertIsNone(proven_execution(path))

    def test_recent_query_patch_includes_both_roles_and_is_idempotent(self):
        source = "def latest_treated_query():\n    return \"role IN ('searcher_luna_max', 'controller_luna_max')\"\n\ndef other():\n    return 'searcher_luna_max'\n"
        patched = patched_dashboard_source(source)
        self.assertIn('searcher_codex_luna_xhigh', patched)
        self.assertIn('controller_codex_luna_xhigh', patched)
        self.assertEqual(patched_dashboard_source(patched), patched)
        self.assertTrue(patched.endswith("return 'searcher_luna_max'\n"))

if __name__ == '__main__':
    unittest.main()
