'use strict';

const { buildGuardKeysForRow } = require('./premium-database-mail-ready-snapshot');
const { buildWebsiteImageGenerationMetadata } = require('./website-image-generation-cost');
const OWNER_KEY = 'nightly-mail-stock::system';
const TIME_ZONE = 'Europe/Amsterdam';
const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function localNight(time) {
  const parts = Object.fromEntries(clock.formatToParts(new Date(time)).map(({ type, value }) => [type, value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function providerOf(row) { return row.webdesignMailProvider === 'instantly' ? 'instantly' : 'softora'; }
function fixedProvider(row) {
  return row.hasPhoto || row.hasMockup || providerOf(row) === 'instantly' ? providerOf(row) : null;
}
function chooseProvider(row, deficit) {
  const fixed = fixedProvider(row);
  return fixed || (deficit.softora >= deficit.instantly ? 'softora' : 'instantly');
}
function addUnique(row, used) {
  const keys = buildGuardKeysForRow(row);
  if (!row.id || !keys.some((key) => key.startsWith('email:')) || keys.some((key) => used.has(key))) return false;
  keys.forEach((key) => used.add(key));
  return true;
}
function inventory(snapshot, activeRows = []) {
  if (!snapshot?.ok || !Array.isArray(snapshot.customers) || !Array.isArray(snapshot.instantlyReadyCustomers) || !Array.isArray(snapshot.availableCustomers)) {
    throw new Error('Mailklare voorraad niet volledig beschikbaar.');
  }
  const used = new Set(), ready = { softora: 0, instantly: 0 }, pending = { softora: 0, instantly: 0 }, readyIds = { softora: [], instantly: [] };
  const byId = new Map([...snapshot.customers, ...snapshot.instantlyReadyCustomers, ...snapshot.availableCustomers].map((row) => [row.id, row]));
  for (const [provider, rows] of [['softora', snapshot.customers], ['instantly', snapshot.instantlyReadyCustomers]]) {
    for (const row of rows) if (addUnique(row, used)) { ready[provider] += 1; readyIds[provider].push(row.id); }
  }
  for (const row of activeRows) {
    const payload = row.payload || {};
    const targets = payload.kind === 'bulk_webdesign_chunk' ? payload.targets || [] : payload.customer ? [{ customer: payload.customer, status: 'running' }] : [];
    for (const target of targets) {
      if (!['pending', 'queued', 'running'].includes(target.status) || !target.customer) continue;
      const customer = { ...byId.get(target.customer.id), ...target.customer };
      if (addUnique(customer, used)) pending[providerOf(customer)] += 1;
    }
  }
  return { ready, pending, used, readyIds };
}
function budgetChargeCents(generation) {
  // Direct Image API requests have no cached-input discount. EUR accounting
  // deliberately reserves 2 EUR per USD, including a generous FX/tax margin.
  if (!/^gpt-image-2\.5-(sunburst|flare)(-\d{4}-\d{2}-\d{2})?$/.test(generation?.model || '') || !generation?.usage) return null;
  const usage = generation.usage, details = usage.input_tokens_details || {};
  const usd = (details.text_tokens * 5 + details.image_tokens * 8 + usage.output_tokens * 30) / 1e6;
  return Number.isFinite(usd) && usd >= 0 ? Math.ceil(usd * 200) : null;
}
function halted(message) { return Object.assign(new Error(message), { noAutomaticWebdesignRetry: true }); }
async function assertApprovedImageRequest({ imageModel, imageSize, imageQuality, prompt, referenceImages }) {
  // One bounded V2 image, no larger/auto quality or unpriced model changes.
  if (!/^gpt-image-2\.5-(sunburst|flare)(-2026-09-08)?$/.test(imageModel) || imageSize !== '1024x1536' ||
    !['low', 'medium'].includes(imageQuality) || typeof prompt !== 'string' || Buffer.byteLength(prompt) > 32768 ||
    !Array.isArray(referenceImages) || referenceImages.length !== 1 ||
    referenceImages.some((image) => typeof image.dataUrl !== 'string' || image.dataUrl.length > 2800000)) {
    throw halted('Automatische generatie valt buiten het gecontroleerde aanvraagbudget.');
  }
  const encoded = referenceImages[0].dataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!encoded) throw halted('De automatische beeldreferentie is niet controleerbaar.');
  const meta = await require('sharp')(Buffer.from(encoded[1], 'base64'), { limitInputPixels: 1920000 }).metadata();
  if (!meta.width || !meta.height || meta.width > 1200 || meta.height > 1600 || (meta.pages || 1) !== 1) {
    throw halted('De automatische beeldreferentie overschrijdt de gecontroleerde afmetingen.');
  }
}

function createNightlyMailStockService({ store, dataOpsStore, snapshotService, now = () => Date.now(), logger = console,
  imageModel = process.env.WEBSITE_PREVIEW_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst' } = {}) {
  let snapshotPromise, accountingUncertain = false;
  async function readInventory(fresh = false) {
    if (fresh) { snapshotService.invalidate(); snapshotPromise = null; }
    if (!snapshotPromise) snapshotPromise = snapshotService.buildMailReadySnapshot({ allRows: true, omitFoundSnapshot: true });
    try { return await snapshotPromise; } catch (error) { snapshotPromise = null; throw error; }
  }
  async function getStatus({ includeInventory = false } = {}) {
    const control = await store.readControl();
    return {
      ok: true, enabled: control.enabled, time: '00:00', timeZone: TIME_ZONE,
      targets: { softora: control.softora_target, instantly: control.instantly_target },
      budget: { currency: 'EUR', limitCents: Number(control.approved_cents), chargedCents: Number(control.charged_cents),
        heldCents: Number(control.held_cents), accounting: 'conservative-image-usage', autoTopUp: false },
      lastCheckDay: control.last_check_day, lastResult: control.last_result,
      ...(includeInventory ? { inventory: (({ ready, pending }) => ({ ready, pending }))(
        inventory(await readInventory(true), await store.readActiveJobs())) } : {}),
    };
  }
  async function materializePlan(planned, batchId) {
    const existing = await dataOpsStore.getWebdesignBatch(OWNER_KEY, batchId);
    const chunks = await dataOpsStore.listWebdesignBatchChunks(OWNER_KEY, batchId);
    if (!Array.isArray(chunks)) throw new Error('Aanvulblokken niet volledig leesbaar.');
    const included = new Set(chunks.flatMap((chunk) => chunk.targets.map((target) => target.customer.id)));
    const missing = planned.filter((row) => ['planned', 'reserved'].includes(row.status) && !included.has(row.customer.id));
    let total = chunks.reduce((sum, chunk) => sum + chunk.targets.length, 0);
    let index = chunks.reduce((max, chunk) => Math.max(max, chunk.index + 1), 0);
    const createdAt = existing?.createdAt || now();
    for (let start = 0; start < missing.length; start += 100) {
      const targets = missing.slice(start, start + 100).map((row, offset) => ({
        index: total + offset, status: 'pending', customer: { ...row.customer, webdesignMailProvider: row.provider },
        websiteUrl: row.customer.website || row.customer.dom, variant: 'v2-visual-dna', updatedAt: now(),
      }));
      const saved = await dataOpsStore.upsertWebdesignBatchChunk({ ownerKey: OWNER_KEY, batchId, index, status: 'queued', createdAt, targets });
      if (saved?.ok !== true) throw new Error('Aanvulblok niet veilig opgeslagen.');
      total += targets.length; index++;
    }
    if (total && (!existing || missing.length || total !== existing.total)) {
      const saved = await dataOpsStore.upsertWebdesignBatch({ ...existing, id: batchId, ownerKey: OWNER_KEY, status: 'running',
        total, expectedChunks: index, uploadedTargets: total, createdAt, startedAt: existing?.startedAt || now(),
        finishedAt: null, summary: {}, lastError: '' });
      if (saved?.ok !== true) throw new Error('Aanvulbatch niet veilig opgeslagen.');
    }
  }
  async function runDueCheck() {
    const { day, hour } = localNight(now());
    try {
      const control = await store.readControl();
      if (!control.enabled) return { skipped: true, reason: 'disabled' };
      if (control.last_check_day !== day && hour !== 0) return { skipped: true, reason: 'outside_midnight_hour' };
      if (control.last_check_day === day && control.last_result?.status === 'complete') return { skipped: true, reason: 'already_checked', day };
      const lastCheckAt = Date.parse(control.last_result?.checkedAt || '');
      if (control.last_check_day === day && now() - lastCheckAt < 5 * 60000) return { skipped: true, reason: 'check_cooldown', day };
      if (Number(control.charged_cents) + Number(control.held_cents) + 1000 > Number(control.approved_cents)) return { skipped: true, reason: 'budget_exhausted' };
      await store.reconcile();
      accountingUncertain = false;
      const snapshot = await readInventory(true);
      const stock = inventory(snapshot, await store.readActiveJobs());
      const targets = { softora: control.softora_target, instantly: control.instantly_target };
      const deficit = Object.fromEntries(Object.keys(targets).map((key) => [key, Math.max(0, targets[key] - stock.ready[key] - stock.pending[key])]));
      const batchId = `mail_stock_${day.replace(/-/g, '')}`;
      let planned = await store.readPlan(batchId);
      if (!Array.isArray(planned)) throw new Error('Nachtelijk aanvulplan niet leesbaar.');
      for (const row of planned.filter((row) => row.status === 'planned' || row.status === 'reserved')) {
        if (addUnique(row.customer, stock.used)) deficit[row.provider] = Math.max(0, deficit[row.provider] - 1);
      }
      const added = { softora: 0, instantly: 0 };
      for (const customer of snapshot.availableCustomers) {
        const provider = chooseProvider(customer, deficit);
        if (!deficit[provider] || !(customer.website || customer.dom)) continue;
        const keys = buildGuardKeysForRow(customer);
        if (keys.some((key) => stock.used.has(key))) continue;
        const allocation = await store.allocate({ ...customer, webdesignMailProvider: provider }, provider, keys, batchId);
        if (allocation.allocated !== true) continue;
        keys.forEach((key) => stock.used.add(key));
        deficit[provider] -= 1; added[provider] += 1;
      }
      planned = await store.readPlan(batchId);
      await materializePlan(planned, batchId);
      const summary = { day, checkedAt: new Date(now()).toISOString(), ready: stock.ready, pending: stock.pending,
        added, missing: deficit, planned: planned.length, batchId: planned.length ? batchId : null };
      summary.status = Object.keys(targets).every((provider) => stock.ready[provider] >= targets[provider]) ? 'complete' : 'replenishing';
      await store.recordCheck(day, summary);
      logger.info?.('[NightlyMailStock][check]', summary);
      return { ok: true, ...summary };
    } catch (error) {
      logger.warn?.('[NightlyMailStock][check-failed]', error?.message || error);
      return { ok: false, reason: 'stock_check_unavailable' };
    }
  }
  async function generate(job, generateImage, markPaidAttempt = async () => {}) {
    if (accountingUncertain) throw halted('Automatische aanvulling wacht op zekere kostenafrekening.');
    if (!/^gpt-image-2\.5-(sunburst|flare)(-\d{4}-\d{2}-\d{2})?$/.test(imageModel)) throw halted('Automatische aanvulling heeft geen gecontroleerd beeldtarief.');
    let payload, reserved = false, paidRequestStarted = false;
    const beforeImageRequest = async (request) => {
      await assertApprovedImageRequest(request);
      // Preparation is unpaid. Reserve durably only at the actual provider boundary.
      const snapshot = await readInventory(true);
      const current = snapshot.availableCustomers.find((row) => row.id === job.customer.id);
      const provider = providerOf(job.customer);
      const control = await store.readControl();
      const stock = inventory(snapshot);
      if (!current || stock.readyIds[provider].includes(current.id) || (fixedProvider(current) && fixedProvider(current) !== provider) || stock.ready[provider] >= control[`${provider}_target`]) throw halted('Aanvulling niet meer nodig of bedrijf niet meer beschikbaar.');
      const keys = buildGuardKeysForRow(current);
      const blocked = await dataOpsStore.listOutboundRecipientGuardKeys(keys, { bypassReadFailureCooldown: true, suppressReadFailureCooldown: true });
      if (!Array.isArray(blocked) || blocked.length) throw halted('Verzendbeveiliging blokkeert deze automatische aanvulling.');
      const reservation = await store.reserve(job.customer.id, job.id, stock.readyIds[provider]);
      if (reservation.reserved !== true) throw halted('Automatische aanvulling gestopt door budget- of herhaalbeveiliging.');
      reserved = true;
      await markPaidAttempt();
      paidRequestStarted = true;
      logger.info?.('[NightlyMailStock][provider-start]', { jobId: job.id, customerId: job.customer.id });
    };
    try {
      payload = await generateImage(beforeImageRequest);
      if (!paidRequestStarted) throw halted('Beeldgenerator heeft de budgetcontrole niet uitgevoerd.');
    } catch (error) {
      if (reserved) await store.settle(job.customer.id, job.id, paidRequestStarted ? null : 0, null).catch(() => { accountingUncertain = true; });
      error.noAutomaticWebdesignRetry = true;
      throw error;
    }
    const generation = buildWebsiteImageGenerationMetadata(payload);
    try {
      const settled = await store.settle(job.customer.id, job.id, budgetChargeCents(generation), generation);
      if (settled.settled !== true) { accountingUncertain = true; logger.warn?.('[NightlyMailStock][cost-uncertain]', job.id); }
    } catch (_error) {
      accountingUncertain = true;
      // Preserve the unique image; a failed settlement keeps its EUR 10 hold.
      await store.settle(job.customer.id, job.id, null, generation).catch(() => {});
      logger.warn?.('[NightlyMailStock][settlement-unavailable]', job.id);
    }
    snapshotPromise = null;
    return payload;
  }
  return { getStatus, runDueCheck, generate };
}

module.exports = { OWNER_KEY, localNight, inventory, budgetChargeCents, assertApprovedImageRequest, createNightlyMailStockService };
