import convexBreakout from '../strategies/convexBreakout.js';

function makeCandles(symbol, count, drift, wave = 0.00065) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 25 : 100;

  for (let index = 0; index < count; index += 1) {
    const activeDrift = typeof drift === 'function' ? drift(index, symbol) : drift;
    price *= 1 + activeDrift + Math.sin(index / 19) * wave;
    candles.push({
      symbol,
      time: Date.UTC(2024, 0, 1 + index),
      open: price * 0.996,
      high: price * 1.008,
      low: price * 0.992,
      close: price,
      volume: 1200 + index,
    });
  }

  return candles;
}

export function convexBreakoutTestCases() {
  return [
    {
      name: 'Convex Breakout neemt gecontroleerde long-only exposure bij gezonde breakout-markt',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 360, 0.002),
          ETHUSDT: makeCandles('ETHUSDT', 360, 0.0022),
          SOLUSDT: makeCandles('SOLUSDT', 360, 0.003),
          XRPUSDT: makeCandles('XRPUSDT', 360, 0.0018),
        };
        const signal = convexBreakout.generateSignal({
          candlesByAsset,
          index: 359,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: {
            scoreThreshold: 65,
            assetCap: 0.45,
            targetVolatility: 0.08,
            rebalanceBars: 90,
          },
        });
        const exposure = Object.values(signal.weights).reduce((sum, weight) => sum + weight, 0);

        assert(signal.strategyName === 'Convex Breakout v1', 'Convex Breakout naam ontbreekt.');
        assert(exposure > 0 && exposure <= 0.721, 'Convex Breakout exposure moet gecontroleerd blijven.');
        assert(Object.values(signal.weights).every((weight) => weight >= 0 && weight <= 0.42), 'Convex Breakout moet long-only asset caps respecteren.');
        assert(signal.ranking.length === 4, 'Convex Breakout geeft geen volledige ranking terug.');
        assert(signal.reasons.some((reason) => reason.includes('Fast BTC filter groen')), 'Gezonde BTC-filter reden ontbreekt.');
      },
    },
    {
      name: 'Convex Breakout blijft cash als BTC fast-risk breekt',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 360, (index) => (index < 285 ? 0.0015 : -0.0045)),
          ETHUSDT: makeCandles('ETHUSDT', 360, 0.0017),
          SOLUSDT: makeCandles('SOLUSDT', 360, 0.0023),
          XRPUSDT: makeCandles('XRPUSDT', 360, 0.0012),
        };
        const signal = convexBreakout.generateSignal({
          candlesByAsset,
          index: 359,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: {
            scoreThreshold: 65,
            rebalanceBars: 90,
          },
        });

        assert(signal.exposure === 0, 'Convex Breakout moet cash blijven bij BTC trendbreuk.');
        assert(signal.reasons.some((reason) => reason.includes('Fast BTC filter sluit exposure')), 'Risk-off reden ontbreekt.');
      },
    },
    {
      name: 'Convex Breakout blijft cash bij diepe paper drawdown',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 360, 0.0015),
          ETHUSDT: makeCandles('ETHUSDT', 360, 0.0017),
          SOLUSDT: makeCandles('SOLUSDT', 360, 0.0023),
          XRPUSDT: makeCandles('XRPUSDT', 360, 0.0012),
        };
        const signal = convexBreakout.generateSignal({
          candlesByAsset,
          index: 359,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: {
            emergencyDrawdownStop: 0.18,
            scoreThreshold: 65,
            rebalanceBars: 90,
          },
          currentDrawdown: 0.17,
        });

        assert(signal.exposure === 0, 'Convex Breakout moet cash blijven bij diepe drawdown.');
      },
    },
  ];
}
