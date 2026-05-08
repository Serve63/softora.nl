import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import { alignCandles, runBacktest } from './backtester.js';
import { optimizeStrategy } from './optimizer.js';
import { DEFAULT_CONFIG } from './riskEngine.js';

export const DEFAULT_WALK_FORWARD_GRID = Object.freeze({
  rebalanceBars: [21, 30, 45],
  emergencyDrawdownStop: [0.24, 0.26],
  targetVolatility: [0.09, 0.1],
});

function compoundReturn(returns) {
  return returns.reduce((growth, value) => growth * (1 + value), 1) - 1;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function countFailedReasons(folds) {
  const reasons = [];
  for (const fold of folds) {
    if (fold.optimizerAccepted) continue;
    reasons.push(...(fold.optimizerFailed || []));
  }
  return countValues(reasons);
}

function sliceAligned(aligned, startIndex, endIndex) {
  const candlesByAsset = {};
  for (const asset of aligned.assets) {
    candlesByAsset[asset] = aligned.candlesByAsset[asset].slice(startIndex, endIndex);
  }
  return candlesByAsset;
}

function buildFoldRanges(length, trainBars, testBars, maxFolds) {
  const ranges = [];
  for (let trainStart = 0; trainStart + trainBars + testBars <= length; trainStart += testBars) {
    const trainEnd = trainStart + trainBars;
    const testEnd = trainEnd + testBars;
    ranges.push({ trainStart, trainEnd, testEnd });
  }
  return ranges.slice(-maxFolds);
}

export function runRollingWalkForward({
  candlesByAsset,
  baseConfig = {},
  grid = DEFAULT_WALK_FORWARD_GRID,
  strategy = frozenCandidate,
  assets = SUPPORTED_ASSETS,
  trainBars = 720,
  testBars = 180,
  maxFolds = 5,
} = {}) {
  const aligned = alignCandles(candlesByAsset || {}, assets);
  const config = { ...DEFAULT_CONFIG, ...baseConfig };

  if (aligned.error) {
    return {
      ok: false,
      error: aligned.error,
      folds: [],
      summary: null,
    };
  }

  const ranges = buildFoldRanges(aligned.times.length, trainBars, testBars, maxFolds);
  if (!ranges.length) {
    return {
      ok: false,
      error: `Te weinig overlappende candles (${aligned.times.length}) voor walk-forward met ${trainBars} train en ${testBars} test candles.`,
      folds: [],
      summary: null,
    };
  }

  const folds = ranges.map((range, index) => {
    const trainCandles = sliceAligned(aligned, range.trainStart, range.trainEnd);
    const foldCandles = sliceAligned(aligned, range.trainStart, range.testEnd);
    const optimizer = optimizeStrategy({
      candlesByAsset: trainCandles,
      baseConfig: config,
      grid,
      strategy,
      assets: aligned.assets,
      stressTop: 3,
    });
    const optimizerAccepted = optimizer.best?.verdict === 'CANDIDATE';
    const chosenConfig = optimizerAccepted ? optimizer.best.config : config;
    const testResult = runBacktest({
      candlesByAsset: foldCandles,
      config: {
        ...chosenConfig,
        backtestStartIndex: trainBars,
      },
      strategy,
      assets: aligned.assets,
    });

    return {
      index: index + 1,
      trainStart: aligned.times[range.trainStart],
      trainEnd: aligned.times[range.trainEnd - 1],
      testStart: aligned.times[range.trainEnd],
      testEnd: aligned.times[range.testEnd - 1],
      optimizerVerdict: optimizer.best?.verdict || 'NONE',
      optimizerAccepted,
      optimizerFailed: optimizer.best?.failed || [],
      optimizerScore: optimizer.best?.score ?? null,
      config: {
        rebalanceBars: chosenConfig.rebalanceBars,
        emergencyDrawdownStop: chosenConfig.emergencyDrawdownStop,
        targetVolatility: chosenConfig.targetVolatility,
      },
      trainReturn: optimizer.best?.strategyReturn ?? 0,
      testReturn: testResult.strategyReturn,
      benchmarkReturn: testResult.benchmarkReturn,
      maxDrawdown: testResult.maxDrawdown,
      profitFactor: testResult.profitFactor,
      trades: testResult.trades,
      beatBenchmark: testResult.strategyReturn > testResult.benchmarkReturn,
      profitable: testResult.strategyReturn > 0,
      signal: testResult.currentSignal?.label || 'CASH',
    };
  });

  const strategyReturns = folds.map((fold) => fold.testReturn);
  const benchmarkReturns = folds.map((fold) => fold.benchmarkReturn);
  const beatCount = folds.filter((fold) => fold.beatBenchmark).length;
  const profitableCount = folds.filter((fold) => fold.profitable).length;
  const candidateCount = folds.filter((fold) => fold.optimizerVerdict === 'CANDIDATE').length;
  const strategyCompoundReturn = compoundReturn(strategyReturns);
  const benchmarkCompoundReturn = compoundReturn(benchmarkReturns);
  const trainVerdictCounts = countValues(folds.map((fold) => fold.optimizerVerdict));
  const trainFailureCounts = countFailedReasons(folds);

  const summary = {
    folds: folds.length,
    beatRate: beatCount / folds.length,
    profitableRate: profitableCount / folds.length,
    candidateRate: candidateCount / folds.length,
    trainVerdictCounts,
    trainFailureCounts,
    strategyCompoundReturn,
    benchmarkCompoundReturn,
    edge: strategyCompoundReturn - benchmarkCompoundReturn,
    averageFoldReturn: average(strategyReturns),
    averageBenchmarkReturn: average(benchmarkReturns),
    worstFoldReturn: Math.min(...strategyReturns),
    maxFoldDrawdown: Math.max(...folds.map((fold) => fold.maxDrawdown)),
    verdict: strategyCompoundReturn > 0
      && strategyCompoundReturn > benchmarkCompoundReturn
      && beatCount / folds.length >= 0.5
      ? 'PASS'
      : 'FAIL',
  };

  return {
    ok: true,
    error: null,
    trainBars,
    testBars,
    folds,
    summary,
  };
}
