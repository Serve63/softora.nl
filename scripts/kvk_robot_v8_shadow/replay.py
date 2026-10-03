#!/usr/bin/env python3
"""Compare robot decisions on frozen evidence with network/model calls blocked."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path
from shadow_paths import ROOT, source_directory, shadow_file

HERE = Path(__file__).resolve().parent
V7 = ROOT / "experiments" / "robot-v7-limit-20260930"
NETWORK_ATTEMPTS = []


def offline_guard(event, arguments):
    if event == "subprocess.Popen":
        # The existing bounded PDF decoder is local, deterministic, and needs
        # a resource-limited child. No arbitrary command/model process is allowed.
        permitted = [sys.executable, "-I", str(ROOT / "scripts" / "screen_v2_pdf.py"), "--worker"]
        if arguments[0] == sys.executable and list(arguments[1]) == permitted:
            return
    if event in {"socket.connect", "socket.getaddrinfo", "subprocess.Popen", "os.system"}:
        NETWORK_ATTEMPTS.append(event)
        raise RuntimeError("Offline replay forbids network and subprocess calls")


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def replay(source, candidate=False):
    # Set before loading v7: its judge defaults to enabled, even in old replays.
    os.environ.update(ROBOT_AI_JUDGE="0", ROBOT_AI_ASSIST="0", ROBOT_AI_SITE_FINDER="0")
    sys.addaudithook(offline_guard)
    sys.path[0:0] = [str(HERE), str(V7), str(ROOT / "scripts")]
    import v7_runtime_patches  # noqa: F401
    import bridge_verify as bridge
    import terminal_decision as terminal
    if candidate:
        import improvements
        improvements.install(bridge, terminal)

    artifacts = [source / "discovery.json"] + [
        source / ("evidence.sqlite" + suffix) for suffix in ("", "-wal", "-shm")
        if (source / ("evidence.sqlite" + suffix)).exists()
    ]
    before = {str(path): checksum(path) for path in artifacts}
    code_artifacts = {Path(__file__).resolve()}
    for module in tuple(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if filename:
            path = Path(filename).resolve()
            if path.suffix == ".py" and (path.is_relative_to(ROOT) or path.is_relative_to(HERE)):
                code_artifacts.add(path)
    code_before = {str(path): checksum(path) for path in sorted(code_artifacts)}
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="robot-v8-replay-") as scratch:
        for path in artifacts[1:]:
            shutil.copy2(path, Path(scratch) / path.name)
        connection = sqlite3.connect(Path(scratch) / "evidence.sqlite")
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        run_id = connection.execute("SELECT DISTINCT run_id FROM entity_results").fetchall()
        if len(run_id) != 1:
            raise ValueError("Expected one finished evidence run")
        discovery = json.loads(artifacts[0].read_text())
        bridge_result = bridge.bridge_candidates(connection, run_id[0][0], discovery)
        result = terminal.terminalize(connection, run_id[0][0], discovery, bridge_result)
        connection.close()
    if before != {str(path): checksum(path) for path in artifacts}:
        raise RuntimeError("Frozen source artifacts changed during replay")
    if code_before != {str(path): checksum(path) for path in code_artifacts}:
        raise RuntimeError("Robot source code changed during replay")
    if NETWORK_ATTEMPTS:
        raise RuntimeError("Replay attempted blocked external work")
    return result, {
        "engine": "v8" if candidate else "v7",
        "wall_seconds": round(time.monotonic() - started, 3),
        "network_attempts": len(NETWORK_ATTEMPTS),
        "model_calls": 0,
        "production_writes": 0,
        "source_sha256": before,
        "code_sha256": code_before,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--candidate", action="store_true")
    args = parser.parse_args()
    source = source_directory(args.source, ROOT)
    output = shadow_file(args.output, ROOT)
    if output.exists() or source == output or source in output.parents:
        raise ValueError("Use a new output outside the frozen source directory")
    result, audit = replay(source, args.candidate)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps({**result, "audit": audit}, ensure_ascii=False))
    print(json.dumps({"counts": result["counts"], "audit": {k: v for k, v in audit.items() if k not in {"source_sha256", "code_sha256"}}}))


if __name__ == "__main__":
    main()
