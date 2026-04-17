const {
  createRuntimeStateSnapshotHelpers,
} = require('./runtime-state-sync-snapshot');
const {
  createRuntimeStateSyncCallUpdateHelpers,
} = require('./runtime-state-sync-call-updates');
const {
  createRuntimeStateSyncDismissedLeadHelpers,
} = require('./runtime-state-sync-dismissed-leads');

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

  const {
    getRuntimeSnapshotItemTimestampMs,
    mergeRuntimeSnapshotPayloads,
    resolveRuntimeStateVersionMs,
  } = createRuntimeStateSnapshotHelpers({
    normalizeString,
    normalizeLeadOwnerRecord,
    compactRuntimeSnapshotWebhookEvent,
    compactRuntimeSnapshotCallUpdate,
    compactRuntimeSnapshotAiInsight,
    compactRuntimeSnapshotDashboardActivity,
    compactRuntimeSnapshotSecurityAuditEvent,
    compactRuntimeSnapshotGeneratedAgendaAppointment,
  });

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
  const {
    buildCallUpdateRowPersistMeta,
    mergeCallUpdatesFromSupabaseRows,
    persistSingleCallUpdateRowToSupabase,
    queueCallUpdateRowPersist,
    syncCallUpdatesFromSupabaseRows,
    waitForQueuedCallUpdateRowPersist,
  } = createRuntimeStateSyncCallUpdateHelpers({
    isSupabaseConfigured,
    getSupabaseClient,
    fetchSupabaseCallUpdateRowsViaRest,
    upsertSupabaseRowViaRest,
    supabaseStateTable,
    supabaseCallUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit,
    supabaseClientPersistTimeoutMs,
    runtimeStateSupabaseSyncCooldownMs,
    normalizeString,
    truncateText,
    parseNumberSafe,
    buildSupabaseCallUpdateStateKey,
    extractSupabaseCallUpdateFromRow,
    buildSupabaseCallUpdatePayload,
    compactRuntimeSnapshotCallUpdate,
    upsertRecentCallUpdate,
    getRuntimeSnapshotItemTimestampMs,
    awaitWithTimeout,
    logError,
    recentCallUpdates,
    callUpdatesById,
    runtimeState,
  });

  async function syncRuntimeStateFromSupabaseIfNewer(options = {}) {
    if (!isSupabaseConfigured()) return false;

    const force = Boolean(options?.force);
    const skipPendingPersistWait = Boolean(options?.skipPendingPersistWait);
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

    // Leespaden zoals de Retell-agenda-check moeten snel kunnen reageren.
    // Als we lokale mutaties al in memory hebben, is wachten op de persist-keten
    // hier niet nodig en kan het tientallen seconden vertraging geven.
    if (!skipPendingPersistWait) {
      await waitForQueuedRuntimeStatePersist();
    }
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
  const {
    ensureDismissedLeadsFreshFromSupabase,
    hydrateDismissedLeadsFromSupabase,
    persistDismissedLeadsToSupabase,
  } = createRuntimeStateSyncDismissedLeadHelpers({
    isSupabaseConfigured,
    supabaseDismissedLeadsStateKey,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
    normalizeString,
    logError,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    runtimeState,
  });

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
