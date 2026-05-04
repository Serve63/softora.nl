#!/usr/bin/env node
const { assertLiveProductionVersion } = require('./check-live-production-version');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 1000;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveWaitConfig(env = process.env) {
  const timeoutMs = parsePositiveInteger(env.LIVE_PRODUCTION_WAIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const intervalMs = parsePositiveInteger(env.LIVE_PRODUCTION_WAIT_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  return {
    intervalMs,
    maxAttempts: Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1),
  };
}

async function waitForLiveProductionVersion(options = {}) {
  const assertFn = options.assertFn || assertLiveProductionVersion;
  const sleep =
    options.sleep ||
    ((ms) => {
      return new Promise((resolve) => setTimeout(resolve, ms));
    });
  const maxAttempts = options.maxAttempts || resolveWaitConfig(options.env).maxAttempts;
  const intervalMs = options.intervalMs || resolveWaitConfig(options.env).intervalMs;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = assertFn();
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const message = String(error && error.message ? error.message : error).split('\n')[0];
      console.log(
        `[live-production] Nog niet op de nieuwste main (${message}). Nieuwe poging ${attempt + 1}/${maxAttempts}...`
      );
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `[live-production] www.softora.nl is na ${maxAttempts} pogingen niet exact gelijk aan origin/main.\n${String(
      lastError && lastError.message ? lastError.message : lastError
    )}`
  );
}

async function runCli() {
  try {
    const result = await waitForLiveProductionVersion();
    const refLabel = result.liveRef ? ` (${result.liveRef})` : '';
    console.log(
      `[live-production] www.softora.nl draait exact op origin/main na ${result.attempts} poging(en): ${result.liveSha}${refLabel}.`
    );
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  parsePositiveInteger,
  resolveWaitConfig,
  waitForLiveProductionVersion,
};
