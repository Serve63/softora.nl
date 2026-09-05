const { parseDocument, DomUtils } = require('htmlparser2');
const { createHash } = require('node:crypto');
const SOURCES = Object.freeze([
  { id: 'bbc', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', home: 'https://www.bbc.com/news/world', hosts: ['www.bbc.co.uk', 'www.bbc.com', 'bbc.co.uk', 'bbc.com'] },
  { id: 'nos', name: 'NOS Buitenland', url: 'https://feeds.nos.nl/nosnieuwsbuitenland', home: 'https://nos.nl/nieuws/buitenland', hosts: ['nos.nl', 'www.nos.nl'] },
  { id: 'gdacs', name: 'GDACS', url: 'https://www.gdacs.org/xml/rss.xml', home: 'https://www.gdacs.org/', hosts: ['www.gdacs.org', 'gdacs.org'] },
]);
const REGIONS = Object.freeze([
  { id: 'ukraine', name: 'Oekraïne & Rusland', lat: 49, lon: 34, words: /ukrain|oekrai|russ|rusland|putin|poetin|kyiv|kiev|moscow|moskou|kremlin/i },
  { id: 'middle-east', name: 'Midden-Oosten', lat: 30, lon: 44, words: /iran|israel|israël|gaza|leban|libanon|hezbollah|houthi|yemen|jemen|hormuz|palestin|palestijn|syri|syrie|syrische/i },
  { id: 'taiwan', name: 'China & Taiwan', lat: 25, lon: 119, words: /taiwan|chin[ae]|chinese|beijing|peking|south china/i },
  { id: 'sudan', name: 'Soedan', lat: 15, lon: 30, words: /sudan|soedan|darfur|khartoum/i },
  { id: 'sahel', name: 'Sahel', lat: 16, lon: 2, words: /sahel|burkina|\bmali\b|\bniger\b|boko haram/i },
  { id: 'korea', name: 'Korea', lat: 38, lon: 127, words: /korea|koreaan|pyongyang/i },
  { id: 'south-asia', name: 'Zuid-Azië', lat: 29, lon: 73, words: /pakistan|kashmir|kasjmir|afghan|taliban|\bindia\b|indiase/i },
  { id: 'central-africa', name: 'Centraal-Afrika', lat: -2, lon: 25, words: /congo|rwanda|\bm23\b/i },
  { id: 'america', name: 'Noord-Amerika', lat: 39, lon: -98, words: /trump|washington|united states|verenigde staten|american|amerikaan|\bUS\b|pentagon|mexic/i },
  { id: 'south-america', name: 'Zuid-Amerika', lat: -7, lon: -65, words: /venezuel|maduro|colombi|brazili|brazil|ecuador|argentini/i },
  { id: 'europe', name: 'Europa', lat: 50, lon: 10, words: /europ|nato|navo|france|frankrijk|german|duits|brit|london|londen|poland|polen/i },
]);
const THREAT_WORDS = /war\b|oorlog|attack|aanval|aanslag|missile|raket|nuclear|nucleair|militar|militair|conflict|troop|troep|terror|sancti|sancties|drone|ceasefire|staakt.het.vuren|geweld|gewapend|escalat|defen|vrede|peace|wape|weapon|killerrobot|envoy|gezant|diploma|protest|verkiezing|election|\bcoup\b|rebell|olietanker|oil tanker/i;
const EVENT_TYPES = { EQ: 'Aardbeving', TC: 'Tropische storm', FL: 'Overstroming', VO: 'Vulkaan', DR: 'Droogte', WF: 'Natuurbrand', TS: 'Tsunami' };
const HOUR = 3600000;

function text(node, name) {
  const child = DomUtils.getElementsByTagName(name, node.children || [], true, 1)[0];
  return child ? DomUtils.textContent(child).trim() : '';
}
function clean(value, limit = 320) {
  return DomUtils.textContent(parseDocument(String(value || ''))).replace(/\s+/g, ' ').trim().slice(0, limit);
}
function safeArticleUrl(value, source) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !source.hosts.includes(url.hostname) || url.port || url.username || url.password) return null;
    url.protocol = 'https:'; return url.href;
  } catch { return null; }
}
function parseFeed(xml, source, now = Date.now()) {
  if (!/<rss[\s>]/i.test(xml) || !/<\/rss>/i.test(xml)) throw new Error('INVALID_FEED');
  const document = parseDocument(xml, { xmlMode: true });
  const nodes = DomUtils.getElementsByTagName('item', document.children, true);
  const items = [], seen = new Set();
  for (const node of nodes) {
    const title = clean(text(node, 'title'), 220), url = safeArticleUrl(text(node, 'link'), source);
    const published = Date.parse(text(node, 'pubDate'));
    if (!title || !url || seen.has(url) || !Number.isFinite(published) || published > now + 10 * 60000 || published < now - 7 * 24 * HOUR) continue;
    seen.add(url);
    const description = clean(text(node, 'description'));
    const item = { id: source.id + '-' + createHash('sha256').update(url).digest('hex').slice(0, 16), source: source.id, sourceName: source.name, title, description, url, publishedAt: new Date(published).toISOString() };
    if (source.id === 'gdacs') {
      const [lat, lon] = text(node, 'georss:point').split(/\s+/).map(Number);
      const level = text(node, 'gdacs:alertlevel').toLowerCase();
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !['red', 'orange', 'green'].includes(level)) continue;
      item.kind = 'nature'; item.level = level; item.lat = lat; item.lon = lon;
      item.eventType = EVENT_TYPES[text(node, 'gdacs:eventtype')] || 'Natuurrisico';
      item.region = clean(text(node, 'gdacs:country'), 80) || item.eventType;
      item.regionId = null; item.locationPrecision = 'provider';
    } else {
      const region = REGIONS.find((candidate) => candidate.words.test(title + ' ' + description));
      item.kind = THREAT_WORDS.test(title + ' ' + description) ? 'geopolitics' : 'world'; item.level = 'news';
      item.regionId = region?.id || null; item.region = region?.name || 'Wereld';
      item.lat = region?.lat ?? null; item.lon = region?.lon ?? null; item.locationPrecision = 'region';
    }
    items.push(item);
  }
  if (source.id === 'gdacs') items.sort((a, b) => ({red:3,orange:2,green:1}[b.level] - {red:3,orange:2,green:1}[a.level]) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return items.slice(0, source.id === 'gdacs' ? 60 : 40);
}
async function fetchFeed(fetchImpl, source) {
  const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(10000), redirect: 'error', headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'SoftoraWorldWatcher/1.0' } });
  if (!response.ok) throw new Error('SOURCE_UNAVAILABLE');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2500000) throw new Error('SOURCE_TOO_LARGE'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
function createWorldWatcherService({ fetchImpl = global.fetch, now = Date.now } = {}) {
  const lastGood = new Map(); let cached = null, expiresAt = 0, pending = null;
  async function refresh() {
    const checkedAt = now();
    const results = await Promise.allSettled(SOURCES.map(async (source) => {
      const items = parseFeed(await fetchFeed(fetchImpl, source), source, checkedAt);
      const record = { items, fetchedAt: new Date(checkedAt).toISOString() }; lastGood.set(source.id, record); return record;
    }));
    const items = [], sources = SOURCES.map((source, index) => {
      const result = results[index], previous = lastGood.get(source.id);
      const record = result.status === 'fulfilled' ? result.value : previous && checkedAt - Date.parse(previous.fetchedAt) < HOUR ? previous : null;
      const status = result.status === 'fulfilled' ? 'ready' : record ? 'stale' : 'unavailable';
      if (record) items.push(...record.items.map((item) => ({ ...item, stale: status === 'stale' })));
      return { id: source.id, name: source.name, url: source.home, status, fetchedAt: record?.fetchedAt || null, count: record?.items.length ?? null };
    });
    const usable = sources.some((source) => source.status !== 'unavailable');
    cached = { ok: usable, checkedAt: new Date(checkedAt).toISOString(), sources, items: items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)), regions: REGIONS.map(({ words, ...region }) => region) };
    expiresAt = checkedAt + (sources.every((source) => source.status === 'ready') ? 5 * 60000 : 30000);
    return cached;
  }
  return { async getSnapshot() {
    if (cached && now() < expiresAt) return cached;
    if (!pending) pending = refresh().finally(() => { pending = null; });
    return pending;
  } };
}
module.exports = { SOURCES, REGIONS, parseFeed, safeArticleUrl, createWorldWatcherService };
