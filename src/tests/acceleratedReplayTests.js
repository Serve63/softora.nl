import {
  runAcceleratedForwardReplay,
  runMultiWindowAcceleratedReplay,
} from '../forward/acceleratedReplay.js';

function makeCandles(symbol, count, drift = 0.001) {
  const candles = [];
  let price = symbol === 'BTCUSDT' ? 100 : 50;
  for (let index = 0; index < count; index += 1) {
    const activeDrift = typeof drift === 'function' ? drift(index) : drift;
    price *= 1 + activeDrift + Math.sin(index / 11) * 0.0002;
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
    {
      name: 'Multi-window replay beoordeelt meerdere losse periodes',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 520, 0.001),
          ETHUSDT: makeCandles('ETHUSDT', 520, -0.001),
        };
        const result = runMultiWindowAcceleratedReplay({
          candlesByAsset,
          strategy: alwaysLongBtc,
          assets: ['BTCUSDT', 'ETHUSDT'],
          config: { initialCapital: 10000, feeRate: 0, slippageRate: 0, warmupBars: 20 },
          windowCount: 3,
          windowLogs: 20,
          replayRules: { minLogs: 10, minGateOpenRate: 0.1 },
          multiWindowRules: { minWindows: 3, minPassRate: 0.6, minPositiveRate: 0.6, minBeatRate: 0.6 },
        });

        assert(result.ok, 'Multi-window replay moet draaien.');
        assert(result.windows.length === 3, 'Multi-window replay moet drie periodes beoordelen.');
        assert(result.summary.passRate >= 0.6, 'Sterke trend moet genoeg replay-ramen laten slagen.');
      },
    },
    {
      name: 'Multi-window replay faalt als slechtste periode te hard verliest',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 520, (index) => (index < 390 ? 0.001 : -0.01)),
          ETHUSDT: makeCandles('ETHUSDT', 520, (index) => (index < 390 ? 0.0008 : -0.008)),
        };
        const result = runMultiWindowAcceleratedReplay({
          candlesByAsset,
          strategy: alwaysLongBtc,
          assets: ['BTCUSDT', 'ETHUSDT'],
          config: { initialCapital: 10000, feeRate: 0, slippageRate: 0, warmupBars: 20 },
          windowCount: 3,
          windowLogs: 20,
          replayRules: { minLogs: 10, minGateOpenRate: 0.1, maxLossBeforeFail: -0.04 },
          multiWindowRules: { minWindows: 3, maxWorstReturn: -0.04, maxWorstDrawdown: 0.04 },
        });

        assert(result.verdict === 'FAIL', 'Multi-window replay moet falen bij een harde slechte periode.');
        assert(result.discipline.failed.some((check) => check.id === 'worst-return' || check.id === 'worst-drawdown'), 'Slechte periode moet zichtbaar falen.');
      },
    },
  ];
}
