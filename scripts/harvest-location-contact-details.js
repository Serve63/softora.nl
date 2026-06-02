#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");
const { setTimeout: delay } = require("timers/promises");

const DATA_PATH = path.join(process.cwd(), "assets", "premium-location-harvest-live.json");
const DEFAULT_LABEL = "Nederland | Noord-Brabant | Oirschot | Oirschot";
const DRIMBLE_BASE_URL = "https://drimble.nl";
const activeLabel = process.argv.slice(2).join(" ").trim() || DEFAULT_LABEL;
const concurrency = Math.max(1, Number(process.env.HARVEST_CONCURRENCY || 4));
const limit = Math.max(0, Number(process.env.HARVEST_LIMIT || 0));
const deepScan = process.env.HARVEST_DEEP !== "0";
const markDone = process.env.HARVEST_MARK_DONE === "1";
const force = process.env.HARVEST_FORCE === "1";
const refreshCandidates = process.env.HARVEST_REFRESH_CANDIDATES === "1";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return normalizeText(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function slugifyPlace(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function drimbleSlugForPlace(place) {
  const normalized = normalizeText(place).toLowerCase();
  if (normalized === "oost west en middelbeers") return "oostelbeers";
  return slugifyPlace(place);
}

function drimbleSourcePlacesForPlace(place) {
  const normalized = normalizeText(place).toLowerCase();
  if (normalized === "oost west en middelbeers") return ["Oostelbeers"];
  return [place];
}

function decodeCloudflareEmail(hex) {
  if (!hex || hex.length < 4) return "";
  const key = parseInt(hex.slice(0, 2), 16);
  let email = "";
  for (let index = 2; index < hex.length; index += 2) {
    email += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16) ^ key);
  }
  return email;
}

function normalizeEmail(value) {
  const email = decodeHtml(value).toLowerCase().replace(/^mailto:/, "").split("?")[0].trim();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return "";
  if (/(example|voorbeeld|domain|domein)\./i.test(email)) return "";
  if (/@drimble\.nl$/i.test(email)) return "";
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email)) return "";
  return email;
}

function normalizePhone(value) {
  const raw = decodeHtml(value)
    .replace(/^tel:/i, "")
    .replace(/[^\d+]/g, "");
  if (!raw) return "";
  let normalized = raw;
  if (normalized.startsWith("0031")) normalized = "+31" + normalized.slice(4);
  if (normalized.startsWith("31") && normalized.length === 11) normalized = "+31" + normalized.slice(2);
  if (normalized.startsWith("+31")) {
    const rest = normalized.slice(3);
    if (/^[1-9]\d{8}$/.test(rest)) return "+31" + rest;
    return "";
  }
  if (/^0[1-9]\d{8}$/.test(normalized)) return normalized;
  return "";
}

function normalizeWebsite(value) {
  const raw = decodeHtml(value).replace(/^website:\s*/i, "").trim();
  if (!raw || /niet beschikbaar|premium|drimble\.nl/i.test(raw)) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^\/\//, "");
  try {
    const url = new URL(withProtocol);
    if (!url.hostname.includes(".")) return "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function findEmails(text) {
  const emails = new Set();
  for (const match of String(text || "").matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const email = normalizeEmail(match[0]);
    if (email) emails.add(email);
  }
  for (const match of String(text || "").matchAll(/email-protection#([a-f0-9]+)/gi)) {
    const email = normalizeEmail(decodeCloudflareEmail(match[1]));
    if (email) emails.add(email);
  }
  return Array.from(emails);
}

function findPhones(text) {
  const phones = new Set();
  const source = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/&nbsp;/g, " ");
  const phonePattern = /(?:tel:)?(?:\+31|0031|0)[\s().-]*(?:[1-9][0-9])[\s().-]*(?:[0-9][\s().-]*){7,8}/gi;
  for (const match of source.matchAll(phonePattern)) {
    const phone = normalizePhone(match[0]);
    if (phone) phones.add(phone);
  }
  return Array.from(phones);
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor));
    return;
  }
  Object.values(value).forEach((item) => walk(item, visitor));
}

function parseJsonScripts(html) {
  const found = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      found.push(JSON.parse(decodeHtml(match[1])));
    } catch {
      // Ignore broken structured data blocks.
    }
  }
  const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) {
    try {
      found.push(JSON.parse(decodeHtml(nextData[1])));
    } catch {
      // Ignore broken Next payloads.
    }
  }
  return found;
}

function extractContactFromHtml(html, options = {}) {
  const allowLooseHtml = options.allowLooseHtml === true;
  const contact = {
    phone: "",
    email: "",
    website: "",
    source: ""
  };

  const jsonBlocks = parseJsonScripts(html);
  for (const block of jsonBlocks) {
    walk(block, (node) => {
      if (!contact.phone && typeof node.telephone === "string") {
        contact.phone = normalizePhone(node.telephone);
        if (contact.phone) contact.source = "structured-data";
      }
      if (!contact.phone && typeof node.phone_number === "string") {
        contact.phone = normalizePhone(node.phone_number);
        if (contact.phone) contact.source = "next-data";
      }
      if (!contact.email && typeof node.email === "string") {
        contact.email = normalizeEmail(node.email);
        if (contact.email && !contact.source) contact.source = "structured-data";
      }
      if (!contact.website && typeof node.website === "string") {
        contact.website = normalizeWebsite(node.website);
      }
      if (!contact.website && typeof node.url === "string") {
        contact.website = normalizeWebsite(node.url);
      }
      if (!contact.website && Array.isArray(node.sameAs)) {
        contact.website = node.sameAs.map(normalizeWebsite).find(Boolean) || "";
      }
    });
  }

  if (allowLooseHtml) {
    if (!contact.email) contact.email = findEmails(html)[0] || "";
    if (!contact.phone) contact.phone = findPhones(html)[0] || "";
    if (!contact.source && (contact.email || contact.phone)) contact.source = "html";
  }

  return contact;
}

function mergeContact(company, contact, sourceUrl) {
  if (contact.phone && !company.phone) company.phone = contact.phone;
  if (contact.email && !company.email) company.email = contact.email;
  if (contact.website && !company.website) company.website = contact.website;
  if (contact.source) company.contactSource = sourceUrl || contact.source;
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 Softora bedrijf contact scraper"
      }
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/text|html|xml|json/i.test(contentType)) {
      return { ok: false, status: response.status, text: "" };
    }
    return { ok: true, status: response.status, text: await response.text(), url: response.url };
  } catch (error) {
    return { ok: false, status: 0, text: "", error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function contactUrlsForWebsite(website) {
  const normalized = normalizeWebsite(website);
  if (!normalized) return [];
  const urls = new Set();
  try {
    const root = new URL(normalized);
    root.pathname = root.pathname && root.pathname !== "/" ? root.pathname : "/";
    root.search = "";
    urls.add(root.toString());
    ["/contact", "/contact/", "/contact.html", "/contact.php", "/over-ons", "/over-ons/", "/info", "/info/"].forEach((pathname) => {
      const url = new URL(root.origin);
      url.pathname = pathname;
      urls.add(url.toString());
    });
  } catch {
    return [];
  }
  return Array.from(urls).slice(0, 8);
}

function isComplete(company) {
  return Boolean(
    normalizeText(company.companyName)
    && normalizePhone(company.phone)
    && normalizeEmail(company.email)
    && normalizeText(company.location)
  );
}

function extractOlderUrl(html, baseUrl) {
  const match = String(html || "").match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*Ouder\s*<\/a>/i);
  if (!match) return "";
  try {
    return new URL(match[1], baseUrl || DRIMBLE_BASE_URL).toString();
  } catch {
    return "";
  }
}

function extractCandidatesFromHtml(html, options) {
  const place = normalizeText(options && options.place);
  const fallbackSourcePlace = normalizeText(options && options.sourcePlace) || place;
  const sourcePage = Number(options && options.sourcePage) || 1;
  const candidates = [];

  for (const match of String(html || "").matchAll(/<tr\s+class=["']row[23]["'][\s\S]*?<\/tr>/gi)) {
    const row = match[0];
    const urlMatch = row.match(/<a[^>]+href=["']([^"']*\/bedrijf\/[^"']+)["']/i)
      || row.match(/window\.location=['"]([^'"]*\/bedrijf\/[^'"]+)['"]/i);
    const nameMatch = row.match(/<b>([\s\S]*?)<\/b>/i);
    const locationMatch = row.match(/<span>([\s\S]*?)<\/span>/i);
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) => stripTags(cell[1]));
    const sourceUrl = urlMatch ? new URL(urlMatch[1], DRIMBLE_BASE_URL).toString() : "";
    const companyName = nameMatch ? stripTags(nameMatch[1]) : "";
    const location = locationMatch ? stripTags(locationMatch[1]) : "";
    const addedAt = cells[0] || "";
    const sourcePlace = cells[2] || fallbackSourcePlace;
    const kvk = cells[cells.length - 1] || "";

    if (!sourceUrl || !companyName || !location) continue;
    candidates.push({
      companyName,
      phone: "",
      email: "",
      location,
      place,
      sourcePlace,
      addedAt,
      kvk,
      sourceUrl,
      sourcePage
    });
  }

  return candidates;
}

async function collectCandidatesFromPages(initialUrl, options) {
  const place = normalizeText(options && options.place);
  const sourceSlug = normalizeText(options && options.slug);
  const allowedSourcePlaces = new Set(
    (options && options.allowedSourcePlaces || [])
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean)
  );
  const seenUrls = new Set();
  const candidates = [];
  let url = initialUrl;
  let page = 1;

  while (url && !seenUrls.has(url) && page <= 250) {
    seenUrls.add(url);
    const response = await fetchText(url, 15000);
    if (!response.ok) break;
    const sourcePlaceMatch = response.text.match(/<h1[^>]*>\s*Bedrijven in\s+([^<]+)<\/h1>/i);
    const sourcePlace = sourcePlaceMatch ? stripTags(sourcePlaceMatch[1]) : place;
    const allPageCandidates = extractCandidatesFromHtml(response.text, {
      place,
      sourcePlace,
      sourcePage: page
    });
    const pageCandidates = allPageCandidates.filter((candidate) => {
      if (!allowedSourcePlaces.size) return true;
      return allowedSourcePlaces.has(normalizeText(candidate.sourcePlace).toLowerCase());
    });
    candidates.push(...pageCandidates);
    const olderUrl = extractOlderUrl(response.text, response.url || url);
    if (!olderUrl || allPageCandidates.length === 0) break;
    url = olderUrl;
    page += 1;
    await delay(120);
  }

  return { candidates, pages: seenUrls.size, slug: sourceSlug };
}

async function fetchCandidatesForPlace(place, municipality) {
  const slug = drimbleSlugForPlace(place);
  if (!slug) return { candidates: [], pages: 0, slug: "" };

  const direct = await collectCandidatesFromPages(`${DRIMBLE_BASE_URL}/bedrijven/${slug}/`, {
    place,
    slug
  });
  if (direct.candidates.length || !municipality) return direct;

  const municipalitySlug = slugifyPlace(municipality);
  if (!municipalitySlug) return direct;
  const fallback = await collectCandidatesFromPages(`${DRIMBLE_BASE_URL}/bedrijven/gemeente/${municipalitySlug}/`, {
    place,
    slug: `${municipalitySlug}:${slug}`,
    allowedSourcePlaces: drimbleSourcePlacesForPlace(place)
  });

  return fallback.candidates.length ? fallback : direct;
}

async function ensureCandidates(data, target, place, municipality) {
  const scopedCompanies = (data.companies || []).filter((company) => normalizeText(company.place) === place);
  if (scopedCompanies.length > 0 && !refreshCandidates) return scopedCompanies;

  const fetched = await fetchCandidatesForPlace(place, municipality);
  if (!fetched.candidates.length) {
    throw new Error(`Geen kandidaatbedrijven gevonden voor ${place}`);
  }

  const existingKeys = new Set((data.companies || []).map((company) => {
    return normalizeText(company.sourceUrl) || [
      normalizeText(company.kvk),
      normalizeText(company.companyName).toLowerCase(),
      normalizeText(company.location).toLowerCase()
    ].join("|");
  }));
  const added = [];

  fetched.candidates.forEach((candidate) => {
    const key = normalizeText(candidate.sourceUrl) || [
      normalizeText(candidate.kvk),
      normalizeText(candidate.companyName).toLowerCase(),
      normalizeText(candidate.location).toLowerCase()
    ].join("|");
    if (!key || existingKeys.has(key)) return;
    existingKeys.add(key);
    added.push(candidate);
  });

  data.companies = Array.isArray(data.companies) ? data.companies : [];
  data.companies.push(...added);
  target.candidateCount = fetched.candidates.length;
  target.rawCompanyCount = fetched.candidates.length;
  target.companySourceSlug = fetched.slug;
  target.companySourcePages = fetched.pages;
  target.updatedAt = new Date().toISOString();
  data.updatedAt = target.updatedAt;

  console.log(JSON.stringify({
    event: "candidates",
    location: activeLabel,
    place,
    slug: fetched.slug,
    pages: fetched.pages,
    found: fetched.candidates.length,
    added: added.length
  }));

  return (data.companies || []).filter((company) => normalizeText(company.place) === place);
}

async function loadData() {
  return JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
}

async function saveData(data, target, scopedCompanies, progress) {
  const completeCount = scopedCompanies.filter(isComplete).length;
  target.completeCompanyCount = completeCount;
  target.checkedCompanyCount = scopedCompanies.filter((company) => company.contactCheckedAt).length;
  target.candidateCount = scopedCompanies.length;
  target.updatedAt = new Date().toISOString();
  data.updatedAt = target.updatedAt;
  data.diagnostics = data.diagnostics || {};
  data.diagnostics.oirschotContactScan = {
    activeLocation: activeLabel,
    checked: target.checkedCompanyCount,
    total: scopedCompanies.length,
    complete: completeCount,
    withWebsite: scopedCompanies.filter((company) => company.website).length,
    errors: progress.errors,
    running: progress.running,
    updatedAt: target.updatedAt
  };
  if (markDone && target.checkedCompanyCount >= scopedCompanies.length && scopedCompanies.length > 0) {
    target.status = "done";
    if (data.activeLocation === activeLabel) data.activeLocation = "";
  }
  const tmpPath = DATA_PATH + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n");
  await fs.rename(tmpPath, DATA_PATH);
}

async function enrichCompany(company) {
  company.contactStatus = "checking";
  company.contactStartedAt = new Date().toISOString();

  if (company.sourceUrl) {
    const detail = await fetchText(company.sourceUrl, 15000);
    if (detail.ok) {
      mergeContact(company, extractContactFromHtml(detail.text, { allowLooseHtml: false }), company.sourceUrl);
    } else {
      company.contactError = `detail:${detail.status || detail.error || "failed"}`;
    }
  }

  if (deepScan && (!company.phone || !company.email) && company.website) {
    for (const url of contactUrlsForWebsite(company.website)) {
      if (company.phone && company.email) break;
      const websitePage = await fetchText(url, 12000);
      if (!websitePage.ok) continue;
      mergeContact(company, extractContactFromHtml(websitePage.text, { allowLooseHtml: true }), websitePage.url || url);
      await delay(100);
    }
  }

  company.contactCheckedAt = new Date().toISOString();
  company.contactStatus = isComplete(company) ? "complete" : "incomplete";
}

async function main() {
  const data = await loadData();
  const target = (data.targets || []).find((item) => item.label === activeLabel);
  if (!target) throw new Error(`Locatie niet gevonden: ${activeLabel}`);
  target.status = "active";
  data.activeLocation = activeLabel;

  const place = activeLabel.split("|").map((part) => part.trim()).filter(Boolean).pop();
  const locationParts = activeLabel.split("|").map((part) => part.trim()).filter(Boolean);
  const municipality = locationParts.length >= 2 ? locationParts[locationParts.length - 2] : "";
  let scopedCompanies = await ensureCandidates(data, target, place, municipality);
  const queue = scopedCompanies
    .filter((company) => force || !company.contactCheckedAt)
    .slice(0, limit || undefined);
  const progress = { checked: 0, errors: 0, running: true };

  console.log(JSON.stringify({
    event: "start",
    location: activeLabel,
    candidates: scopedCompanies.length,
    queued: queue.length,
    concurrency,
    deepScan
  }));

  await saveData(data, target, scopedCompanies, progress);

  let nextIndex = 0;
  let lastFlush = 0;
  let flushLock = Promise.resolve();

  async function maybeSave(forceSave = false) {
    if (!forceSave && Date.now() - lastFlush < 3000) return;
    lastFlush = Date.now();
    flushLock = flushLock.then(() => saveData(data, target, scopedCompanies, progress));
    await flushLock;
  }

  async function worker(workerId) {
    while (nextIndex < queue.length) {
      const company = queue[nextIndex++];
      try {
        await enrichCompany(company);
      } catch (error) {
        progress.errors += 1;
        company.contactStatus = "error";
        company.contactError = error.message;
        company.contactCheckedAt = new Date().toISOString();
      }
      progress.checked += 1;
      if (progress.checked % 10 === 0 || isComplete(company)) {
        const complete = scopedCompanies.filter(isComplete).length;
        console.log(JSON.stringify({
          event: "progress",
          workerId,
          checked: scopedCompanies.filter((item) => item.contactCheckedAt).length,
          total: scopedCompanies.length,
          complete,
          lastCompany: company.companyName,
          status: company.contactStatus
        }));
      }
      await maybeSave(false);
      await delay(160);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
  progress.running = false;
  await maybeSave(true);

  console.log(JSON.stringify({
    event: "done",
    location: activeLabel,
    checked: scopedCompanies.filter((company) => company.contactCheckedAt).length,
    total: scopedCompanies.length,
    complete: scopedCompanies.filter(isComplete).length,
    errors: progress.errors
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
