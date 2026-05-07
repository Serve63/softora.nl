import { buildRobustnessGrid, runParameterRobustness } from '../core/robustnessLab.js';

function makeCandles(symbol, count, drift, wave = 0.001) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 25 : 100;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + drift + Math.sin(index / 13) * wave;
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

const solStrategy = {
  name: 'SOL Robustness Test',
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

const cashStrategy = {
  name: 'Cash Robustness Test',
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

export function robustnessLabTestCases() {
  return [
    {
      name: 'Robustness Lab accepteert een stabiele parameterbuurt',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 360, 0.0004),
          ETHUSDT: makeCandles('ETHUSDT', 360, 0.0005),
          SOLUSDT: makeCandles('SOLUSDT', 360, 0.002),
          XRPUSDT: makeCandles('XRPUSDT', 360, 0.0002),
        };
        const result = runParameterRobustness({
          candlesByAsset,
          strategy: solStrategy,
          baseConfig: {
            warmupBars: 80,
            rebalanceBars: 18,
            scoreThreshold: 45,
            targetVolatility: 0.08,
            emergencyDrawdownStop: 0.24,
            assetCap: 1,
          },
          grid: {
            rebalanceBars: [18, 24],
            scoreThreshold: [45],
            targetVolatility: [0.08],
            emergencyDrawdownStop: [0.24],
            assetCap: [1],
          },
        });

        assert(result.tested === 2, 'Robustness Lab test niet de verwachte buurt.');
        assert(result.verdict === 'PASS', 'Robustness Lab keurt stabiele buurt niet goed.');
        assert(result.passRate === 1, 'Robustness Lab rekent pass-rate niet correct.');
        assert(result.checks.every((check) => check.pass), 'Robustness Lab laat een check falen bij stabiele buurt.');
      },
    },
    {
      name: 'Robustness Lab faalt als nabije varianten cash blijven',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 360, 0.0004),
          ETHUSDT: makeCandles('ETHUSDT', 360, 0.0005),
          SOLUSDT: makeCandles('SOLUSDT', 360, 0.002),
          XRPUSDT: makeCandles('XRPUSDT', 360, 0.0002),
        };
        const result = runParameterRobustness({
          candlesByAsset,
          strategy: cashStrategy,
          baseConfig: {
            warmupBars: 80,
            rebalanceBars: 18,
            scoreThreshold: 45,
            targetVolatility: 0.08,
            emergencyDrawdownStop: 0.24,
            assetCap: 1,
          },
          grid: {
            rebalanceBars: [18],
            scoreThreshold: [45],
            targetVolatility: [0.08],
            emergencyDrawdownStop: [0.24],
            assetCap: [1],
          },
        });

        assert(result.verdict === 'FAIL', 'Cash-buurt mag niet door robustness gate.');
        assert(result.passRate === 0, 'Cash-buurt mag geen geslaagde varianten hebben.');
        assert(result.failed.some((check) => check.id === 'robust-pass-rate'), 'Robustness Lab meldt pass-rate failure niet.');
      },
    },
    {
      name: 'Robustness grid maakt een compacte lokale buurt',
      run(assert) {
        const grid = buildRobustnessGrid({
          rebalanceBars: 90,
          scoreThreshold: 65,
          targetVolatility: 0.04,
          emergencyDrawdownStop: 0.2,
          assetCap: 0.45,
        });

        assert(grid.rebalanceBars.includes(60) && grid.rebalanceBars.includes(90) && grid.rebalanceBars.includes(120), 'Robustness grid mist rebalance-buren.');
        assert(grid.scoreThreshold.includes(55) && grid.scoreThreshold.includes(75), 'Robustness grid mist score-buren.');
        assert(grid.targetVolatility.includes(0.03) && grid.targetVolatility.includes(0.05), 'Robustness grid mist vol-buren.');
        assert(grid.emergencyDrawdownStop.includes(0.18) && grid.emergencyDrawdownStop.includes(0.22), 'Robustness grid mist noodrem-buren.');
        assert(grid.assetCap.includes(0.35) && grid.assetCap.includes(0.55), 'Robustness grid mist asset-cap-buren.');
      },
    },
  ];
}
