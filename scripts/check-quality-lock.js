#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const PREMIUM_SIDEBAR_THEME_VERSION = '20260502a';

const REQUIRED_QUALITY_FILES = Object.freeze([
  'AGENTS.md',
  '.github/pull_request_template.md',
  '.github/workflows/agent-guardrails.yml',
  '.github/workflows/repo-hygiene.yml',
  '.github/workflows/verify-critical.yml',
  'docs/quality-protocol.md',
  'docs/operations-checklist.md',
  'docs/repo-map.md',
  'scripts/check-agent-guardrails.js',
  'scripts/check-quality-lock.js',
  'scripts/check-repo-hygiene.sh',
  'scripts/deploy-production-safe.js',
  'scripts/guard-production-deploy-source.js',
  'scripts/check-live-production-version.js',
  'scripts/verify-critical.js',
  'test/contracts/production-live-version-guard.test.js',
  'test/contracts/production-deploy-guard.test.js',
]);

const GUARDRail_BYPASS_ENV_NAMES = Object.freeze([
  'ALLOW_BROWSER_STORAGE',
  'ALLOW_LARGE_BEHAVIOR_CHANGE',
  'ALLOW_LARGE_INLINE_SCRIPT',
  'ALLOW_NONSTANDARD_SERVER_FILES',
  'ALLOW_SERVER_JS_FUNCTIONS',
  'ALLOW_SERVER_JS_GROWTH',
  'ALLOW_TEST_WEAKENING',
  'ALLOW_UNTESTED_CHANGES',
  'ALLOW_UNTESTED_QUALITY_GATE_CHANGE',
  'ALLOW_UNTESTED_SHELL_CHANGE',
  'SKIP_RUNTIME_BACKUP_CHECK',
]);

const TEST_WEAKENING_PATTERNS = Object.freeze([
  {
    label: '.only',
    pattern: /\b(?:test|it|describe)\.only\s*\(/,
  },
  {
    label: '.skip',
    pattern: /\b(?:test|it|describe)\.skip\s*\(/,
  },
  {
    label: 'skip: true',
    pattern: /\bskip\s*:\s*true\b/,
  },
  {
    label: 'todo: true',
    pattern: /\btodo\s*:\s*true\b/,
  },
]);

function normalizeRepoPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function getTrackedFiles() {
  const trackedOutput = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const untrackedOutput = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return Array.from(
    new Set(
      `${trackedOutput}\n${untrackedOutput}`
        .split('\n')
        .map(normalizeRepoPath)
        .filter(Boolean)
    )
  ).sort();
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function findPatternLine(source, pattern) {
  const lines = String(source || '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      return index + 1;
    }
  }
  return 0;
}

function listPremiumThemeVersions(html, assetName) {
  const pattern = new RegExp(`assets/${assetName.replace('.', '\\.')}\\?v=([^"'\\s>]+)`, 'g');
  return Array.from(String(html || '').matchAll(pattern), (match) => match[1]);
}

function hasSameVersions(cssVersions, jsVersions) {
  const cssSet = new Set(cssVersions);
  const jsSet = new Set(jsVersions);
  if (cssSet.size !== jsSet.size) return false;
  return Array.from(cssSet).every((version) => jsSet.has(version));
}

function listQualityLockViolations(options = {}) {
  const trackedFiles = (options.trackedFiles || getTrackedFiles()).map(normalizeRepoPath);
  const readFile = options.readFile || readRepoFile;
  const trackedFileSet = new Set(trackedFiles);
  const violations = [];

  REQUIRED_QUALITY_FILES.forEach((filePath) => {
    if (!trackedFileSet.has(filePath)) {
      violations.push(`[quality-lock] Verplicht kwaliteitsbestand ontbreekt: ${filePath}`);
    }
  });

  const packageJsonSource = trackedFileSet.has('package.json') ? readFile('package.json') : '{}';
  let packageJson = {};
  try {
    packageJson = JSON.parse(packageJsonSource);
  } catch (_error) {
    violations.push('[quality-lock] package.json is geen geldige JSON.');
  }

  const expectedScripts = {
    'check:guardrails': 'node scripts/check-agent-guardrails.js',
    'check:repo-hygiene': 'bash scripts/check-repo-hygiene.sh',
    'check:quality-lock': 'node scripts/check-quality-lock.js',
    'check:production-deploy-source': 'node scripts/guard-production-deploy-source.js',
    'check:live-production-version': 'node scripts/check-live-production-version.js',
    'deploy:production': 'node scripts/deploy-production-safe.js',
    'verify:critical': 'node scripts/verify-critical.js',
  };
  Object.entries(expectedScripts).forEach(([scriptName, expectedCommand]) => {
    if (packageJson?.scripts?.[scriptName] !== expectedCommand) {
      violations.push(
        `[quality-lock] package.json script "${scriptName}" moet "${expectedCommand}" blijven.`
      );
    }
  });

  if (trackedFileSet.has('scripts/verify-critical.js')) {
    const verifyCriticalSource = readFile('scripts/verify-critical.js');
    ['check:guardrails', 'check:repo-hygiene', 'check:quality-lock', 'test:contracts', 'test:smoke', 'check:secrets'].forEach(
      (scriptName) => {
        const pattern = new RegExp(`\\['run',\\s*'${scriptName.replace(':', '\\:')}'\\]`);
        if (!pattern.test(verifyCriticalSource)) {
          violations.push(`[quality-lock] verify:critical mist npm run ${scriptName}.`);
        }
      }
    );
  }

  if (trackedFileSet.has('scripts/guard-production-deploy-source.js')) {
    const deployGuardSource = readFile('scripts/guard-production-deploy-source.js');
    if (!/mainRef\.stdout !== headRef\.stdout/.test(deployGuardSource)) {
      violations.push(
        '[quality-lock] production deploy guard moet alleen exact origin/main accepteren.'
      );
    }
    if (!/exact origin\/main/.test(deployGuardSource)) {
      violations.push(
        '[quality-lock] production deploy guard mist de exacte-origin/main blokkade.'
      );
    }
  }

  if (trackedFileSet.has('scripts/deploy-production-safe.js')) {
    const safeDeploySource = readFile('scripts/deploy-production-safe.js');
    ['assertSafeProductionDeploySource()', "projectName: 'softora-nl'", "projectId: 'prj_RkOUrkRTAdkGNE3gxVlhAvS9TQgl'", 'check:live-production-version'].forEach(
      (requiredText) => {
        if (!safeDeploySource.includes(requiredText)) {
          violations.push(`[quality-lock] deploy-production-safe.js mist "${requiredText}".`);
        }
      }
    );
  }

  if (trackedFileSet.has('scripts/check-live-production-version.js')) {
    const liveVersionSource = readFile('scripts/check-live-production-version.js');
    ['vercel', 'ls', 'origin/main', 'githubCommitSha', 'gitCommitSha'].forEach((requiredText) => {
      if (!liveVersionSource.includes(requiredText)) {
        violations.push(`[quality-lock] check-live-production-version.js mist "${requiredText}".`);
      }
    });
  }

  const bypassEnvPattern = new RegExp(
    `\\b(?:${GUARDRail_BYPASS_ENV_NAMES.join('|')})\\b\\s*[:=]`,
    'i'
  );
  const qualityCommandBypassPattern =
    /npm\s+run\s+(?:verify:critical|check:guardrails|check:repo-hygiene|check:quality-lock)[^\n]*(?:\|\|\s*true|;\s*exit\s+0)/i;

  trackedFiles
    .filter((filePath) => /^\.github\/workflows\/.+\.ya?ml$/i.test(filePath))
    .forEach((filePath) => {
      const source = readFile(filePath);
      const continueLine = findPatternLine(source, /continue-on-error\s*:\s*true/i);
      if (continueLine) {
        violations.push(
          `[quality-lock] ${filePath}:${continueLine} mag geen continue-on-error: true gebruiken voor kwaliteitschecks.`
        );
      }

      const bypassLine = findPatternLine(source, bypassEnvPattern);
      if (bypassLine) {
        violations.push(
          `[quality-lock] ${filePath}:${bypassLine} mag geen guardrail-bypass env var in CI zetten.`
        );
      }

      const commandBypassLine = findPatternLine(source, qualityCommandBypassPattern);
      if (commandBypassLine) {
        violations.push(
          `[quality-lock] ${filePath}:${commandBypassLine} mag kwaliteitscommando's niet met || true of exit 0 omzeilen.`
        );
      }
    });

  trackedFiles
    .filter((filePath) => /^test\/(?:contracts|smoke)\/.+\.js$/i.test(filePath))
    .forEach((filePath) => {
      const source = readFile(filePath);
      TEST_WEAKENING_PATTERNS.forEach(({ label, pattern }) => {
        const line = findPatternLine(source, pattern);
        if (line) {
          violations.push(
            `[quality-lock] ${filePath}:${line} bevat test-verzwakking (${label}).`
          );
        }
      });
    });

  const premiumThemeFiles = trackedFiles.filter((filePath) => {
    if (!/^premium-[^/]+\.html$/i.test(filePath)) return false;
    const html = readFile(filePath);
    return /assets\/personnel-theme\.(?:css|js)\?v=/.test(html);
  });

  if (premiumThemeFiles.length === 0) {
    violations.push('[quality-lock] Geen premium pagina met personnel-theme assetversie gevonden.');
  }

  premiumThemeFiles.forEach((filePath) => {
    const html = readFile(filePath);
    const cssVersions = listPremiumThemeVersions(html, 'personnel-theme.css');
    const jsVersions = listPremiumThemeVersions(html, 'personnel-theme.js');
    if (cssVersions.length === 0 || jsVersions.length === 0) {
      violations.push(
        `[quality-lock] ${filePath} moet zowel personnel-theme.css als personnel-theme.js met cacheversie laden.`
      );
      return;
    }

    if (!hasSameVersions(cssVersions, jsVersions)) {
      violations.push(
        `[quality-lock] ${filePath} heeft verschillende CSS/JS personnel-theme versies.`
      );
    }

    [...cssVersions, ...jsVersions].forEach((version) => {
      if (version !== PREMIUM_SIDEBAR_THEME_VERSION) {
        violations.push(
          `[quality-lock] ${filePath} gebruikt personnel-theme versie ${version}; verwacht ${PREMIUM_SIDEBAR_THEME_VERSION}.`
        );
      }
    });
  });

  if (trackedFileSet.has('.github/pull_request_template.md')) {
    const template = readFile('.github/pull_request_template.md');
    ['npm run verify:critical', 'npm run check:guardrails', 'rollback'].forEach((requiredText) => {
      if (!template.includes(requiredText)) {
        violations.push(
          `[quality-lock] .github/pull_request_template.md mist "${requiredText}".`
        );
      }
    });
  }

  return violations;
}

function runCli() {
  const violations = listQualityLockViolations();
  if (violations.length > 0) {
    violations.forEach((message) => console.error(message));
    process.exit(1);
  }
  console.log('[quality-lock] Kwaliteitsbaseline is vergrendeld.');
}

if (require.main === module) {
  runCli();
}

module.exports = {
  PREMIUM_SIDEBAR_THEME_VERSION,
  listQualityLockViolations,
};
