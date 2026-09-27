"""Offline runner checks. Never calls OpenAI or touches the company database."""
import importlib.util
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
        self.real_instructions_for = runner.instructions_for
        self.codex = [patch.object(runner, 'codex_run', side_effect=AssertionError('echte Codex-run in een test')),
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

    def run_pipeline(self, companies, count, research_delay):
        queue = [dict(company) for company in companies]
        researched, applied, running, peak = [], [], [0], [0]
        lock = threading.Lock()

        def call(path, payload, **kwargs):
            if path == '/poll':
                return {'state': {'workers': {'searcher': {'enabled': bool(queue), 'count': count}}}}
            if path == '/research':
                with lock:
                    running[0] += 1
                    peak[0] = max(peak[0], running[0])
                    researched.append(payload['company']['kvk_nummer'])
                time.sleep(research_delay(payload['company']['kvk_nummer']))
                with lock:
                    running[0] -= 1
                return {'ok': True, 'result': payload['company']}
            return {'ok': True}

        def next_packet(role, limit):
            self.queue_reads = getattr(self, 'queue_reads', 0) + 1
            return ({'bedrijven': queue[:limit]}, []) if queue else None

        def apply(path, flags, apply_lock, role, **kwargs):
            kvk = queue[0]['kvk_nummer']
            self.assertIn(kvk, path.name)  # only ever the current queue head
            applied.append(queue.pop(0)['kvk_nummer'])
            path.unlink()
            return True

        original_wait = runner.wait
        with patch.object(runner, 'call', side_effect=call), patch.object(runner, 'next_packet', side_effect=next_packet), \
                patch.object(runner, 'apply_result', side_effect=apply), patch.object(runner, 'report'), \
                patch.object(kvk_luna_searcher, 'to_canonical', side_effect=lambda company, *_: company), \
                patch.object(runner, 'wait', side_effect=lambda futures, **kw: original_wait(futures, timeout=0.05, return_when=runner.FIRST_COMPLETED)):
            runner.run_searcher_pipeline(threading.Lock())
        return researched, applied, peak[0]

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
            self.assertIn('gpt-6-luna', command)
            self.assertTrue(kwargs['input'].startswith('INSTRUCTIES'))
            self.assertIn('"kvk_nummer": "00000001"', kwargs['input'])
            Path(command[command.index('-o') + 1]).write_text('Antwoord: {"kvk_nummer":"00000001"}')
            return types.SimpleNamespace(returncode=0, stdout=events, stderr='')
        with patch.object(runner.subprocess, 'run', side_effect=run), patch.object(runner, 'codex_run', self.real_codex_run), \
                patch.object(runner, 'codex_research', self.real_codex_research):
            answer, urls = runner.codex_research({'kvk_nummer': '00000001'}, 'INSTRUCTIES')
        self.assertEqual((answer, urls), ({'kvk_nummer': '00000001'}, ['https://voorbeeld.nl/contact']))

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
        self.assertEqual(runner.json.loads(path.with_suffix('.engine.json').read_text()), {'engine': 'codex'})

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

    def test_a_contact_the_controller_only_mentions_is_recorded_as_rejected_next_to_its_own(self):
        result = {'kvk_nummer': '84043784', 'telefoonnummer': '', 'email': '',
                  'conclusion_note': 'Het eerder genoemde telefoonnummer 06-57201895 hoort bij een andere vestiging.',
                  'field_evidence': {'telefoonnummer': ''}, 'route_notes': {'identity': {'status': 'checked', 'notes': 'KVK 84043784'}},
                  'sources': [{'url': 'https://companyinfo.nl/kapsalon', 'note': 'KVK 84043784'}],
                  'contact_rejections': {'email': [{'value': 'mail@rokven.io', 'reason_code': 'technical_contact'}]}}
        runner.record_mentioned_contacts(result, {'kvk_nummer': '84043784', 'vestigingsnummer': '000050183036'})
        self.assertNotIn('06-57201895', result['conclusion_note'])
        self.assertEqual([item['value'] for item in result['contact_rejections']['telefoonnummer']], ['06-57201895'])
        self.assertEqual(result['contact_rejections']['email'][0]['reason_code'], 'technical_contact')
        self.assertIn('KVK 84043784', result['route_notes']['identity']['notes'])  # identifiers are not scrubbed

    def test_an_empty_contact_set_gets_opened_register_pages_that_show_this_kvk(self):
        company = {'kvk_nummer': '68961375', 'bedrijfsnaam': 'R. Kuijpers Beheer B.V.', 'adres': 'Kerkstraat 1, Berkel-Enschot'}
        opened = []
        def fetch(url):
            opened.append(url)
            return '<p>KVK 68961375</p>' if 'liza' in url or 'bedrijvenregister' in url else None
        sources = kvk_luna_searcher.registry_sources(company, [{'url': 'https://www.kvk.nl/bestellen/#/bedrijf/68961375/'}], fetch)
        self.assertEqual([source['url'] for source in sources], [
            'https://www.liza.nl/nl/68961375', 'https://www.bedrijvenregister.nl/berkel-enschot/r-kuijpers-beheer-bv'])
        # A page that does not show this exact KVK number is never added.
        self.assertEqual(kvk_luna_searcher.registry_sources(company, [], lambda url: 'KVK 12345678'), [])
        # Enough opened pages already: nothing extra is fetched.
        opened.clear()
        enough = [{'url': f'https://bron{i}.nl/bedrijf'} for i in range(3)]
        self.assertEqual(kvk_luna_searcher.registry_sources(company, enough, fetch), [])
        self.assertEqual(opened, [])

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


if __name__ == '__main__':
    unittest.main()
