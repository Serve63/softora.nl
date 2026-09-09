const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createAgendaMcpOAuth, validRedirect, BASE, PREFIX, RESOURCE } = require('../../server/security/agenda-mcp-oauth');
const { registerAgendaMcpRoutes } = require('../../server/routes/agenda-mcp');
const { createAgendaMcpTools } = require('../../server/services/agenda-mcp-tools');
function memoryRepo() {
  const rows = new Map();
  return {
    async put(id, kind, value, ttl) { if (rows.has(id)) return false; rows.set(id, { kind, value, exp: Date.now() + ttl * 1000 }); return true; },
    async get(id, kind, consume) { const r = rows.get(id); if (!r || r.kind !== kind || r.exp <= Date.now()) return null; if (consume) rows.delete(id); return r.value; },
    async finish(id, value) { rows.get(id).value = value; },
    async revoke(grantId) { for (const [id, r] of rows) if (r.value.grantId === grantId) rows.delete(id); },
  };
}
test('agenda OAuth accepts only exact OpenAI and loopback callback shapes', () => {
  for (const u of ['https://evil.example/callback', 'https://chatgpt.com.evil.com/connector_platform_oauth_redirect', 'http://localhost:123/callback', 'https://chatgpt.com/connector/oauth/x?next=evil', 'http://127.0.0.1:123/evil']) assert.equal(validRedirect(u), false);
  assert.equal(validRedirect('https://chatgpt.com/connector_platform_oauth_redirect'), true);
  assert.equal(validRedirect('http://127.0.0.1:4321/callback/id'), true);
});
test('OAuth consent, PKCE, single-use codes, revocation and MCP authorization work end to end', async t => {
  const repo = memoryRepo(), user = { id: 'test-user', email: 'test@example.com', status: 'active', role: 'admin', authVersion: 1 };
  const oauth = createAgendaMcpOAuth({ sessionSecret: 'test-only-local-secret', repo,
    getResolvedPremiumAuthState: async req => req.headers['x-test-login'] ? { authenticated: true, isAdmin: true, user, userId: user.id, email: user.email } : { authenticated: false },
    premiumUsersStore: { ensureUsersHydrated: async () => ({ source: 'supabase', users: [user] }), findUserById: users => users[0], isAdminRole: role => role === 'admin' },
  });
  const app = express(); app.use(express.json()); app.locals.softoraAgendaMcpOAuth = oauth;
  oauth.register(app, (_req, _res, next) => next());
  registerAgendaMcpRoutes(app, { readRouteDeps: { readCoordinator: { listAppointments: async () => ({ ok: true, appointments: [] }) } }, mutationRouteDeps: {} });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await post(PREFIX + '/mcp', rpc)).status, 401);
  const client = await (await post(PREFIX + '/register', { redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] })).json();
  const verifier = 'a'.repeat(43), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', resource: RESOURCE, response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, state: 'test-state', scope: 'agenda:read agenda:write' });
  const path = PREFIX + '/authorize?' + params;
  assert.match((await fetch(base + path, { redirect: 'manual' })).headers.get('location'), /^\/premium-personeel-login/);
  const consentResponse = await fetch(base + path, { headers: { 'x-test-login': '1' } });
  // no-referrer makes browser form POST Origin opaque (null), rejecting real consent.
  assert.equal(consentResponse.headers.get('referrer-policy'), 'same-origin');
  assert.match(consentResponse.headers.get('content-security-policy'), /form-action 'self' https:\/\/chatgpt\.com\/connector_platform_oauth_redirect;/);
  assert.match(consentResponse.headers.get('content-security-policy'), /default-src 'none'/);
  const page = await consentResponse.text();
  const consent = /name="consent" value="([^"]+)"/.exec(page)[1];
  assert.equal((await post(PREFIX + '/authorize', { consent, decision: 'allow' }, { origin: 'https://evil.example', 'x-test-login': '1' })).status, 403);
  assert.equal((await post(PREFIX + '/authorize', { consent, decision: 'allow' }, { origin: 'null', 'x-test-login': '1' })).status, 403);
  const allowed = await post(PREFIX + '/authorize', { consent, decision: 'allow' }, { origin: BASE, 'x-test-login': '1' });
  const callback = new URL(allowed.headers.get('location')); assert.equal(callback.searchParams.get('iss'), BASE);
  const payload = { grant_type: 'authorization_code', client_id: client.client_id, code: callback.searchParams.get('code'), code_verifier: verifier, resource: RESOURCE, redirect_uri: params.get('redirect_uri') };
  assert.equal((await post(PREFIX + '/token', { ...payload, code_verifier: 'b'.repeat(43) })).status, 400);
  assert.equal((await post(PREFIX + '/token', { ...payload, resource: 'https://evil.example' })).status, 400);
  const tokens = await (await post(PREFIX + '/token', payload)).json(); assert.ok(tokens.access_token);
  assert.equal((await post(PREFIX + '/token', payload)).status, 400);
  const authorization = `Bearer ${tokens.access_token}`;
  assert.equal((await (await post(PREFIX + '/mcp', rpc, { authorization })).json()).result.tools.length, 3);
  assert.equal((await post(PREFIX + '/mcp', rpc, { authorization, origin: 'https://evil.example' })).status, 403);
  user.status = 'inactive';
  assert.equal((await post(PREFIX + '/mcp', rpc, { authorization })).status, 401);
  user.status = 'active';
  const refreshed = await (await post(PREFIX + '/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: RESOURCE })).json(); assert.ok(refreshed.access_token);
  assert.equal((await post(PREFIX + '/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: RESOURCE })).status, 400);
  await post(PREFIX + '/revoke', { token: refreshed.refresh_token, client_id: client.client_id });
  assert.equal((await post(PREFIX + '/mcp', rpc, { authorization })).status, 401);
});
test('agenda mutations reuse central writes, preserve metadata, reject read-only and duplicate retries', async () => {
  const repo = memoryRepo(); let writes = 0, written;
  const existing = { id: 7, callId: 'manual_test', company: 'Test', date: '2026-09-10', time: '14:00', manualPhone: 'test-phone', manualNotes: 'notes', manualAvailableAgain: '16:00', appointmentKind: 'overig', manualPlannerWho: 'serve', manualLegendChoice: 'private-serve' };
  const response = async (req, res) => { writes++; written = req.body; return res.json({ ok: true, appointment: existing }); };
  const tools = createAgendaMcpTools({ repo, readRouteDeps: { readCoordinator: { listAppointments: async () => ({ ok: true, appointments: [existing] }) } }, mutationRouteDeps: { createManualAgendaAppointmentResponse: response, updateManualAgendaAppointmentResponse: response } });
  const args = { request_id: 'test-request-id-123', date: '2026-09-10', time: '15:00', title: 'Test', who: 'serve', location: '', notes: 'notes' };
  const auth = { userId: 'test', scope: 'agenda:read agenda:write' };
  await assert.rejects(tools.call('create_appointment', args, { ...auth, scope: 'agenda:read' }), /Schrijfrecht/);
  await assert.rejects(tools.call('create_appointment', { ...args, date: '2026-02-30' }, auth), /kalenderdatum/);
  const first = await tools.call('create_appointment', args, auth);
  assert.deepEqual(await tools.call('create_appointment', args, auth), first); assert.equal(writes, 1);
  await assert.rejects(tools.call('create_appointment', { ...args, title: 'different' }, auth), /andere wijziging/);
  await tools.call('update_appointment', { ...args, request_id: 'update-request-id-123', appointment_id: 7 }, auth);
  assert.equal(written.phone, 'test-phone'); assert.equal(written.availableAgain, '16:00'); assert.equal(written.legendChoice, 'private-serve');
  const list = await tools.call('list_appointments', { from: '2026-09-10', to: '2026-09-10' }, auth); assert.equal(list.structuredContent.appointments.length, 1);
});
test('uncertain mutations never execute twice', async () => {
  const repo = memoryRepo(); let calls = 0;
  const tools = createAgendaMcpTools({ repo, readRouteDeps: { readCoordinator: { listAppointments: async () => ({ ok: true, appointments: [] }) } }, mutationRouteDeps: { createManualAgendaAppointmentResponse: async () => { calls++; throw new Error('timeout'); } } });
  const args = { request_id: 'unknown-request-id', date: '2026-09-10', time: '14:00', title: 'Test', who: 'serve', location: '', notes: '' }, auth = { userId: 'test', scope: 'agenda:read agenda:write' };
  await assert.rejects(tools.call('create_appointment', args, auth), /timeout/);
  const again = await tools.call('create_appointment', args, auth); assert.equal(again.isError, true); assert.equal(calls, 1);
});
test('MCP authentication attempts are rate limited on the endpoint itself', async t => {
  const app = express(); app.use(express.json());
  app.locals.softoraAgendaMcpOAuth = { repo: {}, authenticate: async () => null, challenge: res => res.status(401).json({ error: 'unauthorized' }) };
  registerAgendaMcpRoutes(app, {});
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}${PREFIX}/mcp`;
  let response;
  for (let i = 0; i <= 120; i++) response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(response.status, 429);
});
