import sprintRotation from '../strategies/sprintRotation.js';

function makeCandles(symbol, count, drift, jumpEvery = 0) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 20 : 100;

  for (let index = 0; index < count; index += 1) {
    const jump = jumpEvery > 0 && index > 0 && index % jumpEvery === 0 ? 0.045 : 0;
    price *= 1 + drift + jump + Math.sin(index / 11) * 0.0015;
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

export function sprintRotationTestCases() {
  return [
    {
      name: 'Sprint Rotation geeft geldige long-only weights',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 280, 0.0012),
          ETHUSDT: makeCandles('ETHUSDT', 280, 0.001),
          SOLUSDT: makeCandles('SOLUSDT', 280, 0.002, 28),
          XRPUSDT: makeCandles('XRPUSDT', 280, 0.0006),
        };
        const signal = sprintRotation.generateSignal({
          candlesByAsset,
          index: 279,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: {},
          currentDrawdown: 0,
        });
        const exposure = Object.values(signal.weights).reduce((sum, weight) => sum + weight, 0);

        assert(signal.strategyName === 'Sprint Rotation v1', 'Sprint Rotation naam ontbreekt.');
        assert(exposure >= 0 && exposure <= 1, 'Sprint Rotation exposure valt buiten long-only bereik.');
        assert(Object.values(signal.weights).every((weight) => weight >= 0), 'Sprint Rotation maakt short weights.');
        assert(signal.ranking.length === 4, 'Sprint Rotation geeft geen volledige ranking terug.');
      },
    },
    {
      name: 'Sprint Rotation gaat cash bij drawdown-noodrem',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 280, 0.0012),
          ETHUSDT: makeCandles('ETHUSDT', 280, 0.001),
          SOLUSDT: makeCandles('SOLUSDT', 280, 0.002, 28),
          XRPUSDT: makeCandles('XRPUSDT', 280, 0.0006),
        };
        const signal = sprintRotation.generateSignal({
          candlesByAsset,
          index: 279,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: { emergencyDrawdownStop: 0.24 },
          currentDrawdown: 0.25,
        });

        assert(signal.exposure === 0, 'Sprint Rotation sluit niet bij drawdown-noodrem.');
        assert(Object.keys(signal.weights).length === 0, 'Sprint Rotation houdt weights na noodrem.');
      },
    },
  ];
}
