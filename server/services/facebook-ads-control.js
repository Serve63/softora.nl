const {
  CAMPAIGN_LAUNCH_PACKS,
  buildFacebookAdsLaunchPack,
} = require('./facebook-ads-launch-pack');

const FACEBOOK_ADS_SCOPE = 'premium_facebook_ads';
const MACHINE_STATE_KEY = 'softora_facebook_ads_machine_v1';

function clean(value, maxLength = 300) {
  return String(value || '').trim().replace(/[\r\n]/g, ' ').slice(0, maxLength);
}

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(clean(value, 20));
}

function readConfiguration(env = process.env) {
  const config = {
    adAccountId: clean(env.META_ADS_ACCOUNT_ID, 64),
    businessId: clean(env.META_BUSINESS_ID, 64),
    pixelId: clean(env.META_PIXEL_ID, 64),
    accessToken: clean(env.META_ACCESS_TOKEN, 1000),
    consentConfigured: isEnabled(env.META_ADS_CONSENT_CONFIGURED),
    conversionsApiConfigured: isEnabled(env.META_CAPI_CONFIGURED),
  };

  return {
    accountConfigured: Boolean(config.adAccountId && config.businessId),
    apiConfigured: Boolean(config.accessToken),
    pixelConfigured: /^\d{6,30}$/.test(config.pixelId),
    consentConfigured: config.consentConfigured,
    conversionsApiConfigured: config.conversionsApiConfigured,
  };
}

function createFacebookAdsControlService(deps = {}) {
  const getUiStateValues = deps.getUiStateValues;
  const setUiStateValues = deps.setUiStateValues;
  const env = deps.env || process.env;
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();

  async function readState() {
    if (typeof getUiStateValues !== 'function') return {};
    const values = await getUiStateValues(FACEBOOK_ADS_SCOPE, {
      fallbackToMemory: false,
      suppressTimeoutLog: true,
    });
    return values && typeof values === 'object' ? values : {};
  }

  async function writePatch(patch) {
    if (typeof setUiStateValues !== 'function') return false;
    await setUiStateValues(FACEBOOK_ADS_SCOPE, patch, { source: 'facebook-ads-control' });
    return true;
  }

  function buildReadiness(configuration, launchPack) {
    return [
      { id: 'blueprint', label: 'Meta-campagnes, doelgroepen en plaatsingen', ready: true },
      { id: 'launch-pack', label: 'Copy, creative briefs en URL-tracking gevalideerd', ready: launchPack.validation.valid },
      { id: 'landing-pages', label: 'Alle landingspagina-preflights groen', ready: launchPack.validation.landingPagesReady === launchPack.validation.landingPagesTotal },
      { id: 'cost-lock', label: 'Uitgaven en externe mutaties geblokkeerd', ready: true },
      { id: 'account', label: 'Meta Business Portfolio en advertentieaccount gekoppeld', ready: configuration.accountConfigured },
      { id: 'api', label: 'Meta Marketing API-token gekoppeld', ready: configuration.apiConfigured },
      { id: 'pixel', label: 'Meta Pixel/dataset-ID ingesteld', ready: configuration.pixelConfigured },
      { id: 'capi', label: 'Conversions API server-side geconfigureerd', ready: configuration.conversionsApiConfigured },
      { id: 'consent', label: 'Advertentieconsent voor Meta geconfigureerd', ready: configuration.consentConfigured },
    ];
  }

  async function getStatus() {
    const state = await readState();
    const configuration = readConfiguration(env);
    const launchPack = buildFacebookAdsLaunchPack();
    const readiness = buildReadiness(configuration, launchPack);
    return {
      mode: 'dry-run',
      spendEnabled: false,
      externalMutationsEnabled: false,
      approvedBudgetCents: 0,
      liveCampaigns: 0,
      spendCents: 0,
      configuration,
      readiness,
      readinessReady: readiness.filter((item) => item.ready).length,
      readinessTotal: readiness.length,
      lastRun: state[MACHINE_STATE_KEY]?.lastRun || null,
      launchPackValid: launchPack.validation.valid,
    };
  }

  async function runDryRun() {
    const status = await getStatus();
    const nextBlocker = status.readiness.find((item) => !item.ready);
    const result = {
      id: `facebook-ads-dry-run-${now().getTime()}`,
      mode: 'dry-run',
      ranAt: now().toISOString(),
      outcome: nextBlocker ? 'blocked-safe-action' : 'launch-ready-awaiting-budget-approval',
      selectedAction: nextBlocker
        ? `Los eerst op: ${nextBlocker.label}.`
        : 'Techniek en creatives zijn gereed; wacht op expliciete goedkeuring van één concreet budget.',
      reason: nextBlocker
        ? 'De machine pakt de eerste ontbrekende veiligheidsvoorwaarde en activeert niets.'
        : 'Alle technische voorwaarden zijn groen, maar geld uitgeven blijft afzonderlijk vergrendeld.',
      spendCents: 0,
      mutationsPerformed: 0,
    };
    await writePatch({ [MACHINE_STATE_KEY]: { lastRun: result } });
    return result;
  }

  function getBlueprint() {
    return {
      campaigns: CAMPAIGN_LAUNCH_PACKS.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        destination: new URL(campaign.finalUrl).pathname,
        audience: campaign.audience,
        placements: campaign.placements,
        creativeBrief: campaign.creativeBrief,
        status: campaign.status,
      })),
      optimization: 'Geen algoritmische optimalisatie vóór geldige conversiemeting en budgetgoedkeuring.',
      exclusions: ['Bestaande klanten vóór activatie uitsluiten', 'Medewerkers en bekende testaccounts uitsluiten'],
    };
  }

  function getLaunchPack() {
    return buildFacebookAdsLaunchPack();
  }

  return {
    getBlueprint,
    getLaunchPack,
    getStatus,
    runDryRun,
  };
}

module.exports = {
  FACEBOOK_ADS_SCOPE,
  MACHINE_STATE_KEY,
  createFacebookAdsControlService,
  readConfiguration,
};
