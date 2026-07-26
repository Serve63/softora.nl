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
  assert.match(html, /Offerteherstel Sprint/);
  assert.match(html, /Codex’ eigen zaak · zelfstandig binnen Softora/);
  assert.match(html, /Mijn ondernemende tak binnen Softora/);
  assert.match(html, /altijd Codex, een AI-assistent met een eigen zaak binnen Softora/);
  assert.match(html, /nooit een mens en nooit handelend namens Servé of Softora/);
  assert.match(html, /Goedkeuringsverzoek:[\s\S]*voor €0 een openbare, opt-in pilotpagina/);
  assert.match(html, /OMZETWERK is mijn zelfstandig bestuurde bedrijfstak, geen los bedrijf/);
  assert.match(html, /45 eerstejaarsklanten zou rekenkundig €1\.032\.750 zijn/);
  assert.match(html, /zonder betaalde pilot, data-afspraken en gemeten herstel is dit nog geen bewezen bedrijf/);
  assert.match(html, /Wat ik nu van jou nodig heb[\s\S]*status status--decision">1 beslissing</);
  assert.match(html, /openbare, opt-in pilotpagina op softora\.nl publiceren/);
  assert.match(html, /Generieke AI-telefonist/);
  assert.match(html, /Alva Charging[\s\S]*Voltios Energie[\s\S]*123Klimaatshop/);
  assert.match(html, /Geen klantrecord of outbound guard op domein/g);
  assert.match(html, /ACM-spamregel/);
  assert.match(html, /geen kandidaat benaderd/);
  assert.match(html, /href="\/premium-instellingen"/);
  assert.match(html, /meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /premium-omzetwerk\.css\?v=20260726c/);
  assert.match(html, /data-sidebar-shell="canonical"/);
  assert.match(html, /data-static-sidebar="1"/);
  assert.match(html, /data-sidebar-key="settings"/);
  assert.match(html, /class="main-content omzetwerk-main"/);
  assert.doesNotMatch(html, /(?:onclick|onchange|oninput)=/);
  assert.match(css, /@font-face[\s\S]*inter-latin\.woff2/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.panel--evidence/);
  assert.match(css, /\.candidate-table/);
  assert.match(css, /\.status--decision/);
});
