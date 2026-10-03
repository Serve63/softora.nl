"""Process-local v8 identity fix, installed only by the offline shadow runner."""
from __future__ import annotations

import re
from collections import defaultdict


def profile_regions(bridge, company, row, text):
    """Require the exact target identity near the supporting contact pair.

    A surname elsewhere on a page is not an entity binding. Prefer an exact
    labelled target KVK with the legal name, using the existing nearest-entity
    gate. A profile without any labelled KVK must show the complete legal name
    and assigned street/locality together in a bounded local block.
    """
    gate = bridge.dossier_gate
    kvk = str(company.get("kvk_nummer") or "")
    registrations = gate.labelled_kvks(text)
    if registrations:
        return [
            region for region in gate.local_identity_regions(text, company, row)
            if region["kind"] == "kvk" and region["number"] == kvk
        ]
    normalized = gate.phrase(text)
    name = gate.company_name(company.get("bedrijfsnaam"))
    if not name or not str(company.get("adres") or row.get("adres") or "").strip():
        return []
    regions = []
    for match in re.finditer(r"(?<!\w)" + re.escape(name) + r"(?!\w)", normalized):
        start, end = max(0, match.start() - 300), min(len(normalized), match.end() + 600)
        if not bridge._partial_assignment_visible(company, row, normalized[start:end]):
            continue
        anchor = (match.start() + match.end()) // 2
        regions.append({
            "start": start, "end": end, "anchor": anchor,
            "target_anchors": [anchor], "other_anchors": [],
        })
    return regions


def safe_cross_source_profile_hosts(bridge, company, row, pages):
    """Require the same locally bound pair on two separate domain roots.

    Other bridge routes remain unchanged. This route still needs a readable
    target-KVK/name anchor somewhere in the captured evidence, and rejects a
    candidate site with another KVK. Subdomains and the candidate's own root
    cannot corroborate it. Separate roots are not proof of separate publishers.
    """
    gate = bridge.dossier_gate
    kvk = str(company.get("kvk_nummer") or "")
    readable = [page for page in pages if gate.readable(page)]
    if not any(
        any(region["kind"] == "kvk" and region["number"] == kvk
            for region in gate.local_identity_regions(page.get("visible_text", ""), company, row))
        for page in readable
    ):
        return set()
    by_host = defaultdict(list)
    supporting = []
    for page in readable:
        host = gate.host(gate.page_url(page))
        by_host[host].append(page)
        text = page.get("visible_text", "")
        regions = profile_regions(bridge, company, row, text)
        if not regions:
            continue
        emails, phones = bridge._page_contact_values(page)
        local_emails = {
            value for value in emails
            if gate.value_in_local_regions(text, value, regions, "email")
        }
        local_phones = {
            bridge.screen.comparable_phone(value) for value in phones
            if gate.value_in_local_regions(text, value, regions, "telefoonnummer")
        }
        if local_emails and local_phones:
            supporting.append((gate._registrable_root(host), local_emails, local_phones))
    accepted = set()
    for candidate_host, own_pages in by_host.items():
        if not candidate_host or bridge._host_has_foreign_kvk(candidate_host, pages, kvk):
            continue
        own_emails, own_phones = set(), set()
        for page in own_pages:
            emails, phones = bridge._page_contact_values(page)
            own_emails.update(emails)
            own_phones.update(bridge.screen.comparable_phone(value) for value in phones)
        root = gate._registrable_root(candidate_host)
        pair_sources = defaultdict(set)
        for source_root, emails, phones in supporting:
            if not source_root or source_root == root:
                continue
            for email in own_emails & emails:
                for phone in own_phones & phones:
                    pair_sources[email, phone].add(source_root)
        if any(len(roots) >= 2 for roots in pair_sources.values()):
            accepted.add(candidate_host)
    return accepted


def install(bridge, terminal):
    bridge.safe_cross_source_profile_hosts = lambda company, row, pages: (
        safe_cross_source_profile_hosts(bridge, company, row, pages)
    )
