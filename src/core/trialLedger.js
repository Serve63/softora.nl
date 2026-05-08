export const DEFAULT_TRIAL_VALIDATION_THRESHOLDS = Object.freeze({
  minObservations: 120,
  minSharpe: 0.15,
  minDeflatedSharpe: 0,
  minEdgeSharpe: 0,
});

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n.v.t.';
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

function simpleReturns(curve = []) {
  const returns = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = Number(curve[index - 1]?.value);
    const current = Number(curve[index]?.value);
    if (Number.isFinite(previous) && previous > 0 && Number.isFinite(current)) {
      returns.push(current / previous - 1);
    }
  }
  return returns;
}

function pairedEdgeReturns(strategyCurve = [], benchmarkCurve = []) {
  const length = Math.min(strategyCurve.length, benchmarkCurve.length);
  const returns = [];
  for (let index = 1; index < length; index += 1) {
    const strategyPrevious = Number(strategyCurve[index - 1]?.value);
    const strategyCurrent = Number(strategyCurve[index]?.value);
    const benchmarkPrevious = Number(benchmarkCurve[index - 1]?.value);
    const benchmarkCurrent = Number(benchmarkCurve[index]?.value);
    if (
      Number.isFinite(strategyPrevious)
      && strategyPrevious > 0
      && Number.isFinite(strategyCurrent)
      && Number.isFinite(benchmarkPrevious)
      && benchmarkPrevious > 0
      && Number.isFinite(benchmarkCurrent)
    ) {
      returns.push((strategyCurrent / strategyPrevious - 1) - (benchmarkCurrent / benchmarkPrevious - 1));
    }
  }
  return returns;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function standardDeviation(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  const mean = average(finite);
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

function effectivePeriodsPerYear(timeframe = 'Daily') {
  // Treat 4H crypto bars as daily-effective observations. Adjacent 4H candles are
  // heavily correlated, so full 6x annualization would overstate statistical proof.
  return timeframe === 'Daily' ? 365 : 365;
}

function annualizedSharpe(returns, periodsPerYear) {
  const mean = average(returns);
  const stdev = standardDeviation(returns);
  if (stdev === 0) return mean > 0 ? 8 : mean < 0 ? -8 : 0;
  return (mean / stdev) * Math.sqrt(periodsPerYear);
}

function trialPenalty({ trialCount, observations, periodsPerYear }) {
  if (trialCount <= 1 || observations <= 0) return 0;
  return Math.sqrt((2 * Math.log(trialCount) * periodsPerYear) / observations);
}

export function runTrialLedgerValidation({
  result,
  trialCount = 1,
  timeframe = 'Daily',
  thresholds = {},
} = {}) {
  const activeThresholds = { ...DEFAULT_TRIAL_VALIDATION_THRESHOLDS, ...thresholds };
  const strategyCurve = result?.equityCurve || [];
  const benchmarkCurve = result?.benchmarkCurve || [];
  const returns = simpleReturns(strategyCurve);
  const edgeReturns = pairedEdgeReturns(strategyCurve, benchmarkCurve);
  const observations = returns.length;
  const activeTrialCount = Math.max(1, Math.floor(Number(trialCount) || 1));
  const periodsPerYear = effectivePeriodsPerYear(timeframe);
  const sharpe = annualizedSharpe(returns, periodsPerYear);
  const edgeSharpe = annualizedSharpe(edgeReturns, periodsPerYear);
  const penalty = trialPenalty({
    trialCount: activeTrialCount,
    observations,
    periodsPerYear,
  });
  const deflatedSharpe = sharpe - penalty;

  const checks = [
    makeCheck(
      'trial-observations',
      'Genoeg observaties voor statistische controle',
      observations >= activeThresholds.minObservations,
      `${observations}/${activeThresholds.minObservations}`,
    ),
    makeCheck(
      'trial-sharpe',
      'Sharpe blijft positief',
      sharpe >= activeThresholds.minSharpe,
      `${formatNumber(sharpe)} minimum ${formatNumber(activeThresholds.minSharpe)}`,
    ),
    makeCheck(
      'trial-deflated-sharpe',
      'Deflated Sharpe blijft positief na aantal pogingen',
      deflatedSharpe >= activeThresholds.minDeflatedSharpe,
      `${formatNumber(deflatedSharpe)} na penalty ${formatNumber(penalty)} over ${activeTrialCount} trials`,
    ),
    makeCheck(
      'trial-edge-sharpe',
      'Edge Sharpe tegen benchmark blijft positief',
      edgeSharpe >= activeThresholds.minEdgeSharpe,
      `${formatNumber(edgeSharpe)} minimum ${formatNumber(activeThresholds.minEdgeSharpe)}`,
    ),
  ];
  const failed = checks.filter((check) => !check.pass);
  const severeFailure = failed.some((check) => (
    check.id === 'trial-deflated-sharpe'
    || check.id === 'trial-edge-sharpe'
    || check.id === 'trial-observations'
  ));

  return {
    ok: observations > 0,
    thresholds: activeThresholds,
    trialCount: activeTrialCount,
    observations,
    periodsPerYear,
    sharpe,
    edgeSharpe,
    trialPenalty: penalty,
    deflatedSharpe,
    checks,
    failed,
    verdict: failed.length === 0 ? 'PASS' : !severeFailure && failed.length <= 1 ? 'WATCH' : 'FAIL',
    message: failed.length === 0
      ? 'Trial ledger groen: edge blijft geloofwaardig na correctie voor meerdere pogingen.'
      : `Trial ledger niet groen: ${failed.map((check) => check.label).join(', ')}.`,
  };
}
