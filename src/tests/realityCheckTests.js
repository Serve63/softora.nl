import { runRealityCheck } from '../core/realityCheck.js';

function point(index, value) {
  return {
    time: Date.UTC(2026, 0, 1 + index),
    value,
  };
}

function makeResult(strategyValues, benchmarkValues) {
  return {
    ok: true,
    equityCurve: strategyValues.map((value, index) => point(index, value)),
    benchmarkCurve: benchmarkValues.map((value, index) => point(index, value)),
  };
}

export function realityCheckTestCases() {
  return [
    {
      name: 'Reality Check accepteert edge die na bootstrap overeind blijft',
      run(assert) {
        const review = runRealityCheck({
          result: makeResult(
            [10000, 10300, 10600, 10900, 11200, 11600, 12000, 12500, 13000],
            [10000, 10100, 10200, 10300, 10400, 10500, 10600, 10700, 10800],
          ),
          thresholds: {
            segments: 8,
            samples: 120,
            minPositiveEdgeRate: 0.8,
            minFifthPercentileEdge: 0,
          },
        });

        assert(review.verdict === 'PASS', 'Sterke bootstrap edge moet slagen.');
        assert(review.positiveEdgeRate === 1, 'Alle bootstrap samples moeten positive edge houden.');
        assert(review.checks.some((check) => check.id === 'reality-left-tail'), 'Left-tail check ontbreekt.');
      },
    },
    {
      name: 'Reality Check faalt als edge vooral uit enkele lucky segmenten komt',
      run(assert) {
        const review = runRealityCheck({
          result: makeResult(
            [10000, 7200, 6900, 6700, 6500, 13000, 12600, 12300, 12100],
            [10000, 9800, 9600, 9400, 9200, 9400, 9600, 9800, 10000],
          ),
          thresholds: {
            segments: 8,
            samples: 160,
            minPositiveEdgeRate: 0.65,
            minMedianEdge: 0,
            minMedianStrategyReturn: 0,
          },
        });

        assert(review.verdict === 'FAIL', 'Lucky-segment edge mag niet slagen.');
        assert(review.failed.some((check) => check.id === 'reality-positive-edge-rate' || check.id === 'reality-median-return'), 'Reality failure ontbreekt.');
      },
    },
    {
      name: 'Reality Check crasht niet zonder geldige equity curves',
      run(assert) {
        const review = runRealityCheck({ result: { ok: false, error: 'Geen data.' } });

        assert(review.verdict === 'FAIL', 'Ongeldige curves mogen geen pass geven.');
        assert(review.error.includes('Geen data'), 'Reality check moet de foutmelding bewaren.');
      },
    },
  ];
}
