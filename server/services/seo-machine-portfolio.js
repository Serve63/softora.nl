const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SITE_IDS = Object.freeze(['softora', 'vitale-vrouwen', 'zwanger-baby', 'relatie', 'puppy', 'katten', 'moestuin', 'huis-klus', 'loopbaan', 'huid-haar']);
const WEEK_MS = 7 * 86400000;
const clone = (value) => JSON.parse(JSON.stringify(value));
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const iso = (value) => {
  requireThat(typeof value === 'string' && /T.*Z$/.test(value) && Number.isFinite(Date.parse(value)), 'A UTC ISO timestamp is required.');
  return new Date(value).toISOString();
};
const day = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const safeRelative = (value) => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');

function validateManifest(manifest) {
  requireThat(manifest?.schemaVersion === 1 && manifest.automationId === 'softora-seo-actiemachine', 'Invalid portfolio identity.');
  requireThat(manifest.threadPolicy === 'same_thread' && manifest.schedulePolicy === 'all_sites_each_cycle', 'Every cycle must serve all sites in the same task.');
  requireThat(Array.isArray(manifest.sites) && manifest.sites.length === SITE_IDS.length, 'Exactly ten approved sites are required.');
  requireThat(new Set(manifest.sites.map((site) => site.id)).size === SITE_IDS.length, 'Duplicate sites.');
  for (const site of manifest.sites) {
    requireThat(SITE_IDS.includes(site.id) && site.name && site.topic && safeRelative(site.repository), 'Invalid site or repository.');
    requireThat(['live', 'local_prelaunch'].includes(site.mode), 'Invalid site mode.');
    requireThat(site.adapter === (site.id === 'softora' ? 'softora' : 'academy'), 'Invalid site adapter.');
    requireThat(site.id === 'softora' ? site.repository === '.' : site.repository.startsWith('Desktop/'), 'Invalid repository location.');
    requireThat(Array.isArray(site.offerPaths) && site.offerPaths.length > 0 && site.offerPaths.every((p) => /^\/(?!\/)/.test(p)), 'Offer routes are required.');
    if (site.mode === 'local_prelaunch') {
      requireThat(site.origin === null && site.gscProperty === null && /^http:\/\/localhost:\d+$/.test(site.localOrigin), 'Local sites cannot declare live origins or Search Console data.');
    } else {
      const origin = new URL(site.origin);
      requireThat(origin.protocol === 'https:' && origin.origin === site.origin && !origin.username && !origin.password && origin.hostname.includes('.') && !/localhost|\.local$|^[\d.]+$/.test(origin.hostname), 'A public HTTPS origin is required.');
    }
  }
  return manifest;
}

function emptyState() {
  return { schemaVersion: 1, threadId: null, activeCycle: null, history: [] };
}

function validateState(state) {
  requireThat(state?.schemaVersion === 1 && Array.isArray(state.history), 'Invalid portfolio state; do not reset it.');
  requireThat(state.threadId === null || typeof state.threadId === 'string', 'Invalid task binding.');
  for (const receipt of state.history) {
    requireThat(SITE_IDS.includes(receipt.siteId) && ['published', 'local_ready', 'blocked'].includes(receipt.outcome), 'Invalid historical site receipt.');
    iso(receipt.finishedAt);
    iso(receipt.cycleId);
    requireThat(receipt.cycleDate === day(receipt.cycleId), 'Invalid historical cycle date.');
  }
  if (state.activeCycle) {
    const cycle = state.activeCycle;
    iso(cycle.id);
    requireThat(cycle.order?.length === SITE_IDS.length && new Set(cycle.order).size === SITE_IDS.length && cycle.order.every((id) => SITE_IDS.includes(id)), 'Invalid persisted queue.');
    requireThat(cycle.receipts && typeof cycle.receipts === 'object' && !Array.isArray(cycle.receipts) && Object.keys(cycle.receipts).every((id) => SITE_IDS.includes(id)), 'Invalid site receipts.');
    requireThat(cycle.activeSite === null || (SITE_IDS.includes(cycle.activeSite.id) && !cycle.receipts[cycle.activeSite.id]), 'Invalid active site.');
  }
  return state;
}

function plan(state, manifest, now) {
  validateManifest(manifest);
  validateState(state);
  const timestamp = iso(now);
  const cycle = state.activeCycle;
  return {
    cycleId: cycle?.id || null,
    activeSite: cycle?.activeSite || null,
    completedCount: Object.keys(cycle?.receipts || {}).length,
    pending: (cycle?.order || SITE_IDS).filter((id) => !cycle?.receipts[id]).map((id) => {
      const site = manifest.sites.find((candidate) => candidate.id === id);
      const recent = state.history.filter((r) => r.siteId === id && Date.parse(r.finishedAt) > Date.parse(timestamp) - WEEK_MS && Date.parse(r.finishedAt) <= Date.parse(timestamp));
      const actions = recent.filter((r) => r.outcome === (site.mode === 'live' ? 'published' : 'local_ready'));
      const newUrls = actions.filter((r) => r.actionType === 'new_url');
      const moneyPages = newUrls.filter((r) => r.lane === 'money_page');
      const lastAttempt = state.history.filter((r) => r.siteId === id).at(-1);
      const lastDiscovery = state.history.filter((r) => r.siteId === id && r.research?.weeklyCalls > 0 && r.research.status === 'ready').at(-1)?.finishedAt || null;
      const nativeLedger = site.adapter === 'softora';
      return {
        ...site, countedOutcome: site.mode === 'live' ? 'published' : 'local_ready',
        capacitySource: nativeLedger ? 'softora_live_publication_ledger' : 'portfolio_receipts',
        newUrlsLast7Days: nativeLedger ? null : newUrls.length, moneyPagesLast7Days: nativeLedger ? null : moneyPages.length,
        newUrlAllowed: nativeLedger ? null : newUrls.length < 7, moneyPageAllowed: nativeLedger ? null : newUrls.length < 7 && moneyPages.length < 2,
        maximumNewUrlsPerWeek: 7, maximumMoneyPagesPerWeek: 2,
        lastWeeklyDiscoveryAt: lastDiscovery, weeklyDiscoveryDue: nativeLedger ? null : !lastDiscovery || Date.parse(timestamp) - Date.parse(lastDiscovery) >= WEEK_MS,
        lastAttempt: lastAttempt ? { outcome: lastAttempt.outcome, finishedAt: lastAttempt.finishedAt, evidenceFile: lastAttempt.evidenceFile, nextAction: lastAttempt.nextAction } : null,
      };
    }),
  };
}

function beginCycle(input, manifest, { threadId, invocationAt }) {
  validateManifest(manifest);
  validateState(input);
  const at = iso(invocationAt);
  requireThat(typeof threadId === 'string' && threadId.length >= 8, 'A task id is required.');
  requireThat(input.threadId === null || input.threadId === threadId, 'The task binding must remain unchanged.');
  if (input.activeCycle) return { state: clone(input), status: 'resume' };
  if (input.history.some((r) => r.cycleDate === day(at))) return { state: clone(input), status: 'already_complete' };
  const state = clone(input);
  state.threadId = threadId;
  const last = (id) => Date.parse(state.history.filter((r) => r.siteId === id).at(-1)?.finishedAt || '1970-01-01');
  const order = [...SITE_IDS].sort((a, b) => last(a) - last(b));
  state.activeCycle = { id: at, date: day(at), order, activeSite: null, receipts: {} };
  return { state, status: 'started' };
}

function startSite(input, siteId, now) {
  validateState(input);
  const state = clone(input);
  const cycle = state.activeCycle;
  requireThat(cycle, 'Begin or resume a portfolio cycle first.');
  const next = cycle.order.find((id) => !cycle.receipts[id]);
  requireThat(next === siteId, 'Serve the next pending site; do not skip the queue.');
  requireThat(!cycle.activeSite || cycle.activeSite.id === siteId, 'Another site is active.');
  cycle.activeSite ||= { id: siteId, startedAt: iso(now) };
  return state;
}

function validateReceipt(receipt, site) {
  requireThat(receipt?.siteId === site.id && ['local_ready', 'published', 'blocked'].includes(receipt.outcome), 'Invalid site outcome.');
  requireThat(typeof receipt.evidence === 'string' && receipt.evidence.trim().length >= 20, 'Specific evidence is required.');
  requireThat(typeof receipt.nextAction === 'string' && receipt.nextAction.trim().length >= 8, 'A next action is required.');
  if (receipt.outcome === 'blocked') return;
  requireThat(['new_url', 'substantial_refresh', 'other_growth_action'].includes(receipt.actionType) && ['editorial', 'money_page'].includes(receipt.lane), 'Classify the actual improvement and its publication lane.');
  requireThat(/^\/(?!\/)[^?#]*$/.test(receipt.changedPath), 'One canonical changed path is required.');
  requireThat(site.mode === 'live' ? receipt.outcome === 'published' : receipt.outcome === 'local_ready', 'Local work is never a live publication.');
  requireThat(receipt.verifiedOrigin === (site.mode === 'live' ? site.origin : site.localOrigin), 'Route proof belongs to another site or environment.');
  if (site.adapter === 'softora') {
    const proof = receipt.softoraReceipt;
    requireThat(proof?.outcome === 'published' && proof.publicEffect === 'live' && proof.completionGateStatus === 'ready' && proof.changedUrl === site.origin + receipt.changedPath, 'Softora requires its existing eight-gate live receipt.');
    for (const gate of ['cadence', 'reviews', 'selection', 'keywords', 'visuals', 'verify_critical', 'live_production', 'live_route']) {
      requireThat(proof.gates?.[gate]?.status === 'ready', `Missing Softora gate: ${gate}.`);
    }
    return;
  }
  requireThat(Array.isArray(receipt.artifacts) && receipt.artifacts.length > 0 && receipt.artifacts.every((file) => safeRelative(file.path) && /^[a-f0-9]{64}$/.test(file.sha256)), 'Changed source files and hashes are required.');
  for (const check of ['lint', 'typecheck', 'build']) requireThat(receipt.checks?.[check]?.exitCode === 0 && receipt.checks[check].evidenceFile, `Missing successful ${check} evidence.`);
  const browser = receipt.pageExperience;
  requireThat(browser?.url === receipt.verifiedOrigin + receipt.changedPath && browser.httpStatus === 200 && browser.mobile === true && browser.desktop === true && browser.interactionsPassed === true && browser.mobileScreenshot && browser.desktopScreenshot && typeof browser.review === 'string' && browser.review.length >= 20, 'Both viewports, screenshots, interactions and a real visual review are required.');
  requireThat(receipt.supportingAction?.path && receipt.supportingAction.path !== receipt.changedPath && receipt.supportingAction.verified === true, 'A verified supporting route is required.');
  requireThat(receipt.research?.evidenceFile && ['ready', 'not_required', 'external_research_unavailable', 'auth_blocked', 'quota_blocked'].includes(receipt.research.status), 'Record research provenance and the actual provider status.');
  const research = receipt.research;
  requireThat(Number.isInteger(research.contentCalls) && research.contentCalls >= 0 && research.contentCalls <= 6 && Number.isInteger(research.weeklyCalls) && research.weeklyCalls >= 0 && research.weeklyCalls <= 2, 'Ubersuggest usage exceeds the per-site bounds.');
  if (site.mode === 'live') requireThat(/^[a-f0-9]{40}$/.test(receipt.liveCommit) && receipt.liveProof?.versionMatches === true && receipt.liveProof?.canonical === site.origin + receipt.changedPath && receipt.liveProof?.indexable === true, 'A production version, canonical and indexability proof are required.');
}

function recordSite(input, manifest, receipt, now) {
  validateManifest(manifest);
  validateState(input);
  const state = clone(input);
  const cycle = state.activeCycle;
  requireThat(cycle?.activeSite?.id === receipt?.siteId, 'Start the matching site first.');
  const finishedAt = iso(now);
  requireThat(Date.parse(finishedAt) >= Date.parse(cycle.activeSite.startedAt), 'Receipt predates the site work.');
  const site = manifest.sites.find((candidate) => candidate.id === receipt.siteId);
  validateReceipt(receipt, site);
  const capacity = plan(state, manifest, finishedAt).pending.find((candidate) => candidate.id === site.id);
  if (receipt.outcome !== 'blocked' && receipt.actionType === 'new_url') {
    if (site.adapter !== 'softora') requireThat(capacity.newUrlAllowed && (receipt.lane !== 'money_page' || capacity.moneyPageAllowed), 'The per-site rolling publication cap has been reached.');
    requireThat(!state.history.some((r) => r.siteId === site.id && r.outcome === receipt.outcome && r.actionType === 'new_url' && r.changedPath === receipt.changedPath), 'This URL has already been recorded as new.');
  }
  const record = { ...clone(receipt), cycleId: cycle.id, cycleDate: cycle.date, startedAt: cycle.activeSite.startedAt, finishedAt };
  cycle.receipts[site.id] = record;
  cycle.activeSite = null;
  state.history.push(record);
  return state;
}

function finishCycle(input) {
  validateState(input);
  requireThat(input.activeCycle && !input.activeCycle.activeSite && SITE_IDS.every((id) => input.activeCycle.receipts[id]), 'Every site needs a completion or blocker receipt before closing the cycle.');
  const state = clone(input);
  state.activeCycle = null;
  return state;
}

function verifyArtifacts(receipt, repoRoot) {
  for (const artifact of receipt.artifacts || []) {
    requireThat(safeRelative(artifact.path), 'Unsafe artifact path.');
    const resolved = fs.realpathSync(path.join(repoRoot, artifact.path));
    const root = fs.realpathSync(repoRoot) + path.sep;
    requireThat(resolved.startsWith(root), 'Artifact escapes the repository.');
    requireThat(crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex') === artifact.sha256, 'Source changed after verification.');
  }
  for (const evidenceFile of [...Object.values(receipt.checks || {}).map((check) => check.evidenceFile), receipt.research?.evidenceFile].filter(Boolean)) {
    requireThat(path.isAbsolute(evidenceFile) && fs.statSync(evidenceFile).isFile() && fs.statSync(evidenceFile).size > 0, 'Missing evidence file.');
  }
}

function updateStateFile(file, operation) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lockFile = `${file}.lock`;
  const lock = fs.openSync(lockFile, 'wx', 0o600);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(lock, String(process.pid));
    const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : emptyState();
    validateState(state);
    const updated = operation(state);
    validateState(updated);
    fs.writeFileSync(temp, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return updated;
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}

module.exports = { SITE_IDS, validateManifest, emptyState, validateState, plan, beginCycle, startSite, validateReceipt, recordSite, finishCycle, verifyArtifacts, updateStateFile };
