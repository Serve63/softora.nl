const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '../..');
const pluginRoot = path.join(root, 'codex-plugins/whatsapp-read-only');

function requestMcp(messages, env = {}, waitMs = 1500) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'mcp/server.mjs')], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const expectedIds = new Set(messages.map((message) => message.id).filter((id) => id != null));
    const responses = [];
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    function parseStdoutChunk(chunk = '') {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      lines.filter(Boolean).forEach((line) => responses.push(JSON.parse(line)));
    }

    function hasExpectedResponses() {
      if (expectedIds.size === 0) return responses.length > 0;
      return Array.from(expectedIds).every((id) => responses.some((response) => response.id === id));
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve(responses);
    }

    child.stdout.on('data', (chunk) => {
      parseStdoutChunk(String(chunk || ''));
      if (hasExpectedResponses()) finish();
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (stdoutBuffer.trim()) parseStdoutChunk('\n');
      if (code !== 0 && signal !== 'SIGTERM') return reject(new Error(`MCP exit ${code}: ${stderr}`));
      settled = true;
      clearTimeout(timer);
      resolve(responses);
    });
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join('\n') + '\n');
    timer = setTimeout(finish, waitMs);
  });
}

test('WhatsApp plugin manifest and skill stay strictly read-only', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
  const mcpConfig = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.mcp.json'), 'utf8'));
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills/read-whatsapp/SKILL.md'), 'utf8');
  assert.equal(manifest.name, 'whatsapp-read-only');
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.deepEqual(mcpConfig.mcpServers['whatsapp-read-only'].env_vars, [
    'SOFTORA_WHATSAPP_READ_TOKEN',
    'SOFTORA_WHATSAPP_BASE_URL',
  ]);
  assert.match(skill, /lees mijn WhatsApp/i);

  const responses = await requestMcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]);
  const toolsResponse = responses.find((response) => response.id === 2);
  assert.ok(toolsResponse?.result, 'tools/list response ontbreekt');
  const tools = toolsResponse.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), ['whatsapp_status', 'read_whatsapp']);
  for (const tool of tools) {
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }
  assert.doesNotMatch(tools.map((tool) => tool.name).join(' '), /send|reply|delete|write/i);
});

test('WhatsApp MCP tool performs only authenticated GET and does not echo its token', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      count: 1,
      messages: [{ contactName: 'Test', direction: 'inbound', content: { type: 'text', detail: { body: 'Hallo' } } }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const token = 'local-mcp-read-token';
    const responses = await requestMcp([{
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'read_whatsapp', arguments: { contact: 'Test Persoon', query: 'Hallo', limit: 20 } },
    }], {
      SOFTORA_WHATSAPP_READ_TOKEN: token,
      SOFTORA_WHATSAPP_BASE_URL: `http://127.0.0.1:${address.port}`,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].authorization, `Bearer ${token}`);
    assert.match(requests[0].url, /^\/api\/whatsapp\/messages\?/);
    assert.match(requests[0].url, /contact=Test\+Persoon/);
    assert.ok(responses[0]?.result, 'tools/call response ontbreekt');
    assert.equal(responses[0].result.structuredContent.count, 1);
    assert.doesNotMatch(JSON.stringify(responses), new RegExp(token));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
