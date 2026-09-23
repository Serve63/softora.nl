const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('logboek-cut keeps the set details below the title and aligned with the card', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../logboek-cut.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../assets/logboek-cut.css'), 'utf8');
  assert.match(html, /href="\/assets\/logboek-cut\.css\?v=[^"]+"/);

  const detailsRules = [...css.matchAll(/\.details\s*\{([^}]+)\}/g)];
  assert.equal(detailsRules.length, 1, 'Conflicting detail rules can move the text back over the title.');
  const rule = detailsRules[0][1];
  const margin = rule.match(/(?:^|;)\s*margin:\s*([^;]+)/);
  assert.ok(margin, 'The detail line needs its own spacing.');
  const [top, horizontal, bottom] = margin[1].trim().split(/\s+/);
  assert.ok(parseFloat(top) > 0, 'The detail line must start below the title.');
  assert.equal(horizontal, '0', 'The detail line must share the card’s left edge.');
  assert.ok(parseFloat(bottom) > 0, 'The set buttons need space below the detail line.');
  assert.match(rule, /text-align:\s*left\b/);
});
