const test = require('node:test');
const assert = require('node:assert/strict');

function createHarness(t) {
  const created = [];
  const revoked = [];
  const list = { innerHTML: '' };
  const originalUrl = global.URL;
  const originalCompose = global.SoftoraMailboxCompose;
  global.URL = {
      createObjectURL(blob) {
        const url = `blob:https://www.softora.nl/attachment-${created.length}`;
        created.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) { revoked.push(url); },
  };
  const modulePath = require.resolve('../../assets/premium-mailbox-compose.js');
  delete require.cache[modulePath];
  const compose = require('../../assets/premium-mailbox-compose.js');
  t.after(() => {
    compose.resetOptionalFields();
    global.URL = originalUrl;
    if (originalCompose === undefined) delete global.SoftoraMailboxCompose;
    else global.SoftoraMailboxCompose = originalCompose;
    delete require.cache[modulePath];
  });
  return {
    compose,
    document: { getElementById: (id) => id === 'c-attachment-list' ? list : null },
    list, created, revoked,
  };
}

function file(name, text, type = '') {
  const blob = new Blob([text], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

test('compose opens the exact chosen image/PDF locally and keeps previews separate from send data', async (t) => {
  const h = createHarness(t);
  const first = file('ontwerp.png', 'first image', 'image/png');
  const second = file('ontwerp.png', 'second image', 'image/png');
  const pdf = file('voorstel.pdf', '%PDF-1.7 proposal');
  assert.equal((await h.compose.addAttachments([first, second, pdf], h.document)).ok, true);

  assert.equal(h.created.length, 3);
  assert.equal(await h.created[0].blob.text(), 'first image');
  assert.equal(await h.created[1].blob.text(), 'second image');
  assert.equal(await h.created[2].blob.text(), '%PDF-1.7 proposal');
  assert.equal(h.created[2].blob.type, 'application/pdf');
  assert.equal((h.list.innerHTML.match(/class="compose-attachment-open"/g) || []).length, 3);
  assert.match(h.list.innerHTML, /href="blob:https:\/\/www\.softora\.nl\/attachment-0" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(h.list.innerHTML, / download=/);
  assert.equal(h.compose.getAttachments()[0].file, first);
  assert.deepEqual(Object.keys(h.compose.getAttachments()[0]).sort(), ['contentType', 'file', 'filename', 'size']);

  // Removing one of two identically named files cannot invalidate the other preview.
  h.compose.removeAttachment(0, h.document);
  assert.deepEqual(h.revoked, [h.created[0].url]);
  assert.equal(h.created.length, 3);
  assert.match(h.list.innerHTML, /href="blob:https:\/\/www\.softora\.nl\/attachment-1"/);
  assert.doesNotMatch(h.list.innerHTML, /attachment-0/);
  assert.equal(h.compose.getAttachments()[0].file, second);

  h.compose.resetOptionalFields(h.document);
  assert.deepEqual(h.revoked, h.created.map(({ url }) => url));
  assert.equal(h.list.innerHTML, '');
  assert.equal(h.compose.getAttachments().length, 0);
});

test('compose previews ignore active file MIME types and download unsupported document formats safely', async (t) => {
  const h = createHarness(t);
  await h.compose.addAttachments([
    file('foto.png', '<script>unsafe</script>', 'text/html'),
    file('offerte" & plan.docx', 'office document', 'text/html'),
  ], h.document);
  assert.equal(h.created[0].blob.type, 'image/png');
  assert.equal(h.created[1].blob.type, 'application/octet-stream');
  assert.match(h.list.innerHTML, /download="offerte&quot; &amp; plan\.docx"/);
  assert.match(h.list.innerHTML, /title="Open offerte&quot; &amp; plan\.docx"/);
  assert.equal(h.list.innerHTML.includes('<script>'), false);
  h.compose.resetOptionalFields(h.document);

  assert.equal((await h.compose.addAttachments([file('unsafe.html', 'html')], h.document)).ok, false);
  assert.equal(h.created.length, 2);
  assert.equal(h.compose.getAttachments().length, 0);
});
