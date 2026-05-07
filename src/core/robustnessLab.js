import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { runBacktest } from './backtester.js';
import { DEFAULT_CONFIG } from './riskEngine.js';

export const DEFAULT_ROBUSTNESS_THRESHOLDS = Object.freeze({
  minPassRate: 0.35,
  minMedianProfitFactor: 1.65,
  minMedianEdge: 0,
  minMedianOosEdge: 0,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniqueRounded(values, digits = 4) {
  return [...new Set(values.map((value) => Number(value.toFixed(digits))))];
}

function cartesianProduct(grid) {
  const keys = Object.keys(grid);
  return keys.reduce((rows, key) => rows.flatMap((row) => (
    grid[key].map((value) => ({ ...row, [key]: value }))
  )), [{}]);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function finiteProfitFactor(value) {
  if (value === Number.POSITIVE_INFINITY) return 8;
  return Number.isFinite(value) ? value : 0;
}

export function buildRobustnessGrid(config = DEFAULT_CONFIG) {
  const activeConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    rebalanceBars: uniqueRounded([
      Math.max(18, activeConfig.rebalanceBars - 30),
      activeConfig.rebalanceBars,
      activeConfig.rebalanceBars + 30,
    ], 0),
    scoreThreshold: uniqueRounded([
      clamp(activeConfig.scoreThreshold - 10, 20, 95),
      clamp(activeConfig.scoreThreshold, 20, 95),
      clamp(activeConfig.scoreThreshold + 10, 20, 95),
    ], 0),
    targetVolatility: uniqueRounded([
      clamp(activeConfig.targetVolatility * 0.75, 0.02, 0.16),
      clamp(activeConfig.targetVolatility, 0.02, 0.16),
      clamp(activeConfig.targetVolatility * 1.25, 0.02, 0.16),
    ]),
    emergencyDrawdownStop: uniqueRounded([
      clamp(activeConfig.emergencyDrawdownStop - 0.02, 0.12, 0.3),
      clamp(activeConfig.emergencyDrawdownStop, 0.12, 0.3),
      clamp(activeConfig.emergencyDrawdownStop + 0.02, 0.12, 0.3),
    ]),
    assetCap: uniqueRounded([
      clamp(activeConfig.assetCap - 0.1, 0.2, 0.8),
      clamp(activeConfig.assetCap, 0.2, 0.8),
      clamp(activeConfig.assetCap + 0.1, 0.2, 0.8),
    ]),
  };
}

function passesCoreGate(result, config) {
  const currentRiskExposure = result.preGateSignal?.risk?.exposure || result.preGateSignal?.exposure || 0;

  return result.ok
    && result.strategyReturn > result.benchmarkReturn
    && result.oosReturn > result.oosBenchmarkReturn
    && result.maxDrawdown <= config.maxDrawdownTarget
    && result.profitFactor >= config.minProfitFactor
    && currentRiskExposure > 0;
}

function summarizeVariant({ config, result }) {
  const edge = result.strategyReturn - result.benchmarkReturn;
  const oosEdge = result.oosReturn - result.oosBenchmarkReturn;

  return {
    config,
    pass: passesCoreGate(result, config),
    strategyReturn: result.strategyReturn,
    benchmarkReturn: result.benchmarkReturn,
    edge,
    oosReturn: result.oosReturn,
    oosBenchmarkReturn: result.oosBenchmarkReturn,
    oosEdge,
    maxDrawdown: result.maxDrawdown,
    profitFactor: result.profitFactor,
    trades: result.trades,
    currentSignal: result.currentSignal,
  };
}

function buildChecks(summary, thresholds) {
  return [
    {
      id: 'robust-pass-rate',
      label: 'Genoeg nabije varianten blijven door de gate',
      pass: summary.passRate >= thresholds.minPassRate,
      detail: `${Math.round(summary.passRate * 100)}% minimum ${Math.round(thresholds.minPassRate * 100)}%`,
    },
    {
      id: 'robust-median-pf',
      label: 'Mediane profit factor blijft hoog genoeg',
      pass: summary.medianProfitFactor >= thresholds.minMedianProfitFactor,
      detail: `${summary.medianProfitFactor.toFixed(2)} minimum ${thresholds.minMedianProfitFactor.toFixed(2)}`,
    },
    {
      id: 'robust-median-edge',
      label: 'Mediane edge blijft positief',
      pass: summary.medianEdge >= thresholds.minMedianEdge,
      detail: `${(summary.medianEdge * 100).toFixed(1)}%`,
    },
    {
      id: 'robust-median-oos-edge',
      label: 'Mediane OOS-edge blijft positief',
      pass: summary.medianOosEdge >= thresholds.minMedianOosEdge,
      detail: `${(summary.medianOosEdge * 100).toFixed(1)}%`,
    },
    {
      id: 'robust-worst-drawdown',
      label: 'Slechtste buur blijft binnen drawdownlimiet',
      pass: summary.worstDrawdown <= summary.config.maxDrawdownTarget,
      detail: `${(summary.worstDrawdown * 100).toFixed(1)}% limiet ${(summary.config.maxDrawdownTarget * 100).toFixed(1)}%`,
    },
  ];
}

export function runParameterRobustness({
  candlesByAsset,
  strategy,
  baseConfig = {},
  assets = SUPPORTED_ASSETS,
  grid,
  thresholds = DEFAULT_ROBUSTNESS_THRESHOLDS,
} = {}) {
  const config = { ...DEFAULT_CONFIG, ...baseConfig };
  const activeThresholds = { ...DEFAULT_ROBUSTNESS_THRESHOLDS, ...thresholds };
  const variants = cartesianProduct(grid || buildRobustnessGrid(config));
  const rows = variants.map((variant) => {
    const variantConfig = { ...config, ...variant };
    const result = runBacktest({
      candlesByAsset,
      config: variantConfig,
      strategy,
      assets,
    });
    return summarizeVariant({ config: variantConfig, result });
  });

  const passedRows = rows.filter((row) => row.pass);
  const best = [...rows].sort((a, b) => (
    (b.pass ? 1 : 0) - (a.pass ? 1 : 0)
    || finiteProfitFactor(b.profitFactor) - finiteProfitFactor(a.profitFactor)
    || b.edge - a.edge
  ))[0] || null;
  const summary = {
    ok: true,
    config,
    tested: rows.length,
    passed: passedRows.length,
    passRate: rows.length ? passedRows.length / rows.length : 0,
    medianProfitFactor: median(rows.map((row) => finiteProfitFactor(row.profitFactor))),
    medianEdge: median(rows.map((row) => row.edge)),
    medianOosEdge: median(rows.map((row) => row.oosEdge)),
    worstDrawdown: rows.length ? Math.max(...rows.map((row) => row.maxDrawdown)) : 0,
    best,
    rows: rows.sort((a, b) => (
      (b.pass ? 1 : 0) - (a.pass ? 1 : 0)
      || finiteProfitFactor(b.profitFactor) - finiteProfitFactor(a.profitFactor)
      || b.edge - a.edge
    )),
  };
  const checks = buildChecks(summary, activeThresholds);
  const failed = checks.filter((check) => !check.pass);

  return {
    ...summary,
    thresholds: activeThresholds,
    checks,
    failed,
    verdict: failed.length === 0 ? 'PASS' : failed.length <= 2 ? 'WATCH' : 'FAIL',
    message: failed.length === 0
      ? 'Robustness gate groen: de kandidaat blijft werken rond nabije instellingen.'
      : `Robustness gate niet groen: ${failed.map((check) => check.label).join(', ')}.`,
  };
}
