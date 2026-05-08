import { runAcceleratedForwardReplay } from '../forward/acceleratedReplay.js';

function makeCandles(symbol, count, drift = 0.001) {
  const candles = [];
  let price = symbol === 'BTCUSDT' ? 100 : 50;
  for (let index = 0; index < count; index += 1) {
    price *= 1 + drift + Math.sin(index / 11) * 0.0002;
    candles.push({
      symbol,
      time: Date.UTC(2025, 0, 1, index * 4),
      open: price * 0.998,
      high: price * 1.004,
      low: price * 0.996,
      close: price,
      volume: 1000 + index,
    });
  }
  return candles;
}

const alwaysLongBtc = {
  name: 'Always Long BTC Test',
  generateSignal() {
    return {
      label: 'BTC 50%',
      weights: { BTCUSDT: 0.5 },
      exposure: 0.5,
      reasons: ['test'],
    };
  },
};

const futureLeakStrategy = {
  name: 'Future Leak Test',
  generateSignal({ candlesByAsset, index }) {
    const canSeeFuture = (candlesByAsset.BTCUSDT || []).length > index + 1;
    return {
      label: canSeeFuture ? 'BTC 100%' : 'CASH',
      weights: canSeeFuture ? { BTCUSDT: 1 } : {},
      exposure: canSeeFuture ? 1 : 0,
      reasons: ['test'],
    };
  },
};

const flipStrategy = {
  name: 'Flip Test',
  generateSignal({ index }) {
    const long = index % 2 === 0;
    return {
      label: long ? 'BTC 50%' : 'CASH',
      weights: long ? { BTCUSDT: 0.5 } : {},
      exposure: long ? 0.5 : 0,
      reasons: ['test'],
    };
  },
};

export function acceleratedReplayTestCases() {
  return [
    {
      name: 'Accelerated replay logt maximaal een keer per dag',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 120, 0.001),
          ETHUSDT: makeCandles('ETHUSDT', 120, 0.0008),
        };
        const result = runAcceleratedForwardReplay({
          candlesByAsset,
          strategy: alwaysLongBtc,
          assets: ['BTCUSDT', 'ETHUSDT'],
          config: { initialCapital: 10000, feeRate: 0, slippageRate: 0, warmupBars: 10 },
          startIndex: 10,
          maxLogs: 12,
          logFrequency: 'daily',
        });
        const uniqueDates = new Set(result.logs.map((entry) => entry.dateKey));

        assert(result.ok, 'Replay moet draaien.');
        assert(result.logs.length === uniqueDates.size, 'Replay mag geen dubbele daglogs maken.');
        assert(result.logs.length <= 12, 'Replay moet maxLogs respecteren.');
      },
    },
    {
      name: 'Accelerated replay voorkomt future leakage in strict mode',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 80, 0.001),
          ETHUSDT: makeCandles('ETHUSDT', 80, 0.0008),
        };
        const result = runAcceleratedForwardReplay({
          candlesByAsset,
          strategy: futureLeakStrategy,
          assets: ['BTCUSDT', 'ETHUSDT'],
          config: { initialCapital: 10000, feeRate: 0, slippageRate: 0, warmupBars: 10 },
          startIndex: 10,
          maxLogs: 6,
          strictNoLookahead: true,
        });

        assert(result.logs.every((entry) => entry.signal === 'CASH'), 'Strict replay mag toekomstige candles niet zichtbaar maken.');
      },
    },
    {
      name: 'Accelerated replay rekent fees en slippage mee',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 80, 0),
          ETHUSDT: makeCandles('ETHUSDT', 80, 0),
        };
        const free = runAcceleratedForwardReplay({
          candlesByAsset,
          strategy: flipStrategy,
          assets: ['BTCUSDT', 'ETHUSDT'],
          config: { initialCapital: 10000, feeRate: 0, slippageRate: 0, warmupBars: 10 },
          startIndex: 10,
          maxLogs: 20,
          logFrequency: 'candle',
        });
        const costly = runAcceleratedForwardReplay({
          candlesByAsset,
          strategy: flipStrategy,
          assets: ['BTCUSDT', 'ETHUSDT'],
          config: { initialCapital: 10000, feeRate: 0.001, slippageRate: 0.0005, warmupBars: 10 },
          startIndex: 10,
          maxLogs: 20,
          logFrequency: 'candle',
        });

        assert(costly.metrics.feesPaid > 0, 'Replay moet fees tellen.');
        assert(costly.metrics.slippagePaid > 0, 'Replay moet slippage tellen.');
        assert(costly.metrics.paperEquity < free.metrics.paperEquity, 'Kosten moeten equity verlagen.');
      },
    },
  ];
}
