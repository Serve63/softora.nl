const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDatasetFingerprint,
  normalizeCandlesBySymbol,
  runNextBarPortfolioBacktest,
} = require('../../server/services/papertrader-research');
const { createV17CoreShieldStrategy } = require('../../server/services/papertrader-v17-strategy');

function candles(rows) {
  return rows.map(([time, open, close]) => ({
    time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 100,
  }));
}

test('dataset fingerprint is stable across object key order', () => {
  assert.equal(
    createDatasetFingerprint({ b: 2, a: [{ d: 4, c: 3 }] }),
    createDatasetFingerprint({ a: [{ c: 3, d: 4 }], b: 2 }),
  );
});

test('normalizer aligns symbols and rejects duplicate candles', () => {
  const aligned = normalizeCandlesBySymbol({
    BTCUSDT: candles([[1, 10, 11], [2, 11, 12], [3, 12, 13]]),
    ETHUSDT: candles([[2, 20, 21], [3, 21, 22], [4, 22, 23]]),
  });
  assert.deepEqual(aligned.times, [2, 3]);
  assert.throws(() => normalizeCandlesBySymbol({
    BTCUSDT: candles([[1, 10, 11], [1, 11, 12]]),
  }), /dubbele candle/);
  assert.throws(() => normalizeCandlesBySymbol({
    BTCUSDT: [
      { time: 1, open: 10, high: 9, low: 8, close: 11 },
      { time: 2, open: 11, high: 12, low: 10, close: 12 },
    ],
  }), /onmogelijke OHLC-candle/);
});

test('signal on candle close executes only at the next candle open', () => {
  const observedHistoryLengths = [];
  const result = runNextBarPortfolioBacktest({
    candlesBySymbol: {
      BTCUSDT: candles([[1, 100, 110], [2, 200, 210], [3, 300, 310]]),
    },
    signalAt: ({ historyBySymbol }) => {
      observedHistoryLengths.push(historyBySymbol.BTCUSDT.length);
      return { weights: { BTCUSDT: 1 }, reason: 'Testsignaal' };
    },
    startEquity: 1_000,
    feeRate: 0,
    slippageRate: 0,
  });

  assert.deepEqual(observedHistoryLengths, [1, 2, 3], 'strategie mag nooit toekomstige candles zien');
  assert.equal(result.trades[0].decisionTime, 1);
  assert.equal(result.trades[0].executionTime, 2);
  assert.equal(result.trades[0].executionPrice, 200);
  assert.equal(result.executionModel, 'decision-on-close_execute-next-open');
  assert.equal(result.pendingDecision.decisionTime, 3, 'laatste signaal blijft onvervuld');
  assert.equal(result.pendingDecision.executionTime, null);
});

test('fees and adverse slippage reduce bought units deterministically', () => {
  const result = runNextBarPortfolioBacktest({
    candlesBySymbol: { BTCUSDT: candles([[1, 100, 100], [2, 100, 100]]) },
    signalAt: () => ({ weights: { BTCUSDT: 1 } }),
    startEquity: 1_000,
    feeRate: 0.01,
    slippageRate: 0.01,
  });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].executionPrice, 101);
  assert.equal(result.trades[0].fee, 10);
  assert.equal(result.totalFees, 10);
  assert.equal(result.tradeCount, 1);
  assert.ok(result.finalEquity < 1_000);
});

test('engine rejects leverage disguised as weights above 100 percent', () => {
  assert.throws(() => runNextBarPortfolioBacktest({
    candlesBySymbol: { BTCUSDT: candles([[1, 100, 100], [2, 100, 100]]) },
    signalAt: () => ({ weights: { BTCUSDT: 1.01 } }),
  }), /groter dan 100%/);
});

test('V17 core shield fails closed in a deep bear market', () => {
  const history = Array.from({ length: 240 }, (_, index) => ({
    time: index,
    open: 300 - index,
    high: 301 - index,
    low: 299 - index,
    close: 300 - index,
    volume: 100,
  }));
  const signal = createV17CoreShieldStrategy({ warmupBars: 220 })({
    index: 220,
    symbols: ['BTCUSDT'],
    historyBySymbol: { BTCUSDT: history.slice(0, 221) },
  });
  assert.deepEqual(signal.weights, {});
  assert.match(signal.reason, /shield|zwak/i);
});

test('V17 core shield allocates without leverage in a broad bull market', () => {
  const buildHistory = (multiplier) => Array.from({ length: 240 }, (_, index) => {
    const price = (100 + index * 1.2) * multiplier;
    return { time: index, open: price, high: price * 1.01, low: price * 0.99, close: price, volume: 100 };
  });
  const historyBySymbol = {
    BTCUSDT: buildHistory(1),
    ETHUSDT: buildHistory(0.5),
    SOLUSDT: buildHistory(0.1),
  };
  const signal = createV17CoreShieldStrategy({ warmupBars: 220 })({
    index: 220,
    symbols: Object.keys(historyBySymbol),
    historyBySymbol: Object.fromEntries(Object.entries(historyBySymbol).map(([symbol, rows]) => [symbol, rows.slice(0, 221)])),
  });
  const total = Object.values(signal.weights).reduce((sum, weight) => sum + weight, 0);
  assert.ok(total > 0);
  assert.ok(total <= 0.9 + Number.EPSILON);
  assert.ok(Object.values(signal.weights).every((weight) => weight <= 0.5));
});
