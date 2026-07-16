const crypto = require('crypto');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function hours(milliseconds) {
  const value = Number(milliseconds);
  return Number.isFinite(value) ? Math.round((value / 3600000) * 100) / 100 : '';
}

function createGoogleHealthSheetService(deps = {}) {
  const config = deps.config || {};
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const clientEmail = String(config.clientEmail || '').trim();
  const privateKey = String(config.privateKey || '').trim().replace(/\\n/g, '\n');
  const spreadsheetId = String(config.spreadsheetId || '').trim();
  let tokenCache = null;

  function isConfigured() {
    return Boolean(clientEmail && privateKey && spreadsheetId && typeof fetchImpl === 'function');
  }

  function getSpreadsheetUrl() {
    return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : '';
  }

  async function getAccessToken() {
    if (tokenCache && tokenCache.expiresAtMs - 60000 > Date.now()) return tokenCache.accessToken;
    const iat = Math.floor(Date.now() / 1000);
    const assertion = [
      base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
      base64Url(JSON.stringify({
        iss: clientEmail,
        scope: GOOGLE_SHEETS_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        exp: iat + 3600,
        iat,
      })),
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
      throw new Error(`Google Sheets token mislukt (${response.status})`);
    }
    tokenCache = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + Math.max(300, Number(data.expires_in || 3600)) * 1000,
    };
    return tokenCache.accessToken;
  }

  async function googleRequest(path, options = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${GOOGLE_SHEETS_API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `Google Sheets request mislukt (${response.status})`;
      throw new Error(message);
    }
    return data;
  }

  function buildDailyRows(records) {
    const byDay = new Map();
    records.forEach((record) => {
      const day = String(record.local_day || '');
      if (!day) return;
      if (!byDay.has(day)) byDay.set(day, { workouts: [] });
      const bucket = byDay.get(day);
      if (record.source_type === 'workout') bucket.workouts.push(record.summary || {});
      else bucket[record.source_type] = record.summary || {};
    });
    return Array.from(byDay.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, data]) => {
        const cycle = data.cycle || {};
        const recovery = data.recovery || {};
        const sleep = data.sleep || {};
        const stages = sleep.stage_summary || {};
        return [
          day,
          recovery.recovery_score ?? '',
          recovery.hrv_rmssd_milli ?? '',
          recovery.resting_heart_rate ?? '',
          recovery.spo2_percentage ?? '',
          recovery.skin_temp_celsius ?? '',
          cycle.strain ?? '',
          cycle.kilojoule ?? '',
          cycle.average_heart_rate ?? '',
          cycle.max_heart_rate ?? '',
          sleep.sleep_performance_percentage ?? '',
          hours(stages.total_in_bed_time_milli),
          hours(stages.total_rem_sleep_time_milli),
          hours(stages.total_slow_wave_sleep_time_milli),
          hours(stages.total_light_sleep_time_milli),
          sleep.respiratory_rate ?? '',
          data.workouts.length,
        ];
      });
  }

  function buildSleepRows(records) {
    return records
      .filter((record) => record.source_type === 'sleep')
      .sort((a, b) => String(b.start_at || '').localeCompare(String(a.start_at || '')))
      .map((record) => {
        const sleep = record.summary || {};
        const stages = sleep.stage_summary || {};
        return [
          record.source_id,
          record.local_day,
          record.start_at || '',
          record.end_at || '',
          sleep.nap ? 'Ja' : 'Nee',
          sleep.sleep_performance_percentage ?? '',
          sleep.sleep_consistency_percentage ?? '',
          sleep.sleep_efficiency_percentage ?? '',
          hours(stages.total_in_bed_time_milli),
          hours(stages.total_awake_time_milli),
          hours(stages.total_light_sleep_time_milli),
          hours(stages.total_slow_wave_sleep_time_milli),
          hours(stages.total_rem_sleep_time_milli),
          stages.disturbance_count ?? '',
          sleep.respiratory_rate ?? '',
        ];
      });
  }

  function buildWorkoutRows(records) {
    return records
      .filter((record) => record.source_type === 'workout')
      .sort((a, b) => String(b.start_at || '').localeCompare(String(a.start_at || '')))
      .map((record) => {
        const workout = record.summary || {};
        const zones = workout.zone_durations || {};
        return [
          record.source_id,
          record.local_day,
          record.start_at || '',
          record.end_at || '',
          workout.sport_name || '',
          workout.strain ?? '',
          workout.average_heart_rate ?? '',
          workout.max_heart_rate ?? '',
          workout.kilojoule ?? '',
          workout.distance_meter ?? '',
          hours(zones.zone_zero_milli),
          hours(zones.zone_one_milli),
          hours(zones.zone_two_milli),
          hours(zones.zone_three_milli),
          hours(zones.zone_four_milli),
          hours(zones.zone_five_milli),
        ];
      });
  }

  async function syncSnapshot(snapshot = {}) {
    if (!isConfigured()) return { ok: true, skipped: true, reason: 'google_sheet_not_configured' };
    const records = Array.isArray(snapshot.records) ? snapshot.records : [];
    const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
    const valuesByRange = [
      {
        range: 'Dagoverzicht!A1:Q',
        values: [[
          'Datum', 'Recovery %', 'HRV (ms)', 'Rusthartslag (bpm)', 'SpO2 (%)', 'Huidtemperatuur (°C)',
          'Day strain', 'Energie (kJ)', 'Gem. hartslag', 'Max. hartslag', 'Slaapprestatie %',
          'In bed (uur)', 'REM (uur)', 'Deep (uur)', 'Light (uur)', 'Ademhaling (/min)', 'Workouts',
        ], ...buildDailyRows(records)],
      },
      {
        range: 'Slaap!A1:O',
        values: [[
          'WHOOP slaap-ID', 'Datum', 'Start', 'Einde', 'Dutje', 'Prestatie %', 'Consistentie %',
          'Efficiëntie %', 'In bed (uur)', 'Wakker (uur)', 'Light (uur)', 'Deep (uur)', 'REM (uur)',
          'Verstoringen', 'Ademhaling (/min)',
        ], ...buildSleepRows(records)],
      },
      {
        range: 'Workouts!A1:P',
        values: [[
          'WHOOP workout-ID', 'Datum', 'Start', 'Einde', 'Activiteit', 'Strain', 'Gem. hartslag',
          'Max. hartslag', 'Energie (kJ)', 'Afstand (m)', 'Zone 0 (uur)', 'Zone 1 (uur)',
          'Zone 2 (uur)', 'Zone 3 (uur)', 'Zone 4 (uur)', 'Zone 5 (uur)',
        ], ...buildWorkoutRows(records)],
      },
      {
        range: 'Ruwe_data!A1:J',
        values: [[
          'Type', 'WHOOP ID', 'Datum', 'Start', 'Einde', 'Scorestatus', 'WHOOP gewijzigd',
          'Softora gewijzigd', 'Samenvatting JSON', 'Ruwe WHOOP JSON',
        ], ...records.map((record) => [
          record.source_type, record.source_id, record.local_day, record.start_at || '', record.end_at || '',
          record.score_state || '', record.source_updated_at || '', record.updated_at || '',
          JSON.stringify(record.summary || {}), JSON.stringify(record.raw || {}),
        ])],
      },
      {
        range: 'Sync_log!A1:I',
        values: [[
          'Gestart', 'Afgerond', 'Doeldatum', 'Modus', 'Status', 'Gezien', 'Opgeslagen', 'Sheetstatus', 'Fout',
        ], ...runs.map((run) => [
          run.started_at || '', run.completed_at || '', run.target_day || '', run.mode || '', run.status || '',
          run.records_seen || 0, run.records_upserted || 0, run.sheet_status || '', run.error || '',
        ])],
      },
    ];

    await googleRequest(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
      method: 'POST',
      body: JSON.stringify({ ranges: valuesByRange.map((entry) => entry.range) }),
    });
    await googleRequest(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: valuesByRange.map((entry) => ({
          range: entry.range,
          majorDimension: 'ROWS',
          values: entry.values,
        })),
      }),
    });
    return { ok: true, rows: records.length, spreadsheetUrl: getSpreadsheetUrl() };
  }

  return { getSpreadsheetUrl, isConfigured, syncSnapshot };
}

module.exports = { createGoogleHealthSheetService };
