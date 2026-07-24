const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_REPLY_PROFILE,
  buildMailboxDraftRewriteSystemPrompt,
  buildMailboxReplySystemPrompt,
  enforceMailboxReplyProfile,
  enforceMailboxReplySignature,
  inferMailboxReplyFirstName,
} = require('../../server/services/mailbox-reply-prompt');

test('mailbox reply prompt kiest de ondertekende voornaam uit de nieuwste reactie', () => {
  assert.equal(
    inferMailboxReplyFirstName({
      from: 'De Vyldre',
      body: [
        'Hoi Servé,',
        '',
        'We hebben al een goede partij waar we tevreden mee zijn.',
        '',
        'Groet,',
        'Daffy',
        '',
        'Op 20 jul 2026 heeft Servé Creusen het volgende geschreven:',
        'Goedendag,',
      ].join('\n'),
    }),
    'Daffy'
  );
});

test('mailbox reply prompt gebruikt geen bedrijfsnaam als aanhefnaam', () => {
  assert.equal(inferMailboxReplyFirstName({ from: 'De Vyldre', body: 'Geen interesse.' }), '');
  assert.equal(inferMailboxReplyFirstName({ from: 'Rijs Textiles', body: 'Bedankt.' }), '');
  assert.equal(inferMailboxReplyFirstName({ from: 'Salon TOF', body: 'Met welk programma werk je?' }), '');
});

test('centraal replyprofiel dwingt Servé-stijl, waarheid en beide mailbronnen af', () => {
  const prompt = buildMailboxReplySystemPrompt();

  assert.equal(MAILBOX_REPLY_PROFILE.id, 'serve-mailbox-reply-v1');
  assert.match(prompt, /centraal antwoordprofiel serve-mailbox-reply-v1/);
  assert.match(prompt, /ontvangenMail is de nieuwste mail/);
  assert.match(prompt, /oorspronkelijkeVerzondenMail is de oorspronkelijke mail/);
  assert.match(prompt, /Begin exact met "Beste \[voornaam\],"/);
  assert.match(prompt, /anders exact met "Beste,"/);
  assert.match(prompt, /nooit met jullie/);
  assert.match(prompt, /exact één keer 😁/);
  assert.match(prompt, /prijs afhangt van wat iemand precies wil/);
  assert.match(prompt, /kort en vrijblijvend op locatie langs te gaan/);
  assert.match(prompt, /"laagdrempelig", "kansen" of "verbeterpunten"/);
  assert.match(prompt, /Het actuele ontwerp uit deze coldmail is met code gebouwd/);
  assert.match(prompt, /beweer ook niet dat Servé nooit Webflow gebruikt/);
  assert.match(prompt, /alleen als voorstel getoond en nooit automatisch verzonden/);
  assert.match(prompt, /Met vriendelijke groet,[\s\S]*Servé Creusen/);
});

test('centraal replyprofiel wordt niet overschreven door een losse mailboxafzender', () => {
  const prompt = buildMailboxReplySystemPrompt({ senderName: 'Martijn van de Ven' });

  assert.match(prompt, /Schrijf altijd namens Servé Creusen/);
  assert.doesNotMatch(prompt, /Schrijf altijd namens Martijn van de Ven/);
});

test('mailbox reply vervangt een verkeerde AI-ondertekening door de echte afzender', () => {
  assert.equal(
    enforceMailboxReplySignature(
      'Hoi,\n\nDankjewel voor je reactie 😁\n\nMet vriendelijke groet,\nServé Creusen',
      'Martijn van de Ven'
    ),
    'Hoi,\n\nDankjewel voor je reactie 😁\n\nMet vriendelijke groet,\nMartijn van de Ven'
  );
});

test('los concept houdt de gewone herschrijfprompt', () => {
  const prompt = buildMailboxDraftRewriteSystemPrompt({ senderName: 'Martijn van de Ven' });

  assert.match(prompt, /mailherschrijver van Softora/);
  assert.match(prompt, /afzenderProfiel\.aiInstructions/);
  assert.doesNotMatch(prompt, /serve-mailbox-reply-v1/);
});

test('replyprofiel borgt Beste, je, exact één smile en de vaste Servé-afsluiting', () => {
  const result = enforceMailboxReplyProfile(
    'Hoi Salon,\n\nDankjewel voor jullie reactie 😁😁\n\nGroetjes,\nMartijn van de Ven',
    { firstName: '' }
  );

  assert.equal(result.startsWith('Beste,\n\n'), true);
  assert.doesNotMatch(result, /\bHoi\b|\bjullie\b|Salon,/);
  assert.equal((result.match(/😁/gu) || []).length, 1);
  assert.equal(result.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
});

test('Salon TOF Webflow-antwoord corrigeert een onware toolclaim zonder blanket claim', () => {
  const result = enforceMailboxReplyProfile(
    'Hoi Salon,\n\nIk werk zelf ook in Webflow. We kunnen de kansen laagdrempelig bespreken.',
    {
      firstName: '',
      inboundText: 'Met welk programma werk je? Wij hebben nu Webflow.',
    }
  );

  assert.match(result, /^Beste,/);
  assert.match(result, /Dit ontwerp heb ik met code gebouwd/);
  assert.doesNotMatch(result, /Hoi Salon|werk zelf ook in Webflow|werk nooit.*Webflow|laagdrempelig|\bkansen\b/i);
  assert.equal((result.match(/😁/gu) || []).length, 1);
  assert.equal(result.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
});
