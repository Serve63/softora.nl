const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const VAPI_BASE_URL = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const recentWebhookEvents = [];
const recentCallUpdates = [];
const callUpdatesById = new Map();
const recentAiCallInsights = [];
const aiCallInsightsByCallId = new Map();
const aiAnalysisFingerprintByCallId = new Map();
const aiAnalysisInFlightCallIds = new Set();
const generatedAgendaAppointments = [];
const agendaAppointmentIdByCallId = new Map();
let nextGeneratedAgendaAppointmentId = 100000;
const sequentialDispatchQueues = new Map();
const sequentialDispatchQueueIdByCallId = new Map();
let nextSequentialDispatchQueueId = 1;

// Vercel bundelt dynamische sendFile-doelen niet altijd mee. Door de root-dir
// één keer te scannen op .html bestanden worden die files traceable voor de
// serverless bundle en blijven pagina-links zoals /premium-website.html werken.
function getKnownHtmlPageFiles() {
  try {
    return new Set(
      fs
        .readdirSync(__dirname, { withFileTypes: true })
        .filter((entry) => entry && entry.isFile() && /\.html$/i.test(entry.name))
        .map((entry) => entry.name)
    );
  } catch (error) {
    console.warn('[Startup] Kon HTML-pagina lijst niet lezen:', error?.message || error);
    return new Set(['index.html']);
  }
}

const knownHtmlPageFiles = getKnownHtmlPageFiles();

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

function extractTranscriptText(payload, options = {}) {
  const maxLength = Number.isFinite(options.maxLength) ? Math.max(80, options.maxLength) : 4000;
  const preferFull = options.preferFull !== false;
  const transcriptCandidates = [
    getByPath(payload, 'message.call.transcript'),
    getByPath(payload, 'message.transcript'),
    getByPath(payload, 'call.transcript'),
    getByPath(payload, 'transcript'),
  ];

  for (const candidate of transcriptCandidates) {
    if (!candidate) continue;

    if (typeof candidate === 'string') {
      return truncateText(candidate, maxLength);
    }

    if (Array.isArray(candidate)) {
      const parts = candidate
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') return entry;
          const speaker = normalizeString(entry.role || entry.speaker || entry.name || entry.from || '');
          const text = normalizeString(entry.text || entry.content || entry.message || entry.utterance || '');
          if (!text) return '';
          return speaker ? `${speaker}: ${text}` : text;
        })
        .filter(Boolean);

      if (parts.length > 0) {
        const joined = preferFull ? parts.join('\n') : parts.slice(-6).join(' | ');
        return truncateText(joined, maxLength);
      }
    }
  }

  const utteranceCandidates = collectStringValuesByKey(payload, /utterance|transcript/i, {
    maxItems: preferFull ? 40 : 8,
    minLength: 8,
  });
  if (utteranceCandidates.length > 0) {
    return truncateText(
      preferFull ? utteranceCandidates.join('\n') : utteranceCandidates.slice(-4).join(' | '),
      maxLength
    );
  }

  return '';
}

function extractTranscriptSnippet(payload) {
  return extractTranscriptText(payload, { maxLength: 450, preferFull: false });
}

function extractTranscriptFull(payload) {
  return extractTranscriptText(payload, { maxLength: 8000, preferFull: true });
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
  const transcriptFull = extractTranscriptFull(payload);
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
    transcriptFull,
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
        transcriptFull: update.transcriptFull || existing.transcriptFull || '',
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

function toBooleanSafe(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'ja'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nee'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeDateYyyyMmDd(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const asDate = new Date(raw);
  if (Number.isNaN(asDate.getTime())) return '';
  const y = asDate.getFullYear();
  const m = String(asDate.getMonth() + 1).padStart(2, '0');
  const d = String(asDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeTimeHhMm(value) {
  const raw = normalizeString(value);
  if (!raw) return '';

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hours = Math.max(0, Math.min(23, Number(hhmm[1])));
    const mins = Math.max(0, Math.min(59, Number(hhmm[2])));
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  const compact = raw.match(/^(\d{1,2})(\d{2})$/);
  if (compact) {
    const hours = Math.max(0, Math.min(23, Number(compact[1])));
    const mins = Math.max(0, Math.min(59, Number(compact[2])));
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  return '';
}

function formatEuroLabel(amount) {
  const numeric = parseNumberSafe(amount, null);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'Onbekend';

  try {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `EUR ${Math.round(numeric)}`;
  }
}

function parseJsonLoose(text) {
  const raw = normalizeString(text);
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractOpenAiTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return normalizeString(part.text || part.content || part.output_text || '');
      })
      .filter(Boolean)
      .join('\n');
  }

  if (content && typeof content === 'object') {
    return normalizeString(content.text || content.content || '');
  }

  return '';
}

function getOpenAiApiKey() {
  return normalizeString(process.env.OPENAI_API_KEY);
}

function shouldAnalyzeCallUpdateWithAi(callUpdate) {
  if (!callUpdate || !getOpenAiApiKey()) return false;

  const summary = normalizeString(callUpdate.summary);
  const transcriptSnippet = normalizeString(callUpdate.transcriptSnippet);
  if (!summary && transcriptSnippet.length < 20) return false;

  const statusText = `${normalizeString(callUpdate.status).toLowerCase()} ${normalizeString(
    callUpdate.messageType
  ).toLowerCase()} ${normalizeString(callUpdate.endedReason).toLowerCase()}`;
  const looksFinal = /(end|ended|complete|completed|hang|finish|final|analysis|summary)/i.test(
    statusText
  );

  return Boolean(summary) || looksFinal;
}

function getCallUpdateAiFingerprint(callUpdate) {
  return [
    normalizeString(callUpdate?.status),
    normalizeString(callUpdate?.endedReason),
    normalizeString(callUpdate?.summary),
    normalizeString(callUpdate?.transcriptSnippet),
  ].join('|');
}

function compareAgendaAppointments(a, b) {
  const aKey = `${normalizeDateYyyyMmDd(a?.date)}T${normalizeTimeHhMm(a?.time) || '00:00'}`;
  const bKey = `${normalizeDateYyyyMmDd(b?.date)}T${normalizeTimeHhMm(b?.time) || '00:00'}`;
  if (aKey === bKey) return Number(a?.id || 0) - Number(b?.id || 0);
  return aKey.localeCompare(bKey);
}

function isGeneratedAppointmentConfirmedForAgenda(appointment) {
  if (!appointment || typeof appointment !== 'object') return false;
  if (
    appointment.confirmationAppointmentCancelled ||
    appointment.confirmationAppointmentCancelledAt
  ) {
    return false;
  }
  if (!toBooleanSafe(appointment.aiGenerated, false)) return true;
  return Boolean(appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt);
}

function compareConfirmationTasks(a, b) {
  const aTs = Date.parse(normalizeString(a?.confirmationTaskCreatedAt || a?.createdAt || '')) || 0;
  const bTs = Date.parse(normalizeString(b?.confirmationTaskCreatedAt || b?.createdAt || '')) || 0;
  if (aTs === bTs) return Number(a?.id || 0) - Number(b?.id || 0);
  return bTs - aTs;
}

function formatDateTimeLabelNl(dateYmd, timeHm) {
  const date = normalizeDateYyyyMmDd(dateYmd);
  const time = normalizeTimeHhMm(timeHm) || '09:00';
  if (!date) return '';
  const dt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(dt.getTime())) return `${date} ${time}`;
  return dt.toLocaleString('nl-NL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapAppointmentToConfirmationTask(appointment) {
  if (!appointment || typeof appointment !== 'object') return null;
  const needsConfirmation = toBooleanSafe(
    appointment.needsConfirmationEmail,
    toBooleanSafe(appointment.aiGenerated, false)
  );
  const alreadyDone = Boolean(
    appointment.confirmationResponseReceived ||
      appointment.confirmationResponseReceivedAt ||
      appointment.confirmationAppointmentCancelled ||
      appointment.confirmationAppointmentCancelledAt
  );
  if (!needsConfirmation || alreadyDone) return null;

  return {
    id: Number(appointment.id) || 0,
    type: 'send_confirmation_email',
    title: 'Bevestigingsmail sturen',
    company: normalizeString(appointment.company || 'Onbekende lead'),
    contact: normalizeString(appointment.contact || 'Onbekend'),
    phone: normalizeString(appointment.phone || ''),
    date: normalizeDateYyyyMmDd(appointment.date) || '',
    time: normalizeTimeHhMm(appointment.time) || '09:00',
    datetimeLabel: formatDateTimeLabelNl(appointment.date, appointment.time),
    source: normalizeString(appointment.source || 'AI Cold Calling'),
    summary: truncateText(normalizeString(appointment.summary || ''), 300),
    value: normalizeString(appointment.value || ''),
    createdAt: normalizeString(appointment.confirmationTaskCreatedAt || appointment.createdAt || ''),
    appointmentId: Number(appointment.id) || 0,
    callId: normalizeString(appointment.callId || ''),
    mailDraftAvailable: Boolean(normalizeString(appointment.confirmationEmailDraft || '')),
    mailSent: Boolean(appointment.confirmationEmailSent || appointment.confirmationEmailSentAt),
    mailSentAt: normalizeString(appointment.confirmationEmailSentAt || '') || null,
    mailSentBy: normalizeString(appointment.confirmationEmailSentBy || '') || null,
    confirmationReceived: Boolean(
      appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt
    ),
    confirmationReceivedAt: normalizeString(appointment.confirmationResponseReceivedAt || '') || null,
    confirmationReceivedBy: normalizeString(appointment.confirmationResponseReceivedBy || '') || null,
    appointmentCancelled: Boolean(
      appointment.confirmationAppointmentCancelled || appointment.confirmationAppointmentCancelledAt
    ),
    appointmentCancelledAt:
      normalizeString(appointment.confirmationAppointmentCancelledAt || '') || null,
    appointmentCancelledBy:
      normalizeString(appointment.confirmationAppointmentCancelledBy || '') || null,
  };
}

function getGeneratedAppointmentIndexById(id) {
  const taskId = Number(id);
  if (!Number.isFinite(taskId) || taskId <= 0) return -1;
  return generatedAgendaAppointments.findIndex((item) => Number(item?.id) === taskId);
}

function getLatestCallUpdateByCallId(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;
  return callUpdatesById.get(normalizedCallId) || null;
}

function findTranscriptFromWebhookEvents(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return '';
  for (const event of recentWebhookEvents) {
    if (normalizeString(event?.callId) !== normalizedCallId) continue;
    const text = extractTranscriptFull(event.payload);
    if (text) return text;
  }
  return '';
}

function getAppointmentTranscriptText(appointment) {
  if (!appointment) return '';
  const callId = normalizeString(appointment.callId || '');
  const fromCallUpdate = getLatestCallUpdateByCallId(callId);
  const transcript = normalizeString(fromCallUpdate?.transcriptFull || fromCallUpdate?.transcriptSnippet || '');
  if (transcript) return transcript;
  const fromEvents = findTranscriptFromWebhookEvents(callId);
  if (fromEvents) return fromEvents;
  return '';
}

function buildConfirmationTaskDetail(appointment) {
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) return null;

  const callUpdate = getLatestCallUpdateByCallId(task.callId);
  const aiInsight = task.callId ? aiCallInsightsByCallId.get(task.callId) || null : null;
  const transcript = getAppointmentTranscriptText(appointment) || '';

  return {
    ...task,
    transcript,
    transcriptAvailable: Boolean(transcript),
    vapiSummary: normalizeString(callUpdate?.summary || ''),
    transcriptSnippet: normalizeString(callUpdate?.transcriptSnippet || ''),
    aiSummary: normalizeString(aiInsight?.summary || ''),
    confirmationEmailDraft: normalizeString(appointment.confirmationEmailDraft || ''),
    confirmationEmailDraftGeneratedAt: normalizeString(appointment.confirmationEmailDraftGeneratedAt || '') || null,
    confirmationEmailDraftSource: normalizeString(appointment.confirmationEmailDraftSource || '') || null,
    rawStatus: {
      callStatus: normalizeString(callUpdate?.status || ''),
      callMessageType: normalizeString(callUpdate?.messageType || ''),
      endedReason: normalizeString(callUpdate?.endedReason || ''),
    },
  };
}

function upsertGeneratedAgendaAppointment(appointment, callId) {
  if (!appointment || !callId) return null;

  const existingId = agendaAppointmentIdByCallId.get(callId);
  if (existingId) {
    const idx = generatedAgendaAppointments.findIndex((item) => item.id === existingId);
    if (idx >= 0) {
      const existing = generatedAgendaAppointments[idx];
      generatedAgendaAppointments[idx] = {
        ...existing,
        ...appointment,
        id: existingId,
        needsConfirmationEmail: toBooleanSafe(
          existing?.needsConfirmationEmail,
          toBooleanSafe(appointment?.aiGenerated, false)
        ),
        confirmationEmailSent: Boolean(existing?.confirmationEmailSent || existing?.confirmationEmailSentAt),
        confirmationEmailSentAt: normalizeString(existing?.confirmationEmailSentAt || '') || null,
        confirmationEmailSentBy: normalizeString(existing?.confirmationEmailSentBy || '') || null,
        confirmationResponseReceived: Boolean(
          existing?.confirmationResponseReceived || existing?.confirmationResponseReceivedAt
        ),
        confirmationResponseReceivedAt:
          normalizeString(existing?.confirmationResponseReceivedAt || '') || null,
        confirmationResponseReceivedBy:
          normalizeString(existing?.confirmationResponseReceivedBy || '') || null,
        confirmationAppointmentCancelled: Boolean(
          existing?.confirmationAppointmentCancelled || existing?.confirmationAppointmentCancelledAt
        ),
        confirmationAppointmentCancelledAt:
          normalizeString(existing?.confirmationAppointmentCancelledAt || '') || null,
        confirmationAppointmentCancelledBy:
          normalizeString(existing?.confirmationAppointmentCancelledBy || '') || null,
        confirmationEmailDraft: normalizeString(existing?.confirmationEmailDraft || '') || null,
        confirmationEmailDraftGeneratedAt:
          normalizeString(existing?.confirmationEmailDraftGeneratedAt || '') || null,
        confirmationEmailDraftSource:
          normalizeString(existing?.confirmationEmailDraftSource || '') || null,
        confirmationTaskCreatedAt:
          normalizeString(existing?.confirmationTaskCreatedAt || '') ||
          normalizeString(existing?.createdAt || '') ||
          new Date().toISOString(),
      };
      return generatedAgendaAppointments[idx];
    }
  }

  const createdAtIso = normalizeString(appointment?.createdAt) || new Date().toISOString();
  const needsConfirmationEmail = toBooleanSafe(appointment?.needsConfirmationEmail, toBooleanSafe(appointment?.aiGenerated, false));
  const withId = {
    ...appointment,
    id: nextGeneratedAgendaAppointmentId++,
    createdAt: createdAtIso,
    needsConfirmationEmail,
    confirmationEmailSent: false,
    confirmationEmailSentAt: null,
    confirmationEmailSentBy: null,
    confirmationResponseReceived: false,
    confirmationResponseReceivedAt: null,
    confirmationResponseReceivedBy: null,
    confirmationAppointmentCancelled: false,
    confirmationAppointmentCancelledAt: null,
    confirmationAppointmentCancelledBy: null,
    confirmationEmailDraft: null,
    confirmationEmailDraftGeneratedAt: null,
    confirmationEmailDraftSource: null,
    confirmationTaskCreatedAt: createdAtIso,
  };
  generatedAgendaAppointments.push(withId);
  agendaAppointmentIdByCallId.set(callId, withId.id);
  return withId;
}

function buildGeneratedAgendaAppointmentFromAiInsight(insight) {
  if (!insight || !toBooleanSafe(insight.appointmentBooked, false)) return null;

  const date = normalizeDateYyyyMmDd(insight.appointmentDate);
  if (!date) return null;

  const time = normalizeTimeHhMm(insight.appointmentTime) || '09:00';
  const timeWasGuessed = !normalizeTimeHhMm(insight.appointmentTime);
  const company = normalizeString(insight.company || insight.leadCompany || '') || 'Onbekende lead';
  const contact = normalizeString(insight.contactName || insight.leadName || '') || 'Onbekend';
  const phone = normalizeString(insight.phone || '');
  const branche = normalizeString(insight.branche || insight.sector || '') || 'Onbekend';
  const summaryCore = truncateText(
    normalizeString(insight.summary || insight.shortSummary || insight.short_summary || ''),
    900
  );
  const summary = timeWasGuessed
    ? `${summaryCore}${summaryCore ? ' ' : ''}(Tijd niet expliciet genoemd; standaard op 09:00 gezet.)`
    : summaryCore;

  return {
    company,
    contact,
    phone,
    type: 'meeting',
    date,
    time,
    value: formatEuroLabel(insight.estimatedValueEur || insight.estimated_value_eur),
    branche,
    source: 'AI Cold Calling (Vapi + AI)',
    summary: summary || 'AI-samenvatting aangemaakt op basis van Vapi call update.',
    aiGenerated: true,
    callId: normalizeString(insight.callId),
    createdAt: new Date().toISOString(),
  };
}

async function createAiInsightFromCallUpdate(callUpdate) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const nowIso = new Date().toISOString();
  const systemPrompt = [
    'Je bent een sales-operations assistent voor een Nederlands coldcalling team.',
    'Analyseer een call-update en geef EEN geldig JSON-object terug (geen markdown).',
    'Doelen:',
    '1) Maak een korte Nederlandse samenvatting van max 3 zinnen.',
    '2) Bepaal of er een afspraak is ingepland.',
    '3) Extraheer afspraakdatum en tijd alleen als deze expliciet of zeer duidelijk genoemd zijn.',
    '4) Gebruik null als datum/tijd onbekend zijn.',
    '5) Raad geen bedragen of branche als dit niet uit de tekst blijkt; gebruik null of lege string.',
    'JSON keys exact:',
    'summary, appointmentBooked, appointmentDate, appointmentTime, contactName, company, phone, branche, estimatedValueEur, followUpRequired, followUpReason',
    'Datumformaat: YYYY-MM-DD. Tijdsformaat: HH:MM (24u).',
    'Taal output: Nederlands.',
  ].join('\n');

  const userPayload = {
    nowIso,
    timezone: 'Europe/Amsterdam',
    callUpdate: {
      callId: callUpdate.callId,
      status: callUpdate.status,
      messageType: callUpdate.messageType,
      endedReason: callUpdate.endedReason,
      company: callUpdate.company,
      name: callUpdate.name,
      phone: callUpdate.phone,
      vapiSummary: callUpdate.summary,
      transcriptSnippet: callUpdate.transcriptSnippet,
      updatedAt: callUpdate.updatedAt,
    },
  };

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
      }),
    },
    25000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI analyse mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = extractOpenAiTextContent(content);
  const parsed = parseJsonLoose(text);

  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('OpenAI gaf geen geldig JSON-object terug.');
    err.data = { rawContent: text };
    throw err;
  }

  return {
    callId: normalizeString(callUpdate.callId),
    company: normalizeString(parsed.company || callUpdate.company),
    contactName: normalizeString(parsed.contactName || parsed.contact_name || callUpdate.name),
    phone: normalizeString(parsed.phone || callUpdate.phone),
    branche: normalizeString(parsed.branche || parsed.branch || ''),
    summary: truncateText(
      normalizeString(parsed.summary || parsed.shortSummary || parsed.short_summary || callUpdate.summary),
      900
    ),
    appointmentBooked: toBooleanSafe(parsed.appointmentBooked ?? parsed.appointment_booked, false),
    appointmentDate: normalizeDateYyyyMmDd(parsed.appointmentDate || parsed.appointment_date),
    appointmentTime: normalizeTimeHhMm(parsed.appointmentTime || parsed.appointment_time),
    estimatedValueEur: parseNumberSafe(parsed.estimatedValueEur ?? parsed.estimated_value_eur, null),
    followUpRequired: toBooleanSafe(parsed.followUpRequired ?? parsed.follow_up_required, false),
    followUpReason: truncateText(
      normalizeString(parsed.followUpReason || parsed.follow_up_reason),
      300
    ),
    source: 'openai',
    model: OPENAI_MODEL,
    analyzedAt: new Date().toISOString(),
  };
}

function upsertAiCallInsight(insight) {
  if (!insight || !insight.callId) return null;

  const existing = aiCallInsightsByCallId.get(insight.callId);
  const merged = existing ? { ...existing, ...insight, callId: existing.callId } : insight;
  aiCallInsightsByCallId.set(merged.callId, merged);

  const idx = recentAiCallInsights.findIndex((item) => item.callId === merged.callId);
  if (idx >= 0) {
    recentAiCallInsights.splice(idx, 1);
  }
  recentAiCallInsights.unshift(merged);
  if (recentAiCallInsights.length > 500) {
    recentAiCallInsights.pop();
  }

  return merged;
}

async function maybeAnalyzeCallUpdateWithAi(callUpdate) {
  if (!shouldAnalyzeCallUpdateWithAi(callUpdate)) return null;
  if (!callUpdate?.callId) return null;

  const fingerprint = getCallUpdateAiFingerprint(callUpdate);
  if (aiAnalysisFingerprintByCallId.get(callUpdate.callId) === fingerprint) {
    return aiCallInsightsByCallId.get(callUpdate.callId) || null;
  }
  if (aiAnalysisInFlightCallIds.has(callUpdate.callId)) {
    return null;
  }

  aiAnalysisInFlightCallIds.add(callUpdate.callId);
  try {
    const insight = await createAiInsightFromCallUpdate(callUpdate);
    if (!insight) return null;

    const savedInsight = upsertAiCallInsight(insight);
    aiAnalysisFingerprintByCallId.set(callUpdate.callId, fingerprint);

    if (!normalizeString(callUpdate.summary) && normalizeString(savedInsight?.summary)) {
      upsertRecentCallUpdate({
        callId: callUpdate.callId,
        summary: savedInsight.summary,
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      });
    }

    const agendaAppointment = buildGeneratedAgendaAppointmentFromAiInsight({
      ...savedInsight,
      callId: callUpdate.callId,
      leadCompany: callUpdate.company,
      leadName: callUpdate.name,
    });
    if (agendaAppointment) {
      const savedAppointment = upsertGeneratedAgendaAppointment(agendaAppointment, callUpdate.callId);
      if (savedAppointment) {
        savedInsight.agendaAppointmentId = savedAppointment.id;
      }
    }

    console.log(
      '[AI Call Insight]',
      JSON.stringify(
        {
          callId: callUpdate.callId,
          appointmentBooked: savedInsight.appointmentBooked,
          appointmentDate: savedInsight.appointmentDate || null,
          appointmentTime: savedInsight.appointmentTime || null,
          hasSummary: Boolean(savedInsight.summary),
          agendaAppointmentId: savedInsight.agendaAppointmentId || null,
        },
        null,
        2
      )
    );

    return savedInsight;
  } finally {
    aiAnalysisInFlightCallIds.delete(callUpdate.callId);
  }
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

function buildConfirmationEmailDraftFallback(appointment, detail = {}) {
  const contact = normalizeString(appointment?.contact || detail?.contact || '') || 'heer/mevrouw';
  const company = normalizeString(appointment?.company || detail?.company || '') || 'uw bedrijf';
  const date = normalizeDateYyyyMmDd(appointment?.date || detail?.date);
  const time = normalizeTimeHhMm(appointment?.time || detail?.time) || '09:00';
  const datetimeLabel = formatDateTimeLabelNl(date, time) || `${date} ${time}`;

  const summary =
    normalizeString(detail?.aiSummary || detail?.vapiSummary || appointment?.summary || '').trim() ||
    'Bedankt voor het prettige gesprek.';

  return [
    `Onderwerp: Bevestiging afspraak ${company} - ${date || ''} ${time}`.trim(),
    '',
    `Beste ${contact},`,
    '',
    'Bedankt voor het prettige gesprek van vandaag.',
    `Hierbij bevestig ik onze afspraak op ${datetimeLabel}.`,
    '',
    'Korte samenvatting:',
    summary,
    '',
    'Laat het gerust weten als de tijd aangepast moet worden of als er nog aanvullende vragen zijn.',
    '',
    'Met vriendelijke groet,',
    'Softora',
  ].join('\n');
}

async function generateConfirmationEmailDraftWithAi(appointment, detail = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return {
      draft: buildConfirmationEmailDraftFallback(appointment, detail),
      source: 'template',
      model: null,
    };
  }

  const payload = {
    timezone: 'Europe/Amsterdam',
    appointment: {
      company: normalizeString(appointment?.company || ''),
      contact: normalizeString(appointment?.contact || ''),
      phone: normalizeString(appointment?.phone || ''),
      date: normalizeDateYyyyMmDd(appointment?.date),
      time: normalizeTimeHhMm(appointment?.time),
      source: normalizeString(appointment?.source || ''),
      branche: normalizeString(appointment?.branche || ''),
      value: normalizeString(appointment?.value || ''),
    },
    context: {
      aiSummary: truncateText(normalizeString(detail?.aiSummary || ''), 1000),
      vapiSummary: truncateText(normalizeString(detail?.vapiSummary || ''), 1000),
      transcriptSnippet: truncateText(normalizeString(detail?.transcriptSnippet || ''), 1200),
      transcript: truncateText(normalizeString(detail?.transcript || ''), 4000),
    },
  };

  const systemPrompt = [
    'Je bent een Nederlandse sales assistent.',
    'Schrijf een professionele maar korte bevestigingsmail na een telefonisch gesprek.',
    'Doel: afspraak bevestigen en de klant vragen om per mail te bevestigen dat tijd/datum klopt.',
    'Gebruik Nederlands.',
    'Geef alleen de emailtekst terug (met onderwerpregel bovenaan), geen markdown.',
    'Wees concreet over datum/tijd als aanwezig.',
    'Maximaal ongeveer 220 woorden.',
  ].join('\n');

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    },
    25000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI bevestigingsmail generatie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = extractOpenAiTextContent(content);
  const draft = normalizeString(text);
  if (!draft) {
    return {
      draft: buildConfirmationEmailDraftFallback(appointment, detail),
      source: 'template-fallback-empty',
      model: null,
    };
  }

  return {
    draft: truncateText(draft, 5000),
    source: 'openai',
    model: OPENAI_MODEL,
  };
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

async function processColdcallingLead(lead, campaign, index) {
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

function phoneDispatchKey(value) {
  return String(value || '').replace(/\D/g, '');
}

function isCallUpdateTerminalForSequentialDispatch(callUpdate) {
  if (!callUpdate) return false;

  const messageType = normalizeString(callUpdate.messageType).toLowerCase();
  const status = normalizeString(callUpdate.status).toLowerCase();
  const endedReason = normalizeString(callUpdate.endedReason).toLowerCase();

  if (endedReason) return true;
  if (messageType.includes('call.ended') || messageType.includes('end-of-call')) return true;

  if (
    /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected)/.test(
      status
    )
  ) {
    return true;
  }

  return false;
}

function createSequentialDispatchQueue(campaign, leads) {
  const id = `seq-${nextSequentialDispatchQueueId++}`;
  const queue = {
    id,
    createdAt: new Date().toISOString(),
    campaign: { ...campaign },
    leads: Array.isArray(leads) ? leads.slice() : [],
    nextLeadIndex: 0,
    waitingForCallId: null,
    waitingForPhoneKey: null,
    isAdvancing: false,
    completed: false,
    results: [],
  };
  sequentialDispatchQueues.set(id, queue);
  return queue;
}

function finalizeSequentialDispatchQueueIfDone(queue) {
  if (!queue) return;
  if (queue.completed) return;
  if (queue.waitingForCallId || queue.waitingForPhoneKey) return;
  if (queue.nextLeadIndex < queue.leads.length) return;

  queue.completed = true;
  console.log(
    `[Coldcalling][Sequential Queue] Voltooid ${queue.id}: ${queue.results.filter((r) => r.success).length}/${
      queue.results.length
    } gestart`
  );

  // Opruimen na korte tijd zodat debugging nog even mogelijk blijft.
  const queueId = queue.id;
  setTimeout(() => {
    const current = sequentialDispatchQueues.get(queueId);
    if (!current || !current.completed) return;
    if (current.waitingForCallId) {
      sequentialDispatchQueueIdByCallId.delete(current.waitingForCallId);
    }
    sequentialDispatchQueues.delete(queueId);
  }, 10 * 60 * 1000);
}

async function advanceSequentialDispatchQueue(queueId, reason = 'unknown') {
  const queue = sequentialDispatchQueues.get(queueId);
  if (!queue || queue.completed) return queue || null;
  if (queue.isAdvancing) return queue;
  if (queue.waitingForCallId || queue.waitingForPhoneKey) return queue;

  queue.isAdvancing = true;
  try {
    console.log(
      `[Coldcalling][Sequential Queue] Advance ${queue.id} (reason=${reason}) idx=${queue.nextLeadIndex}/${queue.leads.length}`
    );

    while (
      !queue.completed &&
      !queue.waitingForCallId &&
      !queue.waitingForPhoneKey &&
      queue.nextLeadIndex < queue.leads.length
    ) {
      const index = queue.nextLeadIndex;
      const lead = queue.leads[index];
      queue.nextLeadIndex += 1;

      const result = await processColdcallingLead(lead, queue.campaign, index);
      queue.results.push(result);

      const callId = normalizeString(result?.vapi?.callId);
      const phoneKey = phoneDispatchKey(result?.lead?.phoneE164 || result?.lead?.phone);
      if (result.success && callId) {
        queue.waitingForCallId = callId;
        queue.waitingForPhoneKey = phoneKey || null;
        sequentialDispatchQueueIdByCallId.set(callId, queue.id);
        console.log(
          `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde (${callId}) voor lead ${index + 1}/${
            queue.leads.length
          }`
        );
        break;
      }

      if (result.success && phoneKey) {
        queue.waitingForPhoneKey = phoneKey;
        console.log(
          `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde via telefoon (${phoneKey}) voor lead ${
            index + 1
          }/${queue.leads.length} (geen callId ontvangen)`
        );
        break;
      }

      console.log(
        `[Coldcalling][Sequential Queue] ${queue.id} lead ${index + 1}/${queue.leads.length} ${
          result.success ? 'gestart (zonder callId)' : 'mislukt'
        }, ga door`
      );
    }

    finalizeSequentialDispatchQueueIfDone(queue);
    return queue;
  } finally {
    queue.isAdvancing = false;
  }
}

function handleSequentialDispatchQueueWebhookProgress(callUpdate) {
  if (!callUpdate || !isCallUpdateTerminalForSequentialDispatch(callUpdate)) return;

  const callId = normalizeString(callUpdate.callId);
  const webhookPhoneKey = phoneDispatchKey(callUpdate.phone);

  let queueId = callId ? sequentialDispatchQueueIdByCallId.get(callId) : null;
  let queue = queueId ? sequentialDispatchQueues.get(queueId) : null;

  if (!queue && callId) {
    sequentialDispatchQueueIdByCallId.delete(callId);
  }

  if (!queue && webhookPhoneKey) {
    for (const candidate of sequentialDispatchQueues.values()) {
      if (candidate.completed) continue;
      if (candidate.waitingForCallId && callId && candidate.waitingForCallId !== callId) continue;
      if (candidate.waitingForPhoneKey && candidate.waitingForPhoneKey === webhookPhoneKey) {
        queue = candidate;
        queueId = candidate.id;
        break;
      }
    }
  }

  if (!queue || !queueId) return;

  const matchesCallId = callId && queue.waitingForCallId && queue.waitingForCallId === callId;
  const matchesPhone = webhookPhoneKey && queue.waitingForPhoneKey && queue.waitingForPhoneKey === webhookPhoneKey;
  if (!matchesCallId && !matchesPhone) return;

  if (queue.waitingForCallId) {
    sequentialDispatchQueueIdByCallId.delete(queue.waitingForCallId);
  }
  queue.waitingForCallId = null;
  queue.waitingForPhoneKey = null;

  console.log(
    `[Coldcalling][Sequential Queue] Call beëindigd (${callId || webhookPhoneKey}), volgende lead starten voor queue ${queueId}`
  );

  void advanceSequentialDispatchQueue(queueId, 'webhook-ended').catch((error) => {
    console.error(
      '[Coldcalling][Sequential Queue Error]',
      JSON.stringify(
        {
          queueId,
          callId: callId || null,
          message: error?.message || 'Onbekende fout',
        },
        null,
        2
      )
    );
  });
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

    return res.status(200).json({
      ok: true,
      summary: {
        requested: leads.length,
        attempted: leadsToProcess.length,
        started: startedNow,
        failed: failedNow,
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

    handleSequentialDispatchQueueWebhookProgress(callUpdate);

    void maybeAnalyzeCallUpdateWithAi(callUpdate).catch((error) => {
      console.error(
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

app.get('/api/ai/call-insights', (req, res) => {
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100)));
  return res.status(200).json({
    ok: true,
    count: Math.min(limit, recentAiCallInsights.length),
    insights: recentAiCallInsights.slice(0, limit),
    openAiEnabled: Boolean(getOpenAiApiKey()),
    model: OPENAI_MODEL,
  });
});

app.get('/api/agenda/appointments', (req, res) => {
  const limit = Math.max(1, Math.min(1000, parseIntSafe(req.query.limit, 200)));
  const sorted = generatedAgendaAppointments
    .filter(isGeneratedAppointmentConfirmedForAgenda)
    .slice()
    .sort(compareAgendaAppointments);
  return res.status(200).json({
    ok: true,
    count: Math.min(limit, sorted.length),
    appointments: sorted.slice(0, limit),
  });
});

app.get('/api/agenda/confirmation-tasks', (req, res) => {
  const limit = Math.max(1, Math.min(1000, parseIntSafe(req.query.limit, 100)));
  const tasks = generatedAgendaAppointments
    .map(mapAppointmentToConfirmationTask)
    .filter(Boolean)
    .sort(compareConfirmationTasks);

  return res.status(200).json({
    ok: true,
    count: Math.min(limit, tasks.length),
    tasks: tasks.slice(0, limit),
  });
});

app.get('/api/agenda/confirmation-tasks/:id', (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  const detail = buildConfirmationTaskDetail(appointment);
  if (!detail) {
    return res.status(404).json({ ok: false, error: 'Geen open bevestigingstaak voor deze afspraak' });
  }

  return res.status(200).json({
    ok: true,
    task: detail,
  });
});

app.post('/api/agenda/confirmation-tasks/:id/draft-email', async (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  const detail = buildConfirmationTaskDetail(appointment);
  if (!detail) {
    return res.status(409).json({ ok: false, error: 'Geen open bevestigingstaak voor deze afspraak' });
  }

  try {
    const generated = await generateConfirmationEmailDraftWithAi(appointment, detail);
    const nowIso = new Date().toISOString();
    generatedAgendaAppointments[idx] = {
      ...generatedAgendaAppointments[idx],
      confirmationEmailDraft: generated.draft,
      confirmationEmailDraftGeneratedAt: nowIso,
      confirmationEmailDraftSource: normalizeString(generated.source || 'template'),
    };

    return res.status(200).json({
      ok: true,
      task: buildConfirmationTaskDetail(generatedAgendaAppointments[idx]),
      generated: {
        source: normalizeString(generated.source || ''),
        model: normalizeString(generated.model || '') || null,
      },
    });
  } catch (error) {
    console.error(
      '[ConfirmationTask][DraftEmailError]',
      JSON.stringify(
        {
          appointmentId: Number(appointment?.id) || null,
          callId: normalizeString(appointment?.callId || '') || null,
          message: error?.message || 'Onbekende fout',
          status: Number(error?.status || 0) || null,
        },
        null,
        2
      )
    );

    return res.status(500).json({
      ok: false,
      error: 'Kon geen bevestigingsmail opstellen.',
      detail: normalizeString(error?.message || '') || null,
    });
  }
});

app.post('/api/agenda/confirmation-tasks/:id/mark-sent', (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }
  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  generatedAgendaAppointments[idx] = {
    ...appointment,
    confirmationEmailSent: true,
    confirmationEmailSentAt: nowIso,
    confirmationEmailSentBy: actor || null,
  };

  return res.status(200).json({
    ok: true,
    taskUpdated: true,
    task: buildConfirmationTaskDetail(generatedAgendaAppointments[idx]),
  });
});

app.post('/api/agenda/confirmation-tasks/:id/mark-response-received', (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }
  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  generatedAgendaAppointments[idx] = {
    ...appointment,
    confirmationEmailSent: true,
    confirmationEmailSentAt: normalizeString(appointment?.confirmationEmailSentAt || '') || nowIso,
    confirmationEmailSentBy: normalizeString(appointment?.confirmationEmailSentBy || '') || actor || null,
    confirmationResponseReceived: true,
    confirmationResponseReceivedAt: nowIso,
    confirmationResponseReceivedBy: actor || null,
    confirmationAppointmentCancelled: false,
    confirmationAppointmentCancelledAt: null,
    confirmationAppointmentCancelledBy: null,
  };

  return res.status(200).json({
    ok: true,
    taskCompleted: true,
    appointment: generatedAgendaAppointments[idx],
  });
});

app.post('/api/agenda/confirmation-tasks/:id/mark-cancelled', (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }
  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  generatedAgendaAppointments[idx] = {
    ...appointment,
    confirmationEmailSent: true,
    confirmationEmailSentAt: normalizeString(appointment?.confirmationEmailSentAt || '') || nowIso,
    confirmationEmailSentBy: normalizeString(appointment?.confirmationEmailSentBy || '') || actor || null,
    confirmationResponseReceived: false,
    confirmationResponseReceivedAt: null,
    confirmationResponseReceivedBy: null,
    confirmationAppointmentCancelled: true,
    confirmationAppointmentCancelledAt: nowIso,
    confirmationAppointmentCancelledBy: actor || null,
  };

  return res.status(200).json({
    ok: true,
    taskCompleted: true,
    cancelled: true,
    appointment: generatedAgendaAppointments[idx],
  });
});

app.post('/api/agenda/confirmation-tasks/:id/complete', (req, res) => {
  const taskId = Number(req.params.id);
  const idx = getGeneratedAppointmentIndexById(taskId);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  if (!mapAppointmentToConfirmationTask(appointment)) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  generatedAgendaAppointments[idx] = {
    ...appointment,
    confirmationEmailSent: true,
    confirmationEmailSentAt: nowIso,
    confirmationEmailSentBy: actor || null,
    confirmationResponseReceived: true,
    confirmationResponseReceivedAt: nowIso,
    confirmationResponseReceivedBy: actor || null,
    confirmationAppointmentCancelled: false,
    confirmationAppointmentCancelledAt: null,
    confirmationAppointmentCancelledBy: null,
  };

  return res.status(200).json({
    ok: true,
    taskCompleted: true,
    taskId,
    appointment: generatedAgendaAppointments[idx],
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

// Alias voor serverless setups waar de backend onder /api/* hangt (zoals Vercel).
app.get('/api/healthz', (_req, res) => {
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

  if (!knownHtmlPageFiles.has(page)) {
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

function seedDemoConfirmationTaskForUiTesting() {
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProduction) return;

  const demoCallId = 'demo-confirmation-task-call-1';
  if (generatedAgendaAppointments.some((item) => normalizeString(item?.callId) === demoCallId)) {
    return;
  }

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;

  upsertRecentCallUpdate({
    callId: demoCallId,
    phone: '+31612345678',
    company: 'Testbedrijf Demo BV',
    name: 'Servé Creusen',
    status: 'ended',
    messageType: 'call.ended',
    summary:
      'Afspraak ingepland voor een korte intake over de AI coldcalling setup. Klant wil eerst per mail bevestiging ontvangen.',
    transcriptSnippet:
      'AI: Zullen we morgen om 14:00 een intake plannen? | Klant: Ja, stuur even een bevestigingsmail dan bevestig ik per mail terug.',
    transcriptFull: [
      'assistant: Goedemiddag, u spreekt met de AI assistent van Softora.',
      'customer: Goedemiddag.',
      'assistant: Ik bel kort over het automatiseren van leadopvolging en intakeplanning.',
      'customer: Interessant, vertel.',
      'assistant: Zullen we een intake plannen om de workflow door te nemen?',
      'customer: Ja, dat is goed.',
      'assistant: Past morgen om 14:00 uur?',
      'customer: Ja, stuur even een bevestigingsmail. Als ik die heb, bevestig ik terug.',
      'assistant: Helemaal goed, dan zetten we dat zo door.',
    ].join('\n'),
    endedReason: 'completed',
    updatedAt: now.toISOString(),
    updatedAtMs: now.getTime(),
  });

  const insight = upsertAiCallInsight({
    callId: demoCallId,
    company: 'Testbedrijf Demo BV',
    contactName: 'Servé Creusen',
    phone: '+31612345678',
    branche: 'Zakelijke Dienstverlening',
    summary:
      'Prospect staat open voor intake. Afspraak mondeling ingepland en wil eerst een bevestigingsmail ontvangen en daarna per mail bevestigen.',
    appointmentBooked: true,
    appointmentDate: date,
    appointmentTime: '14:00',
    estimatedValueEur: 2800,
    followUpRequired: true,
    followUpReason: 'Bevestigingsmail sturen en wachten op schriftelijke bevestiging.',
    source: 'seed',
    model: 'seed',
    analyzedAt: now.toISOString(),
  });

  const appointment = upsertGeneratedAgendaAppointment(
    {
      company: 'Testbedrijf Demo BV',
      contact: 'Servé Creusen',
      phone: '+31612345678',
      type: 'meeting',
      date,
      time: '14:00',
      value: '€2.800',
      branche: 'Zakelijke Dienstverlening',
      source: 'AI Cold Calling (Testdata UI)',
      summary:
        'Testafspraak voor UI-testen. Eerst bevestigingsmail sturen, daarna wachten op mailbevestiging voordat de afspraak in de agenda verschijnt.',
      aiGenerated: true,
      callId: demoCallId,
      createdAt: now.toISOString(),
    },
    demoCallId
  );

  if (appointment) {
    appointment.confirmationEmailDraft = [
      'Onderwerp: Bevestiging intakeafspraak Testbedrijf Demo BV - morgen 14:00',
      '',
      'Beste Servé,',
      '',
      'Bedankt voor het prettige telefoongesprek van zojuist.',
      'Hierbij bevestig ik onze intakeafspraak voor morgen om 14:00 uur.',
      '',
      'Zoals besproken lopen we tijdens de intake kort de AI coldcalling workflow door en bekijken we de opvolging in het dashboard.',
      '',
      'Wil je deze tijd per mail bevestigen? Dan zetten wij de afspraak definitief in de agenda.',
      '',
      'Met vriendelijke groet,',
      'Softora',
    ].join('\n');
    appointment.confirmationEmailDraftGeneratedAt = now.toISOString();
    appointment.confirmationEmailDraftSource = 'seed';
    if (insight) {
      insight.agendaAppointmentId = appointment.id;
    }
  }

  console.log('[Startup] Demo bevestigingstaak toegevoegd voor UI-testen.');
}

function startServer() {
  seedDemoConfirmationTaskForUiTesting();
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

const isServerlessRuntime =
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  Boolean(process.env.LAMBDA_TASK_ROOT);

if (require.main === module && !isServerlessRuntime) {
  startServer();
}

module.exports = app;
module.exports.app = app;
module.exports.normalizeNlPhoneToE164 = normalizeNlPhoneToE164;
module.exports.startServer = startServer;
