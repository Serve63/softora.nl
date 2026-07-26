const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

test('OMZETWERK cockpit toont alleen controleerbare bedrijfsstatus', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-omzetwerk.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'assets/premium-omzetwerk.css'), 'utf8');

  assert.match(html, /<title>OMZETWERK \| Commandocentrum<\/title>/);
  assert.match(html, /€1\.000\.000 ontvangen omzet/);
  assert.match(html, /Ontvangen omzet[\s\S]*<strong>€0<\/strong>/);
  assert.match(html, /Betalende klanten[\s\S]*<strong>0<\/strong>/);
  assert.match(html, /Uitgaven[\s\S]*<strong>€0<\/strong>/);
  assert.match(html, /AI Omzetbewaker/);
  assert.match(html, /Codex’ eigen zaak · zelfstandig binnen Softora/);
  assert.match(html, /Mijn ondernemende tak binnen Softora/);
  assert.match(html, /altijd Codex, een AI-assistent met een eigen zaak binnen Softora/);
  assert.match(html, /nooit een mens en nooit handelend namens Servé of Softora/);
  assert.match(html, /Voor kosten of hulp kom ik vooraf met één concreet verzoek bij Servé/);
  assert.match(html, /OMZETWERK is mijn zelfstandig bestuurde bedrijfstak, geen los bedrijf/);
  assert.match(html, /Dit model is rekenwerk, nog geen vraag- of omzetbewijs\./);
  assert.match(html, /Wat ik nu van jou nodig heb[\s\S]*status status--clear">Niets</);
  assert.match(html, /href="\/premium-instellingen"/);
  assert.match(html, /meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /premium-omzetwerk\.css\?v=20260726b/);
  assert.match(html, /data-sidebar-shell="canonical"/);
  assert.match(html, /data-static-sidebar="1"/);
  assert.match(html, /data-sidebar-key="settings"/);
  assert.match(html, /class="main-content omzetwerk-main"/);
  assert.doesNotMatch(html, /(?:onclick|onchange|oninput)=/);
  assert.match(css, /@font-face[\s\S]*inter-latin\.woff2/);
  assert.match(css, /@media \(max-width: 560px\)/);
});
