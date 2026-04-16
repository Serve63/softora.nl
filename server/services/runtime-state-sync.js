function createRuntimeStateSyncCoordinator(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    fetchSupabaseStateRowViaRest = async () => ({ ok: false }),
    upsertSupabaseStateRowViaRest = async () => ({ ok: false }),
    fetchSupabaseCallUpdateRowsViaRest = async () => ({ ok: false }),
    upsertSupabaseRowViaRest = async () => ({ ok: false }),
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false }),
    supabaseStateTable = '',
    supabaseStateKey = '',
    supabaseDismissedLeadsStateKey = '',
    supabaseCallUpdateStateKeyPrefix = '',
    supabaseCallUpdateRowsFetchLimit = 500,
    runtimeStateSupabaseSyncCooldownMs = 4000,
    runtimeStateRemoteNewerThresholdMs = 250,
    supabaseClientPersistTimeoutMs = 12000,
    // Agenda-acties ketenen vaak meerdere persists (upsert, mutatie, dismiss, dashboard-activiteit).
    // 15s was te kort op trage netwerken → false positieve "gedeelde opslag" fouten na "in agenda zetten".
    queuedRuntimePersistAwaitTimeoutMs = 60000,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    parseNumberSafe = (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    buildSupabaseCallUpdateStateKey = () => '',
    extractSupabaseCallUpdateFromRow = () => null,
    buildSupabaseCallUpdatePayload = () => null,
    buildRuntimeStateSnapshotPayloadWithLimits = () => ({}),
    compactRuntimeSnapshotWebhookEvent = (item) => item,
    compactRuntimeSnapshotCallUpdate = (item) => item,
    compactRuntimeSnapshotAiInsight = (item) => item,
    compactRuntimeSnapshotDashboardActivity = (item) => item,
    compactRuntimeSnapshotSecurityAuditEvent = (item) => item,
    compactRuntimeSnapshotGeneratedAgendaAppointment = (item) => item,
    normalizeLeadOwnerRecord = () => null,
    recentWebhookEvents = [],
    recentCallUpdates = [],
    callUpdatesById = new Map(),
    recentAiCallInsights = [],
    aiCallInsightsByCallId = new Map(),
    recentDashboardActivities = [],
    recentSecurityAuditEvents = [],
    generatedAgendaAppointments = [],
    agendaAppointmentIdByCallId = new Map(),
    dismissedInterestedLeadCallIds = new Set(),
    dismissedInterestedLeadKeys = new Set(),
    dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map(),
    leadOwnerAssignmentsByCallId = new Map(),
    upsertRecentCallUpdate = () => null,
    logger = console,
    runtimeState = {},
  } = deps;

  if (!('supabasePersistChain' in runtimeState)) {
    runtimeState.supabasePersistChain = Promise.resolve(true);
  }
  if (!('supabaseCallUpdatePersistChain' in runtimeState)) {
    runtimeState.supabaseCallUpdatePersistChain = Promise.resolve(true);
  }
  if (!('supabaseStateHydrationPromise' in runtimeState)) {
    runtimeState.supabaseStateHydrationPromise = null;
  }
  if (!('supabaseStateHydrated' in runtimeState)) {
    runtimeState.supabaseStateHydrated = false;
  }
  if (!('supabaseHydrateRetryNotBeforeMs' in runtimeState)) {
    runtimeState.supabaseHydrateRetryNotBeforeMs = 0;
  }
  if (!('supabaseLastHydrateError' in runtimeState)) {
    runtimeState.supabaseLastHydrateError = '';
  }
  if (!('supabaseLastPersistError' in runtimeState)) {
    runtimeState.supabaseLastPersistError = '';
  }
  if (!('supabaseLastCallUpdatePersistError' in runtimeState)) {
    runtimeState.supabaseLastCallUpdatePersistError = '';
  }
  if (!('runtimeStateObservedAtMs' in runtimeState)) {
    runtimeState.runtimeStateObservedAtMs = 0;
  }
  if (!('runtimeStateLastSupabaseSyncCheckMs' in runtimeState)) {
    runtimeState.runtimeStateLastSupabaseSyncCheckMs = 0;
  }
  if (!('supabaseCallUpdatesLastSyncCheckMs' in runtimeState)) {
    runtimeState.supabaseCallUpdatesLastSyncCheckMs = 0;
  }
  if (!('dismissedLeadsLastHydrateAtMs' in runtimeState)) {
    runtimeState.dismissedLeadsLastHydrateAtMs = 0;
  }
  if (!('nextLeadOwnerRotationIndex' in runtimeState)) {
    runtimeState.nextLeadOwnerRotationIndex = 0;
  }
  if (!('nextGeneratedAgendaAppointmentId' in runtimeState)) {
    runtimeState.nextGeneratedAgendaAppointmentId = 100000;
  }

  function logError(...args) {
    if (logger && typeof logger.error === 'function') {
      logger.error(...args);
    }
  }

  function logInfo(...args) {
    if (logger && typeof logger.log === 'function') {
      logger.log(...args);
    }
  }

  async function awaitWithTimeout(promise, timeoutMs, errorMessage) {
    const safeTimeoutMs = Math.max(1000, Math.min(120000, Number(timeoutMs) || 12000));
    let timeoutId = null;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(errorMessage || `Timeout na ${Math.round(safeTimeoutMs / 1000)}s`));
          }, safeTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function getRuntimeSnapshotItemTimestampMs(item) {
    const explicitMs = Number(item?.updatedAtMs || 0);
    if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;

    const candidateFields = [
      item?.updatedAt,
      item?.analyzedAt,
      item?.receivedAt,
      item?.endedAt,
      item?.startedAt,
      item?.createdAt,
      item?.confirmationEmailSentAt,
      item?.confirmationResponseReceivedAt,
      item?.confirmationAppointmentCancelledAt,
      item?.postCallUpdatedAt,
    ];

    for (const candidate of candidateFields) {
      const parsedMs = Date.parse(normalizeString(candidate || ''));
      if (Number.isFinite(parsedMs) && parsedMs > 0) return parsedMs;
    }

    return 0;
  }

  function chooseRuntimeSnapshotValue(primaryValue, fallbackValue) {
    if (primaryValue === undefined || primaryValue === null) return fallbackValue;
    if (typeof primaryValue === 'string') {
      return primaryValue.trim() ? primaryValue : fallbackValue;
    }
    if (Array.isArray(primaryValue)) {
      return primaryValue.length > 0
        ? primaryValue.slice()
        : Array.isArray(fallbackValue)
          ? fallbackValue.slice()
          : primaryValue.slice();
    }
    return primaryValue;
  }

  function mergeRuntimeSnapshotObjects(primary, fallback) {
    const safePrimary = primary && typeof primary === 'object' ? primary : {};
    const safeFallback = fallback && typeof fallback === 'object' ? fallback : {};
    const merged = { ...safeFallback };
    const keys = new Set([...Object.keys(safeFallback), ...Object.keys(safePrimary)]);
    keys.forEach((key) => {
      merged[key] = chooseRuntimeSnapshotValue(safePrimary[key], safeFallback[key]);
    });
    return merged;
  }

  function mergeRuntimeSnapshotArraysByKey(localItems, remoteItems, keyFn, limit = 500) {
    const mergedByKey = new Map();
    const append = (items) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const key = normalizeString(keyFn(item) || '');
        if (!key) return;
        const existing = mergedByKey.get(key) || null;
        if (!existing) {
          mergedByKey.set(key, item);
          return;
        }
        const existingTs = getRuntimeSnapshotItemTimestampMs(existing);
        const incomingTs = getRuntimeSnapshotItemTimestampMs(item);
        const primary = incomingTs >= existingTs ? item : existing;
        const fallback = incomingTs >= existingTs ? existing : item;
        mergedByKey.set(key, mergeRuntimeSnapshotObjects(primary, fallback));
      });
    };

    append(remoteItems);
    append(localItems);

    return Array.from(mergedByKey.values())
      .sort((a, b) => getRuntimeSnapshotItemTimestampMs(b) - getRuntimeSnapshotItemTimestampMs(a))
      .slice(0, limit);
  }

  function mergeRuntimeSnapshotPayloads(localPayload, remotePayload) {
    const safeLocal = localPayload && typeof localPayload === 'object' ? localPayload : {};
    const safeRemote = remotePayload && typeof remotePayload === 'object' ? remotePayload : {};
    const localLeadOwnerAssignments = (
      Array.isArray(safeLocal.leadOwnerAssignments) ? safeLocal.leadOwnerAssignments : []
    )
      .map((item) => ({
        callId: normalizeString(item?.callId || ''),
        owner: normalizeLeadOwnerRecord(item?.owner || {}),
      }))
      .filter((item) => item.callId && item.owner);
    const remoteLeadOwnerAssignments = (
      Array.isArray(safeRemote.leadOwnerAssignments) ? safeRemote.leadOwnerAssignments : []
    )
      .map((item) => ({
        callId: normalizeString(item?.callId || ''),
        owner: normalizeLeadOwnerRecord(item?.owner || {}),
      }))
      .filter((item) => item.callId && item.owner);
    const localGeneratedAgendaAppointments = (
      Array.isArray(safeLocal.generatedAgendaAppointments) ? safeLocal.generatedAgendaAppointments : []
    )
      .map(compactRuntimeSnapshotGeneratedAgendaAppointment)
      .filter(Boolean);
    const remoteGeneratedAgendaAppointments = (
      Array.isArray(safeRemote.generatedAgendaAppointments) ? safeRemote.generatedAgendaAppointments : []
    )
      .map(compactRuntimeSnapshotGeneratedAgendaAppointment)
      .filter(Boolean);
    const localWebhookEvents = (
      Array.isArray(safeLocal.recentWebhookEvents) ? safeLocal.recentWebhookEvents : []
    ).map(compactRuntimeSnapshotWebhookEvent);
    const remoteWebhookEvents = (
      Array.isArray(safeRemote.recentWebhookEvents) ? safeRemote.recentWebhookEvents : []
    ).map(compactRuntimeSnapshotWebhookEvent);
    const localCallUpdates = (
      Array.isArray(safeLocal.recentCallUpdates) ? safeLocal.recentCallUpdates : []
    )
      .map(compactRuntimeSnapshotCallUpdate)
      .filter((item) => normalizeString(item?.callId || ''));
    const remoteCallUpdates = (
      Array.isArray(safeRemote.recentCallUpdates) ? safeRemote.recentCallUpdates : []
    )
      .map(compactRuntimeSnapshotCallUpdate)
      .filter((item) => normalizeString(item?.callId || ''));
    const localAiCallInsights = (
      Array.isArray(safeLocal.recentAiCallInsights) ? safeLocal.recentAiCallInsights : []
    )
      .map(compactRuntimeSnapshotAiInsight)
      .filter((item) => normalizeString(item?.callId || ''));
    const remoteAiCallInsights = (
      Array.isArray(safeRemote.recentAiCallInsights) ? safeRemote.recentAiCallInsights : []
    )
      .map(compactRuntimeSnapshotAiInsight)
      .filter((item) => normalizeString(item?.callId || ''));
    const localDashboardActivities = (
      Array.isArray(safeLocal.recentDashboardActivities) ? safeLocal.recentDashboardActivities : []
    )
      .map(compactRuntimeSnapshotDashboardActivity)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const remoteDashboardActivities = (
      Array.isArray(safeRemote.recentDashboardActivities) ? safeRemote.recentDashboardActivities : []
    )
      .map(compactRuntimeSnapshotDashboardActivity)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const localSecurityAuditEvents = (
      Array.isArray(safeLocal.recentSecurityAuditEvents) ? safeLocal.recentSecurityAuditEvents : []
    )
      .map(compactRuntimeSnapshotSecurityAuditEvent)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const remoteSecurityAuditEvents = (
      Array.isArray(safeRemote.recentSecurityAuditEvents) ? safeRemote.recentSecurityAuditEvents : []
    )
      .map(compactRuntimeSnapshotSecurityAuditEvent)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const remoteDismissedCallIds = (
      Array.isArray(safeRemote.dismissedInterestedLeadCallIds)
        ? safeRemote.dismissedInterestedLeadCallIds
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const localDismissedCallIds = (
      Array.isArray(safeLocal.dismissedInterestedLeadCallIds)
        ? safeLocal.dismissedInterestedLeadCallIds
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const remoteDismissedLeadKeys = (
      Array.isArray(safeRemote.dismissedInterestedLeadKeys)
        ? safeRemote.dismissedInterestedLeadKeys
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const localDismissedLeadKeys = (
      Array.isArray(safeLocal.dismissedInterestedLeadKeys)
        ? safeLocal.dismissedInterestedLeadKeys
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const localDismissedLeadKeyUpdatedAtMsByKey =
      safeLocal.dismissedInterestedLeadKeyUpdatedAtMsByKey &&
      typeof safeLocal.dismissedInterestedLeadKeyUpdatedAtMsByKey === 'object'
        ? safeLocal.dismissedInterestedLeadKeyUpdatedAtMsByKey
        : safeLocal.dismissedLeadKeyUpdatedAtMsByKey && typeof safeLocal.dismissedLeadKeyUpdatedAtMsByKey === 'object'
          ? safeLocal.dismissedLeadKeyUpdatedAtMsByKey
          : {};
    const remoteDismissedLeadKeyUpdatedAtMsByKey =
      safeRemote.dismissedInterestedLeadKeyUpdatedAtMsByKey &&
      typeof safeRemote.dismissedInterestedLeadKeyUpdatedAtMsByKey === 'object'
        ? safeRemote.dismissedInterestedLeadKeyUpdatedAtMsByKey
        : safeRemote.dismissedLeadKeyUpdatedAtMsByKey &&
            typeof safeRemote.dismissedLeadKeyUpdatedAtMsByKey === 'object'
          ? safeRemote.dismissedLeadKeyUpdatedAtMsByKey
          : {};

    const leadOwnerAssignments = mergeRuntimeSnapshotArraysByKey(
      localLeadOwnerAssignments,
      remoteLeadOwnerAssignments,
      (item) => item?.callId || '',
      5000
    );

    const mergedAppointments = mergeRuntimeSnapshotArraysByKey(
      localGeneratedAgendaAppointments,
      remoteGeneratedAgendaAppointments,
      (item) => String(item?.id || item?.callId || ''),
      5000
    );

    const mergedWebhookEvents = mergeRuntimeSnapshotArraysByKey(
      localWebhookEvents,
      remoteWebhookEvents,
      (item) =>
        `${normalizeString(item?.receivedAt || '')}|${normalizeString(item?.messageType || '')}|${normalizeString(item?.callId || '')}`,
      80
    );

    const mergedCallUpdates = mergeRuntimeSnapshotArraysByKey(
      localCallUpdates,
      remoteCallUpdates,
      (item) => item?.callId || '',
      500
    );

    const mergedAiCallInsights = mergeRuntimeSnapshotArraysByKey(
      localAiCallInsights,
      remoteAiCallInsights,
      (item) => item?.callId || '',
      500
    );

    const mergedDashboardActivities = mergeRuntimeSnapshotArraysByKey(
      localDashboardActivities,
      remoteDashboardActivities,
      (item) => item?.id || '',
      500
    );

    const mergedSecurityAuditEvents = mergeRuntimeSnapshotArraysByKey(
      localSecurityAuditEvents,
      remoteSecurityAuditEvents,
      (item) => item?.id || '',
      500
    );

    const mergedDismissedCallIds = Array.from(
      new Set([...remoteDismissedCallIds, ...localDismissedCallIds].filter(Boolean))
    ).slice(0, 1000);
    const mergedDismissedLeadKeys = Array.from(
      new Set([...remoteDismissedLeadKeys, ...localDismissedLeadKeys].filter(Boolean))
    ).slice(0, 2000);
    const mergedDismissedLeadKeyUpdatedAtMsByKey = Object.fromEntries(
      mergedDismissedLeadKeys
        .map((leadKey) => {
          const localMs = Number(localDismissedLeadKeyUpdatedAtMsByKey?.[leadKey] || 0);
          const remoteMs = Number(remoteDismissedLeadKeyUpdatedAtMsByKey?.[leadKey] || 0);
          const nextMs = Math.max(localMs, remoteMs);
          return [leadKey, Number.isFinite(nextMs) && nextMs > 0 ? Math.round(nextMs) : 0];
        })
        .filter(([, updatedAtMs]) => Number.isFinite(updatedAtMs) && updatedAtMs > 0)
    );

    return {
      version: Math.max(Number(safeLocal.version || 0), Number(safeRemote.version || 0), 5),
      savedAt: new Date().toISOString(),
      recentWebhookEvents: mergedWebhookEvents,
      recentCallUpdates: mergedCallUpdates,
      recentAiCallInsights: mergedAiCallInsights,
      recentDashboardActivities: mergedDashboardActivities,
      recentSecurityAuditEvents: mergedSecurityAuditEvents,
      generatedAgendaAppointments: mergedAppointments,
      dismissedInterestedLeadCallIds: mergedDismissedCallIds,
      dismissedInterestedLeadKeys: mergedDismissedLeadKeys,
      dismissedInterestedLeadKeyUpdatedAtMsByKey: mergedDismissedLeadKeyUpdatedAtMsByKey,
      leadOwnerAssignments,
      nextLeadOwnerRotationIndex: Math.max(
        0,
        Number(safeLocal.nextLeadOwnerRotationIndex || 0),
        Number(safeRemote.nextLeadOwnerRotationIndex || 0)
      ),
      nextGeneratedAgendaAppointmentId: Math.max(
        100000,
        Number(safeLocal.nextGeneratedAgendaAppointmentId || 0),
        Number(safeRemote.nextGeneratedAgendaAppointmentId || 0),
        ...mergedAppointments
          .map((item) => Number(item?.id || 0) + 1)
          .filter((value) => Number.isFinite(value) && value > 0)
      ),
    };
  }

  function resolveRuntimeStateVersionMs(updatedAt = '', payload = null) {
    const candidates = [normalizeString(updatedAt), normalizeString(payload?.savedAt || '')];
    for (const candidate of candidates) {
      const parsedMs = Date.parse(candidate);
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        return parsedMs;
      }
    }
    return 0;
  }

  function markRuntimeStateObserved(atMs = Date.now()) {
    const nextMs = Number(atMs);
    runtimeState.runtimeStateObservedAtMs =
      Number.isFinite(nextMs) && nextMs > 0
        ? Math.max(runtimeState.runtimeStateObservedAtMs, nextMs)
        : Math.max(runtimeState.runtimeStateObservedAtMs, Date.now());
  }

  function markRuntimeStateSynced(atMs = Date.now()) {
    runtimeState.runtimeStateObservedAtMs =
      Number.isFinite(Number(atMs)) && Number(atMs) > 0 ? Number(atMs) : Date.now();
    runtimeState.runtimeStateLastSupabaseSyncCheckMs = Date.now();
  }

  function applyRuntimeStateSnapshotPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object') return false;

    const nextWebhookEvents = Array.isArray(payload.recentWebhookEvents)
      ? payload.recentWebhookEvents.slice(0, 200).map(compactRuntimeSnapshotWebhookEvent)
      : [];
    const nextCallUpdates = Array.isArray(payload.recentCallUpdates)
      ? payload.recentCallUpdates
          .slice(0, 500)
          .map(compactRuntimeSnapshotCallUpdate)
          .filter((item) => normalizeString(item?.callId || ''))
      : [];
    const nextAiCallInsights = Array.isArray(payload.recentAiCallInsights)
      ? payload.recentAiCallInsights
          .slice(0, 500)
          .map(compactRuntimeSnapshotAiInsight)
          .filter((item) => normalizeString(item?.callId || ''))
      : [];
    const nextDashboardActivities = Array.isArray(payload.recentDashboardActivities)
      ? payload.recentDashboardActivities
          .slice(0, 500)
          .map(compactRuntimeSnapshotDashboardActivity)
          .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''))
      : [];
    const nextSecurityAuditEvents = Array.isArray(payload.recentSecurityAuditEvents)
      ? payload.recentSecurityAuditEvents
          .slice(0, 500)
          .map(compactRuntimeSnapshotSecurityAuditEvent)
          .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''))
      : [];
    const nextAppointments = Array.isArray(payload.generatedAgendaAppointments)
      ? payload.generatedAgendaAppointments
          .slice()
          .map(compactRuntimeSnapshotGeneratedAgendaAppointment)
          .filter(Boolean)
      : [];
    const nextDismissedInterestedLeadCallIds = Array.isArray(payload.dismissedInterestedLeadCallIds)
      ? payload.dismissedInterestedLeadCallIds.slice(0, 1000)
      : [];
    const nextDismissedInterestedLeadKeys = Array.isArray(payload.dismissedInterestedLeadKeys)
      ? payload.dismissedInterestedLeadKeys.slice(0, 2000)
      : [];
    const defaultDismissedLeadKeyUpdatedAtMs = resolveRuntimeStateVersionMs(options?.updatedAt || '', payload);
    const rawDismissedLeadKeyUpdatedAtMsByKey =
      payload.dismissedInterestedLeadKeyUpdatedAtMsByKey &&
      typeof payload.dismissedInterestedLeadKeyUpdatedAtMsByKey === 'object'
        ? payload.dismissedInterestedLeadKeyUpdatedAtMsByKey
        : {};
    const nextLeadOwnerAssignments = Array.isArray(payload.leadOwnerAssignments)
      ? payload.leadOwnerAssignments.slice(0, 5000)
      : [];

    recentWebhookEvents.splice(0, recentWebhookEvents.length, ...nextWebhookEvents);

    recentCallUpdates.splice(0, recentCallUpdates.length, ...nextCallUpdates);
    callUpdatesById.clear();
    recentCallUpdates.forEach((item) => {
      const callId = normalizeString(item?.callId || '');
      if (callId) {
        callUpdatesById.set(callId, item);
      }
    });

    recentAiCallInsights.splice(0, recentAiCallInsights.length, ...nextAiCallInsights);
    aiCallInsightsByCallId.clear();
    recentAiCallInsights.forEach((item) => {
      const callId = normalizeString(item?.callId || '');
      if (callId) {
        aiCallInsightsByCallId.set(callId, item);
      }
    });

    recentDashboardActivities.splice(0, recentDashboardActivities.length, ...nextDashboardActivities);
    recentSecurityAuditEvents.splice(0, recentSecurityAuditEvents.length, ...nextSecurityAuditEvents);

    generatedAgendaAppointments.splice(0, generatedAgendaAppointments.length, ...nextAppointments);
    agendaAppointmentIdByCallId.clear();
    nextDismissedInterestedLeadCallIds.forEach((item) => {
      const callId = normalizeString(item);
      if (callId) dismissedInterestedLeadCallIds.add(callId);
    });
    nextDismissedInterestedLeadKeys.forEach((item) => {
      const leadKey = normalizeString(item);
      if (leadKey) dismissedInterestedLeadKeys.add(leadKey);
      const updatedAtMs = Number(rawDismissedLeadKeyUpdatedAtMsByKey?.[leadKey] || defaultDismissedLeadKeyUpdatedAtMs || 0);
      if (leadKey && Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
        const currentMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(leadKey) || 0);
        if (updatedAtMs >= currentMs) {
          dismissedInterestedLeadKeyUpdatedAtMsByKey.set(leadKey, Math.round(updatedAtMs));
        }
      }
    });
    if (dismissedInterestedLeadCallIds.size > 1000) {
      const excess = Array.from(dismissedInterestedLeadCallIds).slice(0, dismissedInterestedLeadCallIds.size - 1000);
      excess.forEach((id) => dismissedInterestedLeadCallIds.delete(id));
    }
    if (dismissedInterestedLeadKeys.size > 2000) {
      const excess = Array.from(dismissedInterestedLeadKeys).slice(0, dismissedInterestedLeadKeys.size - 2000);
      excess.forEach((key) => {
        dismissedInterestedLeadKeys.delete(key);
        dismissedInterestedLeadKeyUpdatedAtMsByKey.delete(key);
      });
    }
    leadOwnerAssignmentsByCallId.clear();
    nextLeadOwnerAssignments.forEach((item) => {
      const callId = normalizeString(item?.callId || '');
      const owner = normalizeLeadOwnerRecord(item?.owner || item);
      if (callId && owner) {
        leadOwnerAssignmentsByCallId.set(callId, owner);
      }
    });
    let maxAppointmentId = 99999;
    generatedAgendaAppointments.forEach((item) => {
      const id = Number(item?.id);
      const callId = normalizeString(item?.callId || '');
      if (Number.isFinite(id) && id > maxAppointmentId) maxAppointmentId = id;
      if (Number.isFinite(id) && callId) {
        agendaAppointmentIdByCallId.set(callId, id);
      }
    });

    const payloadNextId = Number(payload.nextGeneratedAgendaAppointmentId);
    const payloadLeadOwnerRotationIndex = Number(payload.nextLeadOwnerRotationIndex);
    runtimeState.nextLeadOwnerRotationIndex = Number.isFinite(payloadLeadOwnerRotationIndex)
      ? Math.max(0, payloadLeadOwnerRotationIndex)
      : 0;
    runtimeState.nextGeneratedAgendaAppointmentId = Number.isFinite(payloadNextId)
      ? Math.max(payloadNextId, maxAppointmentId + 1)
      : maxAppointmentId + 1;
    markRuntimeStateSynced(resolveRuntimeStateVersionMs(options?.updatedAt || '', payload));

    return true;
  }

  async function fetchSupabaseCallUpdateRows(limit = supabaseCallUpdateRowsFetchLimit) {
    if (!isSupabaseConfigured()) {
      return { ok: false, status: null, rows: [], error: 'Supabase niet geconfigureerd.' };
    }

    const safeLimit = Math.max(
      1,
      Math.min(2000, Number(limit) || supabaseCallUpdateRowsFetchLimit)
    );
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(supabaseStateTable)
          .select('state_key,payload,updated_at')
          .like('state_key', `${supabaseCallUpdateStateKeyPrefix}%`)
          .order('updated_at', { ascending: false })
          .limit(safeLimit);
        if (!error) {
          return {
            ok: true,
            status: 200,
            rows: Array.isArray(data) ? data : [],
            error: null,
          };
        }
      } catch {
        // Val terug op REST wanneer client query faalt.
      }
    }

    const fallback = await fetchSupabaseCallUpdateRowsViaRest(safeLimit);
    return {
      ok: Boolean(fallback.ok),
      status: fallback.status,
      rows: Array.isArray(fallback.body) ? fallback.body : [],
      error: fallback.error || null,
    };
  }

  async function ensureRuntimeStateHydratedFromSupabase(options = {}) {
    const force = Boolean(options && options.force);
    if (!isSupabaseConfigured()) return false;
    if (runtimeState.supabaseStateHydrated) return true;
    if (runtimeState.supabaseStateHydrationPromise) return runtimeState.supabaseStateHydrationPromise;
    if (!force && Date.now() < runtimeState.supabaseHydrateRetryNotBeforeMs) return false;

    runtimeState.supabaseStateHydrationPromise = (async () => {
      try {
        const client = getSupabaseClient();
        if (!client) return false;

        const { data, error } = await client
          .from(supabaseStateTable)
          .select('payload, updated_at')
          .eq('state_key', supabaseStateKey)
          .maybeSingle();

        if (error) {
          const fallback = await fetchSupabaseStateRowViaRest('payload,updated_at');
          if (!fallback.ok) {
            logError('[Supabase][HydrateError]', error.message || error);
            const fallbackMsg = fallback.error
              ? ` | REST fallback: ${fallback.error}`
              : fallback.status
                ? ` | REST fallback status: ${fallback.status}`
                : '';
            runtimeState.supabaseLastHydrateError = truncateText(
              `${error.message || String(error)}${fallbackMsg}`,
              500
            );
            runtimeState.supabaseHydrateRetryNotBeforeMs = Date.now() + 60_000;
            return false;
          }

          const row = Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
          if (row && row.payload && typeof row.payload === 'object') {
            applyRuntimeStateSnapshotPayload(row.payload, { updatedAt: row.updated_at || '' });
          }
          await syncCallUpdatesFromSupabaseRows({ force: true, maxAgeMs: 0 });
          await hydrateDismissedLeadsFromSupabase();
          runtimeState.supabaseStateHydrated = true;
          runtimeState.supabaseLastHydrateError = '';
          runtimeState.supabaseHydrateRetryNotBeforeMs = 0;
          return true;
        }

        if (data && data.payload && typeof data.payload === 'object') {
          applyRuntimeStateSnapshotPayload(data.payload, { updatedAt: data.updated_at || '' });
          logInfo(
            '[Supabase] Runtime state geladen',
            JSON.stringify({
              table: supabaseStateTable,
              stateKey: supabaseStateKey,
              updatedAt: data.updated_at || null,
              callUpdates: recentCallUpdates.length,
              insights: recentAiCallInsights.length,
              dashboardActivities: recentDashboardActivities.length,
              appointments: generatedAgendaAppointments.length,
            })
          );
        }

        await syncCallUpdatesFromSupabaseRows({ force: true, maxAgeMs: 0 });
        await hydrateDismissedLeadsFromSupabase();

        runtimeState.supabaseStateHydrated = true;
        runtimeState.supabaseLastHydrateError = '';
        runtimeState.supabaseHydrateRetryNotBeforeMs = 0;
        return true;
      } catch (error) {
        logError('[Supabase][HydrateCrash]', error?.message || error);
        runtimeState.supabaseLastHydrateError = truncateText(error?.message || String(error), 500);
        runtimeState.supabaseHydrateRetryNotBeforeMs = Date.now() + 60_000;
        return false;
      } finally {
        runtimeState.supabaseStateHydrationPromise = null;
      }
    })();

    return runtimeState.supabaseStateHydrationPromise;
  }

  async function forceHydrateRuntimeStateWithRetries(maxAttempts = 3) {
    if (!isSupabaseConfigured()) return false;
    if (runtimeState.supabaseStateHydrated) return true;

    const attempts = Math.max(1, Math.min(5, Number(maxAttempts) || 1));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      runtimeState.supabaseHydrateRetryNotBeforeMs = 0;
      const ok = await ensureRuntimeStateHydratedFromSupabase({ force: true });
      if (ok) return true;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    return false;
  }

  async function persistRuntimeStateToSupabase(reason = 'unknown') {
    if (!isSupabaseConfigured()) return false;
    try {
      const client = getSupabaseClient();
      if (!client) return false;

      async function persistRow(row) {
        let error = null;
        try {
          const result = await awaitWithTimeout(
            client.from(supabaseStateTable).upsert(row, {
              onConflict: 'state_key',
            }),
            supabaseClientPersistTimeoutMs,
            `Supabase client persist timeout na ${Math.round(Math.max(1000, Math.min(60000, Number(supabaseClientPersistTimeoutMs) || 12000)) / 1000)}s`
          );
          error = result?.error || null;
        } catch (persistError) {
          error = persistError;
        }

        if (!error) {
          return { ok: true, source: 'client', error: null };
        }

        const fallback = await upsertSupabaseStateRowViaRest(row);
        if (fallback.ok) {
          return { ok: true, source: 'rest', error: null };
        }

        const fallbackMsg = fallback.error
          ? ` | REST fallback: ${fallback.error}`
          : fallback.status
            ? ` | REST fallback status: ${fallback.status}`
            : '';
        return {
          ok: false,
          source: 'none',
          error: truncateText(`${error.message || String(error)}${fallbackMsg}`, 500),
        };
      }

      let payload = buildRuntimeStateSnapshotPayloadWithLimits();
      const remoteSnapshot = await awaitWithTimeout(
        fetchSupabaseStateRowViaRest('payload,updated_at'),
        supabaseClientPersistTimeoutMs,
        `Supabase snapshot fetch timeout na ${Math.round(Math.max(1000, Math.min(60000, Number(supabaseClientPersistTimeoutMs) || 12000)) / 1000)}s`
      ).catch((error) => ({
        ok: false,
        status: null,
        body: null,
        error: truncateText(error?.message || String(error), 500),
      }));
      if (remoteSnapshot.ok) {
        const remoteRow = Array.isArray(remoteSnapshot.body)
          ? remoteSnapshot.body[0] || null
          : remoteSnapshot.body;
        if (remoteRow?.payload && typeof remoteRow.payload === 'object') {
          payload = mergeRuntimeSnapshotPayloads(payload, remoteRow.payload);
        }
      }
      const row = {
        state_key: supabaseStateKey,
        payload,
        updated_at: new Date().toISOString(),
        meta: {
          reason,
          counts: {
            webhookEvents: recentWebhookEvents.length,
            callUpdates: recentCallUpdates.length,
            aiCallInsights: recentAiCallInsights.length,
            dashboardActivities: recentDashboardActivities.length,
            securityAuditEvents: recentSecurityAuditEvents.length,
            appointments: generatedAgendaAppointments.length,
          },
        },
      };

      const primaryPersist = await persistRow(row);
      if (primaryPersist.ok) {
        runtimeState.supabaseLastPersistError = '';
        runtimeState.supabaseStateHydrated = true;
        markRuntimeStateSynced(resolveRuntimeStateVersionMs(row.updated_at, row.payload));
        return true;
      }

      const compactPayload = buildRuntimeStateSnapshotPayloadWithLimits({
        maxWebhookEvents: 40,
        maxCallUpdates: 180,
        maxAiCallInsights: 180,
        maxDashboardActivities: 220,
        maxSecurityAuditEvents: 200,
        maxAgendaAppointments: 1200,
        maxDismissedCallIds: 700,
        maxLeadOwnerAssignments: 2000,
      });
      const compactRow = {
        ...row,
        payload: compactPayload,
        updated_at: new Date().toISOString(),
        meta: {
          ...(row.meta && typeof row.meta === 'object' ? row.meta : {}),
          reason: `${reason}:compact_retry`,
        },
      };
      const compactPersist = await persistRow(compactRow);
      if (compactPersist.ok) {
        runtimeState.supabaseLastPersistError = '';
        runtimeState.supabaseStateHydrated = true;
        markRuntimeStateSynced(resolveRuntimeStateVersionMs(compactRow.updated_at, compactRow.payload));
        return true;
      }

      const combinedError = truncateText(
        `primary=${primaryPersist.error || 'onbekend'} | compact=${compactPersist.error || 'onbekend'}`,
        500
      );
      logError('[Supabase][PersistError]', combinedError);
      runtimeState.supabaseLastPersistError = combinedError;
      return false;
    } catch (error) {
      logError('[Supabase][PersistCrash]', error?.message || error);
      runtimeState.supabaseLastPersistError = truncateText(error?.message || String(error), 500);
      return false;
    }
  }

  function queueRuntimeStatePersist(reason = 'unknown') {
    markRuntimeStateObserved();
    if (!isSupabaseConfigured()) return Promise.resolve(false);

    runtimeState.supabasePersistChain = runtimeState.supabasePersistChain
      .catch(() => null)
      .then(() => persistRuntimeStateToSupabase(reason))
      .catch((error) => {
        logError('[Supabase][PersistQueueError]', error?.message || error);
        return false;
      });

    return runtimeState.supabasePersistChain;
  }

  async function waitForQueuedRuntimeSnapshotPersist() {
    if (!isSupabaseConfigured()) return true;
    const primaryTimeoutMs = Math.max(1000, Math.min(120000, Number(queuedRuntimePersistAwaitTimeoutMs) || 60000));
    const primaryErrorMsg = `Wachten op gedeelde agenda-opslag duurde langer dan ${Math.round(primaryTimeoutMs / 1000)}s`;
    try {
      return Boolean(await awaitWithTimeout(runtimeState.supabasePersistChain, primaryTimeoutMs, primaryErrorMsg));
    } catch (error) {
      logError('[Supabase][RuntimePersistAwaitError]', error?.message || error);
      runtimeState.supabaseLastPersistError = truncateText(error?.message || String(error), 500);
      // Na timeout kan de keten alsnog succesvol aflopen; één extra wachtronde voorkomt valse 503's.
      // Bij korte timeouts (contracttests) blijft de tail beperkt zodat tests niet minuten hangen.
      const tailMs =
        primaryTimeoutMs < 15000
          ? Math.max(250, Math.min(5000, primaryTimeoutMs * 50))
          : Math.max(primaryTimeoutMs, 45000);
      const tailErrorMsg = `Persist-keten na timeout niet binnen ${Math.max(1, Math.round(tailMs / 1000))}s afgewacht`;
      try {
        const recovered = Boolean(await awaitWithTimeout(runtimeState.supabasePersistChain, tailMs, tailErrorMsg));
        if (recovered) {
          runtimeState.supabaseLastPersistError = '';
          return true;
        }
      } catch (tailError) {
        logError('[Supabase][RuntimePersistAwaitTailError]', tailError?.message || tailError);
        const tailMsg = truncateText(tailError?.message || String(tailError), 400);
        const prev = truncateText(runtimeState.supabaseLastPersistError || '', 400);
        runtimeState.supabaseLastPersistError = truncateText(
          prev ? `${prev} | tail: ${tailMsg}` : tailMsg,
          500
        );
      }
      return false;
    }
  }

  async function waitForQueuedRuntimeStatePersist() {
    if (!isSupabaseConfigured()) return false;
    try {
      const runtimePersistOk = await waitForQueuedRuntimeSnapshotPersist();
      const callUpdatePersistOk = await waitForQueuedCallUpdateRowPersist();
      return runtimePersistOk && callUpdatePersistOk;
    } catch (error) {
      logError('[Supabase][PersistAwaitError]', error?.message || error);
      return false;
    }
  }

  function buildCallUpdateRowPersistMeta(callUpdate, reason = 'call_update_row') {
    return {
      reason: truncateText(normalizeString(reason || ''), 80) || 'call_update_row',
      callId: truncateText(normalizeString(callUpdate?.callId || ''), 140),
      status: truncateText(normalizeString(callUpdate?.status || ''), 80),
      provider: truncateText(normalizeString(callUpdate?.provider || ''), 40),
      updatedAt: normalizeString(callUpdate?.updatedAt || '') || new Date().toISOString(),
    };
  }

  async function persistSingleCallUpdateRowToSupabase(callUpdate, reason = 'call_update_row') {
    if (!isSupabaseConfigured()) return false;
    const compact = compactRuntimeSnapshotCallUpdate(callUpdate || {});
    const callId = normalizeString(compact?.callId || '');
    if (!callId || callId.startsWith('demo-')) return false;

    const stateKey = buildSupabaseCallUpdateStateKey(callId);
    if (!stateKey) return false;

    const payload = buildSupabaseCallUpdatePayload(compact, reason);
    if (!payload) return false;

    const updatedAt = normalizeString(compact?.updatedAt || '') || new Date().toISOString();
    const row = {
      state_key: stateKey,
      payload,
      updated_at: updatedAt,
      meta: buildCallUpdateRowPersistMeta(compact, reason),
    };

    const client = getSupabaseClient();
    if (client) {
      try {
        const result = await awaitWithTimeout(
          client.from(supabaseStateTable).upsert(row, {
            onConflict: 'state_key',
          }),
          supabaseClientPersistTimeoutMs,
          `Supabase call-update persist timeout na ${Math.round(Math.max(1000, Math.min(60000, Number(supabaseClientPersistTimeoutMs) || 12000)) / 1000)}s`
        );
        const error = result?.error || null;
        if (!error) {
          runtimeState.supabaseLastCallUpdatePersistError = '';
          return true;
        }
        const fallback = await upsertSupabaseRowViaRest(row);
        if (fallback.ok) {
          runtimeState.supabaseLastCallUpdatePersistError = '';
          return true;
        }
        const fallbackMsg = fallback.error
          ? ` | REST fallback: ${fallback.error}`
          : fallback.status
            ? ` | REST fallback status: ${fallback.status}`
            : '';
        runtimeState.supabaseLastCallUpdatePersistError = truncateText(
          `${error.message || String(error)}${fallbackMsg}`,
          500
        );
        return false;
      } catch (error) {
        const fallback = await upsertSupabaseRowViaRest(row);
        if (fallback.ok) {
          runtimeState.supabaseLastCallUpdatePersistError = '';
          return true;
        }
        const fallbackMsg = fallback.error
          ? ` | REST fallback: ${fallback.error}`
          : fallback.status
            ? ` | REST fallback status: ${fallback.status}`
            : '';
        runtimeState.supabaseLastCallUpdatePersistError = truncateText(
          `${error?.message || String(error)}${fallbackMsg}`,
          500
        );
        return false;
      }
    }

    const fallback = await upsertSupabaseRowViaRest(row);
    if (fallback.ok) {
      runtimeState.supabaseLastCallUpdatePersistError = '';
      return true;
    }
    runtimeState.supabaseLastCallUpdatePersistError = truncateText(
      fallback.error || `REST fallback status: ${fallback.status || 'onbekend'}`,
      500
    );
    return false;
  }

  function queueCallUpdateRowPersist(callUpdate, reason = 'call_update_row') {
    if (!isSupabaseConfigured()) return Promise.resolve(false);
    const callId = normalizeString(callUpdate?.callId || '');
    if (!callId || callId.startsWith('demo-')) return Promise.resolve(false);

    runtimeState.supabaseCallUpdatePersistChain = runtimeState.supabaseCallUpdatePersistChain
      .catch(() => null)
      .then(() => persistSingleCallUpdateRowToSupabase(callUpdate, reason))
      .catch((error) => {
        runtimeState.supabaseLastCallUpdatePersistError = truncateText(
          error?.message || String(error),
          500
        );
        return false;
      });

    return runtimeState.supabaseCallUpdatePersistChain;
  }

  async function waitForQueuedCallUpdateRowPersist() {
    if (!isSupabaseConfigured()) return false;
    try {
      return Boolean(await runtimeState.supabaseCallUpdatePersistChain);
    } catch (error) {
      logError('[Supabase][CallUpdatePersistAwaitError]', error?.message || error);
      return false;
    }
  }

  function mergeCallUpdatesFromSupabaseRows(rows = []) {
    let touched = 0;
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const callUpdate = extractSupabaseCallUpdateFromRow(row);
      if (!callUpdate) return;
      const before = callUpdatesById.get(callUpdate.callId) || null;
      const after = upsertRecentCallUpdate(callUpdate, {
        persistRuntimeState: false,
        persistCallUpdateRow: false,
      });
      if (!after) return;
      const beforeMs = getRuntimeSnapshotItemTimestampMs(before || {});
      const afterMs = getRuntimeSnapshotItemTimestampMs(after || {});
      if (!before || afterMs > beforeMs) {
        touched += 1;
      }
    });
    return touched;
  }

  async function syncCallUpdatesFromSupabaseRows(options = {}) {
    if (!isSupabaseConfigured()) return false;

    const force = Boolean(options?.force);
    const maxAgeMs = Math.max(
      0,
      parseNumberSafe(options?.maxAgeMs, runtimeStateSupabaseSyncCooldownMs) ||
        runtimeStateSupabaseSyncCooldownMs
    );
    const nowMs = Date.now();

    if (
      !force &&
      runtimeState.supabaseCallUpdatesLastSyncCheckMs > 0 &&
      nowMs - runtimeState.supabaseCallUpdatesLastSyncCheckMs < maxAgeMs
    ) {
      return false;
    }

    await waitForQueuedCallUpdateRowPersist();
    const rowsResult = await fetchSupabaseCallUpdateRows(supabaseCallUpdateRowsFetchLimit);
    runtimeState.supabaseCallUpdatesLastSyncCheckMs = Date.now();
    if (!rowsResult.ok) {
      if (rowsResult.error) {
        runtimeState.supabaseLastHydrateError = truncateText(rowsResult.error, 500);
      }
      return false;
    }

    const touched = mergeCallUpdatesFromSupabaseRows(rowsResult.rows || []);
    return touched > 0;
  }

  async function syncRuntimeStateFromSupabaseIfNewer(options = {}) {
    if (!isSupabaseConfigured()) return false;

    const force = Boolean(options?.force);
    const maxAgeMs = Math.max(
      0,
      parseNumberSafe(options?.maxAgeMs, runtimeStateSupabaseSyncCooldownMs) ||
        runtimeStateSupabaseSyncCooldownMs
    );

    if (runtimeState.supabaseStateHydrationPromise) {
      try {
        await runtimeState.supabaseStateHydrationPromise;
      } catch {
        // Hydrate fouten worden al elders gelogd; hier alleen door.
      }
    }

    if (!force && !runtimeState.supabaseStateHydrated) {
      return forceHydrateRuntimeStateWithRetries(3);
    }

    const nowMs = Date.now();
    if (
      !force &&
      runtimeState.runtimeStateLastSupabaseSyncCheckMs > 0 &&
      nowMs - runtimeState.runtimeStateLastSupabaseSyncCheckMs < maxAgeMs
    ) {
      return false;
    }

    await waitForQueuedRuntimeStatePersist();
    runtimeState.runtimeStateLastSupabaseSyncCheckMs = Date.now();

    const snapshot = await fetchSupabaseStateRowViaRest('payload,updated_at');
    if (!snapshot.ok) {
      if (snapshot.error) {
        runtimeState.supabaseLastHydrateError = truncateText(snapshot.error, 500);
      }
      return false;
    }

    const row = Array.isArray(snapshot.body) ? snapshot.body[0] || null : snapshot.body;
    if (!row || !row.payload || typeof row.payload !== 'object') {
      runtimeState.supabaseStateHydrated = true;
      runtimeState.supabaseLastHydrateError = '';
      await hydrateDismissedLeadsFromSupabase();
      return false;
    }

    const remoteVersionMs = resolveRuntimeStateVersionMs(row.updated_at || '', row.payload);
    const shouldApply =
      force ||
      !runtimeState.supabaseStateHydrated ||
      (Number.isFinite(remoteVersionMs) &&
        remoteVersionMs >
          runtimeState.runtimeStateObservedAtMs + runtimeStateRemoteNewerThresholdMs);

    runtimeState.supabaseStateHydrated = true;
    runtimeState.supabaseLastHydrateError = '';

    if (!shouldApply) {
      await syncCallUpdatesFromSupabaseRows({ force, maxAgeMs });
      await hydrateDismissedLeadsFromSupabase();
      return false;
    }

    const applied = applyRuntimeStateSnapshotPayload(row.payload, { updatedAt: row.updated_at || '' });
    await syncCallUpdatesFromSupabaseRows({ force: true, maxAgeMs: 0 });
    await hydrateDismissedLeadsFromSupabase();
    return applied;
  }

  function invalidateSupabaseSyncTimestamp() {
    runtimeState.runtimeStateLastSupabaseSyncCheckMs = 0;
    runtimeState.supabaseCallUpdatesLastSyncCheckMs = 0;
  }

  // CRITIEK op Vercel serverless: meerdere warme instances hebben ieder eigen
  // in-memory dismissed-sets. De Supabase row is 1 rij voor de hele dismissed-state.
  // Een naïeve "overwrite whole row" causeert last-writer-wins: instance B kan
  // dismisses van instance A overschrijven door simpelweg zijn oudere set te
  // persisteren. Daarom doen we hier altijd een READ-MODIFY-WRITE met
  // READ-AFTER-WRITE-VERIFICATIE en RETRY:
  //   1. Lees de huidige remote state (bron van waarheid).
  //   2. Merge remote + lokaal (additief voor sets, max() voor timestamps).
  //   3. Schrijf de gemergde set terug én update ook onze lokale in-memory
  //      kopie zodat we niet meteen de volgende persist met een stale copy doen.
  //   4. Lees opnieuw en verifieer dat onze lokale dismisses ALLEMAAL aanwezig
  //      zijn in de remote row. Als een concurrent write tussendoor ze heeft
  //      overschreven (race tussen read en write) → retry.
  // Gevolg: een dismiss gaat nooit verloren — niet door multi-instance state
  // drift, niet door last-writer-wins, en niet door een concurrent write
  // race tussen onze read en write.
  async function persistDismissedLeadsToSupabase(reason = 'dismissed_leads_persist') {
    if (!isSupabaseConfigured() || !supabaseDismissedLeadsStateKey) return false;

    const maxAttempts = 3;
    let lastResultOk = false;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      const remoteState = await readRemoteDismissedLeadsState();
      const remoteCallIds = remoteState?.callIds instanceof Set ? remoteState.callIds : new Set();
      const remoteLeadKeys = remoteState?.leadKeys instanceof Set ? remoteState.leadKeys : new Set();
      const remoteLeadKeyUpdatedAtMs =
        remoteState?.leadKeyUpdatedAtMsByKey instanceof Map
          ? remoteState.leadKeyUpdatedAtMsByKey
          : new Map();

      const mergedCallIds = new Set();
      dismissedInterestedLeadCallIds.forEach((id) => {
        const value = normalizeString(id);
        if (value) mergedCallIds.add(value);
      });
      remoteCallIds.forEach((id) => {
        const value = normalizeString(id);
        if (value) mergedCallIds.add(value);
      });

      const mergedLeadKeys = new Set();
      dismissedInterestedLeadKeys.forEach((key) => {
        const value = normalizeString(key);
        if (value) mergedLeadKeys.add(value);
      });
      remoteLeadKeys.forEach((key) => {
        const value = normalizeString(key);
        if (value) mergedLeadKeys.add(value);
      });

      const mergedLeadKeyUpdatedAtMs = new Map();
      mergedLeadKeys.forEach((key) => {
        const localMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(key) || 0);
        const remoteMs = Number(remoteLeadKeyUpdatedAtMs.get(key) || 0);
        const best = Math.max(
          Number.isFinite(localMs) && localMs > 0 ? localMs : 0,
          Number.isFinite(remoteMs) && remoteMs > 0 ? remoteMs : 0
        );
        if (best > 0) mergedLeadKeyUpdatedAtMs.set(key, Math.round(best));
      });

      // Sync de gemergde remote-waarden terug naar onze in-memory kopie. Zo
      // ziet deze instance vanaf nu ook dismisses die elders zijn gezet, en
      // pakt de volgende retry de complete set mee.
      mergedCallIds.forEach((id) => dismissedInterestedLeadCallIds.add(id));
      mergedLeadKeys.forEach((key) => dismissedInterestedLeadKeys.add(key));
      mergedLeadKeyUpdatedAtMs.forEach((ms, key) => {
        const currentMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(key) || 0);
        if (ms > currentMs) {
          dismissedInterestedLeadKeyUpdatedAtMsByKey.set(key, ms);
        }
      });

      const callIds = Array.from(mergedCallIds).slice(0, 1000);
      const leadKeys = Array.from(mergedLeadKeys).slice(0, 2000);
      const leadKeyUpdatedAtMsByKey = Object.fromEntries(
        leadKeys
          .map((leadKey) => [leadKey, Number(mergedLeadKeyUpdatedAtMs.get(leadKey) || 0)])
          .filter(([, ms]) => Number.isFinite(ms) && ms > 0)
      );
      if (!callIds.length && !leadKeys.length) return true;

      let writeOk = false;
      try {
        const updatedAt = new Date().toISOString();
        const result = await upsertSupabaseRowViaRest({
          state_key: supabaseDismissedLeadsStateKey,
          payload: {
            callIds,
            leadKeys,
            leadKeyUpdatedAtMsByKey,
            updatedAt,
            reason,
            attempt,
          },
          updated_at: updatedAt,
        });
        writeOk = Boolean(result?.ok);
        lastResultOk = writeOk;
      } catch (error) {
        logError('[Supabase][DismissedLeadsPersistError]', error?.message || error);
        writeOk = false;
        lastResultOk = false;
      }

      if (!writeOk) {
        // Geen succesvolle write — wacht kort en retry.
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
          continue;
        }
        return false;
      }

      // READ-AFTER-WRITE: verifieer dat ALLE lokaal-bekende dismisses (incl. de
      // remote die we net hebben gemerged) in de Supabase row staan. Een
      // concurrent write op een andere instance kan ze tussen onze read en
      // write hebben overschreven — in dat geval moeten we opnieuw mergen en
      // schrijven.
      const verification = await readRemoteDismissedLeadsState();
      if (!verification) {
        // Verify-fetch faalde; we kunnen het niet bevestigen. Toch markeren als
        // succes (write was ok) — TTL hydrate van andere routes herstelt later.
        runtimeState.dismissedLeadsLastHydrateAtMs = Date.now();
        return true;
      }

      const verifyCallIds = verification.callIds;
      const verifyLeadKeys = verification.leadKeys;

      let allCallIdsPresent = true;
      for (const id of dismissedInterestedLeadCallIds) {
        if (!verifyCallIds.has(id)) {
          allCallIdsPresent = false;
          break;
        }
      }
      let allLeadKeysPresent = true;
      if (allCallIdsPresent) {
        for (const key of dismissedInterestedLeadKeys) {
          if (!verifyLeadKeys.has(key)) {
            allLeadKeysPresent = false;
            break;
          }
        }
      }

      if (allCallIdsPresent && allLeadKeysPresent) {
        runtimeState.dismissedLeadsLastHydrateAtMs = Date.now();
        return true;
      }

      // Race gedetecteerd: een andere instance heeft tussen onze read en write
      // de row overschreven en daarbij sommige van onze (lokale) dismisses
      // verloren. We mergen nu opnieuw — de verification-state heeft
      // eventueel hun nieuwere dismisses, en wij hebben nog steeds onze
      // lokale set. De volgende iteratie van de loop schrijft de UNION van
      // allebei.
      logError(
        '[Supabase][DismissedLeadsRaceDetected]',
        `attempt ${attempt}/${maxAttempts}, retry merge & write`
      );
      verifyCallIds.forEach((id) => dismissedInterestedLeadCallIds.add(id));
      verifyLeadKeys.forEach((key) => dismissedInterestedLeadKeys.add(key));
      verification.leadKeyUpdatedAtMsByKey.forEach((ms, key) => {
        const currentMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(key) || 0);
        if (ms > currentMs) {
          dismissedInterestedLeadKeyUpdatedAtMsByKey.set(key, ms);
        }
      });
      // korte backoff voor retry
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }

    return lastResultOk;
  }

  async function readRemoteDismissedLeadsState() {
    if (!isSupabaseConfigured() || !supabaseDismissedLeadsStateKey) return null;
    try {
      const result = await fetchSupabaseRowByKeyViaRest(supabaseDismissedLeadsStateKey, 'payload');
      if (!result?.ok) return null;
      const row = Array.isArray(result.body) ? result.body[0] || null : result.body;
      if (!row?.payload || typeof row.payload !== 'object') return null;

      const callIds = new Set();
      (Array.isArray(row.payload.callIds) ? row.payload.callIds : []).forEach((item) => {
        const value = normalizeString(item);
        if (value) callIds.add(value);
      });

      const leadKeys = new Set();
      (Array.isArray(row.payload.leadKeys) ? row.payload.leadKeys : []).forEach((item) => {
        const value = normalizeString(item);
        if (value) leadKeys.add(value);
      });

      const fallbackUpdatedAtMs =
        Date.parse(normalizeString(row?.payload?.updatedAt || row?.updated_at || row?.updatedAt || '')) || 0;
      const rawMap =
        row.payload.leadKeyUpdatedAtMsByKey && typeof row.payload.leadKeyUpdatedAtMsByKey === 'object'
          ? row.payload.leadKeyUpdatedAtMsByKey
          : {};
      const leadKeyUpdatedAtMsByKey = new Map();
      leadKeys.forEach((leadKey) => {
        const raw = Number(rawMap?.[leadKey] || fallbackUpdatedAtMs || 0);
        if (Number.isFinite(raw) && raw > 0) {
          leadKeyUpdatedAtMsByKey.set(leadKey, Math.round(raw));
        }
      });

      return { callIds, leadKeys, leadKeyUpdatedAtMsByKey };
    } catch (error) {
      logError('[Supabase][DismissedLeadsReadError]', error?.message || error);
      return null;
    }
  }

  async function hydrateDismissedLeadsFromSupabase() {
    const remoteState = await readRemoteDismissedLeadsState();
    if (!remoteState) return false;

    remoteState.callIds.forEach((callId) => {
      dismissedInterestedLeadCallIds.add(callId);
    });
    remoteState.leadKeys.forEach((leadKey) => {
      dismissedInterestedLeadKeys.add(leadKey);
    });
    remoteState.leadKeyUpdatedAtMsByKey.forEach((updatedAtMs, leadKey) => {
      const currentMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(leadKey) || 0);
      if (updatedAtMs >= currentMs) {
        dismissedInterestedLeadKeyUpdatedAtMsByKey.set(leadKey, Math.round(updatedAtMs));
      }
    });
    runtimeState.dismissedLeadsLastHydrateAtMs = Date.now();
    return true;
  }

  // Lichte wrapper om herhaalde hydrate-calls samen te voegen binnen een TTL.
  // Lees-routes op warme Vercel-instances mogen hier goedkoop doorheen: als een
  // andere request binnen `maxAgeMs` al hydrate heeft gedraaid, skippen we.
  async function ensureDismissedLeadsFreshFromSupabase(options = {}) {
    if (!isSupabaseConfigured() || !supabaseDismissedLeadsStateKey) return false;
    const force = Boolean(options?.force);
    const maxAgeMs = Math.max(
      0,
      Number.isFinite(Number(options?.maxAgeMs)) ? Number(options.maxAgeMs) : 2000
    );
    const lastMs = Number(runtimeState.dismissedLeadsLastHydrateAtMs || 0);
    const nowMs = Date.now();
    if (!force && lastMs > 0 && nowMs - lastMs < maxAgeMs) {
      return false;
    }
    return hydrateDismissedLeadsFromSupabase();
  }

  return {
    applyRuntimeStateSnapshotPayload,
    buildCallUpdateRowPersistMeta,
    ensureDismissedLeadsFreshFromSupabase,
    ensureRuntimeStateHydratedFromSupabase,
    forceHydrateRuntimeStateWithRetries,
    hydrateDismissedLeadsFromSupabase,
    invalidateSupabaseSyncTimestamp,
    mergeCallUpdatesFromSupabaseRows,
    persistDismissedLeadsToSupabase,
    persistRuntimeStateToSupabase,
    persistSingleCallUpdateRowToSupabase,
    queueCallUpdateRowPersist,
    queueRuntimeStatePersist,
    syncCallUpdatesFromSupabaseRows,
    syncRuntimeStateFromSupabaseIfNewer,
    waitForQueuedCallUpdateRowPersist,
    waitForQueuedRuntimeSnapshotPersist,
    waitForQueuedRuntimeStatePersist,
  };
}

module.exports = {
  createRuntimeStateSyncCoordinator,
};
