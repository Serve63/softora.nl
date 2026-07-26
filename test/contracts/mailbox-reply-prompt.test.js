const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_REPLY_NEXT_STEP,
  MAILBOX_REPLY_PRICE_EXPLANATION,
  MAILBOX_REPLY_PROFILE,
  MAILBOX_REPLY_WEBFLOW_ANSWER,
  MAILBOX_REPLY_WEBFLOW_NEXT_STEP,
  buildMailboxDraftRewriteSystemPrompt,
  buildMailboxReplySystemPrompt,
  classifyMailboxReplyIntent,
  enforceMailboxReplyProfile,
  enforceMailboxReplySignature,
  inferMailboxReplyFirstName,
  resolveMailboxReplySenderProfile,
} = require('../../server/services/mailbox-reply-prompt');
const {
  REPLY_POLICY_VERSION,
  analyzeMailboxReplyContext,
} = require('../../server/services/mailbox-reply-policy');

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

  assert.equal(MAILBOX_REPLY_PROFILE.id, 'serve-mailbox-reply-v2');
  assert.match(prompt, /centraal antwoordprofiel serve-mailbox-reply-v2/);
  assert.match(prompt, new RegExp(REPLY_POLICY_VERSION));
  assert.match(prompt, /ontvangenMail is de nieuwste mail/);
  assert.match(prompt, /oorspronkelijkeVerzondenMail is de oorspronkelijke mail/);
  assert.match(prompt, /server voegt de bewezen aanhef, exact één 😁 en de juiste afzenderondertekening toe/);
  assert.match(prompt, /Iedere alinea en iedere zin moet rechtstreeks volgen/);
  assert.match(prompt, /geen generieke vulling, losse lof, boilerplate/);
  assert.match(prompt, /Een afwijzing mag concrete feedback nooit wissen/);
  assert.match(prompt, /futureDoorOpenAllowed exact true/);
  assert.match(prompt, /antwoordBeleid\.ctaAllowed exact true/);
  assert.match(prompt, /volgende week \[dag\] even langskom/);
  assert.match(prompt, /de enige vaste waarheid/);
  assert.match(prompt, /bewezen lijn/);
  assert.match(prompt, /Vertel nooit de eigen software/);
  assert.match(prompt, /uitsluitend geldige JSON/);
});

test('centraal replyprofiel gebruikt de geselecteerde Martijn-mailboxidentiteit', () => {
  const prompt = buildMailboxReplySystemPrompt({ senderName: 'Martijn van de Ven' });

  assert.match(prompt, /Schrijf altijd namens Martijn van de Ven/);
  assert.match(prompt, /juiste afzenderondertekening/);
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

test('Salon TOF krijgt een inhoudelijk code-antwoord zonder ongegronde uitnodiging', () => {
  const result = enforceMailboxReplyProfile(
    'Beste,\n\nGoede vraag. Dit ontwerp heb ik helemaal op maat met code gebouwd. Dan kunnen we samen kort kijken wat er mogelijk is.\n\nAls je wilt, denk ik graag even met je mee over wat voor jou handig is. Als je wilt, is het een idee dat ik volgende week [dag] even langskom? 😁',
    {
      firstName: '',
      inboundText: 'Met welk programma werk je? Wij hebben nu Webflow.',
    }
  );

  assert.equal(result, [
    'Beste,',
    '',
    MAILBOX_REPLY_WEBFLOW_ANSWER,
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n'));
  assert.match(result, /volledig op maat met code/);
  assert.match(result, /indeling, uitstraling en werking precies afstemmen/);
  assert.match(result, /zonder vast te zitten aan een standaard websitebouwer/);
  assert.doesNotMatch(result, /Hoi Salon|Leuke vraag|werk zelf ook in Webflow|dus niet in Webflow|Webflow kan ik|advies over Webflow|Wij hebben nu|\bWebflow\b|\bjullie\b|denk ik graag even met je mee|Als je wilt/i);
  assert.doesNotMatch(result, /langskom|afspraak|\[dag\]|volgende week/i);
  assert.doesNotMatch(result, /\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i);
  assert.equal((result.match(/😁/gu) || []).length, 1);
  assert.equal(result.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
});

test('replyprofiel classificeert interesse, prijs en afwijzing vóór afspraaklogica', () => {
  assert.equal(classifyMailboxReplyIntent('Ik ben benieuwd, kan je de preview sturen?'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Ik vind dit wel interessant.'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Dit vinden wij wel interessant.'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Heb je voorbeelden van wat er mogelijk is?'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Met welk programma werk je? Wij hebben nu Webflow.'), 'interest');
  assert.equal(classifyMailboxReplyIntent('Wat kost dit ontwerp ongeveer?'), 'price');
  assert.equal(classifyMailboxReplyIntent('Wij hebben geen interesse en willen geen afspraak.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('Het ontwerp past helaas niet bij ons.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('Het verder ingaan van een traject met Softora is niet aan de orde.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('Wij gaan hier niet mee verder, maar bedankt voor de moeite.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('Dit valt buiten onze scope en we geven hier geen vervolg aan.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('We willen geen gebruik maken van je aanbod.'), 'rejection');
  assert.equal(classifyMailboxReplyIntent('Dank voor het ontwerp.'), 'neutral');
  assert.equal(classifyMailboxReplyIntent('Bedankt voor je bericht.'), 'neutral');
});

test('antwoordbeleid laat alleen expliciete vooruitgerichte signalen een CTA openen', () => {
  const technical = analyzeMailboxReplyContext('Met welk programma werk je? Wij hebben nu Webflow.');
  const feedback = analyzeMailboxReplyContext('Dank voor de opzet. Als feedback mis ik vooral onze eigen sfeer.');
  const pricing = analyzeMailboxReplyContext('Wat kost dit ongeveer en kunnen we dit kort bespreken?');

  assert.equal(technical.intent, 'technical_question');
  assert.equal(technical.ctaAllowed, false);
  assert.equal(feedback.intent, 'feedback_only');
  assert.equal(feedback.ctaAllowed, false);
  assert.equal(pricing.intent, 'price_question');
  assert.equal(pricing.ctaAllowed, true);
});

test('Bossche Brouwers feedback erft geen actieve CTA uit geciteerde coldmail', () => {
  const inbound = [
    'Beste Servé,',
    '',
    'Dank voor de moeite. De opzet ziet er verzorgd uit.',
    'Als feedback zou ik vooral meer van onze eigen sfeer en brouwerij laten terugkomen.',
    'Succes met je verdere werk.',
    '',
    'Op vr 24 jul 2026 om 09:10 schreef Servé Creusen:',
    '> Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening.',
    '> Je kunt het webdesign hier bekijken.',
  ].join('\n');
  assert.equal(classifyMailboxReplyIntent(inbound), 'neutral');

  const result = enforceMailboxReplyProfile(
    'Dankjewel voor je uitgebreide en concrete feedback. Daar kan ik iets mee. Misschien is het leuk als ik volgende week [dag] een keer langskom om verder te bespreken wat er mogelijk is.',
    {
      firstName: '',
      inboundText: inbound,
    }
  );

  assert.match(result, /Dankjewel voor je uitgebreide en concrete feedback/);
  assert.doesNotMatch(result, /langskom|afspraak|\[dag\]|verder bespreken/i);
  assert.equal((result.match(/😁/gu) || []).length, 1);
  assert.equal(result.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
});

test('Bossche Brouwers krijgt een inhoudelijke feedbackreactie ondanks de afwijzing', () => {
  const inbound = [
    'Hallo Servé',
    '',
    'Leuk dat je aandacht schenkt aan ons bedrijf.',
    'Je design ziet er netjes uit. We gaan het echter niet gebruiken :)',
    'Een paar reacties:',
    '',
    'Het design is voor ons bedrijf wat te vlak/algemeen. Dit zou voor iedere brouwerij gebruikt kunnen worden.',
    '- Het is te duidelijk ai',
    '- Het eten wat je toont is niet door onze koks gemaakt',
    '- Onze huisstijl komt nergens terug in het design',
    '- De glazen zijn niet onze glazen, en de kleur van het bier klopt niet helemaal.',
    "- De silo's met lichtreclame zijn niet aanwezig op de Tramkade en de tekst van de lichtreclame valt door ai uit elkaar.",
    '',
    'Wat ik goed vind aan je design is sfeer en overzicht. Wat we missen is identiteit.',
    'Goed dat je hiermee bezig bent, heel veel succes!',
    '',
    'Vriendelijke groet;',
    'Leonard Hamers',
  ].join('\n');
  const policy = analyzeMailboxReplyContext(inbound);

  assert.equal(policy.intent, 'rejection');
  assert.equal(policy.ctaAllowed, false);
  assert.equal(policy.substantiveFeedback, true);
  assert.equal(policy.futureDoorOpenAllowed, true);
  assert.deepEqual(
    policy.feedbackDetails.themes.map((theme) => theme.key),
    [
      'generic_identity',
      'non_own_imagery',
      'missing_brand_style',
      'inaccurate_details',
      'broken_text',
    ]
  );
  assert.deepEqual(
    policy.feedbackDetails.positiveThemes.map((theme) => theme.key),
    ['atmosphere', 'overview', 'presentation']
  );

  const result = enforceMailboxReplyProfile(
    JSON.stringify({
      intent: 'rejection',
      ctaAllowed: false,
      paragraphs: [{
        text: 'Dankjewel voor je reactie.',
        evidence: ['received.intent'],
      }],
    }),
    {
      firstName: 'Leonard',
      inboundText: inbound,
      senderName: 'Servé Creusen',
      originalSentMail: {
        body: [
          'Goedendag,',
          '',
          'Afgelopen week kwam ik jullie website bosschebrouwers.nl tegen.',
          '',
          'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
        ].join('\n'),
      },
    }
  );

  assert.equal(result, [
    'Goedendag Leonard,',
    '',
    'Bedankt dat je er zo uitgebreid naar hebt gekeken en je eerlijke feedback hebt gedeeld! Fijn om te horen dat de sfeer en het overzicht wel goed overkwamen. 😁',
    '',
    'Je punten over de algemene uitstraling, de beelden die niet bij jullie bedrijf passen en het ontbreken van jullie huisstijl zijn duidelijk. Daar kan ik zeker iets mee.',
    '',
    'Mocht je in de toekomst toch eens willen kijken wat er mogelijk is voor jullie website, dan mag je me altijd een berichtje sturen.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n'));
  assert.doesNotMatch(result, /langskom|afspraak|\[dag\]|prijs|vervolgvoorstel|\?/i);
});

test('een expliciet verzoek om geen verder contact blokkeert ook de zachte toekomstzin', () => {
  const inbound = [
    'Bedankt voor je werk. De sfeer is goed, maar onze huisstijl ontbreekt en de beelden zijn niet van ons.',
    'Mail ons niet meer en schrijf ons uit.',
  ].join('\n');
  const policy = analyzeMailboxReplyContext(inbound, {
    originalText: 'Ik kwam jullie website tegen.',
  });
  const result = enforceMailboxReplyProfile('', {
    inboundText: inbound,
    originalSentMail: { body: 'Goedendag,\n\nIk kwam jullie website tegen.' },
  });

  assert.equal(policy.substantiveFeedback, true);
  assert.equal(policy.noFurtherContact, true);
  assert.equal(policy.futureDoorOpenAllowed, false);
  assert.doesNotMatch(result, /in de toekomst|berichtje sturen|wat er mogelijk is/i);
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
  assert.match(result, /het ontwerp samen kort bekijken/);
  assert.doesNotMatch(result, /Zullen we een afspraak maken/);
  assert.doesNotMatch(result, /Als je wilt, is het een idee/i);
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

test('Hoogstam Brigade afwijzing blokkeert ieder bezoek en generieke interesseheuristiek', () => {
  const inbound = [
    'Beste Servé,',
    '',
    'Dank voor je uitgebreide toelichting en de mooie eerste opzet.',
    'Het verder ingaan van een traject met Softora is voor ons niet aan de orde.',
    '',
    'Met vriendelijke groet,',
    'Hub Meertens',
  ].join('\n');
  const result = enforceMailboxReplyProfile(
    'Wat fijn dat je de opzet mooi vindt. Ik denk graag mee. Is het een idee dat ik volgende week [dag] even langskom om prijzen en mogelijkheden te bespreken?',
    {
      firstName: 'Hub',
      inboundText: inbound,
      originalSentMail: {
        body: 'Ik ben benieuwd wat je van het ontwerp vindt en kom graag langs.',
      },
    }
  );

  assert.match(result, /^Beste Hub,/);
  assert.match(result, /Dankjewel voor je duidelijke reactie/);
  assert.doesNotMatch(result, /langskom|afspraak|\[dag\]|meedenk|mogelijkheden|prijs|vervolgstap|traject/i);
  assert.equal((result.match(/😁/gu) || []).length, 1);
  assert.equal(result.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
});

test('Nederlandse afwijzingsvarianten krijgen nooit een vervolgvoorstel', () => {
  const variants = [
    'Wij gaan hier niet mee verder.',
    'Er is geen sprake van een vervolgtraject.',
    'We willen geen gebruik maken van je aanbod.',
    'Dit valt buiten onze scope.',
    'Laat het hierbij en mail ons niet opnieuw.',
  ];
  variants.forEach((inboundText) => {
    const result = enforceMailboxReplyProfile(
      'Ik denk graag met je mee en kan volgende week [dag] langskomen voor een afspraak.',
      { inboundText }
    );
    assert.doesNotMatch(result, /langskom|afspraak|\[dag\]|meedenk|prijs|vervolg/i, inboundText);
  });
});

test('prijsvraag verwijdert verzonnen bedragen, legt afhankelijkheid uit en laat de dag bewerkbaar', () => {
  const result = enforceMailboxReplyProfile(
    'Beste Lisa,\n\nDit kost € 995,-. Ik kan woensdag langskomen om de kansen te bespreken.',
    {
      firstName: 'Lisa',
      inboundText: 'Wat kost zoiets ongeveer?',
    }
  );

  assert.match(result, /De prijs hangt af van wat je precies wilt en wat daarvoor nodig is/);
  assert.match(result, /volgende week \[dag\] even langskom/);
  assert.doesNotMatch(result, /995|€|\bkansen\b/i);
  assert.doesNotMatch(result, /\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i);
});

test('technische vraag zonder commercieel vervolgsignaal krijgt geen gestapelde templates', () => {
  const result = enforceMailboxReplyProfile(
    [
      'Beste,',
      '',
      'Dankjewel voor je vraag.',
      '',
      'Dankjewel voor je vraag!',
      '',
      'Als je wilt, denk ik graag even met je mee over wat voor jou handig is.',
      '',
      'Als je wilt, denk ik graag even met je mee over wat voor jou handig is.',
      'Is het een idee dat ik volgende week [dag] even langskom?',
    ].join('\n'),
    {
      inboundText: 'Kun je vertellen hoe je dit hebt gemaakt?',
    }
  );

  assert.equal((result.match(/Als je wilt/g) || []).length, 0);
  assert.doesNotMatch(result, /Als je wilt, is het een idee/i);
  assert.equal((result.match(/volgende week \[dag\] even langskom/g) || []).length, 0);
  assert.match(result, /volledig op maat met code gebouwd/);
  assert.equal((result.match(/😁/gu) || []).length, 1);
});

test('Christine Jetten tevredenheid blokkeert een bezoek ondanks een slechte AI-draft', () => {
  const result = enforceMailboxReplyProfile(
    JSON.stringify({
      intent: 'forward_interest',
      ctaAllowed: true,
      paragraphs: [{
        text: 'Wat leuk, misschien kan ik volgende week [dag] langskomen om de mogelijkheden te bespreken.',
        evidence: ['received.forward-request'],
      }],
    }),
    {
      firstName: 'Christine',
      inboundText: 'Bedankt voor de moeite, maar ik ben tevreden met mijn huidige website en heb geen interesse.',
    }
  );

  assert.match(result, /^Beste Christine,/);
  assert.match(result, /Dankjewel voor je duidelijke reactie/);
  assert.doesNotMatch(result, /langskom|\[dag\]|afspraak|mogelijkheden/i);
});

test('iedere modelalinea moet relevante bewijslabels en inhoud hebben of valt veilig terug', () => {
  const result = enforceMailboxReplyProfile(
    JSON.stringify({
      intent: 'feedback_only',
      ctaAllowed: false,
      paragraphs: [
        { text: 'Dankjewel voor je concrete feedback.', evidence: ['received.intent'] },
        { text: 'Hopelijk kunnen we samen mooie kansen ontdekken.', evidence: ['received.body'] },
      ],
    }),
    { inboundText: 'Als feedback mis ik vooral onze eigen sfeer en fotografie.' }
  );

  assert.match(result, /uitgebreide en concrete feedback/);
  assert.doesNotMatch(result, /Hopelijk|kansen|samen|langskom|\[dag\]/i);
});

test('een expliciet medewerkersconcept blijft bruikbare bewijscontext bij herschrijven', () => {
  const result = enforceMailboxReplyProfile(
    JSON.stringify({
      intent: 'acknowledgement',
      ctaAllowed: false,
      paragraphs: [{
        text: 'Ik neem je concrete vraag over de planning mee.',
        evidence: ['concept.body'],
      }],
    }),
    {
      inboundText: 'Bedankt voor je reactie.',
      conceptText: 'Neem de concrete vraag over de planning mee.',
    }
  );

  assert.match(result, /concrete vraag over de planning mee/);
  assert.doesNotMatch(result, /langskom|\[dag\]|mogelijkheden/i);
});
