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
