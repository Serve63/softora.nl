"""Offline runner checks. Never calls OpenAI or touches the company database."""
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import kvk_api_evidence as evidence
import kvk_luna_searcher
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
        # A test must never start a real Codex run. Research goes through the patched
        # `call('/research', ...)` fake below, which the tests configure per case.
        def fake_research(company, _instructions, feedback=''):
            self.feedback = feedback
            return runner.call('/research', {'role': 'searcher', 'company': company, 'brief': {}})['result'], []
        def fake_control(company, brief, _instructions):
            return runner.call('/research', {'role': 'controller', 'company': company, 'brief': brief})['result']
        self.real_codex_run, self.real_codex_research = runner.codex_run, runner.codex_research
        self.real_codex_control = runner.codex_control
        self.real_instructions_for = runner.instructions_for
        self.codex = [patch.object(evidence, 'repair_page_evidence', return_value=[]),
                      patch.object(runner, 'codex_run', side_effect=AssertionError('echte Codex-run in een test')),
                      patch.object(runner, 'codex_research', side_effect=fake_research),
                      patch.object(runner, 'codex_control', side_effect=fake_control),
                      patch.object(runner, 'instructions_for', return_value='INSTRUCTIES'),
                      patch.object(runner, 'already_researched', return_value=False),
                      patch.object(runner, 'ROBOT_QUEUE', Path(self.directory.name) / 'geen-robot')]
        for patcher in self.codex:
            patcher.start()
        self.packet = {'bedrijven': [{'kvk_nummer': f'{i:08}'} for i in range(1, 4)]}

    def tearDown(self):
        for patcher in self.codex:
            patcher.stop()
        self.cli.stop()
        self.enabled.stop()
        self.pending.stop()
        self.directory.cleanup()

    def test_restart_quarantines_old_answers_and_exhausted_repairs(self):
        from kvk_worker_cache import contract, stamp, quarantine_stale
        root = Path(self.directory.name)
        expected = {role: contract('gpt-6-luna', 'xhigh', 'NEW') for role in ('searcher', 'controller')}
        old = root / 'contact_agent_results_api_controller_unusable_12345678.json'
        old.write_text('{"checks_completed":false}')
        recovery = old.with_suffix('.recovery.json')
        recovery.write_text('{"attempts":3}')
        stamp(old, contract('gpt-6-luna', 'max', 'OLD'))
        current = root / 'contact_agent_results_api_searcher_initial_23456789.json'
        current.write_text('{}')
        stamp(current, expected['searcher'])
        moved = quarantine_stale(root, root / 'archive', expected)
        self.assertEqual(moved, [old.stem])
        self.assertFalse(old.exists())
        self.assertFalse(recovery.exists())
        self.assertTrue(current.exists())
        saved = list((root / 'archive').glob('*/' + recovery.name))
        self.assertEqual(json.loads(saved[0].read_text()), {'attempts': 3})

    def test_prompt_change_and_missing_marker_both_invalidate_cache(self):
        from kvk_worker_cache import contract, stamp, quarantine_stale
        root = Path(self.directory.name)
        for i in (1, 2):
            path = root / f'contact_agent_results_api_searcher_initial_{i:08}.json'
            path.write_text('{}')
            if i == 1:
                stamp(path, contract('gpt-6-luna', 'xhigh', 'OLD PROMPT'))
        expected = {role: contract('gpt-6-luna', 'xhigh', 'NEW PROMPT') for role in ('searcher', 'controller')}
        self.assertEqual(len(quarantine_stale(root, root / 'archive', expected)), 2)

    def test_selected_count_runs_concurrently_and_saves_every_result(self):
        barrier = threading.Barrier(3)
        def call(path, payload, **kwargs):
            barrier.wait(timeout=3)
            return {'ok': True, 'result': payload['company']}
        with patch.object(runner, 'call', side_effect=call), \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company):
            runner.research_batch('searcher', self.packet, [], 3)
        self.assertEqual(len(list(runner.PENDING.glob('contact_agent_results_api_searcher_initial_????????.luna.json'))), 3)
        # The apply step needs the mapped result, not only the raw answer.
        self.assertEqual(len(list(runner.PENDING.glob('contact_agent_results_api_searcher_initial_????????.json'))), 3)

    def test_researched_queue_head_reaches_the_apply_step(self):
        with patch.object(runner, 'call', return_value={'ok': True, 'result': self.packet['bedrijven'][0]}), \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company), \
                patch.object(runner, 'apply_result', return_value=True) as apply, patch.object(runner, 'report'):
            packet = {'bedrijven': self.packet['bedrijven'][:1]}
            runner.research_batch('searcher', packet, [], 1)
            self.assertEqual(runner.apply_ready_prefix('searcher', packet, [], threading.Lock()), 1)
            apply.assert_called_once()

    def run_pipeline(self, companies, count, research_delay, streaming_role=None, stop_when_isolated=False, writer_failure=None):
        queue = [dict(company) for company in companies]
        researched, applied, running, peak = [], [], [0], [0]
        lock = threading.Lock()

        def call(path, payload, **kwargs):
            if path == '/poll':
                import kvk_worker_failures as failures
                enabled = bool(queue) and not (stop_when_isolated and all(failures.read(runner.pending_path(streaming_role, c['kvk_nummer'], [])).get('needs_review') for c in queue))
                return {'state': {'workers': {streaming_role or 'searcher': {'enabled': enabled, 'count': count}}}}
            if path == '/research':
                with lock:
                    running[0] += 1
                    peak[0] = max(peak[0], running[0])
                    researched.append(payload['company']['kvk_nummer'])
                try:
                    time.sleep(research_delay(payload['company']['kvk_nummer']))
                finally:
                    with lock:
                        running[0] -= 1
                return {'ok': True, 'result': payload['company']}
            return {'ok': True}

        def next_packet(role, limit):
            self.queue_reads = getattr(self, 'queue_reads', 0) + 1
            return ({'bedrijven': queue[:limit]}, []) if queue else None

        def apply(path, flags, apply_lock, role, **kwargs):
            index = next(i for i, c in enumerate(queue) if c['kvk_nummer'] in path.name) if streaming_role else 0
            kvk = queue[index]['kvk_nummer']
            self.assertIn(kvk, path.name)
            if writer_failure:
                writer_failure(kvk)
            applied.append(queue.pop(index)['kvk_nummer'])
            path.unlink()
            return True

        original_wait = runner.wait
        with patch.object(runner, 'call', side_effect=call), patch.object(runner, 'next_packet', side_effect=next_packet), \
                patch.object(runner, 'apply_result', side_effect=apply), patch.object(runner, 'report'), \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company), \
                patch.object(runner, 'wait', side_effect=lambda futures, **kw: original_wait(futures, timeout=0.05, return_when=runner.FIRST_COMPLETED)):
            if streaming_role:
                import kvk_worker_stream
                with patch.object(runner, 'validate_saved_result'), patch.object(kvk_worker_stream, 'time', types.SimpleNamespace(monotonic=lambda: time.monotonic()*100, sleep=lambda _: time.sleep(0.01))), patch.object(kvk_worker_stream, 'wait', side_effect=lambda futures, **kw: original_wait(futures, timeout=0.02, return_when=runner.FIRST_COMPLETED)):
                    kvk_worker_stream.run(streaming_role, runner, threading.Lock())
            else:
                runner.run_searcher_pipeline(threading.Lock())
        return researched, applied, peak[0]

    def test_stream_applies_fast_results_before_slow_peer_for_both_roles(self):
        for role in ('searcher', 'controller'):
            with self.subTest(role=role):
                companies = [{'kvk_nummer': f'{i:08}'} for i in range(11, 15)]
                researched, applied, peak = self.run_pipeline(companies, 3,
                    lambda kvk: 0.4 if kvk == '00000011' else 0.02, role)
                self.assertNotEqual(applied[0], '00000011')
                self.assertEqual(sorted(applied), [c['kvk_nummer'] for c in companies])
                self.assertEqual(sorted(researched), sorted(applied))
                self.assertLessEqual(peak, 3)

    def test_invalid_answers_retry_per_company_while_peers_apply(self):
        from kvk_worker_failures import InvalidModelAnswer
        import kvk_worker_failures as failures
        for role in ('searcher', 'controller'):
            attempts = {}
            def delay(kvk):
                attempts[kvk] = attempts.get(kvk, 0) + 1
                if kvk == '00000081' and attempts[kvk] < 3:
                    raise InvalidModelAnswer('wrong company', {'kvk_nummer': '99999999'})
                return 0.1 if kvk == '00000081' else 0.01
            with self.subTest(role=role), patch.object(failures, 'RETRY_DELAYS', (0, 0)):
                _, applied, peak = self.run_pipeline([{'kvk_nummer': k} for k in ('00000081','00000082')], 2, delay, role)
                self.assertEqual(applied, ['00000082','00000081'])
                self.assertEqual(attempts['00000081'], 3)
                self.assertLessEqual(peak, 2)
                self.assertFalse(failures.state_path(runner.pending_path(role,'00000081',[])).exists())

    def test_permanent_bad_answer_is_bounded_persistent_and_never_applied(self):
        import kvk_worker_failures as failures
        for role in ('searcher', 'controller'):
            def delay(kvk):
                if kvk == '00000091':
                    runner.parse_answer('not JSON')
                return 0.01
            with self.subTest(role=role), patch.object(failures, 'RETRY_DELAYS', (0, 0)):
                _, applied, _ = self.run_pipeline([{'kvk_nummer': k} for k in ('00000091','00000092')], 2, delay, role, True)
                self.assertEqual(applied, ['00000092'])
                path = runner.pending_path(role, '00000091', [])
                state = failures.read(path)
                self.assertEqual(state['attempts'], 3)
                self.assertEqual(state['history'][0]['answer'], 'not JSON')
                self.assertFalse(failures.ready(path))
                self.assertFalse(path.exists())
                # A fresh stream sees the persisted isolation and still processes peers.
                _, applied, _ = self.run_pipeline([{'kvk_nummer': k} for k in ('00000091','00000093')], 2, delay, role, True)
                self.assertEqual(applied, ['00000093'])
                self.assertEqual(failures.read(path)['attempts'], 3)

    def test_exhausted_validation_isolated_but_system_errors_still_propagate(self):
        for role in ('searcher', 'controller'):
            def writer(kvk):
                if kvk == '00000071':
                    raise runner.CompanyValidationFailure('Evidence rejected after repairs')
            with self.subTest(role=role):
                _, applied, _ = self.run_pipeline([{'kvk_nummer': k} for k in ('00000071','00000072')], 2, lambda _: 0.01, role, True, writer)
                self.assertEqual(applied, ['00000072'])
                with self.assertRaisesRegex(RuntimeError, 'provider failed'):
                    self.run_pipeline([{'kvk_nummer':'00000073'}], 1,
                                      lambda _: (_ for _ in ()).throw(RuntimeError('provider failed')), role)

    def test_pipeline_applies_in_queue_order_while_slow_requests_keep_running(self):
        companies = [{'kvk_nummer': f'{i:08}'} for i in range(1, 9)]
        # The first company is slow; the others must not wait for it to be researched.
        delay = lambda kvk: 0.4 if kvk == '00000001' else 0.02
        researched, applied, peak = self.run_pipeline(companies, 3, delay)
        self.assertEqual(applied, [company['kvk_nummer'] for company in companies])
        self.assertEqual(sorted(researched), sorted(applied))  # every company paid exactly once
        self.assertLessEqual(peak, 3)
        self.assertEqual(peak, 3)

    def test_pipeline_stops_on_a_failed_request_but_keeps_paid_peers(self):
        companies = [{'kvk_nummer': f'{i:08}'} for i in range(1, 4)]
        def delay(kvk):
            if kvk == '00000002':
                raise RuntimeError('provider failed')
            return 0.05
        with self.assertRaisesRegex(RuntimeError, 'provider failed'):
            self.run_pipeline(companies, 3, delay)
        self.assertEqual(len(list(runner.PENDING.glob('*.luna.json'))), 2)

    def test_pipeline_reads_the_queue_once_per_window_not_once_per_company(self):
        companies = [{'kvk_nummer': f'{i:08}'} for i in range(1, 13)]
        with patch.object(runner, 'SEARCHER_REFRESH_SECONDS', 3600):
            researched, applied, peak = self.run_pipeline(companies, 2, lambda kvk: 0.01)
        self.assertEqual(applied, [company['kvk_nummer'] for company in companies])
        self.assertLessEqual(self.queue_reads, 7)  # 12 companies in windows of 6, not 12+ reads

    def test_codex_searcher_uses_the_server_instructions_and_never_calls_the_paid_api(self):
        company = {'kvk_nummer': '00000001', 'bedrijfsnaam': 'Voorbeeld B.V.', 'plaats': 'Tilburg'}
        answer = {'kvk_nummer': '00000001', 'telefoonnummer': ''}
        with patch.object(runner, 'codex_research', return_value=(answer, ['https://voorbeeld.nl/'])) as codex, \
                patch.object(runner, 'call') as call, \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company):
            self.assertTrue(runner.luna_search_one(company, [], False))
            call.assert_not_called()
        codex.assert_called_once_with(company, 'INSTRUCTIES', '')
        saved = runner.json.loads(runner.pending_path('searcher', '00000001', []).with_suffix('.luna.json').read_text())
        self.assertEqual((saved['engine'], saved['consulted_urls']), ('codex', ['https://voorbeeld.nl/']))

    def test_codex_answer_for_another_company_is_refused(self):
        with patch.object(runner, 'codex_research', return_value=({'kvk_nummer': '99999999'}, [])):
            with self.assertRaisesRegex(RuntimeError, 'juiste onderneming'):
                runner.luna_search_one({'kvk_nummer': '00000001'}, [], False)

    def test_codex_run_passes_the_prompt_and_reads_opened_pages(self):
        events = '\n'.join([
            '{"type":"item.completed","item":{"type":"web_search","query":"naam plaats","action":{"type":"search"}}}',
            '{"type":"item.completed","item":{"type":"web_search","query":"https://voorbeeld.nl/contact","action":{"type":"other"}}}',
            'geen json',
        ])
        def run(command, **kwargs):
            self.assertIn('--ignore-user-config', command)
            self.assertIn('web_search=live', command)
            self.assertNotIn('CODEX_APP_TOOLS_PIPE_PATH', kwargs['env'])
            self.assertNotIn('CODEX_INTERNAL_ORIGINATOR_OVERRIDE', kwargs['env'])
            self.assertNotIn('CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY', kwargs['env'])
            self.assertIn('gpt-6-luna', command)
            self.assertIn('model_reasoning_effort=xhigh', command)
            self.assertTrue(kwargs['input'].startswith('INSTRUCTIES'))
            self.assertIn('"kvk_nummer": "00000001"', kwargs['input'])
            Path(command[command.index('-o') + 1]).write_text('Antwoord: {"kvk_nummer":"00000001"}')
            return types.SimpleNamespace(returncode=0, stdout=events, stderr='')
        with patch.dict(os.environ, {'CODEX_APP_TOOLS_PIPE_PATH':'parent-pipe', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE':'parent-origin', 'CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY':'parent-task'}), patch.object(runner.subprocess, 'run', side_effect=run), patch.object(runner, 'codex_run', self.real_codex_run), \
                patch.object(runner, 'codex_research', self.real_codex_research), patch.object(runner, 'codex_binary', return_value='/test/codex'):
            answer, urls = runner.codex_research({'kvk_nummer': '00000001'}, 'INSTRUCTIES')
        self.assertEqual((answer, urls), ({'kvk_nummer': '00000001'}, ['https://voorbeeld.nl/contact']))

    def test_controller_uses_luna_xhigh(self):
        def run(command, **kwargs):
            self.assertIn('gpt-6-luna', command)
            self.assertIn('model_reasoning_effort=xhigh', command)
            Path(command[command.index('-o') + 1]).write_text('{}')
            return types.SimpleNamespace(returncode=0, stdout='', stderr='')
        with patch.object(runner.subprocess, 'run', side_effect=run), patch.object(runner, 'codex_run', self.real_codex_run), patch.object(runner, 'codex_binary', return_value='/test/codex'):
            self.assertEqual(self.real_codex_control({}, {}, 'CONTROLE'), {})

    def test_controller_receives_company_searcher_result_and_evidence(self):
        company = {'kvk_nummer': '00000001', 'bedrijfsnaam': 'Voorbeeld',
                   'negative_claim': {'email': 'info@example.nl', 'unusable_reason': 'phone_missing'},
                   'prior_evidence': [{'url': 'https://example.nl/contact'}]}
        brief = runner.api_brief({})
        with patch.object(runner, 'codex_run', return_value=('{}', '')) as run:
            self.real_codex_control(company, brief, 'KORTE CONTROLEPROMPT')
        prompt = run.call_args.args[0]
        self.assertTrue(prompt.startswith('KORTE CONTROLEPROMPT\n\nOpdracht:\n'))
        self.assertEqual(json.loads(prompt.split('Opdracht:\n', 1)[1]),
                         {'company': company, 'research_contract': brief})
        self.assertEqual(run.call_args.kwargs, {'role': 'controller'})
        for old_instruction in ('Begin met', 'Open een gevonden', 'heropen eerst', 'hoogstens'):
            self.assertNotIn(old_instruction, prompt)

    def test_codex_binary_survives_app_layout_change(self):
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / 'codex'
            binary.write_text('test')
            binary.chmod(0o700)
            with patch.object(runner, 'CODEX_CANDIDATES', (folder + '/missing', str(binary))), \
                    patch.object(runner.shutil, 'which', return_value=None):
                self.assertEqual(runner.codex_binary(), str(binary))
            with patch.object(runner, 'CODEX_CANDIDATES', (folder + '/missing',)), \
                    patch.object(runner.shutil, 'which', return_value=None):
                with self.assertRaisesRegex(RuntimeError, 'Geen onderzoek gestart'):
                    runner.codex_binary()

    def test_report_preserves_the_actual_validation_reason(self):
        reason = 'Herstel nodig: ' + 'x' * 180 + ' telefoonveld leeg'
        with patch.object(runner, 'call') as call:
            runner.report('controller', reason, halt=True)
        self.assertEqual(call.call_args.args[1]['message'], reason)

    def test_controller_contract_requires_structured_contact_rejections(self):
        brief = runner.api_brief({})
        self.assertIn('contact_rejections', brief['result_schema'])
        self.assertTrue(any('Verwijder geen bewijs' in rule for rule in brief['bindend']))

    def test_worker_instructions_come_from_the_server_poll(self):
        runner.INSTRUCTIONS.clear()
        polled = {'state': {}, 'searcherInstructions': 'ZOEK', 'controllerInstructions': 'CONTROLEER'}
        with patch.object(runner, 'call', return_value=polled) as call, \
                patch.object(runner, 'instructions_for', self.real_instructions_for):
            self.assertEqual(runner.instructions_for('searcher'), 'ZOEK')
            self.assertEqual(runner.instructions_for('controller'), 'CONTROLEER')
            call.assert_called_once_with('/poll', {})
        runner.INSTRUCTIONS.clear()
        with patch.object(runner, 'call', return_value={'state': {}}), \
                patch.object(runner, 'instructions_for', self.real_instructions_for):
            with self.assertRaisesRegex(RuntimeError, 'Instructies voor controller ontbreken'):
                runner.instructions_for('controller')

    def test_controller_runs_through_codex_and_is_marked_as_codex_work(self):
        company = self.packet['bedrijven'][0]
        result = dict(company, checks_completed=True)
        with patch.object(runner, 'codex_control', return_value=result) as control, patch.object(runner, 'call') as call:
            self.assertTrue(runner.research_one('controller', company, {'contract': 'x'}, [], False))
            call.assert_not_called()
        control.assert_called_once_with(company, {'contract': 'x'}, 'INSTRUCTIES')
        path = runner.pending_path('controller', company['kvk_nummer'], [])
        self.assertEqual(runner.json.loads(path.with_suffix('.engine.json').read_text()), {'engine': 'codex', 'model': 'gpt-6-luna', 'reasoning_effort': 'xhigh'})

    def test_a_searcher_answer_for_a_company_the_robot_already_found_is_set_aside_without_stopping(self):
        company = self.packet['bedrijven'][0]
        path = runner.pending_path('searcher', company['kvk_nummer'], [])
        runner.save_result(path.with_suffix('.luna.json'), {'answer': company, 'consulted_urls': []})
        runner.save_result(path, company)
        completed = Path(self.directory.name) / 'completed'
        with patch.object(runner, 'COMPLETED', completed), patch.object(runner, 'already_researched', return_value=True), \
                patch.object(runner, 'apply_result') as apply, patch.object(runner, 'report'):
            self.assertTrue(runner.apply_searcher_head(self.packet, [], threading.Lock()))
            apply.assert_not_called()
        self.assertFalse(path.exists())
        self.assertEqual(len(list(completed.glob('*.superseded-*'))), 2)

    def test_the_searcher_marks_a_company_busy_while_codex_researches_it(self):
        company = self.packet['bedrijven'][0]
        busy = runner.pending_path('searcher', company['kvk_nummer'], []).with_suffix('.busy')
        seen = []
        def research(company, _instructions, feedback=''):
            seen.append(busy.exists())
            return company, []
        with patch.object(runner, 'codex_research', side_effect=research), \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company):
            self.assertTrue(runner.luna_search_one(company, [], False))
        self.assertEqual(seen, [True])
        self.assertFalse(busy.exists())

    def test_a_searcher_waits_while_the_robot_is_researching_the_same_company(self):
        queue = Path(self.directory.name) / 'robot'
        with patch.object(runner, 'ROBOT_QUEUE', queue):
            self.assertFalse(runner.robot_busy('00000001'))
            (queue / '00000001').mkdir(parents=True)
            (queue / '00000001' / 'runner.log').write_text('bezig')
            self.assertTrue(runner.robot_busy('00000001'))
            (queue / '00000001' / 'completed.json').write_text('{}')
            self.assertFalse(runner.robot_busy('00000001'))
            (queue / '00000002').mkdir()
            old = time.time() - runner.ROBOT_BUSY_SECONDS - 5
            os.utime(queue / '00000002', (old, old))
            self.assertFalse(runner.robot_busy('00000002'))

    def test_refused_searcher_answer_is_researched_again_with_the_reason(self):
        company = self.packet['bedrijven'][0]
        path = runner.pending_path('searcher', company['kvk_nummer'], [])
        runner.save_result(path.with_suffix('.luna.json'), {'answer': company, 'consulted_urls': []})
        runner.save_result(path, company)
        refused = runner.ValidationFailure('minimaal 3 bronnen')
        with patch.object(runner, 'apply_result', side_effect=refused), patch.object(runner, 'report'):
            self.assertFalse(runner.apply_searcher_head(self.packet, [], threading.Lock()))
        self.assertFalse(path.exists())
        self.assertTrue(path.with_suffix('.rejected-1.luna.json').exists())
        with patch.object(runner, 'call', return_value={'ok': True, 'result': company}), \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company):
            self.assertTrue(runner.luna_search_one(company, [], False))
        self.assertIn('minimaal 3 bronnen', self.feedback)
        with patch.object(runner, 'apply_result', side_effect=refused), patch.object(runner, 'report'):
            self.assertFalse(runner.apply_searcher_head(self.packet, [], threading.Lock()))
            with patch.object(runner, 'call', return_value={'ok': True, 'result': company}), \
                    patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company):
                runner.luna_search_one(company, [], False)
            # After the allowed retries the worker stops and says why instead of looping forever.
            with self.assertRaisesRegex(runner.ValidationFailure, 'nieuwe Codex-pogingen'):
                runner.apply_searcher_head(self.packet, [], threading.Lock())

    def test_pipeline_never_exceeds_one_request_with_count_one(self):
        companies = [{'kvk_nummer': f'{i:08}'} for i in range(1, 4)]
        researched, applied, peak = self.run_pipeline(companies, 1, lambda kvk: 0.01)
        self.assertEqual((applied, peak), (['00000001', '00000002', '00000003'], 1))

    def test_saved_paid_results_are_reused(self):
        company = self.packet['bedrijven'][0]
        path = runner.pending_path('searcher', company['kvk_nummer'], [])
        runner.save_result(path.with_suffix('.luna.json'), {'answer': company, 'consulted_urls': []})
        with patch.object(runner, 'call') as call, patch.object(kvk_luna_searcher, 'to_canonical', return_value=company):
            self.assertTrue(runner.research_one('searcher', company, {}, []))
            call.assert_not_called()
        self.assertTrue(path.exists())

    def test_searcher_pays_once_and_never_buys_a_repair(self):
        company = self.packet['bedrijven'][0]
        with patch.object(runner, 'run_cli', side_effect=runner.ValidationFailure('database weigert')), \
                patch.object(kvk_luna_searcher, 'to_canonical', return_value=company), \
                patch.object(runner, 'call', return_value={'ok': True, 'result': company}) as call:
            for _ in range(2):
                with self.assertRaisesRegex(runner.ValidationFailure, 'Codex-antwoord bewaard'):
                    runner.research_one('searcher', company, {}, [])
            self.assertEqual(call.call_count, 1)
            self.assertEqual(call.call_args.args[1]['brief'], {})

    def test_result_from_the_retired_contract_is_not_relabelled_as_luna(self):
        company = self.packet['bedrijven'][0]
        path = runner.pending_path('searcher', company['kvk_nummer'], [])
        runner.save_result(path, dict(company, model='sol'))
        with patch.object(runner, 'call', return_value={'ok': True, 'result': company}) as call, \
                patch.object(kvk_luna_searcher, 'to_canonical', return_value=company):
            self.assertTrue(runner.research_one('searcher', company, {}, [], False))
            call.assert_called_once()
        self.assertNotIn('sol', path.read_text())
        self.assertEqual(len(list(runner.PENDING.glob('*.retired-*.json'))), 1)

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
        with patch.object(runner, 'call', side_effect=call), \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company):
            with self.assertRaises(RuntimeError):
                runner.research_batch('searcher', self.packet, [], 3)
        self.assertEqual(len(list(runner.PENDING.glob('contact_agent_results_api_searcher_initial_????????.luna.json'))), 2)

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
        path = runner.pending_path('controller', company['kvk_nummer'], [])
        old = dict(company, checks_completed=False)
        runner.save_result(path, old)
        fixed = dict(company, checks_completed=True)
        with patch.object(runner, 'run_cli', side_effect=[runner.ValidationFailure('checks incomplete'), '']), patch.object(runner, 'call', return_value={'ok': True, 'result': fixed}) as call:
            self.assertTrue(runner.research_one('controller', company, {}, []))
            repair = call.call_args.args[1]['brief']['repair']
            self.assertEqual(repair['previous_result']['kvk_nummer'], old['kvk_nummer'])
            self.assertFalse(repair['previous_result']['checks_completed'])
            self.assertIn('checks incomplete', repair['validation_error'])
        self.assertEqual(len(list(runner.PENDING.glob('*.rejected-*.json'))), 1)

    def test_repair_attempts_are_bounded_across_restart(self):
        company = self.packet['bedrijven'][0]
        with patch.object(runner, 'run_cli', side_effect=runner.ValidationFailure('incomplete')), patch.object(runner, 'call', return_value={'ok':True,'result':company}) as call:
            for _ in range(2):
                with self.assertRaises(runner.ValidationFailure):
                    runner.research_one('controller', company, {}, [])
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

    def test_api_contract_explains_eligibility_and_negative_evidence_before_spending(self):
        contract = runner.api_brief({'result_schema_eenmaal': {'route_notes': {'social_bio': ''}}})
        rules = '\n'.join(contract['bindend'])
        for requirement in ('telefoonnummer EN email', 'operational_status operational',
                            'entity_role specific', 'doel-KVK', 'bedrijfsdetailbronnen',
                            'exacte bron-URL', 'toolfouten',
                            'ONBRUIKBAAR_REVIEWED_V1', 'not_applicable met eerlijke reden'):
            self.assertIn(requirement, rules)
        self.assertIsInstance(contract['result_schema']['route_notes']['social_bio'], dict)

    def test_contact_icons_are_candidates_not_automatic_database_values(self):
        parser = evidence.ContactLinks('https://example.nl/')
        parser.feed('<a href="mailto:info@example.nl"></a><a href="https://api.whatsapp.com/send?phone=0612345678"></a>')
        result = {'email': 'info@example.nl', 'telefoonnummer': '', 'field_evidence': {}}
        contacts = evidence.unreviewed_contacts(result, [{'contacts': parser.contacts}])
        self.assertEqual([item['value'] for item in contacts], ['0612345678'])
        self.assertEqual(result['telefoonnummer'], '')
        result['field_evidence']['telefoonnummer'] = '0612345678 afgewezen: andere onderneming'
        self.assertEqual(evidence.unreviewed_contacts(result, [{'contacts': parser.contacts}]), [])

    def test_private_urls_and_redirects_are_rejected(self):
        with patch.object(evidence.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 80))]):
            with self.assertRaises(ValueError):
                evidence.require_public_url('http://localhost/')
            with self.assertRaises(ValueError):
                evidence.PublicRedirects().redirect_request(None, None, 302, '', {}, 'http://localhost/')

    def test_unreviewed_html_candidate_requires_repair_even_if_precheck_passes(self):
        result = {'kvk_nummer': '00000001', 'telefoonnummer': ''}
        page = {'contacts': [{'kind': 'phone', 'value': '0612345678', 'href': 'tel:0612345678'}]}
        with patch.object(runner, 'result_page_evidence', return_value=[page]):
            with self.assertRaisesRegex(runner.ValidationFailure, '0612345678'):
                runner.validate_saved_result(runner.PENDING / 'candidate.json', result, [])

    def test_validation_feedback_does_not_drop_first_requirements(self):
        errors = 'first missing route\n' + 'detail\n' * 500 + 'last missing route'
        process = types.SimpleNamespace(returncode=1, stderr=errors, stdout='')
        with patch.object(runner.subprocess, 'run', return_value=process):
            with self.assertRaises(runner.ValidationFailure) as caught:
                self.cli.stop()
                try:
                    runner.run_cli('contact_agent_precheck.py', 'sample.json')
                finally:
                    self.cli.start()
        self.assertIn('first missing route', str(caught.exception))
        self.assertIn('last missing route', str(caught.exception))


class RecoveryEvidenceTests(unittest.TestCase):
    def test_recovery_reopens_only_bounded_deduplicated_urls(self):
        urls = [f'https://example.org/company/{i}' for i in range(6)]
        with patch.object(evidence, 'fetch_page', side_effect=lambda url: {'url': url, 'text': 'proof'}) as fetch:
            pages = evidence.repair_page_evidence(' '.join([urls[0] + '.', *urls]))
        self.assertEqual([p['url'] for p in pages], urls[:4])
        self.assertEqual(fetch.call_count, 4)

    def test_blocked_recovery_source_is_preserved_as_blocked_not_as_proof(self):
        with patch.object(evidence, 'require_public_url', side_effect=ValueError('Non-public address rejected')):
            pages = evidence.repair_page_evidence('http://127.0.0.1/internal')
        self.assertIn('blocked', pages[0])
        self.assertNotIn('text', pages[0])


if __name__ == '__main__':
    unittest.main()
