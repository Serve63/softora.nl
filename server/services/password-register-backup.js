const {
  PASSWORD_REGISTER_SCOPE,
} = require('../security/password-register-access');
const {
  PASSWORD_REGISTER_ENCRYPTED_KEY,
  validatePasswordRegisterValues,
} = require('../schemas/password-register-vault');

const PASSWORD_REGISTER_STATE_KEY = `ui_state:${PASSWORD_REGISTER_SCOPE}`;

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeTrustedSupabaseBaseUrl(value) {
  const rawUrl = normalizeString(value);
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    const isTrustedProjectHost =
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/i.test(parsed.hostname);
    if (
      parsed.protocol !== 'https:' ||
      !isTrustedProjectHost ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname && parsed.pathname !== '/')
    ) {
      return '';
    }
    return `https://${parsed.hostname.toLowerCase()}`;
  } catch (_error) {
    return '';
  }
}

function getFirstRow(body) {
  if (Array.isArray(body)) return body[0] || null;
  return body && typeof body === 'object' ? body : null;
}

async function readPasswordRegisterVaultBackup(options = {}) {
  const configuredSupabaseUrl = normalizeString(options.supabaseUrl);
  const supabaseUrl = normalizeTrustedSupabaseBaseUrl(configuredSupabaseUrl);
  const serviceRoleKey = normalizeString(options.serviceRoleKey);
  const stateTable = normalizeString(options.stateTable || 'softora_runtime_state');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : global.fetch;

  if (!configuredSupabaseUrl || !serviceRoleKey || typeof fetchImpl !== 'function') {
    return {
      included: false,
      scope: PASSWORD_REGISTER_SCOPE,
      reason: 'supabase-not-configured',
    };
  }
  if (!supabaseUrl) {
    throw new Error('Kluisbackup weigert een niet-vertrouwd Supabase projectadres.');
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(stateTable)) {
    throw new Error('Ongeldige Supabase runtime-state tabel voor kluisbackup.');
  }

  const query = new URLSearchParams({
    state_key: `eq.${PASSWORD_REGISTER_STATE_KEY}`,
    select: 'state_key,payload,updated_at',
    limit: '1',
  });
  const requestUrl = new URL(`/rest/v1/${stateTable}`, `${supabaseUrl}/`);
  requestUrl.search = query.toString();
  const response = await fetchImpl(requestUrl.toString(), {
    method: 'GET',
    redirect: 'error',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });
  if (!response || !response.ok) {
    throw new Error(`Wachtwoordenkluis-backupread mislukt (${Number(response && response.status) || 0}).`);
  }

  const row = getFirstRow(await response.json());
  if (!row || normalizeString(row.state_key) !== PASSWORD_REGISTER_STATE_KEY) {
    throw new Error('Wachtwoordenkluis ontbreekt in Supabase runtime-state.');
  }
  const values = row.payload && row.payload.values && typeof row.payload.values === 'object'
    ? row.payload.values
    : {};
  const validation = validatePasswordRegisterValues(values);
  if (!validation.ok) {
    throw new Error('Wachtwoordenkluis-backup geweigerd wegens ongeldig versleuteld formaat.');
  }

  return {
    included: true,
    scope: PASSWORD_REGISTER_SCOPE,
    stateKey: PASSWORD_REGISTER_STATE_KEY,
    updatedAt: normalizeString(row.updated_at) || null,
    envelopeVersion: validation.version,
    values: validation.empty
      ? {}
      : { [PASSWORD_REGISTER_ENCRYPTED_KEY]: values[PASSWORD_REGISTER_ENCRYPTED_KEY] },
  };
}

async function attachPasswordRegisterVaultBackup(payload, options = {}) {
  const envelope = payload && typeof payload === 'object' ? payload : {};
  const snapshot = envelope.snapshot && typeof envelope.snapshot === 'object'
    ? envelope.snapshot
    : {};
  const vaultBackup = await readPasswordRegisterVaultBackup(options);
  envelope.snapshot = {
    ...snapshot,
    protectedUiState: {
      ...(snapshot.protectedUiState && typeof snapshot.protectedUiState === 'object'
        ? snapshot.protectedUiState
        : {}),
      [PASSWORD_REGISTER_SCOPE]: vaultBackup,
    },
  };
  return envelope;
}

module.exports = {
  PASSWORD_REGISTER_STATE_KEY,
  attachPasswordRegisterVaultBackup,
  normalizeTrustedSupabaseBaseUrl,
  readPasswordRegisterVaultBackup,
};
