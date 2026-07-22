const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMailboxMessageImageUrl,
  decodeMailboxMessageImage,
  isMailboxMessageImageUrl,
} = require('../../server/services/mailbox-message-image');

test('mailbox image URL is compact, stable and bound to the original message', () => {
  const url = buildMailboxMessageImageUrl({
    id: 'inbox:42',
    folder: 'inbox',
    accountEmail: 'SERVE@SOFTORA.NL',
  }, 1);

  assert.equal(
    url,
    '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3A42&index=1'
  );
  assert.equal(isMailboxMessageImageUrl(url), true);
  assert.equal(isMailboxMessageImageUrl('javascript:alert(1)'), false);
});

test('mailbox image decoder only accepts complete supported image data', () => {
  const decoded = decodeMailboxMessageImage({
    alt: 'Webdesign',
    dataUrl: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
  });

  assert.equal(decoded.alt, 'Webdesign');
  assert.equal(decoded.contentType, 'image/png');
  assert.equal(decoded.content.toString(), 'image-bytes');
  assert.equal(decodeMailboxMessageImage({ dataUrl: 'https://example.test/image.png' }), null);
  assert.equal(decodeMailboxMessageImage({ dataUrl: 'data:text/html;base64,SGk=' }), null);
});
