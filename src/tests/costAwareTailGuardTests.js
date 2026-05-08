import costAwareTailGuard from '../strategies/costAwareTailGuard.js';

function makeCandles(symbol, count, drift, wave = 0.00045) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 25 : 100;

  for (let index = 0; index < count; index += 1) {
    const activeDrift = typeof drift === 'function' ? drift(index) : drift;
    price *= 1 + activeDrift + Math.sin(index / 23) * wave;
    candles.push({
      symbol,
      time: Date.UTC(2024, 0, 1 + index),
      open: price * 0.997,
      high: price * 1.006,
      low: price * 0.994,
      close: price,
      volume: 1000 + index,
    });
  }

  return candles;
}

export function costAwareTailGuardTestCases() {
  return [
    {
      name: 'Cost Aware Tail Guard geeft alleen beperkte exposure bij sterke trendkwaliteit',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 340, 0.0014),
          ETHUSDT: makeCandles('ETHUSDT', 340, 0.0013),
          SOLUSDT: makeCandles('SOLUSDT', 340, 0.0018),
          XRPUSDT: makeCandles('XRPUSDT', 340, 0.0009),
        };
        const signal = costAwareTailGuard.generateSignal({
          candlesByAsset,
          index: 339,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: {
            scoreThreshold: 70,
            assetCap: 0.45,
            targetVolatility: 0.08,
          },
        });
        const exposure = Object.values(signal.weights).reduce((sum, weight) => sum + weight, 0);

        assert(signal.strategyName === 'Cost Aware Tail Guard v1', 'Cost-aware strategie naam ontbreekt.');
        assert(exposure > 0 && exposure <= 0.421, 'Cost-aware exposure moet conservatief begrensd zijn.');
        assert(Object.values(signal.weights).every((weight) => weight >= 0 && weight <= 0.24), 'Cost-aware asset cap moet stricter zijn dan Tail Guard.');
        assert(signal.ranking.length === 4, 'Cost-aware strategie geeft geen volledige ranking terug.');
      },
    },
    {
      name: 'Cost Aware Tail Guard blijft cash bij zwakke kostenbuffer',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 340, (index) => (index < 300 ? 0.0014 : -0.006)),
          ETHUSDT: makeCandles('ETHUSDT', 340, 0.0012),
          SOLUSDT: makeCandles('SOLUSDT', 340, 0.0016),
          XRPUSDT: makeCandles('XRPUSDT', 340, 0.001),
        };
        const signal = costAwareTailGuard.generateSignal({
          candlesByAsset,
          index: 339,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: { scoreThreshold: 70 },
        });

        assert(signal.exposure === 0, 'Cost-aware strategie moet cash blijven bij te hoge volatility/kostenbuffer.');
      },
    },
  ];
}
