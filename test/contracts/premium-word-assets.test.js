const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium word assets: editorhulpmiddelen en stijl blijven los van opslag', () => {
  const toolsSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-word-tools.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-word.css'), 'utf8');

  assert.match(toolsSource, /window\.SoftoraWordTools = \{ create: create \}/);
  assert.match(toolsSource, /function tableAction\(action\)/);
  assert.match(toolsSource, /function replaceAll\(\)/);
  assert.match(toolsSource, /function exportAs\(kind\)/);
  assert.match(toolsSource, /isSafeHref\(url\)/);
  assert.match(toolsSource, /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mammoth\//);
  assert.doesNotMatch(toolsSource, /localStorage|sessionStorage|innerHTML\s*=|getUiStateClient/);
  assert.match(styleSource, /\.word-page\s*\{/);
  assert.match(styleSource, /\.word-ribbon\s*\{/);
  assert.match(styleSource, /@media print/);
});
