import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import {
  runAcceleratedForwardReplay,
  runMultiWindowAcceleratedReplay,
} from '../forward/acceleratedReplay.js';
import { runBacktest } from './backtester.js';
import { DEFAULT_CONFIG } from './riskEngine.js';

export const DEFAULT_CHAMPION_AUDIT_OPTIONS = Object.freeze({
  maxLogs: 120,
  replayBars: 1200,
  windowCount: 4,
  windowLogs: 45,
  minReturnLift: 0.05,
  minOosLift: 0,
  minProfitFactor: 1.65,
  maxDrawdownWorsening: 0.01,
  maxReplacementDrawdown: 0.3,
  minReplayPositiveRate: 0.45,
  minReplayBeatRate: 0.5,
  minCurrentExposure: 0.01,
  replayRules: Object.freeze({
    minLogs: 35,
    maxDrawdown: 0.12,
    maxLossBeforeFail: -0.06,
    minGateOpenRate: 0.02,
  }),
  multiWindowRules: Object.freeze({
    minWindows: 3,
    minPassRate: 0.25,
    minPositiveRate: 0.4,
    minBeatRate: 0.5,
    maxWorstDrawdown: 0.12,
    maxWorstReturn: -0.06,
  }),
});

function mergeOptions(options = {}) {
  return {
    ...DEFAULT_CHAMPION_AUDIT_OPTIONS,
    ...options,
    replayRules: {
      ...DEFAULT_CHAMPION_AUDIT_OPTIONS.replayRules,
      ...(options.replayRules || {}),
    },
    multiWindowRules: {
      ...DEFAULT_CHAMPION_AUDIT_OPTIONS.multiWindowRules,
      ...(options.multiWindowRules || {}),
    },
  };
}

function finiteProfitFactor(value) {
  if (value === Number.POSITIVE_INFINITY) return 8;
  return Number.isFinite(value) ? value : 0;
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n.v.t.';
}

function summarizeReplay(replay) {
  const metrics = replay?.metrics || {};
  return {
    ok: Boolean(replay?.ok),
    verdict: replay?.verdict || 'FAIL',
    logs: metrics.logs || 0,
    return: metrics.paperReturn || 0,
    benchmarkReturn: metrics.benchmarkReturn || 0,
    edge: metrics.edge || 0,
    maxDrawdown: metrics.maxDrawdown || 0,
    gateOpenRate: metrics.gateOpenRate || 0,
    latestSignal: metrics.latestSignal || 'CASH',
    failed: replay?.discipline?.failed?.map((check) => check.id) || [],
  };
}

function summarizeMultiWindow(replay) {
  const summary = replay?.summary || {};
  return {
    ok: Boolean(replay?.ok),
    verdict: replay?.verdict || 'FAIL',
    windows: summary.windows || 0,
    passRate: summary.passRate || 0,
    positiveRate: summary.positiveRate || 0,
    beatRate: summary.beatRate || 0,
    averageReturn: summary.averageReturn || 0,
    medianReturn: summary.medianReturn || 0,
    worstReturn: summary.worstReturn || 0,
    worstDrawdown: summary.worstDrawdown || 0,
    averageGateOpenRate: summary.averageGateOpenRate || 0,
    failed: replay?.discipline?.failed?.map((check) => check.id) || [],
  };
}

function rowIdentity(row, index, fallbackSource) {
  const strategyName = row?.strategyName || row?.strategy?.name || 'unknown';
  return {
    id: row?.id || `${fallbackSource}-${strategyName.toLowerCase().replaceAll(/\s+/g, '-')}-${index}`,
    label: row?.label || strategyName,
    strategyName,
    source: row?.source || fallbackSource,
  };
}

function stableConfigSignature(config = {}) {
  return JSON.stringify(
    Object.keys(config)
      .sort()
      .map((key) => [key, config[key]]),
  );
}

function evaluationSignature(row, baseConfig = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
    ...(row?.config || {}),
  };
  return [
    row?.strategy?.name || row?.strategyName || 'unknown',
    stableConfigSignature(config),
  ].join('|');
}

function currentExposure(backtest) {
  return backtest?.preGateSignal?.risk?.exposure
    || backtest?.preGateSignal?.exposure
    || backtest?.currentSignal?.exposure
    || 0;
}

function scoreAuditRow({ backtest, replay, multiWindow }) {
  if (!backtest?.ok) return Number.NEGATIVE_INFINITY;

  const oosEdge = backtest.oosReturn - backtest.oosBenchmarkReturn;
  const replayFailPenalty = replay.verdict === 'FAIL' || multiWindow.verdict === 'FAIL' ? 1.4 : 0;
  const replayWatchPenalty = replay.verdict === 'WATCH' || multiWindow.verdict === 'WATCH' ? 0.25 : 0;
  const drawdownPenalty = Math.max(0, backtest.maxDrawdown) * 1.35
    + Math.max(0, multiWindow.worstDrawdown) * 0.6;

  return backtest.strategyReturn * 0.95
    + Math.max(-0.5, oosEdge) * 0.65
    + Math.min(4, finiteProfitFactor(backtest.profitFactor)) * 0.18
    + replay.edge * 0.35
    + multiWindow.positiveRate * 0.35
    + multiWindow.beatRate * 0.45
    + currentExposure(backtest) * 0.12
    - drawdownPenalty
    - replayFailPenalty
    - replayWatchPenalty;
}

function evaluateAuditRow({
  row,
  index,
  fallbackSource,
  candlesByAsset,
  assets,
  baseConfig,
  options,
}) {
  const identity = rowIdentity(row, index, fallbackSource);
  if (!row?.strategy) {
    return {
      ...identity,
      ok: false,
      error: `Strategie ontbreekt voor ${identity.label}.`,
      score: Number.NEGATIVE_INFINITY,
    };
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
    ...(row.config || {}),
  };
  const backtest = runBacktest({
    candlesByAsset,
    config,
    strategy: row.strategy,
    assets,
  });
  const singleReplay = runAcceleratedForwardReplay({
    candlesByAsset,
    strategy: row.strategy,
    assets,
    config,
    maxLogs: options.maxLogs,
    replayBars: options.replayBars,
    rules: options.replayRules,
  });
  const multiReplay = runMultiWindowAcceleratedReplay({
    candlesByAsset,
    strategy: row.strategy,
    assets,
    config,
    windowCount: options.windowCount,
    windowLogs: options.windowLogs,
    replayRules: {
      minLogs: Math.min(options.windowLogs, options.replayRules.minLogs),
      maxDrawdown: options.replayRules.maxDrawdown,
      maxLossBeforeFail: options.replayRules.maxLossBeforeFail,
      minGateOpenRate: options.replayRules.minGateOpenRate,
    },
    multiWindowRules: options.multiWindowRules,
  });
  const replay = summarizeReplay(singleReplay);
  const multiWindow = summarizeMultiWindow(multiReplay);
  const oosEdge = backtest.oosReturn - backtest.oosBenchmarkReturn;
  const score = scoreAuditRow({ backtest, replay, multiWindow });

  return {
    ...identity,
    ok: backtest.ok && singleReplay.ok && multiReplay.ok,
    config,
    score,
    strategyReturn: backtest.strategyReturn,
    benchmarkReturn: backtest.benchmarkReturn,
    oosReturn: backtest.oosReturn,
    oosBenchmarkReturn: backtest.oosBenchmarkReturn,
    oosEdge,
    maxDrawdown: backtest.maxDrawdown,
    profitFactor: backtest.profitFactor,
    trades: backtest.trades,
    currentSignal: backtest.currentSignal,
    currentRiskExposure: currentExposure(backtest),
    backtest,
    replay,
    multiWindow,
  };
}

function buildReplacementChecks({ champion, replacement, options }) {
  if (!replacement) {
    return [
      makeCheck('replacement-found', 'Er is een vervanger om te beoordelen', false, 'Geen challenger beschikbaar.'),
    ];
  }

  const championOosEdge = champion?.oosEdge || 0;
  return [
    makeCheck(
      'replacement-found',
      'Er is een vervanger om te beoordelen',
      Boolean(replacement),
      replacement.label,
    ),
    makeCheck(
      'return-lift',
      'Vervanger heeft duidelijk hogere totale return',
      replacement.strategyReturn > champion.strategyReturn + options.minReturnLift,
      `${formatPercent(replacement.strategyReturn)} vs kampioen ${formatPercent(champion.strategyReturn)}`,
    ),
    makeCheck(
      'oos-lift',
      'Vervanger verbetert recente OOS-edge',
      replacement.oosEdge >= championOosEdge + options.minOosLift,
      `${formatPercent(replacement.oosEdge)} vs kampioen ${formatPercent(championOosEdge)}`,
    ),
    makeCheck(
      'profit-factor',
      'Vervanger haalt minimale profit factor',
      replacement.profitFactor >= options.minProfitFactor,
      `${finiteProfitFactor(replacement.profitFactor).toFixed(2)} minimum ${options.minProfitFactor.toFixed(2)}`,
    ),
    makeCheck(
      'drawdown-not-worse',
      'Vervanger maakt drawdown niet betekenisvol slechter',
      replacement.maxDrawdown <= champion.maxDrawdown + options.maxDrawdownWorsening,
      `${formatPercent(replacement.maxDrawdown)} vs kampioen ${formatPercent(champion.maxDrawdown)}`,
    ),
    makeCheck(
      'drawdown-cap',
      'Vervanger blijft binnen absolute drawdown-limiet',
      replacement.maxDrawdown <= options.maxReplacementDrawdown,
      `${formatPercent(replacement.maxDrawdown)} limiet ${formatPercent(options.maxReplacementDrawdown)}`,
    ),
    makeCheck(
      'replay-not-fail',
      'Replay faalt niet hard',
      replacement.replay.verdict !== 'FAIL' && replacement.multiWindow.verdict !== 'FAIL',
      `${replacement.replay.verdict} / ${replacement.multiWindow.verdict}`,
    ),
    makeCheck(
      'replay-positive-rate',
      'Meerdere replay-ramen zijn positief',
      replacement.multiWindow.positiveRate >= options.minReplayPositiveRate,
      `${formatPercent(replacement.multiWindow.positiveRate)} minimum ${formatPercent(options.minReplayPositiveRate)}`,
    ),
    makeCheck(
      'replay-beat-rate',
      'Meerdere replay-ramen verslaan benchmark',
      replacement.multiWindow.beatRate >= options.minReplayBeatRate,
      `${formatPercent(replacement.multiWindow.beatRate)} minimum ${formatPercent(options.minReplayBeatRate)}`,
    ),
    makeCheck(
      'current-exposure',
      'Huidige risk engine exposure is niet cash-only',
      replacement.currentRiskExposure > options.minCurrentExposure,
      `${formatPercent(replacement.currentRiskExposure)} minimum ${formatPercent(options.minCurrentExposure)}`,
    ),
  ];
}

export function runChampionAudit({
  candlesByAsset,
  champion,
  challengers = [],
  baseConfig = {},
  assets = SUPPORTED_ASSETS,
  options = {},
} = {}) {
  const activeOptions = mergeOptions(options);
  const seenSignatures = new Set([evaluationSignature(champion, baseConfig)]);
  const skippedDuplicates = [];
  const uniqueChallengers = [];

  challengers.forEach((row, index) => {
    const signature = evaluationSignature(row, baseConfig);
    if (seenSignatures.has(signature)) {
      skippedDuplicates.push(rowIdentity(row, index + 1, 'challenger'));
      return;
    }
    seenSignatures.add(signature);
    uniqueChallengers.push(row);
  });

  const championRow = evaluateAuditRow({
    row: champion,
    index: 0,
    fallbackSource: 'champion',
    candlesByAsset,
    assets,
    baseConfig,
    options: activeOptions,
  });
  const challengerRows = uniqueChallengers.map((row, index) => evaluateAuditRow({
    row,
    index: index + 1,
    fallbackSource: 'challenger',
    candlesByAsset,
    assets,
    baseConfig,
    options: activeOptions,
  }));
  const rows = [championRow, ...challengerRows]
    .sort((a, b) => b.score - a.score);
  const bestChallenger = challengerRows
    .filter((row) => row.ok)
    .sort((a, b) => b.score - a.score)[0] || null;
  const replacementChecks = buildReplacementChecks({
    champion: championRow,
    replacement: bestChallenger,
    options: activeOptions,
  });
  const failed = replacementChecks.filter((check) => !check.pass);
  const replacementReady = Boolean(bestChallenger) && failed.length === 0;
  const leader = rows[0] || null;
  const verdict = replacementReady
    ? 'RESEARCH_CHAMPION_REPLACEMENT'
    : leader?.id === championRow.id
      ? 'CHAMPION_OK'
      : 'NO_SAFE_REPLACEMENT';

  return {
    ok: championRow.ok || challengerRows.some((row) => row.ok),
    mode: 'champion-audit',
    paperOnly: true,
    autoPromote: false,
    options: activeOptions,
    champion: championRow,
    replacement: bestChallenger,
    leader,
    rows,
    skippedDuplicates,
    replacementChecks,
    failed,
    verdict,
    action: verdict === 'RESEARCH_CHAMPION_REPLACEMENT'
      ? 'HUMAN_REVIEW_CHAMPION_REPLACEMENT'
      : verdict === 'CHAMPION_OK'
        ? 'KEEP_CHAMPION'
        : 'KEEP_CHAMPION_AND_RESEARCH_MORE',
    message: verdict === 'RESEARCH_CHAMPION_REPLACEMENT'
      ? `${bestChallenger.label} is historisch sterker dan de huidige kampioen, maar blijft paper-only tot handmatige review.`
      : verdict === 'CHAMPION_OK'
        ? 'De huidige kampioen blijft de beste veilige keuze binnen deze audit.'
        : 'Er is wel competitie, maar geen vervanger passeert de conservatieve audit volledig.',
  };
}
