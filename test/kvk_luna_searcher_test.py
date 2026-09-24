"""Offline Luna Searcher checks. Never calls OpenAI, fetches pages or touches the database."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_luna_searcher import phone_digits, phone_on_page, to_canonical

COMPANY = {'kvk_nummer': '12345678', 'bedrijfsnaam': 'Voorbeeld B.V.'}
PAGES = {
    'https://voorbeeld.nl/': '<footer>Voorbeeld</footer>',
    'https://voorbeeld.nl/contact': '<p>Tel: +31 (0)13 533 1678</p><a href="mailto:info@voorbeeld.nl">mail</a>',
    'https://gids.nl/voorbeeld': 'Voorbeeld 06-12345678 post@voorbeeld-mail.nl',
}


def answer(**overrides):
    base = {
        'kvk_nummer': '12345678',
        'identiteit': {'bevestigd': True, 'bron_url': 'https://gids.nl/voorbeeld', 'uitleg': 'Naam en adres komen overeen.'},
        'telefoonnummer': '013 533 1678', 'telefoon_bron_url': 'https://voorbeeld.nl/contact',
        'email': 'info@voorbeeld.nl', 'email_bron_url': 'https://voorbeeld.nl/contact',
        'website': 'https://voorbeeld.nl/', 'website_status': 'found',
        'operational_status': 'operational', 'entity_role': 'specific', 'source_quality': 'official',
        'zoekopdrachten': ['"12345678"'], 'bronnen': [{'url': 'https://voorbeeld.nl/contact', 'wat_gezien': 'tel en mail'}],
        'conclusie': 'Eigen site.',
    }
    base.update(overrides)
    return base


def canonical(value, consulted=()):
    return to_canonical(COMPANY, value, list(consulted), PAGES.get)


class LunaSearcherTests(unittest.TestCase):
    def test_contacts_on_the_cited_page_make_a_usable_lead(self):
        result = canonical(answer())
        self.assertEqual(result['lead_status'], 'usable')
        self.assertEqual(result['website_status'], 'found')
        self.assertIn('https://voorbeeld.nl/contact', result['field_evidence']['telefoonnummer'])
        self.assertTrue(result['checks_completed'])

    def test_contact_missing_from_the_cited_page_is_dropped_not_rebought(self):
        result = canonical(answer(telefoonnummer='020 123 4567'))
        self.assertEqual(result['telefoonnummer'], '')
        self.assertEqual(result['lead_status'], 'unusable')
        self.assertIn('niet gevonden', result['conclusion_note'])

    def test_unreadable_page_counts_only_when_luna_actually_retrieved_it(self):
        value = answer(email_bron_url='https://geblokkeerd.nl/contact')
        self.assertEqual(canonical(value)['email'], '')
        self.assertEqual(canonical(value, ['https://www.geblokkeerd.nl/contact/'])['email'], 'info@voorbeeld.nl')

    def test_lead_without_website_stays_usable(self):
        result = canonical(answer(website='', website_status='no_website', telefoonnummer='06-12345678',
                                  telefoon_bron_url='https://gids.nl/voorbeeld', email='post@voorbeeld-mail.nl',
                                  email_bron_url='https://gids.nl/voorbeeld', source_quality='supported'),
                           ['https://gids.nl/voorbeeld', 'https://a.nl/1', 'https://b.nl/2'])
        self.assertEqual(result['lead_status'], 'usable')
        self.assertEqual(result['website_status'], 'no_website')
        self.assertGreaterEqual(len(result['sources']), 3)

    def test_unreachable_own_domain_is_not_working(self):
        self.assertEqual(canonical(answer(website='oud-domein.nl'))['website_status'], 'not_working')

    def test_unconfirmed_identity_and_holdings_are_never_usable(self):
        self.assertEqual(canonical(answer(identiteit={'bevestigd': False}))['lead_status'], 'unusable')
        holding = canonical(answer(entity_role='parent_or_holding'))
        self.assertEqual((holding['lead_status'], holding['unusable_reason']), ('unusable', 'non_specific_entity'))

    def test_answer_for_another_company_is_rejected(self):
        with self.assertRaises(ValueError):
            canonical(answer(kvk_nummer='87654321'))

    def test_dutch_phone_notations_match(self):
        for value in ('+31 (0)13 533 1678', '0031135331678', '+31135331678', '013-533 16 78'):
            self.assertEqual(phone_digits(value), '0135331678')
        self.assertTrue(phone_on_page('06-12345678', 'Tel 013 533 1678 06 12345678'))
        self.assertFalse(phone_on_page('020 123 4567', 'Tel 013 533 1678'))


if __name__ == '__main__':
    unittest.main()
