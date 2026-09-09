'use strict';
const { createHash, createHmac } = require('node:crypto');
const { READ_OPTIONS } = require('./instantly-mailbox-state');
const SCOPE = 'instantly_mailbox_sync';
const WINDOW_MS = 60_000;
const READ_BUDGET = 18;
const AUDIT_BACKOFF_MS = 15 * 60_000;
const CAPABILITY_BACKOFF_MS = 60 * 60_000;
const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 24);

function retryDelayMs(value, nowMs) {
  const raw = String(value || '').trim();
  const delay = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - nowMs;
  return Number.isFinite(delay) && delay > 0 ? Math.max(1000, delay) : WINDOW_MS;
}

function createInstantlyMailboxApi({ config, assertConfigured, fetchJsonWithTimeout,
  getUiStateValues, setUiStateValues, now, logger, createError }) {
  // Namespace cooldowns by the opaque API credential; this is not a password verifier.
  const fingerprint = createHmac('sha256', config.apiKey).update(`mailbox-read-policy-v1|${config.apiBaseUrl}`).digest('hex').slice(0, 24);
  const rateKey = `read_cooldown_${fingerprint}`;
  const leadKey = `lead_scope_cooldown_${fingerprint}`;
  let policy = {}, lastPolicyRead = -Infinity, policyPromise, readStarts = [];
  const pendingAudits = {};
  const time = () => now().getTime();
  const until = (key) => Number(policy[key]) || 0;
  const auditKey = (key, messageId = '') => `thread_audit_${fingerprint}_${hash(`${key}|${messageId}`)}`;

  async function refreshPolicy() {
    if (time() - lastPolicyRead < 10_000) return;
    if (policyPromise) return policyPromise;
    policyPromise = (async () => {
      const state = await getUiStateValues(SCOPE, READ_OPTIONS);
      if (!state || !state.values || (state.source && state.source !== 'supabase')) {
        throw createError('Instantly-leesbeleid kon niet betrouwbaar worden gelezen.', 'INSTANTLY_READ_POLICY_UNAVAILABLE', 503,
          { mailboxProviderResponseReceived: false, externalEffect: false });
      }
      for (const [key, value] of Object.entries(state?.values || {})) {
        policy[key] = Math.max(until(key), Number(value) || 0);
      }
      lastPolicyRead = time();
    })().finally(() => { policyPromise = null; });
    return policyPromise;
  }
  async function persist(patch) {
    Object.assign(policy, patch);
    try {
      const saved = await setUiStateValues(SCOPE, patch, { source: 'instantly-mailbox-sync', actor: 'Instantly mailbox' });
      if (!saved) throw new Error('Instantly-leesbeleid is niet duurzaam opgeslagen.');
    }
    catch (error) { logger.warn('[InstantlyMailbox][ReadBackoffPersistence]', error?.message || error); }
  }
  function rateError(blockedUntil, code = 'INSTANTLY_RATE_LIMITED') {
    return createError('Instantly-leescontrole wacht op het volgende toegestane moment.', code, 429, {
      retryAfterMs: Math.max(1000, blockedUntil - time()), nextAllowedAt: new Date(blockedUntil).toISOString(),
      mailboxProviderResponseReceived: false, externalEffect: false,
    });
  }
  function assertAvailable() {
    if (until(rateKey) > time()) throw rateError(until(rateKey));
  }
  function remainingReads() {
    readStarts = readStarts.filter((started) => started > time() - WINDOW_MS);
    return READ_BUDGET - readStarts.length;
  }
  function canReadLeads() { return until(leadKey) <= time(); }
  async function request(path, { method = 'GET', query = {}, body } = {}) {
    assertConfigured();
    const route = String(path || '').trim().replace(/^\/+/, '');
    const isRead = method === 'GET' || (method === 'POST' && route === 'leads/list');
    if (isRead) {
      await refreshPolicy();
      assertAvailable();
      if (/^leads(?:\/|$)/.test(route) && !canReadLeads()) {
        throw createError('Instantly biedt met deze koppeling geen leads:read-toegang.', 'INSTANTLY_LEADS_READ_UNAVAILABLE', 403,
          { mailboxProviderResponseReceived: false, externalEffect: false });
      }
      if (remainingReads() <= 0) {
        const blockedUntil = readStarts[0] + WINDOW_MS;
        await persist({ [rateKey]: blockedUntil });
        throw rateError(blockedUntil, 'INSTANTLY_READ_BUDGET_EXHAUSTED');
      }
      readStarts.push(time());
    }
    const url = new URL(`${config.apiBaseUrl}/${route}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value));
    });
    const options = { method, headers: { Accept: 'application/json', Authorization: `Bearer ${config.apiKey}` } };
    if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    const { response, data } = await fetchJsonWithTimeout(url.toString(), options, 20_000);
    if (response?.ok) return data;
    const status = Number(response?.status) || 502;
    const detail = String(data?.message || data?.error || data?.detail || '').trim();
    let retryAfterMs;
    if (isRead && status === 429) {
      retryAfterMs = retryDelayMs(response.headers?.get?.('retry-after'), time());
      await persist({ [rateKey]: time() + retryAfterMs });
    }
    if (isRead && /^leads(?:\/|$)/.test(route) && [401, 403].includes(status) && /scope|permission|leads:read/i.test(detail)) {
      await persist({ [leadKey]: time() + CAPABILITY_BACKOFF_MS });
    }
    throw createError(detail || `Instantly gaf HTTP ${status}.`, status === 429 ? 'INSTANTLY_RATE_LIMITED' : 'INSTANTLY_API_FAILED',
      status === 429 ? 429 : 502, { mailboxProviderResponseReceived: true, providerStatus: status,
        ...(retryAfterMs ? { retryAfterMs, nextAllowedAt: new Date(time() + retryAfterMs).toISOString() } : {}) });
  }
  return { request, refreshPolicy, assertAvailable, canReadLeads,
    canStartAudit: () => remainingReads() >= 6 && until(rateKey) <= time(),
    canAudit: (key, messageId) => until(auditKey(key, messageId)) <= time(),
    noteAudit: (key, messageId) => { const name = auditKey(key, messageId); pendingAudits[name] = time() + AUDIT_BACKOFF_MS; policy[name] = pendingAudits[name]; },
    persistAudits: async () => { if (Object.keys(pendingAudits).length) { const patch = { ...pendingAudits }; await persist(patch); for (const key of Object.keys(patch)) delete pendingAudits[key]; } },
  };
}
module.exports = { createInstantlyMailboxApi, retryDelayMs };
