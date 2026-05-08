import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { atr, closes, computeAssetScore, latestValid, roc, rollingHigh, sma } from '../core/indicators.js';
import { sumWeights } from '../core/portfolio.js';
import { analyzeBtcMacro, applyRiskControls, DEFAULT_CONFIG } from '../core/riskEngine.js';

export const COST_AWARE_TAIL_GUARD_NAME = 'Cost Aware Tail Guard v1';

const analysisCacheByDataset = new WeakMap();

function getDecisionIndex(index, config) {
  const warmupBars = config.warmupBars || 240;
  const rebalanceBars = Math.max(90, config.rebalanceBars || DEFAULT_CONFIG.rebalanceBars);
  if (index <= warmupBars) return index;
  return Math.max(warmupBars, index - ((index - warmupBars) % rebalanceBars));
}

function scoreCandidate(candles, decisionIndex) {
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
  const costScore = (momentum60 ?? -1) * 0.25
    + (momentum120 ?? -1) * 0.45
    + (score.score / 100) * 0.2
    - Math.max(0, (volatility ?? 0.14) - 0.04) * 3.2
    + Math.max(-0.14, pullback ?? -0.14) * 0.35;

  return {
    ...score,
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

function buildRawWeights({ ranking, btcMacro, btcHealthy, config, currentDrawdown }) {
  if (!btcHealthy || btcMacro.exposureCap <= 0) return {};
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
