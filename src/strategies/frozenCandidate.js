import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { closes, computeAssetScore, latestValid, roc, sma } from '../core/indicators.js';
import { sumWeights } from '../core/portfolio.js';
import { analyzeBtcMacro, applyRiskControls, DEFAULT_CONFIG } from '../core/riskEngine.js';

export const FROZEN_CANDIDATE_NAME = 'Frozen Candidate v1';

function addWeight(weights, symbol, value) {
  weights[symbol] = (weights[symbol] || 0) + value;
}

function getDecisionIndex(index, config) {
  const warmupBars = config.warmupBars || 220;
  const rebalanceBars = config.rebalanceBars || DEFAULT_CONFIG.rebalanceBars;
  if (index <= warmupBars) return index;
  return Math.max(warmupBars, index - ((index - warmupBars) % rebalanceBars));
}

function scoreRotationCandidate(candles, decisionIndex) {
  const score = computeAssetScore(candles, decisionIndex);
  const history = candles.slice(0, decisionIndex + 1);
  const closeValues = closes(history);
  const close = closeValues[closeValues.length - 1];
  const sma200 = latestValid(sma(closeValues, 200));
  const momentum60 = latestValid(roc(closeValues, 60));
  const momentum90 = latestValid(roc(closeValues, 90));
  const momentum180 = latestValid(roc(closeValues, 180));
  const rotationScore = (momentum60 ?? -1) * 0.2
    + (momentum90 ?? -1) * 0.5
    + (momentum180 ?? -1) * 0.3;

  return {
    ...score,
    rotationScore,
    momentum60,
    momentum90,
    momentum180,
    trendPass: Number.isFinite(close) && Number.isFinite(sma200) && close > sma200,
  };
}

function buildRawWeights({ ranking, btcMacro, config, currentDrawdown }) {
  if (btcMacro.state === 'weak' || btcMacro.exposureCap <= 0) return {};
  if (currentDrawdown >= (config.emergencyDrawdownStop ?? DEFAULT_CONFIG.emergencyDrawdownStop)) return {};

  const selected = ranking.find((asset) => (
    asset.trendPass
    && asset.score >= config.scoreThreshold
    && asset.rotationScore > (config.minRotationMomentum ?? DEFAULT_CONFIG.minRotationMomentum)
  ));
  if (!selected) return {};

  const rawWeights = { [selected.symbol]: 1 };

  if (btcMacro.state === 'strong' && selected.symbol !== 'BTCUSDT') {
    const btcCandidate = ranking.find((asset) => asset.symbol === 'BTCUSDT');
    if (btcCandidate?.trendPass && btcCandidate.rotationScore > 0.02) {
      rawWeights[selected.symbol] = 0.9;
      addWeight(rawWeights, 'BTCUSDT', 0.1);
    }
  }

  return rawWeights;
}

export function generateFrozenCandidateSignal({
  candlesByAsset,
  index,
  assets = SUPPORTED_ASSETS,
  config = DEFAULT_CONFIG,
  currentDrawdown = 0,
} = {}) {
  const activeConfig = { ...DEFAULT_CONFIG, ...config };
  const decisionIndex = getDecisionIndex(index, activeConfig);
  const btcCandles = candlesByAsset.BTCUSDT || [];
  const btcMacro = analyzeBtcMacro(btcCandles, decisionIndex, activeConfig.guardMode);

  const ranking = assets
    .map((symbol) => {
      const score = scoreRotationCandidate(candlesByAsset[symbol] || [], decisionIndex);
      return { symbol, ...score };
    })
    .sort((a, b) => b.rotationScore - a.rotationScore || b.score - a.score);

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
    config: activeConfig,
  });

  const exposure = sumWeights(risk.weights);
  const label = exposure > 0
    ? Object.entries(risk.weights)
      .filter(([, weight]) => weight > 0.01)
      .map(([symbol, weight]) => `${symbol.replace('USDT', '')} ${(weight * 100).toFixed(0)}%`)
      .join(' / ')
    : 'CASH';

  return {
    strategyName: FROZEN_CANDIDATE_NAME,
    label,
    weights: risk.weights,
    exposure,
    ranking,
    btcMacro,
    risk,
    reasons: [
      btcMacro.reason,
      risk.reason,
      `Decision candle: ${new Date((candlesByAsset.BTCUSDT || [])[decisionIndex]?.time || Date.now()).toISOString().slice(0, 10)}.`,
      exposure > 0
        ? `Top rotation: ${ranking.slice(0, 3).map((asset) => `${asset.symbol.replace('USDT', '')} ${(asset.rotationScore * 100).toFixed(1)}`).join(', ')}.`
        : 'Geen asset haalt tegelijk de macro-, score- en risk gates.',
    ],
  };
}

export default {
  name: FROZEN_CANDIDATE_NAME,
  generateSignal: generateFrozenCandidateSignal,
};
