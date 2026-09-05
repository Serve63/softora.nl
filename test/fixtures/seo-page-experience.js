// Synthetic contract fixture. Never use this as production browser evidence.
function buildPageExperience({ url = 'https://www.softora.nl/blog/test-route', liveCommit = 'a'.repeat(40),
  capturedAt = '2026-08-28T09:00:00+02:00' } = {}) {
  return {
    schemaVersion: 1, url, liveCommit, capturedAt, browser: 'iab',
    views: ['mobile', 'desktop'].map((device) => ({
      device, viewport: { width: device === 'mobile' ? 390 : 1440, height: 900 },
      documentWidth: device === 'mobile' ? 390 : 1440,
      h1Count: 1, brokenImages: [], bodyFontSize: 17, firstScreenAnswer: true,
      contact: { href: 'https://wa.me/31643262792', label: 'Contact',
        rect: { x: 250, y: 14, width: 90, height: 44 }, unobscured: true, keyboardFocusVisible: true },
      navigation: { passed: true, evidence: 'Synthetic test: menu opens and article anchor reaches the heading.' },
      visualReview: { passed: true, evidence: 'Synthetic test: readable answer and contact without overlap.',
        screenshotReference: 'Synthetic test fixture, not an actual browser screenshot.' },
    })),
    fieldData: { status: 'unavailable', reason: 'Synthetic fixture has no production field measurement.' },
  };
}

module.exports = { buildPageExperience };
