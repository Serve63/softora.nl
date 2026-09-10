const test = require('node:test');
const assert = require('node:assert/strict');
const display = require('../../assets/premium-mailbox-display');
const signature = require('../../assets/premium-mailbox-signature');

test('equivalent Outlook destinations become one readable website or email', () => {
  for (const gap of ['', ' ', '\t']) {
    assert.equal(display.normalizeAngleLinkAnnotations(`www.example.nl${gap}<http://www.example.nl>`), '[www.example.nl](http://www.example.nl/)');
    assert.equal(display.normalizeAngleLinkAnnotations(`E-mail: Contact@example.nl${gap}<mailto:Contact@example.nl>`), 'E-mail: Contact@example.nl');
  }
  assert.equal(display.normalizeAngleLinkAnnotations('Zie example.nl/Plan?q=A#Step<https://example.nl/Plan?q=A#Step>.'), 'Zie [example.nl/Plan?q=A#Step](https://example.nl/Plan?q=A#Step).');
});

test('different destinations, literal text and unsupported protocols remain visible', () => {
  for (const text of [
    'www.example.nl<http://other.example.nl>',
    'www.example.nl/Plan<http://www.example.nl/plan>',
    'www.example.nl?q=A<http://www.example.nl?q=a>',
    'www.example.nl#Step<http://www.example.nl#step>',
    'info@example.nl<mailto:other@example.nl>',
    'info@example.nl<mailto:info@example.nl?subject=Vraag>',
    'www.example.nl<javascript:alert(1)>',
    'www.example.nl<http://user:example@www.example.nl>',
    'a < b > c',
  ]) assert.equal(display.normalizeAngleLinkAnnotations(text), text);
});

test('automatic Outlook image labels are removed, meaningful descriptions stay', () => {
  for (const artifact of [
    '[Afbeelding met Graphics, Lettertype, schermopname, logo Automatisch gegenereerde beschrijving]',
    '[Image with text, logo Automatically generated description]',
    '[image: Afbeelding met logo Automatisch gegenereerde beschrijving]',
  ]) assert.equal(display.normalizePresentationText(`Inhoud.\n${artifact}\nTelefoon: 020 123 4567`), 'Inhoud.\nTelefoon: 020 123 4567');
  for (const authored of [
    '[Afbeelding met een beschadigde doos]',
    '[image: Productfoto met maatvoering]',
    'De automatisch gegenereerde beschrijving klopt niet.',
    'Het voorbeeld is: [Afbeelding met logo Automatisch gegenereerde beschrijving]',
    '`[Afbeelding met logo Automatisch gegenereerde beschrijving]`',
  ]) assert.equal(display.normalizePresentationText(authored), authored);
});

test('standalone contact-card renderer also cleans artifacts while keeping actual contacts', () => {
  const contact = { beforeLines: ['Robin Voorbeeld'], phone: '020 123 4567', addressLines: ['Dorpsstraat 12'],
    preservedLines: ['www.example.nl<http://www.example.nl>', 'info@example.nl<mailto:info@example.nl>',
      '[Afbeelding met logo Automatisch gegenereerde beschrijving]'] };
  const snapshot = JSON.stringify(contact);
  const html = signature.renderContactCard(contact);
  assert.match(html, /class="detail-mail-contact-link" href="http:\/\/www.example.nl\/"[^>]*>www.example.nl<\/a>/);
  assert.match(html, /href="mailto:info@example.nl"/);
  assert.match(html, /tel:0201234567/);
  assert.match(html, /Dorpsstraat 12/);
  assert.doesNotMatch(html, /&lt;http|&lt;mailto|Afbeelding|gegenereerde/);
  assert.equal(JSON.stringify(contact), snapshot);
});
