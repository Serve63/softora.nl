const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDocument, DomUtils } = require('htmlparser2');
const signature = require('../../assets/premium-mailbox-signature');
const quoted = require('../../assets/premium-mailbox-quoted-thread');
const presentation = require('../../assets/premium-mailbox-message-presentation').create({
  isSentMessageByProvenance: (message) => message.direction === 'sent',
  getMessageTimestamp: () => 0,
  getProvenOutboundThreadMessages: () => [],
  getDirectParentMessageIds: () => [],
  splitQuotedReply: quoted.splitQuotedThread,
});
const { renderLinkedMailboxText } = require('../../assets/premium-mailbox-display');
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = (s) => s.split('\n').map((line) => renderLinkedMailboxText(line, {}, {
  escapeHtml, isSafeUrl: (url) => /^https?:\/\//.test(url), renderUrls: escapeHtml,
})).join('\n');
const quote = '\n\nRobin Voorbeeld schreef op 2026-09-09 11:02:\n> Ons ontwerp [1]\n';
const appendix = '\nLinks:\n------\n[1] https://example.nl/ontwerp\n[2] https://example.nl/kleuren.pdf\n[3] https://booking.example/hotel';
const authored = 'Hoi Robin,\n\nDeze reactie komt van marketing:\n\n_Beste Robin, _\n\n_Het ontwerp is mooi. Onze kleuren komen uit het kleuronderzoek [2]. We komen op de lijn._';
const contact = '\n\n_Met vriendelijke groet,_\n\n_Jamie Voorbeeld_\n\nHotel Voorbeeld\n📍 Dorpsstraat 2-1 | 1234 AB Voorbeeldstad\n📞 013 123 45 67\nwww.example.nl\n\nMaak hier je reservering [3]\nVolg ons:\nInstagram @hotelvoorbeeld | LinkedIn Hotel Voorbeeld';

function present(body) {
  const message = { body, email: 'hotel@example.nl', from: 'Hotel Voorbeeld', direction: 'received' };
  const root = presentation.getRootPresentation(body, message);
  const thread = presentation.getThreadPresentation(message, message);
  const parts = []; root.appendContact(parts);
  assert.equal(root.body, thread.body);
  assert.equal(parts.join(''), thread.contactHtml);
  assert.equal(message.body, body);
  return { ...thread, html: render(thread.body) };
}

test('embedded marketing response preserves authored emphasis and PDF citation, with a clean contact card', () => {
  for (const wrapper of ['_', '*', '**', '__']) {
    const wrappedContact = contact.replace(/_([^_]+)_/g, `${wrapper}$1${wrapper}`);
    const result = present(authored + wrappedContact + quote + appendix);
    assert.match(result.html, /Deze reactie komt van marketing/);
    assert.match(result.html, /<em>Beste Robin,<\/em>/);
    assert.match(result.html, /<em>Het ontwerp is mooi\./);
    assert.match(result.html, /href="https:\/\/example.nl\/kleuren.pdf"[^>]*>\[2\]<\/a>/);
    assert.match(result.html, /We komen op de lijn\.<\/em>/);
    assert.doesNotMatch(result.html, /Links:|------|booking|Instagram|LinkedIn|reservering|_Beste|_Het|ontwerp"/);
    for (const value of ['Jamie Voorbeeld', 'Hotel Voorbeeld', 'tel:0131234567', 'Dorpsstraat 2-1', '1234 AB Voorbeeldstad', 'href="https://www.example.nl/"']) {
      assert.ok(result.contactHtml.includes(value), value);
    }
    assert.doesNotMatch(DomUtils.textContent(parseDocument(result.contactHtml)), /[_*]|Links:|booking|Instagram|LinkedIn|reservering|\[\d+\]/);
  }
});

test('a generated appendix without quoted history remains outside the contact card', () => {
  const result = present(authored + contact + appendix.replace('[1] https://example.nl/ontwerp\n', ''));
  assert.match(result.html, /href="https:\/\/example.nl\/kleuren.pdf"/);
  assert.doesNotMatch(result.body + result.contactHtml, /Links:|booking|kleuren.pdf<\/div>/);
});

test('mixed references without a signature retain meaningful destinations and omit quoted ones', () => {
  const result = present('Bekijk het onderzoek [2].' + quote + appendix.replace('\n[3] https://booking.example/hotel', ''));
  assert.match(result.html, /href="https:\/\/example.nl\/kleuren.pdf"/);
  assert.doesNotMatch(result.html, /Links:|\/ontwerp/);
});

test('unsafe, conflicting, unresolved and literal references are never silently discarded', () => {
  for (const definitions of [
    '[2] javascript:alert(1)',
    '[2] https://one.example\n[2] https://two.example',
    '[4] https://example.nl/unreferenced',
  ]) {
    const result = present('Onderzoek [2].\n\nLinks:\n------\n' + definitions);
    assert.match(result.body, /Onderzoek \[2\]/);
    assert.ok(result.body.includes(definitions));
    assert.doesNotMatch(result.html, /href=/);
  }
  const body = 'Letterlijk `[2]` en \\[2].\n\nLinks:\n------\n[2] https://example.nl/code';
  assert.equal(present(body).body, body);
  const manual = 'Onze links:\n[2] https://example.nl\nDeze lijst is onderdeel van mijn antwoord.';
  assert.equal(present(manual).body, manual);
});

test('whole-line emphasis does not corrupt identifiers, unsafe text or ordinary internal underscores', () => {
  for (const plain of ['user_name@example.nl', 'https://example.nl/a_b_c', 'mijn_bestand.pdf', 'Twee _losse tekens', '___']) {
    assert.equal(render(plain), escapeHtml(plain));
  }
  assert.equal(render('_Dit <script> is tekst._'), '<em>Dit &lt;script&gt; is tekst.</em>');
  assert.equal(render('**Dit is belangrijk.**'), '<strong>Dit is belangrijk.</strong>');
});

test('Outlook separator belongs to the proven header cluster, including both received and sent views', () => {
  const authoredBody = 'Goedemorgen,\nAlles moet in Google te vinden zijn.';
  for (const rule of ['________________________________', '----------------', '================']) {
    const body = `${authoredBody}\n\n${rule}\n\nFrom: Robin <robin@example.nl>\nSent: Thursday, September 10, 2026 11:02 AM\nTo: hotel@example.nl\nSubject: Voorstel\n\nOud bericht`;
    assert.equal(present(body).body, authoredBody);
    const sent = { direction: 'sent', body };
    assert.equal(presentation.getThreadPresentation(sent, sent, { sent: true }).body, authoredBody);
    assert.ok(quoted.splitQuotedThread(body).quoted.startsWith(rule));
  }
});

test('ordinary authored rules and an unproven header example remain readable', () => {
  for (const body of ['Eerste onderwerp.\n________________________________\nTweede onderwerp.', 'Dit is inhoud.\n--------------------', 'Voorbeeld:\n________\nFrom: collega\nHet antwoord volgt later.']) {
    assert.equal(present(body).body, body);
  }
});
