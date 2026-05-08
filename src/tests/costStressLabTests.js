import { runCostStressLab } from '../core/costStressLab.js';

function resolveDrift(drift, index, symbol) {
  return typeof drift === 'function' ? drift(index, symbol) : drift;
}

function makeCandles(symbol, count, drift, wave = 0.0004) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 25 : 100;

  for (let index = 0; index < count; index += 1) {
    price *= 1 + resolveDrift(drift, index, symbol) + Math.sin(index / 19) * wave;
    candles.push({
      symbol,
      time: Date.UTC(2024, 0, 1 + index),
      open: price * 0.995,
      high: price * 1.015,
      low: price * 0.985,
      close: price,
      volume: 1000 + index,
    });
  }

  return candles;
}

function makeMarket(count = 260) {
  const drift = (symbol) => {
    if (symbol === 'SOLUSDT') return 0.0032;
    if (symbol === 'ETHUSDT') return 0.0007;
    if (symbol === 'XRPUSDT') return 0.0004;
    return 0.0009;
  };

  return {
    BTCUSDT: makeCandles('BTCUSDT', count, drift('BTCUSDT')),
    ETHUSDT: makeCandles('ETHUSDT', count, drift('ETHUSDT')),
    SOLUSDT: makeCandles('SOLUSDT', count, drift('SOLUSDT')),
    XRPUSDT: makeCandles('XRPUSDT', count, drift('XRPUSDT')),
  };
}

const solStrategy = {
  name: 'Cost Stress SOL',
  generateSignal() {
    return {
      label: 'SOL 100%',
      weights: { SOLUSDT: 1 },
      exposure: 1,
      ranking: [],
      risk: { exposure: 1 },
      reasons: ['Synthetic SOL cost-stress strategy.'],
    };
  },
};

const cashStrategy = {
  name: 'Cost Stress Cash',
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

export function costStressLabTestCases() {
  return [
    {
      name: 'Cost Stress Lab accepteert kandidaat die bij dubbele kosten overeind blijft',
      run(assert) {
        const result = runCostStressLab({
          candlesByAsset: makeMarket(),
          strategy: solStrategy,
          baseConfig: {
            warmupBars: 30,
            initialCapital: 10000,
            feeRate: 0.001,
            slippageRate: 0.0005,
            maxDrawdownTarget: 0.3,
          },
          multipliers: [2],
        });

        assert(result.verdict === 'PASS', 'Sterke synthetische kandidaat moet dubbele kosten overleven.');
        assert(result.worstReturn > 0, 'Kostenstress return moet positief blijven.');
        assert(result.worstProfitFactor >= 1, 'Kostenstress profit factor moet boven break-even blijven.');
      },
    },
    {
      name: 'Cost Stress Lab faalt als strategie bij stijgende markt cash blijft',
      run(assert) {
        const result = runCostStressLab({
          candlesByAsset: makeMarket(),
          strategy: cashStrategy,
          baseConfig: {
            warmupBars: 30,
            initialCapital: 10000,
            feeRate: 0.001,
            slippageRate: 0.0005,
            maxDrawdownTarget: 0.3,
          },
          multipliers: [2],
        });

        assert(result.verdict === 'FAIL', 'Cash in een sterke synthetische markt mag geen groene kostenstress krijgen.');
        assert(result.failed.some((check) => check.id === 'cost-stress-return'), 'Kostenstress moet nul-return blokkeren.');
        assert(result.failed.some((check) => check.id === 'cost-stress-edge'), 'Kostenstress moet benchmark-underperformance blokkeren.');
      },
    },
    {
      name: 'Cost Stress Lab crasht niet zonder marktdata',
      run(assert) {
        const result = runCostStressLab({
          candlesByAsset: {},
          strategy: solStrategy,
          baseConfig: {
            warmupBars: 30,
            initialCapital: 10000,
            feeRate: 0.001,
            slippageRate: 0.0005,
          },
          multipliers: [2],
        });

        assert(result.rows.length === 1, 'Kostenstress moet een veilige rij teruggeven bij ontbrekende data.');
        assert(result.verdict === 'FAIL', 'Ontbrekende data mag geen groene kostenstress krijgen.');
      },
    },
  ];
}
