const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDocument, DomUtils } = require('htmlparser2');
const view = require('../../assets/premium-mailbox-contact-view');
const presentation = require('../../assets/premium-mailbox-message-presentation').create({
  isSentMessageByProvenance: (message) => message.direction === 'sent',
  getMessageTimestamp: () => 0,
  getProvenOutboundThreadMessages: () => [],
  getDirectParentMessageIds: () => [],
  splitQuotedReply: require('../../assets/premium-mailbox-quoted-thread').splitQuotedThread,
});
const authored = 'Dank voor je voorstel. Ik heb op dit moment geen interesse.\n\nKun je mijn gegevens uit jullie systeem halen? Bedankt.';
const footer = 'Robin Voorbeeld\nAdviseur milieu & stikstofdepositie\n(Aanwezig op ma-ochtend, di, wo, do, vrij)\nVoorbeeld Advies\nI: www.example.nl | T: 06-12345678 | info@example.nl\nAdres: Voorbeeldlaan 6\n1234 AB Voorbeeld';
const visible = (html) => DomUtils.textContent(parseDocument(html));

test('every existing and future incoming view shows only authored text, phone and address', () => {
  for (const signoff of ['', 'Met vriendelijke groet,\n']) for (const source of ['gmail', 'strato', 'instantly', 'future-provider']) {
    for (const owner of ['serve', 'martijn']) for (const date of ['2026-08-01', '2027-01-01']) {
      const body = `${authored}\n\n${signoff}${footer}`;
      const message = Object.freeze({ body, from: 'Robin Voorbeeld', email: 'info@example.nl', source, date, accountEmail: `${owner}@example.nl` });
      const root = presentation.getRootPresentation(body, message);
      const parts = [];
      assert.equal(root.appendContact(parts), true);
      assert.equal(root.appendContact(parts), false);
      const thread = presentation.getThreadPresentation(message, message);
      for (const html of [parts.join(''), thread.contactHtml]) {
        assert.equal(visible(html), 'Telefoon:06 12 34 56 78Adres:Voorbeeldlaan 61234 AB Voorbeeld');
        assert.match(html, /href="tel:0612345678"/);
        assert.doesNotMatch(html, /Adviseur|Aanwezig|Advies|www\.|info@|Robin/);
      }
      assert.equal(root.body, authored);
      assert.equal(thread.body, authored);
      assert.equal(message.body, body);
    }
  }
});

test('new arbitrary signature roles, availability, companies and links cannot leak through', () => {
  const body = `Akkoord.\n\nGroet,\nRobin Voorbeeld\nChief Future Officer\nUnbekannte Zusatzzeile\nBureau Nieuwe Naam\nTelefonisch bereikbaar op dinsdag\nKlantnummer 987654321\n[Onze website](https://example.nl)\nhttps://social.example/robin`;
  const message = { body, from: 'Robin Voorbeeld', email: 'robin@example.nl' };
  const result = presentation.getThreadPresentation(message, message);
  assert.equal(result.body, 'Akkoord.');
  assert.equal(result.contactHtml, '');
  assert.equal(message.body, body);
});

test('body text about roles, availability, websites and quoted disclaimers is never filtered as a signature', () => {
  const text = 'Ik ben adviseur milieu & stikstofdepositie.\nDinsdag ben ik voor jou beschikbaar.\nLees mijn voorstel op https://example.nl/voorstel.\nDeze tekst wil ik aanpassen: Print deze e-mail alleen indien het noodzakelijk is.';
  const message = { body: `${text}\n\nGroet,\n${footer}`, from: 'Robin Voorbeeld', email: 'info@example.nl' };
  assert.equal(presentation.getThreadPresentation(message, message).body, text);
});

test('a wrapped personal postscript belongs to the authored message, not to the contact block', () => {
  const note = 'P.S. Kun je het voorstel morgen naar mij\nsturen? Dan bespreken we de prijs.';
  const message = { body: `${authored}\n\nGroet,\n${footer}\n\n${note}`, from: 'Robin Voorbeeld', email: 'info@example.nl' };
  const result = presentation.getThreadPresentation(message, message);
  assert.equal(result.body, `${authored}\n\n${note}`);
  assert.doesNotMatch(result.contactHtml, /voorstel|sturen|prijs|P.S/);
});

test('a multi-sentence postscript remains complete until the next contact field or footer paragraph', () => {
  const note = 'P.S. De planning is aangepast.\nHet voorstel mag naar mijn collega.\nDaarna bespreken we samen de prijs.';
  const body = `${authored}\n\nGroet,\n${footer}\n\n${note}\nTel: 06-87654321\n\nEen andere bedrijfsnaam\nManager bijzondere projecten`;
  const message = { body, from: 'Robin Voorbeeld', email: 'info@example.nl' };
  for (const result of [presentation.getRootPresentation(body, message), presentation.getThreadPresentation(message, message)]) {
    assert.equal(result.body, `${authored}\n\n${note}`);
  }
  const html = presentation.getThreadPresentation(message, message).contactHtml;
  assert.match(html, /href="tel:0687654321"/);
  assert.doesNotMatch(html, /collega|Manager|bedrijfsnaam|planning/);
});

test('several phones, extensions and postal addresses remain structured without unknown numbers', () => {
  const result = view.renderContactDetails({ phone: '06-12345678', beforeLines: ['Extra rol', 'M: +31 (0)6 12345678',
    'T: 020 1234567 toestel 9', 'WhatsApp: +44 20 1234 5678', 'Klantnummer 12345678'],
    addressLines: ['44 King Street', 'London SW1A 1AA', 'United Kingdom'] });
  assert.equal((result.match(/06 12 34 56 78/g) || []).length, 1);
  assert.match(result, /href="tel:0201234567;ext&#61;9"/);
  assert.match(result, /020 1234567 \(toestel 9\)/);
  assert.match(result, /href="tel:\+442012345678"/);
  for (const value of ['44 King Street', 'London SW1A 1AA', 'United Kingdom']) assert.ok(result.includes(value));
  assert.doesNotMatch(result, /Extra rol|Klantnummer|tel:12345678/);
});

test('no field or note is taken from a quoted third-party signature', () => {
  const body = 'Mijn antwoord.\n\nOp 21 sep 2026 om 09:00 schreef Robin Voorbeeld:\n> Groet,\n> Robin Voorbeeld\n> Tel: 06-12345678\n> Voorbeeldlaan 6\n> 1234 AB Voorbeeld\n> P.S. Bel me.';
  const message = { body, from: 'Andere Afzender', email: 'ander@example.nl' };
  const result = presentation.getThreadPresentation(message, message);
  assert.equal(result.body, 'Mijn antwoord.');
  assert.equal(result.contactHtml, '');
});

test('address values are escaped and unsafe links cannot become contact actions', () => {
  const result = view.renderContactDetails({ phone: '[bel](javascript:alert(1))', addressLines: ['<img src=x onerror=alert(1)>'], beforeLines: ['[klik](javascript:alert(1))'] });
  assert.doesNotMatch(result, /<img|onerror=|href=/);
  assert.match(result, /&lt;img/);
});
