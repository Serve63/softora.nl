const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auditKeywordEvidence,
  requiresKeywordEvidence,
} = require('../../server/services/seo-machine-keyword-evidence');
const {
  auditContentQuality,
} = require('../../server/services/seo-machine-quality-gates');

function validEvidence(overrides = {}) {
  return {
    version: 1,
    researchedAt: '2026-08-27',
    status: 'ready',
    provider: 'ubersuggest',
    locale: { locId: 2528, language: 'Dutch', verified: true },
    seeds: ['website briefing maken'],
    tools: ['keyword_suggestions', 'google_suggestions', 'keyword_overview', 'serp_analysis'],
    callsUsed: 4,
    calls: [
      { tool: 'keyword_suggestions', observedAt: '2026-08-27', arguments: { keyword: 'website briefing maken', locId: 2528, language: 'Dutch' }, purpose: 'Gerelateerde Nederlandse koperstaal vinden.' },
      { tool: 'google_suggestions', observedAt: '2026-08-27', arguments: { keyword: 'website briefing maken', locId: 2528, language: 'Dutch' }, purpose: 'Werkelijke suggestievarianten controleren.' },
      { tool: 'keyword_overview', observedAt: '2026-08-27', arguments: { keyword: 'website briefing maken', locId: 2528, language: 'Dutch' }, purpose: 'Providerinschattingen en intentie vastleggen.' },
      { tool: 'serp_analysis', observedAt: '2026-08-27', arguments: { keyword: 'website briefing maken', locId: 2528, language: 'Dutch' }, purpose: 'Dominante Nederlandse paginatypen controleren.' },
    ],
    primaryIntent: 'Een bruikbare websitebriefing opstellen voor een leverancier.',
    provisionalPrimaryTerm: 'website briefing maken',
    secondaryBuyerLanguage: ['website briefing voorbeeld'],
    buyerQuestions: ['Wat moet er in een website briefing staan?'],
    dominantPageTypes: ['stappenplan', 'template'],
    serpFeatures: [],
    limitations: ['Providerdata is een schatting en geen GSC-waarheid.'],
    terms: [
      {
        phrase: 'website briefing maken',
        disposition: 'used',
        reason: 'Dekt de concrete koperstaak zonder onnatuurlijke herhaling.',
        metrics: { volume: 0 },
        volumeInterpretation: 'no_measurable_provider_volume',
        observedIn: ['keyword_suggestions', 'keyword_overview', 'serp_analysis'],
      },
      {
        phrase: 'website briefing voorbeeld',
        disposition: 'covered_semantically',
        reason: 'Een voorbeeld wordt inhoudelijk behandeld zonder exact-matchverplichting.',
        observedIn: ['keyword_suggestions', 'google_suggestions'],
      },
    ],
    decision: {
      owner: 'softora_control_plane',
      ubersuggest: 'advisory_only',
      rationale: 'GSC, buyer task, SERP-intentie en Softora-fit bepalen samen de keuze.',
    },
    ...overrides,
  };
}

function futureItem(overrides = {}) {
  return {
    collection: 'kennisbank',
    slug: 'website-briefing-maken',
    title: 'Website briefing maken: van koperstaak naar bruikbaar plan',
    description: 'Een praktisch stappenplan om een websitebriefing helder op te bouwen.',
    summary: 'Maak een websitebriefing die doelen, beslissingen en grenzen controleerbaar maakt.',
    sections: [{ heading: 'Werk met een echte koperstaak', paragraphs: ['Begin bij het besluit dat de website moet ondersteunen.'] }],
    publishedAt: '2026-08-28',
    keywordEvidence: validEvidence(),
    ...overrides,
  };
}

test('keyword evidence is required only for new or refreshed content from the cutoff', () => {
  assert.equal(requiresKeywordEvidence(futureItem()), true);
  assert.equal(requiresKeywordEvidence(futureItem({ publishedAt: '2026-08-27', keywordEvidence: undefined })), false);
  assert.equal(requiresKeywordEvidence(futureItem({
    publishedAt: '2026-08-01',
    growthEventKind: 'substantial_refresh',
    growthEventAt: '2026-08-29',
  })), true);
});

test('valid Dutch advisory Ubersuggest evidence passes', () => {
  assert.deepEqual(auditKeywordEvidence({ items: [futureItem()] }), []);
});

test('content quality gate blocks future content without keyword evidence', () => {
  const issues = auditContentQuality({
    items: [futureItem({ keywordEvidence: undefined })],
    clusters: [],
  });
  assert.equal(issues.some((entry) => entry.type === 'missing-keyword-evidence'), true);
});

test('keyword evidence rejects a wrong locale, forbidden tool and misread zero volume', () => {
  const evidence = validEvidence({
    locale: { locId: 2840, language: 'English', verified: true },
    tools: ['keyword_suggestions', 'google_suggestions', 'keyword_overview', 'serp_analysis', 'generate_article'],
    callsUsed: 5,
    terms: [
      {
        phrase: 'website briefing maken',
        disposition: 'used',
        reason: 'Lijkt inhoudelijk passend bij de concrete koperstaak.',
        metrics: { volume: 0 },
        volumeInterpretation: 'no_demand',
      },
      {
        phrase: 'website briefing voorbeeld',
        disposition: 'covered_semantically',
        reason: 'Wordt als praktisch voorbeeld op natuurlijke wijze behandeld.',
      },
    ],
  });
  const types = auditKeywordEvidence({ items: [futureItem({ keywordEvidence: evidence })] })
    .map((entry) => entry.type);
  assert.ok(types.includes('keyword-evidence-locale'));
  assert.ok(types.includes('keyword-evidence-forbidden-tool'));
  assert.ok(types.includes('keyword-evidence-zero-volume-misread'));
});

test('documented external research fallback stays safe and publishable', () => {
  const evidence = validEvidence({
    status: 'external_research_unavailable',
    provider: 'ubersuggest',
    tools: ['auth_status'],
    callsUsed: 1,
    calls: [
      { tool: 'auth_status', observedAt: '2026-08-27', arguments: {}, purpose: 'Beschikbaarheid van de gekoppelde bron controleren.' },
    ],
    unavailableReason: 'De verbonden read-only provider gaf tijdens deze run een quotafout.',
    unavailableEvidence: 'Auth was geldig, maar de eerste keywordcall retourneerde quota_blocked.',
    fallbackSources: [
      { type: 'gsc', reference: 'reports/seo-agent/latest.json' },
      { type: 'public_dutch_serp', reference: 'Nederlandse SERP handmatig gecontroleerd' },
    ],
  });
  assert.deepEqual(auditKeywordEvidence({ items: [futureItem({ keywordEvidence: evidence })] }), []);
});

test('keyword evidence must be current for the publication or refresh event', () => {
  const evidence = validEvidence({ researchedAt: '2026-07-01' });
  const types = auditKeywordEvidence({ items: [futureItem({ keywordEvidence: evidence })] })
    .map((entry) => entry.type);
  assert.ok(types.includes('keyword-evidence-date'));
});

test('keyword evidence cannot claim an absent term or omit call provenance', () => {
  const evidence = validEvidence({
    calls: [],
    terms: [
      {
        phrase: 'onzichtbare geforceerde zoekterm',
        disposition: 'used',
        reason: 'Deze term wordt ten onrechte als zichtbaar gebruikt gemarkeerd.',
        observedIn: ['keyword_suggestions'],
      },
      {
        phrase: 'website briefing maken',
        disposition: 'covered_semantically',
        reason: 'De primaire taak wordt semantisch behandeld in de pagina.',
        observedIn: ['keyword_overview'],
      },
    ],
  });
  const types = auditKeywordEvidence({ items: [futureItem({ keywordEvidence: evidence })] })
    .map((entry) => entry.type);
  assert.ok(types.includes('keyword-evidence-call-ledger'));
  assert.ok(types.includes('keyword-evidence-used-term-absent'));
});
