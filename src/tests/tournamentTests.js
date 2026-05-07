import { runStrategyTournament } from '../core/strategyTournament.js';

function makeTrendCandles(symbol, count, dailyDrift, wave = 0.0015) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 20 : 100;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + dailyDrift + Math.sin(index / 13) * wave;
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

const alwaysSolStrategy = {
  name: 'Always SOL Test',
  generateSignal() {
    return {
      label: 'SOL 100%',
      weights: { SOLUSDT: 1 },
      exposure: 1,
      ranking: [],
      risk: { exposure: 1 },
      reasons: ['Synthetic test strategy.'],
    };
  },
};

const alwaysCashStrategy = {
  name: 'Always Cash Test',
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

export function tournamentTestCases() {
  return [
    {
      name: 'Strategy tournament rangschikt strategie-families op rolling edge',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeTrendCandles('BTCUSDT', 380, 0.0008),
          ETHUSDT: makeTrendCandles('ETHUSDT', 380, 0.001),
          SOLUSDT: makeTrendCandles('SOLUSDT', 380, 0.0022),
          XRPUSDT: makeTrendCandles('XRPUSDT', 380, 0.0006),
        };
        const tournament = runStrategyTournament({
          candlesByAsset,
          strategies: [alwaysCashStrategy, alwaysSolStrategy],
          walkForwardOptions: {
            trainBars: 260,
            testBars: 60,
            maxFolds: 2,
            grid: {
              rebalanceBars: [21],
              emergencyDrawdownStop: [0.3],
              targetVolatility: [0.1],
            },
          },
          baseConfig: {
            minProfitFactor: 1.2,
          },
        });

        assert(tournament.rows.length === 2, 'Tournament geeft niet alle strategieen terug.');
        assert(tournament.best.strategyName === 'Always SOL Test', 'Tournament kiest niet de sterkste synthetische strategie.');
        assert(tournament.best.rolling.strategyCompoundReturn > tournament.best.rolling.benchmarkCompoundReturn, 'Rolling edge wordt niet correct gemeten.');
        assert(tournament.best.checks.some((check) => check.id === 'rolling-edge'), 'Tournament mist rolling-edge check.');
      },
    },
    {
      name: 'Strategy tournament crasht niet zonder marktdata',
      run(assert) {
        const tournament = runStrategyTournament({
          candlesByAsset: {},
          strategies: [alwaysSolStrategy],
          walkForwardOptions: {
            trainBars: 260,
            testBars: 60,
            maxFolds: 1,
          },
        });

        assert(tournament.rows.length === 1, 'Tournament geeft geen veilige rij terug bij ontbrekende data.');
        assert(tournament.best.verdict === 'REJECT', 'Ontbrekende data mag geen geldig verdict opleveren.');
      },
    },
  ];
}
