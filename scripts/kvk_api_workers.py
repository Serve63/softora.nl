#!/usr/bin/env python3
"""Configurable API Searchers and Controllers, gated by the live Softora switches.

The canonical SQLite database is only changed through the existing
precheck -> validate -> apply pipeline. No model key is stored locally.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError, URLError

import fcntl
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from start_database_fill_control import post_json, resolve_token


ROOT = Path(__file__).resolve().parents[1]
API_URL = os.environ.get("SOFTORA_KVK_API_WORKERS_URL", "https://www.softora.nl/api/kvk-database/api-workers")
PENDING = ROOT / "data" / "kvk_api_pending"
COMPLETED = ROOT / "data" / "kvk_api_completed"
LOCK = ROOT / "data" / "kvk_api_workers.lock"
MODEL = "gpt-6-sol"
MAX_REPAIR_ATTEMPTS = 3


class ValidationFailure(RuntimeError):
    pass


class RemoteFailure(RuntimeError):
    def __init__(self, path, status, message):
        super().__init__(message)
        self.path, self.status = path, status


def transient_control_failure(error):
    return isinstance(error, RemoteFailure) and error.path in ("/poll", "/report") and error.status in (0, 408, 429, 500, 502, 503, 504)

ROLE_FLAGS = {
    "searcher": [],
    "controller-approved": ["--review-approved"],
    "controller-unusable": ["--review-unusable", "--review-grade", "1"],
}


def call(path: str, payload: dict, timeout: int = 45) -> dict:
    token = resolve_token()
    if not token:
        raise RuntimeError("Bestaande KVK-synctoken ontbreekt; geen API-aanvraag gedaan.")
    try:
        return post_json(f"{API_URL}{path}", token, payload, timeout=timeout)
    except HTTPError as error:
        if error.code == 409:
            raise
        try:
            details = json.loads(error.read().decode('utf-8')).get('error', '')
        except (ValueError, UnicodeDecodeError):
            details = ''
        raise RemoteFailure(path, error.code, f"HTTP {error.code}: {details or error.reason}") from None
    except (URLError, TimeoutError, OSError) as error:
        raise RemoteFailure(path, 0, f"Verbinding onderbroken: {error}") from None


def report(role: str, message: str, kvk: str = "", halt: bool = False) -> None:
    call("/report", {"role": role, "message": message[:180], "currentBatch": kvk, "halt": halt})


def run_cli(script: str, *args: str, timeout: int = 900) -> str:
    child_env = os.environ.copy()
    child_env.pop("CODEX_THREAD_ID", None)
    child_env.pop("CODEX_SESSION_ID", None)
    process = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / script), *args],
        cwd=ROOT, env=child_env, text=True, capture_output=True, timeout=timeout,
        check=False,
    )
    if process.returncode:
        details = (process.stderr + "\n" + process.stdout).strip()[-1400:]
        error_type = ValidationFailure if script in ("contact_agent_precheck.py", "contact_validate_apply.py") else RuntimeError
        raise error_type(f"{script} stopte met code {process.returncode}: {details}")
    return process.stdout


def next_packet(role: str, count: int = 1) -> tuple[dict, list[str]] | None:
    variants = ["searcher"] if role == "searcher" else ["controller-approved", "controller-unusable"]
    for variant in variants:
        flags = ROLE_FLAGS[variant]
        raw = run_cli("contact_research.py", "agent-prompts", "--limit", str(count), "--compact", "--no-scout-hints", *flags)
        packet = json.loads(raw)
        if packet.get("bedrijven"):
            return packet, flags
    return None


def pending_path(role: str, kvk: str, flags: list[str]) -> Path:
    mode = "approved" if "--review-approved" in flags else "unusable" if "--review-unusable" in flags else "initial"
    return PENDING / f"contact_agent_results_api_{role}_{mode}_{kvk}.json"


def save_result(path: Path, result: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.partial")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, path)


def apply_result(path: Path, flags: list[str], apply_lock: threading.Lock, role: str) -> bool:
    COMPLETED.mkdir(parents=True, exist_ok=True)
    destination = COMPLETED / path.name
    if destination.exists():
        destination = COMPLETED / f"{path.stem}_{int(time.time())}.json"
    archive_temp = destination.with_suffix(".json.pending")
    with apply_lock:
        if not is_enabled(role):
            return False
        run_cli("contact_agent_precheck.py", str(path), *flags)
        if not is_enabled(role):
            return False
        shutil.copy2(path, archive_temp)
        try:
            run_cli("contact_validate_apply.py", str(path), *flags)
        except Exception:
            archive_temp.unlink(missing_ok=True)
            raise
    os.replace(archive_temp, destination)
    path.unlink(missing_ok=True)
    marker = path.with_name(f"{path.name}.precheck-ok.json")
    if marker.exists():
        os.replace(marker, destination.with_name(f"{destination.name}.precheck-ok.json"))
    return True


class Heartbeat:
    def __init__(self, role: str, kvk: str):
        self.role, self.kvk = role, kvk
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self) -> None:
        while not self.stop.wait(30):
            try:
                report(self.role, f"{MODEL} Max onderzoekt {self.kvk}", self.kvk)
            except Exception:
                pass  # Server budget gate independently rejects stale heartbeats.

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.stop.set()
        self.thread.join(timeout=3)


def is_enabled(role: str) -> bool:
    state = call("/poll", {}).get("state") or {}
    return bool(((state.get("workers") or {}).get(role) or {}).get("enabled"))


def research_one(role: str, company: dict, brief: dict, flags: list[str], validate: bool = True) -> bool:
    kvk = str(company["kvk_nummer"])
    path = pending_path(role, kvk, flags)
    recovery_path = path.with_suffix(".recovery.json")
    recovery = json.loads(recovery_path.read_text()) if recovery_path.exists() else {"attempts": 0}
    previous = None
    failure = ""
    if path.exists() and not validate:
        return True  # Full validation happens only when this company reaches the queue head.
    if path.exists():
        previous = json.loads(path.read_text())
        try:
            run_cli("contact_agent_precheck.py", str(path), *flags)
            return True  # Only validated paid results are reusable.
        except ValidationFailure as error:
            failure = str(error)
    while recovery["attempts"] < MAX_REPAIR_ATTEMPTS:
        if not is_enabled(role):
            return False
        repair_brief = dict(brief)
        if previous is not None:
            repair_brief["repair"] = {"previous_result": previous, "validation_error": failure}
            archive = path.with_suffix(f".rejected-{recovery['attempts']}.json")
            if not archive.exists():
                save_result(archive, previous)
        recovery["attempts"] += 1
        recovery["last_error"] = failure
        save_result(recovery_path, recovery)
        try:
            response = call("/research", {"role": role, "company": company, "brief": repair_brief}, timeout=720)
        except HTTPError as error:
            if error.code == 409:
                recovery["attempts"] -= 1
                save_result(recovery_path, recovery)
                return False
            raise
        result = response.get("result")
        if not response.get("ok") or not isinstance(result, dict) or str(result.get("kvk_nummer")) != kvk:
            raise RuntimeError("API gaf geen geldig resultaat voor de juiste onderneming terug.")
        save_result(path, result)
        previous = result
        if not validate:
            return True
        try:
            run_cli("contact_agent_precheck.py", str(path), *flags)
            return True
        except ValidationFailure as error:
            failure = str(error)
            recovery["last_error"] = failure
            save_result(recovery_path, recovery)
    raise ValidationFailure(f"{kvk}: na {MAX_REPAIR_ATTEMPTS} herstelpogingen nog onvolledig; bewijs bewaard. {failure[:160]}")


def api_brief(packet: dict) -> dict:
    return {
        "planning_scope": packet.get("planning_scope"),
        "bindend": [
            "Onderzoek uitsluitend deze exacte onderneming met openbare webbronnen.",
            "Verifieer naam, adres en KVK; neem geen contactgegevens van een ander bedrijf over.",
            "Zoek de eigen website en contactpagina, sociale profielen en concrete gidsvermeldingen.",
            "Bewijs elk ingevuld contactveld met een exacte bron-URL; vul ontbrekende gegevens niet in.",
            "Noteer per route wat werkelijk is gedaan; gebruik blocked of not_applicable met reden waar nodig.",
            "Gebruik de webtools; lokale bestanden en scripts zijn geen onderdeel van deze API-opdracht.",
        ],
        "result_schema": packet.get("result_schema_eenmaal"),
        "review_approved": packet.get("review_approved"),
        "review_unusable": packet.get("review_unusable"),
    }


def research_batch(role: str, packet: dict, flags: list[str], count: int) -> None:
    companies = packet["bedrijven"]
    identities = [str(company["kvk_nummer"]) for company in companies]
    if len(identities) != len(set(identities)):
        raise RuntimeError("Wachtrij bevat dubbele bedrijven; onderzoek niet gestart.")
    brief = api_brief(packet)
    errors = []
    with ThreadPoolExecutor(max_workers=count) as pool:
        futures = [pool.submit(research_one, role, company, brief, flags, False) for company in companies]
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as error:
                errors.append(error)
    # Each successful result was saved immediately, including peers of a failed request.
    if errors:
        raise errors[0]


def apply_ready_prefix(role: str, packet: dict, flags: list[str], apply_lock: threading.Lock) -> int:
    applied = 0
    for company in packet["bedrijven"]:
        kvk = str(company["kvk_nummer"])
        path = pending_path(role, kvk, flags)
        if not path.exists() or not is_enabled(role):
            break  # Never skip a missing queue head because another result finished first.
        if not research_one(role, company, api_brief(packet), flags):
            break
        if not apply_result(path, flags, apply_lock, role):
            break
        applied += 1
        report(role, f"Resultaat toegepast: {kvk}")
    return applied


def work(role: str, apply_lock: threading.Lock) -> None:
    print(f"KVK API {role}: wacht op de dashboardknop.", flush=True)
    while True:
        try:
            state = call("/poll", {}).get("state") or {}
            worker = (state.get("workers") or {}).get(role) or {}
            if not worker.get("enabled"):
                time.sleep(10)
                continue
            count = max(1, min(10, int(worker.get("count") or 1)))
            report(role, f"{count} ingesteld; wachtrij lezen.")
            packet_result = next_packet(role, count)
            if packet_result is None:
                report(role, "Wachtrij leeg; wacht op nieuw werk.")
                time.sleep(30)
                continue
            packet, flags = packet_result
            batch_label = f"{len(packet['bedrijven'])} bedrijven"
            report(role, f"{count} ingesteld; {batch_label} onderzoeken.", batch_label)
            with Heartbeat(role, batch_label):
                research_batch(role, packet, flags, count)
                applied = apply_ready_prefix(role, packet, flags, apply_lock)
            if not applied:
                report(role, "Wacht op budgetruimte of handmatige start; resultaten bewaard.")
                time.sleep(10)
        except Exception as error:
            if transient_control_failure(error):
                print(f"KVK API {role}: tijdelijke verbindingstoring; opnieuw proberen.", flush=True)
                time.sleep(15)
                continue
            print(f"KVK API {role} gestopt: {error}", flush=True)
            try:
                report(role, f"Gestopt: {str(error)[:145]}", halt=True)
            except Exception:
                pass
            time.sleep(10)


def main() -> int:
    PENDING.mkdir(parents=True, exist_ok=True)
    LOCK.touch(exist_ok=True)
    with LOCK.open("r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("KVK API-werkers draaien al; tweede proces geweigerd.", flush=True)
            return 1
        # A restarted process never resumes a paid run without a new button press.
        for role in ("searcher", "controller"):
            while True:
                try:
                    report(role, "Lokale werker gereed; wacht op handmatige start.", halt=True)
                    break
                except RemoteFailure as error:
                    if not transient_control_failure(error):
                        raise
                    time.sleep(15)
        apply_lock = threading.Lock()
        threads = [threading.Thread(target=work, args=(role, apply_lock), daemon=True)
                   for role in ("searcher", "controller")]
        from kvk_robot_v5 import main as robot_main
        threads.append(threading.Thread(target=robot_main, daemon=True))
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
