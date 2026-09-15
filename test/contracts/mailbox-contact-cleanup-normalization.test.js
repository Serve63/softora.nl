const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSignatureContact: clean } = require('../../assets/premium-mailbox-message-presentation');
const text = (contact) => [...contact.beforeLines, contact.phone, ...contact.addressLines, ...contact.preservedLines].join('\n');

const disclaimer = [
  'De informatie verzonden met dit e-mailbericht (en bijlagen) is uitsluitend',
  'bestemd voor de geadresseerde(n) en zij die van de geadresseerde(n)',
  'toestemming kregen dit bericht te lezen. Kennisneming door anderen is niet',
  'toegestaan. De informatie in dit e-mailbericht (en bijlagen) kan',
  'vertrouwelijk van aard zijn en binnen het bereik van een',
  'geheimhoudingsplicht vallen. Indien dit e-mailbericht niet voor u bestemd',
  'is, wordt u verzocht de afzender daarover onmiddellijk te informeren en het',
  'e-mailbericht (en bijlagen) te vernietigen.',
];

test('wrapped legal footer removed while both phones and the address after it survive', () => {
  const source = { beforeLines: ['Marijn Voorbeeld', 'Voorbeeld - Wandmontage V.O.F.',
    'Voorbeeld - Afbouw en projecten', 'Moderne afbouw. Strak uitgevoerd.', ...disclaimer,
    'T* 0411-123456 | *M* 06-12345678 | *E* marijn@example.nl',
    'Dorpsstraat 13', '5268 EP Voorbeeld', 'KVK nr. 123.45.678', 'BTW nr. NL1234.56.789 B01'], addressLines: [] };
  const snapshot = JSON.stringify(source);
  const result = clean(source);
  assert.equal(result.phone, '0411-123456');
  assert.deepEqual(result.preservedLines, ['Mobiel: 06-12345678']);
  assert.deepEqual(result.addressLines, ['Dorpsstraat 13', '5268 EP Voorbeeld']);
  for (const expected of ['Marijn Voorbeeld', 'marijn@example.nl', 'Voorbeeld']) assert.ok(result.beforeLines.includes(expected));
  assert.doesNotMatch(text(result), /geadresseerde|vertrouwelijk|vernietigen|KVK|BTW|Strak uitgevoerd|Wandmontage|Afbouw/);
  assert.equal(JSON.stringify(source), snapshot);
});

test('sender names and streets are not mistaken for one-letter contact labels', () => {
  const result = clean({ beforeLines: ['Marijn Voorbeeld', 'Thomas Voorbeeld', 'Fleur Voorbeeld', 'Walerijstraat 210', '5617 AR Voorbeeld (Wijk)'], addressLines: [] });
  for (const name of ['Marijn Voorbeeld', 'Thomas Voorbeeld', 'Fleur Voorbeeld']) assert.ok(result.beforeLines.includes(name));
  assert.deepEqual(result.addressLines, ['Walerijstraat 210', '5617 AR Voorbeeld (Wijk)']);
  assert.doesNotMatch(text(result), /M: arijn|T: homas|F: leur|W: alerij/);
});

test('duplicate Outlook annotations reduce to one link, without changing its destination', () => {
  for (const line of ['example.nl<http://www.example.nl>', 'example.nl<[http://www.example.nl](http://www.example.nl)>', '<[http://www.example.nl](http://www.example.nl)>']) {
    const result = clean({ beforeLines: [line, 'www.example.nl', 'info@example.nl<mailto:info@example.nl>', 'E: info@example.nl'], addressLines: [] });
    assert.equal(result.beforeLines.length, 2);
    assert.equal(result.beforeLines[1], 'info@example.nl');
    assert.doesNotMatch(text(result), /<http|<\[|mailto:/);
  }
  for (const line of ['example.nl<https://different.example>', 'example.nl<Path>', '[click](javascript:alert(1))', 'example.nl<https://user:secret@example.nl>', 'info@example.nl<mailto:other@example.nl>']) {
    assert.ok(text(clean({ beforeLines: [line], addressLines: [] })).includes(line));
  }
});

test('equivalent phones deduplicate but distinct phones, extensions and addresses remain', () => {
  const result = clean({ phone: '06-12345678', addressLines: ['Dorpsstraat 12-1', '1234 AB Voorbeeld', 'Dorpsstraat 121'],
    beforeLines: ['Robin Voorbeeld', 'Robin Voorbeeld'], preservedLines: ['Mobiel: +31 (0)6 12345678', 'Tel: 0031 6 12345678',
      'Tel: 020 1234567', 'Tel: 020 1234567 toestel 9', 'Dorpsstraat 12-1', '1234AB Voorbeeld'] });
  assert.equal(result.beforeLines.filter((line) => line === 'Robin Voorbeeld').length, 1);
  assert.equal(result.phone, '06-12345678');
  assert.deepEqual(result.preservedLines, ['Tel: 020 1234567']);
  assert.ok(result.beforeLines.includes('Tel: 020 1234567 toestel 9'));
  assert.deepEqual(result.addressLines, ['Dorpsstraat 12-1', '1234 AB Voorbeeld', 'Dorpsstraat 121']);
});

test('meaningful notes, multiple roles, unknown numbers and foreign addresses are never blanket-deleted', () => {
  const lines = ['Robin Voorbeeld - Account Manager', 'Robin Voorbeeld - Office Manager', 'Bereikbaar op maandag en woensdag',
    'Klantnummer 12345678', 'P.S. Stuur de offerte graag in het Engels.', '44 King Street', 'London SW1A 1AA',
    'Vandaag gesloten. Morgen geopend.', '[Besproken voorbeeld](https://instagram.com/p/example)', 'a < b > c'];
  const result = clean({ beforeLines: lines, addressLines: [] });
  for (const line of lines) assert.ok(text(result).includes(line), line);
});

test('English legal footer stops before a personal note and contacts', () => {
  const result = clean({ beforeLines: ['Robin Example', 'This email and its attachments are confidential and intended solely for the recipient.',
    'If you received this message in error, please notify the sender and delete this message.',
    'P.S. Please call tomorrow.', 'Phone: +44 20 1234 5678', '44 King Street', 'London SW1A 1AA'], addressLines: [] });
  assert.doesNotMatch(text(result), /confidential|recipient|delete this message/);
  assert.ok(text(result).includes('P.S. Please call tomorrow.'));
  assert.ok(text(result).includes('+44 20 1234 5678'));
  assert.ok(text(result).includes('44 King Street'));
});

test('repeated normalization is stable and does not mutate the original contact', () => {
  const input = { beforeLines: ['Robin Voorbeeld', 'E: info@example.nl'], phone: '06-12345678',
    addressLines: ['Dorpsstraat 13', '1234 AB Voorbeeld'], preservedLines: ['Mobiel: +31 (0)6 12345678', 'Tel: 020 1234567'] };
  const first = clean(input);
  assert.deepEqual(clean(first), first);
});
