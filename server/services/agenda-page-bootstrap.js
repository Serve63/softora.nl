function createAgendaPageBootstrapService(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseStateHydrated = () => true,
    forceHydrateRuntimeStateWithRetries = async () => {},
    syncRuntimeStateFromSupabaseIfNewer = async () => false,
    getGeneratedAgendaAppointments = () => [],
    isGeneratedAppointmentVisibleForAgenda = () => true,
    compareAgendaAppointments = () => 0,
    logger = console,
    bootstrapPreparationTimeoutMs = 1500,
    getGoogleMapsPlacesBrowserKey = () =>
      String(process.env.GOOGLE_MAPS_PLACES_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim(),
  } = deps;

  function getSafeBootstrapPreparationTimeoutMs() {
    return Math.max(0, Math.min(10000, Number(bootstrapPreparationTimeoutMs) || 1500));
  }

  async function runBootstrapPreparationWithinSoftTimeout(label, run) {
    const timeoutMs = getSafeBootstrapPreparationTimeoutMs();
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
        if (typeof logger?.error === 'function') {
          logger.error('[Agenda Bootstrap][PreparationTimeout]', label, `na ${timeoutMs}ms`);
        }
        finish();
      }, timeoutMs);

      Promise.resolve()
        .then(run)
        .then(() => finish())
        .catch((error) => {
          if (typeof logger?.error === 'function') {
            logger.error(
              '[Agenda Bootstrap][PreparationError]',
              label,
              error?.message || error
            );
          }
          finish();
        });
    });
  }

  async function buildAgendaBootstrapPayload(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 250));

    await runBootstrapPreparationWithinSoftTimeout('agenda-page-bootstrap', async () => {
      if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
        await forceHydrateRuntimeStateWithRetries(3);
      }

      // Vercel multi-instance: ook al is de instance gehydrateerd, z'n lokale
      // state kan achterlopen op Supabase (bv. afspraak die zojuist via
      // "in agenda zetten" op instance A is geschreven). We proberen daarom
      // een verse sync vóór we de bootstrap-payload samenstellen, maar laten de
      // pagina niet blokkeren als die externe sync traag is.
      if (isSupabaseConfigured()) {
        await syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: 0 });
      }
    });

    const appointments = getGeneratedAgendaAppointments()
      .filter((appointment) => isGeneratedAppointmentVisibleForAgenda(appointment))
      .slice()
      .sort(compareAgendaAppointments)
      .slice(0, limit);

    const googleMapsPlacesKey = getGoogleMapsPlacesBrowserKey();

    return {
      ok: true,
      loadedAt: new Date().toISOString(),
      appointments,
      ...(googleMapsPlacesKey ? { googleMapsPlacesKey } : {}),
    };
  }

  return {
    buildAgendaBootstrapPayload,
  };
}

module.exports = {
  createAgendaPageBootstrapService,
};
