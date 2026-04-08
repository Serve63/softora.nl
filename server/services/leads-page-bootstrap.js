function createLeadsPageBootstrapService(deps = {}) {
  const {
    agendaReadCoordinator = null,
    getUiStateValues = async () => null,
    normalizeString = (value) => String(value || '').trim(),
    leadDatabaseUiScope = 'coldcalling',
    leadDatabaseRowsStorageKey = 'softora_coldcalling_lead_rows_json',
    confirmationTaskLimit = 400,
    interestedLeadLimit = 500,
  } = deps;

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function isGenericConversationPlaceholder(value) {
    const text = normalize(String(value || ''));
    if (!text) return true;
    return (
      text === 'nog geen gesprekssamenvatting beschikbaar.' ||
      text === 'samenvatting volgt na verwerking van het gesprek.'
    );
  }

  function buildLeadVirtualSeed(item) {
    const callId = String(item?.callId || '').trim();
    if (callId) return `call:${callId}`;
    const phoneDigits = String(item?.phone || '').replace(/\D/g, '');
    if (phoneDigits) return `phone:${phoneDigits}`;
    const companyKey = normalize(item?.company || '');
    const contactKey = normalize(item?.contact || '');
    if (companyKey || contactKey) return `name:${companyKey}|${contactKey}`;
    return '';
  }

  function resolveLeadListId(item) {
    const explicitId = Number(item?.id) || 0;
    if (explicitId > 0) return explicitId;
    const seed = buildLeadVirtualSeed(item);
    if (!seed) return 0;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    return -(Math.abs(hash || 1));
  }

  function resolveLeadCallId(value) {
    return String(
      value?.callId ||
        value?.call_id ||
        value?.sourceCallId ||
        value?.source_call_id ||
        ''
    ).trim();
  }

  function normalizeLeadRecordingUrl(item) {
    const raw = String(
      item?.recordingUrl ||
        item?.recording_url ||
        item?.recordingUrlProxy ||
        item?.audioUrl ||
        item?.audio_url ||
        ''
    ).trim();
    return raw;
  }

  function normalizeLeadRow(item) {
    return {
      id: resolveLeadListId(item),
      callId: resolveLeadCallId(item),
      company: String(item?.company || 'Onbekende lead').trim() || 'Onbekende lead',
      contact: String(item?.contact || '').trim(),
      phone: String(item?.phone || '').trim(),
      branche: String(item?.branche || item?.branch || '').trim(),
      province: String(item?.province || item?.provincie || '').trim(),
      address: String(item?.address || item?.adres || '').trim(),
      website: String(item?.website || item?.webiste || item?.url || '').trim(),
      date: String(item?.date || '').trim(),
      time: String(item?.time || '').trim(),
      source: String(item?.source || '').trim(),
      summary: String(item?.summary || '').trim(),
      conversationSummary: String(item?.conversationSummary || '').trim(),
      location: String(item?.location || item?.appointmentLocation || '').trim(),
      whatsappInfo: String(item?.whatsappInfo || item?.whatsappNotes || item?.whatsapp || '').trim(),
      createdAt: String(item?.createdAt || item?.confirmationTaskCreatedAt || item?.updatedAt || '').trim(),
      recordingUrl: normalizeLeadRecordingUrl(item),
      provider: String(item?.provider || '').trim().toLowerCase(),
      providerLabel: String(item?.providerLabel || '').trim(),
      coldcallingStack: String(
        item?.coldcallingStack || item?.callingStack || item?.callingEngine || item?.stack || ''
      )
        .trim()
        .toLowerCase(),
      coldcallingStackLabel: String(item?.coldcallingStackLabel || item?.stackLabel || '').trim(),
      leadType: String(
        item?.leadType ||
          item?.lead_type ||
          item?.productType ||
          item?.product_type ||
          item?.businessMode ||
          item?.business_mode ||
          item?.serviceType ||
          item?.service_type ||
          item?.offerType ||
          item?.offer_type ||
          ''
      ).trim(),
      leadChipLabel: String(item?.leadChipLabel || '').trim(),
      leadChipClass: String(item?.leadChipClass || '').trim(),
      leadOwnerKey: String(item?.leadOwnerKey || item?.assignedToKey || '').trim(),
      leadOwnerName: String(item?.leadOwnerName || item?.assignedToName || '').trim(),
      leadOwnerFullName: String(item?.leadOwnerFullName || item?.assignedToFullName || '').trim(),
      leadOwnerUserId: String(item?.leadOwnerUserId || item?.assignedToUserId || '').trim(),
      leadOwnerEmail: String(item?.leadOwnerEmail || item?.assignedToEmail || '').trim(),
    };
  }

  function normalizePhoneDigits(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0031')) return `31${digits.slice(4)}`;
    if (digits.startsWith('31')) return digits;
    if (digits.startsWith('0') && digits.length >= 10) return `31${digits.slice(1)}`;
    if (digits.startsWith('6') && digits.length === 9) return `31${digits}`;
    return digits;
  }

  function buildLeadMatchKey(item) {
    const phoneKey = normalizePhoneDigits(item?.phone || '');
    if (phoneKey) return `phone:${phoneKey}`;
    const companyKey = normalize(item?.company || '');
    const contactKey = normalize(item?.contact || '');
    if (companyKey || contactKey) return `name:${companyKey}|${contactKey}`;
    return '';
  }

  function buildLeadRecencyTimestamp(item) {
    const explicit = Date.parse(String(item?.createdAt || item?.updatedAt || '').trim());
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const date = String(item?.date || '').trim().slice(0, 10);
    const time = String(item?.time || '').trim() || '00:00';
    if (!date) return 0;
    const parsed = Date.parse(`${date}T${time}:00`);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function hasPersistedLeadTask(value) {
    return (Number(value?.id ?? value) || 0) > 0;
  }

  function isLeadRowPreferred(candidate, existing) {
    const candidateHasTask = hasPersistedLeadTask(candidate);
    const existingHasTask = hasPersistedLeadTask(existing);
    if (candidateHasTask !== existingHasTask) return candidateHasTask;

    const candidateTs = buildLeadRecencyTimestamp(candidate);
    const existingTs = buildLeadRecencyTimestamp(existing);
    if (candidateTs !== existingTs) return candidateTs > existingTs;

    const candidateConfirmed = normalize(candidate?.leadChipClass || '') === 'confirmed';
    const existingConfirmed = normalize(existing?.leadChipClass || '') === 'confirmed';
    if (candidateConfirmed !== existingConfirmed) return candidateConfirmed;

    const candidateHasCall = Boolean(String(candidate?.callId || '').trim());
    const existingHasCall = Boolean(String(existing?.callId || '').trim());
    if (candidateHasCall !== existingHasCall) return candidateHasCall;

    const candidateHasRecording = Boolean(String(candidate?.recordingUrl || '').trim());
    const existingHasRecording = Boolean(String(existing?.recordingUrl || '').trim());
    if (candidateHasRecording !== existingHasRecording) return candidateHasRecording;

    return false;
  }

  function mergeLeadRows(preferred, secondary) {
    const preferredId = Number(preferred?.id) || 0;
    const secondaryId = Number(secondary?.id) || 0;
    const mergedId =
      preferredId > 0 ? preferredId : secondaryId > 0 ? secondaryId : preferredId || secondaryId || 0;
    const preferredSummary = String(preferred?.summary || '').trim();
    const secondarySummary = String(secondary?.summary || '').trim();
    const preferredConversationSummary = String(preferred?.conversationSummary || '').trim();
    const secondaryConversationSummary = String(secondary?.conversationSummary || '').trim();
    return {
      ...preferred,
      id: mergedId,
      callId: String(preferred?.callId || secondary?.callId || '').trim(),
      company: String(preferred?.company || secondary?.company || 'Onbekende lead').trim() || 'Onbekende lead',
      contact: String(preferred?.contact || secondary?.contact || '').trim(),
      phone: String(preferred?.phone || secondary?.phone || '').trim(),
      date: String(preferred?.date || secondary?.date || '').trim(),
      time: String(preferred?.time || secondary?.time || '').trim(),
      source: String(preferred?.source || secondary?.source || '').trim(),
      summary: String(
        (!preferredSummary || isGenericConversationPlaceholder(preferredSummary))
          ? secondarySummary || preferredSummary
          : preferredSummary || secondarySummary
      ).trim(),
      conversationSummary: String(
        (!preferredConversationSummary || isGenericConversationPlaceholder(preferredConversationSummary))
          ? secondaryConversationSummary || preferredConversationSummary
          : preferredConversationSummary || secondaryConversationSummary
      ).trim(),
      location: String(preferred?.location || secondary?.location || '').trim(),
      whatsappInfo: String(preferred?.whatsappInfo || secondary?.whatsappInfo || '').trim(),
      createdAt: String(preferred?.createdAt || secondary?.createdAt || '').trim(),
      recordingUrl: String(preferred?.recordingUrl || secondary?.recordingUrl || '').trim(),
      provider: String(preferred?.provider || secondary?.provider || '').trim().toLowerCase(),
      providerLabel: String(preferred?.providerLabel || secondary?.providerLabel || '').trim(),
      coldcallingStack: String(preferred?.coldcallingStack || secondary?.coldcallingStack || '').trim().toLowerCase(),
      coldcallingStackLabel: String(
        preferred?.coldcallingStackLabel || secondary?.coldcallingStackLabel || ''
      ).trim(),
      leadType: String(preferred?.leadType || secondary?.leadType || '').trim(),
      branche: String(preferred?.branche || secondary?.branche || '').trim(),
      province: String(preferred?.province || secondary?.province || '').trim(),
      address: String(preferred?.address || secondary?.address || '').trim(),
      website: String(preferred?.website || secondary?.website || '').trim(),
      leadChipLabel: String(preferred?.leadChipLabel || secondary?.leadChipLabel || '').trim(),
      leadChipClass: String(preferred?.leadChipClass || secondary?.leadChipClass || '').trim(),
      leadOwnerKey: String(preferred?.leadOwnerKey || secondary?.leadOwnerKey || '').trim(),
      leadOwnerName: String(preferred?.leadOwnerName || secondary?.leadOwnerName || '').trim(),
      leadOwnerFullName: String(preferred?.leadOwnerFullName || secondary?.leadOwnerFullName || '').trim(),
      leadOwnerUserId: String(preferred?.leadOwnerUserId || secondary?.leadOwnerUserId || '').trim(),
      leadOwnerEmail: String(preferred?.leadOwnerEmail || secondary?.leadOwnerEmail || '').trim(),
    };
  }

  function dedupe(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const rowId = Number(row?.id) || 0;
      const key =
        buildLeadMatchKey(row) ||
        (String(row?.callId || '').trim()
          ? `call:${String(row?.callId || '').trim()}`
          : rowId > 0
            ? `id:${rowId}`
            : [
                normalize(row?.company || ''),
                normalize(row?.contact || ''),
                normalize(row?.phone || ''),
                normalize(row?.date || ''),
                normalize(row?.time || ''),
              ].join('|'));
      if (!map.has(key)) {
        map.set(key, row);
        return;
      }
      const existing = map.get(key) || {};
      const preferred = isLeadRowPreferred(row, existing) ? row : existing;
      const secondary = preferred === row ? existing : row;
      map.set(key, mergeLeadRows(preferred, secondary));
    });
    return Array.from(map.values());
  }

  function sortByDateDesc(a, b) {
    const aTs = Date.parse(`${String(a?.date || '')}T${String(a?.time || '00:00')}:00`) || 0;
    const bTs = Date.parse(`${String(b?.date || '')}T${String(b?.time || '00:00')}:00`) || 0;
    if (aTs === bTs) {
      return String(a?.company || '').localeCompare(String(b?.company || ''));
    }
    return bTs - aTs;
  }

  function normalizeLeadDatabaseRow(item) {
    return {
      company: String(item?.company || '').trim(),
      contact: String(item?.contactPerson || item?.contact || item?.contactpersoon || '').trim(),
      phone: String(item?.phone || '').trim(),
      branche: String(item?.branche || item?.branch || '').trim(),
      province: String(item?.province || item?.provincie || '').trim(),
      address: String(item?.address || item?.adres || '').trim(),
      website: String(item?.website || item?.webiste || item?.url || '').trim(),
    };
  }

  function applyLeadDatabaseIdentity(row, databaseByPhone) {
    const base = row && typeof row === 'object' ? row : {};
    const map = databaseByPhone instanceof Map ? databaseByPhone : new Map();
    const phoneKey = normalizePhoneDigits(base?.phone || '');
    if (!phoneKey || !map.has(phoneKey)) return base;

    const databaseRow = map.get(phoneKey) || {};
    return {
      ...base,
      company: String(databaseRow.company || base.company || 'Onbekende lead').trim() || 'Onbekende lead',
      contact: String(databaseRow.contact || base.contact || '').trim(),
      phone: String(databaseRow.phone || base.phone || '').trim(),
      branche: String(databaseRow.branche || base.branche || '').trim(),
      province: String(databaseRow.province || base.province || '').trim(),
      address: String(databaseRow.address || base.address || '').trim(),
      website: String(databaseRow.website || base.website || '').trim(),
    };
  }

  async function loadLeadDatabaseIdentityMap() {
    const state = await getUiStateValues(leadDatabaseUiScope);
    const raw = String(state?.values?.[leadDatabaseRowsStorageKey] || '').trim();
    if (!raw) return new Map();

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Map();
      const nextMap = new Map();
      parsed.forEach((item) => {
        const row = normalizeLeadDatabaseRow(item);
        const phoneKey = normalizePhoneDigits(row.phone || '');
        if (!phoneKey || nextMap.has(phoneKey)) return;
        nextMap.set(phoneKey, row);
      });
      return nextMap;
    } catch (_) {
      return new Map();
    }
  }

  async function buildLeadsBootstrapPayload() {
    if (!agendaReadCoordinator) {
      return {
        ok: true,
        loadedAt: new Date().toISOString(),
        leads: [],
      };
    }

    const databaseByPhone = await loadLeadDatabaseIdentityMap();
    const [tasksResult, interestedResult] = await Promise.allSettled([
      agendaReadCoordinator.listConfirmationTasks({
        quickMode: true,
        includeDemo: false,
        countOnly: false,
        limit: confirmationTaskLimit,
      }),
      agendaReadCoordinator.listInterestedLeads({
        countOnly: false,
        limit: interestedLeadLimit,
      }),
    ]);

    const taskRows =
      tasksResult.status === 'fulfilled' && Array.isArray(tasksResult.value?.tasks)
        ? tasksResult.value.tasks.map((item) =>
            applyLeadDatabaseIdentity(normalizeLeadRow(item), databaseByPhone)
          )
        : [];

    const interestedRows =
      interestedResult.status === 'fulfilled' && Array.isArray(interestedResult.value?.leads)
        ? interestedResult.value.leads.map((item) =>
            applyLeadDatabaseIdentity(normalizeLeadRow(item), databaseByPhone)
          )
        : [];

    if (!taskRows.length && !interestedRows.length) {
      return {
        ok: true,
        loadedAt: new Date().toISOString(),
        leads: [],
      };
    }

    const leads = dedupe([].concat(taskRows, interestedRows))
      .map((row) => applyLeadDatabaseIdentity(row, databaseByPhone))
      .sort(sortByDateDesc);

    return {
      ok: true,
      loadedAt: new Date().toISOString(),
      leads,
    };
  }

  return {
    buildLeadsBootstrapPayload,
  };
}

module.exports = {
  createLeadsPageBootstrapService,
};
