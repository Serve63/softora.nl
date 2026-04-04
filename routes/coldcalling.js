'use strict';

/**
 * routes/coldcalling.js — Coldcalling routes: start, status, webhook, call-updates, recording proxy.
 */

module.exports = function registerColdcallingRoutes(app, ctx) {
  const {
    normalizeString, parseIntSafe, parseNumberSafe,
    validateStartPayload, processColdcallingLead,
    createSequentialDispatchQueue, advanceSequentialDispatchQueue,
    waitForQueuedRuntimeStatePersist, sendColdcallingStatusResponse,
    getEffectivePublicBaseUrl, resolveColdcallingProviderForCampaign, getMissingEnvVars,
    sleep,
    isTwilioStatusApiConfigured, extractTwilioRecordingSidFromUrl,
    fetchTwilioRecordingsByCallId, choosePreferredTwilioRecording,
    buildTwilioRecordingMediaUrl, buildTwilioRecordingProxyUrl, getTwilioBasicAuthorizationHeader,
    callUpdatesById, upsertRecentCallUpdate,
    isRetellWebhookAuthorized, extractCallUpdateFromRetellPayload, triggerPostCallAutomation,
    recentWebhookEvents, recentCallUpdates,
    appendSecurityAuditEvent, getClientIpFromRequest, getRequestPathname, getRequestOriginFromHeaders,
    isSupabaseConfigured, syncRuntimeStateFromSupabaseIfNewer, syncCallUpdatesFromSupabaseRows,
    shouldRefreshRetellCallStatus, collectMissingCallUpdateRefreshCandidates,
    inferCallProvider, refreshCallUpdateFromRetellStatusApi, refreshCallUpdateFromTwilioStatusApi,
    requireRuntimeDebugAccess,
    VERBOSE_CALL_WEBHOOK_LOGS, RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS,
  } = ctx;

  // --- POST /api/coldcalling/start ---
  app.post('/api/coldcalling/start', async (req, res) => {
    const validated = validateStartPayload(req.body);
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const { campaign, leads } = validated;
    campaign.publicBaseUrl = getEffectivePublicBaseUrl(req);
    const provider = resolveColdcallingProviderForCampaign(campaign);
    const missingEnv = getMissingEnvVars(provider);

    if (missingEnv.length > 0) {
      const providerLabel = provider === 'twilio' ? 'Twilio' : 'Retell';
      return res.status(500).json({
        ok: false,
        error: `Server mist vereiste environment variables voor ${providerLabel} outbound calling.`,
        missingEnv,
        provider,
      });
    }

    const leadsToProcess = leads.slice(0, Math.min(campaign.amount, leads.length));

    console.log(
      `[Coldcalling] Start campagne ontvangen via ${provider} (stack=${campaign.coldcallingStack}): ${leadsToProcess.length}/${leads.length} leads, sector="${campaign.sector}", regio="${campaign.region}", mode="${campaign.dispatchMode}", delay=${campaign.dispatchDelaySeconds}s`
    );

    let results = [];

    if (campaign.dispatchMode === 'parallel') {
      results = await Promise.all(
        leadsToProcess.map((lead, index) => processColdcallingLead(lead, campaign, index))
      );
    } else if (campaign.dispatchMode === 'sequential' && leadsToProcess.length > 1) {
      const queue = createSequentialDispatchQueue(campaign, leadsToProcess);
      await advanceSequentialDispatchQueue(queue.id, 'start-request');
      results = queue.results.slice();

      const startedNow = results.filter((item) => item.success).length;
      const failedNow = results.length - startedNow;
      const queuedRemaining = Math.max(0, queue.leads.length - queue.results.length);

      console.log(
        `[Coldcalling][Sequential Queue] ${queue.id} gestart: direct ${results.length}/${queue.leads.length} verwerkt, ${queuedRemaining} wachtend`
      );

      await waitForQueuedRuntimeStatePersist();

      return res.status(200).json({
        ok: true,
        summary: {
          requested: leads.length,
          attempted: leadsToProcess.length,
          started: startedNow,
          failed: failedNow,
          provider,
          coldcallingStack: campaign.coldcallingStack,
          coldcallingStackLabel: campaign.coldcallingStackLabel,
          dispatchMode: campaign.dispatchMode,
          dispatchDelaySeconds: 0,
          sequentialWaitForCallEnd: true,
          queueId: queue.id,
          queuedRemaining,
        },
        results,
      });
    } else {
      results = [];
      const delayMs =
        campaign.dispatchMode === 'delay' ? Math.round(campaign.dispatchDelaySeconds * 1000) : 0;

      for (let index = 0; index < leadsToProcess.length; index += 1) {
        const lead = leadsToProcess[index];
        const result = await processColdcallingLead(lead, campaign, index);
        results.push(result);

        const isLast = index === leadsToProcess.length - 1;
        if (!isLast && delayMs > 0) {
          console.log(
            `[Coldcalling] Wacht ${campaign.dispatchDelaySeconds}s voor volgende lead (${index + 1}/${leadsToProcess.length})`
          );
          await sleep(delayMs);
        }
      }
    }

    const started = results.filter((item) => item.success).length;
    const failed = results.length - started;

    await waitForQueuedRuntimeStatePersist();

    return res.status(200).json({
      ok: true,
      summary: {
        requested: leads.length,
        attempted: leadsToProcess.length,
        started,
        failed,
        provider,
        coldcallingStack: campaign.coldcallingStack,
        coldcallingStackLabel: campaign.coldcallingStackLabel,
        dispatchMode: campaign.dispatchMode,
        dispatchDelaySeconds: campaign.dispatchMode === 'delay' ? campaign.dispatchDelaySeconds : 0,
      },
      results,
    });
  });

  // --- GET /api/coldcalling/call-status/:callId ---
  app.get('/api/coldcalling/call-status/:callId', async (req, res) => {
    const callId = normalizeString(req.params?.callId);
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }
    return sendColdcallingStatusResponse(res, callId);
  });

  // Vercel route-fallback: sommige serverless route-combinaties geven NOT_FOUND op diepere paden.
  // Deze variant gebruikt een ondiep pad met querystring en werkt betrouwbaarder.
  app.get('/api/coldcalling/status', async (req, res) => {
    const callId = normalizeString(req.query?.callId);
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }
    return sendColdcallingStatusResponse(res, callId);
  });

  // --- GET /api/coldcalling/recording-proxy ---
  app.get('/api/coldcalling/recording-proxy', async (req, res) => {
    if (!isTwilioStatusApiConfigured()) {
      return res.status(500).json({ ok: false, error: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ontbreken op server.' });
    }

    const callId = normalizeString(req.query?.callId || '');
    let recordingSid = normalizeString(req.query?.recordingSid || '');
    if (!callId && !recordingSid) {
      return res.status(400).json({ ok: false, error: 'callId of recordingSid ontbreekt.' });
    }

    const cached = callId ? callUpdatesById.get(callId) || null : null;
    if (!recordingSid) {
      recordingSid = normalizeString(cached?.recordingSid || '');
    }
    if (!recordingSid) {
      recordingSid = extractTwilioRecordingSidFromUrl(cached?.recordingUrl || cached?.recording_url || '');
    }

    if (callId) {
      try {
        const { recordings } = await fetchTwilioRecordingsByCallId(callId);
        const preferred = choosePreferredTwilioRecording(recordings, recordingSid);
        if (preferred) {
          recordingSid = normalizeString(preferred?.sid || '') || recordingSid;
        }
      } catch (error) {
        if (recordingSid) {
          // Fallback naar bekende opname als Twilio-lijst tijdelijk niet beschikbaar is.
        } else {
          return res.status(Number(error?.status || 502)).json({
            ok: false,
            error: error?.message || 'Kon Twilio recordinglijst niet ophalen.',
            endpoint: error?.endpoint || null,
            details: error?.data || null,
          });
        }
      }
    }

    if (!recordingSid) {
      return res.status(404).json({ ok: false, error: 'Nog geen opname beschikbaar voor deze call.' });
    }

    const mediaUrl = buildTwilioRecordingMediaUrl(recordingSid);
    if (!mediaUrl) {
      return res.status(500).json({ ok: false, error: 'Kon Twilio recording URL niet opbouwen.' });
    }

    try {
      const upstream = await fetch(mediaUrl, {
        method: 'GET',
        headers: {
          Authorization: getTwilioBasicAuthorizationHeader(),
        },
      });

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        return res.status(upstream.status).json({
          ok: false,
          error: `Twilio opname ophalen mislukt (${upstream.status}).`,
          details: text || null,
        });
      }

      const bytes = Buffer.from(await upstream.arrayBuffer());
      const contentType = normalizeString(upstream.headers.get('content-type') || '');
      res.set('Content-Type', contentType && /audio/i.test(contentType) ? contentType : 'audio/mpeg');
      res.set('Cache-Control', 'private, max-age=120');

      if (callId) {
        const proxyUrl = buildTwilioRecordingProxyUrl(callId);
        const existing = callUpdatesById.get(callId) || {};
        upsertRecentCallUpdate({
          ...existing,
          callId,
          recordingSid,
          recordingUrl: proxyUrl,
          recordingUrlProxy: proxyUrl,
          messageType: normalizeString(existing?.messageType || 'twilio.recording.resolved'),
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
          provider: 'twilio',
        });
      }

      return res.status(200).send(bytes);
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error?.message || 'Kon Twilio opname niet proxien.',
      });
    }
  });

  // --- POST /api/retell/webhook ---
  app.post('/api/retell/webhook', async (req, res) => {
    if (!isRetellWebhookAuthorized(req)) {
      appendSecurityAuditEvent(
        {
          type: 'retell_webhook_rejected',
          severity: 'warning',
          success: false,
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Retell webhook geweigerd door signature/secret check.',
        },
        'security_retell_webhook_rejected'
      );
      return res.status(401).json({ ok: false, error: 'Retell webhook signature/secret ongeldig.' });
    }

    const eventType = normalizeString(req.body?.event || req.body?.type || 'unknown');
    const callData = req.body?.call && typeof req.body.call === 'object' ? req.body.call : null;

    const record = {
      receivedAt: new Date().toISOString(),
      messageType: `retell.${eventType || 'unknown'}`,
      callId: normalizeString(callData?.call_id || ''),
      callStatus: normalizeString(callData?.call_status || ''),
      payload: req.body,
    };

    recentWebhookEvents.unshift(record);
    if (recentWebhookEvents.length > 200) {
      recentWebhookEvents.pop();
    }

    if (VERBOSE_CALL_WEBHOOK_LOGS) {
      console.log('[Retell Webhook]', JSON.stringify({ eventType, call: callData }, null, 2));
    } else {
      console.log(
        '[Retell Webhook]',
        JSON.stringify({
          eventType,
          callId: normalizeString(callData?.call_id || ''),
          status: normalizeString(callData?.call_status || ''),
          endedReason: normalizeString(callData?.disconnection_reason || ''),
        })
      );
    }

    const callUpdate = upsertRecentCallUpdate(extractCallUpdateFromRetellPayload(req.body));
    if (callUpdate) {
      triggerPostCallAutomation(callUpdate);
    }

    await waitForQueuedRuntimeStatePersist();

    return res.status(200).json({ ok: true });
  });

  // --- GET /api/coldcalling/call-updates ---
  app.get('/api/coldcalling/call-updates', async (req, res) => {
    if (isSupabaseConfigured()) {
      await syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS });
      await syncCallUpdatesFromSupabaseRows({ maxAgeMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS });
    }
    const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 200)));
    const sinceMs = parseNumberSafe(req.query.sinceMs, null);
    const nowMs = Date.now();

    const refreshCandidates = [];
    const seenCallIds = new Set();
    for (const item of recentCallUpdates) {
      if (refreshCandidates.length >= 8) break;
      const callId = normalizeString(item?.callId || '');
      if (!callId || seenCallIds.has(callId)) continue;
      if (!shouldRefreshRetellCallStatus(item, nowMs)) continue;
      seenCallIds.add(callId);
      refreshCandidates.push({
        callId,
        provider: normalizeString(item?.provider || ''),
        direction: normalizeString(item?.direction || ''),
        stack: normalizeString(item?.stack || ''),
      });
    }

    const missingCandidates = collectMissingCallUpdateRefreshCandidates(6);
    for (const candidate of missingCandidates) {
      if (refreshCandidates.length >= 14) break;
      const callId = normalizeString(candidate?.callId || '');
      if (!callId || seenCallIds.has(callId)) continue;
      if (
        !shouldRefreshRetellCallStatus(
          { callId, status: 'queued', endedReason: '', provider: candidate?.provider || '', updatedAtMs: 0 },
          nowMs
        )
      ) {
        continue;
      }
      seenCallIds.add(callId);
      refreshCandidates.push({
        callId,
        provider: normalizeString(candidate?.provider || ''),
        direction: normalizeString(candidate?.direction || ''),
        stack: normalizeString(candidate?.stack || ''),
      });
    }

    if (refreshCandidates.length > 0) {
      await Promise.allSettled(
        refreshCandidates.map(async (candidate) => {
          const callId = normalizeString(candidate?.callId || '');
          if (!callId) return null;
          const cached = callUpdatesById.get(callId) || null;
          const provider = inferCallProvider(
            callId,
            normalizeString(candidate?.provider || cached?.provider || 'retell').toLowerCase() || 'retell'
          );
          const refreshed =
            provider === 'twilio'
              ? await refreshCallUpdateFromTwilioStatusApi(callId, {
                  direction: normalizeString(cached?.direction || candidate?.direction || '') || 'outbound',
                  stack: normalizeString(cached?.stack || candidate?.stack || ''),
                })
              : await refreshCallUpdateFromRetellStatusApi(callId);
          if (refreshed) {
            triggerPostCallAutomation(refreshed);
          }
        })
      );
      await waitForQueuedRuntimeStatePersist();
    }

    const filtered = recentCallUpdates.filter((item) => {
      if (!Number.isFinite(sinceMs)) return true;
      return Number(item.updatedAtMs || 0) > Number(sinceMs);
    });

    return res.status(200).json({
      ok: true,
      count: Math.min(limit, filtered.length),
      updates: filtered.slice(0, limit),
    });
  });

  // --- GET /api/coldcalling/webhook-debug ---
  app.get('/api/coldcalling/webhook-debug', requireRuntimeDebugAccess, (req, res) => {
    const limit = Math.max(1, Math.min(100, parseIntSafe(req.query.limit, 20)));
    const demoCallIdPrefix = 'demo-';

    const latestWebhookEvents = recentWebhookEvents.slice(0, limit).map((event) => {
      const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null;
      const call = payload?.call && typeof payload.call === 'object' ? payload.call : null;
      return {
        receivedAt: normalizeString(event?.receivedAt || ''),
        messageType: normalizeString(event?.messageType || ''),
        callId: normalizeString(event?.callId || call?.call_id || ''),
        callStatus: normalizeString(event?.callStatus || call?.call_status || ''),
        endedReason: normalizeString(call?.disconnection_reason || ''),
        topLevelKeys: payload ? Object.keys(payload).slice(0, 30) : [],
        callKeys: call ? Object.keys(call).slice(0, 30) : [],
      };
    });

    const latestRealCallUpdates = recentCallUpdates
      .filter((item) => {
        const callId = normalizeString(item?.callId || '');
        return callId && !callId.startsWith(demoCallIdPrefix);
      })
      .slice(0, limit)
      .map((item) => ({
        callId: normalizeString(item?.callId || ''),
        phone: normalizeString(item?.phone || ''),
        company: normalizeString(item?.company || ''),
        status: normalizeString(item?.status || ''),
        messageType: normalizeString(item?.messageType || ''),
        hasSummary: Boolean(normalizeString(item?.summary || '')),
        hasTranscriptSnippet: Boolean(normalizeString(item?.transcriptSnippet || '')),
        transcriptSnippetLen: normalizeString(item?.transcriptSnippet || '').length || 0,
        hasTranscriptFull: Boolean(normalizeString(item?.transcriptFull || '')),
        transcriptFullLen: normalizeString(item?.transcriptFull || '').length || 0,
        updatedAt: normalizeString(item?.updatedAt || ''),
        updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
      }));

    const allCallUpdateCount = recentCallUpdates.length;
    const realCallUpdateCount = recentCallUpdates.filter((item) => {
      const callId = normalizeString(item?.callId || '');
      return callId && !callId.startsWith(demoCallIdPrefix);
    }).length;

    return res.status(200).json({
      ok: true,
      now: new Date().toISOString(),
      webhookEventCount: recentWebhookEvents.length,
      callUpdateCount: allCallUpdateCount,
      realCallUpdateCount,
      demoOnlyCallUpdates: allCallUpdateCount > 0 && realCallUpdateCount === 0,
      latestWebhookEvents,
      latestRealCallUpdates,
    });
  });
};
