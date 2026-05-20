const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchBinaryWithTimeout,
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
} = require('../../server/services/runtime-fetch');

test('runtime fetch helpers parse json, text and binary payloads consistently', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (_url, options = {}) => {
    assert.ok(options.signal);
    return {
      text: async () => '{"ok":true}',
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    };
  };

  const jsonResult = await fetchJsonWithTimeout('https://softora.test/json', { method: 'GET' }, 50);
  assert.deepEqual(jsonResult.data, { ok: true });

  const textResult = await fetchTextWithTimeout('https://softora.test/text', { method: 'GET' }, 50);
  assert.equal(textResult.text, '{"ok":true}');

  const binaryResult = await fetchBinaryWithTimeout('https://softora.test/file', { method: 'GET' }, 50);
  assert.deepEqual(Array.from(binaryResult.bytes), [1, 2, 3]);
});

test('runtime fetch helpers preserve non-json response bodies as raw text', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => ({
    text: async () => 'plain-text-response',
  });

  const result = await fetchJsonWithTimeout('https://softora.test/raw', { method: 'GET' }, 50);
  assert.deepEqual(result.data, { raw: 'plain-text-response' });
});

test('runtime fetch helpers add OpenAI organization and project context headers', async (t) => {
  const originalFetch = global.fetch;
  const originalOrganizationId = process.env.OPENAI_ORGANIZATION_ID;
  const originalProjectId = process.env.OPENAI_PROJECT_ID;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalOrganizationId === undefined) delete process.env.OPENAI_ORGANIZATION_ID;
    else process.env.OPENAI_ORGANIZATION_ID = originalOrganizationId;
    if (originalProjectId === undefined) delete process.env.OPENAI_PROJECT_ID;
    else process.env.OPENAI_PROJECT_ID = originalProjectId;
  });

  process.env.OPENAI_ORGANIZATION_ID = 'org_softora';
  process.env.OPENAI_PROJECT_ID = 'proj_softora';

  let capturedHeaders = null;
  global.fetch = async (_url, options = {}) => {
    capturedHeaders = options.headers;
    return {
      text: async () => '{"ok":true}',
    };
  };

  await fetchJsonWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-test',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    50
  );

  assert.equal(capturedHeaders['OpenAI-Organization'], 'org_softora');
  assert.equal(capturedHeaders['OpenAI-Project'], 'proj_softora');
  assert.equal(capturedHeaders.Authorization, 'Bearer sk-test');
});

test('runtime fetch helpers leave existing OpenAI context headers untouched', async (t) => {
  const originalFetch = global.fetch;
  const originalOrganizationId = process.env.OPENAI_ORGANIZATION_ID;
  const originalProjectId = process.env.OPENAI_PROJECT_ID;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalOrganizationId === undefined) delete process.env.OPENAI_ORGANIZATION_ID;
    else process.env.OPENAI_ORGANIZATION_ID = originalOrganizationId;
    if (originalProjectId === undefined) delete process.env.OPENAI_PROJECT_ID;
    else process.env.OPENAI_PROJECT_ID = originalProjectId;
  });

  process.env.OPENAI_ORGANIZATION_ID = 'org_softora';
  process.env.OPENAI_PROJECT_ID = 'proj_softora';

  let capturedHeaders = null;
  global.fetch = async (_url, options = {}) => {
    capturedHeaders = options.headers;
    return {
      text: async () => '{"ok":true}',
    };
  };

  await fetchJsonWithTimeout(
    'https://api.openai.com/v1/organization/costs',
    {
      method: 'GET',
      headers: {
        Authorization: 'Bearer sk-admin',
        'OpenAI-Project': 'proj_existing',
      },
    },
    50
  );

  assert.equal(capturedHeaders['OpenAI-Organization'], 'org_softora');
  assert.equal(capturedHeaders['OpenAI-Project'], 'proj_existing');
});
