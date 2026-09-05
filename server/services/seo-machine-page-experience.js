const { isSeoAutomationExcludedPath } = require('./seo-machine-route-policy');

const MAX_EVIDENCE_AGE_MS = 60 * 60 * 1000;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const hasNote = (value) => typeof value === 'string' && value.trim().length >= 24;

function validatePageExperience(evidence, { url, liveCommit, nowMs = Date.now(), notBefore } = {}) {
  const errors = [];
  const fail = (message) => errors.push(`pageExperience: ${message}`);
  if (!evidence || evidence.schemaVersion !== 1) {
    return { status: 'blocked', errors: ['pageExperience: schemaVersion 1 met echt browserbewijs ontbreekt.'] };
  }
  if (evidence.url !== url || !/^https:\/\/www\.softora\.nl\//.test(String(url || ''))
    || isSeoAutomationExcludedPath(url)) fail('bewijs hoort niet bij de gekozen publieke URL.');
  if (!/^[a-f0-9]{40}$/i.test(String(liveCommit || '')) || evidence.liveCommit !== liveCommit) {
    fail('bewijs hoort niet bij de exacte live commit.');
  }
  const capturedMs = Date.parse(evidence.capturedAt || '');
  if (!Number.isFinite(capturedMs) || capturedMs > nowMs || nowMs - capturedMs > MAX_EVIDENCE_AGE_MS
    || (notBefore && capturedMs < Date.parse(notBefore))) fail('browserbewijs is verouderd of heeft een ongeldige datum.');
  if (!['iab', 'chrome'].includes(evidence.browser)) fail('expliciete interne browser of Chrome ontbreekt.');
  if (evidence.browser === 'chrome' && !['authenticated_session', 'user_step', 'explicit_request'].includes(evidence.chromeReason)) {
    fail('Chrome vereist een bestaande sessie, gebruikersstap of expliciet verzoek.');
  }
  const views = Array.isArray(evidence.views) ? evidence.views : [];
  if (views.length !== 2 || new Set(views.map((view) => view?.device)).size !== 2
    || !views.some((view) => view?.device === 'mobile') || !views.some((view) => view?.device === 'desktop')) {
    fail('exact een mobiele en een desktopcontrole zijn vereist.');
  }
  for (const rawView of views) {
    const view = rawView || {};
    const label = view.device || 'onbekend scherm';
    const { width, height } = view.viewport || {};
    if (!isNumber(width) || !isNumber(height) || height < 600
      || (view.device === 'mobile' && (width < 320 || width > 430))
      || (view.device === 'desktop' && width < 1280)) fail(`${label}: viewport is ongeldig.`);
    if (!isNumber(view.documentWidth) || view.documentWidth < width || view.documentWidth > width + 1) {
      fail(`${label}: horizontale overflow of ontbrekende breedtemeting.`);
    }
    if (view.h1Count !== 1) fail(`${label}: precies een H1 is vereist.`);
    if (!Array.isArray(view.brokenImages) || view.brokenImages.length) fail(`${label}: kapotte of ongecontroleerde beelden.`);
    if (!isNumber(view.bodyFontSize) || view.bodyFontSize < 16) fail(`${label}: hoofdtekst is te klein of niet gemeten.`);
    if (view.firstScreenAnswer !== true) fail(`${label}: antwoord of aanbod is niet duidelijk op het eerste scherm.`);
    const contact = view.contact || {};
    const rect = contact.rect || {};
    if (contact.href !== 'https://wa.me/31643262792' || !String(contact.label || '').trim()) {
      fail(`${label}: schone, benoemde contactroute ontbreekt.`);
    }
    if (![rect.x, rect.y, rect.width, rect.height].every(isNumber)
      || rect.width < 44 || rect.height < 44 || rect.x < 0 || rect.y < 0
      || rect.x + rect.width > width + 1 || rect.y + rect.height > height + 1) {
      fail(`${label}: contactknop is te klein of niet volledig in beeld.`);
    }
    if (contact.unobscured !== true || contact.keyboardFocusVisible !== true) {
      fail(`${label}: contactknop is bedekt of toetsenbordfocus is niet gecontroleerd.`);
    }
    if (view.navigation?.passed !== true || !hasNote(view.navigation.evidence)) fail(`${label}: werkende navigatie is niet bewezen.`);
    if (view.visualReview?.passed !== true || !hasNote(view.visualReview.evidence)
      || !hasNote(view.visualReview.screenshotReference)) fail(`${label}: concrete screenshotbeoordeling ontbreekt.`);
  }
  const field = evidence.fieldData || {};
  if (field.status === 'unavailable') {
    if (!hasNote(field.reason)) fail('ontbrekende velddata vereist een eerlijke reden.');
  } else if (field.status === 'measured') {
    if (!/^https:\/\//.test(String(field.source || '')) || !['url', 'origin'].includes(field.scope)
      || field.percentile !== 75 || field.windowDays !== 28
      || ![field.lcpMs, field.inpMs, field.cls].every((value) => isNumber(value) && value >= 0)) {
      fail('veldmetingen missen bron, scope, p75, 28-dagenvenster of echte CWV-waarden.');
    }
    if ((field.lcpMs > 2500 || field.inpMs > 200 || field.cls > 0.1) && !hasNote(field.nextAction)) {
      fail('trage/instabiele veldervaring vereist een concrete vervolgactie.');
    }
  } else fail('velddata moet measured of expliciet unavailable zijn; labmetingen zijn geen velddata.');
  return {
    status: errors.length ? 'blocked' : 'ready',
    errors,
    summary: { url, liveCommit, capturedAt: evidence.capturedAt, browser: evidence.browser,
      devices: views.map((view) => view?.device), fieldDataStatus: field.status },
    evidence,
  };
}

function validatePageExperienceReceipt(receipt, run, { liveCommit, changedUrl } = {}) {
  const result = receipt?.summary?.summary?.pageExperience || receipt?.summary?.pageExperience;
  if (result?.status !== 'ready') return ['gates.live_route mist groene pageExperience-controle.'];
  return validatePageExperience(result.evidence, {
    url: changedUrl, liveCommit, nowMs: Date.parse(receipt.checkedAt), notBefore: run.startedAt,
  }).errors;
}

module.exports = { MAX_EVIDENCE_AGE_MS, validatePageExperience, validatePageExperienceReceipt };
