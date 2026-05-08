import { evaluatePromotionGate } from '../forward/promotionGate.js';
import { createEmptyForwardState, FROZEN_INCUBATION_CANDIDATE } from '../forward/forwardRunner.js';

function makeForwardState({ candidateId = 'candidate', values = [], benchmarkValues = [], gateOpen = true } = {}) {
  const state = createEmptyForwardState(10000, {
    ...FROZEN_INCUBATION_CANDIDATE,
    id: candidateId,
    label: candidateId,
  });
  state.logs = values.map((value, index) => {
    const open = typeof gateOpen === 'function' ? gateOpen(index) : gateOpen;
    return {
      timestamp: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
      dateKey: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      timeframe: '4H',
      paperEquity: value,
      benchmarkEquity: benchmarkValues[index] ?? 10000,
      gateOpen: open,
      signal: open ? 'BTC' : 'CASH',
    };
  });
  state.paperPortfolio = {
    equity: values[values.length - 1] ?? 10000,
    weights: {},
  };
  state.benchmarkPortfolio = {
    equity: benchmarkValues[benchmarkValues.length - 1] ?? 10000,
    weights: {},
  };
  return state;
}

export function promotionGateTestCases() {
  return [
    {
      name: 'Promotion gate wacht zonder watchlist-forward logs',
      run(assert) {
        const review = evaluatePromotionGate({
          championState: makeForwardState({ values: [10000] }),
          challengerState: makeForwardState(),
        });

        assert(review.verdict === 'WAITING', 'Zonder watchlist logs moet promotie wachten.');
        assert(review.autoPromote === false, 'Promotion gate mag nooit automatisch promoveren.');
      },
    },
    {
      name: 'Promotion gate killt watchlist bij vroege drawdown',
      run(assert) {
        const review = evaluatePromotionGate({
          championState: makeForwardState({ values: [10000, 10000, 10000, 10000, 10000] }),
          challengerState: makeForwardState({
            values: [10000, 9800, 9500, 9300, 9000],
            benchmarkValues: [10000, 9900, 9800, 9700, 9600],
          }),
          rules: {
            earlyKillLogs: 5,
            maxDrawdown: 0.08,
            maxLossBeforeKill: -0.06,
          },
        });

        assert(review.verdict === 'KILL_CHALLENGER', 'Vroege drawdown moet watchlist killen.');
        assert(review.failed.some((check) => check.id === 'early-loss-control'), 'Kill mist loss-control failure.');
      },
    },
    {
      name: 'Promotion gate houdt watchlist als edge nog ontbreekt',
      run(assert) {
        const championValues = Array.from({ length: 15 }, (_, index) => 10000 + index * 20);
        const challengerValues = Array.from({ length: 15 }, (_, index) => 10000 + index * 8);
        const review = evaluatePromotionGate({
          championState: makeForwardState({ values: championValues }),
          challengerState: makeForwardState({
            values: challengerValues,
            benchmarkValues: Array.from({ length: 15 }, () => 9900),
          }),
        });

        assert(review.verdict === 'KEEP_WATCHING', 'Ontbrekende edge op kampioen moet watch blijven.');
        assert(review.failed.some((check) => check.id === 'beats-champion'), 'Champion-edge failure ontbreekt.');
      },
    },
    {
      name: 'Promotion gate markeert sterke watchlist als promote-ready',
      run(assert) {
        const championValues = Array.from({ length: 45 }, (_, index) => 10000 + index * 5);
        const challengerValues = Array.from({ length: 45 }, (_, index) => 10000 + index * 18);
        const review = evaluatePromotionGate({
          championState: makeForwardState({ values: championValues }),
          challengerState: makeForwardState({
            values: challengerValues,
            benchmarkValues: Array.from({ length: 45 }, (_, index) => 10000 + index * 3),
            gateOpen: (index) => index % 3 !== 0,
          }),
        });

        assert(review.verdict === 'PROMOTE_READY', 'Sterke watchlist moet promote-ready worden.');
        assert(review.failed.length === 0, 'Promote-ready mag geen actieve failures hebben.');
      },
    },
  ];
}
