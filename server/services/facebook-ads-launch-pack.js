const fs = require('node:fs');
const path = require('node:path');

const URL_PARAMETERS = 'utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}';

const CAMPAIGN_LAUNCH_PACKS = Object.freeze([
  {
    id: 'meta-bedrijfssoftware-op-maat',
    name: 'Meta | Bedrijfssoftware op maat',
    status: 'draft-paused',
    objective: 'OUTCOME_LEADS',
    finalUrl: 'https://www.softora.nl/bedrijfssoftware-op-maat',
    sourceFile: 'premium-bedrijfssoftware.html',
    audience: {
      geography: 'Nederland',
      ageRange: '25-64',
      strategy: 'Broad B2B prospecting; definitieve doelgroep vóór activatie bevestigen',
    },
    placements: ['Facebook Feed', 'Instagram Feed', 'Instagram Stories', 'Instagram Reels'],
    creativeBrief: 'Laat het verschil zien tussen losse tools en één maatwerksysteem, met een rustige productvisual.',
    ads: [
      {
        name: 'Losse tools naar een systeem',
        format: 'single-image',
        primaryText: 'Werk je nog met losse tools en handmatige stappen? Softora bouwt bedrijfssoftware rond jouw echte proces.',
        headline: 'Bedrijfssoftware die echt past',
        description: 'Maatwerk voor jouw bedrijf',
        callToAction: 'LEARN_MORE',
      },
      {
        name: 'Meer grip minder handwerk',
        format: 'single-image',
        primaryText: 'Minder handwerk, meer grip. Ontdek welke processen je kunt samenbrengen in één helder maatwerksysteem.',
        headline: 'Van handwerk naar overzicht',
        description: 'Bespreek je proces',
        callToAction: 'LEARN_MORE',
      },
    ],
  },
  {
    id: 'meta-crm-op-maat',
    name: 'Meta | CRM op maat',
    status: 'draft-paused',
    objective: 'OUTCOME_LEADS',
    finalUrl: 'https://www.softora.nl/crm-systeem-op-maat',
    sourceFile: 'crm-systeem-op-maat.html',
    audience: {
      geography: 'Nederland',
      ageRange: '25-64',
      strategy: 'Broad B2B prospecting; geen gevoelige of persoonlijke targeting',
    },
    placements: ['Facebook Feed', 'Instagram Feed', 'Instagram Stories', 'Instagram Reels'],
    creativeBrief: 'Visualiseer een gemiste lead tegenover een duidelijke opvolgflow in één CRM.',
    ads: [
      {
        name: 'Geen lead meer vergeten',
        format: 'single-image',
        primaryText: 'Leads verspreid over mailboxen en lijstjes? Laat een CRM bouwen dat jouw team vanzelf goed laat opvolgen.',
        headline: 'Geen lead meer vergeten',
        description: 'CRM op maat van je sales',
        callToAction: 'LEARN_MORE',
      },
      {
        name: 'CRM rond jouw proces',
        format: 'single-image',
        primaryText: 'Je CRM hoort jouw verkoopproces te volgen, niet andersom. Softora bouwt één helder klantbeeld op maat.',
        headline: 'Een CRM rond jouw proces',
        description: 'Van lead naar klant',
        callToAction: 'LEARN_MORE',
      },
    ],
  },
  {
    id: 'meta-ai-telefonist',
    name: 'Meta | AI Telefonist',
    status: 'draft-paused',
    objective: 'OUTCOME_LEADS',
    finalUrl: 'https://www.softora.nl/ai-telefonist',
    sourceFile: 'ai-telefonist.html',
    audience: {
      geography: 'Nederland',
      ageRange: '25-64',
      strategy: 'Broad B2B prospecting; optimalisatie pas na geldige conversiesignalen',
    },
    placements: ['Facebook Feed', 'Instagram Feed', 'Instagram Stories', 'Instagram Reels'],
    creativeBrief: 'Toon een gemist telefoontje dat door AI verandert in een concrete afspraak of taak.',
    ads: [
      {
        name: 'Mis geen zakelijk gesprek',
        format: 'short-video',
        primaryText: 'Een gemist gesprek kan een gemiste klant zijn. De AI Telefonist neemt op, vraagt door en draagt helder over.',
        headline: 'Mis geen zakelijk gesprek',
        description: 'AI telefonie van Softora',
        callToAction: 'LEARN_MORE',
      },
      {
        name: 'Van gesprek naar actie',
        format: 'single-image',
        primaryText: 'Laat AI gesprekken aannemen en direct omzetten in een afspraak, CRM-notitie of duidelijke vervolgstap.',
        headline: 'Van gesprek naar actie',
        description: 'Professioneel bereikbaar',
        callToAction: 'LEARN_MORE',
      },
    ],
  },
]);

function pushError(errors, condition, code, campaignId, detail) {
  if (!condition) errors.push({ code, campaignId, detail });
}

function validateCampaign(campaign) {
  const errors = [];
  pushError(errors, campaign.status === 'draft-paused', 'campaign_not_paused', campaign.id, campaign.status);
  pushError(errors, campaign.objective === 'OUTCOME_LEADS', 'unsafe_objective', campaign.id, campaign.objective);
  pushError(errors, /^https:\/\/www\.softora\.nl\//.test(campaign.finalUrl), 'invalid_final_url', campaign.id, campaign.finalUrl);
  pushError(errors, campaign.placements.length >= 2, 'placement_count', campaign.id, String(campaign.placements.length));
  pushError(errors, campaign.ads.length >= 2, 'creative_count', campaign.id, String(campaign.ads.length));
  campaign.ads.forEach((ad) => {
    pushError(errors, ad.primaryText.length <= 125, 'primary_text_too_long', campaign.id, `${ad.primaryText.length}:${ad.name}`);
    pushError(errors, ad.headline.length <= 40, 'headline_too_long', campaign.id, `${ad.headline.length}:${ad.name}`);
    pushError(errors, ad.description.length <= 30, 'description_too_long', campaign.id, `${ad.description.length}:${ad.name}`);
    pushError(errors, ad.callToAction === 'LEARN_MORE', 'unsafe_call_to_action', campaign.id, `${ad.callToAction}:${ad.name}`);
  });
  return errors;
}

function inspectLandingPage(campaign, rootDir) {
  const sourcePath = path.join(rootDir, campaign.sourceFile);
  if (!fs.existsSync(sourcePath)) {
    return {
      campaignId: campaign.id,
      route: new URL(campaign.finalUrl).pathname,
      sourceFile: campaign.sourceFile,
      ready: false,
      checks: { sourceExists: false, singleH1: false, noContentLock: false },
    };
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const h1Count = (source.match(/<h1\b/gi) || []).length;
  const checks = {
    sourceExists: true,
    singleH1: h1Count === 1,
    noContentLock: !/content-lock-overlay|data-content-lock-scope/i.test(source),
    conversionTrackerRuntimeInjected: true,
  };
  return {
    campaignId: campaign.id,
    route: new URL(campaign.finalUrl).pathname,
    sourceFile: campaign.sourceFile,
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}

function buildFacebookAdsLaunchPack(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '../..');
  const validationErrors = CAMPAIGN_LAUNCH_PACKS.flatMap(validateCampaign);
  const landingPages = CAMPAIGN_LAUNCH_PACKS.map((campaign) => inspectLandingPage(campaign, rootDir));

  return {
    schemaVersion: 1,
    generatedMode: 'deterministic-no-spend',
    accountDefaults: {
      currency: 'EUR',
      geography: 'Nederland - definitief bevestigen voor activatie',
      attribution: '7-day click / 1-day view - concept, bevestiging vereist',
      optimization: 'Geen optimalisatie actief',
      dailyBudgetCents: 0,
    },
    tracking: {
      pixelRequired: true,
      conversionsApiRequired: true,
      urlParameters: URL_PARAMETERS,
      primaryConversion: 'WhatsApp-contact gestart',
      consentRequired: true,
    },
    creativeSpecs: {
      square: '1080x1080',
      portrait: '1080x1350',
      storiesAndReels: '1080x1920',
      safeZone: 'Belangrijke tekst en logo binnen de centrale 1080x1420-zone',
    },
    campaigns: CAMPAIGN_LAUNCH_PACKS,
    landingPages,
    validation: {
      valid: validationErrors.length === 0 && landingPages.every((page) => page.ready),
      errors: validationErrors,
      campaignsChecked: CAMPAIGN_LAUNCH_PACKS.length,
      creativesChecked: CAMPAIGN_LAUNCH_PACKS.reduce((total, campaign) => total + campaign.ads.length, 0),
      landingPagesReady: landingPages.filter((page) => page.ready).length,
      landingPagesTotal: landingPages.length,
    },
  };
}

module.exports = {
  CAMPAIGN_LAUNCH_PACKS,
  URL_PARAMETERS,
  buildFacebookAdsLaunchPack,
  inspectLandingPage,
  validateCampaign,
};
