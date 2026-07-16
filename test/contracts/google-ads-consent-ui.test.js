const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootGoogleAdsConsent } = require('../../assets/google-ads-consent');
const middlewareSource = fs.readFileSync(
  path.join(__dirname, '../../server/services/app-middleware-runtime.js'),
  'utf8'
);

test('publieke CSP laat uitsluitend de benodigde Google tag-host toe', () => {
  assert.match(middlewareSource, /scriptSrc:[\s\S]*https:\/\/www\.googletagmanager\.com/);
  assert.doesNotMatch(middlewareSource, /scriptSrc:[\s\S]*https:\/\/www\.google\.com/);
});

function element(tagName) {
  return {
    tagName: String(tagName || '').toUpperCase(),
    children: [],
    parentNode: null,
    hidden: true,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
    },
    addEventListener() {},
    setAttribute(name, value) { this[name] = value; },
  };
}

async function runConsentAsset({ payload, cookie = '', existingBanner = null } = {}) {
  const body = element('body');
  const head = element('head');
  let storedCookie = cookie;
  const document = {
    body,
    head,
    createElement: element,
    getElementById(id) { return id === 'cookieConsent' ? existingBanner : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get cookie() { return storedCookie; },
    set cookie(value) { storedCookie = value; },
  };
  const window = {
    document,
    fetch: async () => ({ ok: true, json: async () => payload }),
  };
  window.window = window;
  bootGoogleAdsConsent(window);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { body, head, window, getCookie: () => storedCookie };
}

test('Google Ads tag-gate blijft zonder volledige publieke config volledig uit', async () => {
  const result = await runConsentAsset({
    payload: { ok: true, enabled: false, consentMode: 'basic-v2', tagId: '', conversionLabel: '' },
  });
  assert.equal(result.head.children.length, 0);
  assert.equal(result.body.children.length, 0);
  assert.equal(result.window.SoftoraGoogleAdsConsent.getState(), 'unknown');
  assert.equal(result.window.SoftoraGoogleAdsConsent.recordConversion({ id: 'x' }), false);
});

test('Google Ads tag-gate toont eerst toestemming en laadt Google nog niet', async () => {
  const result = await runConsentAsset({
    payload: { ok: true, enabled: true, consentMode: 'basic-v2', tagId: 'AW-123', conversionLabel: 'lead' },
  });
  assert.equal(result.head.children.length, 0);
  assert.equal(result.body.children.some((item) => item.className === 'softora-consent'), true);
  assert.equal(result.window.SoftoraGoogleAdsConsent.getState(), 'unknown');
  const consentDefault = result.window.dataLayer[0];
  assert.equal(consentDefault[0], 'consent');
  assert.equal(consentDefault[1], 'default');
  assert.equal(consentDefault[2].ad_storage, 'denied');
  assert.equal(consentDefault[2].ad_user_data, 'denied');
});

test('Google Ads tag en conversie laden uitsluitend na eerder gegeven toestemming', async () => {
  const result = await runConsentAsset({
    cookie: 'softora_cookie_consent=accepted',
    payload: { ok: true, enabled: true, consentMode: 'basic-v2', tagId: 'AW-123', conversionLabel: 'lead' },
  });
  assert.equal(result.window.SoftoraGoogleAdsConsent.getState(), 'granted');
  assert.equal(result.head.children.length, 1);
  assert.equal(result.head.children[0].src, 'https://www.googletagmanager.com/gtag/js?id=AW-123');
  assert.equal(result.window.SoftoraGoogleAdsConsent.recordConversion({ id: 'event-1' }), true);
  const conversion = result.window.dataLayer.at(-1);
  assert.equal(conversion[0], 'event');
  assert.equal(conversion[1], 'conversion');
  assert.equal(conversion[2].send_to, 'AW-123/lead');
  assert.equal(conversion[2].transaction_id, 'event-1');
});
