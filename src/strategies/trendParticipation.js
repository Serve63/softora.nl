import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { closes, computeAssetScore, latestValid, roc, sma } from '../core/indicators.js';
import { sumWeights } from '../core/portfolio.js';
import { analyzeBtcMacro, applyRiskControls, DEFAULT_CONFIG } from '../core/riskEngine.js';

export const TREND_PARTICIPATION_NAME = 'Trend Participation v1';

const analysisCacheByDataset = new WeakMap();

function getDecisionIndex(index, config) {
  const warmupBars = config.warmupBars || 220;
  const rebalanceBars = config.rebalanceBars || DEFAULT_CONFIG.rebalanceBars;
  if (index <= warmupBars) return index;
  return Math.max(warmupBars, index - ((index - warmupBars) % rebalanceBars));
}

function scoreParticipationCandidate(candles, decisionIndex) {
  const score = computeAssetScore(candles, decisionIndex);
  const history = candles.slice(0, decisionIndex + 1);
  const closeValues = closes(history);
  const close = closeValues[closeValues.length - 1];
  const sma120 = latestValid(sma(closeValues, 120));
  const sma200 = latestValid(sma(closeValues, 200));
  const momentum60 = latestValid(roc(closeValues, 60));
  const momentum120 = latestValid(roc(closeValues, 120));
  const participationScore = (momentum60 ?? -1) * 0.45
    + (momentum120 ?? -1) * 0.35
    + (score.score / 100) * 0.2;

  return {
    ...score,
    participationScore,
    momentum60,
    momentum120,
    trendPass: Number.isFinite(close)
      && Number.isFinite(sma120)
      && Number.isFinite(sma200)
      && close > sma120
      && close > sma200
      && Number.isFinite(momentum60)
      && momentum60 > -0.03,
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
  const ranking = assets
    .map((symbol) => {
      const score = scoreParticipationCandidate(candlesByAsset[symbol] || [], decisionIndex);
      return { symbol, ...score };
    })
    .sort((a, b) => b.participationScore - a.participationScore || b.score - a.score);

  const analysis = { btcMacro, ranking };
  datasetCache.set(key, analysis);
  return analysis;
}

function buildRawWeights({ ranking, btcMacro, config, currentDrawdown }) {
  if (btcMacro.state === 'weak' || btcMacro.exposureCap <= 0) return {};
  if (currentDrawdown >= (config.emergencyDrawdownStop ?? DEFAULT_CONFIG.emergencyDrawdownStop)) return {};

  const relaxedScoreThreshold = Math.max(28, (config.scoreThreshold ?? DEFAULT_CONFIG.scoreThreshold) * 0.78);
  const maxHoldings = btcMacro.state === 'strong' ? 4 : 2;
  const selected = ranking
    .filter((asset) => asset.trendPass && asset.score >= relaxedScoreThreshold && asset.participationScore > -0.02)
    .slice(0, maxHoldings);

  if (!selected.length) return {};

  const rawWeights = {};
  const totalQuality = selected.reduce((sum, asset) => {
    const momentumQuality = Math.max(0.05, asset.participationScore + 0.08);
    const scoreQuality = Math.max(0.2, asset.score / 100);
    return sum + momentumQuality + scoreQuality;
  }, 0);

  for (const asset of selected) {
    const momentumQuality = Math.max(0.05, asset.participationScore + 0.08);
    const scoreQuality = Math.max(0.2, asset.score / 100);
    rawWeights[asset.symbol] = (momentumQuality + scoreQuality) / totalQuality;
  }

  return rawWeights;
}

export function generateTrendParticipationSignal({
  candlesByAsset,
  index,
  assets = SUPPORTED_ASSETS,
  config = DEFAULT_CONFIG,
  currentDrawdown = 0,
} = {}) {
  const activeConfig = { ...DEFAULT_CONFIG, ...config };
  const decisionIndex = getDecisionIndex(index, activeConfig);
  const { btcMacro, ranking } = getCachedAnalysis({
    candlesByAsset,
    assets,
    decisionIndex,
    activeConfig,
  });
  const rawWeights = buildRawWeights({
    ranking,
    btcMacro,
    config: activeConfig,
    currentDrawdown,
  });
  const risk = applyRiskControls({
    rawWeights,
    ranking,
    btcMacro,
    currentDrawdown,
    config: {
      ...activeConfig,
      assetCap: Math.min(activeConfig.assetCap ?? DEFAULT_CONFIG.assetCap, 0.45),
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
    strategyName: TREND_PARTICIPATION_NAME,
    label,
    weights: risk.weights,
    exposure,
    ranking,
    btcMacro,
    risk,
    reasons: [
      btcMacro.reason,
      risk.reason,
      exposure > 0
        ? `Diversified trend basket: ${Object.keys(risk.weights).map((symbol) => symbol.replace('USDT', '')).join(', ')}.`
        : 'Trend-participatie vindt geen voldoende sterke basket binnen de macro- en risk gates.',
    ],
  };
}

export default {
  name: TREND_PARTICIPATION_NAME,
  generateSignal: generateTrendParticipationSignal,
};
