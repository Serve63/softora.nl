const { randomUUID } = require('crypto');

function createWebsitePreviewLibraryCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    slugifyAutomationText = (value, fallback = 'gebruiker') => String(value || '').trim() || fallback,
    isSupabaseConfigured = () => false,
    fetchSupabaseRowsByStateKeyPrefixViaRest = async () => ({ ok: false, body: null }),
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false, body: null }),
    upsertSupabaseRowViaRest = async () => ({ ok: false, body: null }),
    deleteSupabaseRowByStateKeyViaRest = async () => ({ ok: false, body: null }),
    supabaseStateKey = '',
    websitePreviewLibraryMaxItems = 50,
  } = deps;

  const maxItems = Math.max(1, Math.min(100, Number(websitePreviewLibraryMaxItems) || 50));
  /** ~12 MiB string cap — past bij JSON-parserlimiet voor deze route. */
  const maxDataUrlChars = Math.floor(12 * 1024 * 1024);

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

  function buildStateKey(ownerSlug, entryId) {
    return `${buildUserKeyPrefix(ownerSlug)}${normalizeString(entryId)}`;
  }

  function isValidEntryId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalizeString(value)
    );
  }

  function mapSupabaseRowToClientEntry(row) {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
    const key = normalizeString(row?.state_key || '');
    const entryId = normalizeString(payload.id || '') || key.split(':').pop() || '';
    return {
      id: entryId,
      dataUrl: String(payload.dataUrl || ''),
      url: String(payload.url || ''),
      hostname: String(payload.hostname || ''),
      fileName: String(payload.fileName || ''),
      width: Number(payload.width) || 1024,
      height: Number(payload.height) || 1536,
      createdAt: String(payload.createdAt || row?.updated_at || new Date().toISOString()),
    };
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
      const ownerSlug = buildOwnerSlug(req);
      const prefix = buildUserKeyPrefix(ownerSlug);
      const result = await fetchSupabaseRowsByStateKeyPrefixViaRest(prefix, maxItems + 25);
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
      const entries = rawRows
        .map(mapSupabaseRowToClientEntry)
        .filter((e) => e.id && e.dataUrl && e.dataUrl.startsWith('data:image/'));
      return res.status(200).json({ ok: true, entries });
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
      const prefix = buildUserKeyPrefix(ownerSlug);
      const listResult = await fetchSupabaseRowsByStateKeyPrefixViaRest(prefix, maxItems + 25);
      if (!listResult.ok) {
        logger.error(
          '[WebsitePreviewLibrary][SaveList]',
          listResult.error || listResult.status || listResult.body
        );
        return {
          ok: false,
          status: 500,
          error: 'Bibliotheek opslaan mislukt',
          detail: 'Kon bestaande items niet ophalen.',
        };
      }

      const existingRows = Array.isArray(listResult.body) ? listResult.body : [];
      const victims = existingRows.slice(maxItems - 1);
      for (const row of victims) {
        const key = normalizeString(row?.state_key || '');
        if (!key.startsWith(prefix)) continue;
        const del = await deleteSupabaseRowByStateKeyViaRest(key);
        if (!del.ok) {
          logger.error('[WebsitePreviewLibrary][Prune]', del.error || del.status || del.body);
        }
      }

      const entryId = randomUUID();
      const stateKey = buildStateKey(ownerSlug, entryId);
      const hostname = truncateText(normalizeString(bodyObj.hostname || ''), 200);
      const fileName = truncateText(normalizeString(bodyObj.fileName || ''), 240);
      const width = Math.max(16, Math.min(4096, Number(bodyObj.width) || 1024));
      const height = Math.max(16, Math.min(8192, Number(bodyObj.height) || 1536));
      const now = new Date().toISOString();

      const row = {
        state_key: stateKey,
        payload: {
          type: 'website_preview_library',
          id: entryId,
          dataUrl,
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

      const saveResult = await upsertSupabaseRowViaRest(row);
      if (!saveResult.ok) {
        logger.error(
          '[WebsitePreviewLibrary][Save]',
          saveResult.error || saveResult.status || saveResult.body
        );
        return {
          ok: false,
          status: 500,
          error: 'Bibliotheek opslaan mislukt',
          detail: 'De preview kon niet in Supabase worden opgeslagen.',
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
      const ownerSlug = buildOwnerSlug(req);
      const stateKey = buildStateKey(ownerSlug, entryId);
      const verify = await fetchSupabaseRowByKeyViaRest(stateKey, 'state_key,payload');
      if (!verify.ok || !Array.isArray(verify.body) || verify.body.length === 0) {
        return res.status(404).json({
          ok: false,
          error: 'Niet gevonden',
          detail: 'Dit item bestaat niet (meer) in je bibliotheek.',
        });
      }

      const payload = verify.body[0]?.payload;
      if (!payload || payload.type !== 'website_preview_library' || normalizeString(payload.id) !== entryId) {
        return res.status(404).json({
          ok: false,
          error: 'Niet gevonden',
          detail: 'Dit item bestaat niet (meer) in je bibliotheek.',
        });
      }

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

  return {
    listLibraryResponse,
    saveLibraryResponse,
    deleteLibraryResponse,
    persistPreviewLibraryEntry,
  };
}

module.exports = {
  createWebsitePreviewLibraryCoordinator,
};
