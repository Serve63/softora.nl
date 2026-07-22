#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MAX_TRACKED_TEXT_BYTES = 1_000_000;
const MAX_EMBEDDED_JSON_BYTES = 64_000;
const BLOCKED_ROOT_DIRECTORIES = new Set([
  'backups',
  'exports',
  'output',
  'outputs',
  'reports',
  'research',
]);
const BLOCKED_DATA_EXTENSIONS = new Set([
  '.csv',
  '.db',
  '.ndjson',
  '.sqlite',
  '.tsv',
  '.xls',
  '.xlsx',
]);
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.sql',
  '.txt',
  '.yml',
  '.yaml',
]);
const BUSINESS_DATA_MARKERS = [
  'bedrijfsnaam',
  'kvk_nummer',
  'telefoonnummer',
  'contact_research_note',
];

function getTrackedFiles(repoRoot = REPO_ROOT) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean);
}

function isBlockedArtifactPath(filePath) {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const [rootDirectory] = normalizedPath.split('/');
  if (BLOCKED_ROOT_DIRECTORIES.has(rootDirectory)) return true;
  return BLOCKED_DATA_EXTENSIONS.has(path.extname(normalizedPath).toLowerCase());
}

function findOversizedEmbeddedJson(filePath, source) {
  if (path.extname(filePath).toLowerCase() !== '.html') return [];
  const violations = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(scriptPattern)) {
    const payloadBytes = Buffer.byteLength(match[1] || '', 'utf8');
    if (payloadBytes > MAX_EMBEDDED_JSON_BYTES) {
      violations.push(
        `${filePath} bevat ${payloadBytes} bytes ingebedde JSON; maximaal ${MAX_EMBEDDED_JSON_BYTES} bytes.`
      );
    }
  }
  return violations;
}

function looksLikeEmbeddedBusinessDataset(source) {
  return BUSINESS_DATA_MARKERS.every((marker) => source.includes(`"${marker}"`));
}

function listPublicDataExposureViolations(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const trackedFiles = options.trackedFiles || getTrackedFiles(repoRoot);
  const violations = [];

  for (const filePath of trackedFiles) {
    const absolutePath = path.join(repoRoot, filePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;

    if (isBlockedArtifactPath(filePath)) {
      violations.push(`${filePath} is een data-export of lokaal artefact en mag niet tracked zijn.`);
      continue;
    }

    const extension = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;

    const fileBytes = fs.statSync(absolutePath).size;
    if (fileBytes > MAX_TRACKED_TEXT_BYTES) {
      violations.push(
        `${filePath} is ${fileBytes} bytes; tracked tekstbestanden mogen maximaal ${MAX_TRACKED_TEXT_BYTES} bytes zijn.`
      );
    }

    const source = fs.readFileSync(absolutePath, 'utf8');
    violations.push(...findOversizedEmbeddedJson(filePath, source));
    if (looksLikeEmbeddedBusinessDataset(source)) {
      violations.push(`${filePath} bevat kenmerken van een ingebedde bedrijfsdataset.`);
    }
  }

  return violations;
}

function runCli() {
  const violations = listPublicDataExposureViolations();
  if (violations.length) {
    console.error('[public-data] Mogelijke publieke data-exposure gevonden:');
    violations.forEach((violation) => console.error(` - ${violation}`));
    process.exit(1);
  }
  console.log('[public-data] Geen tracked exports, grote JSON-snapshots of ingebedde bedrijfsdatasets gevonden.');
}

if (require.main === module) runCli();

module.exports = {
  BLOCKED_DATA_EXTENSIONS,
  BLOCKED_ROOT_DIRECTORIES,
  MAX_EMBEDDED_JSON_BYTES,
  MAX_TRACKED_TEXT_BYTES,
  findOversizedEmbeddedJson,
  isBlockedArtifactPath,
  listPublicDataExposureViolations,
  looksLikeEmbeddedBusinessDataset,
};
