const test = require('node:test');
const assert = require('node:assert/strict');

const provenance = require('../../assets/premium-mailbox-message-provenance');
global.SoftoraMailboxMessageProvenance = provenance;
const quotedThread = require('../../assets/premium-mailbox-quoted-thread');
global.SoftoraMailboxQuotedThread = quotedThread;
const ai = require('../../assets/premium-mailbox-ai-presentation');
const campaign = require('../../assets/premium-mailbox-campaign-inbox');

const sender = 'owner@example.test';
const ownPhone = '+31 6 12345678';
const parentPhone = '+31 6 87654321';
const authored = 'Bedankt voor je voorstel.\n\nIk wil graag bellen over de volgende stap.';
const previewUrl = 'https://design.example.test/ontwerp?cid=demo&sender=owner';
const header = `> Op 6 okt 2026, om 15:37 heeft Alex Voorbeeld <${sender}> het volgende geschreven:`;

function fixture({ domain = 'example.nl', invisibleDomain = true, attachmentNames = ['Webdesign.jpg', 'Mockup.jpg'] } = {}) {
  const displayedDomain = invisibleDomain ? domain.replace(/\./g, '\u2060.\u2060') : domain;
  const parent = {
    id: 'sent:domain-parent', messageId: '<domain-parent@example.test>',
    accountEmail: sender, email: sender, folder: 'sent', direction: 'sent',
    date: '2026-10-06T13:37:16.000Z', bodyLoaded: true,
    body: [
      'Goedendag,', '',
      `Afgelopen week kwam ik jullie website ${displayedDomain} tegen.`, '',
      'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.', '',
      `Je kunt het ontwerp via deze link <${previewUrl}> bekijken.`, '',
      'Met vriendelijke groet,', 'Alex Voorbeeld', `Tel: ${parentPhone}`,
    ].join('\n'),
    attachments: attachmentNames.map(filename => ({ filename, contentType: 'image/jpeg' })),
  };
  const quote = parent.body.replace(`${displayedDomain} tegen`, `${displayedDomain}tegen`)
    .split('\n').map(line => `> ${line}`).join('\n');
  const body = [authored, '', 'Met vriendelijke groet,', 'Robin Voorbeeld', `Telefoon: ${ownPhone}`, '',
    header, '>', quote, ...(attachmentNames.length ? [`> ${attachmentNames.map(name => `<${name}>`).join('')}`] : []),
  ].join('\n');
  const lines = body.split('\n');
  const labels = lines.map(line => /^(?:> )?(?:Met vriendelijke groet,|Alex Voorbeeld|Robin Voorbeeld|Tel: |Telefoon: )/.test(line)
    ? 'signature' : 'authored');
  const incoming = {
    id: 'inbox:domain-reply', messageId: '<domain-reply@example.test>',
    accountEmail: sender, email: 'customer@example.test', from: 'Robin Voorbeeld',
    folder: 'inbox', direction: 'received', inReplyTo: parent.messageId,
    date: '2026-10-06T14:00:00.000Z', body, bodyLoaded: true,
    threadMessages: [parent],
    aiPresentation: {
      version: ai.VERSION, model: ai.MODEL, reasoningEffort: 'max', status: 'ready', sourceBody: body,
      decision: { labels, contacts: [
        { line: lines.findIndex(line => line.includes(ownPhone)), kind: 'phone', text: ownPhone },
        { line: lines.findIndex(line => line.includes(parentPhone)), kind: 'phone', text: parentPhone },
      ] },
    },
  };
  const options = {
    incomingAt: incoming.date, directParentMessageIds: [parent.messageId], directParentScopeProven: true,
  };
  return { parent, body, incoming, options };
}

function strip(body, parents, options) {
  return quotedThread.stripProvenQuotedOutbound(body, parents, options);
}

test('a quoted Apple reply proves its sent copy when only the space after the source hostname was lost', () => {
  for (const config of [{}, { domain: 'atelier.example.test', invisibleDomain: false }]) {
    const { body, parent, options } = fixture(config);
    const result = strip(body, [parent], options);
    assert.equal(result.matchedMessages.length, 1, config.domain || 'example.nl with word joiners');
    assert.equal(result.body, `${authored}\n\nMet vriendelijke groet,\nRobin Voorbeeld\nTelefoon: ${ownPhone}`);
    assert.deepEqual(result.matchedMessages, [parent]);
    assert.equal(result.removed.length, 1);
  }
});

test('ready AI root and timeline prove the original quote before AI hides its signature', () => {
  const { body, parent, incoming } = fixture();
  const original = structuredClone(incoming);
  const root = campaign.getRootMessagePresentation(body, incoming);
  assert.equal(root.body, authored);
  assert.deepEqual(root.contact.beforeLines, [`Tel: ${ownPhone}`]);
  const views = [];
  const timelineHtml = campaign.renderThreadMessages({ ...incoming, threadMessages: [parent, incoming] }, String,
    () => ({ date: 'Vandaag', time: '16:00' }), {
      renderMessageBody(view) { views.push(view); return view.body; },
    });
  const receivedView = views.find(view => view.body === authored);
  assert.ok(receivedView, 'the incoming timeline card has the same authored-only body');
  const timelineContacts = timelineHtml.match(/<address class="detail-mail-contact-card"[\s\S]*?<\/address>/g) || [];
  assert.equal(timelineContacts.length, 1);
  assert.ok(timelineContacts[0].includes(ownPhone));
  assert.ok(!timelineContacts[0].includes(parentPhone));
  assert.ok(views.some(view => view.body === parent.body), 'the original sent message remains in the conversation');
  const rootContact = [];
  root.appendContact(rootContact);
  assert.ok(rootContact.join('').includes(ownPhone));
  assert.ok(!rootContact.join('').includes(parentPhone));
  assert.deepEqual(incoming, original, 'proof and rendering never rewrite the stored source');
});

test('domain boundary matching preserves changes to ordinary words, links and unknown attachments', () => {
  const { body, parent, options } = fixture();
  const cases = [
    ['changed ordinary word', body.replace('fris webdesign', 'ander webdesign')],
    ['inserted ordinary word', body.replace('gewoon omdat', 'gewoon uitsluitend omdat')],
    ['changed original URL', body.replace(previewUrl, 'https://other.example.test/ontwerp')],
    ['changed case-sensitive path', body.replace('/ontwerp?cid=', '/ONTWERP?cid=')],
    ['changed case-sensitive query', body.replace('sender=owner', 'sender=Owner')],
    ['added unknown URL', body.replace('> Goedendag,', '> Goedendag, https://unknown.example.test/info')],
    ['unknown attachment name', body.replace('<Mockup.jpg>', '<Andere-bijlage.jpg>')],
    ['additional unknown attachment', body + '\n> <Extra-document.pdf>'],
    ['substantive addition', body.replace('> Uit enthousiasme', '> Deze nieuwe eis hoort ook bij mijn antwoord.\n> Uit enthousiasme')],
  ];
  for (const [label, candidate] of cases) {
    const result = strip(candidate, [parent], options);
    assert.equal(result.body, candidate, label);
    assert.deepEqual(result.matchedMessages, [], label);
  }
});

test('domain boundary proof requires a unique sent copy and exact quoted sender and minute', () => {
  const { body, parent, options } = fixture();
  const cases = [
    ['no sent copy', body, []],
    ['wrong quoted sender', body.replace(`<${sender}>`, '<other@example.test>'), [parent]],
    ['wrong quoted time', body.replace('om 15:37', 'om 15:38'), [parent]],
    ['wrong quoted day', body.replace('Op 6 okt', 'Op 7 okt'), [parent]],
    ['missing sent time', body, [{ ...parent, date: '' }]],
    ['later sent copy', body, [{ ...parent, date: '2026-10-06T14:37:00.000Z' }]],
    ['ambiguous sent copies', body, [parent, { ...parent, id: 'sent:duplicate', messageId: '<duplicate@example.test>' }]],
    ['no attachment evidence', body, [{ ...parent, attachments: [] }]],
  ];
  for (const [label, candidate, parents] of cases) {
    const proofOptions = label === 'ambiguous sent copies' ? { ...options, directParentMessageIds: [] } : options;
    const result = strip(candidate, parents, proofOptions);
    assert.equal(result.body, candidate, label);
    assert.deepEqual(result.matchedMessages, [], label);
  }
});

test('ready AI retains the unmatched quote when the parent belongs to another mailbox', () => {
  const { body, parent, incoming } = fixture();
  for (const parents of [[], [{ ...parent, accountEmail: 'other-owner@example.test' }]]) {
    const view = campaign.getRootMessagePresentation(body, { ...incoming, threadMessages: parents });
    assert.match(view.body, /het volgende geschreven:/);
    assert.match(view.body, /fris webdesign/);
    assert.ok(view.body.includes(authored));
    assert.ok(view.contact.beforeLines.includes(`Tel: ${ownPhone}`));
  }
});

test('an unquoted inline answer remains visible between quoted blocks', () => {
  const { body, parent, options } = fixture();
  const inline = 'Mijn nieuwe antwoord: graag ook een prijsoverzicht.';
  const candidate = body.replace('> Je kunt het ontwerp', `${inline}\n> Je kunt het ontwerp`);
  const result = strip(candidate, [parent], options);
  assert.ok(result.body.includes(inline));
  assert.ok(result.body.includes(authored));
});


test('optional hostname spacing never turns a changed bare URL target into a proven copy', () => {
  const { body, parent, options } = fixture({ attachmentNames: [] });
  const oldFragment = `<${previewUrl}> bekijken.`;
  const sourceFragment = 'https://design.example.test bekijken.';
  const changedParent = { ...parent, body: parent.body.replace(oldFragment, sourceFragment) };
  const changedQuote = body.replace(oldFragment, 'https://design.example.testbekijken.');
  const result = strip(changedQuote, [changedParent], options);
  assert.equal(result.body, changedQuote);
  assert.deepEqual(result.matchedMessages, []);
});
