function buildRuntimeBackupEnvelope(options = {}) {
  const appName = String(options.appName || 'softora-runtime').trim();
  const appVersion = String(options.appVersion || '0.0.0').trim();
  const generatedAt = new Date().toISOString();
  const featureFlags =
    options.featureFlags && typeof options.featureFlags === 'object' ? { ...options.featureFlags } : {};
  const routeManifest =
    options.routeManifest && typeof options.routeManifest === 'object'
      ? {
          criticalFlowChecklist: Array.isArray(options.routeManifest.criticalFlowChecklist)
            ? options.routeManifest.criticalFlowChecklist.slice()
            : [],
          pageSmokeTargets: Array.isArray(options.routeManifest.pageSmokeTargets)
            ? options.routeManifest.pageSmokeTargets.slice()
            : [],
          contractTargets: Array.isArray(options.routeManifest.contractTargets)
            ? options.routeManifest.contractTargets.slice()
            : [],
        }
      : { criticalFlowChecklist: [], pageSmokeTargets: [], contractTargets: [] };
  const snapshotPayload =
    options.snapshotPayload && typeof options.snapshotPayload === 'object' ? options.snapshotPayload : {};
  const metadata =
    options.metadata && typeof options.metadata === 'object' ? { ...options.metadata } : {};

  return {
    ok: true,
    generatedAt,
    app: {
      name: appName,
      version: appVersion,
    },
    featureFlags,
    routeManifest,
    rollback: {
      recommendation:
        'Herdeploy de laatst bekende stabiele release en herstel daarna indien nodig de runtime-backup.',
      backupScript: 'npm run backup:runtime',
      backupRoute: '/api/debug/runtime-backup',
    },
    metadata,
    snapshot: snapshotPayload,
  };
}

function createRuntimeBackupCoordinator(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    parseNumberSafe = (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    toBooleanSafe = (value, fallback = false) => {
      if (value === true || value === false) return value;
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return fallback;
      return /^(1|true|yes|ja|on)$/.test(raw);
    },
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    resolveCallDurationSeconds = () => null,
    normalizeLeadOwnerRecord = () => null,
    recentWebhookEvents = [],
    recentCallUpdates = [],
    recentAiCallInsights = [],
    recentDashboardActivities = [],
    recentSecurityAuditEvents = [],
    generatedAgendaAppointments = [],
    dismissedInterestedLeadCallIds = new Set(),
    dismissedInterestedLeadKeys = new Set(),
    dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map(),
    leadOwnerAssignmentsByCallId = new Map(),
    getNextLeadOwnerRotationIndex = () => 0,
    getNextGeneratedAgendaAppointmentId = () => 100000,
    appName = 'softora-retell-coldcalling-backend',
    appVersion = '0.0.0',
    getPublicFeatureFlags = () => ({}),
    routeManifest = {},
  } = deps;

  function compactRuntimeSnapshotText(value, maxLength = 500) {
    return truncateText(normalizeString(value || ''), Math.max(40, Number(maxLength) || 500));
  }

  function compactRuntimeSnapshotWebhookEvent(event) {
    return {
      receivedAt: normalizeString(event?.receivedAt || ''),
      messageType: compactRuntimeSnapshotText(event?.messageType, 120),
      callId: compactRuntimeSnapshotText(event?.callId, 120),
      callStatus: compactRuntimeSnapshotText(event?.callStatus, 80),
      payload: null,
    };
  }

  function compactRuntimeSnapshotCallUpdate(item) {
    const durationSeconds = Number(item?.durationSeconds);
    const updatedAtMs = Number(item?.updatedAtMs || 0);
    return {
      callId: compactRuntimeSnapshotText(item?.callId, 140),
      phone: compactRuntimeSnapshotText(item?.phone, 80),
      company: compactRuntimeSnapshotText(item?.company, 180),
      branche: compactRuntimeSnapshotText(item?.branche, 120),
      region: compactRuntimeSnapshotText(item?.region, 120),
      province: compactRuntimeSnapshotText(item?.province, 120),
      address: compactRuntimeSnapshotText(item?.address, 220),
      name: compactRuntimeSnapshotText(item?.name, 140),
      status: compactRuntimeSnapshotText(item?.status, 80),
      messageType: compactRuntimeSnapshotText(item?.messageType, 120),
      summary: compactRuntimeSnapshotText(item?.summary, 1400),
      transcriptSnippet: compactRuntimeSnapshotText(item?.transcriptSnippet, 900),
      transcriptFull: compactRuntimeSnapshotText(item?.transcriptFull, 2200),
      endedReason: compactRuntimeSnapshotText(item?.endedReason, 120),
      startedAt: normalizeString(item?.startedAt || ''),
      endedAt: normalizeString(item?.endedAt || ''),
      durationSeconds:
        Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : null,
      recordingUrl: compactRuntimeSnapshotText(item?.recordingUrl, 1200),
      recordingSid: compactRuntimeSnapshotText(item?.recordingSid, 120),
      recordingUrlProxy: compactRuntimeSnapshotText(item?.recordingUrlProxy, 260),
      updatedAt: normalizeString(item?.updatedAt || ''),
      updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? Math.round(updatedAtMs) : 0,
      provider: compactRuntimeSnapshotText(item?.provider, 40),
      direction: compactRuntimeSnapshotText(item?.direction, 40),
      stack: compactRuntimeSnapshotText(item?.stack, 80),
      stackLabel: compactRuntimeSnapshotText(item?.stackLabel, 80),
      businessMode: compactRuntimeSnapshotText(item?.businessMode, 80),
      business_mode: compactRuntimeSnapshotText(item?.business_mode, 80),
      serviceType: compactRuntimeSnapshotText(item?.serviceType, 80),
      service_type: compactRuntimeSnapshotText(item?.service_type, 80),
    };
  }

  function buildSupabaseCallUpdatePayload(callUpdate, reason = 'call_update_row') {
    const compact = compactRuntimeSnapshotCallUpdate(callUpdate || {});
    if (!normalizeString(compact?.callId || '')) return null;
    const persistedAtIso = new Date().toISOString();
    return {
      version: 1,
      type: 'call_update',
      reason: compactRuntimeSnapshotText(reason, 80),
      savedAt: persistedAtIso,
      callUpdate: compact,
    };
  }

  function extractSupabaseCallUpdateFromRow(row, options = {}) {
    if (!row || typeof row !== 'object') return null;
    const rowCallId = normalizeString(options.extractCallIdFromStateKey?.(row?.state_key || row?.stateKey || '') || '');
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : null;
    const candidate =
      payload && payload.callUpdate && typeof payload.callUpdate === 'object'
        ? payload.callUpdate
        : payload && payload.update && typeof payload.update === 'object'
          ? payload.update
          : payload && payload.type === 'call_update'
            ? payload
            : null;
    const compact = compactRuntimeSnapshotCallUpdate({
      ...(candidate && typeof candidate === 'object' ? candidate : {}),
      callId: normalizeString(candidate?.callId || candidate?.call_id || '') || rowCallId,
      updatedAt:
        normalizeString(candidate?.updatedAt || candidate?.updated_at || '') ||
        normalizeString(row?.updated_at || row?.updatedAt || ''),
      updatedAtMs:
        Number(candidate?.updatedAtMs || candidate?.updated_at_ms || 0) ||
        Date.parse(
          normalizeString(
            candidate?.updatedAt || candidate?.updated_at || row?.updated_at || row?.updatedAt || ''
          )
        ) ||
        0,
    });
    if (!normalizeString(compact?.callId || '')) return null;
    return compact;
  }

  function compactRuntimeSnapshotAiInsight(item) {
    const estimatedValueEur = parseNumberSafe(
      item?.estimatedValueEur ?? item?.estimated_value_eur,
      null
    );
    return {
      callId: compactRuntimeSnapshotText(item?.callId, 140),
      company: compactRuntimeSnapshotText(item?.company, 180),
      leadCompany: compactRuntimeSnapshotText(item?.leadCompany, 180),
      contactName: compactRuntimeSnapshotText(item?.contactName, 140),
      leadName: compactRuntimeSnapshotText(item?.leadName, 140),
      phone: compactRuntimeSnapshotText(item?.phone, 80),
      branche: compactRuntimeSnapshotText(item?.branche, 120),
      summary: compactRuntimeSnapshotText(item?.summary, 1400),
      appointmentBooked: toBooleanSafe(item?.appointmentBooked ?? item?.appointment_booked, false),
      appointmentDate: normalizeDateYyyyMmDd(item?.appointmentDate || item?.appointment_date || ''),
      appointmentTime: normalizeTimeHhMm(item?.appointmentTime || item?.appointment_time || ''),
      estimatedValueEur: Number.isFinite(estimatedValueEur) ? estimatedValueEur : null,
      followUpRequired: toBooleanSafe(item?.followUpRequired ?? item?.follow_up_required, false),
      followUpReason: compactRuntimeSnapshotText(item?.followUpReason || item?.follow_up_reason, 900),
      source: compactRuntimeSnapshotText(item?.source, 40),
      model: compactRuntimeSnapshotText(item?.model, 80),
      analyzedAt: normalizeString(item?.analyzedAt || ''),
      agendaAppointmentId: Number(item?.agendaAppointmentId || 0) || null,
      provider: compactRuntimeSnapshotText(item?.provider, 40),
      coldcallingStack: compactRuntimeSnapshotText(item?.coldcallingStack || item?.stack, 80),
      coldcallingStackLabel: compactRuntimeSnapshotText(
        item?.coldcallingStackLabel || item?.stackLabel,
        80
      ),
      businessMode: compactRuntimeSnapshotText(item?.businessMode || item?.business_mode, 80),
      serviceType: compactRuntimeSnapshotText(item?.serviceType || item?.service_type, 80),
      contactEmail: compactRuntimeSnapshotText(item?.contactEmail || item?.email || item?.leadEmail, 180),
      region: compactRuntimeSnapshotText(item?.region || item?.leadRegion, 120),
      province: compactRuntimeSnapshotText(item?.province || item?.leadProvince, 120),
      address: compactRuntimeSnapshotText(item?.address || item?.leadAddress, 220),
    };
  }

  function compactRuntimeSnapshotDashboardActivity(item) {
    return {
      id: compactRuntimeSnapshotText(item?.id, 140),
      type: compactRuntimeSnapshotText(item?.type, 80),
      title: compactRuntimeSnapshotText(item?.title, 200),
      detail: compactRuntimeSnapshotText(item?.detail || item?.message, 1200),
      company: compactRuntimeSnapshotText(item?.company, 180),
      actor: compactRuntimeSnapshotText(item?.actor, 120),
      taskId: Number(item?.taskId || 0) || null,
      callId: compactRuntimeSnapshotText(item?.callId, 140),
      source: compactRuntimeSnapshotText(item?.source, 120),
      createdAt: normalizeString(item?.createdAt || ''),
      updatedAt: normalizeString(item?.updatedAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
    };
  }

  function compactRuntimeSnapshotSecurityAuditEvent(item) {
    return {
      id: compactRuntimeSnapshotText(item?.id, 140),
      type: compactRuntimeSnapshotText(item?.type, 120),
      severity: compactRuntimeSnapshotText(item?.severity, 20),
      success: toBooleanSafe(item?.success, false),
      email: compactRuntimeSnapshotText(item?.email, 180),
      ip: compactRuntimeSnapshotText(item?.ip, 80),
      path: compactRuntimeSnapshotText(item?.path, 220),
      origin: compactRuntimeSnapshotText(item?.origin, 220),
      detail: compactRuntimeSnapshotText(item?.detail || item?.message, 600),
      userAgent: compactRuntimeSnapshotText(item?.userAgent, 300),
      createdAt: normalizeString(item?.createdAt || ''),
      updatedAt: normalizeString(item?.updatedAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
    };
  }

  function compactRuntimeSnapshotGeneratedAgendaAppointment(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: Number(item?.id || 0) || 0,
      type: compactRuntimeSnapshotText(item?.type, 60),
      company: compactRuntimeSnapshotText(item?.company, 180),
      contact: compactRuntimeSnapshotText(item?.contact, 140),
      phone: compactRuntimeSnapshotText(item?.phone, 80),
      date: normalizeDateYyyyMmDd(item?.date || ''),
      time: normalizeTimeHhMm(item?.time || ''),
      value: compactRuntimeSnapshotText(item?.value, 80),
      branche: compactRuntimeSnapshotText(item?.branche, 120),
      source: compactRuntimeSnapshotText(item?.source, 140),
      summary: compactRuntimeSnapshotText(item?.summary, 1800),
      aiGenerated: toBooleanSafe(item?.aiGenerated, false),
      callId: compactRuntimeSnapshotText(item?.callId, 140),
      createdAt: normalizeString(item?.createdAt || ''),
      needsConfirmationEmail: toBooleanSafe(item?.needsConfirmationEmail, false),
      confirmationTaskType: compactRuntimeSnapshotText(item?.confirmationTaskType, 60),
      provider: compactRuntimeSnapshotText(item?.provider, 40),
      coldcallingStack: compactRuntimeSnapshotText(item?.coldcallingStack, 80),
      coldcallingStackLabel: compactRuntimeSnapshotText(item?.coldcallingStackLabel, 80),
      location: compactRuntimeSnapshotText(item?.location || item?.appointmentLocation, 220),
      whatsappInfo: compactRuntimeSnapshotText(
        item?.whatsappInfo || item?.whatsappNotes || item?.whatsapp,
        1200
      ),
      whatsappConfirmed: toBooleanSafe(item?.whatsappConfirmed, false),
      durationSeconds: resolveCallDurationSeconds(item),
      recordingUrl: compactRuntimeSnapshotText(item?.recordingUrl, 1200),
      contactEmail: compactRuntimeSnapshotText(item?.contactEmail || item?.email, 180),
      confirmationEmailSent: toBooleanSafe(item?.confirmationEmailSent, false),
      confirmationEmailSentAt: normalizeString(item?.confirmationEmailSentAt || ''),
      confirmationEmailSentBy: compactRuntimeSnapshotText(item?.confirmationEmailSentBy, 120),
      confirmationResponseReceived: toBooleanSafe(item?.confirmationResponseReceived, false),
      confirmationResponseReceivedAt: normalizeString(item?.confirmationResponseReceivedAt || ''),
      confirmationResponseReceivedBy: compactRuntimeSnapshotText(
        item?.confirmationResponseReceivedBy,
        120
      ),
      confirmationAppointmentCancelled: toBooleanSafe(item?.confirmationAppointmentCancelled, false),
      confirmationAppointmentCancelledAt: normalizeString(item?.confirmationAppointmentCancelledAt || ''),
      confirmationAppointmentCancelledBy: compactRuntimeSnapshotText(
        item?.confirmationAppointmentCancelledBy,
        120
      ),
      confirmationEmailDraft: compactRuntimeSnapshotText(item?.confirmationEmailDraft, 1800),
      confirmationEmailDraftGeneratedAt: normalizeString(
        item?.confirmationEmailDraftGeneratedAt || ''
      ),
      confirmationEmailDraftSource: compactRuntimeSnapshotText(item?.confirmationEmailDraftSource, 60),
      confirmationEmailLastError: compactRuntimeSnapshotText(item?.confirmationEmailLastError, 600),
      confirmationEmailLastSentMessageId: compactRuntimeSnapshotText(
        item?.confirmationEmailLastSentMessageId,
        180
      ),
      confirmationTaskCreatedAt: normalizeString(item?.confirmationTaskCreatedAt || ''),
      postCallStatus: compactRuntimeSnapshotText(item?.postCallStatus, 60),
      postCallNotesTranscript: compactRuntimeSnapshotText(item?.postCallNotesTranscript, 1800),
      postCallPrompt: compactRuntimeSnapshotText(item?.postCallPrompt, 1200),
      postCallDomainName: compactRuntimeSnapshotText(
        item?.postCallDomainName || item?.domainName,
        220
      ),
      postCallUpdatedAt: normalizeString(item?.postCallUpdatedAt || ''),
      postCallUpdatedBy: compactRuntimeSnapshotText(item?.postCallUpdatedBy, 120),
      activeOrderId: Number(item?.activeOrderId || 0) || null,
      activeOrderAddedAt: normalizeString(item?.activeOrderAddedAt || ''),
      activeOrderAddedBy: compactRuntimeSnapshotText(item?.activeOrderAddedBy, 120),
      activeOrderReferenceImageCount: Number(item?.activeOrderReferenceImageCount || 0) || 0,
      leadOwnerKey: compactRuntimeSnapshotText(item?.leadOwnerKey, 160),
      leadOwnerName: compactRuntimeSnapshotText(item?.leadOwnerName, 140),
      leadOwnerFullName: compactRuntimeSnapshotText(item?.leadOwnerFullName, 180),
      leadOwnerUserId: compactRuntimeSnapshotText(item?.leadOwnerUserId, 120),
      leadOwnerEmail: compactRuntimeSnapshotText(item?.leadOwnerEmail, 180),
      updatedAt: normalizeString(item?.updatedAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
    };
  }

  function buildRuntimeStateSnapshotPayloadWithLimits(options = {}) {
    const maxWebhookEvents = Math.max(10, Math.min(200, Number(options?.maxWebhookEvents || 80) || 80));
    const maxCallUpdates = Math.max(20, Math.min(500, Number(options?.maxCallUpdates || 500) || 500));
    const maxAiCallInsights = Math.max(
      20,
      Math.min(500, Number(options?.maxAiCallInsights || 500) || 500)
    );
    const maxDashboardActivities = Math.max(
      20,
      Math.min(500, Number(options?.maxDashboardActivities || 500) || 500)
    );
    const maxSecurityAuditEvents = Math.max(
      20,
      Math.min(500, Number(options?.maxSecurityAuditEvents || 500) || 500)
    );
    const maxAgendaAppointments = Math.max(
      40,
      Math.min(5000, Number(options?.maxAgendaAppointments || 5000) || 5000)
    );
    const maxDismissedCallIds = Math.max(
      100,
      Math.min(2000, Number(options?.maxDismissedCallIds || 1000) || 1000)
    );
    const maxDismissedLeadKeys = Math.max(
      100,
      Math.min(4000, Number(options?.maxDismissedLeadKeys || 2000) || 2000)
    );
    const maxLeadOwnerAssignments = Math.max(
      200,
      Math.min(5000, Number(options?.maxLeadOwnerAssignments || 5000) || 5000)
    );

    return {
      version: 5,
      savedAt: new Date().toISOString(),
      recentWebhookEvents: recentWebhookEvents
        .slice(0, maxWebhookEvents)
        .map(compactRuntimeSnapshotWebhookEvent),
      recentCallUpdates: recentCallUpdates
        .slice(0, maxCallUpdates)
        .map(compactRuntimeSnapshotCallUpdate)
        .filter((item) => normalizeString(item?.callId || '')),
      recentAiCallInsights: recentAiCallInsights
        .slice(0, maxAiCallInsights)
        .map(compactRuntimeSnapshotAiInsight)
        .filter((item) => normalizeString(item?.callId || '')),
      recentDashboardActivities: recentDashboardActivities
        .slice(0, maxDashboardActivities)
        .map(compactRuntimeSnapshotDashboardActivity)
        .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || '')),
      recentSecurityAuditEvents: recentSecurityAuditEvents
        .slice(0, maxSecurityAuditEvents)
        .map(compactRuntimeSnapshotSecurityAuditEvent)
        .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || '')),
      generatedAgendaAppointments: generatedAgendaAppointments
        .slice(0, maxAgendaAppointments)
        .map(compactRuntimeSnapshotGeneratedAgendaAppointment)
        .filter(Boolean),
      dismissedInterestedLeadCallIds: Array.from(dismissedInterestedLeadCallIds)
        .slice(0, maxDismissedCallIds)
        .map((item) => normalizeString(item))
        .filter(Boolean),
      dismissedInterestedLeadKeys: Array.from(dismissedInterestedLeadKeys)
        .slice(0, maxDismissedLeadKeys)
        .map((item) => normalizeString(item))
        .filter(Boolean),
      dismissedInterestedLeadKeyUpdatedAtMsByKey: Object.fromEntries(
        Array.from(dismissedInterestedLeadKeyUpdatedAtMsByKey.entries())
          .slice(0, maxDismissedLeadKeys)
          .map(([leadKey, updatedAtMs]) => [
            normalizeString(leadKey),
            Number(updatedAtMs || 0) || 0,
          ])
          .filter(([leadKey, updatedAtMs]) => leadKey && Number.isFinite(updatedAtMs) && updatedAtMs > 0)
      ),
      leadOwnerAssignments: Array.from(leadOwnerAssignmentsByCallId.entries())
        .slice(0, maxLeadOwnerAssignments)
        .map(([callId, owner]) => ({
          callId: normalizeString(callId),
          owner: normalizeLeadOwnerRecord(owner),
        }))
        .filter((item) => item.callId && item.owner),
      nextLeadOwnerRotationIndex: Number(getNextLeadOwnerRotationIndex()) || 0,
      nextGeneratedAgendaAppointmentId: Number(getNextGeneratedAgendaAppointmentId()) || 100000,
    };
  }

  function buildRuntimeBackupForOps(options = {}) {
    const snapshotOptions =
      options && typeof options.snapshotOptions === 'object' && options.snapshotOptions
        ? options.snapshotOptions
        : options;
    return buildRuntimeBackupEnvelope({
      appName,
      appVersion,
      featureFlags: getPublicFeatureFlags(),
      routeManifest,
      snapshotPayload: buildRuntimeStateSnapshotPayloadWithLimits(snapshotOptions || {}),
      metadata:
        options && typeof options.metadata === 'object' && options.metadata ? options.metadata : {},
    });
  }

  return {
    buildRuntimeBackupForOps,
    buildRuntimeStateSnapshotPayloadWithLimits,
    buildSupabaseCallUpdatePayload,
    compactRuntimeSnapshotAiInsight,
    compactRuntimeSnapshotCallUpdate,
    compactRuntimeSnapshotDashboardActivity,
    compactRuntimeSnapshotGeneratedAgendaAppointment,
    compactRuntimeSnapshotSecurityAuditEvent,
    compactRuntimeSnapshotText,
    compactRuntimeSnapshotWebhookEvent,
    extractSupabaseCallUpdateFromRow,
  };
}

module.exports = {
  buildRuntimeBackupEnvelope,
  createRuntimeBackupCoordinator,
};
