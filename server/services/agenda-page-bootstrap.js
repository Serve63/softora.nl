function createAgendaPageBootstrapService(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseStateHydrated = () => true,
    forceHydrateRuntimeStateWithRetries = async () => {},
    getGeneratedAgendaAppointments = () => [],
    isGeneratedAppointmentVisibleForAgenda = () => true,
    compareAgendaAppointments = () => 0,
  } = deps;

  async function buildAgendaBootstrapPayload(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 250));

    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
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
