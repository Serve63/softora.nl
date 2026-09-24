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
from kvk_api_validation import PROFILE


ROOT = Path(__file__).resolve().parents[1]
API_URL = os.environ.get("SOFTORA_KVK_API_WORKERS_URL", "https://www.softora.nl/api/kvk-database/api-workers")
PENDING = ROOT / "data" / "kvk_api_pending"
COMPLETED = ROOT / "data" / "kvk_api_completed"
LOCK = ROOT / "data" / "kvk_api_workers.lock"
MODEL_LABEL = "Luna 6 Max"
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
        details = (process.stderr + "\n" + process.stdout).strip()[-6000:]
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
    answer = path.with_suffix(".luna.json")
    if answer.exists():
        os.replace(answer, destination.with_suffix(".luna.json"))
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
                report(self.role, f"{MODEL_LABEL} onderzoekt {self.kvk}", self.kvk)
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


def result_page_evidence(path, result):
    from kvk_api_evidence import public_page_evidence
    import hashlib
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    evidence_path = path.with_suffix('.pages.json')
    cached = json.loads(evidence_path.read_text()) if evidence_path.exists() else {}
    if cached.get('result_sha256') != digest:
        cached = {'result_sha256': digest, 'pages': public_page_evidence(result)}
        save_result(evidence_path, cached)
    return cached.get('pages') or []


def validate_saved_result(path, result, flags):
    from kvk_api_evidence import unreviewed_contacts
    if result.get("validation_profile") not in (None, PROFILE):
        raise ValidationFailure("Onbekend API-onderzoekscontract")
    if result.get("validation_profile") != PROFILE:
        # Preserve the paid evidence exactly; only version the acceptance contract.
        original = path.with_suffix(".legacy-contract.json")
        if path.exists() and not original.exists():
            shutil.copy2(path, original)
        result["validation_profile"] = PROFILE
        save_result(path, result)
    pages = result_page_evidence(path, result)
    try:
        run_cli("contact_agent_precheck.py", str(path), *flags)
        failure = ''
    except ValidationFailure as error:
        failure = str(error)
    missing = unreviewed_contacts(result, pages)
    if missing:
        failure += '\nPublieke HTML bevat nog onbeoordeelde mailto/tel/WhatsApp-contacten: ' + json.dumps(missing, ensure_ascii=False)
    if failure:
        raise ValidationFailure(failure)


def luna_search_one(company: dict, flags: list[str], validate: bool = True) -> bool:
    """Exactly one paid Luna request per company; later steps only reuse the saved answer."""
    from kvk_luna_searcher import to_canonical
    kvk = str(company["kvk_nummer"])
    path = pending_path("searcher", kvk, flags)
    answer_path = path.with_suffix(".luna.json")
    if not answer_path.exists():
        if path.exists():
            # A result from the retired contract is never relabelled as Luna work.
            os.replace(path, path.with_suffix(f".retired-{int(time.time())}.json"))
        if not is_enabled("searcher"):
            return False
        try:
            response = call("/research", {"role": "searcher", "company": company, "brief": {}}, timeout=720)
        except HTTPError as error:
            if error.code == 409:
                return False
            raise
        answer = response.get("result")
        if not response.get("ok") or not isinstance(answer, dict) or str(answer.get("kvk_nummer")) != kvk:
            raise RuntimeError("Luna gaf geen geldig antwoord voor de juiste onderneming terug.")
        save_result(answer_path, {"answer": answer, "consulted_urls": response.get("consultedUrls") or [],
                                  "cost_eur_cents": response.get("costEurCents")})
    if not path.exists():
        # The apply step only picks up a queue head whose mapped result exists.
        saved = json.loads(answer_path.read_text())
        save_result(path, to_canonical(company, saved["answer"], saved.get("consulted_urls") or []))
    if not validate:
        return True
    try:
        run_cli("contact_agent_precheck.py", str(path), *flags)
    except ValidationFailure as error:
        raise ValidationFailure(f"{kvk}: Luna-antwoord bewaard, maar de database weigert het: {str(error)[-300:]}") from None
    return True


def research_one(role: str, company: dict, brief: dict, flags: list[str], validate: bool = True) -> bool:
    if role == "searcher":
        return luna_search_one(company, flags, validate)
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
            validate_saved_result(path, previous, flags)
            return True  # Only validated paid results are reusable.
        except ValidationFailure as error:
            failure = str(error)
    while recovery["attempts"] < MAX_REPAIR_ATTEMPTS:
        if not is_enabled(role):
            return False
        repair_brief = dict(brief)
        if previous is not None:
            repair_brief["repair"] = {"previous_result": previous, "validation_error": failure}
            repair_brief["public_page_evidence"] = result_page_evidence(path, previous)
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
            validate_saved_result(path, result, flags)
            return True
        except ValidationFailure as error:
            failure = str(error)
            recovery["last_error"] = failure
            save_result(recovery_path, recovery)
    raise ValidationFailure(f"{kvk}: na {MAX_REPAIR_ATTEMPTS} herstelpogingen nog onvolledig; bewijs bewaard. {failure[:160]}")


def api_brief(packet: dict) -> dict:
    # The compact native packet references local workpacks. An API model cannot
    # read those: send the actual acceptance criteria before the first paid run.
    schema = dict(packet.get("result_schema_eenmaal") or {})
    schema["route_notes"] = {
        key: {"status": "checked | not_found | blocked | not_applicable", "notes": "concrete bevinding", "urls": []}
        for key in (schema.get("route_notes") or {})
    }
    return {
        "contract": PROFILE,
        "planning_scope": packet.get("planning_scope"),
        "bindend": [
            "Onderzoek alleen deze exacte onderneming met openbare webbronnen. Begin met doel-KVK en bedrijfsnaam + adres/plaats; noteer de werkelijk gebruikte queries met het KVK-nummer.",
            "Verifieer de koppeling tussen naam, adres en doel-KVK. identity, entity_match en final_crosscheck zijn checked met concrete bevindingen; identity noemt het KVK en verwijst naar een geopende bron. Geen contacten van een andere onderneming overnemen.",
            "lead_status=usable vereist telefoonnummer EN email, source_quality official of supported, operational_status operational en entity_role specific. Anders unusable met feitelijke reden; dat is een kandidaat voor controle, geen definitieve afwijzing.",
            "Open een gevonden eigen site en contactpagina; bekijk mailto/tel/WhatsApp-links. Bij ontbrekende contacten volg je concrete domein-, gids- of socialhints. Een onderhoudspagina bewijst geen gestopt bedrijf: controleer eerst de gekoppelde officiële socials of actuele diensten/boekingsinformatie voordat je operational_unclear kiest. Geen verplichte willekeurige domeincombinaties of vaste woorden in de notities.",
            "Alle sources zijn objecten met exacte URL en feitelijke note. Elk gevuld contactveld heeft field_evidence met de exacte bron-URL. Elk leeg contactveld heeft een uitleg van wat niet bewezen is of geblokkeerd was. Geen gegevens of uitgevoerde checks verzinnen.",
            "Bij ontbrekende telefoon/mail krijgen search_engine, directories en website_basic een werkelijk uitgevoerde controle met status checked, not_found of blocked. Bij een gevonden eigen site geldt dit ook voor website_deep. Beschrijf wat je kon lezen, zonder toolfouten als bewijs van afwezigheid te gebruiken.",
            "Een volledig lege contactset vereist twee concrete geopende bedrijfsdetailbronnen; zoekpagina's tellen niet. no_website/not_working vereist minimaal drie vastgelegde bronnen/checks. no_website betekent geen website aangetoond; niet bewezen dat er geen bestaat.",
            "Vul alle route_notes als objecten met status, notes, urls. Routes die geen extra bewijs opleveren mogen not_applicable met eerlijke reden. checks_completed=true betekent dat dit basiscontract werkelijk is uitgevoerd. Stop zodra de contactset en exacte entiteit hard bewezen zijn.",
            "Controleurs: heropen eerst prior_evidence en zoek gericht verder bij ontbrekend/conflicterend bewijs. Verwijder geen bewezen contact zonder hercontrole. Bij review_unusable en opnieuw onbruikbaar zet je ONBRUIKBAAR_REVIEWED_V1 in conclusion_note.",
            "Gebruik webtools; lokale bestanden en scripts zijn niet beschikbaar. Bestaande public_page_evidence bevat aanvullende contactkandidaten die je aan deze entiteit moet koppelen of met reden afwijzen.",
        ],
        "result_schema": schema,
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
    from install_kvk_api_validation import patched_source
    canonical = (ROOT / "scripts/contact_research.py").read_text()
    if patched_source(canonical) != canonical:
        raise RuntimeError("Installeer eerst het API-basiscontract; geen werker gestart.")
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
