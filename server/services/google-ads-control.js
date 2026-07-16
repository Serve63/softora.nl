const GOOGLE_ADS_SCOPE = 'premium_google_ads';
const MACHINE_STATE_KEY = 'softora_google_ads_machine_v1';
const CONVERSION_LEDGER_KEY = 'softora_google_ads_conversion_ledger_v1';
const MAX_CONVERSION_EVENTS = 250;
const { buildGoogleAdsEditorAssetsCsv, buildGoogleAdsLaunchPack } = require('./google-ads-launch-pack');

const CAMPAIGN_BLUEPRINT = Object.freeze([
  {
    id: 'search-bedrijfssoftware-op-maat',
    name: 'Search | Bedrijfssoftware op maat',
    intent: 'Bedrijven die actief maatwerksoftware zoeken',
    landingPage: '/bedrijfssoftware-op-maat',
    matchTypes: ['exact', 'phrase'],
    themes: ['bedrijfssoftware op maat', 'maatwerk bedrijfssoftware', 'software laten maken'],
    status: 'draft-paused',
  },
  {
    id: 'search-crm-op-maat',
    name: 'Search | CRM op maat',
    intent: 'Bedrijven met concrete CRM-vervangings- of bouwintentie',
    landingPage: '/crm-systeem-op-maat',
    matchTypes: ['exact', 'phrase'],
    themes: ['crm systeem op maat', 'crm laten maken', 'maatwerk crm'],
    status: 'draft-paused',
  },
  {
    id: 'search-ai-telefonist',
    name: 'Search | AI Telefonist',
    intent: 'Bedrijven die telefonische bereikbaarheid willen automatiseren',
    landingPage: '/ai-telefonist',
    matchTypes: ['exact', 'phrase'],
    themes: ['ai telefonist', 'ai telefoonassistent', 'telefonische ai assistent'],
    status: 'draft-paused',
  },
]);

const SHARED_NEGATIVE_KEYWORDS = Object.freeze([
  'gratis',
  'vacature',
  'vacatures',
  'opleiding',
  'cursus',
  'stage',
  'salaris',
  'betekenis',
  'template',
  'voorbeeld',
  'zelf maken',
  'open source',
]);

function clean(value, maxLength = 300) {
  return String(value || '').trim().replace(/[\r\n]/g, ' ').slice(0, maxLength);
}

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(clean(value, 20));
}

function readConfiguration(env = process.env) {
  const config = {
    customerId: clean(env.GOOGLE_ADS_CUSTOMER_ID, 32),
    managerId: clean(env.GOOGLE_ADS_MANAGER_CUSTOMER_ID, 32),
    developerToken: clean(env.GOOGLE_ADS_DEVELOPER_TOKEN, 300),
    clientId: clean(env.GOOGLE_ADS_CLIENT_ID, 300),
    clientSecret: clean(env.GOOGLE_ADS_CLIENT_SECRET, 300),
    refreshToken: clean(env.GOOGLE_ADS_REFRESH_TOKEN, 1000),
    conversionId: clean(env.GOOGLE_ADS_CONVERSION_ID, 64),
    conversionLabel: clean(env.GOOGLE_ADS_CONVERSION_LABEL, 128),
    consentModeConfigured: isEnabled(env.GOOGLE_ADS_CONSENT_MODE_CONFIGURED),
  };

  return {
    accountConfigured: Boolean(config.customerId),
    managerConfigured: Boolean(config.managerId),
    apiConfigured: Boolean(
      config.developerToken && config.clientId && config.clientSecret && config.refreshToken
    ),
    conversionConfigured: Boolean(
      /^AW-\d{6,20}$/.test(config.conversionId) && config.conversionLabel
    ),
    consentModeConfigured: config.consentModeConfigured,
  };
}

function sanitizeAttribution(payload = {}) {
  const event = {
    id: clean(payload.id, 80),
    name: clean(payload.name, 80),
    page: clean(payload.page, 240),
    target: clean(payload.target, 40).toLowerCase(),
    landing: clean(payload.landing, 300),
    referrer: clean(payload.referrer, 500),
    path: clean(payload.path, 300),
    gclid: clean(payload.gclid, 180),
    gbraid: clean(payload.gbraid, 180),
    wbraid: clean(payload.wbraid, 180),
    utmSource: clean(payload.utmSource, 80),
    utmMedium: clean(payload.utmMedium, 80),
    utmCampaign: clean(payload.utmCampaign, 160),
    utmTerm: clean(payload.utmTerm, 160),
    at: clean(payload.at, 80),
  };

  if (!event.id || !event.name || !event.page || event.target !== 'whatsapp') return null;
  return event;
}

function createGoogleAdsControlService(deps = {}) {
  const getUiStateValues = deps.getUiStateValues;
  const setUiStateValues = deps.setUiStateValues;
  const env = deps.env || process.env;
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();

  async function readState() {
    if (typeof getUiStateValues !== 'function') return {};
    const values = await getUiStateValues(GOOGLE_ADS_SCOPE, {
      fallbackToMemory: false,
      suppressTimeoutLog: true,
    });
    return values && typeof values === 'object' ? values : {};
  }

  async function writePatch(patch) {
    if (typeof setUiStateValues !== 'function') return false;
    await setUiStateValues(GOOGLE_ADS_SCOPE, patch, { source: 'google-ads-control' });
    return true;
  }

  function buildReadiness(configuration, conversionCount, launchPack) {
    return [
      { id: 'blueprint', label: 'Zoekcampagnes en uitsluitingen', ready: true },
      { id: 'launch-pack', label: 'Advertentieteksten, keywords en assets gevalideerd', ready: launchPack.validation.valid },
      { id: 'landing-pages', label: 'Alle landingspagina-preflights groen', ready: launchPack.validation.landingPagesReady === launchPack.validation.landingPagesTotal },
      { id: 'cost-lock', label: 'Uitgaven en externe mutaties geblokkeerd', ready: true },
      { id: 'first-party', label: 'First-party conversieregistratie', ready: true },
      { id: 'consent-gate', label: 'Basic Consent Mode v2 tag-gate gebouwd', ready: true },
      { id: 'account', label: 'Google Ads-account gekoppeld', ready: configuration.accountConfigured },
      { id: 'api', label: 'Google Ads API OAuth gekoppeld', ready: configuration.apiConfigured },
      { id: 'consent', label: 'Consent Mode v2 geconfigureerd', ready: configuration.consentModeConfigured },
      { id: 'conversion', label: 'Google conversie-ID en label ingesteld', ready: configuration.conversionConfigured },
      { id: 'signal', label: 'Eerste echte conversie ontvangen', ready: conversionCount > 0 },
    ];
  }

  async function getStatus() {
    const state = await readState();
    const configuration = readConfiguration(env);
    const conversions = Array.isArray(state[CONVERSION_LEDGER_KEY])
      ? state[CONVERSION_LEDGER_KEY]
      : [];
    const launchPack = buildGoogleAdsLaunchPack();
    const readiness = buildReadiness(configuration, conversions.length, launchPack);
    return {
      mode: 'dry-run',
      spendEnabled: false,
      externalMutationsEnabled: false,
      approvedBudgetCents: 0,
      liveCampaigns: 0,
      spendCents: 0,
      conversionCount: conversions.length,
      configuration,
      publicTagEnabled: configuration.conversionConfigured && configuration.consentModeConfigured,
      readiness,
      readinessReady: readiness.filter((item) => item.ready).length,
      readinessTotal: readiness.length,
      lastRun: state[MACHINE_STATE_KEY]?.lastRun || null,
      launchPackValid: launchPack.validation.valid,
    };
  }

  function getPublicConfig() {
    const configuration = readConfiguration(env);
    const enabled = configuration.conversionConfigured && configuration.consentModeConfigured;
    return {
      enabled,
      consentMode: 'basic-v2',
      tagId: enabled ? clean(env.GOOGLE_ADS_CONVERSION_ID, 64) : '',
      conversionLabel: enabled ? clean(env.GOOGLE_ADS_CONVERSION_LABEL, 128) : '',
    };
  }

  async function runDryRun() {
    const status = await getStatus();
    const nextBlocker = status.readiness.find((item) => !item.ready);
    const result = {
      id: `google-ads-dry-run-${now().getTime()}`,
      mode: 'dry-run',
      ranAt: now().toISOString(),
      outcome: nextBlocker ? 'blocked-safe-action' : 'launch-ready-awaiting-budget-approval',
      selectedAction: nextBlocker
        ? `Los eerst op: ${nextBlocker.label}.`
        : 'Meetfundament is gereed; wacht op expliciete goedkeuring van één concreet budget.',
      reason: nextBlocker
        ? 'De machine pakt de eerste ontbrekende veiligheidsvoorwaarde en activeert niets.'
        : 'Alle technische voorwaarden zijn groen, maar geld uitgeven blijft afzonderlijk vergrendeld.',
      spendCents: 0,
      mutationsPerformed: 0,
    };
    await writePatch({ [MACHINE_STATE_KEY]: { lastRun: result } });
    return result;
  }

  async function recordConversion(payload) {
    const event = sanitizeAttribution(payload);
    if (!event) return null;
    const state = await readState();
    const current = Array.isArray(state[CONVERSION_LEDGER_KEY])
      ? state[CONVERSION_LEDGER_KEY]
      : [];
    if (current.some((item) => item && item.id === event.id)) return event;
    const received = { ...event, receivedAt: now().toISOString() };
    await writePatch({
      [CONVERSION_LEDGER_KEY]: current.concat(received).slice(-MAX_CONVERSION_EVENTS),
    });
    return received;
  }

  function getBlueprint() {
    return {
      campaigns: CAMPAIGN_BLUEPRINT,
      sharedNegativeKeywords: SHARED_NEGATIVE_KEYWORDS,
      bidding: 'Niet ingesteld; pas na conversiedata en budgetgoedkeuring.',
      geography: 'Nederland; definitieve regio vóór activatie bevestigen.',
      network: 'Google Search only; Display-partners uit in het concept.',
    };
  }

  function getLaunchPack() {
    return buildGoogleAdsLaunchPack();
  }

  function getEditorAssetsCsv() {
    return buildGoogleAdsEditorAssetsCsv(getLaunchPack());
  }

  return { getBlueprint, getEditorAssetsCsv, getLaunchPack, getPublicConfig, getStatus, recordConversion, runDryRun, sanitizeAttribution };
}

module.exports = {
  CAMPAIGN_BLUEPRINT,
  CONVERSION_LEDGER_KEY,
  GOOGLE_ADS_SCOPE,
  MACHINE_STATE_KEY,
  SHARED_NEGATIVE_KEYWORDS,
  createGoogleAdsControlService,
  readConfiguration,
  sanitizeAttribution,
};
