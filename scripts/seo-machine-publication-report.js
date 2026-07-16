#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  DEFAULT_ORIGIN,
  collectLivePublicationLedger,
} = require('../server/services/seo-machine-publication-ledger');
const {
  listLiveProductionVersionViolations,
} = require('./check-live-production-version');

const REPO_ROOT = path.resolve(__dirname, '..');

function resolveOriginMainCommit(options = {}) {
  return String(execFileSync('git', ['rev-parse', '--verify', 'origin/main'], {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const originArg = argv.find((arg) => arg.startsWith('--origin='));
  return {
    json: argv.includes('--json'),
    origin: originArg ? originArg.slice('--origin='.length) : DEFAULT_ORIGIN,
  };
}

function formatPublicationLedger(ledger) {
  const lines = [
    `[seo-publications] status=${ledger.status} live=${ledger.liveCommit || 'unknown'} expected=${ledger.expectedCommit || 'unknown'}`,
  ];
  for (const [days, window] of Object.entries(ledger.windows || {})) {
    lines.push(
      `[seo-publications] ${days}d qualifying=${window.qualifying} declared=${window.declared} `
      + `target=${window.target} deficit=${window.deficit}`
    );
    for (const item of window.items || []) {
      const failedChecks = Object.entries(item.checks || {}).filter(([, passed]) => !passed).map(([name]) => name);
      lines.push(
        `- ${item.publishedAt} ${item.path} ${item.qualifies ? 'LIVE' : `REJECTED(${failedChecks.join(',')})`}`
      );
    }
  }
  for (const error of ledger.errors || []) lines.push(`[seo-publications] P0: ${error}`);
  return lines.join('\n');
}

async function runSeoMachinePublicationReport(options = {}) {
  const liveVersion = options.liveVersion || listLiveProductionVersionViolations({
    domain: new URL(options.origin || DEFAULT_ORIGIN).hostname,
  });
  const expectedCommit = options.expectedCommit || liveVersion.expectedSha || resolveOriginMainCommit(options);
  if (!liveVersion.ok) {
    return {
      status: 'p0',
      generatedAt: new Date(options.now || Date.now()).toISOString(),
      origin: options.origin || DEFAULT_ORIGIN,
      expectedCommit,
      liveCommit: liveVersion.liveSha || '',
      errors: liveVersion.violations,
      windows: {},
    };
  }
  return collectLivePublicationLedger({
    expectedCommit,
    fetchImpl: options.fetchImpl,
    now: options.now,
    origin: options.origin || DEFAULT_ORIGIN,
    publicationPlan: options.publicationPlan,
    verifiedLiveCommit: liveVersion.liveSha,
    windows: options.windows,
  });
}

async function runCli() {
  const args = parseCliArgs();
  try {
    const ledger = await runSeoMachinePublicationReport({ origin: args.origin });
    console.log(args.json ? JSON.stringify(ledger, null, 2) : formatPublicationLedger(ledger));
    if (ledger.status !== 'ready') process.exit(1);
  } catch (error) {
    console.error(`[seo-publications] P0: ${error.message || String(error)}`);
    process.exit(1);
  }
}

if (require.main === module) runCli();

module.exports = {
  formatPublicationLedger,
  parseCliArgs,
  resolveOriginMainCommit,
  runSeoMachinePublicationReport,
};
