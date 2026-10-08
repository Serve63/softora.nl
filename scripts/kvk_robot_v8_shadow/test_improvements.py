"""Identity adversaries, using the real v7 normalizers and local-value gate."""
import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path.home() / "Documents" / "Database"
os.environ.update(ROBOT_AI_JUDGE="0", ROBOT_AI_ASSIST="0", ROBOT_AI_SITE_FINDER="0")
sys.path[:0] = [str(HERE), str(ROOT / "experiments/robot-v7-limit-20260930"), str(ROOT / "scripts")]
import bridge_verify as bridge
from improvements import safe_cross_source_profile_hosts

COMPANY = {"kvk_nummer": "12345678", "bedrijfsnaam": "A. van den Testberg", "adres": "Voorbeeldstraat, Proefstad"}
EMAIL = "info@praktijk-test.nl"
PHONE = "0649278153"
IDENTITY = "A. van den Testberg KVK: 12345678 Voorbeeldstraat 8 Proefstad"


def page(host, text, email=EMAIL, phone=PHONE):
    return {
        "final_url": "https://" + host + "/contact/", "requested_url": "https://" + host + "/contact/",
        "visible_text": text, "http_status": 200, "tls_verified": True,
        "truncated": False, "blocked": False, "error": "", "body_sha256": "a" * 64,
        "fetched_at": "2026-10-03T10:00:00Z", "source_layer": "screen_v2", "capture_method": "http",
        "signals": {"emails": [email] if email else [], "phones": [phone] if phone else []},
    }


def contacts(email=EMAIL, phone=PHONE):
    return f" E-mail: {email} Tel: {phone}"


class ProfileIdentityTests(unittest.TestCase):
    def evaluate(self, sources, own=None):
        pages = [own or page("praktijk.example", "Contact" + contacts()),
                 page("register.example", IDENTITY, email="", phone=""), *sources]
        return safe_cross_source_profile_hosts(bridge, COMPANY, {}, pages)

    def test_two_exact_kvk_profiles_accept(self):
        sources = [page(host, IDENTITY + contacts()) for host in ("gids.nl", "beroepsregister.nl")]
        self.assertIn("praktijk.example", self.evaluate(sources))

    def test_two_exact_name_address_profiles_accept(self):
        text = "A. van den Testberg Voorbeeldstraat 8 Proefstad" + contacts()
        self.assertIn("praktijk.example", self.evaluate([page("gids.nl", text), page("register.nl", text)]))

    def test_shared_surname_is_not_identity(self):
        text = "Van den Testberg Groep Andereweg 1 Andersstad" + contacts()
        self.assertEqual(set(), self.evaluate([page("groep.nl", text), page("werkenbijgroep.nl", text)]))

    def test_foreign_kvk_with_exact_name_cannot_support(self):
        text = IDENTITY.replace("12345678", "87654321") + contacts()
        self.assertEqual(set(), self.evaluate([page("gids.nl", text), page("register.nl", text)]))

    def test_other_address_cannot_support(self):
        text = "A. van den Testberg Andereweg 1 Andersstad" + contacts()
        self.assertEqual(set(), self.evaluate([page("gids.nl", text), page("register.nl", text)]))

    def test_subdomains_count_once(self):
        self.assertEqual(set(), self.evaluate([page("a.gids.nl", IDENTITY + contacts()), page("b.gids.nl", IDENTITY + contacts())]))

    def test_candidate_root_cannot_support_itself(self):
        self.assertEqual(set(), self.evaluate([page("a.praktijk.example", IDENTITY + contacts()), page("gids.nl", IDENTITY + contacts())]))

    def test_contacts_in_distant_footer_cannot_support(self):
        text = IDENTITY + " willekeurige tekst" * 150 + contacts()
        self.assertEqual(set(), self.evaluate([page("gids.nl", text), page("register.nl", text)]))

    def test_neighbouring_foreign_entity_cannot_donate(self):
        text = IDENTITY + " " + " opvulling" * 45 + " Andere onderneming KVK 87654321" + contacts()
        self.assertEqual(set(), self.evaluate([page("gids.nl", text), page("register.nl", text)]))

    def test_same_contact_pair_must_have_two_sources(self):
        second_phone = "0679428513"
        own = page("praktijk.example", "Contact" + contacts() + contacts(phone=second_phone))
        own["signals"]["phones"].append(second_phone)
        sources = [page("gids.nl", IDENTITY + contacts()), page("register.nl", IDENTITY + contacts(phone=second_phone), phone=second_phone)]
        self.assertEqual(set(), self.evaluate(sources, own))

    def test_unreadable_profile_cannot_support(self):
        blocked = page("gids.nl", IDENTITY + contacts()); blocked["blocked"] = True
        self.assertEqual(set(), self.evaluate([blocked, page("register.nl", IDENTITY + contacts())]))

    def test_candidate_with_foreign_kvk_is_rejected(self):
        own = page("praktijk.example", "Andere onderneming KVK: 87654321" + contacts())
        self.assertNotIn("praktijk.example", self.evaluate([page("gids.nl", IDENTITY + contacts()), page("register.nl", IDENTITY + contacts())], own))


if __name__ == "__main__":
    unittest.main()
