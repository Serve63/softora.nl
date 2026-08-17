'use strict';

const { createMailboxDiscoveryRepository } = require('../repositories/mailbox-discovery');
const { getCampaignMailboxAccounts } = require('./mailbox-campaign-replies');

const SEARCH_LIMIT_DEFAULT = 20;
const CONTACT_LIMIT_DEFAULT = 30;
const MAX_CURSOR_OFFSET = 5000;

function createMailboxDiscoveryService(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    mailboxIndexStore = {},
    mailboxOutreachScope = null,
    logger = console,
    repository = createMailboxDiscoveryRepository({
      isSupabaseConfigured,
      getSupabaseClient,
      normalizeMessageRow: mailboxIndexStore.normalizeMessageRow,
    }),
  } = deps;

  function normalizeOwner(value) {
    const owner = String(value || '').trim().toLowerCase().replace('servé', 'serve');
    if (!owner || owner === 'all' || owner === 'both') return '';
    if (owner === 'serve' || owner === 'martijn') return owner;
    const error = new Error('Onbekende mailboxscope.');
    error.code = 'MAILBOX_DISCOVERY_OWNER_INVALID';
    error.status = 400;
    throw error;
  }

  function getScopedAccounts(owner) {
    if (mailboxOutreachScope?.getScopedAccounts) {
      return mailboxOutreachScope.getScopedAccounts(owner);
    }
    return getCampaignMailboxAccounts(normalizeOwner(owner))
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean);
  }

  function parseCursor(value) {
    if (!value) return 0;
    try {
      const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
      const offset = Number(parsed?.offset);
      if (!Number.isInteger(offset) || offset < 0 || offset > MAX_CURSOR_OFFSET) throw new Error('invalid');
      return offset;
    } catch (_) {
      const error = new Error('Ongeldige mailboxpaginering.');
      error.code = 'MAILBOX_DISCOVERY_CURSOR_INVALID';
      error.status = 400;
      throw error;
    }
  }

  function encodeCursor(offset) {
    if (!Number.isInteger(offset) || offset <= 0 || offset > MAX_CURSOR_OFFSET) return null;
    return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
  }

  function normalizeLimit(value, fallback, maximum) {
    return Math.max(1, Math.min(maximum, Math.floor(Number(value) || fallback)));
  }

  function normalizeSearchQuery(value) {
    const query = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (query.length < 2 || query.length > 160) {
      const error = new Error('Gebruik 2 tot 160 tekens om de mailbox te doorzoeken.');
      error.code = 'MAILBOX_SEARCH_QUERY_INVALID';
      error.status = 400;
      throw error;
    }
    return query;
  }

  function normalizeContactEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error('Ongeldig contactadres voor de mailboxtijdlijn.');
      error.code = 'MAILBOX_CONTACT_EMAIL_INVALID';
      error.status = 400;
      throw error;
    }
    return email;
  }

  async function searchMailbox(input = {}) {
    const query = normalizeSearchQuery(input.query);
    const limit = normalizeLimit(input.limit, SEARCH_LIMIT_DEFAULT, 40);
    const offset = parseCursor(input.cursor);
    const result = await repository.search({
      accountEmails: getScopedAccounts(input.owner), query, limit, offset,
    });
    const nextOffset = offset + result.messages.length;
    return {
      ok: true,
      query,
      messages: result.messages,
      totalCount: result.totalCount,
      nextCursor: nextOffset < result.totalCount ? encodeCursor(nextOffset) : null,
    };
  }

  async function getContactTimeline(input = {}) {
    const contactEmail = normalizeContactEmail(input.contactEmail);
    const limit = normalizeLimit(input.limit, CONTACT_LIMIT_DEFAULT, 50);
    const offset = parseCursor(input.cursor);
    const result = await repository.contactTimeline({
      accountEmails: getScopedAccounts(input.owner), contactEmail, limit, offset,
    });
    const nextOffset = offset + result.messages.length;
    return {
      ok: true,
      contactEmail,
      messages: result.messages,
      totalCount: result.totalCount,
      nextCursor: nextOffset < result.totalCount ? encodeCursor(nextOffset) : null,
    };
  }

  function sendFailure(res, error, label) {
    logger.error(`[Mailbox][${label}]`, error?.code || error?.message || error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      code: String(error?.code || 'MAILBOX_DISCOVERY_FAILED'),
      error: Number(error?.status) >= 400 && Number(error?.status) < 500
        ? String(error.message)
        : 'Mailboxhistorie tijdelijk niet beschikbaar. Probeer het zo opnieuw.',
    });
  }

  async function searchMailboxResponse(req, res) {
    try {
      return res.status(200).json(await searchMailbox({
        owner: req.query?.owner,
        query: req.query?.q,
        cursor: req.query?.cursor,
        limit: req.query?.limit,
      }));
    } catch (error) {
      return sendFailure(res, error, 'Search');
    }
  }

  async function contactTimelineResponse(req, res) {
    try {
      return res.status(200).json(await getContactTimeline({
        owner: req.query?.owner,
        contactEmail: req.query?.contact,
        cursor: req.query?.cursor,
        limit: req.query?.limit,
      }));
    } catch (error) {
      return sendFailure(res, error, 'ContactTimeline');
    }
  }

  return {
    contactTimelineResponse,
    getContactTimeline,
    searchMailbox,
    searchMailboxResponse,
  };
}

module.exports = {
  CONTACT_LIMIT_DEFAULT,
  MAX_CURSOR_OFFSET,
  SEARCH_LIMIT_DEFAULT,
  createMailboxDiscoveryService,
};
