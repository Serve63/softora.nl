import { applyPortfolioReturn, equalWeight } from '../core/portfolio.js';
import { clearForwardState, loadForwardState, saveForwardState } from '../storage/localStore.js';

export function createEmptyForwardState(initialCapital = 10000) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    logs: [],
    paperPortfolio: {
      equity: initialCapital,
      weights: {},
    },
    benchmarkPortfolio: {
      equity: initialCapital,
      weights: {},
    },
  };
}

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function latestPricesFromCandles(candlesByAsset, assets) {
  return Object.fromEntries(assets.map((asset) => {
    const candles = candlesByAsset[asset] || [];
    const last = candles[candles.length - 1];
    return [asset, last?.close || null];
  }));
}

export function loadOrCreateForwardState(initialCapital = 10000, storage) {
  return loadForwardState(storage) || createEmptyForwardState(initialCapital);
}

export function logForwardSignal({
  state,
  signal,
  candlesByAsset,
  assets,
  config,
  storage,
  timestamp,
} = {}) {
  const activeState = state || loadOrCreateForwardState(config?.initialCapital || 10000, storage);
  const firstAssetCandles = candlesByAsset?.[assets?.[0]] || [];
  const lastCandle = firstAssetCandles[firstAssetCandles.length - 1];
  const asOf = timestamp || lastCandle?.time || Date.now();
  const key = dateKey(asOf);
  const timeframe = config?.timeframe || 'Daily';

  if (activeState.logs.some((entry) => entry.dateKey === key && entry.timeframe === timeframe)) {
    return {
      state: activeState,
      skipped: true,
      message: `Er bestaat al een forward-log voor ${key} (${timeframe}).`,
    };
  }

  const latestPrices = latestPricesFromCandles(candlesByAsset || {}, assets || []);
  const previousLog = activeState.logs[activeState.logs.length - 1];
  let paperEquity = activeState.paperPortfolio?.equity ?? config.initialCapital;
  let benchmarkEquity = activeState.benchmarkPortfolio?.equity ?? config.initialCapital;

  if (previousLog?.prices) {
    paperEquity = applyPortfolioReturn(
      paperEquity,
      previousLog.weights || {},
      previousLog.prices,
      latestPrices,
    ).equity;

    benchmarkEquity = applyPortfolioReturn(
      benchmarkEquity,
      previousLog.benchmarkWeights || equalWeight(assets, 1),
      previousLog.prices,
      latestPrices,
    ).equity;
  }

  const benchmarkWeights = equalWeight(assets || [], 1);
  const entry = {
    dateKey: key,
    timestamp: new Date(asOf).toISOString(),
    timeframe,
    signal: signal?.label || 'CASH',
    gateOpen: Boolean(signal?.exposure > 0),
    weights: signal?.weights || {},
    benchmarkWeights,
    prices: latestPrices,
    paperEquity,
    benchmarkEquity,
    notes: signal?.reasons || [],
  };

  activeState.logs.push(entry);
  activeState.paperPortfolio = {
    equity: paperEquity,
    weights: entry.weights,
  };
  activeState.benchmarkPortfolio = {
    equity: benchmarkEquity,
    weights: benchmarkWeights,
  };

  saveForwardState(activeState, storage);
  return {
    state: activeState,
    skipped: false,
    entry,
    message: `Forward-signaal gelogd voor ${key}.`,
  };
}

export function exportForwardJson(state) {
  return JSON.stringify(state || createEmptyForwardState(), null, 2);
}

export function importForwardJson(raw, storage) {
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.logs)) {
    throw new Error('JSON import bevat geen geldige forward logs.');
  }
  saveForwardState(parsed, storage);
  return parsed;
}

export function exportForwardCsv(state) {
  const rows = [
    ['date', 'timeframe', 'signal', 'gate_open', 'paper_equity', 'benchmark_equity', 'weights'],
  ];

  for (const entry of state?.logs || []) {
    rows.push([
      entry.dateKey,
      entry.timeframe,
      entry.signal,
      entry.gateOpen ? 'true' : 'false',
      String(entry.paperEquity),
      String(entry.benchmarkEquity),
      JSON.stringify(entry.weights).replaceAll('"', '""'),
    ]);
  }

  return rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

export function resetForwardState(initialCapital = 10000, storage) {
  clearForwardState(storage);
  const state = createEmptyForwardState(initialCapital);
  saveForwardState(state, storage);
  return state;
}
