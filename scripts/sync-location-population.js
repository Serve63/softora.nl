#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const DATA_PATH = path.join(process.cwd(), "assets", "premium-location-harvest-live.json");
const CBS_TABLE = "86165NED";
const CBS_BASE_URL = `https://opendata.cbs.nl/ODataApi/OData/${CBS_TABLE}`;
const CBS_FEED_BASE_URL = `https://opendata.cbs.nl/ODataFeed/OData/${CBS_TABLE}`;
const POPULATION_SOURCE = "CBS Kerncijfers wijken en buurten 2025";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitLabel(label) {
  return normalizeText(label).split("|").map((part) => part.trim()).filter(Boolean);
}

function placeAliases(place) {
  const normalized = normalizeKey(place);
  const aliases = new Set([normalized]);
  if (normalized === "oost west en middelbeers") {
    aliases.add("oostelbeers");
    aliases.add("middelbeers");
    aliases.add("westelbeers");
  }
  return aliases;
}

function regionPriority(row, place, municipality) {
  const type = normalizeKey(row.type);
  const placeKey = normalizeKey(place);
  const municipalityKey = normalizeKey(municipality);
  if (type === "wijk") return 1;
  if (type === "buurt") return 2;
  if (type === "gemeente" && placeKey === municipalityKey) return 3;
  if (type === "gemeente") return 8;
  return 9;
}

function matchesNumberedWijkTitle(row, aliases) {
  if (normalizeKey(row.type) !== "wijk") return false;
  const titleKey = normalizeKey(row.title);
  return Array.from(aliases).some((alias) => {
    return new RegExp(`^wijk [0-9]+ ${alias}(\\b|$)`).test(titleKey);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Softora location population sync"
    }
  });
  if (!response.ok) throw new Error(`CBS request failed ${response.status}: ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/atom+xml,text/xml",
      "user-agent": "Softora location population sync"
    }
  });
  if (!response.ok) throw new Error(`CBS request failed ${response.status}: ${url}`);
  return response.text();
}

async function fetchODataCollection(pathname) {
  const items = [];
  let url = `${CBS_BASE_URL}/${pathname}`;
  while (url) {
    const payload = await fetchJson(url);
    items.push(...(payload.value || []));
    url = payload["odata.nextLink"] || "";
  }
  return items;
}

function decodeXml(value) {
  return normalizeText(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractXmlTag(entry, tag) {
  const match = entry.match(new RegExp(`<d:${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/d:${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

async function fetchTypedDataRows() {
  const count = Number(await (await fetch(`${CBS_BASE_URL}/TypedDataSet/$count`)).text());
  const rows = [];
  const pageSize = 5000;
  for (let skip = 0; skip < count; skip += pageSize) {
    const xml = await fetchText(
      `${CBS_FEED_BASE_URL}/TypedDataSet?$top=${pageSize}&$skip=${skip}`
    );
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
    entries.forEach((entry) => {
      rows.push({
        WijkenEnBuurten: extractXmlTag(entry, "WijkenEnBuurten"),
        Gemeentenaam_1: extractXmlTag(entry, "Gemeentenaam_1"),
        SoortRegio_2: extractXmlTag(entry, "SoortRegio_2"),
        AantalInwoners_5: Number(extractXmlTag(entry, "AantalInwoners_5"))
      });
    });
  }
  return rows;
}

function choosePopulationMatch(rows, target) {
  const parts = splitLabel(target.label);
  const place = parts[parts.length - 1] || "";
  const municipality = parts[parts.length - 2] || "";
  const aliases = placeAliases(place);
  const municipalityKey = normalizeKey(municipality);

  const matches = rows
    .filter((row) => aliases.has(normalizeKey(row.title)))
    .filter((row) => !municipalityKey || normalizeKey(row.municipalityName) === municipalityKey)
    .filter((row) => Number.isFinite(Number(row.population)) && Number(row.population) > 0)
    .sort((left, right) => {
      const priorityDiff = regionPriority(left, place, municipality) - regionPriority(right, place, municipality);
      if (priorityDiff) return priorityDiff;
      return Number(right.population) - Number(left.population);
    });

  if (matches[0]) return matches[0];

  const numberedWijkMatches = rows
    .filter((row) => matchesNumberedWijkTitle(row, aliases))
    .filter((row) => !municipalityKey || normalizeKey(row.municipalityName) === municipalityKey)
    .filter((row) => Number.isFinite(Number(row.population)) && Number(row.population) > 0);

  if (numberedWijkMatches.length) {
    return {
      title: place,
      type: "Wijk",
      population: numberedWijkMatches.reduce((total, row) => total + Number(row.population), 0)
    };
  }

  return null;
}

function estimatePopulation(rows, target, municipalityTargetCounts) {
  const parts = splitLabel(target.label);
  const place = parts[parts.length - 1] || "";
  const municipality = parts[parts.length - 2] || "";
  const municipalityKey = normalizeKey(municipality);
  const municipalityRow = rows.find((row) => {
    return normalizeKey(row.type) === "gemeente"
      && normalizeKey(row.title) === municipalityKey
      && Number.isFinite(Number(row.population))
      && Number(row.population) > 0;
  });
  const municipalityPopulation = municipalityRow ? Number(municipalityRow.population) : 0;
  const targetCount = Math.max(1, municipalityTargetCounts.get(municipalityKey) || 1);
  const candidateEstimate = Number(target.candidateCount || target.rawCompanyCount || 0) * 12;
  const rawEstimate = municipalityPopulation ? municipalityPopulation / targetCount : (candidateEstimate || 1000);
  return {
    title: place,
    type: "Schatting",
    population: Math.max(50, Math.round(rawEstimate / 5) * 5)
  };
}

async function main() {
  const data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  const regions = await fetchODataCollection("WijkenEnBuurten");
  const regionByKey = new Map(regions.map((region) => [normalizeText(region.Key), region]));
  const rows = await fetchTypedDataRows();

  const populationRows = rows.map((row) => {
    const region = regionByKey.get(normalizeText(row.WijkenEnBuurten)) || {};
    return {
      key: normalizeText(row.WijkenEnBuurten),
      title: normalizeText(region.Title),
      municipalityName: normalizeText(row.Gemeentenaam_1),
      type: normalizeText(row.SoortRegio_2),
      population: Number(row.AantalInwoners_5)
    };
  }).filter((row) => row.title);

  const municipalityTargetCounts = new Map();
  (data.targets || []).forEach((target) => {
    const parts = splitLabel(target.label);
    const municipalityKey = normalizeKey(parts[parts.length - 2] || "");
    if (!municipalityKey) return;
    municipalityTargetCounts.set(municipalityKey, (municipalityTargetCounts.get(municipalityKey) || 0) + 1);
  });

  let matched = 0;
  let estimated = 0;
  const now = new Date().toISOString();

  data.targets = (data.targets || []).map((target) => {
    let match = choosePopulationMatch(populationRows, target);
    const isEstimate = !match;
    if (isEstimate) {
      match = estimatePopulation(populationRows, target, municipalityTargetCounts);
      estimated += 1;
    } else {
      matched += 1;
    }
    return {
      ...target,
      population: Math.round(Number(match.population)),
      populationEstimated: isEstimate,
      populationSource: isEstimate ? "Schatting op basis van CBS gemeentetotaal 2025" : POPULATION_SOURCE,
      populationRegionType: match.type,
      populationRegionName: match.title
    };
  });

  data.populationUpdatedAt = now;
  data.updatedAt = now;
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(JSON.stringify({ event: "population-sync", matched, estimated, source: POPULATION_SOURCE }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
