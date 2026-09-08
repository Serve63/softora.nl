const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeoCore } = require('../../server/services/seo-core');
const { createWebsiteGenerationHelpers } = require('../../server/services/website-generation');

function scanAndPrompt(body) {
  const scan = createSeoCore().extractWebsitePreviewScanFromHtml(`<html><head><title>Garage</title><meta name="description" content="Onderhoud &amp; reparatie"></head><body>${body}</body></html>`, 'https://garage.example/');
  return { scan, prompt: createWebsiteGenerationHelpers().buildWebsitePreviewPromptFromScan(scan) };
}

test('hidden nested source links never enter any website design prompt field', () => {
  const { scan, prompt } = scanAndPrompt(`<header><div style="display: none;"><div><h1>Hidden identity</h1><h2>Hidden heading</h2><p>Hidden paragraph</p><a href="https://unrelated.example/">Hidden navigation</a><button>Plan Hidden CTA</button><img src="https://unrelated.example/hidden.jpg" alt="Hidden image"></div></div><nav><a href="/">Home</a><a href="/afspraak">Afspraak maken</a></nav></header><h1>Autogarage</h1><p>Onderhoud en reparatie.</p>`);
  assert.equal(scan.title, 'Garage');
  assert.equal(scan.h1, 'Autogarage');
  assert.deepEqual(scan.navigationLabels, ['Home', 'Afspraak maken']);
  assert.match(prompt, /Onderhoud en reparatie/);
  assert.doesNotMatch(JSON.stringify(scan), /Hidden|unrelated\.example/i);
  assert.doesNotMatch(prompt, /Hidden|unrelated\.example/i);
});

test('explicit HTML hiding, inline hiding and non-rendered content are excluded', () => {
  const { prompt } = scanAndPrompt(`<div hidden><p>Hidden attribute</p></div><div style="DISPLAY: /* comment */ none !important"><p>Hidden display</p></div><div style="visibility: hidden"><p>Hidden visibility</p></div><template><p>Hidden template</p></template><noscript><p>Hidden fallback</p></noscript><script>Hidden script</script><!-- <p>Hidden comment</p> --><p>Visible company copy.</p>`);
  assert.doesNotMatch(prompt, /Hidden (?:attribute|display|visibility|template|fallback|script|comment)/i);
  assert.match(prompt, /Visible company copy/);
});

test('visible content and decorative brand content remain regardless of wording', () => {
  const { scan, prompt } = scanAndPrompt(`<header aria-hidden="true"><a href="/">Visible brand</a></header><div style="display:none; display:block"><p>Visible override</p></div><div style="display:none!important;display:block"><p>Hidden important</p></div><p>Visible unrelated.example content</p>`);
  assert.match(prompt, /Visible brand/);
  assert.match(prompt, /Visible override/);
  assert.match(prompt, /Visible unrelated\.example content/);
  assert.doesNotMatch(prompt, /Hidden important/);
  assert.equal(scan.metaDescription, 'Onderhoud & reparatie');
});
