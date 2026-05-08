import { calculateReturn } from './metrics.js';

export const DEFAULT_REALITY_THRESHOLDS = Object.freeze({
  segments: 12,
  samples: 240,
  minPositiveEdgeRate: 0.6,
  minMedianEdge: 0,
  minFifthPercentileEdge: -0.18,
  minMedianStrategyReturn: 0,
});

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(1)}%`;
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

function compoundReturn(values) {
  return values.reduce((growth, value) => growth * (1 + value), 1) - 1;
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
}

function createSeededRandom(seed = 1337) {
  let state = Math.abs(Math.floor(seed)) || 1337;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function buildSegmentRanges(length, requestedSegments) {
  const span = length - 1;
  const count = Math.max(1, Math.min(span, Math.floor(requestedSegments) || 1));
  const ranges = [];

  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index * span) / count);
    const end = index === count - 1
      ? length - 1
      : Math.floor(((index + 1) * span) / count);
    if (end > start) ranges.push({ start, end });
  }

  return ranges;
}

function buildSegmentReturns(strategyCurve, benchmarkCurve, segments) {
  const length = Math.min(strategyCurve.length, benchmarkCurve.length);
  return buildSegmentRanges(length, segments).map(({ start, end }, index) => {
    const strategyReturn = calculateReturn(strategyCurve[start]?.value, strategyCurve[end]?.value);
    const benchmarkReturn = calculateReturn(benchmarkCurve[start]?.value, benchmarkCurve[end]?.value);
    return {
      index: index + 1,
      startTime: strategyCurve[start]?.time || null,
      endTime: strategyCurve[end]?.time || null,
      strategyReturn,
      benchmarkReturn,
      edge: strategyReturn - benchmarkReturn,
    };
  });
}

function buildChecks(summary, thresholds) {
  return [
    makeCheck(
      'reality-sample-size',
      'Reality check heeft genoeg segmenten',
      summary.segmentCount >= Math.min(6, thresholds.segments),
      `${summary.segmentCount}/${Math.min(6, thresholds.segments)} segmenten`,
    ),
    makeCheck(
      'reality-positive-edge-rate',
      'Bootstrap edge is vaak positief',
      summary.positiveEdgeRate >= thresholds.minPositiveEdgeRate,
      `${formatPercent(summary.positiveEdgeRate)} minimum ${formatPercent(thresholds.minPositiveEdgeRate)}`,
    ),
    makeCheck(
      'reality-median-edge',
      'Mediane bootstrap edge is positief',
      summary.medianEdge >= thresholds.minMedianEdge,
      `${formatPercent(summary.medianEdge)} minimum ${formatPercent(thresholds.minMedianEdge)}`,
    ),
    makeCheck(
      'reality-left-tail',
      'Slechte bootstrap-scenarios blijven binnen marge',
      summary.fifthPercentileEdge >= thresholds.minFifthPercentileEdge,
      `${formatPercent(summary.fifthPercentileEdge)} minimum ${formatPercent(thresholds.minFifthPercentileEdge)}`,
    ),
    makeCheck(
      'reality-median-return',
      'Mediane bootstrap strategy return blijft positief',
      summary.medianStrategyReturn >= thresholds.minMedianStrategyReturn,
      `${formatPercent(summary.medianStrategyReturn)} minimum ${formatPercent(thresholds.minMedianStrategyReturn)}`,
    ),
  ];
}

export function runRealityCheck({
  result,
  thresholds = {},
  seed = 1337,
} = {}) {
  const activeThresholds = { ...DEFAULT_REALITY_THRESHOLDS, ...thresholds };
  const strategyCurve = result?.equityCurve || [];
  const benchmarkCurve = result?.benchmarkCurve || [];
  const length = Math.min(strategyCurve.length, benchmarkCurve.length);

  if (!result?.ok || length < 3) {
    const summary = {
      ok: false,
      error: result?.error || 'Geen geldige equity curves voor reality check.',
      thresholds: activeThresholds,
      segmentCount: 0,
      positiveEdgeRate: 0,
      medianEdge: 0,
      fifthPercentileEdge: 0,
      medianStrategyReturn: 0,
      samples: [],
      segments: [],
    };
    const checks = buildChecks(summary, activeThresholds);
    return {
      ...summary,
      checks,
      failed: checks.filter((check) => !check.pass),
      verdict: 'FAIL',
      message: 'Reality check kon geen geldige segmenten testen.',
    };
  }

  const segments = buildSegmentReturns(
    strategyCurve,
    benchmarkCurve,
    activeThresholds.segments,
  );
  const random = createSeededRandom(seed);
  const samples = Array.from({ length: activeThresholds.samples }, () => {
    const picks = Array.from({ length: segments.length }, () => (
      segments[Math.floor(random() * segments.length)]
    ));
    const strategyReturn = compoundReturn(picks.map((segment) => segment.strategyReturn));
    const benchmarkReturn = compoundReturn(picks.map((segment) => segment.benchmarkReturn));
    return {
      strategyReturn,
      benchmarkReturn,
      edge: strategyReturn - benchmarkReturn,
    };
  });
  const edges = samples.map((sample) => sample.edge);
  const strategyReturns = samples.map((sample) => sample.strategyReturn);
  const summary = {
    ok: true,
    thresholds: activeThresholds,
    segmentCount: segments.length,
    positiveEdgeRate: samples.length
      ? samples.filter((sample) => sample.edge > 0).length / samples.length
      : 0,
    medianEdge: quantile(edges, 0.5),
    fifthPercentileEdge: quantile(edges, 0.05),
    medianStrategyReturn: quantile(strategyReturns, 0.5),
    samples,
    segments,
  };
  const checks = buildChecks(summary, activeThresholds);
  const failed = checks.filter((check) => !check.pass);
  const severeFailure = failed.some((check) => (
    check.id === 'reality-positive-edge-rate'
    || check.id === 'reality-median-edge'
    || check.id === 'reality-median-return'
  ));

  return {
    ...summary,
    checks,
    failed,
    verdict: failed.length === 0 ? 'PASS' : !severeFailure && failed.length <= 1 ? 'WATCH' : 'FAIL',
    message: failed.length === 0
      ? 'Reality check groen: de edge blijft overeind in gehusselde marktsegmenten.'
      : `Reality check niet groen: ${failed.map((check) => check.label).join(', ')}.`,
  };
}
