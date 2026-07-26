const test = require('node:test');
const assert = require('node:assert/strict');

const math = require('../../assets/premium-toto-math');

function entry(overrides = {}) {
  return {
    id: 'entry-' + Math.random(),
    createdAt: '2026-07-26T10:00:00.000Z',
    eventDate: '2026-07-27',
    competition: 'Eredivisie',
    event: 'Thuis - Uit',
    market: 'Matchresultaat',
    selection: 'Thuis',
    odds: 2,
    closingOdds: 1.9,
    modelProbability: 0.56,
    stake: 0.2,
    status: 'pending',
    ...overrides,
  };
}

test('TOTO-doel rekent de vereiste 365-daagse groei eerlijk uit', () => {
  const state = math.normalizeState({});
  const metrics = math.computeMetrics(state);

  assert.equal(math.calendarDaysBetween(state.config.startDate, state.config.targetDate), 365);
  assert.equal(metrics.currentBankroll, 10);
  assert.equal(metrics.requiredDailyGrowthPct, 2.56);
  assert.equal(metrics.requiredThirtyDayGrowthPct, 113.2);
  assert.equal(metrics.proof.code, 'unproven');
});

test('TOTO-metrics verwerken winst, verlies, open risico, CLV en drawdown', () => {
  const state = {
    entries: [
      entry({ id: 'won', status: 'won', odds: 2, stake: 0.2, modelProbability: 0.6 }),
      entry({
        id: 'lost',
        createdAt: '2026-07-27T10:00:00.000Z',
        eventDate: '2026-07-28',
        status: 'lost',
        odds: 2.5,
        closingOdds: 2.4,
        stake: 0.2,
        modelProbability: 0.45,
      }),
      entry({
        id: 'pending',
        createdAt: '2026-07-28T10:00:00.000Z',
        eventDate: '2026-07-29',
        status: 'pending',
        stake: 0.15,
      }),
    ],
  };

  const metrics = math.computeMetrics(state);

  assert.equal(metrics.currentBankroll, 10);
  assert.equal(metrics.availableBankroll, 9.85);
  assert.equal(metrics.profit, 0);
  assert.equal(metrics.totalStaked, 0.4);
  assert.equal(metrics.openRisk, 0.15);
  assert.equal(metrics.settledCount, 2);
  assert.equal(metrics.pendingCount, 1);
  assert.equal(metrics.hitRatePct, 50);
  assert.equal(metrics.roiPct, 0);
  assert.equal(metrics.maxDrawdownPct, 2);
  assert.ok(metrics.brierScore > 0);
  assert.ok(metrics.averageClvPct > 0);
});

test('risicorails blokkeren over-inzet, negatieve EV, combi en duplicaten', () => {
  const nowIso = '2026-07-26T11:00:00.000Z';
  const state = {
    entries: [
      entry({
        id: 'existing',
        event: 'Ajax - PSV',
        market: 'Matchresultaat',
        selection: 'Ajax',
        odds: 2,
        modelProbability: 0.56,
        stake: 0.2,
      }),
    ],
  };
  const result = math.validateDraft(
    {
      eventDate: '2026-07-27',
      event: 'Ajax - PSV',
      market: 'Combi matchresultaat',
      selection: 'Ajax',
      odds: 2,
      modelProbability: 0.49,
      stake: 1,
    },
    state,
    nowIso
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => /Combi/.test(message)));
  assert.ok(result.errors.some((message) => /model-edge/.test(message)));
  assert.ok(result.errors.some((message) => /verwachte waarde/.test(message)));
  assert.ok(result.errors.some((message) => /risicogrens/.test(message)));
});

test('geldige paper-voorspelling krijgt reproduceerbare edge en EV', () => {
  const nowIso = '2026-07-26T11:00:00.000Z';
  const result = math.validateDraft(
    {
      eventDate: '2026-07-27',
      event: 'Ajax - PSV',
      market: 'Matchresultaat',
      selection: 'Ajax',
      odds: 2,
      modelProbability: 0.56,
      stake: 0.2,
    },
    { entries: [] },
    nowIso
  );

  assert.equal(result.ok, true);
  assert.equal(result.impliedProbabilityPct, 50);
  assert.equal(result.edgePoints, 6);
  assert.equal(result.expectedValuePct, 12);
  assert.equal(result.risk.maxAllowedStake, 0.2);
});

test('state-normalisatie houdt onbetrouwbare remote waarden binnen harde grenzen', () => {
  const state = math.normalizeState({
    config: {
      startBankroll: -10,
      targetBankroll: Infinity,
      maxStakePct: 99,
    },
    entries: [
      {
        id: '<script>',
        event: 'x'.repeat(300),
        odds: 9000,
        modelProbability: 4,
        stake: -12,
        status: 'hacked',
      },
    ],
  });

  assert.equal(state.config.startBankroll, 0.01);
  assert.equal(state.config.maxStakePct, 5);
  assert.equal(state.entries[0].event.length, 140);
  assert.equal(state.entries[0].odds, 1000);
  assert.equal(state.entries[0].modelProbability, 1);
  assert.equal(state.entries[0].stake, 0);
  assert.equal(state.entries[0].status, 'pending');
});

test('analyse groepeert forward resultaten per markt en kalibratieband', () => {
  const state = {
    entries: [
      entry({ id: 'one', status: 'won', market: 'Matchresultaat', modelProbability: 0.55 }),
      entry({
        id: 'two',
        createdAt: '2026-07-27T10:00:00.000Z',
        eventDate: '2026-07-28',
        status: 'lost',
        market: 'Matchresultaat',
        modelProbability: 0.55,
      }),
      entry({
        id: 'three',
        createdAt: '2026-07-28T10:00:00.000Z',
        eventDate: '2026-07-29',
        status: 'won',
        market: 'Over/under',
        modelProbability: 0.7,
      }),
    ],
  };

  const cohorts = math.computeCohorts(state, 'market');
  const calibration = math.computeCalibrationBins(state);

  assert.equal(cohorts[0].label, 'Matchresultaat');
  assert.equal(cohorts[0].count, 2);
  assert.equal(cohorts[0].hitRatePct, 50);
  assert.equal(cohorts[1].label, 'Over/under');
  assert.equal(calibration.reduce((total, bin) => total + bin.count, 0), 3);
  assert.equal(calibration[2].predictedPct, 55);
  assert.equal(calibration[2].observedPct, 50);
  assert.equal(calibration[3].observedPct, 100);
});
