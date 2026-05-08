import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { alignCandles } from '../core/backtester.js';
import {
  applyPortfolioReturn,
  driftWeights,
  equalWeight,
  rebalancePortfolio,
  sumWeights,
} from '../core/portfolio.js';
import { DEFAULT_CONFIG } from '../core/riskEngine.js';

export const DEFAULT_REPLAY_RULES = Object.freeze({
  minLogs: 60,
  minEdgeOverBenchmark: 0,
  maxDrawdown: 0.12,
  minGateOpenRate: 0.05,
  maxLossBeforeFail: -0.06,
});

export const DEFAULT_MULTI_WINDOW_RULES = Object.freeze({
  minWindows: 4,
  minPassRate: 0.6,
  minPositiveRate: 0.5,
  minBeatRate: 0.6,
  maxWorstDrawdown: 0.12,
  maxWorstReturn: -0.06,
});

function point(time, value) {
  return { time, value };
}

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function pricesAt(candlesByAsset, assets, index) {
  return Object.fromEntries(assets.map((asset) => [asset, candlesByAsset[asset][index]?.close]));
}

function sliceUntil(candlesByAsset, assets, endIndexExclusive) {
  return Object.fromEntries(
    assets.map((asset) => [asset, candlesByAsset[asset].slice(0, endIndexExclusive)]),
  );
}

function calculateDrawdown(equityCurve) {
  let peak = equityCurve[0]?.value || 0;
  let drawdown = 0;
  for (const item of equityCurve) {
    peak = Math.max(peak, item.value);
    if (peak > 0) drawdown = Math.max(drawdown, 1 - item.value / peak);
  }
  return drawdown;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return 0;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

export function buildReplayIndexes({
  times = [],
  startIndex = 0,
  maxLogs = 120,
  logFrequency = 'daily',
} = {}) {
  const indexes = [];
  if (logFrequency === 'candle') {
    for (let index = Math.max(1, startIndex); index < times.length; index += 1) indexes.push(index);
  } else {
    const latestIndexByDate = new Map();
    for (let index = Math.max(1, startIndex); index < times.length; index += 1) {
      latestIndexByDate.set(dateKey(times[index]), index);
    }
    indexes.push(...latestIndexByDate.values());
  }

  const activeMaxLogs = Math.max(1, Number(maxLogs) || 120);
  return indexes.slice(-activeMaxLogs);
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

export function evaluateAcceleratedReplay(metrics, rules = {}) {
  const activeRules = { ...DEFAULT_REPLAY_RULES, ...rules };
  const checks = [
    makeCheck(
      'sample-size',
      'Replay heeft genoeg beslismomenten',
      metrics.logs >= activeRules.minLogs,
      `${metrics.logs}/${activeRules.minLogs}`,
    ),
    makeCheck(
      'positive-return',
      'Replay paper return is positief',
      metrics.paperReturn > 0,
      `${(metrics.paperReturn * 100).toFixed(2)}%`,
    ),
    makeCheck(
      'beats-benchmark',
      'Replay verslaat benchmark',
      metrics.edge >= activeRules.minEdgeOverBenchmark,
      `${(metrics.paperReturn * 100).toFixed(2)}% vs ${(metrics.benchmarkReturn * 100).toFixed(2)}%`,
    ),
    makeCheck(
      'drawdown-control',
      'Replay drawdown blijft binnen limiet',
      metrics.maxDrawdown <= activeRules.maxDrawdown,
      `${(metrics.maxDrawdown * 100).toFixed(2)}% limiet ${(activeRules.maxDrawdown * 100).toFixed(2)}%`,
    ),
    makeCheck(
      'loss-control',
      'Replay verlies blijft onder kill-grens',
      metrics.paperReturn >= activeRules.maxLossBeforeFail,
      `${(metrics.paperReturn * 100).toFixed(2)}% grens ${(activeRules.maxLossBeforeFail * 100).toFixed(2)}%`,
    ),
    makeCheck(
      'gate-health',
      'Replay heeft genoeg actieve signalen',
      metrics.gateOpenRate >= activeRules.minGateOpenRate,
      `${(metrics.gateOpenRate * 100).toFixed(0)}% minimum ${(activeRules.minGateOpenRate * 100).toFixed(0)}%`,
    ),
  ];
  const failed = checks.filter((check) => !check.pass);
  const verdict = failed.length === 0
    ? 'PASS'
    : failed.some((check) => ['loss-control', 'drawdown-control'].includes(check.id))
      ? 'FAIL'
      : 'WATCH';

  return {
    verdict,
    checks,
    failed,
    rules: activeRules,
    message: verdict === 'PASS'
      ? 'Accelerated replay is groen; nog steeds alleen historisch paper-bewijs.'
      : verdict === 'WATCH'
        ? `Accelerated replay is watch: ${failed.map((check) => check.label).join(', ')}.`
        : `Accelerated replay faalt: ${failed.map((check) => check.label).join(', ')}.`,
  };
}

function sliceAlignedUntil(aligned, endIndexInclusive) {
  return Object.fromEntries(
    aligned.assets.map((asset) => [asset, aligned.candlesByAsset[asset].slice(0, endIndexInclusive + 1)]),
  );
}

function buildWindowRanges(replayIndexes, windowLogs, windowCount) {
  const activeWindowLogs = Math.max(1, Number(windowLogs) || 60);
  const activeWindowCount = Math.max(1, Number(windowCount) || 6);
  const ranges = [];
  let endPosition = replayIndexes.length - 1;

  while (endPosition >= 0 && ranges.length < activeWindowCount) {
    const startPosition = Math.max(0, endPosition - activeWindowLogs + 1);
    const indexes = replayIndexes.slice(startPosition, endPosition + 1);
    if (indexes.length) {
      ranges.push({
        startPosition,
        endPosition,
        startIndex: indexes[0],
        endIndex: indexes[indexes.length - 1],
        logs: indexes.length,
      });
    }
    endPosition = startPosition - 1;
  }

  return ranges.reverse();
}

export function evaluateMultiWindowReplay(summary, rules = {}) {
  const activeRules = { ...DEFAULT_MULTI_WINDOW_RULES, ...rules };
  const checks = [
    makeCheck(
      'window-count',
      'Multi-window replay heeft genoeg periodes',
      summary.windows >= activeRules.minWindows,
      `${summary.windows}/${activeRules.minWindows}`,
    ),
    makeCheck(
      'pass-rate',
      'Genoeg replay-ramen zijn groen',
      summary.passRate >= activeRules.minPassRate,
      `${(summary.passRate * 100).toFixed(0)}% minimum ${(activeRules.minPassRate * 100).toFixed(0)}%`,
    ),
    makeCheck(
      'positive-rate',
      'Genoeg replay-ramen zijn positief',
      summary.positiveRate >= activeRules.minPositiveRate,
      `${(summary.positiveRate * 100).toFixed(0)}% minimum ${(activeRules.minPositiveRate * 100).toFixed(0)}%`,
    ),
    makeCheck(
      'beat-rate',
      'Genoeg replay-ramen verslaan benchmark',
      summary.beatRate >= activeRules.minBeatRate,
      `${(summary.beatRate * 100).toFixed(0)}% minimum ${(activeRules.minBeatRate * 100).toFixed(0)}%`,
    ),
    makeCheck(
      'worst-drawdown',
      'Slechtste replay-drawdown blijft binnen limiet',
      summary.worstDrawdown <= activeRules.maxWorstDrawdown,
      `${(summary.worstDrawdown * 100).toFixed(2)}% limiet ${(activeRules.maxWorstDrawdown * 100).toFixed(2)}%`,
    ),
    makeCheck(
      'worst-return',
      'Slechtste replay-return blijft boven kill-grens',
      summary.worstReturn >= activeRules.maxWorstReturn,
      `${(summary.worstReturn * 100).toFixed(2)}% grens ${(activeRules.maxWorstReturn * 100).toFixed(2)}%`,
    ),
  ];
  const failed = checks.filter((check) => !check.pass);
  const verdict = failed.length === 0
    ? 'PASS'
    : failed.some((check) => ['worst-drawdown', 'worst-return'].includes(check.id))
      ? 'FAIL'
      : 'WATCH';

  return {
    verdict,
    checks,
    failed,
    rules: activeRules,
    message: verdict === 'PASS'
      ? 'Multi-window replay is groen; strategie houdt in meerdere historische periodes stand.'
      : verdict === 'WATCH'
        ? `Multi-window replay is watch: ${failed.map((check) => check.label).join(', ')}.`
        : `Multi-window replay faalt: ${failed.map((check) => check.label).join(', ')}.`,
  };
}

export function runAcceleratedForwardReplay({
  candlesByAsset,
  strategy,
  config: rawConfig = {},
  assets = SUPPORTED_ASSETS,
  startIndex,
  maxLogs = 120,
  replayBars,
  logFrequency = 'daily',
  rules = {},
  strictNoLookahead = true,
} = {}) {
  const config = { ...DEFAULT_CONFIG, ...rawConfig };
  const aligned = alignCandles(candlesByAsset || {}, assets);

  if (aligned.error) {
    return {
      ok: false,
      error: aligned.error,
      verdict: 'FAIL',
      logs: [],
      metrics: null,
      discipline: null,
    };
  }

  const warmupBars = config.warmupBars || 240;
  const replayStart = Number.isFinite(startIndex)
    ? Math.max(1, Math.floor(startIndex))
    : Math.max(warmupBars, aligned.times.length - (Number(replayBars) || aligned.times.length));
  const replayIndexes = buildReplayIndexes({
    times: aligned.times,
    startIndex: replayStart,
    maxLogs,
    logFrequency,
  });

  if (!replayIndexes.length) {
    return {
      ok: false,
      error: 'Te weinig candles voor accelerated replay.',
      verdict: 'FAIL',
      logs: [],
      metrics: null,
      discipline: null,
    };
  }

  let paperEquity = config.initialCapital;
  let benchmarkEquity = config.initialCapital;
  let weights = {};
  let benchmarkWeights = equalWeight(aligned.assets, 1);
  let previousIndex = null;
  let peakEquity = paperEquity;
  let tradeEvents = 0;
  let feesPaid = 0;
  let slippagePaid = 0;
  const logs = [];
  const equityCurve = [point(aligned.times[replayIndexes[0]], paperEquity)];
  const benchmarkCurve = [point(aligned.times[replayIndexes[0]], benchmarkEquity)];

  for (const index of replayIndexes) {
    if (previousIndex !== null) {
      const previousPrices = pricesAt(aligned.candlesByAsset, aligned.assets, previousIndex);
      const currentPrices = pricesAt(aligned.candlesByAsset, aligned.assets, index);
      paperEquity = applyPortfolioReturn(paperEquity, weights, previousPrices, currentPrices).equity;
      weights = driftWeights(weights, previousPrices, currentPrices);
      benchmarkEquity = applyPortfolioReturn(benchmarkEquity, benchmarkWeights, previousPrices, currentPrices).equity;
      benchmarkWeights = driftWeights(benchmarkWeights, previousPrices, currentPrices);
    }

    peakEquity = Math.max(peakEquity, paperEquity);
    const currentDrawdown = peakEquity > 0 ? Math.max(0, 1 - paperEquity / peakEquity) : 0;
    const availableCandlesByAsset = strictNoLookahead
      ? sliceUntil(aligned.candlesByAsset, aligned.assets, index + 1)
      : aligned.candlesByAsset;
    const signalIndex = strictNoLookahead ? availableCandlesByAsset[aligned.assets[0]].length - 1 : index;
    const signal = strategy.generateSignal({
      candlesByAsset: availableCandlesByAsset,
      index: signalIndex,
      assets: aligned.assets,
      config,
      currentDrawdown,
    });
    const targetWeights = signal?.weights || {};
    const rebalance = rebalancePortfolio({
      equity: paperEquity,
      currentWeights: weights,
      targetWeights,
      feeRate: config.feeRate,
      slippageRate: config.slippageRate,
    });

    if (rebalance.turnover > 0.015) tradeEvents += 1;
    feesPaid += rebalance.feePaid;
    slippagePaid += rebalance.slippagePaid;
    paperEquity = rebalance.equity;
    weights = rebalance.weights;

    const prices = pricesAt(aligned.candlesByAsset, aligned.assets, index);
    const exposure = sumWeights(weights);
    const entry = {
      index,
      dateKey: dateKey(aligned.times[index]),
      timestamp: new Date(aligned.times[index]).toISOString(),
      signal: signal?.label || 'CASH',
      gateOpen: exposure > 0,
      weights,
      exposure,
      paperEquity,
      benchmarkEquity,
      drawdown: currentDrawdown,
      turnover: rebalance.turnover,
      feePaid: rebalance.feePaid,
      slippagePaid: rebalance.slippagePaid,
      prices,
    };
    logs.push(entry);
    equityCurve.push(point(aligned.times[index], paperEquity));
    benchmarkCurve.push(point(aligned.times[index], benchmarkEquity));
    previousIndex = index;
  }

  const initialCapital = config.initialCapital;
  const paperReturn = initialCapital > 0 ? paperEquity / initialCapital - 1 : 0;
  const benchmarkReturn = initialCapital > 0 ? benchmarkEquity / initialCapital - 1 : 0;
  const metrics = {
    logs: logs.length,
    startTime: logs[0]?.timestamp || null,
    endTime: logs[logs.length - 1]?.timestamp || null,
    paperEquity,
    benchmarkEquity,
    paperReturn,
    benchmarkReturn,
    edge: paperReturn - benchmarkReturn,
    maxDrawdown: calculateDrawdown(equityCurve),
    benchmarkMaxDrawdown: calculateDrawdown(benchmarkCurve),
    gateOpenRate: logs.length ? logs.filter((entry) => entry.gateOpen).length / logs.length : 0,
    trades: tradeEvents,
    feesPaid,
    slippagePaid,
    latestSignal: logs[logs.length - 1]?.signal || 'CASH',
    latestGateOpen: logs[logs.length - 1]?.gateOpen || false,
  };
  const discipline = evaluateAcceleratedReplay(metrics, rules);

  return {
    ok: true,
    mode: 'accelerated-forward-replay',
    paperOnly: true,
    strictNoLookahead,
    logFrequency,
    replayIndexes,
    logs,
    equityCurve,
    benchmarkCurve,
    metrics,
    discipline,
    verdict: discipline.verdict,
  };
}

export function runMultiWindowAcceleratedReplay({
  candlesByAsset,
  strategy,
  config: rawConfig = {},
  assets = SUPPORTED_ASSETS,
  windowCount = 6,
  windowLogs = 60,
  logFrequency = 'daily',
  replayRules = {},
  multiWindowRules = {},
  strictNoLookahead = true,
} = {}) {
  const config = { ...DEFAULT_CONFIG, ...rawConfig };
  const aligned = alignCandles(candlesByAsset || {}, assets);

  if (aligned.error) {
    return {
      ok: false,
      error: aligned.error,
      verdict: 'FAIL',
      windows: [],
      summary: null,
      discipline: null,
    };
  }

  const warmupBars = config.warmupBars || 240;
  const replayIndexes = buildReplayIndexes({
    times: aligned.times,
    startIndex: warmupBars,
    maxLogs: aligned.times.length,
    logFrequency,
  });
  const ranges = buildWindowRanges(replayIndexes, windowLogs, windowCount);

  if (!ranges.length) {
    return {
      ok: false,
      error: 'Te weinig candles voor multi-window accelerated replay.',
      verdict: 'FAIL',
      windows: [],
      summary: null,
      discipline: null,
    };
  }

  const windows = ranges.map((range, index) => {
    const windowCandlesByAsset = sliceAlignedUntil(aligned, range.endIndex);
    const replay = runAcceleratedForwardReplay({
      candlesByAsset: windowCandlesByAsset,
      strategy,
      config,
      assets: aligned.assets,
      startIndex: range.startIndex,
      maxLogs: range.logs,
      logFrequency,
      rules: {
        minLogs: Math.min(range.logs, Number(replayRules.minLogs) || Math.min(20, range.logs)),
        ...replayRules,
      },
      strictNoLookahead,
    });
    const metrics = replay.metrics || {};
    return {
      index: index + 1,
      startTime: metrics.startTime || new Date(aligned.times[range.startIndex]).toISOString(),
      endTime: metrics.endTime || new Date(aligned.times[range.endIndex]).toISOString(),
      logs: metrics.logs || 0,
      verdict: replay.verdict,
      failed: replay.discipline?.failed?.map((check) => check.id) || [],
      paperReturn: metrics.paperReturn || 0,
      benchmarkReturn: metrics.benchmarkReturn || 0,
      edge: metrics.edge || 0,
      maxDrawdown: metrics.maxDrawdown || 0,
      gateOpenRate: metrics.gateOpenRate || 0,
      trades: metrics.trades || 0,
      feesPaid: metrics.feesPaid || 0,
      slippagePaid: metrics.slippagePaid || 0,
      latestSignal: metrics.latestSignal || 'CASH',
    };
  });

  const returns = windows.map((window) => window.paperReturn);
  const edges = windows.map((window) => window.edge);
  const drawdowns = windows.map((window) => window.maxDrawdown);
  const passCount = windows.filter((window) => window.verdict === 'PASS').length;
  const positiveCount = windows.filter((window) => window.paperReturn > 0).length;
  const beatCount = windows.filter((window) => window.paperReturn > window.benchmarkReturn).length;
  const summary = {
    windows: windows.length,
    windowLogs,
    passRate: windows.length ? passCount / windows.length : 0,
    positiveRate: windows.length ? positiveCount / windows.length : 0,
    beatRate: windows.length ? beatCount / windows.length : 0,
    averageReturn: average(returns),
    medianReturn: median(returns),
    worstReturn: Math.min(...returns),
    averageEdge: average(edges),
    medianEdge: median(edges),
    worstEdge: Math.min(...edges),
    worstDrawdown: Math.max(...drawdowns),
    averageGateOpenRate: average(windows.map((window) => window.gateOpenRate)),
    totalTrades: windows.reduce((sum, window) => sum + window.trades, 0),
    totalFeesPaid: windows.reduce((sum, window) => sum + window.feesPaid, 0),
    totalSlippagePaid: windows.reduce((sum, window) => sum + window.slippagePaid, 0),
  };
  const discipline = evaluateMultiWindowReplay(summary, multiWindowRules);

  return {
    ok: true,
    mode: 'multi-window-accelerated-replay',
    paperOnly: true,
    strictNoLookahead,
    logFrequency,
    windows,
    summary,
    discipline,
    verdict: discipline.verdict,
  };
}
