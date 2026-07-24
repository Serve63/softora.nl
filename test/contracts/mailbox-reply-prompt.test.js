const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_REPLY_CONVERSATION_BRIDGE,
  MAILBOX_REPLY_MEETING_SUGGESTION,
  MAILBOX_REPLY_PRICE_EXPLANATION,
  MAILBOX_REPLY_PROFILE,
  buildMailboxDraftRewriteSystemPrompt,
  buildMailboxReplySystemPrompt,
  classifyMailboxReplyIntent,
  enforceMailboxReplyProfile,
  enforceMailboxReplySignature,
  inferMailboxReplyFirstName,
  resolveMailboxReplySenderProfile,
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
  assert.equal(
    inferMailboxReplyFirstName({
      from: 'Minicamping De Stamhoeve',
      body: 'Bedankt voor je bericht.\n\nGroet,\nMinicamping De Stamhoeve',
    }),
    ''
  );
  assert.equal(inferMailboxReplyFirstName({ from: 'peterbrouwersmakelaardij', body: 'Bedankt.' }), '');
  assert.equal(inferMailboxReplyFirstName({ from: 'Peter Brouwers Makelaardij', body: 'Bedankt.' }), '');
  assert.equal(inferMailboxReplyFirstName({ from: 'info@destamhoeve.nl', body: 'Bedankt.' }), '');
});

test('mailbox reply prompt normaliseert een volledig in hoofdletters geschreven voornaam', () => {
  assert.equal(
    inferMailboxReplyFirstName({
      from: 'Kapsalon Voorbeeld',
      body: 'Bedankt voor je bericht.\n\nGroet,\nPETER',
    }),
    'Peter'
  );
  assert.equal(inferMailboxReplyFirstName({ from: 'PETER JANSEN', body: 'Bedankt.' }), 'Peter');
  assert.equal(inferMailboxReplyFirstName({ from: 'McDonald', body: 'Bedankt.' }), 'McDonald');
});

test('centraal replyprofiel dwingt Servé-stijl, waarheid en beide mailbronnen af', () => {
  const prompt = buildMailboxReplySystemPrompt({ senderName: 'Servé Creusen' });

  assert.equal(MAILBOX_REPLY_PROFILE.id, 'serve-mailbox-reply-v1');
  assert.match(prompt, /centraal antwoordprofiel serve-mailbox-reply-v1/);
  assert.match(prompt, /ontvangenMail is de nieuwste mail/);
  assert.match(prompt, /oorspronkelijkeVerzondenMail is de oorspronkelijke mail/);
  assert.match(prompt, /Begin exact met "Beste \[voornaam\],"/);
  assert.match(prompt, /anders exact met "Beste,"/);
  assert.match(prompt, /nooit met jullie/);
  assert.match(prompt, /exact één keer 😁/);
  assert.match(prompt, /prijs afhangt van wat iemand precies wil/);
  assert.match(prompt, /volgende week \[dag\] even langskom/);
  assert.match(prompt, /placeholder \[dag\] altijd letterlijk staan/);
  assert.match(prompt, /nooit alsof de afspraak al staat/);
  assert.match(prompt, /"laagdrempelig", "kansen" of "verbeterpunten"/);
  assert.match(prompt, /Het actuele ontwerp uit deze coldmail is met code gebouwd/);
  assert.match(prompt, /zonder defensieve tegenstelling zoals "dus niet in Webflow"/);
  assert.match(prompt, /alleen als voorstel getoond en nooit automatisch verzonden/);
  assert.match(prompt, /Met vriendelijke groet,[\s\S]*Servé Creusen/);
});

test('centraal replyprofiel gebruikt de geselecteerde Martijn-mailboxidentiteit', () => {
  const prompt = buildMailboxReplySystemPrompt({ senderName: 'Martijn van de Ven' });

  assert.match(prompt, /Schrijf altijd namens Martijn van de Ven/);
  assert.match(prompt, /Met vriendelijke groet,[\s\S]*Martijn van de Ven/);
  assert.doesNotMatch(prompt, /Schrijf altijd namens Servé Creusen/);
});

test('replyprofiel kiest oorspronkelijke verzender boven een conflicterende mailboxfallback', () => {
  assert.equal(
    resolveMailboxReplySenderProfile({
      accountEmail: 'serve@softora.nl',
      originalSentMail: { from: 'Martijn van de Ven <martijn@softora.nl>' },
    }).name,
    'Martijn van de Ven'
  );
  assert.equal(resolveMailboxReplySenderProfile({ accountEmail: 'serve@softora.nl' }).name, 'Servé Creusen');
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

test('replyprofiel zet een volledig in hoofdletters aangeleverde aanhefnaam normaal', () => {
  const result = enforceMailboxReplyProfile('Dankjewel voor je reactie.', {
    firstName: 'PETER',
  });

  assert.match(result, /^Beste Peter,/);
  assert.doesNotMatch(result, /^Beste PETER,/);
});

test('replyprofiel ondertekent exact met de geselecteerde mailboxidentiteit', () => {
  const serveResult = enforceMailboxReplyProfile('Dankjewel voor je reactie.', {
    accountEmail: 'serve@softora.nl',
    senderName: 'Servé Creusen',
  });
  const martijnResult = enforceMailboxReplyProfile('Dankjewel voor je reactie.', {
    accountEmail: 'martijn@softora.nl',
    senderName: 'Martijn van de Ven',
  });

  assert.equal(serveResult.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
  assert.equal(martijnResult.endsWith('Met vriendelijke groet,\nMartijn van de Ven'), true);
  assert.doesNotMatch(martijnResult, /Servé Creusen/);
});

test('Salon TOF houdt alleen de code-feitelijkheid en stuurt warm naar een bewerkbare dag', () => {
  const result = enforceMailboxReplyProfile(
    'Hoi Salon,\n\nIk werk zelf ook in Webflow. Dus niet in Webflow zoals jullie huidige site. Webflow kan ik ook voor je verbeteren.',
    {
      firstName: '',
      inboundText: 'Met welk programma werk je? Wij hebben nu Webflow.',
    }
  );

  assert.match(result, /^Beste,/);
  assert.match(result, /Dit ontwerp heb ik met code gebouwd/);
  assert.match(result, new RegExp(MAILBOX_REPLY_CONVERSATION_BRIDGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result, new RegExp(MAILBOX_REPLY_MEETING_SUGGESTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(result, /Hoi Salon|werk zelf ook in Webflow|dus niet in Webflow|Webflow kan|advies over Webflow|\bjullie\b/i);
  assert.doesNotMatch(result, /\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i);
  assert.equal((result.match(/😁/gu) || []).length, 1);
  assert.equal(result.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
});

test('replyprofiel classificeert interesse, prijs en afwijzing vóór afspraaklogica', () => {
  assert.equal(classifyMailboxReplyIntent('Ik ben benieuwd, kan je de preview sturen?'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Heb je voorbeelden van wat er mogelijk is?'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Met welk programma werk je? Wij hebben nu Webflow.'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Wat kost dit ontwerp ongeveer?'), 'price');
  assert.equal(classifyMailboxReplyIntent('Wij hebben geen interesse en willen geen afspraak.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('Het ontwerp past helaas niet bij ons.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('Dank voor het ontwerp.'), 'neutral');
  assert.equal(classifyMailboxReplyIntent('Bedankt voor je bericht.'), 'neutral');
});

test('interesse krijgt exact één concreet vrijblijvend voorstel met bewerkbare dag', () => {
  const result = enforceMailboxReplyProfile(
    'Beste Lisa,\n\nLeuk dat je interesse hebt 😁 Zullen we een afspraak maken om het samen te bekijken?',
    {
      firstName: 'Lisa',
      inboundText: 'Ik ben benieuwd en ontvang de preview graag.',
    }
  );

  assert.equal((result.match(/volgende week \[dag\] even langskom/g) || []).length, 1);
  assert.match(result, new RegExp(MAILBOX_REPLY_CONVERSATION_BRIDGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result, new RegExp(MAILBOX_REPLY_MEETING_SUGGESTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(result, /Zullen we een afspraak maken/);
  assert.doesNotMatch(result, /\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i);
});

test('afwijzing verwijdert ieder afspraakvoorstel en blijft kort respectvol', () => {
  const result = enforceMailboxReplyProfile(
    'Beste Daffy,\n\nHelemaal begrijpelijk. Zullen we toch een afspraak maken zodat ik volgende week woensdag langskom?',
    {
      firstName: 'Daffy',
      inboundText: 'Bedankt, maar we hebben geen interesse en zijn tevreden met onze huidige partij.',
    }
  );

  assert.doesNotMatch(result, /afspraak|langskom|volgende week|\[dag\]/i);
  assert.match(result, /^Beste Daffy,/);
  assert.equal((result.match(/😁/gu) || []).length, 1);
});

test('prijsvraag verwijdert verzonnen bedragen, legt afhankelijkheid uit en laat de dag bewerkbaar', () => {
  const result = enforceMailboxReplyProfile(
    'Beste Lisa,\n\nDit kost € 995,-. Ik kan woensdag langskomen om de kansen te bespreken.',
    {
      firstName: 'Lisa',
      inboundText: 'Wat kost zoiets ongeveer?',
    }
  );

  assert.match(result, new RegExp(MAILBOX_REPLY_PRICE_EXPLANATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result, new RegExp(MAILBOX_REPLY_CONVERSATION_BRIDGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result, new RegExp(MAILBOX_REPLY_MEETING_SUGGESTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(result, /995|€|\bkansen\b/i);
  assert.doesNotMatch(result, /\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i);
});
