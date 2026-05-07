import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest } from '../src/core/backtester.js';
import { fetchMarketData, SUPPORTED_ASSETS } from '../src/data/binanceProvider.js';
import {
  calculateForwardMetrics,
  evaluateForwardDiscipline,
  FROZEN_INCUBATION_CANDIDATE,
  loadOrCreateForwardState,
  logForwardSignal,
} from '../src/forward/forwardRunner.js';
import trendParticipation from '../src/strategies/trendParticipation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const statePath = process.env.PAPER_FORWARD_STATE_PATH
  ? path.resolve(process.env.PAPER_FORWARD_STATE_PATH)
  : path.join(repoRoot, '.paper-forward-state.json');

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
    error: 'Binance data niet volledig beschikbaar.',
    errors: market.errors,
  }, null, 2));
  process.exitCode = 1;
} else {
  const backtest = runBacktest({
    candlesByAsset: market.candlesByAsset,
    config,
    strategy: trendParticipation,
    assets: SUPPORTED_ASSETS,
  });

  if (!backtest.ok) {
    console.log(JSON.stringify({
      ok: false,
      logged: false,
      error: backtest.error || 'Backtest kon niet draaien.',
    }, null, 2));
    process.exitCode = 1;
  } else {
    const forwardState = loadOrCreateForwardState(config.initialCapital, storage);
    const logResult = logForwardSignal({
      state: forwardState,
      signal: backtest.currentSignal,
      backtest,
      candlesByAsset: market.candlesByAsset,
      assets: SUPPORTED_ASSETS,
      config,
      storage,
    });
    const metrics = calculateForwardMetrics(logResult.state, config);
    const discipline = evaluateForwardDiscipline(logResult.state, config);

    console.log(JSON.stringify({
      ok: true,
      logged: !logResult.skipped,
      skipped: logResult.skipped,
      message: logResult.message,
      statePath,
      candidate: FROZEN_INCUBATION_CANDIDATE.id,
      signal: backtest.currentSignal.label,
      gateOpen: backtest.gate.open,
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
