const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('shared custom select assets support Softora dropdown variants', () => {
  const cssSource = readRepoFile('assets/custom-selects.css');
  const jsSource = readRepoFile('assets/custom-selects.js');

  assert.match(cssSource, /\.site-select-trigger \{/);
  assert.match(cssSource, /\.site-select-menu \{/);
  assert.match(cssSource, /\.site-select-option\.is-selected \{/);
  assert.match(cssSource, /\.site-select-trigger #campaignRegioTip \{/);
  assert.match(cssSource, /\.topbar-right \.site-select--pill \.site-select-trigger::before \{/);
  assert.match(cssSource, /\.sidebar-link-lock-icon \{/);

  assert.match(jsSource, /const customSelectInstances = new Map\(\);/);
  assert.match(jsSource, /serviceLockOptionValues = new Set\(\["voice_software", "business_software", "ai_chatbots"\]\)/);
  assert.match(jsSource, /if \(select\.id === "regio"\) \{/);
  assert.match(jsSource, /new MutationObserver\(\(mutations\) => \{/);
  assert.match(jsSource, /root\.querySelectorAll\("select"\)/);
  assert.match(jsSource, /select\.form\.addEventListener\("reset"/);
  assert.match(jsSource, /window\.initCustomFormSelects = initCustomFormSelects;/);
  assert.match(jsSource, /window\.refreshCustomFormSelects = refreshCustomFormSelects;/);
});

test('pages with dropdowns all load the shared custom select assets', () => {
  const pages = [
    'ai-coldmailing.html',
    'ai-lead-generator.html',
    'premium-actieve-opdrachten.html',
    'premium-ai-lead-generator.html',
    'premium-bevestigingsmails.html',
    'premium-database.html',
    'premium-instellingen.html',
    'premium-klanten.html',
    'premium-pdfs.html',
    'premium-seo-crm-system.html',
    'premium-seo.html',
    'premium-vaste-lasten.html',
    'seo-crm-system.html',
  ];

  pages.forEach((relativePath) => {
    const source = readRepoFile(relativePath);
    assert.match(
      source,
      /assets\/custom-selects\.css\?v=20260421a/,
      `${relativePath} should load the shared custom select stylesheet`
    );
    assert.match(
      source,
      /assets\/custom-selects\.js\?v=20260421a/,
      `${relativePath} should load the shared custom select script`
    );
  });
});
