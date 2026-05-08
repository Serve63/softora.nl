import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import { runBacktest } from './backtester.js';
import { DEFAULT_CONFIG } from './riskEngine.js';

export const DEFAULT_COST_STRESS_THRESHOLDS = Object.freeze({
  multipliers: [2],
  minStressReturn: 0,
  minStressEdge: -0.1,
  maxStressDrawdown: 0.3,
  minStressProfitFactor: 1,
});

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n.v.t.';
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

function finiteProfitFactor(value) {
  if (value === Number.POSITIVE_INFINITY) return 8;
  return Number.isFinite(value) ? value : 0;
}

function summarizeStressRow(multiplier, result) {
  return {
    multiplier,
    strategyReturn: result.strategyReturn || 0,
    benchmarkReturn: result.benchmarkReturn || 0,
    edge: (result.strategyReturn || 0) - (result.benchmarkReturn || 0),
    maxDrawdown: result.maxDrawdown || 0,
    profitFactor: result.profitFactor || 0,
    trades: result.trades || 0,
    feesPaid: result.feesPaid || 0,
    slippagePaid: result.slippagePaid || 0,
  };
}

function buildChecks(summary, thresholds) {
  return [
    makeCheck(
      'cost-stress-return',
      'Kostenstress blijft positief',
      summary.worstReturn > thresholds.minStressReturn,
      `${formatPercent(summary.worstReturn)} minimum ${formatPercent(thresholds.minStressReturn)}`,
    ),
    makeCheck(
      'cost-stress-edge',
      'Kostenstress edge blijft acceptabel',
      summary.worstEdge >= thresholds.minStressEdge,
      `${formatPercent(summary.worstEdge)} minimum ${formatPercent(thresholds.minStressEdge)}`,
    ),
    makeCheck(
      'cost-stress-drawdown',
      'Kostenstress drawdown blijft binnen limiet',
      summary.worstDrawdown <= thresholds.maxStressDrawdown,
      `${formatPercent(summary.worstDrawdown)} limiet ${formatPercent(thresholds.maxStressDrawdown)}`,
    ),
    makeCheck(
      'cost-stress-profit-factor',
      'Kostenstress profit factor blijft boven break-even',
      summary.worstProfitFactor >= thresholds.minStressProfitFactor,
      `${formatNumber(summary.worstProfitFactor)} minimum ${formatNumber(thresholds.minStressProfitFactor)}`,
    ),
  ];
}

export function runCostStressLab({
  candlesByAsset,
  strategy = frozenCandidate,
  baseConfig = {},
  assets = SUPPORTED_ASSETS,
  multipliers,
  thresholds = {},
} = {}) {
  const config = { ...DEFAULT_CONFIG, ...baseConfig };
  const activeThresholds = {
    ...DEFAULT_COST_STRESS_THRESHOLDS,
    maxStressDrawdown: config.maxDrawdownTarget ?? DEFAULT_COST_STRESS_THRESHOLDS.maxStressDrawdown,
    ...thresholds,
  };
  const activeMultipliers = (multipliers || activeThresholds.multipliers)
    .map((value) => Math.max(1, Number(value) || 1))
    .filter((value, index, values) => values.indexOf(value) === index);
  const rows = activeMultipliers.map((multiplier) => {
    const result = runBacktest({
      candlesByAsset,
      strategy,
      assets,
      config: {
        ...config,
        feeRate: config.feeRate * multiplier,
        slippageRate: config.slippageRate * multiplier,
      },
    });
    return summarizeStressRow(multiplier, result);
  });
  const summary = {
    ok: rows.length > 0,
    thresholds: activeThresholds,
    multipliers: activeMultipliers,
    rows,
    worstReturn: rows.length ? Math.min(...rows.map((row) => row.strategyReturn)) : 0,
    worstEdge: rows.length ? Math.min(...rows.map((row) => row.edge)) : 0,
    worstDrawdown: rows.length ? Math.max(...rows.map((row) => row.maxDrawdown)) : 0,
    worstProfitFactor: rows.length ? Math.min(...rows.map((row) => finiteProfitFactor(row.profitFactor))) : 0,
    maxFeesPaid: rows.length ? Math.max(...rows.map((row) => row.feesPaid)) : 0,
    maxSlippagePaid: rows.length ? Math.max(...rows.map((row) => row.slippagePaid)) : 0,
  };
  const checks = buildChecks(summary, activeThresholds);
  const failed = checks.filter((check) => !check.pass);
  const severeFailure = failed.some((check) => (
    check.id === 'cost-stress-return'
    || check.id === 'cost-stress-edge'
    || check.id === 'cost-stress-profit-factor'
  ));

  return {
    ...summary,
    checks,
    failed,
    verdict: failed.length === 0 ? 'PASS' : !severeFailure && failed.length <= 1 ? 'WATCH' : 'FAIL',
    message: failed.length === 0
      ? 'Kostenstress groen: kandidaat blijft overeind bij slechtere fee/slippage.'
      : `Kostenstress niet groen: ${failed.map((check) => check.label).join(', ')}.`,
  };
}
