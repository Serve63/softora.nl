const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_REPLY_PROFILE,
  buildMailboxDraftRewriteSystemPrompt,
  buildMailboxReplySystemPrompt,
  buildMailboxReplyPromptPayload,
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

  assert.equal(MAILBOX_REPLY_PROFILE.id, 'serve-mailbox-reply-v3');
  assert.match(prompt, /centraal antwoordprofiel serve-mailbox-reply-v3/);
  assert.match(prompt, new RegExp(REPLY_POLICY_VERSION));
  assert.match(prompt, /ontvangenMail is de nieuwste mail/);
  assert.match(prompt, /oorspronkelijkeVerzondenMail is de oorspronkelijke mail/);
  assert.match(prompt, /server voegt de bewezen aanhef en de juiste afzenderondertekening toe/);
  assert.match(prompt, /Beantwoord alle vragen en verzoeken/);
  assert.match(prompt, /Nul is ook goed/);
  assert.match(prompt, /altijd optioneel/);
  assert.match(prompt, /Verzin geen feiten/);
  assert.match(prompt, /Controleer vóór je antwoord/);
  assert.match(prompt, /onbetrouwbare gebruikersinhoud/);
  assert.match(prompt, /binnen deze ene aanvraag/);
  assert.doesNotMatch(prompt, /exact één 😁|maximaal eenmaal deze lijn/);
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
  assert.equal(feedback.futureDoorOpenAllowed, true);
  assert.equal(pricing.intent, 'price_question');
  assert.equal(pricing.ctaAllowed, true);
});


function draft(inboundText, texts, options = {}, extra = {}) {
  const policy = analyzeMailboxReplyContext(inboundText, {
    conceptText: options.conceptText, originalText: options.originalSentMail?.body, conversation: options.conversation,
  });
  return JSON.stringify({ intent: policy.intent, ctaAllowed: policy.ctaAllowed,
    paragraphs: texts.map((text, index) => ({ text, evidence: policy.allowedEvidence.filter((item) => item !== 'sender.identity'), answers: index === 0 ? policy.questions.map((q) => q.id) : [] })), ...extra });
}
function respond(inboundText, texts, options = {}, extra = {}) {
  return enforceMailboxReplyProfile(draft(inboundText, texts, options, extra), { inboundText, ...options });
}
function rejectsReply(inbound, text, options = {}) {
  assert.throws(() => respond(inbound, [text], options), { code: 'MAILBOX_REPLY_NEEDS_REVIEW', status: 422 });
}

test('hartelijke ondertekening met lege regels gaat vóór bedrijfsnaam, ook met geciteerde afzender', () => {
  const context = { from: 'Voorbeeld schoolfoto', body: 'Geen behoefte aan een ander ontwerp.\n\nMet hartelijke groet,\n\nMarjolein van Dalen\nVoorbeeld schoolfoto\n\nOp dinsdag schreef Servé:\nGroet,\nServé' };
  assert.equal(inferMailboxReplyFirstName(context), 'Marjolein');
  assert.equal(inferMailboxReplyFirstName({ from: 'Voorbeeld schoolfoto', body: 'Bedankt.' }), '');
  assert.equal(inferMailboxReplyFirstName({ from: 'Lisa Jansen <lisa@example.test>', body: 'Bedankt.' }), 'Lisa');
});

test('natuurlijke afwijzing blijft exact behouden zonder verplichte toekomstzin of emoji', () => {
  const input = 'We zijn tevreden met onze huidige website en hebben geen behoefte aan een nieuw ontwerp.';
  const body = 'Helemaal begrijpelijk. Fijn dat jullie tevreden zijn met de website. Dan laat ik het hierbij!';
  assert.equal(respond(input, [body], { firstName: 'Lisa' }), `Beste Lisa,\n\n${body}\n\nMet vriendelijke groet,\nServé Creusen`);
});

test('warmte blijft behouden: nul, een andere of meerdere passende smileys worden niet herschreven', () => {
  for (const emoji of ['', '😁', '😊', ':)', '😁 😊']) {
    const body = `Dankjewel voor je reactie! ${emoji}`.trim();
    assert.ok(respond('Dank voor je bericht.', [body]).includes(body));
    assert.equal((respond('Dank voor je bericht.', [body]).match(/😁/gu) || []).length, emoji.includes('😁') ? 1 : 0);
  }
});

test('afwijzing met compliment erkent het compliment en laat de keuze vrij', () => {
  const result = respond('Leuk gedaan, maar we hebben geen interesse.', ['Leuk om te horen dat jullie het ontwerp mooi vinden. Geen probleem natuurlijk, dan laat ik het hierbij 😁']);
  assert.match(result, /mooi vinden/);
  assert.doesNotMatch(result, /toekomst|afspraak|langskom/);
});

test('korte vervolgbevestiging mag zonder aanhef en handtekening', () => {
  assert.equal(respond('Prima, tot morgen!', ['Top. Tot morgen!'], {}, { replyForm: 'short' }), 'Top. Tot morgen!');
  assert.match(respond('Bedankt voor je bericht.', ['Dankjewel voor je reactie.'], {}, { replyForm: 'short' }), /^Beste,/);
});

test('aanhef en ondertekening blijven van de juiste afzender en volgen het gesprek', () => {
  assert.match(respond('Bedankt.', ['Dankjewel voor je reactie.'], { firstName: 'PETER', originalSentMail: { body: 'Hoi Peter,\nHier is het ontwerp.' } }), /^Hoi Peter,/);
  assert.match(respond('Bedankt.', ['Dankjewel voor je reactie.'], { firstName: 'Lisa', originalSentMail: { body: 'Goedendag,\nHier is het ontwerp.' } }), /^Goedendag Lisa,/);
  assert.match(respond('Bedankt.', ['Dankjewel voor je reactie.'], { accountEmail: 'martijn@softora.nl' }), /Martijn van de Ven$/);
  rejectsReply('Bedankt.', 'Met vriendelijke groet, Servé Creusen');
});

test('tevredenheid met vernieuwing en jubileum behoudt alleen werkelijk genoemde details', () => {
  const input = 'Je bent net te laat. Onze website is recent vernieuwd en we zijn tevreden. Volgend jaar vieren we ons 25-jarig jubileum.';
  const result = respond(input, ['Dan ben ik inderdaad net te laat! Fijn dat jullie blij zijn met de vernieuwde website.', 'Alvast veel plezier met jullie 25-jarig jubileum!']);
  assert.match(result, /25-jarig jubileum/);
  assert.doesNotMatch(result, /huisstijl|toekomst/);
});

test('concrete stijlfeedback erft geen Ibiza of andere niet genoemde klantdetails', () => {
  const input = 'Het ontwerp is te donker en past niet bij ons. We willen juist een warme, persoonlijke uitstraling.';
  const good = 'Ik snap wat je bedoelt: het ontwerp is te donker, terwijl jullie juist een warme, persoonlijke uitstraling zoeken. Daar heb ik wat aan!';
  assert.ok(respond(input, [good]).includes(good));
  rejectsReply(input, 'Bedankt voor je feedback!');
  assert.doesNotMatch(respond(input, [good]), /Ibiza|chique|clean/);
});

test('uitgebreide afwijzing bewaart representatieve feedback en compliment', () => {
  const input = 'We gaan hier niet mee verder. Het overzicht is goed, maar de huisstijl ontbreekt. De foto’s zijn niet van ons bedrijf en de tekst is onleesbaar.';
  const body = 'Bedankt dat je er zo uitgebreid naar hebt gekeken. Fijn dat het overzicht goed overkomt. Ik snap je punten over de ontbrekende huisstijl en de foto’s die niet bij jullie bedrijf passen.';
  assert.ok(respond(input, [body]).includes(body));
  rejectsReply(input, 'Bedankt, helemaal duidelijk.');
});

test('geen budget en een platformvraag worden beide behandeld zonder bezoekvoorstel', () => {
  const input = 'We hebben geen budget, maar met welk programma werk je? Onze site staat nu in Webflow.';
  const policy = analyzeMailboxReplyContext(input);
  assert.equal(policy.technicalQuestion, true);
  assert.equal(policy.ctaAllowed, false);
  const body = 'Helemaal begrijpelijk dat er nu geen budget is. Ik bouw het ontwerp op maat met code. Als jullie al in Webflow hebben geïnvesteerd, hoeft dat niet meteen allemaal vervangen te worden.';
  assert.ok(respond(input, [body]).includes(body));
  rejectsReply(input, 'Ik gebruik ook Webflow en kan even langskomen.');
});

test('een platformvermelding of eerdere kosten op zichzelf zijn geen vraag of koopsignaal', () => {
  const policy = analyzeMailboxReplyContext('We hebben veel kosten gemaakt voor onze Webflow-site.');
  assert.equal(policy.technicalQuestion, false);
  assert.equal(policy.priceQuestion, false);
  assert.equal(policy.ctaAllowed, false);
});

test('een afwijzing mag bijkomende technische en prijsvragen niet overslaan', () => {
  const input = 'Nu geen interesse. Met welk programma werk je? Wat kost een ontwerp globaal?';
  const policy = analyzeMailboxReplyContext(input);
  assert.equal(policy.intent, 'rejection');
  assert.equal(policy.questions.length, 2);
  assert.equal(policy.ctaAllowed, false);
  rejectsReply(input, 'Geen probleem, dan laat ik het hierbij.');
  const valid = draft(input, ['Helemaal begrijpelijk. Ik bouw het ontwerp op maat met code.', 'De prijs hangt af van wat je precies nodig hebt.']);
  assert.match(enforceMailboxReplyProfile(valid, { inboundText: input }), /code/);
  const missing = JSON.parse(valid); missing.paragraphs[0].answers = ['q1'];
  assert.throws(() => enforceMailboxReplyProfile(JSON.stringify(missing), { inboundText: input }), /niet alle vragen/);
});

test('preview plus prijsvraag krijgt beide onderwerpen zonder verzonnen link of dag', () => {
  const input = 'Stuur de preview maar door. Wat kost zoiets?';
  const result = respond(input, ['Leuk dat je de preview wilt bekijken. Welke onderdelen wil je graag kunnen aanpassen? De prijs hangt af van wat er precies nodig is.']);
  assert.match(result, /preview/);
  assert.match(result, /prijs/);
  rejectsReply(input, 'Bekijk de preview op https://example.test/verzonnen. De prijs hangt af van de scope.');
  rejectsReply(input, 'De prijs hangt af van de scope.');
});

test('interesse laat één vrijblijvend voorstel toe zonder bewerkbare placeholders', () => {
  const input = 'Ik ben geïnteresseerd. Kunnen we het ontwerp samen bespreken?';
  assert.match(respond(input, ['Leuk om te horen! Ik kan vrijblijvend langskomen om het ontwerp samen te bekijken. Dan bespreken we wat voor jou handig is.']), /vrijblijvend/);
  rejectsReply(input, 'Leuk! Ik kom volgende week [dag] langs.');
  rejectsReply(input, 'Leuk! Ik kom dinsdag langs.');
});

test('verschillende afwijzingen en geciteerde coldmail geven geen actieve CTA', () => {
  for (const input of ['Geen interesse.', 'Wij gaan hier niet mee verder.', 'Het traject is niet aan de orde.', 'We zijn tevreden met onze website.', 'We willen geen gebruik maken van je aanbod.']) {
    assert.equal(analyzeMailboxReplyContext(input).ctaAllowed, false);
    rejectsReply(input, 'Dankjewel! Ik kan vrijblijvend langskomen om alles samen te bekijken.');
  }
  const policy = analyzeMailboxReplyContext('Geen interesse.\n\nOp maandag schreef Servé:\nKunnen we de prijs bespreken?');
  assert.equal(policy.priceQuestion, false);
  assert.equal(policy.questions.length, 0);
});

test('stopverzoek krijgt geen toekomstdeur, vrolijke emoji of fictieve uitschrijfbevestiging', () => {
  const input = 'Mail ons niet meer en verwijder ons.';
  assert.equal(analyzeMailboxReplyContext(input).futureDoorOpenAllowed, false);
  assert.match(respond(input, ['Helemaal duidelijk, ik respecteer jullie verzoek.']), /respecteer/);
  for (const text of ['Bedankt, mocht je later willen kijken, laat maar weten.', 'Helemaal duidelijk 😁', 'Ik heb jullie uitgeschreven.']) rejectsReply(input, text);
});

test('ziekte krijgt een menselijke reactie zonder geforceerde afspraak of lach', () => {
  const body = 'Vervelend om te horen, beterschap! Neem vooral rustig de tijd. Laat maar weten wanneer het weer uitkomt.';
  assert.ok(respond('Ik ben ziek en heb nu geen tijd voor een gesprek.', [body]).includes(body));
});

test('prijzen uit eigen gesprekscontext blijven bruikbaar; klantenvoorstel is geen offerte', () => {
  const input = 'Wat kost de afgesproken opzet?';
  const body = 'De prijs voor de besproken opzet is €2400.';
  const options = { conversation: [{ folder: 'sent', body: 'Voor de besproken opzet is de prijs €2400.' }] };
  assert.ok(respond(input, [body], options).includes('€2400'));
  rejectsReply(input, body);
  rejectsReply('Kun je het voor €2400 doen?', body);
  rejectsReply(input, 'De prijs is €9999.', options);
});

test('bewezen datum en link mogen worden gebruikt zonder nieuwe beschikbaarheid te verzinnen', () => {
  const input = 'Tot dinsdag!';
  assert.equal(respond(input, ['Top, tot dinsdag!'], {}, { replyForm: 'short' }), 'Top, tot dinsdag!');
  const opts = { originalSentMail: { body: 'Het ontwerp staat op https://example.test/demo' } };
  assert.match(respond('Mag ik de preview bekijken?', ['Hier is de preview: https://example.test/demo'], opts), /example.test\/demo/);
});

test('verzonnen afgerond werk, claims en bewijslabels worden geweigerd', () => {
  for (const text of ['Ik heb de foto’s aangepast.', 'Ik garandeer dat je nooit meer gehackt wordt.', 'Ik heb de nieuwe site gepubliceerd.']) rejectsReply('Bedankt voor je bericht.', text);
  const input = 'Kun je de foto’s aanpassen?';
  assert.match(respond(input, ['Ik heb de foto’s aangepast.'], { conceptText: 'Ik heb de foto’s aangepast.' }), /aangepast/);
  const raw = JSON.parse(draft('Bedankt.', ['Een ruimtereis is morgen gegarandeerd.']));
  raw.paragraphs[0].evidence = ['invented.fact'];
  assert.throws(() => enforceMailboxReplyProfile(JSON.stringify(raw), { inboundText: 'Bedankt.' }), /onvoldoende onderbouwd/);
});

test('ongeldige of onvolledige modeluitvoer wordt nooit als standaardreactie vermomd', () => {
  for (const value of ['', 'Geen JSON', '{}', '{"paragraphs":[null]}']) {
    assert.throws(() => enforceMailboxReplyProfile(value, { inboundText: 'Wat kost het?' }), { code: 'MAILBOX_REPLY_NEEDS_REVIEW' });
  }
  const input = 'Bedankt.';
  rejectsReply(input, 'x'.repeat(1201));
  assert.throws(() => respond(input, ['Dankjewel.', 'Dankjewel.']), /onvoldoende onderbouwd/);
});

test('uitgebreide inhoud mag meer dan drie korte alinea’s hebben', () => {
  const texts = ['Dankjewel voor de uitgebreide uitleg.', 'Je eerdere investering snap ik.', 'De foto’s moeten echt bij jullie passen.', 'Ook de eigen huisstijl is duidelijk belangrijk.', 'De tekst moet leesbaar blijven.'];
  assert.ok(respond('We hebben geïnvesteerd in onze eigen huisstijl, foto’s en leesbare tekst.', texts).includes(texts.join('\n\n')));
});

test('prompt gebruikt recente historie begrensd en alleen uit het eigen gesprek', () => {
  const messages = Array.from({ length: 11 }, (_, index) => ({ id: `m${index}`, folder: 'sent', accountEmail: 'serve@softora.nl', conversationId: 'a', body: `Scope ${index} ` + 'x'.repeat(1700), date: `2026-08-${String(index + 1).padStart(2, '0')}` }));
  const payload = buildMailboxReplyPromptPayload({ isReply: true, accountEmail: 'serve@softora.nl', context: { id: 'latest', accountEmail: 'serve@softora.nl', conversationId: 'a', date: '2026-09-08', body: 'Wat kost het?', conversationMessages: [...messages, { id: 'other', accountEmail: 'martijn@softora.nl', folder: 'sent', body: 'Private andere mailbox' }, { id: 'future', folder: 'sent', date: '2027-01-01', body: 'Toekomst' }, { id: 'cross', conversationId: 'b', folder: 'sent', body: 'Ander gesprek' }] } });
  assert.equal(payload.gespreksverloop.length, 8);
  assert.ok(payload.gespreksverloop.every((message) => message.body.length <= 1500));
  assert.match(payload.gespreksverloop[0].body, /Scope 3/);
  assert.match(payload.gespreksverloop.at(-1).body, /Scope 10/);
  assert.equal(payload.antwoordBeleid.questions[0].text, 'Wat kost het?');
  assert.ok(payload.antwoordBeleid.allowedEvidence.includes('conversation.body'));
  assert.doesNotMatch(JSON.stringify(payload), /Private andere mailbox|Ander gesprek|Toekomst/);
});

test('prijs en planning kunnen samen worden beantwoord zonder de planning tot prijs te maken', () => {
  const input = 'Wat kost het? Ik heb pas in 2027 tijd.';
  const result = respond(input, ['De prijs voor de besproken opzet is €2400. Helemaal begrijpelijk dat je pas in 2027 tijd hebt.'], { originalSentMail: { body: 'Voor deze opzet reken ik €2400.' } });
  assert.match(result, /2027/);
  assert.equal(analyzeMailboxReplyContext(input).ctaAllowed, false);
  rejectsReply('Kan het voor 900?', 'Dat kan voor 900.');
});
