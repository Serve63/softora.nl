import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import {
  calculateOosMetrics,
  calculateReturn,
  calculateWalkForwardBeatRate,
  maxDrawdown,
  profitFactor,
  winRate,
} from './metrics.js';
import {
  applyPortfolioReturn,
  driftWeights,
  equalWeight,
  rebalancePortfolio,
  sumWeights,
} from './portfolio.js';
import { DEFAULT_CONFIG, evaluateGate } from './riskEngine.js';

function mergeConfig(config = {}) {
  return { ...DEFAULT_CONFIG, ...config };
}

function point(time, value) {
  return { time, value };
}

export function alignCandles(candlesByAsset, assets = SUPPORTED_ASSETS) {
  const usableAssets = assets.filter((asset) => Array.isArray(candlesByAsset[asset]) && candlesByAsset[asset].length);
  if (!usableAssets.includes('BTCUSDT')) {
    return { assets: usableAssets, candlesByAsset: {}, times: [], error: 'BTCUSDT data ontbreekt; macrofilter kan niet draaien.' };
  }

  const maps = Object.fromEntries(
    usableAssets.map((asset) => [asset, new Map(candlesByAsset[asset].map((candle) => [candle.time, candle]))]),
  );
  const commonTimes = candlesByAsset.BTCUSDT
    .map((candle) => candle.time)
    .filter((time) => usableAssets.every((asset) => maps[asset].has(time)))
    .sort((a, b) => a - b);

  const aligned = {};
  for (const asset of usableAssets) {
    aligned[asset] = commonTimes.map((time) => maps[asset].get(time));
  }

  return { assets: usableAssets, candlesByAsset: aligned, times: commonTimes, error: null };
}

function pricesAt(candlesByAsset, assets, index) {
  return Object.fromEntries(assets.map((asset) => [asset, candlesByAsset[asset][index]?.close]));
}

function createEmptyResult({ config, error = null }) {
  return {
    ok: false,
    error,
    config,
    strategyName: frozenCandidate.name,
    strategyReturn: 0,
    benchmarkReturn: 0,
    oosReturn: 0,
    oosBenchmarkReturn: 0,
    maxDrawdown: 0,
    profitFactor: 0,
    winRate: 0,
    trades: 0,
    feesPaid: 0,
    slippagePaid: 0,
    equityCurve: [],
    benchmarkCurve: [],
    currentSignal: { label: 'CASH', weights: {}, exposure: 0, reasons: [error || 'Geen data beschikbaar.'] },
    gate: { open: false, checks: [], failed: [], message: error || 'Geen data beschikbaar.' },
    ranking: [],
    oosWindow: { candles: 0, startTime: null, endTime: null },
    walkForwardBeatRate: 0,
  };
}

export function runBacktest({
  candlesByAsset,
  config: rawConfig = {},
  strategy = frozenCandidate,
  assets = SUPPORTED_ASSETS,
} = {}) {
  const config = mergeConfig(rawConfig);
  const aligned = alignCandles(candlesByAsset || {}, assets);

  if (aligned.error) return createEmptyResult({ config, error: aligned.error });
  if (aligned.times.length < 240) {
    return createEmptyResult({
      config,
      error: `Te weinig overlappende candles (${aligned.times.length}). Minimaal 240 nodig voor de macrofilter.`,
    });
  }

  const startIndex = 220;
  let equity = config.initialCapital;
  let benchmarkEquity = config.initialCapital;
  let weights = {};
  let benchmarkWeights = equalWeight(aligned.assets, 1);
  let latestSignal = { label: 'CASH', weights: {}, exposure: 0, ranking: [], reasons: [] };
  let feesPaid = 0;
  let slippagePaid = 0;
  let tradeEvents = 0;
  let positionOpenEquity = null;
  let positionOpenTime = null;
  const closedTrades = [];
  const equityCurve = [point(aligned.times[startIndex - 1], equity)];
  const benchmarkCurve = [point(aligned.times[startIndex - 1], benchmarkEquity)];

  for (let index = startIndex; index < aligned.times.length; index += 1) {
    const previousPrices = pricesAt(aligned.candlesByAsset, aligned.assets, index - 1);
    const currentPrices = pricesAt(aligned.candlesByAsset, aligned.assets, index);

    equity = applyPortfolioReturn(equity, weights, previousPrices, currentPrices).equity;
    weights = driftWeights(weights, previousPrices, currentPrices);

    benchmarkEquity = applyPortfolioReturn(benchmarkEquity, benchmarkWeights, previousPrices, currentPrices).equity;
    benchmarkWeights = driftWeights(benchmarkWeights, previousPrices, currentPrices);

    const currentDrawdown = maxDrawdown(equityCurve).value;
    latestSignal = strategy.generateSignal({
      candlesByAsset: aligned.candlesByAsset,
      index,
      assets: aligned.assets,
      config,
      currentDrawdown,
    });

    const rebalance = rebalancePortfolio({
      equity,
      currentWeights: weights,
      targetWeights: latestSignal.weights,
      feeRate: config.feeRate,
      slippageRate: config.slippageRate,
    });

    if (rebalance.turnover > 0.015) {
      if (sumWeights(weights) > 0 && positionOpenEquity !== null) {
        closedTrades.push({
          entryTime: positionOpenTime,
          exitTime: aligned.times[index],
          pnl: equity - positionOpenEquity,
        });
      }

      tradeEvents += 1;
      positionOpenEquity = sumWeights(rebalance.weights) > 0 ? rebalance.equity : null;
      positionOpenTime = sumWeights(rebalance.weights) > 0 ? aligned.times[index] : null;
    }

    feesPaid += rebalance.feePaid;
    slippagePaid += rebalance.slippagePaid;
    equity = rebalance.equity;
    weights = rebalance.weights;

    equityCurve.push(point(aligned.times[index], equity));
    benchmarkCurve.push(point(aligned.times[index], benchmarkEquity));
  }

  if (sumWeights(weights) > 0 && positionOpenEquity !== null) {
    closedTrades.push({
      entryTime: positionOpenTime,
      exitTime: aligned.times[aligned.times.length - 1],
      pnl: equity - positionOpenEquity,
    });
  }

  const drawdown = maxDrawdown(equityCurve);
  const oos = calculateOosMetrics(equityCurve, benchmarkCurve, config.oosRatio);
  const strategyReturn = calculateReturn(config.initialCapital, equityCurve[equityCurve.length - 1].value);
  const benchmarkReturn = calculateReturn(config.initialCapital, benchmarkCurve[benchmarkCurve.length - 1].value);
  const walkForwardBeatRate = calculateWalkForwardBeatRate(equityCurve, benchmarkCurve, 6);
  const pf = profitFactor(closedTrades);
  const wr = winRate(closedTrades);

  const preGateSignal = latestSignal;
  const gate = evaluateGate({
    results: {
      strategyReturn,
      benchmarkReturn,
      oosReturn: oos.strategyReturn,
      oosBenchmarkReturn: oos.benchmarkReturn,
      maxDrawdown: drawdown.value,
      profitFactor: pf,
      walkForwardBeatRate,
    },
    currentRisk: preGateSignal.risk || { exposure: preGateSignal.exposure || 0 },
    config,
  });

  const currentSignal = gate.open
    ? preGateSignal
    : {
      ...preGateSignal,
      label: 'CASH',
      weights: {},
      exposure: 0,
      reasons: [gate.message, ...(preGateSignal.reasons || [])],
    };

  return {
    ok: true,
    config,
    assets: aligned.assets,
    strategyName: strategy.name,
    strategyReturn,
    benchmarkReturn,
    oosReturn: oos.strategyReturn,
    oosBenchmarkReturn: oos.benchmarkReturn,
    maxDrawdown: drawdown.value,
    profitFactor: pf,
    winRate: wr,
    trades: tradeEvents,
    feesPaid,
    slippagePaid,
    equityCurve,
    benchmarkCurve,
    closedTrades,
    currentSignal,
    preGateSignal,
    gate,
    ranking: preGateSignal.ranking || [],
    oosWindow: {
      candles: oos.candles,
      startTime: oos.startTime,
      endTime: oos.endTime,
    },
    walkForwardBeatRate,
  };
}
