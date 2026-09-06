#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const portfolio = require('../server/services/seo-machine-portfolio');
const { inspectAutomationState, DEFAULT_MEMORY_PATH } = require('./seo-machine-automation-state');
const ROOT = path.resolve(__dirname, '..');
const DIRECTORY = path.join(path.dirname(DEFAULT_MEMORY_PATH), 'portfolio');
const STATE_FILE = path.join(DIRECTORY, 'state.json');
const manifest = portfolio.validateManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/growth/seo-machine-sites.json'), 'utf8')));
const repository = (site) => site.repository === '.' ? ROOT : path.join(os.homedir(), site.repository);

function main(argv) {
  const [command = 'inspect', ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index].startsWith('--') || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Options require explicit values.');
    options[args[index].slice(2)] = args[index + 1];
  }
  const now = new Date().toISOString();
  if (command === 'inspect') {
    const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : portfolio.emptyState();
    return { status: 'ready', initialized: fs.existsSync(STATE_FILE), stateFile: STATE_FILE, ...portfolio.plan(state, manifest, now), sites: manifest.sites.map((site) => ({ ...site, repository: repository(site), available: fs.existsSync(path.join(repository(site), 'package.json')) })) };
  }
  const binding = inspectAutomationState(DEFAULT_MEMORY_PATH, new Date());
  if (binding.rotationErrors.length || binding.rotation?.threadPolicy !== 'same_thread' || options.thread !== binding.rotation.activeThreadId) throw new Error('Use the existing verified same-task automation binding.');
  let status = 'ready';
  const state = portfolio.updateStateFile(STATE_FILE, (current) => {
    if (current.threadId && current.threadId !== options.thread) throw new Error('Portfolio task binding mismatch.');
    if (command === 'init') return { ...current, threadId: options.thread };
    if (command === 'begin') {
      const result = portfolio.beginCycle(current, manifest, { threadId: options.thread, invocationAt: options['invocation-at'] });
      status = result.status;
      return result.state;
    }
    if (command === 'start-site') return portfolio.startSite(current, options.site, now);
    if (command === 'finish') return portfolio.finishCycle(current);
    if (command === 'record-site') {
      const receipt = JSON.parse(fs.readFileSync(options.evidence, 'utf8'));
      const site = manifest.sites.find((candidate) => candidate.id === receipt.siteId);
      if (!site || site.adapter === 'softora') throw new Error('Use record-softora for Softora; record-site accepts only the nine academies.');
      portfolio.validateReceipt(receipt, site);
      if (receipt.outcome !== 'blocked') portfolio.verifyArtifacts(receipt, repository(site));
      return portfolio.recordSite(current, manifest, { ...receipt, evidenceFile: path.resolve(options.evidence) }, now);
    }
    if (command === 'record-softora') {
      const proof = binding.lifecycle.lastReceipt;
      if (!proof || proof.threadId !== options.thread || Date.parse(proof.finishedAt) < Date.parse(current.activeCycle?.activeSite?.startedAt)) throw new Error('A fresh Softora finish-run receipt is required.');
      if (!options.evidence) throw new Error('An evidence JSON with actionType, lane and nextAction is required.');
      const detail = JSON.parse(fs.readFileSync(options.evidence, 'utf8'));
      const site = manifest.sites.find((candidate) => candidate.id === 'softora');
      return portfolio.recordSite(current, manifest, { ...detail, siteId: 'softora', outcome: proof.outcome === 'published' ? 'published' : 'blocked', changedPath: proof.changedUrl ? new URL(proof.changedUrl).pathname : null, verifiedOrigin: site.origin, evidence: proof.evidence, softoraReceipt: proof, evidenceFile: path.resolve(options.evidence) }, now);
    }
    throw new Error('Use inspect, init, begin, start-site, record-site, record-softora or finish.');
  });
  return { status, stateFile: STATE_FILE, ...portfolio.plan(state, manifest, now) };
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'blocked', error: error.message })}\n`); process.exitCode = 1; }
}

module.exports = { main };
