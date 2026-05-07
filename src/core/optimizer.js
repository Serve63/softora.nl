import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import { runBacktest } from './backtester.js';
import { runResearchDiagnostics } from './researchEngine.js';
import { DEFAULT_CONFIG } from './riskEngine.js';

export const DEFAULT_OPTIMIZER_GRID = Object.freeze({
  rebalanceBars: [21, 30, 45],
  emergencyDrawdownStop: [0.24, 0.26, 0.28],
  targetVolatility: [0.08, 0.09, 0.1, 0.12],
});

function cartesianProduct(grid) {
  const keys = Object.keys(grid);
  return keys.reduce((rows, key) => rows.flatMap((row) => (
    grid[key].map((value) => ({ ...row, [key]: value }))
  )), [{}]);
}

function finiteProfitFactor(value) {
  if (value === Number.POSITIVE_INFINITY) return 8;
  return Number.isFinite(value) ? value : 0;
}

function scoreCandidate({ result, diagnostics, config }) {
  const returnEdge = result.strategyReturn - result.benchmarkReturn;
  const stressEdge = diagnostics ? diagnostics.stressEdge : 0;
  const drawdownPenalty = Math.max(0, result.maxDrawdown - config.maxDrawdownTarget) * 7;
  const profitQuality = Math.min(3, finiteProfitFactor(result.profitFactor)) * 0.22;
  const oosEdge = result.oosReturn - result.oosBenchmarkReturn;
  const constraintBonus = diagnostics?.verdict === 'CANDIDATE' ? 1.2 : 0;

  return returnEdge
    + result.strategyReturn
    + Math.max(-0.4, oosEdge) * 0.9
    + result.walkForwardBeatRate * 0.5
    + profitQuality
    + Math.max(-0.4, stressEdge) * 0.45
    + constraintBonus
    - drawdownPenalty;
}

function summarizeCandidate({ config, result, diagnostics }) {
  return {
    config,
    score: scoreCandidate({ result, diagnostics, config: { ...DEFAULT_CONFIG, ...config } }),
    verdict: diagnostics?.verdict || 'UNSTRESSED',
    failed: diagnostics?.failed?.map((check) => check.id) || [],
    strategyReturn: result.strategyReturn,
    benchmarkReturn: result.benchmarkReturn,
    returnEdge: result.strategyReturn - result.benchmarkReturn,
    maxDrawdown: result.maxDrawdown,
    profitFactor: result.profitFactor,
    oosReturn: result.oosReturn,
    oosBenchmarkReturn: result.oosBenchmarkReturn,
    walkForwardBeatRate: result.walkForwardBeatRate,
    trades: result.trades,
    stressReturn: diagnostics?.costStressReturn ?? null,
    stressEdge: diagnostics?.stressEdge ?? null,
  };
}

export function optimizeStrategy({
  candlesByAsset,
  baseConfig = {},
  grid = DEFAULT_OPTIMIZER_GRID,
  strategy = frozenCandidate,
  assets = SUPPORTED_ASSETS,
  stressTop = 6,
} = {}) {
  const configs = cartesianProduct(grid).map((variant) => ({
    ...DEFAULT_CONFIG,
    ...baseConfig,
    ...variant,
  }));

  const baseRows = configs.map((config) => {
    const result = runBacktest({ candlesByAsset, config, strategy, assets });
    return summarizeCandidate({ config, result, diagnostics: null });
  }).sort((a, b) => b.score - a.score);

  const stressedRows = baseRows.slice(0, stressTop).map((row) => {
    const result = runBacktest({ candlesByAsset, config: row.config, strategy, assets });
    const diagnostics = runResearchDiagnostics({
      candlesByAsset,
      config: row.config,
      baseResult: result,
      strategy,
      assets,
    });
    return summarizeCandidate({ config: row.config, result, diagnostics });
  }).sort((a, b) => b.score - a.score);

  const best = stressedRows.find((row) => row.verdict === 'CANDIDATE') || stressedRows[0] || null;

  return {
    tested: configs.length,
    stressed: stressedRows.length,
    best,
    candidates: stressedRows,
    rejectedPreview: baseRows.slice(stressTop, stressTop + 6),
  };
}
