const { timingSafeEqualStrings } = require('../security/crypto-utils');

const AGENDA_APP_IDENTITY_EMAILS = Object.freeze({
  serve: 'serve@softora.nl',
  martijn: 'martijn@softora.nl',
});

function createPremiumAuthRouteCoordinator(deps = {}) {
  const {
    sessionSecret = '',
    premiumSessionTtlHours = 12,
    premiumSessionRememberTtlDays = 30,
    agendaAppPin = '',
    agendaAppPinHash = '',
    agendaAppServeEmail = AGENDA_APP_IDENTITY_EMAILS.serve,
    agendaAppMartijnEmail = AGENDA_APP_IDENTITY_EMAILS.martijn,
    agendaAppSessionTtlDays = 3650,
    premiumUsersStore,
    normalizePremiumSessionEmail = (value) => String(value || '').trim().toLowerCase(),
    normalizeString = (value) => String(value || '').trim(),
    isPremiumMfaConfigured = () => false,
    isPremiumMfaCodeValid = () => false,
    getSafePremiumRedirectPath = (value) => value,
    getResolvedPremiumAuthState = async () => ({
      configured: false,
      authenticated: false,
      revoked: false,
      email: '',
    }),
    buildPremiumAuthSessionPayload = (authState) => authState,
    isPremiumAdminIpAllowed = () => true,
    createPremiumSessionToken = () => '',
    setPremiumSessionCookie = () => {},
    clearPremiumSessionCookie = () => {},
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '/',
    getRequestOriginFromHeaders = () => '',
    premiumLoginUsersReadTimeoutMs = 1200,
  } = deps;

  function getRequestUserAgent(req) {
    return normalizeString(typeof req?.get === 'function' ? req.get('user-agent') || '' : '');
  }

  function appendAuditEvent(req, payload, reason) {
    appendSecurityAuditEvent(
      {
        ...payload,
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: getRequestUserAgent(req),
      },
      reason
    );
  }

  function normalizeAgendaAppIdentity(value) {
    const normalized = normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (normalized === 'martijn') return 'martijn';
    if (normalized === 'serve' || normalized === 'serv') return 'serve';
    return '';
  }

  function getAgendaAppIdentityEmail(identity) {
    if (identity === 'martijn') return normalizePremiumSessionEmail(agendaAppMartijnEmail);
    if (identity === 'serve') return normalizePremiumSessionEmail(agendaAppServeEmail);
    return '';
  }

  function isAgendaAppPinConfigured() {
    return Boolean(normalizeString(agendaAppPinHash) || normalizeString(agendaAppPin));
  }

  function isAgendaAppPinValid(pin) {
    const rawPin = String(pin || '').trim();
    if (!rawPin) return false;

    const pinHash = normalizeString(agendaAppPinHash);
    if (pinHash && premiumUsersStore.verifyPasswordHash(rawPin, pinHash)) {
      return true;
    }

    const plainPin = normalizeString(agendaAppPin);
    return Boolean(plainPin && timingSafeEqualStrings(rawPin, plainPin));
  }

  function getAgendaAppSessionMaxAgeMs() {
    const days = Math.max(1, Math.min(3650, Number(agendaAppSessionTtlDays) || 3650));
    return days * 24 * 60 * 60 * 1000;
  }

  function getUserDisplayName(user) {
    if (typeof premiumUsersStore.buildUserDisplayName === 'function') {
      return premiumUsersStore.buildUserDisplayName(user);
    }
    const firstName = normalizeString(user?.firstName || user?.voornaam || '');
    const lastName = normalizeString(user?.lastName || user?.achternaam || '');
    return `${firstName} ${lastName}`.trim() || normalizePremiumSessionEmail(user?.email || '');
  }

  function normalizeAgendaAppIdentityCandidate(value) {
    const normalized = normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const token = normalized.split(/[^a-z0-9]+/).find(Boolean) || normalized;
    return normalizeAgendaAppIdentity(token);
  }

  function getAgendaAppUserIdentityCandidates(user) {
    const email = normalizePremiumSessionEmail(user?.email || '');
    const emailLocalPart = email.split('@')[0] || '';
    return [
      user?.firstName,
      user?.voornaam,
      getUserDisplayName(user),
      emailLocalPart,
    ]
      .map((value) => normalizeAgendaAppIdentityCandidate(value))
      .filter(Boolean);
  }

  function findAgendaAppUser(users, email, identity) {
    const exactUser = premiumUsersStore.findUserByEmail(users, email);
    if (exactUser) return exactUser;
    if (!Array.isArray(users) || !identity) return null;
    return (
      users.find((user) => getAgendaAppUserIdentityCandidates(user).includes(identity)) || null
    );
  }

  async function sendSessionResponse(req, res) {
    const authState = await getResolvedPremiumAuthState(req, {
      allowAnonymousWithoutHydration: true,
    });
    res.setHeader('Cache-Control', 'no-store, private');
    if (authState.revoked) {
      clearPremiumSessionCookie(req, res);
    }
    return res.status(200).json(buildPremiumAuthSessionPayload(authState));
  }

  function getLoginUsersReadTimeoutMs() {
    return Math.max(500, Math.min(2500, Number(premiumLoginUsersReadTimeoutMs) || 1200));
  }

  async function loadUsersForLogin() {
    const hydrated = await premiumUsersStore.ensureUsersHydrated({
      force: true,
      readTimeoutMs: getLoginUsersReadTimeoutMs(),
      allowBootstrapFallback: true,
    });
    const hydratedUsers = Array.isArray(hydrated?.users) ? hydrated.users : [];
    const cachedUsers = premiumUsersStore.getCachedUsers();
    return {
      hydrated,
      users: hydratedUsers.length > 0 ? hydratedUsers : cachedUsers,
    };
  }

  async function recoverBootstrapLoginUser(req, users, email, password, matchedUser) {
    if (!matchedUser) return null;
    if (normalizeString(matchedUser.source || '').toLowerCase() !== 'bootstrap_env') return null;
    if (typeof premiumUsersStore.findBootstrapUserByEmail !== 'function') return null;

    const bootstrapUser = premiumUsersStore.findBootstrapUserByEmail(email);
    if (!bootstrapUser) return null;
    if (!premiumUsersStore.verifyPasswordHash(password, bootstrapUser.passwordHash)) return null;

    const nowIso = new Date().toISOString();
    const nextUser = {
      ...matchedUser,
      passwordHash: bootstrapUser.passwordHash,
      updatedAt: nowIso,
    };
    const existingUsers = Array.isArray(users) ? users : [];
    const nextUsers = existingUsers.map((user) =>
      user && (user.id === matchedUser.id || user.email === matchedUser.email) ? nextUser : user
    );

    let savedUsers = nextUsers;
    if (typeof premiumUsersStore.persistUsersCollection === 'function') {
      const saved = await premiumUsersStore.persistUsersCollection(nextUsers, {
        source: 'premium_auth_bootstrap_recovery',
        reason: 'premium_login_bootstrap_password_sync',
        actorEmail: email,
      });
      if (Array.isArray(saved?.users) && saved.users.length > 0) {
        savedUsers = saved.users;
      }
    }

    appendAuditEvent(
      req,
      {
        type: 'login_bootstrap_password_recovered',
        severity: 'info',
        success: true,
        email,
        detail: 'Premium login wachtwoordhash hersteld vanuit bootstrap-env.',
      },
      'security_login_bootstrap_password_recovered'
    );

    return premiumUsersStore.findUserByEmail(savedUsers, email) || nextUser;
  }

  async function loginResponse(req, res) {
    const email = normalizePremiumSessionEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    const otp = normalizeString(req.body?.otp || '').replace(/\s+/g, '');
    const remember = /^(1|true|yes|on)$/i.test(String(req.body?.remember || ''));
    const nextPath = getSafePremiumRedirectPath(req.body?.next || req.query?.next || '');

    res.setHeader('Cache-Control', 'no-store, private');

    const { hydrated, users } = await loadUsersForLogin();

    if (!sessionSecret) {
      appendAuditEvent(
        req,
        {
          type: 'login_rejected',
          severity: 'warning',
          success: false,
          email,
          detail: 'Premium login niet geconfigureerd: sessie-secret ontbreekt.',
        },
        'security_login_rejected'
      );
      return res.status(503).json({
        ok: false,
        error:
          'Premium login is nog niet volledig via Supabase geconfigureerd op de server. Zet PREMIUM_SESSION_SECRET opnieuw in de productie-omgeving.',
      });
    }

    if (users.length === 0) {
      const isTemporaryUserStoreFailure = hydrated?.source === 'unavailable';
      appendAuditEvent(
        req,
        {
          type: 'login_rejected',
          severity: 'warning',
          success: false,
          email,
          detail: isTemporaryUserStoreFailure
            ? 'Premium login tijdelijk niet beschikbaar: gebruikerslijst kon niet worden geladen.'
            : 'Premium login niet geconfigureerd: geen premium gebruikers gevonden.',
        },
        'security_login_rejected'
      );
      return res.status(503).json({
        ok: false,
        error: isTemporaryUserStoreFailure
          ? 'Premium login is tijdelijk niet beschikbaar omdat de gebruikerslijst niet kon worden geladen. Probeer het zo opnieuw.'
          : 'Premium login is nog niet volledig via Supabase geconfigureerd op de server. Voeg eerst minimaal één premium gebruiker toe in Supabase.',
      });
    }

    if (!isPremiumAdminIpAllowed(req)) {
      appendAuditEvent(
        req,
        {
          type: 'login_ip_blocked',
          severity: 'warning',
          success: false,
          email,
          detail: 'Login geweigerd door admin IP allowlist.',
        },
        'security_login_ip_blocked'
      );
      return res.status(403).json({
        ok: false,
        error: 'Inloggen is vanaf dit IP-adres niet toegestaan.',
      });
    }

    if (!email || !password) {
      appendAuditEvent(
        req,
        {
          type: 'login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'E-mailadres of wachtwoord ontbreekt.',
        },
        'security_login_failed'
      );
      return res.status(400).json({
        ok: false,
        error: 'Vul je e-mailadres en wachtwoord in.',
      });
    }

    let matchedUser = premiumUsersStore.findUserByEmail(users, email);
    let isPasswordValid = matchedUser
      ? premiumUsersStore.verifyPasswordHash(password, matchedUser.passwordHash)
      : false;
    if (!isPasswordValid) {
      const recoveredUser = await recoverBootstrapLoginUser(req, users, email, password, matchedUser);
      if (recoveredUser) {
        matchedUser = recoveredUser;
        isPasswordValid = true;
      }
    }

    if (!matchedUser || !isPasswordValid) {
      appendAuditEvent(
        req,
        {
          type: 'login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Ongeldige inloggegevens.',
        },
        'security_login_failed'
      );
      return res.status(401).json({
        ok: false,
        error: 'Ongeldige inloggegevens.',
      });
    }

    if (premiumUsersStore.normalizeUserStatus(matchedUser.status) !== 'active') {
      appendAuditEvent(
        req,
        {
          type: 'login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Inloggen geweigerd omdat het account inactief is.',
        },
        'security_login_failed'
      );
      return res.status(403).json({
        ok: false,
        error: 'Dit account is gedeactiveerd.',
      });
    }

    if (isPremiumMfaConfigured() && !isPremiumMfaCodeValid(otp)) {
      appendAuditEvent(
        req,
        {
          type: 'login_mfa_failed',
          severity: 'warning',
          success: false,
          email,
          detail: '2FA-code ongeldig of ontbreekt.',
        },
        'security_login_mfa_failed'
      );
      return res.status(401).json({
        ok: false,
        error: 'Ongeldige of ontbrekende 2FA-code.',
        mfaRequired: true,
      });
    }

    const sessionMaxAgeMs = remember
      ? premiumSessionRememberTtlDays * 24 * 60 * 60 * 1000
      : premiumSessionTtlHours * 60 * 60 * 1000;
    const sessionToken = createPremiumSessionToken({
      email,
      maxAgeMs: sessionMaxAgeMs,
      userId: matchedUser.id,
      role: matchedUser.role,
    });
    setPremiumSessionCookie(req, res, sessionToken, sessionMaxAgeMs);

    appendAuditEvent(
      req,
      {
        type: 'login_success',
        severity: 'info',
        success: true,
        email,
        detail: remember
          ? 'Premium login succesvol met verlengde sessie.'
          : 'Premium login succesvol.',
      },
      'security_login_success'
    );

    return res.status(200).json({
      ok: true,
      authenticated: true,
      role: matchedUser.role,
      next: nextPath,
    });
  }

  async function agendaAppLoginResponse(req, res) {
    const pin = String(req.body?.pin || '');
    const identity = normalizeAgendaAppIdentity(req.body?.who || req.body?.identity || '');
    const email = getAgendaAppIdentityEmail(identity);

    res.setHeader('Cache-Control', 'no-store, private');

    const { hydrated, users } = await loadUsersForLogin();

    if (!sessionSecret) {
      appendAuditEvent(
        req,
        {
          type: 'agenda_app_login_rejected',
          severity: 'warning',
          success: false,
          email,
          detail: 'Agenda-app login niet geconfigureerd: sessie-secret ontbreekt.',
        },
        'security_agenda_app_login_rejected'
      );
      return res.status(503).json({
        ok: false,
        error:
          'Agenda-app toegang is nog niet volledig ingesteld op de server.',
      });
    }

    if (!isAgendaAppPinConfigured()) {
      appendAuditEvent(
        req,
        {
          type: 'agenda_app_login_rejected',
          severity: 'warning',
          success: false,
          email,
          detail: 'Agenda-app login niet geconfigureerd: pincode ontbreekt.',
        },
        'security_agenda_app_login_rejected'
      );
      return res.status(503).json({
        ok: false,
        error:
          'Agenda-app toegang is nog niet volledig ingesteld op de server.',
      });
    }

    if (users.length === 0) {
      const isTemporaryUserStoreFailure = hydrated?.source === 'unavailable';
      appendAuditEvent(
        req,
        {
          type: 'agenda_app_login_rejected',
          severity: 'warning',
          success: false,
          email,
          detail: isTemporaryUserStoreFailure
            ? 'Agenda-app login tijdelijk niet beschikbaar: gebruikerslijst kon niet worden geladen.'
            : 'Agenda-app login niet geconfigureerd: geen premium gebruikers gevonden.',
        },
        'security_agenda_app_login_rejected'
      );
      return res.status(503).json({
        ok: false,
        error: isTemporaryUserStoreFailure
          ? 'Agenda-app toegang is tijdelijk niet beschikbaar. Probeer het zo opnieuw.'
          : 'Agenda-app toegang is nog niet volledig ingesteld op de server.',
      });
    }

    if (!identity || !email) {
      appendAuditEvent(
        req,
        {
          type: 'agenda_app_login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Agenda-app identiteit ontbreekt of is ongeldig.',
        },
        'security_agenda_app_login_failed'
      );
      return res.status(400).json({
        ok: false,
        error: 'Kies Martijn of Servé.',
      });
    }

    if (!pin) {
      appendAuditEvent(
        req,
        {
          type: 'agenda_app_login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Agenda-app pincode ontbreekt.',
        },
        'security_agenda_app_login_failed'
      );
      return res.status(400).json({
        ok: false,
        error: 'Vul je pincode in.',
      });
    }

    const matchedUser = findAgendaAppUser(users, email, identity);
    if (!matchedUser || !isAgendaAppPinValid(pin)) {
      appendAuditEvent(
        req,
        {
          type: 'agenda_app_login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Agenda-app pincode of gebruiker ongeldig.',
        },
        'security_agenda_app_login_failed'
      );
      return res.status(401).json({
        ok: false,
        error: 'Pincode klopt niet.',
      });
    }

    if (premiumUsersStore.normalizeUserStatus(matchedUser.status) !== 'active') {
      appendAuditEvent(
        req,
        {
          type: 'agenda_app_login_failed',
          severity: 'warning',
          success: false,
          email,
          detail: 'Agenda-app login geweigerd omdat het account inactief is.',
        },
        'security_agenda_app_login_failed'
      );
      return res.status(403).json({
        ok: false,
        error: 'Dit account is gedeactiveerd.',
      });
    }

    const sessionMaxAgeMs = getAgendaAppSessionMaxAgeMs();
    const sessionEmail = normalizePremiumSessionEmail(matchedUser.email || email);
    const sessionToken = createPremiumSessionToken({
      email: sessionEmail,
      maxAgeMs: sessionMaxAgeMs,
      userId: matchedUser.id,
      role: matchedUser.role,
    });
    setPremiumSessionCookie(req, res, sessionToken, sessionMaxAgeMs);

    appendAuditEvent(
      req,
      {
        type: 'agenda_app_login_success',
        severity: 'info',
        success: true,
        email: sessionEmail,
        detail: 'Agenda-app login succesvol met langdurige sessie.',
      },
      'security_agenda_app_login_success'
    );

    return res.status(200).json({
      ok: true,
      authenticated: true,
      who: identity,
      email: sessionEmail,
      role: matchedUser.role,
      displayName: getUserDisplayName(matchedUser),
    });
  }

  async function logoutResponse(req, res) {
    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');
    clearPremiumSessionCookie(req, res);
    appendAuditEvent(
      req,
      {
        type: 'logout',
        severity: 'info',
        success: true,
        email: authState.email || '',
        detail: 'Premium sessie uitgelogd.',
      },
      'security_logout'
    );
    return res.status(200).json({ ok: true, authenticated: false });
  }

  return {
    agendaAppLoginResponse,
    loginResponse,
    logoutResponse,
    sendSessionResponse,
  };
}

module.exports = {
  createPremiumAuthRouteCoordinator,
};
