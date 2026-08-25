const test = require('node:test');
const assert = require('node:assert/strict');

const signature = require('../../assets/premium-mailbox-signature.js');

test('mailbox verwijdert het exacte JT-signatureblok en bewaart uitsluitend telefoon en adres', () => {
  const body = [
    'Ziet er zeker gaaf uit!',
    '',
    'Best regards/Met vriendelijke groet.',
    'Jeroen Sterke',
    '',
    '*JT-performance',
    '- http://www.jt-performance.nl [1]',
    'service@jt-performance.nl [2]',
    'Phone: +31 97010269099',
    'Street: Nieuwe Baan 1',
    'Postcode:5076 SV',
    'City:',
    'Haaren',
    'Country:',
    'Nederland',
    'Chamber off commerce:',
    '17122606',
    'Tax Number',
    'NL001751168B24',
  ].join('\n');
  const parsed = signature.parseIncoming(body);

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.bodyLines, ['Ziet er zeker gaaf uit!']);
  assert.deepEqual(parsed.contact, {
    phone: '+31 97010269099',
    phoneHref: 'tel:+3197010269099',
    addressLines: ['Nieuwe Baan 1', '5076 SV Haaren', 'Nederland'],
  });

  const html = signature.renderContactCard(parsed.contact);
  assert.match(html, /class="detail-mail-contact-card"/);
  assert.equal((html.match(/class="detail-mail-contact-item"/g) || []).length, 2);
  assert.match(html, /<dt>Telefoon:<\/dt>/);
  assert.match(html, /<dt>Adres:<\/dt>/);
  assert.match(html, /href="tel:\+3197010269099"/);
  assert.match(html, /Nieuwe Baan 1, 5076 SV Haaren, Nederland/);
  assert.doesNotMatch(html, /detail-mail-contact-title|>\s*Contactgegevens\s*<|<br>/i);
  assert.doesNotMatch(html, /JT-performance|jt-performance\.nl|Chamber|17122606|Tax Number|NL001751168B24/);
});

test('mailbox behandelt natuurlijke zinnen en losse contactlabels zonder signoff fail-open', () => {
  const body = [
    'Best regards zijn volgens mij te formeel voor deze reactie.',
    'Mijn Phone: 0612345678 staat al in het dossier.',
    'Street: dit is inhoudelijke tekst, geen bewezen handtekening.',
  ].join('\n');
  const parsed = signature.parseIncoming(body);

  assert.equal(parsed.matched, false);
  assert.deepEqual(parsed.bodyLines, body.split('\n'));
  assert.deepEqual(parsed.contact, { phone: '', phoneHref: '', addressLines: [] });
});

test('mailbox haalt geen handtekening uit geciteerde of quoteachtige tekst', () => {
  const prefixed = [
    'Mijn eigen reactie.',
    '',
    '> Best regards,',
    '> Iemand Anders',
    '> Phone: 0612345678',
  ].join('\n');
  const quotedReply = [
    'Mijn eigen reactie.',
    '',
    'On Tuesday, 18 August 2026 at 10:30, Jane Example wrote:',
    'Best regards,',
    'Jane Example',
    'Phone: 0612345678',
  ].join('\n');

  for (const body of [prefixed, quotedReply]) {
    const parsed = signature.parseIncoming(body);
    assert.equal(parsed.matched, false);
    assert.deepEqual(parsed.bodyLines, body.split('\n'));
  }
});

test('mailbox verwijdert Lia haar footer na een Gmail-quote maar bewaart haar persoonlijke afsluiting en de quote', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website stroomvantaal-popup.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const quotedLines = [
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven :',
    ...sentBody.split('\n').map((line) => `> ${line}`),
  ];
  const body = [
    'Dag Martijn,',
    '',
    'dank voor je mail, ik reageer later!',
    '',
    'groet,',
    'Lia',
    '',
    ...quotedLines,
    '',
    '--',
    '---',
    '*LIA HESEMANS redactie & training*',
    'eindredactie | auteursbegeleiding | schrijftraining',
    'From: lia@example.nl',
    'Haarensteijnstraat 23 | 5076 CM Haaren',
    'M. de Vries',
    'M 06 33688506',
    'I [www.stroomvantaal-popup.nl](http://www.stroomvantaal-popup.nl)',
  ].join('\n');
  const parsed = signature.parseIncoming(body, {
    from: 'Lia Hesemans',
    email: 'lia@example.nl',
  });

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.bodyLines, [
    'Dag Martijn,',
    '',
    'dank voor je mail, ik reageer later!',
    '',
    'groet,',
    'Lia',
    '',
    ...quotedLines,
  ]);
  assert.deepEqual(parsed.contact, {
    phone: '06 33688506',
    phoneHref: 'tel:0633688506',
    addressLines: ['Haarensteijnstraat 23', '5076 CM Haaren'],
  });
  assert.doesNotMatch(parsed.bodyLines.join('\n'), /LIA HESEMANS|eindredactie|lia@example\.nl|M\. de Vries|stroomvantaal-popup\.nl\]\(/);

  const html = signature.renderContactCard(parsed.contact);
  assert.equal((html.match(/<dt>Telefoon:<\/dt>/g) || []).length, 1);
  assert.equal((html.match(/<dt>Adres:<\/dt>/g) || []).length, 1);
  assert.match(html, /href="tel:0633688506">06 33688506<\/a>/);
  assert.match(html, /Haarensteijnstraat 23, 5076 CM Haaren/);

  const withoutMessageContext = signature.parseIncoming(body);
  assert.deepEqual(withoutMessageContext.contact, { phone: '', phoneHref: '', addressLines: [] });
  assert.match(withoutMessageContext.bodyLines.join('\n'), /LIA HESEMANS|M 06 33688506/);
});

test('mailbox stript zonder bewezen post-quote afzenderidentiteit geen deel van Lia haar antwoord', () => {
  const body = [
    'Dag Martijn,',
    '',
    'dank voor je mail, ik reageer later!',
    '',
    'groet,',
    'Lia',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    '> Dit is een voldoende duidelijke geciteerde coldmailregel.',
    '',
    '--',
    'LIA HESEMANS redactie & training',
    'Haarensteijnstraat 23 | 5076 CM Haaren',
    'M 06 33688506',
  ].join('\n');

  for (const [label, context] of [
    ['lege context', {}],
    ['alleen e-mail zonder footermatch', { email: 'lia@example.nl' }],
    ['enkelvoudige afzendernaam', { fromName: 'Lia' }],
  ]) {
    const parsed = signature.parseIncoming(body, context);

    assert.equal(parsed.matched, false, label);
    assert.deepEqual(parsed.bodyLines, body.split('\n'), label);
    assert.deepEqual(parsed.contact, { phone: '', phoneHref: '', addressLines: [] }, label);
    assert.match(parsed.bodyLines.join('\n'), /groet,\nLia/, label);
    assert.match(parsed.bodyLines.join('\n'), /--\nLIA HESEMANS[\s\S]*M 06 33688506/, label);
  }
});

test('mailbox schrijft een mixed of gedeeltelijk geprefixte quote zonder sterke footerscheider nooit toe aan de huidige afzender', () => {
  const body = [
    'Dit is mijn eigen antwoord.',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    '> Dit is de eerste regel van het geciteerde bericht.',
    'Met vriendelijke groet,',
    'M. de Vries',
    'M 06 12345678',
  ].join('\n');
  const parsed = signature.parseIncoming(body);

  assert.equal(parsed.matched, false);
  assert.deepEqual(parsed.bodyLines, body.split('\n'));
  assert.deepEqual(parsed.contact, { phone: '', phoneHref: '', addressLines: [] });
});

test('mailbox slaat een ambigue M-naam over en bewaart een latere echte M-telefoonregel', () => {
  const parsed = signature.parseIncoming([
    'Dank voor je bericht.',
    '',
    '--',
    'M. de Vries',
    'M 06 12345678',
  ].join('\n'));

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.bodyLines, ['Dank voor je bericht.']);
  assert.deepEqual(parsed.contact, {
    phone: '06 12345678',
    phoneHref: 'tel:0612345678',
    addressLines: [],
  });
});

test('mailbox bewaart een expliciete telefoonwaarde met toestel veilig maar zonder kliklink', () => {
  const parsed = signature.parseIncoming([
    'Dank voor je bericht.',
    '',
    '--',
    'Klantenservice',
    'Telefoon: 020 123 45 67 toestel 89',
  ].join('\n'));
  const html = signature.renderContactCard(parsed.contact);

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.contact, {
    phone: '020 123 45 67 toestel 89',
    phoneHref: '',
    addressLines: [],
  });
  assert.match(html, /<dt>Telefoon:<\/dt><dd><span class="detail-mail-contact-value">020 123 45 67 toestel 89<\/span><\/dd>/);
  assert.doesNotMatch(html, /href=/);
});

test('mailbox schrijft een oude Martijn-footer na Anna haar quote nooit aan Anna toe', () => {
  const body = [
    'Dank voor je bericht.',
    '',
    'Groet,',
    'Anna',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    '> Dit is de geciteerde mail van Martijn.',
    '',
    '--',
    'Martijn van de Ven',
    'M 06 12345678',
  ].join('\n');
  const parsed = signature.parseIncoming(body, {
    from: 'Anna Jansen',
    email: 'anna@example.nl',
  });

  assert.deepEqual(parsed.contact, { phone: '', phoneHref: '', addressLines: [] });
  assert.match(parsed.bodyLines.join('\n'), /Martijn van de Ven\nM 06 12345678/);
});

test('mailbox pakt een -- tussen twee echte quote-segmenten nooit als huidige signature', () => {
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
  const parsed = signature.parseIncoming(body, {
    from: 'Anna Jansen',
    email: 'anna@example.nl',
  });

  assert.equal(parsed.matched, false);
  assert.deepEqual(parsed.contact, { phone: '', phoneHref: '', addressLines: [] });
  assert.deepEqual(parsed.bodyLines, body.split('\n'));
});

test('mailbox negeert alleen een aaneengesloten footer-From en nooit een gescheiden tweede sender-headerquote', () => {
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
    'From: anna@example.nl',
    '> Tweede echte quote onder een sender-header.',
  ].join('\n');
  const parsed = signature.parseIncoming(body, {
    from: 'Anna Jansen',
    email: 'anna@example.nl',
  });

  assert.equal(parsed.matched, false);
  assert.deepEqual(parsed.contact, { phone: '', phoneHref: '', addressLines: [] });
  assert.deepEqual(parsed.bodyLines, body.split('\n'));
});

test('mailbox laat pipe- en postcodeachtige inhoud zonder bewezen signaturemarker volledig intact', () => {
  const body = [
    'De notitie gebruikt gewone pipe-tekst: concept | definitief.',
    'Haarensteijnstraat 23 | 5076 CM Haaren',
    'M 06 33688506 hoort in deze inhoudelijke opsomming.',
  ].join('\n');
  const parsed = signature.parseIncoming(body);

  assert.equal(parsed.matched, false);
  assert.deepEqual(parsed.bodyLines, body.split('\n'));
  assert.deepEqual(parsed.contact, { phone: '', phoneHref: '', addressLines: [] });
});

test('mailbox herkent CRLF en non-breaking spaces in een gecombineerde handtekening', () => {
  const parsed = signature.parseIncoming([
    'Dank voor je bericht.',
    '',
    'Best\u00a0regards / Met\u00a0vriendelijke\u00a0groet,',
    'Naam',
    'Telefoon:\u00a006 12 34 56 78',
    'Adres:',
    'Dorpsstraat 4',
    'Postal code: 1234 AB',
    'Plaats: Utrecht',
    'Land: Nederland',
  ].join('\r\n'));

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.bodyLines, ['Dank voor je bericht.']);
  assert.equal(parsed.contact.phoneHref, 'tel:0612345678');
  assert.deepEqual(parsed.contact.addressLines, ['Dorpsstraat 4', '1234 AB Utrecht', 'Nederland']);
});

test('mailbox verwijdert een muzikale standaardhandtekening en bewaart uitsluitend het telefoonnummer', () => {
  const authoredLines = [
    'Hallo Serve,',
    '',
    'Thanks voor je mailtje. Het idee ziet er leuk uit, stuur de online preview maar, ben wel benieuwd.',
    'Wat zouden alle voordelen zijn tov mijn huidige website?',
    '',
    'De huidige website heb ik nooit helemaal afgemaakt. Wel vind ik het belangrijk dat ik zelf alles kan aanpassen,',
    'onderhouden en de SEO kan regelen zoals nu in Wordpress.',
  ];
  const standardSignature = [
    '',
    'Muzikale groet,',
    '',
    'Niels van Kollenburg',
    '',
    'T. 06 - 29 03 73 59',
    'E. info@nielsvankollenburg.nl',
    'W. nielsvankollenburg.nl',
    '',
    'Klik hier voor meer info',
  ];
  const parsed = signature.parseIncoming([...authoredLines, ...standardSignature].join('\n'));

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.bodyLines, authoredLines);
  assert.deepEqual(parsed.contact, {
    phone: '06 - 29 03 73 59',
    phoneHref: 'tel:0629037359',
    addressLines: [],
  });

  const html = signature.renderContactCard(parsed.contact);
  assert.equal((html.match(/class="detail-mail-contact-item"/g) || []).length, 1);
  assert.match(html, /<dt>Telefoon:<\/dt>/);
  assert.match(html, /href="tel:0629037359">06 - 29 03 73 59<\/a>/);
  assert.doesNotMatch(html, /Adres:|Niels van Kollenburg|info@nielsvankollenburg\.nl|nielsvankollenburg\.nl|Klik hier/i);
});

test('mailbox herkent ook Muzikale groeten als zelfstandige signoff zonder zinnen fout te markeren', () => {
  const plural = signature.parseIncoming([
    'Dank voor je bericht.',
    '',
    'Muzikale groeten!',
    'Naam',
    'T 06 12 34 56 78',
    'E. naam@example.nl',
  ].join('\n'));
  const naturalSentence = signature.parseIncoming('Muzikale groeten zijn een leuke afsluiting.\nDit is inhoudelijke tekst.');

  assert.equal(plural.matched, true);
  assert.deepEqual(plural.bodyLines, ['Dank voor je bericht.']);
  assert.equal(plural.contact.phone, '06 12 34 56 78');
  assert.equal(naturalSentence.matched, false);
  assert.deepEqual(naturalSentence.bodyLines, [
    'Muzikale groeten zijn een leuke afsluiting.',
    'Dit is inhoudelijke tekst.',
  ]);
});

test('contactkaart escaped HTML en maakt van een onveilige telefoonwaarde geen link', () => {
  const html = signature.renderContactCard({
    phone: '0612345<img src=x onerror=alert(1)>',
    phoneHref: 'javascript:alert(1)',
    addressLines: ['<script>alert("adres")</script>', 'Test & Dorp'],
  }, String);

  assert.doesNotMatch(html, /<script|<img|onerror=|javascript:/i);
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /0612345&lt;img src&#61;x onerror&#61;alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;adres&quot;\)&lt;\/script&gt;/);
  assert.match(html, /Test &amp; Dorp/);
});

test('mailbox rendert een telefoon-only signature zonder lege adresrij', () => {
  const parsed = signature.parseIncoming('Prima.\n\n--\nBedrijf\nMobiel: 06-12345678');
  const html = signature.renderContactCard(parsed.contact);

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.bodyLines, ['Prima.']);
  assert.equal(parsed.contact.phoneHref, 'tel:0612345678');
  assert.match(html, /class="detail-mail-contact-item"/);
  assert.match(html, />Telefoon:<\/dt>/);
  assert.doesNotMatch(html, />Adres:<\/dt>/);
  assert.doesNotMatch(html, /detail-mail-contact-title|>\s*Contactgegevens\s*</i);
});

test('mailbox rendert een adres-only signature zonder lege telefoonrij', () => {
  const parsed = signature.parseIncoming([
    'Prima.',
    '',
    'Hartelijke groeten,',
    'Naam',
    'Straat: Markt 8',
    'ZIP:',
    '5211 AA',
    'Stad:',
    'Den Bosch',
    'Country: Nederland',
  ].join('\n'));
  const html = signature.renderContactCard(parsed.contact);

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.contact.addressLines, ['Markt 8', '5211 AA Den Bosch', 'Nederland']);
  assert.match(html, /class="detail-mail-contact-item"/);
  assert.match(html, />Adres:<\/dt>/);
  assert.match(html, /Markt 8, 5211 AA Den Bosch, Nederland/);
  assert.doesNotMatch(html, />Telefoon:<\/dt>/);
  assert.doesNotMatch(html, /detail-mail-contact-title|>\s*Contactgegevens\s*<|<br>/i);
});

test('mailbox ondersteunt alle afgesproken telefoonlabels', () => {
  for (const label of ['Phone', 'Tel', 'Telefoon', 'Mobiel', 'Mobile', 'T', 'M']) {
    const parsed = signature.parseIncoming(`Antwoord.\n\nMet vriendelijke groet,\nNaam\n${label}: 0612345678`);
    assert.equal(parsed.matched, true, label);
    assert.equal(parsed.contact.phone, '0612345678', label);
    assert.equal(parsed.contact.phoneHref, 'tel:0612345678', label);
  }
  const compact = signature.parseIncoming('Antwoord.\n\n--\nNaam\nT 073 123 45 67');
  assert.equal(compact.contact.phone, '073 123 45 67');
  assert.equal(compact.contact.phoneHref, 'tel:0731234567');
});

test('mailbox ondersteunt alle afgesproken adreslabels inline en op de volgende regel', () => {
  const variants = [
    ['Street', 'Postcode', 'City', 'Country'],
    ['Straat', 'ZIP', 'Plaats', 'Land'],
    ['Address', 'Postal code', 'Stad', 'Country'],
    ['Adres', 'ZIP code', 'City', 'Land'],
  ];
  for (const [street, postcode, city, country] of variants) {
    const parsed = signature.parseIncoming([
      'Antwoord.',
      '',
      'Kind regards,',
      'Naam',
      `${street}:`,
      'Lindelaan 3',
      `${postcode}: 1000 AA`,
      `${city}:`,
      'Amsterdam',
      `${country}: Nederland`,
    ].join('\n'));
    assert.equal(parsed.matched, true, street);
    assert.deepEqual(parsed.contact.addressLines, ['Lindelaan 3', '1000 AA Amsterdam', 'Nederland'], street);
    const html = signature.renderContactCard(parsed.contact);
    assert.match(html, /Lindelaan 3, 1000 AA Amsterdam, Nederland/, street);
    assert.doesNotMatch(html, /detail-mail-contact-title|>\s*Contactgegevens\s*<|<br>/i, street);
  }
});

test('contactkaart maakt alleen voor telefoons met 7 tot en met 15 cijfers een tel-link', () => {
  const seven = signature.renderContactCard({ phone: '1234567', addressLines: [] });
  const fifteen = signature.renderContactCard({ phone: '+12 345 678 901 234 5', addressLines: [] });
  const six = signature.renderContactCard({ phone: '123456', addressLines: [] });
  const sixteen = signature.renderContactCard({ phone: '1234567890123456', addressLines: [] });

  assert.match(seven, /href="tel:1234567"/);
  assert.match(fifteen, /href="tel:\+123456789012345"/);
  assert.doesNotMatch(six, /href=/);
  assert.doesNotMatch(sixteen, /href=/);
});
