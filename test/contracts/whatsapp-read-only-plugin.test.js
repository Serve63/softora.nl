const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '../..');
const pluginRoot = path.join(root, 'codex-plugins/whatsapp-read-only');

function requestMcp(messages, env = {}, waitMs = 150) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'mcp/server.mjs')], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0 && signal !== 'SIGTERM') return reject(new Error(`MCP exit ${code}: ${stderr}`));
      resolve(stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    });
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join('\n') + '\n');
    setTimeout(() => child.kill('SIGTERM'), waitMs);
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
  const tools = responses.find((response) => response.id === 2).result.tools;
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
    }, 300);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].authorization, `Bearer ${token}`);
    assert.match(requests[0].url, /^\/api\/whatsapp\/messages\?/);
    assert.match(requests[0].url, /contact=Test\+Persoon/);
    assert.equal(responses[0].result.structuredContent.count, 1);
    assert.doesNotMatch(JSON.stringify(responses), new RegExp(token));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
