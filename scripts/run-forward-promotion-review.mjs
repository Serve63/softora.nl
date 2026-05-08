import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePromotionGate } from '../src/forward/promotionGate.js';
import { FROZEN_INCUBATION_CANDIDATE } from '../src/forward/forwardRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const championStatePath = process.env.PAPER_FORWARD_STATE_PATH
  ? path.resolve(process.env.PAPER_FORWARD_STATE_PATH)
  : path.join(repoRoot, '.paper-forward-state.json');
const watchlistStatePath = process.env.PAPER_WATCHLIST_FORWARD_STATE_PATH
  ? path.resolve(process.env.PAPER_WATCHLIST_FORWARD_STATE_PATH)
  : path.join(repoRoot, '.paper-watchlist-forward-state.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function pct(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null;
}

function summarizeMetrics(metrics) {
  return {
    candidate: metrics.candidate?.label || metrics.candidate?.id || 'n.v.t.',
    logs: metrics.logs,
    signal: metrics.latestSignal,
    gateOpen: metrics.latestGateOpen,
    returnPct: pct(metrics.paperReturn),
    benchmarkPct: pct(metrics.benchmarkReturn),
    edgePct: pct(metrics.edge),
    maxDrawdownPct: pct(metrics.maxDrawdown),
    gateOpenRatePct: pct(metrics.gateOpenRate),
  };
}

const championState = readJson(championStatePath);
const watchlistState = readJson(watchlistStatePath);
const watchlistConfig = {
  ...FROZEN_INCUBATION_CANDIDATE.config,
  ...(watchlistState?.candidate?.config || {}),
  initialCapital: watchlistState?.initialCapital || championState?.initialCapital || 10000,
};
const championConfig = {
  ...FROZEN_INCUBATION_CANDIDATE.config,
  initialCapital: championState?.initialCapital || 10000,
};

const review = evaluatePromotionGate({
  championState,
  challengerState: watchlistState,
  championConfig,
  challengerConfig: watchlistConfig,
});

console.log(JSON.stringify({
  ok: true,
  mode: 'paper-forward-promotion-review',
  paperOnly: true,
  autoPromote: false,
  championStatePath,
  watchlistStatePath,
  verdict: review.verdict,
  message: review.message,
  champion: summarizeMetrics(review.champion),
  watchlist: summarizeMetrics(review.challenger),
  edgeOverChampionPct: pct(review.edgeOverChampion),
  edgeOverBenchmarkPct: pct(review.edgeOverBenchmark),
  failed: review.failed.map((check) => check.id),
  checks: review.checks.map((check) => ({
    id: check.id,
    active: check.active,
    pass: check.pass,
    detail: check.detail,
  })),
}, null, 2));
