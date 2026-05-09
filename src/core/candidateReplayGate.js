import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import {
  runAcceleratedForwardReplay,
  runMultiWindowAcceleratedReplay,
} from '../forward/acceleratedReplay.js';

export const DEFAULT_CANDIDATE_REPLAY_GATE_OPTIONS = Object.freeze({
  maxLogs: 120,
  replayBars: 1200,
  windowCount: 4,
  windowLogs: 45,
  single: Object.freeze({
    minLogs: 40,
    maxLossBeforeFail: -0.05,
    minGateOpenRate: 0.02,
  }),
  multi: Object.freeze({
    minWindows: 3,
    minPassRate: 0.25,
    minPositiveRate: 0.4,
    minBeatRate: 0.5,
    maxWorstReturn: -0.05,
  }),
});

function candidateLabel(row, source) {
  return row ? `${source}:${row.strategyName || row.strategy?.name || 'unknown'}` : source;
}

function summarizeReplay(replay) {
  const metrics = replay?.metrics || {};
  return {
    ok: Boolean(replay?.ok),
    verdict: replay?.verdict || 'FAIL',
    logs: metrics.logs || 0,
    return: metrics.paperReturn || 0,
    benchmarkReturn: metrics.benchmarkReturn || 0,
    edge: metrics.edge || 0,
    maxDrawdown: metrics.maxDrawdown || 0,
    gateOpenRate: metrics.gateOpenRate || 0,
    failed: replay?.discipline?.failed?.map((check) => check.id) || [],
    message: replay?.discipline?.message || replay?.error || 'n.v.t.',
  };
}

function summarizeMultiWindow(replay) {
  const summary = replay?.summary || {};
  return {
    ok: Boolean(replay?.ok),
    verdict: replay?.verdict || 'FAIL',
    windows: summary.windows || 0,
    passRate: summary.passRate || 0,
    positiveRate: summary.positiveRate || 0,
    beatRate: summary.beatRate || 0,
    averageReturn: summary.averageReturn || 0,
    worstReturn: summary.worstReturn || 0,
    worstDrawdown: summary.worstDrawdown || 0,
    failed: replay?.discipline?.failed?.map((check) => check.id) || [],
    message: replay?.discipline?.message || replay?.error || 'n.v.t.',
  };
}

function buildGate({ row, source, singleReplay, multiReplay }) {
  const single = summarizeReplay(singleReplay);
  const multi = summarizeMultiWindow(multiReplay);
  const rejected = !single.ok
    || !multi.ok
    || single.verdict === 'FAIL'
    || multi.verdict === 'FAIL';
  const verdict = rejected
    ? 'REJECT'
    : single.verdict === 'PASS' && multi.verdict === 'PASS'
      ? 'PASS'
      : 'WATCH';

  return {
    label: candidateLabel(row, source),
    strategyName: row?.strategyName || row?.strategy?.name || null,
    source,
    verdict,
    pass: verdict !== 'REJECT',
    single,
    multi,
    failed: [
      ...single.failed.map((id) => `single:${id}`),
      ...multi.failed.map((id) => `multi:${id}`),
    ],
    message: verdict === 'REJECT'
      ? 'Replay-gate blokkeert deze kandidaat: single of multi-window replay faalt hard.'
      : verdict === 'PASS'
        ? 'Replay-gate groen: single en multi-window replay zijn allebei groen.'
        : 'Replay-gate watch: geen harde replay-fail, maar bewijs is nog niet volledig groen.',
  };
}

function replayRulesForConfig(config = {}, options = {}) {
  const maxDrawdown = Math.min(config.emergencyDrawdownStop || 0.18, 0.12);
  return {
    single: {
      ...DEFAULT_CANDIDATE_REPLAY_GATE_OPTIONS.single,
      maxDrawdown,
      ...options.single,
    },
    multi: {
      ...DEFAULT_CANDIDATE_REPLAY_GATE_OPTIONS.multi,
      maxWorstDrawdown: maxDrawdown,
      ...options.multi,
    },
  };
}

function evaluateRow({ row, source, candlesByAsset, assets, options }) {
  if (!row?.strategy || !row?.config) return { row: null, gate: null };
  const config = row.config;
  const activeOptions = { ...DEFAULT_CANDIDATE_REPLAY_GATE_OPTIONS, ...options };
  const rules = replayRulesForConfig(config, activeOptions);
  const singleReplay = runAcceleratedForwardReplay({
    candlesByAsset,
    strategy: row.strategy,
    assets,
    config,
    maxLogs: activeOptions.maxLogs,
    replayBars: activeOptions.replayBars,
    rules: rules.single,
  });
  const multiReplay = runMultiWindowAcceleratedReplay({
    candlesByAsset,
    strategy: row.strategy,
    assets,
    config,
    windowCount: activeOptions.windowCount,
    windowLogs: activeOptions.windowLogs,
    replayRules: {
      minLogs: Math.min(activeOptions.windowLogs, rules.single.minLogs),
      maxDrawdown: rules.single.maxDrawdown,
      maxLossBeforeFail: rules.single.maxLossBeforeFail,
      minGateOpenRate: rules.single.minGateOpenRate,
    },
    multiWindowRules: rules.multi,
  });
  const gate = buildGate({ row, source, singleReplay, multiReplay });

  return {
    row: gate.pass ? { ...row, replayGate: gate } : null,
    gate,
  };
}

export function applyCandidateReplayGate({
  lab,
  candlesByAsset,
  assets = SUPPORTED_ASSETS,
  options = {},
} = {}) {
  if (!lab) return lab;
  const candidate = evaluateRow({
    row: lab.candidate,
    source: 'candidate',
    candlesByAsset,
    assets,
    options,
  });
  const watch = evaluateRow({
    row: lab.watch,
    source: 'watch',
    candlesByAsset,
    assets,
    options,
  });

  return {
    ...lab,
    candidate: candidate.row,
    watch: watch.row,
    replayGate: {
      candidate: candidate.gate,
      watch: watch.gate,
    },
  };
}
