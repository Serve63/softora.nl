import { runReplayVariantLab } from '../forward/replayVariantLab.js';

function makeCandles(symbol, count, drift = 0.001) {
  const candles = [];
  let price = symbol === 'BTCUSDT' ? 100 : 50;
  for (let index = 0; index < count; index += 1) {
    const activeDrift = typeof drift === 'function' ? drift(index) : drift;
    price *= 1 + activeDrift + Math.sin(index / 13) * 0.0002;
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

function makeVolTargetStrategy() {
  return {
    name: 'Replay Variant Lab Test',
    generateSignal({ config }) {
      const weight = config.targetVolatility >= 0.03 ? 0.6 : 0.2;
      return {
        label: `BTC ${(weight * 100).toFixed(0)}%`,
        weights: { BTCUSDT: weight },
        exposure: weight,
        reasons: ['test'],
      };
    },
  };
}

export function replayVariantLabTestCases() {
  return [
    {
      name: 'Replay variant lab kiest betere multi-window variant',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 520, 0.001),
          ETHUSDT: makeCandles('ETHUSDT', 520, -0.001),
        };
        const lab = runReplayVariantLab({
          candlesByAsset,
          strategy: makeVolTargetStrategy(),
          assets: ['BTCUSDT', 'ETHUSDT'],
          baseConfig: {
            initialCapital: 10000,
            feeRate: 0,
            slippageRate: 0,
            warmupBars: 20,
            targetVolatility: 0.02,
            rebalanceBars: 120,
            emergencyDrawdownStop: 0.08,
          },
          grid: {
            targetVolatility: [0.02, 0.03],
            rebalanceBars: [120],
            emergencyDrawdownStop: [0.08],
          },
          windowCount: 3,
          windowLogs: 20,
          replayRules: { minLogs: 10, minGateOpenRate: 0.1 },
          multiWindowRules: { minWindows: 3, minPositiveRate: 0.5, minBeatRate: 0.5 },
          rules: { minScoreLift: 0.02 },
        });

        assert(lab.verdict === 'IMPROVES', 'Lab moet een betere variant vinden.');
        assert(lab.best.config.targetVolatility === 0.03, 'Lab moet de sterkere variant kiezen.');
      },
    },
    {
      name: 'Replay variant lab houdt baseline als varianten slechter zijn',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 520, (index) => (index < 390 ? 0.001 : -0.006)),
          ETHUSDT: makeCandles('ETHUSDT', 520, -0.001),
        };
        const lab = runReplayVariantLab({
          candlesByAsset,
          strategy: makeVolTargetStrategy(),
          assets: ['BTCUSDT', 'ETHUSDT'],
          baseConfig: {
            initialCapital: 10000,
            feeRate: 0,
            slippageRate: 0,
            warmupBars: 20,
            targetVolatility: 0.02,
            rebalanceBars: 120,
            emergencyDrawdownStop: 0.08,
          },
          grid: {
            targetVolatility: [0.02, 0.03],
            rebalanceBars: [120],
            emergencyDrawdownStop: [0.08],
          },
          windowCount: 3,
          windowLogs: 20,
          replayRules: { minLogs: 10, minGateOpenRate: 0.1, maxLossBeforeFail: -0.04 },
          multiWindowRules: { minWindows: 3, maxWorstReturn: -0.04, maxWorstDrawdown: 0.04 },
          rules: { minScoreLift: 0.02, maxWorstReturnWorsening: 0.005 },
        });

        assert(lab.verdict !== 'IMPROVES', 'Lab mag geen slechtere variant promoveren.');
        assert(lab.baseline.signature !== undefined, 'Lab moet baseline bewaren.');
      },
    },
  ];
}
