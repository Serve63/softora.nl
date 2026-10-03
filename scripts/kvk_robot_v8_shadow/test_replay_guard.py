"""The isolated runner must refuse remote work and arbitrary child processes."""
import sys
import json
import os
import sqlite3
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import replay


class OfflineGuardTests(unittest.TestCase):
    def setUp(self):
        replay.NETWORK_ATTEMPTS.clear()

    def test_socket_and_process_events_are_blocked(self):
        cases = [
            ("socket.connect", (None, ("127.0.0.1", 9))),
            ("socket.getaddrinfo", ("example.org", 443, 0, 0, 0)),
            ("subprocess.Popen", ("codex", ["codex", "exec", "test"], None, None)),
            ("os.system", (b"true",)),
        ]
        for event, args in cases:
            with self.subTest(event=event), self.assertRaises(RuntimeError):
                replay.offline_guard(event, args)
        self.assertEqual(4, len(replay.NETWORK_ATTEMPTS))

    def test_only_exact_existing_pdf_worker_is_allowed(self):
        args = [sys.executable, "-I", str(replay.ROOT / "scripts" / "screen_v2_pdf.py"), "--worker"]
        replay.offline_guard("subprocess.Popen", (sys.executable, args, None, None))
        self.assertEqual([], replay.NETWORK_ATTEMPTS)
        with self.assertRaises(RuntimeError):
            replay.offline_guard("subprocess.Popen", ("/bin/sh", args, None, None))
        for changed in [args + ["other"], [*args[:2], "/tmp/other.py", "--worker"]]:
            with self.assertRaises(RuntimeError):
                replay.offline_guard("subprocess.Popen", (sys.executable, changed, None, None))

    def test_output_inside_source_is_refused_before_loading_engine(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            source = root / "data" / "shadow" / "source"
            output = source / "nested" / "result.json"
            with patch.object(replay, "ROOT", root), patch.object(sys, "argv", ["replay.py", str(source), str(output)]), patch.object(replay, "replay") as engine:
                with self.assertRaises(ValueError):
                    replay.main()
                engine.assert_not_called()

    def test_pipeline_uses_readonly_copy_and_disables_models_before_import(self):
        # Tiny synthetic evidence tests isolation; it is never a research dataset.
        with tempfile.TemporaryDirectory() as scratch:
            source = Path(scratch)
            (source / "discovery.json").write_text(json.dumps({"results": []}))
            with sqlite3.connect(source / "evidence.sqlite") as db:
                db.execute("CREATE TABLE entity_results (run_id TEXT)")
                db.execute("INSERT INTO entity_results VALUES ('fixture-run')")
            original = (source / "evidence.sqlite").read_bytes()
            def candidates(connection, run_id, discovery):
                self.assertEqual("fixture-run", run_id)
                for name in ("ROBOT_AI_JUDGE", "ROBOT_AI_ASSIST", "ROBOT_AI_SITE_FINDER"):
                    self.assertEqual("0", os.environ[name])
                self.assertEqual(1, connection.execute("PRAGMA query_only").fetchone()[0])
                with self.assertRaises(sqlite3.OperationalError):
                    connection.execute("DELETE FROM entity_results")
                return {}
            modules = {
                "v7_runtime_patches": types.ModuleType("v7_runtime_patches"),
                "bridge_verify": types.SimpleNamespace(bridge_candidates=candidates),
                "terminal_decision": types.SimpleNamespace(terminalize=lambda *args: {"counts": {}}),
            }
            with patch.dict(sys.modules, modules):
                result, audit = replay.replay(source)
            self.assertEqual({"counts": {}}, result)
            self.assertEqual(0, audit["network_attempts"])
            self.assertEqual(0, audit["model_calls"])
            self.assertEqual(0, audit["production_writes"])
            self.assertEqual(original, (source / "evidence.sqlite").read_bytes())


if __name__ == "__main__":
    unittest.main()
