const crypto = require('node:crypto');

const DEFAULT_START_EQUITY = 10_000;
const DEFAULT_FEE_RATE = 0.001;
const DEFAULT_SLIPPAGE_RATE = 0.001;
const EPSILON = 1e-9;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function createDatasetFingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function toFinitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} moet een positief getal zijn.`);
  }
  return number;
}

function normalizeCandle(row, symbol) {
  const time = Number(row && (row.time ?? row.openTime));
  if (!Number.isFinite(time)) throw new Error(`${symbol} bevat een candle zonder geldige tijd.`);
  const candle = {
    time,
    open: toFinitePositive(row.open, `${symbol} open`),
    high: toFinitePositive(row.high, `${symbol} high`),
    low: toFinitePositive(row.low, `${symbol} low`),
    close: toFinitePositive(row.close, `${symbol} close`),
    volume: Number.isFinite(Number(row.volume)) ? Number(row.volume) : 0,
  };
  if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
    throw new Error(`${symbol} bevat een onmogelijke OHLC-candle op ${time}.`);
  }
  return candle;
}

function normalizeCandlesBySymbol(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('candlesBySymbol moet een object per symbool zijn.');
  }

  const normalized = {};
  for (const symbol of Object.keys(input).sort()) {
    const rows = input[symbol];
    if (!Array.isArray(rows) || rows.length < 2) {
      throw new Error(`${symbol} heeft minimaal twee candles nodig.`);
    }
    const byTime = new Map();
    rows.forEach((row) => {
      const candle = normalizeCandle(row, symbol);
      if (byTime.has(candle.time)) throw new Error(`${symbol} bevat dubbele candle ${candle.time}.`);
      byTime.set(candle.time, candle);
    });
    normalized[symbol] = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  }

  if (!Object.keys(normalized).length) throw new Error('Minimaal een symbool is vereist.');
  return alignCandles(normalized);
}

function alignCandles(candlesBySymbol) {
  const symbols = Object.keys(candlesBySymbol);
  const sharedTimes = symbols
    .map((symbol) => new Set(candlesBySymbol[symbol].map((row) => row.time)))
    .reduce((shared, times) => new Set(Array.from(shared).filter((time) => times.has(time))));
  const times = Array.from(sharedTimes).sort((a, b) => a - b);
  if (times.length < 2) throw new Error('Symbolen hebben minder dan twee gedeelde candles.');

  const aligned = {};
  symbols.forEach((symbol) => {
    const byTime = new Map(candlesBySymbol[symbol].map((row) => [row.time, row]));
    aligned[symbol] = times.map((time) => byTime.get(time));
  });
  return { symbols, times, candlesBySymbol: aligned };
}

function normalizeWeights(input, symbols) {
  const weights = {};
  let total = 0;
  for (const [symbol, rawWeight] of Object.entries(input || {})) {
    if (!symbols.includes(symbol)) throw new Error(`Onbekend symbool in doelformatie: ${symbol}.`);
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`Ongeldig gewicht voor ${symbol}.`);
    if (weight <= EPSILON) continue;
    weights[symbol] = weight;
    total += weight;
  }
  if (total > 1 + EPSILON) throw new Error(`Totale allocatie ${total} is groter dan 100%.`);
  return weights;
}

function portfolioEquity(cash, positions, candlesBySymbol, index, field = 'close') {
  return Object.entries(positions).reduce(
    (equity, [symbol, position]) => equity + position.units * candlesBySymbol[symbol][index][field],
    cash,
  );
}

function currentWeights(cash, positions, candlesBySymbol, index, field = 'close') {
  const equity = portfolioEquity(cash, positions, candlesBySymbol, index, field) || 1;
  return Object.fromEntries(
    Object.entries(positions)
      .map(([symbol, position]) => [symbol, (position.units * candlesBySymbol[symbol][index][field]) / equity])
      .filter(([, weight]) => weight > EPSILON),
  );
}

function runNextBarPortfolioBacktest(options = {}) {
  const {
    signalAt,
    startEquity = DEFAULT_START_EQUITY,
    feeRate = DEFAULT_FEE_RATE,
    slippageRate = DEFAULT_SLIPPAGE_RATE,
    minimumTradeValue = 0,
    rebalanceThreshold = 0,
  } = options;
  if (typeof signalAt !== 'function') throw new Error('signalAt callback is vereist.');
  const initialEquity = toFinitePositive(startEquity, 'startEquity');
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) throw new Error('feeRate is ongeldig.');
  if (!Number.isFinite(slippageRate) || slippageRate < 0 || slippageRate >= 1) {
    throw new Error('slippageRate is ongeldig.');
  }

  const aligned = normalizeCandlesBySymbol(options.candlesBySymbol);
  const { symbols, times, candlesBySymbol } = aligned;
  const dataset = { symbols, times, candlesBySymbol };
  const datasetFingerprint = createDatasetFingerprint(dataset);
  let cash = initialEquity;
  const positions = {};
  const decisions = [];
  const trades = [];
  const equityCurve = [];
  let pendingDecision = null;
  let peakEquity = initialEquity;
  let maxDrawdown = 0;

  function executePending(index) {
    if (!pendingDecision) return;
    const weights = pendingDecision.weights;
    const equityBefore = portfolioEquity(cash, positions, candlesBySymbol, index, 'open');

    for (const symbol of symbols) {
      const open = candlesBySymbol[symbol][index].open;
      const currentValue = (positions[symbol]?.units || 0) * open;
      const targetValue = (weights[symbol] || 0) * equityBefore;
      const sellValue = currentValue - targetValue;
      if (sellValue <= Math.max(minimumTradeValue, equityBefore * rebalanceThreshold)) continue;
      const units = Math.min(positions[symbol].units, sellValue / open);
      const executionPrice = open * (1 - slippageRate);
      const gross = units * executionPrice;
      const fee = gross * feeRate;
      cash += gross - fee;
      positions[symbol].units -= units;
      if (positions[symbol].units <= EPSILON) delete positions[symbol];
      trades.push({
        side: 'SELL', symbol, units, executionPrice, gross, fee,
        decisionTime: pendingDecision.decisionTime, executionTime: times[index], reason: pendingDecision.reason,
      });
    }

    const equityAfterSells = portfolioEquity(cash, positions, candlesBySymbol, index, 'open');
    for (const symbol of symbols) {
      const open = candlesBySymbol[symbol][index].open;
      const currentValue = (positions[symbol]?.units || 0) * open;
      const targetValue = (weights[symbol] || 0) * equityAfterSells;
      const desiredSpend = Math.min(cash, targetValue - currentValue);
      if (desiredSpend <= Math.max(minimumTradeValue, equityAfterSells * rebalanceThreshold)) continue;
      const executionPrice = open * (1 + slippageRate);
      const fee = desiredSpend * feeRate;
      const units = (desiredSpend - fee) / executionPrice;
      if (units <= EPSILON) continue;
      cash -= desiredSpend;
      positions[symbol] = positions[symbol] || { units: 0 };
      positions[symbol].units += units;
      trades.push({
        side: 'BUY', symbol, units, executionPrice, gross: desiredSpend - fee, fee,
        decisionTime: pendingDecision.decisionTime, executionTime: times[index], reason: pendingDecision.reason,
      });
    }
    pendingDecision.executedAt = times[index];
    pendingDecision = null;
  }

  for (let index = 0; index < times.length; index += 1) {
    executePending(index);
    const equity = portfolioEquity(cash, positions, candlesBySymbol, index, 'close');
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0);
    equityCurve.push({ time: times[index], equity, cash, weights: currentWeights(cash, positions, candlesBySymbol, index) });

    const historyBySymbol = Object.freeze(Object.fromEntries(
      symbols.map((symbol) => [symbol, Object.freeze(candlesBySymbol[symbol].slice(0, index + 1).map(Object.freeze))]),
    ));
    const signal = signalAt(Object.freeze({
      index,
      time: times[index],
      symbols: Object.freeze([...symbols]),
      historyBySymbol,
      portfolio: Object.freeze({ equity, cash, weights: currentWeights(cash, positions, candlesBySymbol, index) }),
    })) || {};
    const decision = {
      decisionTime: times[index],
      executionTime: index + 1 < times.length ? times[index + 1] : null,
      weights: normalizeWeights(signal.weights, symbols),
      reason: String(signal.reason || 'Geen reden opgegeven'),
    };
    decisions.push(decision);
    pendingDecision = index + 1 < times.length ? decision : decision;
  }

  const finalEquity = equityCurve[equityCurve.length - 1].equity;
  const totalFees = trades.reduce((sum, trade) => sum + trade.fee, 0);
  return {
    engineVersion: '17.0.0',
    executionModel: 'decision-on-close_execute-next-open',
    datasetFingerprint,
    firstTime: times[0],
    lastTime: times[times.length - 1],
    startEquity: initialEquity,
    finalEquity,
    totalReturn: finalEquity / initialEquity - 1,
    maxDrawdown,
    totalFees,
    tradeCount: trades.length,
    feeRate,
    slippageRate,
    decisions,
    trades,
    equityCurve,
    pendingDecision,
  };
}

module.exports = {
  canonicalJson,
  createDatasetFingerprint,
  normalizeCandlesBySymbol,
  runNextBarPortfolioBacktest,
};
