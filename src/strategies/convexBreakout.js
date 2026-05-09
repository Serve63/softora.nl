import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { atr, closes, roc, rollingHigh, sma } from '../core/indicators.js';
import { sumWeights } from '../core/portfolio.js';
import { analyzeBtcMacro, applyRiskControls, DEFAULT_CONFIG } from '../core/riskEngine.js';

export const CONVEX_BREAKOUT_NAME = 'Convex Breakout v1';

const analysisCacheByDataset = new WeakMap();
const seriesCacheByCandles = new WeakMap();
const scoreCacheByCandles = new WeakMap();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getDecisionIndex(index, config) {
  const warmupBars = config.warmupBars || 240;
  const configured = Number(config.rebalanceBars) || DEFAULT_CONFIG.rebalanceBars;
  const rebalanceBars = clamp(Math.round(configured / 2), 21, 60);
  if (index <= warmupBars) return index;
  return Math.max(warmupBars, index - ((index - warmupBars) % rebalanceBars));
}

function latestFiniteAt(series, index) {
  for (let cursor = Math.min(index, series.length - 1); cursor >= 0; cursor -= 1) {
    if (Number.isFinite(series[cursor])) return series[cursor];
  }
  return null;
}

function getSeries(candles) {
  let series = seriesCacheByCandles.get(candles);
  if (series) return series;

  const closeValues = closes(candles);
  series = {
    closeValues,
    sma20: sma(closeValues, 20),
    sma50: sma(closeValues, 50),
    sma100: sma(closeValues, 100),
    sma200: sma(closeValues, 200),
    roc10: roc(closeValues, 10),
    roc20: roc(closeValues, 20),
    roc40: roc(closeValues, 40),
    roc80: roc(closeValues, 80),
    high20: rollingHigh(closeValues, 20),
    high55: rollingHigh(closeValues, 55),
    high90: rollingHigh(closeValues, 90),
    atr21: atr(candles, 21),
  };
  seriesCacheByCandles.set(candles, series);
  return series;
}

function scoreMomentum(value, scale) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value / scale, -1, 1.5);
}

function scoreCandidate(candles, decisionIndex) {
  let scoreCache = scoreCacheByCandles.get(candles);
  if (!scoreCache) {
    scoreCache = new Map();
    scoreCacheByCandles.set(candles, scoreCache);
  }
  if (scoreCache.has(decisionIndex)) return scoreCache.get(decisionIndex);

  const series = getSeries(candles);
  const close = series.closeValues[decisionIndex];
  const sma20 = latestFiniteAt(series.sma20, decisionIndex);
  const sma50 = latestFiniteAt(series.sma50, decisionIndex);
  const sma100 = latestFiniteAt(series.sma100, decisionIndex);
  const sma200 = latestFiniteAt(series.sma200, decisionIndex);
  const momentum10 = latestFiniteAt(series.roc10, decisionIndex);
  const momentum20 = latestFiniteAt(series.roc20, decisionIndex);
  const momentum40 = latestFiniteAt(series.roc40, decisionIndex);
  const momentum80 = latestFiniteAt(series.roc80, decisionIndex);
  const high20 = latestFiniteAt(series.high20, decisionIndex);
  const high55 = latestFiniteAt(series.high55, decisionIndex);
  const high90 = latestFiniteAt(series.high90, decisionIndex);
  const atr21 = latestFiniteAt(series.atr21, decisionIndex);
  const volatility = Number.isFinite(close) && close > 0 && Number.isFinite(atr21)
    ? atr21 / close
    : null;
  const pullback = Number.isFinite(close) && Number.isFinite(high90) && high90 > 0
    ? close / high90 - 1
    : null;
  const nearBreakout = Number.isFinite(close)
    && Number.isFinite(high55)
    && close >= high55 * 0.985;
  const freshBreakout = Number.isFinite(close)
    && Number.isFinite(high20)
    && close >= high20 * 0.995;
  const trendPass = [close, sma20, sma50, sma100, sma200].every(Number.isFinite)
    && close > sma50
    && close > sma100
    && close > sma200
    && sma20 > sma50
    && Number.isFinite(momentum20)
    && momentum20 > 0.015;
  const acceleration = Number.isFinite(momentum20) && Number.isFinite(momentum80)
    ? momentum20 - momentum80 * 0.35
    : null;
  const volatilityPenalty = Math.max(0, (volatility ?? 0.12) - 0.055) * 2.4;
  const pullbackPenalty = Math.max(0, -(pullback ?? 0)) * 0.55;
  const convexScore = scoreMomentum(momentum10, 0.06) * 0.18
    + scoreMomentum(momentum20, 0.12) * 0.27
    + scoreMomentum(momentum40, 0.22) * 0.22
    + scoreMomentum(acceleration, 0.06) * 0.16
    + (nearBreakout ? 0.16 : 0)
    + (freshBreakout ? 0.11 : 0)
    - volatilityPenalty
    - pullbackPenalty;

  const candidate = {
    score: clamp(50 + convexScore * 42, 0, 100),
    trend: trendPass ? 42 : 0,
    momentum: (momentum20 || 0) + (momentum40 || 0),
    breakout: freshBreakout ? 18 : nearBreakout ? 10 : 0,
    volatility,
    close,
    convexScore,
    momentum10,
    momentum20,
    momentum40,
    momentum80,
    acceleration,
    pullback,
    trendPass,
    nearBreakout,
    freshBreakout,
    reasons: [
      trendPass ? 'trend groen' : 'trend onvoldoende',
      nearBreakout ? 'breakout-zone' : 'geen breakout',
      Number.isFinite(volatility) ? `volatility ${(volatility * 100).toFixed(1)}%` : 'volatility onbekend',
    ],
  };
  scoreCache.set(decisionIndex, candidate);
  return candidate;
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
  const btcScore = scoreCandidate(btcCandles, decisionIndex);
  const ranking = assets
    .map((symbol) => ({ symbol, ...scoreCandidate(candlesByAsset[symbol] || [], decisionIndex) }))
    .sort((a, b) => b.convexScore - a.convexScore || b.score - a.score);
  const breadth = ranking.filter((asset) => (
    asset.trendPass
    && asset.nearBreakout
    && asset.convexScore > 0.12
    && (asset.volatility ?? 1) < 0.085
  )).length;
  const analysis = { btcMacro, btcScore, ranking, breadth };
  datasetCache.set(key, analysis);
  return analysis;
}

function btcFastRiskOn({ candlesByAsset, index, btcMacro }) {
  if (btcMacro.exposureCap <= 0 || btcMacro.state === 'weak') return false;
  const btcScore = scoreCandidate(candlesByAsset.BTCUSDT || [], index);
  return btcScore.trendPass
    && (btcScore.momentum20 ?? -1) > 0
    && (btcScore.momentum80 ?? -1) > -0.02
    && (btcScore.pullback ?? -1) > -0.12
    && (btcScore.volatility ?? 1) < 0.075;
}

function buildRawWeights({
  ranking,
  btcMacro,
  btcScore,
  breadth,
  fastRiskOn,
  config,
  currentDrawdown,
}) {
  const stop = Math.min(0.16, config.emergencyDrawdownStop ?? DEFAULT_CONFIG.emergencyDrawdownStop);
  if (currentDrawdown >= stop) return {};
  if (!fastRiskOn) return {};
  if (btcMacro.state === 'neutral' && breadth < 3) return {};

  const threshold = Math.max(66, (config.scoreThreshold ?? DEFAULT_CONFIG.scoreThreshold) * 0.92);
  const maxHoldings = btcMacro.state === 'strong' && breadth >= 3 ? 2 : 1;
  const candidates = ranking
    .filter((asset) => (
      asset.trendPass
      && asset.nearBreakout
      && asset.score >= threshold
      && asset.convexScore > 0.22
      && (asset.volatility ?? 1) <= 0.065
      && (asset.pullback ?? -1) > -0.1
    ))
    .slice(0, maxHoldings);

  if (!candidates.length) return {};

  const qualitySum = candidates.reduce((sum, asset) => (
    sum + Math.max(0.08, asset.convexScore) / Math.max(asset.volatility ?? 0.08, 0.025)
  ), 0);
  const weights = {};
  const coreBtc = btcMacro.state === 'strong'
    && btcScore.trendPass
    && btcScore.nearBreakout
    && (btcScore.convexScore ?? 0) > 0.16
    ? 0.16
    : 0;
  const tacticalShare = 1 - coreBtc;

  if (coreBtc > 0) weights.BTCUSDT = coreBtc;
  for (const asset of candidates) {
    const quality = Math.max(0.08, asset.convexScore) / Math.max(asset.volatility ?? 0.08, 0.025);
    weights[asset.symbol] = (weights[asset.symbol] || 0) + tacticalShare * (quality / qualitySum);
  }

  return weights;
}

export function generateConvexBreakoutSignal({
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
    btcScore,
    ranking,
    breadth,
  } = getCachedAnalysis({
    candlesByAsset,
    assets,
    decisionIndex,
    activeConfig,
  });
  const fastRiskOn = btcFastRiskOn({ candlesByAsset, index, btcMacro });
  const rawWeights = buildRawWeights({
    ranking,
    btcMacro,
    btcScore,
    breadth,
    fastRiskOn,
    config: activeConfig,
    currentDrawdown,
  });
  const risk = applyRiskControls({
    rawWeights,
    ranking,
    btcMacro: {
      ...btcMacro,
      exposureCap: btcMacro.state === 'strong'
        ? Math.min(btcMacro.exposureCap, 0.58)
        : Math.min(btcMacro.exposureCap, 0.22),
    },
    currentDrawdown,
    config: {
      ...activeConfig,
      assetCap: Math.min(activeConfig.assetCap ?? DEFAULT_CONFIG.assetCap, 0.34),
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
    strategyName: CONVEX_BREAKOUT_NAME,
    label,
    weights: risk.weights,
    exposure,
    ranking,
    btcMacro,
    risk,
    reasons: [
      btcMacro.reason,
      fastRiskOn
        ? `Fast BTC filter groen; breadth ${breadth}/${assets.length}.`
        : 'Fast BTC filter sluit exposure door trendbreuk, pullback of te hoge volatility.',
      risk.reason,
      exposure > 0
        ? `Convex breakout basket: ${Object.keys(risk.weights).map((symbol) => symbol.replace('USDT', '')).join(', ')}.`
        : 'Convex Breakout wacht op gezonde macro plus meerdere sterke breakout-kandidaten.',
    ],
  };
}

export default {
  name: CONVEX_BREAKOUT_NAME,
  generateSignal: generateConvexBreakoutSignal,
};
