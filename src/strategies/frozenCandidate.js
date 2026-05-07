import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { computeAssetScore } from '../core/indicators.js';
import { sumWeights } from '../core/portfolio.js';
import { analyzeBtcMacro, applyRiskControls, DEFAULT_CONFIG } from '../core/riskEngine.js';

export const FROZEN_CANDIDATE_NAME = 'Frozen Candidate v1';

function addWeight(weights, symbol, value) {
  weights[symbol] = (weights[symbol] || 0) + value;
}

function buildRawWeights({ ranking, btcMacro, config }) {
  if (btcMacro.state === 'weak' || btcMacro.exposureCap <= 0) return {};

  const selected = ranking.filter((asset) => asset.score >= config.scoreThreshold);
  if (!selected.length) return {};

  const rawWeights = {};
  const scoreTotal = selected.slice(0, 3).reduce((sum, asset) => sum + asset.score, 0);

  if (btcMacro.state === 'strong') {
    const btcScore = ranking.find((asset) => asset.symbol === 'BTCUSDT')?.score || 0;
    if (btcScore >= 45) addWeight(rawWeights, 'BTCUSDT', 0.32);
  }

  const tacticalBudget = btcMacro.state === 'strong' ? 0.68 : 0.9;
  for (const asset of selected.slice(0, 3)) {
    const scoreShare = scoreTotal > 0 ? asset.score / scoreTotal : 1 / selected.length;
    addWeight(rawWeights, asset.symbol, tacticalBudget * scoreShare);
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
  const btcCandles = candlesByAsset.BTCUSDT || [];
  const btcMacro = analyzeBtcMacro(btcCandles, index, config.guardMode);

  const ranking = assets
    .map((symbol) => {
      const score = computeAssetScore(candlesByAsset[symbol] || [], index);
      return { symbol, ...score };
    })
    .sort((a, b) => b.score - a.score);

  const rawWeights = buildRawWeights({ ranking, btcMacro, config });
  const risk = applyRiskControls({
    rawWeights,
    ranking,
    btcMacro,
    currentDrawdown,
    config,
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
      exposure > 0
        ? `Top ranking: ${ranking.slice(0, 3).map((asset) => `${asset.symbol.replace('USDT', '')} ${asset.score.toFixed(0)}`).join(', ')}.`
        : 'Geen asset haalt tegelijk de macro-, score- en risk gates.',
    ],
  };
}

export default {
  name: FROZEN_CANDIDATE_NAME,
  generateSignal: generateFrozenCandidateSignal,
};
