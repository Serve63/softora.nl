const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clipText,
  escapeHtml,
  normalizeColdcallingStack,
  normalizeNlPhoneToE164,
  normalizeString,
  parseIntSafe,
  parseNumberSafe,
  truncateText,
} = require('../../server/services/runtime-primitives');

test('runtime primitives normalize strings and numbers safely', () => {
  assert.equal(normalizeString('  softora  '), 'softora');
  assert.equal(normalizeString(null, 'fallback'), 'fallback');
  assert.equal(parseIntSafe('42.9', 0), 42);
  assert.equal(parseIntSafe('abc', 7), 7);
  assert.equal(parseNumberSafe('12.5', 0), 12.5);
  assert.equal(parseNumberSafe('', 3), 3);
});

test('runtime primitives normalize coldcalling stacks and Dutch phone numbers', () => {
  assert.equal(normalizeColdcallingStack('Gemini'), 'gemini_flash_3_1_live');
  assert.equal(normalizeColdcallingStack('openai realtime 1.5'), 'openai_realtime_1_5');
  assert.equal(normalizeColdcallingStack('unknown'), 'retell_ai');
  assert.equal(normalizeNlPhoneToE164('06 12 34 56 78'), '+31612345678');
  assert.equal(normalizeNlPhoneToE164('+31 6 12 34 56 78'), '+31612345678');
});

test('runtime primitives escape and trim text consistently', () => {
  assert.equal(escapeHtml('<a href="/x">\'test\'</a>'), '&lt;a href=&quot;/x&quot;&gt;&#39;test&#39;&lt;/a&gt;');
  assert.equal(truncateText('abcdef', 5), 'abcd...');
  assert.equal(clipText('abcdef', 5), 'abcde');
  assert.equal(clipText('abcdef', 0), '');
});
