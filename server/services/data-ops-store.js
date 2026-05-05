const {
  buildCustomerIdentityKey,
  extensionForMimeType,
  normalizeString,
  parseImageDataUrl,
  resolveRecordId,
  sanitizeStorageSegment,
} = require('./data-ops-serialization');

const TABLES = Object.freeze({
  customers: 'softora_customers',
  activeOrders: 'softora_active_orders',
  orderRuntime: 'softora_order_runtime',
  designPhotos: 'softora_design_photos',
  webdesignJobs: 'softora_webdesign_jobs',
});

function createSoftoraDataOpsStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    logger = console,
    bucketName = 'softora-design-photos',
    now = () => new Date(),
  } = deps;

  function getClient() {
    if (!isSupabaseConfigured()) return null;
    return getSupabaseClient();
  }

  function isUnavailableError(error) {
    const text = normalizeString(error && (error.message || error.details || error.hint || error.code));
    return (
      /relation .* does not exist/i.test(text) ||
      /could not find .* schema cache/i.test(text) ||
      /bucket not found/i.test(text) ||
      /not found/i.test(text) ||
      error?.code === '42P01' ||
      error?.statusCode === 404 ||
      error?.status === 404
    );
  }

  async function run(label, operation) {
    const client = getClient();
    if (!client) return { ok: false, unavailable: true, error: new Error('Supabase niet geconfigureerd') };
    try {
      const result = await operation(client);
      if (result && result.error) throw result.error;
      return { ok: true, data: result ? result.data : null, count: result ? result.count : null };
    } catch (error) {
      if (!isUnavailableError(error)) {
        logger.error(`[DataOps][${label}]`, error?.message || error);
      }
      return { ok: false, unavailable: isUnavailableError(error), error };
    }
  }

  function isoNow() {
    return now().toISOString();
  }

  function normalizeCustomerPayload(raw = {}, index = 0) {
    const payload = raw && typeof raw === 'object' ? { ...raw } : {};
    payload.id = resolveRecordId(payload, `customer_${index + 1}`);
    const phone = normalizeString(payload.telefoon || payload.tel || payload.phone || payload.contactPhone);
    if (phone && !payload.telefoon) payload.telefoon = phone;
    if (phone && !payload.tel) payload.tel = phone;
    return payload;
  }

  function buildCustomerRow(raw, index, source) {
    const payload = normalizeCustomerPayload(raw, index);
    const status = normalizeString(payload.databaseStatus || payload.status).toLowerCase();
    return {
      customer_id: payload.id,
      identity_key: buildCustomerIdentityKey(payload),
      company: normalizeString(payload.bedrijf || payload.company || payload.companyName).slice(0, 240),
      contact_name: normalizeString(payload.naam || payload.contact || payload.contactName).slice(0, 240),
      phone: normalizeString(payload.telefoon || payload.tel || payload.phone || payload.contactPhone).slice(0, 120),
      email: normalizeString(payload.email || payload.contactEmail).slice(0, 240),
      website: normalizeString(payload.website || payload.dom || payload.domain || payload.url).slice(0, 400),
      database_status: normalizeString(payload.databaseStatus || '').toLowerCase().slice(0, 80),
      lifecycle_status: status.slice(0, 80),
      responsible: normalizeString(payload.verantwoordelijk || payload.responsible || payload.claimedBy).slice(0, 120),
      payload,
      source: normalizeString(source || 'ui-state-compat').slice(0, 120),
      version: Date.now(),
      updated_at: isoNow(),
      deleted_at: null,
    };
  }

  async function markMissingDeleted(table, idColumn, incomingIds, source) {
    const current = await run(`list-${table}-ids`, (client) =>
      client.from(table).select(idColumn).is('deleted_at', null).limit(5000)
    );
    if (!current.ok) return current;
    const incoming = new Set(incomingIds.map(normalizeString).filter(Boolean));
    const missing = (current.data || [])
      .map((row) => normalizeString(row && row[idColumn]))
      .filter((id) => id && !incoming.has(id));
    if (!missing.length) return { ok: true, data: [] };
    return run(`delete-missing-${table}`, (client) =>
      client
        .from(table)
        .update({
          deleted_at: isoNow(),
          updated_at: isoNow(),
          source: normalizeString(source || 'ui-state-compat').slice(0, 120),
        })
        .in(idColumn, missing)
    );
  }

  async function listCustomers() {
    const result = await run('list-customers', (client) =>
      client
        .from(TABLES.customers)
        .select('customer_id,payload,updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(5000)
    );
    if (!result.ok) return null;
    return (result.data || []).map((row) => ({
      ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
      id: normalizeString(row.payload?.id || row.customer_id),
    }));
  }

  async function replaceCustomers(customers, meta = {}) {
    const rows = (Array.isArray(customers) ? customers : []).map((item, index) =>
      buildCustomerRow(item, index, meta.source)
    );
    if (rows.length) {
      const upsert = await run('upsert-customers', (client) =>
        client.from(TABLES.customers).upsert(rows, { onConflict: 'customer_id' })
      );
      if (!upsert.ok) return upsert;
    }
    return markMissingDeleted(
      TABLES.customers,
      'customer_id',
      rows.map((row) => row.customer_id),
      meta.source
    );
  }

  function buildOrderRow(raw, index, source) {
    const payload = raw && typeof raw === 'object' ? { ...raw } : {};
    const id = normalizeString(payload.id || payload.orderId) || `order_${index + 1}`;
    payload.id = payload.id || id;
    return {
      order_id: id,
      customer_id: normalizeString(payload.customerId || payload.customer_id).slice(0, 160),
      customer_name: normalizeString(payload.clientName || payload.naam || payload.contactName).slice(0, 240),
      company_name: normalizeString(payload.companyName || payload.bedrijf || payload.location).slice(0, 240),
      title: normalizeString(payload.title || payload.type).slice(0, 240),
      status: normalizeString(payload.status || payload.statusKey).slice(0, 120),
      payload,
      source: normalizeString(source || 'ui-state-compat').slice(0, 120),
      version: Date.now(),
      updated_at: isoNow(),
      deleted_at: null,
    };
  }

  async function listActiveOrders() {
    const result = await run('list-active-orders', (client) =>
      client
        .from(TABLES.activeOrders)
        .select('order_id,payload,updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(5000)
    );
    if (!result.ok) return null;
    return (result.data || []).map((row) => ({ ...(row.payload || {}), id: row.payload?.id || row.order_id }));
  }

  async function replaceActiveOrders(orders, meta = {}) {
    const rows = (Array.isArray(orders) ? orders : []).map((item, index) =>
      buildOrderRow(item, index, meta.source)
    );
    if (rows.length) {
      const upsert = await run('upsert-active-orders', (client) =>
        client.from(TABLES.activeOrders).upsert(rows, { onConflict: 'order_id' })
      );
      if (!upsert.ok) return upsert;
    }
    return markMissingDeleted(
      TABLES.activeOrders,
      'order_id',
      rows.map((row) => row.order_id),
      meta.source
    );
  }

  async function listOrderRuntime() {
    const result = await run('list-order-runtime', (client) =>
      client
        .from(TABLES.orderRuntime)
        .select('order_id,payload,updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(5000)
    );
    if (!result.ok) return null;
    return (result.data || []).reduce((acc, row) => {
      const id = normalizeString(row.order_id);
      if (id) acc[id] = row.payload && typeof row.payload === 'object' ? row.payload : {};
      return acc;
    }, {});
  }

  async function replaceOrderRuntime(runtimeMap, meta = {}) {
    const source = normalizeString(meta.source || 'ui-state-compat').slice(0, 120);
    const rows = Object.entries(runtimeMap && typeof runtimeMap === 'object' ? runtimeMap : {})
      .map(([id, payload]) => {
        const orderId = normalizeString(id);
        if (!orderId) return null;
        const rowPayload = payload && typeof payload === 'object' ? payload : {};
        return {
          order_id: orderId,
          status_key: normalizeString(rowPayload.statusKey || rowPayload.status).slice(0, 120),
          progress_pct: Number.isFinite(Number(rowPayload.progressPct)) ? Number(rowPayload.progressPct) : null,
          payload: rowPayload,
          source,
          version: Date.now(),
          updated_at: isoNow(),
          deleted_at: null,
        };
      })
      .filter(Boolean);
    if (rows.length) {
      const upsert = await run('upsert-order-runtime', (client) =>
        client.from(TABLES.orderRuntime).upsert(rows, { onConflict: 'order_id' })
      );
      if (!upsert.ok) return upsert;
    }
    return markMissingDeleted(
      TABLES.orderRuntime,
      'order_id',
      rows.map((row) => row.order_id),
      source
    );
  }

  async function ensurePhotoBucket(client) {
    const existing = await client.storage.getBucket(bucketName);
    if (!existing.error) return true;
    const created = await client.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
    if (created.error && !/already exists/i.test(created.error.message || '')) throw created.error;
    return true;
  }

  async function uploadDesignPhoto(entry, meta = {}) {
    const parsed = parseImageDataUrl(entry && entry.dataUrl);
    if (!parsed) return { ok: false, unavailable: false, error: new Error('Ongeldige foto-data') };
    return run('upload-design-photo', async (client) => {
      await ensurePhotoBucket(client);
      const customerId = resolveRecordId({ id: entry.customerId }, 'customer');
      const ext = extensionForMimeType(parsed.mimeType);
      const path = [
        'customers',
        sanitizeStorageSegment(customerId, 'customer'),
        `${parsed.contentHash}.${ext}`,
      ].join('/');
      const uploaded = await client.storage.from(bucketName).upload(path, parsed.buffer, {
        contentType: parsed.mimeType,
        upsert: true,
      });
      if (uploaded.error) throw uploaded.error;
      const row = {
        customer_id: customerId,
        identity_key: normalizeString(entry.identityKey || ''),
        storage_bucket: bucketName,
        storage_path: path,
        mime_type: parsed.mimeType,
        file_name: normalizeString(entry.fileName || entry.websitePhotoName || `${customerId}.${ext}`).slice(0, 240),
        byte_size: parsed.buffer.length,
        content_hash: parsed.contentHash,
        legacy_meta: entry.legacyMeta && typeof entry.legacyMeta === 'object' ? entry.legacyMeta : {},
        source: normalizeString(meta.source || 'ui-state-compat').slice(0, 120),
        version: Date.now(),
        updated_at: isoNow(),
        deleted_at: null,
      };
      return client.from(TABLES.designPhotos).upsert(row, { onConflict: 'customer_id' });
    });
  }

  async function replaceDesignPhotos(entries, meta = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const source = normalizeString(meta.source || 'ui-state-compat').slice(0, 120);
    const fullReplaceAllowed = Boolean(meta.fullReplace || /^migration:/i.test(source));
    if (!fullReplaceAllowed) {
      return upsertDesignPhotos(list, meta);
    }
    if (!list.length && !meta.allowEmptyReplace) {
      return { ok: true, data: [], skippedEmptyReplace: true };
    }
    for (const entry of list) {
      const saved = await uploadDesignPhoto(entry, meta);
      if (!saved.ok) return saved;
    }
    return markMissingDeleted(
      TABLES.designPhotos,
      'customer_id',
      list.map((entry) => entry.customerId),
      source
    );
  }

  async function upsertDesignPhotos(entries, meta = {}) {
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      const saved = await uploadDesignPhoto(entry, meta);
      if (!saved.ok) return saved;
    }
    return { ok: true, data: [], upserted: list.length };
  }

  async function deleteDesignPhotos(customerIds, meta = {}) {
    const ids = Array.from(new Set((Array.isArray(customerIds) ? customerIds : []).map(normalizeString).filter(Boolean)));
    if (!ids.length) return { ok: true, data: [], deleted: 0 };
    return run('delete-design-photos-explicit', (client) =>
      client
        .from(TABLES.designPhotos)
        .update({
          deleted_at: isoNow(),
          updated_at: isoNow(),
          source: normalizeString(meta.source || 'ui-state-compat').slice(0, 120),
        })
        .in('customer_id', ids)
    );
  }

  async function listDesignPhotosWithDataUrls() {
    const result = await run('list-design-photos', (client) =>
      client
        .from(TABLES.designPhotos)
        .select('customer_id,identity_key,storage_bucket,storage_path,mime_type,file_name,legacy_meta,updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(500)
    );
    if (!result.ok) return null;
    const client = getClient();
    const rows = result.data || [];
    const entries = [];
    let cursor = 0;
    const workerCount = Math.min(8, Math.max(1, rows.length));

    async function downloadNext() {
      while (cursor < rows.length) {
        const row = rows[cursor];
        cursor += 1;
        const bucket = normalizeString(row.storage_bucket || bucketName);
        const path = normalizeString(row.storage_path);
        if (!bucket || !path) continue;
        const downloaded = await client.storage.from(bucket).download(path);
        if (downloaded.error || !downloaded.data) continue;
        const buffer = Buffer.from(await downloaded.data.arrayBuffer());
        entries.push({
          customerId: normalizeString(row.customer_id),
          dataUrl: `data:${normalizeString(row.mime_type || 'image/jpeg')};base64,${buffer.toString('base64')}`,
          fileName: normalizeString(row.file_name),
          identityKey: normalizeString(row.identity_key),
          legacyMeta: row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta : {},
          updatedAt: normalizeString(row.updated_at),
        });
      }
    }

    await Promise.all(Array.from({ length: workerCount }, downloadNext));
    Object.defineProperty(entries, 'hadStructuredRows', {
      value: rows.length > 0,
      enumerable: false,
    });
    return entries;
  }

  async function listDesignPhotosWithSignedUrls(options = {}) {
    const expiresInSeconds = Math.max(
      60,
      Math.min(24 * 60 * 60, Number(options.expiresInSeconds) || 60 * 60)
    );
    const result = await run('list-design-photos-signed-urls', (client) =>
      client
        .from(TABLES.designPhotos)
        .select('customer_id,identity_key,storage_bucket,storage_path,mime_type,file_name,legacy_meta,updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(500)
    );
    if (!result.ok) return null;
    const client = getClient();
    const rows = result.data || [];
    const entries = [];

    await Promise.all(
      rows.map(async (row) => {
        const bucket = normalizeString(row.storage_bucket || bucketName);
        const path = normalizeString(row.storage_path);
        if (!bucket || !path) return;
        const signed = await client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
        if (signed.error || !signed.data?.signedUrl) return;
        entries.push({
          customerId: normalizeString(row.customer_id),
          websitePhotoUrl: normalizeString(signed.data.signedUrl),
          storageBucket: bucket,
          storagePath: path,
          mimeType: normalizeString(row.mime_type || 'image/jpeg'),
          fileName: normalizeString(row.file_name),
          identityKey: normalizeString(row.identity_key),
          legacyMeta: row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta : {},
          updatedAt: normalizeString(row.updated_at),
          signedUrlExpiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        });
      })
    );

    Object.defineProperty(entries, 'hadStructuredRows', {
      value: rows.length > 0,
      enumerable: false,
    });
    return entries;
  }

  async function countActiveRows(table, deletedColumn = 'deleted_at') {
    const result = await run(`count-${table}`, (client) => {
      let query = client.from(table).select('*', { count: 'exact', head: true });
      if (deletedColumn) query = query.is(deletedColumn, null);
      return query;
    });
    return result.ok ? Number(result.data?.count || result.count || 0) : null;
  }

  async function getDataOpsCounts() {
    const [customers, activeOrders, orderRuntime, designPhotos, webdesignJobs] = await Promise.all([
      countActiveRows(TABLES.customers),
      countActiveRows(TABLES.activeOrders),
      countActiveRows(TABLES.orderRuntime),
      countActiveRows(TABLES.designPhotos),
      countActiveRows(TABLES.webdesignJobs, ''),
    ]);
    return {
      customers,
      activeOrders,
      orderRuntime,
      designPhotos,
      webdesignJobs,
    };
  }

  function toIsoFromMaybeMs(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
    const normalized = normalizeString(value);
    return normalized || null;
  }

  function toMsFromIso(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function buildWebdesignJobRow(job = {}) {
    return {
      job_id: normalizeString(job.id),
      owner_key: normalizeString(job.ownerKey),
      customer_id: normalizeString(job.customer && job.customer.id).slice(0, 160),
      website_url: normalizeString(job.websiteUrl).slice(0, 500),
      status: normalizeString(job.status || 'queued').toLowerCase(),
      error: normalizeString(job.error || '').slice(0, 1000) || null,
      payload: {
        customer: job.customer && typeof job.customer === 'object' ? job.customer : {},
      },
      created_at: toIsoFromMaybeMs(job.createdAt) || isoNow(),
      started_at: toIsoFromMaybeMs(job.startedAt),
      finished_at: toIsoFromMaybeMs(job.finishedAt),
      updated_at: isoNow(),
    };
  }

  function normalizeWebdesignJobRow(row = {}) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
      id: normalizeString(row.job_id),
      ownerKey: normalizeString(row.owner_key),
      customer: payload.customer && typeof payload.customer === 'object' ? payload.customer : {},
      websiteUrl: normalizeString(row.website_url),
      status: normalizeString(row.status || 'queued').toLowerCase(),
      error: normalizeString(row.error || ''),
      createdAt: toMsFromIso(row.created_at) || Date.now(),
      startedAt: toMsFromIso(row.started_at),
      finishedAt: toMsFromIso(row.finished_at),
    };
  }

  async function upsertWebdesignJob(job) {
    const row = buildWebdesignJobRow(job);
    if (!row.job_id || !row.owner_key) {
      return { ok: false, unavailable: false, error: new Error('Ongeldige webdesign-job') };
    }
    return run('upsert-webdesign-job', (client) =>
      client.from(TABLES.webdesignJobs).upsert(row, { onConflict: 'job_id' })
    );
  }

  async function getWebdesignJob(jobId) {
    const result = await run('get-webdesign-job', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('job_id', normalizeString(jobId))
        .maybeSingle()
    );
    if (!result.ok || !result.data) return null;
    return normalizeWebdesignJobRow(result.data);
  }

  async function findRunningWebdesignJob(ownerKey, customerId) {
    const result = await run('find-running-webdesign-job', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('owner_key', normalizeString(ownerKey))
        .eq('customer_id', normalizeString(customerId))
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    if (!result.ok || !result.data) return null;
    return normalizeWebdesignJobRow(result.data);
  }

  async function listVisibleWebdesignJobs(ownerKey) {
    const result = await run('list-webdesign-jobs', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('owner_key', normalizeString(ownerKey))
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: true })
        .limit(100)
    );
    if (!result.ok) return null;
    return (result.data || []).map(normalizeWebdesignJobRow);
  }

  return {
    findRunningWebdesignJob,
    getDataOpsCounts,
    getWebdesignJob,
    deleteDesignPhotos,
    listActiveOrders,
    listCustomers,
    listDesignPhotosWithDataUrls,
    listDesignPhotosWithSignedUrls,
    listVisibleWebdesignJobs,
    listOrderRuntime,
    replaceActiveOrders,
    replaceCustomers,
    replaceDesignPhotos,
    replaceOrderRuntime,
    uploadDesignPhoto,
    upsertDesignPhotos,
    upsertWebdesignJob,
  };
}

module.exports = {
  TABLES,
  createSoftoraDataOpsStore,
};
