import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest } from '../src/core/backtester.js';
import { fetchMarketData, SUPPORTED_ASSETS } from '../src/data/binanceProvider.js';
import {
  calculateForwardMetrics,
  evaluateForwardDiscipline,
  FROZEN_INCUBATION_CANDIDATE,
  loadOrCreateForwardStateForCandidate,
  logForwardSignal,
} from '../src/forward/forwardRunner.js';
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
const forwardStatePath = process.env.PAPER_WATCHLIST_FORWARD_STATE_PATH
  ? path.resolve(process.env.PAPER_WATCHLIST_FORWARD_STATE_PATH)
  : path.join(repoRoot, '.paper-watchlist-forward-state.json');

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

function pct(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null;
}

function pf(value) {
  if (value === Number.POSITIVE_INFINITY) return 'infinite';
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function strategyForName(name) {
  if (name === frozenCandidate.name) return frozenCandidate;
  if (name === sprintRotation.name) return sprintRotation;
  if (name === tailGuard.name) return tailGuard;
  if (name === costAwareTailGuard.name) return costAwareTailGuard;
  if (name === trendParticipation.name) return trendParticipation;
  return null;
}

function buildCandidate(challenger) {
  const config = {
    ...FROZEN_INCUBATION_CANDIDATE.config,
    ...(challenger.config || {}),
  };

  return {
    id: challenger.id,
    label: challenger.label || `${challenger.strategyName} Watchlist`,
    strategyName: challenger.strategyName,
    lockedAt: challenger.timestamp || new Date().toISOString(),
    source: challenger.source || 'watch',
    paperOnly: true,
    config,
  };
}

const researchStorage = createFileStorage(researchStatePath);
const improvementState = loadImprovementState(researchStorage);
const challenger = improvementState?.pendingChallenger || improvementState?.watchlistChallenger || null;

if (!challenger) {
  console.log(JSON.stringify({
    ok: true,
    logged: false,
    skipped: true,
    message: 'Geen pending of watchlist challenger gevonden om forward te loggen.',
    researchStatePath,
    forwardStatePath,
  }, null, 2));
} else {
  const strategy = strategyForName(challenger.strategyName);
  if (!strategy) {
    console.log(JSON.stringify({
      ok: false,
      logged: false,
      error: `Onbekende watchlist-strategie: ${challenger.strategyName}.`,
      researchStatePath,
      forwardStatePath,
    }, null, 2));
    process.exitCode = 1;
  } else {
    const candidate = buildCandidate(challenger);
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
        logged: false,
        error: 'Binance data niet volledig beschikbaar; watchlist-forward is niet bewaard.',
        errors: market.errors,
        researchStatePath,
        forwardStatePath,
      }, null, 2));
      process.exitCode = 1;
    } else {
      const backtest = runBacktest({
        candlesByAsset: market.candlesByAsset,
        config,
        strategy,
        assets: SUPPORTED_ASSETS,
      });
      const forwardStorage = createFileStorage(forwardStatePath);
      const forwardState = loadOrCreateForwardStateForCandidate(
        candidate,
        config.initialCapital,
        forwardStorage,
      );
      const logResult = logForwardSignal({
        state: forwardState,
        signal: backtest.currentSignal,
        backtest,
        candlesByAsset: market.candlesByAsset,
        assets: SUPPORTED_ASSETS,
        config,
        candidate,
        storage: forwardStorage,
      });
      const metrics = calculateForwardMetrics(logResult.state, config);
      const discipline = evaluateForwardDiscipline(logResult.state, config, {
        firstDecisionLogs: 15,
        promoteLogs: 45,
        minGateOpenRate: 0.35,
        maxForwardDrawdown: Math.min(config.emergencyDrawdownStop || 0.18, 0.12),
        maxLossBeforeReview: -0.06,
      });

      console.log(JSON.stringify({
        ok: true,
        logged: !logResult.skipped,
        skipped: logResult.skipped,
        message: logResult.message,
        mode: 'watchlist-paper-forward-only',
        researchStatePath,
        forwardStatePath,
        candidate: {
          id: candidate.id,
          label: candidate.label,
          strategyName: candidate.strategyName,
          source: candidate.source,
        },
        signal: backtest.currentSignal.label,
        gateOpen: backtest.gate.open,
        gateFailed: backtest.gate.failed.map((check) => check.id),
        backtest: {
          returnPct: pct(backtest.strategyReturn),
          benchmarkPct: pct(backtest.benchmarkReturn),
          oosPct: pct(backtest.oosReturn),
          oosBenchmarkPct: pct(backtest.oosBenchmarkReturn),
          maxDrawdownPct: pct(backtest.maxDrawdown),
          profitFactor: pf(backtest.profitFactor),
          trades: backtest.trades,
        },
        logs: metrics.logs,
        paperReturnPct: pct(metrics.paperReturn),
        benchmarkReturnPct: pct(metrics.benchmarkReturn),
        edgePct: pct(metrics.edge),
        maxDrawdownPct: pct(metrics.maxDrawdown),
        gateOpenRatePct: pct(metrics.gateOpenRate),
        verdict: discipline.verdict,
        discipline: discipline.message,
      }, null, 2));
    }
  }
}
