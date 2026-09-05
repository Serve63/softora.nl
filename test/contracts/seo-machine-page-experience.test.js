const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePageExperience } = require('../../server/services/seo-machine-page-experience');
const { buildPageExperience } = require('../fixtures/seo-page-experience');

const context = { url: 'https://www.softora.nl/blog/test-route', liveCommit: 'a'.repeat(40),
  nowMs: Date.parse('2026-08-28T07:10:00Z'), notBefore: '2026-08-28T06:15:00Z' };

test('page experience accepts distinct mobile and desktop observations bound to live route and commit', () => {
  const result = validatePageExperience(buildPageExperience(), context);
  assert.equal(result.status, 'ready', result.errors.join('\n'));
  assert.equal(result.summary.fieldDataStatus, 'unavailable');
});

test('page experience blocks missing, stale, future, wrong-route and wrong-commit evidence', () => {
  for (const mutate of [
    (e) => { e.views.pop(); },
    (e) => { e.views[0] = null; },
    (e) => { e.views[1].device = 'mobile'; },
    (e) => { e.url += '-other'; },
    (e) => { e.liveCommit = 'b'.repeat(40); },
    (e) => { e.capturedAt = '2026-08-28T05:00:00Z'; },
    (e) => { e.capturedAt = '2026-08-29T07:00:00Z'; },
    (e) => { e.browser = 'edge'; },
    (e) => { e.browser = 'chrome'; },
  ]) {
    const evidence = buildPageExperience(); mutate(evidence);
    assert.equal(validatePageExperience(evidence, context).status, 'blocked');
  }
  assert.equal(validatePageExperience(null, context).status, 'blocked');
  const chrome = { ...buildPageExperience(), browser: 'chrome', chromeReason: 'authenticated_session' };
  assert.equal(validatePageExperience(chrome, context).status, 'ready');
});

test('page experience blocks real usability failure even if the screenshot review says passed', () => {
  for (const mutate of [
    (v) => { v.documentWidth = 450; },
    (v) => { v.brokenImages = ['/broken.jpg']; },
    (v) => { v.bodyFontSize = 12; },
    (v) => { v.h1Count = 2; },
    (v) => { v.firstScreenAnswer = false; },
    (v) => { v.contact.unobscured = false; },
    (v) => { v.contact.keyboardFocusVisible = false; },
    (v) => { v.contact.rect.height = 30; },
    (v) => { v.contact.rect.x = 380; },
    (v) => { v.contact.href += '?text=test'; },
    (v) => { v.navigation.passed = false; },
    (v) => { v.visualReview.screenshotReference = ''; },
  ]) {
    const evidence = buildPageExperience(); mutate(evidence.views[0]);
    assert.equal(validatePageExperience(evidence, context).status, 'blocked');
  }
});

test('field-data absence is not a zero or lab score and poor field experience requires a next action', () => {
  const evidence = buildPageExperience();
  evidence.fieldData = { status: 'lab', score: 100 };
  assert.equal(validatePageExperience(evidence, context).status, 'blocked');
  evidence.fieldData = { status: 'measured', source: 'https://example.org/test-cwv-fixture', scope: 'url',
    percentile: 75, windowDays: 28, lcpMs: 3200, inpMs: 190, cls: 0.05 };
  assert.equal(validatePageExperience(evidence, context).status, 'blocked');
  evidence.fieldData.nextAction = 'Investigate the hero resource load before the next material update.';
  assert.equal(validatePageExperience(evidence, context).status, 'ready');
});
