#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const ignoredDirNames = new Set([
  '.git',
  '.vercel',
  'backups',
  'node_modules',
  'output',
]);
const ignoreFileNames = new Set([
  '.env.example',
  'package-lock.json',
]);

const suspiciousPatterns = [
  { label: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { label: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g },
  { label: 'GitHub personal access token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { label: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { label: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
];

function isLikelyBinary(filePath) {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|mp3|mp4|woff2?)$/i.test(filePath);
}

function shouldIgnoreFile(filePath) {
  const baseName = path.basename(filePath);
  if (ignoreFileNames.has(baseName)) return true;
  if (/^\.env(\..+)?$/i.test(baseName) && baseName !== '.env.example') return true;
  return isLikelyBinary(filePath);
}

function tryListTrackedFilesFromGit() {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || '').toLowerCase();
    if (stderr.includes('not a git repository')) {
      return null;
    }
    throw error;
  }
}

function listFilesFromFilesystem(rootDir, relativeDir = '') {
  const currentDir = path.join(rootDir, relativeDir);
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const collectedFiles = [];

  entries.forEach((entry) => {
    if (!entry) return;
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirNames.has(entry.name)) return;
      collectedFiles.push(...listFilesFromFilesystem(rootDir, relativePath));
      return;
    }
    if (!entry.isFile()) return;
    collectedFiles.push(relativePath);
  });

  return collectedFiles;
}

function main() {
  const gitTrackedFiles = tryListTrackedFilesFromGit();
  const sourceLabel = gitTrackedFiles ? 'tracked files' : 'repo files (filesystem fallback)';
  const candidateFiles = (gitTrackedFiles || listFilesFromFilesystem(repoRoot))
    .map((filePath) => filePath.split(path.sep).join('/'))
    .filter(Boolean)
    .filter((filePath) => !shouldIgnoreFile(filePath));

  const findings = [];

  candidateFiles.forEach((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    let content = '';
    try {
      content = fs.readFileSync(absolutePath, 'utf8');
    } catch (_error) {
      return;
    }
    suspiciousPatterns.forEach((entry) => {
      if (entry.pattern.test(content)) {
        findings.push({ file: relativePath, label: entry.label });
      }
      entry.pattern.lastIndex = 0;
    });
  });

  if (findings.length > 0) {
    console.error(`Verdachte secrets gevonden in ${sourceLabel}:`);
    findings.forEach((finding) => {
      console.error(`- ${finding.file}: ${finding.label}`);
    });
    process.exit(1);
  }

  console.log(`Geen verdachte secrets gevonden in ${candidateFiles.length} ${sourceLabel}.`);
}

main();
