#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildGuardrailViolations,
  countAddedInlineScriptLines,
  countAddedServerJsFunctions,
  countDiffLines,
  isBehaviorChangePath,
  isApprovedBrowserStoragePath,
  isFrontendProductionPath,
  isHighRiskPath,
  isPremiumAuthUsersWriteScanPath,
  isProtectedFrontendShellPath,
  isProtectedQualityGatePath,
  isTestPath,
  listAddedBrowserStorageApis,
  listAddedPremiumAuthUsersWriteRisks,
  listAddedTestWeakeningPatterns,
  normalizeRepoPath,
} = require('./lib/agent-guardrails-core');

const repoRoot = path.resolve(__dirname, '..');
process.chdir(repoRoot);

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryRunGit(args) {
  try {
    return runGit(args);
  } catch (_error) {
    return '';
  }
}

function hasLocalWorkingTreeChanges() {
  return Boolean(tryRunGit(['status', '--porcelain']));
}

let guardrailDiffBaseRef;
function getGuardrailDiffBaseRef() {
  if (guardrailDiffBaseRef !== undefined) return guardrailDiffBaseRef;

  const explicitBase = String(process.env.GUARDRAILS_BASE_REF || '').trim();
  const githubBase = String(process.env.GITHUB_BASE_REF || '').trim();
  const candidates = [
    explicitBase,
    githubBase ? `origin/${githubBase}` : '',
    'origin/main',
  ].filter(Boolean);

  const baseRef = candidates.find((candidate) =>
    Boolean(tryRunGit(['rev-parse', '--verify', `${candidate}^{commit}`]))
  );
  if (!baseRef) {
    guardrailDiffBaseRef = '';
    return guardrailDiffBaseRef;
  }

  const mergeBase = tryRunGit(['merge-base', baseRef, 'HEAD']);
  guardrailDiffBaseRef = mergeBase || '';
  return guardrailDiffBaseRef;
}

function getDiffArgsForPath(filePath) {
  const branchDiffBase = getGuardrailDiffBaseRef();
  if (branchDiffBase) {
    return ['diff', '--unified=0', branchDiffBase, '--', filePath];
  }

  if (hasLocalWorkingTreeChanges()) {
    return ['diff', '--unified=0', 'HEAD', '--', filePath];
  }
  const hasParent = Boolean(tryRunGit(['rev-parse', '--verify', 'HEAD^']));
  if (hasParent) {
    return ['diff', '--unified=0', 'HEAD^', 'HEAD', '--', filePath];
  }
  return null;
}

function getChangedFiles() {
  const untracked = tryRunGit(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .map(normalizeRepoPath)
    .filter(Boolean);

  const branchDiffBase = getGuardrailDiffBaseRef();
  if (branchDiffBase) {
    const branchChanges = tryRunGit(['diff', '--name-only', '--diff-filter=ACMR', branchDiffBase, '--'])
      .split('\n')
      .map(normalizeRepoPath)
      .filter(Boolean);
    return Array.from(new Set([...branchChanges, ...untracked])).sort();
  }

  const workingTreeChanges = tryRunGit(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '--'])
    .split('\n')
    .map(normalizeRepoPath)
    .filter(Boolean);

  if (workingTreeChanges.length > 0 || untracked.length > 0) {
    return Array.from(new Set([...workingTreeChanges, ...untracked])).sort();
  }

  const hasParent = Boolean(tryRunGit(['rev-parse', '--verify', 'HEAD^']));
  if (!hasParent) return [];

  return tryRunGit(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD^', 'HEAD', '--'])
    .split('\n')
    .map(normalizeRepoPath)
    .filter(Boolean)
    .sort();
}

function getAddedFiles() {
  const untracked = tryRunGit(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .map(normalizeRepoPath)
    .filter(Boolean);

  const branchDiffBase = getGuardrailDiffBaseRef();
  if (branchDiffBase) {
    const branchAdded = tryRunGit(['diff', '--name-only', '--diff-filter=A', branchDiffBase, '--'])
      .split('\n')
      .map(normalizeRepoPath)
      .filter(Boolean);
    return Array.from(new Set([...branchAdded, ...untracked])).sort();
  }

  const addedFromHead = tryRunGit(['diff', '--name-only', '--diff-filter=A', 'HEAD', '--'])
    .split('\n')
    .map(normalizeRepoPath)
    .filter(Boolean);

  if (addedFromHead.length > 0 || untracked.length > 0) {
    return Array.from(new Set([...addedFromHead, ...untracked])).sort();
  }

  const hasParent = Boolean(tryRunGit(['rev-parse', '--verify', 'HEAD^']));
  if (!hasParent) return untracked;

  return tryRunGit(['diff', '--name-only', '--diff-filter=A', 'HEAD^', 'HEAD', '--'])
    .split('\n')
    .map(normalizeRepoPath)
    .filter(Boolean)
    .sort();
}

function getNewestRuntimeBackupAgeMs() {
  const backupsDir = path.join(repoRoot, 'backups');
  if (!fs.existsSync(backupsDir)) return null;

  const newestMtimeMs = fs
    .readdirSync(backupsDir)
    .filter((fileName) => /^runtime-backup-.*\.json$/i.test(fileName))
    .map((fileName) => fs.statSync(path.join(backupsDir, fileName)).mtimeMs)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];

  if (!Number.isFinite(newestMtimeMs)) return null;
  return Math.max(0, Date.now() - newestMtimeMs);
}

function readRepoFileLineCount(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, 'utf8').split('\n').length;
}

function readRepoFile(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function getQualityBaselineViolations() {
  const violations = [];

  let packageJson = null;
  try {
    packageJson = JSON.parse(readRepoFile('package.json') || '{}');
  } catch (_error) {
    violations.push('package.json is geen geldige JSON');
  }

  const requiredScripts = {
    'check:guardrails': 'node scripts/check-agent-guardrails.js',
    'check:deps': 'npm audit --omit=dev',
    'check:public-data': 'node scripts/check-public-data-exposure.js',
    'check:repo-hygiene': 'bash scripts/check-repo-hygiene.sh',
    'check:quality-lock': 'node scripts/check-quality-lock.js',
    'clean:local': 'bash scripts/clean-local-artifacts.sh',
    'test:contracts': 'node --test test/contracts/*.test.js',
    'test:smoke': 'node --test test/smoke/*.test.js',
    'check:secrets': 'node scripts/check-tracked-secrets.js',
    'verify:critical': 'node scripts/verify-critical.js',
  };

  Object.entries(requiredScripts).forEach(([name, expected]) => {
    const actual = packageJson?.scripts?.[name];
    if (actual !== expected) {
      violations.push(`package.json script "${name}" moet "${expected}" blijven`);
    }
  });

  if (packageJson?.engines?.node !== '22.x') {
    violations.push('package.json engines.node moet 22.x blijven');
  }
  if (readRepoFile('.nvmrc').trim() !== '22') {
    violations.push('.nvmrc moet Node 22 vastzetten');
  }

  const verifyCriticalSource = readRepoFile('scripts/verify-critical.js');
  [
    'check:guardrails',
    'check:repo-hygiene',
    'check:public-data',
    'check:deps',
    'check:quality-lock',
    'test:contracts',
    'test:smoke',
    'check:secrets',
  ].forEach((scriptName) => {
    const pattern = new RegExp(`\\['run',\\s*'${scriptName.replace(':', '\\:')}'\\]`);
    if (!pattern.test(verifyCriticalSource)) {
      violations.push(`scripts/verify-critical.js mist npm run ${scriptName}`);
    }
  });

  const workflowExpectations = [
    {
      filePath: '.github/workflows/agent-guardrails.yml',
      required: [/push:/, /pull_request:/, /branches:[\s\S]*-\s+main/, /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v7\./, /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v7\./, /node-version:\s*22\b/, /npm run check:guardrails/],
    },
    {
      filePath: '.github/workflows/verify-critical.yml',
      required: [/push:/, /pull_request:/, /branches:[\s\S]*-\s+main/, /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v7\./, /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v7\./, /node-version:\s*22\b/, /npm run verify:critical/],
    },
    {
      filePath: '.github/workflows/live-production-version.yml',
      required: [/push:/, /branches:[\s\S]*-\s+main/, /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v7\./, /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v7\./, /node-version:\s*22\b/, /npm run check:live-production-version:wait/],
    },
    {
      filePath: '.github/workflows/repo-hygiene.yml',
      required: [/push:/, /pull_request:/, /branches:[\s\S]*-\s+main/, /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v7\./, /bash scripts\/check-repo-hygiene\.sh/],
    },
  ];

  workflowExpectations.forEach(({ filePath, required }) => {
    const source = readRepoFile(filePath);
    if (!source) {
      violations.push(`${filePath} ontbreekt`);
      return;
    }

    required.forEach((pattern) => {
      if (!pattern.test(source)) {
        violations.push(`${filePath} mist verplichte workflow-baseline ${pattern}`);
      }
    });
  });

  const protocolExpectations = [
    {
      filePath: 'AGENTS.md',
      required: [
        /npm run verify:critical/,
        /Commit en push elke succesvolle wijziging/,
        /npm run check:guardrails/,
        /npm run check:deps/,
        /npm run check:public-data/,
        /npm run check:quality-lock/,
        /allerlaatste actuele `origin\/main`/,
        /Deploy nooit vanuit een oude lokale kopie/,
        /recente live wijzigingen behouden blijven/,
      ],
    },
    {
      filePath: 'docs/quality-protocol.md',
      required: [
        /Definition Of Done/,
        /npm run verify:critical/,
        /check:deps/,
        /check:public-data/,
        /check:guardrails/,
        /check:quality-lock/,
        /direct gecommit en gepusht/,
        /allerlaatste actuele `origin\/main`/,
        /Oude lokale kopieen/,
        /Recente live wijzigingen mogen niet verdwijnen/,
      ],
    },
    {
      filePath: 'docs/repo-map.md',
      required: [/scripts\/check-agent-guardrails\.js/, /scripts\/check-quality-lock\.js/, /\.github\/workflows\/verify-critical\.yml/],
    },
  ];

  protocolExpectations.forEach(({ filePath, required }) => {
    const source = readRepoFile(filePath);
    if (!source) {
      violations.push(`${filePath} ontbreekt`);
      return;
    }

    required.forEach((pattern) => {
      if (!pattern.test(source)) {
        violations.push(`${filePath} mist verplichte protocol-baseline ${pattern}`);
      }
    });
  });

  return violations;
}

function getOutboundDuplicateSafetyViolations() {
  const violations = [];
  const agentsSource = readRepoFile('AGENTS.md');
  const instantlyRoutesSource = readRepoFile('server/routes/instantly.js');
  const instantlyServiceSource = readRepoFile('server/services/instantly-outreach.js');
  const coldmailServiceSource = readRepoFile('server/services/coldmail-campaign.js');

  if (!/provider-sync[\s\S]*maintenance\/reconcile\/cleanup/i.test(agentsSource)) {
    violations.push('AGENTS.md mist de regel dat provider-sync/instantly-sync geen nieuwe leads mag toevoegen');
  }

  const instantlySyncHandlerSource =
    instantlyRoutesSource.match(/async function handleSync[\s\S]*?async function handleStatus/)?.[0] || '';
  if (/limit:\s*body\.limit/.test(instantlySyncHandlerSource)) {
    violations.push('server/routes/instantly.js mag body.limit niet doorgeven aan legacy Instantly sync-routes');
  }
  if (!/syncInstantlyLeads\(\{[\s\S]*reconcileOnly:\s*true[\s\S]*\}\)/.test(instantlySyncHandlerSource)) {
    violations.push('server/routes/instantly.js moet legacy Instantly sync-routes maintenance-only houden met reconcileOnly: true');
  }

  if (!/syncInstantlyLeads\(\{\s*actor:\s*'Instantly autopilot',\s*reconcileOnly:\s*true\s*\}\)/.test(instantlyServiceSource)) {
    violations.push('Instantly autopilot mag alleen read-only/reconcile sync draaien');
  }

  const addLeadsIndex = instantlyServiceSource.indexOf('const data = await addLeadsToInstantly(leads);');
  const centralInstantlyReserveIndex = addLeadsIndex >= 0
    ? instantlyServiceSource.lastIndexOf('reserveSupabaseOutboundRecipientsForInstantly(sendableRows', addLeadsIndex)
    : -1;
  if (addLeadsIndex >= 0 && centralInstantlyReserveIndex < 0) {
    violations.push('Instantly /leads/add mag niet bereikbaar zijn zonder centrale outbound-reservering');
  }

  if (/return\s+\{\s*ok:\s*false,\s*skipped:\s*true\s*\};/.test(
    coldmailServiceSource.match(/async function reserveSupabaseOutboundRecipientForColdmail[\s\S]*?async function confirmSupabaseOutboundRecipientForColdmail/)?.[0] || ''
  )) {
    violations.push('Coldmail mag bij ontbrekende centrale outbound guard niet stil overslaan; hij moet stoppen vóór SMTP');
  }
  if (!/COLDMAIL_OUTBOUND_GUARD_UNAVAILABLE/.test(coldmailServiceSource)) {
    violations.push('Coldmail mist harde foutcode voor ontbrekende centrale outbound guard');
  }

  return violations;
}

function getMissingRequiredRepoFiles() {
  return [
    'AGENTS.md',
    'docs/repo-map.md',
    'docs/architecture.md',
    'docs/quality-protocol.md',
    'server/routes/manifest.js',
  ].filter((relativePath) => !fs.existsSync(path.join(repoRoot, relativePath)));
}

function toBooleanEnv(name) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

const changedFiles = getChangedFiles();
const addedFiles = getAddedFiles();
const changedTests = changedFiles.filter(isTestPath);
const behaviorFiles = changedFiles.filter(isBehaviorChangePath);
const highRiskFiles = changedFiles.filter(isHighRiskPath);

const serverJsDiffArgs = getDiffArgsForPath('server.js');
const serverJsDiffText = serverJsDiffArgs ? tryRunGit(serverJsDiffArgs) : '';
const serverJsCounts = countDiffLines(serverJsDiffText);
const browserStorageViolations = changedFiles
  .filter(isFrontendProductionPath)
  .filter((filePath) => !isApprovedBrowserStoragePath(filePath))
  .map((filePath) => {
    const diffArgs = getDiffArgsForPath(filePath);
    const diffText = diffArgs ? tryRunGit(diffArgs) : '';
    const apis = listAddedBrowserStorageApis(diffText);
    if (apis.length === 0) return '';
    return `${filePath} (${apis.join(', ')})`;
  })
  .filter(Boolean);

const testWeakeningViolations = changedFiles
  .filter(isTestPath)
  .map((filePath) => {
    const diffArgs = getDiffArgsForPath(filePath);
    const diffText = diffArgs ? tryRunGit(diffArgs) : '';
    const hits = listAddedTestWeakeningPatterns(diffText);
    if (hits.length === 0) return '';
    return `${filePath} (${hits.join(', ')})`;
  })
  .filter(Boolean);

const premiumAuthUsersWriteViolations = changedFiles
  .filter(
    (filePath) =>
      isPremiumAuthUsersWriteScanPath(filePath) &&
      !isTestPath(filePath) &&
      !isProtectedQualityGatePath(filePath)
  )
  .map((filePath) => {
    const diffArgs = getDiffArgsForPath(filePath);
    const diffText = diffArgs ? tryRunGit(diffArgs) : '';
    const hits = listAddedPremiumAuthUsersWriteRisks(diffText);
    if (hits.length === 0) return '';
    return `${filePath} (${hits.join(', ')})`;
  })
  .filter(Boolean);

const inlineScriptLimit = Number(process.env.GUARDRAILS_MAX_INLINE_SCRIPT_ADDITIONS || 80);
const largeInlineScriptViolations = changedFiles
  .filter((filePath) => /^[^/]+\.html$/i.test(filePath))
  .map((filePath) => {
    const diffArgs = getDiffArgsForPath(filePath);
    const diffText = diffArgs ? tryRunGit(diffArgs) : '';
    const absolutePath = path.join(repoRoot, filePath);
    const fileSource = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
    const addedInlineScriptLines = countAddedInlineScriptLines(diffText, fileSource);
    if (addedInlineScriptLines <= inlineScriptLimit) return '';
    return `${filePath} (${addedInlineScriptLines} inline scriptregels toegevoegd; limiet ${inlineScriptLimit})`;
  })
  .filter(Boolean);

const oversizedFrontendLineLimit = Number(process.env.GUARDRAILS_MAX_FRONTEND_FILE_LINES || 1200);
const oversizedFrontendNetGrowthLimit = Number(process.env.GUARDRAILS_MAX_OVERSIZED_FRONTEND_NET_GROWTH || 0);
const oversizedFrontendGrowthViolations = changedFiles
  .filter(isFrontendProductionPath)
  .map((filePath) => {
    const lineCount = readRepoFileLineCount(filePath);
    if (lineCount <= oversizedFrontendLineLimit) return '';
    const diffArgs = getDiffArgsForPath(filePath);
    const diffText = diffArgs ? tryRunGit(diffArgs) : '';
    const counts = countDiffLines(diffText);
    const netGrowth = counts.additions - counts.deletions;
    if (netGrowth <= oversizedFrontendNetGrowthLimit) return '';
    return `${filePath} (${lineCount} regels; netto +${netGrowth}; limiet ${oversizedFrontendLineLimit} regels en max +${oversizedFrontendNetGrowthLimit})`;
  })
  .filter(Boolean);

function diffTouchesPremiumShell(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (isProtectedFrontendShellPath(normalized)) return true;
  if (!/^premium-[^/]+\.html$/i.test(normalized)) return false;
  const diffArgs = getDiffArgsForPath(normalized);
  const diffText = diffArgs ? tryRunGit(diffArgs) : '';
  return /sidebar|data-sidebar-shell|data-static-sidebar|premium-sidebar-profile-prefill|dashboard-layout/i.test(diffText);
}

const protectedFrontendShellFiles = changedFiles.filter(diffTouchesPremiumShell);
const protectedQualityGateFiles = changedFiles.filter(isProtectedQualityGatePath);
const behaviorDiffLineCount = behaviorFiles.reduce((total, filePath) => {
  const diffArgs = getDiffArgsForPath(filePath);
  const diffText = diffArgs ? tryRunGit(diffArgs) : '';
  const counts = countDiffLines(diffText);
  return total + counts.additions + counts.deletions;
}, 0);

const violations = buildGuardrailViolations({
  changedFiles,
  addedFiles,
  changedTests,
  highRiskFiles,
  behaviorFiles,
  newestBackupAgeMs: getNewestRuntimeBackupAgeMs(),
  maxLocalBackupAgeMs: Number(process.env.GUARDRAILS_MAX_BACKUP_AGE_MS || 12 * 60 * 60 * 1000),
  isCi: toBooleanEnv('CI'),
  missingRequiredRepoFiles: getMissingRequiredRepoFiles(),
  serverJsLineCount: readRepoFileLineCount('server.js'),
  maxServerJsLines: Number(process.env.GUARDRAILS_MAX_SERVER_JS_LINES || 7500),
  serverAppRuntimeLineCount: readRepoFileLineCount('server/services/server-app-runtime.js'),
  maxServerAppRuntimeLines: Number(process.env.GUARDRAILS_MAX_SERVER_APP_RUNTIME_LINES || 1200),
  serverJsNetGrowth: Math.max(0, serverJsCounts.additions - serverJsCounts.deletions),
  maxServerJsNetGrowth: Number(process.env.GUARDRAILS_MAX_SERVER_JS_NET_GROWTH || 25),
  addedServerJsFunctions: countAddedServerJsFunctions(serverJsDiffText),
  browserStorageViolations,
  testWeakeningViolations,
  largeInlineScriptViolations,
  oversizedFrontendGrowthViolations,
  protectedFrontendShellFiles,
  protectedQualityGateFiles,
  qualityBaselineViolations: [
    ...getQualityBaselineViolations(),
    ...getOutboundDuplicateSafetyViolations(),
  ],
  premiumAuthUsersWriteViolations,
  behaviorDiffLineCount,
  maxBehaviorDiffLineCount: Number(process.env.GUARDRAILS_MAX_BEHAVIOR_DIFF_LINES || 900),
  allowUntestedChanges: toBooleanEnv('ALLOW_UNTESTED_CHANGES'),
  allowNoRuntimeBackup: toBooleanEnv('SKIP_RUNTIME_BACKUP_CHECK'),
  allowServerJsGrowth: toBooleanEnv('ALLOW_SERVER_JS_GROWTH'),
  allowServerJsFunctions: toBooleanEnv('ALLOW_SERVER_JS_FUNCTIONS'),
  allowNonstandardServerFiles: toBooleanEnv('ALLOW_NONSTANDARD_SERVER_FILES'),
  allowBrowserStorage: toBooleanEnv('ALLOW_BROWSER_STORAGE'),
  allowTestWeakening: toBooleanEnv('ALLOW_TEST_WEAKENING'),
  allowLargeInlineScript: toBooleanEnv('ALLOW_LARGE_INLINE_SCRIPT'),
  allowOversizedFrontendGrowth: toBooleanEnv('ALLOW_OVERSIZED_FRONTEND_GROWTH'),
  allowUntestedShellChange: toBooleanEnv('ALLOW_UNTESTED_SHELL_CHANGE'),
  allowUntestedQualityGateChange: toBooleanEnv('ALLOW_UNTESTED_QUALITY_GATE_CHANGE'),
  allowLargeBehaviorChange: toBooleanEnv('ALLOW_LARGE_BEHAVIOR_CHANGE'),
});

if (changedFiles.length > 0) {
  console.log(`[guardrails] Changed files: ${changedFiles.join(', ')}`);
} else {
  console.log('[guardrails] Geen lokale, branch- of laatste-commit diff gevonden; alleen statische guardrails gecontroleerd.');
}

if (violations.length > 0) {
  violations.forEach((message) => console.error(message));
  process.exit(1);
}

console.log('[guardrails] Agent guardrails zijn geslaagd.');
