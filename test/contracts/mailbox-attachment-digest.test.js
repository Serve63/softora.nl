const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const digest = require('../../assets/premium-mailbox-attachment-digest');

function createFile(name, type, sequences, overrides = {}) {
  const buffers = sequences.map((value) => Uint8Array.from(value));
  let reads = 0;
  return {
    name,
    type,
    size: buffers[0].byteLength,
    get reads() { return reads; },
    async arrayBuffer() {
      const value = buffers[Math.min(reads, buffers.length - 1)];
      reads += 1;
      return value.slice().buffer;
    },
    ...overrides,
  };
}

function selection(file, overrides = {}) {
  return {
    filename: file.name,
    contentType: file.type,
    size: file.size,
    file,
    ...overrides,
  };
}

test('gelijke bestandsmetadata met andere bytes krijgt altijd een ander SHA-256 bewijs', async () => {
  const first = createFile('bewijs.pdf', 'application/pdf', [[1, 2, 3, 4]]);
  const second = createFile('bewijs.pdf', 'application/pdf', [[4, 3, 2, 1]]);

  const firstBound = await digest.bind([selection(first)], { crypto: webcrypto });
  const secondBound = await digest.bind([selection(second)], { crypto: webcrypto });

  assert.match(firstBound.metadata[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(secondBound.metadata[0].sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(firstBound.metadata[0].sha256, secondBound.metadata[0].sha256);
  assert.notDeepEqual(firstBound.metadata, secondBound.metadata);
});

test('lege MIME, aliases, parameters, hoofdletters en alle Office-extensies worden canoniek gebonden', async (t) => {
  const cases = [
    ['rapport.PDF', '', '', 'application/pdf'],
    ['foto.JPEG', 'image/pjpeg', 'IMAGE/JPEG; charset=binary', 'image/jpeg'],
    ['notitie.txt', 'text/plain; charset=utf-8', 'text/plain; charset=us-ascii', 'text/plain'],
    ['tabel.CSV', 'application/csv', '', 'text/csv'],
    ['oud.doc', '', 'application/octet-stream', 'application/msword'],
    ['nieuw.DOCX', '', '', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['slides.ppt', '', '', 'application/vnd.ms-powerpoint'],
    ['slides.PPTX', '', '', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['cijfers.xls', '', '', 'application/vnd.ms-excel'],
    ['cijfers.XLSX', '', '', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ];
  for (const [name, fileType, selectedType, expected] of cases) {
    await t.test(name, async () => {
      const file = createFile(name, fileType, [[7]]);
      const bound = await digest.bind([selection(file, { contentType: selectedType })], { crypto: webcrypto });
      assert.equal(bound.metadata[0].contentType, expected);
      assert.equal(bound.attachments[0].contentType, expected);
    });
  }
});

test('bestandsnamen worden NFKC-genormaliseerd en op exact 120 codepoints begrensd met extensie', () => {
  assert.equal(digest.safeFilename('  Ｆｏｔｏ ①.PDF  '), 'Foto 1.PDF');
  const safe = digest.safeFilename(`${'😀'.repeat(130)}.pdf`);
  assert.equal(Array.from(safe).length, 120);
  assert.match(safe, /\.pdf$/);
  assert.doesNotMatch(digest.safeFilename('../map\\nul\u0000.pdf'), /[\/\\\u0000]/);
});

test('ontbrekend SHA-bewijs wordt berekend; uppercase, ongeldig en gemanipuleerd bewijs faalt gesloten', async () => {
  const bytes = [9, 8, 7, 6];
  const initialFile = createFile('bewijs.pdf', 'application/pdf', [bytes]);
  const initial = await digest.bind([selection(initialFile)], { crypto: webcrypto });
  const sha256 = initial.metadata[0].sha256;

  const exactFile = createFile('bewijs.pdf', 'application/pdf', [bytes]);
  const exact = await digest.bind([selection(exactFile, { sha256 })], { crypto: webcrypto });
  assert.equal(exact.metadata[0].sha256, sha256);

  for (const supplied of ['', 'A'.repeat(64), 'g'.repeat(64), 'abcd']) {
    const file = createFile('bewijs.pdf', 'application/pdf', [bytes]);
    await assert.rejects(
      digest.bind([selection(file, { sha256: supplied })], { crypto: webcrypto }),
      (error) => error.code === 'MAILBOX_ATTACHMENT_SHA256_INVALID'
    );
  }

  const manipulatedFile = createFile('bewijs.pdf', 'application/pdf', [bytes]);
  await assert.rejects(
    digest.bind([selection(manipulatedFile, { sha256: '0'.repeat(64) })], { crypto: webcrypto }),
    (error) => error.code === 'MAILBOX_ATTACHMENT_DIGEST_MISMATCH'
  );
});

test('leesfouten, verkeerde bytevorm en verkeerde grootte stoppen vóór hashing', async (t) => {
  const variants = [
    ['read error', Object.assign(createFile('bewijs.pdf', 'application/pdf', [[1, 2]]), {
      async arrayBuffer() { throw new Error('bestand verdwenen'); },
    }), 'MAILBOX_ATTACHMENT_READ_FAILED'],
    ['typed array', Object.assign(createFile('bewijs.pdf', 'application/pdf', [[1, 2]]), {
      async arrayBuffer() { return Uint8Array.from([1, 2]); },
    }), 'MAILBOX_ATTACHMENT_FILE_BYTES_MISMATCH'],
    ['wrong length', Object.assign(createFile('bewijs.pdf', 'application/pdf', [[1, 2]]), {
      async arrayBuffer() { return Uint8Array.from([1]).buffer; },
    }), 'MAILBOX_ATTACHMENT_FILE_BYTES_MISMATCH'],
  ];
  for (const [label, file, code] of variants) {
    await t.test(label, async () => {
      await assert.rejects(
        digest.bind([selection(file)], { crypto: webcrypto }),
        (error) => error.code === code
      );
    });
  }
});

test('een echte cross-realm ArrayBuffer blijft geldig en wordt exact gehasht', async () => {
  const bytes = vm.runInNewContext('Uint8Array.from([1, 2, 3, 4]).buffer');
  const file = {
    name: 'cross.pdf', type: 'application/pdf', size: 4,
    async arrayBuffer() { return bytes; },
  };
  const bound = await digest.bind([selection(file)], { crypto: webcrypto });
  assert.match(bound.metadata[0].sha256, /^[0-9a-f]{64}$/);
});

test('ontbrekende, falende en ongeldige WebCrypto-digests worden genormaliseerd en nooit geaccepteerd', async (t) => {
  const variants = [
    ['missing', {}, 'MAILBOX_ATTACHMENT_DIGEST_UNAVAILABLE'],
    ['throws', { subtle: { async digest() { throw new Error('crypto failure'); } } }, 'MAILBOX_ATTACHMENT_DIGEST_FAILED'],
    ['short', { subtle: { async digest() { return new ArrayBuffer(31); } } }, 'MAILBOX_ATTACHMENT_DIGEST_INVALID'],
    ['typed array', { subtle: { async digest() { return new Uint8Array(32); } } }, 'MAILBOX_ATTACHMENT_DIGEST_INVALID'],
  ];
  for (const [label, crypto, code] of variants) {
    await t.test(label, async () => {
      const file = createFile('bewijs.pdf', 'application/pdf', [[1, 2, 3, 4]]);
      await assert.rejects(
        digest.bind([selection(file)], { crypto }),
        (error) => error.code === code && error.retryable === false
      );
    });
  }
});

test('unsupported extensies, ontbrekende File en metadatawijziging bij verify falen gesloten', async () => {
  const unsupported = createFile('script.exe', 'application/pdf', [[1]]);
  await assert.rejects(
    digest.bind([selection(unsupported)], { crypto: webcrypto }),
    (error) => error.code === 'MAILBOX_ATTACHMENT_FILE_IDENTITY_MISMATCH'
  );
  await assert.rejects(
    digest.bind([{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 1 }], { crypto: webcrypto }),
    (error) => error.code === 'MAILBOX_ATTACHMENT_RESELECT_REQUIRED'
  );

  const file = createFile('bewijs.pdf', 'application/pdf', [[1, 2, 3]]);
  const bound = await digest.bind([selection(file)], { crypto: webcrypto });
  await assert.rejects(
    digest.verify([selection(file)], [{ ...bound.metadata[0], filename: 'ander.pdf' }], { crypto: webcrypto }),
    (error) => error.code === 'MAILBOX_ATTACHMENT_DIGEST_MISMATCH'
  );
});
