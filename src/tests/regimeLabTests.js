import { runRegimeBreakdown } from '../core/regimeLab.js';

function point(index, value) {
  return {
    time: Date.UTC(2026, 0, 1 + index),
    value,
  };
}

function btcCandle(index, close) {
  return {
    symbol: 'BTCUSDT',
    time: Date.UTC(2026, 0, 1 + index),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  };
}

function makeResult(strategyValues, benchmarkValues) {
  return {
    ok: true,
    equityCurve: strategyValues.map((value, index) => point(index, value)),
    benchmarkCurve: benchmarkValues.map((value, index) => point(index, value)),
  };
}

export function regimeLabTestCases() {
  return [
    {
      name: 'Regime Lab accepteert kandidaat die meerdere BTC-regimes verslaat',
      run(assert) {
        const result = runRegimeBreakdown({
          candlesByAsset: {
            BTCUSDT: [100, 90, 81, 82, 100, 108, 108].map((value, index) => btcCandle(index, value)),
          },
          result: makeResult(
            [10000, 9900, 9800, 9950, 10800, 11700, 11900],
            [10000, 9300, 8700, 8800, 9700, 10400, 10450],
          ),
          thresholds: {
            segments: 6,
            bullReturn: 0.08,
            bearReturn: -0.08,
            minCoveredRegimes: 3,
          },
        });

        assert(result.verdict === 'PASS', 'Sterke multi-regime kandidaat moet slagen.');
        assert(result.coveredRegimes === 3, 'Regime Lab moet bull, bear en sideways herkennen.');
        assert(result.checks.some((check) => check.id === 'regime-bear-defense'), 'Bear-defense check ontbreekt.');
      },
    },
    {
      name: 'Regime Lab faalt als bear-regime te hard achterblijft',
      run(assert) {
        const result = runRegimeBreakdown({
          candlesByAsset: {
            BTCUSDT: [100, 88, 78, 80, 96, 106, 106].map((value, index) => btcCandle(index, value)),
          },
          result: makeResult(
            [10000, 8600, 7000, 7200, 7800, 8300, 8350],
            [10000, 9400, 9000, 9100, 9700, 10400, 10400],
          ),
          thresholds: {
            segments: 6,
            bullReturn: 0.08,
            bearReturn: -0.08,
            maxBearUnderperformance: 0.03,
            maxBearDrawdown: 0.12,
          },
        });

        assert(result.verdict === 'FAIL', 'Slechte bear-defense mag niet door de regime gate.');
        assert(result.failed.some((check) => check.id === 'regime-bear-defense'), 'Bear-underperformance failure ontbreekt.');
        assert(result.failed.some((check) => check.id === 'regime-bear-drawdown'), 'Bear-drawdown failure ontbreekt.');
      },
    },
    {
      name: 'Regime Lab crasht niet zonder BTC data',
      run(assert) {
        const result = runRegimeBreakdown({
          candlesByAsset: {},
          result: makeResult([10000, 10100], [10000, 10050]),
        });

        assert(result.verdict === 'FAIL', 'Ontbrekende BTC data mag geen regime-pass opleveren.');
        assert(result.error.includes('BTCUSDT'), 'Foutmelding moet BTC data benoemen.');
      },
    },
  ];
}
