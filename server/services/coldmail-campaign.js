const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const dnsNative = require('node:dns');
const dns = dnsNative.promises;
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { buildChunkedStatePatch, readChunkedStateValue } = require('./data-ops-serialization');
const { createMailboxService } = require('./mailbox');
const {
  canAdvanceContactStatus,
  normalizeContactStatus,
} = require('./customer-lifecycle');
const { appendSentMessage } = require('./mailbox-sent-copy');
const { buildOpenAiContextHeaders } = require('./openai-request-context');
const previewImageCache = require('./coldmail-preview-image-cache');
const {
  fitWebdesignPreviewForEmail,
  removeDecorativeWebdesignFrameForEmail,
} = require('./coldmail-image-frame');
const {
  WEBDESIGN_EMAIL_MOCKUP_CAPTION: COLDMAIL_MOCKUP_CAPTION,
  WEBDESIGN_EMAIL_TEMPLATE_VERSION,
  renderWebdesignEmailDocument,
  renderWebdesignImageSection,
} = require('./webdesign-email-renderer');

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const DEFAULT_LEAD_DB_SCOPE = 'coldcalling';
const DEFAULT_LEAD_DB_KEY = 'softora_coldcalling_lead_rows_json';
const DEFAULT_CUSTOMER_PHOTO_SCOPE = 'premium_database_photos';
const DEFAULT_CUSTOMER_PHOTO_KEY = 'softora_database_photos_v1';
const DEFAULT_COLDMAIL_REPLY_SCOPE = 'premium_coldmail_auto_replies';
const DEFAULT_COLDMAIL_REPLY_KEY = 'softora_coldmail_auto_replies_v1';
const DEFAULT_COLDMAIL_SEND_GUARD_SCOPE = 'premium_coldmail_send_guard';
const DEFAULT_COLDMAIL_SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';
const DEFAULT_COLDMAILING_SETTINGS_SCOPE = 'premium_coldmailing_settings';
const DEFAULT_COLDMAILING_SETTINGS_KEY = 'softora_coldmailing_settings_v1';
const DEFAULT_COLDMAIL_AUTOPILOT_SCOPE = 'premium_coldmail_autopilot';
const DEFAULT_COLDMAIL_AUTOPILOT_KEY = 'softora_coldmail_autopilot_v1';
const DEFAULT_COLDMAIL_STATS_CACHE_SCOPE = 'premium_coldmail_stats_cache';
const DEFAULT_COLDMAIL_STATS_CACHE_KEY = 'softora_coldmail_stats_cache_v1';
const COLDMAIL_LIVE_STATS_MEMORY_TTL_MS = 30 * 1000;
const COLDMAIL_LIVE_STATS_DURABLE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT = 9;
const DEFAULT_COLDMAIL_DAILY_SEND_LIMIT = 9;
const DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT = 81;
const DEFAULT_COLDMAIL_AUTOPILOT_DAILY_TARGET_MINIMUM = DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT;
const DEFAULT_COLDMAIL_SEND_DELAY_MS = 90_000;
const DEFAULT_COLDMAIL_SAFETY_PAUSE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT = 9;
const DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS = 180_000;
const DEFAULT_COLDMAIL_AUTOPILOT_BATCH_SIZE = 1;
const DEFAULT_COLDMAIL_AUTOPILOT_LOCK_MS = 12 * 60 * 1000;
const DEFAULT_COLDMAIL_SMTP_CONNECTION_TIMEOUT_MS = 45_000;
const DEFAULT_COLDMAIL_SMTP_GREETING_TIMEOUT_MS = 30_000;
const DEFAULT_COLDMAIL_SMTP_SOCKET_TIMEOUT_MS = 90_000;
const DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE = 'Europe/Amsterdam';
const DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR = 7;
const DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR = 17;
const DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES = 5;
const DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES = 60;
const DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES = 74;
const DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MIN_SECONDS = 45;
const DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MAX_SECONDS = 240;
const COLDMAIL_AUTOPILOT_DAY_SLOT_READY_GRACE_MS = 10 * 1000;
const COLDMAIL_AUTOPILOT_STATE_VALUE_SOFT_LIMIT = 160_000;
const MAX_COLDMAIL_RADIUS_KM = 500;
const COLDMAIL_SEND_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000;
const COLDMAIL_RECIPIENT_GUARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const COLDMAIL_POST_SMTP_PERSISTENCE_RETRY_DELAYS_MS = [250, 1000, 2500];
const COLDMAIL_SENDER_COOLDOWN_LOCK_SAFETY_MS = 90 * 1000;
const COLDMAIL_SENDER_COOLDOWN_PREFLIGHT_TTL_MS =
  DEFAULT_COLDMAIL_AUTOPILOT_LOCK_MS + COLDMAIL_SENDER_COOLDOWN_LOCK_SAFETY_MS;
const COLDMAIL_AUTOPILOT_KNOWN_SKIP_CODES = new Set([
  'COLDMAIL_AUTOPILOT_DISABLED',
  'COLDMAIL_AUTOPILOT_STATE_UNAVAILABLE',
  'COLDMAIL_DAILY_LIMIT_REACHED',
  'COLDMAIL_RECIPIENT_RECENTLY_SENT',
  'COLDMAIL_SAFETY_PAUSED',
  'COLDMAIL_SEND_IN_PROGRESS',
  'COLDMAIL_SENDER_COOLDOWN_ACTIVE',
  'COLDMAIL_AUTOPILOT_OUTSIDE_SCHEDULE',
  'EMPTY_MAIL_CONTENT',
  'NO_RECIPIENTS',
  'NO_SENDER_CAPACITY',
  'NO_VALID_RECIPIENT_DOMAINS',
  'NO_WEBDESIGN_PHOTOS',
  'SENDER_SMTP_NOT_CONFIGURED',
  'SMTP_NOT_CONFIGURED',
  'SMTP_TRANSPORT_UNAVAILABLE',
  'WEBDESIGN_PREPARATION_QUEUED',
]);
const COLDMAIL_SMTP_SAFETY_STOP_PATTERN =
  /\b(transmit rate limit|rate limited|too many recipients|too many messages|too many concurrent|no spam please|b-url|b-text|b-score|b-ex|suspected phishing|spam detected|spamverdacht|spam complaint|mailbox is blocked|mailbox is disabled|mailbox restricted|account restricted|account suspended|not allowed to send|sender not authorized|no authorization to send|mailversand gesperrt|versand gesperrt|versandlimit|sperrung|verzendlimiet|verzendblokkade|geblokkeerd|blokkade|dmarc|spf failed|spf|insufficient privacy|tls required)\b/i;
const COLDMAIL_PROVIDER_WARNING_SENDER_PATTERN =
  /\b(strato|mailer-daemon|postmaster|mail delivery|delivery subsystem|abuse|security|noreply|no-reply|support|kundenservice|customer service)\b/i;
const COLDMAIL_PROVIDER_WARNING_SUBJECT_PATTERN =
  /\b(strato|smtp|mailbox|mailserver|mail server|e-mail|email|account|delivery|bezorging|mail delivery|sending|verzenden|blocked|geblokkeerd|warning|waarschuwing|spam|phishing|dmarc|spf|rate limit|limiet|sperrung|versandlimit)\b/i;
const COLDMAIL_DELIVERY_FAILURE_PATTERN =
  /\b(delivery status notification|undeliverable|undelivered mail|mail delivery failed|delivery has failed|failure notice|returned mail|unzustellbar|unzustellbarkeitsmail|niet bezorgd|onbestelbaar|bezorging mislukt|final-recipient|diagnostic-code)\b/i;
const COLDMAIL_HARD_BOUNCE_PATTERN =
  /\b(user unknown|unknown user|no such user|mailbox unknown|mailbox not found|recipient unknown|unknown address|invalid recipient|invalid address|no such mailbox|unknown local part|not known to us|recipient address rejected|5\.1\.1|5\.1\.10|5\.0\.0)\b/i;
const COLDMAIL_SOFT_BOUNCE_PATTERN =
  /\b(mailbox full|quota exceeded|overquota|temporary failure|try again later|temporarily unavailable|deferred|delayed|warning: could not send message|could not send message for past|will keep trying|greylist|greylisted|4\.[0-9]\.[0-9]|resources temporarily unavailable|user has exhausted allowed storage space)\b/i;
const PERSONAL_MAILBOX_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'tuta.com',
  'tutamail.com',
  'yahoo.com',
  'ymail.com',
]);
const COLDMAIL_OPT_OUT_LABEL = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_OPT_OUT_TEXT_PREFIX = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_UNSUBSCRIBE_PATH = '/afmelden';
const COLDMAIL_PREVIEW_IMAGE_PATH = '/coldmailing/webdesign-foto';
const DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL = 'https://www.softora.nl';
const DEFAULT_COLDMAIL_WEBDESIGN_IMAGE_DELIVERY = 'attachment';
const DEFAULT_COLDMAIL_PREVIEW_IMAGE_SECRET = 'softora-coldmail-preview-image-v2';
const DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT = 'Kleine vraag over jullie website';
const DEFAULT_COLDMAIL_WEBDESIGN_BODY = [
  'Goedendag,',
  '',
  'Afgelopen week kwam ik jullie website, {{website}}, tegen.',
  '',
  'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind. Je vindt het ontwerp in de bijlage bij deze e-mail.',
  '',
  'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
  '',
  'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.',
  '',
  'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel lijkt het me tof om te horen wat je van het design vindt en wat er eventueel beter kan. Daar leer ik dan weer van!',
  '',
  'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
  '',
  'Met vriendelijke groet,',
  '{{afzender}}',
  '',
  '📍 {{stad}}',
].join('\n');
const COLDMAIL_IMAGE_VISIBILITY_PS =
  'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨';
const COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN =
  /(?:PS:\s*(?:als het webdesign niet zichtbaar is,\s*klik op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in het scherm\.?|zie je het webdesign niet\?\s*klik dan even op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in je scherm\s*😊?|wordt het webdesign niet zichtbaar\?\s*klik dan even op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in je scherm,?\s*of open het via deze link:\s*(?:https?:\/\/[^\s]+\/)?webdesign\/[a-z0-9-]+(?:\/concept)?(?:\?[^)\s]+)?(?:\s*👈)?|wordt het webdesign niet zichtbaar\?\s*(?:open|bekijk) het via hier\s*👈?)|je kunt het webdesign hier bekijken\s*👈?|webdesign niet zichtbaar\?\s*check het hier\s*👈?|is het design niet zichtbaar\?\s*bekijk het hier\s*👈?|lukt het niet om de bijlage te openen\?\s*dan kun je het webdesign ook via deze link bekijken\s*🎨)/i;
const COLDMAIL_EMAIL_CONTENT_MAX_WIDTH = 600;
const COLDMAIL_TEST_RECIPIENT_EMAILS = Object.freeze([
  'servec321@gmail.com',
  'serve@softora.nl',
]);
const COLDMAIL_TEST_RECIPIENT_EMAIL = COLDMAIL_TEST_RECIPIENT_EMAILS[0];
const COLDMAIL_TEST_RECIPIENT_ID = 'softora-test-mode-recipient';
const COLDMAIL_PREVIEW_IMAGE_CACHE_TTL_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.COLDMAIL_PREVIEW_IMAGE_CACHE_TTL_MS) || 48 * 60 * 60 * 1000
);
const COLDMAIL_PHOTO_MAP_CACHE_TTL_MS = 60 * 1000;
const COLDMAIL_PREVIEW_IMAGE_CACHE_LIMIT = Math.max(
  120,
  Number(process.env.COLDMAIL_PREVIEW_IMAGE_CACHE_LIMIT) || 800
);
const COLDMAIL_PREVIEW_IMAGE_OPTIMIZE_MIN_BYTES = 128 * 1024;
const COLDMAIL_PREVIEW_IMAGE_MAX_WIDTH = 960;
const COLDMAIL_PREVIEW_IMAGE_JPEG_QUALITY = 82;
const TEST_RECIPIENT_EMAILS = new Set(COLDMAIL_TEST_RECIPIENT_EMAILS);
const TEST_RECIPIENT_LOOKUP_EMAILS = new Set([COLDMAIL_TEST_RECIPIENT_EMAIL, 'servec321@gail.com']);
const TEST_RECIPIENT_COMPANIES = new Set(['mcv e-commerce', 'softora testmodus']);
const MARTIJN_LINKEDIN_CTA_PATTERN = /(?:💼\s*)?mijn\s+linkedin\s*👈?|linkedin\.com\/in\/martijn-van-de-ven/i;
const COLDMAIL_AUTOPILOT_MAX_SENDER_EMAILS = 12;
const COLDMAIL_AUTOPILOT_ALLOWED_SENDER_EMAILS = new Set([
  'serve@softora.nl',
  'martijn@softora.nl',
  'servecreusen@softora.nl',
  'martijnvandeven@softora.nl',
  'servec321@gmail.com',
  'martijnven123@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
  'contact.venvisuals@gmail.com',
]);
const SENDER_DISPLAY_NAMES = {
  'serve@softora.nl': 'Servé Creusen',
  'martijn@softora.nl': 'Martijn van de Ven',
  'servecreusen@softora.nl': 'Servé Creusen',
  'martijnvandeven@softora.nl': 'Martijn van de Ven',
  'ruben@softora.nl': 'Ruben',
  'servec321@gmail.com': 'Servé Creusen',
  'martijnven123@gmail.com': 'Martijn van de Ven',
  'serve290@gmail.com': 'Servé Creusen',
  'servecreusen7@gmail.com': 'Servé Creusen',
  'contact.venvisuals@gmail.com': 'Martijn van de Ven',
};
const SENDER_LOCATION_NAMES = {
  'serve@softora.nl': 'Liempde',
  'martijn@softora.nl': 'Alphen',
  'servecreusen@softora.nl': 'Liempde',
  'martijnvandeven@softora.nl': 'Alphen',
  'servec321@gmail.com': 'Liempde',
  'martijnven123@gmail.com': 'Alphen',
  'serve290@gmail.com': 'Liempde',
  'servecreusen7@gmail.com': 'Liempde',
  'contact.venvisuals@gmail.com': 'Alphen',
};
const COLDMAIL_WEBDESIGN_LEAD_RECIPIENT_EMAILS = Object.freeze([
  'serve@softora.nl',
  'martijn@softora.nl',
  'servecreusen@softora.nl',
  'martijnvandeven@softora.nl',
  'servec321@gmail.com',
  'martijnven123@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
  'contact.venvisuals@gmail.com',
]);
let cachedColdmailPreviewSharp = null;

function loadColdmailPreviewSharpModule() {
  if (cachedColdmailPreviewSharp) return cachedColdmailPreviewSharp;
  cachedColdmailPreviewSharp = require('sharp');
  return cachedColdmailPreviewSharp;
}
const DEFAULT_COLDMAIL_SENDER_PROFILES = {
  'serve@softora.nl': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Pas de mail aan op basis van het bedrijf. Noem de naam van het bedrijf in de aanhef. Als het bedrijf een restaurant is, noem dan iets over hun online menu of reserveringen. Als het een bouwbedrijf is, noem dan portfolio of projectfoto's. Houd de mail kort - maximaal 5 zinnen. Vermijd verkooptaal.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'martijn@softora.nl': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Pas de mail aan op basis van het bedrijf. Noem de naam van het bedrijf in de aanhef. Als het bedrijf een restaurant is, noem dan iets over hun online menu of reserveringen. Als het een bouwbedrijf is, noem dan portfolio of projectfoto's. Houd de mail kort - maximaal 5 zinnen. Vermijd verkooptaal.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'servecreusen@softora.nl': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Gebruik de standaard mailtekst zonder AI-variaties. Vervang alleen vaste variabelen zoals {{naam}}, {{bedrijf}}, {{stad}}, {{website}} en {{afzender}}. Gebruik voor de pin de ontvangerplaats via {{stad}}.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'martijnvandeven@softora.nl': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Gebruik de standaard mailtekst zonder AI-variaties. Vervang alleen vaste variabelen zoals {{naam}}, {{bedrijf}}, {{stad}}, {{website}} en {{afzender}}. Gebruik voor de pin de ontvangerplaats via {{stad}}.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'servec321@gmail.com': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Gebruik de standaard mailtekst zonder AI-variaties. Vervang alleen vaste variabelen zoals {{naam}}, {{bedrijf}}, {{stad}}, {{website}} en {{afzender}}. Gebruik voor de pin de ontvangerplaats via {{stad}}.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'martijnven123@gmail.com': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Gebruik de standaard mailtekst zonder AI-variaties. Vervang alleen vaste variabelen zoals {{naam}}, {{bedrijf}}, {{stad}}, {{website}} en {{afzender}}. Gebruik voor de pin de ontvangerplaats via {{stad}}.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'serve290@gmail.com': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Gebruik de standaard mailtekst zonder AI-variaties. Vervang alleen vaste variabelen zoals {{naam}}, {{bedrijf}}, {{stad}}, {{website}} en {{afzender}}. Gebruik voor de pin de ontvangerplaats via {{stad}}.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'servecreusen7@gmail.com': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Gebruik de standaard mailtekst zonder AI-variaties. Vervang alleen vaste variabelen zoals {{naam}}, {{bedrijf}}, {{stad}}, {{website}} en {{afzender}}. Gebruik voor de pin de ontvangerplaats via {{stad}}.",
    toneStyle: 'Vriendelijk & professioneel',
  },
  'contact.venvisuals@gmail.com': {
    subject: DEFAULT_COLDMAIL_WEBDESIGN_SUBJECT,
    body: DEFAULT_COLDMAIL_WEBDESIGN_BODY,
    aiInstructions: "Gebruik de standaard mailtekst zonder AI-variaties. Vervang alleen vaste variabelen zoals {{naam}}, {{bedrijf}}, {{stad}}, {{website}} en {{afzender}}. Gebruik voor de pin de ontvangerplaats via {{stad}}.",
    toneStyle: 'Vriendelijk & professioneel',
  },
};
const COLDMAIL_PRIVATE_COPY_BLOCKED_SENDERS = new Set([
  'serve@softora.nl',
  'martijn@softora.nl',
  'servecreusen@softora.nl',
  'martijnvandeven@softora.nl',
  'servec321@gmail.com',
  'martijnven123@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
  'contact.venvisuals@gmail.com',
]);
const EXCLUDED_DATABASE_STATUSES = new Set([
  'gemaild',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);
const ACTIVE_INSTANTLY_COLDMAIL_STATUSES = new Set([
  'queued',
  'synced',
  'sent',
  'opened',
  'reply_received',
  'replied',
  'interested',
  'completed',
]);
const BLOCKING_INSTANTLY_COLDMAIL_STATUSES = new Set(['bounced', 'unsubscribed', 'blocked']);

function isExpectedDnsMiss(error) {
  return Boolean(
    error &&
      [
        'EBADNAME',
        'ECONNREFUSED',
        'EAI_AGAIN',
        'ENODATA',
        'ENODOMAIN',
        'ENONAME',
        'ENOTFOUND',
        'EREFUSED',
        'ESERVFAIL',
        'ETIMEOUT',
        'ETIMEDOUT',
      ].includes(String(error.code || '').toUpperCase())
  );
}

async function resolveEmailDomainWithDoh(domain) {
  const value = String(domain || '').trim().toLowerCase().replace(/\.+$/g, '');
  if (!value || typeof fetch !== 'function') return false;
  const queryTypes = ['MX', 'A', 'AAAA'];
  for (const type of queryTypes) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
    try {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(value)}&type=${encodeURIComponent(type)}`;
      const response = await fetch(url, {
        headers: { accept: 'application/dns-json' },
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => null);
      const answers = Array.isArray(payload && payload.Answer) ? payload.Answer : [];
      if (answers.some((answer) => String(answer && answer.data || '').replace(/\.+$/g, ''))) return true;
    } catch (_) {
      // DNS-over-HTTPS is a best-effort fallback for server resolver misses.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return false;
}

async function resolveEmailDomainWithDns(domain) {
  const value = String(domain || '').trim().toLowerCase();
  if (!value) return false;
  try {
    const mxRecords = await dns.resolveMx(value);
    if (Array.isArray(mxRecords) && mxRecords.length) return true;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
  }
  try {
    const addresses = await dns.resolve4(value);
    if (Array.isArray(addresses) && addresses.length) return true;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
  }
  try {
    const addresses = await dns.resolve6(value);
    return Array.isArray(addresses) && addresses.length > 0;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
    return resolveEmailDomainWithDoh(value);
  }
}

function createColdmailCampaignService(deps = {}) {
  const {
    env = process.env,
    mailConfig = {},
    getUiStateValues = async () => ({ values: {} }),
    setUiStateValues = async () => null,
    outboundRecipientGuardStore = null,
    dataOpsStore = null,
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
    leadDbScope = DEFAULT_LEAD_DB_SCOPE,
    leadDbKey = DEFAULT_LEAD_DB_KEY,
    customerPhotoScope = DEFAULT_CUSTOMER_PHOTO_SCOPE,
    customerPhotoKey = DEFAULT_CUSTOMER_PHOTO_KEY,
    coldmailReplyScope = DEFAULT_COLDMAIL_REPLY_SCOPE,
    coldmailReplyKey = DEFAULT_COLDMAIL_REPLY_KEY,
    coldmailSendGuardScope = DEFAULT_COLDMAIL_SEND_GUARD_SCOPE,
    coldmailSendGuardKey = DEFAULT_COLDMAIL_SEND_GUARD_KEY,
    coldmailingSettingsScope = DEFAULT_COLDMAILING_SETTINGS_SCOPE,
    coldmailingSettingsKey = DEFAULT_COLDMAILING_SETTINGS_KEY,
    coldmailAutopilotScope = DEFAULT_COLDMAIL_AUTOPILOT_SCOPE,
    coldmailAutopilotKey = DEFAULT_COLDMAIL_AUTOPILOT_KEY,
    mailboxAccountsRaw = '',
    createTransport = (config) => nodemailer.createTransport(config),
    createImapClient = (config) => new ImapFlow(config),
    parseMailSource = (source) => simpleParser(source),
    resolveEmailDomain = resolveEmailDomainWithDns,
    getOpenAiApiKey = () => '',
    fetchJsonWithTimeout = async () => ({ response: { ok: false, status: 500 }, data: null }),
    extractOpenAiTextContent = null,
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    coldmailAutoReplyModel = 'gpt-5.5-pro',
    coldmailAutoReplyEnabled = false,
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    webdesignPreparationCoordinator: initialWebdesignPreparationCoordinator = null,
    mailReadySnapshotService: initialMailReadySnapshotService = null,
    loadPreviewImageSharp = loadColdmailPreviewSharpModule,
  } = deps;

  const {
    smtpHost = '',
    smtpPort = 587,
    smtpSecure = false,
    smtpUser = '',
    smtpPass = '',
    mailFromAddress = '',
    mailFromName = 'Softora',
    mailReplyTo = '',
    publicBaseUrl: mailPublicBaseUrl = '',
    coldmailUnsubscribeSecret = '',
    coldmailTrackingSecret = '',
    coldmailAuditBcc = '',
    imapHost = '',
    imapPort = 993,
    imapSecure = false,
    imapUser = '',
    imapPass = '',
    imapMailbox = 'INBOX',
    imapExtraMailboxes = [],
    imapPollCooldownMs = 20_000,
    coldmailBounceProcessingEnabled = true,
    coldmailCampaignSendLimit = DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT,
    coldmailDailySendLimit = DEFAULT_COLDMAIL_DAILY_SEND_LIMIT,
    coldmailPackageDailySendLimit = DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT,
    coldmailSendDelayMs = DEFAULT_COLDMAIL_SEND_DELAY_MS,
    coldmailSafetyPauseMs = DEFAULT_COLDMAIL_SAFETY_PAUSE_MS,
    coldmailPersonalMailboxDailyLimit = DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT,
    coldmailPersonalMailboxSendDelayMs = DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS,
    coldmailBlockPersonalMailboxDomains = false,
  } = mailConfig;

  let smtpTransporter = null;
  const senderSmtpTransporters = new Map();
  let coldmailCampaignSendPromise = null;
  let webdesignPreparationCoordinator = initialWebdesignPreparationCoordinator;
  let mailReadySnapshotService = initialMailReadySnapshotService;
  let coldmailPhotoMapCache = null;
  let coldmailLiveStatsCache = null;
  let coldmailLiveStatsPromise = null;
  let coldmailLiveStatsDurableReadPromise = null;
  const mailboxAccountService = createMailboxService({
    mailConfig: {
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      mailFromAddress,
      mailFromName,
      imapHost,
      imapPort,
      imapSecure,
      imapUser,
      imapPass,
    },
    mailboxAccountsRaw,
    normalizeString,
    truncateText,
  });

  function normalizeEmailAddress(value) {
    const raw = normalizeString(value)
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g, '');
    const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?/i);
    return (match ? match[0] : raw)
      .replace(/[<>()"[\]]/g, '')
      .replace(/[.,;:!?]+$/g, '')
      .trim();
  }

  function isLikelyValidEmail(value) {
    const email = normalizeEmailAddress(value);
    return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  function getMissingSmtpMailEnv() {
    return [
      !smtpHost ? 'MAIL_SMTP_HOST' : null,
      !smtpUser ? 'MAIL_SMTP_USER' : null,
      !smtpPass ? 'MAIL_SMTP_PASS' : null,
      !mailFromAddress ? 'MAIL_FROM_ADDRESS' : null,
    ].filter(Boolean);
  }

  function getMissingSenderSmtpEnv(senderEmail) {
    const email = normalizeEmailAddress(senderEmail);
    const localKey = envKeyForEmail(email);
    const fullKey = email.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    return [
      fullKey ? `MAILBOX_${fullKey}_PASS` : null,
      localKey ? `MAILBOX_${localKey}_PASS` : null,
      'MAIL_SMTP_PASS',
    ].filter(Boolean);
  }

  function isSenderSmtpAccountConfigured(account) {
    return Boolean(
      account &&
        account.smtpHost &&
        Number.isFinite(Number(account.smtpPort)) &&
        Number(account.smtpPort) > 0 &&
        account.smtpUser &&
        account.smtpPass
    );
  }

  function isSmtpMailConfigured() {
    if (isSenderSmtpAccountConfigured(buildBaseSmtpAccount())) return true;
    return getConfiguredMailboxSmtpAccounts().some(isSenderSmtpAccountConfigured);
  }

  function getMissingImapMailEnv() {
    return [
      !imapHost ? 'MAIL_IMAP_HOST' : null,
      !imapUser ? 'MAIL_IMAP_USER' : null,
      !imapPass ? 'MAIL_IMAP_PASS' : null,
    ].filter(Boolean);
  }

  function isImapMailConfigured() {
    return Boolean(
      imapHost &&
        Number.isFinite(Number(imapPort)) &&
        Number(imapPort) > 0 &&
        imapUser &&
        imapPass
    );
  }

  function getSmtpTransporter() {
    if (!isSmtpMailConfigured()) return null;
    if (smtpTransporter) return smtpTransporter;
    smtpTransporter = createTransport(
      buildSmtpTransportConfig({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: smtpUser,
        pass: smtpPass,
      })
    );
    return smtpTransporter;
  }

  function getConfiguredMailboxSmtpAccounts() {
    return mailboxAccountService
      .getAccounts()
      .filter((account) => account && account.smtpConfigured && isLikelyValidEmail(account.email));
  }

  function buildBaseSmtpAccount(senderEmail = '') {
    const selected = normalizeEmailAddress(senderEmail);
    const fallbackEmail = normalizeEmailAddress(mailFromAddress || smtpUser);
    const email = selected || fallbackEmail;
    const account = {
      email,
      name: normalizeString(SENDER_DISPLAY_NAMES[email] || mailFromName || 'Softora'),
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpSecure: Boolean(smtpSecure),
      smtpUser,
      smtpPass,
      imapHost,
      imapPort: Number(imapPort),
      imapSecure: Boolean(imapSecure),
      imapUser,
      imapPass,
    };
    account.smtpConfigured = isSenderSmtpAccountConfigured(account);
    account.imapConfigured = Boolean(account.imapHost && account.imapUser && account.imapPass);
    return account;
  }

  function resolveSenderSmtpAccount(senderEmail) {
    const selected = normalizeEmailAddress(senderEmail || mailFromAddress || smtpUser);
    const account = getConfiguredMailboxSmtpAccounts().find((item) => normalizeEmailAddress(item.email) === selected);
    if (account) {
      const email = normalizeEmailAddress(account.email);
      const resolved = {
        ...account,
        email,
        name: normalizeString(SENDER_DISPLAY_NAMES[email] || account.name),
        smtpHost: account.smtpHost,
        smtpPort: Number(account.smtpPort) || 587,
        smtpSecure: Boolean(account.smtpSecure),
        smtpUser: account.smtpUser,
        smtpPass: account.smtpPass,
      };
      resolved.smtpConfigured = isSenderSmtpAccountConfigured(resolved);
      return resolved;
    }
    const base = buildBaseSmtpAccount(selected);
    const baseEmails = new Set([
      normalizeEmailAddress(mailFromAddress),
      normalizeEmailAddress(smtpUser),
    ].filter(Boolean));
    if (!selected || baseEmails.has(selected)) return base;
    return {
      ...base,
      smtpPass: '',
      smtpConfigured: false,
    };
  }

  function envKeyForFullMailboxEmail(email) {
    return normalizeEmailAddress(email)
      .replace(/[^a-z0-9]+/gi, '_')
      .toUpperCase();
  }

  function hasRuntimeEnvValue(key) {
    const env = process.env || {};
    return Boolean(normalizeString(env[key] || ''));
  }

  function getRuntimeMailboxEnvDiagnostics(senderEmail) {
    const email = normalizeEmailAddress(senderEmail);
    const keyGroups = {
      full: envKeyForFullMailboxEmail(email),
      local: envKeyForEmail(email),
      domain: envKeyForDomain(email),
    };
    const describeKey = (key) => ({
      key,
      smtpHost: hasRuntimeEnvValue(`MAILBOX_${key}_SMTP_HOST`),
      smtpPort: hasRuntimeEnvValue(`MAILBOX_${key}_SMTP_PORT`),
      smtpSecure: hasRuntimeEnvValue(`MAILBOX_${key}_SMTP_SECURE`),
      smtpUser: hasRuntimeEnvValue(`MAILBOX_${key}_SMTP_USER`),
      smtpPass: hasRuntimeEnvValue(`MAILBOX_${key}_SMTP_PASS`),
      sharedUser: hasRuntimeEnvValue(`MAILBOX_${key}_USER`),
      sharedPass: hasRuntimeEnvValue(`MAILBOX_${key}_PASS`),
    });
    return Object.fromEntries(
      Object.entries(keyGroups)
        .filter(([, key]) => key)
        .map(([group, key]) => [group, describeKey(key)])
    );
  }

  function getSenderSmtpDiagnostic(senderEmail, account) {
    const email = normalizeEmailAddress(senderEmail);
    const mailboxAccount = mailboxAccountService
      .getAccounts()
      .find((item) => normalizeEmailAddress(item && item.email) === email);
    return {
      resolved: {
        hasHost: Boolean(account && account.smtpHost),
        hasPort: Boolean(account && Number.isFinite(Number(account.smtpPort)) && Number(account.smtpPort) > 0),
        hasUser: Boolean(account && account.smtpUser),
        hasPass: Boolean(account && account.smtpPass),
        configured: isSenderSmtpAccountConfigured(account),
      },
      mailboxAccount: {
        found: Boolean(mailboxAccount),
        smtpConfigured: Boolean(mailboxAccount && mailboxAccount.smtpConfigured),
        hasHost: Boolean(mailboxAccount && mailboxAccount.smtpHost),
        hasUser: Boolean(mailboxAccount && mailboxAccount.smtpUser),
        hasPass: Boolean(mailboxAccount && mailboxAccount.smtpPass),
      },
      mailboxAccountsRawConfigured: Boolean(normalizeString(mailboxAccountsRaw)),
      runtimeEnv: getRuntimeMailboxEnvDiagnostics(email),
    };
  }

  function getSenderSmtpTransport(senderEmail) {
    const account = resolveSenderSmtpAccount(senderEmail);
    if (!account.smtpHost || !account.smtpUser || !account.smtpPass) return null;
    const key = [
      account.smtpHost,
      account.smtpPort,
      account.smtpSecure ? 'secure' : 'plain',
      account.smtpUser,
    ].join('|');
    if (!senderSmtpTransporters.has(key)) {
      senderSmtpTransporters.set(
        key,
        createTransport(
          buildSmtpTransportConfig({
            host: account.smtpHost,
            port: account.smtpPort,
            secure: account.smtpSecure,
            user: account.smtpUser,
            pass: account.smtpPass,
          })
        )
      );
    }
    return {
      account,
      transporter: senderSmtpTransporters.get(key),
    };
  }

  function buildSmtpTransportConfig({ host, port, secure, user, pass }) {
    return {
      host,
      port: Number(port),
      secure: Boolean(secure),
      auth: {
        user,
        pass,
      },
      connectionTimeout: DEFAULT_COLDMAIL_SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: DEFAULT_COLDMAIL_SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: DEFAULT_COLDMAIL_SMTP_SOCKET_TIMEOUT_MS,
    };
  }

  function normalizeDatabaseStatus(value, row = {}) {
    return normalizeContactStatus(value, row) || 'prospect';
  }

  function parseDatabaseRows(values = {}) {
    const raw = normalizeString(readChunkedStateValue(values, customerDbKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function getColdmailSentAt(row) {
    return normalizeString(
      row &&
        (row.lastColdmailSentAt ||
          row.lastMailSentAt ||
          row.outreachSentAt ||
          row.outreach_sent_at ||
          row.coldmailCampaignStartedAt ||
          row.mailCampaignStartedAt ||
          row.sentAt)
    );
  }

  function isInstantlyHistoryEntry(entry) {
    const provider = normalizeString(entry && (entry.provider || entry.lastColdmailProvider)).toLowerCase();
    const text = normalizeString(
      [
        entry && entry.type,
        entry && entry.status,
        entry && entry.label,
        entry && entry.source,
        entry && entry.actor,
        entry && entry.subject,
        entry && entry.preview,
      ].join(' ')
    ).toLowerCase();
    return provider === 'instantly' || text.includes('instantly');
  }

  function isSoftoraSystemMailHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object' || isInstantlyHistoryEntry(entry)) return false;
    const text = normalizeString(
      [
        entry.type,
        entry.status,
        entry.label,
        entry.message,
        entry.title,
      ].join(' ')
    ).toLowerCase();
    return /\b(gemaild|mail verstuurd|email sent|coldmail verzonden)\b/.test(text);
  }

  function getSoftoraSystemMailSentCountForRow(row) {
    const email = getRowEmail(row);
    if (!row || isTestRecipientRow(row, email) || hasActiveInstantlyColdmailOutreach(row)) return 0;
    const provider = normalizeString(row.lastColdmailProvider).toLowerCase();
    if (provider === 'instantly') return 0;
    const historyCount = (Array.isArray(row.hist) ? row.hist : []).filter(isSoftoraSystemMailHistoryEntry).length;
    if (historyCount) return historyCount;
    if (['softora', 'gmail', 'smtp', 'strato'].includes(provider)) return 1;
    if (
      normalizeString(
        row.lastColdmailSenderEmail ||
          row.sentFromEmail ||
          row.sent_from_email ||
          row.outreachSentFromEmail
      )
    ) {
      return 1;
    }
    if (getColdmailSentAt(row)) return 1;
    return normalizeString(
      row.coldmailSentMessageId ||
        row.outreachMessageId ||
        row.sentMessageId ||
        row.messageId
    )
      ? 1
      : 0;
  }

  function buildCustomerRowsStateValues(values, rows) {
    return {
      ...(values && typeof values === 'object' ? values : {}),
      ...buildChunkedStatePatch(customerDbKey, JSON.stringify(Array.isArray(rows) ? rows : [])),
    };
  }

  function parseLeadDatabaseRows(values = {}, rowsKey = leadDbKey) {
    const raw = normalizeString(readChunkedStateValue(values, rowsKey));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((row) => row && typeof row === 'object')
        .map((row, index) => {
          const city = getRowCity(row);
          const address = normalizeString(row.address || row.adres || row.location || '');
          const region = normalizeString(row.region || row.regio || row.province || row.provincie || '');
          return {
            id: normalizeString(row.id || row.leadId || '') || `lead-${index}`,
            bedrijf: normalizeString(row.company || row.companyName || row.name || row.bedrijf || row.naam || '') || `Lead ${index + 1}`,
            naam: normalizeString(row.contactPerson || row.contact || row.contactName || row.clientName || row.naam || ''),
            phone: getRowPhone(row),
            branche: normalizeString(row.branche || row.branch || ''),
            region,
            stad: city,
            plaats: city,
            city,
            gemeente: normalizeString(row.gemeente || '') || city,
            adres: address,
            address,
            location: normalizeString(row.location || address || city || region),
            lat: row.lat ?? row.latitude ?? row.latitudeNumber,
            lng: row.lng ?? row.lon ?? row.longitude ?? row.longitudeNumber,
            distanceKm: row.distanceKm,
            afstandKm: row.afstandKm,
            website: normalizeString(row.website || ''),
            call: row.call,
            canCall: row.canCall,
            doNotCall: row.doNotCall,
            status: normalizeString(row.status || row.databaseStatus || ''),
          };
        });
    } catch (_) {
      return [];
    }
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(normalizeString(value));
    } catch (_) {
      return fallback;
    }
  }

  function isWebdesignSpecialAction(value) {
    const normalized = normalizeString(value).toLowerCase();
    return normalized === 'webdesign' || normalized === 'website-design' || normalized === 'website_design';
  }

  function normalizeCampaignService(value) {
    return normalizeString(value)
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function campaignContentPromisesWebdesignAssets(input = {}) {
    const subject = normalizeCampaignService(input.subject || '');
    const body = normalizeCampaignService(input.body || input.text || input.content || '');
    const combined = `${subject} ${body}`.replace(/\bwebsite design\b/g, 'webdesign');
    if (!/\bwebdesign\b/.test(combined)) return false;
    return /\bgemaakt\b/.test(combined) || /\bontwerp\b/.test(combined);
  }

  function shouldUseWebdesignAssets(input = {}, mode = 'mail') {
    if (isWebdesignSpecialAction(input.specialAction)) return true;
    return mode === 'mail' && campaignContentPromisesWebdesignAssets(input);
  }

  function requiresReadyWebdesign(input = {}, mode = 'mail') {
    if (shouldUseWebdesignAssets(input, mode)) return true;
    if (isCampaignTestModeEnabled(input.testMode)) return false;
    const service = normalizeCampaignService(input.service);
    return mode === 'call' && !service;
  }

  function isCampaignTestModeEnabled(value) {
    const normalized = normalizeString(value).toLowerCase();
    return value === true || normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'aan';
  }

  function parseColdmailTestRecipientEmailInput(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      return [
        value.email,
        value.mail,
        value.address,
        value.to,
      ].filter(Boolean);
    }
    return normalizeString(value)
      .split(/[\s,;]+/)
      .filter(Boolean);
  }

  function resolveColdmailTestRecipientEmails(input = {}, mode = 'mail') {
    if (mode !== 'mail') return [COLDMAIL_TEST_RECIPIENT_EMAIL];
    const hasExplicitRecipients = Object.prototype.hasOwnProperty.call(input, 'testRecipientEmails') ||
      Object.prototype.hasOwnProperty.call(input, 'testRecipients') ||
      Object.prototype.hasOwnProperty.call(input, 'testRecipientEmail');
    if (!hasExplicitRecipients) return [COLDMAIL_TEST_RECIPIENT_EMAIL];
    const candidates = [
      ...parseColdmailTestRecipientEmailInput(input.testRecipientEmails),
      ...parseColdmailTestRecipientEmailInput(input.testRecipients),
      ...parseColdmailTestRecipientEmailInput(input.testRecipientEmail),
    ];
    const allowed = [];
    const seen = new Set();
    candidates.forEach((candidate) => {
      const email = normalizeEmailAddress(candidate);
      if (!TEST_RECIPIENT_EMAILS.has(email) || seen.has(email)) return;
      seen.add(email);
      allowed.push(email);
    });
    return allowed.length ? allowed : [COLDMAIL_TEST_RECIPIENT_EMAIL];
  }

  function findColdmailTestRecipientRow(customerRows = []) {
    const rows = (Array.isArray(customerRows) ? customerRows : []).filter((row) => row && typeof row === 'object');
    const isLookupEmailRow = (row) => TEST_RECIPIENT_LOOKUP_EMAILS.has(getRowEmail(row));
    const dedicatedRow = rows.find((row) => {
      if (!row || typeof row !== 'object') return false;
      const id = normalizeString(row.id || row.customerId || row.databaseId).toLowerCase();
      return id === COLDMAIL_TEST_RECIPIENT_ID;
    });
    if (dedicatedRow) return dedicatedRow;
    return (
      rows.find(
        (row) =>
          isLookupEmailRow(row) &&
          isResolvableWebsitePhotoValue(getWebdesignPhotoSource(row))
      ) ||
      rows.find(isLookupEmailRow) ||
      rows.find(
        (row) =>
          TEST_RECIPIENT_COMPANIES.has(getRowCompany(row).toLowerCase()) &&
          isResolvableWebsitePhotoValue(getWebdesignPhotoSource(row))
      ) ||
      rows.find((row) => TEST_RECIPIENT_COMPANIES.has(getRowCompany(row).toLowerCase())) ||
      null
    );
  }

  function buildColdmailTestRecipientRow(mode = 'mail', databaseRow = null, recipientEmail = COLDMAIL_TEST_RECIPIENT_EMAIL, recipientIndex = 0) {
    const row = databaseRow && typeof databaseRow === 'object' ? { ...databaseRow } : {};
    const email = normalizeEmailAddress(recipientEmail) || COLDMAIL_TEST_RECIPIENT_EMAIL;
    const sourceRowId = normalizeString(row.id || row.customerId || row.databaseId);
    const fallbackId = recipientIndex === 0
      ? COLDMAIL_TEST_RECIPIENT_ID
      : `${COLDMAIL_TEST_RECIPIENT_ID}-${email.replace(/[^a-z0-9]+/g, '-')}`;
    return {
      ...row,
      id: recipientIndex === 0
        ? normalizeString(row.id || row.customerId || row.databaseId) || fallbackId
        : fallbackId,
      testModeSourceRowId: sourceRowId || undefined,
      bedrijf: normalizeString(row.bedrijf || row.company || row.companyName) || 'Softora Testmodus',
      naam: normalizeString(row.naam || row.contact || row.contactName) || 'Servé',
      email,
      phone: normalizeString(row.phone || row.telefoon || row.tel) || '+31000000000',
      telefoon: normalizeString(row.telefoon || row.phone || row.tel) || '+31000000000',
      website: normalizeString(row.website || row.websiteUrl || row.dom || row.domain) || 'softora.nl',
      dom: normalizeString(row.dom || row.domain || row.website || row.websiteUrl) || 'softora.nl',
      stad: normalizeString(row.stad || row.plaats || row.city) || 'Oisterwijk',
      plaats: normalizeString(row.plaats || row.stad || row.city) || 'Oisterwijk',
      branche: normalizeString(row.branche || row.branch) || 'Test',
      status: normalizeString(row.status || row.databaseStatus) || 'benaderbaar',
      databaseStatus: normalizeString(row.databaseStatus || row.status) || 'benaderbaar',
      mail: true,
      call: mode === 'call',
      canCall: mode === 'call',
      distanceKm: 0,
      testMode: true,
    };
  }

  function buildResolvedColdmailTestRecipients(input = {}, mode = 'mail', count = 1, customerRows = [], customerPhotoMap = {}) {
    const sourceRow = findColdmailTestRecipientRow(customerRows);
    const recipientEmails = resolveColdmailTestRecipientEmails(input, mode);
    const rows = recipientEmails.map((recipientEmail, index) =>
      buildColdmailTestRecipientRow(mode, sourceRow, recipientEmail, index)
    );
    const candidateRows = rows.map((row, index) => ({ row, index, id: getRowId(row, index) }));
    const failed = [];
    const selectedRows = [];
    const shouldRequireWebdesign = shouldUseWebdesignAssets(input, mode);
    if (shouldRequireWebdesign) {
      const readyWebdesignMatcher = createReadyWebdesignMatcher(rows, customerPhotoMap);
      candidateRows.forEach((item) => {
        if (readyWebdesignMatcher.hasRow(item.row, item.index)) {
          selectedRows.push(item);
        } else {
          failed.push({
            id: item.id,
            bedrijf: getRowCompany(item.row),
            email: getRowEmail(item.row),
            phone: getRowPhone(item.row),
            error: `Nog geen website-design klaar voor ${getRowCompany(item.row) || 'Softora Testmodus'}.`,
          });
        }
      });
    } else {
      selectedRows.push(...candidateRows);
    }
    return {
      count: mode === 'mail' ? recipientEmails.length : count,
      mode,
      radiusKm: parseRadiusKm(input.radiusKm),
      values: {},
      customerValues: {},
      customerRows: rows,
      rows,
      candidateRows,
      selectedRows,
      failed,
      customerPhotoMap: customerPhotoMap && typeof customerPhotoMap === 'object' ? customerPhotoMap : {},
      testMode: true,
      testRecipientEmails: recipientEmails,
    };
  }

  function normalizeOutreachStatus(value) {
    const normalized = normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (['benaderd', 'gemaild', 'mailed', 'sent'].includes(normalized)) return 'benaderd';
    if (['reactie_ontvangen', 'reply_received', 'actie_nodig', 'action_required'].includes(normalized)) {
      return 'reactie_ontvangen';
    }
    if (['interesse', 'interested', 'geinteresseerd'].includes(normalized)) return 'interesse';
    if (['geen_interesse', 'geblokkeerd', 'opt_out', 'unsubscribe', 'geenbehoefte'].includes(normalized)) {
      return 'geen_interesse';
    }
    if (['afgehaakt', 'lost', 'no_deal', 'geendeal'].includes(normalized)) return 'afgehaakt';
    if (['geen_gehoor', 'geengehoor', 'no_answer'].includes(normalized)) return 'geen_gehoor';
    if (['klant_geworden', 'klant', 'customer', 'paid'].includes(normalized)) return 'klant_geworden';
    return '';
  }

  function isWebdesignOutreachRow(row) {
    if (!row || typeof row !== 'object') return false;
    return [
      row.campaignType,
      row.campaign_type,
      row.outreachCampaignType,
      row.outreach_campaign_type,
      row.coldmailSpecialAction,
      row.specialAction,
    ].some(isWebdesignSpecialAction);
  }

  function mapOutreachStatusToDatabaseStatus(status, fallbackStatus = 'gemaild') {
    const normalized = normalizeOutreachStatus(status);
    if (normalized === 'interesse') return 'interesse';
    if (normalized === 'geen_interesse') return 'geblokkeerd';
    if (normalized === 'afgehaakt') return 'afgehaakt';
    if (normalized === 'geen_gehoor') return 'geengehoor';
    if (normalized === 'klant_geworden') return 'klant';
    return normalizeDatabaseStatus(fallbackStatus) || 'gemaild';
  }

  function isOutreachDefinitiveStatus(status) {
    return ['interesse', 'geen_interesse', 'afgehaakt', 'geen_gehoor', 'klant_geworden'].includes(
      normalizeOutreachStatus(status)
    );
  }

  function getOutreachStatusLabel(status) {
    const labels = {
      benaderd: 'Benaderd',
      reactie_ontvangen: 'Reactie ontvangen',
      interesse: 'Interesse',
      geen_interesse: 'Geen interesse',
      afgehaakt: 'Afgehaakt',
      geen_gehoor: 'Geen gehoor',
      klant_geworden: 'Klant geworden',
    };
    return labels[normalizeOutreachStatus(status)] || 'Benaderd';
  }

  function normalizeMailboxMessageKey(value) {
    const raw = normalizeString(value).toLowerCase();
    if (!raw) return '';
    if (/^[a-z]+:\d+$/i.test(raw)) return raw;
    return normalizeMessageIdToken(raw.replace(/^message:/i, ''));
  }

  function collectOutreachMessageKeys(row) {
    const values = [
      row && row.outreachMessageId,
      row && row.coldmailSentMessageId,
      row && row.replyMessageId,
      row && row.replyThreadId,
      row && row.replyMailboxId,
      row && row.lastColdmailReplyMessageKey,
    ];
    return new Set(values.map(normalizeMailboxMessageKey).filter(Boolean));
  }

  function matchesOutreachMessage(row, value) {
    const key = normalizeMailboxMessageKey(value);
    if (!key) return false;
    return collectOutreachMessageKeys(row).has(key);
  }

  function buildMailboxMessageId(folder, uid) {
    const safeUid = normalizeString(uid);
    if (!safeUid) return '';
    const normalizedFolder = normalizeString(folder).toLowerCase();
    const folderKey = normalizedFolder.includes('sent')
      ? 'sent'
      : normalizedFolder.includes('spam') || normalizedFolder.includes('junk')
        ? 'spam'
        : normalizedFolder.includes('trash') || normalizedFolder.includes('prullenbak')
          ? 'trash'
          : 'inbox';
    return `${folderKey}:${safeUid}`;
  }

  function getRowId(row, index) {
    return normalizeString(row.id || row.customerId || row.databaseId || '') || `row-${index}`;
  }

  function getExplicitRowId(row) {
    return normalizeString((row && (row.id || row.customerId || row.databaseId)) || '');
  }

  function getRowCompany(row) {
    return normalizeString(row.bedrijf || row.company || row.companyName || row.naam || row.name);
  }

  function slugifyWebdesignCompany(value, fallback = 'uw-bedrijf') {
    const slug = normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);
    return slug || fallback;
  }

  function buildPublicWebdesignPreviewPath(row, id) {
    const slug = slugifyWebdesignCompany(getRowCompany(row), slugifyWebdesignCompany(id, 'uw-bedrijf'));
    const directIdentifier = normalizeString(id);
    const query = new URLSearchParams();
    if (directIdentifier) query.set('cid', directIdentifier);
    const queryString = query.toString();
    return `/webdesign/${slug}${queryString ? `?${queryString}` : ''}`;
  }

  function inferPublicWebdesignPreviewSenderKey(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const normalized = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const compact = normalized.replace(/[^a-z0-9]+/g, '');
    if (
      normalized.includes('martijn') ||
      compact.includes('martijnvandeven') ||
      normalizeEmailAddress(raw) === 'contact.venvisuals@gmail.com'
    ) {
      return 'martijn';
    }
    if (
      normalized.includes('serve') ||
      normalized.includes('creusen') ||
      compact.includes('servecreusen')
    ) {
      return 'serve';
    }
    return '';
  }

  function getPublicWebdesignPreviewSenderKey(row, input = {}) {
    const candidates = [
      input.senderProfileKey,
      input.senderProfile,
      input.profileKey,
      input.senderKey,
      input.senderEmail,
      input.senderDisplayName,
      input.senderName,
      input.fromName,
      input.mailboxAccount,
      input.accountEmail,
      input.fromEmail,
      input.body,
      input.text,
      input.renderedBody,
      SENDER_DISPLAY_NAMES[normalizeEmailAddress(input.senderEmail)],
      SENDER_DISPLAY_NAMES[normalizeEmailAddress(input.accountEmail)],
      SENDER_DISPLAY_NAMES[normalizeEmailAddress(input.fromEmail)],
      row && row.senderProfileKey,
      row && row.instantlySenderProfileKey,
      row && row.senderEmail,
      row && row.lastColdmailSenderEmail,
      row && row.sentFromEmail,
      row && row.mailboxAccount,
      row && row.fromEmail,
    ];
    for (const candidate of candidates) {
      const key = inferPublicWebdesignPreviewSenderKey(candidate);
      if (key) return key;
    }
    return '';
  }

  function buildPublicWebdesignPreviewUrl(row, id, input = {}) {
    const baseUrl =
      normalizePublicBaseUrl(input.webdesignPublicBaseUrl) ||
      DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL;
    const path = buildPublicWebdesignPreviewPath(row, id);
    const senderKey = getPublicWebdesignPreviewSenderKey(row, input);
    try {
      const url = new URL(path, baseUrl);
      if (senderKey) url.searchParams.set('sender', senderKey);
      return url.toString();
    } catch (_error) {
      return `${baseUrl}${path}${senderKey ? `${path.includes('?') ? '&' : '?'}sender=${encodeURIComponent(senderKey)}` : ''}`;
    }
  }

  function buildImageVisibilityPs(row, id, input = {}) {
    return COLDMAIL_IMAGE_VISIBILITY_PS;
  }

  function getRowContact(row) {
    return normalizeString(row.naam || row.contact || row.contactName || row.clientName) || getRowCompany(row);
  }

  function cleanPlaceLabel(value) {
    const dutchProvinceSuffix =
      '(?:N\\.?\\s?Br\\.?|N\\.?B\\.?|Noord[-\\s]?Brabant|Z\\.?H\\.?|Zuid[-\\s]?Holland|N\\.?H\\.?|Noord[-\\s]?Holland|Gld\\.?|Gelderland|Lb\\.?|Limburg|Ov\\.?|Overijssel|Dr\\.?|Drenthe|Fr\\.?|Friesland|Gr\\.?|Groningen|Fl\\.?|Flevoland|Ze\\.?|Zeeland|Ut\\.?|Utrecht)';
    return normalizeString(value)
      .replace(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b/g, '')
      .replace(new RegExp(`\\s*\\(${dutchProvinceSuffix}\\)\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s+${dutchProvinceSuffix}\\s*$`, 'i'), '')
      .replace(/\b(Nederland|The Netherlands)\b/gi, '')
      .replace(/^[\s,.;-]+|[\s,.;-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeStreetAddress(value) {
    const text = normalizeString(value).toLowerCase();
    return /\d/.test(text) && /(straat|weg|laan|plein|pad|dijk|hof|kade|markt|singel|steeg|gracht|boulevard|baan|akker|plantsoen|park)\b/.test(text);
  }

  function formatKnownPlaceKey(value) {
    return normalizeString(value)
      .split(/\s+/)
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
      .join(' ')
      .replace(/^S Hertogenbosch$/, "'s-Hertogenbosch");
  }

  function findKnownPlaceLabel(value) {
    const haystack = normalizePlaceKey(value);
    if (!haystack) return '';
    const placeKey = Object.keys(campaignPlaceCoords)
      .sort((left, right) => right.length - left.length)
      .find((key) => haystack.includes(normalizePlaceKey(key)));
    return placeKey ? formatKnownPlaceKey(placeKey) : '';
  }

  function extractPlaceFromAddress(value) {
    const text = normalizeString(value)
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .trim();
    if (!text) return '';

    const postalMatch = text.match(/\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b\s+([A-Za-zÀ-ÿ'’.\- ]{2,})$/);
    if (postalMatch) return cleanPlaceLabel(postalMatch[1]);

    const parts = text.split(/[,\n;|]/).map(cleanPlaceLabel).filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const candidate = parts[index];
      if (!candidate || looksLikeStreetAddress(candidate)) continue;
      if (/^\d+$/.test(candidate)) continue;
      return candidate;
    }

    return looksLikeStreetAddress(text) ? findKnownPlaceLabel(text) : cleanPlaceLabel(text);
  }

  function getRowCity(row) {
    const explicit = [
      row && row.plaats,
      row && row.city,
      row && row.gemeente,
      row && row.locality,
      row && row.town,
      row && row.village,
    ]
      .map((value) => {
        const cleaned = cleanPlaceLabel(value);
        if (!cleaned) return '';
        return looksLikeStreetAddress(cleaned) ? extractPlaceFromAddress(cleaned) : cleaned;
      })
      .find(Boolean);
    if (explicit) return explicit;

    const addressLikeValue = [
      row && row.stad,
      row && row.adres,
      row && row.address,
      row && row.location,
    ]
      .map(extractPlaceFromAddress)
      .find(Boolean);
    return addressLikeValue || '';
  }

  function normalizeWebsiteVariableValue(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      return normalizeString(parsed.hostname).replace(/^www\./i, '') || raw;
    } catch (_) {
      return raw
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/.*$/g, '')
        .replace(/\/+$/g, '');
    }
  }

  function getRowDomain(row) {
    return normalizeWebsiteVariableValue(
      row.dom ||
        row.domain ||
        row.website ||
        row.websiteUrl ||
        row.website_url ||
        row.url ||
        row.site ||
        row.domein ||
        ''
    );
  }

  function normalizeWebdesignPreparationUrl(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      if (!parsed.hostname || parsed.hostname.indexOf('.') === -1) return '';
      return parsed.toString();
    } catch (_) {
      return '';
    }
  }

  function getRowWebdesignPreparationUrl(row) {
    return normalizeWebdesignPreparationUrl(
      row &&
        (
          row.website ||
          row.websiteUrl ||
          row.website_url ||
          row.url ||
          row.dom ||
          row.domain ||
          row.site ||
          row.domein ||
          ''
        )
    );
  }

  function getRowEmail(row) {
    return normalizeEmailAddress(row.email || row.contactEmail || row.mail || '');
  }

  function normalizeColdmailGuardKeyPart(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function buildColdmailRecipientGuard(row, id = '') {
    if (!row || typeof row !== 'object') {
      return {
        recipientKey: '',
        recipientEmail: '',
        recipientDomain: '',
        recipientCompanyKey: '',
        recipientId: normalizeColdmailGuardKeyPart(id),
        recipientCompany: '',
      };
    }
    const recipientEmail = getRowEmail(row);
    const emailDomain = getEmailDomain(recipientEmail);
    const recipientDomain = normalizeColdmailGuardKeyPart(
      getRowDomain(row) || (emailDomain && !PERSONAL_MAILBOX_DOMAINS.has(emailDomain) ? emailDomain : '')
    );
    const recipientCompanyKey = normalizeColdmailGuardKeyPart(getRowCompany(row));
    const recipientId = normalizeColdmailGuardKeyPart(id || getExplicitRowId(row));
    const recipientKey = recipientEmail
      ? `email:${recipientEmail}`
      : recipientDomain
        ? `domain:${recipientDomain}`
        : recipientId
          ? `id:${recipientId}`
          : '';
    return {
      recipientKey,
      recipientEmail,
      recipientDomain,
      recipientCompanyKey,
      recipientId,
      recipientCompany: truncateText(getRowCompany(row), 120),
    };
  }

  function hasColdmailRecipientGuardIdentity(entry) {
    return Boolean(
      entry &&
        (entry.recipientKey ||
          entry.recipientEmail ||
          entry.recipientDomain ||
          entry.recipientCompanyKey ||
          entry.recipientId)
    );
  }

  function isPermanentColdmailRecipientGuardEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.permanent === true) return true;
    if (normalizeString(entry.permanent).toLowerCase() === 'true') return true;
    const source = normalizeString(entry.source || entry.reason || '').toLowerCase();
    const provider = normalizeString(entry.provider || entry.lastColdmailProvider || '').toLowerCase();
    const senderEmail = normalizeEmailAddress(entry.senderEmail);
    if (source.includes('instantly') || provider === 'instantly') return true;
    return senderEmail.endsWith('@websoftora.com');
  }

  function getColdmailRecipientGuardMatch(item, entries = []) {
    const guard = buildColdmailRecipientGuard(item && item.row, item && item.id);
    return (Array.isArray(entries) ? entries : []).find((entry) => {
      if (!entry || !hasColdmailRecipientGuardIdentity(entry)) return false;
      if (guard.recipientKey && entry.recipientKey === guard.recipientKey) return true;
      if (guard.recipientEmail && entry.recipientEmail === guard.recipientEmail) return true;
      if (guard.recipientDomain && entry.recipientDomain === guard.recipientDomain) return true;
      if (guard.recipientCompanyKey && entry.recipientCompanyKey === guard.recipientCompanyKey) return true;
      if (guard.recipientId && entry.recipientId === guard.recipientId) return true;
      return false;
    }) || null;
  }

  function buildColdmailRecipientGuardFailure(item, match) {
    const sender = normalizeEmailAddress(match && match.senderEmail);
    const provider = normalizeString(match && match.provider).toLowerCase();
    return {
      id: item && item.id,
      bedrijf: getRowCompany(item && item.row),
      email: getRowEmail(item && item.row),
      code: 'COLDMAIL_RECIPIENT_RECENTLY_SENT',
      error: isPermanentColdmailRecipientGuardEntry(match)
        ? provider === 'instantly'
          ? 'Dit bedrijf/e-mailadres is al eerder gemaild of gereserveerd via Instantly.'
          : sender
          ? `Dit bedrijf/e-mailadres is al eerder gemaild via ${sender}.`
          : 'Dit bedrijf/e-mailadres is al eerder gemaild.'
        : sender
          ? `Dit bedrijf/e-mailadres is recent al gemaild via ${sender}.`
          : 'Dit bedrijf/e-mailadres is recent al gemaild.',
    };
  }

  function isColdmailRecipientGuardFailure(item) {
    return normalizeString(item && item.code) === 'COLDMAIL_RECIPIENT_RECENTLY_SENT';
  }

  function buildOutboundRecipientGuardIdentity(item) {
    const guard = buildColdmailRecipientGuard(item && item.row, item && item.id);
    const emailDomain = getEmailDomain(guard.recipientEmail);
    return {
      recipientKey: guard.recipientKey,
      recipientEmail: guard.recipientEmail,
      recipientDomain:
        guard.recipientDomain ||
        normalizeColdmailGuardKeyPart(emailDomain && !PERSONAL_MAILBOX_DOMAINS.has(emailDomain) ? emailDomain : ''),
      recipientCompanyKey: guard.recipientCompanyKey,
      recipientId: guard.recipientId,
      recipientCompany: guard.recipientCompany,
    };
  }

  function buildSupabaseOutboundGuardFailure(item, match) {
    return buildColdmailRecipientGuardFailure(item, {
      at: normalizeString(match && (match.last_seen_at || match.updated_at || match.created_at)),
      senderEmail: normalizeEmailAddress(match && match.sender_email),
      recipientKey: normalizeString(match && match.guard_key),
      recipientEmail: normalizeEmailAddress(match && match.recipient_email),
      recipientDomain: normalizeColdmailGuardKeyPart(match && match.recipient_domain),
      recipientCompanyKey: normalizeColdmailGuardKeyPart(match && match.recipient_company_key),
      recipientId: normalizeColdmailGuardKeyPart(match && match.recipient_id),
      recipientCompany: normalizeString(match && match.recipient_company),
      permanent: Boolean(match && match.permanent),
      provider: normalizeString(match && match.provider),
      source: normalizeString(match && match.source),
    });
  }

  function isCompleteOutboundGuardReservation(result) {
    const actualCount = Number(result && result.count);
    const expectedCount = Number(result && result.expectedCount);
    if (!result || result.ok !== true) return false;
    if (!Number.isFinite(actualCount) || actualCount <= 0) return false;
    return !(Number.isFinite(expectedCount) && expectedCount > 0 && actualCount < expectedCount);
  }

  async function getSupabaseOutboundRecipientBlock(item) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.findRecipientConflict !== 'function') {
      return null;
    }
    const match = await outboundRecipientGuardStore.findRecipientConflict(buildOutboundRecipientGuardIdentity(item));
    return match ? buildSupabaseOutboundGuardFailure(item, match) : null;
  }

  async function reserveSupabaseOutboundRecipientForColdmail(item, senderEmail, actor) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.reserveRecipients !== 'function') {
      const error = new Error('Centrale outbound duplicate-guard ontbreekt; coldmail niet verzonden.');
      error.code = 'COLDMAIL_OUTBOUND_GUARD_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    const reservation = await outboundRecipientGuardStore.reserveRecipients(
      [buildOutboundRecipientGuardIdentity(item)],
      {
        provider: 'softora',
        channel: 'coldmail',
        senderEmail,
        source: 'softora-coldmail-pre-send',
        actor,
        status: 'reserved',
        permanent: true,
        payload: {
          customerId: item && item.id,
          bedrijf: getRowCompany(item && item.row),
        },
      }
    );
    if (reservation && reservation.conflict) {
      return {
        ok: false,
        conflict: buildSupabaseOutboundGuardFailure(item, reservation.conflict),
        reservationId: reservation.reservationId,
      };
    }
    if (!isCompleteOutboundGuardReservation(reservation)) {
      const error = new Error('Centrale outbound duplicate-guard kon niet reserveren; coldmail niet verzonden.');
      error.code = 'COLDMAIL_OUTBOUND_GUARD_FAILED';
      error.status = 502;
      throw error;
    }
    return reservation;
  }

  async function confirmSupabaseOutboundRecipientForColdmail(reservationId, sentItem) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.confirmReservation !== 'function') {
      const error = new Error(
        'Centrale outbound duplicate-guard kan niet permanent worden bevestigd na SMTP-acceptatie; coldmailing gepauzeerd.'
      );
      error.code = 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_FAILED';
      error.status = 502;
      throw error;
    }
    if (!reservationId) {
      const error = new Error(
        'Centrale outbound duplicate-guard mist een reservering na SMTP-acceptatie; coldmailing gepauzeerd.'
      );
      error.code = 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_FAILED';
      error.status = 502;
      throw error;
    }
    try {
      const confirmation = await outboundRecipientGuardStore.confirmReservation(reservationId, {
        status: 'sent',
        permanent: true,
        payload: {
          messageId: sentItem && sentItem.messageId,
          email: sentItem && sentItem.email,
          bedrijf: sentItem && sentItem.bedrijf,
        },
      });
      if (!confirmation || confirmation.ok !== true || Number(confirmation.count || 0) <= 0) {
        const error = new Error('Centrale outbound duplicate-guard bevestigde geen bestaande reservering.');
        error.code = 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_EMPTY';
        throw error;
      }
    } catch (error) {
      logger.error('[OutboundRecipientGuard][coldmail-confirm]', error && error.message ? error.message : error);
      const wrappedError = new Error(
        'Centrale outbound duplicate-guard kon niet permanent worden bevestigd na SMTP-acceptatie; coldmailing gepauzeerd.'
      );
      wrappedError.code = 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_FAILED';
      wrappedError.status = 502;
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  async function releaseSupabaseOutboundRecipientReservation(reservation, context = {}) {
    const reservationId = normalizeString(reservation && reservation.reservationId);
    if (!reservationId || !outboundRecipientGuardStore || typeof outboundRecipientGuardStore.releaseReservation !== 'function') {
      return;
    }
    try {
      await outboundRecipientGuardStore.releaseReservation(reservationId);
    } catch (error) {
      logger.warn('[OutboundRecipientGuard][coldmail-release]', {
        reservationId,
        recipientEmail: normalizeEmailAddress(context && context.to),
        error: error && error.message ? error.message : error,
      });
    }
  }

  function buildColdmailSenderCooldownIdentity(senderEmail) {
    const email = normalizeEmailAddress(senderEmail);
    return email ? { recipientKey: `coldmail-sender-cooldown:${email}` } : { recipientKey: '' };
  }

  function getColdmailSenderCooldownLockMs(input = {}) {
    const raw = input.senderCooldownLock && typeof input.senderCooldownLock === 'object'
      ? input.senderCooldownLock
      : {};
    const minutes = Math.max(0, Number(raw.senderMinIntervalMinutes || raw.minIntervalMinutes) || 0);
    if (!minutes) return 0;
    return minutes * 60 * 1000 + COLDMAIL_SENDER_COOLDOWN_LOCK_SAFETY_MS;
  }

  function getColdmailSenderCooldownPreflightLockMs(input = {}) {
    const fullLockMs = getColdmailSenderCooldownLockMs(input);
    if (!fullLockMs) return 0;
    return Math.min(fullLockMs, COLDMAIL_SENDER_COOLDOWN_PREFLIGHT_TTL_MS);
  }

  function shouldReserveColdmailSenderCooldown(input = {}) {
    const raw = input.senderCooldownLock && typeof input.senderCooldownLock === 'object'
      ? input.senderCooldownLock
      : {};
    return raw.enabled === true && getColdmailSenderCooldownLockMs(input) > 0;
  }

  function buildColdmailSenderCooldownConflictError(senderEmail, conflict) {
    const retryAt = normalizeString(conflict && (conflict.expires_at || conflict.updated_at || conflict.last_seen_at));
    const detail = retryAt ? ` Actieve lock loopt tot ongeveer ${retryAt}.` : '';
    const error = new Error(
      `Sender ${normalizeEmailAddress(senderEmail) || senderEmail} zit nog in de centrale cooldown.${detail}`
    );
    error.code = 'COLDMAIL_SENDER_COOLDOWN_ACTIVE';
    error.status = 429;
    error.senderEmail = normalizeEmailAddress(senderEmail);
    error.conflict = conflict || null;
    return error;
  }

  function isActiveColdmailSenderCooldownConflict(conflict) {
    if (!conflict || typeof conflict !== 'object') return false;
    const channel = normalizeString(conflict.channel);
    if (channel && channel !== 'coldmail-sender-cooldown') return false;
    const expiresAtMs = parseTimestampMs(conflict.expires_at);
    if (expiresAtMs && expiresAtMs <= now().getTime()) return false;
    return true;
  }

  async function findSupabaseColdmailSenderCooldownConflict(senderEmail) {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.findRecipientConflict !== 'function') {
      return null;
    }
    try {
      const conflict = await outboundRecipientGuardStore.findRecipientConflict(
        buildColdmailSenderCooldownIdentity(senderEmail)
      );
      return isActiveColdmailSenderCooldownConflict(conflict) ? conflict : null;
    } catch (error) {
      logger.warn('[ColdmailSenderCooldown][lookup]', {
        senderEmail: normalizeEmailAddress(senderEmail),
        error: error && error.message ? error.message : error,
      });
      return null;
    }
  }

  async function reserveSupabaseColdmailSenderCooldown(senderEmail, input = {}, actor) {
    if (!shouldReserveColdmailSenderCooldown(input)) return null;
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.reserveRecipients !== 'function') {
      const error = new Error('Centrale sender-cooldown guard ontbreekt; coldmail niet verzonden.');
      error.code = 'COLDMAIL_OUTBOUND_GUARD_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    const ttlMs = getColdmailSenderCooldownPreflightLockMs(input);
    const reservation = await outboundRecipientGuardStore.reserveRecipients(
      [buildColdmailSenderCooldownIdentity(senderEmail)],
      {
        provider: 'softora',
        channel: 'coldmail-sender-cooldown',
        senderEmail,
        source: 'softora-coldmail-sender-cooldown',
        actor,
        status: 'reserved',
        permanent: false,
        ttlMs,
        payload: {
          kind: 'coldmail_sender_cooldown',
          senderEmail: normalizeEmailAddress(senderEmail),
          minIntervalMinutes:
            Math.max(0, Number(input.senderCooldownLock && input.senderCooldownLock.senderMinIntervalMinutes) || 0),
        },
      }
    );
    if (reservation && reservation.conflict) {
      throw buildColdmailSenderCooldownConflictError(senderEmail, reservation.conflict);
    }
    if (!isCompleteOutboundGuardReservation(reservation)) {
      const error = new Error('Centrale sender-cooldown guard kon niet reserveren; coldmail niet verzonden.');
      error.code = 'COLDMAIL_OUTBOUND_GUARD_FAILED';
      error.status = 502;
      throw error;
    }
    return reservation;
  }

  async function confirmSupabaseColdmailSenderCooldown(reservation, senderEmail, input = {}, actor) {
    const reservationId = normalizeString(reservation && reservation.reservationId);
    if (!reservationId || !outboundRecipientGuardStore || typeof outboundRecipientGuardStore.confirmReservation !== 'function') {
      return;
    }
    const ttlMs = getColdmailSenderCooldownLockMs(input);
    if (!ttlMs) return;
    try {
      await outboundRecipientGuardStore.confirmReservation(reservationId, {
        status: 'reserved',
        permanent: false,
        expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
        payload: {
          kind: 'coldmail_sender_cooldown',
          senderEmail: normalizeEmailAddress(senderEmail),
          minIntervalMinutes:
            Math.max(0, Number(input.senderCooldownLock && input.senderCooldownLock.senderMinIntervalMinutes) || 0),
          confirmedAfterSmtp: true,
          actor: truncateText(normalizeString(actor), 160),
        },
      });
    } catch (error) {
      logger.warn('[ColdmailSenderCooldown][confirm]', {
        reservationId,
        senderEmail: normalizeEmailAddress(senderEmail),
        error: error && error.message ? error.message : error,
      });
    }
  }

  function hasPriorOutboundMailSignal(row) {
    if (!row || typeof row !== 'object') return false;
    if (normalizeContactStatus(row.outreachStatus, row) === 'gemaild') return true;
    if (normalizeString(row.lastColdmailSentAt || row.lastMailSentAt || row.outreachSentAt || row.outreach_sent_at)) {
      return true;
    }
    if (normalizeString(row.coldmailSentMessageId || row.outreachMessageId || row.sentMessageId || row.messageId)) {
      return true;
    }
    if (Number(row.coldmailOpenCount || row.outreachOpenCount || 0) > 0) return true;
    if (row.coldmailOpened === true || row.outreachOpened === true) return true;
    return (Array.isArray(row.hist) ? row.hist : []).some((entry) => {
      const text = normalizeString([
        entry && entry.type,
        entry && entry.status,
        entry && entry.label,
        entry && entry.source,
        entry && entry.subject,
        entry && entry.preview,
        entry && entry.messageKey,
      ].join(' ')).toLowerCase();
      return /\b(gemaild|mail verstuurd|coldmail|cold mailing|instantly|email sent|email opened|open tracking)\b/.test(text);
    });
  }

  async function getColdmailOutboundDuplicateBlock(item, recipientGuardEntries = []) {
    const email = getRowEmail(item && item.row);
    if (isTestRecipientRow(item && item.row, email)) return null;
    const recipientGuardMatch = getColdmailRecipientGuardMatch(item, recipientGuardEntries);
    if (recipientGuardMatch) return buildColdmailRecipientGuardFailure(item, recipientGuardMatch);
    const supabaseGuardMatch = await getSupabaseOutboundRecipientBlock(item);
    if (supabaseGuardMatch) return supabaseGuardMatch;
    if (hasPriorOutboundMailSignal(item && item.row)) {
      return {
        id: item && item.id,
        bedrijf: getRowCompany(item && item.row),
        email: getRowEmail(item && item.row),
        code: 'COLDMAIL_RECIPIENT_RECENTLY_SENT',
        error: 'Dit bedrijf/e-mailadres heeft al outbound mailhistorie en wordt niet opnieuw gemaild.',
      };
    }
    return null;
  }

  async function getPreWebdesignColdmailBlock(item, recipientGuardEntries = []) {
    const duplicateBlock = await getColdmailOutboundDuplicateBlock(item, recipientGuardEntries);
    if (duplicateBlock) return duplicateBlock;
    const email = getRowEmail(item && item.row);
    if (!isTestRecipientRow(item && item.row, email) && shouldBlockPersonalMailboxDomains() && isPersonalMailboxDomain(email)) {
      return {
        id: item && item.id,
        bedrijf: getRowCompany(item && item.row),
        email,
        error: `Persoonlijke mailbox overgeslagen voor coldmail: ${getEmailDomain(email)}.`,
      };
    }
    if (!(await isDeliverableEmailDomain(email))) {
      const domain = getEmailDomain(email);
      return {
        id: item && item.id,
        bedrijf: getRowCompany(item && item.row),
        email,
        domain,
        code: 'invalid_email_domain',
        error: `E-maildomein bestaat niet of ontvangt geen mail: ${domain || email}`,
      };
    }
    return null;
  }

  function buildWebdesignPreparationCustomer(item) {
    const row = item && item.row ? item.row : {};
    const websiteUrl = getRowWebdesignPreparationUrl(row);
    return {
      id: item && item.id,
      bedrijf: getRowCompany(row),
      naam: getRowContact(row),
      tel: getRowPhone(row),
      dom: getRowDomain(row) || websiteUrl,
      website: websiteUrl,
    };
  }

  function buildWebdesignPreparationJobId(item) {
    const row = item && item.row ? item.row : {};
    const seed = [
      item && item.id,
      getRowEmail(row),
      getRowCompany(row),
      getRowDomain(row),
    ].map(normalizeString).join('|');
    const hash = crypto.createHash('sha256').update(seed || `${Date.now()}`).digest('hex').slice(0, 24);
    return `coldmail_webdesign_${hash}_${Date.now().toString(36)}`;
  }

  async function queueWebdesignPreparationForRecipient(item) {
    if (
      !item ||
      !webdesignPreparationCoordinator ||
      typeof webdesignPreparationCoordinator.startJob !== 'function'
    ) {
      return null;
    }
    const row = item.row || {};
    const websiteUrl = getRowWebdesignPreparationUrl(row);
    if (!websiteUrl) return null;
    const customer = buildWebdesignPreparationCustomer(item);
    if (!customer.id || !customer.bedrijf) return null;
    const result = await webdesignPreparationCoordinator.startJob({
      ownerKey: 'coldmail-autopilot::system',
      jobId: buildWebdesignPreparationJobId(item),
      customer,
      websiteUrl,
      source: 'coldmail-autopilot',
    });
    if (!result || result.ok === false) return null;
    return {
      queued: true,
      existing: Boolean(result.existing),
      customerId: customer.id,
      bedrijf: customer.bedrijf,
      email: getRowEmail(row),
      websiteUrl,
      job: result.job || null,
    };
  }

  function getRowPhone(row) {
    const value = normalizeString(
      row.phoneE164 ||
        row.phone ||
        row.tel ||
        row.telefoon ||
        row.telefoonnummer ||
        row.telefoonNummer ||
        row.telefoon_nummer ||
        row.mobile ||
        row.mobilePhone ||
        row.mobiel ||
        row.phoneNumber ||
        row.contactPhone ||
        row.contact_phone ||
        ''
    );
    return value === '—' || value === '-' ? '' : value;
  }

  function normalizePhoneDigits(value) {
    return normalizeString(value).replace(/[^\d]/g, '');
  }

  function getComparablePhoneKeys(value) {
    const digits = normalizePhoneDigits(value);
    const keys = new Set();
    if (!digits) return keys;
    keys.add(digits);
    const withoutInternationalPrefix = digits.startsWith('00') ? digits.slice(2) : digits;
    if (withoutInternationalPrefix) keys.add(withoutInternationalPrefix);
    if (withoutInternationalPrefix.startsWith('31') && withoutInternationalPrefix.length > 2) {
      keys.add(`0${withoutInternationalPrefix.slice(2)}`);
    }
    if (withoutInternationalPrefix.startsWith('0') && withoutInternationalPrefix.length > 1) {
      keys.add(`31${withoutInternationalPrefix.slice(1)}`);
    }
    if (withoutInternationalPrefix.length === 9 && withoutInternationalPrefix.startsWith('6')) {
      keys.add(`0${withoutInternationalPrefix}`);
      keys.add(`31${withoutInternationalPrefix}`);
    }
    return keys;
  }

  function parseBlockedPhoneList(value) {
    const entries = Array.isArray(value)
      ? value
      : normalizeString(value).split(/[\n,;|]+/);
    const keys = new Set();
    entries.forEach((entry) => {
      getComparablePhoneKeys(entry).forEach((key) => keys.add(key));
    });
    return keys;
  }

  function isPhoneBlocked(phone, blockedPhoneKeys) {
    if (!blockedPhoneKeys || !blockedPhoneKeys.size) return false;
    for (const key of getComparablePhoneKeys(phone)) {
      if (blockedPhoneKeys.has(key)) return true;
    }
    return false;
  }

  function parseBlockedEmailList(value) {
    const entries = (Array.isArray(value) ? value.join('\n') : normalizeString(value)).split(/[\s,;|]+/);
    return new Set(entries.map(normalizeEmailAddress).filter(isLikelyValidEmail));
  }

  function isEmailBlocked(email, blockedEmailKeys) {
    if (!blockedEmailKeys || !blockedEmailKeys.size) return false;
    return blockedEmailKeys.has(normalizeEmailAddress(email));
  }

  function isLikelyCallablePhone(value) {
    const phone = getRowPhone({ phone: value });
    return phone.replace(/\D/g, '').length >= 8;
  }

  function normalizeIdentityTextPart(value) {
    if (value === undefined || value === null) return '';
    const text = normalizeString(value);
    if (!text || text === 'undefined' || text === 'null') return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeIdentityPhonePart(value) {
    return normalizePhoneDigits(value) || normalizeIdentityTextPart(value);
  }

  function buildNormalizedIdentityKey(company, contact, phone) {
    const normalizedCompany = normalizeIdentityTextPart(company);
    const normalizedContact = normalizeIdentityTextPart(contact);
    const normalizedPhone = normalizeIdentityPhonePart(phone);
    if (!normalizedCompany && !normalizedContact && !normalizedPhone) return '';
    return [normalizedCompany, normalizedContact, normalizedPhone].join('|');
  }

  function buildNormalizedIdentityKeys(company, contact, phone) {
    const phoneKeys = Array.from(getComparablePhoneKeys(phone));
    const normalizedFallbackPhone = normalizeIdentityPhonePart(phone);
    if (!phoneKeys.length && normalizedFallbackPhone) phoneKeys.push(normalizedFallbackPhone);
    const keys = phoneKeys.length
      ? phoneKeys.map((phoneKey) => buildNormalizedIdentityKey(company, contact, phoneKey))
      : [buildNormalizedIdentityKey(company, contact, '')];
    return new Set(keys.filter(Boolean));
  }

  function normalizeStoredIdentityKeys(value) {
    if (value === undefined || value === null) return new Set();
    const raw = normalizeString(value);
    if (!raw || raw === 'undefined' || raw === 'null') return new Set();
    const parts = raw.split('|');
    if (parts.length >= 3) {
      return buildNormalizedIdentityKeys(parts[0], parts[1], parts.slice(2).join('|'));
    }
    return new Set([normalizeIdentityTextPart(raw)].filter(Boolean));
  }

  function getExplicitRowContact(row) {
    return normalizeString(row && (row.naam || row.contact || row.contactName || row.clientName));
  }

  function buildRowIdentityKeys(row) {
    const company = getRowCompany(row);
    const explicitContact = getExplicitRowContact(row);
    const fallbackContact = getRowContact(row);
    const phone = getRowPhone(row);
    const keys = new Set();
    [
      [company, fallbackContact, phone],
      [company, explicitContact, phone],
      [company, company, phone],
    ].forEach(([companyPart, contactPart, phonePart]) => {
      buildNormalizedIdentityKeys(companyPart, contactPart, phonePart).forEach((key) => keys.add(key));
    });
    return keys;
  }

  function buildRowIdentityKey(row) {
    return Array.from(buildRowIdentityKeys(row))[0] || '';
  }

  function getPhotoIdentityKeys(photo) {
    const keys = new Set();
    normalizeStoredIdentityKeys(photo && photo.identityKey).forEach((key) => keys.add(key));
    normalizeStoredIdentityKeys(photo && photo.legacyMeta && photo.legacyMeta.identityKey).forEach((key) => keys.add(key));
    return keys;
  }

  function splitNormalizedIdentityKey(value) {
    const parts = normalizeString(value).split('|');
    return {
      company: normalizeIdentityTextPart(parts[0]),
      contact: normalizeIdentityTextPart(parts[1]),
      phone: normalizeIdentityPhonePart(parts.slice(2).join('|')),
    };
  }

  function identityKeyMatchesRowIdentity(photoIdentityKey, rowIdentityKey, options = {}) {
    if (photoIdentityKey === rowIdentityKey) return true;
    if (!options.allowMissingStoredPhonePart) return false;
    const photoParts = splitNormalizedIdentityKey(photoIdentityKey);
    const rowParts = splitNormalizedIdentityKey(rowIdentityKey);
    return Boolean(
      photoParts.company &&
        photoParts.contact &&
        !photoParts.phone &&
        rowParts.phone &&
        photoParts.company === rowParts.company &&
        photoParts.contact === rowParts.contact
    );
  }

  function photoRecordMatchesRowIdentity(photo, row, options = {}) {
    const photoIdentityKeys = getPhotoIdentityKeys(photo);
    if (!photoIdentityKeys.size) return true;
    const rowIdentityKeys = buildRowIdentityKeys(row);
    return Array.from(photoIdentityKeys).some((photoIdentityKey) =>
      Array.from(rowIdentityKeys).some((rowIdentityKey) =>
        identityKeyMatchesRowIdentity(photoIdentityKey, rowIdentityKey, options)
      )
    );
  }

  function mergeColdcallingRowsWithCustomerRows(leadRows = [], customerRows = []) {
    const mergedRows = [];
    const seenKeys = new Set();
    const addRow = (row) => {
      if (!row || typeof row !== 'object') return;
      const phoneKeys = Array.from(getComparablePhoneKeys(getRowPhone(row)));
      const keys = phoneKeys.length ? phoneKeys : [buildRowIdentityKey(row)];
      if (keys.some((key) => key && seenKeys.has(key))) return;
      mergedRows.push(row);
      keys.filter(Boolean).forEach((key) => seenKeys.add(key));
    };
    (Array.isArray(leadRows) ? leadRows : []).forEach(addRow);
    (Array.isArray(customerRows) ? customerRows : []).forEach(addRow);
    return mergedRows;
  }

  function isResolvableWebsitePhotoValue(value) {
    const text = normalizeString(value);
    if (!text) return false;
    if (parseDataUrlImage(text)) return true;
    return /^https:\/\//i.test(text);
  }

  function findStoredPhotoRecordForRow(row, index, photoMap, photosByIdentity) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const byIdentity = photosByIdentity instanceof Map ? photosByIdentity : new Map();
    const directIds = Array.from(
      new Set([
        getExplicitRowId(row),
        normalizeString(row && row.testModeSourceRowId),
      ].filter(Boolean))
    );
    for (const id of directIds) {
      const directPhoto = photos[id];
      if (
        directPhoto &&
        (photoRecordMatchesRowIdentity(directPhoto, row, { allowMissingStoredPhonePart: true }) ||
          isDedicatedTestModeRow(row))
      ) {
        return directPhoto;
      }
    }
    for (const identityKey of buildRowIdentityKeys(row)) {
      const photo = byIdentity.get(identityKey);
      if (photo) return photo;
    }
    return null;
  }

  function findStoredPhotoRecordById(id, photoMap) {
    const cleanId = normalizeString(id);
    if (!cleanId) return null;
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const direct = photos[cleanId];
    if (direct && typeof direct === 'object') return { ...direct, id: normalizeString(direct.id || direct.customerId) || cleanId };
    const lowerId = cleanId.toLowerCase();
    return Object.keys(photos).reduce((match, key) => {
      if (match) return match;
      const item = photos[key];
      if (!item || typeof item !== 'object') return null;
      const itemId = normalizeString(item.id || item.customerId || key);
      return itemId && itemId.toLowerCase() === lowerId ? { ...item, id: itemId } : null;
    }, null);
  }

  function preferFreshRowPhotoFields(row, storedPhoto) {
    const base = storedPhoto && typeof storedPhoto === 'object' ? { ...storedPhoto } : {};
    const next = { ...base };
    const rowPhotoSource = getWebdesignPhotoSource(row);
    const rowMockupSource = getWebdesignMockupSource(row);
    if (!isResolvableWebsitePhotoValue(getWebdesignPhotoSource(next)) && isResolvableWebsitePhotoValue(rowPhotoSource)) {
      next.websitePhoto = row.websitePhoto || row.websitePhotoUrl || row.signedUrl || (row.storage && row.storage.signedUrl) || rowPhotoSource;
      const rowPhotoName = normalizeString(row.websitePhotoName || row.photoName || row.websiteImageName);
      if (rowPhotoName) next.websitePhotoName = rowPhotoName;
    }
    if (!isResolvableWebsitePhotoValue(getWebdesignMockupSource(next)) && isResolvableWebsitePhotoValue(rowMockupSource)) {
      next.websiteMockup =
        row.websiteMockup ||
        row.websiteMockupUrl ||
        row.mockupUrl ||
        row.signedMockupUrl ||
        (row.mockupStorage && row.mockupStorage.signedUrl) ||
        rowMockupSource;
      const rowMockupName = normalizeString(row.websiteMockupName || row.mockupName);
      if (rowMockupName) next.websiteMockupName = rowMockupName;
      next.mockupRenderer = normalizeString(row.mockupRenderer || row.websiteMockupRenderer || next.mockupRenderer);
      next.mockupOrientation = normalizeString(row.mockupOrientation || row.websiteMockupOrientation || next.mockupOrientation);
      next.mockupQualityStatus = normalizeString(row.mockupQualityStatus || row.websiteMockupQualityStatus || next.mockupQualityStatus);
      next.mockupQualityCheckedAt = normalizeString(row.mockupQualityCheckedAt || row.websiteMockupQualityCheckedAt || next.mockupQualityCheckedAt);
    }
    if (!normalizeString(next.id)) next.id = getRowId(row, 0);
    if (!normalizeString(next.identityKey)) next.identityKey = buildRowIdentityKey(row);
    return next;
  }

  function hasReadyWebsitePhotoRecord(photo) {
    if (!photo || typeof photo !== 'object') return false;
    return Boolean(
      isResolvableWebsitePhotoValue(photo.websitePhoto) ||
        isResolvableWebsitePhotoValue(photo.websitePhotoUrl) ||
        isResolvableWebsitePhotoValue(photo.signedUrl) ||
        isResolvableWebsitePhotoValue(photo.storage && photo.storage.signedUrl)
    );
  }

  function hasReadyWebdesignAssetRecord(photo) {
    if (!hasReadyWebsitePhotoRecord(photo)) return false;
    return isApprovedWebdesignMockupRecord(photo);
  }

  function createReadyWebdesignMatcher(customerRows = [], photoMap = {}) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      if (!hasReadyWebdesignAssetRecord(item)) return;
      getPhotoIdentityKeys(item).forEach((identityKey) => {
        if (identityKey) photosByIdentity.set(identityKey, item);
      });
    });

    const readyIds = new Set();
    const readyIdentityKeys = new Set();
    const readyPhoneKeys = new Set();

    (Array.isArray(customerRows) ? customerRows : []).forEach((row, index) => {
      const photo = preferFreshRowPhotoFields(row, findStoredPhotoRecordForRow(row, index, photos, photosByIdentity));
      if (!hasReadyWebdesignAssetRecord(photo)) return;

      const rowId = getExplicitRowId(row);
      if (rowId) readyIds.add(rowId);
      buildRowIdentityKeys(row).forEach((identityKey) => readyIdentityKeys.add(identityKey));
      getComparablePhoneKeys(getRowPhone(row)).forEach((key) => readyPhoneKeys.add(key));
    });

    return {
      hasRow(row, index = 0) {
        const rowId = getExplicitRowId(row);
        if (rowId && readyIds.has(rowId)) return true;
        for (const identityKey of buildRowIdentityKeys(row)) {
          if (readyIdentityKeys.has(identityKey)) return true;
        }
        for (const key of getComparablePhoneKeys(getRowPhone(row))) {
          if (readyPhoneKeys.has(key)) return true;
        }
        return false;
      },
    };
  }

  function getEmailDomain(email) {
    const normalized = normalizeEmailAddress(email);
    const parts = normalized.split('@');
    return parts.length === 2 ? parts[1] : '';
  }

  function envKeyForEmail(email) {
    return normalizeEmailAddress(email)
      .split('@')[0]
      .replace(/[^a-z0-9]+/g, '_')
      .toUpperCase();
  }

  function envKeyForDomain(email) {
    return normalizeEmailAddress(email)
      .split('@')
      .slice(1)
      .join('@')
      .replace(/[^a-z0-9]+/g, '_')
      .toUpperCase();
  }

  function readBooleanEnv(value) {
    const normalized = normalizeString(value);
    if (!normalized) return null;
    if (/^(1|true|yes)$/i.test(normalized)) return true;
    if (/^(0|false|no)$/i.test(normalized)) return false;
    return null;
  }

  function readPortEnv(value) {
    const port = Number(value || 0);
    return Number.isFinite(port) && port > 0 ? port : 0;
  }

  function readMailboxEnvForKey(key) {
    const env = process.env || {};
    const sharedUser = normalizeString(env[`MAILBOX_${key}_USER`] || '');
    const sharedPass = normalizeString(env[`MAILBOX_${key}_PASS`] || '');
    return {
      imapHost: normalizeString(env[`MAILBOX_${key}_IMAP_HOST`] || ''),
      imapPort: readPortEnv(env[`MAILBOX_${key}_IMAP_PORT`]),
      imapSecure: readBooleanEnv(env[`MAILBOX_${key}_IMAP_SECURE`]),
      imapUser: normalizeString(env[`MAILBOX_${key}_IMAP_USER`] || sharedUser),
      imapPass: normalizeString(env[`MAILBOX_${key}_IMAP_PASS`] || sharedPass),
      useBaseCredentials: readBooleanEnv(env[`MAILBOX_${key}_USE_BASE_CREDENTIALS`]) === true,
    };
  }

  function resolveSentCopyAccount(senderEmail, senderAccount = null) {
    const email = normalizeEmailAddress(
      senderEmail ||
        (senderAccount && senderAccount.email) ||
        mailFromAddress ||
        smtpUser ||
        imapUser
    );
    const envAccount = readMailboxEnvForKey(envKeyForEmail(email));
    const envDomain = readMailboxEnvForKey(envKeyForDomain(email));
    const configuredAccount =
      senderAccount && normalizeEmailAddress(senderAccount.email) === email
        ? senderAccount
        : getConfiguredMailboxSmtpAccounts().find((item) => normalizeEmailAddress(item.email) === email);
    const useBaseCredentials =
      email === normalizeEmailAddress(mailFromAddress) ||
      email === normalizeEmailAddress(smtpUser) ||
      email === normalizeEmailAddress(imapUser) ||
      envAccount.useBaseCredentials ||
      envDomain.useBaseCredentials;
    const port =
      Number(
        (configuredAccount && configuredAccount.imapPort) ||
          envAccount.imapPort ||
          envDomain.imapPort ||
          imapPort ||
          993
      ) || 993;
    const secure =
      configuredAccount && typeof configuredAccount.imapSecure === 'boolean'
        ? Boolean(configuredAccount.imapSecure)
        : typeof envAccount.imapSecure === 'boolean'
        ? envAccount.imapSecure
        : typeof envDomain.imapSecure === 'boolean'
          ? envDomain.imapSecure
          : Boolean(imapSecure || port === 993);
    const account = {
      email,
      imapHost: normalizeString(
        (configuredAccount && configuredAccount.imapHost) ||
          envAccount.imapHost ||
          envDomain.imapHost ||
          imapHost
      ),
      imapPort: port,
      imapSecure: secure,
      imapUser: normalizeString(
        (configuredAccount && configuredAccount.imapUser) ||
          envAccount.imapUser ||
          envDomain.imapUser ||
          (useBaseCredentials ? imapUser : '') ||
          (configuredAccount && configuredAccount.smtpUser) ||
          email
      ),
      imapPass: normalizeString(
        (configuredAccount && configuredAccount.imapPass) ||
          envAccount.imapPass ||
          envDomain.imapPass ||
          (useBaseCredentials ? imapPass : '') ||
          (configuredAccount && configuredAccount.smtpPass)
      ),
    };
    return account;
  }

  async function saveSentCopy(senderEmail, mail, info, senderAccount = null) {
    const senderDomain = normalizeEmailAddress(senderEmail).split('@').pop();
    if (senderDomain === 'gmail.com' || senderDomain === 'googlemail.com') {
      return false;
    }
    return appendSentMessage({
      account: resolveSentCopyAccount(senderEmail, senderAccount),
      createImapClient,
      nodemailer,
      mail,
      messageId: normalizeString(info && info.messageId),
      sentAt: now(),
    });
  }

  function isTestRecipientEmail(email) {
    return TEST_RECIPIENT_EMAILS.has(normalizeEmailAddress(email));
  }

  function isTestRecipientRow(row, email) {
    const company = getRowCompany(row).toLowerCase();
    return isTestRecipientEmail(email || getRowEmail(row)) || TEST_RECIPIENT_COMPANIES.has(company);
  }

  function isDedicatedTestModeRow(row) {
    return [
      normalizeString(row && (row.id || row.customerId || row.databaseId)),
      normalizeString(row && row.testModeSourceRowId),
    ].some((id) => id.toLowerCase() === COLDMAIL_TEST_RECIPIENT_ID);
  }

  function getImapMailboxesForSync() {
    const defaults = ['INBOX', 'Spam', 'Junk', 'INBOX.Spam', 'INBOX.Junk', 'Reclame'];
    const combined = [imapMailbox, ...imapExtraMailboxes, ...defaults].filter(Boolean);
    const seen = new Set();
    return combined.filter((mailbox) => {
      const key = normalizeString(mailbox).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeMessageIdToken(value) {
    return normalizeString(value).replace(/[<>]/g, '').toLowerCase();
  }

  function collectMessageReferenceHeader(parsedMail) {
    const refs = [];
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      normalizeString(value)
        .split(/\s+/)
        .map(normalizeMessageIdToken)
        .filter(Boolean)
        .forEach((token) => refs.push(`<${token}>`));
    };
    add(parsedMail && parsedMail.references);
    add(parsedMail && parsedMail.inReplyTo);
    add(parsedMail && parsedMail.messageId);
    return Array.from(new Set(refs)).join(' ');
  }

  function getParsedMailAddressList(parsedMail, key) {
    const list = parsedMail && parsedMail[key] && Array.isArray(parsedMail[key].value) ? parsedMail[key].value : [];
    return list
      .map((entry) => ({
        address: normalizeEmailAddress(entry && entry.address),
        name: normalizeString(entry && entry.name),
      }))
      .filter((entry) => entry.address);
  }

  function getParsedMailFromEmail(parsedMail) {
    return getParsedMailAddressList(parsedMail, 'from')[0] || { address: '', name: '' };
  }

  function getInboundReplyText(parsedMail) {
    let text = String((parsedMail && (parsedMail.text || parsedMail.html)) || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    const splitPatterns = [
      /\n[-_]{2,}\s*oorspronkelijk bericht\s*[-_]{2,}/i,
      /\non .+ wrote:/i,
      /\nop .+ schreef .+:/i,
      /\nvan:\s.+/i,
    ];
    for (const pattern of splitPatterns) {
      const match = text.match(pattern);
      if (match && Number.isFinite(match.index)) text = text.slice(0, match.index);
    }
    return text
      .split('\n')
      .map((line) => normalizeString(line))
      .filter((line) => line && !line.startsWith('>'))
      .filter((line) => !/^(from|to|subject|onderwerp|sent|verzonden|cc):/i.test(line))
      .join('\n')
      .trim();
  }

  function normalizeInboundIntentText(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifyInboundColdmailReplyLifecycle(inboundText) {
    const text = normalizeInboundIntentText(inboundText);
    if (!text) return { status: '', intent: 'unknown', label: 'Geen duidelijke mailreactie' };

    const optOutPattern =
      /\b(stop|afmelden|uitschrijven|unsubscribe|verwijder|remove me|mail mij niet|niet meer mailen|geen interesse|geen behoefte|niet geinteresseerd|niet interessant|laat maar)\b/i;
    if (optOutPattern.test(text)) {
      return {
        status: 'geblokkeerd',
        intent: 'opt_out',
        label: 'Afmelding of geen interesse via mail',
        disableMail: true,
      };
    }

    const positivePattern =
      /\b(interessant|interesse|klinkt goed|klinkt interessant|vertel|meer info|meer informatie|informatie ontvangen|bel mij|bel me|bellen|afspraak|kennismaking|inplannen|plannen|offerte|prijs|kosten|hoe werkt|wanneer kunnen|neem contact|contact opnemen|tell me more|sounds good|interested)\b/i;
    if (positivePattern.test(text)) {
      return {
        status: 'interesse',
        intent: 'interested',
        label: 'Interesse via mail',
        disableMail: false,
      };
    }

    return { status: '', intent: 'unclear', label: 'Mailreactie zonder duidelijke lifecycle-status' };
  }

  function parseColdmailReplyAiIntent(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
      return normalizeString(parsed && (parsed.intent || parsed.classification || parsed.status)).toLowerCase();
    } catch (_) {
      const text = normalizeInboundIntentText(raw);
      if (/\b(interested|interest|interesse|positive|positief|lead)\b/.test(text)) return 'interested';
      if (/\b(no_interest|not_interested|geen_interesse|negative|negatief|unsubscribe|afmelden)\b/.test(text)) {
        return 'no_interest';
      }
      return '';
    }
  }

  async function classifyInboundColdmailReplyLifecycleWithAi({ row, parsedMail, inboundText }) {
    const fallback = classifyInboundColdmailReplyLifecycle(inboundText);
    if (!isWebdesignOutreachRow(row) || fallback.intent === 'opt_out') return fallback;
    const apiKey = getOpenAiApiKey();
    if (!apiKey) return fallback;

    try {
      const from = getParsedMailFromEmail(parsedMail);
      const response = await fetchJsonWithTimeout(`${openAiApiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: normalizeString(coldmailAutoReplyModel) || 'gpt-5.5-pro',
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: [
                'Je classificeert Nederlandse replies op een Softora webdesign-outreachmail.',
                'Geef alleen JSON terug: {"intent":"interested"|"no_interest"|"unclear"}.',
                'Kies interested bij enige koopintentie, informatievraag, afspraakwens, offerte/prijsvraag of positieve opening.',
                'Kies no_interest alleen bij duidelijke afwijzing of afmelding. Kies anders unclear.',
              ].join(' '),
            },
            {
              role: 'user',
              content: JSON.stringify({
                company: getRowCompany(row),
                recipient: getRowEmail(row),
                from: from.address,
                subject: normalizeString(parsedMail && parsedMail.subject),
                reply: truncateText(inboundText, 2000),
              }),
            },
          ],
        }),
      });
      if (!response || !response.response || !response.response.ok) return fallback;
      const data = response && response.data;
      const content = typeof extractOpenAiTextContent === 'function'
        ? extractOpenAiTextContent(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
        : normalizeString(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
      const intent = parseColdmailReplyAiIntent(content);
      if (intent === 'interested') {
        return {
          status: 'interesse',
          intent: 'interested',
          label: 'Interesse via AI-mailanalyse',
          disableMail: false,
        };
      }
      if (intent === 'no_interest') {
        return {
          status: '',
          intent: 'no_interest',
          label: 'Geen lead volgens AI-mailanalyse',
          disableMail: false,
        };
      }
      return fallback;
    } catch (_) {
      return fallback;
    }
  }

  function buildColdmailDeliveryFailureText(parsedMail, inboundText) {
    const from = getParsedMailFromEmail(parsedMail);
    return [
      normalizeString(parsedMail && parsedMail.subject),
      normalizeString(from.address),
      normalizeString(from.name),
      normalizeString(inboundText),
      normalizeString(parsedMail && parsedMail.text),
      normalizeString(parsedMail && parsedMail.textAsHtml),
      normalizeString(parsedMail && parsedMail.html),
    ].join('\n');
  }

  function isColdmailDeliveryFailureMessage(parsedMail, inboundText) {
    const from = getParsedMailFromEmail(parsedMail);
    const fromText = normalizeString(`${from.address} ${from.name}`).toLowerCase();
    const subject = normalizeString(parsedMail && parsedMail.subject);
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    return Boolean(
      /mailer-daemon|postmaster|mail delivery|no-reply|noreply/i.test(fromText) ||
        COLDMAIL_DELIVERY_FAILURE_PATTERN.test(subject) ||
        COLDMAIL_DELIVERY_FAILURE_PATTERN.test(text)
    );
  }

  function classifyColdmailDeliveryFailure(parsedMail, inboundText) {
    if (!isColdmailDeliveryFailureMessage(parsedMail, inboundText)) return null;
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    if (COLDMAIL_HARD_BOUNCE_PATTERN.test(text)) {
      return {
        status: 'geblokkeerd',
        intent: 'hard_bounce',
        label: 'Hard bounce via mailserver',
        bounceType: 'hard',
        disableMail: true,
      };
    }
    if (COLDMAIL_SOFT_BOUNCE_PATTERN.test(text)) {
      return {
        status: '',
        intent: 'soft_bounce',
        label: 'Zachte bounce via mailserver',
        bounceType: 'soft',
        disableMail: false,
      };
    }
    return {
      status: '',
      intent: 'unknown_bounce',
      label: 'Mailservermelding ontvangen',
      bounceType: 'unknown',
      disableMail: false,
    };
  }

  function getColdmailProviderWarningSafetyReason(parsedMail, inboundText) {
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    const safetyReason = getSmtpSafetyStopReason({ message: text });
    if (!safetyReason) return '';
    const from = getParsedMailFromEmail(parsedMail);
    const fromText = normalizeString(`${from.address} ${from.name}`);
    const subject = normalizeString(parsedMail && parsedMail.subject);
    const providerLike =
      COLDMAIL_PROVIDER_WARNING_SENDER_PATTERN.test(fromText) ||
      COLDMAIL_PROVIDER_WARNING_SUBJECT_PATTERN.test(subject) ||
      isColdmailDeliveryFailureMessage(parsedMail, inboundText);
    return providerLike ? safetyReason : '';
  }

  function extractEmailAddressesFromText(value) {
    const matches = normalizeString(value).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi);
    return Array.from(new Set((matches || []).map(normalizeEmailAddress).filter(Boolean)));
  }

  function isOwnMailboxAddress(email) {
    const address = normalizeEmailAddress(email);
    if (!address) return false;
    if (getAllowedSenderEmails().includes(address)) return true;
    return address.endsWith('@softora.nl');
  }

  function hasActiveColdmailContext(row) {
    if (!row || typeof row !== 'object') return false;
    if (isTestRecipientRow(row)) return true;
    return Boolean(
      normalizeString(row.lastColdmailSentAt || row.coldmailCampaignStartedAt || row.activeColdmailCampaignUntil || row.coldmailCampaignEndsAt)
    );
  }

  function isRowInActiveColdmailCampaign(row) {
    if (!row || typeof row !== 'object') return false;
    const untilMs = Math.max(
      parseTimestampMs(row.activeColdmailCampaignUntil),
      parseTimestampMs(row.coldmailCampaignEndsAt),
      parseTimestampMs(row.mailCampaignEndsAt),
      parseTimestampMs(row.mailCampaignUntil)
    );
    if (untilMs > now().getTime()) return true;
    const startedAtMs = Math.max(
      parseTimestampMs(row.coldmailCampaignStartedAt),
      parseTimestampMs(row.lastColdmailSentAt)
    );
    const durationDays = Number(row.coldmailCampaignDurationDays || row.mailCampaignDurationDays || 0);
    return Boolean(
      startedAtMs &&
        Number.isFinite(durationDays) &&
        durationDays > 0 &&
        startedAtMs + durationDays * 24 * 60 * 60 * 1000 > now().getTime()
    );
  }

  function resolveInboundSenderEmail(parsedMail) {
    const allowed = new Set([...getAllowedSenderEmails(), ...COLDMAIL_WEBDESIGN_LEAD_RECIPIENT_EMAILS]);
    const recipients = [
      ...getParsedMailAddressList(parsedMail, 'to'),
      ...getParsedMailAddressList(parsedMail, 'cc'),
    ];
    const matched = recipients.find((entry) => allowed.has(entry.address));
    return matched ? matched.address : assertSenderAllowed(mailFromAddress);
  }

  function resolveInboundMailboxAccount(parsedMail) {
    try {
      return resolveInboundSenderEmail(parsedMail);
    } catch (_) {
      return normalizeEmailAddress(mailFromAddress || smtpUser || imapUser);
    }
  }

  function findColdmailRowForInboundReply(parsedMail, rows) {
    const from = getParsedMailFromEmail(parsedMail);
    if (!from.address || isOwnMailboxAddress(from.address)) return null;
    const normalizedFrom = from.address;
    const candidates = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) => getRowEmail(row) === normalizedFrom)
      .filter(({ row }) => hasActiveColdmailContext(row));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function findColdmailRowForDeliveryFailure(parsedMail, inboundText, rows) {
    const text = buildColdmailDeliveryFailureText(parsedMail, inboundText);
    const bouncedEmails = extractEmailAddressesFromText(text).filter((email) => !isOwnMailboxAddress(email));
    if (!bouncedEmails.length) return null;
    const bouncedSet = new Set(bouncedEmails);
    const candidates = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) => bouncedSet.has(getRowEmail(row)))
      .filter(({ row }) => hasActiveColdmailContext(row));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function extractOpenAiReplyText(content) {
    if (typeof extractOpenAiTextContent === 'function') {
      return normalizeString(extractOpenAiTextContent(content));
    }
    if (typeof content === 'string') return normalizeString(content);
    if (!Array.isArray(content)) return '';
    return normalizeString(
      content
        .map((item) => {
          if (!item) return '';
          if (typeof item === 'string') return item;
          return typeof item.text === 'string' ? item.text : '';
        })
        .join('\n')
    );
  }

  function getAllowedSenderEmails() {
    return Array.from(
      new Set(
        [
          mailFromAddress,
          smtpUser,
          ...getConfiguredMailboxSmtpAccounts().map((account) => account.email),
          'info@softora.nl',
          'zakelijk@softora.nl',
          'ruben@softora.nl',
          'serve@softora.nl',
          'martijn@softora.nl',
          'servecreusen@softora.nl',
          'martijnvandeven@softora.nl',
          'servec321@gmail.com',
          'martijnven123@gmail.com',
          'serve290@gmail.com',
          'servecreusen7@gmail.com',
          'contact.venvisuals@gmail.com',
        ]
          .map(normalizeEmailAddress)
          .filter(isLikelyValidEmail)
      )
    );
  }

  function getConfiguredSenderEmails() {
    return getAllowedSenderEmails().filter((email) => isSenderSmtpAccountConfigured(resolveSenderSmtpAccount(email)));
  }

  function assertSenderAllowed(senderEmail) {
    const selected = normalizeEmailAddress(senderEmail || mailFromAddress);
    const allowed = getAllowedSenderEmails();
    if (!selected || !allowed.length || allowed.includes(selected)) return selected || allowed[0] || '';
    const error = new Error('Dit afzenderadres is nog niet gekoppeld aan de server.');
    error.code = 'SENDER_NOT_ALLOWED';
    error.allowedSenderEmails = allowed;
    throw error;
  }

  function formatMailFromHeader(senderEmail, smtpAccount = null) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    const name = getSenderDisplayName(address, smtpAccount);
    return name ? `${name} <${address}>` : address;
  }

  function getSenderDisplayName(senderEmail, smtpAccount = null) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    const accountName = smtpAccount && normalizeEmailAddress(smtpAccount.email) === address
      ? normalizeString(smtpAccount.name)
      : '';
    return normalizeString(accountName || SENDER_DISPLAY_NAMES[address] || mailFromName || 'Softora');
  }

  function isColdmailPrivateCopyBlockedSender(senderEmail) {
    return COLDMAIL_PRIVATE_COPY_BLOCKED_SENDERS.has(normalizeEmailAddress(senderEmail));
  }

  function getColdmailReplyToAddress(senderEmail) {
    const selectedSenderEmail = normalizeEmailAddress(senderEmail);
    if (isColdmailPrivateCopyBlockedSender(selectedSenderEmail)) {
      return selectedSenderEmail || mailFromAddress || undefined;
    }
    return mailReplyTo || selectedSenderEmail || mailFromAddress || undefined;
  }

  function getColdmailAuditBccAddress(senderEmail) {
    if (isColdmailPrivateCopyBlockedSender(senderEmail)) return '';
    const email = normalizeEmailAddress(coldmailAuditBcc);
    return isLikelyValidEmail(email) ? email : '';
  }

  function parsePositiveInt(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value || ''), 10);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, safe));
  }

  function getColdmailCampaignSendLimit() {
    return parsePositiveInt(
      coldmailCampaignSendLimit,
      DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT,
      1,
      DEFAULT_COLDMAIL_DAILY_SEND_LIMIT
    );
  }

  function getColdmailDailySendLimit() {
    return parsePositiveInt(
      coldmailDailySendLimit,
      DEFAULT_COLDMAIL_DAILY_SEND_LIMIT,
      1,
      DEFAULT_COLDMAIL_DAILY_SEND_LIMIT
    );
  }

  function getColdmailPackageDailySendLimit() {
    return parsePositiveInt(
      coldmailPackageDailySendLimit,
      DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT,
      1,
      DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT
    );
  }

  function getColdmailSendDelayMs() {
    return parsePositiveInt(coldmailSendDelayMs, DEFAULT_COLDMAIL_SEND_DELAY_MS, 0, 5 * 60 * 1000);
  }

  function getColdmailSafetyPauseMs() {
    return parsePositiveInt(
      coldmailSafetyPauseMs,
      DEFAULT_COLDMAIL_SAFETY_PAUSE_MS,
      60 * 1000,
      24 * 60 * 60 * 1000
    );
  }

  function getColdmailPersonalMailboxDailyLimit() {
    return parsePositiveInt(
      coldmailPersonalMailboxDailyLimit,
      DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT,
      1,
      DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT
    );
  }

  function getColdmailPersonalMailboxSendDelayMs() {
    return parsePositiveInt(
      coldmailPersonalMailboxSendDelayMs,
      DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS,
      0,
      5 * 60 * 1000
    );
  }

  function shouldBlockPersonalMailboxDomains() {
    return coldmailBlockPersonalMailboxDomains !== false;
  }

  function getColdmailSafetyLimits() {
    return {
      campaignSendLimit: getColdmailCampaignSendLimit(),
      dailySendLimit: getColdmailDailySendLimit(),
      packageDailySendLimit: getColdmailPackageDailySendLimit(),
      sendDelayMs: getColdmailSendDelayMs(),
      safetyPauseMs: getColdmailSafetyPauseMs(),
      personalMailboxDailyLimit: getColdmailPersonalMailboxDailyLimit(),
      personalMailboxSendDelayMs: getColdmailPersonalMailboxSendDelayMs(),
      blocksPersonalMailboxDomains: shouldBlockPersonalMailboxDomains(),
      bounceProcessingEnabled: coldmailBounceProcessingEnabled !== false,
      openTrackingConfigured: isColdmailOpenTrackingConfigured(),
      configuredSenderEmails: getConfiguredSenderEmails(),
      auditBccConfigured: Boolean(getColdmailAuditBccAddress()),
    };
  }

  function parseTimestampMs(value) {
    const timestamp = Date.parse(normalizeString(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const oisterwijkCoords = { lat: 51.5792, lng: 5.1889 };
  const campaignPlaceCoords = {
    oisterwijk: { lat: 51.5792, lng: 5.1889 },
    tilburg: { lat: 51.5555, lng: 5.0913 },
    breda: { lat: 51.5719, lng: 4.7683 },
    eindhoven: { lat: 51.4416, lng: 5.4697 },
    'den bosch': { lat: 51.6978, lng: 5.3037 },
    's hertogenbosch': { lat: 51.6978, lng: 5.3037 },
    waalwijk: { lat: 51.6828, lng: 5.0707 },
    boxtel: { lat: 51.5908, lng: 5.3293 },
    helvoirt: { lat: 51.6317, lng: 5.2306 },
    udenhout: { lat: 51.6098, lng: 5.1436 },
    haaren: { lat: 51.6027, lng: 5.2222 },
    goirle: { lat: 51.5206, lng: 5.0667 },
    hilvarenbeek: { lat: 51.4858, lng: 5.1397 },
    chaam: { lat: 51.5069, lng: 4.8616 },
    alphen: { lat: 51.4817, lng: 4.9583 },
    ulvenhout: { lat: 51.5486, lng: 4.7967 },
    galder: { lat: 51.515, lng: 4.775 },
    strijbeek: { lat: 51.5006, lng: 4.7839 },
    bavel: { lat: 51.5653, lng: 4.8307 },
    gilze: { lat: 51.5442, lng: 4.9403 },
    'baarle-nassau': { lat: 51.4475, lng: 4.9292 },
    vught: { lat: 51.6533, lng: 5.2875 },
    best: { lat: 51.5075, lng: 5.3903 },
    oirschot: { lat: 51.505, lng: 5.3139 },
    helmond: { lat: 51.4793, lng: 5.657 },
    dongen: { lat: 51.6265, lng: 4.9383 },
    'etten-leur': { lat: 51.5706, lng: 4.6373 },
    roosendaal: { lat: 51.5308, lng: 4.4653 },
    'bergen op zoom': { lat: 51.4946, lng: 4.2872 },
    almkerk: { lat: 51.7714, lng: 4.9597 },
    werkendam: { lat: 51.8101, lng: 4.8944 },
    sleeuwijk: { lat: 51.815, lng: 4.952 },
    waalre: { lat: 51.3867, lng: 5.4447 },
    valkenswaard: { lat: 51.3513, lng: 5.4595 },
    veldhoven: { lat: 51.418, lng: 5.4024 },
    oss: { lat: 51.765, lng: 5.5181 },
    uden: { lat: 51.6608, lng: 5.6194 },
    veghel: { lat: 51.6167, lng: 5.5486 },
    schijndel: { lat: 51.6225, lng: 5.4319 },
    'sint-oedenrode': { lat: 51.5675, lng: 5.4597 },
  };

  function normalizePlaceKey(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function haversineKm(left, right) {
    const toRad = (value) => (Number(value) * Math.PI) / 180;
    const dLat = toRad(right.lat - left.lat);
    const dLng = toRad(right.lng - left.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function resolveRowCoords(row) {
    const explicitLat = Number(row && (row.lat || row.latitude || row.latitudeNumber));
    const explicitLng = Number(row && (row.lng || row.lon || row.longitude || row.longitudeNumber));
    if (Number.isFinite(explicitLat) && Number.isFinite(explicitLng)) return { lat: explicitLat, lng: explicitLng };
    const haystack = normalizePlaceKey(
      [
        row && row.stad,
        row && row.plaats,
        row && row.city,
        row && row.gemeente,
        row && row.adres,
        row && row.address,
        row && row.location,
      ]
        .filter(Boolean)
        .join(' ')
    );
    const placeKey = Object.keys(campaignPlaceCoords)
      .sort((left, right) => right.length - left.length)
      .find((key) => haystack.includes(normalizePlaceKey(key)));
    return placeKey ? campaignPlaceCoords[placeKey] : null;
  }

  function getRowDistanceKm(row) {
    const existing = Number(row && (row.distanceKm || row.afstandKm || row.radiusKm));
    if (Number.isFinite(existing) && existing >= 0) return existing;
    const coords = resolveRowCoords(row);
    return coords ? haversineKm(oisterwijkCoords, coords) : NaN;
  }

  function parseRadiusKm(value) {
    const parsed = Number.parseFloat(normalizeString(value).replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return 250;
    return Math.max(1, Math.min(MAX_COLDMAIL_RADIUS_KM, parsed));
  }

  function hasExplicitRadiusKm(value) {
    return normalizeString(value) !== '';
  }

  function getColdmailSendGuardSemanticSendKey(entry = {}) {
    if (!entry || Number(entry.count || 0) <= 0) return '';
    let identity = [
      entry.recipientEmail,
      entry.recipientDomain,
      entry.recipientCompanyKey,
      entry.recipientId,
    ].map(normalizeString);
    if (!identity.some(Boolean)) identity = [entry.recipientKey].map(normalizeString);
    if (!identity.some(Boolean)) return '';
    const parsedAt = parseTimestampMs(entry.at);
    const atKey = parsedAt ? new Date(parsedAt).toISOString() : normalizeString(entry.at);
    return [
      atKey,
      normalizeEmailAddress(entry.senderEmail),
      Math.max(0, Number(entry.count || 0) || 0),
      Math.max(0, Number(entry.personalCount || 0) || 0),
      ...identity,
    ].join('|');
  }

  function mergeColdmailSendGuardDuplicateEntry(target, source) {
    if (!target || !source) return target || source;
    const targetPauseMs = parseTimestampMs(target.safetyPauseUntil);
    const sourcePauseMs = parseTimestampMs(source.safetyPauseUntil);
    if (sourcePauseMs > targetPauseMs) {
      target.safetyPauseUntil = source.safetyPauseUntil;
      target.safetyPauseReason = source.safetyPauseReason;
    } else if (!target.safetyPauseReason && source.safetyPauseReason) {
      target.safetyPauseReason = source.safetyPauseReason;
    }
    [
      'recipientKey',
      'recipientEmail',
      'recipientDomain',
      'recipientCompanyKey',
      'recipientId',
      'recipientCompany',
    ].forEach((field) => {
      if (!normalizeString(target[field]) && normalizeString(source[field])) {
        target[field] = source[field];
      }
    });
    return target;
  }

  function pruneColdmailSendGuardEntries(entries) {
    const cutoffMs = now().getTime() - COLDMAIL_SEND_GUARD_WINDOW_MS;
    const currentMs = now().getTime();
    const seen = new Set();
    const semanticSendSeen = new Map();
    const pruned = [];
    (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: normalizeString(entry.at),
        senderEmail: normalizeEmailAddress(entry.senderEmail),
        count: Math.max(0, Number(entry.count || 0) || 0),
        personalCount: Math.max(0, Number(entry.personalCount || 0) || 0),
        recipientKey: normalizeString(entry.recipientKey),
        recipientEmail: normalizeEmailAddress(entry.recipientEmail),
        recipientDomain: normalizeColdmailGuardKeyPart(entry.recipientDomain),
        recipientCompanyKey: normalizeColdmailGuardKeyPart(entry.recipientCompanyKey),
        recipientId: normalizeColdmailGuardKeyPart(entry.recipientId),
        recipientCompany: truncateText(normalizeString(entry.recipientCompany), 120),
        safetyPauseUntil: normalizeString(entry.safetyPauseUntil || entry.until),
        safetyPauseReason: truncateText(normalizeString(entry.safetyPauseReason || entry.reason), 240),
      }))
      .forEach((entry) => {
        const sentRecently = entry.count > 0 && parseTimestampMs(entry.at) >= cutoffMs;
        const activePause = parseTimestampMs(entry.safetyPauseUntil) > currentMs;
        if (!sentRecently && !activePause) return;
        const semanticKey = sentRecently ? getColdmailSendGuardSemanticSendKey(entry) : '';
        if (semanticKey && semanticSendSeen.has(semanticKey)) {
          mergeColdmailSendGuardDuplicateEntry(pruned[semanticSendSeen.get(semanticKey)], entry);
          return;
        }
        const key = [
          entry.at,
          entry.senderEmail,
          entry.count,
          entry.personalCount,
          entry.recipientKey,
          entry.recipientEmail,
          entry.recipientDomain,
          entry.recipientCompanyKey,
          entry.recipientId,
          entry.safetyPauseUntil,
          entry.safetyPauseReason,
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        if (semanticKey) semanticSendSeen.set(semanticKey, pruned.length);
        pruned.push(entry);
      });
    return pruned;
  }

  function pruneColdmailRecipientGuardEntries(entries) {
    const cutoffMs = now().getTime() - COLDMAIL_RECIPIENT_GUARD_WINDOW_MS;
    const seen = new Set();
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: normalizeString(entry.at),
        senderEmail: normalizeEmailAddress(entry.senderEmail),
        recipientKey: normalizeString(entry.recipientKey),
        recipientEmail: normalizeEmailAddress(entry.recipientEmail),
        recipientDomain: normalizeColdmailGuardKeyPart(entry.recipientDomain),
        recipientCompanyKey: normalizeColdmailGuardKeyPart(entry.recipientCompanyKey),
        recipientId: normalizeColdmailGuardKeyPart(entry.recipientId),
        recipientCompany: truncateText(normalizeString(entry.recipientCompany), 120),
        permanent: isPermanentColdmailRecipientGuardEntry(entry),
        source: truncateText(normalizeString(entry.source), 120),
        provider: truncateText(normalizeString(entry.provider || entry.lastColdmailProvider), 80),
        campaignId: truncateText(normalizeString(entry.campaignId || entry.instantlyCampaignId), 160),
        leadId: truncateText(normalizeString(entry.leadId || entry.instantlyLeadId), 160),
      }))
      .filter((entry) => {
        if (!entry.permanent && parseTimestampMs(entry.at) < cutoffMs) return false;
        if (!hasColdmailRecipientGuardIdentity(entry)) return false;
        const key = [
          entry.at,
          entry.senderEmail,
          entry.recipientKey,
          entry.recipientEmail,
          entry.recipientDomain,
          entry.recipientCompanyKey,
          entry.recipientId,
          entry.permanent ? 'permanent' : '',
          entry.source,
          entry.provider,
          entry.campaignId,
          entry.leadId,
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  async function loadColdmailSendGuardState() {
    const state = await getUiStateValues(coldmailSendGuardScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const parsed = safeJsonParse(values[coldmailSendGuardKey] || '{}', {});
    return {
      entries: pruneColdmailSendGuardEntries(parsed && parsed.entries),
      recipientEntries: pruneColdmailRecipientGuardEntries([
        ...((parsed && Array.isArray(parsed.recipientEntries)) ? parsed.recipientEntries : []),
        ...((parsed && Array.isArray(parsed.entries)) ? parsed.entries : []),
      ]),
    };
  }

  async function saveColdmailSendGuardState(sendGuardState, actor = 'coldmail-send-guard') {
    let existingState = { entries: [], recipientEntries: [] };
    try {
      existingState = await loadColdmailSendGuardState();
    } catch (error) {
      logger.warn('[ColdmailSendGuard][merge-load]', error && error.message ? error.message : error);
    }
    const entries = pruneColdmailSendGuardEntries([
      ...(existingState.entries || []),
      ...((sendGuardState && sendGuardState.entries) || []),
    ]).slice(-1000);
    const recipientEntries = pruneColdmailRecipientGuardEntries([
      ...(existingState.recipientEntries || []),
      ...((sendGuardState && sendGuardState.recipientEntries) || []),
      ...((sendGuardState && sendGuardState.entries) || []),
    ]).slice(-2000);
    await setUiStateValues(
      coldmailSendGuardScope,
      {
        [coldmailSendGuardKey]: JSON.stringify({ entries, recipientEntries }),
      },
      {
        source: 'coldmail-send-guard',
        actor,
      }
    );
  }

  async function getColdmailSendQuota(senderEmail) {
    const selectedSenderEmail = normalizeEmailAddress(senderEmail);
    const state = await loadColdmailSendGuardState();
    const entries = state.entries;
    const currentDayKey = getColdmailAutopilotDateKey(now(), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE);
    const dayEntries = entries.filter((entry) =>
      getColdmailAutopilotDateKey(new Date(parseTimestampMs(entry.at)), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE) === currentDayKey
    );
    const nowMs = now().getTime();
    const senderRollingSent = entries
      .filter((entry) => entry.senderEmail === selectedSenderEmail)
      .reduce((sum, entry) => sum + entry.count, 0);
    const packageRollingSent = entries.reduce((sum, entry) => sum + entry.count, 0);
    const personalMailboxRollingSent = entries.reduce((sum, entry) => sum + entry.personalCount, 0);
    const senderDaySent = dayEntries
      .filter((entry) => entry.senderEmail === selectedSenderEmail)
      .reduce((sum, entry) => sum + entry.count, 0);
    const packageDaySent = dayEntries.reduce((sum, entry) => sum + entry.count, 0);
    const personalMailboxDaySent = dayEntries.reduce((sum, entry) => sum + entry.personalCount, 0);
    const safetyPause = entries
      .map((entry) => ({
        senderEmail: normalizeEmailAddress(entry.senderEmail),
        until: normalizeString(entry.safetyPauseUntil),
        reason: normalizeString(entry.safetyPauseReason),
        untilMs: parseTimestampMs(entry.safetyPauseUntil),
      }))
      .filter((entry) => {
        if (entry.untilMs <= nowMs) return false;
        return !entry.senderEmail || !selectedSenderEmail || entry.senderEmail === selectedSenderEmail;
      })
      .sort((left, right) => right.untilMs - left.untilMs)[0] || null;
    const dailySendLimit = getColdmailDailySendLimit();
    const packageDailySendLimit = getColdmailPackageDailySendLimit();
    const personalMailboxDailyLimit = getColdmailPersonalMailboxDailyLimit();
    const senderDayRemaining = Math.max(0, dailySendLimit - senderDaySent);
    const packageDayRemaining = Math.max(0, packageDailySendLimit - packageDaySent);
    const personalMailboxDayRemaining = Math.max(0, personalMailboxDailyLimit - personalMailboxDaySent);
    const senderRollingRemaining = Math.max(0, dailySendLimit - senderRollingSent);
    const packageRollingRemaining = Math.max(0, packageDailySendLimit - packageRollingSent);
    const personalMailboxRollingRemaining = Math.max(0, personalMailboxDailyLimit - personalMailboxRollingSent);
    return {
      entries,
      recipientEntries: state.recipientEntries || [],
      senderSent: senderRollingSent,
      packageSent: packageRollingSent,
      personalMailboxSent: personalMailboxRollingSent,
      senderDaySent,
      packageDaySent,
      personalMailboxDaySent,
      dailySendLimit,
      packageDailySendLimit,
      personalMailboxDailyLimit,
      senderRemaining: senderDayRemaining,
      packageRemaining: packageDayRemaining,
      personalMailboxRemaining: personalMailboxDayRemaining,
      senderDayRemaining,
      senderRollingRemaining,
      packageDayRemaining,
      packageRollingRemaining,
      personalMailboxDayRemaining,
      personalMailboxRollingRemaining,
      safetyPause,
    };
  }

  function summarizeColdmailSendGuardLiveStats(entries) {
    const currentNow = now();
    const currentMs = currentNow.getTime();
    const last24hCutoffMs = currentMs - COLDMAIL_SEND_GUARD_WINDOW_MS;
    const currentDayKey = getColdmailAutopilotDateKey(currentNow, DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE);
    const perSenderToday = {};
    const recipientCounts = {};
    const todayRecipientCounts = {};
    const seen = new Set();
    let totalSent = 0;
    let sentToday = 0;
    let sentLast24h = 0;
    let personalMailboxSentToday = 0;
    let lastSuccessfulSendAt = '';
    let lastSenderEmail = '';

    (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && Number(entry.count || 0) > 0)
      .forEach((entry) => {
        const key = buildColdmailEntryCountKey(entry);
        if (seen.has(key)) return;
        seen.add(key);
        const count = Math.max(0, Number(entry.count || 0) || 0);
        const personalCount = Math.max(0, Number(entry.personalCount || 0) || 0);
        const entryMs = parseTimestampMs(entry.at);
        if (!entryMs) return;
        if (entryMs > currentMs) return;
        totalSent += count;
        if (entryMs >= last24hCutoffMs && entryMs <= currentMs) sentLast24h += count;
        if (!lastSuccessfulSendAt || entryMs > parseTimestampMs(lastSuccessfulSendAt)) {
          lastSuccessfulSendAt = normalizeString(entry.at);
          lastSenderEmail = normalizeEmailAddress(entry.senderEmail);
        }
        const recipientKey = buildColdmailStatsRecipientKey({
          recipientEmail: entry.recipientEmail,
          recipientDomain: entry.recipientDomain,
          recipientId: entry.recipientId,
          recipientCompanyKey: entry.recipientCompanyKey || entry.recipientCompany,
        });
        addColdmailRecipientCount(recipientCounts, recipientKey, count);
        if (getColdmailAutopilotDateKey(new Date(entryMs), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE) !== currentDayKey) {
          return;
        }
        const senderEmail = normalizeEmailAddress(entry.senderEmail) || 'unknown';
        sentToday += count;
        addColdmailRecipientCount(todayRecipientCounts, recipientKey, count);
        personalMailboxSentToday += personalCount;
        perSenderToday[senderEmail] = (perSenderToday[senderEmail] || 0) + count;
      });

    return {
      sentToday,
      totalSent,
      sentLast24h,
      personalMailboxSentToday,
      perSenderToday,
      lastSuccessfulSendAt,
      lastSenderEmail,
      recipientCounts,
      todayRecipientCounts,
      unkeyedTotalSent: 0,
    };
  }

  function normalizeColdmailLiveBounceType(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'hard' || normalized === 'soft' || normalized === 'instantly') return normalized;
    return 'unknown';
  }

  function normalizeColdmailLiveBounceTypeFromText(value) {
    const text = normalizeString(value).toLowerCase();
    if (!/bounce|bounced/.test(text)) return '';
    if (/\bhard[_\s-]*bounce\b|\bhard\b/.test(text)) return 'hard';
    if (/\bsoft[_\s-]*bounce\b|\bsoft\b/.test(text)) return 'soft';
    if (/\binstantly\b/.test(text)) return 'instantly';
    return 'unknown';
  }

  function getColdmailLiveBounceHistoryEntry(row) {
    return (Array.isArray(row && row.hist) ? row.hist : []).find((entry) => {
      const text = normalizeString(
        [
          entry && entry.type,
          entry && entry.status,
          entry && entry.label,
          entry && entry.title,
          entry && entry.message,
          entry && entry.description,
          entry && entry.note,
          entry && entry.source,
          entry && entry.actor,
        ].join(' ')
      );
      return Boolean(normalizeColdmailLiveBounceTypeFromText(text));
    }) || null;
  }

  function getColdmailLiveBounceSignal(row) {
    if (!row || typeof row !== 'object') return null;
    const historyEntry = getColdmailLiveBounceHistoryEntry(row);
    const providerStatus = normalizeInstantlyColdmailStatus(
      row.instantlyStatus ||
        row.lastColdmailProviderStatus ||
        row.providerStatus ||
        row.outreachProviderStatus
    );
    const explicitAt = normalizeString(row.coldmailBounceAt || row.lastColdmailBounceAt || row.bouncedAt);
    const explicitType = normalizeColdmailLiveBounceType(row.coldmailBounceType || row.lastColdmailBounceType);
    const historyText = historyEntry
      ? [
          historyEntry.type,
          historyEntry.status,
          historyEntry.label,
          historyEntry.title,
          historyEntry.message,
          historyEntry.description,
          historyEntry.note,
          historyEntry.source,
          historyEntry.actor,
        ].join(' ')
      : '';
    const historyType = normalizeColdmailLiveBounceTypeFromText(historyText);
    const providerType = providerStatus === 'bounced' ? 'instantly' : '';
    const hasSignal = Boolean(
      explicitAt ||
        normalizeString(row.coldmailBounceType || row.lastColdmailBounceType) ||
        providerType ||
        historyType
    );
    if (!hasSignal) return null;
    return {
      type: explicitType !== 'unknown' ? explicitType : providerType || historyType || explicitType,
      at: normalizeString(
        explicitAt ||
          row.instantlyLastEventAt ||
          row.instantlyUpdatedAt ||
          row.lastColdmailProviderUpdatedAt ||
          row.lastColdmailReplyAt ||
          (historyEntry && (historyEntry.at || historyEntry.date || historyEntry.createdAt || historyEntry.updatedAt)) ||
          row.updatedAt ||
          row.updated_at
      ),
    };
  }

  function summarizeColdmailDatabaseLiveStats(rows) {
    let databaseTotalSent = 0;
    let webdesignTotalSent = 0;
    let webdesignSentToday = 0;
    let interestedTotal = 0;
    let activeCampaignTotal = 0;
    let lastDatabaseSentAt = '';
    let bounces = 0;
    let bouncesToday = 0;
    const recipientCounts = {};
    const webdesignRecipientCounts = {};
    const webdesignTodayRecipientCounts = {};
    const bounceRecipientKeys = new Set();
    const bounceTodayRecipientKeys = new Set();
    const bounceTypes = {
      hard: 0,
      soft: 0,
      instantly: 0,
      unknown: 0,
    };
    const bounceTypesToday = {
      hard: 0,
      soft: 0,
      instantly: 0,
      unknown: 0,
    };
    const bounceItems = [];
    const bounceItemsToday = [];
    let unkeyedTotalSent = 0;
    let webdesignUnkeyedTotalSent = 0;
    const currentDayKey = getColdmailAutopilotDateKey(now(), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE);

    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const sentCount = getSoftoraSystemMailSentCountForRow(row);
      const recipientKey = buildColdmailStatsRecipientKey({
        recipientEmail: getRowEmail(row),
        recipientDomain: getRowDomain(row),
        recipientId: getExplicitRowId(row),
        recipientCompanyKey: getRowCompany(row),
      });
      if (sentCount) {
        databaseTotalSent += sentCount;
        if (!addColdmailRecipientCount(recipientCounts, recipientKey, sentCount)) {
          unkeyedTotalSent += sentCount;
        }
      }
      const sentAt = getColdmailSentAt(row);
      if (sentAt && (!lastDatabaseSentAt || parseTimestampMs(sentAt) > parseTimestampMs(lastDatabaseSentAt))) {
        lastDatabaseSentAt = sentAt;
      }
      if (!isTestRecipientRow(row, getRowEmail(row)) && isWebdesignOutreachRow(row) && sentAt) {
        const webdesignCount = 1;
        const sentAtMs = parseTimestampMs(sentAt);
        webdesignTotalSent += webdesignCount;
        if (
          sentAtMs &&
          getColdmailAutopilotDateKey(new Date(sentAtMs), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE) === currentDayKey
        ) {
          webdesignSentToday += webdesignCount;
          setColdmailRecipientCount(webdesignTodayRecipientCounts, recipientKey, webdesignCount);
        }
        if (!setColdmailRecipientCount(webdesignRecipientCounts, recipientKey, webdesignCount)) {
          webdesignUnkeyedTotalSent += webdesignCount;
        }
      }
      const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
      if (['interesse', 'afspraak', 'klant'].includes(status)) interestedTotal += 1;
      if (isRowInActiveColdmailCampaign(row)) activeCampaignTotal += 1;

      const bounceSignal = getColdmailLiveBounceSignal(row);
      const bounceAt = normalizeString(bounceSignal && bounceSignal.at);
      const bounceAtMs = parseTimestampMs(bounceAt);
      if (bounceSignal && !isTestRecipientRow(row, getRowEmail(row))) {
        const bounceKey = recipientKey || `row:${index}`;
        const bounceType = normalizeColdmailLiveBounceType(bounceSignal.type);
        const bounceItem = {
          company: truncateText(getRowCompany(row), 120),
          email: getRowEmail(row),
          type: bounceType,
          at: bounceAt,
        };
        if (!bounceRecipientKeys.has(bounceKey)) {
          bounceRecipientKeys.add(bounceKey);
          bounces += 1;
          bounceTypes[bounceType] = (bounceTypes[bounceType] || 0) + 1;
          bounceItems.push(bounceItem);
        }
        if (
          bounceAtMs &&
          getColdmailAutopilotDateKey(new Date(bounceAtMs), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE) === currentDayKey &&
          !bounceTodayRecipientKeys.has(bounceKey)
        ) {
          bounceTodayRecipientKeys.add(bounceKey);
          bouncesToday += 1;
          bounceTypesToday[bounceType] = (bounceTypesToday[bounceType] || 0) + 1;
          bounceItemsToday.push(bounceItem);
        }
      }
    });

    return {
      databaseTotalSent,
      webdesignTotalSent: mergeColdmailRecipientCountTotals({
        recipientCounts: webdesignRecipientCounts,
        unkeyedTotalSent: webdesignUnkeyedTotalSent,
      }),
      webdesignDatabaseRowsTotalSent: webdesignTotalSent,
      webdesignSentToday,
      webdesignTodayRecipientCounts,
      interestedTotal,
      activeCampaignTotal,
      lastDatabaseSentAt,
      bounces,
      totalBounces: bounces,
      bounceTypes,
      bounceItems: bounceItems
        .sort((left, right) => parseTimestampMs(right.at) - parseTimestampMs(left.at))
        .slice(0, 12),
      bouncesToday,
      bounceTypesToday,
      bounceItemsToday: bounceItemsToday
        .sort((left, right) => parseTimestampMs(right.at) - parseTimestampMs(left.at))
        .slice(0, 12),
      recipientCounts,
      unkeyedTotalSent,
    };
  }

  function buildColdmailMailboxBounceText(message = {}) {
    const payload = message && typeof message.payload === 'object' ? message.payload : {};
    return [
      normalizeString(message.subject),
      normalizeString(message.sender_email || message.senderEmail),
      normalizeString(message.sender_name || message.senderName),
      normalizeString(message.preview),
      normalizeString(message.body_text || message.bodyText || message.body),
      normalizeString(payload.subject),
      normalizeString(payload.preview),
      normalizeString(payload.body_text || payload.bodyText || payload.body),
    ].join('\n');
  }

  function isColdmailMailboxBounceMessage(message = {}) {
    const subject = normalizeString(message.subject);
    const text = buildColdmailMailboxBounceText(message);
    const fromText = normalizeString(
      `${message.sender_email || message.senderEmail || ''} ${message.sender_name || message.senderName || ''}`
    );
    const providerLike = /\b(mailer-daemon|postmaster|mail delivery|delivery subsystem)\b/i.test(fromText);
    const deliveryFailure =
      COLDMAIL_DELIVERY_FAILURE_PATTERN.test(subject) ||
      COLDMAIL_DELIVERY_FAILURE_PATTERN.test(text) ||
      COLDMAIL_HARD_BOUNCE_PATTERN.test(text) ||
      COLDMAIL_SOFT_BOUNCE_PATTERN.test(text);
    return Boolean(deliveryFailure && (providerLike || COLDMAIL_DELIVERY_FAILURE_PATTERN.test(subject) || COLDMAIL_DELIVERY_FAILURE_PATTERN.test(text)));
  }

  function getColdmailMailboxBounceType(message = {}) {
    const text = buildColdmailMailboxBounceText(message);
    if (COLDMAIL_HARD_BOUNCE_PATTERN.test(text)) return 'hard';
    if (COLDMAIL_SOFT_BOUNCE_PATTERN.test(text)) return 'soft';
    return 'unknown';
  }

  function getColdmailMailboxMessageDate(message = {}) {
    const payload = message && typeof message.payload === 'object' ? message.payload : {};
    return normalizeString(
      message.date ||
        message.internal_date ||
        message.internalDate ||
        message.created_at ||
        message.updated_at ||
        payload.date ||
        payload.internal_date ||
        payload.internalDate
    );
  }

  function buildColdmailMailboxBounceKey(message = {}, index = 0) {
    return normalizeMailboxMessageKey(
      message.message_key ||
        message.messageKey ||
        message.message_id ||
        message.messageId ||
        `${message.account_email || message.accountEmail || 'mailbox'}:${message.folder || 'inbox'}:${message.uid || index}`
    ) || `mailbox-bounce:${index}`;
  }

  function summarizeColdmailMailboxBounceStats(messages) {
    const bounceKeys = new Set();
    const bounceTodayKeys = new Set();
    const bounceTypes = {
      hard: 0,
      soft: 0,
      instantly: 0,
      unknown: 0,
    };
    const bounceTypesToday = {
      hard: 0,
      soft: 0,
      instantly: 0,
      unknown: 0,
    };
    const bounceItems = [];
    const bounceItemsToday = [];
    const currentDayKey = getColdmailAutopilotDateKey(now(), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE);

    (Array.isArray(messages) ? messages : []).forEach((message, index) => {
      if (!message || typeof message !== 'object') return;
      if (normalizeString(message.deleted_at || message.deletedAt)) return;
      const folder = normalizeString(message.folder).toLowerCase();
      if (folder && folder !== 'inbox') return;
      if (!isColdmailMailboxBounceMessage(message)) return;

      const bounceKey = buildColdmailMailboxBounceKey(message, index);
      const bounceType = getColdmailMailboxBounceType(message);
      const at = getColdmailMailboxMessageDate(message);
      const bounceAtMs = parseTimestampMs(at);
      const bounceItem = {
        company: '',
        email: normalizeEmailAddress(message.sender_email || message.senderEmail),
        accountEmail: normalizeEmailAddress(message.account_email || message.accountEmail),
        subject: truncateText(normalizeString(message.subject), 120),
        type: bounceType,
        at,
      };

      if (!bounceKeys.has(bounceKey)) {
        bounceKeys.add(bounceKey);
        bounceTypes[bounceType] = (bounceTypes[bounceType] || 0) + 1;
        bounceItems.push(bounceItem);
      }
      if (
        bounceAtMs &&
        getColdmailAutopilotDateKey(new Date(bounceAtMs), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE) === currentDayKey &&
        !bounceTodayKeys.has(bounceKey)
      ) {
        bounceTodayKeys.add(bounceKey);
        bounceTypesToday[bounceType] = (bounceTypesToday[bounceType] || 0) + 1;
        bounceItemsToday.push(bounceItem);
      }
    });

    return {
      available: true,
      bounces: bounceKeys.size,
      totalBounces: bounceKeys.size,
      bounceTypes,
      bounceItems: bounceItems
        .sort((left, right) => parseTimestampMs(right.at) - parseTimestampMs(left.at))
        .slice(0, 12),
      bouncesToday: bounceTodayKeys.size,
      bounceTypesToday,
      bounceItemsToday: bounceItemsToday
        .sort((left, right) => parseTimestampMs(right.at) - parseTimestampMs(left.at))
        .slice(0, 12),
    };
  }

  function chooseColdmailLiveBounceStats(databaseStats, mailboxStats) {
    const safeMailboxStats = mailboxStats && mailboxStats.available ? mailboxStats : null;
    const totalSource = safeMailboxStats && safeMailboxStats.totalBounces > databaseStats.totalBounces
      ? safeMailboxStats
      : databaseStats;
    const todaySource = safeMailboxStats && safeMailboxStats.bouncesToday > databaseStats.bouncesToday
      ? safeMailboxStats
      : databaseStats;
    const source = totalSource === safeMailboxStats || todaySource === safeMailboxStats
      ? 'mailbox-index'
      : 'database';
    return {
      source,
      bounces: Math.max(databaseStats.bounces, safeMailboxStats ? safeMailboxStats.bounces : 0),
      totalBounces: Math.max(databaseStats.totalBounces, safeMailboxStats ? safeMailboxStats.totalBounces : 0),
      bounceTypes: totalSource.bounceTypes,
      bounceItems: totalSource.bounceItems,
      bouncesToday: Math.max(databaseStats.bouncesToday, safeMailboxStats ? safeMailboxStats.bouncesToday : 0),
      bounceTypesToday: todaySource.bounceTypesToday,
      bounceItemsToday: todaySource.bounceItemsToday,
      mailboxBounces: safeMailboxStats ? safeMailboxStats.totalBounces : null,
      mailboxBouncesToday: safeMailboxStats ? safeMailboxStats.bouncesToday : null,
      mailboxBounceStatsAvailable: Boolean(safeMailboxStats),
      mailboxBounceStatsUnavailableReason: safeMailboxStats ? '' : normalizeString(mailboxStats && mailboxStats.unavailableReason),
    };
  }

  function isSoftoraColdmailCentralGuardGroup(group) {
    const provider = normalizeString(group && group.provider).toLowerCase();
    const channel = normalizeString(group && group.channel).toLowerCase();
    if (provider && provider !== 'softora') return false;
    if (channel && channel !== 'coldmail') return false;
    return true;
  }

  function summarizeColdmailCentralGuardLiveStats(groups, options = {}) {
    const recipientCounts = {};
    const todayRecipientCounts = {};
    const timezone =
      normalizeString(options.timezone || options.timeZone) ||
      DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE;
    const todayKey = getColdmailAutopilotDateKey(now(), timezone);
    let lastSentAt = '';
    let lastSenderEmail = '';

    (Array.isArray(groups) ? groups : []).forEach((group) => {
      if (!isSoftoraColdmailCentralGuardGroup(group)) return;
      const source = normalizeString(group && group.source).toLowerCase();
      const actor = normalizeString(group && group.actor).toLowerCase();
      if (
        source === 'data-ops-customers-sent-guard' ||
        source === 'coldmail-invalid-email-domain' ||
        actor === 'coldmail-invalid-email-domain'
      ) {
        return;
      }
      const senderEmail = normalizeEmailAddress(group.sender_email || group.senderEmail);
      if (!senderEmail) return;
      const recipientKey = buildColdmailStatsRecipientKey({
        recipientEmail: group.recipient_email || group.recipientEmail,
        recipientDomain: group.recipient_domain || group.recipientDomain,
        recipientId: group.recipient_id || group.recipientId,
        recipientCompanyKey: group.recipient_company_key || group.recipientCompanyKey || group.recipient_company || group.recipientCompany,
      });
      setColdmailRecipientCount(recipientCounts, recipientKey, 1);

      const sentAt = normalizeString(
        group.updated_at || group.updatedAt || group.last_seen_at || group.lastSeenAt || group.created_at || group.createdAt
      );
      const sentAtMs = parseTimestampMs(sentAt);
      if (sentAtMs && (!lastSentAt || sentAtMs > parseTimestampMs(lastSentAt))) {
        lastSentAt = sentAt;
        lastSenderEmail = senderEmail;
      }
      if (
        sentAtMs &&
        getColdmailAutopilotDateKey(new Date(sentAtMs), timezone) === todayKey
      ) {
        setColdmailRecipientCount(todayRecipientCounts, recipientKey, 1);
      }
    });

    return {
      available: true,
      recipientCounts,
      todayRecipientCounts,
      unkeyedTotalSent: 0,
      lastSentAt,
      lastSenderEmail,
    };
  }

  async function loadColdmailCentralGuardStats() {
    if (!outboundRecipientGuardStore || typeof outboundRecipientGuardStore.listSentRecipientGroups !== 'function') {
      return {
        ...summarizeColdmailCentralGuardLiveStats([]),
        available: false,
        unavailableReason: 'central_guard_store_unavailable',
      };
    }
    try {
      const groups = await outboundRecipientGuardStore.listSentRecipientGroups({
        provider: 'softora',
        channel: 'coldmail',
        keyType: 'email',
        maxRows: 5_000,
      });
      return summarizeColdmailCentralGuardLiveStats(groups);
    } catch (error) {
      logger.warn('[ColdmailLiveStats][central-guard]', error && error.message ? error.message : error);
      return {
        ...summarizeColdmailCentralGuardLiveStats([]),
        available: false,
        unavailableReason: 'central_guard_read_failed',
      };
    }
  }

  async function loadColdmailMailboxBounceStats() {
    if (!dataOpsStore || typeof dataOpsStore.listMailboxMessages !== 'function') {
      return {
        ...summarizeColdmailMailboxBounceStats([]),
        available: false,
        unavailableReason: 'data_ops_mailbox_store_unavailable',
      };
    }
    try {
      const configuredSenderEmails = getConfiguredSenderEmails();
      const accountEmails = configuredSenderEmails.length ? configuredSenderEmails : getAllowedSenderEmails();
      const messages = await dataOpsStore.listMailboxMessages({
        accountEmails,
        folders: ['inbox'],
        maxRows: 1000,
        bounceCandidatesOnly: true,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressTransientReadFailureLog: true,
      });
      if (!Array.isArray(messages)) {
        return {
          ...summarizeColdmailMailboxBounceStats([]),
          available: false,
          unavailableReason: 'mailbox_bounce_read_failed',
        };
      }
      return summarizeColdmailMailboxBounceStats(messages);
    } catch (error) {
      logger.warn('[ColdmailLiveStats][mailbox-bounces]', error && error.message ? error.message : error);
      return {
        ...summarizeColdmailMailboxBounceStats([]),
        available: false,
        unavailableReason: 'mailbox_bounce_read_failed',
      };
    }
  }

  async function loadFreshColdmailLiveStats() {
    const [sendGuardState, customerState, centralGuardStats, mailboxBounceStats] = await Promise.all([
      loadColdmailSendGuardState(),
      getUiStateValues(customerDbScope),
      loadColdmailCentralGuardStats(),
      loadColdmailMailboxBounceStats(),
    ]);
    const values = customerState && typeof customerState.values === 'object' ? customerState.values : {};
    const rows = parseDatabaseRows(values);
    const guardStats = summarizeColdmailSendGuardLiveStats(sendGuardState.entries);
    const databaseStats = summarizeColdmailDatabaseLiveStats(rows);
    const bounceStats = chooseColdmailLiveBounceStats(databaseStats, mailboxBounceStats);
    const centralGuardAvailable = Boolean(centralGuardStats.available);
    const centralGuardTotalSent = centralGuardAvailable
      ? mergeColdmailRecipientCountTotals(centralGuardStats)
      : null;
    const centralGuardSentToday = centralGuardAvailable
      ? mergeColdmailRecipientCountTotals({
          recipientCounts: centralGuardStats.todayRecipientCounts,
          unkeyedTotalSent: 0,
        })
      : null;
    const legacySendGuardTotalSent = guardStats.totalSent;
    const legacyMergedTotalSent = mergeColdmailRecipientCountTotals(centralGuardStats, guardStats, databaseStats);
    const legacyKeyedSystemSentToday = mergeColdmailRecipientCountTotals(
      {
        recipientCounts: guardStats.todayRecipientCounts,
        unkeyedTotalSent: 0,
      },
      {
        recipientCounts: databaseStats.webdesignTodayRecipientCounts,
        unkeyedTotalSent: 0,
      }
    );
    const legacySystemSentToday = Math.max(
      guardStats.sentToday,
      databaseStats.webdesignSentToday,
      legacyKeyedSystemSentToday
    );
    const systemTotalSent = centralGuardAvailable ? centralGuardTotalSent : null;
    const systemSentToday = centralGuardAvailable ? centralGuardSentToday : null;
    const lastSuccessfulSendAt = centralGuardStats.lastSentAt || guardStats.lastSuccessfulSendAt || databaseStats.lastDatabaseSentAt;
    const conversionRate = databaseStats.databaseTotalSent > 0
      ? Math.round((databaseStats.interestedTotal / databaseStats.databaseTotalSent) * 100)
      : 0;

    return {
      ok: true,
      stats: {
        timezone: DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
        dateKey: getColdmailAutopilotDateKey(now(), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE),
        source: centralGuardAvailable ? 'central-outbound-recipient-guard' : 'central-outbound-recipient-guard-unavailable',
        authoritativeSource: 'central-outbound-recipient-guard',
        reliable: centralGuardAvailable,
        sentToday: systemSentToday,
        systemSentToday,
        centralGuardSentToday,
        sentLast24h: guardStats.sentLast24h,
        personalMailboxSentToday: guardStats.personalMailboxSentToday,
        databaseTotalSent: databaseStats.databaseTotalSent,
        centralGuardTotalSent,
        systemTotalSent,
        totalSent: systemTotalSent,
        webdesignTotalSent: systemTotalSent,
        webdesignSentToday: systemSentToday,
        webdesignGuardSentToday: guardStats.sentToday,
        webdesignDatabaseRowsSentToday: databaseStats.webdesignSentToday,
        webdesignDatabaseRowsTotalSent: databaseStats.webdesignDatabaseRowsTotalSent,
        legacySendGuardTotalSent,
        legacyMergedTotalSent,
        legacySystemSentToday,
        centralGuardUnavailableReason: centralGuardStats.unavailableReason || '',
        activeCampaignTotal: databaseStats.activeCampaignTotal,
        interestedTotal: databaseStats.interestedTotal,
        bounces: bounceStats.bounces,
        totalBounces: bounceStats.totalBounces,
        bounceStatsSource: bounceStats.source,
        databaseBounces: databaseStats.totalBounces,
        databaseBouncesToday: databaseStats.bouncesToday,
        mailboxBounces: bounceStats.mailboxBounces,
        mailboxBouncesToday: bounceStats.mailboxBouncesToday,
        mailboxBounceStatsAvailable: bounceStats.mailboxBounceStatsAvailable,
        mailboxBounceStatsUnavailableReason: bounceStats.mailboxBounceStatsUnavailableReason,
        bounceTypes: bounceStats.bounceTypes,
        bounceItems: bounceStats.bounceItems,
        bouncesToday: bounceStats.bouncesToday,
        todayBounces: bounceStats.bouncesToday,
        bounceTypesToday: bounceStats.bounceTypesToday,
        bounceItemsToday: bounceStats.bounceItemsToday,
        conversionRate,
        lastSuccessfulSendAt,
        lastSenderEmail: centralGuardStats.lastSenderEmail || guardStats.lastSenderEmail,
        updatedAt: now().toISOString(),
      },
    };
  }

  function parseColdmailLiveStatsCache(rawValue) {
    try {
      const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue || '{}') : rawValue;
      if (!parsed || typeof parsed !== 'object' || parsed.ok !== true || !parsed.stats || typeof parsed.stats !== 'object') return null;
      const updatedAtMs = Date.parse(normalizeString(parsed.stats.updatedAt));
      const expectedDateKey = getColdmailAutopilotDateKey(now(), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE);
      if (!updatedAtMs || normalizeString(parsed.stats.dateKey) !== expectedDateKey) return null;
      if (now().getTime() - updatedAtMs > COLDMAIL_LIVE_STATS_DURABLE_TTL_MS) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  async function readDurableColdmailLiveStats() {
    try {
      const state = await getUiStateValues(DEFAULT_COLDMAIL_STATS_CACHE_SCOPE, {
        uiStateReadTimeoutMs: 900,
        suppressTransientReadFailureLog: true,
        suppressReadFailureCooldown: true,
        suppressReadFailureLog: true,
        readFailureCooldownScope: DEFAULT_COLDMAIL_STATS_CACHE_SCOPE,
      });
      const values = state && state.values && typeof state.values === 'object' ? state.values : {};
      return parseColdmailLiveStatsCache(values[DEFAULT_COLDMAIL_STATS_CACHE_KEY]);
    } catch (error) {
      logger.warn('[ColdmailLiveStats][durable-read]', error && error.message ? error.message : error);
      return null;
    }
  }

  async function persistDurableColdmailLiveStats(payload) {
    try {
      await setUiStateValues(
        DEFAULT_COLDMAIL_STATS_CACHE_SCOPE,
        { [DEFAULT_COLDMAIL_STATS_CACHE_KEY]: JSON.stringify(payload) },
        { source: 'coldmail-live-stats-cache', actor: 'Coldmail statistieken' }
      );
      return true;
    } catch (error) {
      logger.warn('[ColdmailLiveStats][durable-write]', error && error.message ? error.message : error);
      return false;
    }
  }

  function hasReliableColdmailLiveTotals(payload) {
    const stats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
    const expectedDateKey = getColdmailAutopilotDateKey(now(), DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE);
    return stats.reliable === true &&
      normalizeString(stats.dateKey) === expectedDateKey &&
      Number.isFinite(Number(stats.systemTotalSent ?? stats.totalSent));
  }

  function preserveReliableColdmailLiveStats(payload, previousPayload) {
    if (!hasReliableColdmailLiveTotals(previousPayload)) return payload;
    const stats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
    const previous = previousPayload.stats;
    const mergedStats = { ...stats };
    let changed = false;
    if (!hasReliableColdmailLiveTotals(payload)) {
      [
        'sentToday',
        'systemSentToday',
        'centralGuardSentToday',
        'systemTotalSent',
        'centralGuardTotalSent',
        'totalSent',
        'webdesignTotalSent',
        'webdesignSentToday',
        'lastSuccessfulSendAt',
        'lastSenderEmail',
      ].forEach((field) => {
        mergedStats[field] = previous[field];
      });
      mergedStats.reliable = true;
      mergedStats.source = previous.source;
      mergedStats.authoritativeSource = previous.authoritativeSource;
      mergedStats.authoritativeStatsStale = true;
      mergedStats.authoritativeStatsUpdatedAt = previous.authoritativeStatsUpdatedAt || previous.updatedAt || '';
      changed = true;
    }
    if (stats.mailboxBounceStatsAvailable === false && previous.mailboxBounceStatsAvailable !== false) {
      [
        'bounces',
        'totalBounces',
        'bounceStatsSource',
        'mailboxBounces',
        'mailboxBouncesToday',
        'mailboxBounceStatsAvailable',
        'mailboxBounceStatsUnavailableReason',
        'bounceTypes',
        'bounceItems',
        'bouncesToday',
        'todayBounces',
        'bounceTypesToday',
        'bounceItemsToday',
      ].forEach((field) => {
        mergedStats[field] = previous[field];
      });
      changed = true;
    }
    return changed ? { ...payload, stats: mergedStats } : payload;
  }

  function refreshColdmailLiveStats() {
    if (!coldmailLiveStatsPromise) {
      coldmailLiveStatsPromise = loadFreshColdmailLiveStats()
        .then(async (payload) => {
          const stablePayload = preserveReliableColdmailLiveStats(
            payload,
            coldmailLiveStatsCache && coldmailLiveStatsCache.payload
          );
          coldmailLiveStatsCache = { cachedAtMs: now().getTime(), payload: stablePayload };
          await persistDurableColdmailLiveStats(stablePayload);
          return stablePayload;
        })
        .finally(() => {
          coldmailLiveStatsPromise = null;
        });
    }
    return coldmailLiveStatsPromise;
  }

  async function getColdmailLiveStats() {
    const cachedAtMs = Number(coldmailLiveStatsCache && coldmailLiveStatsCache.cachedAtMs) || 0;
    const cacheAgeMs = cachedAtMs ? now().getTime() - cachedAtMs : Number.POSITIVE_INFINITY;
    if (coldmailLiveStatsCache && cacheAgeMs < COLDMAIL_LIVE_STATS_MEMORY_TTL_MS) {
      return coldmailLiveStatsCache.payload;
    }
    if (coldmailLiveStatsCache) {
      refreshColdmailLiveStats().catch((error) => {
        logger.warn('[ColdmailLiveStats][refresh]', error && error.message ? error.message : error);
      });
      return coldmailLiveStatsCache.payload;
    }
    if (!coldmailLiveStatsDurableReadPromise) {
      coldmailLiveStatsDurableReadPromise = readDurableColdmailLiveStats().finally(() => {
        coldmailLiveStatsDurableReadPromise = null;
      });
    }
    const durablePayload = await coldmailLiveStatsDurableReadPromise;
    if (durablePayload) {
      coldmailLiveStatsCache = {
        cachedAtMs: Date.parse(normalizeString(durablePayload.stats && durablePayload.stats.updatedAt)) || now().getTime(),
        payload: durablePayload,
      };
      refreshColdmailLiveStats().catch((error) => {
        logger.warn('[ColdmailLiveStats][refresh]', error && error.message ? error.message : error);
      });
      return durablePayload;
    }
    return refreshColdmailLiveStats();
  }

  function summarizeColdmailSenderQuota(quota = {}) {
    return {
      senderSent: Math.max(0, Number(quota.senderSent) || 0),
      senderDaySent: Math.max(0, Number(quota.senderDaySent ?? quota.senderSent) || 0),
      senderRemaining: Math.max(0, Number(quota.senderRemaining) || 0),
      packageRemaining: Math.max(0, Number(quota.packageRemaining) || 0),
      dailySendLimit: Math.max(0, Number(quota.dailySendLimit) || 0),
      packageDailySendLimit: Math.max(0, Number(quota.packageDailySendLimit) || 0),
    };
  }

  function summarizeColdmailAutopilotDailyQuota(quota = {}) {
    if (!quota || typeof quota !== 'object') return undefined;
    const safetyPause = quota.safetyPause && typeof quota.safetyPause === 'object' ? quota.safetyPause : null;
    const summary = {
      senderSentBefore: Math.max(0, Number(quota.senderSentBefore ?? quota.senderSent) || 0),
      packageSentBefore: Math.max(0, Number(quota.packageSentBefore ?? quota.packageSent) || 0),
      personalMailboxSentBefore: Math.max(0, Number(quota.personalMailboxSentBefore ?? quota.personalMailboxSent) || 0),
      senderDaySentBefore: Math.max(0, Number(quota.senderDaySentBefore ?? quota.senderDaySent ?? quota.senderSent) || 0),
      packageDaySentBefore: Math.max(0, Number(quota.packageDaySentBefore ?? quota.packageDaySent ?? quota.packageSent) || 0),
      personalMailboxDaySentBefore: Math.max(0, Number(quota.personalMailboxDaySentBefore ?? quota.personalMailboxDaySent ?? quota.personalMailboxSent) || 0),
      senderRemainingBefore: Math.max(0, Number(quota.senderRemainingBefore ?? quota.senderRemaining) || 0),
      packageRemainingBefore: Math.max(0, Number(quota.packageRemainingBefore ?? quota.packageRemaining) || 0),
      personalMailboxRemainingBefore: Math.max(0, Number(quota.personalMailboxRemainingBefore ?? quota.personalMailboxRemaining) || 0),
      senderRollingRemainingBefore: Math.max(0, Number(quota.senderRollingRemainingBefore ?? quota.senderRollingRemaining) || 0),
      packageRollingRemainingBefore: Math.max(0, Number(quota.packageRollingRemainingBefore ?? quota.packageRollingRemaining) || 0),
      personalMailboxRollingRemainingBefore: Math.max(0, Number(quota.personalMailboxRollingRemainingBefore ?? quota.personalMailboxRollingRemaining) || 0),
      safetyPausedUntil: normalizeString(quota.safetyPausedUntil || (safetyPause && safetyPause.until)),
      safetyPauseReason: truncateText(normalizeString(quota.safetyPauseReason || (safetyPause && safetyPause.reason)), 160),
    };
    Object.keys(summary).forEach((key) => {
      if (summary[key] === '' || summary[key] === undefined || summary[key] === null) delete summary[key];
    });
    return summary;
  }

  function sanitizeColdmailAutopilotSmtpDiagnostic(value) {
    if (!value || typeof value !== 'object') return undefined;
    const sanitizeBooleanMap = (input = {}) => Object.fromEntries(
      Object.entries(input && typeof input === 'object' ? input : {})
        .filter(([, raw]) => typeof raw === 'boolean')
        .map(([key, raw]) => [key, Boolean(raw)])
    );
    const runtimeEnv = {};
    Object.entries(value.runtimeEnv && typeof value.runtimeEnv === 'object' ? value.runtimeEnv : {})
      .slice(0, 4)
      .forEach(([group, flags]) => {
        runtimeEnv[group] = {
          key: truncateText(normalizeString(flags && flags.key), 80),
          ...sanitizeBooleanMap(flags),
        };
      });
    return {
      resolved: sanitizeBooleanMap(value.resolved),
      mailboxAccount: sanitizeBooleanMap(value.mailboxAccount),
      mailboxAccountsRawConfigured: Boolean(value.mailboxAccountsRawConfigured),
      runtimeEnv,
      reason: truncateText(normalizeString(value.reason), 160),
    };
  }

  function getColdmailSenderQuotaDaySent(quota = {}) {
    return Math.max(0, Number(quota.senderDaySent ?? quota.senderSent) || 0);
  }

  function buildColdmailSenderSkip(senderEmail, reason, extra = {}) {
    const quotaSummary = extra.quota ? summarizeColdmailSenderQuota(extra.quota) : null;
    const skip = {
      senderEmail: normalizeEmailAddress(senderEmail),
      reason,
      ...extra,
    };
    if (quotaSummary) {
      skip.quota = quotaSummary;
      skip.senderSent = quotaSummary.senderSent;
      skip.senderDaySent = quotaSummary.senderDaySent;
      skip.senderRemaining = quotaSummary.senderRemaining;
      skip.packageRemaining = quotaSummary.packageRemaining;
    }
    return skip;
  }

  function buildColdmailEntryCountKey(entry) {
    const identity = [
      normalizeString(entry && entry.at),
      normalizeEmailAddress(entry && entry.senderEmail),
      normalizeEmailAddress(entry && entry.recipientEmail),
      normalizeColdmailGuardKeyPart(entry && entry.recipientDomain),
      normalizeColdmailGuardKeyPart(entry && entry.recipientCompanyKey),
      normalizeColdmailGuardKeyPart(entry && entry.recipientId),
      Math.max(0, Number(entry && entry.count) || 0),
      Math.max(0, Number(entry && entry.personalCount) || 0),
    ].join('|');
    return identity;
  }

  function buildColdmailStatsRecipientKey(parts = {}) {
    const email = normalizeEmailAddress(parts.recipientEmail || parts.email);
    if (email) return `email:${email}`;
    const domain = normalizeColdmailGuardKeyPart(parts.recipientDomain || parts.domain);
    if (domain) return `domain:${domain}`;
    const id = normalizeColdmailGuardKeyPart(parts.recipientId || parts.id);
    if (id) return `id:${id}`;
    const company = normalizeColdmailGuardKeyPart(parts.recipientCompanyKey || parts.company);
    return company ? `company:${company}` : '';
  }

  function addColdmailRecipientCount(target, recipientKey, count) {
    const safeCount = Math.max(0, Number(count) || 0);
    if (!recipientKey || !safeCount) return 0;
    target[recipientKey] = (target[recipientKey] || 0) + safeCount;
    return safeCount;
  }

  function setColdmailRecipientCount(target, recipientKey, count) {
    const safeCount = Math.max(0, Number(count) || 0);
    if (!recipientKey || !safeCount) return 0;
    target[recipientKey] = Math.max(Math.max(0, Number(target[recipientKey]) || 0), safeCount);
    return target[recipientKey];
  }

  function mergeColdmailRecipientCountTotals(...statsList) {
    const keys = new Set();
    let unkeyedTotal = 0;
    statsList.forEach((stats) => {
      Object.keys((stats && stats.recipientCounts) || {}).forEach((key) => keys.add(key));
      unkeyedTotal += Math.max(0, Number(stats && stats.unkeyedTotalSent) || 0);
    });
    const keyedTotal = Array.from(keys).reduce((total, key) => {
      const strongest = statsList.reduce((max, stats) => {
        const value = Math.max(0, Number(stats && stats.recipientCounts && stats.recipientCounts[key]) || 0);
        return Math.max(max, value);
      }, 0);
      return total + strongest;
    }, 0);
    return keyedTotal + unkeyedTotal;
  }

  function summarizeColdmailTodaySendStats(sendGuardState, config = {}, schedule = {}) {
    const timezone =
      normalizeString(schedule && (schedule.timezone || schedule.timeZone)) ||
      DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE;
    const todayKey = getColdmailAutopilotDateKey(now(), timezone);
    const dailySendLimit = getColdmailDailySendLimit();
    const packageDailySendLimit = getColdmailPackageDailySendLimit();
    const normalizedConfig = normalizeColdmailAutopilotConfig(config);
    const targetMinimum = Math.min(packageDailySendLimit, normalizedConfig.dailyTargetMinimum);
    const configuredSenders = normalizedConfig.senderEmails.filter(isColdmailAutopilotAllowedSenderEmail);
    const senderStats = new Map();
    configuredSenders.forEach((email) => {
      senderStats.set(email, {
        email,
        sent: 0,
        limit: dailySendLimit,
        remaining: dailySendLimit,
        lastSentAt: '',
        lastRecipientEmail: '',
        lastRecipientCompany: '',
      });
    });

    const seen = new Set();
    let total = 0;
    (Array.isArray(sendGuardState && sendGuardState.entries) ? sendGuardState.entries : [])
      .filter((entry) => entry && Math.max(0, Number(entry.count || 0) || 0) > 0)
      .forEach((entry) => {
        const at = normalizeString(entry.at);
        if (!at || getColdmailAutopilotDateKey(new Date(at), timezone) !== todayKey) return;
        const key = buildColdmailEntryCountKey(entry);
        if (seen.has(key)) return;
        seen.add(key);
        const senderEmail = normalizeEmailAddress(entry.senderEmail);
        const count = Math.max(0, Number(entry.count || 0) || 0);
        total += count;
        if (!senderStats.has(senderEmail)) {
          senderStats.set(senderEmail, {
            email: senderEmail,
            sent: 0,
            limit: dailySendLimit,
            remaining: dailySendLimit,
            lastSentAt: '',
            lastRecipientEmail: '',
            lastRecipientCompany: '',
          });
        }
        const stat = senderStats.get(senderEmail);
        stat.sent += count;
        stat.remaining = Math.max(0, dailySendLimit - stat.sent);
        if (parseTimestampMs(at) >= parseTimestampMs(stat.lastSentAt)) {
          stat.lastSentAt = at;
          stat.lastRecipientEmail = normalizeEmailAddress(entry.recipientEmail);
          stat.lastRecipientCompany = truncateText(normalizeString(entry.recipientCompany), 120);
        }
      });

    return {
      ok: true,
      timezone,
      dateKey: todayKey,
      updatedAt: now().toISOString(),
      total,
      limit: packageDailySendLimit,
      remaining: Math.max(0, packageDailySendLimit - total),
      targetMinimum,
      targetRemaining: Math.max(0, targetMinimum - total),
      targetMet: total >= targetMinimum,
      senders: Array.from(senderStats.values())
        .filter((item) => item.email)
        .sort((left, right) => {
          const leftIndex = configuredSenders.indexOf(left.email);
          const rightIndex = configuredSenders.indexOf(right.email);
          if (leftIndex !== -1 || rightIndex !== -1) {
            return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
          }
          return left.email.localeCompare(right.email);
        }),
    };
  }

  function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const text = normalizeString(value).toLowerCase();
    if (['1', 'true', 'yes', 'ja', 'aan', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'nee', 'uit', 'off'].includes(text)) return false;
    return Boolean(fallback);
  }

  function normalizeColdmailAutopilotSenderEmails(value) {
    const raw = Array.isArray(value)
      ? value
      : normalizeString(value)
        ? normalizeString(value).split(/[\s,;]+/g)
        : [];
    const seen = new Set();
    return raw
      .map(normalizeEmailAddress)
      .filter((email) => {
        if (!isLikelyValidEmail(email) || seen.has(email)) return false;
        seen.add(email);
        return true;
      })
      .slice(0, COLDMAIL_AUTOPILOT_MAX_SENDER_EMAILS);
  }

  function isColdmailAutopilotAllowedSenderEmail(value) {
    return COLDMAIL_AUTOPILOT_ALLOWED_SENDER_EMAILS.has(normalizeEmailAddress(value));
  }

  function normalizeColdmailAutopilotSenderProfiles(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const profiles = {};
    Object.keys(raw).forEach((email) => {
      const normalizedEmail = normalizeEmailAddress(email);
      if (!isColdmailAutopilotAllowedSenderEmail(normalizedEmail)) return;
      const profile = normalizeColdmailingSenderProfile(raw[email]);
      if (!profile.subject || !profile.body) return;
      profiles[normalizedEmail] = profile;
    });
    return profiles;
  }

  function normalizeColdmailTemplateVariants(value, fallback = '', maxLength = 6000) {
    const rawList = Array.isArray(value)
      ? value
      : String(value || '')
          .split(/\n-{3,}\n/g)
          .filter(Boolean);
    const normalized = [];
    const seen = new Set();
    [fallback, ...rawList].forEach((item) => {
      const text = truncateText(normalizeString(item), maxLength);
      const key = text.replace(/\s+/g, ' ').toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      normalized.push(text);
    });
    return normalized.slice(0, 12);
  }

  function normalizeColdmailAutopilotRadiusKm(value) {
    if (normalizeString(value) === '') return '';
    return parseRadiusKm(value);
  }

  function normalizeColdmailWebdesignImageDeliveryOverride(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (
      normalized === 'attachment' ||
      normalized === 'cid' ||
      normalized === 'remote' ||
      normalized === 'link'
    ) {
      return normalized;
    }
    return '';
  }

  function normalizeColdmailAutopilotConfig(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const senderEmails = normalizeColdmailAutopilotSenderEmails(
      Object.prototype.hasOwnProperty.call(raw, 'senderEmails')
        ? raw.senderEmails
        : raw.senderEmail
    ).filter(isColdmailAutopilotAllowedSenderEmail);
    const rawSenderEmail = normalizeEmailAddress(raw.senderEmail);
    const senderEmail = isColdmailAutopilotAllowedSenderEmail(rawSenderEmail)
      ? rawSenderEmail
      : senderEmails[0] || '';
    if (senderEmail && !senderEmails.includes(senderEmail)) senderEmails.unshift(senderEmail);
    return {
      count: parsePositiveInt(
        raw.count || raw.batchSize || raw.batch,
        DEFAULT_COLDMAIL_AUTOPILOT_BATCH_SIZE,
        1,
        Math.min(10, getColdmailCampaignSendLimit())
      ),
      senderEmail: senderEmail || senderEmails[0] || '',
      senderEmails,
      senderProfiles: normalizeColdmailAutopilotSenderProfiles(raw.senderProfiles || raw.senders),
      subject: truncateText(normalizeString(raw.subject), 200),
      body: normalizeString(raw.body),
      aiInstructions: normalizeString(raw.aiInstructions),
      toneStyle: normalizeString(raw.toneStyle) || 'Vriendelijk & professioneel',
      branch: normalizeString(raw.branch || raw.branche),
      service: normalizeString(raw.service),
      database: normalizeString(raw.database),
      specialAction: normalizeString(raw.specialAction),
      durationDays: parsePositiveInt(raw.durationDays, 14, 1, 90),
      radiusKm: normalizeColdmailAutopilotRadiusKm(raw.radiusKm),
      dailyTargetMinimum: parsePositiveInt(
        raw.dailyTargetMinimum ?? raw.dailyTarget ?? raw.targetDailySends ?? raw.minimumDailySends,
        DEFAULT_COLDMAIL_AUTOPILOT_DAILY_TARGET_MINIMUM,
        1,
        getColdmailPackageDailySendLimit()
      ),
      webdesignImageDelivery: normalizeColdmailWebdesignImageDeliveryOverride(
        raw.webdesignImageDelivery || raw.imageDelivery
      ),
    };
  }

  function normalizeColdmailAutopilotSchedule(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const hasSenderMinInterval =
      Object.prototype.hasOwnProperty.call(raw, 'senderMinIntervalMinutes') ||
      Object.prototype.hasOwnProperty.call(raw, 'senderCooldownMinutes') ||
      Object.prototype.hasOwnProperty.call(raw, 'mailboxIntervalMinutes');
    const hasSendJitterMin =
      Object.prototype.hasOwnProperty.call(raw, 'sendJitterMinSeconds') ||
      Object.prototype.hasOwnProperty.call(raw, 'preSendJitterMinSeconds');
    const hasSendJitterMax =
      Object.prototype.hasOwnProperty.call(raw, 'sendJitterMaxSeconds') ||
      Object.prototype.hasOwnProperty.call(raw, 'preSendJitterMaxSeconds');
    const startHour = parsePositiveInt(
      raw.startHour ?? raw.safeStartHour,
      DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR,
      0,
      23
    );
    const startMinute = parsePositiveInt(
      raw.startMinute ?? raw.safeStartMinute,
      0,
      0,
      59
    );
    const endHour = parsePositiveInt(
      raw.endHour ?? raw.safeEndHour,
      DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR,
      1,
      24
    );
    const rawEndMinute = parsePositiveInt(
      raw.endMinute ?? raw.safeEndMinute,
      0,
      0,
      59
    );
    const endMinute = endHour >= 24 ? 0 : rawEndMinute;
    const senderMinIntervalMinutesRaw = parsePositiveInt(
      raw.senderMinIntervalMinutes ?? raw.senderCooldownMinutes ?? raw.mailboxIntervalMinutes,
      DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES,
      0,
      240
    );
    const senderMaxIntervalMinutesRaw = parsePositiveInt(
      raw.senderMaxIntervalMinutes ?? raw.senderCooldownMaxMinutes ?? raw.mailboxMaxIntervalMinutes,
      hasSenderMinInterval
        ? senderMinIntervalMinutesRaw
        : Math.max(senderMinIntervalMinutesRaw, DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES),
      senderMinIntervalMinutesRaw,
      240
    );
    const sendJitterMinSeconds = parsePositiveInt(
      raw.sendJitterMinSeconds ?? raw.preSendJitterMinSeconds,
      DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MIN_SECONDS,
      0,
      300
    );
    const sendJitterMaxSeconds = parsePositiveInt(
      raw.sendJitterMaxSeconds ?? raw.preSendJitterMaxSeconds,
      hasSendJitterMin && !hasSendJitterMax
        ? sendJitterMinSeconds
        : Math.max(sendJitterMinSeconds, DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MAX_SECONDS),
      sendJitterMinSeconds,
      300
    );
    const minIntervalMinutes = parsePositiveInt(
      raw.minIntervalMinutes,
      DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES,
      5,
      240
    );
    const isLegacyWorkdayPace =
      startHour === DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR &&
      startMinute === 0 &&
      endHour === DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR &&
      endMinute === 0 &&
      minIntervalMinutes === DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES &&
      senderMinIntervalMinutesRaw === 70 &&
      senderMaxIntervalMinutesRaw === 82;
    const senderMinIntervalMinutes = isLegacyWorkdayPace
      ? DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES
      : senderMinIntervalMinutesRaw;
    const senderMaxIntervalMinutes = isLegacyWorkdayPace
      ? DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES
      : senderMaxIntervalMinutesRaw;
    return {
      timezone: normalizeString(raw.timezone || raw.timeZone) || DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
      weekdaysOnly: normalizeBooleanFlag(
        Object.prototype.hasOwnProperty.call(raw, 'weekdaysOnly') ? raw.weekdaysOnly : true,
        true
      ),
      startHour,
      startMinute,
      ...normalizeColdmailAutopilotScheduleEnd({ startHour, startMinute, endHour, endMinute }),
      minIntervalMinutes,
      senderMinIntervalMinutes,
      senderMaxIntervalMinutes,
      sendJitterMinSeconds,
      sendJitterMaxSeconds,
    };
  }

  function normalizeColdmailAutopilotScheduleEnd(value = {}) {
    const startMinuteOfDay =
      Math.max(0, Math.min(23, Number(value.startHour) || 0)) * 60 +
      Math.max(0, Math.min(59, Number(value.startMinute) || 0));
    let endMinuteOfDay =
      Math.max(1, Math.min(24, Number(value.endHour) || DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR)) * 60 +
      Math.max(0, Math.min(59, Number(value.endMinute) || 0));
    if (endMinuteOfDay > 24 * 60) endMinuteOfDay = 24 * 60;
    if (endMinuteOfDay <= startMinuteOfDay) {
      endMinuteOfDay = Math.min(24 * 60, startMinuteOfDay + 60);
    }
    return {
      endHour: Math.floor(endMinuteOfDay / 60),
      endMinute: endMinuteOfDay % 60,
    };
  }

  function getColdmailAutopilotScheduleStartMinuteOfDay(schedule) {
    const normalized = normalizeColdmailAutopilotSchedule(schedule);
    return normalized.startHour * 60 + normalized.startMinute;
  }

  function getColdmailAutopilotScheduleEndMinuteOfDay(schedule) {
    const normalized = normalizeColdmailAutopilotSchedule(schedule);
    return normalized.endHour * 60 + normalized.endMinute;
  }

  function formatColdmailAutopilotScheduleTime(hour, minute = 0) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function hasColdmailAutopilotUsableSenderConfig(value) {
    const config = normalizeColdmailAutopilotConfig(value);
    if (!config.senderEmails.length) return false;
    if (config.subject && config.body) return true;
    return config.senderEmails.some((email) => {
      const profile = config.senderProfiles && config.senderProfiles[email];
      return Boolean(profile && profile.subject && profile.body);
    });
  }

  function getColdmailAutopilotScheduleScore(value) {
    const schedule = normalizeColdmailAutopilotSchedule(value);
    let score = 0;
    if (schedule.timezone === DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE) score += 1;
    if (schedule.weekdaysOnly) score += 1;
    if (schedule.startHour <= DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR) score += 1;
    if (getColdmailAutopilotScheduleEndMinuteOfDay(schedule) >= DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR * 60) {
      score += 1;
    }
    if (schedule.minIntervalMinutes >= DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES) score += 1;
    if (schedule.senderMinIntervalMinutes >= DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES) score += 1;
    if (schedule.senderMaxIntervalMinutes >= DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES) score += 1;
    if (schedule.sendJitterMinSeconds >= DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MIN_SECONDS) score += 1;
    if (schedule.sendJitterMaxSeconds >= DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MAX_SECONDS) score += 1;
    return score;
  }

  function isLegacyColdmailAutopilotDashboardSchedule(value) {
    const schedule = normalizeColdmailAutopilotSchedule(value);
    return schedule.startHour === 8 &&
      schedule.startMinute === 0 &&
      schedule.endHour === 17 &&
      schedule.endMinute === 0 &&
      schedule.minIntervalMinutes === 5 &&
      schedule.senderMinIntervalMinutes === 14 &&
      schedule.senderMaxIntervalMinutes === 18 &&
      schedule.sendJitterMinSeconds === 5 &&
      schedule.sendJitterMaxSeconds === 45;
  }

  function pickColdmailAutopilotConfig(primary, fallback) {
    if (hasColdmailAutopilotUsableSenderConfig(primary)) {
      return normalizeColdmailAutopilotConfig(primary);
    }
    return normalizeColdmailAutopilotConfig(fallback);
  }

  function pickColdmailAutopilotSchedule(primary, fallback) {
    if (!primary || typeof primary !== 'object' || isLegacyColdmailAutopilotDashboardSchedule(primary)) {
      return normalizeColdmailAutopilotSchedule(fallback);
    }
    if (
      fallback &&
      typeof fallback === 'object' &&
      getColdmailAutopilotScheduleScore(fallback) > getColdmailAutopilotScheduleScore(primary)
    ) {
      return normalizeColdmailAutopilotSchedule(fallback);
    }
    return normalizeColdmailAutopilotSchedule(primary);
  }

  function getEnvColdmailAutopilotConfig() {
    return normalizeColdmailAutopilotConfig({
      count: env.COLDMAIL_AUTOPILOT_BATCH_SIZE || env.COLDMAIL_AUTOPILOT_COUNT,
      senderEmails: env.COLDMAIL_AUTOPILOT_SENDER_EMAILS || env.COLDMAIL_AUTOPILOT_SENDER_EMAIL,
      senderEmail: env.COLDMAIL_AUTOPILOT_SENDER_EMAIL,
      subject: env.COLDMAIL_AUTOPILOT_SUBJECT,
      body: env.COLDMAIL_AUTOPILOT_BODY,
      aiInstructions: env.COLDMAIL_AUTOPILOT_AI_INSTRUCTIONS,
      toneStyle: env.COLDMAIL_AUTOPILOT_TONE_STYLE,
      branch: env.COLDMAIL_AUTOPILOT_BRANCH,
      service: env.COLDMAIL_AUTOPILOT_SERVICE,
      database: env.COLDMAIL_AUTOPILOT_DATABASE,
      specialAction: env.COLDMAIL_AUTOPILOT_SPECIAL_ACTION,
      durationDays: env.COLDMAIL_AUTOPILOT_DURATION_DAYS,
      radiusKm: env.COLDMAIL_AUTOPILOT_RADIUS_KM,
    });
  }

  function getDefaultColdmailAutopilotState() {
    return {
      version: 1,
      enabled: normalizeBooleanFlag(env.COLDMAIL_AUTOPILOT_ENABLED, false),
      config: getEnvColdmailAutopilotConfig(),
      schedule: normalizeColdmailAutopilotSchedule({
        timezone: env.COLDMAIL_AUTOPILOT_TIMEZONE,
        weekdaysOnly: env.COLDMAIL_AUTOPILOT_WEEKDAYS_ONLY,
        startHour: env.COLDMAIL_AUTOPILOT_START_HOUR,
        startMinute: env.COLDMAIL_AUTOPILOT_START_MINUTE,
        endHour: env.COLDMAIL_AUTOPILOT_END_HOUR,
        endMinute: env.COLDMAIL_AUTOPILOT_END_MINUTE,
        minIntervalMinutes: env.COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES,
        senderMinIntervalMinutes:
          env.COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES ||
          env.COLDMAIL_AUTOPILOT_SENDER_COOLDOWN_MINUTES,
        senderMaxIntervalMinutes:
          env.COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES ||
          env.COLDMAIL_AUTOPILOT_SENDER_COOLDOWN_MAX_MINUTES,
        sendJitterMinSeconds:
          env.COLDMAIL_AUTOPILOT_SEND_JITTER_MIN_SECONDS ||
          env.COLDMAIL_AUTOPILOT_PRE_SEND_JITTER_MIN_SECONDS,
        sendJitterMaxSeconds:
          env.COLDMAIL_AUTOPILOT_SEND_JITTER_MAX_SECONDS ||
          env.COLDMAIL_AUTOPILOT_PRE_SEND_JITTER_MAX_SECONDS,
      }),
      lastRunAt: '',
      lastStartedAt: '',
      lastResult: null,
      lock: null,
      log: [],
      updatedAt: '',
      updatedBy: '',
      emergencyStoppedAt: '',
      emergencyStopReason: '',
    };
  }

  function normalizeColdmailAutopilotLog(entries) {
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        at: normalizeString(entry.at),
        ok: entry.ok !== false,
        skipped: Boolean(entry.skipped),
        reason: truncateText(normalizeString(entry.reason), 120),
        message: truncateText(normalizeString(entry.message), 240),
        sent: Math.max(0, Number(entry.sent || 0) || 0),
        senderEmail: normalizeEmailAddress(entry.senderEmail),
      }))
      .filter((entry) => entry.at)
      .slice(-30);
  }

  function findJsonObjectKeyValueStart(rawText, key) {
    const marker = `"${key}"`;
    const keyIndex = rawText.indexOf(marker);
    if (keyIndex < 0) return -1;
    const colonIndex = rawText.indexOf(':', keyIndex + marker.length);
    if (colonIndex < 0) return -1;
    for (let index = colonIndex + 1; index < rawText.length; index += 1) {
      if (!/\s/.test(rawText[index])) return index;
    }
    return -1;
  }

  function extractBalancedJsonValue(rawText, startIndex) {
    const opening = rawText[startIndex];
    const closing = opening === '{' ? '}' : opening === '[' ? ']' : '';
    if (!closing) return '';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = startIndex; index < rawText.length; index += 1) {
      const char = rawText[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === opening) depth += 1;
      if (char === closing) {
        depth -= 1;
        if (depth === 0) return rawText.slice(startIndex, index + 1);
      }
    }
    return '';
  }

  function extractJsonObjectFieldFromPossiblyTruncatedText(rawText, key) {
    const startIndex = findJsonObjectKeyValueStart(rawText, key);
    if (startIndex < 0) return null;
    const valueText = extractBalancedJsonValue(rawText, startIndex);
    if (!valueText) return null;
    return safeJsonParse(valueText, null);
  }

  function extractJsonStringFieldFromPossiblyTruncatedText(rawText, key) {
    const startIndex = findJsonObjectKeyValueStart(rawText, key);
    if (startIndex < 0 || rawText[startIndex] !== '"') return '';
    let escaped = false;
    for (let index = startIndex + 1; index < rawText.length; index += 1) {
      const char = rawText[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        return safeJsonParse(rawText.slice(startIndex, index + 1), '');
      }
    }
    return '';
  }

  function parseColdmailAutopilotStateValue(rawValue) {
    const rawText = normalizeString(rawValue);
    if (!rawText) return {};
    const parsed = safeJsonParse(rawText, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    const recovered = {};
    const enabledMatch = rawText.match(/"enabled"\s*:\s*(true|false)/);
    if (enabledMatch) recovered.enabled = enabledMatch[1] === 'true';
    const versionMatch = rawText.match(/"version"\s*:\s*([0-9]+)/);
    if (versionMatch) recovered.version = Math.max(1, Number(versionMatch[1]) || 1);
    ['config', 'schedule', 'lock', 'lastResult'].forEach((key) => {
      const value = extractJsonObjectFieldFromPossiblyTruncatedText(rawText, key);
      if (value && typeof value === 'object' && !Array.isArray(value)) recovered[key] = value;
    });
    const log = extractJsonObjectFieldFromPossiblyTruncatedText(rawText, 'log');
    if (Array.isArray(log)) recovered.log = log;
    [
      'lastRunAt',
      'lastStartedAt',
      'updatedAt',
      'updatedBy',
      'emergencyStoppedAt',
      'emergencyStopReason',
    ].forEach((key) => {
      const value = extractJsonStringFieldFromPossiblyTruncatedText(rawText, key);
      if (value) recovered[key] = value;
    });
    return recovered;
  }

  function normalizeColdmailAutopilotState(value) {
    const defaults = getDefaultColdmailAutopilotState();
    const raw = value && typeof value === 'object' ? value : {};
    const rawConfig = raw.config && typeof raw.config === 'object' ? raw.config : {};
    const rawSchedule = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};
    const hasRawSenderMinInterval =
      Object.prototype.hasOwnProperty.call(rawSchedule, 'senderMinIntervalMinutes') ||
      Object.prototype.hasOwnProperty.call(rawSchedule, 'senderCooldownMinutes') ||
      Object.prototype.hasOwnProperty.call(rawSchedule, 'mailboxIntervalMinutes');
    const hasRawSenderMaxInterval =
      Object.prototype.hasOwnProperty.call(rawSchedule, 'senderMaxIntervalMinutes') ||
      Object.prototype.hasOwnProperty.call(rawSchedule, 'senderCooldownMaxMinutes') ||
      Object.prototype.hasOwnProperty.call(rawSchedule, 'mailboxMaxIntervalMinutes');
    const mergedSchedule = { ...defaults.schedule, ...rawSchedule };
    if (hasRawSenderMinInterval && !hasRawSenderMaxInterval) {
      delete mergedSchedule.senderMaxIntervalMinutes;
      delete mergedSchedule.senderCooldownMaxMinutes;
      delete mergedSchedule.mailboxMaxIntervalMinutes;
    }
    return {
      version: 1,
      enabled: normalizeBooleanFlag(
        Object.prototype.hasOwnProperty.call(raw, 'enabled') ? raw.enabled : defaults.enabled,
        defaults.enabled
      ),
      config: normalizeColdmailAutopilotConfig({ ...defaults.config, ...rawConfig }),
      schedule: normalizeColdmailAutopilotSchedule(mergedSchedule),
      lastRunAt: normalizeString(raw.lastRunAt),
      lastStartedAt: normalizeString(raw.lastStartedAt),
      lastResult: raw.lastResult && typeof raw.lastResult === 'object' ? compactColdmailAutopilotResult(raw.lastResult) : null,
      lock: raw.lock && typeof raw.lock === 'object'
        ? {
            startedAt: normalizeString(raw.lock.startedAt),
            expiresAt: normalizeString(raw.lock.expiresAt),
            actor: truncateText(normalizeString(raw.lock.actor), 120),
          }
        : null,
      log: normalizeColdmailAutopilotLog(raw.log),
      updatedAt: normalizeString(raw.updatedAt),
      updatedBy: truncateText(normalizeString(raw.updatedBy), 120),
      emergencyStoppedAt: normalizeString(raw.emergencyStoppedAt),
      emergencyStopReason: truncateText(normalizeString(raw.emergencyStopReason), 240),
    };
  }

  async function loadColdmailAutopilotStateRecord() {
    const state = await getUiStateValues(coldmailAutopilotScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rawValue = values[coldmailAutopilotKey];
    const hasValue = Object.prototype.hasOwnProperty.call(values, coldmailAutopilotKey) &&
      Boolean(normalizeString(rawValue));
    const parsedValue = parseColdmailAutopilotStateValue(rawValue || '{}');
    return {
      state: normalizeColdmailAutopilotState(parsedValue),
      hasValue,
      source: normalizeString(state && state.source),
      updatedAt: normalizeString(state && state.updatedAt),
    };
  }

  async function loadColdmailAutopilotState() {
    const record = await loadColdmailAutopilotStateRecord();
    return record.state;
  }

  function hasColdmailAutopilotTrustedToggleMarker(state = {}) {
    return Boolean(parseTimestampMs(state.updatedAt) && normalizeString(state.updatedBy));
  }

  function isColdmailAutopilotTrustedDisabledState(state = {}) {
    const normalized = normalizeColdmailAutopilotState(state);
    if (normalized.enabled !== false) return false;
    if (parseTimestampMs(normalized.emergencyStoppedAt) && normalizeString(normalized.emergencyStopReason)) {
      return true;
    }
    return hasColdmailAutopilotTrustedToggleMarker(normalized);
  }

  function buildColdmailAutopilotUntrustedDisabledResult() {
    return buildColdmailAutopilotSkipResult(
      'state_unavailable',
      'Autopilot-state is onbetrouwbaar: er staat enabled=false zonder geldige knop-actie. Er is niets verzonden en niets overschreven.'
    );
  }

  function trimColdmailAutopilotProfilesForStorage(config = {}) {
    const normalized = normalizeColdmailAutopilotConfig(config);
    const senderProfiles = {};
    Object.entries(normalized.senderProfiles || {}).forEach(([email, profile]) => {
      senderProfiles[email] = {
        ...profile,
        subject: truncateText(normalizeString(profile && profile.subject), 220),
        body: truncateText(normalizeString(profile && profile.body), 8000),
        aiInstructions: truncateText(normalizeString(profile && profile.aiInstructions), 3000),
      };
    });
    return {
      ...normalized,
      subject: truncateText(normalized.subject, 220),
      body: truncateText(normalized.body, 8000),
      aiInstructions: truncateText(normalized.aiInstructions, 3000),
      senderProfiles,
    };
  }

  function buildColdmailAutopilotStateStoragePayload(state) {
    let normalized = normalizeColdmailAutopilotState(state);
    let payload = JSON.stringify(normalized);
    if (payload.length <= COLDMAIL_AUTOPILOT_STATE_VALUE_SOFT_LIMIT) {
      return { normalized, payload };
    }

    normalized = {
      ...normalized,
      lastResult: normalized.lastResult ? compactColdmailAutopilotResult(normalized.lastResult) : null,
      log: normalizeColdmailAutopilotLog(normalized.log).slice(-10),
    };
    payload = JSON.stringify(normalized);
    if (payload.length <= COLDMAIL_AUTOPILOT_STATE_VALUE_SOFT_LIMIT) {
      return { normalized, payload };
    }

    normalized = {
      ...normalized,
      log: [],
      lastResult: normalized.lastResult
        ? {
            ok: normalized.lastResult.ok !== false,
            skipped: Boolean(normalized.lastResult.skipped),
            reason: truncateText(normalizeString(normalized.lastResult.reason), 120),
            message: truncateText(normalizeString(normalized.lastResult.message), 240),
            at: normalizeString(normalized.lastResult.at) || now().toISOString(),
            sent: Math.max(0, Number(normalized.lastResult.sent || 0) || 0),
            failed: Math.max(0, Number(normalized.lastResult.failed || 0) || 0),
            senderEmail: normalizeEmailAddress(normalized.lastResult.senderEmail),
          }
        : null,
    };
    payload = JSON.stringify(normalized);
    if (payload.length <= COLDMAIL_AUTOPILOT_STATE_VALUE_SOFT_LIMIT) {
      return { normalized, payload };
    }

    normalized = {
      ...normalized,
      config: trimColdmailAutopilotProfilesForStorage(normalized.config),
    };
    payload = JSON.stringify(normalized);
    if (payload.length <= COLDMAIL_AUTOPILOT_STATE_VALUE_SOFT_LIMIT) {
      return { normalized, payload };
    }

    normalized = {
      ...normalized,
      lastResult: {
        ok: true,
        skipped: true,
        reason: 'state_compacted',
        message: 'Autopilot-status is veilig compact opgeslagen.',
        at: now().toISOString(),
        sent: 0,
        failed: 0,
      },
      log: [],
    };
    payload = JSON.stringify(normalized);
    return { normalized, payload };
  }

  async function saveColdmailAutopilotState(state, actor = 'coldmail-autopilot') {
    const { normalized, payload } = buildColdmailAutopilotStateStoragePayload(state);
    await setUiStateValues(
      coldmailAutopilotScope,
      {
        [coldmailAutopilotKey]: payload,
      },
      {
        source: 'coldmail-autopilot',
        actor,
      }
    );
    return normalized;
  }

  function summarizeColdmailAutopilotConfig(config) {
    const normalized = normalizeColdmailAutopilotConfig(config);
    return {
      count: normalized.count,
      senderEmail: normalized.senderEmail,
      senderEmails: normalized.senderEmails,
      senderProfilesConfigured: Object.keys(normalized.senderProfiles || {}),
      branch: normalized.branch,
      service: normalized.service,
      database: normalized.database,
      specialAction: normalized.specialAction,
      durationDays: normalized.durationDays,
      radiusKm: normalized.radiusKm,
      dailyTargetMinimum: normalized.dailyTargetMinimum,
      subjectConfigured: Boolean(normalized.subject),
      bodyConfigured: Boolean(normalized.body),
    };
  }

  function summarizeColdmailAutopilotState(state, sendGuardState = null) {
    const normalized = normalizeColdmailAutopilotState(state);
    return {
      version: normalized.version,
      enabled: normalized.enabled,
      config: summarizeColdmailAutopilotConfig(normalized.config),
      schedule: normalized.schedule,
      lastRunAt: normalized.lastRunAt,
      lastStartedAt: normalized.lastStartedAt,
      lastResult: normalized.lastResult,
      lock: normalized.lock,
      log: normalized.log,
      updatedAt: normalized.updatedAt,
      updatedBy: normalized.updatedBy,
      safetyLimits: getColdmailSafetyLimits(),
      todaySends: sendGuardState
        ? summarizeColdmailTodaySendStats(sendGuardState, normalized.config, normalized.schedule)
        : {
            ok: false,
            unavailable: true,
            timezone: normalized.schedule.timezone || DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
            dateKey: getColdmailAutopilotDateKey(now(), normalized.schedule.timezone),
            total: 0,
            limit: getColdmailPackageDailySendLimit(),
            remaining: getColdmailPackageDailySendLimit(),
            targetMinimum: normalized.config.dailyTargetMinimum,
            targetRemaining: normalized.config.dailyTargetMinimum,
            targetMet: false,
            senders: [],
          },
    };
  }

  async function getColdmailAutopilotStatus() {
    const [state, liveStats, sendGuardState] = await Promise.all([
      loadColdmailAutopilotState(),
      getColdmailLiveStats(),
      loadColdmailSendGuardState().catch((error) => {
        logger.warn('[ColdmailAutopilot][today-sends]', error && error.message ? error.message : error);
        return null;
      }),
    ]);
    return {
      ok: true,
      autopilot: {
        ...summarizeColdmailAutopilotState(state, sendGuardState),
        stats: liveStats.stats,
      },
      stats: liveStats.stats,
    };
  }

  async function updateColdmailAutopilotSettings(input = {}, actor = 'Coldmail Autopilot') {
    const stateRecord = await loadColdmailAutopilotStateRecord();
    const state = stateRecord.state;
    const rawConfig = input && input.config && typeof input.config === 'object' ? input.config : {};
    const rawSchedule = input && input.schedule && typeof input.schedule === 'object' ? input.schedule : {};
    const hasExplicitEnabled = Object.prototype.hasOwnProperty.call(input, 'enabled');
    if (!stateRecord.hasValue && !hasExplicitEnabled) {
      const error = new Error('Autopilot-state kon niet veilig worden geladen. Gebruik de knop om hem expliciet aan of uit te zetten.');
      error.code = 'COLDMAIL_AUTOPILOT_STATE_UNAVAILABLE';
      throw error;
    }
    if (stateRecord.hasValue && !state.enabled && !isColdmailAutopilotTrustedDisabledState(state) && !hasExplicitEnabled) {
      const error = new Error('Autopilot-state is onbetrouwbaar. Gebruik de knop om hem expliciet aan of uit te zetten.');
      error.code = 'COLDMAIL_AUTOPILOT_STATE_UNAVAILABLE';
      throw error;
    }
    const fallbackConfig = await loadColdmailAutopilotSenderSettingsConfig().catch(() => state.config);
    const nextSenderEmails = Object.prototype.hasOwnProperty.call(rawConfig, 'senderEmails')
      ? rawConfig.senderEmails
      : Object.prototype.hasOwnProperty.call(rawConfig, 'senderEmail')
        ? rawConfig.senderEmail
        : state.config.senderEmails;
    const requestedEnabled = hasExplicitEnabled
      ? normalizeBooleanFlag(input.enabled, state.enabled)
      : state.enabled;
    const candidateConfig = normalizeColdmailAutopilotConfig({
      ...state.config,
      ...rawConfig,
      senderEmails: nextSenderEmails,
    });
    const baseConfig = pickColdmailAutopilotConfig(state.config, fallbackConfig);
    const candidateSchedule = normalizeColdmailAutopilotSchedule({
      ...state.schedule,
      ...rawSchedule,
    });
    const nextState = {
      ...state,
      enabled: requestedEnabled,
      config: pickColdmailAutopilotConfig(candidateConfig, baseConfig),
      schedule: pickColdmailAutopilotSchedule(candidateSchedule, state.schedule),
      updatedAt: now().toISOString(),
      updatedBy: truncateText(normalizeString(actor), 120),
    };
    if (!nextState.enabled) {
      nextState.lock = null;
      nextState.lastResult = {
        ok: true,
        skipped: true,
        reason: 'disabled',
        message: 'Coldmail autopilot staat uit.',
        at: now().toISOString(),
      };
    }
    const saved = await saveColdmailAutopilotState(nextState, actor);
    const sendGuardState = await loadColdmailSendGuardState().catch((error) => {
      logger.warn('[ColdmailAutopilot][today-sends]', error && error.message ? error.message : error);
      return null;
    });
    return {
      ok: true,
      autopilot: summarizeColdmailAutopilotState(saved, sendGuardState),
    };
  }

  function normalizeColdmailingSenderProfile(value, fallback = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const subject = truncateText(normalizeString(raw.subject || base.subject), 200);
    const body = normalizeString(raw.body || base.body);
    return {
      subject,
      body,
      subjectVariants: subject ? [subject] : [],
      bodyVariants: body ? [body] : [],
      aiInstructions: normalizeString(raw.aiInstructions || base.aiInstructions),
      toneStyle: normalizeString(raw.toneStyle || base.toneStyle || 'Vriendelijk & professioneel'),
    };
  }

  async function loadColdmailingSenderSettings() {
    const state = await getUiStateValues(coldmailingSettingsScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const parsed = safeJsonParse(values[coldmailingSettingsKey] || '{}', {});
    const raw = parsed && typeof parsed === 'object' ? parsed : {};
    const senders = {};
    Object.keys(raw.senders && typeof raw.senders === 'object' ? raw.senders : {}).forEach((email) => {
      const normalizedEmail = normalizeEmailAddress(email);
      if (!normalizedEmail) return;
      senders[normalizedEmail] = normalizeColdmailingSenderProfile(raw.senders[email]);
    });
    const senderEmail = normalizeEmailAddress(raw.senderEmail);
    if (!Object.keys(senders).length && senderEmail && (raw.subject || raw.body)) {
      senders[senderEmail] = normalizeColdmailingSenderProfile(raw);
    }
    return {
      senderEmail,
      subject: truncateText(normalizeString(raw.subject), 200),
      body: normalizeString(raw.body),
      aiInstructions: normalizeString(raw.aiInstructions),
      toneStyle: normalizeString(raw.toneStyle) || 'Vriendelijk & professioneel',
      webdesignImageDelivery: normalizeColdmailWebdesignImageDeliveryOverride(
        raw.webdesignImageDelivery || raw.imageDelivery
      ),
      senders,
    };
  }

  async function loadColdmailAutopilotSenderSettingsConfig() {
    const settings = await loadColdmailingSenderSettings();
    const senderEmails = normalizeColdmailAutopilotSenderEmails([
      ...Object.keys(settings.senders || {}),
      settings.senderEmail,
    ]).filter(isColdmailAutopilotAllowedSenderEmail);
    return normalizeColdmailAutopilotConfig({
      senderEmail: senderEmails[0] || settings.senderEmail,
      senderEmails,
      senderProfiles: settings.senders,
      subject: settings.subject,
      body: settings.body,
      aiInstructions: settings.aiInstructions,
      toneStyle: settings.toneStyle,
      webdesignImageDelivery: settings.webdesignImageDelivery,
    });
  }

  function resolveColdmailAutopilotSenderProfile(settings, config, senderEmail) {
    const email = normalizeEmailAddress(senderEmail);
    const fallback = DEFAULT_COLDMAIL_SENDER_PROFILES[email] || DEFAULT_COLDMAIL_SENDER_PROFILES['serve@softora.nl'];
    const snapshots = config && config.senderProfiles && typeof config.senderProfiles === 'object'
      ? config.senderProfiles
      : {};
    const snapshot = snapshots[email] && typeof snapshots[email] === 'object'
      ? snapshots[email]
      : null;
    if (snapshot && snapshot.subject && snapshot.body) {
      return normalizeColdmailingSenderProfile(snapshot, fallback);
    }
    if (
      email === 'servec321@gmail.com' ||
      email === 'martijnven123@gmail.com' ||
      email === 'serve290@gmail.com' ||
      email === 'servecreusen7@gmail.com' ||
      email === 'contact.venvisuals@gmail.com'
    ) {
      return normalizeColdmailingSenderProfile(fallback);
    }
    return {
      subject: '',
      body: '',
      aiInstructions: '',
      toneStyle: normalizeString(config && config.toneStyle) || fallback.toneStyle || 'Vriendelijk & professioneel',
    };
  }

  function getColdmailAutopilotSenderCandidates(state, settings) {
    const explicit = normalizeColdmailAutopilotSenderEmails([
      ...(state.config.senderEmails || []),
      state.config.senderEmail,
    ]).filter(isColdmailAutopilotAllowedSenderEmail);
    if (explicit.length) return explicit;
    return [];
  }

  function getLastColdmailSendAtMsForSender(quota, senderEmail) {
    const selectedSenderEmail = normalizeEmailAddress(senderEmail);
    return (Array.isArray(quota && quota.entries) ? quota.entries : [])
      .filter((entry) => entry.senderEmail === selectedSenderEmail && entry.count > 0)
      .map((entry) => parseTimestampMs(entry.at))
      .filter(Boolean)
      .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);
  }

  function getSenderCooldownMinutes(schedule, senderEmail, lastSentAtMs) {
    const min = Math.max(0, Number(schedule && schedule.senderMinIntervalMinutes) || 0);
    const max = Math.max(min, Number(schedule && schedule.senderMaxIntervalMinutes) || min);
    if (!min || max <= min) return min;
    const range = max - min + 1;
    const seed = crypto
      .createHash('sha256')
      .update(`${normalizeEmailAddress(senderEmail)}:${lastSentAtMs}`)
      .digest()
      .readUInt32BE(0);
    return min + (seed % range);
  }

  function isColdmailAutopilotDaySlotPacingSchedule(schedule) {
    const normalized = normalizeColdmailAutopilotSchedule(schedule);
    return normalized.timezone === DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE &&
      normalized.weekdaysOnly &&
      normalized.startHour === DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR &&
      normalized.startMinute === 0 &&
      getColdmailAutopilotScheduleEndMinuteOfDay(normalized) >= DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR * 60 &&
      normalized.minIntervalMinutes === DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES &&
      normalized.senderMinIntervalMinutes === DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES &&
      normalized.senderMaxIntervalMinutes === DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES;
  }

  function getColdmailAutopilotMinuteOfDay(schedule, date = now()) {
    const parts = getZonedColdmailAutopilotParts(date, normalizeColdmailAutopilotSchedule(schedule).timezone);
    return parts.hour * 60 + parts.minute;
  }

  function getColdmailAutopilotDateKey(date, timezone) {
    const parsed = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(parsed.getTime())) return '';
    const parts = getZonedColdmailAutopilotParts(parsed, timezone || DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE);
    if (!parts.year || !parts.month || !parts.day) return '';
    return [
      String(parts.year).padStart(4, '0'),
      String(parts.month).padStart(2, '0'),
      String(parts.day).padStart(2, '0'),
    ].join('-');
  }

  function getColdmailAutopilotDaySlotReadiness(schedule, senderEmail, lastSentAtMs, options = {}) {
    const normalized = normalizeColdmailAutopilotSchedule(schedule);
    if (!isColdmailAutopilotDaySlotPacingSchedule(normalized)) return null;
    const quota = options.quota && typeof options.quota === 'object' ? options.quota : {};
    const dailyLimit = Math.max(1, Number(quota.dailySendLimit) || DEFAULT_COLDMAIL_DAILY_SEND_LIMIT);
    const senderSent = Math.max(0, Number(quota.senderDaySent ?? quota.senderSent) || 0);
    if (!lastSentAtMs || senderSent <= 0 || senderSent >= dailyLimit || dailyLimit < 2) return null;
    const windowMinutes = Math.max(
      normalized.minIntervalMinutes,
      getColdmailAutopilotScheduleEndMinuteOfDay(normalized) -
        getColdmailAutopilotScheduleStartMinuteOfDay(normalized)
    );
    const senderIndex = Math.max(0, Number(options.senderIndex) || 0);
    const slotIndex = Math.min(senderSent, dailyLimit - 1);
    const finalBufferMinutes = Math.ceil(normalized.sendJitterMaxSeconds / 60) + 1;
    const firstWaveOffsetMinutes = Math.min(
      Math.max(0, windowMinutes - finalBufferMinutes),
      senderIndex * normalized.minIntervalMinutes
    );
    // Keep each mailbox on its own hourly cadence; the global interval is already enforced
    // between cron runs and should not accumulate inside every sender's day slots.
    const slotSpacingMinutes = normalized.senderMinIntervalMinutes;
    const targetMinuteOfDay =
      getColdmailAutopilotScheduleStartMinuteOfDay(normalized) +
      firstWaveOffsetMinutes +
      slotIndex * slotSpacingMinutes;
    const currentMs = now().getTime();
    const currentMinuteOfDay = getColdmailAutopilotMinuteOfDay(normalized, now());
    const targetWaitMinutes = Math.max(0, targetMinuteOfDay - currentMinuteOfDay);
    const targetReadyAtMs = currentMs + targetWaitMinutes * 60 * 1000;
    const floorReadyAtMs = lastSentAtMs + normalized.senderMinIntervalMinutes * 60 * 1000;
    const readyAtMs = Math.max(targetReadyAtMs, floorReadyAtMs);
    if (readyAtMs <= currentMs + COLDMAIL_AUTOPILOT_DAY_SLOT_READY_GRACE_MS) {
      return { ok: true, readyAtMs, cooldownMinutes: 0 };
    }
    return {
      ok: false,
      readyAtMs,
      cooldownMinutes: Math.max(0, Math.ceil((readyAtMs - lastSentAtMs) / (60 * 1000))),
    };
  }

  function getColdmailAutopilotSendJitterSeconds(schedule, senderEmail, startedAt) {
    const min = Math.max(0, Number(schedule && schedule.sendJitterMinSeconds) || 0);
    const max = Math.max(min, Number(schedule && schedule.sendJitterMaxSeconds) || min);
    if (!min || max <= min) return min;
    const range = max - min + 1;
    const seed = crypto
      .createHash('sha256')
      .update(`${normalizeEmailAddress(senderEmail)}:${normalizeString(startedAt)}:autopilot-send-jitter`)
      .digest()
      .readUInt32BE(0);
    return min + (seed % range);
  }

  async function chooseColdmailAutopilotSender(candidates, selectionOptions = {}) {
    const schedule = normalizeColdmailAutopilotSchedule(selectionOptions.schedule);
    const currentMs = now().getTime();
    const senderOptions = [];
    const skipped = [];
    for (const [index, candidate] of candidates.entries()) {
      try {
        const senderEmail = assertSenderAllowed(candidate);
        const quota = await getColdmailSendQuota(senderEmail);
        const senderAccount = resolveSenderSmtpAccount(senderEmail);
        if (!isSenderSmtpAccountConfigured(senderAccount)) {
          skipped.push(buildColdmailSenderSkip(senderEmail, 'sender_smtp_not_configured', {
            index,
            quota,
            smtpDiagnostic: getSenderSmtpDiagnostic(senderEmail, senderAccount),
          }));
          continue;
        }
        const remaining = Math.min(quota.senderRemaining, quota.packageRemaining);
        if (quota.safetyPause) {
          skipped.push(buildColdmailSenderSkip(senderEmail, 'coldmail_safety_paused', {
            index,
            quota,
            safetyPause: quota.safetyPause,
          }));
          continue;
        }
        if (remaining <= 0) {
          skipped.push(buildColdmailSenderSkip(senderEmail, 'coldmail_daily_limit_reached', {
            index,
            quota,
          }));
          continue;
        }
        if (schedule.senderMinIntervalMinutes > 0) {
          const lastSentAtMs = getLastColdmailSendAtMsForSender(quota, senderEmail);
          const daySlotReadiness = getColdmailAutopilotDaySlotReadiness(
            schedule,
            senderEmail,
            lastSentAtMs,
            { quota, senderIndex: index, senderCount: candidates.length }
          );
          const cooldownMinutes = daySlotReadiness
            ? daySlotReadiness.cooldownMinutes
            : getSenderCooldownMinutes(schedule, senderEmail, lastSentAtMs);
          const readyAtMs = daySlotReadiness
            ? daySlotReadiness.readyAtMs
            : lastSentAtMs + cooldownMinutes * 60 * 1000;
          if (lastSentAtMs && readyAtMs > currentMs && !(daySlotReadiness && daySlotReadiness.ok)) {
            skipped.push(buildColdmailSenderSkip(senderEmail, 'sender_cooldown', {
              index,
              quota,
              readyAt: new Date(readyAtMs).toISOString(),
              cooldownMinutes,
            }));
            continue;
          }
        }
        const centralCooldownConflict = await findSupabaseColdmailSenderCooldownConflict(senderEmail);
        if (centralCooldownConflict) {
          const readyAt = normalizeString(
            centralCooldownConflict.expires_at ||
            centralCooldownConflict.updated_at ||
            centralCooldownConflict.last_seen_at
          );
          const readyAtMs = parseTimestampMs(readyAt);
          skipped.push(buildColdmailSenderSkip(senderEmail, 'sender_cooldown', {
            index,
            quota,
            readyAt,
            cooldownMinutes: readyAtMs
              ? Math.max(0, Math.ceil((readyAtMs - currentMs) / (60 * 1000)))
              : undefined,
          }));
          continue;
        }
        senderOptions.push({ senderEmail, quota, remaining, index });
      } catch (error) {
        skipped.push(buildColdmailSenderSkip(candidate, normalizeString(error && error.code) || 'sender_not_allowed', {
          index,
        }));
      }
    }
    const smtpConfigSkips = skipped.filter((item) => item && item.reason === 'sender_smtp_not_configured');
    if (smtpConfigSkips.length > 0) {
      return {
        selected: null,
        skipped: smtpConfigSkips,
      };
    }
    senderOptions.sort((left, right) => {
      const leftDaySent = getColdmailSenderQuotaDaySent(left.quota);
      const rightDaySent = getColdmailSenderQuotaDaySent(right.quota);
      const daySentDiff = leftDaySent - rightDaySent;
      if (daySentDiff !== 0) return daySentDiff;
      const sentDiff = (left.quota.senderSent || 0) - (right.quota.senderSent || 0);
      if (sentDiff !== 0) return sentDiff;
      return left.index - right.index;
    });
    return {
      selected: senderOptions[0] || null,
      skipped,
    };
  }

  function isOnlySenderCooldownSkips(skipped) {
    return Array.isArray(skipped) && skipped.length > 0 && skipped.every((item) => item && item.reason === 'sender_cooldown');
  }

  function getNextSenderCooldownReadyAt(skipped) {
    return (Array.isArray(skipped) ? skipped : [])
      .map((item) => parseTimestampMs(item && item.readyAt))
      .filter(Boolean)
      .sort((left, right) => left - right)[0] || 0;
  }

  function getZonedColdmailAutopilotParts(date, timezone) {
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
    } catch (_) {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
    }
    const getPart = (type) => {
      const part = parts.find((item) => item.type === type);
      return part ? part.value : '';
    };
    const rawHour = Number(getPart('hour'));
    return {
      weekday: getPart('weekday'),
      year: Number(getPart('year')) || 0,
      month: Number(getPart('month')) || 0,
      day: Number(getPart('day')) || 0,
      hour: rawHour === 24 ? 0 : rawHour,
      minute: Number(getPart('minute')) || 0,
    };
  }

  function isColdmailAutopilotInSchedule(schedule, date = now()) {
    const normalized = normalizeColdmailAutopilotSchedule(schedule);
    const parts = getZonedColdmailAutopilotParts(date, normalized.timezone);
    if (normalized.weekdaysOnly && ['Sat', 'Sun'].includes(parts.weekday)) {
      return {
        ok: false,
        reason: 'outside_weekday_window',
        message: 'Autopilot wacht tot de volgende werkdag.',
      };
    }
    const currentMinuteOfDay = parts.hour * 60 + parts.minute;
    const startMinuteOfDay = getColdmailAutopilotScheduleStartMinuteOfDay(normalized);
    const endMinuteOfDay = getColdmailAutopilotScheduleEndMinuteOfDay(normalized);
    if (currentMinuteOfDay < startMinuteOfDay || currentMinuteOfDay >= endMinuteOfDay) {
      return {
        ok: false,
        reason: 'outside_safe_hours',
        message: `Autopilot mailt alleen tussen ${formatColdmailAutopilotScheduleTime(normalized.startHour, normalized.startMinute)} en ${formatColdmailAutopilotScheduleTime(normalized.endHour, normalized.endMinute)}.`,
      };
    }
    return { ok: true };
  }

  function isColdmailAutopilotLockActive(state) {
    const expiresAtMs = parseTimestampMs(state && state.lock && state.lock.expiresAt);
    return expiresAtMs > now().getTime();
  }

  function isColdmailAutopilotIntervalReady(state) {
    const schedule = normalizeColdmailAutopilotSchedule(state.schedule);
    const lastStartedAtMs = parseTimestampMs(state.lastStartedAt);
    if (!lastStartedAtMs) return { ok: true };
    const minIntervalMs = schedule.minIntervalMinutes * 60 * 1000;
    const readyAtMs = lastStartedAtMs + minIntervalMs;
    if (readyAtMs <= now().getTime()) return { ok: true };
    return {
      ok: false,
      reason: 'cooldown',
      message: `Autopilot wacht nog tot ${new Date(readyAtMs).toISOString()}.`,
    };
  }

  function compactColdmailAutopilotResult(result = {}) {
    return {
      ok: result.ok !== false,
      skipped: Boolean(result.skipped),
      reason: truncateText(normalizeString(result.reason || result.code), 120),
      message: truncateText(normalizeString(result.message), 500),
      at: normalizeString(result.at) || now().toISOString(),
      sent: Math.max(0, Number(result.sent || 0) || 0),
      failed: Math.max(0, Number(result.failed || 0) || 0),
      failedReasons: Array.isArray(result.failedReasons)
        ? result.failedReasons.slice(0, 8).map((item) => ({
            reason: truncateText(normalizeString(item && item.reason), 120),
            count: Math.max(0, Number(item && item.count) || 0),
            sample: item && item.sample && typeof item.sample === 'object'
              ? {
                  bedrijf: truncateText(normalizeString(item.sample.bedrijf), 120),
                  email: normalizeEmailAddress(item.sample.email),
                  code: truncateText(normalizeString(item.sample.code), 120),
                  error: truncateText(normalizeString(item.sample.error), 240),
                }
              : undefined,
          })).filter((item) => item.reason && item.count > 0)
        : summarizeColdmailFailureReasons(result.failedItems),
      invalidRecipientDomainsBlocked:
        Math.max(0, Number(result.invalidRecipientDomainsBlocked || 0) || 0) || undefined,
      senderEmail: normalizeEmailAddress(result.senderEmail),
      selected: Math.max(0, Number(result.selected || 0) || 0),
      requested: Math.max(0, Number(result.requested || 0) || 0),
      sendJitterSeconds: Math.max(0, Number(result.sendJitterSeconds || 0) || 0) || undefined,
      dailyQuota: summarizeColdmailAutopilotDailyQuota(result.dailyQuota),
      senderSkips: Array.isArray(result.senderSkips)
        ? result.senderSkips.slice(0, 10).map((item) => ({
          senderEmail: normalizeEmailAddress(item && item.senderEmail),
          reason: truncateText(normalizeString(item && item.reason), 120),
          readyAt: normalizeString(item && item.readyAt),
          cooldownMinutes: Math.max(0, Number(item && item.cooldownMinutes) || 0) || undefined,
          senderSent: Math.max(0, Number(item && item.senderSent) || 0),
          senderDaySent: Math.max(0, Number(item && item.senderDaySent) || 0),
          senderRemaining: Math.max(0, Number(item && item.senderRemaining) || 0),
          packageRemaining: Math.max(0, Number(item && item.packageRemaining) || 0),
          smtpDiagnostic: sanitizeColdmailAutopilotSmtpDiagnostic(item && item.smtpDiagnostic),
        }))
        : undefined,
      webdesignPreparation:
        result.webdesignPreparation && typeof result.webdesignPreparation === 'object'
          ? {
              queued: Boolean(result.webdesignPreparation.queued),
              existing: Boolean(result.webdesignPreparation.existing),
              customerId: truncateText(normalizeString(result.webdesignPreparation.customerId), 120),
              bedrijf: truncateText(normalizeString(result.webdesignPreparation.bedrijf), 160),
              email: normalizeEmailAddress(result.webdesignPreparation.email),
              websiteUrl: truncateText(normalizeString(result.webdesignPreparation.websiteUrl), 300),
              job: result.webdesignPreparation.job && typeof result.webdesignPreparation.job === 'object'
                ? {
                    id: truncateText(normalizeString(result.webdesignPreparation.job.id), 120),
                    status: truncateText(normalizeString(result.webdesignPreparation.job.status), 80),
                    customerId: truncateText(normalizeString(result.webdesignPreparation.job.customerId), 120),
                  }
                : undefined,
            }
          : undefined,
      agendaBlocked: Boolean(result.agendaBlocked),
    };
  }

  async function finishColdmailAutopilotRun(state, result, actor, options = {}) {
    const compactResult = compactColdmailAutopilotResult(result);
    const latestStateRecord = await loadColdmailAutopilotStateRecord().catch(() => null);
    const latestState = latestStateRecord && latestStateRecord.hasValue
      ? latestStateRecord.state
      : null;
    const fallbackConfig = await loadColdmailAutopilotSenderSettingsConfig().catch(() => state && state.config);
    const trustedStateConfig = pickColdmailAutopilotConfig(state && state.config, fallbackConfig);
    const trustedStateSchedule = normalizeColdmailAutopilotSchedule(state && state.schedule);
    const preserveDisabledState =
      latestState &&
      latestState.enabled === false &&
      isColdmailAutopilotTrustedDisabledState(latestState) &&
      state &&
      state.enabled !== false;
    const baseState = preserveDisabledState
        ? {
            ...state,
            enabled: false,
            config: pickColdmailAutopilotConfig(latestState.config, trustedStateConfig),
            schedule: pickColdmailAutopilotSchedule(latestState.schedule, trustedStateSchedule),
            updatedAt: latestState.updatedAt || state.updatedAt,
            updatedBy: latestState.updatedBy || state.updatedBy,
            emergencyStoppedAt: latestState.emergencyStoppedAt || state.emergencyStoppedAt,
            emergencyStopReason: latestState.emergencyStopReason || state.emergencyStopReason,
          }
        : {
            ...state,
            config: trustedStateConfig,
            schedule: trustedStateSchedule,
          };
    const logSource = preserveDisabledState && Array.isArray(latestState.log)
      ? latestState.log
      : baseState.log;
    const nextState = {
      ...baseState,
      lock: options.preserveLock && !preserveDisabledState ? baseState.lock : null,
      lastRunAt: compactResult.at,
      lastResult: compactResult,
      log: normalizeColdmailAutopilotLog([
        ...(logSource || []),
        compactResult,
      ]),
    };
    const saved = await saveColdmailAutopilotState(nextState, actor || 'Coldmail Autopilot');
    return {
      ...compactResult,
      autopilot: summarizeColdmailAutopilotState(saved),
    };
  }

  function buildColdmailAutopilotSkipResult(reason, message, extra = {}) {
    return {
      ok: true,
      skipped: true,
      reason,
      message,
      at: now().toISOString(),
      ...extra,
    };
  }

  async function assertColdmailAutopilotStillEnabledBeforeSend() {
    const latestStateRecord = await loadColdmailAutopilotStateRecord().catch(() => null);
    if (!latestStateRecord || !latestStateRecord.hasValue) {
      const error = new Error(
        'Autopilot-state kon vlak voor verzenden niet veilig uit Supabase worden geladen. Er is niets verzonden.'
      );
      error.code = 'COLDMAIL_AUTOPILOT_STATE_UNAVAILABLE';
      throw error;
    }
    if (!latestStateRecord.state.enabled) {
      if (!isColdmailAutopilotTrustedDisabledState(latestStateRecord.state)) {
        const error = new Error(
          'Autopilot-state is onbetrouwbaar: er staat enabled=false zonder geldige knop-actie. Er is niets verzonden.'
        );
        error.code = 'COLDMAIL_AUTOPILOT_STATE_UNAVAILABLE';
        throw error;
      }
      const error = new Error('Coldmail autopilot staat uit. Er is niets verzonden.');
      error.code = 'COLDMAIL_AUTOPILOT_DISABLED';
      throw error;
    }
    const scheduleCheck = isColdmailAutopilotInSchedule(latestStateRecord.state.schedule, now());
    if (!scheduleCheck.ok) {
      const error = new Error(scheduleCheck.message || 'Autopilot staat buiten het veilige verzendvenster. Er is niets verzonden.');
      error.code = 'COLDMAIL_AUTOPILOT_OUTSIDE_SCHEDULE';
      error.reason = scheduleCheck.reason || 'outside_safe_hours';
      error.status = 429;
      throw error;
    }
  }

  async function runColdmailAutopilot(input = {}) {
    const actor = truncateText(normalizeString(input.actor), 120) || 'Coldmail Autopilot';
    const stateRecord = await loadColdmailAutopilotStateRecord();
    let state = stateRecord.state;

    if (!stateRecord.hasValue) {
      return compactColdmailAutopilotResult(buildColdmailAutopilotSkipResult(
        'state_unavailable',
        'Autopilot-state kon niet veilig uit Supabase worden geladen. Er is niets verzonden en niets overschreven.'
      ));
    }

    if (!state.enabled) {
      if (!isColdmailAutopilotTrustedDisabledState(state)) {
        return compactColdmailAutopilotResult(buildColdmailAutopilotUntrustedDisabledResult());
      }
      return finishColdmailAutopilotRun(
        state,
        buildColdmailAutopilotSkipResult('disabled', 'Coldmail autopilot staat uit.'),
        actor
      );
    }
    if (isColdmailAutopilotLockActive(state)) {
      return finishColdmailAutopilotRun(
        state,
        buildColdmailAutopilotSkipResult('already_running', 'Er draait al een autopilot-run.'),
        actor,
        { preserveLock: true }
      );
    }
    if (!input.force) {
      const scheduleCheck = isColdmailAutopilotInSchedule(state.schedule, now());
      if (!scheduleCheck.ok) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(scheduleCheck.reason, scheduleCheck.message),
          actor
        );
      }
      const intervalCheck = isColdmailAutopilotIntervalReady(state);
      if (!intervalCheck.ok) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(intervalCheck.reason, intervalCheck.message),
          actor
        );
      }
    }

    const previousLastStartedAt = state.lastStartedAt;
    const startedAt = now().toISOString();
    state = await saveColdmailAutopilotState(
      {
        ...state,
        lastStartedAt: startedAt,
        lock: {
          startedAt,
          expiresAt: new Date(now().getTime() + DEFAULT_COLDMAIL_AUTOPILOT_LOCK_MS).toISOString(),
          actor,
        },
      },
      actor
    );

    try {
      let replySync = null;
      try {
        replySync = await syncInboundColdmailRepliesFromImap({ force: false, maxMessages: 30 });
      } catch (error) {
        replySync = {
          ok: false,
          skipped: true,
          reason: 'reply_sync_failed',
          message: truncateText(normalizeString(error && error.message), 240),
        };
      }

      const settings = await loadColdmailingSenderSettings();
      const candidates = getColdmailAutopilotSenderCandidates(state, settings);
      const senderChoice = await chooseColdmailAutopilotSender(candidates, { schedule: state.schedule });
      if (!senderChoice.selected) {
        if (isOnlySenderCooldownSkips(senderChoice.skipped)) {
          const nextReadyAtMs = getNextSenderCooldownReadyAt(senderChoice.skipped);
          return finishColdmailAutopilotRun(
            {
              ...state,
              lastStartedAt: previousLastStartedAt,
            },
            buildColdmailAutopilotSkipResult(
              'sender_cooldown',
              nextReadyAtMs
                ? `Autopilot spreidt per mailbox en wacht tot ${new Date(nextReadyAtMs).toISOString()}.`
                : 'Autopilot spreidt per mailbox en wacht nog even.',
              { senderSkips: senderChoice.skipped }
            ),
            actor
          );
        }
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(
            'no_sender_capacity',
            'Geen afzender heeft nu veilige verzendruimte of geldige SMTP-configuratie.',
            { senderSkips: senderChoice.skipped }
          ),
          actor
        );
      }

      const senderEmail = senderChoice.selected.senderEmail;
      const profile = resolveColdmailAutopilotSenderProfile(settings, state.config, senderEmail);
      if (!profile.subject || !profile.body) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(
            'empty_mail_content',
            'Autopilot mist een onderwerp of mailtekst en heeft niets verzonden.',
            { senderEmail }
          ),
          actor
        );
      }

      const sendCount = Math.max(
        0,
        Math.min(
          state.config.count,
          senderChoice.selected.remaining,
          getColdmailCampaignSendLimit()
        )
      );
      if (sendCount <= 0) {
        return finishColdmailAutopilotRun(
          state,
          buildColdmailAutopilotSkipResult(
            'coldmail_daily_limit_reached',
            'Daglimiet bereikt. Autopilot heeft niets verzonden.',
            { senderEmail, dailyQuota: senderChoice.selected.quota }
          ),
          actor
        );
      }

      const sendJitterSeconds = input.force
        ? 0
        : getColdmailAutopilotSendJitterSeconds(state.schedule, senderEmail, state.lastStartedAt);
      if (sendJitterSeconds > 0) {
        await sleep(sendJitterSeconds * 1000);
      }

      const sendResult = await sendColdmailCampaign({
        count: sendCount,
        subject: profile.subject,
        subjectVariants: profile.subjectVariants,
        body: profile.body,
        bodyVariants: profile.bodyVariants,
        aiInstructions: profile.aiInstructions,
        toneStyle: profile.toneStyle,
        branch: state.config.branch,
        service: state.config.service,
        database: state.config.database,
        senderEmail,
        specialAction: state.config.specialAction,
        webdesignImageDelivery: 'attachment',
        imageDelivery: 'attachment',
        durationDays: state.config.durationDays,
        radiusKm: state.config.radiusKm,
        mode: 'mail',
        testMode: false,
        publicBaseUrl: input.publicBaseUrl,
        actor,
        beforeSendGuard: assertColdmailAutopilotStillEnabledBeforeSend,
        senderCooldownLock: {
          enabled: true,
          senderMinIntervalMinutes: normalizeColdmailAutopilotSchedule(state.schedule).senderMinIntervalMinutes,
        },
      });
      return finishColdmailAutopilotRun(
        state,
        {
          ok: true,
          skipped: false,
          reason: 'sent',
          message: `${sendResult.sent || 0} coldmail(s) veilig verzonden.`,
          at: now().toISOString(),
          requested: sendResult.requested,
          selected: sendResult.selected,
          sent: sendResult.sent,
          failed: sendResult.failed,
          failedReasons: sendResult.failedReasons,
          senderEmail,
          sendJitterSeconds,
          dailyQuota: sendResult.dailyQuota,
          senderSkips: senderChoice.skipped,
          replySync: replySync ? {
            ok: replySync.ok !== false,
            skipped: Boolean(replySync.skipped),
            reason: normalizeString(replySync.reason),
          } : undefined,
        },
        actor
      );
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_AUTOPILOT_FAILED';
      if (code === 'COLDMAIL_AUTOPILOT_STATE_UNAVAILABLE') {
        return compactColdmailAutopilotResult(buildColdmailAutopilotSkipResult(
          'state_unavailable',
          normalizeString(error && error.message) ||
            'Autopilot-state kon vlak voor verzenden niet veilig worden geladen. Er is niets verzonden.'
        ));
      }
      const knownSkip = COLDMAIL_AUTOPILOT_KNOWN_SKIP_CODES.has(code);
      const shouldKeepPreviousStartTime =
        code === 'COLDMAIL_AUTOPILOT_DISABLED' ||
        code === 'NO_VALID_RECIPIENT_DOMAINS' ||
        code === 'NO_WEBDESIGN_PHOTOS' ||
        code === 'WEBDESIGN_PREPARATION_QUEUED';
      return finishColdmailAutopilotRun(
        shouldKeepPreviousStartTime
          ? {
              ...state,
              lastStartedAt: previousLastStartedAt,
            }
          : state,
        {
          ok: knownSkip,
          skipped: knownSkip,
          reason: code === 'COLDMAIL_AUTOPILOT_DISABLED'
            ? 'disabled'
            : code === 'COLDMAIL_SENDER_COOLDOWN_ACTIVE'
            ? 'sender_cooldown'
            : code === 'COLDMAIL_AUTOPILOT_OUTSIDE_SCHEDULE'
            ? normalizeString(error && error.reason) || 'outside_safe_hours'
            : code.toLowerCase(),
          message: truncateText(
            normalizeString(error && error.message) || 'Coldmail autopilot kon niet veilig draaien.',
            500
          ),
          at: now().toISOString(),
          failedItems: Array.isArray(error && error.failedItems) ? error.failedItems : undefined,
          webdesignPreparation:
            error && error.webdesignPreparation && typeof error.webdesignPreparation === 'object'
              ? error.webdesignPreparation
              : undefined,
          invalidRecipientDomainsBlocked: Math.max(
            0,
            Number(error && error.invalidRecipientDomainsBlocked) || 0
          ),
          dailyQuota: error && error.quota && typeof error.quota === 'object' ? error.quota : undefined,
        },
        actor
      );
    }
  }

  async function runColdmailBeforeSendGuard(input = {}, context = {}) {
    if (typeof input.beforeSendGuard !== 'function') return;
    await input.beforeSendGuard(context);
  }

  async function recordColdmailSendGuardEntry({
    senderEmail,
    count,
    personalCount = 0,
    actor,
    recipientKey = '',
    recipientEmail = '',
    recipientDomain = '',
    recipientCompanyKey = '',
    recipientId = '',
    recipientCompany = '',
  }) {
    const safeCount = Math.max(0, Number(count || 0) || 0);
    if (!safeCount) return false;
    const state = await loadColdmailSendGuardState();
    const at = now().toISOString();
    const recipientEntry = {
      at,
      senderEmail: normalizeEmailAddress(senderEmail),
      recipientKey: normalizeString(recipientKey),
      recipientEmail: normalizeEmailAddress(recipientEmail),
      recipientDomain: normalizeColdmailGuardKeyPart(recipientDomain),
      recipientCompanyKey: normalizeColdmailGuardKeyPart(recipientCompanyKey),
      recipientId: normalizeColdmailGuardKeyPart(recipientId),
      recipientCompany: truncateText(normalizeString(recipientCompany), 120),
    };
    state.entries.push({
      ...recipientEntry,
      count: safeCount,
      personalCount: Math.max(0, Number(personalCount || 0) || 0),
    });
    if (hasColdmailRecipientGuardIdentity(recipientEntry)) {
      state.recipientEntries = Array.isArray(state.recipientEntries) ? state.recipientEntries : [];
      state.recipientEntries.push(recipientEntry);
    }
    await saveColdmailSendGuardState(state, actor);
    return true;
  }

  async function recordColdmailSafetyPause({ senderEmail, reason, error, actor }) {
    const state = await loadColdmailSendGuardState();
    const at = now();
    const until = new Date(at.getTime() + getColdmailSafetyPauseMs()).toISOString();
    const safetyReason = truncateText(
      normalizeString(reason || (error && error.message) || error || 'mail_provider_safety_signal'),
      240
    );
    state.entries.push({
      at: at.toISOString(),
      senderEmail: normalizeEmailAddress(senderEmail),
      count: 0,
      personalCount: 0,
      safetyPauseUntil: until,
      safetyPauseReason: safetyReason,
    });
    await saveColdmailSendGuardState(state, actor || 'coldmail-safety-pause');
    return { until, reason: safetyReason };
  }

  function getSmtpSafetyStopReason(error) {
    const text = [
      error && error.code,
      error && error.command,
      error && error.responseCode,
      error && error.response,
      error && error.message,
    ]
      .filter(Boolean)
      .join(' ');
    if (!COLDMAIL_SMTP_SAFETY_STOP_PATTERN.test(text)) return '';
    return truncateText(normalizeString(text), 240) || 'Mailprovider gaf een beschermingssignaal terug.';
  }

  function buildColdmailSafetyPauseMessage(pause) {
    const until = normalizeString(pause && pause.until);
    return until
      ? `Coldmailing staat tijdelijk op pauze tot ${until}, omdat de mailprovider een veiligheidsmelding gaf.`
      : 'Coldmailing staat tijdelijk op pauze omdat de mailprovider een veiligheidsmelding gaf.';
  }

  function buildColdmailPostSmtpPersistenceError(step, error) {
    const detail = truncateText(
      normalizeString(error && error.message ? error.message : error),
      300
    );
    const wrapped = new Error(
      `Na SMTP-acceptatie kon ${step} niet betrouwbaar worden opgeslagen.${detail ? ` Detail: ${detail}` : ''}`
    );
    wrapped.code = 'COLDMAIL_POST_SMTP_PERSISTENCE_FAILED';
    wrapped.step = step;
    wrapped.cause = error;
    return wrapped;
  }

  async function runColdmailPostSmtpPersistenceStep(step, fn) {
    let lastError = null;
    for (let attempt = 0; attempt <= COLDMAIL_POST_SMTP_PERSISTENCE_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= COLDMAIL_POST_SMTP_PERSISTENCE_RETRY_DELAYS_MS.length) break;
        logger.warn('[Coldmail][post-smtp-persistence-retry]', {
          step,
          attempt: attempt + 1,
          error: error && error.message ? error.message : error,
        });
        await sleep(COLDMAIL_POST_SMTP_PERSISTENCE_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw buildColdmailPostSmtpPersistenceError(step, lastError);
  }

  function assertColdmailPostSmtpPersistenceResult(step, result) {
    if (result) return result;
    const error = new Error(`${step} gaf geen bevestiging terug.`);
    error.code = 'COLDMAIL_POST_SMTP_PERSISTENCE_EMPTY_RESULT';
    throw error;
  }

  function matchesBranch(row, branchFilter) {
    const filter = normalizeString(branchFilter).toLowerCase();
    if (!filter) return true;
    return normalizeString(row.branche || row.branch || '').toLowerCase() === filter;
  }

  function matchesRadius(row, radiusKm) {
    if (!hasExplicitRadiusKm(radiusKm)) return true;
    const radius = parseRadiusKm(radiusKm);
    const distanceKm = getRowDistanceKm(row);
    if (!Number.isFinite(distanceKm)) return false;
    return distanceKm <= radius;
  }

  function normalizeInstantlyColdmailStatus(value) {
    const normalized = normalizeString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (normalized === 'email_sent') return 'sent';
    if (normalized === 'email_opened') return 'opened';
    if (normalized === 'email_bounced') return 'bounced';
    if (normalized === 'lead_unsubscribed') return 'unsubscribed';
    if (normalized === 'lead_interested') return 'interested';
    if (normalized === 'email_replied') return 'reply_received';
    return normalized;
  }

  function hasActiveInstantlyColdmailOutreach(row) {
    const status = normalizeInstantlyColdmailStatus(row && row.instantlyStatus);
    if (BLOCKING_INSTANTLY_COLDMAIL_STATUSES.has(status)) return false;
    if (ACTIVE_INSTANTLY_COLDMAIL_STATUSES.has(status)) return true;
    return Boolean(
      row &&
        (row.instantlySyncedAt ||
          row.instantlyCampaignId ||
          normalizeString(row.lastColdmailProvider).toLowerCase() === 'instantly')
    );
  }

  function isEligibleColdmailRow(row, branchFilter, radiusKm, blockedEmailKeys) {
    if (isDedicatedTestModeRow(row)) return false;
    const email = getRowEmail(row);
    if (!isLikelyValidEmail(email)) return false;
    if (isEmailBlocked(email, blockedEmailKeys)) return false;
    if (row.mail === false || row.canMail === false || row.doNotMail === true) return false;
    if (!isTestRecipientRow(row, email) && hasActiveInstantlyColdmailOutreach(row)) return false;
    if (!isTestRecipientRow(row, email) && hasPriorOutboundMailSignal(row)) return false;
    if (!matchesBranch(row, branchFilter)) return false;
    if (!matchesRadius(row, radiusKm)) return false;
    if (isTestRecipientRow(row, email)) return true;
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return !EXCLUDED_DATABASE_STATUSES.has(status);
  }

  function isEligibleColdcallingRow(row, branchFilter, radiusKm, blockedPhoneKeys) {
    if (isDedicatedTestModeRow(row)) return false;
    const phone = getRowPhone(row);
    if (!isLikelyCallablePhone(phone)) return false;
    if (isPhoneBlocked(phone, blockedPhoneKeys)) return false;
    if (row.call === false || row.canCall === false || row.doNotCall === true) return false;
    if (!matchesBranch(row, branchFilter)) return false;
    if (!matchesRadius(row, radiusKm)) return false;
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return !new Set(['interesse', 'afspraak', 'klant', 'afgehaakt', 'geblokkeerd', 'buiten']).has(status);
  }

  async function isDeliverableEmailDomain(email) {
    const domain = getEmailDomain(email);
    if (!domain) return false;
    try {
      return Boolean(await resolveEmailDomain(domain));
    } catch (error) {
      if (isExpectedDnsMiss(error)) return false;
      throw error;
    }
  }

  function isPersonalMailboxDomain(email) {
    const domain = getEmailDomain(email);
    return Boolean(domain && PERSONAL_MAILBOX_DOMAINS.has(domain));
  }

  function pickFailureMessage(failedItems = [], candidateItems = []) {
    const failures = Array.isArray(failedItems) ? failedItems : [];
    const candidateIds = new Set(
      (Array.isArray(candidateItems) ? candidateItems : [])
        .map((item) => normalizeString(item && item.id))
        .filter(Boolean)
    );
    const candidateFailure = failures.find((item) =>
      candidateIds.has(normalizeString(item && item.id)) && normalizeString(item && item.error)
    );
    if (candidateFailure) return normalizeString(candidateFailure.error);
    const firstFailure = failures.find((item) => normalizeString(item && item.error));
    return firstFailure ? normalizeString(firstFailure.error) : '';
  }

  function classifyColdmailFailureReason(item = {}) {
    const code = normalizeString(item && item.code).toLowerCase();
    const error = normalizeString(item && item.error).toLowerCase();
    const combined = `${code} ${error}`;
    if (/duplicate|guard|al eerder|recently|recipient_recently_sent/.test(combined)) {
      return 'duplicate_guard';
    }
    if (/geen website-design klaar|no_webdesign|website-design klaar/.test(combined)) {
      return 'webdesign_not_ready';
    }
    if (/geen webdesign-foto|webdesign-foto/.test(combined)) {
      return 'missing_webdesign_photo';
    }
    if (/geen device-mockup|device-mockup|mockup/.test(combined)) {
      return 'missing_device_mockup';
    }
    if (/persoonlijke mailbox/.test(combined)) {
      return 'personal_mailbox_blocked';
    }
    if (/invalid_email_domain|e-maildomein bestaat niet|ontvangt geen mail/.test(combined)) {
      return 'invalid_email_domain';
    }
    if (/daglimiet|quota|limit/.test(combined)) {
      return 'quota_or_day_limit';
    }
    if (/safety|pause|provider|smtp|blocked|spam|rate|refused|timeout/.test(combined)) {
      return 'provider_or_safety';
    }
    return code || 'other';
  }

  function summarizeColdmailFailureReasons(failedItems = [], maxReasons = 8) {
    const groups = new Map();
    (Array.isArray(failedItems) ? failedItems : []).forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const reason = classifyColdmailFailureReason(item);
      if (!groups.has(reason)) {
        groups.set(reason, {
          reason,
          count: 0,
          sample: null,
        });
      }
      const group = groups.get(reason);
      group.count += 1;
      if (!group.sample) {
        group.sample = {
          bedrijf: truncateText(normalizeString(item.bedrijf), 120),
          email: normalizeEmailAddress(item.email),
          code: truncateText(normalizeString(item.code), 120),
          error: truncateText(normalizeString(item.error), 240),
        };
      }
    });
    return [...groups.values()]
      .sort((left, right) => {
        const countDiff = Number(right.count) - Number(left.count);
        if (countDiff !== 0) return countDiff;
        return normalizeString(left.reason).localeCompare(normalizeString(right.reason));
      })
      .slice(0, Math.max(1, Number(maxReasons) || 8));
  }

  async function resolveColdmailRecipients(input = {}) {
    const mode = normalizeString(input.mode || '').toLowerCase() === 'call' ? 'call' : 'mail';
    const count = parsePositiveInt(input.count, 10, 1, mode === 'call' ? 500 : getColdmailCampaignSendLimit());
    if (isCampaignTestModeEnabled(input.testMode)) {
      const customerState = await getUiStateValues(customerDbScope);
      const customerValues =
        customerState && typeof customerState.values === 'object' ? customerState.values : {};
      const customerRows = parseDatabaseRows(customerValues);
      const customerPhotoMap = shouldUseWebdesignAssets(input, mode) ? await loadCustomerPhotoMap(customerRows) : {};
      return buildResolvedColdmailTestRecipients(input, mode, count, customerRows, customerPhotoMap);
    }
    const blockedPhoneKeys = mode === 'call'
      ? parseBlockedPhoneList(input.blockedPhones || input.callBlocklist || input.blockedPhoneNumbers)
      : new Set();
    const blockedEmailKeys = mode === 'mail'
      ? parseBlockedEmailList(
          input.blockedEmails || input.emailBlocklist || input.mailBlocklist || input.blockedMailAddresses
        )
      : new Set();
    const state = await getUiStateValues(mode === 'call' ? leadDbScope : customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const customerState =
      mode === 'call' ? await getUiStateValues(customerDbScope) : state;
    const customerValues =
      customerState && typeof customerState.values === 'object' ? customerState.values : {};
    let customerRows = parseDatabaseRows(customerValues);
    if (mode === 'mail' && mailReadySnapshotService && typeof mailReadySnapshotService.buildMailReadySnapshot === 'function') {
      const snapshot = await mailReadySnapshotService.buildMailReadySnapshot({ limit: 3000, offset: 0 });
      if (!snapshot || snapshot.ok !== true || !Array.isArray(snapshot.customers)) {
        throw new Error('Mailklare voorraad kon niet veilig worden geladen; verzenden is gestopt.');
      }
      customerRows = snapshot.customers;
    }
    let rows = [];
    if (mode === 'call') {
      rows = mergeColdcallingRowsWithCustomerRows(
        parseLeadDatabaseRows(values),
        parseLeadDatabaseRows(customerValues, customerDbKey)
      );
    } else {
      rows = customerRows;
    }
    const shouldRequireWebdesign = requiresReadyWebdesign(input, mode);
    const customerPhotoMap = shouldRequireWebdesign ? await loadCustomerPhotoMap(customerRows) : {};
    const readyWebdesignMatcher = shouldRequireWebdesign
      ? createReadyWebdesignMatcher(customerRows, customerPhotoMap)
      : null;
    const sendGuardState = mode === 'mail' ? await loadColdmailSendGuardState() : { recipientEntries: [] };
    const recipientGuardEntries = sendGuardState.recipientEntries || [];

    const failed = [];
    const eligibleRows = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) =>
        mode === 'call'
          ? isEligibleColdcallingRow(row, input.branch, input.radiusKm, blockedPhoneKeys)
          : isEligibleColdmailRow(row, input.branch, input.radiusKm, blockedEmailKeys)
      );
    const candidateRows = [];
    const selectedRows = [];
    let webdesignPreparationCandidate = null;

    for (const item of eligibleRows) {
      if (readyWebdesignMatcher && !readyWebdesignMatcher.hasRow(item.row, item.index)) {
        if (mode === 'mail' && !webdesignPreparationCandidate) {
          const preWebdesignBlock = await getPreWebdesignColdmailBlock(item, recipientGuardEntries);
          if (preWebdesignBlock) {
            failed.push(preWebdesignBlock);
            continue;
          }
          webdesignPreparationCandidate = item;
        }
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email: getRowEmail(item.row),
          phone: getRowPhone(item.row),
          error: `Nog geen website-design klaar voor ${getRowCompany(item.row) || 'dit bedrijf'}.`,
        });
        continue;
      }
      candidateRows.push(item);
      if (mode === 'call') {
        selectedRows.push(item);
        if (selectedRows.length >= count) break;
        continue;
      }
      const duplicateBlock = await getColdmailOutboundDuplicateBlock(item, recipientGuardEntries);
      if (duplicateBlock) {
        failed.push(duplicateBlock);
        continue;
      }
      const email = getRowEmail(item.row);
      if (!isTestRecipientRow(item.row, email) && shouldBlockPersonalMailboxDomains() && isPersonalMailboxDomain(email)) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email,
          error: `Persoonlijke mailbox overgeslagen voor coldmail: ${getEmailDomain(email)}.`,
        });
        continue;
      }
      if (await isDeliverableEmailDomain(email)) {
        selectedRows.push(item);
        if (selectedRows.length >= count) break;
      } else {
        const domain = getEmailDomain(email);
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email,
          domain,
          code: 'invalid_email_domain',
          error: `E-maildomein bestaat niet of ontvangt geen mail: ${domain || email}`,
        });
      }
    }

    return {
      count,
      mode,
      radiusKm: hasExplicitRadiusKm(input.radiusKm) ? parseRadiusKm(input.radiusKm) : null,
      values,
      customerValues,
      customerRows,
      rows,
      candidateRows,
      selectedRows,
      failed,
      customerPhotoMap,
      webdesignPreparationCandidate,
    };
  }

  async function getColdmailCampaignRecipients(input = {}) {
    const resolved = await resolveColdmailRecipients(input);
    return {
      ok: true,
      mode: resolved.mode,
      testMode: Boolean(resolved.testMode),
      testRecipientEmails: resolved.testMode && Array.isArray(resolved.testRecipientEmails)
        ? resolved.testRecipientEmails
        : undefined,
      requested: resolved.count,
      radiusKm: resolved.radiusKm,
      candidates: resolved.candidateRows.length,
      selected: resolved.selectedRows.length,
      safetyLimits: getColdmailSafetyLimits(),
      recipients: resolved.selectedRows.map((item) => {
        const website = getRowDomain(item.row);
        const recipient = {
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email: getRowEmail(item.row),
          phone: getRowPhone(item.row),
          distanceKm: Number.isFinite(getRowDistanceKm(item.row)) ? Math.round(getRowDistanceKm(item.row) * 10) / 10 : null,
        };
        if (website) recipient.website = website;
        return recipient;
      }),
      failedItems: resolved.failed,
    };
  }

  function getColdmailReplyHistoryEntry(row) {
    const history = Array.isArray(row && row.hist) ? row.hist : [];
    return history.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const source = normalizeString(item.source).toLowerCase();
      const type = normalizeDatabaseStatus(item.type || item.status, item);
      return type === 'interesse' && source === 'coldmail-inbound-reply';
    }) || null;
  }

  function getColdmailReplyMailboxAccount(row) {
    return normalizeEmailAddress(
      row && (
        row.replyMailboxAccount ||
        row.replyMailbox ||
        row.lastColdmailReplyMailboxAccount ||
        row.outreachSentFromEmail ||
        row.sentFromEmail ||
        row.lastColdmailSenderEmail
      )
    );
  }

  function isWebdesignLeadMailbox(email) {
    return COLDMAIL_WEBDESIGN_LEAD_RECIPIENT_EMAILS.includes(normalizeEmailAddress(email));
  }

  function hasPositiveColdmailReplySignal(row) {
    if (!row || typeof row !== 'object') return false;
    if (normalizeString(row.coldmailReplyIntent).toLowerCase() === 'interested') return true;
    return Boolean(getColdmailReplyHistoryEntry(row));
  }

  function hasColdmailReplyInterestSignal(row) {
    if (!row || typeof row !== 'object') return false;
    if (hasPositiveColdmailReplySignal(row)) return true;
    if (normalizeString(row.lastColdmailReplyAt || row.lastColdmailReplyMessageKey)) return true;
    return false;
  }

  function isWebdesignLeadReplyFollowUpRow(row) {
    return Boolean(
      isWebdesignOutreachRow(row) &&
      hasPositiveColdmailReplySignal(row) &&
      isWebdesignLeadMailbox(getColdmailReplyMailboxAccount(row))
    );
  }

  function isColdmailReplyFollowUpRow(row, options = {}) {
    if (!row || typeof row !== 'object') return false;
    if (options.webdesignOnly) return isWebdesignLeadReplyFollowUpRow(row);
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return status === 'interesse' && hasColdmailReplyInterestSignal(row);
  }
  function getColdmailReplyFollowUpTimestampMs(row) {
    const historyEntry = getColdmailReplyHistoryEntry(row);
    return Math.max(
      parseTimestampMs(row && row.lastColdmailReplyAt),
      parseTimestampMs(historyEntry && historyEntry.date),
      parseTimestampMs(row && row.updatedAt)
    );
  }

  function buildColdmailReplyFollowUpItem(row, index) {
    const historyEntry = getColdmailReplyHistoryEntry(row);
    const replyAt = normalizeString(row.lastColdmailReplyAt || (historyEntry && historyEntry.date) || row.updatedAt);
    return {
      id: getRowId(row, index),
      bedrijf: getRowCompany(row),
      naam: getRowContact(row),
      email: getRowEmail(row),
      telefoon: getRowPhone(row),
      branche: normalizeString(row.branche || row.branch || ''),
      plaats: getRowCity(row),
      status: 'interesse',
      replyAt,
      subject: truncateText(normalizeString(row.lastColdmailReplySubject || (historyEntry && historyEntry.subject)), 240),
      preview: truncateText(normalizeString(row.lastColdmailReplyPreview || (historyEntry && historyEntry.preview)), 500),
      messageKey: normalizeString(row.lastColdmailReplyMessageKey || (historyEntry && historyEntry.messageKey)),
      mailboxAccount: getColdmailReplyMailboxAccount(row),
      campaignType: isWebdesignOutreachRow(row) ? 'webdesign' : '',
      outreachStatus: normalizeOutreachStatus(row.outreachStatus),
    };
  }

  async function listColdmailReplyFollowUps(input = {}) {
    const limit = parsePositiveInt(input.limit, 20, 1, 100);
    const campaignType = normalizeString(input.campaignType || input.campaign || input.source).toLowerCase();
    const webdesignOnly = ['webdesign', 'website', 'webdesign-leads', 'webdesign_replies'].includes(campaignType);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const items = rows
      .map((row, index) => ({ row, index, timestampMs: getColdmailReplyFollowUpTimestampMs(row) }))
      .filter(({ row }) => isColdmailReplyFollowUpRow(row, { webdesignOnly }))
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .map(({ row, index }) => buildColdmailReplyFollowUpItem(row, index));

    return {
      ok: true,
      total: items.length,
      limit,
      items: items.slice(0, limit),
    };
  }

  function getSenderLocationName(senderEmail) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    return SENDER_LOCATION_NAMES[address] || '';
  }

  function applySenderVariablesToTemplate(template, senderEmail) {
    const senderName = getSenderDisplayName(senderEmail);
    const senderLocation = getSenderLocationName(senderEmail);
    return normalizeString(template)
      .replace(/\{\{\s*(afzender|afzendernaam|sender|sendername)\s*\}\}/gi, senderName)
      .replace(/\{\{\s*(softora[_\s-]?(plaats|stad|locatie)|sender[_\s-]?(city|location))\s*\}\}/gi, senderLocation)
      .replace(
        /(Met vriendelijke groet,?\s*\n)(?:Serv[ée]\s+Creusen|Martijn\s+van\s+de\s+Ven)(\s*\n+\s*📍\s*)(?:(?:Alphen|Liempde)\b|\{\{\s*(?:stad|plaats|locatie|afzender[_\s-]?(?:plaats|stad|locatie))\s*\}\})/gi,
        `$1${senderName}$2{{stad}}`
      )
      .replace(/\bServe Creusen\b/g, 'Servé Creusen');
  }

  function personalizeTemplate(template, row, options = {}) {
    const company = getRowCompany(row) || 'uw bedrijf';
    const contact = getRowContact(row) || company;
    const domain = getRowDomain(row);
    const city = getRowCity(row) || 'uw regio';
    return applySenderVariablesToTemplate(template, options.senderEmail)
      .replace(/\{\{\s*bedrijf\s*\}\}/gi, company)
      .replace(/\{\{\s*naam\s*\}\}/gi, contact)
      .replace(/\{\{\s*(stad|plaats|locatie|afzender[_\s-]?(?:plaats|stad|locatie))\s*\}\}/gi, city)
      .replace(/\{\{\s*domein\s*\}\}/gi, domain || company)
      .replace(/\{\{\s*website\s*\}\}/gi, domain || company);
  }

  function buildMailText(body, row, id, input = {}) {
    return normalizeColdmailMailText(
      personalizeTemplate(body, row, { senderEmail: input.senderEmail })
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim(),
      row,
      id,
      input
    );
  }

  function normalizeSenderNameInMailText(text) {
    return normalizeString(text).replace(/\bServe Creusen\b/g, 'Servé Creusen');
  }

  function escapeRegexText(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatPinnedCity(city) {
    const cleanCity = normalizeString(city);
    return cleanCity ? `📍 ${cleanCity}` : '';
  }

  function ensurePinnedCityInMailText(text, city) {
    const cleanText = normalizeString(text);
    const cleanCity = normalizeString(city);
    if (!cleanText || !cleanCity || /📍/.test(cleanText)) return cleanText;
    const trailingCityLine = new RegExp(`(^|\\n)\\s*${escapeRegexText(cleanCity)}\\s*$`, 'i');
    if (trailingCityLine.test(cleanText)) {
      return cleanText.replace(trailingCityLine, `$1${formatPinnedCity(cleanCity)}`);
    }
    return `${cleanText}\n\n${formatPinnedCity(cleanCity)}`;
  }

  function hasImageVisibilityPs(text) {
    return COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(normalizeString(text));
  }

  function normalizeImageVisibilityPsInMailText(text, row, id, input = {}) {
    return normalizeString(text).replace(
      COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN,
      buildImageVisibilityPs(row, id, input)
    );
  }

  function ensureImageVisibilityPsInMailText(text, city, row, id, input = {}) {
    const cleanText = normalizeImageVisibilityPsInMailText(text, row, id, input);
    if (!cleanText || hasImageVisibilityPs(cleanText)) return cleanText;
    const cleanCity = normalizeString(city);
    const pinnedCity = formatPinnedCity(cleanCity);
    const lines = cleanText.split('\n');
    const cityMatchers = [pinnedCity, cleanCity]
      .filter(Boolean)
      .map((value) => new RegExp(`^\\s*${escapeRegexText(value)}\\s*$`, 'i'));
    let insertAt = -1;
    if (cityMatchers.length) {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (cityMatchers.some((matcher) => matcher.test(lines[index]))) {
          insertAt = index + 1;
          break;
        }
      }
    }
    if (insertAt === -1) {
      return `${cleanText}\n\n${buildImageVisibilityPs(row, id, input)}`;
    }
    lines.splice(insertAt, 0, '', buildImageVisibilityPs(row, id, input));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function removeLinkedinCtaFromMailText(text) {
    const cleanText = normalizeString(text);
    if (!cleanText || !MARTIJN_LINKEDIN_CTA_PATTERN.test(cleanText)) return cleanText;
    return cleanText
      .split('\n')
      .filter((line) => !MARTIJN_LINKEDIN_CTA_PATTERN.test(normalizeString(line)))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeColdmailMailText(text, row, id, input = {}) {
    const city = getRowCity(row) || 'uw regio';
    const cleanText = removeLinkedinCtaFromMailText(
      ensurePinnedCityInMailText(normalizeSenderNameInMailText(text), city)
    );
    if (!shouldUseWebdesignAssets(input, 'mail') && !hasImageVisibilityPs(cleanText)) return cleanText;
    return ensureImageVisibilityPsInMailText(cleanText, city, row, id, input);
  }

  function selectColdmailTemplateVariant(variants, row, item, senderEmail, reference, kind) {
    const list = normalizeColdmailTemplateVariants(variants);
    if (!list.length) return '';
    return list[0];
  }

  function appendColdmailOptOutText(text, unsubscribeUrl = '') {
    const cleanText = normalizeString(text);
    const cleanUrl = normalizeString(unsubscribeUrl);
    const optOutText = cleanUrl
      ? `${COLDMAIL_OPT_OUT_TEXT_PREFIX}: ${cleanUrl}`
      : COLDMAIL_OPT_OUT_LABEL;
    if (!cleanText) return optOutText;
    if (!shouldAppendColdmailOptOutText(cleanText)) return cleanText;
    return `${cleanText}\n\n${optOutText}`;
  }

  function shouldAppendColdmailOptOutText(text) {
    return !/(?:geen webdesign willen ontvangen\?\s*laat het me weten!?|had je liever geen webdesign willen ontvangen\?\s*laat het me hier weten!?|past dit niet\?\s*laat het me hier weten|liever geen e-mails meer ontvangen|geen e-mails meer ontvangen.*https?:\/\/|afmelden:\s*https?:\/\/|\/afmelden\?t=|\/coldmailing\/afmelden\?t=|unsubscribe:\s*https?:\/\/)/i.test(
      normalizeString(text)
    );
  }

  function buildColdmailReference(row, id) {
    const seed = sanitizeFilename(id || getRowCompany(row) || getRowEmail(row) || 'mail', 'mail')
      .replace(/-/g, '')
      .slice(0, 8)
      .toUpperCase();
    const stamp = now().toISOString().slice(0, 10).replace(/-/g, '');
    return `SF-${stamp}-${seed || 'MAIL'}`;
  }

  function encodeBase64Url(value) {
    return Buffer.from(String(value || ''), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function decodeBase64Url(value) {
    const normalized = normalizeString(value).replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  function getColdmailUnsubscribeSecret() {
    return normalizeString(coldmailUnsubscribeSecret || smtpPass || imapPass || mailFromAddress || 'softora-coldmail');
  }

  function getColdmailTrackingSecret() {
    return normalizeString(coldmailTrackingSecret || coldmailUnsubscribeSecret || smtpPass || imapPass || mailFromAddress || 'softora-coldmail-open');
  }

  function getColdmailPreviewImageSecret() {
    return normalizeString(env.COLDMAIL_PREVIEW_IMAGE_SECRET || DEFAULT_COLDMAIL_PREVIEW_IMAGE_SECRET);
  }

  function signColdmailUnsubscribePayload(encodedPayload) {
    return crypto
      .createHmac('sha256', getColdmailUnsubscribeSecret())
      .update(normalizeString(encodedPayload))
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function signColdmailPreviewImagePayload(encodedPayload) {
    return crypto
      .createHmac('sha256', getColdmailPreviewImageSecret())
      .update(normalizeString(encodedPayload))
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function signColdmailOpenTrackingPayload(encodedPayload) {
    return crypto
      .createHmac('sha256', getColdmailTrackingSecret())
      .update(normalizeString(encodedPayload))
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function buildColdmailUnsubscribeToken(row, id, reference) {
    const payload = {
      v: 1,
      id: normalizeString(id || getRowId(row, 0)),
      email: getRowEmail(row),
      ref: normalizeString(reference),
      ts: now().toISOString(),
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signColdmailUnsubscribePayload(encodedPayload)}`;
  }

  function createColdmailTrackingId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return crypto.randomBytes(16).toString('hex');
  }

  function buildColdmailOpenTrackingToken(row, id, reference, trackingId) {
    const payload = {
      v: 1,
      id: normalizeString(id || getRowId(row, 0)),
      email: getRowEmail(row),
      ref: normalizeString(reference),
      tid: normalizeString(trackingId),
      ts: now().toISOString(),
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signColdmailOpenTrackingPayload(encodedPayload)}`;
  }

  function verifyColdmailUnsubscribeToken(token) {
    const cleanToken = normalizeString(token);
    const parts = cleanToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    const expected = signColdmailUnsubscribePayload(parts[0]);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(parts[1]);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    const payload = safeJsonParse(decodeBase64Url(parts[0]), {});
    const email = normalizeEmailAddress(payload && payload.email);
    if (!payload || typeof payload !== 'object' || !email) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    return {
      v: Number(payload.v || 1),
      id: normalizeString(payload.id),
      email,
      ref: normalizeString(payload.ref),
      ts: normalizeString(payload.ts),
    };
  }

  function verifyColdmailPreviewImageSignature(token) {
    const cleanToken = normalizeString(token);
    const parts = cleanToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    const expected = signColdmailPreviewImagePayload(parts[0]);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(parts[1]);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    const payload = safeJsonParse(decodeBase64Url(parts[0]), {});
    const email = normalizeEmailAddress(payload && payload.email);
    if (!payload || typeof payload !== 'object' || !email) {
      const error = new Error('Deze afmeldlink is ongeldig.');
      error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
      throw error;
    }
    return {
      v: Number(payload.v || 1),
      id: normalizeString(payload.id),
      email,
      ref: normalizeString(payload.ref),
      ts: normalizeString(payload.ts),
    };
  }

  function verifyColdmailOpenTrackingToken(token) {
    const cleanToken = normalizeString(token);
    const parts = cleanToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      const error = new Error('Deze open-trackinglink is ongeldig.');
      error.code = 'INVALID_OPEN_TRACKING_TOKEN';
      throw error;
    }
    const expected = signColdmailOpenTrackingPayload(parts[0]);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(parts[1]);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      const error = new Error('Deze open-trackinglink is ongeldig.');
      error.code = 'INVALID_OPEN_TRACKING_TOKEN';
      throw error;
    }
    const payload = safeJsonParse(decodeBase64Url(parts[0]), {});
    const email = normalizeEmailAddress(payload && payload.email);
    const trackingId = normalizeString(payload && payload.tid);
    if (!payload || typeof payload !== 'object' || !email || !trackingId) {
      const error = new Error('Deze open-trackinglink is ongeldig.');
      error.code = 'INVALID_OPEN_TRACKING_TOKEN';
      throw error;
    }
    return {
      v: Number(payload.v || 1),
      id: normalizeString(payload.id),
      email,
      ref: normalizeString(payload.ref),
      trackingId,
      ts: normalizeString(payload.ts),
    };
  }

  function normalizePublicBaseUrl(value) {
    const raw = normalizeString(value).replace(/\/+$/g, '');
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      return parsed.origin;
    } catch (_) {
      return '';
    }
  }

  function buildColdmailUnsubscribeUrl(row, id, reference, input = {}) {
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailUnsubscribeToken(row, id, reference);
    return `${baseUrl}${COLDMAIL_UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;
  }

  function buildColdmailOneClickUnsubscribeUrl(row, id, reference, input = {}) {
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailUnsubscribeToken(row, id, reference);
    return `${baseUrl}/api/coldmailing/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  function buildColdmailOpenTrackingUrl(row, id, reference, trackingId, input = {}) {
    const cleanTrackingId = normalizeString(trackingId);
    if (!cleanTrackingId) return '';
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailOpenTrackingToken(row, id, reference, cleanTrackingId);
    const params = new URLSearchParams();
    params.set('tid', cleanTrackingId);
    params.set('token', token);
    return `${baseUrl}/api/coldmailing/open.gif?${params.toString()}`;
  }

  function isColdmailOpenTrackingConfigured() {
    return Boolean(getColdmailTrackingSecret());
  }

  function getColdmailListUnsubscribeHeader(senderEmail, row, id, reference, input = {}) {
    const replyTo = normalizeEmailAddress(getColdmailReplyToAddress(senderEmail));
    const parts = [];
    if (isLikelyValidEmail(replyTo)) {
      parts.push(`<mailto:${replyTo}?subject=${encodeURIComponent('Afmelden')}>`);
    }
    const oneClickUrl = buildColdmailOneClickUnsubscribeUrl(row, id, reference, input);
    if (oneClickUrl) parts.push(`<${oneClickUrl}>`);
    return parts.join(', ');
  }

  function getColdmailListUnsubscribePostHeader(row, id, reference, input = {}) {
    return buildColdmailOneClickUnsubscribeUrl(row, id, reference, input)
      ? 'List-Unsubscribe=One-Click'
      : '';
  }

  function buildColdmailPreviewImageToken(row, id, reference, type = 'webdesign') {
    const payload = {
      v: 2,
      id: normalizeString(id || getRowId(row, 0)),
      email: getRowEmail(row),
      ref: normalizeString(reference),
      pv: 2,
      scope: 'preview-image',
      type: normalizeString(type || 'webdesign').toLowerCase() === 'mockup' ? 'mockup' : 'webdesign',
      ts: now().toISOString(),
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signColdmailPreviewImagePayload(encodedPayload)}`;
  }

  function verifyColdmailPreviewImageToken(token) {
    const decoded = safeJsonParse(decodeBase64Url(normalizeString(token).split('.')[0]), {});
    const payload = normalizeString(decoded && decoded.scope) === 'preview-image'
      ? verifyColdmailPreviewImageSignature(token)
      : verifyColdmailUnsubscribeToken(token);
    const type = normalizeString(decoded && decoded.type).toLowerCase();
    return {
      ...payload,
      type: type === 'mockup' ? 'mockup' : 'webdesign',
    };
  }

  function buildColdmailPreviewImageUrl(row, id, reference, input = {}, type = 'webdesign') {
    return buildColdmailPreviewImageLink(row, id, reference, input, type).url;
  }

  function buildColdmailPreviewImageLink(row, id, reference, input = {}, type = 'webdesign') {
    const baseUrl =
      normalizePublicBaseUrl(input.publicBaseUrl || mailPublicBaseUrl) ||
      'https://www.softora.nl';
    const token = buildColdmailPreviewImageToken(row, id, reference, type);
    return {
      token,
      type: normalizeString(type || 'webdesign').toLowerCase() === 'mockup' ? 'mockup' : 'webdesign',
      url: `${baseUrl}${COLDMAIL_PREVIEW_IMAGE_PATH}?t=${encodeURIComponent(token)}`,
    };
  }

  function getColdmailWebdesignImageDelivery(input = {}) {
    const explicit = normalizeString(input.webdesignImageDelivery || input.imageDelivery).toLowerCase();
    const configured = normalizeString(env.COLDMAIL_WEBDESIGN_IMAGE_DELIVERY || env.WEBDESIGN_IMAGE_DELIVERY).toLowerCase();
    const value = explicit || configured || DEFAULT_COLDMAIL_WEBDESIGN_IMAGE_DELIVERY;
    if (['cid', 'inline', 'embedded'].includes(value)) return 'cid';
    if (['attachment', 'attachments', 'attachment-only', 'attachment_only'].includes(value)) return 'attachment';
    if (value === 'remote') return 'remote';
    if (['link', 'link-only', 'link_only', 'none', 'off', 'false', '0'].includes(value)) return 'link';
    return DEFAULT_COLDMAIL_WEBDESIGN_IMAGE_DELIVERY;
  }

  function appendColdmailReference(text, reference) {
    const cleanText = normalizeString(text);
    const cleanReference = normalizeString(reference);
    if (!cleanReference) return cleanText;
    return `${cleanText}\n\nReferentie: ${cleanReference}`;
  }

  function appendHiddenColdmailReferenceHtml(html, reference) {
    const cleanReference = normalizeString(reference);
    if (!cleanReference) return html;
    return `${html}\n<!-- Softora referentie ${escapeHtml(cleanReference)} -->`;
  }

  function appendColdmailOptOutHtml(html, unsubscribeUrl = '') {
    const cleanUrl = normalizeString(unsubscribeUrl);
    if (!cleanUrl) return html;
    return `${html}\n<p style="margin:18px 0 0 0;font-size:11px;line-height:1.35;color:#9ca3af;"><a href="${escapeHtml(
      cleanUrl
    )}" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(COLDMAIL_OPT_OUT_LABEL)}</a></p>`;
  }

  function appendColdmailOpenTrackingPixelHtml(html, trackingUrl = '') {
    const cleanUrl = normalizeString(trackingUrl);
    if (!cleanUrl) return html;
    return `${html}\n<img src="${escapeHtml(cleanUrl)}" alt="" width="1" height="1" style="display:none!important;width:1px!important;height:1px!important;opacity:0!important;overflow:hidden!important;border:0!important;" />`;
  }

  function escapeHtml(value) {
    return normalizeString(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function parseDataUrlImage(value) {
    const match = normalizeString(value).match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    return {
      contentType: match[1].toLowerCase(),
      content: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
    };
  }

  async function resolveImageAttachment(value) {
    const parsed = parseDataUrlImage(value);
    if (parsed) return parsed;
    const url = normalizeString(value);
    if (!/^https:\/\//i.test(url) || typeof fetch !== 'function') return null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) return null;
      const contentType = normalizeString(response.headers && response.headers.get && response.headers.get('content-type')).split(';')[0].toLowerCase();
      if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType)) return null;
      const arrayBuffer = await response.arrayBuffer();
      const content = Buffer.from(arrayBuffer);
      if (!content.length || content.length > 10 * 1024 * 1024) return null;
      return { contentType, content };
    } catch (error) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function optimizePreviewImageForEmail(image) {
    const contentType = normalizeString(image && image.contentType).split(';')[0].toLowerCase();
    const content = image && image.content;
    if (
      !Buffer.isBuffer(content) ||
      content.length < COLDMAIL_PREVIEW_IMAGE_OPTIMIZE_MIN_BYTES ||
      !/^image\/(?:png|jpe?g|webp)$/i.test(contentType) ||
      typeof loadPreviewImageSharp !== 'function'
    ) {
      return image;
    }

    try {
      const sharp = loadPreviewImageSharp();
      if (typeof sharp !== 'function') return image;
      const metadata = await sharp(content, { limitInputPixels: 45_000_000 }).metadata();
      const sourceWidth = Number(metadata && metadata.width) || 0;
      const shouldResize = sourceWidth > COLDMAIL_PREVIEW_IMAGE_MAX_WIDTH;
      const transformer = sharp(content, { limitInputPixels: 45_000_000 }).rotate();
      if (shouldResize) {
        transformer.resize({
          width: COLDMAIL_PREVIEW_IMAGE_MAX_WIDTH,
          withoutEnlargement: true,
        });
      }
      const optimized = await transformer
        .jpeg({
          quality: COLDMAIL_PREVIEW_IMAGE_JPEG_QUALITY,
          mozjpeg: true,
        })
        .toBuffer();
      if (!Buffer.isBuffer(optimized) || !optimized.length) return image;
      if (!shouldResize && contentType === 'image/jpeg' && optimized.length >= content.length) return image;
      return {
        ...image,
        content: optimized,
        contentType: 'image/jpeg',
      };
    } catch (error) {
      return image;
    }
  }

  function getPreviewImageCacheKey(token, type = '') {
    return previewImageCache.getPreviewImageCacheKey(token, type);
  }

  function getCachedPreviewImage(cacheKey) {
    return previewImageCache.getCachedPreviewImage(cacheKey, {
      ttlMs: COLDMAIL_PREVIEW_IMAGE_CACHE_TTL_MS,
    });
  }

  function rememberPreviewImage(cacheKey, image) {
    return previewImageCache.rememberPreviewImage(cacheKey, image, {
      limit: COLDMAIL_PREVIEW_IMAGE_CACHE_LIMIT,
    });
  }

  function getImageExtension(contentType) {
    if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg';
    if (contentType === 'image/webp') return 'webp';
    if (contentType === 'image/gif') return 'gif';
    return 'png';
  }

  function sanitizeFilename(value, fallback = 'webdesign') {
    const normalized = normalizeString(value)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return normalized || fallback;
  }

  function filenameForImage(originalFilename, contentType, fallback = 'webdesign') {
    return `${sanitizeFilename(originalFilename, fallback)}.${getImageExtension(contentType)}`;
  }

  async function preparePreviewImageForEmail(image, type = 'webdesign') {
    if (!image || !Buffer.isBuffer(image.content)) return image;
    const framed = type === 'mockup'
      ? image
      : await removeDecorativeWebdesignFrameForEmail(image);
    const prepared = type === 'mockup'
      ? framed
      : await fitWebdesignPreviewForEmail(framed);
    return optimizePreviewImageForEmail(prepared);
  }

  function mergePreparedImage(original, prepared, fallbackName = 'webdesign') {
    if (!original || !prepared || !Buffer.isBuffer(prepared.content)) return original;
    return {
      ...original,
      ...prepared,
      filename: filenameForImage(original.filename || fallbackName, prepared.contentType, fallbackName),
      alt: original.alt,
      cid: original.cid,
    };
  }

  function buildWebdesignImageAttachments(webdesignPhoto, options = {}) {
    if (!webdesignPhoto || !Buffer.isBuffer(webdesignPhoto.content)) return undefined;
    const inline = options.inline === true;
    const webdesignImage = options.webdesignImage || webdesignPhoto;
    const mockupImage = options.mockupImage || webdesignPhoto.mockup;
    const buildAttachment = (image, original, fallbackName) => {
      if (!image || !Buffer.isBuffer(image.content)) return null;
      const attachment = {
        filename: image.filename || filenameForImage(fallbackName, image.contentType, fallbackName),
        content: image.content,
        contentType: image.contentType,
        contentDisposition: inline ? 'inline' : 'attachment',
      };
      if (inline && original && original.cid) attachment.cid = original.cid;
      return attachment;
    };
    const attachments = [
      buildAttachment(webdesignImage, webdesignPhoto, 'webdesign'),
      options.includeMockup === false
        ? null
        : buildAttachment(mockupImage, webdesignPhoto.mockup, 'device-mockup'),
    ].filter(Boolean);
    return attachments.length ? attachments : undefined;
  }

  function extractPublicWebdesignPreviewLinkFromPs(line) {
    const cleanLine = normalizeString(line);
    const match = cleanLine.match(/(https?:\/\/[^\s<>"']*\/webdesign\/[a-z0-9-]+(?:\/concept)?(?:\?[^)\s<>"']*)?|\/?webdesign\/[a-z0-9-]+(?:\/concept)?(?:\?[^)\s<>"']*)?)/i);
    if (!match) return null;
    const rawHref = match[1].replace(/[),.;!?]+$/g, '');
    const absoluteHref = /^https?:\/\//i.test(rawHref)
      ? rawHref
      : `https://www.softora.nl/${rawHref.replace(/^\/+/, '')}`;
    const href = absoluteHref
      .replace(/\/webdesign\/([^/?#]+)(?:\/concept)?(?=([?#]|$))/i, '/webdesign/$1')
      .replace(/#.*$/g, '');
    let label = rawHref.replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+/, '');
    try {
      label = new URL(href).pathname.replace(/^\/+/, '') || label;
    } catch (_) {}
    return {
      href,
      label,
      start: match.index || 0,
      end: (match.index || 0) + match[1].length,
    };
  }

  function renderImageVisibilityPsHtmlLine(line, options = {}) {
    const cleanLine = normalizeString(line);
    const publicLink = extractPublicWebdesignPreviewLinkFromPs(cleanLine) || {
      href: normalizeString(options.webdesignPreviewUrl),
    };
    if (!publicLink.href) {
      return escapeHtml(COLDMAIL_IMAGE_VISIBILITY_PS);
    }
    return `Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze <a href="${escapeHtmlAttribute(
      publicLink.href
    )}" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;font-weight:700;">link</a> bekijken 🎨`;
  }

  function renderColdmailDomainToken(rawValue) {
    const value = normalizeString(rawValue).replace(/[.,;:!?]+$/g, '');
    if (!value || !/\.[a-z]{2,}(?:\/|$)/i.test(value)) return escapeHtml(rawValue);
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;white-space:nowrap;word-break:keep-all;overflow-wrap:normal;">${escapeHtml(value.replace(/^https?:\/\//i, ''))}</a>${escapeHtml(String(rawValue || '').slice(value.length))}`;
  }

  function renderColdmailHtmlText(line) {
    const source = String(line || '');
    const domainPattern = /(^|[\s(])((?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})(?:\/[^\s<>()]*)?)/gi;
    let html = '';
    let lastIndex = 0;
    for (const match of source.matchAll(domainPattern)) {
      const prefix = match[1] || '';
      const token = match[2] || '';
      const tokenStart = (match.index || 0) + prefix.length;
      const previousChar = tokenStart > 0 ? source[tokenStart - 1] : '';
      if (previousChar === '@') continue;
      html += escapeHtml(source.slice(lastIndex, tokenStart));
      html += renderColdmailDomainToken(token);
      lastIndex = tokenStart + token.length;
    }
    html += escapeHtml(source.slice(lastIndex));
    return html;
  }

  function renderColdmailHtmlLine(line, options = {}) {
    const cleanLine = normalizeString(line);
    if (COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(cleanLine)) {
      return renderImageVisibilityPsHtmlLine(cleanLine, options);
    }
    return renderColdmailHtmlText(cleanLine);
  }

  function isColdmailLinkOnlyImageArtifactLine(line) {
    const cleanLine = normalizeString(line);
    if (!cleanLine) return false;
    if (cleanLine === COLDMAIL_MOCKUP_CAPTION) return true;
    if (/^\[image:\s*[^\]]*(?:webdesign|device\s*mockup|mockup)[^\]]*\]$/i.test(cleanLine)) {
      return true;
    }
    return /^<img\b/i.test(cleanLine) || /\bcid:webdesign[-\w@.]+/i.test(cleanLine);
  }

  function stripColdmailLinkOnlyImageArtifacts(text) {
    const value = String(text || '');
    if (!value) return '';
    return value
      .split(/\r?\n/)
      .filter((line) => !isColdmailLinkOnlyImageArtifactLine(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function assertColdmailLinkOnlyMailIsImageFree(mail = {}) {
    const combined = [mail.text, mail.html].map((value) => String(value || '')).join('\n');
    const attachments = Array.isArray(mail.attachments) ? mail.attachments : [];
    const hasImageArtifact =
      attachments.length > 0 ||
      /<img\b/i.test(combined) ||
      /\bcid:webdesign[-\w@.]+/i.test(combined) ||
      /\/coldmailing\/webdesign-foto\?t=/i.test(combined) ||
      /\[image:\s*[^\]]*(?:webdesign|device\s*mockup|mockup)[^\]]*\]/i.test(combined) ||
      combined.includes(COLDMAIL_MOCKUP_CAPTION);
    if (!hasImageArtifact) return;
    const error = new Error('Link-only webdesignmail bevat nog beeldmateriaal of beeld-placeholderregels.');
    error.code = 'COLDMAIL_WEBDESIGN_LINK_ONLY_VIOLATION';
    error.status = 500;
    throw error;
  }

  function assertColdmailAttachmentOnlyMail(mail = {}) {
    const html = String(mail.html || '');
    const attachments = Array.isArray(mail.attachments) ? mail.attachments : [];
    const attachment = attachments[0];
    const invalid =
      /<img\b/i.test(html) ||
      /\bcid:/i.test(html) ||
      /\/coldmailing\/webdesign-foto\?t=/i.test(html) ||
      attachments.length !== 1 ||
      normalizeString(attachment && attachment.contentDisposition).toLowerCase() !== 'attachment' ||
      Boolean(attachment && attachment.cid);
    if (!invalid) return;
    const error = new Error('Attachment-only webdesignmail bevat inline beeld of geen enkele geldige designbijlage.');
    error.code = 'COLDMAIL_WEBDESIGN_ATTACHMENT_ONLY_VIOLATION';
    error.status = 500;
    throw error;
  }

  function toHtml(text, options = {}) {
    const paragraphStyle = 'margin:0 0 18px 0;font-family:Arial,sans-serif;font-size:17px;line-height:27px;color:#1a1a2e;max-width:100%;overflow-wrap:anywhere;word-break:normal;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;text-size-adjust:100%;';
    const body = normalizeString(text)
      .split(/\n{2,}/)
      .map((paragraph) => {
        const cleanParagraph = normalizeString(paragraph);
        if (COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(cleanParagraph)) {
          return `<p style="${paragraphStyle}">${renderImageVisibilityPsHtmlLine(cleanParagraph, options)}</p>`;
        }
        return `<p style="${paragraphStyle}">${paragraph
            .split('\n')
            .map((line) => renderColdmailHtmlLine(line, options))
            .join('<br>')}</p>`;
      })
      .join('\n');
    return `<div class="softora-webdesign-email-body softora-coldmail-body" data-softora-template-version="${WEBDESIGN_EMAIL_TEMPLATE_VERSION}" style="font-family:Arial,sans-serif;font-size:17px;line-height:27px;color:#1a1a2e;max-width:${COLDMAIL_EMAIL_CONTENT_MAX_WIDTH}px;width:100%;min-width:0;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;text-size-adjust:100%;">${body}</div>`;
  }

  function getWebdesignPhotoSource(photo) {
    if (!photo || typeof photo !== 'object') return '';
    return normalizeString(
      photo.websitePhoto ||
        photo.websitePhotoUrl ||
        photo.signedUrl ||
        (photo.storage && photo.storage.signedUrl)
    );
  }

  function getWebdesignMockupSource(photo) {
    if (!photo || typeof photo !== 'object') return '';
    return normalizeString(
      photo.websiteMockup ||
        photo.websiteMockupUrl ||
        photo.mockupUrl ||
        photo.signedMockupUrl ||
        (photo.mockupStorage && photo.mockupStorage.signedUrl)
    );
  }

  function isApprovedWebdesignMockupRecord(photo) {
    return isResolvableWebsitePhotoValue(getWebdesignMockupSource(photo));
  }
  function collectPreviewImageDataOpsIdentifiers(payload = {}, row = null, photo = null) {
    const values = [
      payload.id,
      payload.email,
      row && (row.id || row.customerId || row.databaseId),
      row && (row.identityKey || row.identity_key),
      row && getRowCompany(row),
      row && getRowDomain(row),
      photo && (photo.id || photo.customerId || photo.customer_id),
      photo && photo.identityKey,
      photo && (photo.websitePhotoName || photo.photoName || photo.fileName),
      photo && (photo.websiteMockupName || photo.mockupName),
    ];
    if (row) values.push(...buildRowIdentityKeys(row));
    return Array.from(new Set(values.map(normalizeString).filter(Boolean)));
  }

  function getDomainFromEmail(value) {
    const email = normalizeEmailAddress(value);
    const domain = email.includes('@') ? email.split('@').pop() : '';
    return normalizeString(domain).replace(/^www\./i, '');
  }

  function collectPreviewImageCustomerIdentityLookupKeys(payload = {}, row = null) {
    const keys = [];
    const seen = new Set();
    const add = (type, value) => {
      const keyType = normalizeString(type).toLowerCase();
      const keyValue = normalizeString(value).toLowerCase();
      const id = `${keyType}:${keyValue}`;
      if (!keyType || !keyValue || seen.has(id)) return;
      seen.add(id);
      keys.push({ type: keyType, value: keyValue });
    };
    const email = normalizeEmailAddress(
      payload.email ||
        (row && (row.email || row.contactEmail || row.mail))
    );
    add('email', email);
    add('domain', getDomainFromEmail(email));
    add('domain', getRowDomain(row || {}));
    return keys;
  }

  function collectPreviewImageCustomerMatchTerms(payload = {}, row = null, photo = null) {
    const values = [
      payload.id,
      payload.email,
      getDomainFromEmail(payload.email),
      row && (row.id || row.customerId || row.databaseId),
      row && getRowEmail(row),
      row && getRowDomain(row),
      row && getRowCompany(row),
      photo && (photo.id || photo.customerId || photo.customer_id),
      photo && photo.identityKey,
    ];
    return new Set(values.map(normalizeString).map((value) => value.toLowerCase()).filter(Boolean));
  }

  function customerMatchesPreviewImageTerms(customer, terms) {
    if (!customer || !terms || !terms.size) return false;
    const values = [
      customer.id,
      customer.customerId,
      customer.databaseId,
      getRowEmail(customer),
      getRowDomain(customer),
      getDomainFromEmail(getRowEmail(customer)),
      getRowCompany(customer),
      customer.identityKey,
    ].map(normalizeString).map((value) => value.toLowerCase()).filter(Boolean);
    return values.some((value) => terms.has(value));
  }

  async function collectPreviewImageExpandedDataOpsIdentifiers(payload = {}, row = null, photo = null) {
    const identifiers = new Set(collectPreviewImageDataOpsIdentifiers(payload, row, photo));
    if (!dataOpsStore) return Array.from(identifiers);

    if (typeof dataOpsStore.listCustomerIdentityKeys === 'function') {
      const keys = collectPreviewImageCustomerIdentityLookupKeys(payload, row);
      if (keys.length) {
        try {
          const result = await dataOpsStore.listCustomerIdentityKeys(keys);
          if (result && result.ok && Array.isArray(result.data)) {
            result.data.forEach((item) => {
              const customerId = normalizeString(item && (item.customer_id || item.customerId));
              if (customerId) identifiers.add(customerId);
            });
          }
        } catch (error) {
          if (logger && typeof logger.warn === 'function') {
            logger.warn('[Coldmail][preview-image-identity-fallback]', error?.message || error);
          }
        }
      }
    }

    if (typeof dataOpsStore.listCustomers === 'function') {
      const terms = collectPreviewImageCustomerMatchTerms(payload, row, photo);
      try {
        const customers = await dataOpsStore.listCustomers({
          bypassReadFailureCooldown: true,
          suppressReadFailureCooldown: true,
          suppressTransientReadFailureLog: true,
          suppressStaleReadCacheLog: true,
        });
        (Array.isArray(customers) ? customers : []).forEach((customer) => {
          if (!customerMatchesPreviewImageTerms(customer, terms)) return;
          const customerId = normalizeString(customer && (customer.id || customer.customerId || customer.databaseId));
          if (customerId) identifiers.add(customerId);
          buildRowIdentityKeys(customer).forEach((identityKey) => {
            if (identityKey) identifiers.add(identityKey);
          });
          const domain = getRowDomain(customer);
          if (domain) identifiers.add(domain);
          const company = getRowCompany(customer);
          if (company) identifiers.add(company);
        });
      } catch (error) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[Coldmail][preview-image-customer-fallback]', error?.message || error);
        }
      }
    }

    return Array.from(identifiers).map(normalizeString).filter(Boolean);
  }

  async function resolvePreviewImageFromDataOps(payload = {}, row = null, photo = null) {
    if (!dataOpsStore || typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function') return null;
    const identifiers = await collectPreviewImageExpandedDataOpsIdentifiers(payload, row, photo);
    if (!identifiers.length) return null;
    let entries = null;
    try {
      entries = await dataOpsStore.listDesignPhotosWithSignedUrls({
        identifiers,
        maxMatches: 12,
        expiresInSeconds: 24 * 60 * 60,
        suppressReadFailureCooldown: true,
        suppressTransientReadFailureLog: true,
        suppressStaleReadCacheLog: true,
      });
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[Coldmail][preview-image-dataops-fallback]', error?.message || error);
      }
      return null;
    }
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return null;
    const expectedIds = new Set(identifiers.map((value) => value.toLowerCase()));
    const preferred =
      list.find((entry) => expectedIds.has(normalizeString(entry && entry.customerId).toLowerCase())) ||
      list.find((entry) => expectedIds.has(normalizeString(entry && entry.identityKey).toLowerCase())) ||
      list[0];
    const source = payload.type === 'mockup'
      ? normalizeString(preferred && preferred.websiteMockupUrl)
      : normalizeString(preferred && preferred.websitePhotoUrl);
    if (!source) return null;
    return resolveImageAttachment(source);
  }


  function appendWebdesignImageHtml(html, attachment, options = {}) {
    const imageSrc = normalizeString(attachment && (attachment.src || (attachment.cid ? `cid:${attachment.cid}` : '')));
    if (!attachment || !imageSrc) return html;
    const optOutText = normalizeString(options.optOutText || '');
    const optOutUrl = normalizeString(options.optOutUrl || '');
    const optOutHtml = optOutText
      ? `\n<p style="margin:7px 0 0 0;font-size:11px;line-height:1.35;color:#9ca3af;">${
          optOutUrl
            ? `<a href="${escapeHtml(optOutUrl)}" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(optOutText)}</a>`
            : escapeHtml(optOutText)
        }</p>`
      : '';
    const imageBlockHtml = renderWebdesignImageSection(attachment, {
      mockupImage: attachment.mockup,
      caption: COLDMAIL_MOCKUP_CAPTION,
      margin: '24px 0 0 0',
    });
    return `${html}${imageBlockHtml}${optOutHtml}`;
  }

  async function loadColdmailReplyState() {
    const state = await getUiStateValues(coldmailReplyScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const parsed = safeJsonParse(values[coldmailReplyKey] || '{}', {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? {
          processed: parsed.processed && typeof parsed.processed === 'object' ? parsed.processed : {},
        }
      : { processed: {} };
  }

  async function saveColdmailReplyState(replyState, actor = 'coldmail-auto-reply') {
    const processed = replyState && replyState.processed && typeof replyState.processed === 'object'
      ? replyState.processed
      : {};
    const entries = Object.entries(processed).slice(-500);
    await setUiStateValues(
      coldmailReplyScope,
      {
        [coldmailReplyKey]: JSON.stringify({ processed: Object.fromEntries(entries) }),
      },
      {
        source: 'coldmail-auto-reply',
        actor,
      }
    );
  }

  function getInboundMessageProcessedKey(parsedMail, message) {
    const messageId = normalizeMessageIdToken(parsedMail && parsedMail.messageId);
    if (messageId) return `message:${messageId}`;
    const from = getParsedMailFromEmail(parsedMail);
    return [
      'fallback',
      from.address,
      normalizeString(parsedMail && parsedMail.subject).toLowerCase(),
      message && message.uid ? `uid:${message.uid}` : '',
    ]
      .filter(Boolean)
      .join('|');
  }

  async function generateColdmailAutoReplyWithOpenAi({ row, inboundText, inboundSubject, fromName, senderEmail }) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const error = new Error('OPENAI_API_KEY ontbreekt');
      error.code = 'OPENAI_NOT_CONFIGURED';
      error.status = 503;
      throw error;
    }
    const model = normalizeString(coldmailAutoReplyModel) || 'gpt-5.5-pro';
    const company = getRowCompany(row);
    const contact = getRowContact(row);
    const website = getRowDomain(row);
    const selectedSenderEmail = normalizeEmailAddress(senderEmail || mailFromAddress || smtpUser || imapUser);
    const senderName = getSenderDisplayName(selectedSenderEmail);
    const system = [
      `Je bent ${senderName || 'Softora'} van Softora.`,
      'Je reageert automatisch op replies op coldmailcampagnes.',
      'Schrijf in natuurlijk Nederlands, kort, menselijk en professioneel.',
      'Klink niet als een chatbot en gebruik geen markdown.',
      'Doel: help de prospect verder en stuur rustig richting een korte kennismaking of concrete vervolgstap.',
      'Verzin geen prijzen, garanties, afspraken of technische details die niet in de context staan.',
      'Als iemand geen interesse heeft, reageer beleefd en rond af zonder door te pushen.',
      'Geef alleen de mailtekst terug, zonder onderwerpregel.',
    ].join('\n');
    const payload = {
      prospect: {
        company,
        contact,
        email: getRowEmail(row),
        website,
        branche: normalizeString(row.branche || row.branch || ''),
      },
      inbound: {
        fromName: normalizeString(fromName),
        subject: truncateText(inboundSubject, 240),
        text: truncateText(inboundText, 4000),
      },
      sender: {
        name: senderName || 'Softora',
        email: selectedSenderEmail,
        company: 'Softora',
      },
    };
    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...buildOpenAiContextHeaders({ env, openAiApiBaseUrl }),
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
      65000
    );
    if (!response.ok) {
      const error = new Error(`OpenAI coldmail auto-reply mislukt (${response.status})`);
      error.code = 'OPENAI_AUTO_REPLY_FAILED';
      error.status = response.status;
      error.data = data;
      throw error;
    }
    const reply = truncateText(extractOpenAiReplyText(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content), 6000);
    if (!reply) {
      const error = new Error('OpenAI gaf een lege auto-reply terug.');
      error.code = 'EMPTY_AI_REPLY';
      error.status = 502;
      throw error;
    }
    return { text: reply, model: normalizeString(data && data.model) || model, usage: data && data.usage ? data.usage : null };
  }

  function buildReplySubject(subject) {
    const value = normalizeString(subject || 'Uw reactie');
    return /^re\s*:/i.test(value) ? value : `Re: ${value}`;
  }

  async function sendColdmailAutoReply({ parsedMail, row, senderEmail, replyText }) {
    const delivery = getSenderSmtpTransport(senderEmail);
    const transporter = delivery && delivery.transporter;
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }
    const from = getParsedMailFromEmail(parsedMail);
    const messageId = normalizeString(parsedMail && parsedMail.messageId);
    const references = collectMessageReferenceHeader(parsedMail);
    const mail = {
      from: formatMailFromHeader(senderEmail, delivery.account),
      to: from.address,
      replyTo: getColdmailReplyToAddress(senderEmail),
      subject: buildReplySubject(parsedMail && parsedMail.subject),
      text: replyText,
      inReplyTo: messageId || undefined,
      references: references || undefined,
    };
    const info = await transporter.sendMail(mail);
    await saveSentCopy(senderEmail, mail, info, delivery.account);
    return info;
  }

  function buildCustomerPhotoDataKey(row) {
    const id = getExplicitRowId(row);
    if (!id) return '';
    return `softora_database_photo_data_v1_${id.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80)}`;
  }

  function readChunkedCustomerPhoto(values, photoKey, chunkCount = 0) {
    const key = normalizeString(photoKey);
    if (!key) return null;
    const count = Math.max(0, Math.min(80, Number(chunkCount || 0) || 0));
    const chunks = [];
    if (count) {
      for (let index = 0; index < count; index += 1) {
        chunks.push(normalizeString(values[`${key}_${index}`]));
      }
    } else {
      for (let index = 0; index < 80; index += 1) {
        const value = values[`${key}_${index}`];
        if (typeof value !== 'string') break;
        chunks.push(normalizeString(value));
      }
    }
    const dataUrl = chunks.join('');
    const parsed = parseDataUrlImage(dataUrl);
    return parsed ? { dataUrl, chunkCount: chunks.length } : null;
  }

  function parseCustomerPhotoMap(raw, values = {}, rows = []) {
    const parsed = safeJsonParse(raw || '{}', {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stateValues = values && typeof values === 'object' ? values : {};
    Object.keys(parsed).forEach((key) => {
      const item = parsed[key];
      if (!item || typeof item !== 'object') return;
      const photoKey = normalizeString(item.photoKey);
      const chunked = readChunkedCustomerPhoto(stateValues, photoKey, item.chunkCount);
      if (chunked) {
        item.websitePhoto = chunked.dataUrl;
        item.chunkCount = chunked.chunkCount;
      }
      const mockupPhotoKey = normalizeString(item.mockupPhotoKey || item.websiteMockupKey);
      const mockupChunked = readChunkedCustomerPhoto(
        stateValues,
        mockupPhotoKey,
        item.mockupChunkCount || item.websiteMockupChunkCount
      );
      if (mockupChunked) {
        item.websiteMockup = mockupChunked.dataUrl;
        item.mockupChunkCount = mockupChunked.chunkCount;
      }
    });
    (Array.isArray(rows) ? rows : []).forEach((entry, index) => {
      const row = entry && entry.row && typeof entry.row === 'object' ? entry.row : entry;
      const id = getExplicitRowId(row);
      if (!id) return;
      const photoKey = buildCustomerPhotoDataKey(row);
      if (!photoKey) return;
      const chunked = readChunkedCustomerPhoto(stateValues, photoKey, 0);
      if (!chunked) return;
      const existing = parsed[id] && typeof parsed[id] === 'object' ? parsed[id] : null;
      if (existing && normalizeString(existing.photoKey) && parseDataUrlImage(existing.websitePhoto)) return;
      parsed[id] = {
        ...(existing || {}),
        id,
        identityKey: normalizeString(existing && existing.identityKey) || buildRowIdentityKey(row),
        photoKey,
        chunkCount: chunked.chunkCount,
        websitePhoto: chunked.dataUrl,
        websitePhotoName: normalizeString(row.websitePhotoName || row.photoName || row.websiteImageName) || 'Websitefoto',
      };
    });
    return parsed;
  }

  async function loadCustomerPhotoMap(rows = []) {
    const state = await getUiStateValues(customerPhotoScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return parseCustomerPhotoMap(values[customerPhotoKey], values, rows);
  }

  async function loadCustomerPhotoMapCached(rows = []) {
    const canReuseRows = !Array.isArray(rows) || rows.length === 0;
    if (
      canReuseRows &&
      coldmailPhotoMapCache &&
      Date.now() - coldmailPhotoMapCache.cachedAt <= COLDMAIL_PHOTO_MAP_CACHE_TTL_MS
    ) {
      return coldmailPhotoMapCache.map;
    }
    const map = await loadCustomerPhotoMap(rows);
    if (canReuseRows) {
      coldmailPhotoMapCache = {
        cachedAt: Date.now(),
        map,
      };
    }
    return map;
  }

  async function resolveRowWebdesignPhoto(row, photoMap) {
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      const identityKey = normalizeString(item && item.identityKey).toLowerCase();
      if (identityKey) photosByIdentity.set(identityKey, item);
    });
    const photo = preferFreshRowPhotoFields(row, findStoredPhotoRecordForRow(row, 0, photos, photosByIdentity));
    const parsed = await resolveImageAttachment(getWebdesignPhotoSource(photo));
    if (!parsed) return null;
    const previewCustomerId =
      normalizeString(photo && (photo.customerId || photo.customer_id || photo.id)) ||
      getExplicitRowId(row) ||
      getRowId(row, 0);
    const baseName = sanitizeFilename(photo.websitePhotoName || `${getRowCompany(row)} webdesign`, 'webdesign');
    const extension = getImageExtension(parsed.contentType);
    const filename = `${baseName}.${extension}`;
    const cid = `webdesign-${sanitizeFilename(getRowId(row, 0), 'image')}@softora`;
    const mockupParsed = isApprovedWebdesignMockupRecord(photo)
      ? await resolveImageAttachment(getWebdesignMockupSource(photo))
      : null;
    const mockupBaseName = sanitizeFilename(photo && (photo.websiteMockupName || `${getRowCompany(row)} device mockup`), 'device-mockup');
    const mockup = mockupParsed
      ? {
          ...mockupParsed,
          filename: `${mockupBaseName}.${getImageExtension(mockupParsed.contentType)}`,
          cid: `webdesign-mockup-${sanitizeFilename(getRowId(row, 0), 'image')}@softora`,
          alt: `${getRowCompany(row) || 'Bedrijf'} device mockup`,
        }
      : null;
    return {
      ...parsed,
      filename,
      cid,
      alt: `${getRowCompany(row) || 'Bedrijf'} webdesign`,
      previewCustomerId,
      mockup,
    };
  }

  function addDaysIso(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString();
  }

  function normalizeCampaignDurationDays(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'disabled' || normalized === 'uitgeschakeld' || normalized === '0') return 0;
    return parsePositiveInt(value, 14, 1, 90);
  }

  function markRowAsMailed(row, actor, durationDays, context = {}) {
    const date = now().toISOString();
    const safeDurationDays = normalizeCampaignDurationDays(durationDays);
    const campaignEndsAt = safeDurationDays > 0 ? addDaysIso(new Date(date), safeDurationDays) : '';
    const existingHistory = Array.isArray(row.hist) ? row.hist : [];
    const senderEmail = normalizeEmailAddress(context.senderEmail);
    const messageId = normalizeString(context.messageId);
    const trackingId = normalizeString(context.trackingId);
    const isWebdesignOutreach = isWebdesignSpecialAction(context.specialAction);
    const trackingFields = trackingId
      ? {
          coldmailTrackingId: trackingId,
          coldmailOpenTrackingId: trackingId,
          coldmailOpened: false,
          coldmailOpenedAt: '',
          coldmailFirstOpenedAt: '',
          coldmailLastOpenedAt: '',
          coldmailOpenCount: 0,
          outreachOpenedAt: '',
          outreachOpenCount: 0,
        }
      : {};
    const outreachFields = isWebdesignOutreach
      ? {
          campaignType: 'webdesign',
          campaign_type: 'webdesign',
          outreachCampaignType: 'webdesign',
          outreach_campaign_type: 'webdesign',
          coldmailSpecialAction: 'webdesign',
          outreachStatus: 'benaderd',
          actionRequired: false,
          outreachActionRequired: false,
          sentFromEmail: senderEmail,
          sent_from_email: senderEmail,
          outreachSentFromEmail: senderEmail,
          outreachSentAt: date,
          outreach_sent_at: date,
          coldmailSentMessageId: messageId,
          outreachMessageId: messageId,
          lastReplyAt: '',
          last_reply_at: '',
          replyThreadId: '',
          reply_thread_id: '',
          replyMessageId: '',
          replyMailboxId: '',
          replyMailboxAccount: '',
          statusUpdatedAt: date,
        }
      : {};
    return {
      ...row,
      ...outreachFields,
      ...trackingFields,
      status: 'gemaild',
      databaseStatus: 'gemaild',
      mail: true,
      lastColdmailSenderEmail: senderEmail || normalizeString(row.lastColdmailSenderEmail),
      lastMailSentAt: date,
      lastColdmailSentAt: date,
      coldmailCampaignStartedAt: date,
      coldmailCampaignDurationDays: safeDurationDays,
      coldmailCampaignEndsAt: campaignEndsAt,
      activeColdmailCampaignUntil: campaignEndsAt,
      updatedAt: date.slice(0, 10),
      hist: [
        {
          type: 'gemaild',
          label: 'Mail verstuurd',
          date: date.slice(0, 10),
          actor: normalizeString(actor) || 'Coldmailing',
        },
        ...existingHistory,
      ],
    };
  }

  function isColdmailInvalidEmailDomainFailure(item) {
    const code = normalizeString(item && item.code).toLowerCase();
    if (code === 'invalid_email_domain') return true;
    return /^E-maildomein bestaat niet of ontvangt geen mail:/i.test(normalizeString(item && item.error));
  }

  function markRowFromColdmailInvalidEmailDomain(row, failure, actor) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const nextStatus = canAdvanceContactStatus(currentStatus, 'geblokkeerd')
      ? 'geblokkeerd'
      : currentStatus || 'geblokkeerd';
    const email = normalizeEmailAddress(failure && failure.email) || getRowEmail(row);
    const domain = normalizeString((failure && failure.domain) || getEmailDomain(email));
    const reason = truncateText(
      normalizeString(failure && failure.error) ||
        `E-maildomein bestaat niet of ontvangt geen mail: ${domain || email}`,
      500
    );
    const existingHistory = Array.isArray(row.hist) ? row.hist : [];
    return {
      ...row,
      mail: false,
      canMail: false,
      doNotMail: true,
      status: nextStatus,
      databaseStatus: nextStatus,
      coldmailInvalidEmailDomain: domain,
      coldmailInvalidEmailDomainAt: date,
      coldmailInvalidEmailDomainReason: reason,
      updatedAt: date,
      hist: [
        {
          type: 'geblokkeerd',
          label: domain
            ? `E-maildomein automatisch overgeslagen: ${domain}`
            : 'E-maildomein automatisch overgeslagen',
          date,
          actor: normalizeString(actor) || 'Coldmailing',
          source: 'coldmail-invalid-email-domain',
          preview: reason,
        },
        ...existingHistory,
      ],
    };
  }

  async function persistColdmailInvalidEmailDomainFailures({ rows, values, failed, actor }) {
    const invalidFailures = (Array.isArray(failed) ? failed : []).filter(isColdmailInvalidEmailDomainFailure);
    if (!invalidFailures.length) return { rows, marked: 0 };
    const failuresById = new Map();
    invalidFailures.forEach((failure) => {
      const id = normalizeString(failure && failure.id);
      if (id && !failuresById.has(id)) failuresById.set(id, failure);
    });
    if (!failuresById.size) return { rows, marked: 0 };
    let marked = 0;
    const nextRows = rows.map((row, index) => {
      const rowId = getRowId(row, index);
      const failure = failuresById.get(rowId);
      if (!failure) return row;
      marked += 1;
      return markRowFromColdmailInvalidEmailDomain(row, failure, actor);
    });
    if (!marked) return { rows, marked: 0 };
    const markedRows = nextRows.filter((row, index) => failuresById.has(getRowId(row, index)));
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues({}, markedRows),
      {
        source: 'coldmail-invalid-email-domain',
        actor,
        upsertOnly: true,
      }
    );
    return { rows: nextRows, marked };
  }

  function buildColdmailReplyHistoryEntry({
    classification,
    parsedMail,
    inboundText,
    processedKey,
    actor,
  }) {
    const date = now().toISOString();
    return {
      type: classification.status,
      label: classification.label,
      date,
      actor: normalizeString(actor) || 'Coldmailing',
      source: 'coldmail-inbound-reply',
      messageKey: normalizeString(processedKey),
      subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      preview: truncateText(inboundText, 500),
    };
  }

  function mergeColdmailReplyHistory(row, entry) {
    const existingHistory = Array.isArray(row && row.hist) ? row.hist.filter(Boolean) : [];
    const messageKey = normalizeString(entry && entry.messageKey);
    const alreadyTracked = messageKey
      ? existingHistory.some((item) => normalizeString(item && item.messageKey) === messageKey)
      : false;
    return (alreadyTracked ? existingHistory : [entry, ...existingHistory]).slice(0, 50);
  }

  function findColdmailOpenTrackingRow(payload, rows = []) {
    const targetId = normalizeString(payload && payload.id);
    const targetEmail = normalizeEmailAddress(payload && payload.email);
    const targetTrackingId = normalizeString(payload && payload.trackingId);
    const items = (Array.isArray(rows) ? rows : []).map((row, index) => ({
      row,
      index,
      id: getRowId(row, index),
      email: getRowEmail(row),
      trackingId: normalizeString(
        row && (row.coldmailTrackingId || row.coldmailOpenTrackingId || row.openTrackingId)
      ),
    }));
    return (
      items.find((item) => targetTrackingId && item.trackingId === targetTrackingId) ||
      items.find((item) => targetId && item.id === targetId && (!targetEmail || item.email === targetEmail)) ||
      items.find((item) => targetEmail && item.email === targetEmail) ||
      null
    );
  }

  function parseColdmailOpenTimestampMs(value) {
    const timestamp = Date.parse(normalizeString(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function isColdmailOpenTokenBeforeReset(row, payload) {
    const resetAtMs = parseColdmailOpenTimestampMs(row && row.coldmailOpenTrackingResetAt);
    if (!resetAtMs) return false;
    const tokenAtMs = parseColdmailOpenTimestampMs(payload && payload.ts);
    return !tokenAtMs || tokenAtMs <= resetAtMs;
  }

  function buildColdmailOpenHistoryEntry(payload, actor) {
    const date = now().toISOString();
    return {
      type: 'mail_geopend',
      label: 'Mail geopend',
      date,
      actor: normalizeString(actor) || 'Coldmail open tracking',
      source: 'coldmail-open-tracking',
      messageKey: `open-${normalizeString(payload && payload.trackingId)}`,
      preview: 'Ontvanger heeft de coldmail geopend.',
    };
  }

  function markRowAsOpened(row, payload, actor) {
    const date = now().toISOString();
    const openCount = Math.max(0, Number(row && row.coldmailOpenCount) || 0) + 1;
    const historyEntry = buildColdmailOpenHistoryEntry(payload, actor);
    return {
      ...row,
      coldmailOpened: true,
      coldmailOpenedAt: row && row.coldmailOpenedAt ? row.coldmailOpenedAt : date,
      coldmailFirstOpenedAt: row && row.coldmailFirstOpenedAt ? row.coldmailFirstOpenedAt : date,
      coldmailLastOpenedAt: date,
      coldmailOpenCount: openCount,
      outreachOpenedAt: row && row.outreachOpenedAt ? row.outreachOpenedAt : date,
      outreachOpenCount: Math.max(0, Number(row && row.outreachOpenCount) || 0) + 1,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  async function recordColdmailOpen(input = {}) {
    let payload;
    try {
      payload = verifyColdmailOpenTrackingToken(input.token || input.t);
    } catch (error) {
      return {
        ok: false,
        updated: 0,
        code: normalizeString(error && error.code) || 'INVALID_OPEN_TRACKING_TOKEN',
      };
    }
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailOpenTrackingRow(payload, rows);
    if (!match || !Number.isInteger(match.index) || !rows[match.index]) {
      return {
        ok: true,
        updated: 0,
        reason: 'target_not_found',
      };
    }
    if (isColdmailOpenTokenBeforeReset(rows[match.index], payload)) {
      return {
        ok: true,
        updated: 0,
        reason: 'tracking_token_before_reset',
        id: match.id,
        email: match.email,
        trackingId: payload.trackingId,
      };
    }

    const nextRows = rows.slice();
    const actor = normalizeString(input.actor || 'Coldmail open tracking');
    nextRows[match.index] = markRowAsOpened(rows[match.index], payload, actor);
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues({}, [nextRows[match.index]]),
      {
        source: 'coldmail-open-tracking',
        actor,
        upsertOnly: true,
      }
    );

    return {
      ok: true,
      updated: 1,
      id: match.id,
      email: match.email,
      trackingId: payload.trackingId,
    };
  }

  function findColdmailUnsubscribeRow(payload, rows = []) {
    const targetId = normalizeString(payload && payload.id);
    const targetEmail = normalizeEmailAddress(payload && payload.email);
    const items = (Array.isArray(rows) ? rows : []).map((row, index) => ({
      row,
      index,
      id: getRowId(row, index),
      email: getRowEmail(row),
    }));
    const exact = items.find((item) => item.id === targetId && item.email === targetEmail);
    if (exact) return exact;
    const emailMatches = items.filter((item) => item.email === targetEmail);
    return emailMatches.length === 1 ? emailMatches[0] : null;
  }

  function markRowFromColdmailUnsubscribe(row, payload, actor) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const nextStatus = canAdvanceContactStatus(currentStatus, 'geblokkeerd')
      ? 'geblokkeerd'
      : currentStatus || 'geblokkeerd';
    const historyEntry = {
      type: 'geblokkeerd',
      label: 'Afgemeld via afmeldlink',
      date,
      actor: normalizeString(actor) || 'coldmail-unsubscribe-link',
      source: 'coldmail-unsubscribe-link',
      messageKey: normalizeString(payload && payload.ref) || `unsubscribe-${normalizeEmailAddress(payload && payload.email)}`,
      preview: 'Ontvanger heeft op afmelden geklikt.',
    };
    return {
      ...row,
      mail: false,
      canMail: false,
      doNotMail: true,
      status: nextStatus,
      databaseStatus: nextStatus,
      coldmailReplyIntent: 'opt_out',
      lastColdmailReplyAt: date,
      lastColdmailUnsubscribedAt: date,
      activeColdmailCampaignUntil: '',
      coldmailCampaignEndsAt: '',
      updatedAt: date,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  function markRowFromColdmailReply(row, classification, parsedMail, inboundText, processedKey, actor, context = {}) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const isWebdesignOutreach = isWebdesignOutreachRow(row);
    const hasDefinitiveOutreachStatus =
      isOutreachDefinitiveStatus(row.outreachStatus) || isOutreachDefinitiveStatus(currentStatus);
    const shouldHoldForManualAction =
      isWebdesignOutreach && classification.status !== 'geblokkeerd' && !hasDefinitiveOutreachStatus;
    const canAdvance = canAdvanceContactStatus(currentStatus, classification.status);
    const nextStatus = shouldHoldForManualAction ? currentStatus : canAdvance ? classification.status : currentStatus;
    const nextOutreachStatus =
      shouldHoldForManualAction
        ? 'reactie_ontvangen'
        : classification.status === 'geblokkeerd'
          ? 'geen_interesse'
          : normalizeOutreachStatus(nextStatus) || normalizeOutreachStatus(row.outreachStatus) || 'reactie_ontvangen';
    const historyClassification = shouldHoldForManualAction
      ? {
          ...classification,
          status: 'reactie_ontvangen',
          label: 'Reactie ontvangen op webdesign-mail',
        }
      : classification;
    const historyEntry = buildColdmailReplyHistoryEntry({
      classification: historyClassification,
      parsedMail,
      inboundText,
      processedKey,
      actor,
    });
    const shouldClearCampaignWindow =
      !shouldHoldForManualAction &&
      (['interesse', 'geblokkeerd'].includes(nextStatus) ||
        ['interesse', 'geblokkeerd'].includes(classification.status));
    const mailFields = classification.disableMail
      ? {
          mail: false,
          canMail: false,
          doNotMail: true,
        }
      : {};
    const inboundRecipientEmail = normalizeEmailAddress(context.mailboxAccount);
    const replyMessageId = normalizeString(parsedMail && parsedMail.messageId);
    const replyMailboxId = normalizeString(context.mailboxId);
    const outreachFields = isWebdesignOutreach
      ? {
          lastReplyAt: date,
          last_reply_at: date,
          replyThreadId: replyMailboxId || normalizeString(processedKey),
          reply_thread_id: replyMailboxId || normalizeString(processedKey),
          replyMessageId,
          replyMailboxId,
          replyMailboxFolder: normalizeString(context.mailboxFolder),
          replyMailboxAccount: inboundRecipientEmail,
          outreachStatus: nextOutreachStatus,
          actionRequired: shouldHoldForManualAction,
          outreachActionRequired: shouldHoldForManualAction,
          statusUpdatedAt: date,
        }
      : {};

    return {
      ...row,
      ...mailFields,
      ...outreachFields,
      status: nextStatus || row.status,
      databaseStatus: nextStatus || row.databaseStatus,
      coldmailReplyIntent: classification.intent,
      lastColdmailReplyAt: date,
      lastColdmailReplySubject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      lastColdmailReplyPreview: truncateText(inboundText, 1000),
      lastColdmailReplyMessageKey: normalizeString(processedKey),
      activeColdmailCampaignUntil: shouldClearCampaignWindow ? '' : row.activeColdmailCampaignUntil,
      coldmailCampaignEndsAt: shouldClearCampaignWindow ? '' : row.coldmailCampaignEndsAt,
      updatedAt: date,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  function buildColdmailBounceHistoryEntry({
    classification,
    parsedMail,
    inboundText,
    processedKey,
    actor,
  }) {
    const date = now().toISOString();
    const hardBounce = classification && classification.bounceType === 'hard';
    return {
      type: hardBounce ? 'geblokkeerd' : 'mail_bounce',
      label: normalizeString(classification && classification.label) || 'Mailservermelding ontvangen',
      date,
      actor: normalizeString(actor) || 'Coldmailing',
      source: 'coldmail-bounce',
      messageKey: normalizeString(processedKey),
      subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      preview: truncateText(inboundText, 500),
    };
  }

  function markRowFromColdmailBounce(row, classification, parsedMail, inboundText, processedKey, actor) {
    const date = now().toISOString();
    const currentStatus = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    const hardBounce = classification && classification.bounceType === 'hard';
    const nextStatus =
      hardBounce && canAdvanceContactStatus(currentStatus, 'geblokkeerd')
        ? 'geblokkeerd'
        : currentStatus;
    const historyEntry = buildColdmailBounceHistoryEntry({
      classification,
      parsedMail,
      inboundText,
      processedKey,
      actor,
    });
    const mailFields = hardBounce
      ? {
          mail: false,
          canMail: false,
          doNotMail: true,
        }
      : {};
    return {
      ...row,
      ...mailFields,
      status: nextStatus || row.status,
      databaseStatus: nextStatus || row.databaseStatus,
      coldmailReplyIntent: normalizeString(classification && classification.intent),
      coldmailBounceType: normalizeString(classification && classification.bounceType) || 'unknown',
      coldmailBounceAt: date,
      coldmailBounceReason: truncateText(inboundText, 1000),
      lastColdmailReplyAt: date,
      lastColdmailReplySubject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
      lastColdmailReplyPreview: truncateText(inboundText, 1000),
      lastColdmailReplyMessageKey: normalizeString(processedKey),
      activeColdmailCampaignUntil: hardBounce ? '' : row.activeColdmailCampaignUntil,
      coldmailCampaignEndsAt: hardBounce ? '' : row.coldmailCampaignEndsAt,
      updatedAt: date,
      hist: mergeColdmailReplyHistory(row, historyEntry),
    };
  }

  async function persistColdmailBounceLifecycle({
    values,
    rows,
    match,
    parsedMail,
    inboundText,
    processedKey,
    actor,
    classification,
  }) {
    if (!classification || !match || !Number.isInteger(match.index) || !rows[match.index]) {
      return {
        persisted: false,
        rows,
        classification,
        reason: 'missing_bounce_match',
      };
    }
    const nextRows = rows.slice();
    nextRows[match.index] = markRowFromColdmailBounce(
      rows[match.index],
      classification,
      parsedMail,
      inboundText,
      processedKey,
      actor
    );
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues({}, [nextRows[match.index]]),
      {
        source: 'coldmail-bounce',
        actor: normalizeString(actor) || 'coldmail-bounce',
        upsertOnly: true,
      }
    );
    return {
      persisted: true,
      rows: nextRows,
      classification,
      reason: 'updated',
    };
  }

  async function persistColdmailReplyLifecycle({
    values,
    rows,
    match,
    parsedMail,
    inboundText,
    processedKey,
    actor,
    mailboxId,
    mailboxFolder,
    mailboxAccount,
    classification: providedClassification,
  }) {
    const classification = providedClassification || classifyInboundColdmailReplyLifecycle(inboundText);
    const matchedRow = match && Number.isInteger(match.index) ? rows[match.index] : null;
    const shouldPersistWebdesignReply = Boolean(matchedRow && isWebdesignOutreachRow(matchedRow));
    if (!classification.status && !shouldPersistWebdesignReply) {
      return {
        persisted: false,
        rows,
        classification,
        reason: 'unclear_intent',
      };
    }
    if (!match || !Number.isInteger(match.index) || !rows[match.index]) {
      return {
        persisted: false,
        rows,
        classification,
        reason: 'missing_match',
      };
    }

    const effectiveClassification = classification.status
      ? classification
      : {
          status: 'reactie_ontvangen',
          intent: 'unclear',
          label: 'Reactie ontvangen op webdesign-mail',
          disableMail: false,
        };
    const nextRows = rows.slice();
    nextRows[match.index] = markRowFromColdmailReply(
      rows[match.index],
      effectiveClassification,
      parsedMail,
      inboundText,
      processedKey,
      actor,
      { mailboxId, mailboxFolder, mailboxAccount }
    );
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues({}, [nextRows[match.index]]),
      {
        source: 'coldmail-inbound-reply',
        actor: normalizeString(actor) || 'coldmail-auto-reply',
        upsertOnly: true,
      }
    );
    return {
      persisted: true,
      rows: nextRows,
      classification,
      reason: 'updated',
    };
  }

  async function unsubscribeColdmailRecipient(input = {}) {
    const payload = verifyColdmailUnsubscribeToken(input.token || input.t);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailUnsubscribeRow(payload, rows);
    if (!match || !Number.isInteger(match.index) || !rows[match.index]) {
      const error = new Error('Deze afmeldlink hoort niet meer bij een bekende ontvanger.');
      error.code = 'UNSUBSCRIBE_TARGET_NOT_FOUND';
      throw error;
    }

    const nextRows = rows.slice();
    const actor = normalizeString(input.actor || 'coldmail-unsubscribe-link');
    nextRows[match.index] = markRowFromColdmailUnsubscribe(rows[match.index], payload, actor);
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues({}, [nextRows[match.index]]),
      {
        source: 'coldmail-unsubscribe-link',
        actor,
        upsertOnly: true,
      }
    );

    return {
      ok: true,
      unsubscribed: true,
      id: match.id,
      email: match.email,
      bedrijf: getRowCompany(nextRows[match.index]),
      status: normalizeDatabaseStatus(nextRows[match.index].databaseStatus || nextRows[match.index].status),
    };
  }

  async function getColdmailUnsubscribePreview(input = {}) {
    const payload = verifyColdmailUnsubscribeToken(input.token || input.t);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailUnsubscribeRow(payload, rows);
    if (!match) {
      const error = new Error('Deze link hoort niet meer bij een bekende ontvanger.');
      error.code = 'UNSUBSCRIBE_TARGET_NOT_FOUND';
      throw error;
    }
    return {
      ok: true,
      id: match.id,
      email: match.email,
      bedrijf: getRowCompany(rows[match.index]),
    };
  }

  function findWebdesignOutreachRowIndex(rows, input = {}) {
    const customerId = normalizeString(input.customerId || input.id);
    const email = normalizeEmailAddress(input.email);
    const messageKeys = [
      input.messageId,
      input.mailboxId,
      input.replyThreadId,
      input.replyMessageId,
    ].map(normalizeMailboxMessageKey).filter(Boolean);
    if (customerId) {
      const index = rows.findIndex((row, rowIndex) => getRowId(row, rowIndex) === customerId);
      if (index >= 0) return index;
    }
    if (messageKeys.length) {
      const index = rows.findIndex((row) => messageKeys.some((key) => matchesOutreachMessage(row, key)));
      if (index >= 0) return index;
    }
    if (email) {
      const index = rows.findIndex((row) => getRowEmail(row) === email && isWebdesignOutreachRow(row));
      if (index >= 0) return index;
    }
    return -1;
  }

  function buildOutreachManualHistoryEntry(status, actor) {
    const databaseStatus = mapOutreachStatusToDatabaseStatus(status);
    return {
      type: databaseStatus,
      label: getOutreachStatusLabel(status),
      date: now().toISOString(),
      actor: normalizeString(actor) || 'Mailbox',
      source: 'webdesign-outreach-action',
    };
  }

  function applyWebdesignOutreachStatus(row, status, actor) {
    const date = now().toISOString();
    const outreachStatus = normalizeOutreachStatus(status);
    const databaseStatus = mapOutreachStatusToDatabaseStatus(outreachStatus, row.databaseStatus || row.status);
    const historyEntry = buildOutreachManualHistoryEntry(outreachStatus, actor);
    const existingHistory = Array.isArray(row.hist) ? row.hist.filter(Boolean) : [];
    const noMailFields =
      outreachStatus === 'geen_interesse'
        ? {
            mail: false,
            canMail: false,
            doNotMail: true,
          }
        : {};
    return {
      ...row,
      ...noMailFields,
      status: databaseStatus,
      databaseStatus,
      outreachStatus,
      actionRequired: false,
      outreachActionRequired: false,
      statusUpdatedAt: date,
      updatedAt: date,
      activeColdmailCampaignUntil: isOutreachDefinitiveStatus(outreachStatus)
        ? ''
        : row.activeColdmailCampaignUntil,
      coldmailCampaignEndsAt: isOutreachDefinitiveStatus(outreachStatus)
        ? ''
        : row.coldmailCampaignEndsAt,
      hist: [historyEntry, ...existingHistory].slice(0, 50),
    };
  }

  async function updateWebdesignOutreachStatus(input = {}) {
    const status = normalizeOutreachStatus(input.status);
    if (!status || status === 'benaderd') {
      const error = new Error('Kies een geldige outreach-status.');
      error.code = 'INVALID_OUTREACH_STATUS';
      error.status = 400;
      throw error;
    }

    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const index = findWebdesignOutreachRowIndex(rows, input);
    if (index < 0 || !rows[index]) {
      const error = new Error('Webdesign-outreach lead niet gevonden.');
      error.code = 'OUTREACH_LEAD_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    if (!isWebdesignOutreachRow(rows[index])) {
      const error = new Error('Deze lead hoort niet bij een webdesign-outreachmail.');
      error.code = 'NOT_WEBDESIGN_OUTREACH';
      error.status = 422;
      throw error;
    }

    const nextRows = rows.slice();
    nextRows[index] = applyWebdesignOutreachStatus(
      rows[index],
      status,
      normalizeString(input.actor) || 'Webdesign outreach'
    );
    await setUiStateValues(
      customerDbScope,
      buildCustomerRowsStateValues({}, [nextRows[index]]),
      {
        source: 'webdesign-outreach-action',
        actor: normalizeString(input.actor) || 'Webdesign outreach',
        upsertOnly: true,
      }
    );

    return {
      ok: true,
      status,
      databaseStatus: nextRows[index].databaseStatus,
      customer: nextRows[index],
    };
  }

  async function getColdmailPreviewImage(input = {}) {
    const token = normalizeString(input.token || input.t);
    const payload = verifyColdmailPreviewImageToken(token);
    const cacheKey = getPreviewImageCacheKey(token, payload.type);
    const cachedImage = getCachedPreviewImage(cacheKey);
    if (cachedImage) return cachedImage;

    const photoMap = await loadCustomerPhotoMapCached();
    const photos = photoMap && typeof photoMap === 'object' ? photoMap : {};
    const photosByIdentity = new Map();
    Object.keys(photos).forEach((key) => {
      const item = photos[key];
      const identityKey = normalizeString(item && item.identityKey).toLowerCase();
      if (identityKey) photosByIdentity.set(identityKey, item);
    });

    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const match = findColdmailUnsubscribeRow(payload, rows);
    const row = match && rows[match.index] ? rows[match.index] : null;
    const photo = row
      ? preferFreshRowPhotoFields(
          row,
          findStoredPhotoRecordForRow(row, match.index, photos, photosByIdentity)
        )
      : findStoredPhotoRecordById(payload.id, photos);

    if (!photo) {
      const error = new Error('Deze foto hoort niet meer bij een bekende ontvanger.');
      error.code = 'PREVIEW_IMAGE_TARGET_NOT_FOUND';
      throw error;
    }
    const source = payload.type === 'mockup'
      ? (isApprovedWebdesignMockupRecord(photo) ? getWebdesignMockupSource(photo) : '')
      : getWebdesignPhotoSource(photo);
    const image =
      await resolveImageAttachment(source) ||
      await resolvePreviewImageFromDataOps(payload, row, photo);
    if (!image) {
      const error = new Error('Deze foto is niet meer beschikbaar.');
      error.code = 'PREVIEW_IMAGE_NOT_FOUND';
      throw error;
    }
    const optimizedImage = await preparePreviewImageForEmail(image, payload.type);

    const company = (row ? getRowCompany(row) : '') || 'Softora webdesign';
    const baseName = payload.type === 'mockup'
      ? normalizeString(photo && photo.websiteMockupName) || `${company} device mockup`
      : normalizeString(photo && photo.websitePhotoName) || `${company} webdesign`;
    const result = {
      ok: true,
      type: payload.type,
      content: optimizedImage.content,
      contentType: optimizedImage.contentType,
      filename: `${sanitizeFilename(baseName, payload.type === 'mockup' ? 'device-mockup' : 'webdesign')}.${getImageExtension(optimizedImage.contentType)}`,
    };
    rememberPreviewImage(cacheKey, result);
    return result;
  }

  async function sendColdmailCampaign(input = {}) {
    if (coldmailCampaignSendPromise) {
      const error = new Error('Er draait al een coldmailcampagne. Wacht tot die klaar is.');
      error.code = 'COLDMAIL_SEND_IN_PROGRESS';
      throw error;
    }
    const promise = sendColdmailCampaignUnlocked(input).finally(() => {
      coldmailCampaignSendPromise = null;
    });
    coldmailCampaignSendPromise = promise;
    return promise;
  }

  async function sendColdmailCampaignUnlocked(input = {}) {
    if (!isSmtpMailConfigured()) {
      const error = new Error('Mail is nog niet gekoppeld. Vul eerst de SMTP-gegevens op de server in.');
      error.code = 'SMTP_NOT_CONFIGURED';
      error.missing = getMissingSmtpMailEnv();
      throw error;
    }

    const senderEmail = assertSenderAllowed(input.senderEmail);
    const senderAccount = resolveSenderSmtpAccount(senderEmail);
    if (!isSenderSmtpAccountConfigured(senderAccount)) {
      const error = new Error(
        `Deze afzender (${senderEmail}) heeft nog geen eigen SMTP-wachtwoord op de server.`
      );
      error.code = 'SENDER_SMTP_NOT_CONFIGURED';
      error.missing = getMissingSenderSmtpEnv(senderEmail);
      throw error;
    }
    const subjectVariants = normalizeColdmailTemplateVariants(input.subjectVariants || input.subjects, input.subject, 200);
    const bodyVariants = normalizeColdmailTemplateVariants(
      input.bodyVariants || input.bodies || input.textVariants,
      input.body,
      12000
    );
    const subjectTemplate = subjectVariants[0] || '';
    const bodyTemplate = bodyVariants[0] || '';
    if (!subjectTemplate || !bodyTemplate) {
      const error = new Error('Vul eerst een onderwerp en mailtekst in.');
      error.code = 'EMPTY_MAIL_CONTENT';
      throw error;
    }

    const resolvedRecipients = await resolveColdmailRecipients(input);
    const testMode = Boolean(resolvedRecipients.testMode);
    const count = resolvedRecipients.count;
    const values = resolvedRecipients.values;
    let rows = resolvedRecipients.rows;
    const candidateRows = resolvedRecipients.candidateRows;
    const failed = resolvedRecipients.failed;

    const shouldIncludeWebdesignPhoto = shouldUseWebdesignAssets(input, 'mail');
    const webdesignImageDelivery = getColdmailWebdesignImageDelivery(input);

    if (!candidateRows.length) {
      const preparation = shouldIncludeWebdesignPhoto
        ? await queueWebdesignPreparationForRecipient(resolvedRecipients.webdesignPreparationCandidate)
        : null;
      if (preparation && preparation.queued) {
        const error = new Error(
          preparation.existing
            ? `Geen mailklare webdesigns meer. Er loopt al een voorbereiding voor ${preparation.bedrijf}.`
            : `Geen mailklare webdesigns meer. Voorbereiding gestart voor ${preparation.bedrijf}.`
        );
        error.code = 'WEBDESIGN_PREPARATION_QUEUED';
        error.failedItems = resolvedRecipients.failed;
        error.webdesignPreparation = preparation;
        throw error;
      }
      const firstFailure = pickFailureMessage(resolvedRecipients.failed);
      const error = new Error(firstFailure || 'Geen geschikte e-mailadressen gevonden in de database.');
      error.code = shouldIncludeWebdesignPhoto && firstFailure ? 'NO_WEBDESIGN_PHOTOS' : 'NO_RECIPIENTS';
      error.failedItems = resolvedRecipients.failed;
      throw error;
    }

    let selectedRows = resolvedRecipients.selectedRows;
    const quota = await getColdmailSendQuota(senderEmail);
    if (!testMode && quota.safetyPause) {
      const error = new Error(buildColdmailSafetyPauseMessage(quota.safetyPause));
      error.code = 'COLDMAIL_SAFETY_PAUSED';
      error.quota = quota;
      throw error;
    }
    const quotaRemaining = testMode ? selectedRows.length : Math.min(quota.senderRemaining, quota.packageRemaining);
    if (!testMode && quotaRemaining <= 0) {
      const error = new Error(
        'Daglimiet bereikt: om je STRATO-mailbox en domeinreputatie te beschermen worden vandaag geen extra coldmails verzonden.'
      );
      error.code = 'COLDMAIL_DAILY_LIMIT_REACHED';
      error.quota = quota;
      throw error;
    }
    if (!testMode && selectedRows.length > quotaRemaining) {
      selectedRows.slice(quotaRemaining).forEach((item) => {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email: getRowEmail(item.row),
          error: `Daglimiet beschermt deze ontvanger: nog ${quotaRemaining} verzending(en) beschikbaar vandaag.`,
        });
      });
      selectedRows = selectedRows.slice(0, quotaRemaining);
    }
    if (!testMode) {
      let selectedPersonalMailboxCount = 0;
      selectedRows = selectedRows.filter((item) => {
        const email = getRowEmail(item.row);
        if (!isPersonalMailboxDomain(email)) return true;
        selectedPersonalMailboxCount += 1;
        if (selectedPersonalMailboxCount <= quota.personalMailboxRemaining) return true;
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email,
          error: `Persoonlijke mailbox-daglimiet beschermt deze ontvanger: nog ${quota.personalMailboxRemaining} Gmail/Outlook/Hotmail verzending(en) beschikbaar vandaag.`,
        });
        return false;
      });
    }
    let invalidRecipientDomainsBlocked = 0;
    if (!testMode && failed.some(isColdmailInvalidEmailDomainFailure)) {
      const persistedInvalidDomains = await persistColdmailInvalidEmailDomainFailures({
        rows,
        values,
        failed,
        actor: input.actor || 'Coldmailing',
      });
      rows = persistedInvalidDomains.rows;
      invalidRecipientDomainsBlocked = persistedInvalidDomains.marked;
    }
    const customerPhotoMap = shouldIncludeWebdesignPhoto
      ? (resolvedRecipients.customerPhotoMap || await loadCustomerPhotoMap(candidateRows))
      : {};

    if (!selectedRows.length) {
      const preparation = shouldIncludeWebdesignPhoto
        ? await queueWebdesignPreparationForRecipient(resolvedRecipients.webdesignPreparationCandidate)
        : null;
      if (preparation && preparation.queued) {
        const error = new Error(
          preparation.existing
            ? `Geen mailbare webdesigns meer. Er loopt al een voorbereiding voor ${preparation.bedrijf}.`
            : `Geen mailbare webdesigns meer. Voorbereiding gestart voor ${preparation.bedrijf}.`
        );
        error.code = 'WEBDESIGN_PREPARATION_QUEUED';
        error.failedItems = failed;
        error.invalidRecipientDomainsBlocked = invalidRecipientDomainsBlocked;
        error.webdesignPreparation = preparation;
        throw error;
      }
      const firstFailure = pickFailureMessage(failed, candidateRows);
      const recipientGuardFailure = failed.length > 0 && failed.every((item) => isColdmailRecipientGuardFailure(item));
      const error = new Error(firstFailure || 'Geen geldige e-maildomeinen gevonden in de database.');
      error.code = recipientGuardFailure ? 'COLDMAIL_RECIPIENT_RECENTLY_SENT' : 'NO_VALID_RECIPIENT_DOMAINS';
      error.failedItems = failed;
      error.invalidRecipientDomainsBlocked = invalidRecipientDomainsBlocked;
      throw error;
    }

    const delivery = getSenderSmtpTransport(senderEmail);
    const transporter = delivery && delivery.transporter;
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd voor deze afzender.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }
    const smtpAccount = delivery.account;
    const sent = [];
    const auditBcc = getColdmailAuditBccAddress(senderEmail);
    const persistedSentRowIds = new Set();
    let safetyPause = null;
    const actor = normalizeString(input.actor || 'Coldmailing');

    for (const [index, item] of selectedRows.entries()) {
      const row = item.row;
      const to = getRowEmail(row);
      if (!testMode) {
        await runColdmailBeforeSendGuard(input, {
          actor,
          index,
          selected: selectedRows.length,
          senderEmail,
          to,
          item,
          row,
        });
      }
      if (!testMode && index > 0) {
        const delayMs = isPersonalMailboxDomain(to)
          ? Math.max(getColdmailSendDelayMs(), getColdmailPersonalMailboxSendDelayMs())
          : getColdmailSendDelayMs();
        if (delayMs > 0) await sleep(delayMs);
      }
      if (!testMode) {
        const liveQuota = await getColdmailSendQuota(senderEmail);
        if (liveQuota.safetyPause) {
          safetyPause = {
            until: liveQuota.safetyPause.until,
            reason: liveQuota.safetyPause.reason,
          };
          failed.push({
            id: 'coldmail-safety-pause',
            bedrijf: 'Softora',
            email: senderEmail,
            error: buildColdmailSafetyPauseMessage(safetyPause),
          });
          break;
        }
        const liveRecipientGuardMatch = getColdmailRecipientGuardMatch(
          item,
          liveQuota.recipientEntries || []
        );
        if (liveRecipientGuardMatch) {
          failed.push(buildColdmailRecipientGuardFailure(item, liveRecipientGuardMatch));
          continue;
        }
      }
      const reference = buildColdmailReference(row, item.id);
      const trackingId = '';
      const selectedBodyTemplate = selectColdmailTemplateVariant(
        bodyVariants,
        row,
        item,
        senderEmail,
        reference,
        'body'
      ) || bodyTemplate;
      const selectedSubjectTemplate = selectColdmailTemplateVariant(
        subjectVariants,
        row,
        item,
        senderEmail,
        reference,
        'subject'
      ) || subjectTemplate;
      const rawBaseText = buildMailText(selectedBodyTemplate, row, item.id, input);
      const baseText = shouldIncludeWebdesignPhoto && webdesignImageDelivery === 'link'
        ? stripColdmailLinkOnlyImageArtifacts(rawBaseText)
        : rawBaseText;
      const text = baseText;
      const subject = personalizeTemplate(selectedSubjectTemplate, row, { senderEmail });
      const webdesignPhoto = shouldIncludeWebdesignPhoto ? await resolveRowWebdesignPhoto(row, customerPhotoMap) : null;
      if (shouldIncludeWebdesignPhoto && !webdesignPhoto) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: `Geen webdesign-foto gevonden voor ${getRowCompany(row) || to}.`,
        });
        continue;
      }
      if (
        shouldIncludeWebdesignPhoto &&
        webdesignImageDelivery !== 'attachment' &&
        !webdesignPhoto.mockup
      ) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: `Geen device-mockup gevonden voor ${getRowCompany(row) || to}.`,
        });
        continue;
      }
      const effectiveSpecialAction = shouldIncludeWebdesignPhoto ? 'webdesign' : input.specialAction;
      const publicWebdesignPreviewId =
        normalizeString(webdesignPhoto && webdesignPhoto.previewCustomerId) || item.id;
      let webdesignPhotoForHtml = webdesignPhoto;
      let preparedWebdesignAttachment = null;
      let preparedMockupAttachment = null;
      let remoteWebdesignAttachment = null;
      let remoteMockupAttachment = null;
      const shouldSendWebdesignImages = Boolean(webdesignPhoto && webdesignImageDelivery !== 'link');
      const shouldPrepareMockup = shouldSendWebdesignImages && webdesignImageDelivery !== 'attachment';
      if (shouldSendWebdesignImages) {
        const preparedWebdesignImage = await preparePreviewImageForEmail(webdesignPhoto, 'webdesign');
        const preparedMockupImage = shouldPrepareMockup && webdesignPhoto.mockup
          ? await preparePreviewImageForEmail(webdesignPhoto.mockup, 'mockup')
          : null;
        preparedWebdesignAttachment = mergePreparedImage(webdesignPhoto, preparedWebdesignImage, 'webdesign');
        preparedMockupAttachment = shouldPrepareMockup && webdesignPhoto.mockup
          ? mergePreparedImage(webdesignPhoto.mockup, preparedMockupImage, 'device-mockup')
          : null;
        webdesignPhotoForHtml = {
          ...webdesignPhoto,
          ...preparedWebdesignAttachment,
          mockup: preparedMockupAttachment || webdesignPhoto.mockup,
        };
      }
      if (shouldSendWebdesignImages && webdesignImageDelivery === 'remote') {
        const webdesignLink = buildColdmailPreviewImageLink(row, item.id, reference, input, 'webdesign');
        const mockupLink = buildColdmailPreviewImageLink(row, item.id, reference, input, 'mockup');
        remoteWebdesignAttachment = preparedWebdesignAttachment;
        remoteMockupAttachment = preparedMockupAttachment;
        rememberPreviewImage(getPreviewImageCacheKey(webdesignLink.token, 'webdesign'), {
          ok: true,
          type: 'webdesign',
          content: remoteWebdesignAttachment.content,
          contentType: remoteWebdesignAttachment.contentType,
          filename: remoteWebdesignAttachment.filename,
        });
        rememberPreviewImage(getPreviewImageCacheKey(mockupLink.token, 'mockup'), {
          ok: true,
          type: 'mockup',
          content: remoteMockupAttachment.content,
          contentType: remoteMockupAttachment.contentType,
          filename: remoteMockupAttachment.filename,
        });
        webdesignPhotoForHtml = {
          ...webdesignPhoto,
          src: webdesignLink.url,
          token: webdesignLink.token,
          mockup: {
            ...webdesignPhoto.mockup,
            src: mockupLink.url,
            token: mockupLink.token,
          },
        };
      }
      const htmlBase = appendHiddenColdmailReferenceHtml(
        toHtml(baseText, {
          senderEmail,
          webdesignPreviewUrl: buildPublicWebdesignPreviewUrl(row, publicWebdesignPreviewId, {
            ...input,
            senderEmail,
            senderDisplayName: getSenderDisplayName(senderEmail, smtpAccount),
            text,
            renderedBody: text,
          }),
        }),
        reference
      );
      const shouldRenderWebdesignImages =
        shouldSendWebdesignImages && webdesignImageDelivery !== 'attachment';
      const htmlWithContent = shouldRenderWebdesignImages
        ? appendWebdesignImageHtml(htmlBase, webdesignPhotoForHtml, {
            optOutText: '',
            optOutUrl: '',
          })
        : htmlBase;
      const html = renderWebdesignEmailDocument(htmlWithContent, {
        maxWidth: COLDMAIL_EMAIL_CONTENT_MAX_WIDTH,
      });
      const attachments = shouldSendWebdesignImages && webdesignImageDelivery === 'cid'
        ? buildWebdesignImageAttachments(
            webdesignPhoto,
            {
              inline: true,
              webdesignImage: preparedWebdesignAttachment || webdesignPhoto,
              mockupImage: preparedMockupAttachment || webdesignPhoto.mockup,
            }
          )
        : shouldSendWebdesignImages && webdesignImageDelivery === 'attachment'
          ? buildWebdesignImageAttachments(webdesignPhoto, {
              inline: false,
              includeMockup: false,
              webdesignImage: preparedWebdesignAttachment || webdesignPhoto,
            })
          : undefined;
      try {
        const mail = {
          from: formatMailFromHeader(senderEmail, smtpAccount),
          to,
          replyTo: getColdmailReplyToAddress(senderEmail),
          subject,
          text,
          html,
          attachments,
        };
        if (shouldIncludeWebdesignPhoto) {
          mail.headers = {
            'X-Softora-Template-Version': WEBDESIGN_EMAIL_TEMPLATE_VERSION,
          };
        }
        const listUnsubscribe = getColdmailListUnsubscribeHeader(senderEmail, row, item.id, reference, input);
        if (listUnsubscribe) {
          mail.headers = mail.headers || {};
          mail.headers['List-Unsubscribe'] = listUnsubscribe;
          const listUnsubscribePost = getColdmailListUnsubscribePostHeader(row, item.id, reference, input);
          if (listUnsubscribePost) mail.headers['List-Unsubscribe-Post'] = listUnsubscribePost;
        }
        if (auditBcc && auditBcc !== normalizeEmailAddress(to)) {
          mail.bcc = auditBcc;
        }
        if (shouldIncludeWebdesignPhoto && webdesignImageDelivery === 'link') {
          assertColdmailLinkOnlyMailIsImageFree(mail);
        }
        if (shouldIncludeWebdesignPhoto && webdesignImageDelivery === 'attachment') {
          assertColdmailAttachmentOnlyMail(mail);
        }
        if (!testMode) {
          await runColdmailBeforeSendGuard(input, {
            actor,
            index,
            selected: selectedRows.length,
            senderEmail,
            to,
            item,
            row,
          });
        }
        const shouldReserveGuards = !isTestRecipientRow(row, to);
        const senderCooldownReservation = shouldReserveGuards
          ? await reserveSupabaseColdmailSenderCooldown(senderEmail, input, actor)
          : null;
        let outboundReservation = null;
        try {
          outboundReservation = shouldReserveGuards
            ? await reserveSupabaseOutboundRecipientForColdmail(item, senderEmail, actor)
            : null;
        } catch (error) {
          await releaseSupabaseOutboundRecipientReservation(senderCooldownReservation, { to });
          throw error;
        }
        if (outboundReservation && outboundReservation.conflict) {
          await releaseSupabaseOutboundRecipientReservation(senderCooldownReservation, { to });
          failed.push(outboundReservation.conflict);
          continue;
        }
        let info;
        let accepted = [];
        let rejected = [];
        try {
          info = await transporter.sendMail(mail);
          accepted = Array.isArray(info && info.accepted)
            ? info.accepted.map(normalizeEmailAddress).filter(Boolean)
            : [];
          rejected = Array.isArray(info && info.rejected)
            ? info.rejected.map(normalizeEmailAddress).filter(Boolean)
            : [];
          if (rejected.includes(normalizeEmailAddress(to)) || (Array.isArray(info && info.accepted) && !accepted.length)) {
            throw new Error('SMTP accepteerde de ontvanger niet.');
          }
        } catch (error) {
          await releaseSupabaseOutboundRecipientReservation(outboundReservation, { to });
          await releaseSupabaseOutboundRecipientReservation(senderCooldownReservation, { to });
          throw error;
        }
        if (!isTestRecipientRow(row, to)) {
          await confirmSupabaseColdmailSenderCooldown(senderCooldownReservation, senderEmail, input, actor);
        }
        const sentItem = {
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          messageId: normalizeString(info && info.messageId),
          trackingId,
          response: truncateText(normalizeString(info && info.response), 500),
          accepted,
          rejected,
          sentCopySaved: false,
        };
        if (!isTestRecipientRow(row, to)) {
          await confirmSupabaseOutboundRecipientForColdmail(
            outboundReservation && outboundReservation.reservationId,
            sentItem
          );
        }
        const sentCopySaved = await saveSentCopy(senderEmail, mail, info, smtpAccount);
        sentItem.sentCopySaved = sentCopySaved;
        if (!isTestRecipientRow(row, to)) {
          const recipientGuard = buildColdmailRecipientGuard(row, item.id);
          await runColdmailPostSmtpPersistenceStep('oude send_guard/teller', () =>
            recordColdmailSendGuardEntry({
              senderEmail,
              count: 1,
              personalCount: isPersonalMailboxDomain(to) ? 1 : 0,
              ...recipientGuard,
              actor,
            })
          );
          let markedRow = null;
          const updatedRows = rows.map((currentRow, rowIndex) => {
            const rowId = getRowId(currentRow, rowIndex);
            if (rowId !== item.id) return currentRow;
            markedRow = markRowAsMailed(currentRow, actor, input.durationDays, {
              senderEmail,
              specialAction: effectiveSpecialAction,
              messageId: sentItem.messageId,
              trackingId: sentItem.trackingId,
            });
            return markedRow;
          });
          if (!markedRow) {
            throw new Error('Klantstatus kon niet veilig worden opgeslagen: verzonden klant niet gevonden.');
          }
          await runColdmailPostSmtpPersistenceStep(
            'klantstatus/teller',
            async () => {
              const result = await setUiStateValues(
                customerDbScope,
                buildCustomerRowsStateValues({}, [markedRow]),
                {
                  source: 'coldmail-campaign',
                  actor,
                  requireDataOps: true,
                  upsertOnly: true,
                }
              );
              return assertColdmailPostSmtpPersistenceResult('klantstatus/teller', result);
            }
          );
          rows = updatedRows;
          persistedSentRowIds.add(item.id);
        }
        sent.push(sentItem);
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          code: normalizeString(error && error.code),
          reason: normalizeString(error && error.reason),
          error: truncateText(normalizeString(error && error.message), 500),
        });
        const errorCode = normalizeString(error && error.code);
        const guardConfirmFailed = errorCode === 'COLDMAIL_OUTBOUND_GUARD_CONFIRM_FAILED';
        const guardPreflightFailed = /^COLDMAIL_OUTBOUND_GUARD_(?:UNAVAILABLE|FAILED)$/i.test(errorCode);
        const postSmtpPersistenceFailed = errorCode === 'COLDMAIL_POST_SMTP_PERSISTENCE_FAILED';
        const safetyReason = guardConfirmFailed
          ? 'central_outbound_guard_confirm_failed'
          : guardPreflightFailed
          ? 'central_outbound_guard_preflight_failed'
          : postSmtpPersistenceFailed
          ? 'post_smtp_persistence_failed'
          : getSmtpSafetyStopReason(error);
        if (safetyReason) {
          safetyPause = await recordColdmailSafetyPause({
            senderEmail,
            reason: safetyReason,
            error,
            actor,
          });
          failed.push({
            id: 'coldmail-safety-pause',
            bedrijf: 'Softora',
            email: senderEmail,
            error: buildColdmailSafetyPauseMessage(safetyPause),
          });
          break;
        }
      }
    }

    if (!sent.length && failed.length) {
      const firstFailure = pickFailureMessage(failed, selectedRows);
      const recipientGuardFailure = failed.every((item) => isColdmailRecipientGuardFailure(item));
      const outboundGuardFailure = failed.every((item) =>
        /^COLDMAIL_OUTBOUND_GUARD_(?:UNAVAILABLE|FAILED|CONFIRM_FAILED)$/i.test(normalizeString(item && item.code))
      );
      const senderCooldownFailure = failed.every((item) =>
        normalizeString(item && item.code) === 'COLDMAIL_SENDER_COOLDOWN_ACTIVE'
      );
      const autopilotGuardFailure = failed.every((item) =>
        [
          'COLDMAIL_AUTOPILOT_DISABLED',
          'COLDMAIL_AUTOPILOT_STATE_UNAVAILABLE',
          'COLDMAIL_AUTOPILOT_OUTSIDE_SCHEDULE',
        ].includes(
          normalizeString(item && item.code)
        )
      );
      const webdesignAssetFailure = shouldIncludeWebdesignPhoto && failed.every((item) =>
        /^Geen (?:webdesign-foto|device-mockup) gevonden voor /i.test(normalizeString(item && item.error))
      );
      const error = new Error(firstFailure ? `Geen mails verzonden: ${firstFailure}` : 'Geen mails verzonden.');
      if (safetyPause) {
        error.code = 'COLDMAIL_SAFETY_PAUSED';
      } else if (recipientGuardFailure) {
        error.code = 'COLDMAIL_RECIPIENT_RECENTLY_SENT';
      } else if (outboundGuardFailure) {
        error.code = 'COLDMAIL_OUTBOUND_GUARD_UNAVAILABLE';
      } else if (senderCooldownFailure) {
        error.code = 'COLDMAIL_SENDER_COOLDOWN_ACTIVE';
      } else if (autopilotGuardFailure) {
        error.code = normalizeString(failed[0] && failed[0].code) || 'COLDMAIL_AUTOPILOT_DISABLED';
        error.reason = normalizeString(failed[0] && failed[0].reason);
      } else if (webdesignAssetFailure) {
        error.code = 'NO_WEBDESIGN_PHOTOS';
      } else {
        error.code = 'SMTP_SEND_FAILED';
      }
      error.failedItems = failed;
      if (safetyPause) error.quota = { ...(quota || {}), safetyPause };
      throw error;
    }

    return {
      ok: true,
      requested: count,
      selected: selectedRows.length,
      sent: sent.length,
      failed: failed.length,
      failedReasons: summarizeColdmailFailureReasons(failed),
      persisted: persistedSentRowIds.size,
      invalidRecipientDomainsBlocked,
      safetyLimits: getColdmailSafetyLimits(),
      dailyQuota: {
        senderSentBefore: quota.senderSent,
        packageSentBefore: quota.packageSent,
        personalMailboxSentBefore: quota.personalMailboxSent,
        senderDaySentBefore: quota.senderDaySent,
        packageDaySentBefore: quota.packageDaySent,
        personalMailboxDaySentBefore: quota.personalMailboxDaySent,
        senderRemainingBefore: quota.senderRemaining,
        packageRemainingBefore: quota.packageRemaining,
        personalMailboxRemainingBefore: quota.personalMailboxRemaining,
        senderRollingRemainingBefore: quota.senderRollingRemaining,
        packageRollingRemainingBefore: quota.packageRollingRemaining,
        personalMailboxRollingRemainingBefore: quota.personalMailboxRollingRemaining,
        safetyPausedUntil: safetyPause ? safetyPause.until : undefined,
      },
      safetyPaused: Boolean(safetyPause),
      senderEmail,
      testMode,
      testRecipientEmail: testMode ? COLDMAIL_TEST_RECIPIENT_EMAIL : undefined,
      testRecipientEmails: testMode && Array.isArray(resolvedRecipients.testRecipientEmails)
        ? resolvedRecipients.testRecipientEmails
        : undefined,
      specialAction: normalizeString(input.specialAction || ''),
      sentItems: sent,
      failedItems: failed,
    };
  }

  async function syncInboundColdmailRepliesFromImap(options = {}) {
    const force = Boolean(options.force);
    const maxMessages = Math.max(5, Math.min(100, Number(options.maxMessages || 30) || 30));
    const bounceProcessingEnabled = coldmailBounceProcessingEnabled !== false;
    if (!coldmailAutoReplyEnabled && !bounceProcessingEnabled) {
      return {
        ok: true,
        skipped: true,
        reason: 'coldmail_reply_sync_disabled',
      };
    }
    if (!isImapMailConfigured()) {
      return {
        ok: false,
        skipped: true,
        reason: 'imap_not_configured',
        missingEnv: getMissingImapMailEnv(),
      };
    }
    if (coldmailAutoReplyEnabled && !isSmtpMailConfigured()) {
      return {
        ok: false,
        skipped: true,
        reason: 'smtp_not_configured',
        missingEnv: getMissingSmtpMailEnv(),
      };
    }
    if (!force && syncInboundColdmailRepliesFromImap.notBeforeMs && Date.now() < syncInboundColdmailRepliesFromImap.notBeforeMs) {
      return syncInboundColdmailRepliesFromImap.lastResult || { ok: true, skipped: true, reason: 'cooldown' };
    }
    if (syncInboundColdmailRepliesFromImap.promise) return syncInboundColdmailRepliesFromImap.promise;

    syncInboundColdmailRepliesFromImap.promise = (async () => {
      const stats = {
        ok: true,
        startedAt: now().toISOString(),
        model: normalizeString(coldmailAutoReplyModel) || 'gpt-5.5-pro',
        mailboxes: getImapMailboxesForSync(),
        scanned: 0,
        matched: 0,
        replied: 0,
        skippedProcessed: 0,
        ignored: 0,
        markedSeen: 0,
        lifecycleUpdated: 0,
        lifecycleSkipped: 0,
        hardBounced: 0,
        softBounced: 0,
        bounceUpdated: 0,
        bounceSkipped: 0,
        providerWarnings: 0,
        autoReplySkippedSafetyPaused: 0,
        errors: [],
      };
      const dbState = await getUiStateValues(customerDbScope);
      const values = dbState && typeof dbState.values === 'object' ? dbState.values : {};
      let rows = parseDatabaseRows(values);
      const replyState = await loadColdmailReplyState();
      const client = createImapClient({
        host: imapHost,
        port: Number(imapPort),
        secure: Boolean(imapSecure),
        auth: {
          user: imapUser,
          pass: imapPass,
        },
        logger: false,
      });

      try {
        await client.connect();
        for (const mailboxName of getImapMailboxesForSync()) {
          let lock = null;
          try {
            lock = await client.getMailboxLock(mailboxName);
            const unseenUids = await client.search(['UNSEEN']);
            const allUids = await client.search(['ALL']);
            const selectedUidSet = new Set();
            if (Array.isArray(allUids)) allUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
            if (Array.isArray(unseenUids)) unseenUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
            const selectedUids = Array.from(selectedUidSet).sort((a, b) => a - b);
            const uidsToMarkSeen = [];
            if (!selectedUids.length) continue;

            for await (const message of client.fetch(
              selectedUids,
              {
                uid: true,
                source: true,
                flags: true,
              },
              { uid: true }
            )) {
              stats.scanned += 1;
              let parsedMail = null;
              try {
                parsedMail = await parseMailSource(message.source);
              } catch (error) {
                stats.errors.push(`Parse error ${mailboxName}/${message.uid}: ${truncateText(error && error.message, 140)}`);
                continue;
              }

              const processedKey = getInboundMessageProcessedKey(parsedMail, message);
              if (replyState.processed[processedKey]) {
                stats.skippedProcessed += 1;
                continue;
              }

              const inboundText = getInboundReplyText(parsedMail);
              const deliveryFailure = classifyColdmailDeliveryFailure(parsedMail, inboundText);
              const providerWarningSafetyReason = getColdmailProviderWarningSafetyReason(parsedMail, inboundText);
              let providerWarningPause = null;
              const from = getParsedMailFromEmail(parsedMail);
              if (providerWarningSafetyReason) {
                providerWarningPause = await recordColdmailSafetyPause({
                  senderEmail: resolveInboundMailboxAccount(parsedMail),
                  reason: providerWarningSafetyReason,
                  error: providerWarningSafetyReason,
                  actor: 'coldmail-provider-warning',
                });
                stats.providerWarnings += 1;
                stats.safetyPausedUntil = providerWarningPause.until;
                replyState.processed[processedKey] = {
                  at: now().toISOString(),
                  from: from.address,
                  subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
                  lifecycleIntent: 'provider_warning',
                  safetyPauseUntil: providerWarningPause.until,
                  safetyPauseReason: providerWarningPause.reason,
                };
                await saveColdmailReplyState(replyState, 'coldmail-provider-warning');
              }
              const match = deliveryFailure
                ? findColdmailRowForDeliveryFailure(parsedMail, inboundText, rows)
                : findColdmailRowForInboundReply(parsedMail, rows);
              if (!match || (!inboundText && !deliveryFailure)) {
                if (providerWarningPause) {
                  const flagsSet =
                    message.flags instanceof Set
                      ? message.flags
                      : new Set(Array.isArray(message.flags) ? message.flags : []);
                  if (!flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
                  continue;
                }
                stats.ignored += 1;
                continue;
              }
              if (deliveryFailure && !bounceProcessingEnabled) {
                stats.ignored += 1;
                continue;
              }

              stats.matched += 1;
              const mailboxId = buildMailboxMessageId(mailboxName, message.uid);
              const classification = deliveryFailure
                ? deliveryFailure
                : await classifyInboundColdmailReplyLifecycleWithAi({
                    row: match.row,
                    parsedMail,
                    inboundText,
                  });
              try {
                if (deliveryFailure && bounceProcessingEnabled) {
                  try {
                    const lifecycle = await persistColdmailBounceLifecycle({
                      values,
                      rows,
                      match,
                      parsedMail,
                      inboundText: inboundText || truncateText(normalizeString(parsedMail && parsedMail.subject), 500),
                      processedKey,
                      actor: 'Coldmailing',
                      classification: deliveryFailure,
                    });
                    rows = lifecycle.rows;
                    if (lifecycle.persisted) {
                      stats.bounceUpdated += 1;
                      if (deliveryFailure.bounceType === 'hard') stats.hardBounced += 1;
                      else if (deliveryFailure.bounceType === 'soft') stats.softBounced += 1;
                    } else {
                      stats.bounceSkipped += 1;
                    }
                    replyState.processed[processedKey] = {
                      at: now().toISOString(),
                      from: from.address,
                      company: getRowCompany(match.row),
                      subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
                      lifecycleStatus: normalizeString(deliveryFailure.status),
                      lifecycleIntent: normalizeString(deliveryFailure.intent),
                      bounceType: normalizeString(deliveryFailure.bounceType),
                    };
                    await saveColdmailReplyState(replyState, 'coldmail-bounce');
                    const flagsSet =
                      message.flags instanceof Set
                        ? message.flags
                        : new Set(Array.isArray(message.flags) ? message.flags : []);
                    if (!flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
                    continue;
                  } catch (error) {
                    stats.errors.push(
                      `${from.address || 'mailserver'} bounce: ${truncateText(
                        error && error.message ? error.message : String(error),
                        220
                      )}`
                    );
                  }
                }

                if (!coldmailAutoReplyEnabled) {
                  stats.lifecycleSkipped += 1;
                  continue;
                }

                try {
                  const lifecycle = await persistColdmailReplyLifecycle({
                    values,
                    rows,
                    match,
                    parsedMail,
                    inboundText,
                    processedKey,
                    actor: 'Coldmailing',
                    mailboxId,
                    mailboxFolder: mailboxName,
                    mailboxAccount: resolveInboundMailboxAccount(parsedMail),
                    classification,
                  });
                  rows = lifecycle.rows;
                  if (lifecycle.persisted) {
                    stats.lifecycleUpdated += 1;
                  } else {
                    stats.lifecycleSkipped += 1;
                  }
                } catch (error) {
                  stats.errors.push(
                    `${from.address || 'onbekende afzender'} lifecycle: ${truncateText(
                      error && error.message ? error.message : String(error),
                      220
                    )}`
                  );
                }

                const senderEmail = resolveInboundSenderEmail(parsedMail);
                const autoReplyQuota = await getColdmailSendQuota(senderEmail);
                if (autoReplyQuota.safetyPause) {
                  stats.autoReplySkippedSafetyPaused += 1;
                  stats.safetyPausedUntil = autoReplyQuota.safetyPause.until;
                  replyState.processed[processedKey] = {
                    at: now().toISOString(),
                    from: from.address,
                    company: getRowCompany(match.row),
                    subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
                    lifecycleStatus: normalizeString(classification.status),
                    lifecycleIntent: 'auto_reply_skipped_safety_pause',
                    safetyPauseUntil: autoReplyQuota.safetyPause.until,
                    safetyPauseReason: autoReplyQuota.safetyPause.reason,
                  };
                  await saveColdmailReplyState(replyState, 'coldmail-auto-reply-safety-pause');
                  const flagsSet =
                    message.flags instanceof Set
                      ? message.flags
                      : new Set(Array.isArray(message.flags) ? message.flags : []);
                  if (!flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
                  continue;
                }
                const aiReply = await generateColdmailAutoReplyWithOpenAi({
                  row: match.row,
                  inboundText,
                  inboundSubject: normalizeString(parsedMail && parsedMail.subject),
                  fromName: from.name,
                  senderEmail,
                });
                const info = await sendColdmailAutoReply({
                  parsedMail,
                  row: match.row,
                  senderEmail,
                  replyText: aiReply.text,
                });
                replyState.processed[processedKey] = {
                  at: now().toISOString(),
                  from: from.address,
                  company: getRowCompany(match.row),
                  subject: truncateText(normalizeString(parsedMail && parsedMail.subject), 240),
                  model: aiReply.model,
                  messageId: normalizeString(info && info.messageId),
                  lifecycleStatus: normalizeString(classification.status),
                  lifecycleIntent: normalizeString(classification.intent),
                };
                await saveColdmailReplyState(replyState, 'coldmail-auto-reply');
                stats.replied += 1;

                const flagsSet =
                  message.flags instanceof Set
                    ? message.flags
                    : new Set(Array.isArray(message.flags) ? message.flags : []);
                if (!flagsSet.has('\\Seen')) uidsToMarkSeen.push(message.uid);
              } catch (error) {
                stats.errors.push(
                  `${from.address || 'onbekende afzender'}: ${truncateText(error && error.message ? error.message : String(error), 220)}`
                );
              }
            }

            if (uidsToMarkSeen.length) {
              await client.messageFlagsAdd(uidsToMarkSeen, ['\\Seen'], { uid: true });
              stats.markedSeen += uidsToMarkSeen.length;
            }
          } catch (error) {
            stats.errors.push(`Mailbox ${mailboxName}: ${truncateText(error && error.message ? error.message : String(error), 180)}`);
          } finally {
            try {
              if (lock) lock.release();
            } catch (_) {}
          }
        }
      } catch (error) {
        stats.ok = false;
        stats.error = truncateText(error && error.message ? error.message : String(error), 500);
      } finally {
        try {
          if (client.usable) await client.logout();
        } catch (_) {}
        stats.finishedAt = now().toISOString();
        syncInboundColdmailRepliesFromImap.notBeforeMs = Date.now() + Number(imapPollCooldownMs || 20_000);
        syncInboundColdmailRepliesFromImap.lastResult = stats;
        syncInboundColdmailRepliesFromImap.promise = null;
      }

      return stats;
    })();

    return syncInboundColdmailRepliesFromImap.promise;
  }

  return {
    getAllowedSenderEmails,
    getConfiguredSenderEmails,
    getMissingImapMailEnv,
    getMissingSmtpMailEnv,
    getColdmailSafetyLimits,
    isImapMailConfigured,
    isSmtpMailConfigured,
    isLikelyValidEmail,
    getColdmailCampaignRecipients,
    getColdmailLiveStats,
    getColdmailPreviewImage,
    getColdmailAutopilotStatus,
    getColdmailUnsubscribePreview,
    listColdmailReplyFollowUps,
    recordColdmailOpen,
    runColdmailAutopilot,
    sendColdmailCampaign,
    setWebdesignPreparationCoordinator: (coordinator) => {
      webdesignPreparationCoordinator = coordinator || null;
      return webdesignPreparationCoordinator;
    },
    setMailReadySnapshotService: (service) => {
      mailReadySnapshotService = service || null;
      return mailReadySnapshotService;
    },
    syncInboundColdmailRepliesFromImap,
    unsubscribeColdmailRecipient,
    updateColdmailAutopilotSettings,
    updateWebdesignOutreachStatus,
  };
}

module.exports = {
  createColdmailCampaignService,
  DEFAULT_CUSTOMER_DB_KEY,
  DEFAULT_CUSTOMER_DB_SCOPE,
};
