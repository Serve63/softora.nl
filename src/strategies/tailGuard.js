import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { atr, closes, computeAssetScore, latestValid, roc, rollingHigh, sma } from '../core/indicators.js';
import { sumWeights } from '../core/portfolio.js';
import { analyzeBtcMacro, applyRiskControls, DEFAULT_CONFIG } from '../core/riskEngine.js';

export const TAIL_GUARD_NAME = 'Tail Guard v1';

const analysisCacheByDataset = new WeakMap();

function getDecisionIndex(index, config) {
  const warmupBars = config.warmupBars || 220;
  const rebalanceBars = Math.max(45, config.rebalanceBars || DEFAULT_CONFIG.rebalanceBars);
  if (index <= warmupBars) return index;
  return Math.max(warmupBars, index - ((index - warmupBars) % rebalanceBars));
}

function scoreTailGuardCandidate(candles, decisionIndex) {
  const score = computeAssetScore(candles, decisionIndex);
  const history = candles.slice(0, decisionIndex + 1);
  const closeValues = closes(history);
  const close = closeValues[closeValues.length - 1];
  const sma80 = latestValid(sma(closeValues, 80));
  const sma200 = latestValid(sma(closeValues, 200));
  const momentum60 = latestValid(roc(closeValues, 60));
  const momentum120 = latestValid(roc(closeValues, 120));
  const high90 = latestValid(rollingHigh(closeValues, 90));
  const atr21 = latestValid(atr(history, 21));
  const volatility = Number.isFinite(close) && close > 0 && Number.isFinite(atr21)
    ? atr21 / close
    : null;
  const pullback = Number.isFinite(close) && Number.isFinite(high90) && high90 > 0
    ? close / high90 - 1
    : null;
  const tailScore = (momentum60 ?? -1) * 0.35
    + (momentum120 ?? -1) * 0.35
    + (score.score / 100) * 0.25
    - Math.max(0, (volatility ?? 0.12) - 0.045) * 2.5
    + Math.max(-0.18, pullback ?? -0.18) * 0.4;

  return {
    ...score,
    tailScore,
    momentum60,
    momentum120,
    volatility,
    pullback,
    trendPass: Number.isFinite(close)
      && Number.isFinite(sma80)
      && Number.isFinite(sma200)
      && close > sma80
      && close > sma200
      && Number.isFinite(momentum60)
      && momentum60 > 0,
  };
}

function getCachedAnalysis({ candlesByAsset, assets, decisionIndex, activeConfig }) {
  let datasetCache = analysisCacheByDataset.get(candlesByAsset);
  if (!datasetCache) {
    datasetCache = new Map();
    analysisCacheByDataset.set(candlesByAsset, datasetCache);
  }

  const key = [
    assets.join('|'),
    decisionIndex,
    activeConfig.guardMode,
    activeConfig.scoreThreshold,
  ].join(':');

  if (datasetCache.has(key)) return datasetCache.get(key);

  const btcCandles = candlesByAsset.BTCUSDT || [];
  const btcMacro = analyzeBtcMacro(btcCandles, decisionIndex, activeConfig.guardMode);
  const btcScore = scoreTailGuardCandidate(btcCandles, decisionIndex);
  const btcHealthy = btcMacro.state === 'strong'
    && (btcScore.pullback ?? -1) > -0.12
    && (btcScore.volatility ?? 1) < 0.07;
  const ranking = assets
    .map((symbol) => {
      const score = scoreTailGuardCandidate(candlesByAsset[symbol] || [], decisionIndex);
      return { symbol, ...score };
    })
    .sort((a, b) => b.tailScore - a.tailScore || b.score - a.score);

  const analysis = { btcMacro, btcHealthy, btcScore, ranking };
  datasetCache.set(key, analysis);
  return analysis;
}

function buildRawWeights({ ranking, btcMacro, btcHealthy, config, currentDrawdown }) {
  if (!btcHealthy || btcMacro.exposureCap <= 0) return {};
  if (currentDrawdown >= Math.min(0.16, config.emergencyDrawdownStop ?? DEFAULT_CONFIG.emergencyDrawdownStop)) return {};

  const threshold = Math.max(62, config.scoreThreshold ?? DEFAULT_CONFIG.scoreThreshold);
  const candidates = ranking
    .filter((asset) => (
      asset.trendPass
      && asset.score >= threshold
      && asset.tailScore > 0.04
      && (asset.volatility ?? 1) <= 0.075
      && (asset.pullback ?? -1) > -0.16
    ))
    .slice(0, 3);

  if (!candidates.length) return {};

  const totalQuality = candidates.reduce((sum, asset) => (
    sum + Math.max(0.05, asset.tailScore) / Math.max(asset.volatility ?? 0.08, 0.025)
  ), 0);
  const weights = {};

  for (const asset of candidates) {
    const quality = Math.max(0.05, asset.tailScore) / Math.max(asset.volatility ?? 0.08, 0.025);
    weights[asset.symbol] = quality / totalQuality;
  }

  return weights;
}

export function generateTailGuardSignal({
  candlesByAsset,
  index,
  assets = SUPPORTED_ASSETS,
  config = DEFAULT_CONFIG,
  currentDrawdown = 0,
} = {}) {
  const activeConfig = { ...DEFAULT_CONFIG, ...config };
  const decisionIndex = getDecisionIndex(index, activeConfig);
  const {
    btcMacro,
    btcHealthy,
    btcScore,
    ranking,
  } = getCachedAnalysis({
    candlesByAsset,
    assets,
    decisionIndex,
    activeConfig,
  });
  const rawWeights = buildRawWeights({
    ranking,
    btcMacro,
    btcHealthy,
    config: activeConfig,
    currentDrawdown,
  });
  const risk = applyRiskControls({
    rawWeights,
    ranking,
    btcMacro: {
      ...btcMacro,
      exposureCap: Math.min(btcMacro.exposureCap, btcMacro.state === 'strong' ? 0.55 : 0.25),
    },
    currentDrawdown,
    config: {
      ...activeConfig,
      assetCap: Math.min(activeConfig.assetCap ?? DEFAULT_CONFIG.assetCap, 0.3),
      targetVolatility: Math.min(activeConfig.targetVolatility ?? DEFAULT_CONFIG.targetVolatility, 0.035),
    },
  });

  const exposure = sumWeights(risk.weights);
  const label = exposure > 0
    ? Object.entries(risk.weights)
      .filter(([, weight]) => weight > 0.01)
      .map(([symbol, weight]) => `${symbol.replace('USDT', '')} ${(weight * 100).toFixed(0)}%`)
      .join(' / ')
    : 'CASH';

  return {
    strategyName: TAIL_GUARD_NAME,
    label,
    weights: risk.weights,
    exposure,
    ranking,
    btcMacro,
    risk,
    reasons: [
      btcMacro.reason,
      btcHealthy
        ? `BTC tail guard gezond: pullback ${((btcScore.pullback || 0) * 100).toFixed(1)}%, volatility ${((btcScore.volatility || 0) * 100).toFixed(1)}%.`
        : 'BTC tail guard blokkeert exposure door trend, pullback of volatility.',
      risk.reason,
      exposure > 0
        ? `Tail basket: ${Object.keys(risk.weights).map((symbol) => symbol.replace('USDT', '')).join(', ')}.`
        : 'Tail Guard blijft cash tot trend en tail-risk tegelijk groen zijn.',
    ],
  };
}

export default {
  name: TAIL_GUARD_NAME,
  generateSignal: generateTailGuardSignal,
};
