const fs = require('node:fs');
const path = require('node:path');

const FINAL_URL_SUFFIX = 'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&utm_content={creative}';

const SHARED_ASSETS = Object.freeze({
  callouts: [
    'Maatwerk van Softora',
    'Persoonlijke aanpak',
    'Gebouwd voor groei',
    'Duidelijke vervolgstap',
  ],
  sitelinks: [
    { text: 'Bekijk onze diensten', finalUrl: 'https://www.softora.nl/diensten', description1: 'Ontdek alle oplossingen', description2: 'Voor software en groei' },
    { text: 'AI automatisering', finalUrl: 'https://www.softora.nl/ai-automatisering', description1: 'Automatiseer slim werk', description2: 'Met veilige overdracht' },
    { text: 'Website laten maken', finalUrl: 'https://www.softora.nl/website-laten-maken', description1: 'Een website voor leads', description2: 'Sterk, snel en meetbaar' },
    { text: 'Over Softora', finalUrl: 'https://www.softora.nl/over-softora', description1: 'Leer Softora kennen', description2: 'Bekijk onze werkwijze' },
  ],
});

const CAMPAIGN_LAUNCH_PACKS = Object.freeze([
  {
    id: 'search-bedrijfssoftware-op-maat',
    name: 'Search | Bedrijfssoftware op maat',
    status: 'draft-paused',
    advertisingChannelType: 'SEARCH',
    networks: { googleSearch: true, searchPartners: false, display: false },
    finalUrl: 'https://www.softora.nl/bedrijfssoftware-op-maat',
    sourceFile: 'premium-bedrijfssoftware.html',
    path1: 'software',
    path2: 'op-maat',
    headlines: [
      'Bedrijfssoftware Op Maat',
      'Software Die Echt Past',
      'Laat Bedrijfssoftware Maken',
      'Minder Handwerk, Meer Grip',
      'Eén Systeem Voor Je Proces',
      'Softora Bouwt Maatwerk',
      'Automatiseer Slimmer',
      'Van Losse Tools Naar Eén',
      'Gebouwd Rond Jouw Team',
      'Plan Een Kennismaking',
      'Meer Overzicht In Je Bedrijf',
      'Software Zonder Omwegen',
    ],
    descriptions: [
      'Laat bedrijfssoftware bouwen rond je processen, team en groeiplannen. Bespreek je idee.',
      'Vervang losse tools en handwerk door één helder maatwerksysteem van Softora.',
      'Van analyse tot oplevering: praktische software die aansluit op hoe je bedrijf werkt.',
      'Ontdek waar maatwerk tijd bespaart en grip geeft. Start een gesprek met Softora.',
    ],
    keywords: [
      { text: 'bedrijfssoftware op maat', matchType: 'EXACT' },
      { text: 'bedrijfssoftware op maat', matchType: 'PHRASE' },
      { text: 'maatwerk bedrijfssoftware', matchType: 'EXACT' },
      { text: 'maatwerk bedrijfssoftware', matchType: 'PHRASE' },
      { text: 'bedrijfssoftware laten maken', matchType: 'EXACT' },
      { text: 'software voor bedrijf laten maken', matchType: 'PHRASE' },
    ],
  },
  {
    id: 'search-crm-op-maat',
    name: 'Search | CRM op maat',
    status: 'draft-paused',
    advertisingChannelType: 'SEARCH',
    networks: { googleSearch: true, searchPartners: false, display: false },
    finalUrl: 'https://www.softora.nl/crm-systeem-op-maat',
    sourceFile: 'crm-systeem-op-maat.html',
    path1: 'crm',
    path2: 'op-maat',
    headlines: [
      'CRM Systeem Op Maat',
      'Laat Je CRM Bouwen',
      'CRM Rond Jouw Salesproces',
      'Meer Grip Op Leads',
      'Volg Elke Kans Slim Op',
      'Geen Leads Meer Vergeten',
      'Softora Bouwt Jouw CRM',
      'Van Lead Naar Klant',
      'Eén Helder Klantbeeld',
      'Automatiseer Je Opvolging',
      'Plan Een CRM Gesprek',
      'CRM Zonder Overbodige Ruis',
    ],
    descriptions: [
      'Laat een CRM bouwen rond je eigen salesproces, team en opvolging. Bespreek je wensen.',
      'Breng leads, taken en klantinformatie samen in één helder CRM-systeem van Softora.',
      'Voorkom losse lijsten en gemiste opvolging met een CRM dat werkt zoals jouw team werkt.',
      'Ontdek hoe maatwerk-CRM meer grip geeft van eerste lead tot vaste klant.',
    ],
    keywords: [
      { text: 'crm systeem op maat', matchType: 'EXACT' },
      { text: 'crm systeem op maat', matchType: 'PHRASE' },
      { text: 'crm laten maken', matchType: 'EXACT' },
      { text: 'crm laten maken', matchType: 'PHRASE' },
      { text: 'maatwerk crm', matchType: 'EXACT' },
      { text: 'crm software op maat', matchType: 'PHRASE' },
    ],
  },
  {
    id: 'search-ai-telefonist',
    name: 'Search | AI Telefonist',
    status: 'draft-paused',
    advertisingChannelType: 'SEARCH',
    networks: { googleSearch: true, searchPartners: false, display: false },
    finalUrl: 'https://www.softora.nl/ai-telefonist',
    sourceFile: 'ai-telefonist.html',
    path1: 'ai',
    path2: 'telefonist',
    headlines: [
      'AI Telefonist Voor Bedrijven',
      'Mis Geen Zakelijk Gesprek',
      'AI Neemt De Telefoon Op',
      'Professioneel Bereikbaar',
      'Slimme Telefonische Intake',
      'Laat Bellers Goed Helpen',
      'AI Telefonie Van Softora',
      'Van Gesprek Naar Actie',
      'Koppel Met Agenda En CRM',
      'Plan Een AI Telefonie Demo',
      'Altijd Duidelijke Overdracht',
      'Start Met Een AI Telefonist',
    ],
    descriptions: [
      'Laat AI gesprekken aannemen, vragen stellen en duidelijk overdragen aan je team.',
      'Blijf professioneel bereikbaar en zet ieder gesprek om in een bruikbare vervolgstap.',
      'Koppel telefonische intake aan je agenda, CRM en opvolging met Softora AI-telefonie.',
      'Ontdek hoe een AI telefonist past bij jouw gesprekken. Plan een gerichte kennismaking.',
    ],
    keywords: [
      { text: 'ai telefonist', matchType: 'EXACT' },
      { text: 'ai telefonist', matchType: 'PHRASE' },
      { text: 'ai telefoonassistent', matchType: 'EXACT' },
      { text: 'ai telefoonassistent', matchType: 'PHRASE' },
      { text: 'ai telefonie bedrijf', matchType: 'EXACT' },
      { text: 'telefonische ai assistent', matchType: 'PHRASE' },
    ],
  },
]);

function pushError(errors, condition, code, campaignId, detail) {
  if (!condition) errors.push({ code, campaignId, detail });
}

function validateCampaign(campaign) {
  const errors = [];
  pushError(errors, campaign.status === 'draft-paused', 'campaign_not_paused', campaign.id, campaign.status);
  pushError(errors, campaign.advertisingChannelType === 'SEARCH', 'channel_not_search', campaign.id, campaign.advertisingChannelType);
  pushError(errors, campaign.networks.googleSearch && !campaign.networks.searchPartners && !campaign.networks.display, 'unsafe_networks', campaign.id, JSON.stringify(campaign.networks));
  pushError(errors, /^https:\/\/www\.softora\.nl\//.test(campaign.finalUrl), 'invalid_final_url', campaign.id, campaign.finalUrl);
  pushError(errors, campaign.path1.length <= 15 && campaign.path2.length <= 15, 'display_path_too_long', campaign.id, `${campaign.path1}/${campaign.path2}`);
  pushError(errors, campaign.headlines.length >= 3 && campaign.headlines.length <= 15, 'headline_count', campaign.id, String(campaign.headlines.length));
  pushError(errors, campaign.descriptions.length >= 2 && campaign.descriptions.length <= 4, 'description_count', campaign.id, String(campaign.descriptions.length));
  campaign.headlines.forEach((value) => pushError(errors, value.length <= 30, 'headline_too_long', campaign.id, `${value.length}:${value}`));
  campaign.descriptions.forEach((value) => pushError(errors, value.length <= 90, 'description_too_long', campaign.id, `${value.length}:${value}`));
  pushError(errors, new Set(campaign.headlines).size === campaign.headlines.length, 'duplicate_headline', campaign.id, 'headlines');
  pushError(errors, new Set(campaign.descriptions).size === campaign.descriptions.length, 'duplicate_description', campaign.id, 'descriptions');
  campaign.keywords.forEach((keyword) => pushError(errors, ['EXACT', 'PHRASE'].includes(keyword.matchType), 'unsafe_match_type', campaign.id, keyword.matchType));
  return errors;
}

function inspectLandingPage(campaign, rootDir) {
  const sourcePath = path.join(rootDir, campaign.sourceFile);
  if (!fs.existsSync(sourcePath)) {
    return { campaignId: campaign.id, route: new URL(campaign.finalUrl).pathname, sourceFile: campaign.sourceFile, ready: false, checks: { sourceExists: false, singleH1: false, noContentLock: false } };
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

function buildGoogleAdsLaunchPack(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '../..');
  const validationErrors = CAMPAIGN_LAUNCH_PACKS.flatMap(validateCampaign);
  SHARED_ASSETS.callouts.forEach((value) => {
    if (value.length > 25) validationErrors.push({ code: 'callout_too_long', campaignId: 'shared', detail: `${value.length}:${value}` });
  });
  SHARED_ASSETS.sitelinks.forEach((item) => {
    if (item.text.length > 25 || item.description1.length > 35 || item.description2.length > 35) {
      validationErrors.push({ code: 'sitelink_too_long', campaignId: 'shared', detail: item.text });
    }
  });
  const landingPages = CAMPAIGN_LAUNCH_PACKS.map((campaign) => inspectLandingPage(campaign, rootDir));

  return {
    schemaVersion: 1,
    generatedMode: 'deterministic-no-spend',
    accountDefaults: {
      currency: 'EUR',
      language: 'nl',
      geography: 'Nederland - definitief bevestigen voor activatie',
      adSchedule: 'Werkdagen 08:00-18:00 - concept, bevestiging vereist',
      bidding: 'Niet ingesteld',
      dailyBudgetCents: 0,
    },
    tracking: {
      autoTaggingRequired: true,
      finalUrlSuffix: FINAL_URL_SUFFIX,
      primaryConversion: 'WhatsApp-contact gestart',
      enhancedConversions: 'Niet actief; vereist consent en bruikbare first-party leadgegevens',
    },
    sharedAssets: SHARED_ASSETS,
    campaigns: CAMPAIGN_LAUNCH_PACKS,
    landingPages,
    validation: {
      valid: validationErrors.length === 0 && landingPages.every((page) => page.ready),
      errors: validationErrors,
      campaignsChecked: CAMPAIGN_LAUNCH_PACKS.length,
      landingPagesReady: landingPages.filter((page) => page.ready).length,
      landingPagesTotal: landingPages.length,
    },
  };
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildGoogleAdsEditorAssetsCsv(launchPack = buildGoogleAdsLaunchPack()) {
  if (!launchPack.validation?.valid) throw new Error('Google Ads launch-pack is niet valide.');
  const headers = [
    'Campaign', 'Ad group', 'Status', 'Keyword', 'Match type', 'Final URL',
    ...Array.from({ length: 15 }, (_value, index) => `Headline ${index + 1}`),
    ...Array.from({ length: 4 }, (_value, index) => `Description ${index + 1}`),
    'Path 1', 'Path 2', 'Final URL suffix',
  ];
  const rows = [headers];

  launchPack.campaigns.forEach((campaign) => {
    const base = [campaign.name, 'Kernintentie', 'Paused'];
    campaign.keywords.forEach((keyword) => {
      rows.push([
        ...base,
        keyword.text,
        keyword.matchType === 'EXACT' ? 'Exact' : 'Phrase',
        campaign.finalUrl,
        ...Array(15).fill(''),
        ...Array(4).fill(''),
        '', '', launchPack.tracking.finalUrlSuffix,
      ]);
    });
    rows.push([
      ...base,
      '', '', campaign.finalUrl,
      ...Array.from({ length: 15 }, (_value, index) => campaign.headlines[index] || ''),
      ...Array.from({ length: 4 }, (_value, index) => campaign.descriptions[index] || ''),
      campaign.path1, campaign.path2, launchPack.tracking.finalUrlSuffix,
    ]);
  });

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = {
  CAMPAIGN_LAUNCH_PACKS,
  FINAL_URL_SUFFIX,
  SHARED_ASSETS,
  buildGoogleAdsLaunchPack,
  buildGoogleAdsEditorAssetsCsv,
  inspectLandingPage,
  validateCampaign,
};
