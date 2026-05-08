import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { atr, closes, roc, rollingHigh, sma } from '../core/indicators.js';
import { sumWeights } from '../core/portfolio.js';
import { analyzeBtcMacro, applyRiskControls, DEFAULT_CONFIG } from '../core/riskEngine.js';

export const COST_AWARE_TAIL_GUARD_NAME = 'Cost Aware Tail Guard v1';

const analysisCacheByDataset = new WeakMap();
const scoreCacheByCandles = new WeakMap();
const seriesCacheByCandles = new WeakMap();

function getDecisionIndex(index, config) {
  const warmupBars = config.warmupBars || 240;
  const rebalanceBars = Math.max(90, config.rebalanceBars || DEFAULT_CONFIG.rebalanceBars);
  if (index <= warmupBars) return index;
  return Math.max(warmupBars, index - ((index - warmupBars) % rebalanceBars));
}

function latestFiniteAt(series, index) {
  for (let cursor = Math.min(index, series.length - 1); cursor >= 0; cursor -= 1) {
    if (Number.isFinite(series[cursor])) return series[cursor];
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreMomentum(value, scale) {
  if (!Number.isFinite(value)) return 0;
  return clamp((value / scale) * 10, -10, 15);
}

function getSeries(candles) {
  let series = seriesCacheByCandles.get(candles);
  if (series) return series;

  const closeValues = closes(candles);
  // Deze strategie wordt honderden keren per research-run aangeroepen. Door de
  // indicator-series eenmalig per dataset te bouwen blijft de dagelijkse
  // verbeter-loop bruikbaar snel zonder de tradingregels te versoepelen.
  series = {
    closeValues,
    sma50: sma(closeValues, 50),
    sma80: sma(closeValues, 80),
    sma120: sma(closeValues, 120),
    sma200: sma(closeValues, 200),
    roc20: roc(closeValues, 20),
    roc60: roc(closeValues, 60),
    roc120: roc(closeValues, 120),
    high55: rollingHigh(closeValues, 55),
    high90: rollingHigh(closeValues, 90),
    atr14: atr(candles, 14),
    atr21: atr(candles, 21),
  };
  seriesCacheByCandles.set(candles, series);
  return series;
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
  const sma50 = latestFiniteAt(series.sma50, decisionIndex);
  const sma80 = latestFiniteAt(series.sma80, decisionIndex);
  const sma120 = latestFiniteAt(series.sma120, decisionIndex);
  const sma200 = latestFiniteAt(series.sma200, decisionIndex);
  const momentum20 = latestFiniteAt(series.roc20, decisionIndex);
  const momentum60 = latestFiniteAt(series.roc60, decisionIndex);
  const momentum120 = latestFiniteAt(series.roc120, decisionIndex);
  const high55 = latestFiniteAt(series.high55, decisionIndex);
  const high90 = latestFiniteAt(series.high90, decisionIndex);
  const atr14 = latestFiniteAt(series.atr14, decisionIndex);
  const atr21 = latestFiniteAt(series.atr21, decisionIndex);
  const volatility = Number.isFinite(close) && close > 0 && Number.isFinite(atr21)
    ? atr21 / close
    : null;
  const scoreVolatility = Number.isFinite(close) && close > 0 && Number.isFinite(atr14)
    ? atr14 / close
    : null;
  const pullback = Number.isFinite(close) && Number.isFinite(high90) && high90 > 0
    ? close / high90 - 1
    : null;
  const score = [close, sma50, sma120, sma200, high55, atr14].every(Number.isFinite)
    ? (() => {
      let trend = 0;
      if (close > sma50) trend += 12;
      if (close > sma120) trend += 12;
      if (close > sma200) trend += 12;
      if (sma50 > sma120) trend += 8;

      const momentum = scoreMomentum(momentum20, 0.08)
        + scoreMomentum(momentum60, 0.18)
        + scoreMomentum(momentum120, 0.35);
      const breakout = close >= high55 * 0.995 ? 15 : close >= high55 * 0.96 ? 8 : 0;
      const volatilityPenalty = scoreVolatility > 0.1 ? 18 : scoreVolatility > 0.075 ? 10 : scoreVolatility > 0.055 ? 4 : 0;
      const total = clamp(trend + momentum + breakout + 18 - volatilityPenalty, 0, 100);
      const reasons = [];
      if (trend >= 32) reasons.push('trend sterk');
      if (momentum > 12) reasons.push('momentum positief');
      if (breakout >= 15) reasons.push('bij breakout-zone');
      if (volatilityPenalty >= 10) reasons.push('volatiliteit remt sizing');
      if (!reasons.length) reasons.push('score matig');
      return {
        score: total,
        trend,
        momentum,
        breakout,
        volatility: scoreVolatility,
        close,
        reasons,
      };
    })()
    : {
      score: 0,
      trend: 0,
      momentum: 0,
      breakout: 0,
      volatility: null,
      close,
      reasons: ['Te weinig historie voor betrouwbare score'],
    };
  const costScore = (momentum60 ?? -1) * 0.25
    + (momentum120 ?? -1) * 0.45
    + (score.score / 100) * 0.2
    - Math.max(0, (volatility ?? 0.14) - 0.04) * 3.2
    + Math.max(-0.14, pullback ?? -0.14) * 0.35;

  const candidate = {
    ...score,
    close,
    sma80,
    sma200,
    costScore,
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
      && Number.isFinite(momentum120)
      && momentum60 > 0.025
      && momentum120 > 0.035,
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
  const btcHealthy = btcMacro.state === 'strong'
    && (btcScore.momentum60 ?? -1) > 0.02
    && (btcScore.momentum120 ?? -1) > 0.035
    && (btcScore.pullback ?? -1) > -0.09
    && (btcScore.volatility ?? 1) < 0.06;
  const ranking = assets
    .map((symbol) => {
      const score = scoreCandidate(candlesByAsset[symbol] || [], decisionIndex);
      return { symbol, ...score };
    })
    .sort((a, b) => b.costScore - a.costScore || b.score - a.score);

  const analysis = { btcMacro, btcHealthy, btcScore, ranking };
  datasetCache.set(key, analysis);
  return analysis;
}

function buildRawWeights({
  ranking,
  btcMacro,
  btcHealthy,
  btcFastRiskOn,
  config,
  currentDrawdown,
}) {
  if (!btcHealthy || btcMacro.exposureCap <= 0) return {};
  if (!btcFastRiskOn) return {};
  if (currentDrawdown >= Math.min(0.12, config.emergencyDrawdownStop ?? DEFAULT_CONFIG.emergencyDrawdownStop)) return {};

  const threshold = Math.max(70, config.scoreThreshold ?? DEFAULT_CONFIG.scoreThreshold);
  const candidates = ranking
    .filter((asset) => (
      asset.trendPass
      && asset.score >= threshold
      && asset.costScore > 0.09
      && (asset.volatility ?? 1) <= 0.06
      && (asset.pullback ?? -1) > -0.1
    ))
    .slice(0, 2);

  if (!candidates.length) return {};

  const totalQuality = candidates.reduce((sum, asset) => (
    sum + Math.max(0.06, asset.costScore) / Math.max(asset.volatility ?? 0.08, 0.025)
  ), 0);
  const weights = {};

  for (const asset of candidates) {
    const quality = Math.max(0.06, asset.costScore) / Math.max(asset.volatility ?? 0.08, 0.025);
    weights[asset.symbol] = quality / totalQuality;
  }

  return weights;
}

export function generateCostAwareTailGuardSignal({
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
  const btcFastScore = scoreCandidate(candlesByAsset.BTCUSDT || [], index);
  const btcFastRiskOn = btcHealthy
    && Number.isFinite(btcFastScore.close)
    && Number.isFinite(btcFastScore.sma200)
    && btcFastScore.close > btcFastScore.sma200
    && (btcFastScore.momentum60 ?? -1) > -0.06
    && (btcFastScore.pullback ?? -1) > -0.2
    && (btcFastScore.volatility ?? 1) < 0.09;
  const rawWeights = buildRawWeights({
    ranking,
    btcMacro,
    btcHealthy,
    btcFastRiskOn,
    config: activeConfig,
    currentDrawdown,
  });
  const risk = applyRiskControls({
    rawWeights,
    ranking,
    btcMacro: {
      ...btcMacro,
      exposureCap: btcHealthy ? Math.min(btcMacro.exposureCap, 0.42) : 0,
    },
    currentDrawdown,
    config: {
      ...activeConfig,
      assetCap: Math.min(activeConfig.assetCap ?? DEFAULT_CONFIG.assetCap, 0.24),
      targetVolatility: Math.min(activeConfig.targetVolatility ?? DEFAULT_CONFIG.targetVolatility, 0.025),
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
    strategyName: COST_AWARE_TAIL_GUARD_NAME,
    label,
    weights: risk.weights,
    exposure,
    ranking,
    btcMacro,
    risk,
    reasons: [
      btcMacro.reason,
      btcHealthy
        ? `Cost-aware BTC filter groen: 120 momentum ${((btcScore.momentum120 || 0) * 100).toFixed(1)}%, volatility ${((btcScore.volatility || 0) * 100).toFixed(1)}%.`
        : 'Cost-aware filter blijft cash: trendkwaliteit of kostenbuffer is onvoldoende.',
      btcFastRiskOn
        ? 'Fast-exit filter staat exposure toe.'
        : 'Fast-exit filter sluit exposure door recente BTC trendzwakte.',
      risk.reason,
      exposure > 0
        ? `Kostenbewuste basket: ${Object.keys(risk.weights).map((symbol) => symbol.replace('USDT', '')).join(', ')}.`
        : 'Cost Aware Tail Guard wacht op een sterker signaal met minder turnover-risico.',
    ],
  };
}

export default {
  name: COST_AWARE_TAIL_GUARD_NAME,
  generateSignal: generateCostAwareTailGuardSignal,
};
