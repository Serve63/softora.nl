function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function createColdcallingRuntime(deps = {}) {
  const {
    normalizeString = defaultNormalizeString,
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    parseIntSafe = (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    parseNumberSafe = (value, fallback = null) => {
      if (value === '' || value === null || value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    getColdcallingStackLabel = (value) => normalizeString(value),
    resolveColdcallingProviderForCampaign = () => 'retell',
    buildRetellPayload = () => ({}),
    createRetellOutboundCall = async () => ({ endpoint: '', data: null }),
    classifyRetellFailure = () => ({ cause: 'unknown', explanation: '' }),
    toIsoFromUnixMilliseconds = () => '',
    upsertRecentCallUpdate = () => null,
    refreshCallUpdateFromRetellStatusApi = async () => null,
    waitForQueuedRuntimeStatePersist = async () => true,
    sleep = async () => {},
    buildTwilioOutboundPayload = () => ({}),
    createTwilioOutboundCall = async () => ({ endpoint: '', data: null }),
    classifyTwilioFailure = () => ({ cause: 'unknown', explanation: '' }),
    parseDateToIso = () => '',
    handleSequentialDispatchQueueWebhookProgress = () => {},
    ensureRuleBasedInsightAndAppointment = () => {},
    maybeAnalyzeCallUpdateWithAi = async () => null,
    logger = console,
  } = deps;

  function logError(...args) {
    if (logger && typeof logger.error === 'function') {
      logger.error(...args);
    }
  }

  const processRetellColdcallingLead = async (lead, campaign, index) => {
    try {
      const payload = buildRetellPayload(lead, campaign);
      const normalizedPhone = normalizeString(payload.to_number);
      const { endpoint, data } = await createRetellOutboundCall(payload);
      const callId = normalizeString(data?.call_id || data?.callId || data?.id);
      const callStatus = normalizeString(data?.call_status || data?.status || 'registered');
      let latestUpdate = null;

      if (callId) {
        latestUpdate = upsertRecentCallUpdate({
          callId,
          phone: normalizedPhone,
          company: normalizeString(lead.company),
          branche: normalizeString(lead.branche || lead.branch || lead.sector || campaign.sector || ''),
          region: normalizeString(lead.region || campaign.region || ''),
          province: normalizeString(lead.province || ''),
          address: normalizeString(lead.address || ''),
          name: normalizeString(lead.name),
          status: callStatus,
          messageType: 'coldcalling.start.response',
          summary: '',
          transcriptSnippet: '',
          endedReason: '',
          startedAt: toIsoFromUnixMilliseconds(data?.start_timestamp) || new Date().toISOString(),
          endedAt: '',
          durationSeconds: null,
          recordingUrl: '',
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
          provider: 'retell',
          direction: 'outbound',
        });

        if (/^(registered|queued|initiated|dialing)$/i.test(callStatus)) {
          await sleep(1200);
          const refreshed = await refreshCallUpdateFromRetellStatusApi(callId);
          if (refreshed) {
            latestUpdate = refreshed;
          }
        }

        await waitForQueuedRuntimeStatePersist();
      }

      const effectiveStatus = normalizeString(latestUpdate?.status || callStatus).toLowerCase();
      const effectiveEndedReason = normalizeString(latestUpdate?.endedReason || '');
      const effectiveStartedAt = normalizeString(
        latestUpdate?.startedAt ||
          toIsoFromUnixMilliseconds(data?.start_timestamp) ||
          new Date().toISOString()
      );

      if (
        effectiveStatus === 'not_connected' ||
        /dial_failed|dial-failed|dial failed/.test(effectiveEndedReason.toLowerCase())
      ) {
        return {
          index,
          success: false,
          lead: {
            name: normalizeString(lead.name),
            company: normalizeString(lead.company),
            phone: normalizeString(lead.phone),
            region: normalizeString(lead.region),
            phoneE164: normalizedPhone,
          },
          error: `Call kon niet verbinden (${effectiveEndedReason || effectiveStatus || 'onbekende reden'}).`,
          statusCode: null,
          cause: 'dial failed',
          causeExplanation:
            'Retell kon het gesprek niet opzetten. Controleer outbound nummer/SIP-auth configuratie in Retell.',
          details: {
            endpoint,
            callId,
            status: effectiveStatus,
            endedReason: effectiveEndedReason,
            startedAt: effectiveStartedAt,
          },
        };
      }

      return {
        index,
        success: true,
        lead: {
          name: normalizeString(lead.name),
          company: normalizeString(lead.company),
          phone: normalizeString(lead.phone),
          region: normalizeString(lead.region),
          phoneE164: normalizedPhone,
        },
        call: {
          endpoint,
          callId,
          status: effectiveStatus || callStatus,
          endedReason: effectiveEndedReason,
        },
      };
    } catch (error) {
      const failure = classifyRetellFailure(error);
      logError(
        '[Coldcalling][Lead Error]',
        JSON.stringify(
          {
            provider: 'retell',
            lead: {
              name: normalizeString(lead?.name),
              company: normalizeString(lead?.company),
              phone: normalizeString(lead?.phone),
            },
            error: error.message || 'Onbekende fout',
            statusCode: error.status || null,
            cause: failure.cause,
            explanation: failure.explanation,
            responseBody: error.data || null,
          },
          null,
          2
        )
      );

      return {
        index,
        success: false,
        lead: {
          name: normalizeString(lead?.name),
          company: normalizeString(lead?.company),
          phone: normalizeString(lead?.phone),
          region: normalizeString(lead?.region),
        },
        error: error.message || 'Onbekende fout',
        statusCode: error.status || null,
        cause: failure.cause,
        causeExplanation: failure.explanation,
        details: error.data || null,
      };
    }
  };

  async function processTwilioColdcallingLead(lead, campaign, index) {
    try {
      const payload = buildTwilioOutboundPayload(lead, campaign);
      const normalizedPhone = normalizeString(payload.To);
      const { endpoint, data } = await createTwilioOutboundCall(payload);
      const callId = normalizeString(data?.sid || data?.call_sid || data?.callSid || '');
      const callStatus = normalizeString(data?.status || 'queued').toLowerCase();
      const startedAt =
        parseDateToIso(data?.start_time || data?.date_created) || new Date().toISOString();
      let latestUpdate = null;

      if (callId) {
        latestUpdate = upsertRecentCallUpdate({
          callId,
          phone: normalizedPhone,
          company: normalizeString(lead.company),
          branche: normalizeString(lead.branche || lead.branch || lead.sector || campaign.sector || ''),
          region: normalizeString(lead.region || campaign.region || ''),
          province: normalizeString(lead.province || ''),
          address: normalizeString(lead.address || ''),
          name: normalizeString(lead.name),
          status: callStatus,
          messageType: 'twilio.start.response',
          summary: '',
          transcriptSnippet: '',
          endedReason: '',
          startedAt,
          endedAt: '',
          durationSeconds: null,
          recordingUrl: '',
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
          provider: 'twilio',
          direction: 'outbound',
        });

        await waitForQueuedRuntimeStatePersist();
      }

      const effectiveStatus = normalizeString(latestUpdate?.status || callStatus).toLowerCase();
      const effectiveEndedReason = normalizeString(latestUpdate?.endedReason || '');
      const terminalFailureStatuses = new Set(['failed', 'busy', 'no-answer', 'canceled', 'cancelled']);

      if (terminalFailureStatuses.has(effectiveStatus)) {
        return {
          index,
          success: false,
          lead: {
            name: normalizeString(lead.name),
            company: normalizeString(lead.company),
            phone: normalizeString(lead.phone),
            region: normalizeString(lead.region),
            phoneE164: normalizedPhone,
          },
          error: `Call kon niet verbinden (${effectiveEndedReason || effectiveStatus || 'onbekende reden'}).`,
          statusCode: null,
          cause: 'dial failed',
          causeExplanation: 'Twilio kon het gesprek niet opzetten. Controleer nummer/call config in Twilio.',
          details: {
            endpoint,
            callId,
            status: effectiveStatus,
            endedReason: effectiveEndedReason,
            startedAt,
          },
        };
      }

      return {
        index,
        success: true,
        lead: {
          name: normalizeString(lead.name),
          company: normalizeString(lead.company),
          phone: normalizeString(lead.phone),
          region: normalizeString(lead.region),
          phoneE164: normalizedPhone,
        },
        call: {
          endpoint,
          callId,
          status: effectiveStatus || callStatus,
          endedReason: effectiveEndedReason,
        },
      };
    } catch (error) {
      const failure = classifyTwilioFailure(error);
      logError(
        '[Coldcalling][Lead Error]',
        JSON.stringify(
          {
            provider: 'twilio',
            lead: {
              name: normalizeString(lead?.name),
              company: normalizeString(lead?.company),
              phone: normalizeString(lead?.phone),
            },
            error: error.message || 'Onbekende fout',
            statusCode: error.status || null,
            cause: failure.cause,
            explanation: failure.explanation,
            responseBody: error.data || null,
          },
          null,
          2
        )
      );

      return {
        index,
        success: false,
        lead: {
          name: normalizeString(lead?.name),
          company: normalizeString(lead?.company),
          phone: normalizeString(lead?.phone),
          region: normalizeString(lead?.region),
        },
        error: error.message || 'Onbekende fout',
        statusCode: error.status || null,
        cause: failure.cause,
        causeExplanation: failure.explanation,
        details: error.data || null,
      };
    }
  }

  async function processColdcallingLead(lead, campaign, index) {
    const provider = resolveColdcallingProviderForCampaign(campaign);
    if (provider === 'twilio') {
      return processTwilioColdcallingLead(lead, campaign, index);
    }
    return processRetellColdcallingLead(lead, campaign, index);
  }

  function validateStartPayload(body) {
    const campaign = body?.campaign ?? {};
    const leads = Array.isArray(body?.leads) ? body.leads : null;

    if (!leads) {
      return { error: 'Body moet een "leads" array bevatten.' };
    }

    if (leads.length === 0) {
      return { error: 'Leads array is leeg.' };
    }

    const dispatchModeRaw = normalizeString(campaign.dispatchMode).toLowerCase();
    const dispatchMode = ['parallel', 'sequential', 'delay'].includes(dispatchModeRaw)
      ? dispatchModeRaw
      : 'sequential';
    const dispatchDelaySecondsInput = parseNumberSafe(campaign.dispatchDelaySeconds, 0);
    const dispatchDelaySeconds = Number.isFinite(dispatchDelaySecondsInput)
      ? Math.max(0, Math.min(3600, dispatchDelaySecondsInput))
      : 0;

    const normalizedCampaign = {
      amount: Math.max(1, parseIntSafe(campaign.amount, leads.length)),
      sector: normalizeString(campaign.sector),
      region: normalizeString(campaign.region),
      minProjectValue: parseNumberSafe(campaign.minProjectValue, null),
      maxDiscountPct: parseNumberSafe(campaign.maxDiscountPct, null),
      extraInstructions: normalizeString(campaign.extraInstructions),
      dispatchMode,
      dispatchDelaySeconds,
      coldcallingStack: normalizeColdcallingStack(
        campaign.coldcallingStack || campaign.callingEngine || campaign.callingStack
      ),
    };
    normalizedCampaign.coldcallingStackLabel = getColdcallingStackLabel(normalizedCampaign.coldcallingStack);

    return {
      campaign: normalizedCampaign,
      leads,
    };
  }

  function triggerPostCallAutomation(callUpdate) {
    if (!callUpdate) return;

    handleSequentialDispatchQueueWebhookProgress(callUpdate);
    ensureRuleBasedInsightAndAppointment(callUpdate);

    void maybeAnalyzeCallUpdateWithAi(callUpdate).catch((error) => {
      logError(
        '[AI Call Insight Error]',
        JSON.stringify(
          {
            callId: callUpdate.callId,
            message: error?.message || 'Onbekende fout',
            status: error?.status || null,
            data: error?.data || null,
          },
          null,
          2
        )
      );
    });
  }

  return {
    processColdcallingLead,
    processRetellColdcallingLead,
    processTwilioColdcallingLead,
    triggerPostCallAutomation,
    validateStartPayload,
  };
}

module.exports = {
  createColdcallingRuntime,
};
