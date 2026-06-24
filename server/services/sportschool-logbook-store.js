const SPORTSCHOOL_LOGBOOK_TABLE = 'softora_sportschool_logbook';
const SPORTSCHOOL_LOGBOOK_ROW_ID = 'serve_logbook';
const SPORTSCHOOL_LOGBOOK_SCOPE = 'sportschool_logboek';
const SPORTSCHOOL_LOGBOOK_KEY = 'sportschool_logboek_v1';
const SPORTSCHOOL_LOGBOOK_MAX_LENGTH = 180000;

function normalizeSportschoolLogbookPayload(rawPayload) {
  let payload = rawPayload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (_error) {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (!payload.days || typeof payload.days !== 'object' || Array.isArray(payload.days)) return null;
  const serialized = JSON.stringify(payload);
  if (serialized.length > SPORTSCHOOL_LOGBOOK_MAX_LENGTH) return null;
  return { payload, serialized };
}

function createSportschoolLogbookStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    normalizeString = (value) => String(value || '').trim(),
    logger = console,
    now = () => new Date(),
  } = deps;

  function getClient() {
    if (!isSupabaseConfigured()) return null;
    return getSupabaseClient({
      timeoutMs: 10000,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
  }

  function buildState(serialized, updatedAt) {
    return {
      values: { [SPORTSCHOOL_LOGBOOK_KEY]: serialized },
      source: 'supabase:sportschool',
      updatedAt: normalizeString(updatedAt) || null,
    };
  }

  function logError(label, error) {
    const log = logger && (typeof logger.error === 'function' ? logger.error : logger.warn);
    if (typeof log === 'function') {
      log.call(logger, `[SportschoolLogbook][${label}]`, error?.message || error);
    }
  }

  async function readLogbookState() {
    const client = getClient();
    if (!client) return null;
    try {
      const { data, error } = await client
        .from(SPORTSCHOOL_LOGBOOK_TABLE)
        .select('payload, updated_at')
        .eq('id', SPORTSCHOOL_LOGBOOK_ROW_ID)
        .maybeSingle();
      if (error) throw error;
      const normalized = normalizeSportschoolLogbookPayload(data && data.payload);
      if (!normalized) return null;
      return buildState(normalized.serialized, data && data.updated_at);
    } catch (error) {
      logError('read', error);
      return null;
    }
  }

  async function writeLogbookSnapshot(snapshot, meta = {}) {
    const normalized = normalizeSportschoolLogbookPayload(snapshot);
    if (!normalized) return null;
    const client = getClient();
    if (!client) return null;
    const updatedAt = now().toISOString();
    try {
      const { error } = await client.from(SPORTSCHOOL_LOGBOOK_TABLE).upsert(
        {
          id: SPORTSCHOOL_LOGBOOK_ROW_ID,
          payload: normalized.payload,
          updated_at: updatedAt,
        },
        { onConflict: 'id' }
      );
      if (error) throw error;
      return {
        ...buildState(normalized.serialized, updatedAt),
        meta: {
          source: normalizeString(meta.source || 'sportschool-logboek'),
          actor: normalizeString(meta.actor || 'serve'),
        },
      };
    } catch (error) {
      logError('write', error);
      return null;
    }
  }

  return {
    readLogbookState,
    writeLogbookSnapshot,
  };
}

module.exports = {
  SPORTSCHOOL_LOGBOOK_KEY,
  SPORTSCHOOL_LOGBOOK_SCOPE,
  SPORTSCHOOL_LOGBOOK_TABLE,
  createSportschoolLogbookStore,
  normalizeSportschoolLogbookPayload,
};
