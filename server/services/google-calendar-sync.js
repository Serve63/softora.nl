const crypto = require('crypto');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const DEFAULT_TIMEZONE = 'Europe/Amsterdam';

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function createGoogleCalendarSyncService(deps = {}) {
  const {
    config = {},
    fetchImpl = fetch,
    upsertGeneratedAgendaAppointment = () => null,
    getGeneratedAppointmentIndexById = () => -1,
    setGeneratedAgendaAppointmentAtIndex = () => null,
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
    logger = console,
  } = deps;

  const calendarByOwner = {
    serve: normalizeString(config.serveCalendarId || ''),
    martijn: normalizeString(config.martijnCalendarId || ''),
  };
  const clientEmail = normalizeString(config.clientEmail || '');
  const privateKey = normalizeString(config.privateKey || '').replace(/\\n/g, '\n');
  const enabled = Boolean(config.enabled);
  const timezone = normalizeString(config.timezone || DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
  let tokenCache = null;
  let lastSyncNotBeforeMs = 0;
  let lastSyncResult = null;

  function isConfigured() {
    return Boolean(enabled && clientEmail && privateKey && (calendarByOwner.serve || calendarByOwner.martijn));
  }

  function getMissingConfig() {
    return [
      !enabled ? 'GOOGLE_CALENDAR_SYNC_ENABLED' : null,
      !clientEmail ? 'GOOGLE_CALENDAR_CLIENT_EMAIL' : null,
      !privateKey ? 'GOOGLE_CALENDAR_PRIVATE_KEY' : null,
      !calendarByOwner.serve ? 'GOOGLE_CALENDAR_SERVE_ID' : null,
      !calendarByOwner.martijn ? 'GOOGLE_CALENDAR_MARTIJN_ID' : null,
    ].filter(Boolean);
  }

  async function getAccessToken() {
    if (tokenCache && tokenCache.expiresAtMs - 60000 > Date.now()) return tokenCache.accessToken;
    const iat = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientEmail,
      scope: GOOGLE_CALENDAR_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: iat + 3600,
      iat,
    };
    const assertion = [
      base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
      base64Url(JSON.stringify(payload)),
    ].join('.');
    const signature = crypto.createSign('RSA-SHA256').update(assertion).sign(privateKey, 'base64url');
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${assertion}.${signature}`,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      const error = new Error(`Google Calendar token mislukt (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    tokenCache = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + Math.max(300, Number(data.expires_in || 3600)) * 1000,
    };
    return tokenCache.accessToken;
  }

  async function googleRequest(path, options = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Google Calendar request mislukt (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function formatDateInTimezone(date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function formatTimeInTimezone(date) {
    return new Intl.DateTimeFormat('nl-NL', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function resolveOwner(value) {
    const raw = normalizeString(value).toLowerCase();
    if (raw === 'martijn') return 'martijn';
    if (raw === 'serve' || raw === 'servé') return 'serve';
    return 'serve';
  }

  function mapGoogleEventToAppointment(event, owner, calendarId) {
    const eventId = normalizeString(event && event.id);
    if (!eventId) return null;
    const summary = truncateText(normalizeString(event.summary || 'Google Calendar activiteit'), 500);
    const start = event.start || {};
    const end = event.end || {};
    const allDay = Boolean(start.date && !start.dateTime);
    const startDate = allDay ? normalizeDateYyyyMmDd(start.date) : formatDateInTimezone(new Date(start.dateTime));
    const startTime = allDay ? '09:00' : normalizeTimeHhMm(formatTimeInTimezone(new Date(start.dateTime))) || '09:00';
    const endTime = allDay ? '17:00' : normalizeTimeHhMm(formatTimeInTimezone(new Date(end.dateTime || start.dateTime))) || '';
    if (!startDate) return null;
    const ownerLabel = owner === 'martijn' ? 'Martijn' : 'Servé';
    const location = sanitizeAppointmentLocation(event.location || '') || '—';
    const callId = `google_calendar_${owner}_${eventId}`;
    return {
      callId,
      aiGenerated: false,
      needsConfirmationEmail: false,
      company: summary,
      contact: '—',
      phone: '',
      date: startDate,
      time: startTime,
      location,
      appointmentLocation: location,
      source: 'Google Calendar',
      provider: 'google-calendar',
      providerLabel: 'Google Calendar',
      coldcallingStack: 'google-calendar',
      manualPlannerWho: owner,
      manualAllDayUnavailable: allDay,
      googleCalendarEventId: eventId,
      googleCalendarId: calendarId,
      googleCalendarOwner: owner,
      googleCalendarSyncedAt: now().toISOString(),
      googleCalendarHtmlLink: normalizeString(event.htmlLink || ''),
      summary: [
        summary,
        `Wie: ${ownerLabel}`,
        endTime ? `Beschikbaar vanaf: ${endTime}` : '',
        normalizeString(event.description || ''),
      ]
        .filter(Boolean)
        .join('\n\n'),
      summaryFormatVersion: 4,
      branche: '',
      confirmationTaskType: '',
    };
  }

  async function syncGoogleCalendarEvents(options = {}) {
    if (!isConfigured()) {
      return { ok: true, skipped: true, reason: 'google_calendar_not_configured', missing: getMissingConfig() };
    }
    const force = Boolean(options.force);
    const cooldownMs = Math.max(10000, Math.min(600000, Number(config.syncCooldownMs || 60000) || 60000));
    if (!force && Date.now() < lastSyncNotBeforeMs) {
      return lastSyncResult || { ok: true, skipped: true, reason: 'cooldown' };
    }
    const timeMin = options.timeMin || addDays(now(), -45).toISOString();
    const timeMax = options.timeMax || addDays(now(), 180).toISOString();
    const stats = { ok: true, imported: 0, scanned: 0, errors: [] };
    for (const [owner, calendarId] of Object.entries(calendarByOwner)) {
      if (!calendarId) continue;
      try {
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          timeMin,
          timeMax,
        });
        const data = await googleRequest(`/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
        const events = Array.isArray(data.items) ? data.items : [];
        for (const event of events) {
          if (event.status === 'cancelled') continue;
          stats.scanned += 1;
          const appointment = mapGoogleEventToAppointment(event, owner, calendarId);
          if (!appointment) continue;
          if (upsertGeneratedAgendaAppointment(appointment, appointment.callId)) stats.imported += 1;
        }
      } catch (error) {
        stats.errors.push(`${owner}: ${truncateText(error && error.message ? error.message : String(error), 220)}`);
      }
    }
    lastSyncNotBeforeMs = Date.now() + cooldownMs;
    lastSyncResult = stats;
    return stats;
  }

  function buildGoogleEventFromAppointment(appointment) {
    const title = truncateText(normalizeString(appointment.company || appointment.activity || 'Softora afspraak'), 200);
    const date = normalizeDateYyyyMmDd(appointment.date || '');
    const time = normalizeTimeHhMm(appointment.time || '') || '09:00';
    const allDay = Boolean(appointment.manualAllDayUnavailable);
    const availableAgainMatch = normalizeString(appointment.summary || '').match(/beschikbaar voor een reis naar prospect:\s*(\d{1,2}:\d{2})/i);
    const endTime =
      normalizeTimeHhMm(appointment.manualAvailableAgain || appointment.availableAgain || (availableAgainMatch && availableAgainMatch[1]) || '') ||
      '17:00';
    const event = {
      summary: title,
      location: sanitizeAppointmentLocation(appointment.location || appointment.appointmentLocation || ''),
      description: truncateText(normalizeString(appointment.summary || ''), 8000),
      extendedProperties: {
        private: {
          softoraAppointmentId: String(appointment.id || ''),
          softoraCallId: normalizeString(appointment.callId || ''),
          softoraSource: 'premium-personeel-agenda',
        },
      },
    };
    if (allDay) {
      event.start = { date };
      event.end = { date: addDays(new Date(`${date}T00:00:00.000Z`), 1).toISOString().slice(0, 10) };
    } else {
      event.start = { dateTime: `${date}T${time}:00`, timeZone: timezone };
      event.end = { dateTime: `${date}T${endTime}:00`, timeZone: timezone };
    }
    return event;
  }

  async function createGoogleCalendarEventForAppointment(appointment) {
    if (!isConfigured()) return { ok: true, skipped: true, reason: 'google_calendar_not_configured' };
    const rawOwner = normalizeString(appointment.manualPlannerWho || appointment.googleCalendarOwner || '').toLowerCase();
    if (rawOwner === 'overig' || rawOwner === 'other') {
      return { ok: true, skipped: true, reason: 'calendar_not_required_for_other', owner: 'overig' };
    }
    const owner = resolveOwner(appointment.manualPlannerWho || appointment.googleCalendarOwner || '');
    const calendarId = calendarByOwner[owner];
    if (!calendarId) return { ok: false, skipped: true, reason: 'calendar_missing_for_owner', owner };
    if (normalizeString(appointment.googleCalendarEventId || '')) {
      return { ok: true, skipped: true, reason: 'already_linked' };
    }
    const event = buildGoogleEventFromAppointment(appointment);
    const data = await googleRequest(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
    const idx = getGeneratedAppointmentIndexById(appointment.id);
    const updated = {
      ...appointment,
      googleCalendarEventId: normalizeString(data.id || ''),
      googleCalendarId: calendarId,
      googleCalendarOwner: owner,
      googleCalendarSyncedAt: now().toISOString(),
      googleCalendarHtmlLink: normalizeString(data.htmlLink || ''),
    };
    if (idx >= 0) setGeneratedAgendaAppointmentAtIndex(idx, updated, 'google_calendar_manual_export');
    return { ok: true, appointment: updated, event: data };
  }

  return {
    createGoogleCalendarEventForAppointment,
    getMissingConfig,
    isConfigured,
    syncGoogleCalendarEvents,
  };
}

module.exports = {
  createGoogleCalendarSyncService,
};
