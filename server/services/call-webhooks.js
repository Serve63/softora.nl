const crypto = require('crypto');

function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function createCallWebhookRuntime(deps = {}) {
  const {
    env = process.env,
    normalizeString = defaultNormalizeString,
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    normalizeAbsoluteHttpUrl = (value) => normalizeString(value),
    getEffectivePublicBaseUrl = () => '',
    isSecureHttpRequest = () => false,
    appendQueryParamsToUrl = (url) => url,
    escapeHtml = (value) => normalizeString(value),
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '',
    getRequestOriginFromHeaders = () => '',
    appendSecurityAuditEvent = () => {},
    getColdcallingStackLabel = (value) => normalizeString(value),
    getTwilioMediaWsUrlForStack = () => '',
    buildTwilioStatusCallbackUrl = () => '',
    upsertRecentCallUpdate = () => null,
    extractCallUpdateFromTwilioPayload = () => null,
    extractCallUpdateFromRetellPayload = () => null,
    triggerPostCallAutomation = () => {},
    waitForQueuedRuntimeStatePersist = async () => true,
    recentWebhookEvents = [],
    verboseCallWebhookLogs = false,
    timingSafeEqualStrings = (left, right) => left === right,
    logger = console,
  } = deps;

  function logInfo(...args) {
    if (logger && typeof logger.log === 'function') {
      logger.log(...args);
    }
  }

  function logError(...args) {
    if (logger && typeof logger.error === 'function') {
      logger.error(...args);
    }
  }

  function isWebhookAuthorized(req) {
    const secret = normalizeString(env.WEBHOOK_SECRET);
    if (!secret) return true;

    const headerCandidates = [req.get('x-retell-signature'), req.get('authorization')].filter(Boolean);
    for (const candidate of headerCandidates) {
      if (candidate === secret) return true;
      if (String(candidate).toLowerCase().startsWith('bearer ') && String(candidate).slice(7).trim() === secret) {
        return true;
      }
    }
    return false;
  }

  function parseRetellSignatureHeader(signatureHeader) {
    const raw = normalizeString(signatureHeader);
    if (!raw) return null;
    const match = raw.match(/v=(\d+),d=([a-fA-F0-9]+)/);
    if (!match) return null;
    const timestamp = Number(match[1]);
    const digest = normalizeString(match[2]).toLowerCase();
    if (!Number.isFinite(timestamp) || !digest) return null;
    return { timestamp, digest };
  }

  function verifyRetellWebhookSignature(req, maxSkewMs = 5 * 60 * 1000) {
    const apiKey = normalizeString(env.RETELL_API_KEY);
    const signatureHeader = normalizeString(req.get('x-retell-signature'));
    if (!apiKey || !signatureHeader) return false;

    const parsed = parseRetellSignatureHeader(signatureHeader);
    if (!parsed) return false;

    if (Math.abs(Date.now() - parsed.timestamp) > maxSkewMs) {
      return false;
    }

    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString('utf8')
      : normalizeString(req.rawBody) || JSON.stringify(req.body || {});
    const expectedDigest = crypto
      .createHmac('sha256', apiKey)
      .update(`${rawBody}${parsed.timestamp}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedDigest, 'hex');
    const incomingBuffer = Buffer.from(parsed.digest, 'hex');
    if (expectedBuffer.length !== incomingBuffer.length) return false;

    return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
  }

  function isRetellWebhookAuthorized(req) {
    const hasSecret = Boolean(normalizeString(env.WEBHOOK_SECRET));
    const secretAuthorized = isWebhookAuthorized(req);
    const hasRetellSignature = Boolean(normalizeString(req.get('x-retell-signature')));
    const signatureAuthorized = hasRetellSignature ? verifyRetellWebhookSignature(req) : false;

    if (hasSecret) {
      return secretAuthorized || signatureAuthorized;
    }
    if (hasRetellSignature) {
      return signatureAuthorized;
    }
    return true;
  }

  function buildTwilioAllowedCallerSet() {
    const raw = normalizeString(env.TWILIO_ALLOWED_CALLERS);
    if (!raw) return new Set();
    return new Set(
      raw
        .split(/[,\n]/)
        .map((item) => normalizePhoneForTwilioMatch(item))
        .filter(Boolean)
    );
  }

  function normalizePhoneForTwilioMatch(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const digits = raw.replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) return digits.slice(2);
    if (digits.startsWith('0')) return `31${digits.slice(1)}`;
    return digits;
  }

  function isTwilioInboundCallerAllowed(rawCaller) {
    const allowed = buildTwilioAllowedCallerSet();
    if (allowed.size === 0) return true;
    const normalizedCaller = normalizePhoneForTwilioMatch(rawCaller);
    if (!normalizedCaller) return false;
    return allowed.has(normalizedCaller);
  }

  function sendTwimlXml(res, xml) {
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(xml);
  }

  function buildTwilioStreamParameterXml(parameters) {
    return Object.entries(parameters || {})
      .map(([name, value]) => [normalizeString(name), normalizeString(value)])
      .filter(([name, value]) => name && value)
      .map(
        ([name, value]) =>
          `      <Parameter name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
      )
      .join('\n');
  }

  function mapTwilioInboundDigitToStack(digitValue) {
    const digit = normalizeString(digitValue);
    if (digit === '1') return 'retell_ai';
    if (digit === '2') return 'gemini_flash_3_1_live';
    return '';
  }

  function buildTwilioInboundSelectionActionUrl(req) {
    const base = getEffectivePublicBaseUrl(req);
    const candidate = base ? `${base}/api/twilio/voice` : '';
    return normalizeAbsoluteHttpUrl(candidate) || '/api/twilio/voice';
  }

  function buildAbsoluteRequestUrl(req) {
    const originalUrl = normalizeString(req?.originalUrl || req?.url || req?.path || '');
    const publicBaseUrl = normalizeAbsoluteHttpUrl(getEffectivePublicBaseUrl(req));
    if (publicBaseUrl) {
      try {
        return new URL(originalUrl || '/', publicBaseUrl).toString();
      } catch {
        return `${publicBaseUrl.replace(/\/+$/, '')}${originalUrl || '/'}`;
      }
    }

    const protocol = isSecureHttpRequest(req) ? 'https' : 'http';
    const host = normalizeString(req?.get?.('host') || '');
    if (!host) return originalUrl || '/';
    return `${protocol}://${host}${originalUrl || '/'}`;
  }

  function isTwilioSignatureValid(req) {
    const twilioAuthToken = normalizeString(env.TWILIO_AUTH_TOKEN);
    const signatureHeader = normalizeString(req.get('x-twilio-signature'));
    if (!twilioAuthToken || !signatureHeader) return false;

    const absoluteUrl = buildAbsoluteRequestUrl(req);
    const params =
      req && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const sortedKeys = Object.keys(params).sort();
    const signaturePayload = sortedKeys.reduce((accumulator, key) => {
      const rawValue = params[key];
      if (Array.isArray(rawValue)) {
        return accumulator + rawValue.map((item) => `${key}${String(item ?? '')}`).join('');
      }
      return accumulator + key + String(rawValue ?? '');
    }, absoluteUrl);

    const expectedSignature = crypto
      .createHmac('sha1', twilioAuthToken)
      .update(signaturePayload, 'utf8')
      .digest('base64');

    return timingSafeEqualStrings(signatureHeader, expectedSignature);
  }

  function isTwilioWebhookAuthorized(req) {
    if (isTwilioSignatureValid(req)) return true;

    const secret = normalizeString(env.TWILIO_WEBHOOK_SECRET);
    if (!secret) return false;

    const headerSecret = normalizeString(req.get('x-webhook-secret'));
    const querySecret = normalizeString(req.query?.secret || req.body?.secret || '');
    const authorizationHeader = normalizeString(req.get('authorization'));
    const bearerSecret = /^bearer\s+/i.test(authorizationHeader)
      ? normalizeString(authorizationHeader.replace(/^bearer\s+/i, ''))
      : '';
    return secret === headerSecret || secret === querySecret || secret === bearerSecret;
  }

  function handleTwilioInboundVoice(req, res) {
    if (!isTwilioWebhookAuthorized(req)) {
      appendSecurityAuditEvent(
        {
          type: 'twilio_webhook_rejected',
          severity: 'warning',
          success: false,
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Twilio inbound voice webhook geweigerd door signature/secret check.',
        },
        'security_twilio_webhook_rejected'
      );
      return sendTwimlXml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="nl-NL" voice="alice">Verzoek niet toegestaan.</Say>
  <Hangup />
</Response>`
      );
    }

    const caller = normalizeString(req.body?.From || req.query?.From || '');
    const rawStack = normalizeString(req.query?.stack || req.body?.stack || '');
    const explicitStack = rawStack ? normalizeColdcallingStack(rawStack) : '';
    const rawDigits = normalizeString(req.body?.Digits || req.query?.Digits || '');
    const stackFromDigit = mapTwilioInboundDigitToStack(rawDigits);
    const stack = normalizeColdcallingStack(explicitStack || stackFromDigit || 'retell_ai');
    const callSid = normalizeString(req.body?.CallSid || req.query?.CallSid || '');
    const to = normalizeString(req.body?.To || req.query?.To || '');
    const from = normalizeString(req.body?.From || req.query?.From || '');

    if (!isTwilioInboundCallerAllowed(caller)) {
      return sendTwimlXml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Reject reason="rejected" />
</Response>`
      );
    }

    if (!explicitStack) {
      if (!rawDigits) {
        const actionUrl = buildTwilioInboundSelectionActionUrl(req);
        return sendTwimlXml(
          res,
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="7" action="${escapeHtml(actionUrl)}" method="POST">
    <Say language="nl-NL" voice="alice">Maak een keuze. Toets 1 voor Retell A I. Toets 2 voor Gemini 3 punt 1 Live.</Say>
  </Gather>
  <Say language="nl-NL" voice="alice">Geen keuze ontvangen. Het gesprek wordt nu beeindigd.</Say>
  <Hangup />
</Response>`
        );
      }

      if (!stackFromDigit) {
        return sendTwimlXml(
          res,
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="nl-NL" voice="alice">Ongeldige keuze. Het gesprek wordt nu beeindigd.</Say>
  <Hangup />
</Response>`
        );
      }
    }

    const mediaWsBaseUrl = getTwilioMediaWsUrlForStack(stack);
    const mediaWsUrl = mediaWsBaseUrl;
    const streamParameterXml = buildTwilioStreamParameterXml({
      stack,
      callSid,
      to,
      from,
    });
    const inboundStartedAt = new Date().toISOString();
    if (callSid) {
      upsertRecentCallUpdate({
        callId: callSid,
        phone: caller || from,
        company: normalizeString(req.body?.CallerName || req.query?.CallerName || caller || ''),
        name: normalizeString(req.body?.CallerName || req.query?.CallerName || ''),
        status: 'in_progress',
        messageType: 'twilio.inbound.selected',
        summary: `Inkomende call gestart via ${getColdcallingStackLabel(stack)}.`,
        transcriptSnippet: '',
        transcriptFull: '',
        endedReason: '',
        startedAt: inboundStartedAt,
        endedAt: '',
        durationSeconds: null,
        recordingUrl: '',
        updatedAt: inboundStartedAt,
        updatedAtMs: Date.now(),
        provider: 'twilio',
        direction: 'inbound',
        stack,
        stackLabel: getColdcallingStackLabel(stack),
      });
    }

    if (!/^wss?:\/\//i.test(mediaWsUrl)) {
      logError(
        '[Twilio Voice] Ongeldige media WS URL',
        JSON.stringify({ stack, value: mediaWsBaseUrl || null }, null, 2)
      );
      return sendTwimlXml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="nl-NL" voice="alice">De provider is tijdelijk niet beschikbaar. Probeer het later opnieuw.</Say>
  <Hangup />
</Response>`
      );
    }

    let streamStatusCallbackUrl = '';
    try {
      streamStatusCallbackUrl = buildTwilioStatusCallbackUrl(stack, {
        publicBaseUrl: getEffectivePublicBaseUrl(req),
      });
    } catch {
      streamStatusCallbackUrl = '';
    }
    const streamStatusAttributes = streamStatusCallbackUrl
      ? ` statusCallback="${escapeHtml(streamStatusCallbackUrl)}" statusCallbackMethod="POST"`
      : '';

    return sendTwimlXml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeHtml(mediaWsUrl)}"${streamStatusAttributes}>
${streamParameterXml}
    </Stream>
  </Connect>
</Response>`
    );
  }

  async function handleTwilioStatusWebhook(req, res) {
    if (!isTwilioWebhookAuthorized(req)) {
      appendSecurityAuditEvent(
        {
          type: 'twilio_webhook_rejected',
          severity: 'warning',
          success: false,
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Twilio status webhook geweigerd door signature/secret check.',
        },
        'security_twilio_webhook_rejected'
      );
      return res.status(401).json({ ok: false, error: 'Twilio webhook signature/secret ongeldig.' });
    }

    const stack = normalizeColdcallingStack(req.query?.stack || req.body?.stack || 'retell_ai');
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const callUpdate = upsertRecentCallUpdate(extractCallUpdateFromTwilioPayload(payload, { stack }));

    recentWebhookEvents.unshift({
      receivedAt: new Date().toISOString(),
      messageType: `twilio.${normalizeString(payload?.CallStatus || 'status').toLowerCase() || 'status'}`,
      callId: normalizeString(payload?.CallSid || ''),
      callStatus: normalizeString(payload?.CallStatus || ''),
      payload,
    });
    if (recentWebhookEvents.length > 200) {
      recentWebhookEvents.pop();
    }

    if (callUpdate) {
      triggerPostCallAutomation(callUpdate);
    }

    await waitForQueuedRuntimeStatePersist();
    return res.status(200).json({ ok: true });
  }

  async function handleRetellWebhook(req, res) {
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

    recentWebhookEvents.unshift({
      receivedAt: new Date().toISOString(),
      messageType: `retell.${eventType || 'unknown'}`,
      callId: normalizeString(callData?.call_id || ''),
      callStatus: normalizeString(callData?.call_status || ''),
      payload: req.body,
    });
    if (recentWebhookEvents.length > 200) {
      recentWebhookEvents.pop();
    }

    if (verboseCallWebhookLogs) {
      logInfo(
        '[Retell Webhook]',
        JSON.stringify(
          {
            eventType,
            call: callData,
          },
          null,
          2
        )
      );
    } else {
      logInfo(
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
  }

  return {
    buildAbsoluteRequestUrl,
    buildTwilioAllowedCallerSet,
    buildTwilioInboundSelectionActionUrl,
    handleRetellWebhook,
    handleTwilioInboundVoice,
    handleTwilioStatusWebhook,
    isRetellWebhookAuthorized,
    isTwilioInboundCallerAllowed,
    isTwilioSignatureValid,
    isTwilioWebhookAuthorized,
    isWebhookAuthorized,
    mapTwilioInboundDigitToStack,
    normalizePhoneForTwilioMatch,
    parseRetellSignatureHeader,
    sendTwimlXml,
    verifyRetellWebhookSignature,
  };
}

module.exports = {
  createCallWebhookRuntime,
};
