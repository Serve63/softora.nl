const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('../../server/services/seo-machine-portfolio');
const manifest = require('../../docs/growth/seo-machine-sites.json');
const threadId = 'portfolio-test-task';
const at = (date, hour = '08') => `2026-09-${date}T${hour}:15:00.000Z`;
const blocked = (siteId) => ({ siteId, outcome: 'blocked', evidence: 'The test fixture intentionally records an unavailable project.', nextAction: 'Restore the project before the next cycle.' });
function localReceipt(siteId = 'vitale-vrouwen', slug = 'onderwerp', lane = 'editorial') {
  const site = manifest.sites.find((candidate) => candidate.id === siteId);
  return {
    siteId, outcome: 'local_ready', evidence: 'Local article, sources and the linked offer have been checked.', nextAction: 'Review discovery after the domain has launched.',
    actionType: 'new_url', lane, changedPath: `/blog/${slug}`, verifiedOrigin: site.localOrigin,
    artifacts: [{ path: 'app/blog-data.ts', sha256: 'a'.repeat(64) }],
    checks: Object.fromEntries(['lint', 'typecheck', 'build'].map((key) => [key, { exitCode: 0, evidenceFile: `/tmp/portfolio-${key}.log` }])),
    research: { status: 'ready', contentCalls: 4, weeklyCalls: 0, evidenceFile: '/tmp/portfolio-research.json' },
    supportingAction: { path: '/blog', verified: true },
    pageExperience: { url: `${site.localOrigin}/blog/${slug}`, httpStatus: 200, mobile: true, desktop: true, interactionsPassed: true, mobileScreenshot: 'actual-mobile-tool-reference', desktopScreenshot: 'actual-desktop-tool-reference', review: 'Readable heading, working offer link and no horizontal overflow.' },
  };
}
function cycle(state, date, receipt) {
  state = p.beginCycle(state, manifest, { threadId, invocationAt: at(date) }).state;
  for (const site of p.plan(state, manifest, at(date)).pending) {
    state = p.startSite(state, site.id, at(date));
    state = p.recordSite(state, manifest, site.id === receipt?.siteId ? receipt : blocked(site.id), at(date, '09'));
  }
  return p.finishCycle(state);
}

test('the registry contains the approved ten distinct sites and nine local projects', () => {
  assert.equal(p.validateManifest(manifest), manifest);
  assert.deepEqual(manifest.sites.map((site) => site.id), [...p.SITE_IDS]);
  assert.equal(manifest.sites.filter((site) => site.mode === 'live').length, 1);
  assert.equal(manifest.sites[0].contentPolicy, 'seo_growth');
  for (const site of manifest.sites.slice(1)) {
    assert.equal(site.gscProperty, null);
    assert.equal(site.origin, null);
    assert.equal(site.adapter, 'academy');
    assert.equal(site.contentPolicy, 'blogs_only');
  }
  assert.throws(() => p.validateManifest({ ...manifest, sites: [...manifest.sites, manifest.sites[1]] }), /Exactly ten/);
  const unsafe = structuredClone(manifest);
  unsafe.sites[1].repository = '../other';
  assert.throws(() => p.validateManifest(unsafe), /Invalid/);
});

test('an interruption resumes the same cycle and site without losing completed sites', () => {
  let state = p.beginCycle(p.emptyState(), manifest, { threadId, invocationAt: at('01') }).state;
  state = p.startSite(state, 'softora', at('01'));
  state = p.recordSite(state, manifest, blocked('softora'), at('01', '09'));
  state = p.startSite(state, 'vitale-vrouwen', at('01', '10'));
  const resumed = p.beginCycle(state, manifest, { threadId, invocationAt: at('02') });
  assert.equal(resumed.status, 'resume');
  assert.deepEqual(resumed.state, state);
  assert.equal(p.plan(state, manifest, at('02')).pending.length, 9);
  assert.equal(p.plan(state, manifest, at('02')).pending[0].id, 'vitale-vrouwen');
  assert.throws(() => p.startSite(state, 'puppy', at('02')), /next pending/);
  assert.throws(() => p.finishCycle(state), /Every site/);
  assert.throws(() => p.beginCycle(state, manifest, { threadId: 'another-task', invocationAt: at('02') }), /binding/);
});

test('a complete cycle requires all ten receipts and does not repeat on the same day', () => {
  const state = cycle(p.emptyState(), '01', localReceipt());
  assert.equal(state.activeCycle, null);
  assert.equal(state.history.length, 10);
  assert.equal(state.history.filter((r) => r.outcome === 'local_ready').length, 1);
  assert.equal(p.beginCycle(state, manifest, { threadId, invocationAt: at('01', '12') }).status, 'already_complete');
  assert.equal(p.beginCycle(state, manifest, { threadId, invocationAt: at('02') }).status, 'started');
});

test('local source work cannot be admitted as live or verified on another site', () => {
  const site = manifest.sites[1];
  const receipt = localReceipt();
  assert.throws(() => p.validateReceipt({ ...receipt, outcome: 'published' }, site), /never a live/);
  assert.throws(() => p.validateReceipt({ ...receipt, verifiedOrigin: 'https://www.softora.nl' }, site), /another site/);
  const failedBuild = structuredClone(receipt);
  failedBuild.checks.build.exitCode = 1;
  assert.throws(() => p.validateReceipt(failedBuild, site), /build/);
  assert.throws(() => p.validateReceipt({ ...receipt, pageExperience: { ...receipt.pageExperience, desktop: false } }, site), /Both viewports/);
  assert.throws(() => p.validateReceipt({ ...receipt, research: { ...receipt.research, contentCalls: 7 } }, site), /bounds/);
  assert.throws(() => p.validateReceipt({ ...receipt, artifacts: [{ path: '../private', sha256: 'a'.repeat(64) }] }, site), /hashes/);
});

test('only Softora retains the money-page lane, including when academies go live', () => {
  const view = p.plan(p.emptyState(), manifest, at('01')).pending;
  assert.equal(view[0].maximumMoneyPagesPerWeek, 2);
  assert.deepEqual(view[0].allowedPublicationLanes, ['editorial', 'money_page']);
  for (const site of manifest.sites.slice(1)) {
    const capacity = view.find((item) => item.id === site.id);
    assert.equal(capacity.moneyPageAllowed, false);
    assert.equal(capacity.maximumMoneyPagesPerWeek, 0);
    assert.deepEqual(capacity.allowedPublicationLanes, ['editorial']);
    for (const actionType of ['new_url', 'substantial_refresh', 'other_growth_action']) {
      assert.throws(() => p.validateReceipt({ ...localReceipt(site.id, 'artikel', 'money_page'), actionType }, site), /only blogs/);
    }
    const live = { ...site, mode: 'live', origin: 'https://academy.example.com' };
    assert.throws(() => p.validateReceipt({ ...localReceipt(site.id, 'artikel', 'money_page'), outcome: 'published', verifiedOrigin: live.origin }, live), /only blogs/);
  }
});

test('the editorial seven-URL cap remains per academy and still permits blog refreshes', () => {
  let state = p.emptyState();
  for (let date = 1; date <= 7; date++) state = cycle(state, String(date).padStart(2, '0'), localReceipt('vitale-vrouwen', `artikel-${date}`));
  const view = p.plan(state, manifest, at('08')).pending;
  assert.equal(view.find((site) => site.id === 'vitale-vrouwen').newUrlAllowed, false);
  assert.equal(view.find((site) => site.id === 'puppy').newUrlAllowed, true);
  state = p.beginCycle(state, manifest, { threadId, invocationAt: at('08') }).state;
  state = p.startSite(state, 'softora', at('08'));
  state = p.recordSite(state, manifest, blocked('softora'), at('08'));
  state = p.startSite(state, 'vitale-vrouwen', at('08'));
  assert.throws(() => p.recordSite(state, manifest, localReceipt('vitale-vrouwen', 'artikel-8'), at('08')), /cap/);
  assert.doesNotThrow(() => p.recordSite(state, manifest, { ...localReceipt('vitale-vrouwen', 'artikel-1'), actionType: 'substantial_refresh' }, at('08')));
  assert.equal(p.plan(state, manifest, at('10')).pending.find((site) => site.id === 'vitale-vrouwen').newUrlAllowed, true);
});

test('an editorial label cannot admit an offer route, supporting offer edit or shared page file', () => {
  const site = manifest.sites[1];
  const receipt = localReceipt();
  for (const changedPath of ['/ebook', '/academy', '/academy/cursus', '/', '/kennisbank/uitleg', '/blog/../ebook', '/blog/%2e%2e/ebook']) {
    assert.throws(() => p.validateReceipt({ ...receipt, changedPath }, site), /blog overviews or individual/);
  }
  assert.throws(() => p.validateReceipt({ ...receipt, supportingAction: { path: '/ebook', verified: true } }, site), /supporting action/);
  for (const file of ['app/ebook/page.tsx', 'app/academy/page.tsx', 'app/page.tsx', 'app/globals.css', 'public/brand-logo.png']) {
    assert.throws(() => p.validateReceipt({ ...receipt, artifacts: [{ path: file, sha256: 'a'.repeat(64) }] }, site), /blog files/);
  }
  for (const file of ['app/blog/[slug]/page.tsx', 'app/blog/blog.module.css', 'app/article-guidance-life.ts', 'public/images/blog/artikel/hero.webp']) {
    assert.doesNotThrow(() => p.validateReceipt({ ...receipt, artifacts: [{ path: file, sha256: 'a'.repeat(64) }] }, site));
  }
  assert.throws(() => p.validateManifest({ ...manifest, sites: manifest.sites.map((item) => item.id === site.id ? { ...item, contentPolicy: 'seo_growth' } : item) }), /Only Softora/);
});

test('existing Softora publications remain in their native ledger and discovery is site-specific', () => {
  const first = p.plan(p.emptyState(), manifest, at('01')).pending;
  assert.equal(first[0].capacitySource, 'softora_live_publication_ledger');
  assert.equal(first[0].newUrlsLast7Days, null);
  assert.equal(first[0].newUrlAllowed, null);
  const receipt = localReceipt();
  receipt.research.weeklyCalls = 2;
  const state = cycle(p.emptyState(), '01', receipt);
  const second = p.plan(state, manifest, at('02')).pending;
  assert.equal(second.find((site) => site.id === 'vitale-vrouwen').weeklyDiscoveryDue, false);
  assert.equal(second.find((site) => site.id === 'puppy').weeklyDiscoveryDue, true);
  assert.equal(p.plan(state, manifest, at('09')).pending.find((site) => site.id === 'vitale-vrouwen').weeklyDiscoveryDue, true);
});

test('new URL deduplication does not confuse a local preparation with its later publication', () => {
  const state = cycle(p.emptyState(), '01', localReceipt());
  assert.throws(() => cycle(state, '02', localReceipt()), /already been recorded/);
  const launched = structuredClone(manifest);
  Object.assign(launched.sites[1], { mode: 'live', origin: 'https://academy.example.com', gscProperty: 'sc-domain:academy.example.com' });
  assert.equal(p.plan(state, launched, at('02')).pending.find((site) => site.id === 'vitale-vrouwen').newUrlsLast7Days, 0);
  assert.equal(p.plan(state, manifest, at('02')).pending.find((site) => site.id === 'vitale-vrouwen').newUrlsLast7Days, 1);
});

test('the Softora adapter cannot replace its eight existing gates with a local receipt', () => {
  const receipt = { ...localReceipt(), siteId: 'softora', outcome: 'published', verifiedOrigin: manifest.sites[0].origin };
  assert.throws(() => p.validateReceipt(receipt, manifest.sites[0]), /eight-gate/);
  receipt.softoraReceipt = { outcome: 'published', publicEffect: 'live', completionGateStatus: 'ready', changedUrl: receipt.verifiedOrigin + receipt.changedPath, gates: { cadence: { status: 'ready' } } };
  assert.throws(() => p.validateReceipt(receipt, manifest.sites[0]), /Missing Softora gate/);
});

test('source drift, symlink escapes and missing logs prevent evidence admission', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-proof-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'page.ts');
  fs.writeFileSync(source, 'verified source');
  const proof = { artifacts: [{ path: 'page.ts', sha256: crypto.createHash('sha256').update('verified source').digest('hex') }] };
  assert.doesNotThrow(() => p.verifyArtifacts(proof, directory));
  fs.writeFileSync(source, 'changed source');
  assert.throws(() => p.verifyArtifacts(proof, directory), /changed after/);
  fs.symlinkSync(os.tmpdir(), path.join(directory, 'outside'));
  assert.throws(() => p.verifyArtifacts({ artifacts: [{ path: 'outside', sha256: 'a'.repeat(64) }] }, directory), /escapes/);
  assert.throws(() => p.verifyArtifacts({ checks: { lint: { evidenceFile: path.join(directory, 'missing.log') } } }, directory));
});

test('academy blog artifacts cannot resolve to offer files inside the same repository', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-blog-scope-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'app/blog'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'app/ebook'));
  const content = 'verified source';
  fs.writeFileSync(path.join(directory, 'app/blog/page.tsx'), content);
  const proof = { siteId: 'vitale-vrouwen', artifacts: [{ path: 'app/blog/page.tsx', sha256: crypto.createHash('sha256').update(content).digest('hex') }] };
  assert.doesNotThrow(() => p.verifyArtifacts(proof, directory));
  fs.writeFileSync(path.join(directory, 'app/ebook/page.tsx'), content);
  fs.unlinkSync(path.join(directory, 'app/blog/page.tsx'));
  fs.symlinkSync('../ebook/page.tsx', path.join(directory, 'app/blog/page.tsx'));
  assert.throws(() => p.verifyArtifacts(proof, directory), /outside the allowed blog files/);
});

test('state writes are exclusive and corrupt state is preserved for recovery', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json');
  p.updateStateFile(file, (state) => state);
  fs.writeFileSync(`${file}.lock`, 'active writer');
  assert.throws(() => p.updateStateFile(file, (state) => state), /EEXIST/);
  fs.unlinkSync(`${file}.lock`);
  fs.writeFileSync(file, '{invalid');
  assert.throws(() => p.updateStateFile(file, () => p.emptyState()));
  assert.equal(fs.readFileSync(file, 'utf8'), '{invalid');
  assert.equal(fs.existsSync(`${file}.lock`), false);
});
