#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildGuardrailViolations,
  countAddedServerJsFunctions,
  countDiffLines,
  isBehaviorChangePath,
  isFrontendProductionPath,
  isHighRiskPath,
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

function readServerJsLineCount() {
  const serverPath = path.join(repoRoot, 'server.js');
  if (!fs.existsSync(serverPath)) return 0;
  return fs.readFileSync(serverPath, 'utf8').split('\n').length;
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

const violations = buildGuardrailViolations({
  changedFiles,
  addedFiles,
  changedTests,
  highRiskFiles,
  behaviorFiles,
  newestBackupAgeMs: getNewestRuntimeBackupAgeMs(),
  maxLocalBackupAgeMs: Number(process.env.GUARDRAILS_MAX_BACKUP_AGE_MS || 12 * 60 * 60 * 1000),
  isCi: toBooleanEnv('CI'),
  serverJsLineCount: readServerJsLineCount(),
  maxServerJsLines: Number(process.env.GUARDRAILS_MAX_SERVER_JS_LINES || 7500),
  serverJsNetGrowth: Math.max(0, serverJsCounts.additions - serverJsCounts.deletions),
  maxServerJsNetGrowth: Number(process.env.GUARDRAILS_MAX_SERVER_JS_NET_GROWTH || 25),
  addedServerJsFunctions: countAddedServerJsFunctions(serverJsDiffText),
  browserStorageViolations,
  allowUntestedChanges: toBooleanEnv('ALLOW_UNTESTED_CHANGES'),
  allowNoRuntimeBackup: toBooleanEnv('SKIP_RUNTIME_BACKUP_CHECK'),
  allowServerJsGrowth: toBooleanEnv('ALLOW_SERVER_JS_GROWTH'),
  allowServerJsFunctions: toBooleanEnv('ALLOW_SERVER_JS_FUNCTIONS'),
  allowNonstandardServerFiles: toBooleanEnv('ALLOW_NONSTANDARD_SERVER_FILES'),
  allowBrowserStorage: toBooleanEnv('ALLOW_BROWSER_STORAGE'),
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
