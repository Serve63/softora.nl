import {
  appendImprovementReview,
  createEmptyImprovementState,
  createImprovementReview,
} from '../core/improvementLoop.js';

const championCandidate = {
  id: 'champion-v1',
  label: 'Champion v1',
  strategyName: 'Trend Participation v1',
  config: {
    timeframe: '4H',
    guardMode: 'Strict',
    maxDrawdownTarget: 0.3,
    minProfitFactor: 1.65,
    scoreThreshold: 65,
    assetCap: 0.35,
    rebalanceBars: 90,
    emergencyDrawdownStop: 0.18,
    targetVolatility: 0.03,
  },
};

function makeBacktest(overrides = {}) {
  return {
    strategyName: championCandidate.strategyName,
    strategyReturn: 0.44,
    benchmarkReturn: -0.1,
    oosReturn: 0.08,
    oosBenchmarkReturn: -0.06,
    maxDrawdown: 0.14,
    profitFactor: 2.2,
    trades: 18,
    currentSignal: { label: 'BTC 30% / ETH 20%' },
    ...overrides,
  };
}

function makeLabCandidate(overrides = {}) {
  return {
    strategyName: 'Sprint Rotation v1',
    verdict: 'CANDIDATE',
    config: {
      ...championCandidate.config,
      scoreThreshold: 75,
      assetCap: 0.45,
    },
    strategyReturn: 0.62,
    benchmarkReturn: -0.1,
    edge: 0.72,
    oosReturn: 0.16,
    oosBenchmarkReturn: -0.06,
    maxDrawdown: 0.15,
    profitFactor: 2.45,
    trades: 24,
    currentRiskExposure: 0.72,
    currentSignal: { label: 'BTC 35% / SOL 30%' },
    rolling: {
      summary: {
        strategyCompoundReturn: 0.24,
        benchmarkCompoundReturn: -0.03,
        beatRate: 0.8,
        maxFoldDrawdown: 0.13,
      },
    },
    robustness: {
      verdict: 'PASS',
      passRate: 0.5,
      medianProfitFactor: 2,
      medianEdge: 0.2,
      medianOosEdge: 0.08,
      worstDrawdown: 0.17,
    },
    regime: {
      verdict: 'PASS',
      testedSegments: 6,
      coveredRegimes: 3,
      segmentBeatRate: 0.83,
      worstSegmentEdge: -0.02,
      bearUnderperformance: 0,
      failed: [],
    },
    reality: {
      verdict: 'PASS',
      segmentCount: 12,
      positiveEdgeRate: 0.82,
      medianEdge: 0.18,
      fifthPercentileEdge: -0.04,
      medianStrategyReturn: 0.2,
      failed: [],
    },
    statistical: {
      verdict: 'PASS',
      trialCount: 64,
      observations: 260,
      sharpe: 1.4,
      edgeSharpe: 1.1,
      trialPenalty: 0.35,
      deflatedSharpe: 1.05,
      failed: [],
    },
    costStress: {
      verdict: 'PASS',
      worstReturn: 0.21,
      worstEdge: 0.13,
      worstDrawdown: 0.14,
      worstProfitFactor: 2.12,
      maxFeesPaid: 120,
      maxSlippagePaid: 60,
      failed: [],
    },
    failed: [],
    ...overrides,
  };
}

export function improvementLoopTestCases() {
  return [
    {
      name: 'Improvement loop houdt kampioen als uitdager niet duidelijk beter is',
      run(assert) {
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest(),
          lab: {
            candidate: makeLabCandidate({
              strategyName: championCandidate.strategyName,
              config: championCandidate.config,
              strategyReturn: 0.44,
              oosReturn: 0.08,
              maxDrawdown: 0.14,
              profitFactor: 2.2,
            }),
          },
        });

        assert(review.action === 'KEEP_CHAMPION', 'De loop mag dezelfde kandidaat niet als verbetering promoveren.');
        assert(review.failed.some((check) => check.id === 'not-same-candidate'), 'De loop moet dezelfde config herkennen.');
      },
    },
    {
      name: 'Improvement loop markeert sterke uitdager alleen voor incubatie',
      run(assert) {
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest(),
          lab: {
            candidate: makeLabCandidate(),
          },
        });

        assert(review.action === 'INCUBATE_CHALLENGER', 'Sterke uitdager moet naar aparte incubatie.');
        assert(review.autoPromote === false, 'De loop mag nooit automatisch de kampioen vervangen.');
        assert(review.checks.every((check) => check.pass), 'Sterke uitdager moet alle improvement checks halen.');
      },
    },
    {
      name: 'Improvement loop logt geen dubbele review per dag',
      run(assert) {
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest(),
          lab: {
            candidate: makeLabCandidate(),
          },
        });
        const state = createEmptyImprovementState({ championId: championCandidate.id });
        const first = appendImprovementReview({ state, review });
        const second = appendImprovementReview({ state: first.state, review });

        assert(first.skipped === false, 'Eerste improvement review moet bewaard worden.');
        assert(second.skipped === true, 'Tweede review op dezelfde dag moet worden overgeslagen.');
        assert(second.state.reviews.length === 1, 'Dubbele review mag de historie niet vervuilen.');
      },
    },
    {
      name: 'Improvement loop bewaart watchlist-uitdager zonder promotie',
      run(assert) {
        const watch = makeLabCandidate({
          verdict: 'WATCH',
          strategyName: 'Defensive Watch v1',
          strategyReturn: 0.09,
          oosReturn: -0.02,
          maxDrawdown: 0.08,
          profitFactor: 1.71,
          currentSignal: { label: 'BTC 20%' },
          rolling: {
            summary: {
              strategyCompoundReturn: -0.12,
              benchmarkCompoundReturn: -0.5,
              beatRate: 0.6,
              maxFoldDrawdown: 0.1,
            },
          },
          robustness: {
            verdict: 'WATCH',
            passRate: 0.3,
            medianProfitFactor: 1.4,
            medianEdge: 0.1,
            medianOosEdge: 0.05,
            worstDrawdown: 0.16,
          },
          failed: [
            { id: 'rolling-positive' },
            { id: 'robustness' },
          ],
        });
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest({ strategyReturn: -0.18, profitFactor: 0 }),
          lab: { candidate: null, watch },
        });
        const state = createEmptyImprovementState({ championId: championCandidate.id });
        const logged = appendImprovementReview({ state, review });

        assert(review.action === 'WATCH_CHALLENGER', 'Watchlist-uitdager moet apart zichtbaar blijven.');
        assert(review.challenger.source === 'watch', 'Watchlist bron moet bewaard blijven.');
        assert(logged.state.pendingChallenger === null, 'Watchlist mag geen pending promotie worden.');
        assert(logged.state.watchlistChallenger?.strategyName === 'Defensive Watch v1', 'Watchlist-uitdager wordt niet opgeslagen.');
      },
    },
    {
      name: 'Improvement loop ververst watchlist-status bij dubbele dagreview',
      run(assert) {
        const watch = makeLabCandidate({
          verdict: 'WATCH',
          strategyName: 'Duplicate Watch v1',
          failed: [{ id: 'rolling-positive' }],
        });
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest({ strategyReturn: -0.18, profitFactor: 0 }),
          lab: { candidate: null, watch },
        });
        const staleState = {
          ...createEmptyImprovementState({ championId: championCandidate.id }),
          reviews: [{
            id: review.id,
            dateKey: review.dateKey,
            timestamp: review.timestamp,
            timeframe: review.timeframe,
            action: 'KEEP_CHAMPION',
          }],
          watchlistChallenger: null,
        };
        const logged = appendImprovementReview({ state: staleState, review });

        assert(logged.skipped === true, 'Dubbele dagreview moet geen extra review toevoegen.');
        assert(logged.state.reviews.length === 1, 'Dubbele dagreview mag de reviewlijst niet verlengen.');
        assert(logged.state.watchlistChallenger?.strategyName === 'Duplicate Watch v1', 'Dubbele dagreview moet watchlist-status wel verversen.');
      },
    },
    {
      name: 'Improvement loop blokkeert uitdager als reality check faalt',
      run(assert) {
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest(),
          lab: {
            candidate: makeLabCandidate({
              reality: {
                verdict: 'FAIL',
                segmentCount: 12,
                positiveEdgeRate: 0.42,
                medianEdge: -0.03,
                fifthPercentileEdge: -0.22,
                medianStrategyReturn: -0.02,
                failed: [{ id: 'reality-positive-edge-rate' }],
              },
            }),
          },
        });

        assert(review.action === 'WATCH_CHALLENGER', 'Reality failure mag geen directe incubatie geven.');
        assert(review.failed.some((check) => check.id === 'reality-quality'), 'Reality-quality failure ontbreekt.');
      },
    },
    {
      name: 'Improvement loop blokkeert uitdager als trial-ledger faalt',
      run(assert) {
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest(),
          lab: {
            candidate: makeLabCandidate({
              statistical: {
                verdict: 'FAIL',
                trialCount: 500,
                observations: 180,
                sharpe: 0.4,
                edgeSharpe: -0.1,
                trialPenalty: 1.1,
                deflatedSharpe: -0.7,
                failed: [{ id: 'trial-deflated-sharpe' }],
              },
            }),
          },
        });

        assert(review.action === 'WATCH_CHALLENGER', 'Trial-ledger failure mag geen directe incubatie geven.');
        assert(review.failed.some((check) => check.id === 'statistical-proof'), 'Statistical-proof failure ontbreekt.');
      },
    },
    {
      name: 'Improvement loop blokkeert uitdager als kostenstress faalt',
      run(assert) {
        const review = createImprovementReview({
          asOf: Date.UTC(2026, 4, 8),
          timeframe: '4H',
          championCandidate,
          championBacktest: makeBacktest(),
          lab: {
            candidate: makeLabCandidate({
              costStress: {
                verdict: 'FAIL',
                worstReturn: -0.04,
                worstEdge: -0.16,
                worstDrawdown: 0.18,
                worstProfitFactor: 0.8,
                maxFeesPaid: 980,
                maxSlippagePaid: 490,
                failed: [{ id: 'cost-stress-return' }],
              },
            }),
          },
        });

        assert(review.action === 'WATCH_CHALLENGER', 'Kostenstress failure mag geen directe incubatie geven.');
        assert(review.failed.some((check) => check.id === 'cost-stress-quality'), 'Cost-stress-quality failure ontbreekt.');
      },
    },
  ];
}
