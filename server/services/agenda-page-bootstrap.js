function createAgendaPageBootstrapService(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseStateHydrated = () => true,
    forceHydrateRuntimeStateWithRetries = async () => {},
    syncRuntimeStateFromSupabaseIfNewer = async () => false,
    getGeneratedAgendaAppointments = () => [],
    isGeneratedAppointmentVisibleForAgenda = () => true,
    compareAgendaAppointments = () => 0,
  } = deps;

  async function buildAgendaBootstrapPayload(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 250));

    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
    }

    // Vercel multi-instance: ook al is de instance gehydrateerd, z'n lokale
    // state kan achterlopen op Supabase (bv. afspraak die zojuist via
    // "in agenda zetten" op instance A is geschreven). We dwingen daarom
    // altijd een verse sync vóór we de bootstrap-payload samenstellen, zodat
    // een gebruiker die direct na het inplannen naar /premium-personeel-agenda
    // navigeert de afspraak meteen ziet.
    if (isSupabaseConfigured()) {
      await syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: 0 });
    }

    const appointments = getGeneratedAgendaAppointments()
      .filter((appointment) => isGeneratedAppointmentVisibleForAgenda(appointment))
      .slice()
      .sort(compareAgendaAppointments)
      .slice(0, limit);

    return {
      ok: true,
      loadedAt: new Date().toISOString(),
      appointments,
    };
  }

  return {
    buildAgendaBootstrapPayload,
  };
}

module.exports = {
  createAgendaPageBootstrapService,
};
