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
          const title = truncateText(normalizeString(item.title || ''), 200);
          const description = truncateText(normalizeString(item.description || ''), 3000);
          if (!Number.isFinite(id) || id <= 0) return null;
          if (!clientName || !title || !description) return null;
          if (!Number.isFinite(amount) || amount <= 0) return null;

          return {
            ...item,
            id,
            clientName,
            location,
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
    const company = truncateText(normalizeString(appointment?.company || ''), 160) || 'Nieuwe lead';
    const contact = truncateText(normalizeString(appointment?.contact || ''), 160);
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
      location: truncateText(normalizeString(input.location || ''), 160),
      title,
      description,
      amount,
      domainName,
      status: normalizeActiveOrderStatusKey(input.status || 'wacht'),
      source: 'agenda_post_call_prompt',
      sourceAppointmentId: Number(appointment?.id) || null,
      sourceCallId: normalizeString(appointment?.callId || '') || null,
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
    appendDashboardActivity = () => {},
    getUiStateValues = async () => null,
    setUiStateValues = async () => null,
    premiumActiveOrdersScope = 'premium_active_orders',
    premiumActiveCustomOrdersKey = 'softora_custom_orders_premium_v1',
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

  function updateAgendaAppointmentPostCallDataById(req, res, appointmentIdRaw) {
    const idx = getGeneratedAppointmentIndexById(appointmentIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
    }

    const appointment = getGeneratedAgendaAppointments()[idx];
    const payload = buildPostCallPayload(req.body || {});
    const nowIso = new Date().toISOString();
    const updated = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        postCallStatus: payload.postCallStatus || normalizePostCallStatus(appointment?.postCallStatus),
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
      },
      'agenda_post_call_update'
    );

    if (!updated) {
      return res.status(500).json({ ok: false, error: 'Kon afspraak niet opslaan' });
    }

    appendDashboardActivity(
      {
        type: 'post_call_notes_saved',
        title: 'Klantwens opgeslagen',
        detail: 'Na-afspraak transcriptie/prompt bijgewerkt.',
        company: updated?.company || appointment?.company || '',
        actor: payload.postCallUpdatedBy || '',
        taskId: Number(updated?.id || appointment?.id || 0) || null,
        callId: normalizeString(updated?.callId || appointment?.callId || ''),
        source: 'premium-personeel-agenda',
      },
      'dashboard_activity_post_call_saved'
    );

    return res.status(200).json({
      ok: true,
      appointment: updated,
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
    const customOrders = parseCustomOrdersFromUiState(currentValues[premiumActiveCustomOrdersKey]);

    const appointmentId = Number(appointment?.id) || null;
    let existingOrder = appointmentId
      ? customOrders.find((item) => Number(item?.sourceAppointmentId) === appointmentId)
      : null;
    const hadExistingOrder = Boolean(existingOrder);

    if (existingOrder) {
      existingOrder = {
        ...existingOrder,
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

    return res.status(200).json({
      ok: true,
      order: existingOrder,
      appointment: updatedAppointment,
      alreadyExisted: hadExistingOrder,
    });
  }

  return {
    addAgendaAppointmentToPremiumActiveOrders,
    updateAgendaAppointmentPostCallDataById,
  };
}

module.exports = {
  createAgendaPostCallCoordinator,
  createAgendaPostCallHelpers,
};
