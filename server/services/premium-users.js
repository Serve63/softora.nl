function createPremiumUserManagementCoordinator(deps = {}) {
  const {
    premiumUsersStore,
    buildPremiumAuthSessionPayload = () => ({ ok: true }),
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value) => String(value || '').trim(),
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '/',
    getRequestOriginFromHeaders = () => '',
  } = deps;

  function getRequestUserAgent(req) {
    return typeof req?.get === 'function' ? req.get('user-agent') : '';
  }

  function requireAuthenticatedPremiumAuthState(req, res) {
    const authState = req?.premiumAuth || null;
    if (!authState || !authState.authenticated) {
      res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
      return null;
    }
    return authState;
  }

  function requireAdminPremiumAuthState(req, res) {
    const authState = requireAuthenticatedPremiumAuthState(req, res);
    if (!authState) return null;
    if (!authState.isAdmin) {
      res.status(403).json({ ok: false, error: 'Alleen administrators hebben toegang.' });
      return null;
    }
    return authState;
  }

  async function loadPremiumUsers(options = {}) {
    const hydrated = await premiumUsersStore.ensureUsersHydrated({ force: options.force !== false });
    const users = Array.isArray(hydrated?.users) ? hydrated.users : premiumUsersStore.getCachedUsers();
    return { hydrated, users };
  }

  function sanitizeUsersForClient(users) {
    return users.map((user) => premiumUsersStore.sanitizeUserForClient(user));
  }

  function parsePremiumProfileDisplayName(value) {
    const displayName = truncateText(normalizeString(value || ''), 160);
    if (!displayName) return { firstName: '', lastName: '' };
    const parts = displayName.split(/\s+/).filter(Boolean);
    const firstName = truncateText(parts.shift() || '', 80);
    const lastName = truncateText(parts.join(' '), 80);
    return { firstName, lastName };
  }

  function appendAuditEvent(req, authState, payload, reason) {
    appendSecurityAuditEvent(
      {
        ...payload,
        email: authState?.email || '',
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: getRequestUserAgent(req),
      },
      reason
    );
  }

  async function getProfileResponse(req, res) {
    const authState = requireAuthenticatedPremiumAuthState(req, res);
    if (!authState) return res;

    return res.status(200).json({
      ok: true,
      user: premiumUsersStore.sanitizeUserForClient(authState.user),
      session: buildPremiumAuthSessionPayload(authState),
    });
  }

  async function updateProfileResponse(req, res) {
    const authState = requireAuthenticatedPremiumAuthState(req, res);
    if (!authState) return res;

    const { users } = await loadPremiumUsers({ force: true });
    const existingUser =
      premiumUsersStore.findUserById(users, authState.userId) ||
      premiumUsersStore.findUserByEmail(users, authState.email);

    if (!existingUser) {
      return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden.' });
    }

    const hasDisplayNameInput =
      req.body?.displayName !== undefined || req.body?.naam !== undefined || req.body?.fullName !== undefined;
    const avatarInputProvided = req.body?.avatarDataUrl !== undefined || req.body?.avatar !== undefined;
    const removeAvatar = /^(1|true|yes|on)$/i.test(String(req.body?.removeAvatar || ''));

    let nextFirstName = existingUser.firstName;
    let nextLastName = existingUser.lastName;
    if (hasDisplayNameInput) {
      const parsedNames = parsePremiumProfileDisplayName(
        req.body?.displayName || req.body?.naam || req.body?.fullName || ''
      );
      if (!parsedNames.firstName) {
        return res.status(400).json({ ok: false, error: 'Voer een geldige naam in.' });
      }
      nextFirstName = parsedNames.firstName;
      nextLastName = parsedNames.lastName;
    }

    let nextAvatarDataUrl = premiumUsersStore.sanitizeAvatarDataUrl(existingUser.avatarDataUrl || '');
    if (removeAvatar) {
      nextAvatarDataUrl = '';
    } else if (avatarInputProvided) {
      nextAvatarDataUrl = premiumUsersStore.sanitizeAvatarDataUrl(req.body?.avatarDataUrl || req.body?.avatar || '');
      const providedAvatarValue = normalizeString(req.body?.avatarDataUrl || req.body?.avatar || '');
      if (providedAvatarValue && !nextAvatarDataUrl) {
        return res.status(400).json({
          ok: false,
          error: 'Profielfoto moet een geldige PNG, JPG, WEBP of GIF data-url zijn.',
        });
      }
    }

    const nextUsers = users.map((user) => {
      if (user.id !== existingUser.id) return user;
      return premiumUsersStore.sanitizeUserRecord({
        ...user,
        firstName: nextFirstName,
        lastName: nextLastName,
        avatarDataUrl: nextAvatarDataUrl,
        updatedAt: new Date().toISOString(),
        source: 'self_service_profile',
      });
    });

    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, {
      source: 'premium_profile_update',
      reason: 'premium_profile_updated',
      actorEmail: authState.email,
    });
    if (!saved || saved.source !== 'supabase') {
      return res.status(503).json({
        ok: false,
        error: 'Profiel kon niet worden opgeslagen zonder geldige Supabase-opslag.',
      });
    }

    const updatedUser =
      premiumUsersStore.findUserById(saved.users, existingUser.id) ||
      premiumUsersStore.findUserByEmail(saved.users, authState.email);

    appendAuditEvent(
      req,
      authState,
      {
        type: 'premium_profile_updated',
        severity: 'info',
        success: true,
        detail: 'Premium gebruiker heeft eigen profiel bijgewerkt.',
      },
      'security_premium_profile_updated'
    );

    const refreshedAuthState = {
      ...authState,
      user: updatedUser,
      firstName: normalizeString(updatedUser?.firstName || ''),
      lastName: normalizeString(updatedUser?.lastName || ''),
      displayName: premiumUsersStore.buildUserDisplayName(updatedUser),
      avatarDataUrl: premiumUsersStore.sanitizeAvatarDataUrl(updatedUser?.avatarDataUrl || ''),
    };

    return res.status(200).json({
      ok: true,
      user: premiumUsersStore.sanitizeUserForClient(updatedUser),
      session: buildPremiumAuthSessionPayload(refreshedAuthState),
    });
  }

  async function listPremiumUsersResponse(req, res) {
    const authState = requireAdminPremiumAuthState(req, res);
    if (!authState) return res;

    const { hydrated, users } = await loadPremiumUsers({ force: true });
    return res.status(200).json({
      ok: true,
      users: sanitizeUsersForClient(users),
      updatedAt: hydrated?.updatedAt || premiumUsersStore.getUsersUpdatedAt() || null,
    });
  }

  async function createPremiumUserResponse(req, res) {
    const authState = requireAdminPremiumAuthState(req, res);
    if (!authState) return res;

    const { users } = await loadPremiumUsers({ force: true });
    const email = premiumUsersStore.validateUserEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    const { firstName, lastName } = premiumUsersStore.normalizeUserInputNames(req.body || {});
    const role = premiumUsersStore.normalizeUserRole(req.body?.rol || req.body?.role || 'medewerker');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'E-mail en wachtwoord zijn verplicht.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Wachtwoord moet minimaal 8 tekens bevatten.' });
    }
    if (premiumUsersStore.findUserByEmail(users, email)) {
      return res.status(409).json({ ok: false, error: 'Dit e-mailadres bestaat al.' });
    }

    const nowIso = new Date().toISOString();
    const nextUsers = users.concat([
      premiumUsersStore.sanitizeUserRecord({
        firstName,
        lastName,
        email,
        role,
        status: 'active',
        passwordHash: premiumUsersStore.createPasswordHash(password),
        source: 'managed_ui',
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
    ]);

    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, {
      source: 'premium_users_api_create',
      reason: 'premium_user_created',
      actorEmail: authState.email,
    });
    if (!saved || saved.source !== 'supabase') {
      return res.status(503).json({
        ok: false,
        error: 'Gebruiker kon niet worden opgeslagen zonder geldige Supabase-opslag.',
      });
    }

    const createdUser = premiumUsersStore.findUserByEmail(saved.users, email);
    appendAuditEvent(
      req,
      authState,
      {
        type: 'premium_user_created',
        severity: 'info',
        success: true,
        detail: `Premium gebruiker toegevoegd: ${email}.`,
      },
      'security_premium_user_created'
    );

    return res.status(201).json({
      ok: true,
      user: premiumUsersStore.sanitizeUserForClient(createdUser),
      users: sanitizeUsersForClient(saved.users),
    });
  }

  async function updatePremiumUserResponse(req, res, userIdRaw) {
    const authState = requireAdminPremiumAuthState(req, res);
    if (!authState) return res;

    const userId = truncateText(normalizeString(userIdRaw || ''), 120);
    const { users } = await loadPremiumUsers({ force: true });
    const existingUser = premiumUsersStore.findUserById(users, userId);
    if (!existingUser) {
      return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden.' });
    }

    const emailRaw = req.body?.email;
    const password = String(req.body?.password || '');
    const role = premiumUsersStore.normalizeUserRole(req.body?.rol || req.body?.role || existingUser.role);
    const status = premiumUsersStore.normalizeUserStatus(req.body?.status || existingUser.status);
    const nextEmail =
      emailRaw === undefined ? existingUser.email : premiumUsersStore.validateUserEmail(emailRaw);
    const { firstName, lastName } = premiumUsersStore.normalizeUserInputNames({
      firstName: req.body?.firstName === undefined ? existingUser.firstName : req.body?.firstName,
      lastName: req.body?.lastName === undefined ? existingUser.lastName : req.body?.lastName,
      voornaam: req.body?.voornaam,
      achternaam: req.body?.achternaam,
    });

    if (!nextEmail) {
      return res.status(400).json({ ok: false, error: 'Voer een geldig e-mailadres in.' });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Wachtwoord moet minimaal 8 tekens bevatten.' });
    }
    if (users.some((item) => item.id !== userId && item.email === nextEmail)) {
      return res.status(409).json({ ok: false, error: 'Dit e-mailadres is al in gebruik.' });
    }

    const nextUsers = users.map((user) => {
      if (user.id !== userId) return user;
      return premiumUsersStore.sanitizeUserRecord({
        ...user,
        firstName,
        lastName,
        email: nextEmail,
        role,
        status,
        passwordHash: password ? premiumUsersStore.createPasswordHash(password) : user.passwordHash,
        source: 'managed_ui',
        updatedAt: new Date().toISOString(),
      });
    });

    if (premiumUsersStore.countActiveAdmins(nextUsers) < 1) {
      return res.status(400).json({
        ok: false,
        error: 'Er moet altijd minimaal één actieve administrator overblijven.',
      });
    }

    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, {
      source: 'premium_users_api_update',
      reason: 'premium_user_updated',
      actorEmail: authState.email,
    });
    if (!saved || saved.source !== 'supabase') {
      return res.status(503).json({
        ok: false,
        error: 'Gebruiker kon niet worden bijgewerkt zonder geldige Supabase-opslag.',
      });
    }

    const updatedUser = premiumUsersStore.findUserById(saved.users, userId);
    appendAuditEvent(
      req,
      authState,
      {
        type: 'premium_user_updated',
        severity: 'info',
        success: true,
        detail: `Premium gebruiker bijgewerkt: ${nextEmail}.`,
      },
      'security_premium_user_updated'
    );

    return res.status(200).json({
      ok: true,
      user: premiumUsersStore.sanitizeUserForClient(updatedUser),
      users: sanitizeUsersForClient(saved.users),
    });
  }

  async function deletePremiumUserResponse(req, res, userIdRaw) {
    const authState = requireAdminPremiumAuthState(req, res);
    if (!authState) return res;

    const userId = truncateText(normalizeString(userIdRaw || ''), 120);
    const { users } = await loadPremiumUsers({ force: true });
    const existingUser = premiumUsersStore.findUserById(users, userId);
    if (!existingUser) {
      return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden.' });
    }

    const nextUsers = users.filter((user) => user.id !== userId);
    if (premiumUsersStore.countActiveAdmins(nextUsers) < 1) {
      return res.status(400).json({
        ok: false,
        error: 'Er moet altijd minimaal één actieve administrator overblijven.',
      });
    }

    const saved = await premiumUsersStore.persistUsersCollection(nextUsers, {
      source: 'premium_users_api_delete',
      reason: 'premium_user_deleted',
      actorEmail: authState.email,
    });
    if (!saved || saved.source !== 'supabase') {
      return res.status(503).json({
        ok: false,
        error: 'Gebruiker kon niet worden verwijderd zonder geldige Supabase-opslag.',
      });
    }

    appendAuditEvent(
      req,
      authState,
      {
        type: 'premium_user_deleted',
        severity: 'info',
        success: true,
        detail: `Premium gebruiker verwijderd: ${existingUser.email}.`,
      },
      'security_premium_user_deleted'
    );

    return res.status(200).json({
      ok: true,
      users: sanitizeUsersForClient(saved.users),
    });
  }

  return {
    createPremiumUserResponse,
    deletePremiumUserResponse,
    getProfileResponse,
    listPremiumUsersResponse,
    updatePremiumUserResponse,
    updateProfileResponse,
  };
}

module.exports = {
  createPremiumUserManagementCoordinator,
};
