function createLeadOwnerService(deps = {}) {
  const {
    premiumUsersStore,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    normalizePremiumSessionEmail = (value) => normalizeString(value).toLowerCase(),
    leadOwnerAssignmentsByCallId = new Map(),
    getNextLeadOwnerRotationIndex = () => 0,
    setNextLeadOwnerRotationIndex = () => {},
    queueRuntimeStatePersist = () => {},
  } = deps;

  function normalizeLeadOwnerKey(value) {
    const normalized = normalizeString(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (normalized.includes('serve')) return 'serve';
    if (normalized.includes('martijn')) return 'martijn';
    return normalized;
  }

  function buildLeadOwnerFallbackRecord(key) {
    if (key === 'martijn') {
      return {
        key: 'martijn',
        displayName: 'Martijn van de Ven',
        fullName: 'Martijn van de Ven',
        userId: '',
        email: '',
      };
    }
    return {
      key: 'serve',
      displayName: 'Servé Creusen',
      fullName: 'Servé Creusen',
      userId: '',
      email: '',
    };
  }

  function buildLeadOwnerRecordFromUser(user, fallbackKey) {
    const fallback = buildLeadOwnerFallbackRecord(fallbackKey);
    const fullName =
      premiumUsersStore?.buildUserDisplayName(user) || fallback.fullName;
    return {
      key: fallback.key,
      displayName: fullName,
      fullName,
      userId: truncateText(normalizeString(user?.id || ''), 120),
      email: normalizePremiumSessionEmail(user?.email || ''),
    };
  }

  function getLeadOwnerPool() {
    const activeUsers = (premiumUsersStore?.getCachedUsers() || []).filter(
      (user) => user && normalizeString(user?.status || '').toLowerCase() !== 'inactive'
    );

    const serveUser =
      activeUsers.find((user) => {
        const display = normalizeLeadOwnerKey(premiumUsersStore?.buildUserDisplayName(user));
        const email = normalizeLeadOwnerKey(user?.email || '');
        return display.includes('serve') || email.includes('serve');
      }) || null;
    const martijnUser =
      activeUsers.find((user) => {
        const display = normalizeLeadOwnerKey(premiumUsersStore?.buildUserDisplayName(user));
        const email = normalizeLeadOwnerKey(user?.email || '');
        return display.includes('martijn') || email.includes('martijn');
      }) || null;

    return [
      serveUser
        ? buildLeadOwnerRecordFromUser(serveUser, 'serve')
        : buildLeadOwnerFallbackRecord('serve'),
      martijnUser
        ? buildLeadOwnerRecordFromUser(martijnUser, 'martijn')
        : buildLeadOwnerFallbackRecord('martijn'),
    ];
  }

  function normalizeLeadOwnerRecord(value) {
    if (!value || typeof value !== 'object') return null;
    const fallbackKey =
      normalizeLeadOwnerKey(
        value.key || value.displayName || value.fullName || value.email || ''
      ) || 'serve';
    const fallback = buildLeadOwnerFallbackRecord(fallbackKey);
    const rawDisplayName = truncateText(
      normalizeString(value.displayName || value.name || ''),
      80
    );
    const rawFullName =
      truncateText(
        normalizeString(value.fullName || value.displayName || value.name || ''),
        160
      ) || rawDisplayName;
    const looksLikeUsername = (input) => {
      const text = normalizeString(input || '');
      if (!text) return true;
      if (/\s/.test(text)) return false;
      return /^[a-z0-9._-]{3,}$/i.test(text);
    };
    const forceFallbackHumanName =
      (fallback.key === 'martijn' || fallback.key === 'serve') &&
      (looksLikeUsername(rawDisplayName) || looksLikeUsername(rawFullName));
    return {
      key: fallback.key,
      displayName: forceFallbackHumanName
        ? fallback.displayName
        : rawDisplayName || fallback.displayName,
      fullName: forceFallbackHumanName
        ? fallback.fullName
        : rawFullName || fallback.fullName,
      userId: truncateText(normalizeString(value.userId || value.id || ''), 120),
      email: normalizePremiumSessionEmail(value.email || ''),
    };
  }

  function getOrAssignLeadOwnerByCallId(callId, options = {}) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;

    const existing = normalizeLeadOwnerRecord(
      leadOwnerAssignmentsByCallId.get(normalizedCallId)
    );
    if (existing) {
      leadOwnerAssignmentsByCallId.set(normalizedCallId, existing);
      return existing;
    }

    if (options.createIfMissing === false) return null;

    const pool = getLeadOwnerPool();
    if (!pool.length) return null;
    const index = Math.abs(Number(getNextLeadOwnerRotationIndex()) || 0) % pool.length;
    const assigned = normalizeLeadOwnerRecord(pool[index]);
    setNextLeadOwnerRotationIndex((index + 1) % pool.length);
    leadOwnerAssignmentsByCallId.set(normalizedCallId, assigned);
    queueRuntimeStatePersist('lead_owner_assignment');
    return assigned;
  }

  function buildLeadOwnerFields(callId, existingValue = null) {
    const existing = normalizeLeadOwnerRecord(existingValue);
    if (existing) {
      return {
        leadOwnerKey: existing.key,
        leadOwnerName: existing.displayName,
        leadOwnerFullName: existing.fullName,
        leadOwnerUserId: existing.userId,
        leadOwnerEmail: existing.email,
      };
    }

    const assigned = getOrAssignLeadOwnerByCallId(callId);
    if (!assigned) {
      return {
        leadOwnerKey: '',
        leadOwnerName: '',
        leadOwnerFullName: '',
        leadOwnerUserId: '',
        leadOwnerEmail: '',
      };
    }

    return {
      leadOwnerKey: assigned.key,
      leadOwnerName: assigned.displayName,
      leadOwnerFullName: assigned.fullName,
      leadOwnerUserId: assigned.userId,
      leadOwnerEmail: assigned.email,
    };
  }

  return {
    buildLeadOwnerFallbackRecord,
    buildLeadOwnerFields,
    getLeadOwnerPool,
    getOrAssignLeadOwnerByCallId,
    normalizeLeadOwnerKey,
    normalizeLeadOwnerRecord,
  };
}

module.exports = {
  createLeadOwnerService,
};
