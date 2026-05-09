import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import { DEFAULT_CONFIG } from '../core/riskEngine.js';
import { runMultiWindowAcceleratedReplay } from './acceleratedReplay.js';

export const DEFAULT_REPLAY_VARIANT_GRID = Object.freeze({
  rebalanceBars: [90, 120],
  emergencyDrawdownStop: [0.08, 0.1],
  targetVolatility: [0.02, 0.025],
});

export const DEFAULT_REPLAY_VARIANT_RULES = Object.freeze({
  minScoreLift: 0.08,
  maxWorstReturnWorsening: 0.01,
  maxDrawdownWorsening: 0.01,
});

function cartesianProduct(grid) {
  const keys = Object.keys(grid);
  return keys.reduce((rows, key) => rows.flatMap((row) => (
    grid[key].map((value) => ({ ...row, [key]: value }))
  )), [{}]);
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function variantSignature(config = {}) {
  return [
    config.rebalanceBars,
    config.emergencyDrawdownStop,
    config.targetVolatility,
    config.assetCap,
    config.scoreThreshold,
  ].map((value) => (
    typeof value === 'number' ? value.toFixed(6) : String(value)
  )).join('|');
}

export function scoreReplayVariant(row) {
  const summary = row.multiWindow?.summary || {};
  const discipline = row.multiWindow?.discipline || {};
  const failPenalty = (discipline.failed?.length || 0) * 0.18;

  return finite(summary.averageReturn) * 2.4
    + finite(summary.medianReturn) * 2
    + finite(summary.averageEdge) * 0.45
    + finite(summary.positiveRate) * 0.55
    + finite(summary.beatRate) * 0.45
    + finite(summary.passRate) * 0.7
    - Math.max(0, -finite(summary.worstReturn)) * 1.4
    - finite(summary.worstDrawdown) * 1.2
    - failPenalty;
}

function summarizeVariant({ config, multiWindow, source }) {
  const row = {
    source,
    signature: variantSignature(config),
    config,
    verdict: multiWindow.verdict,
    multiWindow,
    score: 0,
  };
  row.score = scoreReplayVariant(row);
  return row;
}

function isMeaningfullyBetter({ row, baseline, rules }) {
  const summary = row.multiWindow.summary;
  const baselineSummary = baseline.multiWindow.summary;
  const scoreLift = row.score - baseline.score;
  const worstReturnWorsening = baselineSummary.worstReturn - summary.worstReturn;
  const drawdownWorsening = summary.worstDrawdown - baselineSummary.worstDrawdown;

  return scoreLift >= rules.minScoreLift
    && worstReturnWorsening <= rules.maxWorstReturnWorsening
    && drawdownWorsening <= rules.maxDrawdownWorsening;
}

export function runReplayVariantLab({
  candlesByAsset,
  strategy,
  baseConfig = {},
  assets = SUPPORTED_ASSETS,
  grid = DEFAULT_REPLAY_VARIANT_GRID,
  maxVariants = 8,
  windowCount = 6,
  windowLogs = 60,
  replayRules = {},
  multiWindowRules = {},
  rules = {},
} = {}) {
  const activeRules = { ...DEFAULT_REPLAY_VARIANT_RULES, ...rules };
  const config = { ...DEFAULT_CONFIG, ...baseConfig };
  const baselineReplay = runMultiWindowAcceleratedReplay({
    candlesByAsset,
    strategy,
    assets,
    config,
    windowCount,
    windowLogs,
    replayRules,
    multiWindowRules,
  });
  const baseline = summarizeVariant({
    config,
    multiWindow: baselineReplay,
    source: 'baseline',
  });
  const variants = cartesianProduct(grid)
    .map((variant) => ({ ...config, ...variant }))
    .filter((variant) => variantSignature(variant) !== baseline.signature)
    .slice(0, Math.max(0, Number(maxVariants) || 0));

  const rows = [
    baseline,
    ...variants.map((variant) => summarizeVariant({
      config: variant,
      multiWindow: runMultiWindowAcceleratedReplay({
        candlesByAsset,
        strategy,
        assets,
        config: variant,
        windowCount,
        windowLogs,
        replayRules,
        multiWindowRules,
      }),
      source: 'variant',
    })),
  ].sort((a, b) => b.score - a.score);

  const best = rows[0] || baseline;
  const improvement = best.signature !== baseline.signature
    && isMeaningfullyBetter({ row: best, baseline, rules: activeRules });
  const verdict = improvement
    ? 'IMPROVES'
    : baseline.multiWindow.verdict === 'PASS'
      ? 'BASELINE_OK'
      : 'NO_IMPROVEMENT';

  return {
    ok: true,
    verdict,
    tested: rows.length,
    baseline,
    best,
    improvement,
    rows,
    rules: activeRules,
    message: improvement
      ? 'Replay variant lab vond een betere variant voor menselijke review.'
      : 'Replay variant lab vond geen betekenisvol betere variant; baseline blijft research-spoor.',
  };
}
