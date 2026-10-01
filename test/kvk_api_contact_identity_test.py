"""Rejected contacts match complete identities, never coincidental digit suffixes."""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from kvk_api_validation import phone_identity
from install_kvk_contact_identity import patched_source

SOURCE = '''
def meaningful_phone_hits(text):
    # Social profile IDs, KVK slugs and encoded query parameters are not phone
    return re.findall(r"(?<!\\d)0\\d{9}(?!\\d)", text)

def _structured_rejected_values(result, kvk_nummer, field):
    rejections = result['contact_rejections']
    if field == "telefoonnummer":
        return {re.sub(r"\\D+", "", item["value"]) for item in rejections[field]}
    return set()

def require_not_dropped(result, hits):
    rejected_phones = _structured_rejected_values(result, '', 'telefoonnummer')
    if not result.get('telefoonnummer'):
        for hit in hits:
            digits = re.sub(r"\\D+", "", hit)
            if digits in rejected_phones:
                continue
            raise ValueError('Contact not rejected')
'''


class PhoneIdentityTests(unittest.TestCase):
    def test_only_complete_dutch_numbers_are_equivalent(self):
        for number in ('0612345678', '06 1234 5678', '+31 6 1234 5678',
                       '0031 6 1234 5678', '+31 (0)6 1234 5678', '0031 (0)6 1234 5678'):
            self.assertEqual(phone_identity(number), '0612345678')
        for number in ('612345678', '+32 6 1234 5678', '+31 6 1234 5679', '+31 6 1234'):
            self.assertNotEqual(phone_identity(number), '0612345678')

    def test_installed_gate_accepts_rejected_format_variants_but_still_blocks_other_contacts(self):
        namespace = {'re': re}
        exec(patched_source(SOURCE), namespace)
        result = {'contact_rejections': {'telefoonnummer': [{'value': '+31411604184'}]}}
        namespace['require_not_dropped'](result, ['0411-604184', '0031 411 604184'])
        with self.assertRaises(ValueError):
            namespace['require_not_dropped'](result, ['0411-604185'])
        with self.assertRaises(ValueError):
            namespace['require_not_dropped'](result, ['411604184'])

    def test_registry_reference_is_not_a_phone_but_real_unreviewed_numbers_remain(self):
        namespace = {'re': re}
        exec(patched_source(SOURCE), namespace)
        self.assertEqual(namespace['meaningful_phone_hits']('Andere entiteit BE0761790983; telefoon 0612345678'), ['0612345678'])

    def test_installer_is_idempotent_and_refuses_partial_or_drifted_sources(self):
        installed = patched_source(SOURCE)
        self.assertEqual(patched_source(installed), installed)
        with self.assertRaisesRegex(ValueError, 'Onvolledige'):
            patched_source(installed.replace('if phone_identity(hit) in rejected_phones:', 'if digits in rejected_phones:'))
        with self.assertRaisesRegex(ValueError, 'geen installatie'):
            patched_source(SOURCE.replace('if digits in rejected_phones:', 'if hit in rejected_phones:'))


if __name__ == '__main__':
    unittest.main()
