const crypto = require('node:crypto');
const { createAgendaMcpRepository } = require('../repositories/agenda-mcp');
const BASE = 'https://www.softora.nl';
const PREFIX = '/integrations/agenda';
const RESOURCE = `${BASE}${PREFIX}/mcp`;
const SCOPES = ['agenda:read', 'agenda:write'];
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function validRedirect(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.hash || u.search) return false;
    return (u.origin === 'https://chatgpt.com' && (u.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[\w-]+$/.test(u.pathname))) ||
      (u.protocol === 'http:' && u.hostname === '127.0.0.1' && /^\/callback(?:\/[\w-]+)?$/.test(u.pathname));
  } catch { return false; }
}
function createAgendaMcpOAuth({ sessionSecret, getResolvedPremiumAuthState, premiumUsersStore, repo = createAgendaMcpRepository() }) {
  const key = crypto.createHmac('sha256', sessionSecret || '').update('softora-agenda-oauth-client-v1').digest();
  function pack(value) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', key).update(body).digest('base64url')}`;
  }
  function unpack(value) {
    if (!sessionSecret || typeof value !== 'string' || value.length > 4000) return null;
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', key).update(body).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url')); } catch { return null; }
  }
  async function currentUser(value) {
    const hydrated = await premiumUsersStore.ensureUsersHydrated({ force: true, requireFresh: true });
    if (hydrated?.source !== 'supabase') throw new Error('Fresh account validation unavailable');
    const user = premiumUsersStore.findUserById(hydrated.users, value.userId);
    if (!user || user.status !== 'active' || !premiumUsersStore.isAdminRole(user.role) || Number(user.authVersion || 1) !== value.authVersion) return null;
    return user;
  }
  async function authenticate(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    if (!match) return null;
    const value = await repo.get(hash(match[1]), 'access');
    if (!value || value.resource !== RESOURCE || !await repo.get(value.grantId, 'grant') || !await currentUser(value)) return null;
    return value;
  }
  async function issue(value) {
    const access = random(), refresh = random();
    await repo.put(hash(access), 'access', value, 3600);
    await repo.put(hash(refresh), 'refresh', value, 30 * 86400);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: value.scope };
  }
  const challenge = res => res.set('WWW-Authenticate', `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/integrations/agenda/mcp", scope="agenda:read"`).status(401).json({ error: 'unauthorized' });
  function register(app, limiter) {
    const wrap = fn => async (req, res) => {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex' });
      try { if (!sessionSecret) return res.status(503).json({ error: 'temporarily_unavailable' }); await fn(req, res); }
      catch { if (!res.headersSent) res.status(503).json({ error: 'temporarily_unavailable' }); }
    };
    app.use(PREFIX, limiter, require('express').urlencoded({ extended: false, limit: '16kb' }));
    app.get('/.well-known/oauth-protected-resource/integrations/agenda/mcp', wrap((_req, res) => res.json({ resource: RESOURCE, authorization_servers: [BASE], scopes_supported: SCOPES })));
    app.get('/.well-known/oauth-authorization-server', wrap((_req, res) => res.json({
      issuer: BASE, authorization_endpoint: `${BASE}${PREFIX}/authorize`, token_endpoint: `${BASE}${PREFIX}/token`,
      registration_endpoint: `${BASE}${PREFIX}/register`, revocation_endpoint: `${BASE}${PREFIX}/revoke`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true, scopes_supported: SCOPES,
    })));
    app.post(`${PREFIX}/register`, wrap((req, res) => {
      const redirects = req.body?.redirect_uris;
      if (!Array.isArray(redirects) || !redirects.length || redirects.length > 3 || !redirects.every(validRedirect) || (req.body.token_endpoint_auth_method && req.body.token_endpoint_auth_method !== 'none')) return res.status(400).json({ error: 'invalid_client_metadata' });
      return res.status(201).json({ client_id: pack({ redirects }), redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    }));
    app.get(`${PREFIX}/authorize`, wrap(async (req, res) => {
      const q = req.query, client = unpack(q.client_id);
      if (!client?.redirects?.includes(q.redirect_uri) || !validRedirect(q.redirect_uri)) return res.status(400).send('Ongeldige terugkeerlink.');
      const fail = error => { const u = new URL(q.redirect_uri); u.searchParams.set('error', error); u.searchParams.set('iss', BASE); if (typeof q.state === 'string') u.searchParams.set('state', q.state); return res.redirect(u.href); };
      const scope = typeof q.scope === 'string' ? q.scope : 'agenda:read';
      if (q.response_type !== 'code' || q.resource !== RESOURCE || q.code_challenge_method !== 'S256' || !/^[\w-]{43}$/.test(q.code_challenge || '') || typeof q.state !== 'string' || q.state.length > 2000) return fail('invalid_request');
      if (!scope.split(' ').every(s => SCOPES.includes(s)) || !scope.split(' ').includes('agenda:read')) return fail('invalid_scope');
      const auth = await getResolvedPremiumAuthState(req, { requireFreshUserHydration: true });
      if (!auth?.authenticated) return res.redirect(`/premium-personeel-login?next=${encodeURIComponent(req.originalUrl)}`);
      if (!auth.user || !auth.isAdmin || auth.hydrationUnavailable) return res.status(403).send('Alleen een actief Full Access-account kan de agenda koppelen.');
      const consent = random();
      await repo.put(hash(consent), 'consent', { clientId: q.client_id, redirect: q.redirect_uri, challenge: q.code_challenge, state: q.state, scope, resource: RESOURCE, userId: auth.userId, authVersion: Number(auth.user.authVersion || 1) }, 600);
      // Permit only the validated OAuth callback after the same-origin form POST.
      res.set('Content-Security-Policy', `default-src 'none'; base-uri 'none'; form-action 'self' ${q.redirect_uri}; frame-ancestors 'none'; object-src 'none'`);
      res.type('html').send(`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Softora Agenda koppelen</title><body><main><h1>Softora Agenda koppelen</h1><p>Ingelogd als ${escape(auth.email)}.</p><p>Deze koppeling geeft ChatGPT of Codex toegang tot de gedeelde Softora-agenda van Servé en Martijn.</p><p>${scope.includes('agenda:write') ? 'Afspraken bekijken, toevoegen en handmatige afspraken wijzigen.' : 'Alleen afspraken bekijken.'} Geen toegang tot mailbox, wachtwoorden of andere Softora-onderdelen.</p><p>Terug naar: ${escape(new URL(q.redirect_uri).origin)}</p><form method="post" action="${PREFIX}/authorize"><input type="hidden" name="consent" value="${consent}"><button name="decision" value="allow">Agenda koppelen</button><button name="decision" value="deny">Annuleren</button></form></main></body></html>`);
    }));
    app.post(`${PREFIX}/authorize`, wrap(async (req, res) => {
      if (req.headers.origin !== BASE) return res.status(403).send('Ongeldige herkomst.');
      const auth = await getResolvedPremiumAuthState(req, { requireFreshUserHydration: true });
      if (!auth?.authenticated || !auth.user || !auth.isAdmin || auth.hydrationUnavailable) return res.status(403).send('Log opnieuw in bij Softora.');
      const consentHash = hash(req.body?.consent || '');
      const pending = await repo.get(consentHash, 'consent');
      if (!pending || pending.userId !== auth.userId || pending.authVersion !== Number(auth.user.authVersion || 1)) return res.status(400).send('Koppelaanvraag verlopen.');
      const value = await repo.get(consentHash, 'consent', true);
      if (!value) return res.status(400).send('Koppelaanvraag al verwerkt.');
      const u = new URL(value.redirect); u.searchParams.set('state', value.state); u.searchParams.set('iss', BASE);
      if (req.body.decision !== 'allow') u.searchParams.set('error', 'access_denied');
      else { const code = random(); await repo.put(hash(code), 'code', value, 120); u.searchParams.set('code', code); }
      return res.redirect(u.href);
    }));
    app.post(`${PREFIX}/token`, wrap(async (req, res) => {
      const b = req.body || {}, kind = b.grant_type === 'authorization_code' ? 'code' : b.grant_type === 'refresh_token' ? 'refresh' : '';
      if (!kind) return res.status(400).json({ error: 'unsupported_grant_type' });
      const token = kind === 'code' ? b.code : b.refresh_token;
      if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return res.status(400).json({ error: 'invalid_grant' });
      const value = await repo.get(hash(token), kind);
      if (!value || value.clientId !== b.client_id || b.resource !== RESOURCE || !await currentUser(value)) return res.status(400).json({ error: 'invalid_grant' });
      if (kind === 'code' && (b.redirect_uri !== value.redirect || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier || '') || crypto.createHash('sha256').update(b.code_verifier).digest('base64url') !== value.challenge)) return res.status(400).json({ error: 'invalid_grant' });
      if (b.scope && b.scope !== value.scope) return res.status(400).json({ error: 'invalid_scope' });
      if (!await repo.get(hash(token), kind, true)) return res.status(400).json({ error: 'invalid_grant' });
      if (kind === 'refresh' && !await repo.get(value.grantId, 'grant')) return res.status(400).json({ error: 'invalid_grant' });
      const grant = { userId: value.userId, authVersion: value.authVersion, clientId: value.clientId, resource: RESOURCE, scope: value.scope, grantId: value.grantId || crypto.randomUUID() };
      if (kind === 'code') await repo.put(grant.grantId, 'grant', grant, 30 * 86400);
      return res.json(await issue(grant));
    }));
    app.post(`${PREFIX}/revoke`, wrap(async (req, res) => {
      const id = hash(req.body?.token || '');
      const grant = await repo.get(id, 'refresh') || await repo.get(id, 'access');
      if (grant && grant.clientId === req.body?.client_id) await repo.revoke(grant.grantId);
      return res.status(200).end();
    }));
  }
  return { register, authenticate, challenge, repo };
}
module.exports = { createAgendaMcpOAuth, validRedirect, hash, BASE, PREFIX, RESOURCE };
