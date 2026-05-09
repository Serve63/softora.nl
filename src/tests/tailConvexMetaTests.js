import tailConvexMeta from '../strategies/tailConvexMeta.js';

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

const baseConfig = Object.freeze({
  initialCapital: 10000,
  feeRate: 0.001,
  slippageRate: 0.0005,
  scoreThreshold: 65,
  assetCap: 0.45,
  targetVolatility: 0.08,
  rebalanceBars: 90,
});

export function tailConvexMetaTestCases() {
  return [
    {
      name: 'Tail Convex Meta kiest Convex alleen als recente replay-gate open is',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 420, 0.002),
          ETHUSDT: makeCandles('ETHUSDT', 420, 0.0022),
          SOLUSDT: makeCandles('SOLUSDT', 420, 0.003),
          XRPUSDT: makeCandles('XRPUSDT', 420, 0.0018),
        };
        const signal = tailConvexMeta.generateSignal({
          candlesByAsset,
          index: 419,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: baseConfig,
        });

        assert(signal.strategyName === 'Tail Convex Meta v1', 'Meta-strategie naam ontbreekt.');
        assert(signal.meta.selected === 'convex', 'Meta moet Convex kiezen bij groene recente replay.');
        assert(signal.meta.convexGateOpen === true, 'Convex-gate moet open zijn.');
        assert(signal.meta.convexReplay.return > signal.meta.tailReplay.return, 'Convex moet Tail recent verslaan.');
        assert(signal.label.startsWith('CONVEX'), 'Meta-label moet duidelijk maken dat Convex gekozen is.');
      },
    },
    {
      name: 'Tail Convex Meta valt terug op Tail Guard als Convex Tail recent niet verslaat',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 420, (index) => (index < 330 ? 0.0015 : -0.0045)),
          ETHUSDT: makeCandles('ETHUSDT', 420, 0.0022),
          SOLUSDT: makeCandles('SOLUSDT', 420, 0.003),
          XRPUSDT: makeCandles('XRPUSDT', 420, 0.0018),
        };
        const signal = tailConvexMeta.generateSignal({
          candlesByAsset,
          index: 419,
          assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
          config: baseConfig,
        });

        assert(signal.meta.selected === 'tail', 'Meta moet Tail kiezen als Convex-gate dicht is.');
        assert(signal.meta.convexGateOpen === false, 'Convex-gate mag niet open zijn bij zwakkere recente replay.');
        assert(signal.meta.gate.failed.some((check) => check.id === 'beats-tail'), 'Meta moet het Tail-vs-Convex falen tonen.');
        assert(signal.reasons[0].includes('Tail Guard'), 'Meta moet uitleggen waarom Tail basis blijft.');
      },
    },
  ];
}
