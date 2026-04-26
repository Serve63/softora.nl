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
  isFrontendProductionPath,
  isHighRiskPath,
  isProtectedFrontendShellPath,
  isProtectedQualityGatePath,
  isTestPath,
  listAddedBrowserStorageApis,
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

function getDiffArgsForPath(filePath) {
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
  .map((filePath) => {
    const diffArgs = getDiffArgsForPath(filePath);
    const diffText = diffArgs ? tryRunGit(diffArgs) : '';
    const apis = listAddedBrowserStorageApis(diffText);
    if (apis.length === 0) return '';
    return `${filePath} (${apis.join(', ')})`;
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
  largeInlineScriptViolations,
  protectedFrontendShellFiles,
  protectedQualityGateFiles,
  behaviorDiffLineCount,
  maxBehaviorDiffLineCount: Number(process.env.GUARDRAILS_MAX_BEHAVIOR_DIFF_LINES || 900),
  allowUntestedChanges: toBooleanEnv('ALLOW_UNTESTED_CHANGES'),
  allowNoRuntimeBackup: toBooleanEnv('SKIP_RUNTIME_BACKUP_CHECK'),
  allowServerJsGrowth: toBooleanEnv('ALLOW_SERVER_JS_GROWTH'),
  allowServerJsFunctions: toBooleanEnv('ALLOW_SERVER_JS_FUNCTIONS'),
  allowNonstandardServerFiles: toBooleanEnv('ALLOW_NONSTANDARD_SERVER_FILES'),
  allowBrowserStorage: toBooleanEnv('ALLOW_BROWSER_STORAGE'),
  allowLargeInlineScript: toBooleanEnv('ALLOW_LARGE_INLINE_SCRIPT'),
  allowUntestedShellChange: toBooleanEnv('ALLOW_UNTESTED_SHELL_CHANGE'),
  allowUntestedQualityGateChange: toBooleanEnv('ALLOW_UNTESTED_QUALITY_GATE_CHANGE'),
  allowLargeBehaviorChange: toBooleanEnv('ALLOW_LARGE_BEHAVIOR_CHANGE'),
});

if (changedFiles.length > 0) {
  console.log(`[guardrails] Changed files: ${changedFiles.join(', ')}`);
} else {
  console.log('[guardrails] Geen lokale of laatste-commit diff gevonden; alleen statische guardrails gecontroleerd.');
}

if (violations.length > 0) {
  violations.forEach((message) => console.error(message));
  process.exit(1);
}

console.log('[guardrails] Agent guardrails zijn geslaagd.');
