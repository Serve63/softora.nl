import { runChampionAudit } from '../src/core/championAudit.js';
import { fetchMarketData, SUPPORTED_ASSETS } from '../src/data/binanceProvider.js';
import { FROZEN_INCUBATION_CANDIDATE } from '../src/forward/forwardRunner.js';
import costAwareTailGuard from '../src/strategies/costAwareTailGuard.js';
import convexBreakout from '../src/strategies/convexBreakout.js';
import frozenCandidate from '../src/strategies/frozenCandidate.js';
import sprintRotation from '../src/strategies/sprintRotation.js';
import tailConvexMeta from '../src/strategies/tailConvexMeta.js';
import tailGuard from '../src/strategies/tailGuard.js';
import { strategyForName } from '../src/strategies/registry.js';

function pct(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null;
}

function pf(value) {
  if (value === Number.POSITIVE_INFINITY) return 'infinite';
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function num(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function summarizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    strategyName: row.strategyName,
    source: row.source,
    ok: row.ok,
    score: num(row.score),
    returnPct: pct(row.strategyReturn),
    benchmarkPct: pct(row.benchmarkReturn),
    oosReturnPct: pct(row.oosReturn),
    oosBenchmarkPct: pct(row.oosBenchmarkReturn),
    oosEdgePct: pct(row.oosEdge),
    maxDrawdownPct: pct(row.maxDrawdown),
    profitFactor: pf(row.profitFactor),
    currentExposurePct: pct(row.currentRiskExposure),
    currentSignal: row.currentSignal?.label || 'CASH',
    replay: {
      verdict: row.replay?.verdict || 'FAIL',
      returnPct: pct(row.replay?.return || 0),
      edgePct: pct(row.replay?.edge || 0),
      maxDrawdownPct: pct(row.replay?.maxDrawdown || 0),
      gateOpenRatePct: pct(row.replay?.gateOpenRate || 0),
      latestSignal: row.replay?.latestSignal || 'CASH',
      failed: row.replay?.failed || [],
    },
    multiWindow: {
      verdict: row.multiWindow?.verdict || 'FAIL',
      windows: row.multiWindow?.windows || 0,
      positiveRatePct: pct(row.multiWindow?.positiveRate || 0),
      beatRatePct: pct(row.multiWindow?.beatRate || 0),
      worstReturnPct: pct(row.multiWindow?.worstReturn || 0),
      worstDrawdownPct: pct(row.multiWindow?.worstDrawdown || 0),
      failed: row.multiWindow?.failed || [],
    },
  };
}

function challenger(id, label, strategy, config, source = 'strategy-shelf') {
  return {
    id,
    label,
    strategyName: strategy.name,
    strategy,
    source,
    paperOnly: true,
    config,
  };
}

const baseConfig = {
  ...FROZEN_INCUBATION_CANDIDATE.config,
  initialCapital: 10000,
  feeRate: 0.001,
  slippageRate: 0.0005,
  oosRatio: 0.25,
  minWalkForwardBeatRate: 0.5,
};
const defensiveConfig = {
  ...baseConfig,
  targetVolatility: Math.min(baseConfig.targetVolatility || 0.03, 0.025),
  emergencyDrawdownStop: Math.min(baseConfig.emergencyDrawdownStop || 0.18, 0.12),
  assetCap: Math.min(baseConfig.assetCap || 0.35, 0.25),
};

const market = await fetchMarketData({
  assets: SUPPORTED_ASSETS,
  timeframe: baseConfig.timeframe,
  target: baseConfig.candleTarget || 3000,
});
const championStrategy = strategyForName(FROZEN_INCUBATION_CANDIDATE.strategyName);

if (!championStrategy) {
  console.log(JSON.stringify({
    ok: false,
    mode: 'champion-audit',
    paperOnly: true,
    autoPromote: false,
    error: `Onbekende frozen champion-strategie: ${FROZEN_INCUBATION_CANDIDATE.strategyName}.`,
  }, null, 2));
  process.exitCode = 1;
} else if (market.errors.length) {
  console.log(JSON.stringify({
    ok: false,
    mode: 'champion-audit',
    paperOnly: true,
    autoPromote: false,
    error: 'Binance data niet volledig beschikbaar; champion audit is niet gedraaid.',
    errors: market.errors,
  }, null, 2));
  process.exitCode = 1;
} else {
  const audit = runChampionAudit({
    candlesByAsset: market.candlesByAsset,
    assets: SUPPORTED_ASSETS,
    baseConfig,
    champion: {
      ...FROZEN_INCUBATION_CANDIDATE,
      strategy: championStrategy,
      source: 'frozen-forward-champion',
      config: baseConfig,
    },
    challengers: [
      challenger('frozen-candidate-current', 'Frozen Candidate current config', frozenCandidate, baseConfig),
      challenger('sprint-rotation-current', 'Sprint Rotation current config', sprintRotation, baseConfig),
      challenger('tail-guard-current', 'Tail Guard current config', tailGuard, baseConfig),
      challenger('tail-guard-defensive', 'Tail Guard defensive config', tailGuard, defensiveConfig),
      challenger('cost-aware-tail-guard-current', 'Cost Aware Tail Guard current config', costAwareTailGuard, baseConfig),
      challenger('convex-breakout-current', 'Convex Breakout current config', convexBreakout, baseConfig),
      challenger('tail-convex-meta-current', 'Tail Convex Meta current config', tailConvexMeta, baseConfig),
      challenger('tail-convex-meta-defensive', 'Tail Convex Meta defensive config', tailConvexMeta, defensiveConfig),
    ],
    options: {
      minReturnLift: Number(process.env.CHAMPION_AUDIT_MIN_RETURN_LIFT || 0.05),
      minOosLift: Number(process.env.CHAMPION_AUDIT_MIN_OOS_LIFT || 0),
      minProfitFactor: Number(process.env.CHAMPION_AUDIT_MIN_PROFIT_FACTOR || baseConfig.minProfitFactor || 1.65),
      maxDrawdownWorsening: Number(process.env.CHAMPION_AUDIT_MAX_DD_WORSENING || 0.01),
      maxReplacementDrawdown: Math.min(baseConfig.maxDrawdownTarget || 0.3, 0.3),
      maxLogs: Number(process.env.CHAMPION_AUDIT_MAX_LOGS || 120),
      replayBars: Number(process.env.CHAMPION_AUDIT_REPLAY_BARS || 1200),
      windowCount: Number(process.env.CHAMPION_AUDIT_WINDOW_COUNT || 4),
      windowLogs: Number(process.env.CHAMPION_AUDIT_WINDOW_LOGS || 45),
    },
  });

  console.log(JSON.stringify({
    ok: audit.ok,
    mode: audit.mode,
    paperOnly: true,
    autoPromote: false,
    verdict: audit.verdict,
    action: audit.action,
    message: audit.message,
    champion: summarizeRow(audit.champion),
    leader: summarizeRow(audit.leader),
    replacement: summarizeRow(audit.replacement),
    replacementChecks: audit.replacementChecks.map((check) => ({
      id: check.id,
      pass: check.pass,
      detail: check.detail,
    })),
    failed: audit.failed.map((check) => check.id),
    skippedDuplicates: audit.skippedDuplicates.map((row) => row.label),
    rows: audit.rows.slice(0, 8).map(summarizeRow),
    note: 'Paper trading / educatie. Geen echte orders, geen leverage, geen financieel advies.',
  }, null, 2));
}
