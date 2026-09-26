"""Put a Robot v5 find straight into the canonical database so the Searchers skip it.

Only a usable result with both a phone number and an e-mail address is written,
and only for a company that is still unresearched: a Searcher result is never
overwritten. Anything the Robot did not find is left alone for the Searchers.
This mirrors the earlier Robot sheet import (same columns, events and labels).
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

NOTE = "Robot v5 (dashboard): deterministisch gevonden contact"


def robot_find(result: dict) -> dict | None:
    """The contact set to import, or None when the Robot did not find a usable lead."""
    if result.get("lead_status") != "usable":
        return None
    phone = str(result.get("phone") or result.get("telefoonnummer") or "").strip()
    email = str(result.get("email") or "").strip()
    if not phone or not email:
        return None
    return {
        "kvk": str(result.get("kvk_nummer") or result.get("kvk") or ""),
        "phone": phone,
        "email": email,
        "website": str(result.get("website") or "").strip(),
    }


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
