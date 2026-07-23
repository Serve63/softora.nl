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
  'Afgelopen week kwam ik jullie website {{website}} tegen.',
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

module.exports = {
  ACTIVE_INSTANTLY_COLDMAIL_STATUSES,
  BLOCKING_INSTANTLY_COLDMAIL_STATUSES,
  COLDMAIL_AUTOPILOT_ALLOWED_SENDER_EMAILS,
  COLDMAIL_AUTOPILOT_DAY_SLOT_READY_GRACE_MS,
  COLDMAIL_AUTOPILOT_KNOWN_SKIP_CODES,
  COLDMAIL_AUTOPILOT_MAX_SENDER_EMAILS,
  COLDMAIL_AUTOPILOT_STATE_VALUE_SOFT_LIMIT,
  COLDMAIL_IMAGE_VISIBILITY_PS,
  COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN,
  COLDMAIL_LIVE_STATS_DURABLE_TTL_MS,
  COLDMAIL_LIVE_STATS_MEMORY_TTL_MS,
  COLDMAIL_OPT_OUT_LABEL,
  COLDMAIL_OPT_OUT_TEXT_PREFIX,
  COLDMAIL_PHOTO_MAP_CACHE_TTL_MS,
  COLDMAIL_POST_SMTP_PERSISTENCE_RETRY_DELAYS_MS,
  COLDMAIL_PREVIEW_IMAGE_CACHE_LIMIT,
  COLDMAIL_PREVIEW_IMAGE_CACHE_TTL_MS,
  COLDMAIL_PREVIEW_IMAGE_JPEG_QUALITY,
  COLDMAIL_PREVIEW_IMAGE_MAX_WIDTH,
  COLDMAIL_PREVIEW_IMAGE_OPTIMIZE_MIN_BYTES,
  COLDMAIL_PREVIEW_IMAGE_PATH,
  COLDMAIL_PRIVATE_COPY_BLOCKED_SENDERS,
  COLDMAIL_PROVIDER_WARNING_SENDER_PATTERN,
  COLDMAIL_PROVIDER_WARNING_SUBJECT_PATTERN,
  COLDMAIL_RECIPIENT_GUARD_WINDOW_MS,
  COLDMAIL_SENDER_COOLDOWN_LOCK_SAFETY_MS,
  COLDMAIL_SENDER_COOLDOWN_PREFLIGHT_TTL_MS,
  COLDMAIL_SEND_GUARD_WINDOW_MS,
  COLDMAIL_SMTP_SAFETY_STOP_PATTERN,
  COLDMAIL_TEST_RECIPIENT_EMAIL,
  COLDMAIL_TEST_RECIPIENT_ID,
  COLDMAIL_UNSUBSCRIBE_PATH,
  COLDMAIL_WEBDESIGN_LEAD_RECIPIENT_EMAILS,
  DEFAULT_COLDMAILING_SETTINGS_KEY,
  DEFAULT_COLDMAILING_SETTINGS_SCOPE,
  DEFAULT_COLDMAIL_AUTOPILOT_BATCH_SIZE,
  DEFAULT_COLDMAIL_AUTOPILOT_DAILY_TARGET_MINIMUM,
  DEFAULT_COLDMAIL_AUTOPILOT_END_HOUR,
  DEFAULT_COLDMAIL_AUTOPILOT_KEY,
  DEFAULT_COLDMAIL_AUTOPILOT_LOCK_MS,
  DEFAULT_COLDMAIL_AUTOPILOT_MIN_INTERVAL_MINUTES,
  DEFAULT_COLDMAIL_AUTOPILOT_SCOPE,
  DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MAX_INTERVAL_MINUTES,
  DEFAULT_COLDMAIL_AUTOPILOT_SENDER_MIN_INTERVAL_MINUTES,
  DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MAX_SECONDS,
  DEFAULT_COLDMAIL_AUTOPILOT_SEND_JITTER_MIN_SECONDS,
  DEFAULT_COLDMAIL_AUTOPILOT_START_HOUR,
  DEFAULT_COLDMAIL_AUTOPILOT_TIMEZONE,
  DEFAULT_COLDMAIL_CAMPAIGN_SEND_LIMIT,
  DEFAULT_COLDMAIL_DAILY_SEND_LIMIT,
  DEFAULT_COLDMAIL_PACKAGE_DAILY_SEND_LIMIT,
  DEFAULT_COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT,
  DEFAULT_COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS,
  DEFAULT_COLDMAIL_PREVIEW_IMAGE_SECRET,
  DEFAULT_COLDMAIL_REPLY_KEY,
  DEFAULT_COLDMAIL_REPLY_SCOPE,
  DEFAULT_COLDMAIL_SAFETY_PAUSE_MS,
  DEFAULT_COLDMAIL_SENDER_PROFILES,
  DEFAULT_COLDMAIL_SEND_DELAY_MS,
  DEFAULT_COLDMAIL_SEND_GUARD_KEY,
  DEFAULT_COLDMAIL_SEND_GUARD_SCOPE,
  DEFAULT_COLDMAIL_SMTP_CONNECTION_TIMEOUT_MS,
  DEFAULT_COLDMAIL_SMTP_GREETING_TIMEOUT_MS,
  DEFAULT_COLDMAIL_SMTP_SOCKET_TIMEOUT_MS,
  DEFAULT_COLDMAIL_STATS_CACHE_KEY,
  DEFAULT_COLDMAIL_STATS_CACHE_SCOPE,
  DEFAULT_COLDMAIL_WEBDESIGN_IMAGE_DELIVERY,
  DEFAULT_CUSTOMER_DB_KEY,
  DEFAULT_CUSTOMER_DB_SCOPE,
  DEFAULT_CUSTOMER_PHOTO_KEY,
  DEFAULT_CUSTOMER_PHOTO_SCOPE,
  DEFAULT_LEAD_DB_KEY,
  DEFAULT_LEAD_DB_SCOPE,
  DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL,
  EXCLUDED_DATABASE_STATUSES,
  MARTIJN_LINKEDIN_CTA_PATTERN,
  MAX_COLDMAIL_RADIUS_KM,
  PERSONAL_MAILBOX_DOMAINS,
  TEST_RECIPIENT_COMPANIES,
  TEST_RECIPIENT_EMAILS,
  TEST_RECIPIENT_LOOKUP_EMAILS,
};
