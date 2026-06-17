const DEFAULT_TABLE = 'softora_outbound_recipient_guards';
const DEFAULT_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
const PERSONAL_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
]);

function defaultNormalizeString(value) {
  return String(value || '').trim();
}

function normalizeEmailAddress(value, normalizeString = defaultNormalizeString) {
  const raw = normalizeString(value)
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
  const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?/i);
  return (match ? match[0] : raw)
    .replace(/[<>()"[\]]/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

function normalizeGuardKeyPart(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/g, '')
    .replace(/[^a-z0-9@._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function normalizeDomainKeyPart(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function normalizeCompanyKeyPart(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function normalizeDomain(value, normalizeString = defaultNormalizeString) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return normalizeDomainKeyPart(new URL(candidate).hostname, normalizeString);
  } catch (_error) {
    return normalizeDomainKeyPart(raw, normalizeString);
  }
}

function getEmailDomain(email) {
  const normalized = normalizeEmailAddress(email);
  const parts = normalized.split('@');
  return parts.length === 2 ? parts[1].replace(/\.+$/g, '') : '';
}

function getNonPersonalEmailDomain(email) {
  const domain = getEmailDomain(email);
  return domain && !PERSONAL_MAILBOX_DOMAINS.has(domain) ? domain : '';
}

function normalizeIdentity(identity = {}, normalizeString = defaultNormalizeString) {
  const recipientEmail = normalizeEmailAddress(identity.recipientEmail || identity.email, normalizeString);
  const recipientDomain =
    normalizeDomain(identity.recipientDomain || identity.domain || identity.websiteDomain, normalizeString) ||
    normalizeDomain(getNonPersonalEmailDomain(recipientEmail), normalizeString);
  const recipientCompanyKey = normalizeCompanyKeyPart(
    identity.recipientCompanyKey || identity.companyKey || identity.company || identity.recipientCompany,
    normalizeString
  );
  const recipientId = normalizeGuardKeyPart(identity.recipientId || identity.customerId || identity.id, normalizeString);
  const recipientKey = normalizeString(identity.recipientKey || identity.key);
  return {
    recipientKey,
    recipientEmail,
    recipientDomain,
    recipientCompanyKey,
    recipientId,
    recipientCompany: normalizeString(identity.recipientCompany || identity.company),
  };
}

function getIdentityKeyRows(identity = {}, normalizeString = defaultNormalizeString) {
  const normalized = normalizeIdentity(identity, normalizeString);
  const rows = [
    ['email', normalized.recipientEmail],
    ['domain', normalized.recipientDomain],
    ['company', normalized.recipientCompanyKey],
    ['id', normalized.recipientId],
  ]
    .filter(([, value]) => value)
    .map(([type, value]) => ({
      keyType: type,
      keyValue: value,
      guardKey: `${type}:${value}`,
      identity: normalized,
    }));
  if (normalized.recipientKey && !rows.some((row) => row.guardKey === normalized.recipientKey)) {
    const keyValue = normalizeGuardKeyPart(normalized.recipientKey, normalizeString);
    if (keyValue) {
      rows.push({
        keyType: 'custom',
        keyValue,
        guardKey: `custom:${keyValue}`,
        identity: normalized,
      });
    }
  }
  return rows;
}

function createOutboundRecipientGuardStore(deps = {}) {
  const {
    table = DEFAULT_TABLE,
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    normalizeString = defaultNormalizeString,
    truncateText = (value, maxLength = 500) => defaultNormalizeString(value).slice(0, maxLength),
    now = () => new Date(),
    logger = console,
  } = deps;

  function getClient() {
    if (!isSupabaseConfigured()) return null;
    return getSupabaseClient();
  }

  function buildReservationId(source = 'outbound') {
    const random = Math.random().toString(36).slice(2, 10);
    return `${normalizeGuardKeyPart(source, normalizeString) || 'outbound'}-${Date.now().toString(36)}-${random}`;
  }

  async function pruneExpiredReservations(client) {
    const current = now().toISOString();
    await client
      .from(table)
      .delete()
      .eq('permanent', false)
      .lt('expires_at', current);
  }

  async function findRecipientConflictByKeys(client, keys = []) {
    const uniqueKeys = Array.from(new Set((Array.isArray(keys) ? keys : []).map(normalizeString).filter(Boolean)));
    if (!uniqueKeys.length) return null;
    for (let index = 0; index < uniqueKeys.length; index += 500) {
      const keyChunk = uniqueKeys.slice(index, index + 500);
      const { data, error } = await client
        .from(table)
        .select('*')
        .in('guard_key', keyChunk)
        .limit(1);
      if (error) throw error;
      if (Array.isArray(data) && data.length) return data[0];
    }
    return null;
  }

  async function findRecipientConflict(identity = {}) {
    const client = getClient();
    if (!client) return null;
    const keys = getIdentityKeyRows(identity, normalizeString).map((row) => row.guardKey);
    return findRecipientConflictByKeys(client, keys);
  }

  function buildRowsForReservation(items = [], options = {}) {
    const at = normalizeString(options.at) || now().toISOString();
    const reservationId = normalizeString(options.reservationId) || buildReservationId(options.source);
    const expiresAt =
      options.permanent === true
        ? null
        : new Date(new Date(at).getTime() + (Number(options.ttlMs) || DEFAULT_RESERVATION_TTL_MS)).toISOString();
    const rows = [];
    (Array.isArray(items) ? items : [items]).forEach((identity) => {
      getIdentityKeyRows(identity, normalizeString).forEach((keyRow) => {
        rows.push({
          guard_key: keyRow.guardKey,
          key_type: keyRow.keyType,
          key_value: keyRow.keyValue,
          reservation_id: reservationId,
          provider: truncateText(normalizeString(options.provider), 80),
          channel: truncateText(normalizeString(options.channel), 80),
          sender_email: normalizeEmailAddress(options.senderEmail, normalizeString),
          recipient_email: keyRow.identity.recipientEmail,
          recipient_domain: keyRow.identity.recipientDomain,
          recipient_company_key: keyRow.identity.recipientCompanyKey,
          recipient_id: keyRow.identity.recipientId,
          recipient_company: truncateText(keyRow.identity.recipientCompany, 160),
          status: truncateText(normalizeString(options.status) || 'reserved', 80),
          source: truncateText(normalizeString(options.source), 120),
          actor: truncateText(normalizeString(options.actor), 160),
          permanent: options.permanent === true,
          payload: options.payload && typeof options.payload === 'object' ? options.payload : {},
          expires_at: expiresAt,
          last_seen_at: at,
          updated_at: at,
        });
      });
    });
    return { reservationId, rows };
  }

  async function reserveRecipients(items = [], options = {}) {
    const client = getClient();
    if (!client) return { ok: false, skipped: true, reason: 'supabase_not_configured', expectedCount: 0 };
    await pruneExpiredReservations(client);
    const { reservationId, rows } = buildRowsForReservation(items, options);
    if (!rows.length) return { ok: false, skipped: true, reason: 'no_recipient_identity', reservationId, expectedCount: 0 };
    const existingConflict = await findRecipientConflictByKeys(
      client,
      rows.map((row) => row.guard_key)
    );
    if (existingConflict) {
      return {
        ok: false,
        conflict: existingConflict,
        reservationId,
        expectedCount: rows.length,
      };
    }
    const { data, error } = await client
      .from(table)
      .insert(rows)
      .select('*');
    if (error) {
      if (String(error.code || '') === '23505' || /duplicate key|unique/i.test(String(error.message || ''))) {
        const conflict = await findRecipientConflictByKeys(
          client,
          rows.map((row) => row.guard_key)
        );
        return {
          ok: false,
          conflict: conflict || {
            guard_key: rows[0].guard_key,
            recipient_email: rows[0].recipient_email,
            recipient_domain: rows[0].recipient_domain,
            recipient_company: rows[0].recipient_company,
          },
          reservationId,
          expectedCount: rows.length,
        };
      }
      logger.warn('[OutboundRecipientGuard][reserve]', error && error.message ? error.message : error);
      throw error;
    }
    return { ok: true, reservationId, count: Array.isArray(data) ? data.length : rows.length, expectedCount: rows.length };
  }

  async function confirmReservation(reservationId, options = {}) {
    const client = getClient();
    const id = normalizeString(reservationId);
    if (!client || !id) return { ok: false, skipped: true };
    const at = normalizeString(options.at) || now().toISOString();
    const patch = {
      status: truncateText(normalizeString(options.status) || 'sent', 80),
      permanent: options.permanent !== false,
      expires_at: options.permanent === false ? options.expiresAt || null : null,
      last_seen_at: at,
      updated_at: at,
    };
    if (options.payload && typeof options.payload === 'object') patch.payload = options.payload;
    const { data, error } = await client
      .from(table)
      .update(patch)
      .eq('reservation_id', id)
      .select('guard_key');
    if (error) throw error;
    const count = Array.isArray(data) ? data.length : 0;
    if (count <= 0) return { ok: false, reason: 'reservation_not_found', count };
    return { ok: true, count };
  }

  function mergeSentRecipientGroup(target, row = {}) {
    [
      'recipient_email',
      'recipient_domain',
      'recipient_company_key',
      'recipient_id',
      'recipient_company',
      'sender_email',
      'provider',
      'channel',
      'source',
      'actor',
      'updated_at',
      'last_seen_at',
      'created_at',
    ].forEach((field) => {
      if (!normalizeString(target[field]) && normalizeString(row[field])) target[field] = row[field];
    });
    return target;
  }

  async function listSentRecipientGroups(options = {}) {
    const client = getClient();
    if (!client) return [];
    const maxRows = Math.max(1, Math.min(20_000, Number(options.maxRows) || 10_000));
    const provider = normalizeString(options.provider);
    const channel = normalizeString(options.channel);
    const selectColumns = 'reservation_id,guard_key,key_type,key_value,provider,channel,sender_email,recipient_email,recipient_domain,recipient_company_key,recipient_id,recipient_company,status,source,actor,permanent,created_at,updated_at,last_seen_at';
    const buildQuery = () => {
      let query = client
        .from(table)
        .select(selectColumns)
        .eq('status', 'sent')
        .eq('permanent', true);
      if (provider && query && typeof query.eq === 'function') query = query.eq('provider', provider);
      if (channel && query && typeof query.eq === 'function') query = query.eq('channel', channel);
      if (query && typeof query.order === 'function') query = query.order('updated_at', { ascending: false });
      return query;
    };
    const rows = [];
    const pageSize = Math.min(1000, maxRows);
    const firstQuery = buildQuery();
    if (firstQuery && typeof firstQuery.range === 'function') {
      for (let from = 0; from < maxRows; from += pageSize) {
        const to = Math.min(maxRows - 1, from + pageSize - 1);
        const { data, error } = await buildQuery().range(from, to);
        if (error) throw error;
        const pageRows = Array.isArray(data) ? data : [];
        rows.push(...pageRows);
        if (pageRows.length < pageSize) break;
      }
    } else {
      const query = firstQuery && typeof firstQuery.limit === 'function' ? firstQuery.limit(maxRows) : firstQuery;
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(Array.isArray(data) ? data : []));
    }
    const groups = new Map();
    rows.slice(0, maxRows).forEach((row) => {
      const reservationId = normalizeString(row && row.reservation_id);
      const fallbackKey = [
        normalizeEmailAddress(row && row.recipient_email, normalizeString),
        normalizeDomainKeyPart(row && row.recipient_domain, normalizeString),
        normalizeCompanyKeyPart(row && row.recipient_company_key, normalizeString),
        normalizeGuardKeyPart(row && row.recipient_id, normalizeString),
        normalizeString(row && (row.last_seen_at || row.updated_at || row.created_at)),
      ].join('|');
      const groupKey = reservationId || fallbackKey;
      if (!groupKey) return;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          reservation_id: reservationId,
          recipient_email: '',
          recipient_domain: '',
          recipient_company_key: '',
          recipient_id: '',
          recipient_company: '',
          sender_email: '',
          provider: '',
          channel: '',
          source: '',
          actor: '',
          updated_at: '',
          last_seen_at: '',
          created_at: '',
        });
      }
      mergeSentRecipientGroup(groups.get(groupKey), row);
    });
    return Array.from(groups.values());
  }

  async function releaseReservation(reservationId) {
    const client = getClient();
    const id = normalizeString(reservationId);
    if (!client || !id) return { ok: false, skipped: true };
    const { error } = await client
      .from(table)
      .delete()
      .eq('reservation_id', id)
      .eq('status', 'reserved');
    if (error) throw error;
    return { ok: true };
  }

  return {
    findRecipientConflict,
    reserveRecipients,
    confirmReservation,
    listSentRecipientGroups,
    releaseReservation,
  };
}

module.exports = {
  createOutboundRecipientGuardStore,
  getIdentityKeyRows,
  normalizeIdentity,
};
