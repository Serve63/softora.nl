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
  function getSafePreparationTimeoutMs() {
    return Math.max(0, Math.min(10000, Number(deps.readPreparationTimeoutMs) || 1500));
  }

  async function runPreparationWithinSoftTimeout(label, run) {
    const timeoutMs = getSafePreparationTimeoutMs();
    if (!timeoutMs) {
      return run();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve();
      };

      const timeoutHandle = setTimeout(() => {
        if (typeof deps.logger?.error === 'function') {
          deps.logger.error('[Agenda Read][PreparationTimeout]', label, `na ${timeoutMs}ms`);
        }
        finish();
      }, timeoutMs);

      Promise.resolve()
        .then(run)
        .then(() => finish())
        .catch((error) => {
          if (typeof deps.logger?.error === 'function') {
            deps.logger.error(
              '[Agenda Read][PreparationError]',
              label,
              error?.message || error
            );
          }
          finish();
        });
    });
  }

  async function ensureHydratedIfNeeded() {
    if (deps.isSupabaseConfigured() && !deps.getSupabaseStateHydrated()) {
      await deps.forceHydrateRuntimeStateWithRetries(3);
    }
  }

  async function prepareAppointmentsOverview(options = {}) {
    // Vercel serverless: zonder freshSharedState kan een instance die net een
    // cooldown heeft gedaan de zojuist door een andere instance ge-upserte
    // afspraak missen. Bij `freshSharedState` omzeilen we de cooldown en
    // halen we direct de laatste Supabase-state op (maxAgeMs: 0). Gebruikt
    // door de agenda-pagina bij eerste load / focus / pageshow.
    const freshSharedState = Boolean(options.freshSharedState);
    await runPreparationWithinSoftTimeout('appointments', async () => {
      await ensureHydratedIfNeeded();
      if (deps.isSupabaseConfigured()) {
        await deps.syncRuntimeStateFromSupabaseIfNewer({
          maxAgeMs: freshSharedState ? 0 : deps.runtimeSyncCooldownMs,
        });
      }
      if (deps.isImapMailConfigured()) {
        await deps.syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
      }
      deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
      await deps.refreshAgendaAppointmentCallSourcesIfNeeded();
      deps.backfillGeneratedAgendaAppointmentsMetadataIfNeeded();
      await deps.refreshGeneratedAgendaSummariesIfNeeded();
    });
  }

  // Vercel serverless: elke warme instance heeft eigen in-memory dismissed-sets.
  // Daarom bij élke lees ook de dedicated dismissed-leads row uit Supabase
  // refreshen (met een korte TTL-dedupe). Zonder dit blijft een dismiss die op
  // instance A is gezet onzichtbaar voor instance B tot de eerstvolgende volledige
  // snapshot-sync — wat "dismisses komen terug" of "verschillende tabs zien
  // verschillende dingen" veroorzaakt.
  async function ensureDismissedLeadsFresh(options = {}) {
    if (typeof deps.ensureDismissedLeadsFreshFromSupabase !== 'function') return false;
    return deps.ensureDismissedLeadsFreshFromSupabase(options || {});
  }

  async function prepareConfirmationTasks(options = {}) {
    const quickMode = Boolean(options.quickMode);
    const freshSharedState = Boolean(options.freshSharedState);
    await runPreparationWithinSoftTimeout('confirmation-tasks', async () => {
      await ensureHydratedIfNeeded();
      await deps.syncRuntimeStateFromSupabaseIfNewer({
        maxAgeMs: freshSharedState ? 0 : deps.runtimeSyncCooldownMs,
      });
      await ensureDismissedLeadsFresh({ maxAgeMs: freshSharedState ? 0 : 2000 });
      if (!quickMode && deps.isImapMailConfigured()) {
        await deps.syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
      }
      deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
      if (!quickMode) {
        deps.getGeneratedAgendaAppointments().forEach((appointment, idx) => {
          if (!appointment) return;
          if (!deps.mapAppointmentToConfirmationTask(appointment)) return;
          deps.ensureConfirmationEmailDraftAtIndex(idx, {
            reason: 'confirmation_task_list_auto_draft',
          });
        });
      }
    });
  }

  async function prepareInterestedLeads(options = {}) {
    const freshSharedState = Boolean(options.freshSharedState);
    await runPreparationWithinSoftTimeout('interested-leads', async () => {
      await ensureHydratedIfNeeded();
      await deps.syncRuntimeStateFromSupabaseIfNewer({
        maxAgeMs: freshSharedState ? 0 : deps.runtimeSyncCooldownMs,
      });
      await ensureDismissedLeadsFresh({ maxAgeMs: freshSharedState ? 0 : 2000 });
      deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
    });
  }

  async function listAppointments(options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    await prepareAppointmentsOverview({ freshSharedState: Boolean(options.freshSharedState) });
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

    await prepareConfirmationTasks({ quickMode, freshSharedState: Boolean(options.freshSharedState) });

    const tasks = deps
      .getGeneratedAgendaAppointments()
      .filter((appointment) => {
        if (includeDemo) return true;
        if (deps.demoConfirmationTaskEnabled) return true;
        const callId = deps.normalizeString(appointment?.callId || '');
        return !callId.startsWith('demo-');
      })
      .map(deps.mapAppointmentToConfirmationTask)
      .filter(Boolean)
      .filter((task) => {
        if (typeof deps.isInterestedLeadDismissedForRow !== 'function') return true;
        const callId = deps.normalizeString(task?.callId || '');
        return !deps.isInterestedLeadDismissedForRow(callId, task);
      });

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

    await prepareInterestedLeads({ freshSharedState: Boolean(options.freshSharedState) });
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
