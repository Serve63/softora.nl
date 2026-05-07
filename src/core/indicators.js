export function compactNumbers(values) {
  return values.filter((value) => Number.isFinite(value));
}

export function closes(candles) {
  return candles.map((candle) => Number(candle.close));
}

export function sma(values, period) {
  const output = Array(values.length).fill(null);
  if (!Number.isFinite(period) || period <= 0) return output;

  let rollingSum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    rollingSum += Number.isFinite(value) ? value : 0;

    if (index >= period) {
      const oldValue = Number(values[index - period]);
      rollingSum -= Number.isFinite(oldValue) ? oldValue : 0;
    }

    if (index >= period - 1) {
      output[index] = rollingSum / period;
    }
  }

  return output;
}

export function ema(values, period) {
  const output = Array(values.length).fill(null);
  if (!Number.isFinite(period) || period <= 0) return output;

  const smoothing = 2 / (period + 1);
  let previous = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) continue;

    if (previous === null) {
      previous = value;
    } else {
      previous = value * smoothing + previous * (1 - smoothing);
    }

    if (index >= period - 1) {
      output[index] = previous;
    }
  }

  return output;
}

export function roc(values, period) {
  const output = Array(values.length).fill(null);
  if (!Number.isFinite(period) || period <= 0) return output;

  for (let index = period; index < values.length; index += 1) {
    const previous = Number(values[index - period]);
    const current = Number(values[index]);
    output[index] = Number.isFinite(previous) && previous !== 0 && Number.isFinite(current)
      ? current / previous - 1
      : null;
  }

  return output;
}

export function rollingHigh(values, period) {
  const output = Array(values.length).fill(null);
  if (!Number.isFinite(period) || period <= 0) return output;

  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1).map(Number);
    output[index] = Math.max(...compactNumbers(window));
  }

  return output;
}

export function rollingStdDev(values, period) {
  const output = Array(values.length).fill(null);
  if (!Number.isFinite(period) || period <= 1) return output;

  for (let index = period - 1; index < values.length; index += 1) {
    const window = compactNumbers(values.slice(index - period + 1, index + 1).map(Number));
    if (window.length !== period) continue;

    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    output[index] = Math.sqrt(variance);
  }

  return output;
}

export function trueRange(candles) {
  return candles.map((candle, index) => {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const previousClose = index > 0 ? Number(candles[index - 1].close) : Number(candle.close);

    if (![high, low, previousClose].every(Number.isFinite)) return null;

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
  });
}

export function atr(candles, period = 14) {
  return ema(trueRange(candles), period);
}

export function valueAt(series, index, fallback = null) {
  const value = series[index];
  return Number.isFinite(value) ? value : fallback;
}

export function latestValid(series) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(series[index])) return series[index];
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

export function computeAssetScore(candles, index = candles.length - 1) {
  const history = candles.slice(0, index + 1);
  const closeValues = closes(history);
  const close = closeValues[closeValues.length - 1];
  const sma50 = latestValid(sma(closeValues, 50));
  const sma120 = latestValid(sma(closeValues, 120));
  const sma200 = latestValid(sma(closeValues, 200));
  const roc20 = latestValid(roc(closeValues, 20));
  const roc60 = latestValid(roc(closeValues, 60));
  const roc120 = latestValid(roc(closeValues, 120));
  const high55 = latestValid(rollingHigh(closeValues, 55));
  const atr14 = latestValid(atr(history, 14));

  if (![close, sma50, sma120, sma200, high55, atr14].every(Number.isFinite)) {
    return {
      score: 0,
      trend: 0,
      momentum: 0,
      breakout: 0,
      volatility: null,
      reasons: ['Te weinig historie voor betrouwbare score'],
    };
  }

  let trend = 0;
  if (close > sma50) trend += 12;
  if (close > sma120) trend += 12;
  if (close > sma200) trend += 12;
  if (sma50 > sma120) trend += 8;

  const momentum = scoreMomentum(roc20, 0.08) + scoreMomentum(roc60, 0.18) + scoreMomentum(roc120, 0.35);
  const breakout = close >= high55 * 0.995 ? 15 : close >= high55 * 0.96 ? 8 : 0;
  const volatility = atr14 / close;
  const volatilityPenalty = volatility > 0.1 ? 18 : volatility > 0.075 ? 10 : volatility > 0.055 ? 4 : 0;
  const score = clamp(trend + momentum + breakout + 18 - volatilityPenalty, 0, 100);

  const reasons = [];
  if (trend >= 32) reasons.push('trend sterk');
  if (momentum > 12) reasons.push('momentum positief');
  if (breakout >= 15) reasons.push('bij breakout-zone');
  if (volatilityPenalty >= 10) reasons.push('volatiliteit remt sizing');
  if (!reasons.length) reasons.push('score matig');

  return {
    score,
    trend,
    momentum,
    breakout,
    volatility,
    close,
    reasons,
  };
}
