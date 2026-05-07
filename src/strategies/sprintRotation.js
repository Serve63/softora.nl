import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { atr, closes, computeAssetScore, latestValid, roc, rollingHigh, sma } from '../core/indicators.js';
import { normalizeWeights, sumWeights } from '../core/portfolio.js';
import { DEFAULT_CONFIG } from '../core/riskEngine.js';

export const SPRINT_ROTATION_NAME = 'Sprint Rotation v1';

const analysisCacheByDataset = new WeakMap();

function getDecisionIndex(index, config) {
  const warmupBars = config.warmupBars || 220;
  const rebalanceBars = 7;
  if (index <= warmupBars) return index;
  return Math.max(warmupBars, index - ((index - warmupBars) % rebalanceBars));
}

function scoreSprintCandidate(candles, decisionIndex) {
  const score = computeAssetScore(candles, decisionIndex);
  const history = candles.slice(0, decisionIndex + 1);
  const closeValues = closes(history);
  const close = closeValues[closeValues.length - 1];
  const sma150 = latestValid(sma(closeValues, 150));
  const momentum14 = latestValid(roc(closeValues, 14));
  const momentum30 = latestValid(roc(closeValues, 30));
  const momentum60 = latestValid(roc(closeValues, 60));
  const high55 = latestValid(rollingHigh(closeValues, 55));
  const atr14 = latestValid(atr(history, 14));
  const volatility = Number.isFinite(close) && close > 0 && Number.isFinite(atr14) ? atr14 / close : null;
  const breakout = Number.isFinite(close) && Number.isFinite(high55) && close >= high55 * 0.98;
  const trendPass = (Number.isFinite(close) && Number.isFinite(sma150) && close > sma150)
    || (breakout && Number.isFinite(momentum14) && momentum14 > 0.02);
  const sprintScore = (momentum14 ?? -1) * 0.45
    + (momentum30 ?? -1) * 0.35
    + (momentum60 ?? -1) * 0.2
    + (breakout ? 0.16 : 0)
    - (Number.isFinite(volatility) ? volatility * 0.4 : 0.08);

  return {
    ...score,
    sprintScore,
    momentum14,
    momentum30,
    momentum60,
    breakout,
    trendPass,
    volatility,
  };
}

function getCachedAnalysis({ candlesByAsset, assets, decisionIndex }) {
  let datasetCache = analysisCacheByDataset.get(candlesByAsset);
  if (!datasetCache) {
    datasetCache = new Map();
    analysisCacheByDataset.set(candlesByAsset, datasetCache);
  }

  const key = `${assets.join('|')}:${decisionIndex}`;
  if (datasetCache.has(key)) return datasetCache.get(key);

  const btcCandles = candlesByAsset.BTCUSDT || [];
  const btcHistory = btcCandles.slice(0, decisionIndex + 1);
  const btcCloses = closes(btcHistory);
  const btcClose = btcCloses[btcCloses.length - 1];
  const btcSma200 = latestValid(sma(btcCloses, 200));
  const btcMomentum60 = latestValid(roc(btcCloses, 60));
  const btcMacroOk = Number.isFinite(btcClose)
    && Number.isFinite(btcSma200)
    && btcClose > btcSma200
    && Number.isFinite(btcMomentum60)
    && btcMomentum60 > -0.02;
  const btcMacroNeutral = Number.isFinite(btcClose) && Number.isFinite(btcSma200) && btcClose > btcSma200;
  const ranking = assets
    .map((symbol) => {
      const score = scoreSprintCandidate(candlesByAsset[symbol] || [], decisionIndex);
      return { symbol, ...score };
    })
    .sort((a, b) => b.sprintScore - a.sprintScore || b.score - a.score);

  const analysis = {
    ranking,
    btcMacro: {
      state: btcMacroOk ? 'strong' : btcMacroNeutral ? 'neutral' : 'weak',
      exposureCap: btcMacroOk ? 1 : btcMacroNeutral ? 0.55 : 0,
      reason: btcMacroOk
        ? 'Sprint macro groen: BTC boven lange trend en 60-candle momentum is niet zwak.'
        : btcMacroNeutral
          ? 'Sprint macro neutraal: BTC boven lange trend, maar momentum is voorzichtig.'
          : 'Sprint macro zwak: geen snelle rotatie.',
    },
  };
  datasetCache.set(key, analysis);
  return analysis;
}

function buildRawWeights({ ranking, btcMacro, config, currentDrawdown }) {
  const stop = Math.min(0.3, config.emergencyDrawdownStop ?? DEFAULT_CONFIG.emergencyDrawdownStop);
  if (currentDrawdown >= stop) return {};
  if (btcMacro.exposureCap <= 0) return {};

  const selected = ranking.find((asset) => asset.trendPass && asset.sprintScore > -0.02);
  return selected ? { [selected.symbol]: 1 } : {};
}

export function generateSprintRotationSignal({
  candlesByAsset,
  index,
  assets = SUPPORTED_ASSETS,
  config = DEFAULT_CONFIG,
  currentDrawdown = 0,
} = {}) {
  const activeConfig = { ...DEFAULT_CONFIG, ...config };
  const decisionIndex = getDecisionIndex(index, activeConfig);
  const { ranking, btcMacro } = getCachedAnalysis({
    candlesByAsset,
    assets,
    decisionIndex,
  });
  const rawWeights = buildRawWeights({
    ranking,
    btcMacro,
    config: activeConfig,
    currentDrawdown,
  });
  const weights = normalizeWeights(rawWeights, btcMacro.exposureCap);
  const exposure = sumWeights(weights);
  const top = ranking[0];
  const label = exposure > 0
    ? Object.entries(weights)
      .filter(([, weight]) => weight > 0.01)
      .map(([symbol, weight]) => `${symbol.replace('USDT', '')} ${(weight * 100).toFixed(0)}%`)
      .join(' / ')
    : 'CASH';

  return {
    strategyName: SPRINT_ROTATION_NAME,
    label,
    weights,
    exposure,
    ranking,
    btcMacro,
    risk: { exposure, exposureCap: btcMacro.exposureCap },
    reasons: [
      btcMacro.reason,
      top
        ? `Sprint top: ${top.symbol.replace('USDT', '')} score ${(top.sprintScore * 100).toFixed(1)}.`
        : 'Geen sprint-ranking beschikbaar.',
      'Incubatie-strategie: snelle rotatie moet rolling winnen zonder drawdown-limiet te breken voordat gate open mag.',
    ],
  };
}

export default {
  name: SPRINT_ROTATION_NAME,
  generateSignal: generateSprintRotationSignal,
};
