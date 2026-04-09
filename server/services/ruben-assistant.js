function createRubenAssistant(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    parseJsonLoose = (value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value ?? null;
    },
    getUiStateValues = async () => null,
    assistantMemoryScope = 'ruben_nijhuis_memory',
    assistantName = 'Ruben Nijhuis',
  } = deps;

  function buildAssistantIdentity() {
    return {
      name: assistantName,
      role: 'Softora coach & systeemassistent',
      company: 'Softora',
      style: 'collegiaal, scherp, rustig en operationeel',
      mission:
        'Houd overzicht over de hele Softora-software, verbind losse processen aan elkaar en help het team beslissen op basis van echte runtime-data.',
    };
  }

  function buildOperatingRules() {
    return [
      {
        key: 'lead_do_not_call',
        title: 'Niet geïnteresseerde leads niet opnieuw bellen',
        why: 'Als een lead als niet geïnteresseerd, dismissed of uit bellijst is gemarkeerd, is dat leidend voor vervolgacties.',
      },
      {
        key: 'appointment_open_dossier',
        title: 'Afspraken met opdracht openen direct het dossier',
        why: 'Als een agenda-afspraak al gekoppeld is aan een actieve opdracht, hoort de flow door te gaan naar het dossier en niet opnieuw naar akkoord/geen deal.',
      },
      {
        key: 'supabase_truth',
        title: 'Supabase is de bron van waarheid voor dashboardstate',
        why: 'Configuratie, resets en dashboardstatus moeten echt persistent zijn en niet alleen lokaal of tijdelijk in de browser bestaan.',
      },
      {
        key: 'owner_consistency',
        title: 'Eigenaar moet consistent blijven tussen lead, agenda en opdracht',
        why: 'Claims en verantwoordelijke collega moeten zoveel mogelijk hetzelfde blijven tussen gekoppelde onderdelen van de flow.',
      },
      {
        key: 'answer_from_context',
        title: 'Alle antwoorden moeten uit echte context komen',
        why: 'Ruben mag geen losse aannames doen. Als data ontbreekt, moet dat expliciet gezegd worden.',
      },
    ];
  }

  function parseAssistantMemoryNotes(rawValue) {
    const parsed = parseJsonLoose(rawValue);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const createdAt = normalizeString(item.createdAt || item.updatedAt || item.date || '');
        return {
          id: truncateText(normalizeString(item.id || `note-${index + 1}`), 80),
          category: truncateText(normalizeString(item.category || item.type || 'operationeel'), 80) || 'operationeel',
          title: truncateText(normalizeString(item.title || item.subject || ''), 160) || 'Werkafspraak',
          detail: truncateText(normalizeString(item.detail || item.note || item.description || ''), 500),
          why: truncateText(normalizeString(item.why || item.reason || ''), 240),
          createdAt,
          createdAtMs: createdAt ? Date.parse(createdAt) || 0 : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0))
      .slice(0, 40);
  }

  async function loadAssistantMemory() {
    const state = await getUiStateValues(assistantMemoryScope);
    const values = state?.values && typeof state.values === 'object' ? state.values : {};

    return {
      scope: assistantMemoryScope,
      source: normalizeString(state?.source || ''),
      mission: truncateText(normalizeString(values.mission || values.assistantMission || ''), 240),
      companyContext: truncateText(normalizeString(values.companyContext || values.context || ''), 500),
      notes: parseAssistantMemoryNotes(
        values.notes || values.memoryNotes || values.entries || values.journal || ''
      ),
      updatedAt: normalizeString(state?.updatedAt || ''),
    };
  }

  function buildRecentSoftwareTimeline(dashboardContext) {
    const activities = Array.isArray(dashboardContext?.recentActivities)
      ? dashboardContext.recentActivities
      : [];

    return activities.slice(0, 18).map((item, index) => ({
      id: truncateText(normalizeString(item?.id || `activity-${index + 1}`), 80),
      time: truncateText(normalizeString(item?.tijd || item?.createdAt || ''), 80),
      title: truncateText(normalizeString(item?.titel || item?.title || ''), 200),
      detail: truncateText(normalizeString(item?.detail || ''), 240),
      company: truncateText(normalizeString(item?.bedrijf || item?.company || ''), 120),
      source: truncateText(normalizeString(item?.bron || item?.source || ''), 80),
      actor: truncateText(normalizeString(item?.actor || ''), 120),
    }));
  }

  async function buildAssistantContext(options = {}) {
    const dashboardContext =
      options.dashboardContext && typeof options.dashboardContext === 'object'
        ? options.dashboardContext
        : {};
    const memory = await loadAssistantMemory();
    const identity = buildAssistantIdentity();

    return {
      identity,
      memory,
      operatingRules: buildOperatingRules(),
      recentSoftwareTimeline: buildRecentSoftwareTimeline(dashboardContext),
      dashboardOverview: dashboardContext?.overview || {},
    };
  }

  function buildAssistantSystemPrompt(options = {}) {
    const assistantContext =
      options.assistantContext && typeof options.assistantContext === 'object'
        ? options.assistantContext
        : {};
    const identity =
      assistantContext.identity && typeof assistantContext.identity === 'object'
        ? assistantContext.identity
        : buildAssistantIdentity();

    return [
      `Je bent ${identity.name}, ${identity.role} van ${identity.company}.`,
      'Je bent geen losse generieke AI, maar een digitale collega die de Softora-software van binnenuit begeleidt.',
      'Je spreekt altijd in duidelijk Nederlands en antwoordt collegiaal, scherp en praktisch.',
      'Je gebruikt uitsluitend de aangeleverde context, het operationele geheugen en de recente software-activiteit.',
      'Als de gebruiker vraagt wat er gebeurd is, kijk je expliciet naar recente software-activiteit, calls, agenda, opdrachten, klanten en AI-insights.',
      'Als de gebruiker vraagt waarom iets zo werkt, leg je de samenhang tussen processen uit op basis van de operationele regels en het geheugen.',
      'Als data ontbreekt of onzeker is, zeg je dat expliciet en verzin je niets.',
      'Noem geen technische secrets, tokens, interne serverdetails of gevoelige configuratie.',
      'Beschouw leads, agenda, actieve opdrachten, klanten en coldcalling als één samenhangend systeem en leg verbanden uit wanneer dat relevant is.',
    ].join('\n');
  }

  function buildWelcomeMessage() {
    return 'Hoi, ik ben Ruben Nijhuis. Ik ben je digitale Softora-collega en houd overzicht over klanten, opdrachten, agenda, calls, AI-insights en recente software-activiteit.';
  }

  return {
    buildAssistantContext,
    buildAssistantIdentity,
    buildAssistantSystemPrompt,
    buildOperatingRules,
    buildRecentSoftwareTimeline,
    buildWelcomeMessage,
    loadAssistantMemory,
    parseAssistantMemoryNotes,
  };
}

module.exports = {
  createRubenAssistant,
};
