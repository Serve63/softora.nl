import {
  buildProfitFactorLabChecks,
  DEFAULT_PROFIT_FACTOR_GRID,
  DEFAULT_PROFIT_FACTOR_STRATEGIES,
  runProfitFactorLab,
} from '../core/profitFactorLab.js';

function resolveDrift(drift, index, symbol) {
  return typeof drift === 'function' ? drift(index, symbol) : drift;
}

function makeCandles(symbol, count, drift, wave = 0.001) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 25 : 100;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + resolveDrift(drift, index, symbol) + Math.sin(index / 15) * wave;
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

function multiRegimeDrift(symbol) {
  return (index) => {
    if (index < 220) return symbol === 'SOLUSDT' ? 0.0015 : 0.0007;
    if (index < 300) {
      if (symbol === 'SOLUSDT') return -0.001;
      if (symbol === 'ETHUSDT') return -0.005;
      if (symbol === 'XRPUSDT') return -0.006;
      return -0.004;
    }
    if (index < 340) {
      if (symbol === 'SOLUSDT') return 0.006;
      if (symbol === 'ETHUSDT') return 0.003;
      if (symbol === 'XRPUSDT') return 0.002;
      return 0.004;
    }
    if (symbol === 'SOLUSDT') return 0.0015;
    if (symbol === 'ETHUSDT') return -0.0002;
    if (symbol === 'XRPUSDT') return -0.0003;
    return 0.0001;
  };
}

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
          BTCUSDT: makeCandles('BTCUSDT', 380, multiRegimeDrift('BTCUSDT')),
          ETHUSDT: makeCandles('ETHUSDT', 380, multiRegimeDrift('ETHUSDT')),
          SOLUSDT: makeCandles('SOLUSDT', 380, multiRegimeDrift('SOLUSDT')),
          XRPUSDT: makeCandles('XRPUSDT', 380, multiRegimeDrift('XRPUSDT')),
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
          regimeOptions: {
            thresholds: {
              segments: 6,
              bullReturn: 0.08,
              bearReturn: -0.08,
              minCoveredRegimes: 2,
            },
          },
        });

        assert(result.tested === 4, 'Profit Factor Lab test niet het verwachte aantal varianten.');
        assert(result.validated === 2, 'Profit Factor Lab valideert niet de top-kandidaten.');
        assert(result.best.strategyName === 'SOL PF Test', 'Profit Factor Lab kiest niet de sterkste synthetische kandidaat.');
        assert(result.best.rolling?.summary, 'Profit Factor Lab mist rolling summary op de beste kandidaat.');
        assert(result.best.robustness?.verdict === 'PASS', 'Profit Factor Lab mist robustness-validatie op de beste kandidaat.');
        assert(result.best.regime?.verdict === 'PASS', 'Profit Factor Lab mist regime-validatie op de beste kandidaat.');
        assert(result.best.reality?.verdict === 'PASS', 'Profit Factor Lab mist bootstrap reality-check op de beste kandidaat.');
        assert(result.best.checks.some((check) => check.id === 'oos-edge'), 'Profit Factor Lab controleert OOS-edge niet expliciet.');
        assert(result.best.checks.some((check) => check.id === 'current-exposure'), 'Profit Factor Lab controleert actuele exposure niet expliciet.');
        assert(result.best.checks.some((check) => check.id === 'robustness'), 'Profit Factor Lab controleert parameterrobustheid niet expliciet.');
        assert(result.best.checks.some((check) => check.id === 'regime-lab'), 'Profit Factor Lab controleert regime-robuustheid niet expliciet.');
        assert(result.best.checks.some((check) => check.id === 'reality-check'), 'Profit Factor Lab controleert bootstrap reality niet expliciet.');
      },
    },
    {
      name: 'Profit Factor Lab bevat conservatieve 4H PF-preset',
      run(assert) {
        assert(DEFAULT_PROFIT_FACTOR_GRID.rebalanceBars.includes(120), 'PF-grid mist de defensieve 4H rebalance-preset.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.scoreThreshold.includes(70), 'PF-grid mist de defensieve scorefilter.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.targetVolatility.includes(0.02) && DEFAULT_PROFIT_FACTOR_GRID.targetVolatility.includes(0.025), 'PF-grid mist defensieve volatiliteitsdoelstellingen.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.emergencyDrawdownStop.includes(0.08) && DEFAULT_PROFIT_FACTOR_GRID.emergencyDrawdownStop.includes(0.1), 'PF-grid mist de defensieve drawdown-noodremmen.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.assetCap.includes(0.2), 'PF-grid mist defensieve asset cap.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.rebalanceBars.includes(90), 'PF-grid mist de langere 4H rebalance-preset.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.scoreThreshold.includes(65) && DEFAULT_PROFIT_FACTOR_GRID.scoreThreshold.includes(75), 'PF-grid mist de scorefilters.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.targetVolatility.includes(0.03) && DEFAULT_PROFIT_FACTOR_GRID.targetVolatility.includes(0.04), 'PF-grid mist de lage volatiliteitsdoelstellingen.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.emergencyDrawdownStop.includes(0.18) && DEFAULT_PROFIT_FACTOR_GRID.emergencyDrawdownStop.includes(0.2), 'PF-grid mist de strakkere drawdown-noodremmen.');
        assert(DEFAULT_PROFIT_FACTOR_GRID.assetCap.includes(0.35) && DEFAULT_PROFIT_FACTOR_GRID.assetCap.includes(0.45), 'PF-grid mist de asset caps die concentratierisico beperken.');
        assert(DEFAULT_PROFIT_FACTOR_STRATEGIES.some((strategy) => strategy.name === 'Tail Guard v1'), 'PF-lab mist de defensieve Tail Guard strategie.');
      },
    },
    {
      name: 'Profit Factor Lab weigert negatieve rolling winst als kandidaat',
      run(assert) {
        const checks = buildProfitFactorLabChecks({
          strategyReturn: 0.3,
          benchmarkReturn: -0.2,
          oosReturn: 0.08,
          oosBenchmarkReturn: -0.05,
          maxDrawdown: 0.12,
          profitFactor: 2.1,
          currentRiskExposure: 0.7,
          rolling: {
            summary: {
              strategyCompoundReturn: -0.02,
              benchmarkCompoundReturn: -0.4,
              beatRate: 0.8,
              profitableRate: 0.4,
            },
          },
        }, {
          maxDrawdownTarget: 0.3,
          minProfitFactor: 1.65,
          minWalkForwardBeatRate: 0.5,
        }, {
          verdict: 'PASS',
          passRate: 0.5,
          medianProfitFactor: 2,
        });

        const rollingPositive = checks.find((check) => check.id === 'rolling-positive');
        const profitableRate = checks.find((check) => check.id === 'rolling-profitable-rate');

        assert(rollingPositive && rollingPositive.pass === false, 'Negatieve rolling return mag geen kandidaat blijven.');
        assert(profitableRate && profitableRate.pass === false, 'Te weinig winstgevende rolling windows moet falen.');
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
