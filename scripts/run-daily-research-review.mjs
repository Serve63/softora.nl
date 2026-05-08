import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest } from '../src/core/backtester.js';
import {
  appendImprovementReview,
  createImprovementReview,
  normalizeImprovementState,
} from '../src/core/improvementLoop.js';
import { runProfitFactorLab } from '../src/core/profitFactorLab.js';
import { fetchMarketData, SUPPORTED_ASSETS } from '../src/data/binanceProvider.js';
import { FROZEN_INCUBATION_CANDIDATE } from '../src/forward/forwardRunner.js';
import {
  loadImprovementState,
  saveImprovementState,
} from '../src/storage/localStore.js';
import trendParticipation from '../src/strategies/trendParticipation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const statePath = process.env.PAPER_RESEARCH_STATE_PATH
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

function pct(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null;
}

function pf(value) {
  if (value === Number.POSITIVE_INFINITY) return 'infinite';
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function num(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function latestCandleTime(candlesByAsset) {
  const candles = candlesByAsset?.BTCUSDT || [];
  return candles[candles.length - 1]?.time || Date.now();
}

const DAILY_ROBUSTNESS_GRID = Object.freeze({
  rebalanceBars: [60, 90, 120],
  scoreThreshold: [65, 75],
  targetVolatility: [0.03, 0.04],
  emergencyDrawdownStop: [0.18, 0.2],
  assetCap: [0.35, 0.45],
});

const DAILY_PROFIT_FACTOR_GRID = Object.freeze({
  rebalanceBars: [90, 120],
  scoreThreshold: [70, 75],
  targetVolatility: [0.02, 0.025],
  emergencyDrawdownStop: [0.08, 0.1],
  assetCap: [0.2, 0.25],
});

function dailyLabOptions() {
  if (process.env.FULL_PAPER_RESEARCH === '1') return {};
  return {
    grid: DAILY_PROFIT_FACTOR_GRID,
    topN: 3,
    robustnessOptions: {
      grid: DAILY_ROBUSTNESS_GRID,
    },
  };
}

const config = {
  ...FROZEN_INCUBATION_CANDIDATE.config,
  initialCapital: 10000,
  feeRate: 0.001,
  slippageRate: 0.0005,
  oosRatio: 0.25,
  minWalkForwardBeatRate: 0.5,
};
const storage = createFileStorage(statePath);
const market = await fetchMarketData({
  assets: SUPPORTED_ASSETS,
  timeframe: config.timeframe,
  target: config.candleTarget,
});

if (market.errors.length) {
  console.log(JSON.stringify({
    ok: false,
    logged: false,
    error: 'Binance data niet volledig beschikbaar; improvement-review is niet bewaard.',
    errors: market.errors,
    statePath,
  }, null, 2));
  process.exitCode = 1;
} else {
  const championBacktest = runBacktest({
    candlesByAsset: market.candlesByAsset,
    config,
    strategy: trendParticipation,
    assets: SUPPORTED_ASSETS,
  });

  const lab = runProfitFactorLab({
    candlesByAsset: market.candlesByAsset,
    baseConfig: config,
    assets: SUPPORTED_ASSETS,
    ...dailyLabOptions(),
  });

  const review = createImprovementReview({
    asOf: latestCandleTime(market.candlesByAsset),
    timeframe: config.timeframe,
    championCandidate: FROZEN_INCUBATION_CANDIDATE,
    championBacktest,
    lab,
  });
  const previousState = normalizeImprovementState(loadImprovementState(storage), {
    championId: FROZEN_INCUBATION_CANDIDATE.id,
    initialCapital: config.initialCapital,
  });
  const logResult = appendImprovementReview({ state: previousState, review });
  saveImprovementState(logResult.state, storage);

  console.log(JSON.stringify({
    ok: true,
    logged: !logResult.skipped,
    skipped: logResult.skipped,
    message: logResult.message,
    statePath,
    mode: 'paper-research-only',
    researchDepth: process.env.FULL_PAPER_RESEARCH === '1' ? 'full' : 'daily-compact',
    autoPromote: false,
    champion: {
      id: review.champion.id,
      label: review.champion.label,
      returnPct: pct(review.champion.strategyReturn),
      benchmarkPct: pct(review.champion.benchmarkReturn),
      oosEdgePct: pct(review.champion.oosEdge),
      maxDrawdownPct: pct(review.champion.maxDrawdown),
      profitFactor: pf(review.champion.profitFactor),
      signal: review.champion.currentSignal,
    },
    challenger: review.challenger ? {
      strategyName: review.challenger.strategyName,
      verdict: review.challenger.verdict,
      returnPct: pct(review.challenger.strategyReturn),
      benchmarkPct: pct(review.challenger.benchmarkReturn),
      oosEdgePct: pct(review.challenger.oosEdge),
      maxDrawdownPct: pct(review.challenger.maxDrawdown),
      profitFactor: pf(review.challenger.profitFactor),
      robustness: review.challenger.robustness?.verdict || null,
      robustPassRatePct: pct(review.challenger.robustness?.passRate || 0),
      regime: review.challenger.regime?.verdict || null,
      regimeBeatRatePct: pct(review.challenger.regime?.segmentBeatRate || 0),
      regimeWorstEdgePct: pct(review.challenger.regime?.worstSegmentEdge || 0),
      coveredRegimes: review.challenger.regime?.coveredRegimes || 0,
      reality: review.challenger.reality?.verdict || null,
      realityPositiveEdgeRatePct: pct(review.challenger.reality?.positiveEdgeRate || 0),
      realityMedianEdgePct: pct(review.challenger.reality?.medianEdge || 0),
      realityTailEdgePct: pct(review.challenger.reality?.fifthPercentileEdge || 0),
      statistical: review.challenger.statistical?.verdict || null,
      trialCount: review.challenger.statistical?.trialCount || 0,
      sharpe: num(review.challenger.statistical?.sharpe),
      edgeSharpe: num(review.challenger.statistical?.edgeSharpe),
      deflatedSharpe: num(review.challenger.statistical?.deflatedSharpe),
      trialPenalty: num(review.challenger.statistical?.trialPenalty),
      costStress: review.challenger.costStress?.verdict || null,
      costStressReturnPct: pct(review.challenger.costStress?.worstReturn || 0),
      costStressEdgePct: pct(review.challenger.costStress?.worstEdge || 0),
      costStressMaxDrawdownPct: pct(review.challenger.costStress?.worstDrawdown || 0),
      costStressProfitFactor: pf(review.challenger.costStress?.worstProfitFactor),
      costStressFeesPaid: num(review.challenger.costStress?.maxFeesPaid),
      costStressSlippagePaid: num(review.challenger.costStress?.maxSlippagePaid),
      signal: review.challenger.currentSignal,
    } : null,
    action: review.action,
    verdict: review.verdict,
    failed: review.failed.map((check) => check.id),
    challengerFailed: review.challenger?.failed || [],
    checks: review.checks.map((check) => ({
      id: check.id,
      pass: check.pass,
      detail: check.detail,
    })),
    reviews: logResult.state.reviews.length,
    pendingChallenger: Boolean(logResult.state.pendingChallenger),
    watchlistChallenger: Boolean(logResult.state.watchlistChallenger),
  }, null, 2));
}
