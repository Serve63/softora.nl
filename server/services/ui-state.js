function createUiStateStore(deps = {}) {
  const {
    uiStateScopePrefix = 'ui_state:',
    inMemoryUiStateByScope = new Map(),
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    supabaseStateTable = '',
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false }),
    upsertSupabaseRowViaRest = async () => ({ ok: false }),
    uiStateReadTimeoutMs = 1500,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    logger = console,
  } = deps;

  function getSafeUiStateReadTimeoutMs() {
    return Math.max(0, Math.min(10000, Number(uiStateReadTimeoutMs) || 0));
  }

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

  function buildInMemoryState(scope) {
    const cachedValues = inMemoryUiStateByScope.get(scope);
    if (!cachedValues || typeof cachedValues !== 'object') return null;
    const values = sanitizeUiStateValues(cachedValues);
    return {
      values: { ...values },
      updatedAt: null,
      source: 'memory',
    };
  }

  async function getUiStateValues(scope) {
    const normalizedScope = normalizeUiStateScope(scope);
    if (!normalizedScope) return null;

    if (!isSupabaseConfigured()) {
      return null;
    }

    const executeRead = async () => {
      const rowKey = getUiStateRowKey(normalizedScope);
      const client = getSupabaseClient();
      let row = null;
      async function readRowViaRest(clientError = null) {
        const fallback = await fetchSupabaseRowByKeyViaRest(rowKey, 'payload,updated_at');
        if (!fallback.ok) {
          const fallbackMsg = fallback.error
            ? ` | REST fallback: ${fallback.error}`
            : fallback.status
              ? ` | REST fallback status: ${fallback.status}`
              : '';
          logger.error(
            '[UI State][Supabase][GetError]',
            `${clientError?.message || clientError || 'Supabase client ontbreekt.'}${fallbackMsg}`
          );
          return buildInMemoryState(normalizedScope);
        }
        return Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
      }

      if (client) {
        try {
          const { data, error } = await client
            .from(supabaseStateTable)
            .select('payload, updated_at')
            .eq('state_key', rowKey)
            .maybeSingle();

          if (!error) {
            row = data || null;
          } else {
            row = await readRowViaRest(error);
            if (row === null) return null;
          }
        } catch (error) {
          row = await readRowViaRest(error);
          if (row === null) return null;
        }
      } else {
        row = await readRowViaRest(new Error('Supabase client ontbreekt.'));
        if (row === null) return null;
      }

      const values = sanitizeUiStateValues(row?.payload?.values || {});
      inMemoryUiStateByScope.set(normalizedScope, values);
      return {
        values: { ...values },
        updatedAt: normalizeString(row?.updated_at || '') || null,
        source: row?.source || 'supabase',
      };
    };

    const timeoutMs = getSafeUiStateReadTimeoutMs();
    const memoryState = buildInMemoryState(normalizedScope);

    if (!timeoutMs) {
      try {
        return await executeRead();
      } catch (error) {
        logger.error('[UI State][Supabase][GetCrash]', error?.message || error);
        return memoryState;
      }
    }

    try {
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(value);
        };

        const timeoutHandle = setTimeout(() => {
          logger.error('[UI State][Supabase][GetTimeout]', normalizedScope, `na ${timeoutMs}ms`);
          finish(memoryState);
        }, timeoutMs);

        Promise.resolve()
          .then(executeRead)
          .then((value) => finish(value))
          .catch((error) => {
            logger.error('[UI State][Supabase][GetCrash]', error?.message || error);
            finish(memoryState);
          });
      });
    } catch (error) {
      logger.error('[UI State][Supabase][GetCrash]', error?.message || error);
      return memoryState;
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
        try {
          const { error } = await client.from(supabaseStateTable).upsert(row, {
            onConflict: 'state_key',
          });
          upsertError = error || null;
        } catch (error) {
          upsertError = error;
        }
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
