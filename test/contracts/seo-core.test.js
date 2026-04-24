const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoCore } = require('../../server/services/seo-core');

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  return String(value || '').slice(0, maxLength);
}

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBooleanSafe(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'ja', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'nee', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString().replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

function normalizeWebsitePreviewTargetUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function createSeoCoreFixture() {
  return createSeoCore({
    knownHtmlPageFiles: new Set(['index.html', 'premium-website.html', 'premium-blog.html', 'premium-seo.html']),
    normalizeAbsoluteHttpUrl,
    normalizeString,
    normalizeWebsitePreviewTargetUrl,
    parseIntSafe,
    seoDefaultSiteOrigin: 'https://www.softora.nl',
    seoMaxImagesPerPage: 20,
    seoModelPresets: [
      { value: 'gpt-5.5', label: 'GPT-5.5' },
      { value: 'gpt-5.1', label: 'GPT-5.1' },
      { value: 'gpt-5-mini', label: 'GPT-5 mini' },
      { value: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
    ],
    seoPageFieldDefs: [
      { key: 'title', maxLength: 300 },
      { key: 'metaDescription', maxLength: 1000 },
      { key: 'metaKeywords', maxLength: 1000 },
      { key: 'canonical', maxLength: 1200 },
      { key: 'robots', maxLength: 250 },
      { key: 'ogTitle', maxLength: 300 },
      { key: 'ogDescription', maxLength: 1000 },
      { key: 'ogImage', maxLength: 1200 },
      { key: 'twitterTitle', maxLength: 300 },
      { key: 'twitterDescription', maxLength: 1000 },
      { key: 'twitterImage', maxLength: 1200 },
      { key: 'h1', maxLength: 300 },
    ],
    toBooleanSafe,
    truncateText,
  });
}

test('seo core normalizes config and filters unknown files', () => {
  const seoCore = createSeoCoreFixture();

  const config = seoCore.normalizeSeoConfig({
    version: 1,
    pages: {
      'premium-website.html': {
        title: ' Softora Website ',
        metaDescription: '',
      },
      'unknown.html': {
        title: 'Moet weg',
      },
    },
    images: {
      'premium-website.html': {
        '/hero.png': ' Held ',
        '/empty.png': '',
      },
      'evil.js': {
        '/x': 'Y',
      },
    },
    automation: {
      preferredModel: 'gpt51',
      blogAutomationEnabled: 'true',
      blogCadence: 'dagelijks',
      blogModel: 'opus46',
    },
  });

  assert.equal(config.version, 2);
  assert.deepEqual(Object.keys(config.pages), ['premium-website.html']);
  assert.deepEqual(config.pages['premium-website.html'], { title: 'Softora Website' });
  assert.deepEqual(config.images['premium-website.html'], { '/hero.png': 'Held' });
  assert.equal(config.automation.preferredModel, 'gpt-5.1');
  assert.equal(config.automation.blogAutomationEnabled, true);
  assert.equal(config.automation.blogCadence, 'daily');
  assert.equal(config.automation.blogModel, 'claude-opus-4.6');
});

test('seo core defaults automation models to GPT-5.5', () => {
  const seoCore = createSeoCoreFixture();

  const config = seoCore.normalizeSeoConfig({});

  assert.equal(config.automation.preferredModel, 'gpt-5.5');
  assert.equal(config.automation.blogModel, 'gpt-5.5');
  assert.equal(seoCore.normalizeSeoModelPreset('gpt55'), 'gpt-5.5');
});

test('seo core builds audit suggestions for weak pages', () => {
  const seoCore = createSeoCoreFixture();

  const audit = seoCore.buildSeoPageAuditEntry(
    'premium-website.html',
    { title: 'Kort' },
    {},
    {
      title: 'Kort',
      metaDescription: 'Te kort',
      canonical: '',
      robots: 'noindex',
      ogTitle: '',
      ogDescription: '',
      twitterTitle: '',
      twitterDescription: '',
      h1: '',
    },
    [{ src: '/hero.png', alt: '' }]
  );

  assert.equal(audit.file, 'premium-website.html');
  assert.equal(audit.health.titleHealthy, false);
  assert.equal(audit.health.canonicalHealthy, false);
  assert.equal(audit.suggestedPageOverrides.canonical, 'https://www.softora.nl/premium-website');
  assert.ok(audit.suggestedPageOverrides.title.includes('Softora'));
  assert.equal(audit.suggestedImageOverrides['/hero.png'], 'Visual van Kort - Softora');
  assert.ok(audit.score < 80);
});

test('seo core applies page and image overrides to html', () => {
  const seoCore = createSeoCoreFixture();
  const html = `<!doctype html>
<html>
  <head>
    <title>Oud</title>
    <meta name="description" content="Oud beschrijving">
  </head>
  <body>
    <h1>Oude titel</h1>
    <img src="/hero.png">
  </body>
</html>`;

  const nextHtml = seoCore.applySeoOverridesToHtml('premium-website.html', html, {
    pages: {
      'premium-website.html': {
        title: 'Nieuw',
        metaDescription: 'Nieuwe beschrijving',
        canonical: 'https://www.softora.nl/premium-website',
        h1: 'Nieuwe H1',
      },
    },
    images: {
      'premium-website.html': {
        '/hero.png': 'Hero afbeelding',
      },
    },
  });

  assert.match(nextHtml, /<title>Nieuw<\/title>/);
  assert.match(nextHtml, /content="Nieuwe beschrijving"/);
  assert.match(nextHtml, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/premium-website">/);
  assert.match(nextHtml, /<h1>Nieuwe H1<\/h1>/);
  assert.match(nextHtml, /<img src="\/hero\.png" alt="Hero afbeelding">/);
});

test('seo core extracts website preview scan data from html', () => {
  const seoCore = createSeoCoreFixture();
  const scan = seoCore.extractWebsitePreviewScanFromHtml(
    `<!doctype html>
<html>
  <head>
    <title>Softora Preview</title>
    <meta name="description" content="Een korte preview beschrijving">
    <meta property="og:image" content="/og-softora.jpg">
  </head>
  <body>
    <header>
      <nav>
        <a href="/">Home</a>
        <a href="/diensten">Diensten</a>
        <a href="/contact">Contact</a>
      </nav>
      <a class="hero-cta" href="/start">Start project</a>
    </header>
    <h1>Welkom bij Softora</h1>
    <h2>Onze aanpak</h2>
    <p>Wij bouwen websites die converteren.</p>
    <img src="/hero-image.png" alt="Hero visual">
  </body>
</html>`,
    'softora.nl/preview'
  );

  assert.equal(scan.url, 'https://softora.nl/preview');
  assert.equal(scan.host, 'softora.nl');
  assert.equal(scan.title, 'Softora Preview');
  assert.equal(scan.h1, 'Welkom bij Softora');
  assert.deepEqual(scan.headings, ['Onze aanpak']);
  assert.deepEqual(scan.navigationLabels, ['Home', 'Diensten', 'Contact', 'Start project']);
  assert.deepEqual(scan.ctaLabels, ['Start project', 'Contact']);
  assert.ok(scan.layoutHints.includes('kaart- of gridstructuur') === false);
  assert.ok(scan.layoutHints.includes('volledige homepage met footer') === false);
  assert.deepEqual(scan.visualCues, ['Hero visual']);
  assert.deepEqual(scan.referenceImageUrls, [
    'https://softora.nl/og-softora.jpg',
    'https://softora.nl/hero-image.png',
  ]);
  assert.ok(scan.bodyTextSample.includes('Wij bouwen websites die converteren.'));
});
