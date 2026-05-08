import { spawn } from 'node:child_process';

const STEPS = Object.freeze([
  {
    id: 'research-review',
    label: 'Daily research review',
    args: ['scripts/run-daily-research-review.mjs'],
  },
  {
    id: 'watchlist-forward',
    label: 'Watchlist forward snapshot',
    args: ['scripts/run-watchlist-forward-snapshot.mjs'],
  },
  {
    id: 'accelerated-replay',
    label: 'Accelerated forward replay',
    args: ['scripts/run-accelerated-forward-replay.mjs'],
  },
  {
    id: 'promotion-review',
    label: 'Forward promotion review',
    args: ['scripts/run-forward-promotion-review.mjs'],
  },
]);

function parseJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function runNodeStep(step) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      const parsed = parseJsonOutput(stdout);
      resolve({
        id: step.id,
        label: step.label,
        ok: code === 0 && parsed?.ok !== false,
        exitCode: code,
        parsed,
        stderr: stderr.trim(),
      });
    });
  });
}

function stepSummary(result) {
  return {
    id: result.id,
    ok: result.ok,
    exitCode: result.exitCode,
    skipped: Boolean(result.parsed?.skipped),
    verdict: result.parsed?.verdict || null,
    message: result.parsed?.message || result.parsed?.discipline || result.stderr || 'Geen bericht.',
  };
}

function summarizeCycle(results) {
  const research = results.find((result) => result.id === 'research-review')?.parsed || {};
  const watchlist = results.find((result) => result.id === 'watchlist-forward')?.parsed || {};
  const replay = results.find((result) => result.id === 'accelerated-replay')?.parsed || {};
  const promotion = results.find((result) => result.id === 'promotion-review')?.parsed || {};
  const ok = results.every((result) => result.ok);
  const promotionVerdict = promotion.verdict || 'UNKNOWN';
  const action = !ok
    ? 'CHECK_DATA_OR_SCRIPT'
    : promotionVerdict === 'PROMOTE_READY'
      ? 'HUMAN_REVIEW_BEFORE_PROMOTION'
      : promotionVerdict === 'KILL_CHALLENGER'
        ? 'RESEARCH_NEW_CHALLENGER'
        : 'KEEP_INCUBATING';

  return {
    ok,
    mode: 'paper-research-cycle',
    paperOnly: true,
    autoPromote: false,
    action,
    steps: results.map(stepSummary),
    challenger: research.challenger ? {
      strategyName: research.challenger.strategyName,
      verdict: research.challenger.verdict,
      returnPct: research.challenger.returnPct,
      oosEdgePct: research.challenger.oosEdgePct,
      maxDrawdownPct: research.challenger.maxDrawdownPct,
      profitFactor: research.challenger.profitFactor,
      rollingReturnPct: research.challenger.rollingReturnPct,
      signal: research.challenger.signal,
    } : null,
    watchlist: watchlist.candidate ? {
      label: watchlist.candidate.label,
      signal: watchlist.signal,
      logs: watchlist.logs,
      verdict: watchlist.verdict,
      paperReturnPct: watchlist.paperReturnPct,
      benchmarkReturnPct: watchlist.benchmarkReturnPct,
      edgePct: watchlist.edgePct,
      maxDrawdownPct: watchlist.maxDrawdownPct,
    } : null,
    acceleratedReplay: replay.replay ? {
      verdict: replay.verdict,
      message: replay.message,
      logs: replay.replay.logs,
      returnPct: replay.replay.returnPct,
      benchmarkPct: replay.replay.benchmarkPct,
      edgePct: replay.replay.edgePct,
      maxDrawdownPct: replay.replay.maxDrawdownPct,
      gateOpenRatePct: replay.replay.gateOpenRatePct,
      latestSignal: replay.replay.latestSignal,
      failed: replay.failed || [],
    } : null,
    promotion: {
      verdict: promotion.verdict || null,
      message: promotion.message || null,
      failed: promotion.failed || [],
      edgeOverChampionPct: promotion.edgeOverChampionPct ?? null,
      edgeOverBenchmarkPct: promotion.edgeOverBenchmarkPct ?? null,
    },
    note: 'Paper trading / educatie. Geen echte orders, geen leverage, geen financieel advies.',
  };
}

const results = [];
for (const step of STEPS) {
  const result = await runNodeStep(step);
  results.push(result);
  if (!result.ok) break;
}

const summary = summarizeCycle(results);
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
