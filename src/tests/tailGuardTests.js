import tailGuard from '../strategies/tailGuard.js';

function makeCandles(symbol, count, drift, wave = 0.0008) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 25 : 100;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + drift + Math.sin(index / 17) * wave;
    candles.push({
      symbol,
      time: Date.UTC(2024, 0, 1 + index),
      open: price * 0.995,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000 + index,
    });
  }

  return candles;
}

export function tailGuardTestCases() {
  return [
    {
      name: 'Tail Guard geeft defensieve long-only exposure bij gezonde macro',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 300, 0.001),
          ETHUSDT: makeCandles('ETHUSDT', 300, 0.0011),
          SOLUSDT: makeCandles('SOLUSDT', 300, 0.0014),
          XRPUSDT: makeCandles('XRPUSDT', 300, 0.0007),
        };
        const signal = tailGuard.generateSignal({
          candlesByAsset,
          index: 299,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: {
            scoreThreshold: 62,
            assetCap: 0.45,
            targetVolatility: 0.08,
          },
        });
        const exposure = Object.values(signal.weights).reduce((sum, weight) => sum + weight, 0);

        assert(signal.strategyName === 'Tail Guard v1', 'Tail Guard naam ontbreekt.');
        assert(exposure > 0 && exposure <= 0.551, 'Tail Guard exposure moet defensief begrensd zijn.');
        assert(Object.values(signal.weights).every((weight) => weight >= 0 && weight <= 0.3), 'Tail Guard respecteert long-only asset cap niet.');
        assert(signal.ranking.length === 4, 'Tail Guard geeft geen volledige ranking terug.');
      },
    },
    {
      name: 'Tail Guard blijft cash als BTC macro of drawdown zwak is',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 300, -0.001),
          ETHUSDT: makeCandles('ETHUSDT', 300, 0.001),
          SOLUSDT: makeCandles('SOLUSDT', 300, 0.0012),
          XRPUSDT: makeCandles('XRPUSDT', 300, 0.0008),
        };
        const weakMacro = tailGuard.generateSignal({
          candlesByAsset,
          index: 299,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: { scoreThreshold: 62 },
        });
        const emergencyStop = tailGuard.generateSignal({
          candlesByAsset: {
            ...candlesByAsset,
            BTCUSDT: makeCandles('BTCUSDT', 300, 0.001),
          },
          index: 299,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: { emergencyDrawdownStop: 0.18, scoreThreshold: 62 },
          currentDrawdown: 0.17,
        });

        assert(weakMacro.exposure === 0, 'Tail Guard moet cash blijven bij zwakke BTC macro.');
        assert(emergencyStop.exposure === 0, 'Tail Guard moet cash blijven bij defensieve drawdown-stop.');
      },
    },
  ];
}
