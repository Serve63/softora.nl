import { DEFAULT_PROFIT_FACTOR_GRID, runProfitFactorLab } from '../core/profitFactorLab.js';

function makeCandles(symbol, count, drift, wave = 0.001) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 25 : 100;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + drift + Math.sin(index / 15) * wave;
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
  name: 'SOL PF Test',
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
  name: 'Cash PF Test',
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

export function profitFactorLabTestCases() {
  return [
    {
      name: 'Profit Factor Lab valideert top-kandidaten met rolling check',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 380, 0.0007),
          ETHUSDT: makeCandles('ETHUSDT', 380, 0.0008),
          SOLUSDT: makeCandles('SOLUSDT', 380, 0.002),
          XRPUSDT: makeCandles('XRPUSDT', 380, 0.0004),
        };
        const result = runProfitFactorLab({
          candlesByAsset,
          strategies: [cashStrategy, solStrategy],
          grid: {
            rebalanceBars: [18, 30],
            scoreThreshold: [45],
            targetVolatility: [0.08],
            emergencyDrawdownStop: [0.24],
          },
          topN: 2,
          walkForwardOptions: {
            trainBars: 260,
            testBars: 60,
            maxFolds: 2,
          },
        });

        assert(result.tested === 4, 'Profit Factor Lab test niet het verwachte aantal varianten.');
        assert(result.validated === 2, 'Profit Factor Lab valideert niet de top-kandidaten.');
        assert(result.best.strategyName === 'SOL PF Test', 'Profit Factor Lab kiest niet de sterkste synthetische kandidaat.');
        assert(result.best.rolling?.summary, 'Profit Factor Lab mist rolling summary op de beste kandidaat.');
        assert(result.best.checks.some((check) => check.id === 'oos-edge'), 'Profit Factor Lab controleert OOS-edge niet expliciet.');
        assert(result.best.checks.some((check) => check.id === 'current-exposure'), 'Profit Factor Lab controleert actuele exposure niet expliciet.');
      },
    },
    {
      name: 'Profit Factor Lab bevat conservatieve 4H PF-preset',
      run(assert) {
        assert(DEFAULT_PROFIT_FACTOR_GRID.rebalanceBars.includes(90), 'PF-grid mist de langere 4H rebalance-preset.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.scoreThreshold.includes(75), 'PF-grid mist de strengere scorefilter.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.targetVolatility.includes(0.04), 'PF-grid mist de lagere volatiliteitsdoelstelling.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.emergencyDrawdownStop.includes(0.2), 'PF-grid mist de strakkere drawdown-noodrem.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.assetCap.includes(0.45), 'PF-grid mist de asset cap die concentratierisico beperkt.');
      },
    },
    {
      name: 'Profit Factor Lab crasht niet zonder marktdata',
      run(assert) {
        const result = runProfitFactorLab({
          candlesByAsset: {},
          strategies: [solStrategy],
          grid: {
            rebalanceBars: [18],
            scoreThreshold: [45],
            targetVolatility: [0.08],
            emergencyDrawdownStop: [0.24],
          },
          topN: 1,
          walkForwardOptions: {
            trainBars: 260,
            testBars: 60,
            maxFolds: 1,
          },
        });

        assert(result.rows.length === 1, 'Profit Factor Lab geeft geen veilige rij terug bij ontbrekende data.');
        assert(result.best.verdict === 'REJECT', 'Ontbrekende data mag geen kandidaat opleveren.');
      },
    },
  ];
}
