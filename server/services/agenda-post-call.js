const { normalizeLeadLikePhoneKey } = require('./lead-identity');
const { readChunkedStateValue } = require('./data-ops-serialization');

function normalizeCustomerSearchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCustomerDatabaseRows(rawValue) {
  if (Array.isArray(rawValue)) return rawValue.filter((item) => item && typeof item === 'object');
  try {
    const parsed = JSON.parse(String(rawValue || '[]'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

function getAppointmentPhoneKey(appointment) {
  return (
    normalizeLeadLikePhoneKey(appointment?.phone || '') ||
    normalizeLeadLikePhoneKey(appointment?.telefoon || '') ||
    normalizeLeadLikePhoneKey(appointment?.contactPhone || '')
  );
}

function getCustomerPhoneKey(row) {
  return (
    normalizeLeadLikePhoneKey(row?.phoneE164 || '') ||
    normalizeLeadLikePhoneKey(row?.phone || '') ||
    normalizeLeadLikePhoneKey(row?.tel || '') ||
    normalizeLeadLikePhoneKey(row?.telefoon || '') ||
    normalizeLeadLikePhoneKey(row?.contactPhone || '')
  );
}

function getAppointmentCompanyKey(appointment) {
  return normalizeCustomerSearchText(appointment?.company || appointment?.bedrijf || appointment?.contact || '');
}

function getCustomerCompanyKey(row) {
  return normalizeCustomerSearchText(row?.bedrijf || row?.company || row?.companyName || row?.naam || row?.name || '');
}

function findCustomerDatabaseRowIndexForAppointment(rows, appointment) {
  const phoneKey = getAppointmentPhoneKey(appointment);
  if (phoneKey) {
    const phoneIndex = rows.findIndex((row) => getCustomerPhoneKey(row) === phoneKey);
    if (phoneIndex >= 0) return phoneIndex;
  }

  const companyKey = getAppointmentCompanyKey(appointment);
  if (companyKey) {
    const companyIndex = rows.findIndex((row) => getCustomerCompanyKey(row) === companyKey);
    if (companyIndex >= 0) return companyIndex;
  }

  return -1;
}

function normalizeLifecycleDatabaseStatus(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'klant' || key === 'customer') return 'klant';
  if (key === 'afgehaakt' || key === 'geendeal' || key === 'nodeal' || key === 'lost') {
    return 'afgehaakt';
  }
  return '';
}

function getLifecycleDatabaseStatusLabel(status) {
  if (status === 'klant') return 'Klant geworden';
  if (status === 'afgehaakt') return 'Afgehaakt na afspraak';
  return 'Status bijgewerkt';
}

function inferAppointmentService(appointment) {
  const hay = `${appointment?.branche || ''} ${appointment?.summary || ''}`.toLowerCase();
  if (/bedrijfssoftware|business/.test(hay)) return 'bedrijfssoftware';
  if (/voicesoftware|voice|belsoftware/.test(hay)) return 'voicesoftware';
  if (/chatbot|chatbots/.test(hay)) return 'chatbot';
  return 'website';
}

function buildCustomerDatabaseRowForLifecycleStatus(row, appointment, status, actor) {
  const nowIso = new Date().toISOString();
  const company = String(row?.bedrijf || row?.company || row?.companyName || appointment?.company || '').trim();
  const contact = String(row?.naam || row?.contact || row?.contactName || appointment?.contact || company).trim();
  const phone = String(
    row?.telefoon || row?.tel || row?.phone || row?.contactPhone || appointment?.phone || appointment?.telefoon || ''
  ).trim();
  const history = Array.isArray(row?.hist) ? row.hist.filter(Boolean) : [];
  const historyEntry = {
    type: status,
    label: getLifecycleDatabaseStatusLabel(status),
    date: nowIso,
    actor: String(actor || '').trim(),
  };

  return {
    ...row,
    id: String(row?.id || `customer-${Date.now().toString(36)}`).trim(),
    naam: contact || company || 'Onbekend',
    bedrijf: company || contact || 'Onbekend bedrijf',
    tel: phone || row?.tel || row?.telefoon || '',
    telefoon: phone || row?.telefoon || row?.tel || '',
    email: String(row?.email || row?.contactEmail || appointment?.contactEmail || appointment?.email || '').trim(),
    stad: String(row?.stad || row?.location || row?.address || appointment?.location || '').trim(),
    branche: String(row?.branche || appointment?.branche || '').trim(),
    website: String(row?.website || row?.dom || appointment?.domainName || appointment?.postCallDomainName || '').trim(),
    service: String(row?.service || inferAppointmentService(appointment)).trim(),
    databaseStatus: status,
    updatedAt: nowIso,
    hist: history.concat(historyEntry).slice(-20),
  };
}

function createAgendaPostCallHelpers(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    sanitizeLaunchDomainName = (value) => String(value || '').trim(),
    sanitizeReferenceImages = () => [],
    sanitizePostCallText = (value) => String(value || '').trim(),
    normalizePostCallStatus = (value) => String(value || '').trim(),
  } = deps;

  function buildPostCallPayload(body = {}) {
    return {
      postCallStatus: normalizePostCallStatus(body.status || body.postCallStatus),
      postCallNotesTranscript: sanitizePostCallText(
        body.transcript || body.postCallNotesTranscript || body.voiceTranscript,
        25000
      ),
      postCallPrompt: sanitizePostCallText(
        body.prompt || body.postCallPrompt || body.generatedPrompt,
        25000
      ),
      postCallDomainName: sanitizeLaunchDomainName(
        body.domainName || body.domain || body.postCallDomainName || ''
      ),
      referenceImages: sanitizeReferenceImages(body.referenceImages || body.attachments || []),
      postCallUpdatedBy: truncateText(normalizeString(body.actor || body.doneBy || ''), 120),
    };
  }

  function normalizeActiveOrderStatusKey(value) {
    const key = normalizeString(value || '').toLowerCase();
    if (key === 'actief') return 'actief';
    if (key === 'bezig') return 'bezig';
    if (key === 'klaar') return 'klaar';
    return 'wacht';
  }

  function parseAmountFromEuroLabel(value) {
    const raw = normalizeString(value || '');
    if (!raw) return null;
    const digitsOnly = raw.replace(/[^\d]/g, '');
    const amount = Number(digitsOnly);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(amount);
  }

  function parseCustomOrdersFromUiState(rawValue) {
    const raw = normalizeString(rawValue || '');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const id = Number(item.id);
          const amount = Math.round(Number(item.amount));
          const clientName = truncateText(normalizeString(item.clientName || ''), 160);
          const location = truncateText(normalizeString(item.location || ''), 160);
          const companyName = truncateText(normalizeString(item.companyName || ''), 160);
          const contactName = truncateText(normalizeString(item.contactName || ''), 160);
          const contactPhone = truncateText(normalizeString(item.contactPhone || item.phone || ''), 80);
          const contactEmail = truncateText(normalizeString(item.contactEmail || item.email || ''), 160);
          const title = truncateText(normalizeString(item.title || ''), 200);
          const description = truncateText(normalizeString(item.description || ''), 3000);
          if (!Number.isFinite(id) || id <= 0) return null;
          if ((!clientName && !companyName) || !title || !description) return null;
          if (!Number.isFinite(amount) || amount <= 0) return null;

          return {
            ...item,
            id,
            clientName,
            location,
            companyName,
            contactName,
            contactPhone,
            contactEmail,
            title,
            description,
            amount,
            domainName: sanitizeLaunchDomainName(item.domainName || item.domain || ''),
            status: normalizeActiveOrderStatusKey(item.status),
            sourceAppointmentId: Number(item.sourceAppointmentId) || null,
            sourceCallId: normalizeString(item.sourceCallId || '') || null,
            referenceImages: sanitizeReferenceImages(item.referenceImages || item.attachments || []),
            prompt: sanitizePostCallText(item.prompt || '', 25000),
            transcript: sanitizePostCallText(item.transcript || '', 25000),
            createdAt: normalizeString(item.createdAt || '') || null,
            updatedAt: normalizeString(item.updatedAt || '') || null,
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function getNextCustomOrderId(customOrders) {
    const maxId = (Array.isArray(customOrders) ? customOrders : [])
      .map((item) => Number(item?.id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .reduce((max, id) => (id > max ? id : max), 0);
    return maxId + 1;
  }

  function buildActiveOrderDescriptionFromAppointment(appointment, transcript, prompt) {
    const summary = normalizeString(appointment?.summary || '');
    if (summary) return truncateText(summary, 1000);
    if (transcript) return truncateText(transcript, 1000);
    if (prompt) return truncateText(prompt, 1000);
    return 'Nieuwe website-opdracht op basis van intakegesprek.';
  }

  function buildActiveOrderRecordFromAppointment(appointment, input = {}, nextId = 1) {
    const resolvedContactPhone =
      appointment?.phone || appointment?.telefoon || appointment?.contactPhone || '';
    const company = truncateText(normalizeString(appointment?.company || ''), 160) || 'Nieuwe lead';
    const contact = truncateText(normalizeString(appointment?.contact || ''), 160);
    const contactPhone = truncateText(normalizeString(resolvedContactPhone), 80);
    const contactEmail = truncateText(
      normalizeString(appointment?.contactEmail || appointment?.email || ''),
      160
    );
    const claimedBy =
      truncateText(
        normalizeString(appointment?.leadOwnerName || appointment?.leadOwnerFullName || ''),
        80
      ) || null;
    const prompt = sanitizePostCallText(input.prompt || appointment?.postCallPrompt || '', 25000);
    const transcript = sanitizePostCallText(
      input.transcript || appointment?.postCallNotesTranscript || '',
      25000
    );
    const title =
      truncateText(normalizeString(input.title || ''), 200) ||
      `Website opdracht voor ${company}`;
    const description =
      truncateText(normalizeString(input.description || ''), 3000) ||
      buildActiveOrderDescriptionFromAppointment(appointment, transcript, prompt);
    const amountCandidate = Math.round(Number(input.amount));
    const amount =
      (Number.isFinite(amountCandidate) && amountCandidate > 0
        ? amountCandidate
        : parseAmountFromEuroLabel(appointment?.value || '')) || 2500;
    const domainName = sanitizeLaunchDomainName(
      input.domainName || input.domain || appointment?.postCallDomainName || appointment?.domainName || ''
    );
    const referenceImages = sanitizeReferenceImages(
      input.referenceImages || input.attachments || appointment?.referenceImages || []
    );

    return {
      id: Number(nextId) || 1,
      clientName: company,
      location: truncateText(normalizeString(input.location || appointment?.location || contact || ''), 160),
      companyName: company,
      contactName: contact,
      contactPhone,
      contactEmail,
      title,
      description,
      amount,
      domainName,
      status: normalizeActiveOrderStatusKey(input.status || 'wacht'),
      source: normalizeString(appointment?.source || '') || 'agenda_post_call_prompt',
      sourceAppointmentId: Number(appointment?.id) || null,
      sourceCallId: normalizeString(appointment?.callId || '') || null,
      sourceAppointmentDate: truncateText(normalizeString(appointment?.date || ''), 10) || null,
      sourceAppointmentTime: truncateText(normalizeString(appointment?.time || ''), 5) || null,
      branche: truncateText(normalizeString(appointment?.branche || ''), 160) || null,
      provider: truncateText(normalizeString(appointment?.providerLabel || appointment?.provider || ''), 160) || null,
      claimedBy,
      contact,
      referenceImages,
      prompt,
      transcript,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    buildPostCallPayload,
    buildActiveOrderRecordFromAppointment,
    getNextCustomOrderId,
    parseCustomOrdersFromUiState,
  };
}

function createAgendaPostCallCoordinator(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    sanitizeLaunchDomainName = (value) => String(value || '').trim(),
    sanitizeReferenceImages = () => [],
    sanitizePostCallText = (value) => String(value || '').trim(),
    normalizePostCallStatus = (value) => String(value || '').trim(),
    getGeneratedAppointmentIndexById = () => -1,
    getGeneratedAgendaAppointments = () => [],
    setGeneratedAgendaAppointmentAtIndex = () => null,
    upsertGeneratedAgendaAppointment = () => null,
    appendDashboardActivity = () => {},
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    premiumActiveOrdersScope = 'premium_active_orders',
    premiumActiveCustomOrdersKey = 'softora_custom_orders_premium_v1',
    premiumCustomersScope = 'premium_customers_database',
    premiumCustomersKey = 'softora_customers_premium_v1',
    logger = console,
    helpers = null,
  } = deps;

  const resolvedHelpers =
    helpers ||
    createAgendaPostCallHelpers({
      normalizeString,
      truncateText,
      sanitizeLaunchDomainName,
      sanitizeReferenceImages,
      sanitizePostCallText,
      normalizePostCallStatus,
    });

  const {
    buildPostCallPayload,
    buildActiveOrderRecordFromAppointment,
    getNextCustomOrderId,
    parseCustomOrdersFromUiState,
  } = resolvedHelpers;

  function buildFollowUpLeadCallId(appointment) {
    const existing = normalizeString(
      appointment?.leadFollowUpCallId || appointment?.leadFollowUpSourceCallId || ''
    );
    if (existing) return existing;
    const appointmentId = Number(appointment?.id || 0);
    if (Number.isFinite(appointmentId) && appointmentId > 0) {
      return `appointment-follow-up:${appointmentId}`;
    }
    const fallbackCallId = normalizeString(appointment?.callId || '');
    return fallbackCallId ? `appointment-follow-up:${fallbackCallId}` : '';
  }

  function findExistingFollowUpLeadTaskIndex(appointment, followUpCallId) {
    const sourceAppointmentId = Number(appointment?.id || 0);
    const existingFollowUpId = Number(appointment?.leadFollowUpAppointmentId || 0);
    return getGeneratedAgendaAppointments().findIndex((item) => {
      if (!item || typeof item !== 'object') return false;
      const itemId = Number(item?.id || 0);
      const itemCallId = normalizeString(item?.callId || '');
      const itemSourceAppointmentId = Number(item?.leadFollowUpSourceAppointmentId || 0);
      if (followUpCallId && itemCallId === followUpCallId) return true;
      if (existingFollowUpId > 0 && itemId === existingFollowUpId) return true;
      if (sourceAppointmentId > 0 && itemSourceAppointmentId === sourceAppointmentId) return true;
      return false;
    });
  }

  function buildFollowUpLeadAppointmentFromAppointment(appointment, input = {}, followUpCallId) {
    const nowIso = new Date().toISOString();
    const transcript = sanitizePostCallText(
      input.transcript || appointment?.postCallNotesTranscript || '',
      25000
    );
    const prompt = sanitizePostCallText(
      input.prompt || appointment?.postCallPrompt || '',
      25000
    );
    const domainName = sanitizeLaunchDomainName(
      input.domainName || input.domain || appointment?.postCallDomainName || appointment?.domainName || ''
    );
    const referenceImages = sanitizeReferenceImages(
      input.referenceImages || input.attachments || appointment?.referenceImages || []
    );
    const summary =
      truncateText(
        normalizeString(
          input.summary ||
            appointment?.summary ||
            appointment?.postCallNotesTranscript ||
            'Lead wil verder in het traject.'
        ),
        4000
      ) || 'Lead wil verder in het traject.';

    return {
      company: truncateText(normalizeString(appointment?.company || ''), 160) || 'Nieuwe lead',
      contact: truncateText(normalizeString(appointment?.contact || ''), 160) || 'Onbekend',
      phone: truncateText(
        normalizeString(appointment?.phone || appointment?.telefoon || appointment?.contactPhone || ''),
        80
      ),
      contactEmail: truncateText(
        normalizeString(appointment?.contactEmail || appointment?.email || ''),
        160
      ),
      type: normalizeString(appointment?.type || 'meeting') || 'meeting',
      date: truncateText(normalizeString(appointment?.date || ''), 10) || '',
      time: truncateText(normalizeString(appointment?.time || ''), 5) || '09:00',
      value: truncateText(normalizeString(appointment?.value || ''), 80) || '',
      branche: truncateText(normalizeString(appointment?.branche || ''), 160) || 'Onbekend',
      source:
        truncateText(
          normalizeString(input.source || appointment?.source || 'Agenda vervolg na meeting'),
          200
        ) || 'Agenda vervolg na meeting',
      summary,
      leadConversationSummary: summary,
      aiGenerated: false,
      callId: followUpCallId,
      createdAt:
        normalizeString(appointment?.leadFollowUpAddedAt || appointment?.createdAt || '') || nowIso,
      needsConfirmationEmail: false,
      confirmationTaskType: 'lead_follow_up',
      provider: truncateText(normalizeString(appointment?.provider || ''), 80) || '',
      providerLabel: truncateText(normalizeString(appointment?.providerLabel || ''), 120) || '',
      coldcallingStack: truncateText(normalizeString(appointment?.coldcallingStack || ''), 120) || '',
      coldcallingStackLabel:
        truncateText(
          normalizeString(appointment?.coldcallingStackLabel || appointment?.providerLabel || ''),
          120
        ) || '',
      location: truncateText(
        normalizeString(input.location || appointment?.location || appointment?.appointmentLocation || ''),
        220
      ),
      durationSeconds: Number(appointment?.durationSeconds || 0) || 0,
      whatsappConfirmed: Boolean(appointment?.whatsappConfirmed),
      whatsappInfo: truncateText(
        normalizeString(appointment?.whatsappInfo || appointment?.whatsappNotes || ''),
        4000
      ),
      recordingUrl: truncateText(normalizeString(appointment?.recordingUrl || ''), 4000),
      postCallStatus:
        normalizePostCallStatus(input.status || appointment?.postCallStatus || 'bezig') || 'bezig',
      postCallNotesTranscript: transcript,
      postCallPrompt: prompt,
      postCallDomainName: domainName,
      postCallUpdatedAt: nowIso,
      postCallUpdatedBy: truncateText(normalizeString(input.actor || input.doneBy || ''), 120) || null,
      referenceImages,
      leadFollowUpSourceAppointmentId: Number(appointment?.id || 0) || null,
      leadFollowUpSourceCallId: normalizeString(appointment?.callId || '') || null,
      leadOwnerKey: truncateText(normalizeString(appointment?.leadOwnerKey || ''), 80) || '',
      leadOwnerName: truncateText(normalizeString(appointment?.leadOwnerName || ''), 120) || '',
      leadOwnerFullName:
        truncateText(
          normalizeString(appointment?.leadOwnerFullName || appointment?.leadOwnerName || ''),
          160
        ) || '',
      leadOwnerUserId: truncateText(normalizeString(appointment?.leadOwnerUserId || ''), 120) || '',
      leadOwnerEmail: truncateText(normalizeString(appointment?.leadOwnerEmail || ''), 160) || '',
    };
  }

  function isLeadFollowUpStatus(value) {
    const key = normalizeString(value || '').toLowerCase().replace(/[\s-]+/g, '_');
    return key === 'lead_follow_up' || key === 'follow_up' || key === 'vervolg';
  }

  async function syncPremiumCustomerDatabaseStatusFromAppointment(appointment, lifecycleStatus, actor) {
    const status = normalizeLifecycleDatabaseStatus(lifecycleStatus);
    if (!status || !appointment || typeof appointment !== 'object') {
      return { ok: false, skipped: true, reason: 'invalid_input' };
    }

    try {
      const currentState = await getUiStateValues(premiumCustomersScope);
      const currentValues =
        currentState && currentState.values && typeof currentState.values === 'object'
          ? currentState.values
          : {};
      const rows = parseCustomerDatabaseRows(readChunkedStateValue(currentValues, premiumCustomersKey));
      const rowIndex = findCustomerDatabaseRowIndexForAppointment(rows, appointment);

      const nextRows = rows.slice();
      const currentRow = rowIndex >= 0 ? rows[rowIndex] : {};
      const nextRow = buildCustomerDatabaseRowForLifecycleStatus(
        currentRow,
        appointment,
        status,
        actor
      );

      if (rowIndex >= 0) {
        nextRows[rowIndex] = nextRow;
      } else {
        nextRows.push(nextRow);
      }

      const nextValues = {
        ...currentValues,
        [premiumCustomersKey]: JSON.stringify(nextRows),
      };
      const saved = await setUiStateValues(premiumCustomersScope, nextValues, {
        source: 'premium-personeel-agenda',
        actor,
      });

      if (!saved) {
        return { ok: false, skipped: false, reason: 'save_failed', status };
      }

      return {
        ok: true,
        skipped: false,
        status,
        matchedExisting: rowIndex >= 0,
        customerCount: nextRows.length,
      };
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error('[Agenda][CustomerDatabaseStatusSyncError]', error?.message || error);
      }
      return { ok: false, skipped: false, reason: 'exception', status };
    }
  }

  async function updateAgendaAppointmentPostCallDataById(req, res, appointmentIdRaw) {
    const idx = getGeneratedAppointmentIndexById(appointmentIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
    }

    const appointment = getGeneratedAgendaAppointments()[idx];
    const payload = buildPostCallPayload(req.body || {});
    const nowIso = new Date().toISOString();
    const shouldCreateOpenLead = isLeadFollowUpStatus(req.body?.status || req.body?.postCallStatus || payload.postCallStatus);
    const nextAppointmentFields = {
      ...appointment,
      postCallStatus: shouldCreateOpenLead
        ? 'lead_follow_up'
        : payload.postCallStatus || normalizePostCallStatus(appointment?.postCallStatus),
      postCallNotesTranscript:
        payload.postCallNotesTranscript ||
        sanitizePostCallText(appointment?.postCallNotesTranscript || '', 25000),
      postCallPrompt:
        payload.postCallPrompt || sanitizePostCallText(appointment?.postCallPrompt || '', 25000),
      postCallDomainName:
        payload.postCallDomainName ||
        sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
      referenceImages:
        Array.isArray(payload.referenceImages) && payload.referenceImages.length
          ? sanitizeReferenceImages(payload.referenceImages)
          : sanitizeReferenceImages(appointment?.referenceImages || []),
      postCallUpdatedAt: nowIso,
      postCallUpdatedBy: payload.postCallUpdatedBy || null,
    };

    if (shouldCreateOpenLead) {
      nextAppointmentFields.needsConfirmationEmail = true;
      nextAppointmentFields.confirmationTaskType = 'lead_follow_up';
      nextAppointmentFields.type = 'lead_follow_up';
      nextAppointmentFields.taskType = 'lead_follow_up';
      nextAppointmentFields.confirmationTaskCreatedAt =
        normalizeString(appointment?.confirmationTaskCreatedAt || '') || nowIso;
      nextAppointmentFields.confirmationResponseReceived = false;
      nextAppointmentFields.confirmationResponseReceivedAt = null;
      nextAppointmentFields.confirmationResponseReceivedBy = null;
      nextAppointmentFields.confirmationAppointmentCancelled = false;
      nextAppointmentFields.confirmationAppointmentCancelledAt = null;
      nextAppointmentFields.confirmationAppointmentCancelledBy = null;
    }

    const updated = setGeneratedAgendaAppointmentAtIndex(
      idx,
      nextAppointmentFields,
      'agenda_post_call_update'
    );

    if (!updated) {
      return res.status(500).json({ ok: false, error: 'Kon afspraak niet opslaan' });
    }

    appendDashboardActivity(
      {
        type: shouldCreateOpenLead ? 'lead_follow_up_added_from_agenda' : 'post_call_notes_saved',
        title: shouldCreateOpenLead ? 'Vervolg toegevoegd aan openstaande leads' : 'Klantwens opgeslagen',
        detail: shouldCreateOpenLead
          ? 'Afspraak als open lead-opvolging klaargezet.'
          : 'Na-afspraak transcriptie/prompt bijgewerkt.',
        company: updated?.company || appointment?.company || '',
        actor: payload.postCallUpdatedBy || '',
        taskId: Number(updated?.id || appointment?.id || 0) || null,
        callId: normalizeString(updated?.callId || appointment?.callId || ''),
        source: 'premium-personeel-agenda',
      },
      shouldCreateOpenLead ? 'dashboard_activity_lead_follow_up_added' : 'dashboard_activity_post_call_saved'
    );

    const shouldMarkAfgehaakt = normalizeLifecycleDatabaseStatus(req.body?.status) === 'afgehaakt';
    const databaseSync = shouldMarkAfgehaakt
      ? await syncPremiumCustomerDatabaseStatusFromAppointment(
          updated || appointment,
          'afgehaakt',
          payload.postCallUpdatedBy || ''
        )
      : null;
    if (databaseSync && databaseSync.ok !== true) {
      return res.status(500).json({
        ok: false,
        error: 'Afspraak opgeslagen, maar database-status kon niet worden bijgewerkt.',
        appointment: updated,
        databaseSync,
      });
    }

    return res.status(200).json({
      ok: true,
      appointment: updated,
      databaseSync,
    });
  }

  async function addAgendaAppointmentToPremiumActiveOrders(req, res, appointmentIdRaw) {
    const idx = getGeneratedAppointmentIndexById(appointmentIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
    }

    const appointment = getGeneratedAgendaAppointments()[idx];
    if (!appointment || typeof appointment !== 'object') {
      return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
    }

    const actor = truncateText(normalizeString(req.body?.actor || req.body?.doneBy || ''), 120);
    const promptText = sanitizePostCallText(req.body?.prompt || appointment?.postCallPrompt || '', 25000);
    const transcriptText = sanitizePostCallText(
      req.body?.transcript || appointment?.postCallNotesTranscript || '',
      25000
    );
    const domainName = sanitizeLaunchDomainName(
      req.body?.domainName || req.body?.domain || appointment?.postCallDomainName || appointment?.domainName || ''
    );
    const referenceImages = sanitizeReferenceImages(
      req.body?.referenceImages || req.body?.attachments || appointment?.referenceImages || []
    );

    if (!promptText) {
      return res.status(400).json({
        ok: false,
        error: 'Maak eerst een prompt voordat je toevoegt aan actieve opdrachten.',
      });
    }

    const currentState = await getUiStateValues(premiumActiveOrdersScope);
    const currentValues =
      currentState && currentState.values && typeof currentState.values === 'object'
        ? currentState.values
        : {};
    const customOrders = parseCustomOrdersFromUiState(readChunkedStateValue(currentValues, premiumActiveCustomOrdersKey));

    const appointmentId = Number(appointment?.id) || null;
    let existingOrder = appointmentId
      ? customOrders.find((item) => Number(item?.sourceAppointmentId) === appointmentId)
      : null;
    const hadExistingOrder = Boolean(existingOrder);

    if (existingOrder) {
      existingOrder = {
        ...existingOrder,
        clientName: truncateText(
          normalizeString(existingOrder?.clientName || appointment?.company || ''),
          160
        ),
        location: truncateText(
          normalizeString(existingOrder?.location || appointment?.contact || ''),
          160
        ),
        companyName: truncateText(
          normalizeString(existingOrder?.companyName || appointment?.company || existingOrder?.clientName || ''),
          160
        ),
        contactName: truncateText(
          normalizeString(existingOrder?.contactName || appointment?.contact || existingOrder?.location || ''),
          160
        ),
        contactPhone: truncateText(
          normalizeString(
            existingOrder?.contactPhone ||
              appointment?.phone ||
              appointment?.telefoon ||
              appointment?.contactPhone ||
              ''
          ),
          80
        ),
        contactEmail: truncateText(
          normalizeString(existingOrder?.contactEmail || appointment?.contactEmail || appointment?.email || ''),
          160
        ),
        prompt: promptText,
        transcript: transcriptText || sanitizePostCallText(existingOrder?.transcript || '', 25000),
        domainName:
          domainName ||
          sanitizeLaunchDomainName(existingOrder?.domainName || existingOrder?.domain || ''),
        referenceImages:
          referenceImages.length > 0
            ? referenceImages
            : sanitizeReferenceImages(existingOrder?.referenceImages || []),
        updatedAt: new Date().toISOString(),
      };
      for (let i = 0; i < customOrders.length; i += 1) {
        if (Number(customOrders[i]?.id) !== Number(existingOrder.id)) continue;
        customOrders[i] = existingOrder;
        break;
      }
    } else {
      const nextId = getNextCustomOrderId(customOrders);
      const record = buildActiveOrderRecordFromAppointment(
        {
          ...appointment,
          postCallPrompt: promptText,
          postCallNotesTranscript: transcriptText,
          postCallDomainName:
            domainName ||
            sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
          referenceImages:
            referenceImages.length > 0
              ? referenceImages
              : sanitizeReferenceImages(appointment?.referenceImages || []),
        },
        req.body || {},
        nextId
      );
      customOrders.push(record);
      existingOrder = record;
    }

    const nextValues = {
      ...currentValues,
      [premiumActiveCustomOrdersKey]: JSON.stringify(customOrders),
    };

    const savedUiState = await setUiStateValues(premiumActiveOrdersScope, nextValues, {
      source: 'premium-personeel-agenda',
      actor,
    });
    if (!savedUiState) {
      return res.status(500).json({ ok: false, error: 'Kon actieve opdrachten niet opslaan.' });
    }

    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        postCallStatus: normalizePostCallStatus(req.body?.status || appointment?.postCallStatus),
        postCallNotesTranscript: transcriptText,
        postCallPrompt: promptText,
        postCallDomainName:
          domainName ||
          sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
        referenceImages:
          referenceImages.length > 0
            ? referenceImages
            : sanitizeReferenceImages(appointment?.referenceImages || []),
        postCallUpdatedAt: nowIso,
        postCallUpdatedBy: actor || null,
        activeOrderId: Number(existingOrder?.id) || null,
        activeOrderAddedAt: nowIso,
        activeOrderAddedBy: actor || null,
        activeOrderReferenceImageCount: referenceImages.length,
      },
      'agenda_add_active_order'
    );

    appendDashboardActivity(
      {
        type: 'active_order_added_from_agenda',
        title: 'Toegevoegd aan actieve opdrachten',
        detail: `Afspraak omgezet naar actieve opdracht (#${Number(existingOrder?.id) || '?'})`,
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-personeel-agenda',
      },
      'dashboard_activity_active_order_added'
    );

    const databaseSync = await syncPremiumCustomerDatabaseStatusFromAppointment(
      updatedAppointment || appointment,
      'klant',
      actor
    );
    if (databaseSync.ok !== true) {
      return res.status(500).json({
        ok: false,
        error: 'Dossier aangemaakt, maar database-status kon niet worden bijgewerkt.',
        order: existingOrder,
        appointment: updatedAppointment,
        alreadyExisted: hadExistingOrder,
        databaseSync,
      });
    }

    return res.status(200).json({
      ok: true,
      order: existingOrder,
      appointment: updatedAppointment,
      alreadyExisted: hadExistingOrder,
      databaseSync,
    });
  }

  async function addAgendaAppointmentToInterestedLeads(req, res, appointmentIdRaw) {
    const idx = getGeneratedAppointmentIndexById(appointmentIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
    }

    const appointment = getGeneratedAgendaAppointments()[idx];
    if (!appointment || typeof appointment !== 'object') {
      return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
    }

    const actor = truncateText(normalizeString(req.body?.actor || req.body?.doneBy || ''), 120);
    const promptText = sanitizePostCallText(req.body?.prompt || appointment?.postCallPrompt || '', 25000);
    const transcriptText = sanitizePostCallText(
      req.body?.transcript || appointment?.postCallNotesTranscript || '',
      25000
    );
    const domainName = sanitizeLaunchDomainName(
      req.body?.domainName || req.body?.domain || appointment?.postCallDomainName || appointment?.domainName || ''
    );
    const referenceImages = sanitizeReferenceImages(
      req.body?.referenceImages || req.body?.attachments || appointment?.referenceImages || []
    );

    if (!promptText) {
      return res.status(400).json({
        ok: false,
        error: 'Maak eerst een prompt voordat je doorgaat met vervolg.',
      });
    }

    const followUpCallId = buildFollowUpLeadCallId(appointment);
    if (!followUpCallId) {
      return res.status(500).json({
        ok: false,
        error: 'Kon geen vervolgreferentie maken voor deze afspraak.',
      });
    }

    const followUpInput = {
      ...req.body,
      actor,
      prompt: promptText,
      transcript: transcriptText,
      domainName:
        domainName ||
        sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
      referenceImages:
        referenceImages.length > 0
          ? referenceImages
          : sanitizeReferenceImages(appointment?.referenceImages || []),
      status: normalizePostCallStatus(req.body?.status || appointment?.postCallStatus || 'bezig') || 'bezig',
    };

    const existingFollowUpIdx = findExistingFollowUpLeadTaskIndex(appointment, followUpCallId);
    const hadExistingLead = existingFollowUpIdx >= 0;
    let followUpLead = null;

    if (hadExistingLead) {
      const existingFollowUp = getGeneratedAgendaAppointments()[existingFollowUpIdx] || {};
      const builtFollowUp = buildFollowUpLeadAppointmentFromAppointment(
        appointment,
        followUpInput,
        followUpCallId
      );
      const nowIso = new Date().toISOString();
      const hintedUpdatedAtMs = Date.parse(nowIso) || Date.now();
      followUpLead = setGeneratedAgendaAppointmentAtIndex(
        existingFollowUpIdx,
        {
          ...existingFollowUp,
          ...builtFollowUp,
          id: Number(existingFollowUp?.id || 0) || Number(builtFollowUp?.id || 0) || null,
          callId: followUpCallId,
          createdAt: normalizeString(existingFollowUp?.createdAt || builtFollowUp?.createdAt || '') || nowIso,
          updatedAt: nowIso,
          updatedAtMs: hintedUpdatedAtMs,
          needsConfirmationEmail: false,
          confirmationTaskType: 'lead_follow_up',
          confirmationEmailSent: false,
          confirmationEmailSentAt: null,
          confirmationEmailSentBy: null,
          confirmationResponseReceived: false,
          confirmationResponseReceivedAt: null,
          confirmationResponseReceivedBy: null,
          confirmationAppointmentCancelled: false,
          confirmationAppointmentCancelledAt: null,
          confirmationAppointmentCancelledBy: null,
          confirmationTaskCreatedAt:
            normalizeString(existingFollowUp?.confirmationTaskCreatedAt || existingFollowUp?.createdAt || '') ||
            nowIso,
        },
        'agenda_follow_up_lead_update'
      );
    } else {
      followUpLead = upsertGeneratedAgendaAppointment(
        buildFollowUpLeadAppointmentFromAppointment(appointment, followUpInput, followUpCallId),
        followUpCallId
      );
    }

    if (!followUpLead) {
      return res.status(500).json({ ok: false, error: 'Kon vervolg niet opslaan bij openstaande leads.' });
    }

    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        postCallStatus: normalizePostCallStatus(req.body?.status || appointment?.postCallStatus),
        postCallNotesTranscript: transcriptText,
        postCallPrompt: promptText,
        postCallDomainName:
          domainName ||
          sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
        referenceImages:
          referenceImages.length > 0
            ? referenceImages
            : sanitizeReferenceImages(appointment?.referenceImages || []),
        postCallUpdatedAt: nowIso,
        postCallUpdatedBy: actor || null,
        leadFollowUpAppointmentId: Number(followUpLead?.id || 0) || null,
        leadFollowUpCallId: followUpCallId,
        leadFollowUpAddedAt:
          normalizeString(appointment?.leadFollowUpAddedAt || followUpLead?.createdAt || '') || nowIso,
        leadFollowUpAddedBy: actor || normalizeString(appointment?.leadFollowUpAddedBy || '') || null,
        leadFollowUpReferenceImageCount: referenceImages.length,
      },
      'agenda_add_follow_up_lead'
    );

    appendDashboardActivity(
      {
        type: 'follow_up_lead_added_from_agenda',
        title: 'Toegevoegd aan openstaande leads',
        detail: `Afspraak doorgeschoven naar openstaande leads (#${Number(followUpLead?.id) || '?'})`,
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-personeel-agenda',
      },
      'dashboard_activity_follow_up_lead_added'
    );

    return res.status(200).json({
      ok: true,
      followUpLead,
      appointment: updatedAppointment,
      alreadyExisted: hadExistingLead,
    });
  }

  return {
    addAgendaAppointmentToPremiumActiveOrders,
    addAgendaAppointmentToInterestedLeads,
    updateAgendaAppointmentPostCallDataById,
  };
}

module.exports = {
  createAgendaPostCallCoordinator,
  createAgendaPostCallHelpers,
};
