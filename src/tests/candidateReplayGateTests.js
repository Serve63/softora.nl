import { applyCandidateReplayGate } from '../core/candidateReplayGate.js';

function makeCandles(symbol, count, drift, wave = 0.0004) {
  const candles = [];
  let price = symbol === 'ETHUSDT' ? 60 : 100;

  for (let index = 0; index < count; index += 1) {
    const activeDrift = typeof drift === 'function' ? drift(index, symbol) : drift;
    price *= 1 + activeDrift + Math.sin(index / 17) * wave;
    candles.push({
      symbol,
      time: Date.UTC(2024, 0, 1 + index),
      open: price * 0.998,
      high: price * 1.006,
      low: price * 0.994,
      close: price,
      volume: 1000 + index,
    });
  }

  return candles;
}

const alwaysEthStrategy = {
  name: 'Replay Gate ETH Test',
  generateSignal() {
    return {
      label: 'ETH 100%',
      weights: { ETHUSDT: 1 },
      exposure: 1,
      ranking: [{ symbol: 'ETHUSDT', volatility: 0.03 }],
      risk: { exposure: 1 },
      reasons: ['Synthetic replay-gate strategy.'],
    };
  },
};

const baseRow = Object.freeze({
  strategyName: alwaysEthStrategy.name,
  strategy: alwaysEthStrategy,
  config: Object.freeze({
    initialCapital: 10000,
    feeRate: 0,
    slippageRate: 0,
    timeframe: '4H',
    warmupBars: 20,
    emergencyDrawdownStop: 0.12,
  }),
  verdict: 'WATCH',
});

export function candidateReplayGateTestCases() {
  return [
    {
      name: 'Candidate replay gate blokkeert kandidaat met harde replay-fail',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 220, -0.001),
          ETHUSDT: makeCandles('ETHUSDT', 220, -0.004),
        };
        const lab = applyCandidateReplayGate({
          lab: { candidate: baseRow, watch: null },
          candlesByAsset,
          assets: ['BTCUSDT', 'ETHUSDT'],
          options: {
            maxLogs: 80,
            replayBars: 120,
            windowCount: 3,
            windowLogs: 25,
            single: { minLogs: 20, maxLossBeforeFail: -0.03 },
            multi: { minWindows: 2, maxWorstReturn: -0.03 },
          },
        });

        assert(lab.candidate === null, 'Replay-gate moet een hard falende kandidaat blokkeren.');
        assert(lab.replayGate.candidate.verdict === 'REJECT', 'Replay-gate moet REJECT rapporteren.');
        assert(lab.replayGate.candidate.failed.some((id) => id.includes('loss-control') || id.includes('worst-return')), 'Replay-gate mist loss failure.');
      },
    },
    {
      name: 'Candidate replay gate laat kandidaat door zonder harde replay-fail',
      run(assert) {
        const candlesByAsset = {
          BTCUSDT: makeCandles('BTCUSDT', 220, 0.001),
          ETHUSDT: makeCandles('ETHUSDT', 220, 0.003),
        };
        const lab = applyCandidateReplayGate({
          lab: { candidate: baseRow, watch: null },
          candlesByAsset,
          assets: ['BTCUSDT', 'ETHUSDT'],
          options: {
            maxLogs: 80,
            replayBars: 120,
            windowCount: 3,
            windowLogs: 25,
            single: { minLogs: 20 },
            multi: { minWindows: 2 },
          },
        });

        assert(lab.candidate !== null, 'Replay-gate mag een gezonde kandidaat niet blokkeren.');
        assert(lab.candidate.replayGate.pass === true, 'Doorgelaten kandidaat moet replayGate metadata krijgen.');
        assert(['PASS', 'WATCH'].includes(lab.replayGate.candidate.verdict), 'Gezonde kandidaat mag geen REJECT verdict krijgen.');
      },
    },
  ];
}
