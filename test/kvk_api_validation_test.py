"""Offline regression coverage for basic evidence and the runtime migration."""
import copy
import sys
import unittest
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_api_validation import validate_api_evidence
from install_kvk_api_validation import EDITS, patched_source
from kvk_api_attribution import activity_labels, execution_for


def negative():
    url = 'https://example.nl/bedrijven/voorbeeld'
    return {
        'kvk_nummer': '12345678', 'telefoonnummer': '', 'email': '',
        'website': '', 'website_status': 'no_website',
        'sources': [{'url': url, 'note': 'Exacte naam en adres voor KVK 12345678.'}],
        'field_evidence': {'telefoonnummer': 'Niet openbaar leesbaar.', 'email': 'Niet openbaar leesbaar.'},
        'research_route': {
            'identity': {'status': 'checked', 'notes': 'De pagina bevestigt 12345678.', 'urls': [url]},
            'entity_match': {'status': 'checked', 'notes': 'Naam en volledig adres komen overeen.'},
            'final_crosscheck': {'status': 'checked', 'notes': 'Geen onbewezen contacten overgenomen.'},
            'search_engine': {'status': 'checked', 'notes': 'Eerst gezocht op "12345678" telefoon email en daarna exacte naam en adres.'},
            'directories': {'status': 'checked', 'notes': 'De geopende bedrijfsdetails schermen de contacten af.'},
            'website_basic': {'status': 'blocked', 'notes': 'De gevonden domeinhint gaf een toolfout, bestaan onbekend.'},
        },
    }


class ApiValidationTests(unittest.TestCase):
    def test_negative_result_with_opened_source_is_accepted(self):
        validate_api_evidence(negative())

    def test_research_ladder_routes_are_no_longer_required(self):
        row = negative()
        row['research_route'] = {}
        validate_api_evidence(row)

    def test_sources_need_url_and_note(self):
        for source in ({'url': 'ftp://example.nl', 'note': 'x'}, {'url': 'https://example.nl', 'note': ''}):
            row = negative()
            row['sources'] = [source]
            with self.subTest(source=source), self.assertRaises(ValueError):
                validate_api_evidence(row)

    def test_invalid_kvk_is_not_accepted(self):
        row = negative()
        row['kvk_nummer'] = '1234'
        with self.assertRaisesRegex(ValueError, 'doel-KVK'):
            validate_api_evidence(row)

    def test_filled_fields_need_exact_source_reference(self):
        row = negative()
        row.update(telefoonnummer='0612345678', email='info@example.nl', website='https://example.nl/')
        for field in ('telefoonnummer', 'email', 'website'):
            row['field_evidence'][field] = row['sources'][0]['url'] + ': contact letterlijk gezien.'
        validate_api_evidence(row)
        for field in ('telefoonnummer', 'email', 'website'):
            invalid = copy.deepcopy(row)
            invalid['field_evidence'][field] = 'Ik denk dat dit klopt.'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, field):
                validate_api_evidence(invalid)

    def test_installer_fails_closed_on_partial_install_or_source_drift(self):
        with self.assertRaisesRegex(ValueError, 'zonder wijzigingen'):
            patched_source('unrelated source')
        with self.assertRaisesRegex(ValueError, 'Onvolledige'):
            patched_source(EDITS[0][1])

    def test_installer_is_idempotent_and_preserves_native_branch(self):
        installed = '\n'.join(new for _, new in EDITS)
        self.assertEqual(patched_source(installed), installed)
        self.assertIn('and not api_basic', installed)
        self.assertIn('validate_api_evidence(result)', installed)
        self.assertIn('if profile not in (None, PROFILE)', installed)

    def test_roles_follow_actual_producer_without_invented_model_fallback(self):
        self.assertEqual(activity_labels(False, 'searcher_api_sol_max', 'Sol 6 Max'), ('Searcher', 'Sol 6 Max'))
        self.assertEqual(activity_labels(False, 'searcher_luna_max', None), ('Searcher', ''))
        self.assertEqual(activity_labels(False, 'searcher_robot', 'Sol 5.6 Xhigh'), ('Robot', ''))
        self.assertEqual(activity_labels(True, 'controller_api_sol_max', 'Sol 6 Max'), ('Controleur', 'Sol 6 Max'))
        self.assertEqual(activity_labels(False, None, None), ('Onbekend', ''))

    def test_api_attribution_is_durable_and_separate_from_native_workers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'result.json'
            path.write_text('{}')
            for review, role in ((False, 'searcher'), (True, 'controller')):
                result = execution_for([{'validation_profile': 'api-basic-v1'}], path, review)
                self.assertEqual(result['model_role'], role + '_luna_max')
                self.assertEqual(result['producer_thread_id'], 'api:' + role)
                self.assertEqual(result['model'], 'gpt-6-luna')
                self.assertEqual(result['display_label'], 'Luna 6 Max')
                self.assertEqual(len(result['input_sha256']), 64)
            self.assertIsNone(execution_for([{}], path))
            with self.assertRaises(ValueError):
                execution_for([{}, {'validation_profile': 'api-basic-v1'}], path)


if __name__ == '__main__':
    unittest.main()
