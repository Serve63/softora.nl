const KEYWORD_EVIDENCE_VERSION = 1;
const KEYWORD_EVIDENCE_CUTOFF = '2026-08-28';
const KEYWORD_EVIDENCE_MAX_AGE_DAYS = 31;
const NETHERLANDS_LOCATION_ID = 2528;
const NETHERLANDS_LANGUAGE = 'Dutch';

const REQUIRED_UBERSUGGEST_TOOLS = Object.freeze([
  'keyword_suggestions',
  'google_suggestions',
  'keyword_overview',
  'serp_analysis',
]);

const ALLOWED_UBERSUGGEST_TOOLS = Object.freeze([
  'auth_status',
  ...REQUIRED_UBERSUGGEST_TOOLS,
  'match_keywords',
  'competitors',
  'domain_keywords',
  'domain_top_pages',
  'content_ideas',
]);

const FORBIDDEN_UBERSUGGEST_TOOLS = Object.freeze([
  'keyword_metrics',
  'generate_article',
  'create_project',
  'update_project',
  'delete_project',
  'add_tracked_keywords',
  'remove_tracked_keywords',
  'backlinks',
  'site_audit',
  'purchase',
  'upgrade',
  'top_up',
]);

const TERM_DISPOSITIONS = Object.freeze([
  'used',
  'covered_semantically',
  'rejected',
]);

const FALLBACK_PUBLIC_SOURCE_TYPES = new Set([
  'public_dutch_serp',
  'google_autocomplete',
  'primary_source',
]);

function normalizeDate(valueRaw) {
  const value = String(valueRaw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? value : '';
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function getKeywordEvidenceEffectiveDate(item = {}) {
  const dates = [normalizeDate(item.publishedAt)].filter(Boolean);
  if (['new_url', 'substantial_refresh'].includes(String(item.growthEventKind || ''))) {
    const growthEventAt = normalizeDate(item.growthEventAt);
    if (growthEventAt) dates.push(growthEventAt);
  }
  return dates.sort().at(-1) || '';
}

function requiresKeywordEvidence(item = {}, cutoff = KEYWORD_EVIDENCE_CUTOFF) {
  const effectiveDate = getKeywordEvidenceEffectiveDate(item);
  return Boolean(effectiveDate && effectiveDate >= normalizeDate(cutoff));
}

function issue(type, path, message) {
  return { type, path, message };
}

function cleanStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function collectPageText(item = {}) {
  return normalizeSearchText(JSON.stringify({
    title: item.title,
    description: item.description,
    summary: item.summary,
    sections: item.sections,
    relatedLinks: item.relatedLinks,
  }));
}

function auditResearchCalls(evidence, pathName, tools, status) {
  const issues = [];
  const calls = Array.isArray(evidence.calls) ? evidence.calls : [];
  const callsUsed = Number(evidence.callsUsed);
  if (calls.length !== callsUsed) {
    issues.push(issue(
      'keyword-evidence-call-ledger',
      pathName,
      `${pathName} laat callsUsed niet overeenkomen met de controleerbare researchcalls.`
    ));
  }
  for (const call of calls) {
    const tool = String(call && call.tool || '').trim();
    const observedAt = normalizeDate(call && call.observedAt);
    if (
      !tools.includes(tool)
      || !ALLOWED_UBERSUGGEST_TOOLS.includes(tool)
      || !observedAt
      || !call.arguments
      || typeof call.arguments !== 'object'
      || Array.isArray(call.arguments)
      || String(call.purpose || '').trim().length < 10
    ) {
      issues.push(issue(
        'keyword-evidence-invalid-call',
        pathName,
        `${pathName} heeft een researchcall zonder toegestane tool, datum, argumenten of doel.`
      ));
    }
  }
  if (status === 'ready' && calls.some((call) => normalizeDate(call.observedAt) !== normalizeDate(evidence.researchedAt))) {
    issues.push(issue(
      'keyword-evidence-call-date',
      pathName,
      `${pathName} heeft researchcalls buiten de vastgelegde researchdatum.`
    ));
  }
  return issues;
}

function auditKeywordTerms(evidence, item, pathName, minimumTerms = 1) {
  const issues = [];
  const terms = Array.isArray(evidence.terms) ? evidence.terms : [];
  const pageText = collectPageText(item);
  const evidenceTools = new Set(cleanStringArray(evidence.tools));
  if (terms.length < minimumTerms) {
    issues.push(issue('keyword-evidence-missing-terms', pathName, `${pathName} mist beoordeelde zoektermen.`));
    return issues;
  }

  for (const term of terms) {
    const phrase = String(term && term.phrase || '').trim();
    const disposition = String(term && term.disposition || '').trim();
    const reason = String(term && term.reason || '').trim();
    const observedIn = cleanStringArray(term && term.observedIn);
    if (!phrase || !TERM_DISPOSITIONS.includes(disposition) || reason.length < 10) {
      issues.push(issue(
        'keyword-evidence-invalid-term',
        pathName,
        `${pathName} heeft een zoekterm zonder phrase, geldige disposition of controleerbare reden.`
      ));
      continue;
    }
    if (String(evidence.status || '') === 'ready'
      && (!observedIn.length || observedIn.some((tool) => !evidenceTools.has(tool)))) {
      issues.push(issue(
        'keyword-evidence-term-provenance',
        pathName,
        `${pathName} heeft een zoekterm zonder herleidbare researchtool.`
      ));
    }
    if (disposition === 'used' && !pageText.includes(normalizeSearchText(phrase))) {
      issues.push(issue(
        'keyword-evidence-used-term-absent',
        pathName,
        `${pathName} markeert "${phrase}" als gebruikt, maar de term staat niet in de zichtbare paginacopy.`
      ));
    }
    if (term.metrics && Number(term.metrics.volume) === 0
      && String(term.volumeInterpretation || '') !== 'no_measurable_provider_volume') {
      issues.push(issue(
        'keyword-evidence-zero-volume-misread',
        pathName,
        `${pathName} behandelt provider-volume 0 niet als no_measurable_provider_volume.`
      ));
    }
  }

  const primaryTerm = normalizeSearchText(evidence.provisionalPrimaryTerm);
  const primaryDecision = terms.find((term) => normalizeSearchText(term && term.phrase) === primaryTerm);
  if (!primaryDecision || primaryDecision.disposition === 'rejected') {
    issues.push(issue(
      'keyword-evidence-primary-term-decision',
      pathName,
      `${pathName} heeft geen niet-afgewezen termbesluit voor de voorlopige primaire zoekterm.`
    ));
  }
  if (!terms.some((term) => term && term.disposition === 'used')) {
    issues.push(issue(
      'keyword-evidence-no-natural-use',
      pathName,
      `${pathName} verwerkt geen enkele bewezen term aantoonbaar in de zichtbare paginacopy.`
    ));
  }
  return issues;
}

function auditKeywordEvidenceItem(item = {}, options = {}) {
  const cutoff = options.cutoff || KEYWORD_EVIDENCE_CUTOFF;
  if (!requiresKeywordEvidence(item, cutoff)) return [];

  const pathName = `/${String(item.collection || '').trim()}/${String(item.slug || '').trim()}`
    .replace(/\/{2,}/g, '/');
  const evidence = item.keywordEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return [issue(
      'missing-keyword-evidence',
      pathName,
      `${pathName} mist verplichte machineleesbare keywordEvidence.`
    )];
  }

  const issues = [];
  const status = String(evidence.status || '').trim();
  const researchedAt = normalizeDate(evidence.researchedAt);
  const effectiveDate = getKeywordEvidenceEffectiveDate(item);
  const tools = cleanStringArray(evidence.tools);
  const seeds = cleanStringArray(evidence.seeds);
  const callsUsed = Number(evidence.callsUsed);
  const evidenceAgeDays = researchedAt && effectiveDate ? daysBetween(researchedAt, effectiveDate) : null;

  if (Number(evidence.version) !== KEYWORD_EVIDENCE_VERSION) {
    issues.push(issue('keyword-evidence-version', pathName, `${pathName} gebruikt niet keywordEvidence versie 1.`));
  }
  if (!['ready', 'external_research_unavailable'].includes(status)) {
    issues.push(issue('keyword-evidence-status', pathName, `${pathName} heeft geen geldige keywordEvidence-status.`));
  }
  if (
    !researchedAt
    || researchedAt > effectiveDate
    || evidenceAgeDays === null
    || evidenceAgeDays > KEYWORD_EVIDENCE_MAX_AGE_DAYS
  ) {
    issues.push(issue(
      'keyword-evidence-date',
      pathName,
      `${pathName} heeft geen geldige researchdatum op of voor de contentgebeurtenis.`
    ));
  }
  if (String(evidence.primaryIntent || '').trim().length < 20) {
    issues.push(issue('keyword-evidence-intent', pathName, `${pathName} mist een concrete primaire zoekintentie.`));
  }
  if (!String(evidence.provisionalPrimaryTerm || '').trim()) {
    issues.push(issue('keyword-evidence-primary-term', pathName, `${pathName} mist een voorlopige primaire zoekterm.`));
  }
  if (
    String(evidence.decision && evidence.decision.owner || '') !== 'softora_control_plane'
    || String(evidence.decision && evidence.decision.ubersuggest || '') !== 'advisory_only'
    || String(evidence.decision && evidence.decision.rationale || '').trim().length < 20
  ) {
    issues.push(issue(
      'keyword-evidence-decision-boundary',
      pathName,
      `${pathName} bewijst niet dat de Softora-control-plane beslist en Ubersuggest alleen adviseert.`
    ));
  }
  if (
    Object.hasOwn(evidence, 'keywordDensity')
    || Object.hasOwn(evidence, 'minimumOccurrences')
    || Object.hasOwn(evidence, 'exactMatchCount')
  ) {
    issues.push(issue(
      'keyword-evidence-forbidden-quota',
      pathName,
      `${pathName} bevat een verboden keyworddichtheid of occurrence-quota.`
    ));
  }

  const forbiddenTools = tools.filter((tool) => FORBIDDEN_UBERSUGGEST_TOOLS.includes(tool));
  const unknownTools = tools.filter((tool) => !ALLOWED_UBERSUGGEST_TOOLS.includes(tool));
  if (forbiddenTools.length || unknownTools.length) {
    issues.push(issue(
      'keyword-evidence-forbidden-tool',
      pathName,
      `${pathName} noemt niet-toegestane Ubersuggest-tools: ${[...forbiddenTools, ...unknownTools].join(', ')}.`
    ));
  }

  if (status === 'ready') {
    if (String(evidence.provider || '') !== 'ubersuggest') {
      issues.push(issue('keyword-evidence-provider', pathName, `${pathName} mist Ubersuggest als adviserende bron.`));
    }
    if (
      Number(evidence.locale && evidence.locale.locId) !== NETHERLANDS_LOCATION_ID
      || String(evidence.locale && evidence.locale.language || '') !== NETHERLANDS_LANGUAGE
      || evidence.locale && evidence.locale.verified !== true
    ) {
      issues.push(issue(
        'keyword-evidence-locale',
        pathName,
        `${pathName} heeft geen geverifieerde Nederlandse Ubersuggest-locale.`
      ));
    }
    if (seeds.length < 1 || seeds.length > 3) {
      issues.push(issue('keyword-evidence-seeds', pathName, `${pathName} moet een tot drie onderbouwde seeds gebruiken.`));
    }
    if (!Number.isInteger(callsUsed) || callsUsed < 4 || callsUsed > 6) {
      issues.push(issue('keyword-evidence-call-cap', pathName, `${pathName} moet vier tot zes read-only researchcalls gebruiken.`));
    }
    const missingTools = REQUIRED_UBERSUGGEST_TOOLS.filter((tool) => !tools.includes(tool));
    if (missingTools.length) {
      issues.push(issue(
        'keyword-evidence-required-tools',
        pathName,
        `${pathName} mist verplichte read-only checks: ${missingTools.join(', ')}.`
      ));
    }
    issues.push(...auditResearchCalls(evidence, pathName, tools, status));
    if (cleanStringArray(evidence.secondaryBuyerLanguage).length < 1) {
      issues.push(issue(
        'keyword-evidence-buyer-language',
        pathName,
        `${pathName} mist secundaire Nederlandse koperstaal uit de research.`
      ));
    }
    if (cleanStringArray(evidence.dominantPageTypes).length < 1) {
      issues.push(issue(
        'keyword-evidence-serp-intent',
        pathName,
        `${pathName} mist de dominante Nederlandse SERP-paginatypen.`
      ));
    }
    if (!Array.isArray(evidence.buyerQuestions) || !Array.isArray(evidence.serpFeatures) || !Array.isArray(evidence.limitations)) {
      issues.push(issue(
        'keyword-evidence-research-shape',
        pathName,
        `${pathName} mist buyerQuestions, serpFeatures of limitations als expliciete researchvelden.`
      ));
    }
  }

  if (status === 'external_research_unavailable') {
    const fallbackSources = Array.isArray(evidence.fallbackSources) ? evidence.fallbackSources : [];
    const fallbackTypes = new Set(fallbackSources.map((source) => String(source && source.type || '')));
    const hasPublicFallback = [...fallbackTypes].some((type) => FALLBACK_PUBLIC_SOURCE_TYPES.has(type));
    if (String(evidence.unavailableReason || '').trim().length < 20
      || String(evidence.unavailableEvidence || '').trim().length < 20) {
      issues.push(issue(
        'keyword-evidence-unavailable-proof',
        pathName,
        `${pathName} mist concrete evidence voor onbeschikbare externe research.`
      ));
    }
    if (!fallbackTypes.has('gsc') || !hasPublicFallback) {
      issues.push(issue(
        'keyword-evidence-fallback',
        pathName,
        `${pathName} mist GSC plus een publieke Nederlandse fallbackbron.`
      ));
    }
    if (fallbackSources.some((source) => String(source && source.reference || '').trim().length < 10)) {
      issues.push(issue(
        'keyword-evidence-fallback-reference',
        pathName,
        `${pathName} heeft een fallbackbron zonder controleerbare referentie.`
      ));
    }
    if (!Number.isInteger(callsUsed) || callsUsed < 0 || callsUsed > 6) {
      issues.push(issue('keyword-evidence-call-cap', pathName, `${pathName} overschrijdt de researchcall-cap.`));
    }
    issues.push(...auditResearchCalls(evidence, pathName, tools, status));
  }

  return [...issues, ...auditKeywordTerms(evidence, item, pathName, status === 'ready' ? 2 : 1)];
}

function auditKeywordEvidence({ items = [], cutoff = KEYWORD_EVIDENCE_CUTOFF } = {}) {
  return (Array.isArray(items) ? items : []).flatMap((item) => auditKeywordEvidenceItem(item, { cutoff }));
}

module.exports = {
  ALLOWED_UBERSUGGEST_TOOLS,
  FORBIDDEN_UBERSUGGEST_TOOLS,
  KEYWORD_EVIDENCE_CUTOFF,
  KEYWORD_EVIDENCE_MAX_AGE_DAYS,
  KEYWORD_EVIDENCE_VERSION,
  NETHERLANDS_LANGUAGE,
  NETHERLANDS_LOCATION_ID,
  REQUIRED_UBERSUGGEST_TOOLS,
  TERM_DISPOSITIONS,
  auditKeywordEvidence,
  auditKeywordEvidenceItem,
  collectPageText,
  getKeywordEvidenceEffectiveDate,
  requiresKeywordEvidence,
};
