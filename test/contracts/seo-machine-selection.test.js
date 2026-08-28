const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSelectionEvidence } = require('../../server/services/seo-machine-selection');

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
  const result = validateSelectionEvidence(evidence(), report());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.highestOpportunity.reasonCode, 'recent_material_change');
});

test('selection gate blocks a vague skip of the highest GSC opportunity', () => {
  const candidate = evidence();
  delete candidate.prioritizedReview[0].lastChangedAt;
  delete candidate.prioritizedReview[0].recheckAt;
  delete candidate.prioritizedReview[0].changeReference;
  candidate.prioritizedReview[0].evidence = 'Recent.';
  const result = validateSelectionEvidence(candidate, report());
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /skipbewijs/);
  assert.match(result.errors.join(' '), /lastChangedAt/);
});

test('selection gate blocks reordered or score-mutated GSC evidence', () => {
  const candidate = evidence();
  candidate.prioritizedReview[0].query = 'conversiegerichte website';
  candidate.prioritizedReview[0].opportunityScore = 999;
  const result = validateSelectionEvidence(candidate, report());
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /query\/pagina/);
  assert.match(result.errors.join(' '), /opportunityScore/);
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
  };
  candidate.prioritizedReview = candidate.prioritizedReview.map((item) => ({
    ...item,
    decision: 'skipped',
    reasonCode: 'binding_new_url_floor',
    evidence: 'De bindende cadence vereist deze run een unieke nieuwe openbare URL.',
  }));
  let result = validateSelectionEvidence(candidate, report());
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
  result = validateSelectionEvidence(candidate, report());
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

  const result = validateSelectionEvidence(candidate, report());
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

  const result = validateSelectionEvidence(candidate, report());
  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /supportingAction/);
});
