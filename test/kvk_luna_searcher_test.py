"""Offline Luna Searcher checks. Never calls OpenAI, fetches pages or touches the database."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_luna_searcher import phone_digits, phone_on_page, structured_contacts, to_canonical

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

    def test_mentioned_but_unkept_contacts_are_recorded_as_rejected(self):
        result = canonical(answer(entity_role='parent_or_holding', telefoonnummer='020 123 4567',
                                  conclusie='Holding. Nummer (013) 533 39 63 en post@andere.nl horen bij een ander bedrijf.'))
        self.assertEqual(result['telefoonnummer'], '')
        rejected = {field: [item['value'] for item in items] for field, items in result['contact_rejections'].items()}
        self.assertIn('post@andere.nl', rejected['email'])
        self.assertEqual(len(rejected['telefoonnummer']), 2)
        self.assertNotIn('533 39 63', result['conclusion_note'])
        self.assertNotIn('020 123 4567', result['conclusion_note'])
        self.assertTrue(all(item['reason_code'] == 'unverified_candidate' and item['url']
                            for items in result['contact_rejections'].values() for item in items))

    def test_kept_contacts_urls_and_kvk_are_left_intact(self):
        result = canonical(answer(conclusie='Bel 013 533 1678 of mail info@voorbeeld.nl; KVK 12345678.'))
        self.assertEqual(result['contact_rejections'], {'telefoonnummer': [], 'email': []})
        self.assertIn('013 533 1678', result['conclusion_note'])
        self.assertIn('https://voorbeeld.nl/contact', result['field_evidence']['telefoonnummer'])

    def test_field_urls_stay_exact_next_to_www_variants(self):
        result = canonical(answer(website='voorbeeld.nl', bronnen=[{'url': 'https://www.voorbeeld.nl/', 'wat_gezien': 'site'}]))
        urls = [source['url'] for source in result['sources']]
        self.assertIn(result['website'], urls)
        self.assertIn(result['website'], result['field_evidence']['website'])

    def test_opened_search_pages_count_as_recorded_checks_after_concrete_pages(self):
        result = canonical(answer(website='', website_status='no_website', telefoonnummer='', email='',
                                  identiteit={'bevestigd': False}, bronnen=[
                                      {'url': 'https://www.kvk.nl/zoeken/?q=Voorbeeld', 'wat_gezien': 'geen treffer'},
                                      {'url': 'https://gids.nl/voorbeeld', 'wat_gezien': 'adres'},
                                      {'url': 'https://voorbeeld.nl/', 'wat_gezien': 'geparkeerd'}]))
        self.assertEqual([source['label'] for source in result['sources']], ['Bron', 'Bron', 'Zoekpagina'])

    def test_each_page_is_fetched_once_even_when_cited_twice(self):
        fetched = []
        def fetch(url):
            fetched.append(url)
            return PAGES.get(url)
        result = to_canonical(COMPANY, answer(), [], fetch)
        self.assertEqual(result['lead_status'], 'usable')
        self.assertEqual(sorted(fetched), ['https://voorbeeld.nl/', 'https://voorbeeld.nl/contact'])

    def test_hidden_directory_number_is_taken_from_this_companys_structured_data(self):
        page = ('<a href="tel:+31135111966">andere praktijk</a><script type="application/ld&#x2B;json">'
                '{"@type":"Physiotherapy","name":"Voorbeeld","telephone":"\\u002B31620703059",'
                '"identifier":{"@type":"PropertyValue","name":"KVK","value":"12345678"}}</script>'
                '<script type="application/ld+json">{"@type":"LocalBusiness","name":"Buurman","telephone":"0131234567"}</script>')
        pages = dict(PAGES, **{'https://gids.nl/voorbeeld': page})
        result = to_canonical(COMPANY, answer(website='', website_status='no_website', telefoonnummer='',
                                              email='post@voorbeeld-mail.nl', source_quality='supported',
                                              email_bron_url='https://gids.nl/voorbeeld'), [], pages.get)
        self.assertEqual(result['telefoonnummer'], '+31620703059')
        self.assertIn('gestructureerde bedrijfsgegevens', result['field_evidence']['telefoonnummer'])
        self.assertIn('https://gids.nl/voorbeeld', [source['url'] for source in result['sources']])

    def test_structured_data_of_another_or_ambiguous_company_is_ignored(self):
        other_kvk = '<script type="application/ld+json">{"name":"Voorbeeld","telephone":"0612345678","identifier":{"name":"KVK","value":"87654321"}}</script>'
        self.assertEqual(structured_contacts(other_kvk, 'Voorbeeld B.V.', '12345678'), {})
        other_name = '<script type="application/ld+json">{"name":"Buurman Schilders","telephone":"0612345678"}</script>'
        self.assertEqual(structured_contacts(other_name, 'Voorbeeld B.V.', '12345678'), {})
        conflict = ('<script type="application/ld+json">[{"name":"Voorbeeld","telephone":"0612345678"},'
                    '{"name":"Voorbeeld BV","telephone":"0687654321"}]</script>')
        self.assertEqual(structured_contacts(conflict, 'Voorbeeld B.V.', '12345678'), {})
        same = '<script type="application/ld+json">{"name":"Voorbeeld","email":"mailto:info@voorbeeld.nl"}</script>'
        self.assertEqual(structured_contacts(same, 'Voorbeeld B.V.', '12345678'), {'e-mail': 'info@voorbeeld.nl'})

    def test_dutch_phone_notations_match(self):
        for value in ('+31 (0)13 533 1678', '0031135331678', '+31135331678', '013-533 16 78'):
            self.assertEqual(phone_digits(value), '0135331678')
        self.assertTrue(phone_on_page('06-12345678', 'Tel 013 533 1678 06 12345678'))
        self.assertFalse(phone_on_page('020 123 4567', 'Tel 013 533 1678'))


if __name__ == '__main__':
    unittest.main()
