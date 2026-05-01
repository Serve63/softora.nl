const express = require('express');
const { validateColdcallingStartConfirmPin } = require('../security/coldcalling-start-confirm-pin');
const { resolveUsdToEurRateDetails } = require('../services/openai-costs');
const {
  countFailedColdcallingResults,
  countSkippedColdcallingResults,
  countStartedColdcallingResults,
  filterColdcallingLeadsByDatabaseStatus,
  parseCustomerDatabaseRowsFromUiState,
} = require('../services/coldcalling-lead-eligibility');

const DEFAULT_RETELL_ESTIMATED_COST_PER_MINUTE_USD = 0.07;
const RETELL_COST_SUMMARY_CACHE_MS = 12000;
const retellCostSummaryCacheByScope = new Map();

function hasKnownRetellCost(update) {
  const costUsdMilli = Number(update?.costUsdMilli ?? update?.cost_usd_milli);
  if (Number.isFinite(costUsdMilli) && costUsdMilli >= 0) return true;

  const costUsd = Number(update?.costUsd ?? update?.cost_usd);
  return Number.isFinite(costUsd) && costUsd >= 0;
}

function extractRetellCallsFromListResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.calls)) return data.calls;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function extractRetellListPaginationKey(data, calls = []) {
  const explicitKey =
    data?.pagination_key ||
    data?.next_pagination_key ||
    data?.nextPaginationKey ||
    data?.next_page ||
    data?.nextPage ||
    '';
  if (explicitKey) return String(explicitKey).trim();

  const lastCall = Array.isArray(calls) && calls.length ? calls[calls.length - 1] : null;
  return String(lastCall?.call_id || lastCall?.callId || '').trim();
}

function normalizeRetellCostSummaryScope(value) {
  return String(value || '').trim().toLowerCase() === 'month' ? 'month' : 'all_time';
}

function getRetellCostSummaryMonthStartMs(nowMs = Date.now()) {
  const now = new Date(Number(nowMs) || Date.now());
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
}

function getRetellEstimatedCostUsdFromDurationSeconds(durationSeconds) {
  const safeDurationSeconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
  if (safeDurationSeconds <= 0) return 0;
  return (safeDurationSeconds / 60) * DEFAULT_RETELL_ESTIMATED_COST_PER_MINUTE_USD;
}

function resolveRetellCallStartMs(call) {
  const timestampCandidates = [
    call?.start_timestamp,
    call?.startTime,
    call?.start_time,
    call?.created_at,
    call?.createdAt,
  ];

  for (const candidate of timestampCandidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(candidate || ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return 0;
}

function resolveRetellCallDurationSeconds(call) {
  const durationMs = Number(call?.duration_ms);
  if (Number.isFinite(durationMs) && durationMs > 0) {
    return Math.max(1, Math.round(durationMs / 1000));
  }

  const durationSeconds = Number(call?.duration_seconds ?? call?.duration);
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.max(1, Math.round(durationSeconds));
  }

  const startedAtMs = resolveRetellCallStartMs(call);
  const endedAtMs =
    Number.isFinite(Number(call?.end_timestamp)) && Number(call.end_timestamp) > 0
      ? Number(call.end_timestamp) < 10_000_000_000
        ? Number(call.end_timestamp) * 1000
        : Number(call.end_timestamp)
      : Date.parse(String(call?.end_time || call?.endedAt || call?.ended_at || ''));
  if (startedAtMs > 0 && Number.isFinite(endedAtMs) && endedAtMs > startedAtMs) {
    return Math.max(1, Math.round((endedAtMs - startedAtMs) / 1000));
  }

  return 0;
}

function shouldIncludeRetellCallInCostSummary(deps, call, lowerThresholdMs) {
  if (!call || typeof call !== 'object') return false;

  const startedAtMs = resolveRetellCallStartMs(call);
  if (Number.isFinite(lowerThresholdMs) && lowerThresholdMs > 0 && startedAtMs > 0 && startedAtMs < lowerThresholdMs) {
    return false;
  }

  const callType = deps.normalizeString(call?.call_type || call?.callType || '').toLowerCase();
  if (callType && callType !== 'phone_call') return false;

  const direction = deps.normalizeString(call?.direction || call?.call_direction || '').toLowerCase();
  if (direction && direction.indexOf('outbound') === -1) return false;

  const status = deps.normalizeString(call?.call_status || call?.status || '').toLowerCase();
  if (!status || status === 'registered' || status === 'ongoing' || status === 'in_progress') return false;

  const metadata = call?.metadata && typeof call.metadata === 'object' ? call.metadata : {};
  const source = deps.normalizeString(metadata.source || metadata.Source || '');
  if (source && source !== 'softora-coldcalling-dashboard') return false;

  return true;
}

function buildRetellListOptionsForCostSummary(deps, lowerThresholdMs, paginationKey, apiVersion) {
  if (apiVersion === 'v2') {
    const filterCriteria = {
      call_type: ['phone_call'],
      direction: ['outbound'],
      call_status: ['ended', 'not_connected', 'error', 'completed'],
    };
    if (Number.isFinite(lowerThresholdMs) && lowerThresholdMs > 0) {
      filterCriteria.start_timestamp = {
        lower_threshold: lowerThresholdMs,
      };
    }
    return {
      apiVersion: 'v2',
      filterCriteria,
      sortOrder: 'descending',
      limit: 1000,
      paginationKey,
    };
  }

  return {
    apiVersion: 'v3',
    filterCriteria: {},
    sortOrder: 'descending',
    limit: 1000,
    paginationKey,
  };
}

async function listRetellCallsForCostSummary(deps, lowerThresholdMs, paginationKey, preferredApiVersion) {
  const versions = preferredApiVersion === 'v2' ? ['v2'] : ['v3', 'v2'];
  let lastError = null;

  for (const apiVersion of versions) {
    try {
      const result = await deps.listRetellCalls(
        buildRetellListOptionsForCostSummary(deps, lowerThresholdMs, paginationKey, apiVersion)
      );
      return {
        ...result,
        apiVersion,
      };
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      if (apiVersion === 'v2' || ![400, 404, 405, 422].includes(status)) break;
    }
  }

  throw lastError || new Error('Retell list calls ophalen mislukt.');
}

async function buildRetellCostSummary(deps, scope, options = {}) {
  const normalizedScope = normalizeRetellCostSummaryScope(scope);
  const nowMs = Math.max(0, Number(options?.nowMs) || Date.now());
  const force = Boolean(options?.force);
  const cached = retellCostSummaryCacheByScope.get(normalizedScope);
  if (
    !force &&
    cached &&
    Number.isFinite(Number(cached.cachedAtMs)) &&
    nowMs - Number(cached.cachedAtMs) < RETELL_COST_SUMMARY_CACHE_MS
  ) {
    return cached.summary;
  }

  const lowerThresholdMs =
    normalizedScope === 'month' ? getRetellCostSummaryMonthStartMs(nowMs) : null;

  let paginationKey = '';
  let totalCostUsd = 0;
  let totalDurationSeconds = 0;
  let callCount = 0;
  let exactCostCount = 0;
  let estimatedCostCount = 0;
  let lastApiVersion = '';
  const preferredApiVersion = deps.normalizeString(
    options?.apiVersion || deps.retellCostSummaryApiVersion || deps.env?.RETELL_COST_SUMMARY_API_VERSION || 'v3'
  ).toLowerCase() === 'v2'
    ? 'v2'
    : 'v3';

  for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
    const { data, apiVersion } = await listRetellCallsForCostSummary(
      deps,
      lowerThresholdMs,
      paginationKey,
      preferredApiVersion
    );
    lastApiVersion = apiVersion;
    const calls = extractRetellCallsFromListResponse(data);
    if (!calls.length) break;

    let pageReachedOlderThanMonth = false;

    calls.forEach((call) => {
      if (!call || typeof call !== 'object') return;

      const startedAtMs = resolveRetellCallStartMs(call);
      if (
        Number.isFinite(lowerThresholdMs) &&
        lowerThresholdMs > 0 &&
        startedAtMs > 0 &&
        startedAtMs < lowerThresholdMs
      ) {
        pageReachedOlderThanMonth = true;
      }
      if (!shouldIncludeRetellCallInCostSummary(deps, call, lowerThresholdMs)) return;

      const durationSeconds = resolveRetellCallDurationSeconds(call);
      const resolvedCost =
        typeof deps.resolveRetellCallCostFields === 'function'
          ? deps.resolveRetellCallCostFields(call)
          : { costUsd: null, costUsdMilli: null };
      const rawExactCostUsd = resolvedCost?.costUsd;
      const exactCostUsd = Number(rawExactCostUsd);

      callCount += 1;
      totalDurationSeconds += durationSeconds;

      if (rawExactCostUsd !== null && rawExactCostUsd !== undefined && Number.isFinite(exactCostUsd) && exactCostUsd >= 0) {
        totalCostUsd += exactCostUsd;
        exactCostCount += 1;
        return;
      }

      totalCostUsd += getRetellEstimatedCostUsdFromDurationSeconds(durationSeconds);
      estimatedCostCount += 1;
    });

    const nextPaginationKey = deps.normalizeString(extractRetellListPaginationKey(data, calls));
    if (pageReachedOlderThanMonth && normalizedScope === 'month') break;
    if (data && data.has_more === false) break;
    if (calls.length < 1000 || !nextPaginationKey) break;
    paginationKey = nextPaginationKey;
  }

  const usdToEurRateDetails = await resolveUsdToEurRateDetails({
    env: deps.env,
    fetchJsonWithTimeout: deps.fetchJsonWithTimeout,
    usdToEurRate: deps.usdToEurRate,
    exchangeRateApiUrl: deps.exchangeRateApiUrl,
    usdToEurRateCache: deps.usdToEurRateCache,
  });

  const summary = {
    scope: normalizedScope,
    source: 'retell',
    exact: estimatedCostCount === 0,
    callCount,
    totalDurationSeconds,
    exactCostCount,
    estimatedCostCount,
    costUsd: Math.round(totalCostUsd * 1000) / 1000,
    costUsdMilli: Math.max(0, Math.round(totalCostUsd * 1000)),
    costEur: Math.round(totalCostUsd * usdToEurRateDetails.rate * 100) / 100,
    usdToEurRate: usdToEurRateDetails.rate,
    usdToEurRateSource: usdToEurRateDetails.source,
    exchangeRateFetchedAtMs: usdToEurRateDetails.fetchedAtMs,
    retellListApiVersion: lastApiVersion || preferredApiVersion,
    note:
      estimatedCostCount === 0
        ? 'Retell AI call_cost factuurkosten.'
        : 'Retell AI call_cost waar beschikbaar; resterende afgeronde calls tijdelijk geschat op duur.',
  };

  retellCostSummaryCacheByScope.set(normalizedScope, {
    cachedAtMs: nowMs,
    summary,
  });

  return summary;
}

function createSendColdcallingStatusResponse(deps) {
  return async function sendColdcallingStatusResponse(res, callId) {
    const cached = deps.callUpdatesById.get(callId) || null;
    const provider = deps
      .normalizeString(cached?.provider || deps.inferCallProvider(callId, deps.getColdcallingProvider()))
      .toLowerCase();

    const sendCached = (providerName) =>
      res.status(200).json({
        ok: true,
        source: 'cache',
        provider: providerName,
        callId: deps.normalizeString(cached?.callId || callId),
        status: deps.normalizeString(cached?.status || ''),
        endedReason: deps.normalizeString(cached?.endedReason || ''),
        startedAt: deps.normalizeString(cached?.startedAt || ''),
        endedAt: deps.normalizeString(cached?.endedAt || ''),
        durationSeconds: deps.parseNumberSafe(cached?.durationSeconds, null),
        recordingUrl: deps.normalizeString(cached?.recordingUrl || ''),
      });

    if (provider === 'twilio') {
      if (!deps.isTwilioStatusApiConfigured()) {
        if (cached) return sendCached('twilio');
        return res
          .status(500)
          .json({
            ok: false,
            error:
              'Twilio credentials ontbreken op server. Verwacht TWILIO_ACCOUNT_SID plus TWILIO_AUTH_TOKEN of TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET.',
          });
      }

      try {
        const { endpoint, data } = await deps.fetchTwilioCallStatusById(callId);
        const update = deps.extractCallUpdateFromTwilioCallStatusResponse(callId, data, {
          stack: cached?.stack || '',
        });
        if (update) {
          deps.upsertRecentCallUpdate(update);
          deps.triggerPostCallAutomation(update);
          await deps.waitForQueuedRuntimeStatePersist();
        }

        return res.status(200).json({
          ok: true,
          endpoint,
          source: 'twilio',
          provider: 'twilio',
          callId: deps.normalizeString(update?.callId || data?.sid || callId),
          status: deps.normalizeString(update?.status || data?.status || ''),
          endedReason: deps.normalizeString(update?.endedReason || ''),
          startedAt: deps.normalizeString(
            update?.startedAt || deps.parseDateToIso(data?.start_time || data?.date_created)
          ),
          endedAt: deps.normalizeString(update?.endedAt || deps.parseDateToIso(data?.end_time)),
          durationSeconds: deps.parseNumberSafe(update?.durationSeconds || data?.duration, null),
          recordingUrl: deps.normalizeString(update?.recordingUrl || data?.recording_url || ''),
        });
      } catch (error) {
        return res.status(Number(error?.status || 500)).json({
          ok: false,
          error: error?.message || 'Kon Twilio call status niet ophalen.',
          endpoint: error?.endpoint || null,
          details: error?.data || null,
        });
      }
    }

    if (!deps.hasRetellApiKey()) {
      if (cached) return sendCached('retell');
      return res.status(500).json({ ok: false, error: 'RETELL_API_KEY ontbreekt op server.' });
    }

    try {
      const { endpoint, data } = await deps.fetchRetellCallStatusById(callId);
      const update = deps.extractCallUpdateFromRetellCallStatusResponse(callId, data);
      if (update) {
        deps.upsertRecentCallUpdate(update);
        deps.triggerPostCallAutomation(update);
        await deps.waitForQueuedRuntimeStatePersist();
      }

      return res.status(200).json({
        ok: true,
        endpoint,
        source: 'retell',
        provider: 'retell',
        callId: deps.normalizeString(update?.callId || data?.call_id || callId),
        status: deps.normalizeString(update?.status || data?.call_status || ''),
        endedReason: deps.normalizeString(update?.endedReason || data?.disconnection_reason || ''),
        startedAt: deps.normalizeString(
          update?.startedAt || deps.toIsoFromUnixMilliseconds(data?.start_timestamp)
        ),
        endedAt: deps.normalizeString(update?.endedAt || deps.toIsoFromUnixMilliseconds(data?.end_timestamp)),
        durationSeconds:
          deps.parseNumberSafe(update?.durationSeconds, null) ||
          (Number.isFinite(Number(data?.duration_ms)) && Number(data.duration_ms) > 0
            ? Math.max(1, Math.round(Number(data.duration_ms) / 1000))
            : null),
        recordingUrl: deps.normalizeString(
          update?.recordingUrl ||
            data?.recording_url ||
            data?.recording_multi_channel_url ||
            data?.scrubbed_recording_url ||
            ''
        ),
      });
    } catch (error) {
      return res.status(Number(error?.status || 500)).json({
        ok: false,
        error: error?.message || 'Kon Retell call status niet ophalen.',
        endpoint: error?.endpoint || null,
        details: error?.data || null,
      });
    }
  };
}

async function loadCustomerDatabaseRowsForColdcalling(deps) {
  if (!deps || typeof deps.getUiStateValues !== 'function') return [];

  async function loadRows(scope, key) {
    if (!scope || !key) return [];
    const state = await deps.getUiStateValues(scope);
    return parseCustomerDatabaseRowsFromUiState(state?.values || {}, key);
  }

  try {
    const customerRows = await loadRows(
      deps.premiumCustomersScope || 'premium_customers_database',
      deps.premiumCustomersKey || 'softora_customers_premium_v1'
    );
    const activeOrderRows = await loadRows(
      deps.premiumActiveOrdersScope || '',
      deps.premiumActiveCustomOrdersKey || ''
    );
    return customerRows.concat(activeOrderRows);
  } catch (error) {
    if (deps.logger && typeof deps.logger.error === 'function') {
      deps.logger.error('[Coldcalling][DatabaseEligibilityError]', error?.message || error);
    }
    return [];
  }
}

function buildColdcallingSummary({
  leads,
  selectedLeads,
  results,
  provider,
  campaign,
  queuedRemaining = 0,
  sequentialWaitForCallEnd = false,
  queueId = '',
}) {
  const started = countStartedColdcallingResults(results);
  const skipped = countSkippedColdcallingResults(results);
  const failed = countFailedColdcallingResults(results);

  return {
    requested: leads.length,
    attempted: selectedLeads.length - skipped,
    skipped,
    started,
    failed,
    provider,
    coldcallingStack: campaign.coldcallingStack,
    coldcallingStackLabel: campaign.coldcallingStackLabel,
    dispatchMode: campaign.dispatchMode,
    dispatchDelaySeconds: campaign.dispatchMode === 'delay' ? campaign.dispatchDelaySeconds : 0,
    sequentialWaitForCallEnd,
    queueId,
    queuedRemaining,
  };
}

function registerColdcallingWebhookRoutes(app, deps) {
  app.get('/api/twilio/voice', deps.handleTwilioInboundVoice);
  app.post('/api/twilio/voice', express.urlencoded({ extended: false }), deps.handleTwilioInboundVoice);
  app.post('/api/twilio/status', express.urlencoded({ extended: false }), deps.handleTwilioStatusWebhook);
  app.post('/api/retell/webhook', deps.handleRetellWebhook);
}

function registerColdcallingRoutes(app, deps) {
  const sendColdcallingStatusResponse = createSendColdcallingStatusResponse(deps);

  app.post('/api/coldcalling/start', async (req, res) => {
    const validated = deps.validateStartPayload(req.body);
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const pinCheck = validateColdcallingStartConfirmPin(req.body);
    if (!pinCheck.ok) {
      return res.status(403).json({ ok: false, error: pinCheck.error });
    }

    const { campaign, leads } = validated;
    campaign.publicBaseUrl = deps.getEffectivePublicBaseUrl(req);
    const provider = deps.resolveColdcallingProviderForCampaign(campaign);
    const selectedLeads = leads.slice(0, Math.min(campaign.amount, leads.length));
    const customerRows = await loadCustomerDatabaseRowsForColdcalling(deps);
    const eligibility = filterColdcallingLeadsByDatabaseStatus(selectedLeads, customerRows);
    const leadsToProcess = eligibility.allowed;
    const skippedResults = eligibility.skippedResults;

    if (!leadsToProcess.length) {
      return res.status(200).json({
        ok: true,
        summary: buildColdcallingSummary({
          leads,
          selectedLeads,
          results: skippedResults,
          provider,
          campaign,
        }),
        results: skippedResults,
      });
    }

    const missingEnv = deps.getMissingEnvVars(provider);

    if (missingEnv.length > 0) {
      const providerLabel = provider === 'twilio' ? 'Twilio' : 'Retell';
      return res.status(500).json({
        ok: false,
        error: `Server mist vereiste environment variables voor ${providerLabel} outbound calling.`,
        missingEnv,
        provider,
      });
    }

    console.log(
      `[Coldcalling] Start campagne ontvangen via ${provider} (stack=${campaign.coldcallingStack}): ${leadsToProcess.length}/${leads.length} leads, ${skippedResults.length} database-skip(s), sector="${campaign.sector}", regio="${campaign.region}", mode="${campaign.dispatchMode}", delay=${campaign.dispatchDelaySeconds}s`
    );

    let results = [];

    if (campaign.dispatchMode === 'parallel') {
      results = await Promise.all(
        leadsToProcess.map(({ lead, index }) => deps.processColdcallingLead(lead, campaign, index))
      );
    } else if (campaign.dispatchMode === 'sequential' && leadsToProcess.length > 1) {
      const queue = deps.createSequentialDispatchQueue(
        campaign,
        leadsToProcess.map(({ lead }) => lead)
      );
      await deps.advanceSequentialDispatchQueue(queue.id, 'start-request');
      results = skippedResults.concat(queue.results.slice());

      const startedNow = countStartedColdcallingResults(queue.results);
      const queuedRemaining = Math.max(0, queue.leads.length - queue.results.length);

      console.log(
        `[Coldcalling][Sequential Queue] ${queue.id} gestart: direct ${startedNow}/${queue.leads.length} call(s), ${skippedResults.length} database-skip(s), ${queuedRemaining} wachtend`
      );

      await deps.waitForQueuedRuntimeStatePersist();

      return res.status(200).json({
        ok: true,
        summary: buildColdcallingSummary({
          leads,
          selectedLeads,
          results,
          provider,
          campaign,
          queuedRemaining,
          sequentialWaitForCallEnd: true,
          queueId: queue.id,
        }),
        results,
      });
    } else {
      results = [];
      const delayMs =
        campaign.dispatchMode === 'delay' ? Math.round(campaign.dispatchDelaySeconds * 1000) : 0;

      for (let index = 0; index < leadsToProcess.length; index += 1) {
        const leadEntry = leadsToProcess[index];
        const result = await deps.processColdcallingLead(leadEntry.lead, campaign, leadEntry.index);
        results.push(result);

        const isLast = index === leadsToProcess.length - 1;
        if (!isLast && delayMs > 0) {
          console.log(
            `[Coldcalling] Wacht ${campaign.dispatchDelaySeconds}s voor volgende lead (${index + 1}/${leadsToProcess.length})`
          );
          await deps.sleep(delayMs);
        }
      }
    }

    results = skippedResults.concat(results);

    await deps.waitForQueuedRuntimeStatePersist();

    return res.status(200).json({
      ok: true,
      summary: buildColdcallingSummary({
        leads,
        selectedLeads,
        results,
        provider,
        campaign,
      }),
      results,
    });
  });

  app.get('/api/coldcalling/call-status/:callId', async (req, res) => {
    const callId = deps.normalizeString(req.params?.callId);
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }
    return sendColdcallingStatusResponse(res, callId);
  });

  app.get('/api/coldcalling/status', async (req, res) => {
    const callId = deps.normalizeString(req.query?.callId);
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }
    return sendColdcallingStatusResponse(res, callId);
  });

  app.get('/api/coldcalling/recording-proxy', async (req, res) => {
    if (!deps.isTwilioStatusApiConfigured()) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            'Twilio credentials ontbreken op server. Verwacht TWILIO_ACCOUNT_SID plus TWILIO_AUTH_TOKEN of TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET.',
        });
    }

    const callId = deps.normalizeString(req.query?.callId || '');
    let recordingSid = deps.normalizeString(req.query?.recordingSid || '');
    if (!callId && !recordingSid) {
      return res.status(400).json({ ok: false, error: 'callId of recordingSid ontbreekt.' });
    }

    const cached = callId ? deps.callUpdatesById.get(callId) || null : null;
    if (!recordingSid) {
      recordingSid = deps.normalizeString(cached?.recordingSid || '');
    }
    if (!recordingSid) {
      recordingSid = deps.extractTwilioRecordingSidFromUrl(
        cached?.recordingUrl || cached?.recording_url || ''
      );
    }

    if (callId) {
      try {
        const { recordings } = await deps.fetchTwilioRecordingsByCallId(callId);
        const preferred = deps.choosePreferredTwilioRecording(recordings, recordingSid);
        if (preferred) {
          recordingSid = deps.normalizeString(preferred?.sid || '') || recordingSid;
        }
      } catch (error) {
        if (!recordingSid) {
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

    const mediaUrl = deps.buildTwilioRecordingMediaUrl(recordingSid);
    if (!mediaUrl) {
      return res.status(500).json({ ok: false, error: 'Kon Twilio recording URL niet opbouwen.' });
    }

    try {
      const upstream = await fetch(mediaUrl, {
        method: 'GET',
        headers: {
          Authorization: deps.getTwilioBasicAuthorizationHeader(),
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
      const contentType = deps.normalizeString(upstream.headers.get('content-type') || '');
      res.set('Content-Type', contentType && /audio/i.test(contentType) ? contentType : 'audio/mpeg');
      res.set('Cache-Control', 'private, max-age=120');

      if (callId) {
        const proxyUrl = deps.buildTwilioRecordingProxyUrl(callId);
        const existing = deps.callUpdatesById.get(callId) || {};
        deps.upsertRecentCallUpdate({
          ...existing,
          callId,
          recordingSid,
          recordingUrl: proxyUrl,
          recordingUrlProxy: proxyUrl,
          messageType: deps.normalizeString(existing?.messageType || 'twilio.recording.resolved'),
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
  app.get('/api/coldcalling/call-updates', async (req, res) => {
    if (deps.isSupabaseConfigured()) {
      await deps.syncRuntimeStateFromSupabaseIfNewer({
        maxAgeMs: deps.runtimeStateSupabaseSyncCooldownMs,
      });
      await deps.syncCallUpdatesFromSupabaseRows({
        maxAgeMs: deps.runtimeStateSupabaseSyncCooldownMs,
      });
    }
    const limit = Math.max(1, Math.min(500, deps.parseIntSafe(req.query.limit, 200)));
    const sinceMs = deps.parseNumberSafe(req.query.sinceMs, null);
    const nowMs = Date.now();

    const refreshCandidates = [];
    const seenCallIds = new Set();
    for (const item of deps.recentCallUpdates) {
      if (refreshCandidates.length >= 8) break;
      const callId = deps.normalizeString(item?.callId || '');
      if (!callId || seenCallIds.has(callId)) continue;
      if (!deps.shouldRefreshRetellCallStatus(item, nowMs)) continue;
      seenCallIds.add(callId);
      refreshCandidates.push({
        callId,
        provider: deps.normalizeString(item?.provider || ''),
        direction: deps.normalizeString(item?.direction || ''),
        stack: deps.normalizeString(item?.stack || ''),
      });
    }

    const missingCandidates = deps.collectMissingCallUpdateRefreshCandidates(6);
    for (const candidate of missingCandidates) {
      if (refreshCandidates.length >= 14) break;
      const callId = deps.normalizeString(candidate?.callId || '');
      if (!callId || seenCallIds.has(callId)) continue;
      if (
        !deps.shouldRefreshRetellCallStatus(
          {
            callId,
            status: 'queued',
            endedReason: '',
            provider: candidate?.provider || '',
            updatedAtMs: 0,
          },
          nowMs
        )
      ) {
        continue;
      }
      seenCallIds.add(callId);
      refreshCandidates.push({
        callId,
        provider: deps.normalizeString(candidate?.provider || ''),
        direction: deps.normalizeString(candidate?.direction || ''),
        stack: deps.normalizeString(candidate?.stack || ''),
      });
    }

    if (refreshCandidates.length > 0) {
      await Promise.allSettled(
        refreshCandidates.map(async (candidate) => {
          const callId = deps.normalizeString(candidate?.callId || '');
          if (!callId) return null;
          const cached = deps.callUpdatesById.get(callId) || null;
          const provider =
            deps.inferCallProvider(
              callId,
              deps.normalizeString(candidate?.provider || cached?.provider || 'retell').toLowerCase() ||
                'retell'
            );
          const refreshed =
            provider === 'twilio'
              ? await deps.refreshCallUpdateFromTwilioStatusApi(callId, {
                  direction:
                    deps.normalizeString(cached?.direction || candidate?.direction || '') || 'outbound',
                  stack: deps.normalizeString(cached?.stack || candidate?.stack || ''),
                })
              : await deps.refreshCallUpdateFromRetellStatusApi(callId);
          if (refreshed) {
            deps.triggerPostCallAutomation(refreshed);
          }
        })
      );
      await deps.waitForQueuedRuntimeStatePersist();
    }

    let filtered = deps.recentCallUpdates.filter((item) => {
      if (!Number.isFinite(sinceMs)) return true;
      return Number(item.updatedAtMs || 0) > Number(sinceMs);
    });

    const retellCostBackfillCallIds =
      typeof deps.fetchRetellCallsByIds === 'function'
        ? Array.from(
            new Set(
              filtered
                .filter((item) => {
                  const callId = deps.normalizeString(item?.callId || '');
                  if (!callId || callId.startsWith('demo-')) return false;

                  const provider = deps.inferCallProvider(
                    callId,
                    deps.normalizeString(item?.provider || 'retell').toLowerCase() || 'retell'
                  );
                  return provider === 'retell' && !hasKnownRetellCost(item);
                })
                .map((item) => deps.normalizeString(item?.callId || ''))
                .filter(Boolean)
            )
          ).slice(0, 200)
        : [];

    if (retellCostBackfillCallIds.length > 0) {
      try {
        const { data } = await deps.fetchRetellCallsByIds(retellCostBackfillCallIds);
        const calls = extractRetellCallsFromListResponse(data);
        let touched = 0;

        calls.forEach((call) => {
          const callId = deps.normalizeString(call?.call_id || call?.callId || '');
          if (!callId) return;

          const update = deps.extractCallUpdateFromRetellCallStatusResponse(callId, call);
          if (!update) return;

          const saved = deps.upsertRecentCallUpdate(update, {
            persistReason: 'retell_call_cost_backfill',
          });
          if (saved) touched += 1;
        });

        if (touched > 0) {
          await deps.waitForQueuedRuntimeStatePersist();
          filtered = deps.recentCallUpdates.filter((item) => {
            if (!Number.isFinite(sinceMs)) return true;
            return Number(item.updatedAtMs || 0) > Number(sinceMs);
          });
        }
      } catch (_) {
        // Laat de route slagen, ook als de cost-backfill tijdelijk faalt.
      }
    }

    return res.status(200).json({
      ok: true,
      count: Math.min(limit, filtered.length),
      updates: filtered.slice(0, limit),
    });
  });

  app.get('/api/coldcalling/cost-summary', async (req, res) => {
    const scope = normalizeRetellCostSummaryScope(req.query?.scope);
    if (!deps.hasRetellApiKey()) {
      return res.status(503).json({
        ok: false,
        error: 'RETELL_API_KEY ontbreekt op server.',
      });
    }

    if (typeof deps.listRetellCalls !== 'function') {
      return res.status(503).json({
        ok: false,
        error: 'Retell cost summary helper is niet beschikbaar.',
      });
    }

    try {
      const summary = await buildRetellCostSummary(deps, scope);
      return res.status(200).json({
        ok: true,
        scope,
        source: 'retell',
        summary,
      });
    } catch (error) {
      return res.status(Number(error?.status || 502)).json({
        ok: false,
        error: error?.message || 'Retell cost summary ophalen mislukt.',
        endpoint: error?.endpoint || null,
        details: error?.data || null,
      });
    }
  });

  app.get('/api/coldcalling/call-detail', async (req, res) => {
    if (deps.isSupabaseConfigured()) {
      await deps.syncRuntimeStateFromSupabaseIfNewer({
        maxAgeMs: deps.runtimeStateSupabaseSyncCooldownMs,
      });
      await deps.syncCallUpdatesFromSupabaseRows({
        maxAgeMs: deps.runtimeStateSupabaseSyncCooldownMs,
      });
    }

    const callId = deps.normalizeString(req.query?.callId || '');
    if (!callId) {
      return res.status(400).json({
        ok: false,
        error: 'callId ontbreekt.',
      });
    }

    deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();

    try {
      const detail = await deps.buildCallBackedLeadDetail(callId);
      if (!detail) {
        return res.status(404).json({
          ok: false,
          error: 'Call niet gevonden.',
        });
      }
      return res.status(200).json({
        ok: true,
        detail,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: deps.normalizeString(error?.message || '') || 'Call detail laden mislukt.',
      });
    }
  });

  app.get('/api/coldcalling/webhook-debug', deps.requireRuntimeDebugAccess, (req, res) => {
    const limit = Math.max(1, Math.min(100, deps.parseIntSafe(req.query.limit, 20)));
    const demoCallIdPrefix = 'demo-';

    const latestWebhookEvents = deps.recentWebhookEvents.slice(0, limit).map((event) => {
      const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null;
      const call = payload?.call && typeof payload.call === 'object' ? payload.call : null;

      return {
        receivedAt: deps.normalizeString(event?.receivedAt || ''),
        messageType: deps.normalizeString(event?.messageType || ''),
        callId: deps.normalizeString(event?.callId || call?.call_id || ''),
        callStatus: deps.normalizeString(event?.callStatus || call?.call_status || ''),
        endedReason: deps.normalizeString(call?.disconnection_reason || ''),
        topLevelKeys: payload ? Object.keys(payload).slice(0, 30) : [],
        callKeys: call ? Object.keys(call).slice(0, 30) : [],
      };
    });

    const latestRealCallUpdates = deps.recentCallUpdates
      .filter((item) => {
        const callId = deps.normalizeString(item?.callId || '');
        return callId && !callId.startsWith(demoCallIdPrefix);
      })
      .slice(0, limit)
      .map((item) => ({
        callId: deps.normalizeString(item?.callId || ''),
        phone: deps.normalizeString(item?.phone || ''),
        company: deps.normalizeString(item?.company || ''),
        status: deps.normalizeString(item?.status || ''),
        messageType: deps.normalizeString(item?.messageType || ''),
        hasSummary: Boolean(deps.normalizeString(item?.summary || '')),
        hasTranscriptSnippet: Boolean(deps.normalizeString(item?.transcriptSnippet || '')),
        transcriptSnippetLen: deps.normalizeString(item?.transcriptSnippet || '').length || 0,
        hasTranscriptFull: Boolean(deps.normalizeString(item?.transcriptFull || '')),
        transcriptFullLen: deps.normalizeString(item?.transcriptFull || '').length || 0,
        updatedAt: deps.normalizeString(item?.updatedAt || ''),
        updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
      }));

    const allCallUpdateCount = deps.recentCallUpdates.length;
    const realCallUpdateCount = deps.recentCallUpdates.filter((item) => {
      const callId = deps.normalizeString(item?.callId || '');
      return callId && !callId.startsWith(demoCallIdPrefix);
    }).length;

    return res.status(200).json({
      ok: true,
      now: new Date().toISOString(),
      webhookEventCount: deps.recentWebhookEvents.length,
      callUpdateCount: allCallUpdateCount,
      realCallUpdateCount,
      demoOnlyCallUpdates: allCallUpdateCount > 0 && realCallUpdateCount === 0,
      latestWebhookEvents,
      latestRealCallUpdates,
    });
  });

  app.get('/api/ai/call-insights', async (req, res) => {
    if (deps.isSupabaseConfigured()) {
      await deps.syncRuntimeStateFromSupabaseIfNewer({
        maxAgeMs: deps.runtimeStateSupabaseSyncCooldownMs,
      });
    }
    const touched = deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
    if (touched > 0) {
      await deps.waitForQueuedRuntimeStatePersist();
    }
    const limit = Math.max(1, Math.min(500, deps.parseIntSafe(req.query.limit, 100)));
    return res.status(200).json({
      ok: true,
      count: Math.min(limit, deps.recentAiCallInsights.length),
      insights: deps.recentAiCallInsights.slice(0, limit),
      openAiEnabled: Boolean(deps.getOpenAiApiKey()),
      model: deps.openAiModel,
    });
  });
}

module.exports = {
  buildRetellCostSummary,
  createSendColdcallingStatusResponse,
  extractRetellListPaginationKey,
  registerColdcallingWebhookRoutes,
  registerColdcallingRoutes,
  resolveRetellCallDurationSeconds,
  resolveRetellCallStartMs,
};
