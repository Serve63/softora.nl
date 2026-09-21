const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSignatureContact, create } = require('../../assets/premium-mailbox-message-presentation');
const quotedThread = require('../../assets/premium-mailbox-quoted-thread');
const presentation = create({
  isSentMessageByProvenance: (message) => message.direction === 'sent',
  getMessageTimestamp: () => 0,
  getProvenOutboundThreadMessages: () => [],
  getDirectParentMessageIds: () => [],
  splitQuotedReply: quotedThread.splitQuotedThread,
});

const print = 'Print deze e-mail alleen indien het noodzakelijk is.';
const legal = [
  'De informatie in deze e-mail is vertrouwelijk en uitsluitend bestemd voor',
  'de geadresseerde. Indien de lezer van deze mededeling niet de geadresseerde',
  'is, wordt u er hierbij op gewezen dat u geen recht hebt kennis te nemen van',
  'de rest van de e-mail, deze te kopiëren en/of te verstrekken aan andere',
  'personen dan de geadresseerde. Door ons wordt geen aansprakelijkheid',
  'aanvaard en aan de inhoud van dit bericht kunnen geen rechten worden',
  'ontleend.',
];
const contacts = ['Robin Voorbeeld', 'Adviseur', 'Tel: 06 12 34 56 78',
  'info@example.nl', 'www.example.nl', 'Voorbeeldstraat 48', '1234 AB Voorbeeld'];
const text = (contact) => [...contact.beforeLines, contact.phone, ...contact.addressLines, ...contact.preservedLines].join('\n');
const wrap = (value, width) => {
  const lines = [''];
  for (const word of value.split(/\s+/)) {
    if (lines.at(-1).length + word.length > width) lines.push('');
    lines[lines.length - 1] += `${lines.at(-1) ? ' ' : ''}${word}`;
  }
  return lines.filter(Boolean);
};

test('complete disclaimer sentences disappear independently of provider line wrapping', () => {
  const notices = [print, ...legal, 'BeantwoordenDoorsturen'];
  for (const rows of [notices, ...[20, 47, 72, 2000].map((width) => wrap(notices.join(' '), width))]) {
    for (const placement of ['before', 'after']) {
      const source = { addressLines: [], beforeLines: placement === 'before' ? [...rows, ...contacts] : [...contacts, ...rows] };
      const original = JSON.stringify(source);
      const cleaned = normalizeSignatureContact(source);
      assert.equal(text(cleaned), text(normalizeSignatureContact({ addressLines: [], beforeLines: contacts })), JSON.stringify(rows));
      assert.equal(JSON.stringify(source), original);
      assert.deepEqual(normalizeSignatureContact(cleaned), cleaned);
    }
  }
});

test('print notices and copied reply/forward controls are removed without a legal paragraph', () => {
  for (const notice of [print, 'Print dit bericht alleen als het noodzakelijk is.',
    'Please consider the environment before printing this email.', 'Only print this message if necessary.']) {
    for (const actions of [['BeantwoordenDoorsturen'], ['Beantwoorden | Doorsturen'], ['Beantwoorden', 'Doorsturen'], ['Reply Forward']]) {
      const cleaned = normalizeSignatureContact({ beforeLines: [...contacts, notice, ...actions], addressLines: [] });
      assert.equal(text(cleaned), text(normalizeSignatureContact({ beforeLines: contacts, addressLines: [] })));
    }
  }
});

test('personal notes, useful contact details and unknown numbers following boilerplate survive', () => {
  const notes = ['P.S. Bel mij morgen over de vertrouwelijke offerte.', 'Bereikbaar op maandag en woensdag',
    'Klantnummer 12345678', '44 King Street', 'London SW1A 1AA',
    'Print de offerte en neem deze mee naar onze afspraak.', 'Klik op Beantwoorden of Doorsturen om te reageren.',
    'Dit e-mailbericht kan als bevestiging worden gebruikt.', 'This email is my reply to the recipient.'];
  const cleaned = normalizeSignatureContact({ beforeLines: [...contacts, print, ...legal, ...notes], addressLines: [] });
  for (const line of notes) assert.ok(text(cleaned).includes(line), line);
  assert.equal(cleaned.phone, '06 12 34 56 78');
  assert.deepEqual(cleaned.addressLines, ['Voorbeeldstraat 48', '1234 AB Voorbeeld']);
  assert.doesNotMatch(text(cleaned), /ontleend|geadresseerde|noodzakelijk/);
});

test('an unpunctuated footer cannot swallow contact fields, names or personal notes', () => {
  for (const tail of [contacts, ['P.S. Graag morgen bellen.'], ['graag morgen bellen.'], ['Tweede Persoon', 'Account Manager'], ['Adres: Voorbeeldstraat 48', '1234 AB Voorbeeld']]) {
    const result = normalizeSignatureContact({ beforeLines: ['Robin Voorbeeld', 'De informatie in deze e-mail is vertrouwelijk', ...tail], addressLines: [] });
    assert.doesNotMatch(text(result), /De informatie/);
    for (const line of tail) assert.ok(text(result).includes(line.replace(/^(?:Tel|Adres): /, '')), line);
  }
});

test('English notice continuations are removed as sentences while the following request survives', () => {
  const footer = 'This email and its attachments are confidential and intended solely for the recipient. Any disclosure, copying or distribution of this message is strictly prohibited. Please notify the sender and delete this message.';
  const result = normalizeSignatureContact({ beforeLines: [...contacts, ...wrap(footer, 35), 'please call tomorrow.'], addressLines: [] });
  assert.doesNotMatch(text(result), /confidential|disclosure|prohibited|notify|delete/);
  assert.ok(text(result).includes('please call tomorrow.'));
});

test('old and future incoming messages in every mailbox use the same root and thread cleanup', () => {
  for (const source of ['gmail', 'strato', 'instantly', 'future-provider']) for (const owner of ['serve', 'martijn']) {
    for (const date of ['2026-08-01', '2027-01-01']) for (const signoff of ['Met vriendelijke groet,\n', '']) {
      const authored = 'Dank voor je bericht. Ik kom hier later op terug.';
      const body = `${authored}\n\n${signoff}${contacts.join('\n')}\n${print}\n${legal.join('\n')}\nBeantwoordenDoorsturen`;
      const message = Object.freeze({ body, from: 'Robin Voorbeeld', email: 'info@example.nl', source, date,
        direction: 'received', accountEmail: `${owner}@example.nl` });
      const root = presentation.getRootPresentation(body, message);
      const rootHtml = [];
      root.appendContact(rootHtml);
      const thread = presentation.getThreadPresentation(message, message);
      assert.equal(root.body, authored);
      assert.equal(thread.body, authored);
      for (const html of [rootHtml.join(''), thread.contactHtml]) {
        for (const content of ['Robin Voorbeeld', 'Adviseur', '06 12 34 56 78', 'info@example.nl', 'www.example.nl']) assert.ok(html.includes(content), content);
        assert.match(html, /class="detail-mail-contact-value detail-mail-contact-address"[^>]*><div>Voorbeeldstraat 48<\/div><div>1234 AB Voorbeeld<\/div>/);
        assert.doesNotMatch(html, /Print deze|geadresseerde|ontleend|BeantwoordenDoorsturen/);
      }
      assert.equal(message.body, body);
    }
  }
});

test('quoted legal text in the authored message and outgoing messages are preserved', () => {
  const authored = `Graag deze tekst aanpassen:\n${print}\n${legal.join('\n')}\nBeantwoordenDoorsturen is een fout in de export.`;
  const body = `${authored}\n\nGroet,\n${contacts.join('\n')}\n${print}\n${legal.join('\n')}`;
  const incoming = { body, from: 'Robin Voorbeeld', email: 'info@example.nl' };
  assert.equal(presentation.getThreadPresentation(incoming, incoming).body, authored);
  const sent = { ...incoming, direction: 'sent' };
  assert.equal(presentation.getThreadPresentation(sent, sent, { sent: true }).body, body);
});
