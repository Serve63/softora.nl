function normalizeString(value) {
  return String(value ?? '').trim();
}

function truncateText(value, maxLength = 0) {
  const text = normalizeString(value);
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function normalizeActorFields(body = {}) {
  const actor = truncateText(body.actor || body.doneBy || '', 120);
  return {
    actor,
    doneBy: actor,
  };
}

function normalizeBooleanOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return undefined;
  if (['1', 'true', 'yes', 'ja', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'nee', 'off'].includes(raw)) return false;
  return Boolean(value);
}

function normalizeReferenceImages(body = {}) {
  if (Array.isArray(body.referenceImages)) return body.referenceImages;
  if (Array.isArray(body.attachments)) return body.attachments;
  return [];
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric);
}

function ensureRequiredRef(rawValue, label) {
  const value = normalizeString(rawValue);
  if (!value) {
    return {
      ok: false,
      error: `${label} ontbreekt.`,
    };
  }
  return {
    ok: true,
    value,
  };
}

function validatePostCallRequest(req) {
  const appointmentId = ensureRequiredRef(req.params?.id || req.query?.appointmentId, 'appointmentId');
  if (!appointmentId.ok) return appointmentId;

  const body = req.body || {};
  const actorFields = normalizeActorFields(body);
  const status = truncateText(body.status || body.postCallStatus || '', 80);
  const transcript = truncateText(
    body.transcript || body.postCallNotesTranscript || body.voiceTranscript || '',
    25000
  );
  const prompt = truncateText(body.prompt || body.postCallPrompt || body.generatedPrompt || '', 25000);
  const domainName = truncateText(
    body.domainName || body.domain || body.postCallDomainName || '',
    255
  );
  const referenceImages = normalizeReferenceImages(body);

  return {
    ok: true,
    params: req.params?.id ? { id: appointmentId.value } : undefined,
    query: req.query?.appointmentId !== undefined ? { appointmentId: appointmentId.value } : undefined,
    body: {
      ...actorFields,
      status,
      postCallStatus: status,
      transcript,
      postCallNotesTranscript: transcript,
      prompt,
      postCallPrompt: prompt,
      domainName,
      domain: domainName,
      postCallDomainName: domainName,
      referenceImages,
      attachments: referenceImages,
    },
  };
}

function validateAddActiveOrderRequest(req) {
  const appointmentId = ensureRequiredRef(req.params?.id || req.query?.appointmentId, 'appointmentId');
  if (!appointmentId.ok) return appointmentId;

  const body = req.body || {};
  const actorFields = normalizeActorFields(body);
  const prompt = truncateText(body.prompt || body.postCallPrompt || '', 25000);
  const transcript = truncateText(body.transcript || body.postCallNotesTranscript || '', 25000);
  const domainName = truncateText(
    body.domainName || body.domain || body.postCallDomainName || '',
    255
  );
  const referenceImages = normalizeReferenceImages(body);
  const amount = normalizeOptionalInteger(body.amount);

  return {
    ok: true,
    params: req.params?.id ? { id: appointmentId.value } : undefined,
    query: req.query?.appointmentId !== undefined ? { appointmentId: appointmentId.value } : undefined,
    body: {
      ...actorFields,
      prompt,
      postCallPrompt: prompt,
      transcript,
      postCallNotesTranscript: transcript,
      domainName,
      domain: domainName,
      postCallDomainName: domainName,
      title: truncateText(body.title || '', 200),
      description: truncateText(body.description || '', 3000),
      status: truncateText(body.status || '', 80),
      location: truncateText(body.location || '', 160),
      amount,
      referenceImages,
      attachments: referenceImages,
    },
  };
}

function buildLeadToAgendaBody(body = {}, options = {}) {
  const actorFields = normalizeActorFields(body);
  const whatsappConfirmed = normalizeBooleanOrUndefined(body.whatsappConfirmed);
  const normalizedBody = {
    ...actorFields,
    appointmentDate: truncateText(body.appointmentDate || body.date || '', 40),
    date: truncateText(body.appointmentDate || body.date || '', 40),
    appointmentTime: truncateText(body.appointmentTime || body.time || '', 20),
    time: truncateText(body.appointmentTime || body.time || '', 20),
    location: truncateText(body.location || body.appointmentLocation || '', 255),
    appointmentLocation: truncateText(body.location || body.appointmentLocation || '', 255),
    whatsappInfo: truncateText(body.whatsappInfo || body.whatsappNotes || body.notes || '', 4000),
    whatsappNotes: truncateText(body.whatsappInfo || body.whatsappNotes || body.notes || '', 4000),
    notes: truncateText(body.whatsappInfo || body.whatsappNotes || body.notes || '', 4000),
    summary: truncateText(body.summary || '', 4000),
    company: truncateText(body.company || '', 160),
    contact: truncateText(body.contact || '', 160),
    phone: truncateText(body.phone || '', 80),
    contactEmail: truncateText(body.contactEmail || '', 320),
    branche: truncateText(body.branche || '', 160),
  };

  if (options.includeCallId) {
    normalizedBody.callId = truncateText(body.callId || '', 160);
  }
  if (whatsappConfirmed !== undefined) {
    normalizedBody.whatsappConfirmed = whatsappConfirmed;
  }
  return normalizedBody;
}

function validateInterestedLeadSetInAgendaRequest(req) {
  const callId = ensureRequiredRef(req.body?.callId || req.query?.callId, 'callId');
  if (!callId.ok) return callId;

  const body = buildLeadToAgendaBody(req.body || {}, { includeCallId: true });
  body.callId = callId.value;

  return {
    ok: true,
    query: req.query?.callId !== undefined ? { callId: callId.value } : undefined,
    body,
  };
}

function validateInterestedLeadDismissRequest(req) {
  const callId = ensureRequiredRef(req.body?.callId || req.query?.callId, 'callId');
  if (!callId.ok) return callId;

  return {
    ok: true,
    query: req.query?.callId !== undefined ? { callId: callId.value } : undefined,
    body: {
      ...normalizeActorFields(req.body || {}),
      callId: callId.value,
    },
  };
}

function validateConfirmationMailSyncRequest(req) {
  const body = req.body || {};
  const maxMessagesRaw = normalizeOptionalInteger(body.maxMessages);
  const maxMessages = Math.max(10, Math.min(400, maxMessagesRaw || 120));
  return {
    ok: true,
    body: {
      ...normalizeActorFields(body),
      maxMessages,
    },
  };
}

function validateTaskQueryRequest(req, queryKey = 'taskId') {
  const taskId = ensureRequiredRef(req.params?.id || req.query?.[queryKey], queryKey);
  if (!taskId.ok) return taskId;

  return {
    ok: true,
    params: req.params?.id ? { id: taskId.value } : undefined,
    query: req.query?.[queryKey] !== undefined ? { [queryKey]: taskId.value } : undefined,
  };
}

function validateDraftEmailRequest(req) {
  const taskResult = validateTaskQueryRequest(req, 'taskId');
  if (!taskResult.ok) return taskResult;
  return {
    ...taskResult,
    body: {
      ...normalizeActorFields(req.body || {}),
    },
  };
}

function validateSendEmailRequest(req) {
  const taskResult = validateTaskQueryRequest(req, 'taskId');
  if (!taskResult.ok) return taskResult;

  const body = req.body || {};
  const recipientEmail = truncateText(body.recipientEmail || body.email || '', 320);
  return {
    ...taskResult,
    body: {
      ...normalizeActorFields(body),
      recipientEmail,
      email: recipientEmail,
    },
  };
}

function validateConfirmationTaskSetInAgendaRequest(req) {
  const taskResult = validateTaskQueryRequest(req, 'taskId');
  if (!taskResult.ok) return taskResult;
  return {
    ...taskResult,
    body: buildLeadToAgendaBody(req.body || {}),
  };
}

function validateTaskActorRequest(req) {
  const taskResult = validateTaskQueryRequest(req, 'taskId');
  if (!taskResult.ok) return taskResult;
  return {
    ...taskResult,
    body: {
      ...normalizeActorFields(req.body || {}),
    },
  };
}

function validateManualAgendaAppointmentRequest(req) {
  const body = req.body || {};
  return {
    ok: true,
    body: {
      ...normalizeActorFields(body),
      date: truncateText(normalizeString(body.date || body.appointmentDate || ''), 32),
      time: truncateText(normalizeString(body.time || body.appointmentTime || ''), 16),
      location: truncateText(normalizeString(body.location || body.appointmentLocation || ''), 220),
      activity: truncateText(normalizeString(body.activity || body.company || ''), 500),
      availableAgain: truncateText(
        normalizeString(body.availableAgain || body.available_after || ''),
        800
      ),
    },
  };
}

module.exports = {
  ensureRequiredRef,
  validateAddActiveOrderRequest,
  validateConfirmationMailSyncRequest,
  validateConfirmationTaskSetInAgendaRequest,
  validateDraftEmailRequest,
  validateInterestedLeadDismissRequest,
  validateInterestedLeadSetInAgendaRequest,
  validateManualAgendaAppointmentRequest,
  validatePostCallRequest,
  validateSendEmailRequest,
  validateTaskActorRequest,
};
