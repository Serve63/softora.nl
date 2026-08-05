#!/usr/bin/env node

const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { DomUtils, parseDocument } = require('htmlparser2');
const {
  loadTransferwereldDataset,
  writeTransferwereldDataset,
} = require('./transferwereld-data-io');

const OPTA_URL = 'https://dataviz.theanalyst.com/opta-power-rankings/index.js';
const TRANSFERMARKT_ORIGIN = 'https://www.transfermarkt.com';
const TRANSFERMARKT_FETCH_ORIGINS = [
  'https://www.transfermarkt.us',
  'https://www.transfermarkt.co.uk',
  'https://www.transfermarkt.com',
  'https://www.transfermarkt.de',
  'https://www.transfermarkt.fr',
  'https://www.transfermarkt.es',
  'https://www.transfermarkt.it',
  'https://www.transfermarkt.nl',
];
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36';
const REQUEST_DELAY_MS = 175;
const execFileAsync = promisify(execFile);
let transferBrowserPromise;

const searchAliases = {
  'Athletic Club': 'Athletic Bilbao',
  'Atlético Nacional': 'Atletico Nacional',
  'Bayern München': 'Bayern Munich',
  'Bodø / Glimt': 'Bodo Glimt',
  'Celta de Vigo': 'Celta Vigo',
  Como: 'Como 1907',
  'Independiente Valle': 'Independiente del Valle',
  Internazionale: 'Inter Milan',
  Milan: 'AC Milan',
  'Olympiakos Piraeus': 'Olympiacos Piraeus',
  Roma: 'AS Roma',
  'Sporting Braga': 'SC Braga',
  Zenit: 'Zenit St Petersburg',
};

const knownClubIds = {
  Arsenal: { id: 11, slug: 'fc-arsenal' },
  'Bayern München': { id: 27, slug: 'fc-bayern-munchen' },
  'Manchester City': { id: 281, slug: 'manchester-city' },
  'Paris Saint-Germain': { id: 583, slug: 'fc-paris-saint-germain' },
  Barcelona: { id: 131, slug: 'fc-barcelona' },
  'Manchester United': { id: 985, slug: 'manchester-united' },
  'Real Madrid': { id: 418, slug: 'real-madrid' },
  Internazionale: { id: 46, slug: 'inter-mailand' },
  Liverpool: { id: 31, slug: 'fc-liverpool' },
  'Borussia Dortmund': { id: 16, slug: 'borussia-dortmund' },
  Milan: { id: 5, slug: 'ac-mailand' },
  Palmeiras: { id: 1023, slug: 'se-palmeiras-sao-paulo' },
  Cruzeiro: { id: 609, slug: 'ec-cruzeiro-belo-horizonte' },
  Botafogo: { id: 537, slug: 'botafogo-rio-de-janeiro' },
  'Eintracht Frankfurt': { id: 24, slug: 'eintracht-frankfurt' },
  'Al Hilal': { id: 1114, slug: 'al-hilal-riad' },
  'AEK Athens': { id: 2441, slug: 'aek-athen' },
  Ajax: { id: 610, slug: 'ajax-amsterdam' },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTransferBrowser() {
  if (!process.env.TRANSFER_BROWSER_EXECUTABLE) {
    throw new Error('TRANSFER_BROWSER_EXECUTABLE is not configured');
  }
  if (!transferBrowserPromise) {
    const { chromium } = require('playwright');
    transferBrowserPromise = chromium.launch({
      headless: true,
      executablePath: process.env.TRANSFER_BROWSER_EXECUTABLE,
    });
  }
  return transferBrowserPromise;
}

async function fetchTransfermarktBrowser(relativePath) {
  const browser = await getTransferBrowser();
  const page = await browser.newPage({ locale: 'en-GB' });
  try {
    const response = await page.goto(`${TRANSFERMARKT_ORIGIN}${relativePath}`, {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
    if (!response?.ok()) throw new Error(`Browser HTTP ${response?.status() || 'unknown'}`);
    if (/\/kader\/verein\//.test(relativePath)) {
      await page.waitForSelector('a[href*="/profil/spieler/"]', { timeout: 12_000 });
    }
    const bodyText = await page.locator('body').innerText();
    if (/verify that you're not a robot|502 bad gateway/i.test(bodyText)) throw new Error('Browser challenge response');
    return page.content();
  } finally {
    await page.close();
  }
}

async function closeTransferBrowser() {
  if (!transferBrowserPromise) return;
  const browser = await transferBrowserPromise;
  transferBrowserPromise = undefined;
  await browser.close();
}

async function fetchText(url, options = {}) {
  const attempts = options.attempts || 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, {
        headers: {
          'accept-language': 'en-GB,en;q=0.9',
          'user-agent': USER_AGENT,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length < 500) throw new Error(`Unexpected short response (${body.length} bytes)`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1_600);
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

async function fetchTransfermarkt(relativePath, seed = 0) {
  const isClubPage = /\/(transfers|kader|geruechte)\/verein\//.test(relativePath);
  let lastError;
  if (isClubPage && process.env.TRANSFER_BROWSER_FALLBACK === '1') {
    try {
      return await fetchTransfermarktBrowser(relativePath);
    } catch (error) {
      lastError = error;
    }
  }
  const attempts = isClubPage ? 7 : TRANSFERMARKT_FETCH_ORIGINS.length;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const useReader = isClubPage && attempt === 1;
    const directAttempt = attempt === 0 ? 0 : attempt - 1;
    const origin = TRANSFERMARKT_FETCH_ORIGINS[(seed + directAttempt) % TRANSFERMARKT_FETCH_ORIGINS.length];
    try {
      const url = useReader
        ? `https://r.jina.ai/http://www.transfermarkt.com${relativePath}`
        : `${origin}${relativePath}`;
      const { stdout } = await execFileAsync('curl', [
        '--fail',
        '--max-time',
        useReader ? '35' : (isClubPage ? '9' : '18'),
        '-L',
        '--compressed',
        ...(useReader ? ['-H', 'X-Return-Format: html'] : []),
        ...(!useReader ? ['-A', USER_AGENT] : []),
        '-sS',
        url,
      ], { maxBuffer: 25 * 1024 * 1024, timeout: useReader ? 40_000 : (isClubPage ? 12_000 : 22_000) });
      if (stdout.length < 500) throw new Error(`Unexpected short response (${stdout.length} bytes)`);
      if (/AwsWafIntegration|challenge-container|verify that you're not a robot|502 Bad Gateway|upstream connect error/i.test(stdout)) {
        throw new Error('Anti-bot challenge response');
      }
      if (/\/kader\/verein\//.test(relativePath) && !/\/profil\/spieler\/\d+/.test(stdout)) {
        throw new Error('Squad page contains no player rows');
      }
      return stdout;
    } catch (error) {
      lastError = error;
      await sleep(350 + attempt * 250);
    }
  }
  throw new Error(`${relativePath}: ${lastError.message}`);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|cf|afc|ac|as|ss|sc|fk|bv|rc|cd|sd|sv|tsg|gnk|krc|csd)\b/g, ' ')
    .replace(/\b(football club|futbol club|sporting club|club de futbol)\b/g, ' ')
    .replace(/\b(18|19|20|21|23|1899|1907|1909|1925|1967)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  const matrix = Array.from({ length: a.length + 1 }, (_, row) => [row]);
  for (let column = 0; column <= b.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length][b.length];
}

function similarity(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = union ? intersection / union : 0;
  const containment = a.includes(b) || b.includes(a) ? 0.94 : 0;
  return Math.max(containment, editScore * 0.7 + tokenScore * 0.3);
}

function isReserveCandidate(name) {
  return /\b(u[- ]?(18|19|20|21|23)|ii|b team|reserves?|academy|youth|juvenil|primavera)\b/i.test(name);
}

function transfermarktSeasonId(team) {
  return team.confederation === 'South America' || team.country === 'Norway' ? 2025 : 2026;
}

function extractOptaTop100(source) {
  const marker = 'f6=JSON.parse(`';
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf('`),v6=', start);
  if (start < marker.length || end < start) throw new Error('Opta ranking payload not found');
  const payload = source.slice(start, end);
  if (payload.includes('${')) throw new Error('Unexpected template expression in Opta payload');
  const allTeams = vm.runInNewContext(`JSON.parse(\`${payload}\`)`);
  const updatedMatch = source.match(/const N0="([^"]+)"/);
  const teams = allTeams
    .filter((team) => Number(team.currentGlobalRank) <= 100)
    .sort((left, right) => Number(left.currentGlobalRank) - Number(right.currentGlobalRank))
    .map((team) => ({
      rank: Number(team.currentGlobalRank),
      name: team.contestantName,
      fullName: team.contestantClubName,
      shortName: team.contestantShortName,
      code: team.contestantCode,
      rating: Number(Number(team.currentRating).toFixed(2)),
      country: team.country,
      confederation: team.confederation,
      leagueId: team.domesticLeagueId,
      league: team.domesticLeagueName,
      optaId: team.contestantId,
      badge: `https://omo.akamai.opta.net/image.php?secure=true&h=omo.akamai.opta.net&sport=football&entity=team&description=badges&dimensions=150&id=${team.contestantId}`,
  }));
  if (teams.length !== 100) throw new Error(`Expected 100 Opta teams, found ${teams.length}`);
  const ajax = allTeams.find((team) => team.contestantName === 'Ajax');
  if (!ajax) throw new Error('Ajax is missing from the Opta ranking payload');
  teams.push({
    rank: Number(ajax.currentGlobalRank),
    name: ajax.contestantName,
    fullName: ajax.contestantClubName,
    shortName: ajax.contestantShortName,
    code: ajax.contestantCode,
    rating: Number(Number(ajax.currentRating).toFixed(2)),
    country: ajax.country,
    confederation: ajax.confederation,
    leagueId: ajax.domesticLeagueId,
    league: ajax.domesticLeagueName,
    optaId: ajax.contestantId,
    badge: `https://omo.akamai.opta.net/image.php?secure=true&h=omo.akamai.opta.net&sport=football&entity=team&description=badges&dimensions=150&id=${ajax.contestantId}`,
    isWildcard: true,
  });
  const leagueIds = new Set(teams.map((team) => team.leagueId).filter(Boolean));
  const leagueMap = new Map();
  for (const team of allTeams) {
    if (!leagueIds.has(team.domesticLeagueId) || !team.contestantName || Number(team.currentGlobalRank) <= 0) continue;
    if (!leagueMap.has(team.domesticLeagueId)) {
      leagueMap.set(team.domesticLeagueId, {
        id: team.domesticLeagueId,
        name: team.domesticLeagueName,
        country: team.country,
        teams: [],
      });
    }
    leagueMap.get(team.domesticLeagueId).teams.push({
      name: team.contestantName,
      shortName: team.contestantShortName,
      code: team.contestantCode,
      rating: Number(Number(team.currentRating).toFixed(2)),
      seasonAverageRating: Number(Number(team.seasonAverageRating || team.currentRating).toFixed(2)),
      lastWeekRating: Number(Number(team.lastWeekRating || team.currentRating).toFixed(2)),
      globalRank: Number(team.currentGlobalRank),
      optaId: team.contestantId,
    });
  }
  const leagues = [...leagueMap.values()]
    .map((league) => ({
      ...league,
      teams: league.teams.sort((left, right) => right.rating - left.rating),
    }))
    .filter((league) => league.teams.length >= 7)
    .sort((left, right) => left.name.localeCompare(right.name));
  return { teams, leagues, rankingUpdated: updatedMatch ? updatedMatch[1] : 'Aug 3, 2026' };
}

function allElements(root, predicate) {
  return DomUtils.findAll(predicate, Array.isArray(root) ? root : [root]);
}

function extractClubCandidates(html) {
  const document = parseDocument(html);
  const links = allElements(document.children, (node) => {
    if (node.type !== 'tag' || node.name !== 'a') return false;
    return /\/startseite\/verein\/\d+/.test(node.attribs?.href || '');
  });
  const candidates = [];
  const seen = new Set();
  for (const link of links) {
    const href = link.attribs.href;
    const match = href.match(/^\/([^/]+)\/startseite\/verein\/(\d+)/);
    if (!match) continue;
    const name = cleanText(link.attribs.title || DomUtils.getText(link));
    const id = Number(match[2]);
    if (!name || seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, slug: match[1], name });
  }
  return candidates;
}

function chooseCandidate(team, candidates) {
  const variants = [
    team.name,
    team.fullName,
    team.shortName,
    searchAliases[team.name],
  ].filter(Boolean);
  return candidates
    .map((candidate) => {
      let score = Math.max(...variants.map((variant) => similarity(variant, candidate.name)));
      if (isReserveCandidate(candidate.name)) score -= 0.55;
      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score)[0];
}

async function resolveTransfermarktClubs(teams) {
  const existingByName = new Map([...loadExistingClubs().values()].map((club) => [club.name, club.transfermarkt]));
  const marketCandidates = [];
  if (existingByName.size < teams.length) {
    for (let page = 1; page <= 4; page += 1) {
      const suffix = page === 1 ? '' : `/page/${page}`;
      try {
        const html = await fetchTransfermarkt(`/vereinsstatistik/wertvollstemannschaften/marktwertetop${suffix}`, page);
        marketCandidates.push(...extractClubCandidates(html));
      } catch (error) {
        console.warn(`Market-value page ${page} unavailable; falling back to club search.`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const resolved = new Array(teams.length);
  const unresolved = [];
  for (const [index, team] of teams.entries()) {
    const known = knownClubIds[team.name] || existingByName.get(team.name);
    if (known) {
      resolved[index] = { ...team, transfermarkt: { ...known, name: known.matchedName || team.fullName, score: 1 } };
      continue;
    }

    const match = chooseCandidate(team, marketCandidates);
    if (match && match.score >= 0.72) {
      resolved[index] = { ...team, transfermarkt: match };
    } else {
      unresolved.push({ team, index });
    }
  }

  let searched = 0;
  await mapWithConcurrency(unresolved, 5, async ({ team, index }) => {
    const query = encodeURIComponent(searchAliases[team.name] || team.name);
    const html = await fetchTransfermarkt(`/schnellsuche/ergebnis/schnellsuche?query=${query}`, index);
    const match = chooseCandidate(team, extractClubCandidates(html));
    if (!match || match.score < 0.58) {
      throw new Error(`No confident Transfermarkt match for ${team.name}; best=${match?.name || 'none'} (${match?.score || 0})`);
    }
    resolved[index] = { ...team, transfermarkt: match };
    searched += 1;
    process.stdout.write(`\rResolved searches ${searched}/${unresolved.length}`);
  });
  process.stdout.write(`\nResolved all ${resolved.length} clubs\n`);
  return resolved;
}

function directChildren(node, tagName) {
  return (node.children || []).filter((child) => child.type === 'tag' && child.name === tagName);
}

function firstElement(root, predicate) {
  return allElements(root, predicate)[0];
}

function parseFeeValue(label) {
  const normalized = String(label || '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, '');
  if (!normalized.includes('€')) return 0;
  const match = normalized.match(/€?([0-9]+(?:\.[0-9]+)?)(mio\.?|mill\.?|mln\.?|mila|mil|m|k)?€?/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (['m', 'mio', 'mio.', 'mill', 'mill.', 'mln', 'mln.'].includes(match[2])) return Math.round(amount * 1_000_000);
  if (['k', 'mil', 'mila'].includes(match[2])) return Math.round(amount * 1_000);
  return Math.round(amount);
}

function extractTransfers(html, direction) {
  const document = parseDocument(html);
  const heading = firstElement(document.children, (node) => (
    node.type === 'tag'
    && node.name === 'h2'
    && (
      cleanText(DomUtils.getText(node)).toLowerCase() === direction.toLowerCase()
      || node.attribs?.name === (direction === 'Arrivals' ? 'zugaenge' : 'abgaenge')
    )
  ));
  if (!heading) return [];
  let box = heading.parent;
  while (box && !(box.type === 'tag' && String(box.attribs?.class || '').split(/\s+/).includes('box'))) box = box.parent;
  if (!box) return [];
  const table = firstElement(box.children, (node) => (
    node.type === 'tag'
    && node.name === 'table'
    && String(node.attribs?.class || '').split(/\s+/).includes('items')
  ));
  const tbody = table && firstElement(table.children, (node) => node.type === 'tag' && node.name === 'tbody');
  if (!tbody) return [];

  return directChildren(tbody, 'tr').map((row) => {
    const cells = directChildren(row, 'td');
    if (cells.length < 6) return null;
    const playerLink = firstElement(cells[1], (node) => (
      node.type === 'tag' && node.name === 'a' && /\/profil\/spieler\/\d+/.test(node.attribs?.href || '')
    ));
    if (!playerLink) return null;
    const playerName = cleanText(playerLink.attribs.title || DomUtils.getText(playerLink));
    const nestedRows = allElements(cells[1], (node) => node.type === 'tag' && node.name === 'tr');
    const position = cleanText(nestedRows[1] ? DomUtils.getText(nestedRows[1]) : 'Onbekend');
    const playerImage = firstElement(cells[1], (node) => node.type === 'tag' && node.name === 'img');
    const nationalityImage = firstElement(cells[3], (node) => node.type === 'tag' && node.name === 'img');
    const clubLink = firstElement(cells[4], (node) => (
      node.type === 'tag' && node.name === 'a' && /\/startseite\/verein\/\d+/.test(node.attribs?.href || '')
    ));
    const feeLink = firstElement(cells[5], (node) => node.type === 'tag' && node.name === 'a');
    const fee = cleanText(DomUtils.getText(cells[5])) || 'Onbekend';
    return {
      direction: direction === 'Arrivals' ? 'in' : 'out',
      player: playerName,
      position,
      age: Number(cleanText(DomUtils.getText(cells[2]))) || null,
      nationality: cleanText(nationalityImage?.attribs?.alt),
      counterpart: cleanText(clubLink?.attribs?.title || (clubLink ? DomUtils.getText(clubLink) : DomUtils.getText(cells[4]))),
      fee,
      feeValue: parseFeeValue(fee),
      transferId: feeLink?.attribs?.href?.match(/transfer_id\/(\d+)/)?.[1] || '',
    };
  }).filter((transfer) => transfer && !/\b(u[- ]?(18|19|20|21|23)|academy|youth|juvenil|primavera)\b/i.test(transfer.counterpart));
}

function extractSquad(html) {
  const document = parseDocument(html);
  const tables = allElements(document.children, (node) => (
    node.type === 'tag'
    && node.name === 'table'
    && String(node.attribs?.class || '').split(/\s+/).includes('items')
  ));
  const table = tables.find((candidate) => {
    const heading = cleanText(DomUtils.getText(firstElement(candidate.children, (node) => node.type === 'tag' && node.name === 'thead')));
    return /player|spieler|joueur|jugador|giocatore|speler/i.test(heading)
      && /market value|marktwert|marktwaarde|valeur marchande|valor de mercado|valore di mercato/i.test(heading);
  });
  const tbodies = table ? allElements(table.children, (node) => node.type === 'tag' && node.name === 'tbody') : [];
  if (!tbodies.length) return [];
  return tbodies.flatMap((tbody) => directChildren(tbody, 'tr')).map((row) => {
    const cells = directChildren(row, 'td');
    if (cells.length < 6) return null;
    const playerLink = firstElement(cells[1], (node) => (
      node.type === 'tag' && node.name === 'a' && /\/profil\/spieler\/\d+/.test(node.attribs?.href || '')
    ));
    if (!playerLink) return null;
    const nestedRows = allElements(cells[1], (node) => node.type === 'tag' && node.name === 'tr');
    const nationalityImage = firstElement(cells[3], (node) => node.type === 'tag' && node.name === 'img');
    const marketValue = cleanText(DomUtils.getText(cells[5]));
    return {
      player: cleanText(playerLink.attribs.title || DomUtils.getText(playerLink)),
      position: cleanText(nestedRows[1] ? DomUtils.getText(nestedRows[1]) : cells[0].attribs?.title),
      age: Number(cleanText(DomUtils.getText(cells[2]))) || null,
      nationality: cleanText(nationalityImage?.attribs?.alt),
      marketValue,
      marketValueNumber: parseFeeValue(marketValue),
    };
  }).filter(Boolean);
}

function extractRumours(html) {
  const document = parseDocument(html);
  const rows = allElements(document.children, (node) => node.type === 'tag' && node.name === 'tr');
  return rows.map((row) => {
    const cells = directChildren(row, 'td');
    if (cells.length < 7) return null;
    const playerLink = firstElement(cells[1], (node) => (
      node.type === 'tag' && node.name === 'a' && /\/profil\/spieler\/\d+/.test(node.attribs?.href || '')
    ));
    const probabilityMatch = cleanText(DomUtils.getText(cells.at(-1))).match(/(\d+)\s*%/);
    if (!playerLink || !probabilityMatch) return null;
    const nestedRows = allElements(cells[1], (node) => node.type === 'tag' && node.name === 'tr');
    const playerImage = firstElement(cells[1], (node) => node.type === 'tag' && node.name === 'img');
    const currentClubLink = firstElement(cells[4], (node) => (
      node.type === 'tag' && node.name === 'a' && /\/geruechte\/verein\/\d+/.test(node.attribs?.href || '')
    ));
    const sourceLink = firstElement(cells[6], (node) => node.type === 'tag' && node.name === 'a');
    const marketValue = cleanText(DomUtils.getText(cells[5]));
    return {
      player: cleanText(playerLink.attribs.title || DomUtils.getText(playerLink)),
      position: cleanText(nestedRows[1] ? DomUtils.getText(nestedRows[1]) : ''),
      age: Number(cleanText(DomUtils.getText(cells[3]))) || null,
      currentClub: cleanText(currentClubLink?.attribs?.title || DomUtils.getText(cells[4])),
      marketValue,
      marketValueNumber: parseFeeValue(marketValue),
      probability: Number(probabilityMatch[1]),
      updated: cleanText(DomUtils.getText(cells[6])),
      image: playerImage?.attribs?.['data-src'] || playerImage?.attribs?.src || '',
      profile: `${TRANSFERMARKT_ORIGIN}${playerLink.attribs.href}`,
      source: sourceLink?.attribs?.href || '',
    };
  }).filter(Boolean).sort((left, right) => right.probability - left.probability).slice(0, 12);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => next()));
  return results;
}

function loadExistingClubs() {
  try {
    return new Map((loadTransferwereldDataset().clubs || []).map((club) => [club.transfermarkt?.id, club]));
  } catch {
    return new Map();
  }
}

async function addClubData(teams, existingClubs = new Map()) {
  let complete = 0;
  const enriched = await mapWithConcurrency(teams, 4, async (team, index) => {
    const { id, slug } = team.transfermarkt;
    const existing = existingClubs.get(id);
    const seasonId = transfermarktSeasonId(team);
    const canReuseSeasonData = existing?.transfermarkt?.seasonId === seasonId
      || (!existing?.transfermarkt?.seasonId && seasonId === 2026);
    const warnings = [];
    const base = `/${slug}`;
    let arrivals = canReuseSeasonData ? (existing?.arrivals || []) : [];
    let departures = canReuseSeasonData ? (existing?.departures || []) : [];
    let squad = canReuseSeasonData ? (existing?.squad || []) : [];
    let rumours = existing?.rumours || [];

    if (!arrivals.length && !departures.length) {
      try {
        const html = await fetchTransfermarkt(`${base}/transfers/verein/${id}/saison_id/${seasonId}`, index * 3);
        arrivals = extractTransfers(html, 'Arrivals');
        departures = extractTransfers(html, 'Departures');
      } catch (error) {
        warnings.push('Transfers niet opgehaald');
      }
    }
    if (squad.length < 16) {
      try {
        const html = await fetchTransfermarkt(`${base}/kader/verein/${id}/saison_id/${seasonId}`, index * 3 + 1);
        squad = extractSquad(html);
        if (squad.length < 16) throw new Error(`Only ${squad.length} squad rows parsed`);
      } catch (error) {
        warnings.push('Selectie niet opgehaald');
      }
    }
    if (!rumours.length) {
      try {
        const html = await fetchTransfermarkt(`${base}/geruechte/verein/${id}`, index * 3 + 2);
        rumours = extractRumours(html);
      } catch (error) {
        warnings.push('Geruchten niet opgehaald');
      }
    }

    complete += 1;
    process.stdout.write(`\rFetched club data ${complete}/${teams.length}`);
    await sleep(REQUEST_DELAY_MS);
    const { dataWarning: _previousDataWarning, ...cleanTeam } = team;
    return {
      ...cleanTeam,
      transfermarkt: {
        id,
        slug,
        seasonId,
        sourceUrl: `${TRANSFERMARKT_ORIGIN}/${slug}/transfers/verein/${id}/saison_id/${seasonId}`,
        matchedName: team.transfermarkt.name,
      },
      arrivals: arrivals.map(({ direction, player, position, age, counterpart, fee }) => (
        { direction, player, position, age, counterpart, fee, feeValue: parseFeeValue(fee) }
      )),
      departures: departures.map(({ direction, player, position, age, counterpart, fee }) => (
        { direction, player, position, age, counterpart, fee, feeValue: parseFeeValue(fee) }
      )),
      squad: squad.map(({ player, position, marketValueNumber }) => ({ player, position, marketValueNumber })),
      rumours: rumours.map(({ player, currentClub, marketValue, probability, updated, source }) => (
        { player, currentClub, marketValue, probability, updated, source }
      )),
      ...(existing?.context ? { context: existing.context } : {}),
      ...(existing?.contextWarning ? { contextWarning: existing.contextWarning } : {}),
      ...(warnings.length ? { dataWarning: warnings.join('; ') } : {}),
    };
  });
  process.stdout.write('\n');
  return enriched;
}

function writeData(payload) {
  const sizes = writeTransferwereldDataset(payload);
  console.log(`Wrote split transfer data (${sizes.baseBytes} + ${sizes.scopeBytes} bytes)`);
}

async function main() {
  try {
    console.log('Fetching Opta Power Ranking...');
    const optaSource = await fetchText(OPTA_URL);
    const { teams, leagues, rankingUpdated } = extractOptaTop100(optaSource);
    console.log(`Opta top 100 loaded (${rankingUpdated})`);
    const resolved = await resolveTransfermarktClubs(teams);
    const clubs = await addClubData(resolved, loadExistingClubs());
    const warnings = clubs.filter((club) => club.dataWarning).length;
    writeData({
      meta: {
        title: 'Transferwereld 100',
        season: 'Zomer 2026 / seizoen 2026–27',
        rankingUpdated,
        transfersFetchedAt: new Date().toISOString(),
        rankingSource: 'https://theanalyst.com/articles/who-are-the-best-football-team-in-the-world-opta-power-rankings',
        transferSource: TRANSFERMARKT_ORIGIN,
        warnings,
      },
      clubs,
      leagues,
    });
    if (warnings) process.exitCode = 2;
  } finally {
    await closeTransferBrowser();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  extractRumours,
  extractSquad,
  extractTransfers,
  extractClubCandidates,
  fetchTransfermarkt,
  addClubData,
  loadExistingClubs,
  parseFeeValue,
};
