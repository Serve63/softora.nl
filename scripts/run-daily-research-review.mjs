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

function latestCandleTime(candlesByAsset) {
  const candles = candlesByAsset?.BTCUSDT || [];
  return candles[candles.length - 1]?.time || Date.now();
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
      signal: review.challenger.currentSignal,
    } : null,
    action: review.action,
    verdict: review.verdict,
    failed: review.failed.map((check) => check.id),
    checks: review.checks.map((check) => ({
      id: check.id,
      pass: check.pass,
      detail: check.detail,
    })),
    reviews: logResult.state.reviews.length,
    pendingChallenger: Boolean(logResult.state.pendingChallenger),
  }, null, 2));
}
