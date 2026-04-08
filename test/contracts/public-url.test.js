const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendQueryParamsToUrl,
  assertWebsitePreviewUrlIsPublic,
  getEffectivePublicBaseUrl,
  getPublicBaseUrlFromRequest,
  isPrivateIpAddress,
  normalizeAbsoluteHttpUrl,
  normalizeWebsitePreviewTargetUrl,
} = require('../../server/security/public-url');

function createRequest(headers = {}, secure = false) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  return {
    secure,
    get(name) {
      return normalizedHeaders[String(name || '').toLowerCase()] || '';
    },
  };
}

test('normalizeAbsoluteHttpUrl keeps only http(s), strips hash and trailing slash', () => {
  assert.equal(normalizeAbsoluteHttpUrl('https://Example.com/demo/#intro'), 'https://example.com/demo');
  assert.equal(normalizeAbsoluteHttpUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeAbsoluteHttpUrl('ftp://example.com/file.txt'), '');
});

test('normalizeWebsitePreviewTargetUrl adds https and rejects credentials', () => {
  assert.equal(normalizeWebsitePreviewTargetUrl('softora.nl'), 'https://softora.nl/');
  assert.equal(normalizeWebsitePreviewTargetUrl('https://user:pass@example.com/demo'), '');
  assert.equal(normalizeWebsitePreviewTargetUrl('mailto:test@example.com'), '');
});

test('appendQueryParamsToUrl only appends non-empty params', () => {
  assert.equal(
    appendQueryParamsToUrl('https://example.com/path', {
      stack: 'retell',
      empty: '',
      ignored: '   ',
    }),
    'https://example.com/path?stack=retell'
  );
});

test('getPublicBaseUrlFromRequest prefers forwarded headers', () => {
  const req = createRequest(
    {
      host: 'internal.local:3000',
      'x-forwarded-host': 'app.softora.nl',
      'x-forwarded-proto': 'https',
    },
    false
  );

  assert.equal(getPublicBaseUrlFromRequest(req), 'https://app.softora.nl');
});

test('getEffectivePublicBaseUrl prefers explicit config before request host', () => {
  const req = createRequest({ host: 'localhost:3000' }, false);
  assert.equal(
    getEffectivePublicBaseUrl(req, '', 'https://www.softora.nl'),
    'https://www.softora.nl'
  );
  assert.equal(
    getEffectivePublicBaseUrl(req, 'https://preview.softora.nl/', 'https://www.softora.nl'),
    'https://preview.softora.nl'
  );
});

test('isPrivateIpAddress detects common private and loopback ranges', () => {
  assert.equal(isPrivateIpAddress('127.0.0.1'), true);
  assert.equal(isPrivateIpAddress('192.168.1.10'), true);
  assert.equal(isPrivateIpAddress('::1'), true);
  assert.equal(isPrivateIpAddress('8.8.8.8'), false);
});

test('assertWebsitePreviewUrlIsPublic rejects localhost and private lookup targets', async () => {
  await assert.rejects(() => assertWebsitePreviewUrlIsPublic('http://localhost:3000'), {
    status: 400,
  });

  await assert.rejects(
    () =>
      assertWebsitePreviewUrlIsPublic('https://example.com', {
        lookup: async () => [{ address: '192.168.1.12' }],
      }),
    {
      status: 400,
    }
  );
});

test('assertWebsitePreviewUrlIsPublic accepts public urls and tolerates dns lookup errors', async () => {
  await assert.doesNotReject(() =>
    assertWebsitePreviewUrlIsPublic('https://example.com', {
      lookup: async () => [{ address: '93.184.216.34' }],
    })
  );

  const normalizedUrl = await assertWebsitePreviewUrlIsPublic('softora.nl', {
    lookup: async () => {
      throw new Error('temporary dns failure');
    },
  });
  assert.equal(normalizedUrl, 'https://softora.nl/');
});
