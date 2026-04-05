#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
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

function main() {
  const trackedFiles = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => !ignoreFileNames.has(path.basename(filePath)))
    .filter((filePath) => !isLikelyBinary(filePath));

  const findings = [];

  trackedFiles.forEach((relativePath) => {
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
    console.error('Verdachte secrets gevonden in tracked files:');
    findings.forEach((finding) => {
      console.error(`- ${finding.file}: ${finding.label}`);
    });
    process.exit(1);
  }

  console.log(`Geen verdachte secrets gevonden in ${trackedFiles.length} tracked files.`);
}

main();
