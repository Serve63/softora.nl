const { resolveInstantlyDesignOwner } = require('./instantly-design-owner');

const APPROVED_CAMPAIGNS = Object.freeze({
  serve: { id: '6ba410c6-d97a-4186-a414-83ba95022b1a', name: 'Servé Creusen Softora.nl' },
  martijn: { id: '9a603e82-7a50-46e2-855a-5a2990a9304b', name: 'Martijn van de Ven Softora.nl' },
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
    createError = (message, code, status = 400) => Object.assign(new Error(message), { code, status }),
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

  async function readApprovedCampaign(owner) {
    const approved = assertApprovedCampaign(owner);
    const campaign = await getCampaign(approved.id);
    if (text(campaign && campaign.name) !== approved.name) {
      throw createError('Instantly-campagne heeft niet meer de goedgekeurde naam.', 'INSTANTLY_AUTO_CAMPAIGN_IDENTITY_MISMATCH', 503);
    }
    const status = Number(campaign.status);
    // A paused campaign remains a valid, exact upload target: Instantly accepts
    // new leads while it is paused and only sends them after a deliberate resume.
    if (![1, 2, 3].includes(status)) {
      throw createError('Instantly-campagne is ongezond of nog een concept.', 'INSTANTLY_AUTO_CAMPAIGN_NOT_SENDABLE', 503);
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

  async function run(input = {}) {
    if (!config.enabled) {
      throw createError('Instantly-integratie staat niet veilig aan.', 'INSTANTLY_AUTO_INTEGRATION_DISABLED', 503);
    }
    if (!config.autoUploadEnabled) {
      throw createError('Instantly automatische upload staat niet veilig aan.', 'INSTANTLY_AUTO_DISABLED', 503);
    }
    if (!config.apiKey) {
      throw createError('Instantly API-configuratie ontbreekt.', 'INSTANTLY_AUTO_API_KEY_MISSING', 503);
    }
    // Never use the destructive campaign-replacement operation or an unchecked CSV import.
    assertApprovedCampaign('serve');
    assertApprovedCampaign('martijn');
    const actor = text(input.actor) || 'Instantly automatische aanvulling';
    const at = now().toISOString();
    const loaded = await loadRows();
    const rows = Array.isArray(loaded && loaded.rows) ? loaded.rows : [];
    // A provider-accepted lead must not remain stranded if a previous activation
    // failed. Resume only an exact approved Completed campaign, never a paused one.
    const recovered = await recoverAcceptedLeadCampaign(rows);
    if (recovered) return { ok: true, skipped: true, reason: 'accepted_campaign_reactivated', ...recovered, finishedAt: at };
    const today = formatDateKeyForTimeZone(at, config.dailyCapTimeZone);
    const syncedToday = rows.filter((row) =>
      formatDateKeyForTimeZone(row && row.instantlySyncedAt, config.dailyCapTimeZone) === today
    ).length;
    if (syncedToday >= config.dailyCap) {
      return { ok: true, skipped: true, reason: 'daily_cap', syncedToday, cap: config.dailyCap, finishedAt: at };
    }
    const screeningContext = await loadContext(rows, null, { autoMailReadyOnly: true });
    const selected = await collectEligibleRows(rows, 1, screeningContext);
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
    const uploadId = `instantly-auto-${at.replace(/[^0-9a-z]+/gi, '').slice(0, 15)}-${owner}`;
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

    // An ambiguous provider response is never retried automatically: the permanent
    // recipient guards protect against a duplicate even when Instantly did create it.
    const result = await addCampaignLeads(approved.id, [lead]);
    const created = Array.isArray(result && result.created_leads) ? result.created_leads : [];
    const createdLead = created.find((entry) => Number(entry && entry.index) === 0);
    if (Number(result && result.leads_uploaded) !== 1 || created.length !== 1 ||
        text(createdLead && createdLead.id) === '' || text(createdLead && createdLead.email).toLowerCase() !== text(lead.email).toLowerCase()) {
      throw createError('Instantly bevestigde niet exact één nieuwe lead; guards blijven staan.', 'INSTANTLY_AUTO_PROVIDER_PARTIAL_UPLOAD', 502);
    }

    const fresh = await loadRows();
    const freshRows = Array.isArray(fresh && fresh.rows) ? fresh.rows : [];
    const linkTarget = freshRows.find((row) =>
      text(row && row.instantlyManualUploadId) === uploadId &&
      text(row && (row.email || row.contactEmail)).toLowerCase() === text(lead.email).toLowerCase());
    // The provider already accepted the lead, so the permanent guards intentionally stay.
    // The local link is a small single-row upsert with retries, never a full replace.
    let linked = false;
    if (linkTarget) {
      const linkedRow = { ...linkTarget, instantlyLeadId: text(createdLead.id), instantlyStatus: 'synced',
        lastColdmailProviderStatus: 'synced', instantlyLastEventAt: at, updatedAt: at };
      for (let attempt = 0; attempt < 3 && !linked; attempt += 1) {
        try {
          linked = typeof persistSingleRow === 'function'
            ? Boolean(await persistSingleRow(linkedRow, { source: 'instantly-auto-upload-linked', actor, upsertOnly: true }))
            : Boolean(await persistRows(fresh, freshRows.map((row) => (row === linkTarget ? linkedRow : row)), { source: 'instantly-auto-upload-linked', actor }));
        } catch (_) {
          linked = false;
        }
      }
    }
    if (!linked) {
      throw createError('Instantly accepteerde de lead, maar de lokale lead-koppeling faalde; guards blijven staan.', 'INSTANTLY_AUTO_LOCAL_LINK_FAILED', 502);
    }

    return { ok: true, uploaded: 1, activated, owner, campaignId: approved.id, finishedAt: at };
  }

  return { run };
}

module.exports = { APPROVED_CAMPAIGNS, createInstantlyAutoUpload, formatDateKeyForTimeZone, isDesignedInstantlyRow };
