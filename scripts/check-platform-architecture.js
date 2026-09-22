#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getKnownHtmlPageFiles, createKnownPrettyPageSlugToFile } = require('../server/config/page-routing');

const REGISTRY = 'server/config/platform-pages.json';
const MODES = new Set(['legacy-document', 'public-document', 'isolated-document', 'application-module']);

function validatePlatformArchitecture({ files, registry, baseline, baselineFiles, readFile }) {
  const errors = [];
  const pages = registry?.pages || {};
  const known = new Set(files);
  if (registry?.schemaVersion !== 1) errors.push('Unsupported platform registry schema.');
  for (const file of known) {
    const page = pages[file];
    if (!page) {
      errors.push(`${file}: reachable HTML is not registered.`);
      continue;
    }
    if (!MODES.has(page.delivery)) errors.push(`${file}: unknown delivery mode.`);
    if (!Number.isFinite(page.targetReadyMs) || page.targetReadyMs <= 0 || page.targetReadyMs > 3000) {
      errors.push(`${file}: complete readiness budget must be at most 3000 ms.`);
    }
    const previous = baseline?.pages?.[file];
    if (previous && page.targetReadyMs > previous.targetReadyMs) {
      errors.push(`${file}: readiness budget cannot grow.`);
    }
    if (page.delivery === 'legacy-document') {
      // The first registry may only grandfather files already present on the base branch.
      const allowed = baseline ? previous?.delivery === 'legacy-document' : baselineFiles.has(file);
      if (!allowed) errors.push(`${file}: new legacy exceptions or migration regressions are forbidden.`);
      continue;
    }
    if (typeof page.readinessContract !== 'string' ||
        !/^test\/contracts\/[a-z0-9-]+\.test\.js$/.test(page.readinessContract)) {
      errors.push(`${file}: missing complete-readiness contract.`);
    } else {
      try { if (!readFile(page.readinessContract).trim()) throw new Error('Empty contract'); }
      catch (_) { errors.push(`${file}: readiness contract does not exist.`); }
    }
    if (!Array.isArray(page.requiredData) || !Array.isArray(page.requiredImages) ||
        typeof page.freshness !== 'string' || !page.freshness.trim()) {
      errors.push(`${file}: declare required data, images and freshness.`);
    }
    if (page.delivery === 'isolated-document' && !String(page.isolationReason || '').trim()) {
      errors.push(`${file}: isolated delivery requires a reason.`);
    }
    // Do not let a metadata change claim that a legacy page has a working module lifecycle.
    if (page.delivery === 'application-module') {
      errors.push(`${file}: application modules require the verified shared runtime in the next migration step.`);
    }
  }
  for (const file of Object.keys(pages)) {
    if (!known.has(file)) errors.push(`${file}: registry points to missing HTML.`);
  }
  return errors;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function resolveBaselineRef(root, env, runGit = (args) => git(root, args)) {
  if (['pull_request', 'push'].includes(env.GITHUB_EVENT_NAME)) {
    const head = runGit(['rev-parse', 'HEAD']);
    if (head !== env.GITHUB_SHA ||
        (env.GITHUB_EVENT_NAME === 'pull_request' && !/^refs\/pull\/\d+\/merge$/.test(env.GITHUB_REF || ''))) {
      throw new Error('CI must check out the exact GitHub merge commit.');
    }
    // Raw commit headers retain parent IDs even when HEAD is a shallow boundary.
    const headers = runGit(['cat-file', '-p', 'HEAD']).split('\n\n')[0];
    const sha = headers.match(/^parent ([a-f0-9]{40})$/m)?.[1];
    if (!sha) throw new Error('Missing exact CI base commit.');
    try { runGit(['cat-file', '-e', `${sha}^{commit}`]); }
    catch (_) { runGit(['fetch', '--no-tags', '--depth=1', 'origin', sha]); }
    return sha;
  }
  return runGit(['merge-base', 'HEAD', 'origin/main']);
}

function readBaseline(root, env = process.env) {
  // Use the PR base rather than HEAD: committing an exception must not legitimise it.
  const ref = resolveBaselineRef(root, env);
  const tracked = new Set(git(root, ['ls-tree', '--name-only', ref]).split('\n'));
  const hasRegistry = git(root, ['ls-tree', '--name-only', ref, REGISTRY]) === REGISTRY;
  return {
    baselineFiles: tracked,
    baseline: hasRegistry ? JSON.parse(git(root, ['show', `${ref}:${REGISTRY}`])) : null,
  };
}

function checkPlatformArchitecture(root = path.resolve(__dirname, '..')) {
  const files = getKnownHtmlPageFiles(root);
  const registry = JSON.parse(fs.readFileSync(path.join(root, REGISTRY), 'utf8'));
  const errors = validatePlatformArchitecture({
    files, registry, ...readBaseline(root),
    readFile: (file) => fs.readFileSync(path.join(root, file), 'utf8'),
  });
  return { errors, files: files.size, routes: createKnownPrettyPageSlugToFile(files).size };
}

if (require.main === module) {
  try {
    const result = checkPlatformArchitecture();
    if (result.errors.length) {
      result.errors.forEach((error) => console.error(`[platform-architecture] ${error}`));
      process.exitCode = 1;
    } else {
      console.log(`[platform-architecture] ${result.files} HTML files / ${result.routes} pretty routes registered; legacy cannot expand. Readiness budgets are targets, not measured results.`);
    }
  } catch (error) {
    console.error(`[platform-architecture] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validatePlatformArchitecture, checkPlatformArchitecture, readBaseline, resolveBaselineRef };
