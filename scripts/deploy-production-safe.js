#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertSafeProductionDeploySource } = require('./guard-production-deploy-source');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const gitCmd = process.platform === 'win32' ? 'git.exe' : 'git';
const tarCmd = process.platform === 'win32' ? 'tar.exe' : 'tar';
const EXPECTED_VERCEL_PROJECT = Object.freeze({
  projectId: 'prj_RkOUrkRTAdkGNE3gxVlhAvS9TQgl',
  orgId: 'team_LFd5fMyc9TMAoLasBzDgdhuT',
  projectName: 'softora-nl',
});
const vercelProjectPath = path.join(process.cwd(), '.vercel', 'project.json');
const vercelOutputFunctionsPath = path.join(process.cwd(), '.vercel', 'output', 'functions');
const SHARP_LINUX_PACKAGES = Object.freeze([
  { name: '@img/sharp-linux-x64', version: '0.35.3', tarball: 'img-sharp-linux-x64-0.35.3.tgz' },
  { name: '@img/sharp-libvips-linux-x64', version: '1.3.2', tarball: 'img-sharp-libvips-linux-x64-1.3.2.tgz' },
  { name: '@img/sharp-linux-arm64', version: '0.35.3', tarball: 'img-sharp-linux-arm64-0.35.3.tgz' },
  { name: '@img/sharp-libvips-linux-arm64', version: '1.3.2', tarball: 'img-sharp-libvips-linux-arm64-1.3.2.tgz' },
]);

function readVercelProjectLink() {
  try {
    return JSON.parse(fs.readFileSync(vercelProjectPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function isExpectedVercelProjectLink(link) {
  return Boolean(
    link &&
    link.projectId === EXPECTED_VERCEL_PROJECT.projectId &&
    link.orgId === EXPECTED_VERCEL_PROJECT.orgId &&
    link.projectName === EXPECTED_VERCEL_PROJECT.projectName
  );
}

function ensureExpectedVercelProjectLink() {
  if (isExpectedVercelProjectLink(readVercelProjectLink())) return;
  fs.mkdirSync(path.dirname(vercelProjectPath), { recursive: true });
  fs.writeFileSync(vercelProjectPath, `${JSON.stringify(EXPECTED_VERCEL_PROJECT, null, 2)}\n`);
  console.log(`[production-deploy] Vercel projectlink gezet naar ${EXPECTED_VERCEL_PROJECT.projectName}.`);
}

function assertExpectedVercelProjectLink() {
  if (isExpectedVercelProjectLink(readVercelProjectLink())) return;
  console.error(`[production-deploy] Verkeerde Vercel projectlink; verwacht ${EXPECTED_VERCEL_PROJECT.projectName}.`);
  process.exit(1);
}

function run(label, command, args) {
  console.log(`\n[production-deploy] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runQuiet(label, command, args) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(`[production-deploy] ${label} mislukt.\n${stderr || stdout}`);
  }
  return result;
}

function listDirtyFiles() {
  const result = runQuiet('git status', gitCmd, ['status', '--porcelain']);
  return String(result.stdout || '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim());
}

function restoreKnownProductionBuildSideEffects() {
  const dirtyFiles = listDirtyFiles();
  if (dirtyFiles.length === 0) return;

  const knownBuildSideEffects = new Set(['package-lock.json']);
  const canRestore = dirtyFiles.every((filePath) => knownBuildSideEffects.has(filePath));
  if (!canRestore) return;

  console.log('[production-deploy] Bekende npm lockfile-bijwerking hersteld vóór Vercel deploy.');
  runQuiet('git restore package-lock.json', gitCmd, ['restore', '--', 'package-lock.json']);
}

function listVercelFunctionDirs(rootDir) {
  const result = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) return;
      if (/\.func$/i.test(entry.name)) {
        result.push(fullPath);
        return;
      }
      walk(fullPath);
    });
  }

  walk(rootDir);
  return result;
}

function installVercelSharpLinuxOutput() {
  console.log('\n[production-deploy] Linux sharp-binaries in Vercel output controleren');
  const functionDirs = listVercelFunctionDirs(vercelOutputFunctionsPath);
  if (!functionDirs.length) {
    throw new Error('[production-deploy] Geen Vercel function output gevonden; productie-deploy geblokkeerd.');
  }

  const tempDir = fs.mkdtempSync(path.join(process.cwd(), '.vercel-sharp-linux-'));
  try {
    SHARP_LINUX_PACKAGES.forEach((pkg) => {
      runQuiet(`npm pack ${pkg.name}`, npmCmd, [
        'pack',
        `${pkg.name}@${pkg.version}`,
        '--pack-destination',
        tempDir,
      ]);
    });

    let installed = 0;
    functionDirs.forEach((functionDir) => {
      SHARP_LINUX_PACKAGES.forEach((pkg) => {
        const packageDir = path.join(functionDir, 'node_modules', ...pkg.name.split('/'));
        if (fs.existsSync(path.join(packageDir, 'package.json'))) return;
        fs.mkdirSync(packageDir, { recursive: true });
        runQuiet(`extract ${pkg.name}`, tarCmd, [
          '-xzf',
          path.join(tempDir, pkg.tarball),
          '-C',
          packageDir,
          '--strip-components=1',
        ]);
        installed += 1;
      });
    });
    console.log(`[production-deploy] Linux sharp-binaries klaar (${installed} pakketkopieën toegevoegd).`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  assertSafeProductionDeploySource();
  console.log('[production-deploy] Bron is veilig: schoon en exact gelijk aan origin/main.');
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

run('kritieke checks', npmCmd, ['run', 'verify:critical']);
ensureExpectedVercelProjectLink();
run('Vercel productieomgeving ophalen', npxCmd, ['vercel', 'pull', '--yes', '--environment=production']);
assertExpectedVercelProjectLink();
run('Vercel productie-build', npxCmd, ['vercel', 'build', '--prod']);
restoreKnownProductionBuildSideEffects();
installVercelSharpLinuxOutput();
assertSafeProductionDeploySource();
run('Vercel productie-deploy', npxCmd, ['vercel', 'deploy', '--prebuilt', '--prod', '--yes']);
run('live productieversie controleren', npmCmd, ['run', 'check:live-production-version']);
