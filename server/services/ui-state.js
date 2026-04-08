function createUiStateStore(deps = {}) {
  const {
    uiStateScopePrefix = 'ui_state:',
    inMemoryUiStateByScope = new Map(),
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    supabaseStateTable = '',
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false }),
    upsertSupabaseRowViaRest = async () => ({ ok: false }),
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    logger = console,
  } = deps;

  function normalizeUiStateScope(scope) {
    const value = normalizeString(scope || '').toLowerCase();
    if (!/^[a-z0-9:_-]{1,80}$/.test(value)) return '';
    return value;
  }

  function getUiStateRowKey(scope) {
    const normalizedScope = normalizeUiStateScope(scope);
    return normalizedScope ? `${uiStateScopePrefix}${normalizedScope}` : '';
  }

  function sanitizeUiStateValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    const out = {};
    for (const [rawKey, rawValue] of Object.entries(values)) {
      const key = normalizeString(rawKey);
      if (!key || key.length > 120) continue;
      if (rawValue === undefined) continue;
      if (rawValue === null) {
        out[key] = '';
        continue;
      }
      out[key] = truncateText(String(rawValue), 200000);
    }
    return out;
  }

  async function getUiStateValues(scope) {
    const normalizedScope = normalizeUiStateScope(scope);
    if (!normalizedScope) return null;

    if (!isSupabaseConfigured()) {
      return null;
    }

    try {
      const rowKey = getUiStateRowKey(normalizedScope);
      const client = getSupabaseClient();
      let row = null;

      if (client) {
        const { data, error } = await client
          .from(supabaseStateTable)
          .select('payload, updated_at')
          .eq('state_key', rowKey)
          .maybeSingle();

        if (!error) {
          row = data || null;
        } else {
          const fallback = await fetchSupabaseRowByKeyViaRest(rowKey, 'payload,updated_at');
          if (!fallback.ok) {
            logger.error('[UI State][Supabase][GetError]', error.message || error);
            return null;
          }
          row = Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
        }
      } else {
        const fallback = await fetchSupabaseRowByKeyViaRest(rowKey, 'payload,updated_at');
        if (!fallback.ok) {
          logger.error(
            '[UI State][Supabase][GetError]',
            'Supabase client ontbreekt en REST fallback faalde.'
          );
          return null;
        }
        row = Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
      }

      const values = sanitizeUiStateValues(row?.payload?.values || {});
      inMemoryUiStateByScope.set(normalizedScope, values);
      return {
        values: { ...values },
        updatedAt: normalizeString(row?.updated_at || '') || null,
        source: 'supabase',
      };
    } catch (error) {
      logger.error('[UI State][Supabase][GetCrash]', error?.message || error);
      return null;
    }
  }

  async function setUiStateValues(scope, values, meta = {}) {
    const normalizedScope = normalizeUiStateScope(scope);
    if (!normalizedScope) return null;

    const sanitizedValues = sanitizeUiStateValues(values);
    const updatedAt = new Date().toISOString();

    if (!isSupabaseConfigured()) {
      return null;
    }

    try {
      const client = getSupabaseClient();
      const rowKey = getUiStateRowKey(normalizedScope);
      const row = {
        state_key: rowKey,
        payload: {
          scope: normalizedScope,
          values: sanitizedValues,
        },
        meta: {
          type: 'ui_state',
          scope: normalizedScope,
          source: normalizeString(meta.source || 'frontend'),
          actor: normalizeString(meta.actor || ''),
        },
        updated_at: updatedAt,
      };

      let upsertError = null;
      if (client) {
        const { error } = await client.from(supabaseStateTable).upsert(row, {
          onConflict: 'state_key',
        });
        upsertError = error || null;
      } else {
        upsertError = new Error('Supabase client ontbreekt.');
      }

      if (upsertError) {
        const fallback = await upsertSupabaseRowViaRest(row);
        if (!fallback.ok) {
          logger.error('[UI State][Supabase][SetError]', upsertError.message || upsertError);
          return null;
        }
      }

      inMemoryUiStateByScope.set(normalizedScope, sanitizedValues);
      return { values: { ...sanitizedValues }, source: 'supabase', updatedAt };
    } catch (error) {
      logger.error('[UI State][Supabase][SetCrash]', error?.message || error);
      return null;
    }
  }

  return {
    getUiStateRowKey,
    getUiStateValues,
    normalizeUiStateScope,
    sanitizeUiStateValues,
    setUiStateValues,
  };
}

module.exports = {
  createUiStateStore,
};
