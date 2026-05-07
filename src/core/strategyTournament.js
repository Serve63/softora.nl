import { SUPPORTED_ASSETS } from '../data/binanceProvider.js';
import frozenCandidate from '../strategies/frozenCandidate.js';
import sprintRotation from '../strategies/sprintRotation.js';
import trendParticipation from '../strategies/trendParticipation.js';
import { runBacktest } from './backtester.js';
import { runResearchDiagnostics } from './researchEngine.js';
import { DEFAULT_CONFIG } from './riskEngine.js';
import { runRollingWalkForward } from './walkForward.js';

export const TOURNAMENT_STRATEGIES = Object.freeze([
  frozenCandidate,
  trendParticipation,
  sprintRotation,
]);

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n.v.t.';
  return `${(value * 100).toFixed(1)}%`;
}

function finiteProfitFactor(value) {
  if (value === Number.POSITIVE_INFINITY) return 8;
  return Number.isFinite(value) ? value : 0;
}

function makeCheck(id, label, pass, detail) {
  return { id, label, pass, detail };
}

function buildTournamentChecks({ full, diagnostics, walkForward, config }) {
  const summary = walkForward?.summary;
  const checks = [
    makeCheck(
      'full-edge',
      'Volledige sample verslaat buy-and-hold',
      full.ok && full.strategyReturn > full.benchmarkReturn,
      `${formatPercent(full.strategyReturn)} vs ${formatPercent(full.benchmarkReturn)}`,
    ),
    makeCheck(
      'oos-edge',
      'Recente OOS verslaat benchmark',
      full.ok && full.oosReturn > full.oosBenchmarkReturn,
      `${formatPercent(full.oosReturn)} vs ${formatPercent(full.oosBenchmarkReturn)}`,
    ),
    makeCheck(
      'rolling-edge',
      'Rolling walk-forward verslaat benchmark',
      Boolean(summary) && summary.strategyCompoundReturn > summary.benchmarkCompoundReturn,
      summary
        ? `${formatPercent(summary.strategyCompoundReturn)} vs ${formatPercent(summary.benchmarkCompoundReturn)}`
        : walkForward?.error || 'Geen rolling summary beschikbaar.',
    ),
    makeCheck(
      'rolling-beat-rate',
      'Rolling beat-rate is voldoende',
      Boolean(summary) && summary.beatRate >= config.minWalkForwardBeatRate,
      summary
        ? `${formatPercent(summary.beatRate)} minimum ${formatPercent(config.minWalkForwardBeatRate)}`
        : walkForward?.error || 'Geen rolling summary beschikbaar.',
    ),
    makeCheck(
      'drawdown',
      'Drawdown blijft binnen doel',
      full.ok
        && full.maxDrawdown <= config.maxDrawdownTarget
        && (!summary || summary.maxFoldDrawdown <= config.maxDrawdownTarget),
      `${formatPercent(full.maxDrawdown)} full · ${summary ? formatPercent(summary.maxFoldDrawdown) : 'n.v.t.'} rolling`,
    ),
    makeCheck(
      'profit-factor',
      'Profit factor haalt minimum',
      full.ok && full.profitFactor >= config.minProfitFactor,
      `${Number.isFinite(full.profitFactor) ? full.profitFactor.toFixed(2) : 'oneindig'} minimum ${config.minProfitFactor.toFixed(2)}`,
    ),
    makeCheck(
      'cost-stress',
      'Dubbele fee/slippage blijft acceptabel',
      diagnostics?.costStressReturn > 0 && diagnostics?.stressEdge > -0.1,
      `${formatPercent(diagnostics?.costStressReturn)} stress-return, edge ${formatPercent(diagnostics?.stressEdge)}`,
    ),
    makeCheck(
      'current-exposure',
      'Huidige risk engine exposure > 0',
      (full.preGateSignal?.risk?.exposure || full.preGateSignal?.exposure || 0) > 0,
      `${formatPercent(full.preGateSignal?.risk?.exposure || full.preGateSignal?.exposure || 0)} exposure`,
    ),
  ];

  return checks;
}

function scoreTournamentRow({ full, diagnostics, walkForward, checks, config }) {
  const summary = walkForward?.summary;
  if (!full.ok || !summary) return Number.NEGATIVE_INFINITY;

  const failedHistoricalChecks = checks.filter((check) => check.id !== 'current-exposure' && !check.pass);
  const rollingEdge = summary.strategyCompoundReturn - summary.benchmarkCompoundReturn;
  const fullEdge = full.strategyReturn - full.benchmarkReturn;
  const drawdownPenalty = Math.max(0, full.maxDrawdown - config.maxDrawdownTarget) * 7
    + Math.max(0, summary.maxFoldDrawdown - config.maxDrawdownTarget) * 7;
  const profitQuality = Math.min(3, finiteProfitFactor(full.profitFactor)) * 0.18;
  const stressQuality = Math.max(-0.5, diagnostics?.stressEdge ?? 0) * 0.4;
  const passBonus = failedHistoricalChecks.length === 0 ? 2 : 0;

  return rollingEdge
    + summary.strategyCompoundReturn * 0.35
    + fullEdge * 0.25
    + summary.beatRate * 0.85
    + profitQuality
    + stressQuality
    + passBonus
    - drawdownPenalty
    - failedHistoricalChecks.length * 0.35;
}

function verdictFromChecks(checks) {
  const failedHistoricalChecks = checks.filter((check) => check.id !== 'current-exposure' && !check.pass);
  const currentExposureCheck = checks.find((check) => check.id === 'current-exposure');

  if (!failedHistoricalChecks.length && currentExposureCheck?.pass) return 'GATE_OPEN';
  if (!failedHistoricalChecks.length) return 'RESEARCH_PASS_CASH';
  if (failedHistoricalChecks.length <= 2) return 'WATCH';
  return 'REJECT';
}

function summarizeStrategy({ strategy, candlesByAsset, baseConfig, assets, walkForwardOptions }) {
  const config = { ...DEFAULT_CONFIG, ...baseConfig };
  const full = runBacktest({
    candlesByAsset,
    config,
    strategy,
    assets,
  });
  const diagnostics = runResearchDiagnostics({
    candlesByAsset,
    config,
    baseResult: full,
    strategy,
    assets,
  });
  const walkForward = runRollingWalkForward({
    candlesByAsset,
    baseConfig: config,
    strategy,
    assets,
    ...(walkForwardOptions || {}),
  });
  const checks = buildTournamentChecks({ full, diagnostics, walkForward, config });
  const verdict = verdictFromChecks(checks);
  const score = scoreTournamentRow({ full, diagnostics, walkForward, checks, config });

  return {
    strategyName: strategy.name,
    verdict,
    score,
    checks,
    failed: checks.filter((check) => !check.pass),
    full,
    diagnostics,
    walkForward,
    strategyReturn: full.strategyReturn,
    benchmarkReturn: full.benchmarkReturn,
    oosReturn: full.oosReturn,
    oosBenchmarkReturn: full.oosBenchmarkReturn,
    maxDrawdown: full.maxDrawdown,
    profitFactor: full.profitFactor,
    currentSignal: full.currentSignal,
    rolling: walkForward.summary,
  };
}

export function runStrategyTournament({
  candlesByAsset,
  baseConfig = {},
  strategies = TOURNAMENT_STRATEGIES,
  assets = SUPPORTED_ASSETS,
  walkForwardOptions = {},
} = {}) {
  const startedAt = Date.now();
  const rows = strategies
    .map((strategy) => summarizeStrategy({
      strategy,
      candlesByAsset,
      baseConfig,
      assets,
      walkForwardOptions,
    }))
    .sort((a, b) => b.score - a.score);

  const best = rows[0] || null;
  const deployable = rows.find((row) => row.verdict === 'GATE_OPEN') || null;
  const researchPass = rows.find((row) => row.verdict === 'RESEARCH_PASS_CASH' || row.verdict === 'GATE_OPEN') || null;
  const rollingLeader = [...rows]
    .filter((row) => row.rolling)
    .sort((a, b) => b.rolling.strategyCompoundReturn - a.rolling.strategyCompoundReturn)[0] || null;

  return {
    ok: rows.length > 0,
    startedAt,
    finishedAt: Date.now(),
    best,
    deployable,
    researchPass,
    rollingLeader,
    rows,
    message: deployable
      ? `${deployable.strategyName} heeft de tournament gate open.`
      : researchPass
        ? `${researchPass.strategyName} passeert historisch, maar het actuele signaal blijft cash.`
        : 'Geen strategie passeert de volledige tournament gate.',
  };
}
