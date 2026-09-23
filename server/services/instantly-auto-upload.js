const { createHash } = require('node:crypto');
const { resolveInstantlyDesignOwner } = require('./instantly-design-owner');
const { isRemoteLeadConfirmedSent } = require('./instantly-campaign-replacement');

const MAX_AUTO_UPLOAD_BATCH = 500;
// Leave time for the canonical POST to respond before the cron's HTTP timeout.
const AUTO_UPLOAD_RUN_BUDGET_MS = 90 * 1000;

const APPROVED_CAMPAIGNS = Object.freeze({
  serve: { id: '7a94c361-d83c-4857-9395-e9c5ba603f90', name: 'Servé Creusen Softora.nl - frisse start' },
  martijn: { id: 'e4f7df3a-6c53-4c03-911c-beb758d9231c', name: 'Martijn van de Ven Softora.nl - frisse start' },
});

const LEGACY_CAMPAIGNS = Object.freeze({
  serve: '6ba410c6-d97a-4186-a414-83ba95022b1a',
  martijn: '79b1f8c0-35de-4687-95ea-8384c4c491bd',
});

function text(value) {
  return String(value || '').trim();
}

function isDesignedInstantlyRow(row, assets, normalizeString = text) {
  return normalizeString(row && row.webdesignMailProvider || assets && assets.photo && assets.photo.webdesignMailProvider).toLowerCase() === 'instantly' &&
    Boolean(assets && assets.ready);
}

function formatDateKeyForTimeZone(value, timeZone = 'Europe/Amsterdam') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}

function createInstantlyAutoUpload(deps = {}) {
  const {
    config = {},
    now = () => new Date(),
    loadRows,
    persistRows,
    loadContext,
    collectEligibleRows,
    getReadyPhoto,
    buildLead,
    resolveSender,
    reserveRows,
    confirmReservation,
    releaseReservation = async () => ({ ok: false, skipped: true }),
    saveLegacyGuards,
    markPreparedRows,
    persistSingleRow = null,
    getCampaign,
    listCampaignLeads,
    addCampaignLeads,
    activateCampaign,
    removeMailReadyCustomer = async () => {},
    createError = (message, code, status = 400, details = {}) => Object.assign(new Error(message), { code, status, ...details }),
  } = deps;

  function assertApprovedCampaign(owner) {
    const approved = APPROVED_CAMPAIGNS[owner];
    const configuredCampaigns = config.autoApprovedCampaigns || config.replacementCampaigns;
    const configured = text(configuredCampaigns && configuredCampaigns[owner]);
    if (!configured || configured !== approved.id) {
      throw createError('De twee goedgekeurde Instantly-campagnes zijn niet exact gekoppeld.', 'INSTANTLY_AUTO_CAMPAIGN_CONFIG_MISMATCH', 503);
    }
    return approved;
  }

  function assertAutoReady() {
    if (!config.enabled) {
      throw createError('Instantly-integratie staat niet veilig aan.', 'INSTANTLY_AUTO_INTEGRATION_DISABLED', 503);
    }
    if (!config.autoUploadEnabled) {
      throw createError('Instantly automatische upload staat niet veilig aan.', 'INSTANTLY_AUTO_DISABLED', 503);
    }
    if (!config.apiKey) {
      throw createError('Instantly API-configuratie ontbreekt.', 'INSTANTLY_AUTO_API_KEY_MISSING', 503);
    }
  }

  async function readApprovedCampaign(owner) {
    const approved = assertApprovedCampaign(owner);
    const campaign = await getCampaign(approved.id);
    if (text(campaign && campaign.name) !== approved.name) {
      throw createError('Instantly-campagne heeft niet meer de goedgekeurde naam.', 'INSTANTLY_AUTO_CAMPAIGN_IDENTITY_MISMATCH', 503);
    }
    const status = Number(campaign.status);
    // Draft and paused campaigns may receive leads but cannot send until the
    // owner deliberately launches or resumes them. Never activate either here.
    if (![0, 1, 2, 3].includes(status)) {
      throw createError('Instantly-campagne heeft een onbekende status.', 'INSTANTLY_AUTO_CAMPAIGN_NOT_SENDABLE', 503);
    }
    return { approved, status };
  }

  async function recoverAcceptedLeadCampaign(rows) {
    for (const owner of ['serve', 'martijn']) {
      const approved = assertApprovedCampaign(owner);
      const index = rows.findIndex((row) =>
        text(row && row.instantlyCampaignId) === approved.id &&
        text(row && row.instantlyManualUploadId).startsWith('instantly-auto-') &&
        text(row && row.instantlyLeadId) &&
        text(row && row.instantlyStatus).toLowerCase() === 'synced' &&
        !text(row && (row.instantlyEmailSentAt || row.lastInstantlySentAt || row.instantlySentAt))
      );
      if (index < 0) continue;
      const photoContext = await loadContext(rows, null, { autoMailReadyOnly: true });
      const designOwner = resolveInstantlyDesignOwner(rows[index], getReadyPhoto({ row: rows[index], index }, photoContext));
      if (designOwner.owner !== owner) {
        throw createError('Geaccepteerde Instantly-lead heeft geen bewezen afzender voor de gekozen campagne; activering gestopt.',
          'INSTANTLY_AUTO_ACCEPTED_DESIGN_SENDER_MISMATCH', 503);
      }
      const campaign = await readApprovedCampaign(owner);
      if (campaign.status !== 3) continue;
      await activateCampaign(approved.id);
      return { owner, campaignId: approved.id };
    }
    return null;
  }

  function getRemoteLeadPayload(lead) {
    if (!lead || typeof lead !== 'object') return {};
    const payload = lead.payload && typeof lead.payload === 'object' ? lead.payload : {};
    const customVariables = lead.custom_variables && typeof lead.custom_variables === 'object'
      ? lead.custom_variables
      : {};
    return { ...customVariables, ...payload };
  }

  function getRemoteLeadId(lead) {
    return text(lead && (lead.id || lead.lead_id || lead.instantly_lead_id));
  }

  function getRemoteLeadEmail(lead) {
    const payload = getRemoteLeadPayload(lead);
    return text(lead && (lead.email || lead.contact || lead.lead_email || payload.email)).toLowerCase();
  }

  function getRemoteCustomerId(lead) {
    const payload = getRemoteLeadPayload(lead);
    return text(payload.softora_customer_id || payload.softoraCustomerId || payload.customer_id || payload.customerId);
  }

  function getRemoteUploadId(lead) {
    const payload = getRemoteLeadPayload(lead);
    return text(payload.softora_instantly_upload_id || payload.softoraInstantlyUploadId);
  }

  async function reconcileMovedLeadLinks(rows, actor, at) {
    if (typeof persistSingleRow !== 'function') return 0;
    let updated = 0;
    for (const owner of ['serve', 'martijn']) {
      const candidates = rows.filter((row) =>
        text(row && row.instantlyCampaignId) === LEGACY_CAMPAIGNS[owner] &&
        text(row && row.instantlyStatus).toLowerCase() === 'synced' &&
        text(row && row.instantlyLeadId) &&
        !text(row && (row.instantlyEmailSentAt || row.lastInstantlySentAt || row.instantlySentAt))
      );
      if (!candidates.length) continue;
      const { approved } = await readApprovedCampaign(owner);
      const [newLeads, oldLeads] = await Promise.all([
        listCampaignLeads(approved.id, 10000),
        listCampaignLeads(LEGACY_CAMPAIGNS[owner], 10000),
      ]);
      for (const row of candidates) {
        const email = text(row.email || row.contactEmail).toLowerCase();
        const customerId = text(row.id || row.customerId || row.databaseId);
        const uploadId = text(row.instantlyManualUploadId);
        const matches = (newLeads || []).filter((lead) =>
          getRemoteLeadEmail(lead) === email &&
          (getRemoteLeadId(lead) === text(row.instantlyLeadId) ||
            (customerId && getRemoteCustomerId(lead) === customerId) ||
            (uploadId && getRemoteUploadId(lead) === uploadId))
        );
        if (!matches.length) continue;
        if (matches.length !== 1 || !getRemoteLeadId(matches[0]) || isRemoteLeadConfirmedSent(matches[0]) ||
            (oldLeads || []).some((lead) => getRemoteLeadEmail(lead) === email)) {
          throw createError('Verplaatste lead is niet uniek, niet onverzonden of staat nog in de oude campagne.',
            'INSTANTLY_AUTO_MOVED_LEAD_AMBIGUOUS', 503);
        }
        const linked = { ...row, instantlyCampaignId: approved.id,
          instantlyLeadId: getRemoteLeadId(matches[0]), instantlyLastEventAt: at, updatedAt: at,
          hist: [{ type: 'instantly_verplaatst', label: 'Verplaatst naar nieuwe Instantly-campagne',
            date: at, actor, source: 'instantly-auto-upload-moved-link',
            messageKey: `instantly-campaign-move:${getRemoteLeadId(matches[0])}:${approved.id}`,
            subject: 'Instantly-campagne gewisseld',
            preview: 'De onverstuurde lead staat uitsluitend in de nieuwe campagne.' },
          ...(Array.isArray(row.hist) ? row.hist : [])].slice(0, 50),
        };
        if (!(await persistLinkedRow(linked, actor))) {
          throw createError('Verplaatste Instantly-lead kon niet in Softora worden gekoppeld.',
            'INSTANTLY_AUTO_MOVED_LEAD_LINK_FAILED', 502);
        }
        updated += 1;
      }
    }
    return updated;
  }

  async function persistLinkedRow(row, actor) {
    if (!row || typeof persistSingleRow !== 'function') return false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (await persistSingleRow(row, { source: 'instantly-auto-upload-linked', actor, upsertOnly: true })) {
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  async function recoverAcceptedLeadLink(rows, actor, at) {
    const pending = (Array.isArray(rows) ? rows : []).find((row) =>
      text(row && row.instantlyManualUploadId).startsWith('instantly-auto-') &&
      text(row && row.instantlyStatus).toLowerCase() === 'queued' &&
      !text(row && row.instantlyLeadId) &&
      !text(row && (row.instantlyEmailSentAt || row.lastInstantlySentAt || row.instantlySentAt))
    );
    if (!pending) return null;

    const owner = ['serve', 'martijn'].find((key) => APPROVED_CAMPAIGNS[key].id === text(pending.instantlyCampaignId));
    if (!owner) {
      throw createError('Lokale Instantly-wachtrij verwijst niet naar een goedgekeurde campagne.',
        'INSTANTLY_AUTO_PENDING_CAMPAIGN_MISMATCH', 503);
    }
    const { approved } = await readApprovedCampaign(owner);
    const remoteLeads = await listCampaignLeads(approved.id, 10000);
    const uploadId = text(pending.instantlyManualUploadId);
    const customerId = text(pending.id || pending.customerId || pending.databaseId);
    const email = text(pending.email || pending.contactEmail).toLowerCase();
    const matches = (Array.isArray(remoteLeads) ? remoteLeads : []).filter((lead) => {
      const identityMatches = getRemoteUploadId(lead) === uploadId ||
        (customerId && getRemoteCustomerId(lead) === customerId);
      return Boolean(getRemoteLeadId(lead) && email && getRemoteLeadEmail(lead) === email && identityMatches);
    });
    if (!matches.length) {
      const history = Array.isArray(pending.hist) ? pending.hist.filter(Boolean) : [];
      const failedRow = {
        ...pending,
        instantlyLeadId: '',
        instantlyCampaignId: '',
        instantlyStatus: 'provider_not_found',
        instantlySyncedAt: '',
        instantlyLastEventAt: at,
        instantlyManualUploadId: '',
        instantlyManualUploadPreparedAt: '',
        instantlySenderProfileKey: '',
        instantlySenderName: '',
        instantlySenderEmail: '',
        instantlyPreviousStatus: '',
        instantlyPreviousDatabaseStatus: '',
        instantlyProviderRecoveryAt: at,
        instantlyProviderRecoveryReason: 'provider_lead_not_found',
        instantlyProviderRecoveryCampaignId: approved.id,
        instantlyProviderRecoveryUploadId: uploadId,
        lastColdmailProvider: 'instantly',
        lastColdmailProviderStatus: 'provider_not_found',
        updatedAt: at,
        hist: [{
          type: 'instantly_niet_geaccepteerd',
          label: 'Niet aanwezig in Instantly',
          date: at,
          actor,
          source: 'instantly-auto-upload-missing-provider-cleanup',
          messageKey: `instantly-auto-provider-not-found:${uploadId}:${customerId || email}`,
          subject: 'Instantly wachtrij hersteld',
          preview: 'De lokale voorreservering is niet door Instantly geaccepteerd en telt daarom niet meer als klaargezet. De ontvanger-guard blijft fail-closed staan.',
        }, ...history].slice(0, 50),
      };
      if (!(await persistLinkedRow(failedRow, actor))) {
        throw createError('De niet-geaccepteerde Instantly-voorreservering kon niet worden hersteld.',
          'INSTANTLY_AUTO_MISSING_PROVIDER_CLEANUP_FAILED', 502,
          { campaignId: approved.id, customerId, uploadId, email });
      }
      return {
        owner,
        campaignId: approved.id,
        customerId,
        uploadId,
        email,
        reason: 'missing_provider_lead_cleared',
      };
    }
    if (matches.length !== 1) {
      throw createError(
        'Meer dan één Instantly-lead past bij de lokale wachtrij; herstel is veilig gestopt.',
        'INSTANTLY_AUTO_REMOTE_LINK_AMBIGUOUS',
        502,
        { campaignId: approved.id, customerId, uploadId, email, matches: matches.length }
      );
    }
    const leadId = getRemoteLeadId(matches[0]);
    const linkedRow = { ...pending, instantlyLeadId: leadId, instantlyStatus: 'synced',
      lastColdmailProviderStatus: 'synced', instantlyLastEventAt: at, updatedAt: at };
    if (!(await persistLinkedRow(linkedRow, actor))) {
      throw createError('Bestaande Instantly-lead is gevonden, maar de lokale herkoppeling faalde.',
        'INSTANTLY_AUTO_LOCAL_RECOVERY_LINK_FAILED', 502,
        { campaignId: approved.id, customerId, uploadId, email, leadId });
    }
    await removeMailReadyCustomer(customerId);
    return { owner, campaignId: approved.id, customerId, uploadId, leadId };
  }

  async function getCapacity() {
    assertAutoReady();
    assertApprovedCampaign('serve');
    assertApprovedCampaign('martijn');
    const at = now().toISOString();
    const loaded = await loadRows();
    const rows = Array.isArray(loaded && loaded.rows) ? loaded.rows : [];
    const context = await loadContext(rows, null, { autoMailReadyOnly: true });
    const selected = await collectEligibleRows(rows, Math.max(1, rows.length), context);
    const availableByOwner = { serve: 0, martijn: 0 };
    let unresolvedSender = 0;
    for (const item of selected.selectedRows || []) {
      const resolved = resolveInstantlyDesignOwner(item.row, getReadyPhoto(item, context));
      if (resolved.owner && Object.hasOwn(availableByOwner, resolved.owner)) availableByOwner[resolved.owner] += 1;
      else unresolvedSender += 1;
    }
    const campaignStates = await Promise.all(['serve', 'martijn'].map(readApprovedCampaign));
    const campaignLeadLists = await Promise.all(['serve', 'martijn'].map((owner) =>
      listCampaignLeads(APPROVED_CAMPAIGNS[owner].id, 10000)
    ));
    const queuedByOwner = Object.fromEntries(['serve', 'martijn'].map((owner, index) => [
      owner,
      (Array.isArray(campaignLeadLists[index]) ? campaignLeadLists[index] : [])
        .filter((lead) => !isRemoteLeadConfirmedSent(lead)).length,
    ]));
    const today = formatDateKeyForTimeZone(at, config.dailyCapTimeZone);
    const syncedToday = rows.filter((row) =>
      formatDateKeyForTimeZone(row && row.instantlySyncedAt, config.dailyCapTimeZone) === today
    ).length;
    const total = availableByOwner.serve + availableByOwner.martijn;
    return {
      ok: true,
      exact: true,
      total,
      syncedToday,
      dailyCap: Number(config.dailyCap || 0),
      remainingToday: Math.max(0, Number(config.dailyCap || 0) - syncedToday),
      // The daily cap still applies to legacy sync, not to preparing leads
      // in the approved campaigns. Instantly controls the actual send pace.
      uploadableToday: total,
      automaticUploadUncapped: true,
      unresolvedSender,
      campaigns: Object.fromEntries(['serve', 'martijn'].map((owner, index) => [owner, {
        id: APPROVED_CAMPAIGNS[owner].id,
        name: APPROVED_CAMPAIGNS[owner].name,
        status: campaignStates[index].status,
        available: availableByOwner[owner],
        queued: queuedByOwner[owner],
      }])),
      queuedTotal: queuedByOwner.serve + queuedByOwner.martijn,
      checkedRows: rows.length,
      rejectedBySafetyChecks: Array.isArray(selected.failed) ? selected.failed.length : 0,
      generatedAt: at,
    };
  }

  async function runOne(input = {}) {
    assertAutoReady();
    // Never use the destructive campaign-replacement operation or an unchecked CSV import.
    assertApprovedCampaign('serve');
    assertApprovedCampaign('martijn');
    const actor = text(input.actor) || 'Instantly automatische aanvulling';
    const at = now().toISOString();
    const loaded = await loadRows();
    const rows = Array.isArray(loaded && loaded.rows) ? loaded.rows : [];
    const movedLinks = await reconcileMovedLeadLinks(rows, actor, at);
    if (movedLinks) {
      return { ok: true, skipped: true, reason: 'moved_leads_linked', movedLinks, finishedAt: at };
    }
    const recoveredLink = await recoverAcceptedLeadLink(rows, actor, at);
    if (recoveredLink) {
      return { ok: true, skipped: true, reason: 'accepted_lead_linked', ...recoveredLink, finishedAt: at };
    }
    // A provider-accepted lead must not remain stranded if a previous activation
    // failed. Resume only an exact approved Completed campaign, never a paused one.
    const recovered = await recoverAcceptedLeadCampaign(rows);
    if (recovered) return { ok: true, skipped: true, reason: 'accepted_campaign_reactivated', ...recovered, finishedAt: at };
    const screeningContext = await loadContext(rows, null, { autoMailReadyOnly: true });
    // Look one lead ahead so a single-lead batch can finish without a second
    // full DataOps read after the provider has accepted that lead.
    const selected = await collectEligibleRows(rows, 2, screeningContext);
    const item = selected && selected.selectedRows && selected.selectedRows[0];
    if (!item) {
      return { ok: true, skipped: true, reason: 'no_mailready_instantly_leads', finishedAt: at };
    }
    const designOwner = resolveInstantlyDesignOwner(item.row, getReadyPhoto(item, screeningContext));
    if (!designOwner.owner) {
      throw createError('Afzender van dit Instantly-design ontbreekt of is tegenstrijdig; niets geüpload.',
        'INSTANTLY_AUTO_DESIGN_SENDER_UNRESOLVED', 503);
    }
    const owner = designOwner.owner;
    const { approved, status } = await readApprovedCampaign(owner);
    let activated = status === 1;
    if (!activated && status === 3) {
      // Instantly rejects new leads for a Completed campaign. Resume only an
      // exact approved campaign with no current leads, before creating any new
      // outbound reservation; existing leads must never be sent again.
      if (typeof listCampaignLeads !== 'function') {
        throw createError('Instantly-campagne kan niet veilig op bestaande leads worden gecontroleerd.',
          'INSTANTLY_AUTO_CAMPAIGN_LEADS_CHECK_UNAVAILABLE', 503);
      }
      const existingLeads = await listCampaignLeads(approved.id, 1);
      if (!Array.isArray(existingLeads) || existingLeads.length) {
        throw createError('Afgeronde Instantly-campagne bevat nog leads; niet opnieuw geactiveerd.',
          'INSTANTLY_AUTO_COMPLETED_CAMPAIGN_HAS_LEADS', 503);
      }
      await activateCampaign(approved.id);
      activated = true;
    }
    const sender = resolveSender(owner);
    const context = await loadContext(rows, sender, { autoMailReadyOnly: true });
    const reselected = await collectEligibleRows(rows, 1, context);
    if (!reselected.selectedRows[0] || reselected.selectedRows[0].index !== item.index) {
      throw createError('De lead veranderde tijdens de afzendercontrole; niets geüpload.',
        'INSTANTLY_AUTO_DESIGN_SENDER_SELECTION_CHANGED', 503);
    }
    const lead = await buildLead(item, context);
    // Several leads can now be prepared within one second; the customer hash
    // keeps each durable reservation and recovery link unambiguous.
    const customerHash = createHash('sha256').update(text(item.id)).digest('hex').slice(0, 12);
    const uploadId = `instantly-auto-${at.replace(/[^0-9a-z]+/gi, '').slice(0, 15)}-${owner}-${customerHash}`;
    lead.custom_variables = { ...(lead.custom_variables || {}), softora_instantly_upload_id: uploadId };
    const reservation = await reserveRows([item], { actor, uploadId, campaignId: approved.id, sender, provisional: true });
    if (!reservation || reservation.ok !== true || Number(reservation.count) < 1 ||
        Number(reservation.count) !== Number(reservation.expectedCount) || !text(reservation.reservationId)) {
      throw createError('Centrale ontvanger-guard kon niet exact één lead reserveren.', 'INSTANTLY_AUTO_CENTRAL_GUARD_FAILED', 503);
    }

    async function releaseProvisional(reservationId) {
      try {
        await releaseReservation(reservationId);
      } catch (_) {}
    }

    async function rollbackLocalQueuedState() {
      try {
        if (typeof persistSingleRow === 'function') {
          await persistSingleRow(item.row, { source: 'instantly-auto-upload-rollback', actor, upsertOnly: true });
        } else {
          await persistRows(loaded, rows, { source: 'instantly-auto-upload-rollback', actor });
        }
      } catch (_) {}
    }

    // Both the local queued state and both permanent guards must be durable BEFORE /leads/add.
    // The local write is a single-row upsert (never a full replace) so a large database
    // can never block the queue with a 413/timeout. A provisional central reservation is
    // always released again when a pre-upload step fails, so the lead stays retryable and
    // no permanent guard is written before the local state is safe.
    const queued = markPreparedRows(rows, [item], { at, actor, uploadId, campaignId: approved.id, sender });
    const preparedSingle = Array.isArray(queued) ? queued[item.index] : null;
    let prepared = false;
    try {
      prepared = typeof persistSingleRow === 'function'
        ? await persistSingleRow(preparedSingle, { source: 'instantly-auto-upload', actor, upsertOnly: true })
        : await persistRows(loaded, queued, { source: 'instantly-auto-upload', actor });
    } catch (_) {
      prepared = false;
    }
    if (!prepared) {
      await releaseProvisional(reservation.reservationId);
      throw createError('Lokale Instantly-reservering kon niet worden bewaard.', 'INSTANTLY_AUTO_LOCAL_RESERVATION_FAILED', 502);
    }
    try {
      await saveLegacyGuards([item], { at, actor, uploadId, campaignId: approved.id, sender, source: 'instantly-auto-upload' });
    } catch (error) {
      await rollbackLocalQueuedState();
      await releaseProvisional(reservation.reservationId);
      throw error;
    }
    let confirmed = null;
    try {
      confirmed = await confirmReservation(reservation.reservationId, {
        status: 'queued', permanent: true, at, payload: { campaignId: approved.id, uploadId, owner },
      });
    } catch (_) {
      confirmed = null;
    }
    if (!confirmed || confirmed.ok !== true) {
      await rollbackLocalQueuedState();
      await releaseProvisional(reservation.reservationId);
      throw createError('Centrale guard kon niet definitief worden bevestigd; er is niets geüpload.', 'INSTANTLY_AUTO_GUARD_CONFIRM_FAILED', 502);
    }
    await removeMailReadyCustomer(item.id);

    // An ambiguous provider response is never retried automatically: the permanent
    // recipient guards protect against a duplicate even when Instantly did create it.
    const result = await addCampaignLeads(approved.id, [lead]);
    const created = Array.isArray(result && result.created_leads) ? result.created_leads : [];
    const createdLead = created.find((entry) => Number(entry && entry.index) === 0);
    if (Number(result && result.leads_uploaded) !== 1 || created.length !== 1 ||
        text(createdLead && createdLead.id) === '' || text(createdLead && createdLead.email).toLowerCase() !== text(lead.email).toLowerCase()) {
      throw createError('Instantly bevestigde niet exact één nieuwe lead; guards blijven staan.', 'INSTANTLY_AUTO_PROVIDER_PARTIAL_UPLOAD', 502);
    }

    const linkedRow = { ...preparedSingle, instantlyLeadId: text(createdLead.id), instantlyStatus: 'synced',
      lastColdmailProviderStatus: 'synced', instantlyLastEventAt: at, updatedAt: at };
    const linked = await persistLinkedRow(linkedRow, actor);
    if (!linked) {
      throw createError('Instantly accepteerde de lead, maar de lokale lead-koppeling faalde; guards blijven staan.',
        'INSTANTLY_AUTO_LOCAL_LINK_FAILED', 502,
        { campaignId: approved.id, customerId: item.id, uploadId, email: lead.email, leadId: text(createdLead.id) });
    }

    return { ok: true, uploaded: 1, activated, owner, campaignId: approved.id,
      moreAvailable: selected.selectedRows.length > 1, finishedAt: at };
  }

  async function run(input = {}) {
    const requested = Number(input.limit);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_AUTO_UPLOAD_BATCH)
      : MAX_AUTO_UPLOAD_BATCH;
    const started = Date.now();
    const distribution = { serve: 0, martijn: 0 };
    let uploaded = 0;
    let recovered = 0;
    let lastUpload = null;
    let lastRecovery = null;

    // Reuse the proven per-recipient guard -> local queue -> permanent guard
    // -> Instantly acceptance -> local link sequence. A response is never
    // retried after an ambiguous provider effect; the next run reconciles it.
    for (let attempts = 0; attempts < limit + 20 && Date.now() - started < AUTO_UPLOAD_RUN_BUDGET_MS; attempts += 1) {
      let result;
      try {
        result = await runOne(input);
      } catch (error) {
        if (!uploaded) throw error;
        // Stop after any ambiguous provider effect. The next invocation first
        // reconciles queued rows; permanent guards prevent a duplicate send.
        return {
          ok: false, code: text(error && error.code) || 'INSTANTLY_AUTO_BATCH_INTERRUPTED',
          uploaded, distribution, recovered, hasMore: true,
          finishedAt: now().toISOString(),
        };
      }
      if (Number(result && result.uploaded) === 1) {
        uploaded += 1;
        distribution[result.owner] += 1;
        lastUpload = result;
        if (!result.moreAvailable) {
          return { ...lastUpload, uploaded, distribution, recovered, hasMore: false, finishedAt: now().toISOString() };
        }
        if (uploaded >= limit) break;
        continue;
      }
      if (result && ['moved_leads_linked', 'accepted_lead_linked', 'accepted_campaign_reactivated'].includes(result.reason)) {
        recovered += 1;
        lastRecovery = result;
        continue;
      }
      if (!uploaded) return { ...(lastRecovery || result), recovered, hasMore: false };
      return { ...lastUpload, uploaded, distribution, recovered, hasMore: false, finishedAt: now().toISOString() };
    }
    return {
      ...(lastUpload || lastRecovery || { ok: true }),
      uploaded,
      distribution,
      recovered,
      hasMore: true,
      finishedAt: now().toISOString(),
    };
  }

  return { getCapacity, run };
}

module.exports = { APPROVED_CAMPAIGNS, createInstantlyAutoUpload, formatDateKeyForTimeZone, isDesignedInstantlyRow };
