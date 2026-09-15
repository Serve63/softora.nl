const CONFIRMED_DELIVERY_STATUSES = new Set([
  'sent',
  'email_sent',
  'opened',
  'email_opened',
  'reply_received',
  'replied',
  'email_replied',
]);

const REQUIRED_OWNERS = Object.freeze(['serve', 'martijn']);
const MAX_REPLACEMENT_LEADS = 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeStatus(value) {
  const status = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (status === 'email_sent') return 'sent';
  if (status === 'email_opened') return 'opened';
  if (status === 'email_replied') return 'reply_received';
  return status;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(normalizeText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeReplacementCampaigns(value) {
  const source = parseJsonObject(value);
  const campaigns = {};
  REQUIRED_OWNERS.forEach((owner) => {
    const raw = source[owner];
    const campaignId = normalizeText(raw && typeof raw === 'object' ? raw.campaignId || raw.id : raw);
    if (campaignId) campaigns[owner] = campaignId;
  });
  return campaigns;
}

function getMissingReplacementCampaigns(campaigns = {}) {
  return REQUIRED_OWNERS.filter((owner) => !normalizeText(campaigns[owner]));
}

function isCustomerConfirmedSent(row) {
  if (!row || typeof row !== 'object') return false;
  if (normalizeText(row.instantlyEmailSentAt || row.lastInstantlySentAt || row.instantlySentAt)) return true;
  return CONFIRMED_DELIVERY_STATUSES.has(
    normalizeStatus(row.instantlyStatus || row.lastColdmailProviderStatus)
  );
}

function getRemoteLastContactAt(lead) {
  return normalizeText(
    lead &&
      (lead.timestamp_last_contact ||
        lead.last_step_timestamp_executed ||
        (lead.status_summary &&
          lead.status_summary.lastStep &&
          lead.status_summary.lastStep.timestamp_executed))
  );
}

function isRemoteLeadConfirmedSent(lead) {
  if (!lead || typeof lead !== 'object') return false;
  if (
    getRemoteLastContactAt(lead) ||
    normalizeText(lead.timestamp_last_open || lead.timestamp_last_reply) ||
    Number(lead.email_open_count || 0) > 0 ||
    Number(lead.email_reply_count || 0) > 0
  ) {
    return true;
  }
  const status = normalizeStatus(lead.status);
  return status && !/^-?\d+$/.test(status) && CONFIRMED_DELIVERY_STATUSES.has(status);
}

function getRemoteLeadId(lead) {
  return normalizeText(lead && (lead.id || lead.lead_id || lead.instantly_lead_id));
}

function getRemoteLeadEmail(lead) {
  const payload = lead && lead.payload && typeof lead.payload === 'object' ? lead.payload : {};
  return normalizeText(lead && (lead.email || lead.contact || lead.lead_email || payload.email)).toLowerCase();
}

function getRemoteUploadId(lead) {
  const payload = lead && lead.payload && typeof lead.payload === 'object'
    ? lead.payload
    : lead && lead.custom_variables && typeof lead.custom_variables === 'object'
      ? lead.custom_variables
      : {};
  return normalizeText(payload.softora_instantly_upload_id);
}

function getCreatedLeadIds(data) {
  const values = Array.isArray(data && data.created_leads)
    ? data.created_leads
    : Array.isArray(data && data.leads)
      ? data.leads
      : [];
  return Array.from(new Set(values.map(getRemoteLeadId).filter(Boolean)));
}

function assignCreatedLeadIds(data, assignments) {
  const created = Array.isArray(data && data.created_leads) ? data.created_leads : [];
  const byInputIndex = new Map();
  created.forEach((lead, fallbackIndex) => {
    const inputIndex = Number.isInteger(Number(lead && lead.index))
      ? Number(lead.index)
      : fallbackIndex;
    const id = getRemoteLeadId(lead);
    if (id) byInputIndex.set(inputIndex, id);
  });
  (assignments || []).forEach((assignment, index) => {
    assignment.leadId = byInputIndex.get(index) || '';
  });
  return (assignments || []).map((assignment) => assignment.leadId).filter(Boolean);
}

function getUploadedCount(data) {
  const count = Number(data && (data.leads_uploaded ?? data.uploaded ?? data.created));
  return Number.isFinite(count) ? Math.max(0, count) : getCreatedLeadIds(data).length;
}

function splitRequestedCount(total) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  return {
    serve: Math.ceil(count / 2),
    martijn: Math.floor(count / 2),
  };
}

function getLocalRowId(row, index) {
  return normalizeText(row && (row.id || row.customerId || row.databaseId)) || `row-${index}`;
}

function getLocalRowEmail(row) {
  return normalizeText(row && (row.email || row.contactEmail)).toLowerCase();
}

function buildHistoryEntry(row, entry) {
  const history = Array.isArray(row && row.hist) ? row.hist.filter(Boolean) : [];
  if (entry.messageKey && history.some((item) => normalizeText(item && item.messageKey) === entry.messageKey)) {
    return history;
  }
  return [entry, ...history].slice(0, 50);
}

function clearReplacedQueuedRows(rows, removedLeads, at, actor) {
  const leadIds = new Set((removedLeads || []).map(getRemoteLeadId).filter(Boolean));
  const emails = new Set((removedLeads || []).map(getRemoteLeadEmail).filter(Boolean));
  if (!leadIds.size && !emails.size) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    if (isCustomerConfirmedSent(row)) return row;
    const leadId = normalizeText(row && row.instantlyLeadId);
    const email = getLocalRowEmail(row);
    if (!(leadId && leadIds.has(leadId)) && !(email && emails.has(email))) return row;
    const wasIncorrectlyMailed = normalizeText(row.databaseStatus || row.status).toLowerCase() === 'gemaild';
    const nextStatus = wasIncorrectlyMailed
      ? normalizeText(row.instantlyPreviousStatus) || 'prospect'
      : row.status;
    const nextDatabaseStatus = wasIncorrectlyMailed
      ? normalizeText(row.instantlyPreviousDatabaseStatus) || nextStatus
      : row.databaseStatus;
    const messageKey = `instantly-replacement-removed:${leadId || email}:${at}`;
    return {
      ...row,
      status: nextStatus,
      databaseStatus: nextDatabaseStatus,
      instantlyLeadId: '',
      instantlyCampaignId: '',
      instantlyStatus: '',
      instantlySyncedAt: '',
      instantlyLastEventAt: '',
      instantlyManualUploadId: '',
      instantlyManualUploadPreparedAt: '',
      instantlySenderProfileKey: '',
      instantlySenderName: '',
      instantlySenderEmail: '',
      lastColdmailProvider: normalizeText(row.lastColdmailProvider).toLowerCase() === 'instantly' ? '' : row.lastColdmailProvider,
      lastColdmailProviderStatus: normalizeText(row.lastColdmailProvider).toLowerCase() === 'instantly' ? '' : row.lastColdmailProviderStatus,
      outreachStatus: wasIncorrectlyMailed ? '' : row.outreachStatus,
      coldmailCampaignStartedAt: wasIncorrectlyMailed ? '' : row.coldmailCampaignStartedAt,
      instantlyPreviousStatus: '',
      instantlyPreviousDatabaseStatus: '',
      instantlyRemovedAt: at,
      instantlyRemovedLeadId: leadId,
      instantlyRemovedReason: 'campaign_replacement',
      updatedAt: at,
      hist: buildHistoryEntry(row, {
        type: 'instantly_verwijderd',
        label: 'Niet-verstuurde Instantly-lead vervangen',
        date: at,
        actor,
        source: 'instantly-campaign-replacement',
        messageKey,
        subject: 'Instantly-lijst vervangen',
        preview: 'De nog niet verstuurde lead is uit Instantly verwijderd en teruggezet naar de mailklare voorraad.',
      }),
    };
  });
}

function markQueuedRows(rows, assignments, at, actor, uploadId) {
  const byIndex = new Map((assignments || []).map((item) => [item.index, item]));
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const assignment = byIndex.get(index);
    if (!assignment) return row;
    const sender = assignment.sender || {};
    const messageKey = `instantly-campaign-replacement:${uploadId}:${getLocalRowId(row, index)}`;
    return {
      ...row,
      instantlyLeadId: normalizeText(assignment.leadId),
      instantlyCampaignId: assignment.campaignId,
      instantlyStatus: 'synced',
      instantlySyncedAt: at,
      instantlyLastEventAt: at,
      instantlyManualUploadId: uploadId,
      instantlyManualUploadPreparedAt: at,
      instantlyPreviousStatus: normalizeText(row.status),
      instantlyPreviousDatabaseStatus: normalizeText(row.databaseStatus),
      instantlySenderProfileKey: assignment.owner,
      instantlySenderName: normalizeText(sender.name),
      instantlySenderEmail: normalizeText(sender.email).toLowerCase(),
      senderProfileKey: assignment.owner,
      senderEmail: normalizeText(sender.email).toLowerCase(),
      lastColdmailSenderEmail: normalizeText(sender.email).toLowerCase(),
      sentFromEmail: normalizeText(sender.email).toLowerCase(),
      sent_from_email: normalizeText(sender.email).toLowerCase(),
      outreachSentFromEmail: normalizeText(sender.email).toLowerCase(),
      outreach_sent_from_email: normalizeText(sender.email).toLowerCase(),
      replyMailboxAccount: normalizeText(sender.email).toLowerCase(),
      lastColdmailProvider: 'instantly',
      lastColdmailProviderStatus: 'synced',
      mail: true,
      updatedAt: at,
      hist: buildHistoryEntry(row, {
        type: 'instantly_klaargezet',
        label: 'Klaargezet voor Instantly',
        date: at,
        actor,
        source: 'instantly-campaign-replacement',
        messageKey,
        subject: 'Instantly-lijst vervangen',
        preview: 'De lead staat klaar in Instantly en wordt pas als verstuurd geteld na een bevestigd verzendevent.',
      }),
    };
  });
}

function applyRemoteDeliveryUpdates(rows, remoteLeads, at, actor) {
  const byId = new Map();
  const byEmail = new Map();
  (remoteLeads || []).filter(isRemoteLeadConfirmedSent).forEach((lead) => {
    const id = getRemoteLeadId(lead);
    const email = getRemoteLeadEmail(lead);
    if (id) byId.set(id, lead);
    if (email) byEmail.set(email, lead);
  });
  let updated = 0;
  const nextRows = (Array.isArray(rows) ? rows : []).map((row, index) => {
    if (isCustomerConfirmedSent(row)) return row;
    const remote = byId.get(normalizeText(row.instantlyLeadId)) || byEmail.get(getLocalRowEmail(row));
    if (!remote) return row;
    updated += 1;
    const sentAt = getRemoteLastContactAt(remote) || normalizeText(remote.timestamp_last_open || remote.timestamp_last_reply) || at;
    const remoteStatus = normalizeStatus(remote.status);
    const status = Number(remote.email_reply_count || 0) > 0 || normalizeText(remote.timestamp_last_reply)
      ? 'reply_received'
      : Number(remote.email_open_count || 0) > 0 || normalizeText(remote.timestamp_last_open)
        ? 'opened'
        : CONFIRMED_DELIVERY_STATUSES.has(remoteStatus) ? normalizeStatus(remoteStatus) : 'sent';
    const messageKey = `instantly-delivery-reconcile:${getRemoteLeadId(remote) || getLocalRowId(row, index)}:${sentAt}`;
    return {
      ...row,
      status: normalizeText(row.databaseStatus || row.status).toLowerCase() === 'prospect' || normalizeText(row.databaseStatus || row.status).toLowerCase() === 'benaderbaar' ? 'gemaild' : row.status,
      databaseStatus: normalizeText(row.databaseStatus || row.status).toLowerCase() === 'prospect' || normalizeText(row.databaseStatus || row.status).toLowerCase() === 'benaderbaar' ? 'gemaild' : row.databaseStatus,
      instantlyStatus: status,
      instantlyEmailSentAt: normalizeText(row.instantlyEmailSentAt) || sentAt,
      instantlyLastEventAt: at,
      lastMailSentAt: normalizeText(row.lastMailSentAt) || sentAt,
      lastColdmailSentAt: normalizeText(row.lastColdmailSentAt) || sentAt,
      lastColdmailProvider: 'instantly',
      lastColdmailProviderStatus: status,
      outreachStatus: normalizeText(row.outreachStatus) || 'benaderd',
      coldmailCampaignStartedAt: normalizeText(row.coldmailCampaignStartedAt) || sentAt,
      campaignType: normalizeText(row.campaignType) || 'webdesign',
      campaign_type: normalizeText(row.campaign_type) || 'webdesign',
      outreachCampaignType: normalizeText(row.outreachCampaignType) || 'webdesign',
      outreach_campaign_type: normalizeText(row.outreach_campaign_type) || 'webdesign',
      updatedAt: at,
      hist: buildHistoryEntry(row, {
        type: 'gemaild',
        label: 'Verstuurd via Instantly',
        date: sentAt,
        actor,
        source: 'instantly-delivery-reconcile',
        messageKey,
        subject: 'Instantly verzendbevestiging',
        preview: 'Instantly heeft bevestigd dat de campagne deze lead heeft gemaild.',
      }),
    };
  });
  return { rows: nextRows, updated };
}

function createInstantlyCampaignReplacement(deps = {}) {
  const {
    campaigns = {},
    now = () => new Date(),
    loadRows,
    persistRows,
    persistSingleRow,
    collectEligibleRows,
    buildLead,
    loadContext,
    resolveSender,
    reserveRows,
    releaseReservation,
    confirmReservation,
    saveLegacyGuards,
    listCampaignLeads,
    getCampaign,
    pauseCampaign,
    addCampaignLeads,
    deleteCampaignLeads,
    activateCampaign,
    createError = (message, code, status = 400, extra = {}) => Object.assign(new Error(message), { code, status, ...extra }),
  } = deps;

  async function rollbackCreated(groups, uploadId) {
    for (const group of groups) {
      let ids = group.createdIds || [];
      if (!ids.length && typeof listCampaignLeads === 'function') {
        const remote = await listCampaignLeads(group.campaignId, 10000).catch(() => []);
        ids = remote.filter((lead) => getRemoteUploadId(lead) === uploadId).map(getRemoteLeadId).filter(Boolean);
      }
      if (ids.length) await deleteCampaignLeads(group.campaignId, ids).catch(() => null);
    }
  }

  async function replace(input = {}) {
    const missingCampaigns = getMissingReplacementCampaigns(campaigns);
    if (missingCampaigns.length) {
      throw createError('De Instantly-campagnes van Servé en Martijn zijn nog niet volledig gekoppeld.', 'INSTANTLY_REPLACEMENT_CAMPAIGNS_MISSING', 503, { missing: missingCampaigns });
    }
    const requested = Math.floor(Number(input.limit));
    if (!Number.isFinite(requested) || requested < 1 || requested > MAX_REPLACEMENT_LEADS) {
      throw createError(`Kies een aantal tussen 1 en ${MAX_REPLACEMENT_LEADS}.`, 'INSTANTLY_REPLACEMENT_LIMIT_INVALID', 400);
    }
    const actor = normalizeText(input.actor) || 'Instantly-lijst vervangen';
    const at = now().toISOString();
    const uploadId = normalizeText(input.uploadId) || `instantly-replace-${at.replace(/[^0-9a-z]+/gi, '').slice(0, 15)}`;
    const loaded = await loadRows();
    const rows = Array.isArray(loaded && loaded.rows) ? loaded.rows : [];
    const owners = splitRequestedCount(requested);
    const senderByOwner = Object.fromEntries(REQUIRED_OWNERS.map((owner) => [owner, resolveSender(owner)]));
    const selectionContext = await loadContext(rows, senderByOwner.serve, input);
    const selected = await collectEligibleRows(rows, requested, selectionContext);
    const selectedRows = Array.isArray(selected && selected.selectedRows) ? selected.selectedRows : [];
    if (selectedRows.length < requested) {
      return { ok: true, skipped: true, reason: 'insufficient_eligible_leads', requested, available: selectedRows.length, failed: selected && selected.failed || [], finishedAt: at };
    }

    const assignments = [];
    let offset = 0;
    for (const owner of REQUIRED_OWNERS) {
      const count = owners[owner];
      const sender = senderByOwner[owner];
      const context = owner === 'serve' ? selectionContext : await loadContext(rows, sender, input);
      for (const item of selectedRows.slice(offset, offset + count)) {
        const lead = await buildLead(item, context);
        lead.custom_variables = { ...(lead.custom_variables || {}), softora_instantly_upload_id: uploadId };
        assignments.push({ ...item, owner, sender, campaignId: campaigns[owner], lead });
      }
      offset += count;
    }

    const reservation = await reserveRows(selectedRows, { actor, uploadId, provisional: true });
    if (!reservation || reservation.ok !== true) {
      return { ok: true, skipped: true, reason: 'central_outbound_guard_conflict', requested, available: 0, finishedAt: at };
    }

    const oldByCampaign = new Map();
    const uploadedGroups = [];
    const pausedActiveCampaigns = new Set();
    let localPersisted = false;
    let confirmationAttempted = false;
    try {
      for (const owner of REQUIRED_OWNERS) {
        const campaignId = campaigns[owner];
        const campaign = await getCampaign(campaignId);
        const status = Number(campaign && campaign.status);
        if (status === 1 || status === 4) {
          await pauseCampaign(campaignId);
          pausedActiveCampaigns.add(campaignId);
        }
        const remote = await listCampaignLeads(campaignId, 10000);
        oldByCampaign.set(campaignId, remote.filter((lead) => !isRemoteLeadConfirmedSent(lead)));
      }

      for (const owner of REQUIRED_OWNERS) {
        const campaignId = campaigns[owner];
        const groupAssignments = assignments.filter((item) => item.owner === owner);
        if (!groupAssignments.length) continue;
        const data = await addCampaignLeads(campaignId, groupAssignments.map((item) => item.lead));
        const createdIds = assignCreatedLeadIds(data, groupAssignments);
        const uploaded = getUploadedCount(data);
        uploadedGroups.push({ owner, campaignId, assignments: groupAssignments, createdIds, data });
        if (uploaded !== groupAssignments.length || createdIds.length !== groupAssignments.length) {
          throw createError('Instantly accepteerde niet exact het gevraagde aantal; de nieuwe upload is teruggedraaid.', 'INSTANTLY_REPLACEMENT_PARTIAL_UPLOAD', 502, { requested: groupAssignments.length, uploaded });
        }
      }

      // Persist the newly uploaded leads before deleting the previous waiting list.
      // If the final cleanup is interrupted, Softora still has a complete record
      // of every lead that can exist in either campaign and both campaigns stay paused.
      const nextRows = markQueuedRows(rows, assignments, at, actor, uploadId);
      const persisted = await persistRows(loaded, nextRows, { source: 'instantly-campaign-replacement', actor });
      if (!persisted) throw createError('De nieuwe Instantly-lijst kon niet in Softora worden vastgezet.', 'INSTANTLY_REPLACEMENT_PERSIST_FAILED', 502);
      localPersisted = true;

      const leadIdByEmail = new Map(assignments.map((item) => [getLocalRowEmail(item.row), item.leadId]));
      await saveLegacyGuards(assignments, { at, actor, uploadId, leadIdByEmail, source: 'instantly-campaign-replacement' });
      confirmationAttempted = true;
      const confirmed = await confirmReservation(reservation.reservationId, { status: 'queued', permanent: true, at, payload: { uploadId, requested, campaigns } });
      if (!confirmed || confirmed.ok !== true) throw createError('De centrale Instantly-reservering kon niet definitief worden bevestigd.', 'INSTANTLY_REPLACEMENT_GUARD_CONFIRM_FAILED', 502);

      const remainingOldByCampaign = new Map();
      const deletionErrors = [];
      for (const owner of REQUIRED_OWNERS) {
        const campaignId = campaigns[owner];
        const oldLeads = oldByCampaign.get(campaignId) || [];
        const oldIds = oldLeads.map(getRemoteLeadId).filter(Boolean);
        if (oldIds.length) {
          try {
            const deleted = await deleteCampaignLeads(campaignId, oldIds);
            const deletedCount = Math.max(0, Number(deleted && deleted.count) || 0);
            if (deletedCount !== oldIds.length) {
              deletionErrors.push({ owner, requested: oldIds.length, deleted: deletedCount });
            }
          } catch (error) {
            deletionErrors.push({ owner, requested: oldIds.length, deleted: 0, message: normalizeText(error && error.message) });
          }
        }
        try {
          const remoteAfterDelete = await listCampaignLeads(campaignId, 10000);
          const remainingIds = new Set(remoteAfterDelete.map(getRemoteLeadId).filter(Boolean));
          remainingOldByCampaign.set(campaignId, oldLeads.filter((lead) => remainingIds.has(getRemoteLeadId(lead))));
        } catch (error) {
          remainingOldByCampaign.set(campaignId, oldLeads);
          deletionErrors.push({ owner, requested: oldIds.length, deleted: 0, message: normalizeText(error && error.message) || 'Controle na verwijdering mislukt.' });
        }
      }

      const oldLeads = Array.from(oldByCampaign.values()).flat();
      const remainingOldIds = new Set(
        Array.from(remainingOldByCampaign.values()).flat().map(getRemoteLeadId).filter(Boolean)
      );
      const removedLeads = oldLeads.filter((lead) => !remainingOldIds.has(getRemoteLeadId(lead)));
      const finalRows = clearReplacedQueuedRows(nextRows, removedLeads, at, actor);
      let finalPersisted = true;
      if (removedLeads.length) {
        finalPersisted = Boolean(await persistRows(loaded, finalRows, { source: 'instantly-campaign-replacement-cleanup', actor }));
      }
      const remainingQueued = Array.from(remainingOldByCampaign.values()).reduce((sum, leads) => sum + leads.length, 0);
      if (deletionErrors.length || remainingQueued > 0 || !finalPersisted) {
        return {
          ok: false,
          code: !finalPersisted ? 'INSTANTLY_REPLACEMENT_LOCAL_CLEANUP_FAILED' : 'INSTANTLY_REPLACEMENT_PARTIAL_DELETE',
          message: !finalPersisted
            ? 'Instantly is veilig bijgewerkt, maar Softora kon de verwijderde wachtlijst nog niet volledig verwerken; de campagnes blijven gepauzeerd.'
            : 'De nieuwe leads staan veilig klaar, maar de oude Instantly-wachtlijst is nog niet volledig verwijderd; de campagnes blijven gepauzeerd.',
          requested,
          replacedQueued: removedLeads.length,
          remainingQueued,
          uploaded: assignments.length,
          distribution: owners,
          campaigns,
          activated: false,
          campaignsPaused: true,
          deletionErrors,
          uploadId,
          finishedAt: at,
        };
      }

      const activationErrors = [];
      for (const owner of REQUIRED_OWNERS) {
        try { await activateCampaign(campaigns[owner]); } catch (error) { activationErrors.push({ owner, message: normalizeText(error && error.message) }); }
      }
      return {
        ok: activationErrors.length === 0,
        code: activationErrors.length ? 'INSTANTLY_REPLACEMENT_ACTIVATION_FAILED' : undefined,
        message: activationErrors.length ? 'De leads staan veilig klaar, maar niet alle campagnes konden automatisch starten.' : undefined,
        requested,
        replacedQueued: removedLeads.length,
        uploaded: assignments.length,
        distribution: owners,
        campaigns,
        activated: activationErrors.length === 0,
        activationErrors,
        uploadId,
        finishedAt: at,
      };
    } catch (error) {
      if (confirmationAttempted) {
        // The confirmation response can be lost after Supabase committed it.
        // Keep the fully recorded upload and leave campaigns paused rather than
        // deleting remote leads while a permanent central guard may already exist.
        throw error;
      }
      await rollbackCreated(uploadedGroups, uploadId);
      await releaseReservation(reservation.reservationId).catch(() => null);
      if (localPersisted) {
        await persistRows(loaded, rows, { source: 'instantly-campaign-replacement-rollback', actor }).catch(() => null);
      }
      for (const campaignId of pausedActiveCampaigns) {
        await activateCampaign(campaignId).catch(() => null);
      }
      throw error;
    }
  }

  async function refreshDeliveryStatus(input = {}) {
    const missingCampaigns = getMissingReplacementCampaigns(campaigns);
    if (missingCampaigns.length) return { ok: true, skipped: true, reason: 'replacement_campaigns_missing', updated: 0 };
    const actor = normalizeText(input.actor) || 'Instantly verzendstatus';
    const at = now().toISOString();
    const loaded = await loadRows();
    const remoteLeads = [];
    for (const owner of REQUIRED_OWNERS) {
      remoteLeads.push(...await listCampaignLeads(campaigns[owner], 10000));
    }
    const result = applyRemoteDeliveryUpdates(loaded.rows, remoteLeads, at, actor);
    if (result.updated) {
      const changes = result.rows.filter((row, index) => row !== loaded.rows[index]);
      if (typeof persistSingleRow === 'function') {
        for (const row of changes) {
          const saved = await persistSingleRow(row, { source: 'instantly-delivery-reconcile', actor, upsertOnly: true });
          if (!saved) throw createError('Instantly verzendstatus kon niet duurzaam worden bewaard.',
            'INSTANTLY_DELIVERY_PERSIST_FAILED', 502);
        }
      } else if (!(await persistRows(loaded, result.rows, { source: 'instantly-delivery-reconcile', actor }))) {
        throw createError('Instantly verzendstatus kon niet duurzaam worden bewaard.',
          'INSTANTLY_DELIVERY_PERSIST_FAILED', 502);
      }
    }
    return { ok: true, updated: result.updated, checked: remoteLeads.length, finishedAt: at };
  }

  return { refreshDeliveryStatus, replace };
}

module.exports = {
  MAX_REPLACEMENT_LEADS,
  applyRemoteDeliveryUpdates,
  createInstantlyCampaignReplacement,
  getMissingReplacementCampaigns,
  isCustomerConfirmedSent,
  isRemoteLeadConfirmedSent,
  normalizeReplacementCampaigns,
  splitRequestedCount,
};
