const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSelectionEvidence } = require('../../server/services/seo-machine-selection');

const KNOWN_PUBLIC_PATHS = new Set([
  '/bedrijfssoftware-op-maat',
  '/kennisbank/wat-is-bedrijfssoftware-op-maat',
  '/kennisbank/wat-is-een-conversiegerichte-website',
]);
const READY_BACKLOG_PATHS = new Set([
  '/blog/nieuwe-pagina',
  '/branches/nieuwe-geldpagina',
]);

function validate(candidate = evidence()) {
  return validateSelectionEvidence(candidate, report(), {
    knownPublicPaths: KNOWN_PUBLIC_PATHS,
    readyBacklogPaths: READY_BACKLOG_PATHS,
    reportPath: 'reports/seo-agent/latest.json',
    now: new Date('2026-08-28T06:25:00.000Z'),
  });
}

function report() {
  return {
    status: 'ready',
    generatedAt: '2026-08-28T06:15:00.000Z',
    queries: {
      prioritized: [
        { query: 'bedrijfssoftware laten maken', page: '/bedrijfssoftware-op-maat', opportunityScore: 52.3 },
        { query: 'conversiegerichte website', page: '/kennisbank/wat-is-een-conversiegerichte-website', opportunityScore: 21.4 },
        { query: 'bedrijfssoftware op maat', page: '/bedrijfssoftware-op-maat', opportunityScore: 5.3 },
      ],
    },
  };
}

function evidence() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-28T06:20:00.000Z',
    sourceReport: { path: 'reports/seo-agent/latest.json', generatedAt: '2026-08-28T06:15:00.000Z' },
    machineState: 'performance_recovery',
    controlPlane: { newUrlRequired: false, newUrlDeficit: 0 },
    selected: {
      source: 'gsc_prioritized',
      query: 'conversiegerichte website',
      path: '/kennisbank/wat-is-een-conversiegerichte-website',
      actionType: 'substantial_refresh',
      buyerTask: 'Een ondernemer helpen conversie-eisen te toetsen.',
      expectedQualifiedImpact: 'Meer gekwalificeerde doorkliks naar de website-dienstpagina.',
      selectionEvidence: 'De tweede kans is uitvoerbaar en ligt binnen dezelfde commerciële buyer task.',
      supportingAction: {
        type: 'contextual_internal_link',
        path: '/kennisbank/wat-is-bedrijfssoftware-op-maat',
        evidence: 'Deze bestaande uitlegpagina is een natuurlijke en controleerbare inkomende route.',
        verification: { kind: 'link_to_selected_url' },
      },
    },
    prioritizedReview: [
      {
        rank: 1,
        query: 'bedrijfssoftware laten maken',
        page: '/bedrijfssoftware-op-maat',
        opportunityScore: 52.3,
        decision: 'skipped',
        reasonCode: 'recent_material_change',
        evidence: 'PR #1800 wijzigde deze money page minder dan veertien dagen geleden.',
        lastChangedAt: '2026-08-22T08:00:00.000Z',
        recheckAt: '2026-09-05T08:00:00.000Z',
        changeReference: 'PR #1800',
      },
      {
        rank: 2,
        query: 'conversiegerichte website',
        page: '/kennisbank/wat-is-een-conversiegerichte-website',
        opportunityScore: 21.4,
        decision: 'selected',
      },
      {
        rank: 3,
        query: 'bedrijfssoftware op maat',
        page: '/bedrijfssoftware-op-maat',
        opportunityScore: 5.3,
        decision: 'skipped',
        reasonCode: 'higher_qualified_impact',
        evidence: 'De gekozen positie-negenkans ligt dichter bij een gekwalificeerde doorklik.',
      },
    ],
  };
}

test('selection gate accepts an exact top-three review with concrete skip evidence', () => {
  const result = validate();
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.highestOpportunity.reasonCode, 'recent_material_change');
});

test('selection gate blocks excluded routes in every actionable field', () => {
  const mutations = [
    (candidate) => { candidate.selected.path = '/website'; },
    (candidate) => { candidate.selected.targetMoneyPage = '/bedrijfssoftware'; },
    (candidate) => { candidate.selected.supportingAction.path = '/voicesoftware'; },
    (candidate) => {
      candidate.selected.supportingAction.type = 'existing_page_refresh';
      candidate.selected.supportingAction.verification = { kind: 'link_present', value: '/chatbot' };
    },
  ];

  for (const mutate of mutations) {
    const candidate = evidence();
    mutate(candidate);
    const result = validate(candidate);
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /buiten de SEO-automation/i);
  }

  const protectedReport = report();
  protectedReport.queries.prioritized[0].page = '/website';
  const result = validateSelectionEvidence(evidence(), protectedReport, {
    knownPublicPaths: KNOWN_PUBLIC_PATHS,
    readyBacklogPaths: READY_BACKLOG_PATHS,
    reportPath: 'reports/seo-agent/latest.json',
    now: new Date('2026-08-28T06:25:00.000Z'),
  });
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join('\n'), /uitgesloten SEO-route/i);
});

test('selection gate blocks a vague skip of the highest GSC opportunity', () => {
  const candidate = evidence();
  delete candidate.prioritizedReview[0].lastChangedAt;
  delete candidate.prioritizedReview[0].recheckAt;
  delete candidate.prioritizedReview[0].changeReference;
  candidate.prioritizedReview[0].evidence = 'Recent.';
  const result = validate(candidate);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /skipbewijs/);
  assert.match(result.errors.join(' '), /lastChangedAt/);
});

test('selection gate blocks reordered or score-mutated GSC evidence', () => {
  const candidate = evidence();
  candidate.prioritizedReview[0].query = 'conversiegerichte website';
  candidate.prioritizedReview[0].opportunityScore = 999;
  const result = validate(candidate);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /query\/pagina/);
  assert.match(result.errors.join(' '), /opportunityScore/);
});

test('selection gate blocks stale or time-traveling GSC evidence', () => {
  const stale = validateSelectionEvidence(evidence(), report(), {
    knownPublicPaths: KNOWN_PUBLIC_PATHS,
    readyBacklogPaths: READY_BACKLOG_PATHS,
    reportPath: 'reports/seo-agent/latest.json',
    now: new Date('2026-08-28T07:00:01.000Z'),
  });
  assert.equal(stale.status, 'blocked');
  assert.match(stale.errors.join(' '), /ouder dan 30 minuten/);

  const candidate = evidence();
  candidate.generatedAt = '2026-08-28T06:14:59.000Z';
  const beforeReport = validate(candidate);
  assert.equal(beforeReport.status, 'blocked');
  assert.match(beforeReport.errors.join(' '), /voor het gekoppelde GSC-rapport/);

  const wrongPath = evidence();
  wrongPath.sourceReport.path = 'reports/seo-agent/ander.json';
  const pathMismatch = validate(wrongPath);
  assert.equal(pathMismatch.status, 'blocked');
  assert.match(pathMismatch.errors.join(' '), /werkelijk ingelezen GSC-rapport/);
});

test('selection gate only accepts new-URL-floor skips when cadence proves the deficit', () => {
  const candidate = evidence();
  candidate.selected.source = 'canonical_backlog';
  delete candidate.selected.query;
  candidate.selected.path = '/blog/nieuwe-pagina';
  candidate.selected.actionType = 'new_url';
  candidate.selected.publicationLane = 'editorial';
  candidate.selected.supportingAction = {
    type: 'contextual_internal_link',
    path: '/kennisbank/wat-is-een-conversiegerichte-website',
    evidence: 'Deze bestaande geindexeerde uitlegpagina is inhoudelijk de sterkste inkomende route.',
    verification: { kind: 'link_to_selected_url' },
  };
  candidate.prioritizedReview = candidate.prioritizedReview.map((item) => ({
    ...item,
    decision: 'skipped',
    reasonCode: 'binding_new_url_floor',
    evidence: 'De bindende cadence vereist deze run een unieke nieuwe openbare URL.',
  }));
  let result = validate(candidate);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /zonder bindend deficit/);

  candidate.controlPlane = {
    newUrlRequired: true,
    newUrlDeficit: 1,
    requiredPublicationLane: 'editorial',
    allowedPublicationLanes: ['editorial'],
    moneyPageAllowed: false,
    moneyPageNewUrls: 2,
    maximumMoneyPageNewUrlsPerWeek: 2,
  };
  result = validate(candidate);
  assert.equal(result.status, 'ready');
});

test('selection gate blocks a third money page in the rolling week', () => {
  const candidate = evidence();
  candidate.selected = {
    source: 'canonical_backlog',
    path: '/branches/nieuwe-geldpagina',
    actionType: 'new_url',
    publicationLane: 'money_page',
    buyerTask: 'Een ondernemer helpen een branchespecifieke oplossing te beoordelen.',
    expectedQualifiedImpact: 'Meer gekwalificeerde doorkliks naar de passende Softora-dienst.',
    selectionEvidence: 'De backlogscore is sterk, maar de rollende geldpagina-cap is bindend.',
    supportingAction: {
      type: 'contextual_internal_link',
      path: '/kennisbank/wat-is-bedrijfssoftware-op-maat',
      evidence: 'Deze bestaande uitlegpagina is de meest relevante natuurlijke inkomende route.',
      verification: { kind: 'link_to_selected_url' },
    },
  };
  candidate.controlPlane = {
    newUrlRequired: true,
    newUrlDeficit: 1,
    requiredPublicationLane: 'editorial',
    allowedPublicationLanes: ['editorial'],
    moneyPageAllowed: false,
    moneyPageNewUrls: 2,
    maximumMoneyPageNewUrlsPerWeek: 2,
  };
  candidate.prioritizedReview = candidate.prioritizedReview.map((item) => ({
    ...item,
    decision: 'skipped',
    reasonCode: 'binding_new_url_floor',
    evidence: 'De bindende cadence vereist deze run een nieuwe openbare URL uit de toegestane lane.',
  }));

  const result = validate(candidate);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /vereist publicationLane editorial/);
  assert.match(result.errors.join(' '), /geldpagina-cap/);
});

test('selection gate requires a concrete existing-page action beside a new URL', () => {
  const candidate = evidence();
  candidate.selected = {
    source: 'canonical_backlog',
    path: '/blog/nieuwe-pagina',
    actionType: 'new_url',
    publicationLane: 'editorial',
    buyerTask: 'Een ondernemer helpen een concrete softwarekeuze te beoordelen.',
    expectedQualifiedImpact: 'Meer relevante non-branded routes naar de softwaredienst.',
    selectionEvidence: 'De backlogbrief vult een unieke en bewijsdekte koperstaak in.',
  };
  candidate.controlPlane = {
    newUrlRequired: true,
    newUrlDeficit: 1,
    requiredPublicationLane: 'editorial',
    allowedPublicationLanes: ['editorial'],
  };
  candidate.prioritizedReview = candidate.prioritizedReview.map((item) => ({
    ...item,
    decision: 'skipped',
    reasonCode: 'binding_new_url_floor',
    evidence: 'De bindende cadence vereist deze run een redactionele nieuwe openbare URL.',
  }));

  const result = validate(candidate);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /supportingAction/);
});

test('selection gate rejects a fictitious supporting page and missing live proof', () => {
  const candidate = evidence();
  candidate.selected = {
    source: 'canonical_backlog',
    path: '/blog/nieuwe-pagina',
    actionType: 'new_url',
    publicationLane: 'editorial',
    buyerTask: 'Een ondernemer helpen een concrete softwarekeuze te beoordelen.',
    expectedQualifiedImpact: 'Meer relevante non-branded routes naar de softwaredienst.',
    selectionEvidence: 'De backlogbrief vult een unieke en bewijsdekte koperstaak in.',
    supportingAction: {
      type: 'contextual_internal_link',
      path: '/bestaat-absoluut-niet',
      evidence: 'Deze zogenaamd bestaande route zou de inkomende contextuele link krijgen.',
    },
  };
  candidate.controlPlane = {
    newUrlRequired: true,
    newUrlDeficit: 1,
    requiredPublicationLane: 'editorial',
    allowedPublicationLanes: ['editorial'],
  };
  candidate.prioritizedReview = candidate.prioritizedReview.map((item) => ({
    ...item,
    decision: 'skipped',
    reasonCode: 'binding_new_url_floor',
    evidence: 'De bindende cadence vereist deze run een redactionele nieuwe openbare URL.',
  }));

  let result = validate(candidate);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /canonieke publieke inventaris/);
  assert.match(result.errors.join(' '), /verification/);

  candidate.selected.supportingAction.path = '/kennisbank/wat-is-een-conversiegerichte-website';
  candidate.selected.supportingAction.verification = { kind: 'link_to_selected_url' };
  result = validate(candidate);
  assert.equal(result.status, 'ready', result.errors.join('\n'));
  assert.deepEqual(result.summary.supportingAction.verification, { kind: 'link_to_selected_url', value: null });
});

test('selection gate binds the primary path to inventory or the ready backlog', () => {
  const fictitiousRefresh = evidence();
  fictitiousRefresh.selected.path = '/kennisbank/bestaat-niet';
  let result = validate(fictitiousRefresh);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /canonieke publieke inventaris/);

  const outsideBacklog = evidence();
  outsideBacklog.selected = {
    source: 'canonical_backlog',
    path: '/blog/buiten-de-ready-backlog',
    actionType: 'new_url',
    publicationLane: 'editorial',
    buyerTask: 'Een ondernemer helpen een concrete softwarekeuze te beoordelen.',
    expectedQualifiedImpact: 'Meer relevante non-branded routes naar de softwaredienst.',
    selectionEvidence: 'De kandidaat lijkt nuttig maar staat niet in het canonieke ready register.',
    supportingAction: {
      type: 'contextual_internal_link',
      path: '/kennisbank/wat-is-een-conversiegerichte-website',
      evidence: 'Deze bestaande uitlegpagina is de relevante natuurlijke inkomende route.',
      verification: { kind: 'link_to_selected_url' },
    },
  };
  outsideBacklog.controlPlane = { allowedPublicationLanes: ['editorial'] };
  result = validate(outsideBacklog);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /geen ready kandidaat/);

  const unknownAction = evidence();
  unknownAction.selected.actionType = 'doe_maar_wat';
  result = validate(unknownAction);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /actionType is ongeldig/);
});

test('selection gate rejects trivial supporting-action proof', () => {
  const candidate = evidence();
  candidate.selected.actionType = 'other_growth_action';
  candidate.selected.supportingAction = {
    type: 'existing_page_refresh',
    path: '/kennisbank/wat-is-bedrijfssoftware-op-maat',
    evidence: 'De bestaande uitlegpagina krijgt een aantoonbare inhoudelijke verbetering.',
    verification: { kind: 'text_present', value: 'het' },
  };

  const result = validate(candidate);
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /te vaag voor text_present/);
});

test('selection gate fails closed when canonical inventory is unavailable', () => {
  const candidate = evidence();
  candidate.selected = {
    source: 'canonical_backlog',
    path: '/blog/nieuwe-pagina',
    actionType: 'new_url',
    publicationLane: 'editorial',
    buyerTask: 'Een ondernemer helpen een concrete softwarekeuze te beoordelen.',
    expectedQualifiedImpact: 'Meer relevante non-branded routes naar de softwaredienst.',
    selectionEvidence: 'De backlogbrief vult een unieke en bewijsdekte koperstaak in.',
    supportingAction: {
      type: 'contextual_internal_link',
      path: '/kennisbank/wat-is-een-conversiegerichte-website',
      evidence: 'Deze bestaande uitlegpagina wordt een natuurlijke inkomende route.',
      verification: { kind: 'link_to_selected_url' },
    },
  };
  candidate.controlPlane = { allowedPublicationLanes: ['editorial'] };

  const result = validateSelectionEvidence(candidate, report());
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /canonieke publieke inventaris ontbreekt/);
});
