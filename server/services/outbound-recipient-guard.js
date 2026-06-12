const crypto = require('node:crypto');
const { findOutreachSuppressionMatch } = require('./outreach-suppression');

const OUTBOUND_RECIPIENT_GUARDS_TABLE = 'softora_outbound_recipient_guards';

function defaultNormalizeString(value) {
  return String(value || '').trim();
}

function normalizeEmailAddress(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value).toLowerCase();
}

function normalizeGuardKeyPart(value, normalizeString = defaultNormalizeString) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function truncateValue(value, maxLength = 500) {
  return String(value || '').slice(0, maxLength);
}

function createGuardError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function createReservationId(source, now = () => new Date()) {
  const safeSource = normalizeGuardKeyPart(source || 'outbound-recipient-guard') || 'outbound-recipient-guard';
  const stamp = now().toISOString().replace(/[^0-9a-z]+/gi, '').slice(0, 15);
  const suffix = crypto.randomBytes(8).toString('hex');
  return `${safeSource}-${stamp}-${suffix}`;
}

function buildIdentityRowsForRecipient(input = {}, context = {}) {
  const {
    normalizeString = defaultNormalizeString,
    truncateText = truncateValue,
    reservationId,
    provider,
    channel,
    source,
    actor,
    status = 'reserved',
    permanent = true,
    at,
  } = context;
  const recipientEmail = normalizeEmailAddress(input.recipientEmail || input.email, normalizeString);
  const recipientDomain = normalizeGuardKeyPart(input.recipientDomain || input.domain, normalizeString);
  const recipientCompanyKey = normalizeGuardKeyPart(
    input.recipientCompanyKey || input.companyKey || input.recipientCompany || input.company,
    normalizeString
  );
  const recipientId = normalizeGuardKeyPart(input.recipientId || input.customerId || input.id, normalizeString);
  const identities = [
    ['email', recipientEmail],
    ['domain', recipientDomain],
    ['company', recipientCompanyKey],
    ['id', recipientId],
  ].filter(([, value]) => Boolean(value));

  return identities.map(([keyType, keyValue]) => ({
    guard_key: `${keyType}:${keyValue}`,
    key_type: keyType,
    key_value: keyValue,
    reservation_id: reservationId,
    provider: normalizeString(provider),
    channel: normalizeString(channel),
    sender_email: normalizeEmailAddress(input.senderEmail || context.senderEmail, normalizeString),
    recipient_email: recipientEmail,
    recipient_domain: recipientDomain,
    recipient_company_key: recipientCompanyKey,
    recipient_id: recipientId,
    recipient_company: truncateText(input.recipientCompany || input.company || '', 160),
    status: normalizeString(input.status || status) || 'reserved',
    source: normalizeString(input.source || source) || 'unknown',
    actor: truncateText(input.actor || actor || '', 160),
    permanent: input.permanent === undefined ? Boolean(permanent) : Boolean(input.permanent),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    expires_at: input.expiresAt || null,
    last_seen_at: at,
    created_at: at,
    updated_at: at,
  }));
}

function summarizeConflictRow(row = {}) {
  return {
    guardKey: row.guard_key || row.guardKey || '',
    keyType: row.key_type || row.keyType || '',
    keyValue: row.key_value || row.keyValue || '',
    provider: row.provider || '',
    channel: row.channel || '',
    senderEmail: row.sender_email || row.senderEmail || '',
    recipientEmail: row.recipient_email || row.recipientEmail || '',
    recipientDomain: row.recipient_domain || row.recipientDomain || '',
    recipientCompany: row.recipient_company || row.recipientCompany || '',
    status: row.status || '',
    source: row.source || '',
    permanent: row.permanent === true,
    createdAt: row.created_at || row.createdAt || '',
    updatedAt: row.updated_at || row.updatedAt || '',
  };
}

function createOutboundRecipientGuardService(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    normalizeString = defaultNormalizeString,
    truncateText = truncateValue,
    logger = console,
    now = () => new Date(),
  } = deps;

  function getClientOrThrow() {
    if (!isSupabaseConfigured()) {
      throw createGuardError(
        'Centrale outbound duplicate-guard is niet beschikbaar; er wordt geen mail verstuurd.',
        'OUTBOUND_RECIPIENT_GUARD_UNAVAILABLE'
      );
    }
    const client = getSupabaseClient();
    if (!client || typeof client.from !== 'function') {
      throw createGuardError(
        'Centrale outbound duplicate-guard kon niet worden verbonden; er wordt geen mail verstuurd.',
        'OUTBOUND_RECIPIENT_GUARD_UNAVAILABLE'
      );
    }
    return client;
  }

  async function findExistingGuardRows(client, guardKeys) {
    const keys = Array.from(new Set((Array.isArray(guardKeys) ? guardKeys : []).filter(Boolean)));
    if (!keys.length) return [];
    const { data, error } = await client
      .from(OUTBOUND_RECIPIENT_GUARDS_TABLE)
      .select(
        'guard_key,key_type,key_value,provider,channel,sender_email,recipient_email,recipient_domain,recipient_company,status,source,permanent,created_at,updated_at'
      )
      .in('guard_key', keys)
      .limit(Math.min(keys.length, 100));
    if (error) {
      logger.warn('[OutboundRecipientGuard][conflict-read]', error.message || error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  }

  async function reserveRecipients(recipients = [], options = {}) {
    const client = getClientOrThrow();
    const items = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);
    const reservationId = normalizeString(options.reservationId) || createReservationId(options.source, now);
    const at = (options.at instanceof Date ? options.at : now()).toISOString();
    const rows = items.flatMap((item) =>
      buildIdentityRowsForRecipient(item, {
        normalizeString,
        truncateText,
        reservationId,
        provider: options.provider,
        channel: options.channel,
        source: options.source,
        actor: options.actor,
        senderEmail: options.senderEmail,
        status: options.status || 'reserved',
        permanent: options.permanent === undefined ? true : options.permanent,
        at,
      })
    );
    const suppressed = items
      .map((item) => findOutreachSuppressionMatch(item))
      .find(Boolean);
    if (suppressed) {
      throw createGuardError(
        suppressed.message || 'Deze ontvanger is hard geblokkeerd voor outbound mail.',
        'OUTREACH_SUPPRESSION_HARD_BLOCK',
        {
          conflicts: [
            {
              guardKey: `domain:${suppressed.domain}`,
              keyType: 'domain',
              keyValue: suppressed.domain,
              status: 'blocked',
              source: 'hard-coded-outreach-suppression',
              permanent: true,
            },
          ],
        }
      );
    }
    if (!rows.length) {
      throw createGuardError(
        'Ontvanger mist een e-mail, domein, bedrijf en id; er wordt geen mail verstuurd.',
        'OUTBOUND_RECIPIENT_GUARD_IDENTITY_MISSING'
      );
    }

    const seen = new Map();
    for (const row of rows) {
      if (!seen.has(row.guard_key)) {
        seen.set(row.guard_key, row);
        continue;
      }
      throw createGuardError(
        'Deze batch bevat dezelfde ontvanger-identiteit meer dan één keer; er wordt niets verstuurd.',
        'OUTBOUND_RECIPIENT_GUARD_CONFLICT',
        {
          conflicts: [summarizeConflictRow(row)],
          reservationId,
        }
      );
    }

    const { data, error } = await client
      .from(OUTBOUND_RECIPIENT_GUARDS_TABLE)
      .insert(rows)
      .select('guard_key,key_type,key_value');

    if (error) {
      const conflicts = await findExistingGuardRows(client, rows.map((row) => row.guard_key));
      if (conflicts.length || error.code === '23505') {
        throw createGuardError(
          'Deze ontvanger is al eerder vastgezet in de centrale outbound duplicate-guard; er wordt geen mail verstuurd.',
          'OUTBOUND_RECIPIENT_GUARD_CONFLICT',
          {
            conflicts: conflicts.map(summarizeConflictRow),
            reservationId,
          }
        );
      }
      logger.error('[OutboundRecipientGuard][reserve]', error.message || error);
      throw createGuardError(
        'Centrale outbound duplicate-guard faalde; er wordt geen mail verstuurd.',
        'OUTBOUND_RECIPIENT_GUARD_UNAVAILABLE',
        { cause: error }
      );
    }

    return {
      ok: true,
      reservationId,
      count: items.length,
      guardRows: Array.isArray(data) ? data.length : rows.length,
    };
  }

  async function markReservationSent(reservationId, options = {}) {
    const cleanReservationId = normalizeString(reservationId);
    if (!cleanReservationId) return { ok: false, skipped: true };
    const client = getClientOrThrow();
    const sentAt = (options.at instanceof Date ? options.at : now()).toISOString();
    const patch = {
      status: 'sent',
      permanent: true,
      updated_at: sentAt,
      last_seen_at: sentAt,
    };
    const senderEmail = normalizeEmailAddress(options.senderEmail, normalizeString);
    if (senderEmail) patch.sender_email = senderEmail;
    const { error } = await client
      .from(OUTBOUND_RECIPIENT_GUARDS_TABLE)
      .update(patch)
      .eq('reservation_id', cleanReservationId);
    if (error) {
      logger.warn('[OutboundRecipientGuard][mark-sent]', error.message || error);
      return { ok: false, error };
    }
    return { ok: true, reservationId: cleanReservationId };
  }

  return {
    buildIdentityRowsForRecipient: (input, options = {}) =>
      buildIdentityRowsForRecipient(input, {
        normalizeString,
        truncateText,
        now,
        at: now().toISOString(),
        ...options,
      }),
    markReservationSent,
    reserveRecipients,
  };
}

module.exports = {
  OUTBOUND_RECIPIENT_GUARDS_TABLE,
  createOutboundRecipientGuardService,
  normalizeGuardKeyPart,
};
