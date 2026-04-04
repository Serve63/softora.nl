'use strict';

/**
 * routes/premium-users.js — CRUD voor premium gebruikersbeheer (admin only).
 */

module.exports = function registerPremiumUsersRoutes(app, ctx) {
  const {
    normalizeString, truncateText,
    requirePremiumAdminApiAccess, premiumUsersStore,
    appendSecurityAuditEvent, getClientIpFromRequest, getRequestPathname, getRequestOriginFromHeaders,
  } = ctx;

  // --- GET /api/premium-users ---
  app.get('/api/premium-users', requirePremiumAdminApiAccess, async (req, res) => {
    const hydrated = await premiumUsersStore.ensureUsersHydrated({ force: true });
    const users = Array.isArray(hydrated?.users) ? hydrated.users : premiumUsersStore.getCachedUsers();
    return res.status(200).json({
      ok: true,
      users: users.map((u) => premiumUsersStore.sanitizeUserForClient(u)),
      updatedAt: hydrated?.updatedAt || premiumUsersStore.getUsersUpdatedAt() || null,
    });
  });

  // --- POST /api/premium-users ---
  app.post('/api/premium-users', requirePremiumAdminApiAccess, async (req, res) => {
    const authState = req.premiumAuth;
    const users = (await premiumUsersStore.ensureUsersHydrated({ force: true }))?.users || premiumUsersStore.getCachedUsers();
    const email = premiumUsersStore.validateUserEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    const { firstName, lastName } = premiumUsersStore.normalizeUserInputNames(req.body || {});
    const role = premiumUsersStore.normalizeUserRole(req.body?.rol || req.body?.role || 'medewerker');

    if (!email || !password) return res.status(400).json({ ok: false, error: 'E-mail en wachtwoord zijn verplicht.' });
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'Wachtwoord moet minimaal 8 tekens bevatten.' });
    if (premiumUsersStore.findUserByEmail(users, email)) return res.status(409).json({ ok: false, error: 'Dit e-mailadres bestaat al.' });

    const nowIso = new Date().toISOString();
    const nextUsers = users.concat([premiumUsersStore.sanitizeUserRecord({ firstName, lastName, email, role, status: 'active', passwordHash: premiumUsersStore.createPasswordHash(password), source: 'managed_ui', createdAt: nowIso, updatedAt: nowIso })]);
    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, { source: 'premium_users_api_create', reason: 'premium_user_created', actorEmail: authState.email });
    if (!saved || saved.source !== 'supabase') return res.status(503).json({ ok: false, error: 'Gebruiker kon niet worden opgeslagen zonder geldige Supabase-opslag.' });

    const createdUser = premiumUsersStore.findUserByEmail(saved.users, email);
    appendSecurityAuditEvent({ type: 'premium_user_created', severity: 'info', success: true, email: authState.email || '', ip: getClientIpFromRequest(req), path: getRequestPathname(req), origin: getRequestOriginFromHeaders(req), userAgent: req.get('user-agent'), detail: `Premium gebruiker toegevoegd: ${email}.` }, 'security_premium_user_created');
    return res.status(201).json({ ok: true, user: premiumUsersStore.sanitizeUserForClient(createdUser), users: saved.users.map((u) => premiumUsersStore.sanitizeUserForClient(u)) });
  });

  // --- PATCH /api/premium-users/:id ---
  app.patch('/api/premium-users/:id', requirePremiumAdminApiAccess, async (req, res) => {
    const authState = req.premiumAuth;
    const userId = truncateText(normalizeString(req.params?.id || ''), 120);
    const users = (await premiumUsersStore.ensureUsersHydrated({ force: true }))?.users || premiumUsersStore.getCachedUsers();
    const existingUser = premiumUsersStore.findUserById(users, userId);
    if (!existingUser) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden.' });

    const emailRaw = req.body?.email;
    const password = String(req.body?.password || '');
    const role = premiumUsersStore.normalizeUserRole(req.body?.rol || req.body?.role || existingUser.role);
    const status = premiumUsersStore.normalizeUserStatus(req.body?.status || existingUser.status);
    const nextEmail = emailRaw === undefined ? existingUser.email : premiumUsersStore.validateUserEmail(emailRaw);
    const { firstName, lastName } = premiumUsersStore.normalizeUserInputNames({ firstName: req.body?.firstName === undefined ? existingUser.firstName : req.body?.firstName, lastName: req.body?.lastName === undefined ? existingUser.lastName : req.body?.lastName, voornaam: req.body?.voornaam, achternaam: req.body?.achternaam });

    if (!nextEmail) return res.status(400).json({ ok: false, error: 'Voer een geldig e-mailadres in.' });
    if (password && password.length < 8) return res.status(400).json({ ok: false, error: 'Wachtwoord moet minimaal 8 tekens bevatten.' });
    if (users.some((item) => item.id !== userId && item.email === nextEmail)) return res.status(409).json({ ok: false, error: 'Dit e-mailadres is al in gebruik.' });

    const nextUsers = users.map((user) => {
      if (user.id !== userId) return user;
      return premiumUsersStore.sanitizeUserRecord({ ...user, firstName, lastName, email: nextEmail, role, status, passwordHash: password ? premiumUsersStore.createPasswordHash(password) : user.passwordHash, source: 'managed_ui', updatedAt: new Date().toISOString() });
    });

    if (premiumUsersStore.countActiveAdmins(nextUsers) < 1) return res.status(400).json({ ok: false, error: 'Er moet altijd minimaal één actieve administrator overblijven.' });

    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, { source: 'premium_users_api_update', reason: 'premium_user_updated', actorEmail: authState.email });
    if (!saved || saved.source !== 'supabase') return res.status(503).json({ ok: false, error: 'Gebruiker kon niet worden bijgewerkt zonder geldige Supabase-opslag.' });

    const updatedUser = premiumUsersStore.findUserById(saved.users, userId);
    appendSecurityAuditEvent({ type: 'premium_user_updated', severity: 'info', success: true, email: authState.email || '', ip: getClientIpFromRequest(req), path: getRequestPathname(req), origin: getRequestOriginFromHeaders(req), userAgent: req.get('user-agent'), detail: `Premium gebruiker bijgewerkt: ${nextEmail}.` }, 'security_premium_user_updated');
    return res.status(200).json({ ok: true, user: premiumUsersStore.sanitizeUserForClient(updatedUser), users: saved.users.map((u) => premiumUsersStore.sanitizeUserForClient(u)) });
  });

  // --- DELETE /api/premium-users/:id ---
  app.delete('/api/premium-users/:id', requirePremiumAdminApiAccess, async (req, res) => {
    const authState = req.premiumAuth;
    const userId = truncateText(normalizeString(req.params?.id || ''), 120);
    const users = (await premiumUsersStore.ensureUsersHydrated({ force: true }))?.users || premiumUsersStore.getCachedUsers();
    const existingUser = premiumUsersStore.findUserById(users, userId);
    if (!existingUser) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden.' });

    const nextUsers = users.filter((user) => user.id !== userId);
    if (premiumUsersStore.countActiveAdmins(nextUsers) < 1) return res.status(400).json({ ok: false, error: 'Er moet altijd minimaal één actieve administrator overblijven.' });

    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, { source: 'premium_users_api_delete', reason: 'premium_user_deleted', actorEmail: authState.email });
    if (!saved || saved.source !== 'supabase') return res.status(503).json({ ok: false, error: 'Gebruiker kon niet worden verwijderd zonder geldige Supabase-opslag.' });

    appendSecurityAuditEvent({ type: 'premium_user_deleted', severity: 'info', success: true, email: authState.email || '', ip: getClientIpFromRequest(req), path: getRequestPathname(req), origin: getRequestOriginFromHeaders(req), userAgent: req.get('user-agent'), detail: `Premium gebruiker verwijderd: ${existingUser.email}.` }, 'security_premium_user_deleted');
    return res.status(200).json({ ok: true, users: saved.users.map((u) => premiumUsersStore.sanitizeUserForClient(u)) });
  });
};
