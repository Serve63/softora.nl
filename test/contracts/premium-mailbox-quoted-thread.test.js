const test = require('node:test');
const assert = require('node:assert/strict');

const provenance = require('../../assets/premium-mailbox-message-provenance.js');
global.SoftoraMailboxMessageProvenance = provenance;
const quotedThread = require('../../assets/premium-mailbox-quoted-thread.js');
global.SoftoraMailboxQuotedThread = quotedThread;
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');

const replyText = 'Kunnen we morgen bellen?';
const introLine = 'On Thu, Aug 20, 2026 at 2:49\u202fPM Martijn van de Ven';

function wrappedReply({ blankBeforeQuote = false, quotePrefix = true } = {}) {
  return [
    'Ja, dat kan.',
    '',
    introLine,
    'wrote:',
    ...(blankBeforeQuote ? [''] : []),
    `${quotePrefix ? '> ' : ''}${replyText}`,
  ].join('\n');
}

function parent(overrides = {}) {
  return {
    id: 'sent:gmail-parent',
    messageId: '<gmail-parent@softora.nl>',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    date: '2026-08-20T12:49:00.000Z',
    body: replyText,
    ...overrides,
  };
}

function proofOptions(overrides = {}) {
  return {
    incomingAt: '2026-08-20T13:00:00.000Z',
    directParentMessageIds: ['<gmail-parent@softora.nl>'],
    directParentScopeProven: true,
    ...overrides,
  };
}

const excerptHeader = 'Op 1 okt 2026, om 08:36 heeft Servé Creusen <serve@websoftora.com> het volgende geschreven:';
const excerptParent = () => parent({ accountEmail: 'serve@websoftora.com',
  date: '2026-10-01T06:36:30.000Z',
  body: 'Goedendag,\n\nIk kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.' });
const excerptOptions = { incomingAt: '2026-10-01T07:10:40.000Z' };

test('een letterlijk geselecteerd Apple Mail-fragment verdwijnt bij unieke afzender- en verzendtijdbewijzen', () => {
  const body = `Hi Servé,\n\nIk wil best eens kijken naar jouw online preview.\n\n${excerptHeader}\n\nonline preview doorsturen`;
  const result = quotedThread.stripProvenQuotedOutbound(body, [excerptParent()], excerptOptions);
  assert.equal(result.body, 'Hi Servé,\n\nIk wil best eens kijken naar jouw online preview.');
  assert.deepEqual(result.matchedMessages, [excerptParent()]);
});

test('een fragment blijft zichtbaar zonder exacte identiteit, tijd, volledige tekst of unieke sent-copy', () => {
  const body = `Mijn antwoord.\n\n${excerptHeader}\n\nonline preview doorsturen`;
  const cases = [
    [body, []],
    [body, [excerptParent(), { ...excerptParent(), id: 'sent:other', messageId: '<other@example.nl>' }]],
    [body, [{ ...excerptParent(), accountEmail: 'martijn@websoftora.com' }]],
    [body, [{ ...excerptParent(), email: 'someone@example.nl' }]],
    [body, [{ ...excerptParent(), date: '2026-10-01T06:37:00.000Z' }]],
    [body, [{ ...excerptParent(), date: '' }]],
    [body.replace('online preview doorsturen', 'online preview aanpassen'), [excerptParent()]],
    [body.replace('online preview doorsturen', 'preview'), [excerptParent()]],
    [body + '\nMijn aanvullende vraag moet blijven.', [excerptParent()]],
    [body.replace('serve@websoftora.com', 'thirdparty@example.nl'), [excerptParent()]],
    [body.replace('Op 1 okt 2026, om 08:36', 'Op 2 okt 2026, om 08:36'), [excerptParent()]],
  ];
  for (const [incoming, parents] of cases) {
    assert.equal(quotedThread.stripProvenQuotedOutbound(incoming, parents, excerptOptions).body, incoming);
  }
  assert.equal(quotedThread.stripProvenQuotedOutbound(body, [excerptParent()], {
    incomingAt: '2026-10-01T06:00:00Z',
  }).body, body);
});

test('fragmentbewijs ondersteunt Engelse headers en beschermt veranderde links en woorddelen', () => {
  const header = 'On Thursday, October 1st, 2026 at 8:36 AM, Servé <serve@websoftora.com> wrote:';
  const sent = excerptParent();
  assert.equal(quotedThread.stripProvenQuotedOutbound(`Bedankt.\n${header}\n> online preview doorsturen`,
    [sent], excerptOptions).body, 'Bedankt.');
  for (const body of [
    'Ik kan ook de online preview doorsturenlater, zodat je kunt kijken.',
    'Bekijk de online preview op https://example.nl/original.',
  ]) {
    const excerpt = body.includes('doorsturenlater') ? 'online preview doorsturen' : 'online preview op https://example.nl/changed';
    const incoming = `Bedankt.\n${excerptHeader}\n${excerpt}`;
    assert.equal(quotedThread.stripProvenQuotedOutbound(incoming, [{ ...sent, body }], excerptOptions).body, incoming);
  }
});

test('bewezen Gmail-parent verwijdert ook de over twee regels gesplitste replyheader', () => {
  const body = wrappedReply();
  const before = quotedThread.findQuotedSegments(body);

  assert.equal(before.segments.length, 1);
  assert.equal(before.segments[0].marker, 'quote-prefix');
  assert.equal(before.segments[0].start, 4);

  const result = quotedThread.stripProvenQuotedOutbound(body, [parent()], proofOptions());

  assert.equal(result.body, 'Ja, dat kan.');
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].start, 2);
  assert.equal(result.removed[0].end, 5);
  assert.deepEqual(result.matchedMessages.map((message) => message.id), ['sent:gmail-parent']);
});

test('bewezen gesplitste Gmail-header ondersteunt hoogstens één lege regel voor het citaat', () => {
  const body = wrappedReply({ blankBeforeQuote: true });
  const result = quotedThread.stripProvenQuotedOutbound(body, [parent()], proofOptions());

  assert.equal(result.body, 'Ja, dat kan.');
  assert.equal(result.removed[0].start, 2);
  assert.equal(result.removed[0].end, 6);

  const twoBlankLines = wrappedReply().replace('wrote:\n>', 'wrote:\n\n\n>');
  const failOpen = quotedThread.stripProvenQuotedOutbound(twoBlankLines, [parent()], proofOptions());
  assert.match(failOpen.body, new RegExp(`${introLine}\\nwrote:`));
});

test('gesplitste Gmail-header blijft volledig fail-open zonder passende oudere unieke parent', () => {
  const body = wrappedReply();
  const cases = [
    [],
    [parent({ body: 'Volledig andere uitgaande tekst.' })],
    [parent({ date: '2026-08-20T13:30:00.000Z' })],
    [parent({ id: 'sent:duplicate-a', messageId: '<duplicate-a@softora.nl>' }), parent({
      id: 'sent:duplicate-b',
      messageId: '<duplicate-b@softora.nl>',
    })],
  ];

  cases.forEach((parents, index) => {
    const options = index === 3
      ? proofOptions({ directParentMessageIds: [], directParentScopeProven: false })
      : proofOptions();
    const result = quotedThread.stripProvenQuotedOutbound(body, parents, options);
    assert.equal(result.body, body, `fail-open case ${index}`);
    assert.deepEqual(result.removed, [], `fail-open case ${index}`);
  });
});

test('klokmarge geldt alleen voor de exact bewezen In-Reply-To-parent', () => {
  const body = wrappedReply();
  const slightlyFutureParent = parent({ date: '2026-08-20T13:04:59.000Z' });

  const textOnly = quotedThread.stripProvenQuotedOutbound(body, [slightlyFutureParent], proofOptions({
    directParentMessageIds: [],
    directParentScopeProven: false,
  }));
  assert.equal(textOnly.body, body);
  assert.deepEqual(textOnly.removed, []);

  const exactDirectParent = quotedThread.stripProvenQuotedOutbound(
    body,
    [slightlyFutureParent],
    proofOptions()
  );
  assert.equal(exactDirectParent.body, 'Ja, dat kan.');
  assert.equal(exactDirectParent.removed[0].start, 2);
  assert.deepEqual(
    exactDirectParent.matchedMessages.map((message) => message.id),
    ['sent:gmail-parent']
  );
});

test('cross-owner parent mag een gesplitste Gmail-header nooit verwijderen', () => {
  const body = wrappedReply();
  const mail = {
    id: 'inbox:serve-cross-owner',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-20T13:00:00.000Z',
    inReplyTo: '<gmail-parent@softora.nl>',
    threadMessages: [parent()],
  };

  assert.equal(campaignInbox.stripProvenQuotedOutbound(body, mail), body);
});

test('natuurlijke regeleinden en onbewezen Gmail-achtige varianten worden niet uitgebreid', () => {
  const naturalBody = [
    'Dit is mijn eigen toelichting.',
    '',
    'On Thursday, the team documented the plan',
    'wrote:',
    `> ${replyText}`,
  ].join('\n');
  const pronounBody = wrappedReply().replace('Martijn van de Ven', 'I');
  const unprefixedBody = wrappedReply({ quotePrefix: false });

  const natural = quotedThread.stripProvenQuotedOutbound(naturalBody, [parent()], proofOptions());
  assert.match(natural.body, /On Thursday, the team documented the plan\nwrote:/);
  assert.doesNotMatch(natural.body, /Kunnen we morgen bellen/);

  const pronoun = quotedThread.stripProvenQuotedOutbound(pronounBody, [parent()], proofOptions());
  assert.match(pronoun.body, /On Thu, Aug 20, 2026 at 2:49\s+PM I\nwrote:/);
  assert.doesNotMatch(pronoun.body, /Kunnen we morgen bellen/);

  const unprefixed = quotedThread.stripProvenQuotedOutbound(unprefixedBody, [parent()], proofOptions());
  assert.equal(unprefixed.body, unprefixedBody);
  assert.deepEqual(unprefixed.removed, []);
});

test('quoteparser houdt twee structurele quotes rond een losse -- als twee echte segmenten', () => {
  const body = [
    'Dit is Anna haar eigen antwoord.',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    '> Eerste echte quote.',
    '',
    '--',
    'Anna Jansen',
    'M 06 87654321',
    '',
    'On Tue, Aug 25, 2026 at 11:30 AM Piet Jansen wrote:',
    '> Tweede echte quote.',
  ].join('\n');
  const parsed = quotedThread.findQuotedSegments(body);

  assert.deepEqual(parsed.segments.map((segment) => segment.marker), ['reply-header', 'reply-header']);
  assert.ok(parsed.segments[0].end <= body.split('\n').indexOf('--'));
  assert.ok(parsed.segments[1].start > body.split('\n').indexOf('--'));
});

test('a quoted sent mail is proven even when the client rewrote its link as markdown', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt. Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link [https://www.softora.nl/webdesign/voorbeeld?cid=kvk-1&sender=serve] bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const incoming = [
    'Beste Servé,',
    '',
    'Bedankt, maar wij hebben geen interesse.',
    '',
    'On Tuesday, September 22nd, 2026 at 2:09 PM, Servé Creusen <serve@softora.nl> wrote:',
    '',
    '> Goedendag,',
    '>',
    '> Uit enthousiasme heb ik een fris webdesign gemaakt. Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '>',
    '> Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze [link](https://www.softora.nl/webdesign/voorbeeld?cid=kvk-1&sender=serve) bekijken 🎨',
    '>',
    '> Met vriendelijke groet,',
    '> Servé Creusen',
  ].join('\n');
  const sent = {
    id: 'sent:1', folder: 'sent', accountEmail: 'serve@softora.nl', messageId: '<sent-1@softora.nl>',
    date: '2026-09-22T12:09:16.000Z', body: sentBody,
  };
  const result = quotedThread.stripProvenQuotedOutbound(incoming, [sent], {
    directParentMessageIds: ['sent-1@softora.nl'], directParentScopeProven: true, incomingAt: '2026-09-22T12:17:19.000Z',
  });
  assert.equal(result.matchedMessages.length, 1);
  assert.equal(result.body, 'Beste Servé,\n\nBedankt, maar wij hebben geen interesse.');

  // A different link label is different text and stays visible.
  const changed = incoming.replace('deze [link](', 'deze [andere pagina](');
  assert.equal(quotedThread.stripProvenQuotedOutbound(changed, [sent], {
    directParentMessageIds: ['sent-1@softora.nl'], directParentScopeProven: true, incomingAt: '2026-09-22T12:17:19.000Z',
  }).matchedMessages.length, 0);
});

test('een citaat met rechte aanhalingstekens bewijst dezelfde verzonden mail met gekrulde', () => {
  const quotedThread = require('../../assets/premium-mailbox-quoted-thread');
  const sent = {
    accountEmail: 'martijnven@websoftora.com', messageId: '<sent@example.test>',
    body: 'Hoi,\n\nWat vervelend dat je zo’n onzekere periode achter de rug hebt. Helemaal begrijpelijk dat je nu even niet in je website wilt investeren.\n\nMet vriendelijke groet,\nMartijn van de Ven',
  };
  const reply = 'Dank je wel!\n\nRenata\n\nMartijn van de Ven schreef op 2026-10-06 16:33:\n\nHoi,\n\nWat vervelend dat je zo\'n onzekere periode achter de rug hebt. Helemaal begrijpelijk dat je nu even niet in je website wilt investeren.\n\nMet vriendelijke groet,\nMartijn van de Ven';
  assert.equal(quotedThread.stripProvenQuotedOutbound(reply, [sent]).body, 'Dank je wel!\n\nRenata');
  // A changed word is still not the same mail.
  const altered = reply.replace('onzekere', 'drukke');
  assert.equal(quotedThread.stripProvenQuotedOutbound(altered, [sent]).body, altered.trim());
});
