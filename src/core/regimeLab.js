import { calculateReturn, maxDrawdown } from './metrics.js';

export const DEFAULT_REGIME_THRESHOLDS = Object.freeze({
  segments: 6,
  bullReturn: 0.08,
  bearReturn: -0.08,
  minCoveredRegimes: 2,
  minSegmentBeatRate: 0.5,
  minWorstSegmentEdge: -0.12,
  maxBearUnderperformance: 0.03,
  maxBearDrawdown: 0.2,
});

const REGIMES = Object.freeze(['bull', 'bear', 'sideways']);

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

function closeAtOrBefore(candles, time) {
  if (!Array.isArray(candles) || !candles.length) return null;
  let low = 0;
  let high = candles.length - 1;
  let best = candles[0];

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candle = candles[mid];
    if (candle.time <= time) {
      best = candle;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return Number.isFinite(best?.close) ? best.close : null;
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

function classifyRegime(btcReturn, thresholds) {
  if (btcReturn >= thresholds.bullReturn) return 'bull';
  if (btcReturn <= thresholds.bearReturn) return 'bear';
  return 'sideways';
}

function sliceReturn(curve, start, end) {
  return calculateReturn(curve[start]?.value, curve[end]?.value);
}

function summarizeRegime(rows, regime) {
  const regimeRows = rows.filter((row) => row.regime === regime);
  const strategyReturn = compoundReturn(regimeRows.map((row) => row.strategyReturn));
  const benchmarkReturn = compoundReturn(regimeRows.map((row) => row.benchmarkReturn));

  return {
    regime,
    segments: regimeRows.length,
    strategyReturn,
    benchmarkReturn,
    edge: strategyReturn - benchmarkReturn,
    beatRate: regimeRows.length
      ? regimeRows.filter((row) => row.beatBenchmark).length / regimeRows.length
      : 0,
    worstReturn: regimeRows.length
      ? Math.min(...regimeRows.map((row) => row.strategyReturn))
      : 0,
    maxDrawdown: regimeRows.length
      ? Math.max(...regimeRows.map((row) => row.maxDrawdown))
      : 0,
  };
}

function buildChecks(summary, thresholds) {
  const bear = summary.byRegime.bear;
  return [
    makeCheck(
      'regime-coverage',
      'Kandidaat is getest in meerdere BTC-regimes',
      summary.coveredRegimes >= thresholds.minCoveredRegimes,
      `${summary.coveredRegimes}/${thresholds.minCoveredRegimes} regimes`,
    ),
    makeCheck(
      'regime-segment-beat-rate',
      'Segment beat-rate over regimes is voldoende',
      summary.segmentBeatRate >= thresholds.minSegmentBeatRate,
      `${formatPercent(summary.segmentBeatRate)} minimum ${formatPercent(thresholds.minSegmentBeatRate)}`,
    ),
    makeCheck(
      'regime-worst-edge',
      'Geen enkel regime-segment loopt extreem achter',
      summary.worstSegmentEdge >= thresholds.minWorstSegmentEdge,
      `${formatPercent(summary.worstSegmentEdge)} minimum ${formatPercent(thresholds.minWorstSegmentEdge)}`,
    ),
    makeCheck(
      'regime-bear-defense',
      'Bear-regime underperformance blijft beperkt',
      bear.segments === 0 || summary.bearUnderperformance <= thresholds.maxBearUnderperformance,
      bear.segments === 0
        ? 'Geen bear-segment in deze sample.'
        : `${formatPercent(summary.bearUnderperformance)} max ${formatPercent(thresholds.maxBearUnderperformance)}`,
    ),
    makeCheck(
      'regime-bear-drawdown',
      'Bear-regime drawdown blijft onder noodlimiet',
      bear.segments === 0 || bear.maxDrawdown <= thresholds.maxBearDrawdown,
      bear.segments === 0
        ? 'Geen bear-segment in deze sample.'
        : `${formatPercent(bear.maxDrawdown)} max ${formatPercent(thresholds.maxBearDrawdown)}`,
    ),
  ];
}

export function runRegimeBreakdown({
  candlesByAsset,
  result,
  thresholds = {},
} = {}) {
  const activeThresholds = { ...DEFAULT_REGIME_THRESHOLDS, ...thresholds };
  const btcCandles = candlesByAsset?.BTCUSDT || [];
  const strategyCurve = result?.equityCurve || [];
  const benchmarkCurve = result?.benchmarkCurve || [];
  const length = Math.min(strategyCurve.length, benchmarkCurve.length);

  if (!result?.ok || length < 2 || !btcCandles.length) {
    const emptyByRegime = Object.fromEntries(REGIMES.map((regime) => [regime, summarizeRegime([], regime)]));
    const checks = buildChecks({
      testedSegments: 0,
      coveredRegimes: 0,
      segmentBeatRate: 0,
      worstSegmentEdge: 0,
      bearUnderperformance: 0,
      byRegime: emptyByRegime,
    }, activeThresholds);
    return {
      ok: false,
      error: !btcCandles.length ? 'BTCUSDT data ontbreekt voor regime-lab.' : result?.error || 'Geen geldige backtest voor regime-lab.',
      thresholds: activeThresholds,
      testedSegments: 0,
      coveredRegimes: 0,
      segmentBeatRate: 0,
      worstSegmentEdge: 0,
      bearUnderperformance: 0,
      byRegime: emptyByRegime,
      segments: [],
      checks,
      failed: checks.filter((check) => !check.pass),
      verdict: 'FAIL',
      message: 'Regime-lab kon geen geldige segmenten testen.',
    };
  }

  const ranges = buildSegmentRanges(length, activeThresholds.segments);
  const segments = ranges.map(({ start, end }, index) => {
    const startTime = strategyCurve[start].time;
    const endTime = strategyCurve[end].time;
    const btcStart = closeAtOrBefore(btcCandles, startTime);
    const btcEnd = closeAtOrBefore(btcCandles, endTime);
    const btcReturn = calculateReturn(btcStart, btcEnd);
    const strategyReturn = sliceReturn(strategyCurve, start, end);
    const benchmarkReturn = sliceReturn(benchmarkCurve, start, end);
    const edge = strategyReturn - benchmarkReturn;
    const drawdown = maxDrawdown(strategyCurve.slice(start, end + 1)).value;

    return {
      index: index + 1,
      startTime,
      endTime,
      regime: classifyRegime(btcReturn, activeThresholds),
      btcReturn,
      strategyReturn,
      benchmarkReturn,
      edge,
      maxDrawdown: drawdown,
      beatBenchmark: strategyReturn > benchmarkReturn,
    };
  });

  const byRegime = Object.fromEntries(REGIMES.map((regime) => [regime, summarizeRegime(segments, regime)]));
  const coveredRegimes = REGIMES.filter((regime) => byRegime[regime].segments > 0).length;
  const segmentBeatRate = segments.length
    ? segments.filter((segment) => segment.beatBenchmark).length / segments.length
    : 0;
  const worstSegmentEdge = segments.length ? Math.min(...segments.map((segment) => segment.edge)) : 0;
  const bearUnderperformance = byRegime.bear.segments
    ? Math.max(0, byRegime.bear.benchmarkReturn - byRegime.bear.strategyReturn)
    : 0;
  const summary = {
    ok: true,
    thresholds: activeThresholds,
    testedSegments: segments.length,
    coveredRegimes,
    segmentBeatRate,
    worstSegmentEdge,
    bearUnderperformance,
    byRegime,
    segments,
  };
  const checks = buildChecks(summary, activeThresholds);
  const failed = checks.filter((check) => !check.pass);
  const severeFailure = failed.some((check) => (
    check.id === 'regime-bear-defense' || check.id === 'regime-bear-drawdown'
  ));

  return {
    ...summary,
    checks,
    failed,
    verdict: failed.length === 0 ? 'PASS' : !severeFailure && failed.length <= 2 ? 'WATCH' : 'FAIL',
    message: failed.length === 0
      ? 'Regime-lab groen: kandidaat houdt stand over meerdere BTC-regimes.'
      : `Regime-lab niet groen: ${failed.map((check) => check.label).join(', ')}.`,
  };
}
