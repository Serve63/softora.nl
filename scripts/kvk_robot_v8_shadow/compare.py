"""Report aggregate historical-reference agreement without exporting contacts."""
import argparse
import json
import re
from collections import Counter
from pathlib import Path


def keyed(rows):
    result = {str(row["kvk_nummer"]): row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate company in comparison")
    return result


def phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("0031"):
        digits = digits[4:]
    elif digits.startswith("31"):
        digits = digits[2:]
    return digits.lstrip("0")


def score(truth, results):
    totals = Counter(positives=0, negatives=0, found=0, false_usable=0,
                     email_exact=0, phone_exact=0, contact_both_exact=0)
    for kvk, reference in truth.items():
        result = results[kvk]
        usable = result.get("lead_status") == "usable"
        if reference["lead_status"] == "usable":
            totals["positives"] += 1
            if usable:
                totals["found"] += 1
                email_ok = str(reference.get("email") or "").casefold() == str(result.get("email") or "").casefold()
                phone_ok = phone(reference.get("telefoonnummer")) == phone(result.get("phone"))
                totals["email_exact"] += email_ok
                totals["phone_exact"] += phone_ok
                totals["contact_both_exact"] += email_ok and phone_ok
        else:
            totals["negatives"] += 1
            totals["false_usable"] += usable
    return dict(totals)


def compare(truth_path, baseline_path, candidate_path):
    truth = keyed(json.loads(Path(truth_path).read_text()))
    baseline = json.loads(Path(baseline_path).read_text())
    candidate = json.loads(Path(candidate_path).read_text())
    old, new = keyed(baseline["results"]), keyed(candidate["results"])
    if not (truth.keys() == old.keys() == new.keys()):
        raise ValueError("Truth, baseline and candidate must cover identical companies")
    if baseline["audit"]["source_sha256"] != candidate["audit"]["source_sha256"]:
        raise ValueError("Comparison requires exactly the same frozen evidence")
    common_code = set(baseline["audit"].get("code_sha256", {})) & set(candidate["audit"].get("code_sha256", {}))
    # Harness paths can differ; common imported v7 modules must be identical.
    for path in common_code:
        if baseline["audit"]["code_sha256"][path] != candidate["audit"]["code_sha256"][path]:
            raise ValueError("Common engine source changed between runs")
    changes = Counter(gained_usable=0, lost_usable=0, changed_accepted_contacts=0, changed_decisions_or_contacts=0)
    for kvk in truth:
        a, b = old[kvk], new[kvk]
        a_ok, b_ok = a.get("lead_status") == "usable", b.get("lead_status") == "usable"
        changes["gained_usable"] += not a_ok and b_ok
        changes["lost_usable"] += a_ok and not b_ok
        fields = ("decision", "lead_status", "website", "email", "phone")
        changes["changed_decisions_or_contacts"] += any(a.get(key) != b.get(key) for key in fields)
        changes["changed_accepted_contacts"] += a_ok and b_ok and any(a.get(key) != b.get(key) for key in ("website", "email", "phone"))
    audits = {}
    for name, data in (("baseline", baseline), ("candidate", candidate)):
        audit = data["audit"]
        if any(audit[key] != 0 for key in ("network_attempts", "model_calls", "production_writes")):
            raise ValueError("Replay isolation gate failed")
        audits[name] = {key: audit[key] for key in ("wall_seconds", "network_attempts", "model_calls", "production_writes")}
    return {"n": len(truth), "baseline": score(truth, old), "candidate": score(truth, new),
            "changes": dict(changes), "common_engine_files_verified": len(common_code), "audit": audits}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("truth")
    parser.add_argument("baseline")
    parser.add_argument("candidate")
    args = parser.parse_args()
    print(json.dumps(compare(args.truth, args.baseline, args.candidate), indent=2))
