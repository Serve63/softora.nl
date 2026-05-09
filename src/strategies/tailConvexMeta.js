import {
  applyPortfolioReturn,
  driftWeights,
  rebalancePortfolio,
  sumWeights,
} from '../core/portfolio.js';
import { DEFAULT_CONFIG } from '../core/riskEngine.js';
import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import convexBreakout from './convexBreakout.js';
import tailGuard from './tailGuard.js';

export const TAIL_CONVEX_META_NAME = 'Tail Convex Meta v1';

const replayCacheByDataset = new WeakMap();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pricesAt(candlesByAsset, assets, index) {
  return Object.fromEntries(assets.map((asset) => [asset, candlesByAsset[asset]?.[index]?.close]));
}

function buildReplayIndexes({ index, config }) {
  const warmupBars = config.warmupBars || 240;
  const lookbackBars = Math.max(90, Number(config.metaLookbackBars) || 270);
  const configuredStep = Number(config.metaSampleStep);
  const defaultStep = Math.max(21, Math.round((config.rebalanceBars || DEFAULT_CONFIG.rebalanceBars) / 2));
  const step = clamp(Math.round(configuredStep || defaultStep), 14, 90);
  const start = Math.max(warmupBars, index - lookbackBars);
  const indexes = [];

  for (let cursor = start; cursor <= index; cursor += step) indexes.push(cursor);
  if (indexes[indexes.length - 1] !== index) indexes.push(index);
  return indexes.filter((value) => value >= 1 && value <= index);
}

function replayKey({ strategyName, indexes, assets, config }) {
  return [
    strategyName,
    indexes[0],
    indexes[indexes.length - 1],
    indexes.length,
    assets.join('|'),
    config.timeframe,
    config.guardMode,
    config.scoreThreshold,
    config.assetCap,
    config.rebalanceBars,
    config.emergencyDrawdownStop,
    config.targetVolatility,
    config.feeRate,
    config.slippageRate,
  ].join(':');
}

function runRecentReplay({
  candlesByAsset,
  strategy,
  assets,
  config,
  indexes,
}) {
  let datasetCache = replayCacheByDataset.get(candlesByAsset);
  if (!datasetCache) {
    datasetCache = new Map();
    replayCacheByDataset.set(candlesByAsset, datasetCache);
  }

  const key = replayKey({
    strategyName: strategy.name,
    indexes,
    assets,
    config,
  });
  if (datasetCache.has(key)) return datasetCache.get(key);

  const initialCapital = config.initialCapital || DEFAULT_CONFIG.initialCapital;
  let equity = initialCapital;
  let weights = {};
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let trades = 0;
  let feesPaid = 0;
  let slippagePaid = 0;
  let gateOpenCount = 0;
  let latestSignal = null;
  let previousIndex = null;

  for (const currentIndex of indexes) {
    if (previousIndex !== null) {
      const previousPrices = pricesAt(candlesByAsset, assets, previousIndex);
      const currentPrices = pricesAt(candlesByAsset, assets, currentIndex);
      equity = applyPortfolioReturn(equity, weights, previousPrices, currentPrices).equity;
      weights = driftWeights(weights, previousPrices, currentPrices);
    }

    peakEquity = Math.max(peakEquity, equity);
    const currentDrawdown = peakEquity > 0 ? Math.max(0, 1 - equity / peakEquity) : 0;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    latestSignal = strategy.generateSignal({
      candlesByAsset,
      index: currentIndex,
      assets,
      config,
      currentDrawdown,
    });

    const rebalance = rebalancePortfolio({
      equity,
      currentWeights: weights,
      targetWeights: latestSignal?.weights || {},
      feeRate: config.feeRate,
      slippageRate: config.slippageRate,
    });
    if (rebalance.turnover > 0.015) trades += 1;
    if (sumWeights(rebalance.weights) > 0) gateOpenCount += 1;
    feesPaid += rebalance.feePaid;
    slippagePaid += rebalance.slippagePaid;
    equity = rebalance.equity;
    weights = rebalance.weights;
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) maxDrawdown = Math.max(maxDrawdown, 1 - equity / peakEquity);
    previousIndex = currentIndex;
  }

  const result = {
    samples: indexes.length,
    return: initialCapital > 0 ? equity / initialCapital - 1 : 0,
    maxDrawdown,
    trades,
    feesPaid,
    slippagePaid,
    gateOpenRate: indexes.length ? gateOpenCount / indexes.length : 0,
    latestSignal: latestSignal?.label || 'CASH',
    latestExposure: latestSignal?.exposure || 0,
  };
  datasetCache.set(key, result);
  return result;
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

function evaluateConvexGate({ convexReplay, tailReplay, config }) {
  const minSamples = Number(config.metaMinSamples) || 5;
  const minConvexReturn = Number.isFinite(config.metaMinConvexReturn)
    ? config.metaMinConvexReturn
    : 0.002;
  const minEdgeOverTail = Number.isFinite(config.metaMinEdgeOverTail)
    ? config.metaMinEdgeOverTail
    : 0.001;
  const maxDrawdown = Number.isFinite(config.metaMaxDrawdown)
    ? config.metaMaxDrawdown
    : Math.min(0.055, config.emergencyDrawdownStop || 0.12);
  const minGateOpenRate = Number.isFinite(config.metaMinGateOpenRate)
    ? config.metaMinGateOpenRate
    : 0.12;
  const edgeOverTail = convexReplay.return - tailReplay.return;
  const checks = [
    makeCheck(
      'sample-size',
      'Genoeg recente replay-punten',
      convexReplay.samples >= minSamples,
      `${convexReplay.samples}/${minSamples}`,
    ),
    makeCheck(
      'convex-positive',
      'Convex recente return is positief',
      convexReplay.return >= minConvexReturn,
      `${(convexReplay.return * 100).toFixed(2)}% minimum ${(minConvexReturn * 100).toFixed(2)}%`,
    ),
    makeCheck(
      'beats-tail',
      'Convex verslaat Tail Guard recent',
      edgeOverTail >= minEdgeOverTail,
      `${(edgeOverTail * 100).toFixed(2)}% edge`,
    ),
    makeCheck(
      'drawdown-control',
      'Convex recente drawdown blijft laag',
      convexReplay.maxDrawdown <= maxDrawdown,
      `${(convexReplay.maxDrawdown * 100).toFixed(2)}% limiet ${(maxDrawdown * 100).toFixed(2)}%`,
    ),
    makeCheck(
      'signal-health',
      'Convex had genoeg echte signalen',
      convexReplay.gateOpenRate >= minGateOpenRate,
      `${(convexReplay.gateOpenRate * 100).toFixed(0)}% minimum ${(minGateOpenRate * 100).toFixed(0)}%`,
    ),
  ];
  const failed = checks.filter((check) => !check.pass);

  return {
    open: failed.length === 0,
    checks,
    failed,
    edgeOverTail,
    message: failed.length
      ? `Convex-gate dicht: ${failed.map((check) => check.label).join(', ')}.`
      : 'Convex-gate open: recente replay is beter dan Tail Guard met beperkte drawdown.',
  };
}

function buildMetaReplay({ candlesByAsset, index, assets, config }) {
  const indexes = buildReplayIndexes({ index, config });
  const tailReplay = runRecentReplay({
    candlesByAsset,
    strategy: tailGuard,
    assets,
    config,
    indexes,
  });
  const convexReplay = runRecentReplay({
    candlesByAsset,
    strategy: convexBreakout,
    assets,
    config,
    indexes,
  });
  const gate = evaluateConvexGate({ convexReplay, tailReplay, config });
  return { indexes, tailReplay, convexReplay, gate };
}

export function generateTailConvexMetaSignal({
  candlesByAsset,
  index,
  assets = SUPPORTED_ASSETS,
  config = DEFAULT_CONFIG,
  currentDrawdown = 0,
} = {}) {
  const activeConfig = { ...DEFAULT_CONFIG, ...config };
  const tailSignal = tailGuard.generateSignal({
    candlesByAsset,
    index,
    assets,
    config: activeConfig,
    currentDrawdown,
  });
  const convexSignal = convexBreakout.generateSignal({
    candlesByAsset,
    index,
    assets,
    config: activeConfig,
    currentDrawdown,
  });
  const replay = buildMetaReplay({
    candlesByAsset,
    index,
    assets,
    config: activeConfig,
  });
  const useConvex = replay.gate.open && (convexSignal.exposure || 0) > 0;
  const selectedSignal = useConvex ? convexSignal : tailSignal;
  const selected = useConvex ? 'convex' : 'tail';
  const labelPrefix = useConvex ? 'CONVEX' : 'TAIL';

  return {
    ...selectedSignal,
    strategyName: TAIL_CONVEX_META_NAME,
    label: selectedSignal.label === 'CASH' ? 'CASH' : `${labelPrefix} ${selectedSignal.label}`,
    meta: {
      selected,
      convexGateOpen: replay.gate.open,
      gate: replay.gate,
      tailReplay: replay.tailReplay,
      convexReplay: replay.convexReplay,
      samples: replay.indexes.length,
    },
    reasons: [
      useConvex
        ? 'Meta kiest Convex Breakout omdat zijn recente paper-replay groen is.'
        : 'Meta kiest Tail Guard als basis; Convex moet eerst zijn recente replay-gate openen.',
      replay.gate.message,
      `Tail recent ${(replay.tailReplay.return * 100).toFixed(2)}%, Convex recent ${(replay.convexReplay.return * 100).toFixed(2)}%.`,
      ...(selectedSignal.reasons || []),
    ],
  };
}

export default {
  name: TAIL_CONVEX_META_NAME,
  generateSignal: generateTailConvexMetaSignal,
};
