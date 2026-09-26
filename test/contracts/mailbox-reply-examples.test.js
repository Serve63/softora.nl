const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createMailboxReplyExamples,
  selectMailboxReplyExamples,
} = require('../../server/services/mailbox-reply-examples');
const { createMailboxReplyExamplesRepository } = require('../../server/repositories/mailbox-reply-examples');
const {
  buildMailboxReplyPromptPayload,
  buildMailboxReplySystemPrompt,
  enforceMailboxReplyProfile,
} = require('../../server/services/mailbox-reply-prompt');
const { createMailboxService } = require('../../server/services/mailbox');

const rows = [
  {
    inbound_body: 'Hoi Servé, we hebben geen interesse, de website is net vernieuwd.\nGroet, Paul',
    reply_body: 'Goedendag Paul,\n\nHelemaal helder, fijn dat de website net vernieuwd is!\n\nMet vriendelijke groet,\nServé Creusen\n\nOp 16 september schreef Paul:\nGeen interesse',
  },
  {
    inbound_body: 'Wat kost zo’n website ongeveer?',
    reply_body: 'Hoi,\n\nDe prijs hangt af van wat je precies nodig hebt.\n\nMet vriendelijke groet,\nServé Creusen',
  },
  {
    inbound_body: 'Hoi Servé, we hebben geen interesse, de website is net vernieuwd.\nGroet, Paul',
    reply_body: 'Dubbele kopie uit een andere map.',
  },
];

test('eigen voorbeelden: vergelijkbare klantmail eerst, zonder aanhef, groet of citaat', () => {
  const examples = selectMailboxReplyExamples(rows, 'Geen interesse, onze website is recent vernieuwd.');
  assert.equal(examples.length, 2);
  assert.match(examples[0].klantMail, /geen interesse/);
  assert.equal(examples[0].mijnAntwoord, 'Helemaal helder, fijn dat de website net vernieuwd is!');
  assert.match(examples[1].mijnAntwoord, /prijs hangt af/);
});

test('eigen voorbeelden slaan dezelfde klantmail en lege antwoorden over', () => {
  const same = selectMailboxReplyExamples(rows, rows[1].inbound_body);
  assert.ok(same.every((example) => !/Wat kost/.test(example.klantMail)));
  assert.deepEqual(selectMailboxReplyExamples([{ inbound_body: 'Hoi', reply_body: '' }], 'Hoi'), []);
  assert.deepEqual(selectMailboxReplyExamples(rows, ''), []);
});

test('voorbeelden worden per afzender geladen, bewaard en blokkeren nooit bij een fout', async () => {
  const calls = [];
  let fail = false;
  let clock = 0;
  const service = createMailboxReplyExamples({
    now: () => clock,
    logger: { error() {} },
    repository: {
      async listReplyExamples({ accountEmails }) {
        calls.push(accountEmails);
        if (fail) throw new Error('database weg');
        return rows;
      },
    },
  });
  const first = await service.findReplyExamples({ profileKey: 'serve', inboundText: 'Geen interesse.' });
  await service.findReplyExamples({ profileKey: 'serve', inboundText: 'Wat kost het?' });
  assert.ok(first.length > 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('servec321@gmail.com'));
  assert.ok(calls[0].every((email) => !/martijn|venvisuals/.test(email)));
  await service.findReplyExamples({ profileKey: 'martijn', inboundText: 'Geen interesse.' });
  assert.ok(calls[1].includes('martijn@softora.nl'));
  assert.deepEqual(await service.findReplyExamples({ profileKey: 'onbekend', inboundText: 'x' }), []);
  fail = true;
  clock = 16 * 60 * 1000;
  assert.deepEqual(await service.findReplyExamples({ profileKey: 'serve', inboundText: 'Geen interesse.' }), []);
});

test('repository leest alleen via de beveiligde outreach-RPC', async () => {
  const rpcCalls = [];
  const repository = createMailboxReplyExamplesRepository({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ rpc: async (name, params) => { rpcCalls.push({ name, params }); return { data: rows, error: null }; } }),
  });
  assert.equal((await repository.listReplyExamples({ accountEmails: [' Serve@Softora.nl ', 'serve@softora.nl'] })).length, 3);
  assert.deepEqual(rpcCalls, [{ name: 'softora_mailbox_reply_examples', params: { p_account_emails: ['serve@softora.nl'], p_limit: 300 } }]);
  assert.deepEqual(await createMailboxReplyExamplesRepository().listReplyExamples({ accountEmails: ['serve@softora.nl'] }), []);
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260925090000_mailbox_reply_examples.sql'), 'utf8');
  assert.match(migration, /softora_mailbox_outreach_contacts\(accounts\.emails\)/);
  assert.match(migration, /revoke all on function public\.softora_mailbox_reply_examples\(text\[\], integer\)\s+from public, anon, authenticated;/);
});

test('prompt gebruikt eerdere antwoorden als stijlbron en vraagt bij opnieuw een andere variant', () => {
  const payload = buildMailboxReplyPromptPayload({
    isReply: true,
    accountEmail: 'serve@softora.nl',
    context: { body: 'Geen interesse.' },
    replyExamples: [{ klantMail: 'Nee dank je.', mijnAntwoord: 'Helemaal helder!' }],
    previousSuggestion: 'Dankjewel voor je reactie.',
  });
  assert.deepEqual(payload.eerdereAntwoorden, [{ klantMail: 'Nee dank je.', mijnAntwoord: 'Helemaal helder!' }]);
  assert.equal(payload.vorigVoorstel, 'Dankjewel voor je reactie.');
  const prompt = buildMailboxReplySystemPrompt({ senderName: 'Servé Creusen', hasExamples: true, hasPreviousSuggestion: true });
  assert.match(prompt, /eerdereAntwoorden zijn echte antwoorden die Servé Creusen zelf verstuurde/);
  assert.match(prompt, /Neem er nooit feiten, namen, bedragen/);
  assert.match(prompt, /duidelijk andere, betere variant/);
  assert.doesNotMatch(buildMailboxReplySystemPrompt({}), /eerdereAntwoorden|vorigVoorstel/);
});

test('aanhef neemt de door het model gevonden naam alleen over als de klant die zelf schreef', () => {
  const reply = (aanhefNaam) => JSON.stringify({ intent: 'rejection', ctaAllowed: false, aanhefNaam, paragraphs: [{ text: 'Dankjewel voor je reactie.', evidence: ['received.body'] }] });
  const inboundText = 'Beste Servé, we zijn al voorzien. Met warme, vriendelijke groet, Harold de Bie';
  const originalSentMail = { body: 'Goedendag,\nIk kwam jullie site tegen.' };
  assert.match(enforceMailboxReplyProfile(reply('Harold'), { inboundText, originalSentMail }), /^Goedendag Harold,/);
  assert.match(enforceMailboxReplyProfile(reply('Piet'), { inboundText, originalSentMail }), /^Goedendag,/);
  assert.match(enforceMailboxReplyProfile(reply('Servé'), { inboundText, originalSentMail }), /^Goedendag,/);
});

test('voorgestelde reactie stuurt eigen voorbeelden mee naar het model', async () => {
  const requests = [];
  const service = createMailboxService({
    getOpenAiApiKey: () => 'openai-key',
    openAiModel: 'gpt-test',
    mailboxReplyExamples: {
      async findReplyExamples({ profileKey, inboundText }) {
        assert.equal(profileKey, 'serve');
        assert.match(inboundText, /geen interesse/);
        return [{ klantMail: 'Nee dank je.', mijnAntwoord: 'Helemaal helder, succes!' }];
      },
    },
    fetchJsonWithTimeout: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { response: { ok: true }, data: { choices: [{ message: { content: JSON.stringify({ intent: 'rejection', ctaAllowed: false, aanhefNaam: 'Paul', paragraphs: [{ text: 'Helemaal helder, dankjewel voor je reactie.', evidence: ['received.body'] }] }) } }] } };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });
  const result = await service.rewriteDraft({
    accountEmail: 'serve@softora.nl', to: 'paul@example.test', subject: 'Re: Kleine vraag over jullie website', body: '',
    context: { from: 'info', email: 'paul@example.test', body: 'We hebben geen interesse. Grt. Paul' },
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[1].content, /"eerdereAntwoorden":\[\{"klantMail":"Nee dank je.","mijnAntwoord":"Helemaal helder, succes!"\}\]/);
  assert.match(result.text, /^Beste Paul,\n\nHelemaal helder/);
});

test('voorbeelden met inloggegevens gaan nooit mee en contactgegevens worden afgeschermd', () => {
  const examples = selectMailboxReplyExamples([
    { inbound_body: 'Hieronder mijn inlog bij PostNL: info@klant.nl / Welkom123!', reply_body: 'Hoi,\n\nBedankt voor de gegevens!' },
    { inbound_body: 'Bel me op 06-12345678 of mail jan@klant.nl, zie www.klant.nl', reply_body: 'Hoi Jan,\n\nIk bel je morgen even op 06 12345678.' },
  ], 'Kun je me bellen?');
  assert.equal(examples.length, 1);
  assert.equal(examples[0].klantMail, 'Bel me op [telefoon] of mail [e-mail], zie [link]');
  assert.equal(examples[0].mijnAntwoord, 'Ik bel je morgen even op [telefoon].');
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260925090000_mailbox_reply_examples.sql'), 'utf8');
  assert.match(migration, /like '%kleine vraag over jullie website%'/);
});

test('voorgestelde reactie gebruikt GPT-6 Luna op max-denkstand zonder temperature', async () => {
  const calls = [];
  const service = createMailboxService({
    getOpenAiApiKey: () => 'openai-key',
    openAiModel: 'gpt-6-luna',
    openAiReasoningEffort: 'max',
    mailboxReplyExamples: { findReplyExamples: async () => [] },
    fetchJsonWithTimeout: async (_url, options, timeout) => {
      calls.push({ payload: JSON.parse(options.body), timeout });
      return { response: { ok: true }, data: { choices: [{ message: { content: JSON.stringify({ intent: 'rejection', ctaAllowed: false, paragraphs: [{ text: 'Helemaal helder, dankjewel voor je reactie.', evidence: ['received.body'] }] }) } }] } };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });
  await service.rewriteDraft({
    accountEmail: 'serve@softora.nl', to: 'klant@example.test', subject: 'Re: Kleine vraag over jullie website', body: '',
    context: { from: 'Klant', email: 'klant@example.test', body: 'We hebben geen interesse.' },
  });
  assert.equal(calls[0].payload.model, 'gpt-6-luna');
  assert.equal(calls[0].payload.reasoning_effort, 'max');
  assert.equal('temperature' in calls[0].payload, false);
  assert.equal(calls[0].timeout, 300000);
  const composition = fs.readFileSync(path.join(__dirname, '../../server/services/server-app-runtime-feature-composition-builders.js'), 'utf8');
  assert.match(composition, /MAILBOX_REWRITE_OPENAI_MODEL \|\| 'gpt-6-luna'/);
  assert.match(composition, /MAILBOX_REWRITE_REASONING_EFFORT \|\| 'max'/);
});
