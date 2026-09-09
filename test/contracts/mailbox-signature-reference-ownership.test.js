const test = require('node:test');
const assert = require('node:assert/strict');
const signature = require('../../assets/premium-mailbox-signature');
const presentation = require('../../assets/premium-mailbox-message-presentation').create({
  isSentMessageByProvenance: (message) => message.direction === 'sent',
  getMessageTimestamp: () => 0,
  getProvenOutboundThreadMessages: () => [],
  getDirectParentMessageIds: () => [],
  splitQuotedReply: require('../../assets/premium-mailbox-quoted-thread').splitQuotedThread,
});
const signoff = '\n\nMet vriendelijke groet,\nRobin Voorbeeld\nAdviseur\nTel: 06-12345678\nDorpsstraat 1 | 1234 AB Voorbeeldstad\n';
const quote = '\n\nMartijn van de Ven schreef op 2026-08-27 17:44:\n> Dit was mijn eerdere bericht zonder linknummers.\n';
const links = '\nLinks:\n------\n[1] https://example.nl\n[2] https://facebook.com/voorbeeld\n[3] https://instagram.com/voorbeeld\n[4] https://example.nl/bedrijfsfilm/';
function render(body) {
  const message = { body, from: 'Robin Voorbeeld', email: 'robin@example.nl', direction: 'received' };
  const root = presentation.getRootPresentation(body, message);
  const parts = []; root.appendContact(parts);
  const thread = presentation.getThreadPresentation(message, message);
  assert.equal(root.body, thread.body);
  assert.equal(parts.join(''), thread.contactHtml);
  assert.equal(message.body, body, 'de oorspronkelijke tekst blijft ongewijzigd');
  return { body: root.body, html: thread.contactHtml };
}

test('iconverwijzingen worden afzonderlijke contacten zonder afhankelijkheid van nummers in het citaat', () => {
  for (const history of ['', quote, quote.replace('linknummers.', 'linknummers [1].')]) {
    const result = render('Akkoord.' + signoff + '[1] [2] [3] [4]' + history + links);
    assert.equal(result.body, 'Akkoord.');
    assert.match(result.html, /href="https:\/\/example.nl\/"/);
    for (const value of ['Robin Voorbeeld', 'Adviseur', 'tel:0612345678', 'Dorpsstraat 1', '1234 AB Voorbeeldstad']) assert.ok(result.html.includes(value), value);
    assert.doesNotMatch(result.html, /facebook|instagram|bedrijfsfilm|Links:|\[\d+\]|\]\(/);
  }
});

test('een gelabelde referentie na een citaat hoort bij de handtekening', () => {
  const result = render('Akkoord.' + signoff + 'Onze website [1]' + quote + '\nLinks:\n-----\n[1] https://example.nl');
  assert.equal(result.body, 'Akkoord.');
  assert.match(result.html, /href="https:\/\/example.nl\/"[^>]*>Onze website<\/a>/);
  assert.doesNotMatch(result.html, /\[1\]/);
});

test('een cluster met slechts twee verwijzingen is geen referentiedefinitie', () => {
  const result = render('Akkoord.' + signoff + '[1] [2]' + quote + '\nLinks:\n----\n[1] https://example.nl\n[2] https://facebook.com/voorbeeld');
  assert.equal(result.body, 'Akkoord.');
  assert.match(result.html, /href="https:\/\/example.nl\/"/);
  assert.doesNotMatch(result.html, /facebook|\[1\]|\[2\]/);
});

test('inhoudelijke bronverwijzingen houden hun definitie als de handtekening dezelfde voetnoot gebruikt', () => {
  const result = render('Lees de voorwaarden [1].' + signoff + 'Website [1]' + quote + '\nLinks:\n-----\n[1] https://example.nl');
  assert.match(result.body, /Lees de voorwaarden \[1\]/);
  assert.match(result.body, /\[1\] https:\/\/example.nl/);
  assert.match(result.html, /href="https:\/\/example.nl\/"/);
});

test('onbekende en conflicterende nummers leiden niet tot gegokte linkbestemmingen', () => {
  for (const definitions of ['', '\n[1] javascript:alert(1)', '\n[1] https://one.example\n[1] https://two.example']) {
    const result = render('Akkoord.' + signoff + '[1] [2]' + quote + definitions);
    assert.match(result.html, /\[1\]/);
    assert.match(result.html, /\[2\]/);
    assert.doesNotMatch(result.html, /href="(?:https:\/\/(?:one|two)|javascript)/);
  }
});

test('signaturepromotie wordt per onderdeel verwijderd en nuttige tekst blijft bestaan', () => {
  const result = render('We bespreken Instagram als kanaal.' + signoff +
    'Volg ons:\nLinkedIn voorbeeld bv\nInstagram @voorbeeld | WhatsApp: 0687654321\nhttps://m.facebook.com/voorbeeld\n[@voorbeeld](https://instagram.com/voorbeeld)\n[*www.example.nl*](https://example.nl)\n[Besproken voorbeeld](https://instagram.com/p/voorbeeld)');
  assert.equal(result.body, 'We bespreken Instagram als kanaal.');
  assert.match(result.html, /WhatsApp: 0687654321/);
  assert.match(result.html, />www.example.nl<\/a>/);
  assert.match(result.html, /href="https:\/\/instagram.com\/p\/voorbeeld"/);
  assert.doesNotMatch(result.html, /LinkedIn|@voorbeeld|m.facebook|\*www/);
});

test('herkenbare afzender en contactvelden ondersteunen ontbrekende of afwijkende groet', () => {
  for (const boundary of ['\nRobin Voorbeeld', 'Grt.\nRobin Voorbeeld', 'Met vriendelijke groet, kind regards,\nRobin Voorbeeld', 'Met vriendelijke groet, Robin Voorbeeld']) {
    const result = render('Akkoord.\n\n' + boundary + '\nTel: 0612345678\nVolg ons:\nInstagram @voorbeeld');
    assert.equal(result.body, 'Akkoord.');
    assert.match(result.html, /Robin Voorbeeld/);
    assert.match(result.html, /tel:0612345678/);
    assert.doesNotMatch(result.html, /Instagram/);
  }
});

test('de standaardfooter verdwijnt met numerieke bijlage en na samenklappen van regels', () => {
  for (const body of [
    'Akkoord.\n\nVerzonden vanaf Outlook voor Android [1]\n\nLinks:\n----\n[1] https://aka.ms/AAb9ysg',
    'Akkoord. Sent from my iPhone',
    'Akkoord. Verzonden vanaf mijn iPad',
  ]) assert.equal(render(body).body, 'Akkoord.');
  const result = render('Akkoord.' + signoff + 'Verzonden vanaf Outlook voor Android [1]\nWhatsApp: 0687654321\n[1] https://aka.ms/AAb9ysg');
  assert.doesNotMatch(result.html, /Outlook|aka.ms|\[1\]/);
  assert.match(result.html, /WhatsApp: 0687654321/);
});

test('footeropruiming wist geen definitie die nog bij inhoudelijke tekst hoort', () => {
  const body = 'De documentatie staat in [1].\nVerzonden vanaf Outlook voor Android [1]\n\n[1] https://aka.ms/AAb9ysg';
  const result = signature.stripClientFooter(body);
  assert.match(result, /De documentatie staat in \[1\]/);
  assert.match(result, /\[1\] https:\/\/aka.ms\/AAb9ysg/);
});

test('samengeplakte Galaxy-footer verdwijnt zonder afzender of inhoud weg te nemen', () => {
  for (const text of ['Hoi MartijnBedankt voor je voorstel.MvgRob', 'Dag Serve,Bedankt voor de moeite.Met vriendelijke groetSjef']) {
    assert.equal(render(text + 'Verzonden vanaf mijn Galaxy').body, text);
  }
  const literal = 'Deze tekst bevat VerzendinformatieVerzonden vanaf mijn Galaxy';
  assert.equal(render(literal).body, literal);
});
