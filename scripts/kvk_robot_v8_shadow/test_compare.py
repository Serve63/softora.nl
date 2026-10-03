"""Comparisons must fail on missing cases or changed evidence, never hide them."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from compare import compare


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name)
        self.truth = [
            {"kvk_nummer": "12345678", "lead_status": "usable", "email": "info@fixture.nl", "telefoonnummer": "0649278153"},
            {"kvk_nummer": "87654321", "lead_status": "unusable"},
        ]
        self.baseline = {"results": [
            {"kvk_nummer": "12345678", "decision": "technical_retry"},
            {"kvk_nummer": "87654321", "decision": "holding"},
        ], "audit": {"source_sha256": {"fixture": "a" * 64}, "network_attempts": 0,
                     "model_calls": 0, "production_writes": 0, "wall_seconds": 1.0,
                     "code_sha256": {"/fixture/bridge.py": "b" * 64}}}
        self.candidate = copy.deepcopy(self.baseline)
        self.candidate["results"][0].update(lead_status="usable", decision="usable",
            email="info@fixture.nl", phone="+31 6 49278153")

    def tearDown(self):
        self.scratch.cleanup()

    def evaluate(self):
        paths = []
        for name, data in (("truth", self.truth), ("baseline", self.baseline), ("candidate", self.candidate)):
            path = self.root / (name + ".json")
            path.write_text(json.dumps(data))
            paths.append(path)
        return compare(*paths)

    def test_known_gain_and_phone_format_agreement(self):
        result = self.evaluate()
        self.assertEqual(0, result["baseline"]["found"])
        self.assertEqual(1, result["candidate"]["found"])
        self.assertEqual(1, result["candidate"]["contact_both_exact"])
        self.assertEqual(0, result["candidate"]["false_usable"])
        self.assertEqual(1, result["changes"]["gained_usable"])

    def test_missing_or_duplicate_cases_are_refused(self):
        self.candidate["results"].pop()
        with self.assertRaises(ValueError):
            self.evaluate()
        self.candidate = copy.deepcopy(self.baseline)
        self.candidate["results"].append(self.candidate["results"][0])
        with self.assertRaises(ValueError):
            self.evaluate()

    def test_changed_capture_or_engine_is_refused(self):
        for field in ("source_sha256", "code_sha256"):
            with self.subTest(field=field):
                self.candidate = copy.deepcopy(self.baseline)
                key = next(iter(self.candidate["audit"][field]))
                self.candidate["audit"][field][key] = "c" * 64
                with self.assertRaises(ValueError):
                    self.evaluate()

    def test_external_activity_in_audit_is_refused(self):
        for field in ("network_attempts", "model_calls", "production_writes"):
            with self.subTest(field=field):
                self.candidate = copy.deepcopy(self.baseline)
                self.candidate["audit"][field] = 1
                with self.assertRaises(ValueError):
                    self.evaluate()


if __name__ == "__main__":
    unittest.main()
