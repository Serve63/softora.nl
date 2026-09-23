const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('logboek-cut keeps the set details below the title and aligned with the exercise', () => {
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
  assert.match(rule, /font-weight:\s*700\b/);
});

test('logboek-cut fills the page without an outer card on desktop and mobile', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/logboek-cut.css'), 'utf8');
  assert.match(css, /\.app\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.workout\s*\{[^}]*width:\s*100%[^}]*border:\s*0/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(css, /\.exercise\s*\{[^}]*margin-inline:\s*calc\(-1 \* var\(--row-gutter\)\)/);
});

test('logboek-cut has no training progress badge or progress bar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../logboek-cut.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../../assets/logboek-cut.js'), 'utf8');
  assert.doesNotMatch(html, /id="training-completion"|class="progress-head"|<progress\b|id="progress-label"|id="percent"/);
  assert.doesNotMatch(script, /\$\('training-completion'\)|\$\('progress-label'\)|\$\('percent'\)|\$\('progress'\)/);
});

test('completed exercise fill and separators reach the full screen width', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/logboek-cut.css'), 'utf8');
  const row = css.match(/\.exercise::before\s*\{([^}]+)\}/)?.[1];
  const complete = css.match(/\.exercise\.complete::before\s*\{([^}]+)\}/)?.[1];
  assert.ok(row);
  assert.match(row, /width:\s*100vw/);
  assert.match(row, /border-top:\s*1px solid var\(--line\)/);
  assert.match(css, /\.app\s*\{[^}]*overflow-x:\s*clip/);
  assert.ok(complete);
  assert.match(complete, /background:\s*#edf8ef/);
  assert.match(complete, /border-color:\s*#b9d9c0/);
});
