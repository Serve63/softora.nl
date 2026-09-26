const { randomUUID } = require('crypto');

let cachedSharp = null;

async function createPreviewThumbnailDataUrl(dataUrl) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) return '';
  if (!cachedSharp) cachedSharp = require('sharp');
  const buffer = await cachedSharp(Buffer.from(match[1], 'base64'), { limitInputPixels: 45_000_000 })
    .resize({ width: 420, withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

function createWebsitePreviewLibraryCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    slugifyAutomationText = (value, fallback = 'gebruiker') => String(value || '').trim() || fallback,
    isSupabaseConfigured = () => false,
    fetchSupabaseRowsByStateKeyPrefixViaRest = async () => ({ ok: false, body: null }),
    upsertSupabaseRowViaRest = async () => ({ ok: false, body: null }),
    deleteSupabaseRowByStateKeyViaRest = async () => ({ ok: false, body: null }),
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false, body: null }),
    createThumbnailDataUrl = createPreviewThumbnailDataUrl,
    supabaseStateKey = '',
    storageRetrySleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = deps;

  const supabasePageSize = 500;
  const libraryStorageOptions = Object.freeze({
    timeoutMs: 20000, ignoreFailureCooldown: true, suppressFailureCooldown: true,
  });
  /** ~12 MiB string cap — past bij JSON-parserlimiet voor deze route. */
  const maxDataUrlChars = Math.floor(12 * 1024 * 1024);
  /** Houd de lijstrespons klein genoeg voor serverless/browser-limieten. */
  const maxListDataUrlChars = Math.floor(3.2 * 1024 * 1024);
  const maxThumbDataUrlChars = 400 * 1024;
  // The list never downloads full screenshots; only metadata and the small thumbnail.
  const listSelectColumns = [
    'state_key', 'updated_at', 'id:payload->>id', 'url:payload->>url', 'hostname:payload->>hostname',
    'fileName:payload->>fileName', 'width:payload->>width', 'height:payload->>height',
    'createdAt:payload->>createdAt', 'thumbDataUrl:payload->>thumbDataUrl',
  ].join(',');
  const idSelectColumns = 'state_key,type:payload->>type,id:payload->>id';

  function buildOwnerSlug(req) {
    const email = normalizeString(req?.premiumAuth?.email || '').toLowerCase();
    const uid = normalizeString(req?.premiumAuth?.userId || '');
    const basis = email || uid || 'unknown';
    let slug = slugifyAutomationText(basis.replace(/@/g, '-at-'), 'gebruiker');
    slug = String(slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
    return truncateText(slug || 'gebruiker', 80) || 'gebruiker';
  }

  function buildUserKeyPrefix(ownerSlug) {
    const sk = normalizeString(supabaseStateKey);
    return `${sk}:website_preview_lib:${ownerSlug}:`;
  }

  function buildGlobalKeyPrefix() {
    const sk = normalizeString(supabaseStateKey);
    return `${sk}:website_preview_lib:`;
  }

  function buildStateKey(ownerSlug, entryId) {
    return `${buildUserKeyPrefix(ownerSlug)}${normalizeString(entryId)}`;
  }

  function isValidEntryId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalizeString(value)
    );
  }

  function readThumbDataUrl(value) {
    const thumb = String(value || '');
    return thumb.startsWith('data:image/') && thumb.length <= maxThumbDataUrlChars ? thumb : '';
  }

  function mapSupabaseRowToClientEntry(row) {
    // Rows come either with a full payload or with flattened light list columns.
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : (row || {});
    const key = normalizeString(row?.state_key || '');
    const entryId = normalizeString(payload.id || '') || key.split(':').pop() || '';
    return {
      id: entryId,
      dataUrl: String(payload.dataUrl || ''),
      thumbDataUrl: readThumbDataUrl(payload.thumbDataUrl),
      url: String(payload.url || ''),
      hostname: String(payload.hostname || ''),
      fileName: String(payload.fileName || ''),
      width: Number(payload.width) || 1024,
      height: Number(payload.height) || 1536,
      createdAt: String(payload.createdAt || row?.updated_at || new Date().toISOString()),
    };
  }

  async function fetchAllRowsByPrefix(prefix, selectColumns = 'state_key,payload,updated_at') {
    const rows = [];
    let offset = 0;

    while (true) {
      const result = await fetchSupabaseRowsByStateKeyPrefixViaRest(
        prefix,
        supabasePageSize,
        selectColumns,
        offset,
        libraryStorageOptions
      );
      if (!result.ok) return result;

      const pageRows = Array.isArray(result.body) ? result.body : [];
      rows.push(...pageRows);
      if (pageRows.length < supabasePageSize) {
        return { ok: true, body: rows };
      }

      offset += supabasePageSize;
    }
  }

  async function fetchStoredPreviewRowById(entryId, selectColumns = 'state_key,payload,updated_at') {
    // Find the key with a tiny id-only query, then download just that one row.
    const result = await fetchAllRowsByPrefix(buildGlobalKeyPrefix(), idSelectColumns);
    if (!result.ok) return { ok: false, result, row: null };

    const match = (Array.isArray(result.body) ? result.body : []).find((candidate) => {
      const payload = candidate?.payload && typeof candidate.payload === 'object' ? candidate.payload : candidate || {};
      return payload.type === 'website_preview_library' && normalizeString(payload.id) === entryId;
    });
    if (!match) return { ok: true, result, row: null };

    const rowResult = await fetchSupabaseRowByKeyViaRest(
      normalizeString(match.state_key), selectColumns, libraryStorageOptions
    );
    if (!rowResult.ok) return { ok: false, result: rowResult, row: null };
    const row = Array.isArray(rowResult.body) ? rowResult.body[0] : null;
    return { ok: true, result: rowResult, row: row || null };
  }

  async function safeCreateThumbnail(dataUrl) {
    try {
      return readThumbDataUrl(await createThumbnailDataUrl(dataUrl));
    } catch (error) {
      logger.error('[WebsitePreviewLibrary][Thumbnail]', error?.message || error);
      return '';
    }
  }

  /** Oudere items krijgen hun thumbnail bij de eerste volledige opvraag. */
  async function backfillThumbnail(row, entry) {
    if (entry.thumbDataUrl || !row?.state_key || !row?.payload) return entry;
    const thumbDataUrl = await safeCreateThumbnail(entry.dataUrl);
    if (!thumbDataUrl) return entry;
    try {
      await upsertSupabaseRowViaRest({
        state_key: row.state_key,
        payload: { ...row.payload, thumbDataUrl },
        updated_at: row.updated_at || entry.createdAt,
      }, libraryStorageOptions);
    } catch (error) {
      logger.error('[WebsitePreviewLibrary][ThumbnailBackfill]', error?.message || error);
    }
    return { ...entry, thumbDataUrl };
  }

  async function listLibraryResponse(req, res) {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'Bibliotheek is niet beschikbaar',
        detail: 'Supabase is niet geconfigureerd voor deze omgeving.',
      });
    }

    try {
      const result = await fetchAllRowsByPrefix(buildGlobalKeyPrefix(), listSelectColumns);
      if (!result.ok) {
        logger.error(
          '[WebsitePreviewLibrary][List]',
          result.error || result.status || result.body
        );
        return res.status(500).json({
          ok: false,
          error: 'Bibliotheek laden mislukt',
          detail: 'Kon geen items ophalen uit Supabase.',
        });
      }

      const rawRows = Array.isArray(result.body) ? result.body : [];
      const entries = [];
      let thumbChars = 0;
      let omittedLargeItems = 0;

      for (const row of rawRows) {
        const { dataUrl: _fullImage, ...entry } = mapSupabaseRowToClientEntry(row);
        if (!entry.id) continue;

        const nextSize = entry.thumbDataUrl.length;
        const thumbDataUrl = nextSize && thumbChars + nextSize <= maxListDataUrlChars ? entry.thumbDataUrl : '';
        thumbChars += thumbDataUrl.length;
        entries.push({ ...entry, dataUrl: '', thumbDataUrl, imageDeferred: true });
      }

      return res.status(200).json({
        ok: true,
        entries,
        omittedLargeItems,
      });
    } catch (error) {
      logger.error('[WebsitePreviewLibrary][ListCrash]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Bibliotheek laden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  /**
   * Slaat een preview op voor de gegeven premium-auth (ook server-side jobs zonder volledige Request).
   * @returns {Promise<{ ok: true, entry: object }|{ ok: false, status: number, error: string, detail: string }>}
   */
  async function persistPreviewLibraryEntry(premiumAuth, body) {
    const bodyObj = body && typeof body === 'object' ? body : {};
    const dataUrl = String(bodyObj.dataUrl || '').trim();
    const url = String(bodyObj.url || '').trim();

    if (!dataUrl || !url) {
      return {
        ok: false,
        status: 400,
        error: 'Preview onvolledig',
        detail: 'dataUrl en url zijn verplicht.',
      };
    }

    if (!dataUrl.startsWith('data:image/')) {
      return {
        ok: false,
        status: 400,
        error: 'Ongeldige afbeelding',
        detail: 'Alleen data:image/… (PNG/JPEG) is toegestaan.',
      };
    }

    if (dataUrl.length > maxDataUrlChars) {
      return {
        ok: false,
        status: 400,
        error: 'Afbeelding te groot',
        detail: 'Verklein de preview of scan opnieuw met een lichtere pagina.',
      };
    }

    if (!isSupabaseConfigured()) {
      return {
        ok: false,
        status: 503,
        error: 'Bibliotheek is niet beschikbaar',
        detail: 'Supabase is niet geconfigureerd voor deze omgeving.',
      };
    }

    const reqLike = { premiumAuth };
    try {
      const ownerSlug = buildOwnerSlug(reqLike);
      const entryId = randomUUID();
      const stateKey = buildStateKey(ownerSlug, entryId);
      const hostname = truncateText(normalizeString(bodyObj.hostname || ''), 200);
      const fileName = truncateText(normalizeString(bodyObj.fileName || ''), 240);
      const width = Math.max(16, Math.min(4096, Number(bodyObj.width) || 1024));
      const height = Math.max(16, Math.min(8192, Number(bodyObj.height) || 1536));
      const now = new Date().toISOString();
      const thumbDataUrl = await safeCreateThumbnail(dataUrl);

      const row = {
        state_key: stateKey,
        payload: {
          type: 'website_preview_library',
          id: entryId,
          dataUrl,
          thumbDataUrl,
          url,
          hostname,
          fileName,
          width,
          height,
          createdAt: now,
        },
        meta: {
          type: 'website_preview_library',
          source: 'premium-websitegenerator',
          actor: normalizeString(
            premiumAuth?.displayName || premiumAuth?.email || 'dashboard'
          ),
        },
        updated_at: now,
      };

      // Keep the same row/id after an uncertain write so a retry cannot duplicate the photo.
      let saveResult;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          saveResult = await upsertSupabaseRowViaRest(row, libraryStorageOptions);
        } catch (_) {
          saveResult = { ok: false, status: null, error: 'Opslagverbinding onderbroken.' };
        }
        if (saveResult.ok) break;
        const retryable = !saveResult.status || saveResult.status === 429 || saveResult.status >= 500;
        if (!retryable || attempt === 2) break;
        await storageRetrySleep(500 * Math.pow(2, attempt));
      }
      if (!saveResult.ok) {
        logger.error(
          '[WebsitePreviewLibrary][Save]',
          saveResult.error || saveResult.status || saveResult.body
        );
        return {
          ok: false,
          status: 500,
          error: 'Bibliotheek opslaan mislukt',
          detail: 'De foto is gemaakt, maar opslaan is na meerdere pogingen niet bevestigd. Genereer niet opnieuw; laat de opslag controleren.',
        };
      }

      const entry = mapSupabaseRowToClientEntry({
        state_key: stateKey,
        payload: row.payload,
        updated_at: now,
      });
      return { ok: true, entry };
    } catch (error) {
      logger.error('[WebsitePreviewLibrary][SaveCrash]', error?.message || error);
      return {
        ok: false,
        status: 500,
        error: 'Bibliotheek opslaan mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      };
    }
  }

  async function saveLibraryResponse(req, res) {
    const result = await persistPreviewLibraryEntry(req.premiumAuth, req.body);
    if (!result.ok) {
      return res.status(result.status).json({
        ok: false,
        error: result.error,
        detail: result.detail,
      });
    }
    return res.status(200).json({ ok: true, entry: result.entry });
  }

  async function deleteLibraryResponse(req, res) {
    const rawId = normalizeString(req.params?.id || '');
    const entryId = decodeURIComponent(rawId);

    if (!isValidEntryId(entryId)) {
      return res.status(400).json({
        ok: false,
        error: 'Ongeldig item',
        detail: 'Geen geldige bibliotheek-id.',
      });
    }

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'Bibliotheek is niet beschikbaar',
        detail: 'Supabase is niet geconfigureerd voor deze omgeving.',
      });
    }

    try {
      const verify = await fetchStoredPreviewRowById(entryId, idSelectColumns);
      if (!verify.ok) {
        logger.error(
          '[WebsitePreviewLibrary][DeleteVerify]',
          verify.result?.error || verify.result?.status || verify.result?.body
        );
        return res.status(500).json({
          ok: false,
          error: 'Verwijderen mislukt',
          detail: 'Kon het item niet uit Supabase controleren.',
        });
      }
      if (!verify.row) {
        return res.status(404).json({
          ok: false,
          error: 'Niet gevonden',
          detail: 'Dit item bestaat niet (meer) in je bibliotheek.',
        });
      }

      const payload = verify.row;
      if (!payload || payload.type !== 'website_preview_library' || normalizeString(payload.id) !== entryId) {
        return res.status(404).json({
          ok: false,
          error: 'Niet gevonden',
          detail: 'Dit item bestaat niet (meer) in je bibliotheek.',
        });
      }

      const stateKey = normalizeString(verify.row?.state_key || '');
      const del = await deleteSupabaseRowByStateKeyViaRest(stateKey);
      if (!del.ok) {
        logger.error('[WebsitePreviewLibrary][Delete]', del.error || del.status || del.body);
        return res.status(500).json({
          ok: false,
          error: 'Verwijderen mislukt',
          detail: 'Kon het item niet uit Supabase verwijderen.',
        });
      }

      return res.status(200).json({ ok: true, id: entryId });
    } catch (error) {
      logger.error('[WebsitePreviewLibrary][DeleteCrash]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Verwijderen mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  async function getLibraryEntryResponse(req, res) {
    const rawId = normalizeString(req.params?.id || '');
    const entryId = decodeURIComponent(rawId);

    if (!isValidEntryId(entryId)) {
      return res.status(400).json({
        ok: false,
        error: 'Ongeldig item',
        detail: 'Geen geldige bibliotheek-id.',
      });
    }

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'Bibliotheek is niet beschikbaar',
        detail: 'Supabase is niet geconfigureerd voor deze omgeving.',
      });
    }

    try {
      const result = await fetchStoredPreviewRowById(entryId, 'state_key,payload,updated_at');
      const row = result.row;
      if (!result.ok || !row) {
        return res.status(404).json({
          ok: false,
          error: 'Niet gevonden',
          detail: 'Dit item bestaat niet (meer) in je bibliotheek.',
        });
      }

      let entry = mapSupabaseRowToClientEntry(row);
      if (!entry.id || !entry.dataUrl || !entry.dataUrl.startsWith('data:image/')) {
        return res.status(404).json({
          ok: false,
          error: 'Niet gevonden',
          detail: 'Dit item bevat geen geldige previewafbeelding.',
        });
      }

      entry = await backfillThumbnail(row, entry);
      return res.status(200).json({ ok: true, entry });
    } catch (error) {
      logger.error('[WebsitePreviewLibrary][GetCrash]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Bibliotheekitem laden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  return {
    listLibraryResponse,
    getLibraryEntryResponse,
    saveLibraryResponse,
    deleteLibraryResponse,
    persistPreviewLibraryEntry,
  };
}

module.exports = {
  createWebsitePreviewLibraryCoordinator,
};
