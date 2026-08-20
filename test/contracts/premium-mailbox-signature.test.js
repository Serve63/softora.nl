const test = require('node:test');
const assert = require('node:assert/strict');

const signature = require('../../assets/premium-mailbox-signature.js');

test('mailbox verwijdert het exacte JT-signatureblok en bewaart uitsluitend telefoon en adres', () => {
  const parsed = signature.parseIncoming([
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
  ].join('\n'));

  assert.equal(parsed.matched, true);
  assert.deepEqual(parsed.bodyLines, ['Ziet er zeker gaaf uit!']);
  assert.deepEqual(parsed.contact, {
    phone: '+31 97010269099',
    phoneHref: 'tel:+3197010269099',
    addressLines: ['Nieuwe Baan 1', '5076 SV Haaren', 'Nederland'],
  });

  const html = signature.renderContactCard(parsed.contact);
  assert.match(html, /class="detail-mail-contact-card"/);
  assert.match(html, /href="tel:\+3197010269099"/);
  assert.match(html, /Nieuwe Baan 1<br>5076 SV Haaren<br>Nederland/);
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
  assert.match(html, />Telefoon</);
  assert.doesNotMatch(html, />Adres</);
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
  assert.match(html, />Adres</);
  assert.doesNotMatch(html, />Telefoon</);
});

test('mailbox ondersteunt alle afgesproken telefoonlabels', () => {
  for (const label of ['Phone', 'Tel', 'Telefoon', 'Mobiel', 'Mobile', 'T']) {
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
