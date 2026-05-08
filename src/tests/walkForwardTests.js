import { runRollingWalkForward } from '../core/walkForward.js';

function makeCandles(symbol, count, drift) {
  const candles = [];
  let price = symbol === 'BTCUSDT' ? 100 : 30;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + drift + Math.sin(index / 17) * 0.0015;
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
  name: 'Walk Forward Cash Test',
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

export function walkForwardTestCases() {
  return [
    {
      name: 'Rolling walk-forward optimaliseert alleen op vorige blokken',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 420, 0.0011),
          ETHUSDT: makeCandles('ETHUSDT', 420, 0.0013),
          SOLUSDT: makeCandles('SOLUSDT', 420, 0.0018),
          XRPUSDT: makeCandles('XRPUSDT', 420, 0.0007),
        };
        const result = runRollingWalkForward({
          candlesByAsset,
          trainBars: 260,
          testBars: 60,
          maxFolds: 2,
          grid: {
            rebalanceBars: [21],
            emergencyDrawdownStop: [0.24],
            targetVolatility: [0.1],
          },
        });

        assert(result.ok === true, 'Walk-forward geeft geen geldige run terug.');
        assert(result.folds.length === 2, 'Walk-forward maakt niet het verwachte aantal folds.');
        assert(Number.isFinite(result.summary.strategyCompoundReturn), 'Walk-forward compound return is ongeldig.');
        assert(result.folds.every((fold) => fold.testStart > fold.trainEnd), 'Testblok start niet na trainblok.');
      },
    },
    {
      name: 'Rolling walk-forward gebruikt geen afgekeurde train-config',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 420, 0.0011),
          ETHUSDT: makeCandles('ETHUSDT', 420, 0.0013),
          SOLUSDT: makeCandles('SOLUSDT', 420, 0.0018),
          XRPUSDT: makeCandles('XRPUSDT', 420, 0.0007),
        };
        const result = runRollingWalkForward({
          candlesByAsset,
          strategy: cashStrategy,
          baseConfig: {
            rebalanceBars: 99,
            emergencyDrawdownStop: 0.11,
            targetVolatility: 0.04,
          },
          trainBars: 260,
          testBars: 60,
          maxFolds: 1,
          grid: {
            rebalanceBars: [21],
            emergencyDrawdownStop: [0.24],
            targetVolatility: [0.1],
          },
        });
        const fold = result.folds[0];

        assert(fold.optimizerAccepted === false, 'Afgekeurde train-config mag niet geaccepteerd worden.');
        assert(fold.config.rebalanceBars === 99, 'Walk-forward moet terugvallen op de basisconfig.');
        assert(fold.config.emergencyDrawdownStop === 0.11, 'Walk-forward bewaart de basis drawdown-stop bij optimizer failure.');
        assert(fold.config.targetVolatility === 0.04, 'Walk-forward bewaart de basis volatility target bij optimizer failure.');
      },
    },
  ];
}
