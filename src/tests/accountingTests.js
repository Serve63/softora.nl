import { maxDrawdown, profitFactor } from '../core/metrics.js';
import { rebalancePortfolio, simulateTradeAccounting } from '../core/portfolio.js';
import {
  calculateLiveMarkToMarket,
  calculateForwardMetrics,
  createEmptyForwardState,
  evaluateForwardDiscipline,
  FROZEN_INCUBATION_CANDIDATE,
  loadOrCreateForwardStateForCandidate,
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
      name: 'Geen dubbele forward-log voor dezelfde candle',
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
        assert(secondLog.skipped === true, 'Dubbele forward-log op dezelfde candle wordt niet geblokkeerd.');
      },
    },
    {
      name: '4H forward-log accepteert nieuwe candle op dezelfde dag',
      run(assert) {
        const storage = createMemoryStorage();
        const forwardState = createEmptyForwardState(10000);
        const firstCandles = {
          BTCUSDT: [{ time: Date.UTC(2026, 0, 1, 0), close: 100 }],
        };
        const secondCandles = {
          BTCUSDT: [
            { time: Date.UTC(2026, 0, 1, 0), close: 100 },
            { time: Date.UTC(2026, 0, 1, 4), close: 104 },
          ],
        };
        const firstLog = logForwardSignal({
          state: forwardState,
          signal: { label: 'BTC 100%', weights: { BTCUSDT: 1 }, exposure: 1 },
          candlesByAsset: firstCandles,
          assets: ['BTCUSDT'],
          config: { ...FROZEN_INCUBATION_CANDIDATE.config, initialCapital: 10000 },
          storage,
        });
        const secondLog = logForwardSignal({
          state: firstLog.state,
          signal: { label: 'BTC 100%', weights: { BTCUSDT: 1 }, exposure: 1 },
          candlesByAsset: secondCandles,
          assets: ['BTCUSDT'],
          config: { ...FROZEN_INCUBATION_CANDIDATE.config, initialCapital: 10000 },
          storage,
        });

        assert(secondLog.skipped === false, 'Nieuwe 4H-candle op dezelfde dag moet gelogd worden.');
        assert(secondLog.state.logs.length === 2, 'Tweede 4H-candle ontbreekt in forward logs.');
        assert(secondLog.state.logs[0].decisionKey !== secondLog.state.logs[1].decisionKey, '4H candles moeten eigen decision keys krijgen.');
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
      name: 'Watchlist forward-state wisselt niet door kandidaten heen',
      run(assert) {
        const storage = createMemoryStorage();
        const firstCandidate = {
          ...FROZEN_INCUBATION_CANDIDATE,
          id: 'watch-a',
          label: 'Watch A',
        };
        const secondCandidate = {
          ...FROZEN_INCUBATION_CANDIDATE,
          id: 'watch-b',
          label: 'Watch B',
        };
        const firstState = createEmptyForwardState(10000, firstCandidate);
        firstState.logs.push({
          timestamp: '2026-01-01T00:00:00.000Z',
          dateKey: '2026-01-01',
          timeframe: '4H',
          paperEquity: 10100,
          benchmarkEquity: 9900,
          gateOpen: true,
          signal: 'BTC',
        });
        storage.setItem('softora.paperResearch.forwardState.v1', JSON.stringify(firstState));

        const loadedSame = loadOrCreateForwardStateForCandidate(firstCandidate, 10000, storage);
        const loadedDifferent = loadOrCreateForwardStateForCandidate(secondCandidate, 10000, storage);

        assert(loadedSame.logs.length === 1, 'Dezelfde watchlist-kandidaat moet bestaande forward logs houden.');
        assert(loadedDifferent.logs.length === 0, 'Nieuwe watchlist-kandidaat mag oude forward logs niet erven.');
        assert(loadedDifferent.candidate.id === 'watch-b', 'Nieuwe watchlist-state krijgt niet de nieuwe kandidaat.');
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
      name: 'Live mark-to-market waardeert open paper weights zonder nieuwe log',
      run(assert) {
        const forwardState = createEmptyForwardState(10000);
        forwardState.logs = [{
          timestamp: '2026-01-01T00:00:00.000Z',
          dateKey: '2026-01-01',
          decisionKey: '2026-01-01T00:00:00.000Z',
          timeframe: '4H',
          paperEquity: 10000,
          benchmarkEquity: 10000,
          weights: { BTCUSDT: 0.5 },
          benchmarkWeights: { BTCUSDT: 0.5, ETHUSDT: 0.5 },
          prices: { BTCUSDT: 100, ETHUSDT: 100 },
          gateOpen: true,
          signal: 'BTC 50%',
        }];
        const live = calculateLiveMarkToMarket({
          state: forwardState,
          prices: { BTCUSDT: 110, ETHUSDT: 90 },
          assets: ['BTCUSDT', 'ETHUSDT'],
          config: { initialCapital: 10000 },
          timestamp: Date.UTC(2026, 0, 1, 1),
        });

        assert(live.ok, 'Live mark-to-market moet slagen met een bestaande log.');
        assert(approx(live.paperEquity, 10500), 'Live paper equity waardeert open weights niet correct.');
        assert(approx(live.benchmarkEquity, 10000), 'Live benchmark equity klopt niet.');
        assert(forwardState.logs.length === 1, 'Live mark-to-market mag geen extra forward-log schrijven.');
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
