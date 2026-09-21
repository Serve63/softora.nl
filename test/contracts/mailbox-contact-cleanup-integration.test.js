const test = require('node:test');
const assert = require('node:assert/strict');
const quotedThread = require('../../assets/premium-mailbox-quoted-thread');
const signature = require('../../assets/premium-mailbox-signature');
const presentation = require('../../assets/premium-mailbox-message-presentation').create({
  isSentMessageByProvenance: (message) => message.direction === 'sent',
  getMessageTimestamp: () => 0,
  getProvenOutboundThreadMessages: () => [],
  getDirectParentMessageIds: () => [],
  splitQuotedReply: quotedThread.splitQuotedThread,
});

const fixtures = [
  { from: 'Robin Voorbeeld', email: 'robin@example.nl',
    body: 'Dank voor je ontwerp. Graag een kostenindicatie.\n\nIk hoor het graag!\n\nRobin Voorbeeld\nwww.example.nl\nVoorbeeld - Wandmontage V.O.F.\nVoorbeeld - Afbouw en projecten\nModerne afbouw. Strak uitgevoerd.\nDe informatie verzonden met dit e-mailbericht (en bijlagen) is uitsluitend\nbestemd voor de geadresseerde(n).\nIndien dit e-mailbericht niet voor u bestemd is, wordt u verzocht de afzender te informeren en het\ne-mailbericht (en bijlagen) te vernietigen.\nT* 0411-123456 | *M* 06-12345678 | *E* robin@example.nl\nDorpsstraat 13\n5268 EP Voorbeeld\nKVK nr. 123.45.678\nBTW nr. NL1234.56.789 B01',
    authored: 'Dank voor je ontwerp. Graag een kostenindicatie.\n\nIk hoor het graag!',
    expected: ['0411-123456', '06 12 34 56 78', '<div>Dorpsstraat 13</div><div>5268 EP Voorbeeld</div>'],
    absent: /Robin Voorbeeld|robin@example|geadresseerde|vernietigen|KVK|BTW|Moderne afbouw|Wandmontage|Afbouw en projecten/ },
  { from: 'stephanvoorbeeld@example.nl', email: 'stephanvoorbeeld@example.nl',
    body: 'Dank voor je werk. Ik kom later terug op de website.\n\nFijne avond, Stephan\n\nStephan Voorbeeld\nWalerijstraat 210\n5617 AR Voorbeeld (Wijk)\n\nexample.nl<http://www.example.nl>',
    authored: 'Dank voor je werk. Ik kom later terug op de website.\n\nFijne avond, Stephan',
    expected: ['<div>Walerijstraat 210</div><div>5617 AR Voorbeeld (Wijk)</div>'],
    absent: /Stephan Voorbeeld|example.nl|&lt;http|<\[|&lt;\[/ },
];
const histories = ['', '\n\nOp 9 sep 2026 om 12:00 schreef Andere Afzender:\n> Dit is een ouder bericht.\n> Tel: 030 7654321'];

test('one central cleanup covers root, dossier, all accounts and providers, old and future messages', () => {
  for (const fixture of fixtures) for (const owner of ['serve', 'martijn']) for (const source of ['gmail', 'strato', 'instantly', 'future-provider']) for (const date of ['2026-08-01', '2027-01-01']) for (const history of histories) {
    const originalBody = fixture.body + history;
    const message = Object.freeze({ ...fixture, body: originalBody, accountEmail: `${owner}+alias@example.nl`, source, date, direction: 'received' });
    const root = presentation.getRootPresentation(message.body, message);
    const rootHtml = [root.body];
    assert.equal(root.appendContact(rootHtml), true);
    assert.equal(root.appendContact(rootHtml), false);
    const thread = presentation.getThreadPresentation(message, message);
    const diagnostic = () => JSON.stringify({ parsed: signature.parseIncoming(message.body, message), root, thread });
    for (const html of [rootHtml.join(''), thread.body + thread.contactHtml]) {
      for (const expected of fixture.expected) assert.ok(html.includes(expected), `${source}/${owner}/${date}: ${expected}\n${html}\n${diagnostic()}`);
      assert.doesNotMatch(html, fixture.absent, diagnostic());
      assert.doesNotMatch(html, /ouder bericht|030 7654321/);
      assert.equal((html.match(/class="detail-mail-contact-card"/g) || []).length, 1);
    }
    assert.equal(message.body, originalBody);
    assert.equal(root.body, fixture.authored);
  }
});

test('legal phrases in actual message text and notes after the signature remain available', () => {
  const authored = 'Graag deze disclaimer aanpassen:\nDe informatie verzonden met dit e-mailbericht is vertrouwelijk.\nKVK nr. 12345678 moet op de factuur staan.';
  const message = { body: `${authored}\n\nMet vriendelijke groet,\nRobin Voorbeeld\nTel: 020 1234567\nP.S. Bel mij morgen.`, from: 'Robin Voorbeeld', email: 'robin@example.nl' };
  const result = presentation.getThreadPresentation(message, message);
  assert.equal(result.body, `${authored}\n\nP.S. Bel mij morgen.`);
  assert.doesNotMatch(result.contactHtml, /P.S. Bel mij morgen/);
});

test('quoted third-party contact is not attached to the current sender and outgoing text is unchanged', () => {
  const own = 'Dit is mijn antwoord.';
  const body = `${own}\n\nOp 9 sep 2026 om 12:00 schreef Robin Voorbeeld:\n> Robin Voorbeeld\n> Dorpsstraat 13\n> 5268 EP Voorbeeld\n> Tel: 020 1234567`;
  const incoming = { body, from: 'Andere Afzender', email: 'ander@example.nl' };
  const result = presentation.getThreadPresentation(incoming, incoming);
  assert.doesNotMatch(result.contactHtml, /Robin|Dorpsstraat|020/);
  const sent = { ...incoming, direction: 'sent', body: fixtures[0].body };
  assert.equal(presentation.getThreadPresentation(sent, sent, { sent: true }).body, sent.body);
});

test('HTML-looking contact input cannot introduce active markup and the original is unchanged', () => {
  const body = 'Akkoord.\n\nGroet,\nRobin Voorbeeld\n<img src=x onerror=alert(1)>\n[klik](javascript:alert(1))\nTel: 020 1234567';
  const message = Object.freeze({ body, from: 'Robin Voorbeeld', email: 'robin@example.nl' });
  const result = presentation.getThreadPresentation(message, message);
  assert.doesNotMatch(result.contactHtml, /<img|href="javascript:|onerror=/);
  assert.match(result.contactHtml, /020 1234567/);
  assert.equal(message.body, body);
});
