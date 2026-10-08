'use strict';
const DAY_MS = 24 * 60 * 60 * 1000;
const TEMPORARY_MS = 30 * 60 * 1000;

function sourceKey(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch (_) { return ''; }
}

function sourceHold(row) {
  if (row.status !== 'error') return null;
  const message = String(row.error || '');
  const code = String(row.preparationCode || '');
  const recheck = (reason) => ({ duration: DAY_MS, requiresSourceRecheck: true, reason });
  if (/^De beeldgenerator heeft dit ontwerp geweigerd via het veiligheidsfilter\./.test(message)) {
    return recheck('De beeldgenerator weigerde dit ontwerp via het veiligheidsfilter.');
  }
  if (/^De screenshotdiensten leverden na drie pogingen/.test(message)) {
    return { duration: TEMPORARY_MS, reason: 'Screenshotdiensten tijdelijk niet beschikbaar; de website is niet afgekeurd.' };
  }
  if (/^De homepage-screenshot is geblokkeerd(?:, leeg)? of onleesbaar\./.test(message)) {
    return recheck('Het homepage-bronbeeld was geblokkeerd, leeg of onleesbaar.');
  }
  if (row.rejected === true || /WEBDESIGN_(?:PLACEHOLDER|PLATFORM)_WEBSITE/.test(code) ||
      /website lijkt in onderhoud|niet de eigen website van het bedrijf/i.test(message)) {
    return recheck('Geen bruikbare eigen bedrijfswebsite: onderhoud, geparkeerd of een platformpagina.');
  }
  // Image/provider/upload failures must remain retryable; these holds concern source analysis only.
  if (row.preparationPhase !== 'failed' && !/^Websiteanalyse mislukt:/i.test(message)) return null;
  if (code === 'WEBDESIGN_WEBSITE_DNS_MISSING' || /niet te vinden in DNS|ENOTFOUND|ENODATA|Domain .*could not be resolved/i.test(message)) {
    return recheck('Het websiteadres is niet te vinden in DNS.');
  }
  if (code === 'WEBDESIGN_WEBSITE_TLS_FAILED') return recheck('De website heeft geen werkende HTTPS- of HTTP-verbinding.');
  if (code === 'WEBDESIGN_EMPTY_WEBSITE' || /lege pagina|te weinig bruikbare inhoud|onvoldoende .*inhoud|geen bruikbare (?:pagina|website)|toegangscontrole of blokkeerpagina/i.test(message)) {
    return recheck('De website leverde geen bruikbare bedrijfsinhoud.');
  }
  if (/toegang \(403\)|niet .*beschikbaar \(404\)|(?:ophalen|website) \(410\)/i.test(message)) {
    return recheck('De websitebron weigert toegang of de opgegeven pagina bestaat niet meer.');
  }
  if (code === 'WEBDESIGN_WEBSITE_FETCH_FAILED' || /Kon deze website niet ophalen|Websiteanalyse duurde te lang|geen bruikbare (?:pagina|website)|onvoldoende .*inhoud|te weinig bruikbare inhoud|leeg|timeout|timed out|ETIMEDOUT|ECONNRESET|403|522/i.test(message)) {
    return { duration: TEMPORARY_MS, reason: 'De website was niet bereikbaar of leverde geen bruikbare inhoud.' };
  }
  return null;
}

function selectWebdesignSources(targets, history, now) {
  const latest = new Map();
  for (const row of history) {
    // Only a later success releases a previous source hold; unrelated failures do not.
    if (row.status !== 'done' && !sourceHold(row)) continue;
    const key = String(row.customer_id) + '\n' + sourceKey(row.website_url);
    const timestamp = Date.parse(row.finished_at || row.updated_at || row.created_at);
    if (Number.isFinite(timestamp) && (!latest.has(key) || timestamp > latest.get(key).timestamp)) latest.set(key, { row, timestamp });
  }
  return targets.map((target) => {
    const prior = latest.get(String(target.customerId) + '\n' + sourceKey(target.websiteUrl));
    const hold = prior && sourceHold(prior.row);
    const retryAt = hold ? prior.timestamp + hold.duration : 0;
    const held = Boolean(hold && (hold.requiresSourceRecheck || retryAt > now));
    return { customerId: target.customerId, websiteUrl: target.websiteUrl, eligible: !held,
      ...(held ? { reason: hold.reason, retryAt, ...(hold.requiresSourceRecheck ? { requiresSourceRecheck: true } : {}) } : {}) };
  });
}

function createWebdesignSourceSelectionResponse({ ownerKeyFromReq, dataOpsStore, now }) {
  return async (req, res) => {
    const owner = ownerKeyFromReq(req);
    if (!owner) return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
    const targets = req.body && req.body.targets;
    if (!Array.isArray(targets) || !targets.length || targets.length > 250 || targets.some((item) =>
      !item || typeof item.customerId !== 'string' || !item.customerId.trim() || item.customerId.length > 200 ||
      typeof item.websiteUrl !== 'string' || item.websiteUrl.length > 2000 || !sourceKey(item.websiteUrl))) {
      return res.status(400).json({ ok: false, error: 'Ongeldige bronselectie (maximaal 250 bedrijven).' });
    }
    try {
      if (typeof dataOpsStore?.listWebdesignSourceHistory !== 'function') throw new Error('Bronhistorie ontbreekt');
      const history = await dataOpsStore.listWebdesignSourceHistory(owner, [...new Set(targets.map((item) => item.customerId))]);
      if (!Array.isArray(history)) throw new Error('Bronhistorie onvolledig');
      return res.status(200).json({ ok: true, targets: selectWebdesignSources(targets, history, now()) });
    } catch (_) {
      return res.status(503).json({ ok: false, error: 'Eerdere websitefouten konden niet volledig worden gecontroleerd. Er is geen batch gestart; probeer later opnieuw.' });
    }
  };
}

module.exports = { sourceKey, selectWebdesignSources, createWebdesignSourceSelectionResponse };
