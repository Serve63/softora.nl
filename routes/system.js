'use strict';

/**
 * routes/system.js — Systeem routes: healthz, robots.txt, security.txt, debug.
 */

module.exports = function registerSystemRoutes(app, ctx) {
  const {
    normalizeString, truncateText,
    recentWebhookEvents, recentCallUpdates, recentAiCallInsights,
    recentSecurityAuditEvents, generatedAgendaAppointments,
    isSupabaseConfigured, getSupabaseClient,
    SUPABASE_STATE_TABLE, SUPABASE_STATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_CALL_UPDATE_STATE_KEY_PREFIX, SECURITY_CONTACT_EMAIL,
    MAIL_IMAP_MAILBOX, MAIL_IMAP_POLL_COOLDOWN_MS,
    redactSupabaseUrlForDebug, requireRuntimeDebugAccess, getEffectivePublicBaseUrl,
    isSmtpMailConfigured, isImapMailConfigured,
    persistRuntimeStateToSupabase, ensureRuntimeStateHydratedFromSupabase,
    // Getters voor mutable let-variabelen in server.js
    getSupabaseStateHydrated, setSupabaseStateHydrated,
    getSupabaseHydrateRetryNotBeforeMs, setSupabaseHydrateRetryNotBeforeMs,
    getSupabaseLastHydrateError, getSupabaseLastPersistError, getSupabaseLastCallUpdatePersistError,
    getInboundConfirmationMailSyncNotBeforeMs, getInboundConfirmationMailSyncLastResult,
  } = ctx;

  // --- Healthz ---

  function buildHealthzPayload() {
    return {
      ok: true,
      service: 'softora-retell-coldcalling-backend',
      supabase: {
        enabled: isSupabaseConfigured(),
        hydrated: getSupabaseStateHydrated(),
        table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
        stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  app.get('/healthz', (_req, res) => res.status(200).json(buildHealthzPayload()));
  app.get('/api/healthz', (_req, res) => res.status(200).json(buildHealthzPayload()));

  // --- Robots.txt ---

  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(
      [
        'User-agent: *', 'Allow: /',
        'Disallow: /api/', 'Disallow: /premium-', 'Disallow: /personeel-',
        'Disallow: /actieve-opdrachten', 'Disallow: /ai-coldmailing',
        'Disallow: /ai-lead-generator', 'Disallow: /seo-crm-system', '',
      ].join('\n')
    );
  });

  // --- Security.txt ---

  app.get('/.well-known/security.txt', (req, res) => {
    const publicBaseUrl = getEffectivePublicBaseUrl(req) || 'https://www.softora.nl';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(
      [
        `Contact: mailto:${SECURITY_CONTACT_EMAIL || 'info@softora.nl'}`,
        `Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}`,
        `Canonical: ${publicBaseUrl}/.well-known/security.txt`,
        'Preferred-Languages: nl, en', '',
      ].join('\n')
    );
  });

  // --- Runtime health debug ---

  function sendRuntimeHealthDebug(_req, res) {
    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      runtime: {
        webhookEvents: recentWebhookEvents.length,
        callUpdates: recentCallUpdates.length,
        aiCallInsights: recentAiCallInsights.length,
        securityAuditEvents: recentSecurityAuditEvents.length,
        appointments: generatedAgendaAppointments.length,
        realCallUpdates: recentCallUpdates.filter((item) => {
          const callId = normalizeString(item?.callId || '');
          return callId && !callId.startsWith('demo-');
        }).length,
      },
      supabase: {
        enabled: isSupabaseConfigured(),
        hydrated: getSupabaseStateHydrated(),
        hydrateRetryNotBeforeMs: getSupabaseHydrateRetryNotBeforeMs(),
        table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
        stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
        host: redactSupabaseUrlForDebug(SUPABASE_URL),
        hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
        lastHydrateError: getSupabaseLastHydrateError() || null,
        lastPersistError: getSupabaseLastPersistError() || null,
        lastCallUpdatePersistError: getSupabaseLastCallUpdatePersistError() || null,
        callUpdateStateKeyPrefix: SUPABASE_CALL_UPDATE_STATE_KEY_PREFIX,
      },
      mail: {
        smtpConfigured: isSmtpMailConfigured(),
        imapConfigured: isImapMailConfigured(),
        imapMailbox: isImapMailConfigured() ? MAIL_IMAP_MAILBOX : null,
        imapPollCooldownMs: MAIL_IMAP_POLL_COOLDOWN_MS,
        imapNextPollAfterMs: getInboundConfirmationMailSyncNotBeforeMs(),
        imapLastSync: getInboundConfirmationMailSyncLastResult() || null,
      },
    });
  }

  app.get('/api/debug/runtime-health', requireRuntimeDebugAccess, sendRuntimeHealthDebug);
  app.get('/api/runtime-health', requireRuntimeDebugAccess, sendRuntimeHealthDebug);

  // --- Supabase probe ---

  app.get('/api/supabase-probe', requireRuntimeDebugAccess, async (_req, res) => {
    if (!isSupabaseConfigured()) {
      return res.status(200).json({ ok: false, configured: false, error: 'Supabase niet geconfigureerd.' });
    }
    const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}?select=state_key&limit=1`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = truncateText(text, 800); }
      return res.status(200).json({
        ok: response.ok, configured: true, status: response.status,
        supabaseHost: redactSupabaseUrlForDebug(SUPABASE_URL),
        table: SUPABASE_STATE_TABLE, stateKey: SUPABASE_STATE_KEY,
        hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY), body,
      });
    } catch (error) {
      return res.status(200).json({
        ok: false, configured: true, status: null,
        supabaseHost: redactSupabaseUrlForDebug(SUPABASE_URL),
        table: SUPABASE_STATE_TABLE, stateKey: SUPABASE_STATE_KEY,
        hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
        error: truncateText(error?.message || String(error), 500),
      });
    }
  });

  // --- Runtime sync now ---

  app.post('/api/runtime-sync-now', requireRuntimeDebugAccess, async (_req, res) => {
    const before = {
      hydrated: getSupabaseStateHydrated(),
      lastHydrateError: getSupabaseLastHydrateError() || null,
      lastPersistError: getSupabaseLastPersistError() || null,
      lastCallUpdatePersistError: getSupabaseLastCallUpdatePersistError() || null,
    };

    const persistOk = await persistRuntimeStateToSupabase('debug_runtime_sync_now');
    setSupabaseStateHydrated(false);
    setSupabaseHydrateRetryNotBeforeMs(0);
    const hydratedOk = await ensureRuntimeStateHydratedFromSupabase();

    return res.status(200).json({
      ok: Boolean(persistOk && hydratedOk), before,
      after: {
        hydrated: getSupabaseStateHydrated(),
        lastHydrateError: getSupabaseLastHydrateError() || null,
        lastPersistError: getSupabaseLastPersistError() || null,
        lastCallUpdatePersistError: getSupabaseLastCallUpdatePersistError() || null,
        counts: {
          webhookEvents: recentWebhookEvents.length, callUpdates: recentCallUpdates.length,
          aiCallInsights: recentAiCallInsights.length, appointments: generatedAgendaAppointments.length,
        },
      },
      persistOk, hydratedOk,
      supabase: { host: redactSupabaseUrlForDebug(SUPABASE_URL), table: SUPABASE_STATE_TABLE, stateKey: SUPABASE_STATE_KEY },
    });
  });
};
