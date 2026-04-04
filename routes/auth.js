'use strict';

/**
 * routes/auth.js — Auth routes: sessie, login, logout, profiel.
 * Inclusief de API-auth middleware die alle /api routes beschermt.
 */

module.exports = function registerAuthRoutes(app, ctx) {
  const {
    normalizeString, truncateText,
    getResolvedPremiumAuthState, buildPremiumAuthSessionPayload,
    clearPremiumSessionCookie, createPremiumSessionToken, setPremiumSessionCookie,
    normalizePremiumSessionEmail, getSafePremiumRedirectPath,
    getClientIpFromRequest, getRequestPathname, getRequestOriginFromHeaders,
    appendSecurityAuditEvent, isPremiumAdminIpAllowed,
    isPremiumMfaConfigured, isPremiumMfaCodeValid,
    isPremiumPublicApiRequest, parsePremiumProfileDisplayName,
    premiumUsersStore,
    PREMIUM_SESSION_SECRET, PREMIUM_SESSION_TTL_HOURS, PREMIUM_SESSION_REMEMBER_TTL_DAYS,
  } = ctx;

  // --- GET /api/auth/session ---
  app.get('/api/auth/session', async (req, res) => {
    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');
    if (authState.revoked) clearPremiumSessionCookie(req, res);
    return res.status(200).json(buildPremiumAuthSessionPayload(authState));
  });

  // --- POST /api/auth/login ---
  app.post('/api/auth/login', async (req, res) => {
    const email = normalizePremiumSessionEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    const otp = normalizeString(req.body?.otp || '').replace(/\s+/g, '');
    const remember = /^(1|true|yes|on)$/i.test(String(req.body?.remember || ''));
    const nextPath = getSafePremiumRedirectPath(req.body?.next || req.query?.next || '');
    const clientIp = getClientIpFromRequest(req);
    const requestPath = getRequestPathname(req);
    const requestOrigin = getRequestOriginFromHeaders(req);
    const userAgent = normalizeString(req.get('user-agent') || '');

    res.setHeader('Cache-Control', 'no-store, private');

    const hydrated = await premiumUsersStore.ensureUsersHydrated();
    const users = Array.isArray(hydrated?.users) ? hydrated.users : premiumUsersStore.getCachedUsers();

    if (!PREMIUM_SESSION_SECRET || hydrated?.source !== 'supabase' || users.length === 0) {
      appendSecurityAuditEvent({ type: 'login_rejected', severity: 'warning', success: false, email, ip: clientIp, path: requestPath, origin: requestOrigin, userAgent, detail: 'Premium login niet geconfigureerd op de server.' }, 'security_login_rejected');
      return res.status(503).json({ ok: false, error: 'Premium login is nog niet volledig via Supabase geconfigureerd op de server. Voeg eerst minimaal één premium gebruiker toe in Supabase en zet PREMIUM_SESSION_SECRET.' });
    }

    if (!isPremiumAdminIpAllowed(req)) {
      appendSecurityAuditEvent({ type: 'login_ip_blocked', severity: 'warning', success: false, email, ip: clientIp, path: requestPath, origin: requestOrigin, userAgent, detail: 'Login geweigerd door admin IP allowlist.' }, 'security_login_ip_blocked');
      return res.status(403).json({ ok: false, error: 'Inloggen is vanaf dit IP-adres niet toegestaan.' });
    }

    if (!email || !password) {
      appendSecurityAuditEvent({ type: 'login_failed', severity: 'warning', success: false, email, ip: clientIp, path: requestPath, origin: requestOrigin, userAgent, detail: 'E-mailadres of wachtwoord ontbreekt.' }, 'security_login_failed');
      return res.status(400).json({ ok: false, error: 'Vul je e-mailadres en wachtwoord in.' });
    }

    const matchedUser = premiumUsersStore.findUserByEmail(users, email);
    const isPasswordValid = matchedUser ? premiumUsersStore.verifyPasswordHash(password, matchedUser.passwordHash) : false;
    if (!matchedUser || !isPasswordValid) {
      appendSecurityAuditEvent({ type: 'login_failed', severity: 'warning', success: false, email, ip: clientIp, path: requestPath, origin: requestOrigin, userAgent, detail: 'Ongeldige inloggegevens.' }, 'security_login_failed');
      return res.status(401).json({ ok: false, error: 'Ongeldige inloggegevens.' });
    }

    if (premiumUsersStore.normalizeUserStatus(matchedUser.status) !== 'active') {
      appendSecurityAuditEvent({ type: 'login_failed', severity: 'warning', success: false, email, ip: clientIp, path: requestPath, origin: requestOrigin, userAgent, detail: 'Inloggen geweigerd omdat het account inactief is.' }, 'security_login_failed');
      return res.status(403).json({ ok: false, error: 'Dit account is gedeactiveerd.' });
    }

    if (isPremiumMfaConfigured() && !isPremiumMfaCodeValid(otp)) {
      appendSecurityAuditEvent({ type: 'login_mfa_failed', severity: 'warning', success: false, email, ip: clientIp, path: requestPath, origin: requestOrigin, userAgent, detail: '2FA-code ongeldig of ontbreekt.' }, 'security_login_mfa_failed');
      return res.status(401).json({ ok: false, error: 'Ongeldige of ontbrekende 2FA-code.', mfaRequired: true });
    }

    const sessionMaxAgeMs = remember
      ? PREMIUM_SESSION_REMEMBER_TTL_DAYS * 24 * 60 * 60 * 1000
      : PREMIUM_SESSION_TTL_HOURS * 60 * 60 * 1000;
    const sessionToken = createPremiumSessionToken({ email, maxAgeMs: sessionMaxAgeMs, userId: matchedUser.id, role: matchedUser.role });
    setPremiumSessionCookie(req, res, sessionToken, sessionMaxAgeMs);
    appendSecurityAuditEvent({ type: 'login_success', severity: 'info', success: true, email, ip: clientIp, path: requestPath, origin: requestOrigin, userAgent, detail: remember ? 'Premium login succesvol met verlengde sessie.' : 'Premium login succesvol.' }, 'security_login_success');
    return res.status(200).json({ ok: true, authenticated: true, role: matchedUser.role, next: nextPath });
  });

  // --- POST /api/auth/logout ---
  app.post('/api/auth/logout', async (req, res) => {
    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');
    clearPremiumSessionCookie(req, res);
    appendSecurityAuditEvent({ type: 'logout', severity: 'info', success: true, email: authState.email || '', ip: getClientIpFromRequest(req), path: getRequestPathname(req), origin: getRequestOriginFromHeaders(req), userAgent: req.get('user-agent'), detail: 'Premium sessie uitgelogd.' }, 'security_logout');
    return res.status(200).json({ ok: true, authenticated: false });
  });

  // --- Middleware: beschermt alle /api routes die niet publiek zijn ---
  app.use('/api', async (req, res, next) => {
    if (isPremiumPublicApiRequest(req)) return next();
    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');

    if (!authState.configured) {
      return res.status(503).json({ ok: false, error: 'Premium auth is nog niet volledig via Supabase geconfigureerd op de server. Voeg eerst minimaal één premium gebruiker toe in Supabase en zet PREMIUM_SESSION_SECRET.' });
    }

    if (authState.authenticated) {
      if (!isPremiumAdminIpAllowed(req)) {
        appendSecurityAuditEvent({ type: 'admin_ip_blocked', severity: 'warning', success: false, email: authState.email || '', ip: getClientIpFromRequest(req), path: getRequestPathname(req), origin: getRequestOriginFromHeaders(req), userAgent: req.get('user-agent'), detail: 'Ingelogde API-request geweigerd door admin IP allowlist.' }, 'security_admin_ip_blocked');
        clearPremiumSessionCookie(req, res);
        return res.status(403).json({ ok: false, error: 'Toegang vanaf dit IP-adres is niet toegestaan.' });
      }
      req.premiumAuth = authState;
      return next();
    }

    if (authState.expired || authState.revoked) clearPremiumSessionCookie(req, res);
    return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
  });

  // --- GET /api/auth/profile ---
  app.get('/api/auth/profile', async (req, res) => {
    const authState = req.premiumAuth || null;
    if (!authState?.authenticated) return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
    return res.status(200).json({
      ok: true,
      user: premiumUsersStore.sanitizeUserForClient(authState.user),
      session: buildPremiumAuthSessionPayload(authState),
    });
  });

  // --- PATCH /api/auth/profile ---
  app.patch('/api/auth/profile', async (req, res) => {
    const authState = req.premiumAuth || null;
    if (!authState?.authenticated) return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });

    const users = (await premiumUsersStore.ensureUsersHydrated({ force: true }))?.users || premiumUsersStore.getCachedUsers();
    const existingUser = premiumUsersStore.findUserById(users, authState.userId) || premiumUsersStore.findUserByEmail(users, authState.email);
    if (!existingUser) return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden.' });

    const hasDisplayNameInput = req.body?.displayName !== undefined || req.body?.naam !== undefined || req.body?.fullName !== undefined;
    const avatarInputProvided = req.body?.avatarDataUrl !== undefined || req.body?.avatar !== undefined;
    const removeAvatar = /^(1|true|yes|on)$/i.test(String(req.body?.removeAvatar || ''));

    let nextFirstName = existingUser.firstName;
    let nextLastName = existingUser.lastName;
    if (hasDisplayNameInput) {
      const parsedNames = parsePremiumProfileDisplayName(req.body?.displayName || req.body?.naam || req.body?.fullName || '');
      if (!parsedNames.firstName) return res.status(400).json({ ok: false, error: 'Voer een geldige naam in.' });
      nextFirstName = parsedNames.firstName;
      nextLastName = parsedNames.lastName;
    }

    let nextAvatarDataUrl = premiumUsersStore.sanitizeAvatarDataUrl(existingUser.avatarDataUrl || '');
    if (removeAvatar) {
      nextAvatarDataUrl = '';
    } else if (avatarInputProvided) {
      nextAvatarDataUrl = premiumUsersStore.sanitizeAvatarDataUrl(req.body?.avatarDataUrl || req.body?.avatar || '');
      if (normalizeString(req.body?.avatarDataUrl || req.body?.avatar || '') && !nextAvatarDataUrl) {
        return res.status(400).json({ ok: false, error: 'Profielfoto moet een geldige PNG, JPG, WEBP of GIF data-url zijn.' });
      }
    }

    const nextUsers = users.map((user) => {
      if (user.id !== existingUser.id) return user;
      return premiumUsersStore.sanitizeUserRecord({ ...user, firstName: nextFirstName, lastName: nextLastName, avatarDataUrl: nextAvatarDataUrl, updatedAt: new Date().toISOString(), source: 'self_service_profile' });
    });

    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, { source: 'premium_profile_update', reason: 'premium_profile_updated', actorEmail: authState.email });
    if (!saved || saved.source !== 'supabase') return res.status(503).json({ ok: false, error: 'Profiel kon niet worden opgeslagen zonder geldige Supabase-opslag.' });

    const updatedUser = premiumUsersStore.findUserById(saved.users, existingUser.id) || premiumUsersStore.findUserByEmail(saved.users, authState.email);
    appendSecurityAuditEvent({ type: 'premium_profile_updated', severity: 'info', success: true, email: authState.email || '', ip: getClientIpFromRequest(req), path: getRequestPathname(req), origin: getRequestOriginFromHeaders(req), userAgent: req.get('user-agent'), detail: 'Premium gebruiker heeft eigen profiel bijgewerkt.' }, 'security_premium_profile_updated');

    const refreshedAuthState = { ...authState, user: updatedUser, firstName: normalizeString(updatedUser?.firstName || ''), lastName: normalizeString(updatedUser?.lastName || ''), displayName: premiumUsersStore.buildUserDisplayName(updatedUser), avatarDataUrl: premiumUsersStore.sanitizeAvatarDataUrl(updatedUser?.avatarDataUrl || '') };
    return res.status(200).json({ ok: true, user: premiumUsersStore.sanitizeUserForClient(updatedUser), session: buildPremiumAuthSessionPayload(refreshedAuthState) });
  });
};
