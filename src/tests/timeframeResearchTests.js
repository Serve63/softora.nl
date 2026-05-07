import { runTimeframeResearch } from '../core/timeframeResearch.js';

function makeCandles(symbol, count, drift, wave = 0.001) {
  const candles = [];
  let price = symbol === 'BTCUSDT' ? 100 : 30;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + drift + Math.sin(index / 17) * wave;
    candles.push({
      symbol,
      time: Date.UTC(2024, 0, 1 + index),
      open: price * 0.99,
      high: price * 1.02,
      low: price * 0.98,
      close: price,
      volume: 1000 + index,
    });
  }

  return candles;
}

const cashStrategy = {
  name: 'Cash Timeframe Test',
  generateSignal() {
    return {
      label: 'CASH',
      weights: {},
      exposure: 0,
      ranking: [],
      risk: { exposure: 0 },
      reasons: ['Synthetic cash strategy.'],
    };
  },
};

const solStrategy = {
  name: 'SOL Timeframe Test',
  generateSignal() {
    return {
      label: 'SOL 100%',
      weights: { SOLUSDT: 1 },
      exposure: 1,
      ranking: [],
      risk: { exposure: 1 },
      reasons: ['Synthetic SOL strategy.'],
    };
  },
};

function dataset(count, solDrift) {
  return {
    candlesByAsset: {
      BTCUSDT: makeCandles('BTCUSDT', count, 0.0007),
      ETHUSDT: makeCandles('ETHUSDT', count, 0.0008),
      SOLUSDT: makeCandles('SOLUSDT', count, solDrift),
      XRPUSDT: makeCandles('XRPUSDT', count, 0.0004),
    },
  };
}

export function timeframeResearchTestCases() {
  return [
    {
      name: 'Timeframe research rangschikt timeframes met dezelfde tournament-gate',
      run(assert) {
        const result = runTimeframeResearch({
          datasetsByTimeframe: {
            Daily: dataset(380, 0.0003),
            '4H': dataset(380, 0.002),
          },
          plan: {
            Daily: {
              candleTarget: 380,
              walkForwardOptions: {
                trainBars: 260,
                testBars: 60,
                maxFolds: 2,
                grid: {
                  rebalanceBars: [21],
                  emergencyDrawdownStop: [0.3],
                  targetVolatility: [0.1],
                },
              },
            },
            '4H': {
              candleTarget: 380,
              walkForwardOptions: {
                trainBars: 260,
                testBars: 60,
                maxFolds: 2,
                grid: {
                  rebalanceBars: [21],
                  emergencyDrawdownStop: [0.3],
                  targetVolatility: [0.1],
                },
              },
            },
          },
          strategies: [cashStrategy, solStrategy],
        });

        assert(result.rows.length === 2, 'Timeframe research geeft niet beide timeframes terug.');
        assert(result.best.timeframe === '4H', 'Timeframe research kiest niet het sterkste synthetische timeframe.');
        assert(result.best.bestStrategy === 'SOL Timeframe Test', 'Timeframe research bewaart niet de beste strategie.');
        assert(result.message.includes('4H'), 'Timeframe research message noemt het research-spoor niet.');
      },
    },
  ];
}
