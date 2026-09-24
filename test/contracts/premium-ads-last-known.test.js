const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function node(tag) {
  const children = [];
  return { tag, children, textContent: '', className: '', disabled: false, listeners: {},
    appendChild(child) { children.push(child); return child; },
    replaceChildren(...next) { children.splice(0, children.length, ...next); },
    addEventListener(type, fn) { this.listeners[type] = fn; } };
}

const originals = { window: globalThis.window, document: globalThis.document };
test.afterEach(() => {
  for (const [name, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
  }
});

function load(provider, remembered) {
  const elements = new Map();
  const stored = new Map(remembered ? [[`${provider}-ads`, remembered]] : []);
  const pending = [];
  globalThis.document = {
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, node('div')); return elements.get(id); },
    createElement: (tag) => node(tag),
    body: node('body'),
  };
  globalThis.window = {
    fetch: (url) => new Promise((resolve) => pending.push({ url, resolve })),
    SoftoraReadModelStore: {
      readLastKnown: (name) => (stored.has(name) ? stored.get(name) : null),
      rememberLastKnown: (name, value) => { stored.set(name, value); return true; },
    },
  };
  const scriptPath = path.join(__dirname, `../../assets/premium-${provider}-ads.js`);
  delete require.cache[require.resolve(scriptPath)];
  require(scriptPath);
  return { get: (id) => globalThis.document.getElementById(id), pending, stored };
}

function googleData(spendCents) {
  return {
    status: { ok: true, spendCents, liveCampaigns: 0, conversionCount: 0, readinessReady: 3, readinessTotal: 4, readiness: [{ ready: true, label: 'Tag' }] },
    blueprint: { ok: true, campaigns: [{ name: 'Websites', intent: 'Leads', themes: ['web'] }], sharedNegativeKeywords: ['gratis'] },
    pack: { ok: true, validation: { valid: true, campaignsChecked: 1, landingPagesReady: 1, errors: [] },
      campaigns: [{ name: 'Websites', headlines: ['a'], descriptions: ['b'], keywords: ['c'], finalUrl: 'https://softora.nl', path1: 'x', path2: 'y' }] },
  };
}

test('Google Ads opens with the last verified status; the launch pack only downloads once live', async () => {
  const page = load('google', googleData(1250));
  assert.equal(page.get('googleAdsSpend').textContent, '€ 12,50', 'remembered status is on screen before any request returns');
  assert.equal(page.get('googleAdsCampaigns').children.length, 1);
  assert.equal(page.get('googleAdsDownloadPack').disabled, true, 'a remembered launch pack is never downloadable');

  const live = googleData(2000);
  for (const request of page.pending) {
    const key = request.url.endsWith('/status') ? 'status' : request.url.endsWith('/blueprint') ? 'blueprint' : 'pack';
    request.resolve({ ok: true, json: async () => live[key] });
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.get('googleAdsSpend').textContent, '€ 20,00');
  assert.equal(page.get('googleAdsDownloadPack').disabled, false);
  assert.equal(page.stored.get('google-ads').status.spendCents, 2000, 'the verified live data is remembered');
});

test('Facebook Ads keeps its loading placeholders without a remembered result', () => {
  const page = load('facebook', null);
  assert.equal(page.get('facebookAdsSpend').textContent, '');
  assert.equal(page.pending.length, 3);
});
