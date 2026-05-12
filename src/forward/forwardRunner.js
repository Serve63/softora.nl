import { applyPortfolioReturn, equalWeight } from '../core/portfolio.js';
import { clearForwardState, loadForwardState, saveForwardState } from '../storage/localStore.js';

export const FROZEN_INCUBATION_CANDIDATE = Object.freeze({
  id: 'tail-convex-meta-4h-audit-v1',
  label: 'Tail Convex Meta 4H Audit v1',
  strategyName: 'Tail Convex Meta v1',
  lockedAt: '2026-05-09',
  paperOnly: true,
  config: Object.freeze({
    timeframe: '4H',
    candleTarget: 3000,
    guardMode: 'Strict',
    maxDrawdownTarget: 0.3,
    minProfitFactor: 1.65,
    scoreThreshold: 65,
    assetCap: 0.35,
    rebalanceBars: 90,
    emergencyDrawdownStop: 0.18,
    targetVolatility: 0.03,
  }),
});

const CANDIDATE_LOCK_FIELDS = Object.freeze([
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

const DEFAULT_FORWARD_RULES = Object.freeze({
  firstDecisionLogs: 30,
  promoteLogs: 90,
  minGateOpenRate: 0.5,
  maxForwardDrawdown: FROZEN_INCUBATION_CANDIDATE.config.emergencyDrawdownStop,
  maxLossBeforeReview: -0.1,
});

export function createEmptyForwardState(
  initialCapital = 10000,
  candidate = FROZEN_INCUBATION_CANDIDATE,
) {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    initialCapital,
    candidate,
    logs: [],
    paperPortfolio: {
      equity: initialCapital,
      weights: {},
    },
    benchmarkPortfolio: {
      equity: initialCapital,
      weights: {},
    },
  };
}

function normalizeForwardState(
  state,
  initialCapital = 10000,
  candidate = FROZEN_INCUBATION_CANDIDATE,
) {
  if (!state || !Array.isArray(state.logs)) return null;
  const normalizedInitialCapital = Number(state.initialCapital || initialCapital) || 10000;
  return {
    ...state,
    version: 2,
    initialCapital: normalizedInitialCapital,
    candidate: state.candidate || candidate,
    paperPortfolio: state.paperPortfolio || { equity: normalizedInitialCapital, weights: {} },
    benchmarkPortfolio: state.benchmarkPortfolio || { equity: normalizedInitialCapital, weights: {} },
    logs: state.logs,
  };
}

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function decisionKey(timestamp, timeframe = 'Daily') {
  const iso = new Date(timestamp).toISOString();
  if (timeframe === 'Daily') return iso.slice(0, 10);
  return iso;
}

function decisionLabel(timestamp, timeframe = 'Daily') {
  const iso = new Date(timestamp).toISOString();
  if (timeframe === 'Daily') return iso.slice(0, 10);
  return iso.replace('T', ' ').slice(0, 16);
}

function latestPricesFromCandles(candlesByAsset, assets) {
  return Object.fromEntries(assets.map((asset) => {
    const candles = candlesByAsset[asset] || [];
    const last = candles[candles.length - 1];
    return [asset, last?.close || null];
  }));
}

export function loadOrCreateForwardState(initialCapital = 10000, storage) {
  return normalizeForwardState(loadForwardState(storage), initialCapital) || createEmptyForwardState(initialCapital);
}

export function loadOrCreateForwardStateForCandidate(candidate, initialCapital = 10000, storage) {
  const activeCandidate = candidate || FROZEN_INCUBATION_CANDIDATE;
  const loaded = normalizeForwardState(loadForwardState(storage), initialCapital, activeCandidate);
  if (loaded?.candidate?.id === activeCandidate.id) return loaded;
  return createEmptyForwardState(initialCapital, activeCandidate);
}

function configMatchesCandidate(config = {}, candidate = FROZEN_INCUBATION_CANDIDATE) {
  return CANDIDATE_LOCK_FIELDS.every((field) => {
    const expected = candidate.config[field];
    const actual = config[field];
    if (typeof expected === 'number') return Math.abs((Number(actual) || 0) - expected) < 1e-9;
    return actual === expected;
  });
}

export function logForwardSignal({
  state,
  signal,
  candlesByAsset,
  assets,
  config,
  backtest,
  candidate = FROZEN_INCUBATION_CANDIDATE,
  storage,
  timestamp,
} = {}) {
  const activeState = state || loadOrCreateForwardState(config?.initialCapital || 10000, storage);
  const activeCandidate = activeState.candidate || candidate;
  if (!configMatchesCandidate(config, activeCandidate)) {
    return {
      state: activeState,
      skipped: true,
      message: `Forward-incubatie is gelockt op ${activeCandidate.label}; pas eerst de PF-kandidaat toe.`,
    };
  }

  const firstAssetCandles = candlesByAsset?.[assets?.[0]] || [];
  const lastCandle = firstAssetCandles[firstAssetCandles.length - 1];
  const asOf = timestamp || lastCandle?.time || Date.now();
  const key = dateKey(asOf);
  const timeframe = config?.timeframe || 'Daily';
  const logKey = decisionKey(asOf, timeframe);

  if (activeState.logs.some((entry) => (
    (entry.decisionKey || decisionKey(entry.timestamp || entry.dateKey, entry.timeframe || timeframe)) === logKey
    && entry.timeframe === timeframe
  ))) {
    return {
      state: activeState,
      skipped: true,
      message: `Er bestaat al een forward-log voor ${decisionLabel(asOf, timeframe)} (${timeframe}).`,
    };
  }

  const latestPrices = latestPricesFromCandles(candlesByAsset || {}, assets || []);
  const previousLog = activeState.logs[activeState.logs.length - 1];
  let paperEquity = activeState.paperPortfolio?.equity ?? config.initialCapital;
  let benchmarkEquity = activeState.benchmarkPortfolio?.equity ?? config.initialCapital;

  if (previousLog?.prices) {
    paperEquity = applyPortfolioReturn(
      paperEquity,
      previousLog.weights || {},
      previousLog.prices,
      latestPrices,
    ).equity;

    benchmarkEquity = applyPortfolioReturn(
      benchmarkEquity,
      previousLog.benchmarkWeights || equalWeight(assets, 1),
      previousLog.prices,
      latestPrices,
    ).equity;
  }

  const benchmarkWeights = equalWeight(assets || [], 1);
  const gate = backtest?.gate || {};
  const gateFailed = Array.isArray(gate.failed) ? gate.failed.map((check) => check.id) : [];
  const entry = {
    id: `${logKey}-${timeframe}-${activeCandidate.id}`,
    dateKey: key,
    decisionKey: logKey,
    timestamp: new Date(asOf).toISOString(),
    timeframe,
    candidateId: activeCandidate.id,
    strategyName: activeCandidate.strategyName,
    signal: signal?.label || 'CASH',
    gateOpen: typeof gate.open === 'boolean' ? gate.open : Boolean(signal?.exposure > 0),
    gateFailed,
    weights: signal?.weights || {},
    benchmarkWeights,
    prices: latestPrices,
    paperEquity,
    benchmarkEquity,
    edge: paperEquity - benchmarkEquity,
    configSnapshot: Object.fromEntries(CANDIDATE_LOCK_FIELDS.map((field) => [field, config?.[field]])),
    backtestSnapshot: backtest ? {
      strategyReturn: backtest.strategyReturn,
      benchmarkReturn: backtest.benchmarkReturn,
      oosReturn: backtest.oosReturn,
      oosBenchmarkReturn: backtest.oosBenchmarkReturn,
      maxDrawdown: backtest.maxDrawdown,
      profitFactor: backtest.profitFactor,
      walkForwardBeatRate: backtest.walkForwardBeatRate,
      trades: backtest.trades,
    } : null,
    notes: signal?.reasons || [],
  };

  activeState.logs.push(entry);
  activeState.paperPortfolio = {
    equity: paperEquity,
    weights: entry.weights,
  };
  activeState.benchmarkPortfolio = {
    equity: benchmarkEquity,
    weights: benchmarkWeights,
  };

  saveForwardState(activeState, storage);
  return {
    state: activeState,
    skipped: false,
    entry,
    message: `Forward-signaal gelogd voor ${decisionLabel(asOf, timeframe)}.`,
  };
}

function calculateDrawdownFromEquity(values) {
  let peak = values[0] || 0;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.max(drawdown, 1 - value / peak);
  }
  return drawdown;
}

export function calculateForwardMetrics(state, config = {}) {
  const activeState = normalizeForwardState(state, config.initialCapital || 10000) || createEmptyForwardState(config.initialCapital);
  const logs = activeState.logs || [];
  const initialCapital = activeState.initialCapital || config.initialCapital || 10000;
  const last = logs[logs.length - 1] || null;
  const paperEquity = last?.paperEquity ?? initialCapital;
  const benchmarkEquity = last?.benchmarkEquity ?? initialCapital;
  const equitySeries = [initialCapital, ...logs.map((entry) => entry.paperEquity).filter(Number.isFinite)];
  const benchmarkSeries = [initialCapital, ...logs.map((entry) => entry.benchmarkEquity).filter(Number.isFinite)];
  const startTime = logs[0]?.timestamp || null;
  const endTime = last?.timestamp || null;
  const daysSinceStart = startTime && endTime
    ? Math.max(1, Math.round((new Date(endTime) - new Date(startTime)) / (24 * 60 * 60 * 1000)) + 1)
    : 0;

  return {
    logs: logs.length,
    startTime,
    endTime,
    daysSinceStart,
    initialCapital,
    paperEquity,
    benchmarkEquity,
    paperReturn: initialCapital > 0 ? paperEquity / initialCapital - 1 : 0,
    benchmarkReturn: initialCapital > 0 ? benchmarkEquity / initialCapital - 1 : 0,
    edge: initialCapital > 0 ? (paperEquity - benchmarkEquity) / initialCapital : 0,
    maxDrawdown: calculateDrawdownFromEquity(equitySeries),
    benchmarkMaxDrawdown: calculateDrawdownFromEquity(benchmarkSeries),
    gateOpenRate: logs.length ? logs.filter((entry) => entry.gateOpen).length / logs.length : 0,
    latestSignal: last?.signal || 'n.v.t.',
    latestGateOpen: last?.gateOpen || false,
    latestGateFailed: last?.gateFailed || [],
    candidate: activeState.candidate || FROZEN_INCUBATION_CANDIDATE,
  };
}

export function calculateLiveMarkToMarket({
  state,
  prices,
  assets = [],
  config = {},
  timestamp = Date.now(),
} = {}) {
  const activeState = normalizeForwardState(state, config.initialCapital || 10000);
  const logs = activeState?.logs || [];
  const last = logs[logs.length - 1] || null;
  const initialCapital = activeState?.initialCapital || config.initialCapital || 10000;

  if (!last?.prices) {
    return {
      ok: false,
      error: 'Nog geen forward-log met prijzen beschikbaar voor live waardering.',
      timestamp: new Date(timestamp).toISOString(),
    };
  }

  const activeAssets = assets.length ? assets : Object.keys(last.prices || {});
  const livePrices = Object.fromEntries(
    activeAssets.map((asset) => [asset, Number(prices?.[asset]) || last.prices?.[asset] || null]),
  );
  const paper = applyPortfolioReturn(
    last.paperEquity ?? initialCapital,
    last.weights || {},
    last.prices,
    livePrices,
  );
  const benchmark = applyPortfolioReturn(
    last.benchmarkEquity ?? initialCapital,
    last.benchmarkWeights || equalWeight(activeAssets, 1),
    last.prices,
    livePrices,
  );
  const paperReturn = initialCapital > 0 ? paper.equity / initialCapital - 1 : 0;
  const benchmarkReturn = initialCapital > 0 ? benchmark.equity / initialCapital - 1 : 0;

  return {
    ok: true,
    mode: 'live-mark-to-market',
    paperOnly: true,
    timestamp: new Date(timestamp).toISOString(),
    lastLogTime: last.timestamp || null,
    lastSignal: last.signal || 'n.v.t.',
    lastWeights: last.weights || {},
    livePrices,
    logPaperEquity: last.paperEquity ?? initialCapital,
    logBenchmarkEquity: last.benchmarkEquity ?? initialCapital,
    paperEquity: paper.equity,
    benchmarkEquity: benchmark.equity,
    paperReturn,
    benchmarkReturn,
    edge: paperReturn - benchmarkReturn,
    edgeMoney: paper.equity - benchmark.equity,
    paperUnrealizedSinceLog: paper.equity - (last.paperEquity ?? initialCapital),
    benchmarkUnrealizedSinceLog: benchmark.equity - (last.benchmarkEquity ?? initialCapital),
    logs: logs.length,
  };
}

export function evaluateForwardDiscipline(state, config = {}, rules = {}) {
  const activeRules = { ...DEFAULT_FORWARD_RULES, ...rules };
  const metrics = calculateForwardMetrics(state, config);
  const decisionActive = metrics.logs >= activeRules.firstDecisionLogs;
  const checks = [
    {
      id: 'sample-size',
      label: 'Minimaal forward logs voor eerste oordeel',
      pass: decisionActive,
      active: decisionActive,
      detail: `${metrics.logs}/${activeRules.firstDecisionLogs}`,
    },
    {
      id: 'forward-edge',
      label: 'Forward paper verslaat benchmark',
      pass: metrics.paperReturn > metrics.benchmarkReturn,
      active: decisionActive,
      detail: `${(metrics.paperReturn * 100).toFixed(1)}% vs ${(metrics.benchmarkReturn * 100).toFixed(1)}%`,
    },
    {
      id: 'forward-drawdown',
      label: 'Forward drawdown blijft binnen incubatielimiet',
      pass: metrics.maxDrawdown <= activeRules.maxForwardDrawdown,
      active: decisionActive,
      detail: `${(metrics.maxDrawdown * 100).toFixed(1)}% limiet ${(activeRules.maxForwardDrawdown * 100).toFixed(1)}%`,
    },
    {
      id: 'gate-health',
      label: 'Gate vaak genoeg open',
      pass: metrics.gateOpenRate >= activeRules.minGateOpenRate,
      active: decisionActive,
      detail: `${(metrics.gateOpenRate * 100).toFixed(0)}% minimum ${(activeRules.minGateOpenRate * 100).toFixed(0)}%`,
    },
    {
      id: 'loss-control',
      label: 'Forward verlies blijft onder reviewgrens',
      pass: metrics.paperReturn >= activeRules.maxLossBeforeReview,
      active: decisionActive,
      detail: `${(metrics.paperReturn * 100).toFixed(1)}% grens ${(activeRules.maxLossBeforeReview * 100).toFixed(1)}%`,
    },
  ];
  const activeFailed = checks.filter((check) => check.active && !check.pass);
  const verdict = metrics.logs === 0
    ? 'WAITING'
    : !decisionActive
      ? 'INCUBATING'
      : activeFailed.length === 0 && metrics.logs >= activeRules.promoteLogs && metrics.paperReturn > 0
        ? 'PROMOTE_READY'
        : activeFailed.length === 0
          ? 'PASS'
          : activeFailed.length === 1
            ? 'WATCH'
            : 'DEGRADE';

  return {
    verdict,
    metrics,
    checks,
    failed: activeFailed,
    rules: activeRules,
    message: verdict === 'WAITING'
      ? 'Nog geen forward logs.'
      : verdict === 'INCUBATING'
        ? `Incubatie loopt: ${metrics.logs}/${activeRules.firstDecisionLogs} logs voor eerste oordeel.`
        : verdict === 'PROMOTE_READY'
          ? 'Forward discipline groen: kandidaat is klaar voor strengere evaluatie.'
          : verdict === 'PASS'
            ? 'Forward discipline groen: kandidaat blijft in incubatie.'
            : `Forward discipline waarschuwt: ${activeFailed.map((check) => check.label).join(', ')}.`,
  };
}

export function exportForwardJson(state) {
  return JSON.stringify(normalizeForwardState(state) || createEmptyForwardState(), null, 2);
}

export function importForwardJson(raw, storage) {
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.logs)) {
    throw new Error('JSON import bevat geen geldige forward logs.');
  }
  const normalized = normalizeForwardState(parsed);
  saveForwardState(normalized, storage);
  return normalized;
}

export function exportForwardCsv(state) {
  const rows = [
    ['date', 'decision_key', 'timeframe', 'candidate_id', 'signal', 'gate_open', 'gate_failed', 'paper_equity', 'benchmark_equity', 'edge', 'weights'],
  ];

  for (const entry of state?.logs || []) {
    rows.push([
      entry.dateKey,
      entry.decisionKey || entry.timestamp || entry.dateKey,
      entry.timeframe,
      entry.candidateId || '',
      entry.signal,
      entry.gateOpen ? 'true' : 'false',
      (entry.gateFailed || []).join('|'),
      String(entry.paperEquity),
      String(entry.benchmarkEquity),
      String(entry.edge ?? ''),
      JSON.stringify(entry.weights).replaceAll('"', '""'),
    ]);
  }

  return rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

export function resetForwardState(initialCapital = 10000, storage) {
  clearForwardState(storage);
  const state = createEmptyForwardState(initialCapital);
  saveForwardState(state, storage);
  return state;
}
