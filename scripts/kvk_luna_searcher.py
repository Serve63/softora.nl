"""Single-pass Luna Searcher: verify one answer for free, then map it to the canonical result.

Luna researches each company exactly once. Nothing is re-bought: every cited
phone number and e-mail address is checked here against the cited public page.
A claim that is not on that page (or, when the page cannot be fetched, was not
among the pages Luna actually retrieved) is dropped instead of written.
"""
from __future__ import annotations

import html
import re
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from kvk_api_evidence import PublicRedirects, require_public_url
from kvk_api_validation import PROFILE

ROUTES = ("identity", "search_engine", "website_basic", "website_deep", "visual_assets", "maps_profile",
          "social_search", "social_bio", "order_links", "directories", "entity_match", "final_crosscheck")
SEARCH_URL = re.compile(r"(google|bing|duckduckgo)\.[a-z.]+/search|[?&](q|query|search)=", re.I)
# Same contact patterns as the canonical validator, which refuses a result whose
# notes mention a phone number or e-mail address that is neither kept nor rejected.
CANON_PHONE_RE = re.compile(
    r"(?:(?:\+|00)31[\s().-]*(?:0)?|0)(?:6|7[0-9]|8[578]|[1-5][0-9])"
    r"[\s().-]*[0-9][\s().-]*[0-9][\s().-]*[0-9][\s().-]*[0-9]"
    r"[\s().-]*[0-9][\s().-]*[0-9](?:[\s().-]*[0-9]){0,2}"
)
CANON_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+")
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Softora-Searcher-Verify"
MAX_BYTES = 3_000_000


def fetch_page(url: str, timeout: int = 15) -> str | None:
    """Public page text for verification, or None when it cannot be read."""
    try:
        # Cited URLs come from the model: only public addresses, also after redirects.
        require_public_url(url)
        opener = build_opener(ProxyHandler({}), PublicRedirects())
        with opener.open(Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout) as response:
            if not 200 <= response.status < 400:
                return None
            raw = response.read(MAX_BYTES)
            return raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    except Exception:
        return None


def clean(value) -> str:
    return str(value or "").strip()


def url_key(url: str) -> str:
    parts = urlsplit(clean(url))
    host = (parts.hostname or "").removeprefix("www.")
    return f"{host}{parts.path.rstrip('/')}".lower()


def phone_digits(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if digits.startswith("00"):
        digits = digits[2:]
    elif not digits.startswith("31"):
        return digits
    # +31 6..., 0031 6... and +31 (0)6... all become 06...
    national = digits[2:].removeprefix("0")
    return "0" + national if len(national) == 9 else digits


def phone_on_page(phone: str, page: str) -> bool:
    wanted = phone_digits(phone)
    if len(wanted) < 9:
        return False
    text = html.unescape(page)
    for candidate in re.findall(r"(?:\+|00)?[\d][\d\s().\-/]{7,30}\d", text):
        # Adjacent numbers can merge into one candidate; the national part must still be intact.
        if phone_digits(candidate) == wanted or wanted[1:] in re.sub(r"\D", "", candidate):
            return True
    return False


def email_on_page(email: str, page: str) -> bool:
    text = html.unescape(page).lower().replace("[at]", "@").replace("(at)", "@")
    return bool(email) and email.lower() in text


def verify_claim(kind: str, value: str, url: str, consulted: set[str], fetch) -> tuple[bool, str]:
    if not value:
        return False, ""
    if not url or urlsplit(url).scheme not in ("http", "https"):
        return False, f"{kind} {value} niet opgenomen: geen bron-URL."
    page = fetch(url)
    if page is not None:
        found = phone_on_page(value, page) if kind == "telefoon" else email_on_page(value, page)
        if found:
            return True, f"{url} — {kind} {value} letterlijk op deze pagina gecontroleerd."
        return False, f"{kind} {value} niet opgenomen: niet gevonden op {url}."
    if url_key(url) in consulted:
        return True, f"{url} — {kind} {value} door Luna op deze pagina gezien; pagina lokaal niet leesbaar."
    return False, f"{kind} {value} niet opgenomen: bron {url} niet leesbaar en niet door Luna geopend."


def website_state(answer: dict, fetch) -> tuple[str, str, str]:
    website = clean(answer.get("website"))
    status = clean(answer.get("website_status"))
    if not website or status == "no_website":
        return "", "no_website", "Geen eigen website gevonden."
    if not urlsplit(website).scheme:
        website = "https://" + website
    if fetch(website) is not None:
        return website, "found", f"{website} — eigen website geopend en bereikbaar."
    return website, "not_working", f"{website} — eigen domein gevonden maar niet bereikbaar."


def lead_sources(answer: dict, consulted_urls: list[str], extra: list[str]) -> list[dict]:
    sources, seen = [], set()

    def add(url, note, label="Bron", exact=False):
        url = clean(url)
        key = url if exact else url_key(url)
        if urlsplit(url).scheme not in ("http", "https") or key in seen \
                or (exact and url in [source["url"] for source in sources]):
            return
        seen.add(key)
        sources.append({"url": url, "label": label, "note": clean(note) or "Door Luna geopende bron."})

    listed = [source for source in answer.get("bronnen") or [] if isinstance(source, dict)]
    # Concrete pages first; a search page Luna opened still counts as a recorded check.
    for source in sorted(listed, key=lambda item: bool(SEARCH_URL.search(clean(item.get("url"))))):
        label = "Zoekpagina" if SEARCH_URL.search(clean(source.get("url"))) else "Bron"
        add(source.get("url"), source.get("wat_gezien"), label)
    # Field evidence cites these exact URLs, so www and slash variants must not hide them.
    for url in extra:
        add(url, "Bron van een gecontroleerd veld.", exact=True)
    # Pages Luna retrieved count as consulted sources when fewer were listed.
    for url in consulted_urls:
        if len(sources) >= 3:
            break
        if not SEARCH_URL.search(url):
            add(url, "Door Luna via de webzoektool geopend.", "Geraadpleegd")
    return sources[:15]


def withhold_unaccepted_contacts(result: dict, reference_url: str, identifiers: list[str]) -> None:
    """Replace contacts Luna mentioned but that were not kept, and record them as rejected."""
    keep_phone = phone_digits(result["telefoonnummer"]) if result["telefoonnummer"] else ""
    keep_email = result["email"].casefold()
    identifier_digits = [re.sub(r"\D", "", value) for value in identifiers if re.sub(r"\D", "", value)]
    rejected: dict[str, dict[str, str]] = {"telefoonnummer": {}, "email": {}}

    def phone(match):
        raw = match.group(0)
        digits = re.sub(r"\D", "", raw)
        if any(digits in value or value in digits for value in identifier_digits) \
                or (keep_phone and phone_digits(raw) == keep_phone):
            return raw
        rejected["telefoonnummer"].setdefault(digits, raw.strip())
        return "[nummer niet overgenomen]"

    def email(match):
        raw = match.group(0)
        if raw.casefold() == keep_email:
            return raw
        rejected["email"].setdefault(raw.casefold(), raw)
        return "[e-mailadres niet overgenomen]"

    def scrub(text: str) -> str:
        parts = URL_RE.split(text)
        urls = URL_RE.findall(text)
        out = []
        for index, part in enumerate(parts):
            out.append(CANON_EMAIL_RE.sub(email, CANON_PHONE_RE.sub(phone, part)))
            if index < len(urls):
                out.append(urls[index])
        return "".join(out)

    result["conclusion_note"] = scrub(result["conclusion_note"])
    result["field_evidence"] = {key: scrub(value) for key, value in result["field_evidence"].items()}
    for source in result["sources"]:
        source["note"], source["label"] = scrub(source["note"]), scrub(source["label"])
    for stage in result["route_notes"].values():
        stage["notes"] = scrub(stage["notes"])
    note = "Door Luna genoemd, niet als contact van deze onderneming bevestigd of overgenomen."
    result["contact_rejections"] = {
        field: [{"value": value, "reason_code": "unverified_candidate", "url": reference_url, "note": note}
                for value in values.values()]
        for field, values in rejected.items()
    }


def to_canonical(company: dict, answer: dict, consulted_urls: list[str], fetch=fetch_page) -> dict:
    kvk = str(company["kvk_nummer"])
    if clean(answer.get("kvk_nummer")) != kvk:
        raise ValueError(f"Luna-antwoord hoort niet bij KVK {kvk}.")
    consulted = {url_key(url) for url in consulted_urls}
    identity = answer.get("identiteit") if isinstance(answer.get("identiteit"), dict) else {}
    identity_url = clean(identity.get("bron_url"))
    identity_ok = identity.get("bevestigd") is True and bool(identity_url)

    phone_ok, phone_note = verify_claim("telefoon", clean(answer.get("telefoonnummer")),
                                        clean(answer.get("telefoon_bron_url")), consulted, fetch)
    email_ok, email_note = verify_claim("e-mail", clean(answer.get("email")),
                                        clean(answer.get("email_bron_url")), consulted, fetch)
    website, website_status, website_note = website_state(answer, fetch)
    phone = clean(answer.get("telefoonnummer")) if phone_ok else ""
    email = clean(answer.get("email")) if email_ok else ""

    operational = clean(answer.get("operational_status")) or "unclear"
    role = clean(answer.get("entity_role")) or "unclear"
    quality = clean(answer.get("source_quality")) or "weak"
    if not identity_ok:
        role = "unclear"
    usable = bool(phone and email) and identity_ok and operational == "operational" \
        and role == "specific" and quality in ("official", "supported")

    field_urls = [identity_url, clean(answer.get("telefoon_bron_url")) if phone else "",
                  clean(answer.get("email_bron_url")) if email else "", website]
    sources = lead_sources(answer, consulted_urls, [url for url in field_urls if url])
    queries = [clean(query) for query in answer.get("zoekopdrachten") or [] if clean(query)]
    dropped = [note for ok, note in ((phone_ok, phone_note), (email_ok, email_note)) if not ok and note]
    source_urls = [source["url"] for source in sources]

    def route(status, notes, urls=()):
        return {"status": status, "notes": notes, "urls": [url for url in urls if url]}

    route_notes = {key: route("not_applicable", "Luna Searcher v2 legt deze route niet apart vast.") for key in ROUTES}
    route_notes["identity"] = route("checked" if identity_ok else "not_found",
                                    f"KVK {kvk}: {clean(identity.get('uitleg')) or 'geen bevestigde koppeling'}",
                                    [identity_url])
    route_notes["entity_match"] = route("checked", f"entity_role={role}; operational_status={operational}.", [identity_url])
    route_notes["search_engine"] = route("checked", "Zoekopdrachten: " + ("; ".join(queries[:12]) or f"KVK {kvk}"))
    route_notes["website_basic"] = route("checked", website_note, [website])
    route_notes["final_crosscheck"] = route("checked", " ".join(
        [note for note in (phone_note, email_note) if note] or ["Geen contactclaim om te controleren."]),
        source_urls[:5])

    conclusion = clean(answer.get("conclusie")) or "Luna Searcher v2."
    if dropped:
        conclusion += " Lokale controle: " + " ".join(dropped)
    result = {
        "kvk_nummer": kvk,
        "telefoonnummer": phone,
        "email": email,
        "website": website,
        "website_status": website_status,
        "lead_status": "usable" if usable else "unusable",
        "unusable_reason": "non_specific_entity" if role in ("parent_or_holding", "asset_or_real_estate")
        else "stopped" if operational == "stopped" else "",
        "operational_status": operational,
        "source_quality": quality,
        "entity_role": role,
        "conclusion_note": conclusion[:1500],
        "field_evidence": {
            "telefoonnummer": phone_note if phone else (phone_note or "Geen telefoonnummer gevonden."),
            "email": email_note if email else (email_note or "Geen e-mailadres gevonden."),
            "website": website_note,
        },
        "sources": sources,
        "checks_completed": True,
        "route_notes": route_notes,
        "validation_profile": PROFILE,
    }
    reference = identity_url or (source_urls[0] if source_urls else "")
    withhold_unaccepted_contacts(result, reference, [kvk, clean(company.get("vestigingsnummer"))])
    return result
