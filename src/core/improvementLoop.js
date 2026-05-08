const SIGNATURE_FIELDS = Object.freeze([
  'timeframe',
  'guardMode',
  'maxDrawdownTarget',
  'minProfitFactor',
  'scoreThreshold',
  'assetCap',
  'rebalanceBars',
  'emergencyDrawdownStop',
  'targetVolatility',
]);

export const DEFAULT_IMPROVEMENT_RULES = Object.freeze({
  minProfitFactorLift: 0.1,
  minOosEdgeLift: 0.02,
  maxDrawdownWorsening: 0.02,
  minRobustPassRate: 0.35,
  minRollingBeatRate: 0.5,
});

function dateKey(timestamp) {
  return new Date(timestamp || Date.now()).toISOString().slice(0, 10);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(1)}%`;
}

function finiteProfitFactor(value) {
  if (value === Number.POSITIVE_INFINITY) return 8;
  return Number.isFinite(value) ? value : 0;
}

function metricLift(challengerValue, championValue) {
  return (Number(challengerValue) || 0) - (Number(championValue) || 0);
}

function configSignature(config = {}, strategyName = 'unknown') {
  return [
    strategyName,
    ...SIGNATURE_FIELDS.map((field) => {
      const value = config[field];
      return typeof value === 'number' ? value.toFixed(6) : String(value);
    }),
  ].join('|');
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

function summarizeBacktest({ id, label, strategyName, config = {}, result = {} }) {
  const oosEdge = (result.oosReturn || 0) - (result.oosBenchmarkReturn || 0);
  return {
    id,
    label,
    strategyName: strategyName || result.strategyName || 'n.v.t.',
    signature: configSignature(config, strategyName || result.strategyName),
    config: Object.fromEntries(SIGNATURE_FIELDS.map((field) => [field, config[field]])),
    strategyReturn: result.strategyReturn || 0,
    benchmarkReturn: result.benchmarkReturn || 0,
    edge: (result.strategyReturn || 0) - (result.benchmarkReturn || 0),
    oosReturn: result.oosReturn || 0,
    oosBenchmarkReturn: result.oosBenchmarkReturn || 0,
    oosEdge,
    maxDrawdown: result.maxDrawdown || 0,
    profitFactor: result.profitFactor || 0,
    trades: result.trades || 0,
    currentSignal: result.currentSignal?.label || 'CASH',
  };
}

function summarizeLabCandidate(row, source = 'candidate') {
  if (!row) return null;
  const rolling = row.rolling?.summary || null;
  const robustness = row.robustness || null;

  return {
    id: configSignature(row.config, row.strategyName),
    label: `${row.strategyName} ${row.config?.timeframe || ''}`.trim(),
    strategyName: row.strategyName,
    verdict: row.verdict,
    source,
    signature: configSignature(row.config, row.strategyName),
    config: Object.fromEntries(SIGNATURE_FIELDS.map((field) => [field, row.config?.[field]])),
    strategyReturn: row.strategyReturn || 0,
    benchmarkReturn: row.benchmarkReturn || 0,
    edge: row.edge || ((row.strategyReturn || 0) - (row.benchmarkReturn || 0)),
    oosReturn: row.oosReturn || 0,
    oosBenchmarkReturn: row.oosBenchmarkReturn || 0,
    oosEdge: (row.oosReturn || 0) - (row.oosBenchmarkReturn || 0),
    maxDrawdown: row.maxDrawdown || 0,
    profitFactor: row.profitFactor || 0,
    trades: row.trades || 0,
    currentSignal: row.currentSignal?.label || 'CASH',
    currentRiskExposure: row.currentRiskExposure || 0,
    rolling: rolling ? {
      strategyCompoundReturn: rolling.strategyCompoundReturn || 0,
      benchmarkCompoundReturn: rolling.benchmarkCompoundReturn || 0,
      beatRate: rolling.beatRate || 0,
      maxFoldDrawdown: rolling.maxFoldDrawdown || 0,
    } : null,
    robustness: robustness ? {
      verdict: robustness.verdict,
      passRate: robustness.passRate || 0,
      medianProfitFactor: robustness.medianProfitFactor || 0,
      medianEdge: robustness.medianEdge || 0,
      medianOosEdge: robustness.medianOosEdge || 0,
      worstDrawdown: robustness.worstDrawdown || 0,
    } : null,
    failed: (row.failed || []).map((check) => check.id),
  };
}

function buildImprovementChecks({ champion, challenger, rules }) {
  if (!challenger) {
    return [
      makeCheck('challenger-found', 'Er is een nieuwe uitdager gevonden', false, 'Profit Factor Lab leverde geen kandidaat of watchlist-variant op.'),
    ];
  }

  const sameSignature = challenger.signature === champion.signature;
  const challengerPf = finiteProfitFactor(challenger.profitFactor);
  const championPf = finiteProfitFactor(champion.profitFactor);
  const pfLift = metricLift(challengerPf, championPf);
  const oosLift = metricLift(challenger.oosEdge, champion.oosEdge);
  const rolling = challenger.rolling;
  const robustness = challenger.robustness;

  return [
    makeCheck(
      'challenger-found',
      'Uitdager haalt de harde lab-gate',
      challenger.verdict === 'CANDIDATE',
      `Verdict: ${challenger.verdict || 'n.v.t.'}`,
    ),
    makeCheck(
      'not-same-candidate',
      'Uitdager is niet exact dezelfde kampioen',
      !sameSignature,
      sameSignature ? 'Het lab bevestigt dezelfde instelling als de huidige kampioen.' : 'Nieuwe strategie/config gevonden.',
    ),
    makeCheck(
      'profit-factor-lift',
      'Profit factor is duidelijk beter',
      pfLift >= rules.minProfitFactorLift,
      `${challengerPf.toFixed(2)} vs ${championPf.toFixed(2)} · lift ${pfLift.toFixed(2)}`,
    ),
    makeCheck(
      'oos-edge-lift',
      'Recente OOS-edge is duidelijk beter',
      oosLift >= rules.minOosEdgeLift,
      `${formatPercent(challenger.oosEdge)} vs ${formatPercent(champion.oosEdge)} · lift ${formatPercent(oosLift)}`,
    ),
    makeCheck(
      'drawdown-not-worse',
      'Drawdown wordt niet betekenisvol slechter',
      challenger.maxDrawdown <= champion.maxDrawdown + rules.maxDrawdownWorsening,
      `${formatPercent(challenger.maxDrawdown)} vs ${formatPercent(champion.maxDrawdown)}`,
    ),
    makeCheck(
      'rolling-quality',
      'Rolling walk-forward is positief en beter dan benchmark',
      Boolean(rolling)
        && rolling.strategyCompoundReturn > 0
        && rolling.strategyCompoundReturn > rolling.benchmarkCompoundReturn
        && rolling.beatRate >= rules.minRollingBeatRate,
      rolling
        ? `${formatPercent(rolling.strategyCompoundReturn)} vs ${formatPercent(rolling.benchmarkCompoundReturn)} · beat ${formatPercent(rolling.beatRate, 0)}`
        : 'Geen rolling summary.',
    ),
    makeCheck(
      'robustness-pass',
      'Parameterbuurt blijft robuust',
      Boolean(robustness)
        && robustness.verdict === 'PASS'
        && robustness.passRate >= rules.minRobustPassRate,
      robustness
        ? `${robustness.verdict} · ${formatPercent(robustness.passRate, 0)} buren groen`
        : 'Geen robustness-resultaat.',
    ),
    makeCheck(
      'current-exposure',
      'Risk engine ziet vandaag echte exposure',
      challenger.currentRiskExposure > 0,
      `${formatPercent(challenger.currentRiskExposure)} exposure`,
    ),
  ];
}

function decideAction({ challenger, checks }) {
  if (!challenger) return 'NO_CHALLENGER';
  if (checks.every((check) => check.pass)) return 'INCUBATE_CHALLENGER';
  if (challenger.verdict === 'WATCH' || challenger.source === 'watch') {
    return 'WATCH_CHALLENGER';
  }
  if (challenger.verdict === 'CANDIDATE' && checks.filter((check) => !check.pass).length <= 2) {
    return 'WATCH_CHALLENGER';
  }
  return 'KEEP_CHAMPION';
}

function actionMessage(action) {
  if (action === 'INCUBATE_CHALLENGER') {
    return 'Nieuwe uitdager is beter genoeg voor aparte paper-incubatie. De kampioen blijft nog onveranderd.';
  }
  if (action === 'WATCH_CHALLENGER') {
    return 'Uitdager is interessant, maar nog niet duidelijk genoeg beter. Op watchlist houden.';
  }
  if (action === 'NO_CHALLENGER') {
    return 'Geen betere uitdager gevonden. Kampioen blijft lopen.';
  }
  return 'Kampioen blijft. Dagelijkse research heeft geen overtuigende verbetering gevonden.';
}

export function createImprovementReview({
  asOf = Date.now(),
  timeframe = '4H',
  championCandidate = {},
  championBacktest = {},
  lab = {},
  rules = {},
} = {}) {
  const activeRules = { ...DEFAULT_IMPROVEMENT_RULES, ...rules };
  const champion = summarizeBacktest({
    id: championCandidate.id,
    label: championCandidate.label,
    strategyName: championCandidate.strategyName,
    config: championCandidate.config,
    result: championBacktest,
  });
  const challenger = summarizeLabCandidate(lab.candidate, 'candidate')
    || summarizeLabCandidate(lab.watch, 'watch');
  const checks = buildImprovementChecks({ champion, challenger, rules: activeRules });
  const failed = checks.filter((check) => !check.pass);
  const action = decideAction({ challenger, checks });

  return {
    id: `${dateKey(asOf)}-${timeframe}-improvement-review`,
    dateKey: dateKey(asOf),
    timestamp: new Date(asOf).toISOString(),
    timeframe,
    paperOnly: true,
    autoPromote: false,
    action,
    verdict: action,
    message: actionMessage(action),
    rules: activeRules,
    champion,
    challenger,
    labMessage: lab.message || 'n.v.t.',
    checks,
    failed,
  };
}

export function createEmptyImprovementState({ championId = 'unknown', initialCapital = 10000 } = {}) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    championId,
    initialCapital,
    reviews: [],
    latest: null,
    pendingChallenger: null,
    watchlistChallenger: null,
  };
}

export function normalizeImprovementState(state, options = {}) {
  if (!state || !Array.isArray(state.reviews)) return createEmptyImprovementState(options);
  return {
    ...createEmptyImprovementState(options),
    ...state,
    version: 1,
    reviews: state.reviews,
    latest: state.latest || state.reviews[state.reviews.length - 1] || null,
  };
}

export function appendImprovementReview({ state, review }) {
  const activeState = normalizeImprovementState(state, {
    championId: review?.champion?.id || 'unknown',
  });
  if (!review?.dateKey) {
    return {
      state: activeState,
      skipped: true,
      message: 'Geen geldige research-review om te bewaren.',
    };
  }

  if (activeState.reviews.some((entry) => (
    entry.dateKey === review.dateKey && entry.timeframe === review.timeframe
  ))) {
    return {
      state: activeState,
      skipped: true,
      message: `Er bestaat al een improvement-review voor ${review.dateKey} (${review.timeframe}).`,
    };
  }

  const entry = {
    id: review.id,
    dateKey: review.dateKey,
    timestamp: review.timestamp,
    timeframe: review.timeframe,
    action: review.action,
    message: review.message,
    champion: review.champion,
    challenger: review.challenger,
    failed: review.failed.map((check) => check.id),
    checks: review.checks,
  };

  activeState.reviews.push(entry);
  activeState.latest = entry;
  activeState.championId = review.champion?.id || activeState.championId;
  if (review.action === 'INCUBATE_CHALLENGER') {
    activeState.pendingChallenger = review.challenger;
  } else if (review.action === 'WATCH_CHALLENGER') {
    activeState.watchlistChallenger = review.challenger;
  }

  return {
    state: activeState,
    skipped: false,
    entry,
    message: `Improvement-review gelogd voor ${review.dateKey}.`,
  };
}
