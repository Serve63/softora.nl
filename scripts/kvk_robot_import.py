"""Put a Robot result straight into the canonical database.

A usable result with both a phone number and an e-mail address is written as
usable. With final verdicts switched on (SOFTORA_ROBOT_FINAL_VERDICTS=1) every
other result is written as unusable with its reason and review grade 1, the
same state an initial Searcher "unusable" gets, so the Controleurs check it
before it counts as final. Only a company that is still unresearched is
written: a Searcher or Controleur result is never overwritten. This mirrors
the earlier Robot sheet import (same columns, events and labels).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

NOTE = "Robot v5 (dashboard): deterministisch gevonden contact"
# Servé, 2026-10-04: the Robot replaces the Searchers; its unusable verdicts go to the Controleurs.
FINAL_VERDICTS = os.environ.get("SOFTORA_ROBOT_FINAL_VERDICTS", "0") == "1"
# Robot decision -> the Searchers' unusable_reason. A conflict is written as identity_unconfirmed so the
# Controleur looks at exactly that; every verdict is review grade 1 and checked before it counts.
UNUSABLE_REASONS = {
    "missing_phone_and_email": "missing_phone_and_email",
    "missing_email": "missing_email",
    "missing_phone": "missing_phone",
    "holding": "non_specific_entity",
    "chain": "chain_branch",
    "stopped": "stopped",
    "no_own_contact": "no_own_contact",
    "conflict": "identity_unconfirmed",
    # Sources the Robot could not open: the Searchers ended 123 of 199 such companies as missing contacts.
    "technical_retry": "missing_phone_and_email",
}
# A holding/beheer/vastgoed name without a find is a non-specific entity, as the Searchers record it.
HOLDING_NAME = re.compile(r"\b(holding|beheer|vastgoed|participaties?|investments?|onroerend goed|fund|fonds)\b", re.I)
NO_CONTACT_DECISIONS = {"missing_phone_and_email", "technical_retry", "missing_email", "missing_phone", "no_own_contact"}


# Last gate before the database, whatever path produced the find: a website builder's or host's
# own address (datenschutz@jimdo.com in a site footer) is never the company's e-mail.
PLATFORM_EMAIL_DOMAINS = frozenset({
    "jimdo.com", "jimdosite.com", "wix.com", "wixpress.com", "squarespace.com", "webnode.com", "webnode.nl",
    "weebly.com", "site123.com", "strato.de", "strato.nl", "one.com", "hostnet.nl", "transip.nl", "mijndomein.nl",
    "vimexx.nl", "godaddy.com", "shopify.com", "lightspeedhq.com", "mailchimp.com", "wordpress.com",
    "wordpress.org", "automattic.com", "webflow.com", "jouwweb.nl", "sentry.io", "example.com", "domain.com",
    "domain.tld", "cloudflare.com", "google.com", "facebook.com",
})


def contact_problem(result: dict) -> str:
    """Why a usable result's contacts cannot be right, or '' when they pass."""
    email = str(result.get("email") or "").strip().lower()
    domain = email.rsplit("@", 1)[-1]
    if any(domain == item or domain.endswith("." + item) for item in PLATFORM_EMAIL_DOMAINS):
        return f"platform-e-mail {email}"
    phone = re.sub(r"[^\d+]", "", str(result.get("phone") or result.get("telefoonnummer") or ""))
    website = str(result.get("website") or "").lower()
    dutch_site = bool(re.search(r"\.nl(?:[/:?#]|$)", website)) or domain.endswith(".nl")
    foreign = phone.startswith("+") and not phone.startswith("+31") or phone.startswith("00") and not phone.startswith("0031")
    if foreign and dutch_site:
        return f"buitenlands nummer {phone} bij een Nederlandse site (demonummer van een websitethema)"
    return ""


def robot_find(result: dict) -> dict | None:
    """The contact set to import, or None when the Robot did not find a usable lead."""
    if result.get("lead_status") != "usable":
        return None
    phone = str(result.get("phone") or result.get("telefoonnummer") or "").strip()
    email = str(result.get("email") or "").strip()
    if not phone or not email or contact_problem(result):
        return None
    return {
        "kvk": str(result.get("kvk_nummer") or result.get("kvk") or ""),
        "phone": phone,
        "email": email,
        "website": str(result.get("website") or "").strip(),
    }


def robot_verdict(result: dict) -> dict | None:
    """The unusable verdict to import for a finished Robot result that is no find, or None."""
    if robot_find(result) is not None:
        return None
    decision = str(result.get("decision") or "")
    problem = contact_problem(result) if result.get("lead_status") == "usable" else ""
    # A find that fails the contact gate goes to the Controleurs as unconfirmed, never in silently.
    reason = "identity_unconfirmed" if problem else UNUSABLE_REASONS.get(decision)
    if not reason:
        return None
    if decision in NO_CONTACT_DECISIONS and HOLDING_NAME.search(str(result.get("bedrijfsnaam") or "")):
        reason = "non_specific_entity"
    assist = result.get("ai_assist") or {}
    proof = [str(item.get("url") or "") for item in result.get("proof") or [] if isinstance(item, dict)]
    note = "; ".join(part for part in (
        f"Robot v7 + AI-hulp: {result.get('decision')}",
        f"contactcontrole afgekeurd: {problem}" if problem else "",
        f"AI-controle: {assist.get('reason')}" if assist.get("reason") else "",
        f"conflict: {result.get('conflict_kind')}" if result.get("conflict_kind") else "",
        ("bewijs: " + ", ".join(url for url in proof if url)[:500]) if any(proof) else "",
    ) if part)
    return {"kvk": str(result.get("kvk_nummer") or result.get("kvk") or ""), "reason": reason, "note": note[:1200]}


def import_verdict(db_path: Path, verdict: dict, timestamp: str | None = None) -> bool:
    """Write one unusable verdict for the Controleurs (review grade 1); True when the company was updated."""
    timestamp = timestamp or datetime.now(timezone(timedelta(hours=2))).isoformat()
    kvk = verdict["kvk"]
    digest = hashlib.sha256(json.dumps(verdict, sort_keys=True).encode()).hexdigest()
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        cursor = connection.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute(
            """UPDATE companies SET lead_status='unusable', unusable_reason=?, contact_status='checked',
               contact_checked_at=?, contact_research_note=?, unusable_review_grade=1,
               unusable_reviewed_at='', usable_review_state='not_required', usable_reviewed_at='',
               usable_review_outcome='', updated_at=?
               WHERE kvk_nummer=? AND lead_status='unresearched'""",
            (verdict["reason"], timestamp, verdict["note"], timestamp, kvk),
        )
        if cursor.rowcount != 1:
            connection.rollback()
            return False
        cursor.execute(
            """INSERT INTO contact_research_lane_events(kvk_nummer,lane,model_role,outcome,created_at)
               VALUES(?,'initial','searcher_robot','unusable',?)
               ON CONFLICT(kvk_nummer,lane) DO NOTHING""",
            (kvk, timestamp),
        )
        cursor.execute(
            """INSERT INTO contact_research_bucket_events(kvk_nummer,lane,model_role,from_bucket,to_bucket,created_at)
               SELECT ?,'initial','searcher_robot','','unusable',?
               WHERE NOT EXISTS (SELECT 1 FROM contact_research_bucket_events b
                 WHERE b.kvk_nummer=? AND b.lane='initial' AND b.model_role='searcher_robot')""",
            (kvk, timestamp, kvk),
        )
        cursor.execute(
            """INSERT INTO unusable_review_grade_events(kvk_nummer,from_grade,to_grade,model_role,created_at)
               VALUES(?,0,1,'initial_research',?)""",
            (kvk, timestamp),
        )
        cursor.execute(
            """INSERT INTO research_attribution(kvk_nummer,researcher,created_at)
               VALUES(?,'robot',?)
               ON CONFLICT(kvk_nummer) DO UPDATE SET researcher=excluded.researcher, created_at=excluded.created_at""",
            (kvk, timestamp),
        )
        cursor.execute(
            """INSERT OR IGNORE INTO research_execution_attributions(kvk_nummer,lane,created_at,producer_thread_id,model,reasoning_effort,display_label,input_sha256)
               VALUES(?,'initial',?,'robot-v5-dashboard','robot','deterministic','Robot',?)""",
            (kvk, timestamp, digest),
        )
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def import_find(db_path: Path, find: dict, timestamp: str | None = None) -> bool:
    """Write one find in a single transaction; True when the company was updated."""
    timestamp = timestamp or datetime.now(timezone(timedelta(hours=2))).isoformat()
    kvk, website = find["kvk"], find["website"]
    digest = hashlib.sha256(json.dumps(find, sort_keys=True).encode()).hexdigest()
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        cursor = connection.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute(
            """UPDATE companies SET website=?, website_status=?, email=?, telefoonnummer=?,
               lead_status='usable', contact_status='checked', contact_checked_at=?,
               operational_status='operational', source_quality='official',
               entity_role='specific', contact_research_note=?,
               unusable_reason='', unusable_review_grade=0,
               usable_review_state='verified', usable_reviewed_at=?,
               usable_review_outcome='confirmed', updated_at=?
               WHERE kvk_nummer=? AND lead_status='unresearched'""",
            (website, "found" if website else "no_website", find["email"], find["phone"],
             timestamp, NOTE, timestamp, timestamp, kvk),
        )
        if cursor.rowcount != 1:
            connection.rollback()
            return False
        cursor.execute(
            """INSERT INTO contact_research_lane_events(kvk_nummer,lane,model_role,outcome,created_at)
               VALUES(?,'initial','searcher_robot','usable',?)
               ON CONFLICT(kvk_nummer,lane) DO NOTHING""",
            (kvk, timestamp),
        )
        cursor.execute(
            """INSERT INTO contact_research_bucket_events(kvk_nummer,lane,model_role,from_bucket,to_bucket,created_at)
               SELECT ?,'initial','searcher_robot','',?,?
               WHERE NOT EXISTS (SELECT 1 FROM contact_research_bucket_events b
                 WHERE b.kvk_nummer=? AND b.lane='initial' AND b.model_role='searcher_robot')""",
            (kvk, "with_website" if website else "without_website", timestamp, kvk),
        )
        cursor.execute(
            """INSERT INTO research_attribution(kvk_nummer,researcher,created_at)
               VALUES(?,'robot',?)
               ON CONFLICT(kvk_nummer) DO UPDATE SET researcher=excluded.researcher, created_at=excluded.created_at""",
            (kvk, timestamp),
        )
        cursor.execute(
            """INSERT OR IGNORE INTO research_execution_attributions(kvk_nummer,lane,created_at,producer_thread_id,model,reasoning_effort,display_label,input_sha256)
               VALUES(?,'initial',?,'robot-v5-dashboard','robot','deterministic','Robot',?)""",
            (kvk, timestamp, digest),
        )
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def publish_live(root: Path) -> None:
    """Hand the change to the live dashboard publisher, like a Searcher apply does."""
    try:
        if str(root / "scripts") not in sys.path:
            sys.path.insert(0, str(root / "scripts"))
        from live_progress_sync import request_if_running
        if request_if_running():
            return
    except Exception:
        pass
    script = root / "scripts" / "sync_live_dashboard.py"
    if script.exists():
        subprocess.run([sys.executable, str(script)], cwd=root, check=False,
                       capture_output=True, text=True, timeout=120)
