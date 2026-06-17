const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

function normalizeString(value) {
  return String(value || '').trim();
}

function expandHomePath(valueRaw, homeDir = os.homedir()) {
  const raw = normalizeString(valueRaw);
  if (!raw) return '';
  if (raw === '~') return homeDir;
  if (raw.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, raw.slice(2));
  }
  return raw;
}

function toAbsolutePath(valueRaw, fallbackDir = process.cwd(), homeDir = os.homedir()) {
  const expanded = expandHomePath(valueRaw, homeDir);
  if (!expanded) return '';
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(fallbackDir, expanded);
}

function uniquePaths(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function getSoftoraLocalEnvCandidates(options = {}) {
  const homeDir = toAbsolutePath(options.homeDir || os.homedir(), process.cwd(), os.homedir());
  const cwd = toAbsolutePath(options.cwd || process.cwd(), process.cwd(), homeDir);
  const projectRootDir = toAbsolutePath(options.projectRootDir || cwd, cwd, homeDir);
  const explicitEnvFile = normalizeString(options.envFile || process.env.SOFTORA_ENV_FILE);

  const repoCandidates = [
    path.join(projectRootDir, '.env'),
    path.join(projectRootDir, '.env.local'),
    path.join(projectRootDir, '.env.private'),
    path.join(projectRootDir, '.env.local.private'),
  ];
  const cwdCandidates = [
    path.join(cwd, '.env'),
    path.join(cwd, '.env.local'),
    path.join(cwd, '.env.private'),
    path.join(cwd, '.env.local.private'),
  ];
  const sharedCandidates = [
    path.join(homeDir, '.config', 'softora', '.env'),
    path.join(homeDir, '.config', 'softora', 'local.env'),
    path.join(homeDir, '.config', 'softora', 'search-console.env'),
    path.join(homeDir, '.config', 'softora', 'seo-agent.env'),
    path.join(homeDir, '.codex', 'softora.local.env'),
    path.join(homeDir, '.codex', 'search-console.env'),
    path.join(homeDir, '.codex', 'softora-search-console.env'),
  ];

  return uniquePaths([
    explicitEnvFile ? toAbsolutePath(explicitEnvFile, cwd, homeDir) : '',
    ...repoCandidates,
    ...cwdCandidates,
    ...sharedCandidates,
  ]);
}

function loadSoftoraLocalEnv(options = {}) {
  const override = Boolean(options.override);
  const quiet = options.quiet !== false;
  const candidates = getSoftoraLocalEnvCandidates(options);
  const loadedFiles = [];

  candidates.forEach((candidate) => {
    if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return;
    dotenv.config({ path: candidate, override, quiet });
    loadedFiles.push(candidate);
  });

  return {
    loadedFiles,
    candidates,
  };
}

module.exports = {
  expandHomePath,
  getSoftoraLocalEnvCandidates,
  loadSoftoraLocalEnv,
  toAbsolutePath,
};
