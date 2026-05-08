import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAcceleratedForwardReplay } from '../src/forward/acceleratedReplay.js';
import { FROZEN_INCUBATION_CANDIDATE } from '../src/forward/forwardRunner.js';
import { fetchMarketData, SUPPORTED_ASSETS } from '../src/data/binanceProvider.js';
import { loadImprovementState } from '../src/storage/localStore.js';
import costAwareTailGuard from '../src/strategies/costAwareTailGuard.js';
import frozenCandidate from '../src/strategies/frozenCandidate.js';
import sprintRotation from '../src/strategies/sprintRotation.js';
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
  if (name === trendParticipation.name) return trendParticipation;
  return null;
}

function pct(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null;
}

function num(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
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
    lockedAt: challenger.timestamp || new Date().toISOString(),
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
    error: `Onbekende replay-strategie: ${candidate.strategyName}.`,
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
      error: 'Binance data niet volledig beschikbaar; accelerated replay is niet gedraaid.',
      errors: market.errors,
      researchStatePath,
    }, null, 2));
    process.exitCode = 1;
  } else {
    const replay = runAcceleratedForwardReplay({
      candlesByAsset: market.candlesByAsset,
      strategy,
      assets: SUPPORTED_ASSETS,
      config,
      maxLogs: Number(process.env.REPLAY_MAX_LOGS || 180),
      replayBars: Number(process.env.REPLAY_BARS || 1500),
      logFrequency: process.env.REPLAY_LOG_FREQUENCY || 'daily',
      strictNoLookahead: process.env.REPLAY_STRICT_NO_LOOKAHEAD !== '0',
      rules: {
        minLogs: Number(process.env.REPLAY_MIN_LOGS || 60),
        maxDrawdown: Math.min(config.emergencyDrawdownStop || 0.18, 0.12),
        maxLossBeforeFail: -0.06,
        minGateOpenRate: 0.05,
      },
    });
    const metrics = replay.metrics || {};

    console.log(JSON.stringify({
      ok: replay.ok,
      mode: 'accelerated-forward-replay',
      paperOnly: true,
      strictNoLookahead: replay.strictNoLookahead,
      researchStatePath,
      candidate: {
        id: candidate.id,
        label: candidate.label,
        strategyName: candidate.strategyName,
        source: candidate.source || 'champion',
      },
      replay: {
        logs: metrics.logs || 0,
        startTime: metrics.startTime,
        endTime: metrics.endTime,
        returnPct: pct(metrics.paperReturn || 0),
        benchmarkPct: pct(metrics.benchmarkReturn || 0),
        edgePct: pct(metrics.edge || 0),
        maxDrawdownPct: pct(metrics.maxDrawdown || 0),
        benchmarkMaxDrawdownPct: pct(metrics.benchmarkMaxDrawdown || 0),
        gateOpenRatePct: pct(metrics.gateOpenRate || 0),
        trades: metrics.trades || 0,
        feesPaid: num(metrics.feesPaid || 0),
        slippagePaid: num(metrics.slippagePaid || 0),
        latestSignal: metrics.latestSignal || 'CASH',
      },
      verdict: replay.verdict,
      message: replay.discipline?.message || replay.error || 'n.v.t.',
      failed: replay.discipline?.failed?.map((check) => check.id) || [],
      checks: replay.discipline?.checks || [],
      note: 'Historische accelerated replay. Dit versnelt bewijs, maar vervangt echte forward-dagen niet.',
    }, null, 2));
    if (!replay.ok) process.exitCode = 1;
  }
}
