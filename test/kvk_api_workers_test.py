"""Offline runner checks. Never calls OpenAI or touches the company database."""
import importlib.util
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules['start_database_fill_control'] = types.SimpleNamespace(post_json=None, resolve_token=None)
spec = importlib.util.spec_from_file_location('runner', Path(__file__).parents[1] / 'scripts/kvk_api_workers.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.pending = patch.object(runner, 'PENDING', Path(self.directory.name))
        self.pending.start()
        self.cli = patch.object(runner, 'run_cli', return_value='')
        self.enabled = patch.object(runner, 'is_enabled', return_value=True)
        self.cli.start()
        self.enabled.start()
        self.packet = {'bedrijven': [{'kvk_nummer': f'{i:08}'} for i in range(1, 4)]}

    def tearDown(self):
        self.cli.stop()
        self.enabled.stop()
        self.pending.stop()
        self.directory.cleanup()

    def test_selected_count_runs_concurrently_and_saves_every_result(self):
        barrier = threading.Barrier(3)
        def call(path, payload, **kwargs):
            barrier.wait(timeout=3)
            return {'ok': True, 'result': payload['company']}
        with patch.object(runner, 'call', side_effect=call):
            runner.research_batch('searcher', self.packet, [], 3)
        self.assertEqual(len(list(runner.PENDING.glob('contact_agent_results_api_searcher_initial_????????.json'))), 3)

    def test_saved_paid_results_are_reused(self):
        company = self.packet['bedrijven'][0]
        runner.save_result(runner.pending_path('searcher', company['kvk_nummer'], []), company)
        with patch.object(runner, 'call') as call:
            self.assertTrue(runner.research_one('searcher', company, {}, []))
            call.assert_not_called()

    def test_apply_never_skips_missing_queue_head(self):
        company = self.packet['bedrijven'][1]
        runner.save_result(runner.pending_path('searcher', company['kvk_nummer'], []), company)
        with patch.object(runner, 'apply_result') as apply:
            self.assertEqual(runner.apply_ready_prefix('searcher', self.packet, [], threading.Lock()), 0)
            apply.assert_not_called()

    def test_peer_results_survive_one_failed_request(self):
        def call(path, payload, **kwargs):
            if payload['company']['kvk_nummer'] == '00000002':
                raise RuntimeError('provider failed')
            return {'ok': True, 'result': payload['company']}
        with patch.object(runner, 'call', side_effect=call):
            with self.assertRaises(RuntimeError):
                runner.research_batch('searcher', self.packet, [], 3)
        self.assertEqual(len(list(runner.PENDING.glob('contact_agent_results_api_searcher_initial_????????.json'))), 2)

    def test_stopped_role_does_not_apply_saved_results(self):
        company = self.packet['bedrijven'][0]
        runner.save_result(runner.pending_path('searcher', company['kvk_nummer'], []), company)
        with patch.object(runner, 'is_enabled', return_value=False), patch.object(runner, 'apply_result') as apply:
            self.assertEqual(runner.apply_ready_prefix('searcher', self.packet, [], threading.Lock()), 0)
            apply.assert_not_called()

    def test_queue_packet_uses_selected_count(self):
        with patch.object(runner, 'run_cli', return_value='{"bedrijven":[{"kvk_nummer":"00000001"}]}') as cli:
            runner.next_packet('searcher', 7)
            args = cli.call_args.args
            self.assertEqual(args[args.index('--limit') + 1], '7')

    def test_invalid_saved_result_is_repaired_with_evidence_and_validation_error(self):
        company = self.packet['bedrijven'][0]
        path = runner.pending_path('searcher', company['kvk_nummer'], [])
        old = dict(company, checks_completed=False)
        runner.save_result(path, old)
        fixed = dict(company, checks_completed=True)
        with patch.object(runner, 'run_cli', side_effect=[runner.ValidationFailure('checks incomplete'), '']), patch.object(runner, 'call', return_value={'ok': True, 'result': fixed}) as call:
            self.assertTrue(runner.research_one('searcher', company, {}, []))
            repair = call.call_args.args[1]['brief']['repair']
            self.assertEqual(repair['previous_result'], old)
            self.assertIn('checks incomplete', repair['validation_error'])
        self.assertEqual(len(list(runner.PENDING.glob('*.rejected-*.json'))), 1)

    def test_repair_attempts_are_bounded_across_restart(self):
        company = self.packet['bedrijven'][0]
        with patch.object(runner, 'run_cli', side_effect=runner.ValidationFailure('incomplete')), patch.object(runner, 'call', return_value={'ok':True,'result':company}) as call:
            for _ in range(2):
                with self.assertRaises(runner.ValidationFailure):
                    runner.research_one('searcher', company, {}, [])
            self.assertEqual(call.call_count, runner.MAX_REPAIR_ATTEMPTS)

    def test_transient_poll_failure_does_not_disable_worker_but_paid_uncertainty_stops(self):
        self.assertTrue(runner.transient_control_failure(runner.RemoteFailure('/poll',503,'offline')))
        self.assertTrue(runner.transient_control_failure(runner.RemoteFailure('/report',0,'offline')))
        self.assertFalse(runner.transient_control_failure(runner.RemoteFailure('/research',503,'uncertain cost')))
        self.assertFalse(runner.transient_control_failure(runner.RemoteFailure('/poll',401,'unauthorized')))

    def test_api_packet_uses_self_contained_contract(self):
        with patch.object(runner,'research_one',return_value=True) as research:
            runner.research_batch('searcher',dict(self.packet,bindend=['Volg AGENTS.md en contact_page_extract.py']),[],1)
        self.assertIs(research.call_args.args[4], False)
        contract = research.call_args.args[2]
        self.assertNotIn('AGENTS.md', str(contract))
        self.assertNotIn('contact_page_extract.py', str(contract))


if __name__ == '__main__':
    unittest.main()
