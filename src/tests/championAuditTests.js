import { runChampionAudit } from '../core/championAudit.js';

function makeCandles(symbol, count, drift = 0.001, wave = 0.0002) {
  const candles = [];
  let price = symbol === 'SOLUSDT' ? 30 : 100;

  for (let index = 0; index < count; index += 1) {
    const activeDrift = typeof drift === 'function' ? drift(index, symbol) : drift;
    price *= 1 + activeDrift + Math.sin(index / 13) * wave;
    candles.push({
      symbol,
      time: Date.UTC(2024, 0, 1 + index),
      open: price * 0.998,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 1000 + index,
    });
  }

  return candles;
}

function constantStrategy(name, weights) {
  return {
    name,
    generateSignal() {
      const exposure = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
      return {
        label: exposure > 0 ? name : 'CASH',
        weights,
        exposure,
        risk: { exposure },
        reasons: ['Synthetic champion-audit strategy.'],
      };
    },
  };
}

const championStrategy = constantStrategy('Synthetic BTC Champion', { BTCUSDT: 1 });
const solStrategy = constantStrategy('Synthetic SOL Challenger', { SOLUSDT: 1 });

const baseConfig = Object.freeze({
  initialCapital: 10000,
  feeRate: 0,
  slippageRate: 0,
  timeframe: 'Daily',
  candleTarget: 260,
  warmupBars: 20,
  maxDrawdownTarget: 0.5,
  minProfitFactor: 1.65,
  oosRatio: 0.25,
});

const fastOptions = Object.freeze({
  maxLogs: 80,
  replayBars: 120,
  windowCount: 3,
  windowLogs: 24,
  minReturnLift: 0.02,
  minReplayPositiveRate: 0.6,
  minReplayBeatRate: 0.6,
  replayRules: {
    minLogs: 20,
    maxDrawdown: 0.2,
    maxLossBeforeFail: -0.04,
    minGateOpenRate: 0.1,
  },
  multiWindowRules: {
    minWindows: 3,
    minPassRate: 0.4,
    minPositiveRate: 0.6,
    minBeatRate: 0.6,
    maxWorstDrawdown: 0.2,
    maxWorstReturn: -0.04,
  },
});

export function championAuditTestCases() {
  return [
    {
      name: 'Champion audit markeert sterkere kandidaat zonder auto-promotie',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 260, 0.0001),
          SOLUSDT: makeCandles('SOLUSDT', 260, 0.003),
        };
        const audit = runChampionAudit({
          candlesByAsset,
          assets: ['BTCUSDT', 'SOLUSDT'],
          baseConfig,
          champion: {
            id: 'synthetic-btc-champion',
            label: 'Synthetic BTC Champion',
            strategy: championStrategy,
            config: baseConfig,
          },
          challengers: [{
            id: 'synthetic-sol-challenger',
            label: 'Synthetic SOL Challenger',
            strategy: solStrategy,
            config: baseConfig,
          }],
          options: fastOptions,
        });

        assert(audit.verdict === 'RESEARCH_CHAMPION_REPLACEMENT', 'Sterkere kandidaat moet als onderzoeksvervanger naar boven komen.');
        assert(audit.autoPromote === false, 'Audit mag nooit automatisch promoten.');
        assert(audit.replacement?.id === 'synthetic-sol-challenger', 'SOL challenger moet de vervanger zijn.');
        assert(audit.replacementChecks.every((check) => check.pass), 'Sterke kandidaat moet alle replacement checks halen.');
      },
    },
    {
      name: 'Champion audit blokkeert kandidaat met te slechte drawdown',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 260, 0.0001),
          SOLUSDT: makeCandles('SOLUSDT', 260, (index) => (index < 190 ? 0.004 : -0.018)),
        };
        const audit = runChampionAudit({
          candlesByAsset,
          assets: ['BTCUSDT', 'SOLUSDT'],
          baseConfig,
          champion: {
            id: 'synthetic-btc-champion',
            label: 'Synthetic BTC Champion',
            strategy: championStrategy,
            config: baseConfig,
          },
          challengers: [{
            id: 'synthetic-sol-challenger',
            label: 'Synthetic SOL Challenger',
            strategy: solStrategy,
            config: baseConfig,
          }],
          options: {
            ...fastOptions,
            maxDrawdownWorsening: 0.01,
            maxReplacementDrawdown: 0.08,
          },
        });

        assert(audit.verdict !== 'RESEARCH_CHAMPION_REPLACEMENT', 'Drawdown-kandidaat mag niet als vervanger klaarstaan.');
        assert(audit.failed.some((check) => check.id === 'drawdown-not-worse' || check.id === 'drawdown-cap' || check.id === 'replay-not-fail'), 'Drawdown/replay failure moet zichtbaar zijn.');
      },
    },
  ];
}
