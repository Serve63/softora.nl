function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function closes(history) {
  return history.map((candle) => candle.close);
}

function simpleMovingAverage(values, length) {
  if (values.length < length) return null;
  return mean(values.slice(-length));
}

function returnOver(values, bars) {
  if (values.length <= bars) return null;
  return values.at(-1) / values.at(-(bars + 1)) - 1;
}

function realizedVolatility(values, bars = 20) {
  if (values.length <= bars) return null;
  const sample = values.slice(-(bars + 1));
  const returns = sample.slice(1).map((value, index) => value / sample[index] - 1);
  return standardDeviation(returns);
}

function scoreAsset(history) {
  const values = closes(history);
  const last = values.at(-1);
  const ma50 = simpleMovingAverage(values, 50);
  const ma200 = simpleMovingAverage(values, 200);
  const ret20 = returnOver(values, 20);
  const ret60 = returnOver(values, 60);
  const volatility = realizedVolatility(values, 20);
  if ([last, ma50, ma200, ret20, ret60, volatility].some((value) => value === null)) return null;
  let score = 50;
  score += last > ma200 ? 18 : -24;
  score += ma50 > ma200 ? 14 : -12;
  score += clamp(ret20 * 80, -12, 12);
  score += clamp(ret60 * 60, -16, 16);
  score -= clamp((volatility - 0.035) * 180, 0, 18);
  return { score: clamp(score, 0, 100), ret20, ret60, volatility, last, ma50, ma200 };
}

function createV17CoreShieldStrategy(config = {}) {
  const warmupBars = Math.max(200, Number(config.warmupBars) || 220);
  const rebalanceEveryBars = Math.max(1, Number(config.rebalanceEveryBars) || 9);
  const preferredCore = config.preferredCore || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  let lastWeights = {};

  return function v17CoreShieldSignal(context) {
    if (context.index < warmupBars) return { weights: {}, reason: 'Warmup: onvoldoende gesloten candles' };
    if ((context.index - warmupBars) % rebalanceEveryBars !== 0) {
      return { weights: lastWeights, reason: 'Doelallocatie vasthouden tot volgende rebalance' };
    }

    const btcHistory = context.historyBySymbol.BTCUSDT;
    if (!btcHistory) return { weights: {}, reason: 'BTC-macro ontbreekt: fail-closed naar cash' };
    const btc = scoreAsset(btcHistory);
    if (!btc) return { weights: {}, reason: 'BTC-macro heeft onvoldoende historie' };
    const deepBear = btc.last < btc.ma200 * 0.9 && btc.ma50 < btc.ma200 && btc.ret60 < -0.12;
    if (deepBear || btc.score < 32) {
      lastWeights = {};
      return { weights: {}, reason: 'BTC-macro diep zwak: tactical shield volledig actief' };
    }

    const ranking = context.symbols
      .map((symbol) => ({ symbol, metrics: scoreAsset(context.historyBySymbol[symbol]) }))
      .filter((candidate) => candidate.metrics)
      .sort((a, b) => b.metrics.score - a.metrics.score);
    const eligible = ranking.filter((candidate) => candidate.metrics.score >= 48 && candidate.metrics.ret60 > -0.08);
    if (!eligible.length) {
      lastWeights = {};
      return { weights: {}, reason: 'Geen asset door de V17 kwaliteitsdrempel' };
    }

    const strongMacro = btc.score >= 68 && btc.last > btc.ma50 && btc.ret60 > 0;
    const maximumExposure = strongMacro ? 0.9 : btc.score >= 52 ? 0.68 : 0.4;
    const selected = [...eligible].sort((a, b) => {
      const aCore = preferredCore.includes(a.symbol) ? 1 : 0;
      const bCore = preferredCore.includes(b.symbol) ? 1 : 0;
      return bCore - aCore || b.metrics.score - a.metrics.score;
    }).slice(0, 3);
    const raw = selected.map((candidate) => ({
      ...candidate,
      weight: Math.max(1, candidate.metrics.score - 35) / Math.max(0.02, candidate.metrics.volatility),
    }));
    const rawTotal = raw.reduce((sum, candidate) => sum + candidate.weight, 0) || 1;
    const weights = {};
    raw.forEach((candidate) => {
      weights[candidate.symbol] = Math.min(0.5, maximumExposure * candidate.weight / rawTotal);
    });
    const allocated = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    if (allocated > maximumExposure) {
      Object.keys(weights).forEach((symbol) => { weights[symbol] *= maximumExposure / allocated; });
    }
    lastWeights = weights;
    return {
      weights,
      reason: `V17 core shield: BTC-score ${btc.score.toFixed(1)}, exposure ${(Object.values(weights).reduce((a, b) => a + b, 0) * 100).toFixed(0)}%`,
    };
  };
}

module.exports = {
  createV17CoreShieldStrategy,
  scoreAsset,
};
