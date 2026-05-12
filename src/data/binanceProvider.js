export const SUPPORTED_ASSETS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']);

export const TIMEFRAMES = Object.freeze({
  Daily: { label: 'Daily', interval: '1d', durationMs: 24 * 60 * 60 * 1000 },
  '4H': { label: '4H', interval: '4h', durationMs: 4 * 60 * 60 * 1000 },
});

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const BINANCE_TICKER_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price';
const MAX_BINANCE_LIMIT = 1000;

export class BinanceDataError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BinanceDataError';
    this.details = details;
  }
}

function parseKline(symbol, row) {
  return {
    symbol,
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
  };
}

function buildKlineUrl({ symbol, interval, limit, endTime }) {
  const url = new URL(BINANCE_KLINES_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', String(limit));
  if (Number.isFinite(endTime)) {
    url.searchParams.set('endTime', String(Math.floor(endTime)));
  }
  return url;
}

async function requestKlines({ symbol, interval, limit, endTime, fetchImpl, signal }) {
  const response = await fetchImpl(buildKlineUrl({ symbol, interval, limit, endTime }), { signal });

  if (!response.ok) {
    throw new BinanceDataError(`Binance gaf geen geldige response voor ${symbol}.`, {
      symbol,
      status: response.status,
      statusText: response.statusText,
    });
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new BinanceDataError(`Binance gaf onverwachte data terug voor ${symbol}.`, { symbol });
  }

  return payload.map((row) => parseKline(symbol, row));
}

export async function fetchKlines({
  symbol,
  timeframe = 'Daily',
  target = 3000,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!SUPPORTED_ASSETS.includes(symbol)) {
    throw new BinanceDataError(`Asset ${symbol} wordt niet ondersteund.`, { symbol });
  }

  if (typeof fetchImpl !== 'function') {
    throw new BinanceDataError('Er is geen fetch-functie beschikbaar om Binance data op te halen.');
  }

  const timeframeConfig = TIMEFRAMES[timeframe] || TIMEFRAMES.Daily;
  const candles = [];
  let endTime = Date.now();
  let remaining = Math.max(1, Number(target) || MAX_BINANCE_LIMIT);

  while (remaining > 0) {
    const limit = Math.min(MAX_BINANCE_LIMIT, remaining);
    const batch = await requestKlines({
      symbol,
      interval: timeframeConfig.interval,
      limit,
      endTime,
      fetchImpl,
      signal,
    });

    if (!batch.length) break;

    candles.unshift(...batch);
    remaining -= batch.length;
    endTime = batch[0].time - 1;

    if (batch.length < limit) break;
  }

  const deduped = new Map();
  for (const candle of candles) {
    deduped.set(candle.time, candle);
  }

  return [...deduped.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-target);
}

export async function fetchMarketData({
  assets = SUPPORTED_ASSETS,
  timeframe = 'Daily',
  target = 3000,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const candlesByAsset = {};
  const errors = [];

  for (const symbol of assets) {
    try {
      candlesByAsset[symbol] = await fetchKlines({ symbol, timeframe, target, fetchImpl, signal });
    } catch (error) {
      candlesByAsset[symbol] = [];
      errors.push({
        symbol,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details || {},
      });
    }
  }

  return {
    candlesByAsset,
    errors,
    summaries: buildDataSummaries(candlesByAsset, timeframe),
  };
}

export async function fetchTickerPrices({
  assets = SUPPORTED_ASSETS,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new BinanceDataError('Er is geen fetch-functie beschikbaar om Binance prijzen op te halen.');
  }

  const prices = {};
  const errors = [];

  for (const symbol of assets) {
    if (!SUPPORTED_ASSETS.includes(symbol)) {
      errors.push({ symbol, message: `Asset ${symbol} wordt niet ondersteund.` });
      continue;
    }

    try {
      const url = new URL(BINANCE_TICKER_PRICE_URL);
      url.searchParams.set('symbol', symbol);
      const response = await fetchImpl(url, { signal });
      if (!response.ok) {
        throw new BinanceDataError(`Binance gaf geen geldige prijsresponse voor ${symbol}.`, {
          symbol,
          status: response.status,
          statusText: response.statusText,
        });
      }
      const payload = await response.json();
      const price = Number(payload?.price);
      if (!Number.isFinite(price)) {
        throw new BinanceDataError(`Binance gaf geen geldige prijs terug voor ${symbol}.`, { symbol });
      }
      prices[symbol] = price;
    } catch (error) {
      errors.push({
        symbol,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details || {},
      });
    }
  }

  return {
    ok: errors.length === 0,
    prices,
    errors,
    timestamp: new Date().toISOString(),
  };
}

export function buildDataSummaries(candlesByAsset, timeframe = 'Daily') {
  return Object.entries(candlesByAsset).map(([symbol, candles]) => {
    const first = candles[0];
    const last = candles[candles.length - 1];
    return {
      symbol,
      candles: candles.length,
      start: first ? new Date(first.time).toISOString() : null,
      end: last ? new Date(last.time).toISOString() : null,
      timeframe,
    };
  });
}
