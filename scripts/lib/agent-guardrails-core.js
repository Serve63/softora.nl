const HIGH_RISK_PATH_PATTERNS = Object.freeze([
  /^server\.js$/,
  /^api\//,
  /^server\/routes\//,
  /^server\/security\//,
  /^server\/services\/.+-runtime(?:-[^/]+)?\.js$/,
  /^server\/services\/agenda-/,
  /^server\/services\/premium-/,
  /^server\/services\/confirmation-/,
  /^server\/services\/runtime-/,
  /^server\/services\/active-orders\.js$/,
  /^server\/services\/ai-dashboard\.js$/,
  /^server\/services\/ai-tools\.js$/,
  /^lib\/premium-users-store\.js$/,
]);

const ALLOWED_NEW_SERVER_PREFIXES = Object.freeze([
  'server/config/',
  'server/repositories/',
  'server/routes/',
  'server/schemas/',
  'server/security/',
  'server/services/',
]);

const PROTECTED_FRONTEND_SHELL_PATHS = Object.freeze([
  'assets/personnel-theme.css',
  'assets/personnel-theme.js',
  'assets/premium-sidebar-profile-prefill.js',
]);

const PROTECTED_QUALITY_GATE_PATHS = Object.freeze([
  '.github/workflows/agent-guardrails.yml',
  '.github/workflows/verify-critical.yml',
  'scripts/check-agent-guardrails.js',
  'scripts/lib/agent-guardrails-core.js',
  'scripts/verify-critical.js',
]);

const DISALLOWED_BROWSER_STORAGE_PATTERNS = Object.freeze([
  {
    label: 'localStorage',
    pattern: /\b(?:window\.)?localStorage\b/,
  },
  {
    label: 'sessionStorage',
    pattern: /\b(?:window\.)?sessionStorage\b/,
  },
  {
    label: 'indexedDB',
    pattern: /\b(?:window\.)?indexedDB\b/,
  },
]);

function normalizeRepoPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isTestPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return normalized.startsWith('test/contracts/') || normalized.startsWith('test/smoke/');
}

function isBehaviorChangePath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return (
    normalized === 'server.js' ||
    normalized.startsWith('scripts/') ||
    normalized.startsWith('.github/workflows/') ||
    normalized.startsWith('server/') ||
    normalized.startsWith('api/') ||
    normalized.startsWith('assets/') ||
    /^[^/]+\.html$/i.test(normalized)
  );
}

function isFrontendProductionPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return normalized.startsWith('assets/') || /^[^/]+\.html$/i.test(normalized);
}

function isHighRiskPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isProtectedFrontendShellPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return PROTECTED_FRONTEND_SHELL_PATHS.includes(normalized);
}

function isProtectedQualityGatePath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return PROTECTED_QUALITY_GATE_PATHS.includes(normalized);
}

function isAllowedNewServerPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (!normalized.startsWith('server/')) return true;
  return ALLOWED_NEW_SERVER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function countDiffLines(diffText = '') {
  const summary = {
    additions: 0,
    deletions: 0,
  };

  String(diffText || '')
    .split('\n')
    .forEach((line) => {
      if (!line || line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
        return;
      }
      if (line.startsWith('+')) {
        summary.additions += 1;
      } else if (line.startsWith('-')) {
        summary.deletions += 1;
      }
    });

  return summary;
}

function countAddedServerJsFunctions(diffText = '') {
  return String(diffText || '')
    .split('\n')
    .filter((line) => /^\+(?!\+\+)\s*(async\s+)?function\s+[A-Za-z0-9_]+\s*\(/.test(line))
    .length;
}

function listAddedBrowserStorageApis(diffText = '') {
  const hits = new Set();

  String(diffText || '')
    .split('\n')
    .forEach((line) => {
      if (!/^\+(?!\+\+\+)/.test(line)) return;
      const source = line.slice(1);
      DISALLOWED_BROWSER_STORAGE_PATTERNS.forEach(({ label, pattern }) => {
        if (pattern.test(source)) {
          hits.add(label);
        }
      });
    });

  return Array.from(hits).sort();
}

function getAddedLineNumbersFromDiff(diffText = '') {
  const addedLineNumbers = [];
  let nextNewLineNumber = 0;

  String(diffText || '')
    .split('\n')
    .forEach((line) => {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        nextNewLineNumber = Number(hunkMatch[1]) || 0;
        return;
      }

      if (!nextNewLineNumber) return;
      if (line.startsWith('+++') || line.startsWith('---')) return;

      if (line.startsWith('+')) {
        addedLineNumbers.push(nextNewLineNumber);
        nextNewLineNumber += 1;
        return;
      }

      if (line.startsWith('-')) {
        return;
      }

      if (line.startsWith(' ') || line === '') {
        nextNewLineNumber += 1;
      }
    });

  return addedLineNumbers;
}

function getInlineScriptLineSet(htmlSource = '') {
  const inlineScriptLines = new Set();
  let inInlineScript = false;

  String(htmlSource || '')
    .split('\n')
    .forEach((line, index) => {
      const lineNumber = index + 1;
      const source = String(line || '');
      const scriptOpenMatch = source.match(/<script\b([^>]*)>/i);
      const scriptCloseIndex = source.search(/<\/script>/i);

      if (inInlineScript) {
        if (scriptCloseIndex === -1) {
          inlineScriptLines.add(lineNumber);
          return;
        }

        if (source.slice(0, scriptCloseIndex).trim()) {
          inlineScriptLines.add(lineNumber);
        }
        inInlineScript = false;
        return;
      }

      if (!scriptOpenMatch) return;

      const attrs = scriptOpenMatch[1] || '';
      const isExternal = /\bsrc\s*=/i.test(attrs);
      if (isExternal) return;

      const openEndIndex = source.indexOf('>', scriptOpenMatch.index);
      const inlineTail = openEndIndex >= 0 ? source.slice(openEndIndex + 1) : '';
      const closesOnSameLine = /<\/script>/i.test(inlineTail);
      const inlineCode = closesOnSameLine
        ? inlineTail.replace(/<\/script>[\s\S]*$/i, '').trim()
        : inlineTail.trim();

      if (inlineCode) {
        inlineScriptLines.add(lineNumber);
      }

      if (!closesOnSameLine) {
        inInlineScript = true;
      }
    });

  return inlineScriptLines;
}

function countAddedInlineScriptLines(diffText = '', htmlSource = '') {
  const inlineScriptLines = getInlineScriptLineSet(htmlSource);
  if (inlineScriptLines.size === 0) return 0;
  return getAddedLineNumbersFromDiff(diffText)
    .filter((lineNumber) => inlineScriptLines.has(lineNumber))
    .length;
}

function formatAgeMs(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'onbekend';
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((ageMs / 3600000) * 10) / 10;
  return `${hours} uur`;
}

function buildGuardrailViolations(options = {}) {
  const {
    changedFiles = [],
    addedFiles = [],
    changedTests = [],
    highRiskFiles = [],
    newestBackupAgeMs = null,
    maxLocalBackupAgeMs = 12 * 60 * 60 * 1000,
    isCi = false,
    behaviorFiles = [],
    missingRequiredRepoFiles = [],
    serverJsLineCount = 0,
    maxServerJsLines = 7500,
    serverAppRuntimeLineCount = 0,
    maxServerAppRuntimeLines = 1200,
    serverJsNetGrowth = 0,
    maxServerJsNetGrowth = 25,
    addedServerJsFunctions = 0,
    browserStorageViolations = [],
    largeInlineScriptViolations = [],
    protectedFrontendShellFiles = [],
    protectedQualityGateFiles = [],
    behaviorDiffLineCount = 0,
    maxBehaviorDiffLineCount = 900,
    allowUntestedChanges = false,
    allowNoRuntimeBackup = false,
    allowServerJsGrowth = false,
    allowServerJsFunctions = false,
    allowNonstandardServerFiles = false,
    allowBrowserStorage = false,
    allowLargeInlineScript = false,
    allowUntestedShellChange = false,
    allowUntestedQualityGateChange = false,
    allowLargeBehaviorChange = false,
  } = options;

  const violations = [];
  const normalizedAddedFiles = addedFiles.map(normalizeRepoPath);

  if (missingRequiredRepoFiles.length > 0) {
    violations.push(
      `[guardrails] Verplichte repo-protocolfiles ontbreken: ${missingRequiredRepoFiles.join(', ')}. Herstel de architectuur- en kwaliteitsdocs voordat je afrondt.`
    );
  }

  if (serverJsLineCount > maxServerJsLines) {
    violations.push(
      `[guardrails] server.js telt nu ${serverJsLineCount} regels; limiet is ${maxServerJsLines}. Trek nieuwe logica uit naar server/services of server/routes.`
    );
  }

  if (serverAppRuntimeLineCount > maxServerAppRuntimeLines) {
    violations.push(
      `[guardrails] server/services/server-app-runtime.js telt nu ${serverAppRuntimeLineCount} regels; limiet is ${maxServerAppRuntimeLines}. Houd de runtime-compositie opgesplitst over kleinere modules.`
    );
  }

  if (!allowServerJsGrowth && serverJsNetGrowth > maxServerJsNetGrowth) {
    violations.push(
      `[guardrails] server.js groeide netto met ${serverJsNetGrowth} regels; limiet is ${maxServerJsNetGrowth}. Houd server.js wiring-only of gebruik ALLOW_SERVER_JS_GROWTH=1 voor een bewuste uitzondering.`
    );
  }

  if (!allowServerJsFunctions && addedServerJsFunctions > 0) {
    violations.push(
      `[guardrails] Nieuwe function-declaraties in server.js gedetecteerd (${addedServerJsFunctions}). Verplaats helpers naar server/services of gebruik ALLOW_SERVER_JS_FUNCTIONS=1 voor een bewuste uitzondering.`
    );
  }

  const unexpectedServerFiles = normalizedAddedFiles.filter(
    (filePath) => filePath.startsWith('server/') && !isAllowedNewServerPath(filePath)
  );
  if (!allowNonstandardServerFiles && unexpectedServerFiles.length > 0) {
    violations.push(
      `[guardrails] Nieuwe server-files buiten toegestane architectuurmappen: ${unexpectedServerFiles.join(', ')}.`
    );
  }

  const unexpectedRootJsFiles = normalizedAddedFiles.filter(
    (filePath) => /^[^/]+\.js$/i.test(filePath) && filePath !== 'server.js'
  );
  if (!allowNonstandardServerFiles && unexpectedRootJsFiles.length > 0) {
    violations.push(
      `[guardrails] Nieuwe root-JS files gedetecteerd: ${unexpectedRootJsFiles.join(', ')}. Zet nieuwe code in server/*, assets/* of scripts/*.`
    );
  }

  if (!allowUntestedChanges && behaviorFiles.length > 0 && changedTests.length === 0) {
    violations.push(
      `[guardrails] Productiecode aangepast zonder testwijziging. Pas minimaal een contract- of smoke-test aan voor: ${behaviorFiles.join(', ')}.`
    );
  }

  if (!allowBrowserStorage && browserStorageViolations.length > 0) {
    violations.push(
      `[guardrails] Nieuwe browser-opslag in productiecode gedetecteerd: ${browserStorageViolations.join(', ')}. Gebruik gedeelde opslag via server/Supabase of gebruik ALLOW_BROWSER_STORAGE=1 voor een bewuste uitzondering.`
    );
  }

  if (!allowLargeInlineScript && largeInlineScriptViolations.length > 0) {
    violations.push(
      `[guardrails] Grote inline frontend-script toevoeging gedetecteerd: ${largeInlineScriptViolations.join(', ')}. Zet paginalogica in assets/* of gebruik ALLOW_LARGE_INLINE_SCRIPT=1 voor een bewuste uitzondering.`
    );
  }

  const hasSidebarShellTest = changedTests.includes('test/contracts/premium-sidebar-shell-scope.test.js');
  if (!allowUntestedShellChange && protectedFrontendShellFiles.length > 0 && !hasSidebarShellTest) {
    violations.push(
      `[guardrails] Premium shell/sidebar gewijzigd zonder gerichte shell-contracttest. Pas test/contracts/premium-sidebar-shell-scope.test.js aan voor: ${protectedFrontendShellFiles.join(', ')}.`
    );
  }

  const hasGuardrailTest = changedTests.includes('test/contracts/agent-guardrails.test.js');
  if (!allowUntestedQualityGateChange && protectedQualityGateFiles.length > 0 && !hasGuardrailTest) {
    violations.push(
      `[guardrails] Quality-gate bestanden gewijzigd zonder guardrail-test. Pas test/contracts/agent-guardrails.test.js aan voor: ${protectedQualityGateFiles.join(', ')}.`
    );
  }

  if (
    !allowLargeBehaviorChange &&
    Number.isFinite(behaviorDiffLineCount) &&
    behaviorDiffLineCount > maxBehaviorDiffLineCount
  ) {
    violations.push(
      `[guardrails] Productiewijziging is te groot voor één veilige stap (${behaviorDiffLineCount} gewijzigde regels; limiet ${maxBehaviorDiffLineCount}). Knip dit op of gebruik ALLOW_LARGE_BEHAVIOR_CHANGE=1 voor een bewuste uitzondering.`
    );
  }

  if (!isCi && !allowNoRuntimeBackup && highRiskFiles.length > 0) {
    if (!Number.isFinite(newestBackupAgeMs)) {
      violations.push(
        `[guardrails] High-risk wijzigingen gedetecteerd (${highRiskFiles.join(', ')}), maar er is geen runtime-backup gevonden. Draai eerst npm run backup:runtime of gebruik SKIP_RUNTIME_BACKUP_CHECK=1 voor een bewuste uitzondering.`
      );
    } else if (newestBackupAgeMs > maxLocalBackupAgeMs) {
      violations.push(
        `[guardrails] High-risk wijzigingen gedetecteerd (${highRiskFiles.join(', ')}), maar de nieuwste runtime-backup is ${formatAgeMs(newestBackupAgeMs)} oud. Draai eerst npm run backup:runtime of gebruik SKIP_RUNTIME_BACKUP_CHECK=1 voor een bewuste uitzondering.`
      );
    }
  }

  return violations;
}

module.exports = {
  countAddedServerJsFunctions,
  countAddedInlineScriptLines,
  countDiffLines,
  buildGuardrailViolations,
  formatAgeMs,
  getAddedLineNumbersFromDiff,
  isAllowedNewServerPath,
  isBehaviorChangePath,
  isFrontendProductionPath,
  isHighRiskPath,
  isProtectedFrontendShellPath,
  isProtectedQualityGatePath,
  isTestPath,
  listAddedBrowserStorageApis,
  normalizeRepoPath,
};
