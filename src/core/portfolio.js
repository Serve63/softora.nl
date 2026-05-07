export function normalizeWeights(weights = {}, maxExposure = 1) {
  const cleaned = {};
  let total = 0;

  for (const [symbol, rawValue] of Object.entries(weights)) {
    const value = Math.max(0, Number(rawValue) || 0);
    if (value > 0) {
      cleaned[symbol] = value;
      total += value;
    }
  }

  const cap = Math.max(0, Math.min(1, Number(maxExposure)));
  if (total === 0 || cap === 0) return {};

  const scale = total > cap ? cap / total : 1;
  for (const symbol of Object.keys(cleaned)) {
    cleaned[symbol] *= scale;
  }

  return cleaned;
}

export function sumWeights(weights = {}) {
  return Object.values(weights).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function calculateTurnover(currentWeights = {}, targetWeights = {}) {
  const symbols = new Set([...Object.keys(currentWeights), ...Object.keys(targetWeights)]);
  let turnover = 0;

  for (const symbol of symbols) {
    turnover += Math.abs((Number(targetWeights[symbol]) || 0) - (Number(currentWeights[symbol]) || 0));
  }

  return turnover;
}

export function priceReturn(previousPrice, currentPrice) {
  if (!Number.isFinite(previousPrice) || previousPrice <= 0 || !Number.isFinite(currentPrice)) return 0;
  return currentPrice / previousPrice - 1;
}

export function applyPortfolioReturn(equity, weights = {}, previousPrices = {}, currentPrices = {}) {
  const startingEquity = Number(equity) || 0;
  let weightedGrowth = 1 - sumWeights(weights);

  for (const [symbol, weight] of Object.entries(weights)) {
    const growth = 1 + priceReturn(previousPrices[symbol], currentPrices[symbol]);
    weightedGrowth += (Number(weight) || 0) * growth;
  }

  return {
    equity: startingEquity * weightedGrowth,
    portfolioReturn: weightedGrowth - 1,
  };
}

export function driftWeights(weights = {}, previousPrices = {}, currentPrices = {}) {
  const cashWeight = Math.max(0, 1 - sumWeights(weights));
  let denominator = cashWeight;
  const numerators = {};

  for (const [symbol, weight] of Object.entries(weights)) {
    const growth = 1 + priceReturn(previousPrices[symbol], currentPrices[symbol]);
    numerators[symbol] = (Number(weight) || 0) * growth;
    denominator += numerators[symbol];
  }

  if (denominator <= 0) return {};

  const drifted = {};
  for (const [symbol, numerator] of Object.entries(numerators)) {
    if (numerator > 0) drifted[symbol] = numerator / denominator;
  }

  return drifted;
}

export function rebalancePortfolio({
  equity,
  currentWeights = {},
  targetWeights = {},
  feeRate = 0.001,
  slippageRate = 0.0005,
}) {
  const normalizedTarget = normalizeWeights(targetWeights, 1);
  const turnover = calculateTurnover(currentWeights, normalizedTarget);
  const feePaid = (Number(equity) || 0) * turnover * Math.max(0, Number(feeRate) || 0);
  const slippagePaid = (Number(equity) || 0) * turnover * Math.max(0, Number(slippageRate) || 0);
  const costsPaid = feePaid + slippagePaid;

  return {
    equity: Math.max(0, (Number(equity) || 0) - costsPaid),
    weights: normalizedTarget,
    turnover,
    feePaid,
    slippagePaid,
    costsPaid,
  };
}

export function equalWeight(assets = [], exposure = 1) {
  if (!assets.length || exposure <= 0) return {};
  const weight = Math.min(1, exposure) / assets.length;
  return Object.fromEntries(assets.map((asset) => [asset, weight]));
}

export function simulateTradeAccounting(initialCash, trades, feeRate = 0.001, slippageRate = 0.0005) {
  let cash = Number(initialCash) || 0;
  let position = 0;
  let costsPaid = 0;

  for (const trade of trades) {
    const price = Number(trade.price);
    const qty = Number(trade.qty);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;

    const notional = price * qty;
    const costs = Math.abs(notional) * (feeRate + slippageRate);
    costsPaid += costs;

    if (trade.side === 'buy') {
      cash -= notional + costs;
      position += qty;
    } else if (trade.side === 'sell') {
      cash += notional - costs;
      position -= qty;
    }
  }

  return { cash, position, costsPaid };
}
