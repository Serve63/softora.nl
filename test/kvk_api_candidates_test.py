"""Candidate contacts survive mapping and remain unavailable for outbound use."""
import sys
import hashlib
import json
import sqlite3
import tempfile
import types
import unittest
from unittest.mock import Mock, patch as mock_patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_candidate_identity import from_answer, validate_review, verify_api_dossier
from kvk_api_validation import validate_api_evidence
from install_kvk_candidates import patch, RESEARCH_EDITS, DIRECTORY_EDITS, HANDOFF_EDITS
from kvk_directory_candidates import enrich_directory_rows
from kvk_candidate_repair import repair
from kvk_luna_searcher_test import COMPANY, answer, canonical


def candidate():
    return {'bedrijfsnaam': 'Voorbeeld', 'adres': 'Andere plaats',
            'telefoonnummer': '0612345678', 'telefoon_bron_url': 'https://gids.nl/voorbeeld',
            'email': 'info@voorbeeld.nl', 'email_bron_url': 'https://voorbeeld.nl/contact',
            'website': 'https://voorbeeld.nl/', 'bron_url': 'https://gids.nl/voorbeeld',
            'onzekerheid': 'Naam gelijk, maar adresverschil nog niet verklaard.'}


def ambiguous():
    return answer(identiteit={'bevestigd': False, 'bron_url': 'https://gids.nl/voorbeeld',
                              'uitleg': 'Mogelijke match met ander adres.'},
                  telefoonnummer='', email='', website='', mogelijke_matches=[candidate()])


class CandidateTests(unittest.TestCase):
    def test_api_dossier_handoff_accepts_only_valid_candidates_or_empty_placeholder(self):
        rows = [canonical(ambiguous())] + [dict(canonical(answer()), research_dossier=dossier)
                for dossier in ({}, {'possible_matches': []}, {'identity_status': '', 'possible_matches': []},
                                {'identity_status': 'confirmed', 'possible_matches': []})]
        for row in rows:
            self.assertTrue(verify_api_dossier(row))
            self.assertFalse(verify_api_dossier(row, required=True))
            self.assertFalse(verify_api_dossier(dict(row, validation_profile='native')))
            with self.assertRaises(ValueError):
                verify_api_dossier(dict(row, sources=[]))
        for dossier in ({'version': 1}, {'unknown': True}, [], None):
            self.assertFalse(verify_api_dossier(dict(canonical(answer()), research_dossier=dossier)))
        for dossier in ({'identity_status': 'unconfirmed', 'possible_matches': []},
                        {'identity_status': 'confirmed', 'possible_matches': [candidate()]},
                        {'possible_matches': None}, {'identity_status': 'unknown'}):
            with self.assertRaises(ValueError):
                verify_api_dossier(dict(canonical(answer()), research_dossier=dossier))
        row = canonical(ambiguous())
        with self.assertRaises(ValueError):
            verify_api_dossier(dict(row, lead_status='usable'))
        row['research_dossier']['possible_matches'][0]['telefoon_bron_url'] = ''
        with self.assertRaises(ValueError):
            verify_api_dossier(row)

    def test_handoff_installer_preserves_native_and_required_hash_validation(self):
        source = '''def verify_row(row, required=False):
    receipt = row.get('research_dossier')
    if receipt is None and not required:
        return
    if not isinstance(receipt, dict) or receipt.get('version') != 1:
        raise ValueError('hash-gekoppeld onderzoeksdossier')
    return verify_hashes(receipt)
'''
        patched = patch(source, HANDOFF_EDITS)
        self.assertEqual(patch(patched, HANDOFF_EDITS), patched)
        hashes = Mock(side_effect=ValueError('Dossier gewijzigd'))
        namespace = {'verify_hashes': hashes}
        exec(patched, namespace)
        verify = namespace['verify_row']
        verify(canonical(ambiguous()))
        verify(dict(canonical(answer()), research_dossier={}))
        hashes.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'hash-gekoppeld'):
            verify(canonical(ambiguous()), required=True)
        with self.assertRaisesRegex(ValueError, 'hash-gekoppeld'):
            verify({'research_dossier': {}})
        native = dict(canonical(answer()), research_dossier={'version': 1})
        for required in (False, True):
            with self.assertRaisesRegex(ValueError, 'Dossier gewijzigd'):
                verify(native, required=required)
        self.assertEqual(hashes.call_count, 2)
        with self.assertRaises(ValueError):
            patch(source.replace("receipt = row.get('research_dossier')", 'receipt = None'), HANDOFF_EDITS)

    def test_directory_mirrors_latest_evidence_without_filling_confirmed_contacts(self):
        connection = sqlite3.connect(':memory:')
        connection.execute('CREATE TABLE contact_research_audits (id INTEGER, kvk_nummer TEXT, route_json TEXT)')
        dossier = {'identity_status': 'unconfirmed', 'possible_matches': [candidate()]}
        connection.execute('INSERT INTO contact_research_audits VALUES (1, ?, ?)',
                           ('12345678', json.dumps({'research_dossier': dossier})))
        row = dict(kvk_nummer='12345678', unusable_reason='identity_unconfirmed',
                   lead_status='unusable', telefoonnummer='', email='', website='')
        module = types.SimpleNamespace(decode_audit_json=lambda value: value)
        with mock_patch.dict(sys.modules, {'contact_research': module}):
            result = enrich_directory_rows(connection, [row])[0]
            self.assertEqual(result['research_dossier'], dossier)
            self.assertEqual(result['telefoonnummer'], '')
            self.assertEqual(result['lead_status'], 'unusable')
            connection.execute('INSERT INTO contact_research_audits VALUES (2, ?, ?)', ('12345678', '{}'))
            self.assertEqual(enrich_directory_rows(connection, [row])[0]['research_dossier'], {})
        connection.close()

    def test_directory_does_not_resurrect_stale_candidates_after_review(self):
        row = dict(kvk_nummer='12345678', unusable_reason='', lead_status='usable',
                   telefoonnummer='0101234567', research_dossier={'stale': True})
        self.assertEqual(enrich_directory_rows(None, [row])[0]['research_dossier'], {})
        self.assertEqual(row['telefoonnummer'], '0101234567')

    def test_directory_installer_covers_full_and_incremental_and_refuses_drift(self):
        source = 'import review_classification\n\ndef full():\n    for rows in []:\n' + DIRECTORY_EDITS[1][0] + ' 0\n'
        source += '\ndef incremental():\n    for rows in []:\n' + DIRECTORY_EDITS[2][0] + " ''\n"
        updated = patch(source, DIRECTORY_EDITS)
        self.assertEqual(updated.count('payload = enrich_directory_rows('), 2)
        self.assertEqual(patch(updated, DIRECTORY_EDITS), updated)
        with self.assertRaises(ValueError):
            patch(source.replace('yield payload', 'yield []'), DIRECTORY_EDITS)

    def test_candidate_survives_without_becoming_a_confirmed_contact(self):
        result = canonical(ambiguous())
        self.assertTrue(validate_review(result))
        validate_api_evidence(result)
        self.assertEqual(result['research_dossier']['possible_matches'], [candidate()])
        self.assertEqual(result['unusable_reason'], 'identity_unconfirmed')
        self.assertEqual(result['website_status'], 'unknown')
        for key in ('telefoonnummer', 'email', 'website'):
            self.assertEqual(result[key], '')
            self.assertIn('nog niet bevestigd', result['field_evidence'][key])

    def test_unconfirmed_main_fields_are_preserved_only_as_candidates(self):
        value = answer(identiteit={'bevestigd': False, 'bron_url': 'https://gids.nl/voorbeeld', 'uitleg': 'Adres wijkt af'})
        result = canonical(value)
        self.assertEqual(result['telefoonnummer'], '')
        self.assertEqual(result['research_dossier']['possible_matches'][0]['telefoonnummer'], value['telefoonnummer'])
        self.assertTrue(validate_review(result))

    def test_legacy_found_website_with_empty_fields_preserves_uncertainty(self):
        value = ambiguous()
        del value['mogelijke_matches']
        result = canonical(value)
        self.assertTrue(validate_review(result))
        self.assertEqual(result['research_dossier']['possible_matches'][0]['telefoonnummer'], '')

    def test_no_match_is_not_relabelled_as_possible_match(self):
        value = ambiguous()
        value.update(mogelijke_matches=[], website_status='no_website')
        self.assertEqual(from_answer(COMPANY, value), [])
        self.assertEqual(canonical(value)['website_status'], 'no_website')

    def test_confirmed_identity_and_proven_exclusions_keep_their_meaning(self):
        self.assertNotIn('research_dossier', canonical(answer(mogelijke_matches=[candidate()])))
        value = ambiguous()
        value['uitsluiting'] = 'stopped'
        self.assertEqual(canonical(value)['unusable_reason'], 'stopped')

    def test_candidates_cannot_bypass_contact_and_website_guards(self):
        result = canonical(ambiguous())
        for override in ({'telefoonnummer': '0612345678'}, {'email': 'info@voorbeeld.nl'},
                         {'website': 'https://voorbeeld.nl'}, {'lead_status': 'usable'},
                         {'website_status': 'no_website'}, {'unusable_reason': 'missing_phone_and_email'}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                validate_api_evidence(dict(result, **override))
        result['research_dossier']['possible_matches'] = []
        with self.assertRaises(ValueError):
            validate_review(result)

    def test_candidate_values_require_sources_and_uncertainty(self):
        for key in ('bron_url', 'onzekerheid', 'telefoon_bron_url', 'email_bron_url'):
            value = ambiguous()
            value['mogelijke_matches'][0][key] = ''
            with self.subTest(key=key), self.assertRaises(ValueError):
                canonical(value)
        value = ambiguous()
        value['mogelijke_matches'][0]['bron_url'] = 'javascript:alert(1)'
        with self.assertRaises(ValueError):
            canonical(value)

    def test_installer_does_not_guess_after_source_drift(self):
        installed = '\n'.join(new for _, new in RESEARCH_EDITS)
        self.assertEqual(patch(installed, RESEARCH_EDITS), installed)
        with self.assertRaises(ValueError):
            patch('unrelated code', RESEARCH_EDITS)
        with self.assertRaises(ValueError):
            patch(RESEARCH_EDITS[0][1], RESEARCH_EDITS)

    def test_historical_repair_preserves_contacts_and_review_grade_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'result.json'
            source.write_text(json.dumps({'kvk_nummer': '12345678', 'conclusion_note': 'Adresverschil'}))
            source.with_suffix('.luna.json').write_text(json.dumps({'answer': ambiguous()}))
            marker = {'status': 'PRECHECK_OK', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                      'scope': {'queue_kind': 'global_initial'}, 'validated_draft': {'sha256': 'draft-hash'}}
            source.with_name(source.name + '.precheck-ok.json').write_text(json.dumps(marker))
            c = sqlite3.connect(':memory:'); c.row_factory = sqlite3.Row
            c.executescript('''
                CREATE TABLE companies(id integer, kvk_nummer text, bedrijfsnaam text, lead_status text,
                  unusable_reason text, unusable_reviewed_at text, unusable_review_grade integer,
                  telefoonnummer text, email text, website text, website_status text, updated_at text);
                CREATE TABLE company_primary(kvk_nummer text, company_id integer);
                CREATE TABLE contact_research_audits(id integer, kvk_nummer text, route_json text, conclusion_note text, created_at text);
                CREATE TABLE research_execution_attributions(kvk_nummer text, lane text, created_at text, input_sha256 text);
                INSERT INTO companies VALUES(1,'12345678','Voorbeeld','unusable','missing_phone_and_email','',1,'','','','no_website','old');
                INSERT INTO company_primary VALUES('12345678',1);
                INSERT INTO contact_research_audits VALUES(1,'12345678','{}','Adresverschil','initial-time');
                INSERT INTO research_execution_attributions VALUES('12345678','initial','initial-time','draft-hash');
            ''')
            codec = types.SimpleNamespace(decode_audit_json=lambda s: s, encode_audit_json=json.dumps,
                                          now=lambda: '2026-09-30T22:00:00+0200')
            with mock_patch.dict(sys.modules, {'contact_research': codec}):
                c.execute("UPDATE research_execution_attributions SET input_sha256='newer'")
                with self.assertRaisesRegex(ValueError, 'Laatste audit'):
                    repair(c, source, Path(folder) / 'backup.json')
                self.assertFalse((Path(folder) / 'backup.json').exists())
                c.execute("UPDATE research_execution_attributions SET input_sha256='draft-hash'")
                self.assertTrue(repair(c, source, Path(folder) / 'backup.json'))
                self.assertFalse(repair(c, source, Path(folder) / 'backup-again.json'))
            row = dict(c.execute('SELECT * FROM companies').fetchone())
            self.assertEqual((row['lead_status'], row['unusable_review_grade']), ('unusable', 1))
            self.assertEqual((row['telefoonnummer'], row['email'], row['website']), ('', '', ''))
            self.assertEqual((row['unusable_reason'], row['website_status']), ('identity_unconfirmed', 'unknown'))
            self.assertEqual(row['updated_at'], '2026-09-30T22:00:00+0200')
            audit = json.loads(c.execute('SELECT route_json FROM contact_research_audits').fetchone()[0])
            self.assertEqual(audit['research_dossier']['possible_matches'], [candidate()])
            self.assertEqual(json.loads((Path(folder) / 'backup.json').read_text())['company']['website_status'], 'no_website')
            c.close()


if __name__ == '__main__':
    unittest.main()
