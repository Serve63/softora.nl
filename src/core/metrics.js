export function calculateReturn(startValue, endValue) {
  if (!Number.isFinite(startValue) || startValue === 0 || !Number.isFinite(endValue)) return 0;
  return endValue / startValue - 1;
}

export function maxDrawdown(equityCurve) {
  let peak = -Infinity;
  let maxDepth = 0;
  let peakTime = null;
  let troughTime = null;

  for (const point of equityCurve) {
    const value = Number(point.value);
    if (!Number.isFinite(value)) continue;

    if (value > peak) {
      peak = value;
      peakTime = point.time;
    }

    if (peak > 0) {
      const drawdown = value / peak - 1;
      if (drawdown < maxDepth) {
        maxDepth = drawdown;
        troughTime = point.time;
      }
    }
  }

  return {
    value: Math.abs(maxDepth),
    peakTime,
    troughTime,
  };
}

export function profitFactor(closedTrades) {
  let grossProfit = 0;
  let grossLoss = 0;

  for (const trade of closedTrades) {
    const pnl = Number(trade.pnl);
    if (!Number.isFinite(pnl)) continue;
    if (pnl > 0) grossProfit += pnl;
    if (pnl < 0) grossLoss += Math.abs(pnl);
  }

  if (grossProfit === 0 && grossLoss === 0) return 0;
  if (grossLoss === 0) return Number.POSITIVE_INFINITY;
  return grossProfit / grossLoss;
}

export function winRate(closedTrades) {
  const validTrades = closedTrades.filter((trade) => Number.isFinite(trade.pnl));
  if (!validTrades.length) return 0;
  const winners = validTrades.filter((trade) => trade.pnl > 0).length;
  return winners / validTrades.length;
}

export function sliceWindowReturn(curve, startIndex, endIndex = curve.length - 1) {
  if (!curve.length || startIndex >= curve.length || endIndex <= startIndex) return 0;
  return calculateReturn(curve[startIndex].value, curve[endIndex].value);
}

export function calculateOosMetrics(strategyCurve, benchmarkCurve, oosRatio = 0.25) {
  const length = Math.min(strategyCurve.length, benchmarkCurve.length);
  if (length < 2) {
    return {
      startIndex: 0,
      startTime: null,
      endTime: null,
      strategyReturn: 0,
      benchmarkReturn: 0,
      candles: 0,
    };
  }

  const startIndex = Math.max(1, Math.floor(length * (1 - oosRatio)));
  return {
    startIndex,
    startTime: strategyCurve[startIndex]?.time || null,
    endTime: strategyCurve[length - 1]?.time || null,
    strategyReturn: sliceWindowReturn(strategyCurve, startIndex, length - 1),
    benchmarkReturn: sliceWindowReturn(benchmarkCurve, startIndex, length - 1),
    candles: length - startIndex,
  };
}

export function calculateWalkForwardBeatRate(strategyCurve, benchmarkCurve, windows = 6) {
  const length = Math.min(strategyCurve.length, benchmarkCurve.length);
  if (length < windows + 1) return 0;

  let beats = 0;
  let tested = 0;
  const windowSize = Math.floor((length - 1) / windows);

  for (let windowIndex = 0; windowIndex < windows; windowIndex += 1) {
    const start = windowIndex * windowSize;
    const end = windowIndex === windows - 1 ? length - 1 : Math.min(length - 1, start + windowSize);
    if (end <= start) continue;

    const strategyReturn = sliceWindowReturn(strategyCurve, start, end);
    const benchmarkReturn = sliceWindowReturn(benchmarkCurve, start, end);
    if (strategyReturn > benchmarkReturn) beats += 1;
    tested += 1;
  }

  return tested ? beats / tested : 0;
}
