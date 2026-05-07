import { maxDrawdown, profitFactor } from '../core/metrics.js';
import { rebalancePortfolio, simulateTradeAccounting } from '../core/portfolio.js';
import {
  calculateForwardMetrics,
  createEmptyForwardState,
  evaluateForwardDiscipline,
  FROZEN_INCUBATION_CANDIDATE,
  logForwardSignal,
} from '../forward/forwardRunner.js';
import { createMemoryStorage } from '../storage/localStore.js';

function approx(actual, expected, tolerance = 1e-8) {
  return Math.abs(actual - expected) <= tolerance;
}

export function accountingTestCases() {
  return [
    {
      name: 'Fees en slippage worden meegerekend',
      run(assert) {
        const rebalance = rebalancePortfolio({
          equity: 10000,
          currentWeights: {},
          targetWeights: { BTCUSDT: 1 },
          feeRate: 0.001,
          slippageRate: 0.0005,
        });
        assert(approx(rebalance.feePaid, 10), 'Fee wordt niet correct berekend.');
        assert(approx(rebalance.slippagePaid, 5), 'Slippage wordt niet correct berekend.');
        assert(approx(rebalance.equity, 9985), 'Fees en slippage worden niet van equity afgetrokken.');
      },
    },
    {
      name: 'Buy/sell accounting klopt',
      run(assert) {
        const accounting = simulateTradeAccounting(1000, [
          { side: 'buy', price: 100, qty: 1 },
          { side: 'sell', price: 110, qty: 1 },
        ], 0.001, 0);
        assert(approx(accounting.position, 0), 'Buy/sell accounting laat een restpositie staan.');
        assert(approx(accounting.cash, 1009.79), 'Buy/sell accounting cash klopt niet.');
      },
    },
    {
      name: 'Drawdown wordt correct berekend',
      run(assert) {
        const drawdown = maxDrawdown([
          { time: 1, value: 100 },
          { time: 2, value: 120 },
          { time: 3, value: 90 },
          { time: 4, value: 110 },
        ]);
        assert(approx(drawdown.value, 0.25), 'Drawdownberekening klopt niet.');
      },
    },
    {
      name: 'Profit factor wordt correct berekend',
      run(assert) {
        const pf = profitFactor([
          { pnl: 100 },
          { pnl: -50 },
          { pnl: 50 },
          { pnl: -25 },
        ]);
        assert(approx(pf, 2), 'Profit factor klopt niet.');
      },
    },
    {
      name: 'Geen dubbele forward-log per dag',
      run(assert) {
        const storage = createMemoryStorage();
        const forwardState = createEmptyForwardState(10000);
        const candlesByAsset = {
          BTCUSDT: [{ time: Date.UTC(2026, 0, 1), close: 100 }],
        };
        const firstLog = logForwardSignal({
          state: forwardState,
          signal: { label: 'BTC 100%', weights: { BTCUSDT: 1 }, exposure: 1 },
          candlesByAsset,
          assets: ['BTCUSDT'],
          config: { ...FROZEN_INCUBATION_CANDIDATE.config, initialCapital: 10000 },
          storage,
        });
        const secondLog = logForwardSignal({
          state: firstLog.state,
          signal: { label: 'BTC 100%', weights: { BTCUSDT: 1 }, exposure: 1 },
          candlesByAsset,
          assets: ['BTCUSDT'],
          config: { ...FROZEN_INCUBATION_CANDIDATE.config, initialCapital: 10000 },
          storage,
        });
        assert(firstLog.state.logs.length === 1, 'Eerste forward-log is niet opgeslagen.');
        assert(secondLog.skipped === true, 'Dubbele forward-log op dezelfde datum wordt niet geblokkeerd.');
      },
    },
    {
      name: 'Forward-log weigert niet-gelockte kandidaatconfig',
      run(assert) {
        const forwardState = createEmptyForwardState(10000);
        const result = logForwardSignal({
          state: forwardState,
          signal: { label: 'BTC 100%', weights: { BTCUSDT: 1 }, exposure: 1 },
          candlesByAsset: { BTCUSDT: [{ time: Date.UTC(2026, 0, 1), close: 100 }] },
          assets: ['BTCUSDT'],
          config: { timeframe: 'Daily', initialCapital: 10000 },
        });

        assert(result.skipped === true, 'Forward-log accepteert een niet-gelockte config.');
        assert(result.state.logs.length === 0, 'Niet-gelockte config mag geen log toevoegen.');
      },
    },
    {
      name: 'Forward metrics berekenen edge en drawdown',
      run(assert) {
        const forwardState = createEmptyForwardState(10000);
        forwardState.logs = [
          { timestamp: '2026-01-01T00:00:00.000Z', paperEquity: 10000, benchmarkEquity: 10000, gateOpen: true, signal: 'BTC' },
          { timestamp: '2026-01-02T00:00:00.000Z', paperEquity: 11000, benchmarkEquity: 9000, gateOpen: true, signal: 'BTC' },
          { timestamp: '2026-01-03T00:00:00.000Z', paperEquity: 9900, benchmarkEquity: 8000, gateOpen: false, signal: 'CASH' },
        ];
        const metrics = calculateForwardMetrics(forwardState, FROZEN_INCUBATION_CANDIDATE.config);

        assert(approx(metrics.paperReturn, -0.01), 'Forward paper return klopt niet.');
        assert(approx(metrics.benchmarkReturn, -0.2), 'Forward benchmark return klopt niet.');
        assert(approx(metrics.edge, 0.19), 'Forward edge klopt niet.');
        assert(approx(metrics.maxDrawdown, 0.1), 'Forward drawdown klopt niet.');
        assert(approx(metrics.gateOpenRate, 2 / 3), 'Forward gate-open rate klopt niet.');
      },
    },
    {
      name: 'Forward discipline blijft incubating voor 30 logs',
      run(assert) {
        const forwardState = createEmptyForwardState(10000);
        forwardState.logs = Array.from({ length: 12 }, (_, index) => ({
          timestamp: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
          paperEquity: 10000 + index * 10,
          benchmarkEquity: 10000,
          gateOpen: true,
          signal: 'BTC',
        }));
        const discipline = evaluateForwardDiscipline(forwardState, FROZEN_INCUBATION_CANDIDATE.config);

        assert(discipline.verdict === 'INCUBATING', 'Forward discipline moet voor 30 logs incubating blijven.');
        assert(discipline.failed.length === 0, 'Incubating fase mag nog geen actieve failures geven.');
      },
    },
  ];
}

export function runAccountingTests(assert) {
  for (const testCase of accountingTestCases()) {
    testCase.run(assert);
  }
}
