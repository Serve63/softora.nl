const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test("premium pagina's tonen het uniforme telefoonnummer van WhatsApp", () => {
  const files = [
    'premium-bedrijfssoftware.html',
    'premium-websites.html',
    'premium-over-softora.html',
    'premium-chatbot.html',
    'premium-voicesoftware.html',
    'premium-website.html',
    'premium-privacy-policy.html',
    'premium-bevestigingsmails.html',
  ];
  const repoRoot = path.resolve(__dirname, '../..');
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(source, /\+31 6 2991 7185/, `${file} bevat nog het oude telefoonnummer met spaties.`);
    assert.doesNotMatch(source, /\+31629917185/, `${file} bevat nog het oude telefonnummer zonder spaties.`);
    assert.doesNotMatch(source, /tel:\+31629917185/, `${file} bevat nog een tel-link met het oude nummer.`);
  }
});

test('premium telefoonnummer links gebruiken het juiste WhatsApp-nummer', () => {
  const files = [
    'premium-bedrijfssoftware.html',
    'premium-over-softora.html',
    'premium-chatbot.html',
    'premium-voicesoftware.html',
  ];
  const repoRoot = path.resolve(__dirname, '../..');
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.match(source, /https:\/\/wa\.me\/31643262792/, `${file} heeft geen juiste WhatsApp-link meer.`);
    assert.doesNotMatch(source, /href="tel:/, `${file} mag geen tel-link meer als primaire CTA gebruiken.`);
  }

  const websiteSource = fs.readFileSync(path.join(repoRoot, 'premium-websites.html'), 'utf8');
  assert.match(websiteSource, /id="growth-website-intake"/);
  assert.match(websiteSource, /data-softora-conversion-target="website-intake"/);
  assert.doesNotMatch(websiteSource, /https:\/\/wa\.me\//, 'De vaste website-intake mag niet terugvallen op handmatige WhatsApp-opvolging.');
});
