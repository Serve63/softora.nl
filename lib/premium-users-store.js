const crypto = require('crypto');

function createPremiumUsersStore({ config = {}, deps = {} } = {}) {
  const {
    premiumLoginEmails = [],
    premiumLoginPassword = '',
    premiumLoginPasswordHash = '',
    premiumSessionSecret = '',
    premiumAuthUsersRowKey = 'premium_auth_users',
    premiumAuthUsersVersion = 1,
    supabaseStateTable = '',
  } = config;

  const {
    normalizeString,
    truncateText,
    timingSafeEqualStrings,
    normalizePremiumSessionEmail,
    isSupabaseConfigured,
    getSupabaseClient,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
  } = deps;

  const usersCache = [];
  let usersHydrated = false;
  let usersHydrationPromise = null;
  let usersUpdatedAt = '';

  function verifyPasswordHash(password, passwordHash) {
    const rawPassword = String(password || '');
    const rawHash = normalizeString(passwordHash);
    if (!rawPassword || !rawHash) return false;

    if (/^sha256:/i.test(rawHash)) {
      const expectedHex = rawHash.replace(/^sha256:/i, '').trim().toLowerCase();
      const digestHex = crypto.createHash('sha256').update(rawPassword).digest('hex').toLowerCase();
      return timingSafeEqualStrings(digestHex, expectedHex);
    }

    if (/^scrypt:/i.test(rawHash)) {
      const [, saltBase64 = '', derivedKeyBase64 = ''] = rawHash.split(':');
      if (!saltBase64 || !derivedKeyBase64) return false;
      try {
        const salt = Buffer.from(saltBase64, 'base64');
        const expectedBuffer = Buffer.from(derivedKeyBase64, 'base64');
        const derivedBuffer = crypto.scryptSync(rawPassword, salt, expectedBuffer.length);
        return crypto.timingSafeEqual(derivedBuffer, expectedBuffer);
      } catch {
        return false;
      }
    }

    return false;
  }

  function createPasswordHash(password) {
    const rawPassword = String(password || '');
    if (!rawPassword) return '';
    const saltBuffer = crypto.randomBytes(16);
    const derivedBuffer = crypto.scryptSync(rawPassword, saltBuffer, 64);
    return `scrypt:${saltBuffer.toString('base64')}:${derivedBuffer.toString('base64')}`;
  }

  function normalizeUserRole(value) {
    return normalizeString(value || '').toLowerCase() === 'admin' ? 'admin' : 'medewerker';
  }

  function normalizeUserStatus(value) {
    return normalizeString(value || '').toLowerCase() === 'inactive' ? 'inactive' : 'active';
  }

  function isAdminRole(value) {
    return normalizeUserRole(value) === 'admin';
  }

  function createUserId() {
    return `usr_${crypto.randomBytes(8).toString('hex')}`;
  }

  function deriveUserFirstNameFromEmail(email) {
    const normalizedEmail = normalizePremiumSessionEmail(email);
    const localPart = normalizedEmail.split('@')[0] || '';
    const firstToken = localPart.split(/[._-]+/).find(Boolean) || localPart || 'Gebruiker';
    const cleaned = firstToken.replace(/[^a-z0-9]+/gi, '');
    if (!cleaned) return 'Gebruiker';
    return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
  }

  function sanitizeUserRecord(raw, options = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const email = normalizePremiumSessionEmail(raw.email || raw.mail || '');
    const passwordHash = normalizeString(raw.passwordHash || '');
    if (!email || !passwordHash) return null;

    const nowIso = new Date().toISOString();
    const firstName =
      truncateText(normalizeString(raw.firstName || raw.voornaam || ''), 80) ||
      deriveUserFirstNameFromEmail(email);
    const lastName = truncateText(normalizeString(raw.lastName || raw.achternaam || ''), 80);

    return {
      id: truncateText(normalizeString(raw.id || createUserId()), 120) || createUserId(),
      firstName,
      lastName,
      email,
      role: normalizeUserRole(raw.role || options.role || 'medewerker'),
      status: normalizeUserStatus(raw.status || options.status || 'active'),
      passwordHash,
      source: truncateText(normalizeString(raw.source || options.source || 'managed'), 60) || 'managed',
      createdAt: normalizeString(raw.createdAt || nowIso) || nowIso,
      updatedAt: normalizeString(raw.updatedAt || nowIso) || nowIso,
    };
  }

  function sanitizeUsersCollection(list) {
    if (!Array.isArray(list)) return [];
    const normalized = [];
    const seenEmails = new Set();
    for (const rawItem of list) {
      const item = sanitizeUserRecord(rawItem);
      if (!item) continue;
      if (seenEmails.has(item.email)) continue;
      seenEmails.add(item.email);
      normalized.push(item);
    }
    return normalized;
  }

  function setUsersCache(users, updatedAt = new Date().toISOString()) {
    const sanitizedUsers = sanitizeUsersCollection(users);
    usersCache.splice(0, usersCache.length, ...sanitizedUsers);
    usersUpdatedAt = normalizeString(updatedAt || '') || new Date().toISOString();
    usersHydrated = true;
    return usersCache;
  }

  function buildBootstrapUsers() {
    const passwordHash = premiumLoginPasswordHash || createPasswordHash(premiumLoginPassword);
    if (!premiumLoginEmails.length || !passwordHash) return [];
    const nowIso = new Date().toISOString();
    return sanitizeUsersCollection(
      premiumLoginEmails.map((email) => ({
        id: createUserId(),
        firstName: deriveUserFirstNameFromEmail(email),
        lastName: '',
        email,
        role: 'admin',
        status: 'active',
        passwordHash,
        source: 'bootstrap_env',
        createdAt: nowIso,
        updatedAt: nowIso,
      }))
    );
  }

  function findUserByEmail(users, email) {
    const normalizedEmail = normalizePremiumSessionEmail(email);
    if (!normalizedEmail || !Array.isArray(users)) return null;
    return users.find((item) => item && item.email === normalizedEmail) || null;
  }

  function findUserById(users, userId) {
    const normalizedId = truncateText(normalizeString(userId || ''), 120);
    if (!normalizedId || !Array.isArray(users)) return null;
    return users.find((item) => item && item.id === normalizedId) || null;
  }

  function countActiveAdmins(users) {
    if (!Array.isArray(users)) return 0;
    return users.filter(
      (item) => item && normalizeUserStatus(item.status) === 'active' && isAdminRole(item.role)
    ).length;
  }

  function buildUserDisplayName(user) {
    const firstName = truncateText(normalizeString(user?.firstName || ''), 80);
    const lastName = truncateText(normalizeString(user?.lastName || ''), 80);
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || normalizePremiumSessionEmail(user?.email || '') || 'Onbekende gebruiker';
  }

  function sanitizeUserForClient(user) {
    if (!user || typeof user !== 'object') return null;
    return {
      id: truncateText(normalizeString(user.id || ''), 120),
      voornaam: truncateText(normalizeString(user.firstName || ''), 80),
      achternaam: truncateText(normalizeString(user.lastName || ''), 80),
      email: normalizePremiumSessionEmail(user.email || ''),
      rol: normalizeUserRole(user.role),
      status: normalizeUserStatus(user.status),
      displayName: buildUserDisplayName(user),
      createdAt: normalizeString(user.createdAt || ''),
      updatedAt: normalizeString(user.updatedAt || ''),
    };
  }

  async function persistUsersCollection(users, meta = {}) {
    const sanitizedUsers = sanitizeUsersCollection(users);
    const updatedAt = new Date().toISOString();
    setUsersCache(sanitizedUsers, updatedAt);

    if (!isSupabaseConfigured()) {
      return { users: usersCache.slice(), source: 'memory', updatedAt };
    }

    const row = {
      state_key: premiumAuthUsersRowKey,
      payload: {
        version: premiumAuthUsersVersion,
        users: sanitizedUsers,
      },
      meta: {
        type: 'premium_auth_users',
        source: truncateText(normalizeString(meta.source || 'server'), 80),
        reason: truncateText(normalizeString(meta.reason || ''), 200),
        actorEmail: normalizePremiumSessionEmail(meta.actorEmail || ''),
      },
      updated_at: updatedAt,
    };

    try {
      const client = getSupabaseClient();
      if (!client) {
        return { users: usersCache.slice(), source: 'memory', updatedAt };
      }
      const { error } = await client.from(supabaseStateTable).upsert(row, {
        onConflict: 'state_key',
      });
      if (error) {
        const fallback = await upsertSupabaseRowViaRest(row);
        if (!fallback.ok) {
          console.error('[PremiumUsers][PersistError]', error.message || error);
          return { users: usersCache.slice(), source: 'memory', updatedAt };
        }
      }
      return { users: usersCache.slice(), source: 'supabase', updatedAt };
    } catch (error) {
      console.error('[PremiumUsers][PersistCrash]', error?.message || error);
      return { users: usersCache.slice(), source: 'memory', updatedAt };
    }
  }

  async function ensureUsersHydrated(options = {}) {
    const force = Boolean(options && options.force);
    if (usersHydrated && !force) {
      return { users: usersCache.slice(), updatedAt: usersUpdatedAt, source: 'memory' };
    }
    if (usersHydrationPromise) return usersHydrationPromise;

    usersHydrationPromise = (async () => {
      const bootstrapUsers = buildBootstrapUsers();

      if (!isSupabaseConfigured()) {
        setUsersCache(bootstrapUsers, new Date().toISOString());
        return { users: usersCache.slice(), updatedAt: usersUpdatedAt, source: 'memory' };
      }

      try {
        const client = getSupabaseClient();
        let row = null;

        if (client) {
          const { data, error } = await client
            .from(supabaseStateTable)
            .select('payload, updated_at')
            .eq('state_key', premiumAuthUsersRowKey)
            .maybeSingle();

          if (!error) {
            row = data || null;
          } else {
            const fallback = await fetchSupabaseRowByKeyViaRest(
              premiumAuthUsersRowKey,
              'payload,updated_at'
            );
            if (fallback.ok) {
              row = Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
            }
          }
        }

        const storedUsers = sanitizeUsersCollection(row?.payload?.users || []);
        if (storedUsers.length > 0) {
          setUsersCache(storedUsers, row?.updated_at || new Date().toISOString());
          return { users: usersCache.slice(), updatedAt: usersUpdatedAt, source: 'supabase' };
        }

        setUsersCache(bootstrapUsers, new Date().toISOString());
        if (bootstrapUsers.length > 0) {
          return persistUsersCollection(bootstrapUsers, {
            source: 'bootstrap_env',
            reason: 'premium_users_bootstrap',
          });
        }

        return { users: usersCache.slice(), updatedAt: usersUpdatedAt, source: 'memory' };
      } catch (error) {
        console.error('[PremiumUsers][HydrateCrash]', error?.message || error);
        setUsersCache(bootstrapUsers, new Date().toISOString());
        return { users: usersCache.slice(), updatedAt: usersUpdatedAt, source: 'memory' };
      } finally {
        usersHydrationPromise = null;
      }
    })();

    return usersHydrationPromise;
  }

  function getCachedUsers() {
    return usersCache.slice();
  }

  function getUsersUpdatedAt() {
    return usersUpdatedAt;
  }

  function hasConfiguredUsers() {
    const hasBootstrapCredentials = Boolean(
      premiumLoginEmails.length && (premiumLoginPassword || premiumLoginPasswordHash)
    );
    return Boolean(premiumSessionSecret && (usersCache.length > 0 || hasBootstrapCredentials));
  }

  function validateUserEmail(value) {
    const email = normalizePremiumSessionEmail(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  function normalizeUserInputNames(input) {
    return {
      firstName: truncateText(normalizeString(input?.voornaam || input?.firstName || ''), 80),
      lastName: truncateText(normalizeString(input?.achternaam || input?.lastName || ''), 80),
    };
  }

  return {
    createPasswordHash,
    ensureUsersHydrated,
    findUserByEmail,
    findUserById,
    countActiveAdmins,
    buildUserDisplayName,
    sanitizeUserForClient,
    sanitizeUserRecord,
    persistUsersCollection,
    verifyPasswordHash,
    normalizeUserRole,
    normalizeUserStatus,
    isAdminRole,
    getCachedUsers,
    getUsersUpdatedAt,
    hasConfiguredUsers,
    validateUserEmail,
    normalizeUserInputNames,
  };
}

module.exports = {
  createPremiumUsersStore,
};
