const test = require('node:test');
const assert = require('node:assert/strict');
const signature = require('../../assets/premium-mailbox-signature.js');
const presentation = require('../../assets/premium-mailbox-message-presentation.js').create({
  isSentMessageByProvenance: (message) => message.direction === 'sent',
  getMessageTimestamp: () => 0,
  getProvenOutboundThreadMessages: () => [],
  getDirectParentMessageIds: () => [],
  splitQuotedReply: require('../../assets/premium-mailbox-quoted-thread.js').splitQuotedThread,
});

const cases = [
  {
    name: 'samengeplakte naam, telefoon en website',
    from: 'Robin Voorbeeld', email: 'robin@example.nl',
    body: 'Dank voor je ontwerp.\n\nIk wens je veel succes.\n\nMet vriendelijke groet,\nRobin Voorbeeld\n\n*Robin VoorbeeldTel: 06-12345678www.example.nl\n *\n\nOp wo 9 sep 2026 om 09:59 schreef Servé Creusen :\n> Oude tekst\n> Tel: 06-99999999',
    expected: ['Robin Voorbeeld', 'href="tel:0612345678"', 'href="https://www.example.nl/"'],
    absent: /\*Robin|VoorbeeldTel|12345678www|99999999|Oude tekst/,
  },
  {
    name: 'hotelcontact met pictogrammen en een reserveringsvoetnoot achter het citaat',
    from: 'Hotel Voorbeeld', email: 'info@hotel.example',
    body: 'Dank, ik stuur het door.\n\nVriendelijke groet,\n\nJamie Voorbeeld\nHotel Voorbeeld\n\n📍 Dorpsstraat 2-1 | 1234 AB Voorbeeldstad\n📞 013 123 45 67\n\nMaak hier je reservering [2]\n\nVolg ons:\nInstagram @hotelvoorbeeld | LinkedIn Hotel Voorbeeld\n\nServé Creusen schreef op 2026-09-09 11:02:\n> Oude ontwerptekst [1]\n\nLinks:\n------\n[1] https://www.softora.nl/webdesign/voorbeeld\n[2] https://booking.example/hotel/nl/%20',
    expected: ['Jamie Voorbeeld', 'Hotel Voorbeeld', 'href="tel:0131234567"', 'Dorpsstraat 2-1, 1234 AB Voorbeeldstad', 'href="https://booking.example/hotel/nl/%20"', '>Maak hier je reservering</a>', 'Instagram @hotelvoorbeeld'],
    absent: /\[2\]|Oude ontwerptekst|webdesign\/voorbeeld/,
  },
];

for (const fixture of cases) {
  test(`root en dossier behouden ${fixture.name} voor bestaande en toekomstige providerberichten`, () => {
    for (const owner of ['serve', 'martijn']) for (const provider of ['gmail', 'strato', 'instantly']) {
      for (const date of ['2026-08-01', '2027-01-01']) {
        const message = { ...fixture, accountEmail: `${owner}@softora.nl`, source: provider, date, direction: 'received' };
        const root = presentation.getRootPresentation(message.body, message);
        const rootHtml = [root.body];
        assert.equal(root.appendContact(rootHtml), true);
        assert.equal(root.appendContact(rootHtml), false);
        const thread = presentation.getThreadPresentation(message, message);
        for (const html of [rootHtml.join(''), thread.body + thread.contactHtml]) {
          for (const expected of fixture.expected) assert.ok(html.includes(expected), `${owner}/${provider}/${date}: ${expected}`);
          assert.doesNotMatch(html, fixture.absent);
          assert.equal((html.match(/class="detail-mail-contact-card"/g) || []).length, 1);
        }
        assert.equal(message.body, fixture.body);
      }
    }
  });
}

test('dezelfde naam verschijnt eenmaal in de contactkaart en de antwoordtekst blijft intact', () => {
  const fixture = cases[0];
  const result = signature.parseIncoming(fixture.body, fixture);
  const html = signature.renderContactCard(result.contact);
  assert.equal((html.match(/Robin Voorbeeld/g) || []).length, 1);
  assert.match(result.bodyLines.join('\n'), /^Dank voor je ontwerp\.\n\nIk wens je veel succes\./);
});

test('alle nuttige extra tekst blijft behouden en een onbekend nummer wordt geen verzonnen telefoonlink', () => {
  const body = 'Akkoord.\n\nGroet,\nRobin Voorbeeld\nAdviseur\nTel: 06-12345678\nWhatsApp: 06-87654321\nBereikbaar op maandag en woensdag\nKlantnummer 12345678\nP.S. Stuur de offerte graag in het Engels.';
  const parsed = signature.parseIncoming(body);
  const html = signature.renderContactCard(parsed.contact);
  for (const text of ['Robin Voorbeeld', 'Adviseur', 'WhatsApp: 06-87654321', 'Bereikbaar op maandag en woensdag', 'Klantnummer 12345678', 'P.S. Stuur de offerte graag in het Engels.']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /tel:12345678/);
});

test('onbewezen, conflicterende en onveilige linkreferenties blijven tekst zonder actieve bestemming', () => {
  for (const appendix of ['', '\n[2] javascript:alert(1)', '\n[2] https://one.example\n[2] https://two.example']) {
    const parsed = signature.parseIncoming(`Akkoord.\n\nGroet,\nVoorbeeld\nReserveer hier [2]\n\nOp wo 9 sep 2026 om 09:59 schreef Servé Creusen :\n> Oude tekst${appendix}`);
    const html = signature.renderContactCard(parsed.contact);
    assert.match(html, /Reserveer hier \[2\]/);
    assert.doesNotMatch(html, /href=/);
  }
  const html = signature.renderContactCard({ beforeLines: ['[klik](javascript:alert(1))', '<img src=x onerror=alert(1)>', '[site](https://user:secret@example.nl)'], addressLines: [] });
  assert.doesNotMatch(html, /href=|<img|onerror=/);
  assert.match(html, /&lt;img/);
});

test('bracketgetallen zonder bewezen voetnoot blijven staan', () => {
  const parsed = signature.parseIncoming('Akkoord.\n\nGroet,\nVoorbeeld\nTelefoon: [0612345678]\n[12345678]\nTel: 020 1234567 [89]');
  const html = signature.renderContactCard(parsed.contact);
  assert.match(html, /\[0612345678\]/);
  assert.match(html, /\[12345678\]/);
  assert.match(html, /020 1234567 \[89\]/);
});

test('dezelfde opmaak in gewone inhoud, quotes of een andere afzender wordt niet blind gesplitst', () => {
  const raw = '*Robin VoorbeeldTel: 06-12345678www.example.nl';
  for (const body of [raw, `Antwoord.\n\nOp wo 9 sep 2026 om 09:59 schreef Robin Voorbeeld :\n> Groet\n> ${raw}`]) {
    assert.equal(signature.parseIncoming(body, { from: 'Robin Voorbeeld' }).matched, false);
  }
  const other = signature.parseIncoming(`Antwoord.\n\nGroet\n${raw}`, { from: 'Andere Afzender' });
  assert.equal(other.contact.phone, '');
  assert.match(signature.renderContactCard(other.contact), /Robin VoorbeeldTel: 06-12345678www.example.nl/);
});
