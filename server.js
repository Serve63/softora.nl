const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const VAPI_BASE_URL = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';
const recentWebhookEvents = [];
const recentCallUpdates = [];
const callUpdatesById = new Map();

app.disable('x-powered-by');

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function collectStringValuesByKey(root, keyRegex, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  const maxItems = options.maxItems ?? 10;
  const minLength = options.minLength ?? 1;
  const out = [];
  const seen = new Set();

  function walk(node, depth) {
    if (out.length >= maxItems) return;
    if (depth > maxDepth) return;
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
        if (out.length >= maxItems) return;
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && keyRegex.test(key)) {
        const normalized = normalizeString(value);
        if (normalized.length >= minLength && !seen.has(normalized)) {
          seen.add(normalized);
          out.push(normalized);
          if (out.length >= maxItems) return;
        }
      }

      if (value && typeof value === 'object') {
        walk(value, depth + 1);
        if (out.length >= maxItems) return;
      }
    }
  }

  walk(root, 0);
  return out;
}

function extractTranscriptSnippet(payload) {
  const transcriptCandidates = [
    getByPath(payload, 'message.call.transcript'),
    getByPath(payload, 'message.transcript'),
    getByPath(payload, 'call.transcript'),
    getByPath(payload, 'transcript'),
  ];

  for (const candidate of transcriptCandidates) {
    if (!candidate) continue;

    if (typeof candidate === 'string') {
      return truncateText(candidate, 450);
    }

    if (Array.isArray(candidate)) {
      const parts = candidate
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') return entry;
          return normalizeString(entry.text || entry.content || entry.message || '');
        })
        .filter(Boolean);

      if (parts.length > 0) {
        return truncateText(parts.slice(-6).join(' | '), 450);
      }
    }
  }

  const utteranceCandidates = collectStringValuesByKey(payload, /utterance|transcript/i, {
    maxItems: 8,
    minLength: 8,
  });
  if (utteranceCandidates.length > 0) {
    return truncateText(utteranceCandidates.slice(-4).join(' | '), 450);
  }

  return '';
}

function extractSummaryFromVapiPayload(payload) {
  const directSummaryPaths = [
    'message.call.analysis.summary',
    'message.analysis.summary',
    'call.analysis.summary',
    'analysis.summary',
    'message.summary',
    'summary',
    'message.call.summary',
    'message.artifact.summary',
  ];

  for (const path of directSummaryPaths) {
    const value = getByPath(payload, path);
    if (typeof value === 'string' && normalizeString(value)) {
      return truncateText(value, 700);
    }
  }

  const summaries = collectStringValuesByKey(payload, /summary|recap|synopsis/i, {
    maxItems: 5,
    minLength: 12,
  });
  if (summaries.length > 0) {
    return truncateText(summaries[0], 700);
  }

  return '';
}

function extractCallUpdateFromWebhookPayload(payload) {
  const messageType = normalizeString(payload?.message?.type || payload?.type || 'unknown');
  const call = payload?.message?.call || payload?.call || {};
  const callId = normalizeString(call?.id || payload?.callId || payload?.message?.callId);
  const phone =
    normalizeString(call?.customer?.number) ||
    normalizeString(payload?.message?.customer?.number) ||
    normalizeString(call?.phoneNumber) ||
    normalizeString(payload?.customer?.number);
  const company =
    normalizeString(call?.metadata?.leadCompany) ||
    normalizeString(payload?.message?.call?.metadata?.leadCompany) ||
    normalizeString(call?.customer?.name) ||
    normalizeString(call?.metadata?.company);
  const name =
    normalizeString(call?.metadata?.leadName) ||
    normalizeString(call?.customer?.name) ||
    normalizeString(payload?.message?.customer?.name);
  const status = normalizeString(call?.status || payload?.status || '');
  const summary = extractSummaryFromVapiPayload(payload);
  const transcriptSnippet = extractTranscriptSnippet(payload);
  const endedReason =
    normalizeString(call?.endedReason) ||
    normalizeString(getByPath(payload, 'message.call.endedReason')) ||
    normalizeString(getByPath(payload, 'message.endedReason'));

  if (!callId && !phone && !company && !summary && !transcriptSnippet && !status) {
    return null;
  }

  return {
    callId: callId || `anon-${Date.now()}`,
    phone,
    company,
    name,
    status,
    messageType,
    summary,
    transcriptSnippet,
    endedReason,
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
  };
}

function upsertRecentCallUpdate(update) {
  if (!update) return null;

  const existing = callUpdatesById.get(update.callId);
  const merged = existing
    ? {
        ...existing,
        ...update,
        phone: update.phone || existing.phone || '',
        company: update.company || existing.company || '',
        name: update.name || existing.name || '',
        status: update.status || existing.status || '',
        summary: update.summary || existing.summary || '',
        transcriptSnippet: update.transcriptSnippet || existing.transcriptSnippet || '',
        endedReason: update.endedReason || existing.endedReason || '',
        messageType: update.messageType || existing.messageType || '',
        updatedAt: update.updatedAt,
        updatedAtMs: update.updatedAtMs,
      }
    : update;

  callUpdatesById.set(merged.callId, merged);

  const existingIndex = recentCallUpdates.findIndex((item) => item.callId === merged.callId);
  if (existingIndex >= 0) {
    recentCallUpdates.splice(existingIndex, 1);
  }
  recentCallUpdates.unshift(merged);
  if (recentCallUpdates.length > 500) {
    const removed = recentCallUpdates.pop();
    if (removed) {
      callUpdatesById.delete(removed.callId);
    }
  }

  return merged;
}

function normalizeNlPhoneToE164(input) {
  const raw = normalizeString(input);

  if (!raw) {
    throw new Error('Telefoonnummer ontbreekt');
  }

  let cleaned = raw.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith('+')) {
    const normalized = `+${cleaned.slice(1).replace(/\D/g, '')}`;

    if (!/^\+\d{8,15}$/.test(normalized)) {
      throw new Error(`Ongeldig E.164 nummer: ${raw}`);
    }

    if (normalized.startsWith('+31')) {
      const nlDigits = normalized.slice(3);
      if (nlDigits.length !== 9) {
        throw new Error(`NL nummer heeft niet 9 cijfers na +31: ${raw}`);
      }
    }

    return normalized;
  }

  const digits = cleaned.replace(/\D/g, '');

  if (digits.startsWith('31')) {
    const nlDigits = digits.slice(2);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 9 cijfers na 31: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.startsWith('0')) {
    const nlDigits = digits.slice(1);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 10 cijfers inclusief 0: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.length === 9 && digits.startsWith('6')) {
    return `+31${digits}`;
  }

  throw new Error(`Kan nummer niet omzetten naar NL E.164 formaat: ${raw}`);
}

function getRequiredVapiEnv() {
  return ['VAPI_API_KEY', 'VAPI_ASSISTANT_ID', 'VAPI_PHONE_NUMBER_ID'];
}

function getMissingEnvVars() {
  return getRequiredVapiEnv().filter((key) => !process.env[key]);
}

async function fetchJsonWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function createVapiOutboundCall(payload) {
  const endpoints = ['/call', '/call/phone'];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const { response, data } = await fetchJsonWithTimeout(
        `${VAPI_BASE_URL}${endpoint}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      console.log(
        '[Vapi Response]',
        JSON.stringify(
          {
            endpoint,
            statusCode: response.status,
            ok: response.ok,
            body: data,
          },
          null,
          2
        )
      );

      if (response.ok) {
        return { endpoint, data };
      }

      const statusError = new Error(
        data?.message ||
          data?.error ||
          data?.raw ||
          `Vapi API fout (${response.status}) op ${endpoint}`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;

      if (response.status === 404 && endpoint !== endpoints[endpoints.length - 1]) {
        lastError = statusError;
        continue;
      }

      throw statusError;
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') {
        throw new Error('Timeout bij aanroepen van Vapi API');
      }
      if (error.status === 404 && endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Onbekende fout bij starten Vapi call');
}

function classifyVapiFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  const detailText = JSON.stringify(error?.data || {}).toLowerCase();
  const combined = `${message} ${detailText}`;
  const status = Number(error?.status || 0);

  if (
    status === 402 ||
    /credit|credits|balance|billing|payment required|insufficient funds/.test(combined)
  ) {
    return {
      cause: 'credits',
      explanation: 'Waarschijnlijk onvoldoende Vapi-credits/balance om de call te starten.',
    };
  }

  if (
    /free vapi number|free vapi numbers/.test(combined) &&
    /international call|international calls/.test(combined)
  ) {
    return {
      cause: 'wrong phoneNumberId',
      explanation:
        'Je VAPI_PHONE_NUMBER_ID verwijst naar een gratis Vapi-nummer. Gratis Vapi-nummers ondersteunen geen internationale outbound calls (zoals +31). Gebruik een betaald/extern nummer met internationale outbound.',
    };
  }

  if (
    /assistant/.test(combined) &&
    /(not found|unknown|invalid|does not exist|no .*assistant)/.test(combined)
  ) {
    return {
      cause: 'wrong assistantId',
      explanation: 'De opgegeven VAPI_ASSISTANT_ID lijkt ongeldig of bestaat niet.',
    };
  }

  if (
    /(phone.?number.?id|phone number id|from number|caller id)/.test(combined) &&
    /(not found|unknown|invalid|does not exist|unauthorized)/.test(combined)
  ) {
    return {
      cause: 'wrong phoneNumberId',
      explanation: 'De opgegeven VAPI_PHONE_NUMBER_ID lijkt ongeldig of niet beschikbaar voor dit account.',
    };
  }

  if (
    /invalid.*(phone|number)|invalid number|e\\.164|phone.*format|number.*format|telefoonnummer|kan nummer niet omzetten/.test(
      combined
    )
  ) {
    return {
      cause: 'invalid number',
      explanation: 'Het doelnummer is ongeldig of niet in het verwachte formaat beschikbaar.',
    };
  }

  if (
    status >= 500 ||
    /provider|twilio|carrier|sip|telecom|downstream|upstream|timeout|temporar|rate limit|service unavailable/.test(
      combined
    )
  ) {
    return {
      cause: 'provider issue',
      explanation: 'Waarschijnlijk een issue bij Vapi/provider/carrier (tijdelijk of extern).',
    };
  }

  return {
    cause: 'unknown',
    explanation:
      'Oorzaak kon niet eenduidig worden bepaald. Controleer de exacte foutmelding en Vapi response body.',
  };
}

function buildVariableValues(lead, campaign) {
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);

  return {
    name: normalizeString(lead.name),
    company: normalizeString(lead.company),
    sector: normalizeString(campaign.sector),
    region: effectiveRegion,
    minProjectValue: campaign.minProjectValue,
    maxDiscountPct: campaign.maxDiscountPct,
    extraInstructions: normalizeString(campaign.extraInstructions),
  };
}

function buildVapiPayload(lead, campaign) {
  const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);

  return {
    assistantId: process.env.VAPI_ASSISTANT_ID,
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: {
      name: normalizeString(lead.name) || normalizeString(lead.company) || 'Onbekende lead',
      number: normalizedPhone,
    },
    assistantOverrides: {
      variableValues: buildVariableValues(
        {
          ...lead,
          phone: normalizedPhone,
        },
        campaign
      ),
    },
    metadata: {
      source: 'softora-coldcalling-dashboard',
      leadCompany: normalizeString(lead.company),
      leadName: normalizeString(lead.name),
      leadPhoneE164: normalizedPhone,
      sector: normalizeString(campaign.sector),
      region: effectiveRegion,
    },
  };
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
  };

  return {
    campaign: normalizedCampaign,
    leads,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWebhookAuthorized(req) {
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    return true;
  }

  const headerCandidates = [
    req.get('x-vapi-secret'),
    req.get('x-vapi-signature'),
    req.get('authorization'),
  ].filter(Boolean);

  for (const candidate of headerCandidates) {
    if (candidate === secret) return true;
    if (candidate.toLowerCase().startsWith('bearer ') && candidate.slice(7).trim() === secret) {
      return true;
    }
  }

  return false;
}

app.post('/api/coldcalling/start', async (req, res) => {
  const missingEnv = getMissingEnvVars();

  if (missingEnv.length > 0) {
    return res.status(500).json({
      ok: false,
      error: 'Server mist vereiste environment variables voor Vapi.',
      missingEnv,
    });
  }

  const validated = validateStartPayload(req.body);
  if (validated.error) {
    return res.status(400).json({ ok: false, error: validated.error });
  }

  const { campaign, leads } = validated;
  const leadsToProcess = leads.slice(0, Math.min(campaign.amount, leads.length));

  console.log(
    `[Coldcalling] Start campagne ontvangen: ${leadsToProcess.length}/${leads.length} leads, sector="${campaign.sector}", regio="${campaign.region}", mode="${campaign.dispatchMode}", delay=${campaign.dispatchDelaySeconds}s`
  );

  const processLead = async (lead, index) => {
    try {
      const payload = buildVapiPayload(lead, campaign);
      const normalizedPhone = payload.customer.number;
      const { endpoint, data } = await createVapiOutboundCall(payload);
      const callId = data?.id || data?.call?.id || null;
      const callStatus = data?.status || data?.call?.status || null;

      if (callId) {
        upsertRecentCallUpdate({
          callId,
          phone: normalizedPhone,
          company: normalizeString(lead.company),
          name: normalizeString(lead.name),
          status: normalizeString(callStatus),
          messageType: 'coldcalling.start.response',
          summary: '',
          transcriptSnippet: '',
          endedReason: '',
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
        });
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
        vapi: {
          endpoint,
          callId,
          status: callStatus,
        },
      };
    } catch (error) {
      const failure = classifyVapiFailure(error);
      console.error(
        '[Coldcalling][Lead Error]',
        JSON.stringify(
          {
            lead: {
              name: normalizeString(lead?.name),
              company: normalizeString(lead?.company),
              phone: normalizeString(lead?.phone),
            },
            error: error.message || 'Onbekende fout',
            statusCode: error.status || null,
            cause: failure.cause,
            explanation: failure.explanation,
            vapiBody: error.data || null,
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

  let results = [];

  if (campaign.dispatchMode === 'parallel') {
    results = await Promise.all(leadsToProcess.map((lead, index) => processLead(lead, index)));
  } else {
    results = [];
    const delayMs =
      campaign.dispatchMode === 'delay' ? Math.round(campaign.dispatchDelaySeconds * 1000) : 0;

    for (let index = 0; index < leadsToProcess.length; index += 1) {
      const lead = leadsToProcess[index];
      const result = await processLead(lead, index);
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

  return res.status(200).json({
    ok: true,
    summary: {
      requested: leads.length,
      attempted: leadsToProcess.length,
      started,
      failed,
      dispatchMode: campaign.dispatchMode,
      dispatchDelaySeconds: campaign.dispatchMode === 'delay' ? campaign.dispatchDelaySeconds : 0,
    },
    results,
  });
});

app.post('/api/vapi/webhook', (req, res) => {
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Webhook secret ongeldig.' });
  }

  const messageType = req.body?.message?.type || req.body?.type || 'unknown';
  const callData = req.body?.message?.call || req.body?.call || null;

  const record = {
    receivedAt: new Date().toISOString(),
    messageType,
    callId: callData?.id || null,
    callStatus: callData?.status || null,
    payload: req.body,
  };

  recentWebhookEvents.unshift(record);
  if (recentWebhookEvents.length > 200) {
    recentWebhookEvents.pop();
  }

  console.log(
    '[Vapi Webhook]',
    JSON.stringify(
      {
        messageType,
        call: callData,
      },
      null,
      2
    )
  );

  const callUpdate = upsertRecentCallUpdate(extractCallUpdateFromWebhookPayload(req.body));
  if (callUpdate) {
    console.log(
      '[Vapi Webhook -> CallUpdate]',
      JSON.stringify(
        {
          callId: callUpdate.callId,
          phone: callUpdate.phone,
          company: callUpdate.company,
          status: callUpdate.status,
          messageType: callUpdate.messageType,
          hasSummary: Boolean(callUpdate.summary),
          hasTranscriptSnippet: Boolean(callUpdate.transcriptSnippet),
        },
        null,
        2
      )
    );
  }

  // TODO: Sla call-status updates op (bijv. queued/ringing/in-progress/ended).
  // TODO: Sla transcript/events op zodra je transcriptie wilt tonen in het dashboard.
  // TODO: Sla afspraken of opvolgacties op wanneer de call een afspraak boekt.

  return res.status(200).json({ ok: true });
});

app.get('/api/vapi/call-updates', (req, res) => {
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 200)));
  const sinceMs = parseNumberSafe(req.query.sinceMs, null);

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

// Simpele healthcheck voor hosting platforms (Render/Railway).
app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'softora-vapi-coldcalling-backend',
    timestamp: new Date().toISOString(),
  });
});

// API routes eerst, daarna statische frontend assets/html serveren.
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/:page', (req, res, next) => {
  const page = req.params.page;

  if (!/^[a-zA-Z0-9._-]+\.html$/.test(page)) {
    return next();
  }

  return res.sendFile(path.join(__dirname, page), (err) => {
    if (err) next();
  });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Niet gevonden' });
});

app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    ok: false,
    error: 'Interne serverfout',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`Softora Vapi backend draait op http://localhost:${PORT}`);
    const missingEnv = getMissingEnvVars();
    if (missingEnv.length > 0) {
      console.warn(
        `[Startup] Let op: ontbrekende env vars voor Vapi (${missingEnv.join(', ')}). /api/coldcalling/start zal falen totdat deze zijn ingevuld.`
      );
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  normalizeNlPhoneToE164,
  startServer,
};
