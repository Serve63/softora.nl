const crypto = require('node:crypto');

const DIRECTORY_TABLE = 'softora_kvk_company_directory';
const META_TABLE = 'softora_kvk_company_directory_meta';
const META_ID = 'canonical';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_SYNC_BATCH_SIZE = 5000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_WRITE_TIMEOUT_MS = 120_000;
const DIRECTORY_CATEGORIES = Object.freeze({
  all: 'all',
  behandeld: 'behandeld',
  'succesvol-gevonden': 'succesvol-gevonden',
  bruikbaar: 'bruikbaar',
  'met-website': 'met-website',
  'zonder-werkende-website': 'zonder-werkende-website',
  controle: 'controle',
  definitief: 'definitief',
});
const DIRECTORY_SELECT_COLUMNS = [
  'source_company_id',
  'bedrijfsnaam',
  'kvk_nummer',
  'contact_status',
  'lead_status',
  'unusable_reason',
  'telefoonnummer',
  'email',
  'website',
  'website_status',
  'woonplaats',
  'gemeente',
  'provincie',
  'usable_review_state',
  'usable_review_outcome',
  'unusable_review_grade',
  'premium_database_transferred',
].join(',');

function createKvkCompanyDirectoryService(deps = {}) {
  const {
    getSupabaseClient = () => null,
    kvkDatabaseSyncToken = '',
    fallbackSyncToken = '',
    readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
    writeTimeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
  } = deps;

  function directoryClient() {
    try {
      return getSupabaseClient({
        timeoutMs: Math.max(readTimeoutMs, Math.min(writeTimeoutMs, 60_000)),
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      }) || null;
    } catch {
      return null;
    }
  }

  function constantTimeEquals(left, right) {
    const leftText = normalizeString(left);
    const rightText = normalizeString(right);
    if (!leftText || !rightText) return false;
    const leftBuffer = Buffer.from(leftText);
    const rightBuffer = Buffer.from(rightText);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  function acceptedTokens() {
    return [kvkDatabaseSyncToken, fallbackSyncToken]
      .map((token) => normalizeString(token))
      .filter(Boolean);
  }

  function requestToken(req) {
    const authorization = normalizeString(req?.headers?.authorization || '');
    if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
    return normalizeString(
      req?.headers?.['x-kvk-sync-token'] ||
        req?.headers?.['x-softora-sync-token'] ||
        req?.body?.syncToken ||
        ''
    );
  }

  function hasValidSyncToken(req) {
    const submittedToken = requestToken(req);
    return acceptedTokens().some((token) => constantTimeEquals(submittedToken, token));
  }

  function withTimeout(promise, timeoutMs, message) {
    const safeTimeout = Math.max(1000, Number(timeoutMs) || 1000);
    let timeoutHandle = null;
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(message)), safeTimeout);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timeoutHandle));
  }

  function normalizedSearchValue(value) {
    return normalizeString(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function searchTerms(value) {
    return normalizedSearchValue(value)
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .slice(0, 8);
  }

  function escapeIlikePattern(value) {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
  }

  function normalizedField(value, maxLength) {
    return truncateText(normalizeString(value), maxLength);
  }

  function normalizeTimestamp(value) {
    const raw = normalizeString(value);
    if (!raw) return null;
    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function normalizeCategory(value) {
    const category = normalizeString(value).toLowerCase();
    return DIRECTORY_CATEGORIES[category] || DIRECTORY_CATEGORIES.all;
  }

  function normalizeCategoryTotals(value) {
    const totals = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(
      Object.values(DIRECTORY_CATEGORIES).map((category) => [
        category,
        Math.max(0, Math.trunc(Number(totals[category]) || 0)),
      ])
    );
  }

  function applyDirectoryCategoryFilter(request, category) {
    if (category === DIRECTORY_CATEGORIES.behandeld) {
      return request.in('lead_status', ['usable', 'unusable']);
    }
    if (category === DIRECTORY_CATEGORIES['succesvol-gevonden']) {
      return request.eq('lead_status', 'usable');
    }
    if (category === DIRECTORY_CATEGORIES.bruikbaar) {
      return request
        .eq('lead_status', 'usable')
        .eq('usable_review_state', 'verified')
        .eq('premium_database_transferred', false);
    }
    if (category === DIRECTORY_CATEGORIES['met-website']) {
      return request
        .eq('lead_status', 'usable')
        .eq('usable_review_state', 'verified')
        .eq('premium_database_transferred', false)
        .eq('website_status', 'found')
        .neq('website', '');
    }
    if (category === DIRECTORY_CATEGORIES['zonder-werkende-website']) {
      return request
        .eq('lead_status', 'usable')
        .eq('premium_database_transferred', false)
        .in('website_status', ['no_website', 'not_working']);
    }
    if (category === DIRECTORY_CATEGORIES.controle) {
      return request.eq('lead_status', 'unusable').eq('unusable_review_grade', 1);
    }
    if (category === DIRECTORY_CATEGORIES.definitief) {
      return request.eq('lead_status', 'unusable').gte('unusable_review_grade', 2);
    }
    return request;
  }

  function normalizeSyncRow(row, generation) {
    const sourceCompanyId = Number(row?.source_company_id);
    const kvkNummer = normalizedField(row?.kvk_nummer, 32);
    const bedrijfsnaam = normalizedField(row?.bedrijfsnaam, 500);
    if (!Number.isSafeInteger(sourceCompanyId) || sourceCompanyId <= 0 || !kvkNummer || !bedrijfsnaam) {
      return null;
    }

    const normalized = {
      source_company_id: sourceCompanyId,
      kvk_nummer: kvkNummer,
      bedrijfsnaam,
      contact_status: normalizedField(row?.contact_status || 'unknown', 40),
      lead_status: normalizedField(row?.lead_status || 'unresearched', 40),
      unusable_reason: normalizedField(row?.unusable_reason, 80),
      telefoonnummer: normalizedField(row?.telefoonnummer, 100),
      email: normalizedField(row?.email, 320),
      website: normalizedField(row?.website, 2000),
      website_status: normalizedField(row?.website_status || 'unknown', 40),
      woonplaats: normalizedField(row?.woonplaats || row?.plaats, 200),
      gemeente: normalizedField(row?.gemeente, 200),
      provincie: normalizedField(row?.provincie, 200),
      usable_review_state: normalizedField(row?.usable_review_state || 'not_required', 40),
      usable_review_outcome: normalizedField(row?.usable_review_outcome, 80),
      unusable_review_grade: Math.max(0, Math.min(3, Math.trunc(Number(row?.unusable_review_grade) || 0))),
      premium_database_transferred: Boolean(row?.premium_database_transferred),
      sync_generation: generation,
      source_updated_at: normalizeTimestamp(row?.source_updated_at || row?.updated_at),
      synced_at: now().toISOString(),
    };
    normalized.search_text = normalizedSearchValue(
      [
        normalized.bedrijfsnaam,
        normalized.kvk_nummer,
        normalized.telefoonnummer,
        normalized.email,
        normalized.website,
        normalized.woonplaats,
        normalized.gemeente,
        normalized.provincie,
      ].join(' ')
    );
    return normalized;
  }

  async function fetchDirectoryRows({
    query = '',
    cursor = 0,
    limit = DEFAULT_PAGE_SIZE,
    category = DIRECTORY_CATEGORIES.all,
  } = {}) {
    const client = directoryClient();
    if (!client) return { ok: false, error: 'Supabase is niet geconfigureerd.' };
    let request = client
      .from(DIRECTORY_TABLE)
      .select(DIRECTORY_SELECT_COLUMNS)
      .order('source_company_id', { ascending: true })
      .limit(limit + 1);
    request = applyDirectoryCategoryFilter(request, normalizeCategory(category));
    if (cursor > 0) request = request.gt('source_company_id', cursor);
    for (const term of searchTerms(query)) {
      request = request.ilike('search_text', `%${escapeIlikePattern(term)}%`);
    }
    try {
      const result = await withTimeout(
        request,
        readTimeoutMs,
        'Online bedrijvendatabase reageerde niet op tijd.'
      );
      if (result?.error) return { ok: false, error: result.error.message || String(result.error) };
      return { ok: true, rows: Array.isArray(result?.data) ? result.data : [] };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function fetchDirectoryMeta() {
    const client = directoryClient();
    if (!client) return { ok: false, error: 'Supabase is niet geconfigureerd.' };
    try {
      const result = await withTimeout(
        client
          .from(META_TABLE)
          .select('total,category_totals,completed,sync_generation,source_updated_at,updated_at')
          .eq('id', META_ID)
          .limit(1),
        readTimeoutMs,
        'Online bedrijvendatabase-metadata reageerde niet op tijd.'
      );
      if (result?.error) return { ok: false, error: result.error.message || String(result.error) };
      return { ok: true, row: Array.isArray(result?.data) ? result.data[0] || null : null };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function upsertDirectoryRows(rows) {
    const client = directoryClient();
    if (!client) return { ok: false, error: 'Supabase is niet geconfigureerd.' };
    try {
      const result = await withTimeout(
        client.from(DIRECTORY_TABLE).upsert(rows, { onConflict: 'kvk_nummer' }),
        writeTimeoutMs,
        'Online bedrijvendatabase-sync reageerde niet op tijd.'
      );
      if (result?.error) return { ok: false, error: result.error.message || String(result.error) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function deleteStaleRows(generation) {
    const client = directoryClient();
    if (!client) return { ok: false, error: 'Supabase is niet geconfigureerd.' };
    try {
      const result = await withTimeout(
        client.from(DIRECTORY_TABLE).delete().neq('sync_generation', generation),
        writeTimeoutMs,
        'Verouderde online bedrijfsregels opruimen duurde te lang.'
      );
      if (result?.error) return { ok: false, error: result.error.message || String(result.error) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function upsertDirectoryMeta({
    total,
    categoryTotals,
    completed,
    generation,
    sourceUpdatedAt,
  }) {
    const client = directoryClient();
    if (!client) return { ok: false, error: 'Supabase is niet geconfigureerd.' };
    try {
      const result = await withTimeout(
        client.from(META_TABLE).upsert(
          {
            id: META_ID,
            total,
            category_totals: normalizeCategoryTotals(categoryTotals),
            completed,
            sync_generation: generation,
            source_updated_at: normalizeTimestamp(sourceUpdatedAt),
            updated_at: now().toISOString(),
          },
          { onConflict: 'id' }
        ),
        writeTimeoutMs,
        'Online bedrijvendatabase-metadata kon niet worden opgeslagen.'
      );
      if (result?.error) return { ok: false, error: result.error.message || String(result.error) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function sendGetDirectoryResponse(req, res) {
    const query = normalizedField(req?.query?.q, 120);
    const category = normalizeCategory(req?.query?.categorie);
    const cursor = Math.max(0, Number(req?.query?.after) || 0);
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(req?.query?.limit) || DEFAULT_PAGE_SIZE));
    if (query && !searchTerms(query).length) {
      return res.status(200).json({
        ok: true,
        rows: [],
        total: 0,
        limit,
        after: cursor,
        next_cursor: null,
        has_more: false,
        category,
        total_is_exact: true,
        source: 'supabase',
        updated_at: '',
      });
    }
    const rowsReader = typeof deps.fetchDirectoryRows === 'function'
      ? deps.fetchDirectoryRows
      : fetchDirectoryRows;
    const metaReader = typeof deps.fetchDirectoryMeta === 'function'
      ? deps.fetchDirectoryMeta
      : fetchDirectoryMeta;
    const [rowsResult, metaResult] = await Promise.all([
      rowsReader({ query, cursor, limit, category }),
      metaReader(),
    ]);
    if (!rowsResult.ok) {
      return res.status(503).json({
        ok: false,
        error: truncateText(rowsResult.error || 'Online bedrijvendatabase is niet beschikbaar.', 500),
      });
    }
    if (!metaResult.ok || !metaResult.row?.completed) {
      return res.status(503).json({
        ok: false,
        error: 'Online bedrijvendatabase wordt nog opgebouwd.',
      });
    }
    const categoryTotals = metaResult.row.category_totals;
    if (
      category !== DIRECTORY_CATEGORIES.all &&
      (!categoryTotals ||
        typeof categoryTotals !== 'object' ||
        !Object.prototype.hasOwnProperty.call(categoryTotals, category))
    ) {
      return res.status(503).json({
        ok: false,
        error: 'Deze bedrijfscategorie wordt nog opgebouwd.',
      });
    }

    const hasMore = rowsResult.rows.length > limit;
    const rows = rowsResult.rows.slice(0, limit);
    const nextCursor = hasMore ? Number(rows[rows.length - 1]?.source_company_id || 0) : null;
    return res.status(200).json({
      ok: true,
      rows,
      total: query
        ? 0
        : category === DIRECTORY_CATEGORIES.all
          ? Math.max(0, Number(metaResult.row.total) || 0)
          : normalizeCategoryTotals(categoryTotals)[category],
      category,
      limit,
      after: cursor,
      next_cursor: nextCursor,
      has_more: hasMore,
      total_is_exact: !query,
      source: 'supabase',
      updated_at: normalizeString(metaResult.row.updated_at || ''),
    });
  }

  async function sendPostDirectorySyncResponse(req, res) {
    if (!acceptedTokens().length) {
      return res.status(503).json({ ok: false, error: 'KVK sync-token is niet geconfigureerd.' });
    }
    if (!hasValidSyncToken(req)) {
      return res.status(401).json({ ok: false, error: 'Ongeldig KVK sync-token.' });
    }

    const body = req?.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const generation = normalizedField(body.generation, 100);
    const mode = normalizeString(body.mode).toLowerCase() === 'full' ? 'full' : 'incremental';
    const complete = Boolean(body.complete);
    const submittedRows = Array.isArray(body.rows) ? body.rows : [];
    const total = Math.max(0, Number(body.total) || 0);
    if (!generation) return res.status(400).json({ ok: false, error: 'Syncgeneratie ontbreekt.' });
    if (submittedRows.length > MAX_SYNC_BATCH_SIZE) {
      return res.status(413).json({
        ok: false,
        error: `Maximaal ${MAX_SYNC_BATCH_SIZE} bedrijven per syncbatch.`,
      });
    }
    if (!submittedRows.length && !complete && !body.updateMeta) {
      return res.status(400).json({ ok: false, error: 'Syncbatch bevat geen bedrijven.' });
    }

    const rowsByKvk = new Map();
    for (const row of submittedRows) {
      const normalized = normalizeSyncRow(row, generation);
      if (!normalized) {
        return res.status(400).json({ ok: false, error: 'Syncbatch bevat een ongeldige bedrijfsregel.' });
      }
      rowsByKvk.set(normalized.kvk_nummer, normalized);
    }
    const rows = [...rowsByKvk.values()];
    if (rows.length) {
      const rowsWriter = typeof deps.upsertDirectoryRows === 'function'
        ? deps.upsertDirectoryRows
        : upsertDirectoryRows;
      const writeResult = await rowsWriter(rows);
      if (!writeResult.ok) {
        return res.status(502).json({
          ok: false,
          error: truncateText(writeResult.error || 'Online bedrijfsregels opslaan mislukt.', 500),
        });
      }
    }

    if (mode === 'full' && complete) {
      const staleRowsDeleter = typeof deps.deleteStaleRows === 'function'
        ? deps.deleteStaleRows
        : deleteStaleRows;
      const cleanupResult = await staleRowsDeleter(generation);
      if (!cleanupResult.ok) {
        return res.status(502).json({
          ok: false,
          error: truncateText(cleanupResult.error || 'Verouderde bedrijfsregels opruimen mislukt.', 500),
        });
      }
    }

    if (complete || body.updateMeta) {
      const metaWriter = typeof deps.upsertDirectoryMeta === 'function'
        ? deps.upsertDirectoryMeta
        : upsertDirectoryMeta;
      const metaResult = await metaWriter({
        total,
        completed: complete || mode === 'incremental',
        generation,
        sourceUpdatedAt: body.sourceUpdatedAt,
        categoryTotals: body.categoryTotals,
      });
      if (!metaResult.ok) {
        return res.status(502).json({
          ok: false,
          error: truncateText(metaResult.error || 'Online bedrijfsmetadata opslaan mislukt.', 500),
        });
      }
    }

    return res.status(200).json({
      ok: true,
      accepted: rows.length,
      generation,
      completed: complete,
      total,
    });
  }

  return {
    fetchDirectoryMeta,
    fetchDirectoryRows,
    hasValidSyncToken,
    normalizeSyncRow,
    normalizeCategory,
    normalizeCategoryTotals,
    normalizedSearchValue,
    searchTerms,
    sendGetDirectoryResponse,
    sendPostDirectorySyncResponse,
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  DIRECTORY_CATEGORIES,
  DIRECTORY_TABLE,
  MAX_PAGE_SIZE,
  MAX_SYNC_BATCH_SIZE,
  META_TABLE,
  createKvkCompanyDirectoryService,
};
