import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMarketData, SUPPORTED_ASSETS } from '../src/data/binanceProvider.js';
import { runReplayVariantLab } from '../src/forward/replayVariantLab.js';
import { FROZEN_INCUBATION_CANDIDATE } from '../src/forward/forwardRunner.js';
import { loadImprovementState } from '../src/storage/localStore.js';
import costAwareTailGuard from '../src/strategies/costAwareTailGuard.js';
import convexBreakout from '../src/strategies/convexBreakout.js';
import frozenCandidate from '../src/strategies/frozenCandidate.js';
import sprintRotation from '../src/strategies/sprintRotation.js';
import tailConvexMeta from '../src/strategies/tailConvexMeta.js';
import tailGuard from '../src/strategies/tailGuard.js';
import trendParticipation from '../src/strategies/trendParticipation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const researchStatePath = process.env.PAPER_RESEARCH_STATE_PATH
  ? path.resolve(process.env.PAPER_RESEARCH_STATE_PATH)
  : path.join(repoRoot, '.paper-research-state.json');

function createFileStorage(filePath) {
  return {
    getItem() {
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    setItem(_key, value) {
      fs.writeFileSync(filePath, String(value));
    },
    removeItem() {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },
  };
}

function strategyForName(name) {
  if (name === frozenCandidate.name) return frozenCandidate;
  if (name === sprintRotation.name) return sprintRotation;
  if (name === tailGuard.name) return tailGuard;
  if (name === costAwareTailGuard.name) return costAwareTailGuard;
  if (name === convexBreakout.name) return convexBreakout;
  if (name === tailConvexMeta.name) return tailConvexMeta;
  if (name === trendParticipation.name) return trendParticipation;
  return null;
}

function pct(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null;
}

function num(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function summarizeRow(row) {
  const summary = row.multiWindow?.summary || {};
  return {
    source: row.source,
    verdict: row.verdict,
    score: num(row.score),
    config: {
      rebalanceBars: row.config.rebalanceBars,
      emergencyDrawdownStop: row.config.emergencyDrawdownStop,
      targetVolatility: row.config.targetVolatility,
      assetCap: row.config.assetCap,
      scoreThreshold: row.config.scoreThreshold,
    },
    passRatePct: pct(summary.passRate || 0),
    positiveRatePct: pct(summary.positiveRate || 0),
    beatRatePct: pct(summary.beatRate || 0),
    averageReturnPct: pct(summary.averageReturn || 0),
    medianReturnPct: pct(summary.medianReturn || 0),
    worstReturnPct: pct(summary.worstReturn || 0),
    worstDrawdownPct: pct(summary.worstDrawdown || 0),
    averageGateOpenRatePct: pct(summary.averageGateOpenRate || 0),
    totalTrades: summary.totalTrades || 0,
  };
}

function buildCandidate(challenger) {
  if (!challenger) {
    return {
      ...FROZEN_INCUBATION_CANDIDATE,
      strategyName: trendParticipation.name,
    };
  }

  return {
    id: challenger.id,
    label: challenger.label || `${challenger.strategyName} Watchlist`,
    strategyName: challenger.strategyName,
    source: challenger.source || 'watch',
    paperOnly: true,
    config: {
      ...FROZEN_INCUBATION_CANDIDATE.config,
      ...(challenger.config || {}),
    },
  };
}

const improvementState = loadImprovementState(createFileStorage(researchStatePath));
const challenger = improvementState?.pendingChallenger || improvementState?.watchlistChallenger || null;
const candidate = buildCandidate(challenger);
const strategy = strategyForName(candidate.strategyName);

if (!strategy) {
  console.log(JSON.stringify({
    ok: false,
    error: `Onbekende strategie voor replay variant lab: ${candidate.strategyName}.`,
    researchStatePath,
  }, null, 2));
  process.exitCode = 1;
} else {
  const config = {
    ...candidate.config,
    initialCapital: 10000,
    feeRate: 0.001,
    slippageRate: 0.0005,
    oosRatio: 0.25,
    minWalkForwardBeatRate: 0.5,
  };
  const market = await fetchMarketData({
    assets: SUPPORTED_ASSETS,
    timeframe: config.timeframe,
    target: config.candleTarget || 3000,
  });

  if (market.errors.length) {
    console.log(JSON.stringify({
      ok: false,
      error: 'Binance data niet volledig beschikbaar; replay variant lab is niet gedraaid.',
      errors: market.errors,
      researchStatePath,
    }, null, 2));
    process.exitCode = 1;
  } else {
    const lab = runReplayVariantLab({
      candlesByAsset: market.candlesByAsset,
      strategy,
      assets: SUPPORTED_ASSETS,
      baseConfig: config,
      maxVariants: Number(process.env.REPLAY_VARIANT_LIMIT || 4),
      windowCount: Number(process.env.REPLAY_WINDOW_COUNT || 6),
      windowLogs: Number(process.env.REPLAY_WINDOW_LOGS || 60),
      replayRules: {
        minLogs: Number(process.env.REPLAY_WINDOW_MIN_LOGS || 30),
        maxDrawdown: Math.min(config.emergencyDrawdownStop || 0.18, 0.12),
        maxLossBeforeFail: -0.06,
        minGateOpenRate: 0.02,
      },
      multiWindowRules: {
        minWindows: Number(process.env.REPLAY_MIN_WINDOWS || 4),
        minPassRate: Number(process.env.REPLAY_MIN_PASS_RATE || 0.5),
        minPositiveRate: Number(process.env.REPLAY_MIN_POSITIVE_RATE || 0.5),
        minBeatRate: Number(process.env.REPLAY_MIN_BEAT_RATE || 0.6),
        maxWorstDrawdown: Math.min(config.emergencyDrawdownStop || 0.18, 0.12),
        maxWorstReturn: -0.06,
      },
      rules: {
        minScoreLift: Number(process.env.REPLAY_VARIANT_MIN_SCORE_LIFT || 0.08),
        maxWorstReturnWorsening: 0.01,
        maxDrawdownWorsening: 0.01,
      },
    });

    console.log(JSON.stringify({
      ok: lab.ok,
      mode: 'replay-variant-lab',
      paperOnly: true,
      autoPromote: false,
      researchStatePath,
      candidate: {
        id: candidate.id,
        label: candidate.label,
        strategyName: candidate.strategyName,
        source: candidate.source || 'champion',
      },
      verdict: lab.verdict,
      improvement: lab.improvement,
      tested: lab.tested,
      message: lab.message,
      baseline: summarizeRow(lab.baseline),
      best: summarizeRow(lab.best),
      rows: lab.rows.slice(0, 6).map(summarizeRow),
      note: 'Dit lab zoekt alleen paper-varianten. Het promoot niets automatisch en plaatst geen orders.',
    }, null, 2));
  }
}
