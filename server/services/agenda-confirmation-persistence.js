function createAgendaConfirmationPersistenceHelpers(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    buildRuntimeStateSnapshotPayload = () => null,
    getGeneratedAgendaAppointments = () => [],
    getGeneratedAppointmentIndexById = () => -1,
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    waitForQueuedRuntimeSnapshotPersist = async () => true,
    syncRuntimeStateFromSupabaseIfNewer = async () => false,
    applyRuntimeStateSnapshotPayload = () => false,
    invalidateSupabaseSyncTimestamp = () => {},
  } = deps;

  function takeRuntimeMutationSnapshot() {
    if (!isSupabaseConfigured()) return null;
    const snapshot = buildRuntimeStateSnapshotPayload();
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
  }

  function resolveGeneratedAgendaAppointmentById(rawId) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const idx = getGeneratedAppointmentIndexById(id);
    if (idx < 0) return null;
    return getGeneratedAgendaAppointments()[idx] || null;
  }

  function doesAgendaMutationMatchAppointment(expected, candidate) {
    if (!expected || !candidate) return false;

    const expectedId = Number(expected?.id || 0);
    const candidateId = Number(candidate?.id || 0);
    if (!Number.isFinite(expectedId) || expectedId <= 0 || expectedId !== candidateId) return false;

    const expectedCallId = normalizeString(expected?.callId || '');
    const candidateCallId = normalizeString(candidate?.callId || '');
    if (expectedCallId && expectedCallId !== candidateCallId) return false;

    const expectedDate = normalizeDateYyyyMmDd(expected?.date || '');
    const candidateDate = normalizeDateYyyyMmDd(candidate?.date || '');
    if (expectedDate && expectedDate !== candidateDate) return false;

    const expectedTime = normalizeTimeHhMm(expected?.time || '');
    const candidateTime = normalizeTimeHhMm(candidate?.time || '');
    if (expectedTime && expectedTime !== candidateTime) return false;

    const expectedLocation = normalizeString(expected?.location || expected?.appointmentLocation || '');
    const candidateLocation = normalizeString(candidate?.location || candidate?.appointmentLocation || '');
    if (expectedLocation && expectedLocation !== candidateLocation) return false;

    return true;
  }

  function waitForPendingPersistResponse(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve('pending'), Math.max(250, Number(ms) || 3000));
    });
  }

  async function ensureLeadMutationPersisted(runtimeSnapshot, failureMessage, options = {}) {
    const verifyPersisted =
      options && typeof options.verifyPersisted === 'function' ? options.verifyPersisted : null;
    const allowPendingResponse = Boolean(options?.allowPendingResponse);
    const pendingResponseAfterMs = Math.max(1000, Math.min(15000, Number(options?.pendingResponseAfterMs) || 3000));
    let persisted = null;

    if (allowPendingResponse && isSupabaseConfigured()) {
      const fastPersistResult = await Promise.race([
        waitForQueuedRuntimeSnapshotPersist()
          .then((value) => (value ? true : false))
          .catch(() => false),
        waitForPendingPersistResponse(pendingResponseAfterMs),
      ]);
      if (fastPersistResult === true) return true;
      if (fastPersistResult === 'pending') {
        if (!verifyPersisted) return 'pending';
        try {
          if (verifyPersisted()) return 'pending';
        } catch {
          // Val terug op het bestaande foutpad als lokale verificatie faalt.
        }
      } else {
        persisted = false;
      }
    } else {
      persisted = await waitForQueuedRuntimeSnapshotPersist();
      if (persisted) return true;
    }

    if (persisted === null) {
      persisted = await waitForQueuedRuntimeSnapshotPersist();
      if (persisted) return true;
    }

    if (!isSupabaseConfigured()) return true;
    const syncedFromSharedState = await syncRuntimeStateFromSupabaseIfNewer({ force: true, maxAgeMs: 0 }).catch(
      () => false
    );
    if (syncedFromSharedState && verifyPersisted) {
      try {
        if (verifyPersisted()) return true;
      } catch {
        // Val terug op foutpad als verificatie zelf faalt.
      }
    }

    if (!syncedFromSharedState && runtimeSnapshot) {
      applyRuntimeStateSnapshotPayload(runtimeSnapshot, {
        updatedAt: normalizeString(runtimeSnapshot?.savedAt || '') || new Date().toISOString(),
      });
    }
    return failureMessage || 'Leadwijziging kon niet veilig in gedeelde opslag worden opgeslagen.';
  }

  async function ensureLeadMutationPersistedOrRespond(res, runtimeSnapshot, failureMessage, options = {}) {
    const persistResult = await ensureLeadMutationPersisted(runtimeSnapshot, failureMessage, options);
    if (persistResult === true || persistResult === 'pending') {
      invalidateSupabaseSyncTimestamp();
      return persistResult;
    }

    const errorMessage =
      normalizeString(persistResult || failureMessage) ||
      'Leadwijziging kon niet veilig in gedeelde opslag worden opgeslagen.';
    res.status(503).json({
      ok: false,
      error: errorMessage,
    });
    return false;
  }

  return {
    takeRuntimeMutationSnapshot,
    resolveGeneratedAgendaAppointmentById,
    doesAgendaMutationMatchAppointment,
    ensureLeadMutationPersisted,
    ensureLeadMutationPersistedOrRespond,
  };
}

module.exports = {
  createAgendaConfirmationPersistenceHelpers,
};
