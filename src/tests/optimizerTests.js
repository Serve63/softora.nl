import { optimizeStrategy } from '../core/optimizer.js';

function makeTrendCandles(symbol, count, dailyDrift, wave = 0.002) {
  const candles = [];
  let price = symbol === 'BTCUSDT' ? 100 : 20;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + dailyDrift + Math.sin(index / 14) * wave;
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

export function optimizerTestCases() {
  return [
    {
      name: 'Optimizer rangschikt kandidaat-instellingen',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeTrendCandles('BTCUSDT', 340, 0.0012),
          ETHUSDT: makeTrendCandles('ETHUSDT', 340, 0.0016),
          SOLUSDT: makeTrendCandles('SOLUSDT', 340, 0.0021),
          XRPUSDT: makeTrendCandles('XRPUSDT', 340, 0.0008),
        };
        const result = optimizeStrategy({
          candlesByAsset,
          grid: {
            rebalanceBars: [21, 30],
            emergencyDrawdownStop: [0.24],
            targetVolatility: [0.09],
          },
          stressTop: 1,
        });

        assert(result.tested === 2, 'Optimizer test niet het verwachte aantal configuraties.');
        assert(result.best, 'Optimizer geeft geen beste kandidaat terug.');
        assert(result.candidates.length === 1, 'Optimizer stresstest niet de juiste top-kandidaten.');
        assert(Number.isFinite(result.best.score), 'Optimizer score is geen geldig getal.');
      },
    },
  ];
}
