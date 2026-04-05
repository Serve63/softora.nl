function buildConfirmationTaskDedupeKey(task, normalizeString) {
  return [
    normalizeString(task?.company || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim(),
    normalizeString(task?.contact || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim(),
    normalizeString(task?.phone || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim(),
    normalizeString(task?.date || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim(),
    normalizeString(task?.time || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim(),
  ].join('|');
}

function createAgendaReadCoordinator(deps) {
  async function ensureHydratedIfNeeded() {
    if (deps.isSupabaseConfigured() && !deps.getSupabaseStateHydrated()) {
      await deps.forceHydrateRuntimeStateWithRetries(3);
    }
  }

  async function prepareAppointmentsOverview() {
    await ensureHydratedIfNeeded();
    if (deps.isSupabaseConfigured()) {
      await deps.syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: deps.runtimeSyncCooldownMs });
    }
    if (deps.isImapMailConfigured()) {
      await deps.syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
    }
    deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
    await deps.refreshAgendaAppointmentCallSourcesIfNeeded();
    deps.backfillGeneratedAgendaAppointmentsMetadataIfNeeded();
    await deps.refreshGeneratedAgendaSummariesIfNeeded();
  }

  async function prepareConfirmationTasks(options = {}) {
    const quickMode = Boolean(options.quickMode);
    await ensureHydratedIfNeeded();
    await deps.syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: deps.runtimeSyncCooldownMs });
    if (!quickMode && deps.isImapMailConfigured()) {
      await deps.syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
    }
    deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
    if (!quickMode) {
      deps.getGeneratedAgendaAppointments().forEach((appointment, idx) => {
        if (!appointment) return;
        if (!deps.mapAppointmentToConfirmationTask(appointment)) return;
        deps.ensureConfirmationEmailDraftAtIndex(idx, { reason: 'confirmation_task_list_auto_draft' });
      });
    }
  }

  async function prepareInterestedLeads() {
    await ensureHydratedIfNeeded();
    await deps.syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: deps.runtimeSyncCooldownMs });
    deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
  }

  async function listAppointments(options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    await prepareAppointmentsOverview();
    const sorted = deps
      .getGeneratedAgendaAppointments()
      .filter(deps.isGeneratedAppointmentVisibleForAgenda)
      .slice()
      .sort(deps.compareAgendaAppointments);

    return {
      ok: true,
      count: Math.min(limit, sorted.length),
      appointments: sorted.slice(0, limit),
    };
  }

  async function listConfirmationTasks(options = {}) {
    const includeDemo = Boolean(options.includeDemo);
    const quickMode = Boolean(options.quickMode);
    const countOnly = Boolean(options.countOnly);
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 100));

    await prepareConfirmationTasks({ quickMode });

    const tasks = deps
      .getGeneratedAgendaAppointments()
      .filter((appointment) => {
        if (includeDemo) return true;
        if (deps.demoConfirmationTaskEnabled) return true;
        const callId = deps.normalizeString(appointment?.callId || '');
        return !callId.startsWith('demo-');
      })
      .map(deps.mapAppointmentToConfirmationTask)
      .filter(Boolean);

    if (countOnly) {
      const dedupe = new Set();
      tasks.forEach((task) => {
        dedupe.add(buildConfirmationTaskDedupeKey(task, deps.normalizeString));
      });
      return {
        ok: true,
        count: dedupe.size,
      };
    }

    tasks.sort(deps.compareConfirmationTasks);
    return {
      ok: true,
      count: Math.min(limit, tasks.length),
      tasks: tasks.slice(0, limit),
    };
  }

  async function listInterestedLeads(options = {}) {
    const countOnly = Boolean(options.countOnly);
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 100));

    await prepareInterestedLeads();
    const interestedLeads = deps.buildAllInterestedLeadRows();

    if (countOnly) {
      return {
        ok: true,
        count: interestedLeads.length,
      };
    }

    return {
      ok: true,
      count: Math.min(limit, interestedLeads.length),
      leads: interestedLeads.slice(0, limit),
    };
  }

  return {
    listAppointments,
    listConfirmationTasks,
    listInterestedLeads,
    prepareAppointmentsOverview,
    prepareConfirmationTasks,
    prepareInterestedLeads,
  };
}

module.exports = {
  createAgendaReadCoordinator,
};
