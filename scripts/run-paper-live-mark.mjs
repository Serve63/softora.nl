import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTickerPrices, SUPPORTED_ASSETS } from '../src/data/binanceProvider.js';
import {
  calculateLiveMarkToMarket,
  FROZEN_INCUBATION_CANDIDATE,
} from '../src/forward/forwardRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const statePath = process.env.PAPER_FORWARD_STATE_PATH
  ? path.resolve(process.env.PAPER_FORWARD_STATE_PATH)
  : path.join(repoRoot, '.paper-forward-state.json');

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

function money(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

const state = readJson(statePath);
const prices = await fetchTickerPrices({ assets: SUPPORTED_ASSETS });

if (!state) {
  console.log(JSON.stringify({
    ok: false,
    mode: 'paper-live-mark-to-market',
    paperOnly: true,
    error: 'Nog geen paper-forward state gevonden.',
    statePath,
  }, null, 2));
  process.exitCode = 1;
} else if (!prices.ok) {
  console.log(JSON.stringify({
    ok: false,
    mode: 'paper-live-mark-to-market',
    paperOnly: true,
    error: 'Binance live prijzen niet volledig beschikbaar.',
    errors: prices.errors,
    statePath,
  }, null, 2));
  process.exitCode = 1;
} else {
  const mark = calculateLiveMarkToMarket({
    state,
    prices: prices.prices,
    assets: SUPPORTED_ASSETS,
    config: {
      ...FROZEN_INCUBATION_CANDIDATE.config,
      initialCapital: state.initialCapital || 10000,
    },
    timestamp: prices.timestamp,
  });

  console.log(JSON.stringify({
    ok: mark.ok,
    mode: 'paper-live-mark-to-market',
    paperOnly: true,
    statePath,
    timestamp: mark.timestamp,
    lastLogTime: mark.lastLogTime,
    lastSignal: mark.lastSignal,
    logs: mark.logs,
    paperEquity: money(mark.paperEquity),
    benchmarkEquity: money(mark.benchmarkEquity),
    paperPnL: money(mark.paperEquity - (state.initialCapital || 10000)),
    benchmarkPnL: money(mark.benchmarkEquity - (state.initialCapital || 10000)),
    edgeMoney: money(mark.edgeMoney),
    paperReturnPct: pct(mark.paperReturn),
    benchmarkReturnPct: pct(mark.benchmarkReturn),
    edgePct: pct(mark.edge),
    paperUnrealizedSinceLog: money(mark.paperUnrealizedSinceLog),
    benchmarkUnrealizedSinceLog: money(mark.benchmarkUnrealizedSinceLog),
    weights: mark.lastWeights,
    prices: mark.livePrices,
    note: 'Live waardering op echte Binance tickerprijzen. Geen nieuwe trade, geen echte order, paper-only.',
    error: mark.error || undefined,
  }, null, 2));

  if (!mark.ok) process.exitCode = 1;
}
