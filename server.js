const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createPremiumUsersStore } = require('./lib/premium-users-store');
const { FEATURE_FLAGS, getPublicFeatureFlags } = require('./server/config/feature-flags');
const {
  createKnownPrettyPageSlugToFile,
  getKnownHtmlPageFiles,
  resolveLegacyPrettyPageRedirect,
  toPrettyPagePathFromHtmlFile,
} = require('./server/config/page-routing');
const { timingSafeEqualStrings } = require('./server/security/crypto-utils');
const {
  appendQueryParamsToUrl,
  assertWebsitePreviewUrlIsPublic,
  getEffectivePublicBaseUrl: resolveEffectivePublicBaseUrl,
  normalizeAbsoluteHttpUrl,
  normalizeWebsitePreviewTargetUrl,
} = require('./server/security/public-url');
const { createPremiumPublicHtmlFilesSet } = require('./server/config/premium-public-html-files');
const { createPremiumHtmlPageAccessController } = require('./server/security/premium-pages');
const {
  createPremiumApiAccessGuard,
  createPremiumAuthStateManager,
} = require('./server/security/premium-auth');
const { createPremiumSessionManager } = require('./server/security/premium-session');
const {
  createRequestSecurityContext,
  getClientIpFromRequest,
  getRequestOriginFromHeaders,
  getRequestPathname,
  isSecureHttpRequest,
  normalizeIpAddress,
  normalizeOrigin,
} = require('./server/security/request-context');
const { createRuntimeDebugAccessGuard } = require('./server/security/runtime-debug');
const { createRuntimeEventStore } = require('./server/security/runtime-events');
const { createTotpManager } = require('./server/security/totp');
const routeManifest = require('./server/routes/manifest');
const { registerRuntimeDebugOpsRoutes } = require('./server/routes/runtime-debug-ops');
const { createRuntimeBackupCoordinator } = require('./server/services/runtime-backup');
const { createRuntimeDebugOpsCoordinator } = require('./server/services/runtime-debug-ops');
const { createSupabaseStateStore } = require('./server/services/supabase-state');
const { createRuntimeStateSyncCoordinator } = require('./server/services/runtime-state-sync');
const { registerAiDashboardRoutes } = require('./server/routes/ai-dashboard');
const { registerAiToolRoutes } = require('./server/routes/ai-tools');
const { registerWebsiteLinkRoutes } = require('./server/routes/website-links');
const { registerHealthAndOpsRoutes } = require('./server/routes/health');
const { registerActiveOrderRoutes } = require('./server/routes/active-orders');
const { createAiHelpers } = require('./server/services/ai-helpers');
const { createActiveOrderAutomationService } = require('./server/services/active-order-automation');
const { createAgendaConfirmationCoordinator } = require('./server/services/agenda-confirmation');
const { createAgendaPageBootstrapService } = require('./server/services/agenda-page-bootstrap');
const { createAgendaAppointmentStateService } = require('./server/services/agenda-appointment-state');
const { createAgendaAppointmentUpsertService } = require('./server/services/agenda-appointment-upsert');
const { createAgendaLeadDetailService } = require('./server/services/agenda-lead-detail');
const { createAgendaMetadataService } = require('./server/services/agenda-metadata');
const { createAgendaTaskHelpers } = require('./server/services/agenda-task-helpers');
const { createAgendaLeadFollowUpService } = require('./server/services/agenda-lead-follow-up');
const { createAgendaInterestedLeadReadService } = require('./server/services/agenda-interested-lead-read');
const { createAgendaInterestedLeadStateService } = require('./server/services/agenda-interested-lead-state');
const { resolveCallUpdateTimestamp } = require('./server/services/call-update-timestamp');
const { createAgendaInterestedLeadsCoordinator } = require('./server/services/agenda-interested-leads');
const { createAgendaPostCallCoordinator, createAgendaPostCallHelpers } = require('./server/services/agenda-post-call');
const { createAgendaReadCoordinator } = require('./server/services/agenda-read');
const { createActiveOrdersCoordinator } = require('./server/services/active-orders');
const { createAiDashboardCoordinator } = require('./server/services/ai-dashboard');
const { createRubenAssistant } = require('./server/services/ruben-assistant');
const { createAiToolsCoordinator } = require('./server/services/ai-tools');
const { createCustomersPageBootstrapService } = require('./server/services/customers-page-bootstrap');
const { createHtmlPageCoordinator } = require('./server/services/html-pages');
const { createColdcallingDashboardBootstrapService } = require('./server/services/coldcalling-dashboard-bootstrap');
const { createLeadsPageBootstrapService } = require('./server/services/leads-page-bootstrap');
const { registerAgendaMutationRoutes } = require('./server/routes/agenda');
const { registerPremiumAuthRoutes } = require('./server/routes/premium-auth');
const { registerAgendaReadRoutes } = require('./server/routes/agenda-read');
const { registerPremiumUserManagementRoutes } = require('./server/routes/premium-users');
const { registerRuntimeOpsRoutes } = require('./server/routes/runtime-ops');
const { registerSeoReadRoutes } = require('./server/routes/seo-read');
const { registerSeoWriteRoutes } = require('./server/routes/seo-write');
const { createPremiumAuthRouteCoordinator } = require('./server/services/premium-auth');
const { createPremiumUserManagementCoordinator } = require('./server/services/premium-users');
const { createConfirmationMailService } = require('./server/services/confirmation-mail');
const { createRuntimeOpsCoordinator } = require('./server/services/runtime-ops');
const { createSeoCore } = require('./server/services/seo-core');
const { createSeoReadCoordinator } = require('./server/services/seo-read');
const { createSeoWriteCoordinator } = require('./server/services/seo-write');
const { createUiStateStore } = require('./server/services/ui-state');
const { createWebsiteGenerationHelpers } = require('./server/services/website-generation');
const { createWebsiteLinkCoordinator } = require('./server/services/website-links');
const { createWebsiteInputHelpers } = require('./server/services/website-inputs');
require('dotenv').config();
const { version: APP_VERSION = '0.0.0' } = require('./package.json');
const isServerlessRuntime =
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  Boolean(process.env.LAMBDA_TASK_ROOT);

function normalizeLoginEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const RETELL_API_BASE_URL = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const TWILIO_API_BASE_URL = process.env.TWILIO_API_BASE_URL || 'https://api.twilio.com';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_IMAGE_MODEL =
  process.env.OPENAI_IMAGE_MODEL || process.env.WEBSITE_PREVIEW_IMAGE_MODEL || 'gpt-image-1';
const ANTHROPIC_API_BASE_URL = process.env.ANTHROPIC_API_BASE_URL || 'https://api.anthropic.com/v1';
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-opus-4-6';
const WEBSITE_ANTHROPIC_MODEL =
  process.env.WEBSITE_ANTHROPIC_MODEL ||
  process.env.ANTHROPIC_WEBSITE_MODEL ||
  'claude-opus-4-6';
const DOSSIER_ANTHROPIC_MODEL =
  process.env.DOSSIER_ANTHROPIC_MODEL ||
  process.env.ANTHROPIC_DOSSIER_MODEL ||
  process.env.CLAUDE_DOSSIER_MODEL ||
  'claude-opus-4-6';
const WEBSITE_GENERATION_PROVIDER = String(
  process.env.WEBSITE_GENERATION_PROVIDER || process.env.SITE_GENERATION_PROVIDER || ''
)
  .trim()
  .toLowerCase();
const WEBSITE_GENERATION_STRICT_ANTHROPIC = !/^(0|false|no)$/i.test(
  String(process.env.WEBSITE_GENERATION_STRICT_ANTHROPIC || 'true')
);
const WEBSITE_GENERATION_STRICT_HTML = !/^(0|false|no)$/i.test(
  String(process.env.WEBSITE_GENERATION_STRICT_HTML || 'true')
);
const WEBSITE_GENERATION_TIMEOUT_MS = Math.max(
  60_000,
  Math.min(600_000, Number(process.env.WEBSITE_GENERATION_TIMEOUT_MS || 300_000) || 300_000)
);
const ACTIVE_ORDER_AUTOMATION_ENABLED = /^(1|true|yes)$/i.test(
  String(process.env.ACTIVE_ORDER_AUTOMATION_ENABLED || '')
);
const ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER || process.env.GITHUB_OWNER || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE = !/^(0|false|no)$/i.test(
  String(process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE || 'true')
);
const ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG = /^(1|true|yes)$/i.test(
  String(process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG || '')
);
const ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX || 'softora-case-'
)
  .trim()
  .toLowerCase();
const ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH || 'main'
).trim() || 'main';
const ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN = String(
  process.env.ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN || process.env.VERCEL_TOKEN || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE = String(
  process.env.ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE || process.env.VERCEL_SCOPE || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND = String(
  process.env.ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL = String(
  process.env.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN = String(
  process.env.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN || ''
).trim();
const VERBOSE_CALL_WEBHOOK_LOGS = /^(1|true|yes)$/i.test(
  String(process.env.VERBOSE_CALL_WEBHOOK_LOGS || '')
);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STATE_TABLE = String(process.env.SUPABASE_STATE_TABLE || 'softora_runtime_state').trim();
const SUPABASE_STATE_KEY = String(process.env.SUPABASE_STATE_KEY || 'core').trim();
const SUPABASE_CALL_UPDATE_STATE_KEY_PREFIX = `${SUPABASE_STATE_KEY}:call_update:`;
const SUPABASE_DISMISSED_LEADS_STATE_KEY = `${SUPABASE_STATE_KEY}:dismissed_leads`;
const SUPABASE_CALL_UPDATE_ROWS_FETCH_LIMIT = 1000;
const DEFAULT_TWILIO_MEDIA_WS_URL = 'wss://twilio-media-bridge-pjzd.onrender.com/twilio-media';
const PREMIUM_LOGIN_EMAILS = Array.from(
  new Set(
    String(process.env.PREMIUM_LOGIN_EMAILS || process.env.PREMIUM_LOGIN_EMAIL || '')
      .split(/[\s,;]+/)
      .map((value) => normalizeLoginEmailValue(value))
      .filter(Boolean)
  )
);
const PREMIUM_LOGIN_PASSWORD = String(process.env.PREMIUM_LOGIN_PASSWORD || '').trim();
const PREMIUM_LOGIN_PASSWORD_HASH = String(process.env.PREMIUM_LOGIN_PASSWORD_HASH || '').trim();
const PREMIUM_SESSION_SECRET = String(process.env.PREMIUM_SESSION_SECRET || '').trim();
const PREMIUM_SESSION_TTL_HOURS = Math.max(
  1,
  Math.min(24 * 30, Number(process.env.PREMIUM_SESSION_TTL_HOURS || 12) || 12)
);
const PREMIUM_SESSION_REMEMBER_TTL_DAYS = Math.max(
  1,
  Math.min(365, Number(process.env.PREMIUM_SESSION_REMEMBER_TTL_DAYS || 30) || 30)
);
const PREMIUM_SESSION_COOKIE_NAME = 'softora_premium_session';
const PREMIUM_MFA_TOTP_SECRET = String(process.env.PREMIUM_MFA_TOTP_SECRET || '').trim();
const PREMIUM_ADMIN_IP_ALLOWLIST = String(process.env.PREMIUM_ADMIN_IP_ALLOWLIST || '').trim();
const PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS = !/^(0|false|no)$/i.test(
  String(process.env.PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS || 'true')
);
const PREMIUM_ENABLE_RUNTIME_DEBUG_ROUTES = /^(1|true|yes)$/i.test(
  String(process.env.PREMIUM_ENABLE_RUNTIME_DEBUG_ROUTES || '')
);
const PREMIUM_PUBLIC_HTML_FILES = createPremiumPublicHtmlFilesSet();
const NOINDEX_HEADER_VALUE = 'noindex, nofollow, noarchive, nosnippet';
const SECURITY_CONTACT_EMAIL = String(process.env.SECURITY_CONTACT_EMAIL || 'info@softora.nl').trim();
const PREMIUM_AUTH_USERS_ROW_KEY = 'premium_auth_users';
const PREMIUM_AUTH_USERS_VERSION = 1;
const MAIL_SMTP_HOST = String(
  process.env.MAIL_SMTP_HOST || process.env.SMTP_HOST || process.env.STRATO_SMTP_HOST || ''
).trim();
const MAIL_SMTP_PORT = Number(
  process.env.MAIL_SMTP_PORT || process.env.SMTP_PORT || process.env.STRATO_SMTP_PORT || 587
);
const MAIL_SMTP_USER = String(
  process.env.MAIL_SMTP_USER || process.env.SMTP_USER || process.env.STRATO_SMTP_USER || ''
).trim();
const MAIL_SMTP_PASS = String(
  process.env.MAIL_SMTP_PASS || process.env.SMTP_PASS || process.env.STRATO_SMTP_PASS || ''
).trim();
const MAIL_SMTP_SECURE = /^(1|true|yes)$/i.test(
  String(
    process.env.MAIL_SMTP_SECURE ||
      process.env.SMTP_SECURE ||
      (MAIL_SMTP_PORT === 465 ? 'true' : '')
  )
);
const MAIL_FROM_ADDRESS = String(
  process.env.CONFIRMATION_MAIL_FROM ||
    process.env.MAIL_FROM ||
    process.env.STRATO_SMTP_FROM ||
    MAIL_SMTP_USER ||
    ''
).trim();
const MAIL_FROM_NAME = String(
  process.env.CONFIRMATION_MAIL_FROM_NAME || process.env.MAIL_FROM_NAME || 'Softora'
).trim();
const MAIL_REPLY_TO = String(
  process.env.CONFIRMATION_MAIL_REPLY_TO || process.env.MAIL_REPLY_TO || ''
).trim();
const MAIL_IMAP_HOST = String(
  process.env.MAIL_IMAP_HOST ||
    process.env.IMAP_HOST ||
    process.env.STRATO_IMAP_HOST ||
    (/strato/i.test(String(process.env.MAIL_SMTP_HOST || process.env.SMTP_HOST || process.env.STRATO_SMTP_HOST || ''))
      ? 'imap.strato.com'
      : '')
).trim();
const MAIL_IMAP_PORT = Number(
  process.env.MAIL_IMAP_PORT || process.env.IMAP_PORT || process.env.STRATO_IMAP_PORT || 993
);
const MAIL_IMAP_SECURE = /^(1|true|yes)$/i.test(
  String(
    process.env.MAIL_IMAP_SECURE ||
      process.env.IMAP_SECURE ||
      (MAIL_IMAP_PORT === 993 ? 'true' : '')
  )
);
const MAIL_IMAP_USER = String(
  process.env.MAIL_IMAP_USER || process.env.IMAP_USER || process.env.STRATO_IMAP_USER || MAIL_SMTP_USER || ''
).trim();
const MAIL_IMAP_PASS = String(
  process.env.MAIL_IMAP_PASS || process.env.IMAP_PASS || process.env.STRATO_IMAP_PASS || MAIL_SMTP_PASS || ''
).trim();
const MAIL_IMAP_MAILBOX = String(process.env.MAIL_IMAP_MAILBOX || process.env.IMAP_MAILBOX || 'INBOX').trim() || 'INBOX';
const MAIL_IMAP_EXTRA_MAILBOXES = String(process.env.MAIL_IMAP_MAILBOXES || '')
  .split(',')
  .map((value) => String(value || '').trim())
  .filter(Boolean);
const MAIL_IMAP_POLL_COOLDOWN_MS = Math.max(
  5_000,
  Math.min(300_000, Number(process.env.MAIL_IMAP_POLL_COOLDOWN_MS || 20_000) || 20_000)
);
const recentWebhookEvents = [];
const recentCallUpdates = [];
const callUpdatesById = new Map();
const retellCallStatusRefreshByCallId = new Map();
const RETELL_STATUS_REFRESH_COOLDOWN_MS = 8000;
const recentAiCallInsights = [];
const recentDashboardActivities = [];
const recentSecurityAuditEvents = [];
const inMemoryUiStateByScope = new Map();
const aiCallInsightsByCallId = new Map();
const aiAnalysisFingerprintByCallId = new Map();
const aiAnalysisInFlightCallIds = new Set();
const callRecordingTranscriptionPromiseByCallId = new Map();
const generatedAgendaAppointments = [];
const agendaAppointmentIdByCallId = new Map();
const dismissedInterestedLeadCallIds = new Set();
const dismissedInterestedLeadKeys = new Set();
const dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map();
const leadOwnerAssignmentsByCallId = new Map();
let nextLeadOwnerRotationIndex = 0;
let nextGeneratedAgendaAppointmentId = 100000;
const sequentialDispatchQueues = new Map();
const sequentialDispatchQueueIdByCallId = new Map();
let nextSequentialDispatchQueueId = 1;
const confirmationMailRuntimeState = {
  smtpTransporter: null,
  inboundConfirmationMailSyncPromise: null,
  inboundConfirmationMailSyncNotBeforeMs: 0,
  inboundConfirmationMailSyncLastResult: null,
};
let supabaseStateHydrationPromise = null;
let supabaseStateHydrated = false;
let supabasePersistChain = Promise.resolve(true);
let supabaseCallUpdatePersistChain = Promise.resolve(true);
let supabaseHydrateRetryNotBeforeMs = 0;
let supabaseLastHydrateError = '';
let supabaseLastPersistError = '';
let supabaseLastCallUpdatePersistError = '';
let runtimeStateObservedAtMs = 0;
let runtimeStateLastSupabaseSyncCheckMs = 0;
let supabaseCallUpdatesLastSyncCheckMs = 0;
const runtimeStateSyncState = {
  get supabaseStateHydrationPromise() {
    return supabaseStateHydrationPromise;
  },
  set supabaseStateHydrationPromise(value) {
    supabaseStateHydrationPromise = value;
  },
  get supabaseStateHydrated() {
    return supabaseStateHydrated;
  },
  set supabaseStateHydrated(value) {
    supabaseStateHydrated = Boolean(value);
  },
  get supabasePersistChain() {
    return supabasePersistChain;
  },
  set supabasePersistChain(value) {
    supabasePersistChain = value;
  },
  get supabaseCallUpdatePersistChain() {
    return supabaseCallUpdatePersistChain;
  },
  set supabaseCallUpdatePersistChain(value) {
    supabaseCallUpdatePersistChain = value;
  },
  get supabaseHydrateRetryNotBeforeMs() {
    return supabaseHydrateRetryNotBeforeMs;
  },
  set supabaseHydrateRetryNotBeforeMs(value) {
    supabaseHydrateRetryNotBeforeMs = Number(value) || 0;
  },
  get supabaseLastHydrateError() {
    return supabaseLastHydrateError;
  },
  set supabaseLastHydrateError(value) {
    supabaseLastHydrateError = String(value || '');
  },
  get supabaseLastPersistError() {
    return supabaseLastPersistError;
  },
  set supabaseLastPersistError(value) {
    supabaseLastPersistError = String(value || '');
  },
  get supabaseLastCallUpdatePersistError() {
    return supabaseLastCallUpdatePersistError;
  },
  set supabaseLastCallUpdatePersistError(value) {
    supabaseLastCallUpdatePersistError = String(value || '');
  },
  get runtimeStateObservedAtMs() {
    return runtimeStateObservedAtMs;
  },
  set runtimeStateObservedAtMs(value) {
    runtimeStateObservedAtMs = Number(value) || 0;
  },
  get runtimeStateLastSupabaseSyncCheckMs() {
    return runtimeStateLastSupabaseSyncCheckMs;
  },
  set runtimeStateLastSupabaseSyncCheckMs(value) {
    runtimeStateLastSupabaseSyncCheckMs = Number(value) || 0;
  },
  get supabaseCallUpdatesLastSyncCheckMs() {
    return supabaseCallUpdatesLastSyncCheckMs;
  },
  set supabaseCallUpdatesLastSyncCheckMs(value) {
    supabaseCallUpdatesLastSyncCheckMs = Number(value) || 0;
  },
  get nextLeadOwnerRotationIndex() {
    return nextLeadOwnerRotationIndex;
  },
  set nextLeadOwnerRotationIndex(value) {
    nextLeadOwnerRotationIndex = Number(value) || 0;
  },
  get nextGeneratedAgendaAppointmentId() {
    return nextGeneratedAgendaAppointmentId;
  },
  set nextGeneratedAgendaAppointmentId(value) {
    nextGeneratedAgendaAppointmentId = Number(value) || 0;
  },
};
const RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS = 4000;
const RUNTIME_STATE_REMOTE_NEWER_THRESHOLD_MS = 250;
const UI_STATE_SCOPE_PREFIX = 'ui_state:';
const PREMIUM_ACTIVE_ORDERS_SCOPE = 'premium_active_orders';
const PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY = 'softora_custom_orders_premium_v1';
const PREMIUM_ACTIVE_RUNTIME_KEY = 'softora_order_runtime_premium_v1';
const PREMIUM_CUSTOMERS_SCOPE = 'premium_customers_database';
const PREMIUM_CUSTOMERS_KEY = 'softora_customers_premium_v1';
const SEO_UI_STATE_SCOPE = 'seo';
const SEO_UI_STATE_CONFIG_KEY = 'config_json';
const SEO_CONFIG_CACHE_TTL_MS = 15_000;
const SEO_MAX_IMAGES_PER_PAGE = 2000;
const SEO_DEFAULT_SITE_ORIGIN = 'https://www.softora.nl';
const SEO_MODEL_PRESETS = Object.freeze([
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'claude-opus-4.6', label: 'Opus 4.6' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
]);
const SEO_PAGE_FIELD_DEFS = [
  { key: 'title', maxLength: 300 },
  { key: 'metaDescription', maxLength: 1000 },
  { key: 'metaKeywords', maxLength: 1000 },
  { key: 'canonical', maxLength: 1200 },
  { key: 'robots', maxLength: 250 },
  { key: 'ogTitle', maxLength: 300 },
  { key: 'ogDescription', maxLength: 1000 },
  { key: 'ogImage', maxLength: 1200 },
  { key: 'twitterTitle', maxLength: 300 },
  { key: 'twitterDescription', maxLength: 1000 },
  { key: 'twitterImage', maxLength: 1200 },
  { key: 'h1', maxLength: 300 },
];
let seoConfigCache = {
  loadedAtMs: 0,
  config: {
    version: 2,
    pages: {},
    images: {},
    automation: {},
  },
};
const DEMO_CONFIRMATION_TASK_ENABLED = /^(1|true|yes)$/i.test(
  String(process.env.ENABLE_DEMO_CONFIRMATION_TASK || '')
);

const knownHtmlPageFiles = getKnownHtmlPageFiles(__dirname, console);
const knownPrettyPageSlugToFile = createKnownPrettyPageSlugToFile(knownHtmlPageFiles);

function appendOriginalQuery(pathname, originalUrl) {
  const basePath = String(pathname || '').trim() || '/';
  const original = String(originalUrl || '');
  const queryIndex = original.indexOf('?');
  if (queryIndex < 0) return basePath;
  const query = original.slice(queryIndex);
  return `${basePath}${query}`;
}

function getEffectivePublicBaseUrl(req = null, overrideValue = '') {
  return resolveEffectivePublicBaseUrl(req, overrideValue, PUBLIC_BASE_URL);
}

const premiumAdminAllowedIpSet = new Set(
  PREMIUM_ADMIN_IP_ALLOWLIST.split(/[\s,]+/)
    .map((value) => normalizeIpAddress(value))
    .filter(Boolean)
);

const { getStateChangingApiProtectionDecision, isPremiumAdminIpAllowed, isSameOriginApiRequest } = createRequestSecurityContext({
  enforceSameOriginRequests: PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS,
  getEffectivePublicBaseUrl,
  premiumAdminAllowedIpSet,
});

app.disable('x-powered-by');

app.use(
  helmet({
    frameguard: { action: 'deny' },
    permissionsPolicy: {
      features: {
        accelerometer: [],
        autoplay: ['self'],
        camera: [],
        geolocation: [],
        gyroscope: [],
        magnetometer: [],
        microphone: [],
        payment: [],
        usb: [],
      },
    },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        connectSrc: ["'self'", 'https:'],
        mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
        upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: IS_PRODUCTION
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
  })
);

app.use(
  compression({
    threshold: 1024,
    filter(req, res) {
      return !String(res.getHeader('Cache-Control') || '').includes('no-transform') && compression.filter(req, res);
    },
  })
);

app.use(
  express.json({
    limit: '8mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const generalApiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => isPremiumPublicApiRequest(req),
  handler: (req, res) => {
    appendSecurityAuditEvent(
      {
        type: 'rate_limit_hit',
        severity: 'warning',
        success: false,
        email: getPremiumAuthState(req)?.email || '',
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: req.get('user-agent'),
        detail: 'Algemene API rate limit geraakt.',
      },
      'security_rate_limit_hit'
    );
    return res.status(429).json({
      ok: false,
      error: 'Te veel verzoeken. Probeer het over enkele minuten opnieuw.',
    });
  },
});

const premiumLoginRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    appendSecurityAuditEvent(
      {
        type: 'login_rate_limit_hit',
        severity: 'warning',
        success: false,
        email: normalizePremiumSessionEmail(req.body?.email || ''),
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: req.get('user-agent'),
        detail: 'Te veel premium loginpogingen.',
      },
      'security_login_rate_limit_hit'
    );
    return res.status(429).json({
      ok: false,
      error: 'Te veel inlogpogingen. Wacht 10 minuten en probeer opnieuw.',
    });
  },
});

app.use('/api', generalApiRateLimiter);

app.use('/api', (req, res, next) => {
  res.setHeader('X-Robots-Tag', NOINDEX_HEADER_VALUE);
  return next();
});

app.use('/api', (req, res, next) => {
  const protectionDecision = getStateChangingApiProtectionDecision(req);
  if (protectionDecision.allowed) return next();

  appendSecurityAuditEvent(
    {
      type: protectionDecision.reason || 'csrf_origin_blocked',
      severity: 'warning',
      success: false,
      email: getPremiumAuthState(req)?.email || '',
      ip: getClientIpFromRequest(req),
      path: getRequestPathname(req),
      origin: getRequestOriginFromHeaders(req),
      userAgent: req.get('user-agent'),
      detail: protectionDecision.detail || 'State-changing API request geweigerd door API-beveiliging.',
    },
    `security_${protectionDecision.reason || 'same_origin_blocked'}`
  );

  return res.status(403).json({
    ok: false,
    error: protectionDecision.publicMessage || 'Verzoek geweigerd door API-beveiliging.',
  });
});

app.use((req, _res, next) => {
  const requestPath = String(req.path || '');
  if (!isSupabaseConfigured()) return next();
  if (!requestPath.startsWith('/api/')) return next();

  ensureRuntimeStateHydratedFromSupabase()
    .then(() => next())
    .catch((error) => {
      console.error('[Supabase][HydrateMiddlewareError]', error?.message || error);
      next();
    });
});

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

const supabaseStateStore = createSupabaseStateStore({
  supabaseUrl: SUPABASE_URL,
  supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  supabaseStateTable: SUPABASE_STATE_TABLE,
  supabaseStateKey: SUPABASE_STATE_KEY,
  supabaseCallUpdateStateKeyPrefix: SUPABASE_CALL_UPDATE_STATE_KEY_PREFIX,
  supabaseCallUpdateRowsFetchLimit: SUPABASE_CALL_UPDATE_ROWS_FETCH_LIMIT,
  normalizeString,
  truncateText,
});

const {
  buildSupabaseCallUpdateStateKey,
  extractCallIdFromSupabaseCallUpdateStateKey,
  fetchSupabaseCallUpdateRowsViaRest,
  fetchSupabaseRowByKeyViaRest,
  fetchSupabaseStateRowViaRest,
  getSupabaseClient,
  isSupabaseConfigured,
  redactSupabaseUrlForDebug,
  upsertSupabaseRowViaRest,
  upsertSupabaseStateRowViaRest,
} = supabaseStateStore;

function isPremiumAuthConfigured() {
  return premiumUsersStore.hasConfiguredUsers();
}

function normalizePremiumSessionEmail(value) {
  return normalizeString(value).toLowerCase();
}

let premiumMfaManager = null;

function getPremiumMfaManager() {
  if (premiumMfaManager) return premiumMfaManager;
  premiumMfaManager = createTotpManager({
    secret: PREMIUM_MFA_TOTP_SECRET,
    normalizeString,
  });
  return premiumMfaManager;
}

function isPremiumMfaConfigured() {
  return getPremiumMfaManager().isConfigured();
}

function isPremiumMfaCodeValid(codeRaw) {
  return getPremiumMfaManager().isCodeValid(codeRaw);
}

const premiumUsersStore = createPremiumUsersStore({
  config: {
    premiumLoginEmails: PREMIUM_LOGIN_EMAILS,
    premiumLoginPassword: PREMIUM_LOGIN_PASSWORD,
    premiumLoginPasswordHash: PREMIUM_LOGIN_PASSWORD_HASH,
    premiumSessionSecret: PREMIUM_SESSION_SECRET,
    premiumAuthUsersRowKey: PREMIUM_AUTH_USERS_ROW_KEY,
    premiumAuthUsersVersion: PREMIUM_AUTH_USERS_VERSION,
    supabaseStateTable: SUPABASE_STATE_TABLE,
  },
  deps: {
    normalizeString,
    truncateText,
    timingSafeEqualStrings,
    normalizePremiumSessionEmail,
    isSupabaseConfigured,
    getSupabaseClient,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
  },
});

function normalizeLeadOwnerKey(value) {
  const normalized = normalizeString(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized.includes('serve')) return 'serve';
  if (normalized.includes('martijn')) return 'martijn';
  return normalized;
}

function buildLeadOwnerFallbackRecord(key) {
  if (key === 'martijn') {
    return {
      key: 'martijn',
      displayName: 'Martijn van de Ven',
      fullName: 'Martijn van de Ven',
      userId: '',
      email: '',
    };
  }
  return {
    key: 'serve',
    displayName: 'Servé Creusen',
    fullName: 'Servé Creusen',
    userId: '',
    email: '',
  };
}

function buildLeadOwnerRecordFromUser(user, fallbackKey) {
  const fallback = buildLeadOwnerFallbackRecord(fallbackKey);
  const fullName = premiumUsersStore.buildUserDisplayName(user) || fallback.fullName;
  return {
    key: fallback.key,
    displayName: fullName,
    fullName,
    userId: truncateText(normalizeString(user?.id || ''), 120),
    email: normalizePremiumSessionEmail(user?.email || ''),
  };
}

function getLeadOwnerPool() {
  const activeUsers = premiumUsersStore
    .getCachedUsers()
    .filter((user) => user && normalizeString(user?.status || '').toLowerCase() !== 'inactive');

  const serveUser =
    activeUsers.find((user) => {
      const display = normalizeLeadOwnerKey(premiumUsersStore.buildUserDisplayName(user));
      const email = normalizeLeadOwnerKey(user?.email || '');
      return display.includes('serve') || email.includes('serve');
    }) || null;
  const martijnUser =
    activeUsers.find((user) => {
      const display = normalizeLeadOwnerKey(premiumUsersStore.buildUserDisplayName(user));
      const email = normalizeLeadOwnerKey(user?.email || '');
      return display.includes('martijn') || email.includes('martijn');
    }) || null;

  return [
    serveUser ? buildLeadOwnerRecordFromUser(serveUser, 'serve') : buildLeadOwnerFallbackRecord('serve'),
    martijnUser ? buildLeadOwnerRecordFromUser(martijnUser, 'martijn') : buildLeadOwnerFallbackRecord('martijn'),
  ];
}

function normalizeLeadOwnerRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const fallbackKey = normalizeLeadOwnerKey(value.key || value.displayName || value.fullName || value.email || '') || 'serve';
  const fallback = buildLeadOwnerFallbackRecord(fallbackKey);
  const rawDisplayName = truncateText(normalizeString(value.displayName || value.name || ''), 80);
  const rawFullName =
    truncateText(normalizeString(value.fullName || value.displayName || value.name || ''), 160) || rawDisplayName;
  const looksLikeUsername = (input) => {
    const text = normalizeString(input || '');
    if (!text) return true;
    if (/\s/.test(text)) return false;
    return /^[a-z0-9._-]{3,}$/i.test(text);
  };
  const forceFallbackHumanName =
    (fallback.key === 'martijn' || fallback.key === 'serve') &&
    (looksLikeUsername(rawDisplayName) || looksLikeUsername(rawFullName));
  return {
    key: fallback.key,
    displayName: forceFallbackHumanName ? fallback.displayName : rawDisplayName || fallback.displayName,
    fullName: forceFallbackHumanName ? fallback.fullName : rawFullName || fallback.fullName,
    userId: truncateText(normalizeString(value.userId || value.id || ''), 120),
    email: normalizePremiumSessionEmail(value.email || ''),
  };
}

function getOrAssignLeadOwnerByCallId(callId, options = {}) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;

  const existing = normalizeLeadOwnerRecord(leadOwnerAssignmentsByCallId.get(normalizedCallId));
  if (existing) {
    leadOwnerAssignmentsByCallId.set(normalizedCallId, existing);
    return existing;
  }

  if (options.createIfMissing === false) return null;

  const pool = getLeadOwnerPool();
  if (!pool.length) return null;
  const index = Math.abs(Number(nextLeadOwnerRotationIndex) || 0) % pool.length;
  const assigned = normalizeLeadOwnerRecord(pool[index]);
  nextLeadOwnerRotationIndex = (index + 1) % pool.length;
  leadOwnerAssignmentsByCallId.set(normalizedCallId, assigned);
  queueRuntimeStatePersist('lead_owner_assignment');
  return assigned;
}

function buildLeadOwnerFields(callId, existingValue = null) {
  const existing = normalizeLeadOwnerRecord(existingValue);
  if (existing) {
    return {
      leadOwnerKey: existing.key,
      leadOwnerName: existing.displayName,
      leadOwnerFullName: existing.fullName,
      leadOwnerUserId: existing.userId,
      leadOwnerEmail: existing.email,
    };
  }

  const assigned = getOrAssignLeadOwnerByCallId(callId);
  if (!assigned) {
    return {
      leadOwnerKey: '',
      leadOwnerName: '',
      leadOwnerFullName: '',
      leadOwnerUserId: '',
      leadOwnerEmail: '',
    };
  }

  return {
    leadOwnerKey: assigned.key,
    leadOwnerName: assigned.displayName,
    leadOwnerFullName: assigned.fullName,
    leadOwnerUserId: assigned.userId,
    leadOwnerEmail: assigned.email,
  };
}

let premiumSessionManager = null;

function getPremiumSessionManager() {
  if (premiumSessionManager) return premiumSessionManager;
  premiumSessionManager = createPremiumSessionManager({
    sessionSecret: PREMIUM_SESSION_SECRET,
    sessionCookieName: PREMIUM_SESSION_COOKIE_NAME,
    defaultSessionTtlMs: PREMIUM_SESSION_TTL_HOURS * 60 * 60 * 1000,
    isProduction: IS_PRODUCTION,
    isAuthConfigured: isPremiumAuthConfigured,
    isSecureHttpRequest,
    normalizeString,
    truncateText,
    normalizeSessionEmail: normalizePremiumSessionEmail,
  });
  return premiumSessionManager;
}

function createPremiumSessionToken({ email, maxAgeMs, userId = '', role = '' }) {
  return getPremiumSessionManager().createSessionToken({ email, maxAgeMs, userId, role });
}

function readPremiumSessionTokenFromRequest(req) {
  return getPremiumSessionManager().readSessionTokenFromRequest(req);
}

function verifyPremiumSessionToken(token) {
  return getPremiumSessionManager().verifySessionToken(token);
}

const {
  buildPremiumAuthSessionPayload,
  getPremiumAuthState,
  getResolvedPremiumAuthState,
  getSafePremiumRedirectPath,
  isPremiumPublicApiRequest,
} = createPremiumAuthStateManager({
  sessionSecret: PREMIUM_SESSION_SECRET,
  normalizeString,
  truncateText,
  normalizeSessionEmail: normalizePremiumSessionEmail,
  readSessionTokenFromRequest: readPremiumSessionTokenFromRequest,
  verifySessionToken: verifyPremiumSessionToken,
  premiumUsersStore,
  isPremiumMfaConfigured,
  getRequestPathname,
});

function buildPremiumSessionCookieHeader(req, token, maxAgeMs) {
  return getPremiumSessionManager().buildSessionCookieHeader(req, token, maxAgeMs);
}

function setPremiumSessionCookie(req, res, token, maxAgeMs) {
  res.append('Set-Cookie', buildPremiumSessionCookieHeader(req, token, maxAgeMs));
}

function clearPremiumSessionCookie(req, res) {
  res.append('Set-Cookie', getPremiumSessionManager().buildClearedSessionCookieHeader(req));
}

const runtimeEventStore = createRuntimeEventStore({
  recentDashboardActivities,
  recentSecurityAuditEvents,
  queueRuntimeStatePersist,
  normalizeString,
  truncateText,
  normalizePremiumSessionEmail,
  normalizeIpAddress,
  normalizeOrigin,
});

const { appendDashboardActivity, appendSecurityAuditEvent } = runtimeEventStore;

const { requirePremiumAdminApiAccess, requirePremiumApiAccess } = createPremiumApiAccessGuard({
  isPremiumPublicApiRequest,
  getResolvedPremiumAuthState,
  isPremiumAdminIpAllowed,
  appendSecurityAuditEvent,
  getClientIpFromRequest,
  getRequestPathname,
  getRequestOriginFromHeaders,
  clearPremiumSessionCookie,
});

const { resolvePremiumHtmlPageAccess } = createPremiumHtmlPageAccessController({
  premiumPublicHtmlFiles: PREMIUM_PUBLIC_HTML_FILES,
  noindexHeaderValue: NOINDEX_HEADER_VALUE,
  getResolvedPremiumAuthState,
  getSafePremiumRedirectPath,
  clearPremiumSessionCookie,
  isPremiumAdminIpAllowed,
  appendSecurityAuditEvent,
  getClientIpFromRequest,
  getRequestOriginFromHeaders,
});

const { requireRuntimeDebugAccess } = createRuntimeDebugAccessGuard({
  isProduction: IS_PRODUCTION,
  enableRuntimeDebugRoutes: PREMIUM_ENABLE_RUNTIME_DEBUG_ROUTES,
  getPremiumAuthState,
  isPremiumAdminIpAllowed,
  appendSecurityAuditEvent,
  getClientIpFromRequest,
  getRequestPathname,
  getRequestOriginFromHeaders,
});

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function clipText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  if (!Number.isFinite(Number(maxLength)) || Number(maxLength) <= 0) return '';
  const limit = Math.floor(Number(maxLength));
  return text.length > limit ? text.slice(0, limit) : text;
}

const { parseImageDataUrl, sanitizeReferenceImages, sanitizeLaunchDomainName, slugifyAutomationText } =
  createWebsiteInputHelpers({
    normalizeString,
    truncateText,
  });
const {
  buildAnthropicWebsiteHtmlPrompts,
  buildLocalWebsiteBlueprint,
  buildWebsiteGenerationContext,
  buildWebsiteGenerationPrompts,
  buildWebsitePreviewBriefFromScan,
  buildWebsitePreviewDownloadFileName,
  buildWebsitePreviewPromptFromScan,
  ensureHtmlDocument,
  ensureStrictAnthropicHtml,
  getAnthropicWebsiteStageEffort,
  getAnthropicWebsiteStageMaxTokens,
  isLikelyUsableWebsiteHtml,
  supportsAnthropicAdaptiveThinking,
} = createWebsiteGenerationHelpers({
  env: process.env,
  normalizeString,
  truncateText,
  clipText,
  escapeHtml,
  sanitizeReferenceImages,
});
let agendaInterestedLeadReadService = null;
let agendaInterestedLeadStateService = null;
let agendaMetadataService = null;

const agendaTaskHelpers = createAgendaTaskHelpers({
  normalizeString,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  truncateText,
  toBooleanSafe,
  normalizeEmailAddress: (value) => normalizeString(String(value || '').trim().toLowerCase()),
  getLatestCallUpdateByCallId,
  resolveAppointmentCallId,
  normalizeColdcallingStack,
  getColdcallingStackLabel,
  resolveAgendaLocationValue: (...args) =>
    agendaMetadataService?.resolveAgendaLocationValue(...args) ||
    truncateText(normalizeString(args[0] || ''), 220),
  resolveCallDurationSeconds,
  buildLeadOwnerFields,
});

const {
  compareConfirmationTasks,
  formatDateTimeLabelNl,
  mapAppointmentToConfirmationTask,
  sanitizeAppointmentLocation,
  sanitizeAppointmentWhatsappInfo,
} = agendaTaskHelpers;

const agendaAppointmentStateService = createAgendaAppointmentStateService({
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  agendaAppointmentIdByCallId,
  getRecentDashboardActivities: () => recentDashboardActivities,
  queueRuntimeStatePersist,
  normalizeString,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  sanitizeAppointmentLocation,
});

const {
  extractAgendaScheduleFromDashboardActivity,
  getGeneratedAppointmentIndexById,
  repairAgendaAppointmentsFromDashboardActivities,
  setGeneratedAgendaAppointmentAtIndex,
} = agendaAppointmentStateService;

agendaMetadataService = createAgendaMetadataService({
  normalizeString,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  truncateText,
  toBooleanSafe,
  sanitizeAppointmentLocation,
  sanitizeAppointmentWhatsappInfo,
  isWeakAppointmentLocationText,
  extractAddressLikeLocationFromText,
  summaryContainsEnglishMarkers,
  getOpenAiApiKey,
  generateTextSummaryWithAi,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  setGeneratedAgendaAppointmentAtIndex,
  queueRuntimeStatePersist,
  agendaAppointmentIdByCallId,
  getLatestCallUpdateByCallId,
  aiCallInsightsByCallId,
  resolveAppointmentLocation,
  resolvePreferredRecordingUrl,
  resolveCallDurationSeconds,
  refreshCallUpdateFromTwilioStatusApi,
  refreshCallUpdateFromRetellStatusApi,
});

const {
  backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
  buildLeadToAgendaSummary,
  compareAgendaAppointments,
  isGeneratedAppointmentVisibleForAgenda,
  refreshAgendaAppointmentCallSourcesIfNeeded,
  refreshGeneratedAgendaSummariesIfNeeded,
  resolveAgendaLocationValue,
} = agendaMetadataService;

const confirmationMailService = createConfirmationMailService({
  mailConfig: {
    smtpHost: MAIL_SMTP_HOST,
    smtpPort: MAIL_SMTP_PORT,
    smtpSecure: MAIL_SMTP_SECURE,
    smtpUser: MAIL_SMTP_USER,
    smtpPass: MAIL_SMTP_PASS,
    mailFromAddress: MAIL_FROM_ADDRESS,
    mailFromName: MAIL_FROM_NAME,
    mailReplyTo: MAIL_REPLY_TO,
    imapHost: MAIL_IMAP_HOST,
    imapPort: MAIL_IMAP_PORT,
    imapSecure: MAIL_IMAP_SECURE,
    imapUser: MAIL_IMAP_USER,
    imapPass: MAIL_IMAP_PASS,
    imapMailbox: MAIL_IMAP_MAILBOX,
    imapExtraMailboxes: MAIL_IMAP_EXTRA_MAILBOXES,
    imapPollCooldownMs: MAIL_IMAP_POLL_COOLDOWN_MS,
  },
  runtimeState: confirmationMailRuntimeState,
  generatedAgendaAppointments,
  appendDashboardActivity,
  getGeneratedAppointmentIndexById,
  mapAppointmentToConfirmationTask,
  normalizeDateYyyyMmDd,
  normalizeString,
  normalizeTimeHhMm,
  setGeneratedAgendaAppointmentAtIndex,
  formatDateTimeLabelNl,
  truncateText,
});
const {
  buildConfirmationEmailDraftFallback,
  getMissingImapMailEnv,
  getMissingSmtpMailEnv,
  isImapMailConfigured,
  isLikelyValidEmail,
  isSmtpMailConfigured,
  normalizeEmailAddress,
  sendConfirmationEmailViaSmtp,
  syncInboundConfirmationEmailsFromImap,
} = confirmationMailService;

const runtimeBackupCoordinator = createRuntimeBackupCoordinator({
  normalizeString,
  truncateText,
  parseNumberSafe,
  toBooleanSafe,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  resolveCallDurationSeconds,
  normalizeLeadOwnerRecord,
  recentWebhookEvents,
  recentCallUpdates,
  recentAiCallInsights,
  recentDashboardActivities,
  recentSecurityAuditEvents,
  generatedAgendaAppointments,
  dismissedInterestedLeadCallIds,
  dismissedInterestedLeadKeys,
  dismissedInterestedLeadKeyUpdatedAtMsByKey,
  leadOwnerAssignmentsByCallId,
  getNextLeadOwnerRotationIndex: () => nextLeadOwnerRotationIndex,
  getNextGeneratedAgendaAppointmentId: () => nextGeneratedAgendaAppointmentId,
  appName: 'softora-retell-coldcalling-backend',
  appVersion: APP_VERSION,
  getPublicFeatureFlags,
  routeManifest,
});

const {
  buildRuntimeBackupForOps,
  buildRuntimeStateSnapshotPayloadWithLimits,
  buildSupabaseCallUpdatePayload,
  compactRuntimeSnapshotAiInsight,
  compactRuntimeSnapshotCallUpdate,
  compactRuntimeSnapshotDashboardActivity,
  compactRuntimeSnapshotGeneratedAgendaAppointment,
  compactRuntimeSnapshotSecurityAuditEvent,
  compactRuntimeSnapshotText,
  compactRuntimeSnapshotWebhookEvent,
  extractSupabaseCallUpdateFromRow: extractSupabaseCallUpdateFromRowFromSnapshot,
} = runtimeBackupCoordinator;

function extractSupabaseCallUpdateFromRow(row) {
  return extractSupabaseCallUpdateFromRowFromSnapshot(row, {
    extractCallIdFromStateKey: extractCallIdFromSupabaseCallUpdateStateKey,
  });
}

const runtimeStateSyncCoordinator = createRuntimeStateSyncCoordinator({
  isSupabaseConfigured,
  getSupabaseClient,
  fetchSupabaseStateRowViaRest,
  upsertSupabaseStateRowViaRest,
  fetchSupabaseCallUpdateRowsViaRest,
  upsertSupabaseRowViaRest,
  fetchSupabaseRowByKeyViaRest,
  supabaseStateTable: SUPABASE_STATE_TABLE,
  supabaseStateKey: SUPABASE_STATE_KEY,
  supabaseDismissedLeadsStateKey: SUPABASE_DISMISSED_LEADS_STATE_KEY,
  supabaseCallUpdateStateKeyPrefix: SUPABASE_CALL_UPDATE_STATE_KEY_PREFIX,
  supabaseCallUpdateRowsFetchLimit: SUPABASE_CALL_UPDATE_ROWS_FETCH_LIMIT,
  runtimeStateSupabaseSyncCooldownMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS,
  runtimeStateRemoteNewerThresholdMs: RUNTIME_STATE_REMOTE_NEWER_THRESHOLD_MS,
  normalizeString,
  truncateText,
  parseNumberSafe,
  buildSupabaseCallUpdateStateKey,
  extractSupabaseCallUpdateFromRow,
  buildSupabaseCallUpdatePayload,
  buildRuntimeStateSnapshotPayloadWithLimits,
  compactRuntimeSnapshotWebhookEvent,
  compactRuntimeSnapshotCallUpdate,
  compactRuntimeSnapshotAiInsight,
  compactRuntimeSnapshotDashboardActivity,
  compactRuntimeSnapshotSecurityAuditEvent,
  compactRuntimeSnapshotGeneratedAgendaAppointment,
  normalizeLeadOwnerRecord,
  recentWebhookEvents,
  recentCallUpdates,
  callUpdatesById,
  recentAiCallInsights,
  aiCallInsightsByCallId,
  recentDashboardActivities,
  recentSecurityAuditEvents,
  generatedAgendaAppointments,
  agendaAppointmentIdByCallId,
  dismissedInterestedLeadCallIds,
  dismissedInterestedLeadKeys,
  dismissedInterestedLeadKeyUpdatedAtMsByKey,
  leadOwnerAssignmentsByCallId,
  upsertRecentCallUpdate,
  logger: console,
  runtimeState: runtimeStateSyncState,
});

const {
  applyRuntimeStateSnapshotPayload,
  buildCallUpdateRowPersistMeta,
  ensureRuntimeStateHydratedFromSupabase,
  forceHydrateRuntimeStateWithRetries,
  invalidateSupabaseSyncTimestamp,
  persistRuntimeStateToSupabase,
  queueCallUpdateRowPersist,
  syncCallUpdatesFromSupabaseRows,
  syncRuntimeStateFromSupabaseIfNewer,
  waitForQueuedCallUpdateRowPersist,
  waitForQueuedRuntimeSnapshotPersist,
  waitForQueuedRuntimeStatePersist,
  persistDismissedLeadsToSupabase,
} = runtimeStateSyncCoordinator;

function queueRuntimeStatePersist(reason = 'unknown') {
  return runtimeStateSyncCoordinator.queueRuntimeStatePersist(reason);
}

function buildRuntimeStateSnapshotPayload() {
  return buildRuntimeStateSnapshotPayloadWithLimits();
}

const uiStateStore = createUiStateStore({
  uiStateScopePrefix: UI_STATE_SCOPE_PREFIX,
  inMemoryUiStateByScope,
  isSupabaseConfigured,
  getSupabaseClient,
  supabaseStateTable: SUPABASE_STATE_TABLE,
  fetchSupabaseRowByKeyViaRest,
  upsertSupabaseRowViaRest,
  normalizeString,
  truncateText,
  logger: console,
});

const { getUiStateValues, normalizeUiStateScope, sanitizeUiStateValues, setUiStateValues } =
  uiStateStore;

const seoCore = createSeoCore({
  knownHtmlPageFiles,
  normalizeAbsoluteHttpUrl,
  normalizeString,
  normalizeWebsitePreviewTargetUrl,
  parseIntSafe,
  seoDefaultSiteOrigin: SEO_DEFAULT_SITE_ORIGIN,
  seoMaxImagesPerPage: SEO_MAX_IMAGES_PER_PAGE,
  seoModelPresets: SEO_MODEL_PRESETS,
  seoPageFieldDefs: SEO_PAGE_FIELD_DEFS,
  toBooleanSafe,
  truncateText,
});

const {
  applySeoAuditSuggestionsToConfig,
  applySeoOverridesToHtml,
  buildSeoPageAuditEntry,
  extractImageEntriesFromHtml,
  extractSeoSourceFromHtml,
  extractWebsitePreviewScanFromHtml,
  getDefaultSeoConfig,
  getSeoEditableHtmlFiles,
  getSeoModelPresetOptions,
  mergeSeoSourceWithOverrides,
  normalizeSeoAutomationSettings,
  normalizeSeoConfig,
  normalizeSeoImageOverridePatch,
  normalizeSeoModelPreset,
  normalizeSeoPageOverridePatch,
  normalizeSeoStoredImageOverrides,
  normalizeSeoStoredPageOverrides,
  sanitizeKnownHtmlFileName,
} = seoCore;

const aiHelpers = createAiHelpers({
  anthropicModel: ANTHROPIC_MODEL,
  env: process.env,
  normalizeString,
  openAiModel: OPENAI_MODEL,
  truncateText,
});

const {
  estimateAnthropicTextCost,
  estimateAnthropicUsageCost,
  estimateOpenAiTextCost,
  estimateOpenAiUsageCost,
  extractAnthropicTextContent,
  extractOpenAiTextContent,
  extractRetellTranscriptText,
  extractTranscriptFull,
  extractTranscriptSnippet,
  extractTranscriptText,
  parseJsonLoose,
} = aiHelpers;

const agendaLeadDetailService = createAgendaLeadDetailService({
  openAiApiBaseUrl: OPENAI_API_BASE_URL,
  openAiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || '',
  openAiAudioTranscriptionModel: process.env.OPENAI_AUDIO_TRANSCRIPTION_MODEL || '',
  publicBaseUrl: PUBLIC_BASE_URL,
  recentWebhookEvents,
  recentCallUpdates,
  transcriptionPromiseByCallId: callRecordingTranscriptionPromiseByCallId,
  aiCallInsightsByCallId,
  normalizeString,
  truncateText,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  sanitizeAppointmentLocation,
  sanitizeAppointmentWhatsappInfo,
  resolveAppointmentCallId,
  getLatestCallUpdateByCallId,
  resolvePreferredRecordingUrl,
  normalizeAbsoluteHttpUrl,
  inferCallProvider,
  isTwilioStatusApiConfigured,
  fetchTwilioRecordingsByCallId,
  choosePreferredTwilioRecording,
  buildTwilioRecordingMediaUrl,
  fetchBinaryWithTimeout,
  getTwilioBasicAuthorizationHeader,
  parseJsonLoose,
  getOpenAiApiKey,
  upsertRecentCallUpdate,
  upsertAiCallInsight,
  ensureRuleBasedInsightAndAppointment,
  maybeAnalyzeCallUpdateWithAi,
  summaryContainsEnglishMarkers,
  generateTextSummaryWithAi,
  resolveCallDurationSeconds,
  findInterestedLeadRowByCallId: (...args) => agendaInterestedLeadReadService?.findInterestedLeadRowByCallId(...args) || null,
  extractTranscriptFull,
  extractTwilioRecordingSidFromUrl,
  logger: console,
});

const {
  buildCallBackedLeadDetail,
  buildConversationSummaryForLeadDetail,
  buildRecordingFileNameForTranscription,
  getAppointmentTranscriptText,
  getOpenAiTranscriptionModelCandidates,
  pickReadableConversationSummaryForLeadDetail,
} = agendaLeadDetailService;

async function readSeoConfigFromUiState() {
  const state = await getUiStateValues(SEO_UI_STATE_SCOPE);
  const rawJson = normalizeString(state?.values?.[SEO_UI_STATE_CONFIG_KEY] || '');
  if (!rawJson) return getDefaultSeoConfig();

  try {
    const parsed = JSON.parse(rawJson);
    return normalizeSeoConfig(parsed);
  } catch (error) {
    console.warn('[SEO Config][ParseError]', error?.message || error);
    return getDefaultSeoConfig();
  }
}

async function getSeoConfigCached(forceFresh = false) {
  const nowMs = Date.now();
  if (!forceFresh && nowMs - seoConfigCache.loadedAtMs < SEO_CONFIG_CACHE_TTL_MS) {
    return seoConfigCache.config;
  }

  const config = await readSeoConfigFromUiState();
  seoConfigCache = {
    loadedAtMs: nowMs,
    config,
  };
  return config;
}

async function persistSeoConfig(config, meta = {}) {
  const normalizedConfig = normalizeSeoConfig(config);
  const payload = {
    [SEO_UI_STATE_CONFIG_KEY]: JSON.stringify(normalizedConfig),
  };

  const state = await setUiStateValues(SEO_UI_STATE_SCOPE, payload, {
    source: normalizeString(meta.source || 'seo-dashboard'),
    actor: normalizeString(meta.actor || ''),
  });

  if (!state) return null;

  seoConfigCache = {
    loadedAtMs: Date.now(),
    config: normalizedConfig,
  };
  return normalizedConfig;
}

let getRuntimeHtmlPageBootstrapData = async () => null;

const { readHtmlPageContent, resolveSeoPageFileFromRequest, sendSeoManagedHtmlPageResponse } =
  createHtmlPageCoordinator({
    pagesDir: __dirname,
    logger: console,
    sanitizeKnownHtmlFileName,
    normalizeString,
    knownPrettyPageSlugToFile,
    resolvePremiumHtmlPageAccess,
    getSeoConfigCached,
    applySeoOverridesToHtml,
    getPageBootstrapData: (req, fileName) => getRuntimeHtmlPageBootstrapData(req, fileName),
  });

const seoReadCoordinator = createSeoReadCoordinator({
  logger: console,
  getSeoConfigCached,
  normalizeSeoConfig,
  getSeoEditableHtmlFiles,
  readHtmlPageContent,
  extractSeoSourceFromHtml,
  normalizeSeoStoredPageOverrides,
  normalizeSeoStoredImageOverrides,
  mergeSeoSourceWithOverrides,
  extractImageEntriesFromHtml,
  normalizeString,
  resolveSeoPageFileFromRequest,
  buildSeoPageAuditEntry,
  getSeoModelPresetOptions,
  normalizeSeoAutomationSettings,
});

const seoWriteCoordinator = createSeoWriteCoordinator({
  logger: console,
  resolveSeoPageFileFromRequest,
  normalizeSeoPageOverridePatch,
  normalizeSeoImageOverridePatch,
  getSeoConfigCached,
  normalizeSeoConfig,
  seoPageFieldDefs: SEO_PAGE_FIELD_DEFS,
  normalizeString,
  persistSeoConfig,
  appendDashboardActivity,
  normalizeSeoModelPreset,
  applySeoAuditSuggestionsToConfig,
  seoReadCoordinator,
  normalizeSeoAutomationSettings,
  getSeoModelPresetOptions,
});

const runtimeOpsCoordinator = createRuntimeOpsCoordinator({
  parseIntSafe,
  recentDashboardActivities,
  recentSecurityAuditEvents,
  normalizeString,
  appendDashboardActivity,
  normalizeUiStateScope,
  getUiStateValues,
  sanitizeUiStateValues,
  setUiStateValues,
});

const runtimeDebugOpsCoordinator = createRuntimeDebugOpsCoordinator({
  isSupabaseConfigured,
  supabaseUrl: SUPABASE_URL,
  supabaseStateTable: SUPABASE_STATE_TABLE,
  supabaseStateKey: SUPABASE_STATE_KEY,
  supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  redactSupabaseUrlForDebug,
  truncateText,
  fetchImpl: fetch,
  getBeforeState: () => ({
    hydrated: supabaseStateHydrated,
    lastHydrateError: supabaseLastHydrateError || null,
    lastPersistError: supabaseLastPersistError || null,
    lastCallUpdatePersistError: supabaseLastCallUpdatePersistError || null,
  }),
  persistRuntimeStateToSupabase,
  resetHydrationState: () => {
    supabaseStateHydrated = false;
    supabaseHydrateRetryNotBeforeMs = 0;
  },
  ensureRuntimeStateHydratedFromSupabase,
  getAfterState: () => ({
    hydrated: supabaseStateHydrated,
    lastHydrateError: supabaseLastHydrateError || null,
    lastPersistError: supabaseLastPersistError || null,
    lastCallUpdatePersistError: supabaseLastCallUpdatePersistError || null,
    counts: {
      webhookEvents: recentWebhookEvents.length,
      callUpdates: recentCallUpdates.length,
      aiCallInsights: recentAiCallInsights.length,
      appointments: generatedAgendaAppointments.length,
    },
  }),
});

const { runActiveOrderLaunchPipeline } = createActiveOrderAutomationService({
  automationEnabled: ACTIVE_ORDER_AUTOMATION_ENABLED,
  githubToken: ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN,
  githubOwner: ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER,
  githubPrivate: ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE,
  githubOwnerIsOrg: ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG,
  githubRepoPrefix: ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX,
  githubDefaultBranch: ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH,
  vercelToken: ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN,
  vercelScope: ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE,
  stratoCommand: ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND,
  stratoWebhookUrl: ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL,
  stratoWebhookToken: ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN,
  normalizeString,
  truncateText,
  sanitizeLaunchDomainName,
  slugifyAutomationText,
  logger: console,
});

const activeOrdersCoordinator = createActiveOrdersCoordinator({
  normalizeString,
  truncateText,
  sanitizeReferenceImages,
  sanitizeLaunchDomainName,
  generateWebsiteHtmlWithAi,
  runActiveOrderLaunchPipeline,
  appendDashboardActivity,
  getOpenAiApiKey,
  getAnthropicApiKey,
  getWebsiteGenerationProvider,
  getWebsiteAnthropicModel,
  openAiModel: OPENAI_MODEL,
  websiteGenerationStrictAnthropic: WEBSITE_GENERATION_STRICT_ANTHROPIC,
  websiteGenerationStrictHtml: WEBSITE_GENERATION_STRICT_HTML,
});

const agendaPostCallHelpers = createAgendaPostCallHelpers({
  normalizeString,
  truncateText,
  sanitizeLaunchDomainName,
  sanitizeReferenceImages,
  sanitizePostCallText,
  normalizePostCallStatus,
});

const aiToolsCoordinator = createAiToolsCoordinator({
  normalizeString,
  truncateText,
  fetchWebsitePreviewScanFromUrl,
  generateWebsitePreviewImageWithAi,
  appendDashboardActivity,
  getOpenAiApiKey,
  openAiImageModel: OPENAI_IMAGE_MODEL,
  buildOrderDossierInput,
  generateDynamicOrderDossierWithAnthropic,
  buildOrderDossierFallbackLayout,
  getAnthropicApiKey,
  getDossierAnthropicModel,
  generateWebsitePromptFromTranscriptWithAi,
  buildWebsitePromptFallback,
  extractMeetingNotesFromImageWithAi,
  logger: console,
});

const websiteLinkCoordinator = createWebsiteLinkCoordinator({
  logger: console, normalizeString, truncateText, slugifyAutomationText, isSupabaseConfigured,
  fetchSupabaseRowByKeyViaRest, upsertSupabaseRowViaRest,
  websiteLinkStateKeyPrefix: `${SUPABASE_STATE_KEY}:website_link:`, knownPrettyPageSlugToFile,
  resolveLegacyPrettyPageRedirect, getPublicBaseUrlFromRequest: getEffectivePublicBaseUrl, appendDashboardActivity,
});

const rubenAssistant = createRubenAssistant({
  normalizeString,
  truncateText,
  parseJsonLoose,
  getUiStateValues,
  assistantMemoryScope: 'ruben_nijhuis_memory',
  assistantName: 'Ruben Nijhuis',
});

const aiDashboardCoordinator = createAiDashboardCoordinator({
  normalizeString,
  truncateText,
  parseJsonLoose,
  parseNumberSafe,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  toBooleanSafe,
  resolvePreferredRecordingUrl,
  getUiStateValues,
  premiumActiveOrdersScope: PREMIUM_ACTIVE_ORDERS_SCOPE,
  premiumCustomersScope: PREMIUM_CUSTOMERS_SCOPE,
  premiumActiveCustomOrdersKey: PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY,
  premiumActiveRuntimeKey: PREMIUM_ACTIVE_RUNTIME_KEY,
  premiumCustomersKey: PREMIUM_CUSTOMERS_KEY,
  parseCustomOrdersFromUiState: agendaPostCallHelpers.parseCustomOrdersFromUiState,
  recentCallUpdates,
  generatedAgendaAppointments,
  recentAiCallInsights,
  recentDashboardActivities,
  getOpenAiApiKey,
  fetchJsonWithTimeout,
  openAiApiBaseUrl: OPENAI_API_BASE_URL,
  openAiModel: OPENAI_MODEL,
  extractOpenAiTextContent,
  ensureDashboardChatRuntimeReady: async () => {
    if (isSupabaseConfigured() && !supabaseStateHydrated) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    backfillInsightsAndAppointmentsFromRecentCallUpdates();
  },
  normalizeAiSummaryStyle,
  generateTextSummaryWithAi,
  parseIntSafe,
  rubenAssistant,
});

function extractCallUpdateFromRetellPayload(payload) {
  const event = normalizeString(payload?.event || payload?.type || 'retell.webhook.unknown');
  const call = payload?.call && typeof payload.call === 'object' ? payload.call : {};
  const callId = normalizeString(call?.call_id || payload?.call_id || payload?.callId || '');
  const status = normalizeString(call?.call_status || payload?.call_status || payload?.status || '');
  const phone =
    normalizeString(call?.to_number) ||
    normalizeString(call?.metadata?.leadPhoneE164) ||
    normalizeString(call?.from_number);
  const company =
    normalizeString(call?.metadata?.leadCompany) ||
    normalizeString(call?.metadata?.company);
  const branche =
    normalizeString(call?.metadata?.leadBranche) ||
    normalizeString(call?.metadata?.branche) ||
    normalizeString(call?.metadata?.sector);
  const region =
    normalizeString(call?.metadata?.leadRegion) ||
    normalizeString(call?.metadata?.region) ||
    normalizeString(call?.metadata?.leadCity) ||
    normalizeString(call?.metadata?.city);
  const province =
    normalizeString(call?.metadata?.leadProvince) ||
    normalizeString(call?.metadata?.province) ||
    normalizeString(call?.metadata?.state);
  const address =
    normalizeString(call?.metadata?.leadAddress) ||
    normalizeString(call?.metadata?.address) ||
    normalizeString(call?.metadata?.street);
  const name =
    normalizeString(call?.metadata?.leadName) ||
    normalizeString(call?.metadata?.lead_name);
  const summary =
    normalizeString(call?.call_analysis?.call_summary) ||
    normalizeString(call?.call_analysis?.summary);
  const transcriptFull = extractRetellTranscriptText(call, { maxLength: 9000, preferFull: true });
  const transcriptSnippet = transcriptFull
    ? truncateText(transcriptFull.replace(/\s+/g, ' '), 450)
    : '';
  const endedReason = normalizeString(call?.disconnection_reason || '');
  const startedAt = toIsoFromUnixMilliseconds(call?.start_timestamp);
  const endedAt = toIsoFromUnixMilliseconds(call?.end_timestamp);
  const durationFromMs = parseNumberSafe(call?.duration_ms, null);
  const durationSeconds =
    Number.isFinite(durationFromMs) && durationFromMs > 0
      ? Math.max(1, Math.round(durationFromMs / 1000))
      : Number.isFinite(Date.parse(startedAt)) && Number.isFinite(Date.parse(endedAt))
        ? Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
        : null;
  const recordingUrl =
    normalizeString(call?.recording_url) ||
    normalizeString(call?.recording_multi_channel_url) ||
    normalizeString(call?.scrubbed_recording_url) ||
    normalizeString(call?.scrubbed_recording_multi_channel_url);
  const terminal = isTerminalColdcallingStatus(status, endedReason);
  const updatedAtMs = terminal
    ? Number(call?.end_timestamp || call?.start_timestamp || Date.now())
    : Date.now();

  if (!callId && !phone && !company && !summary && !transcriptSnippet && !status) {
    return null;
  }

  return {
    callId: callId || `retell-anon-${Date.now()}`,
    phone,
    company,
    branche,
    region,
    province,
    address,
    name,
    status,
    messageType: `retell.${event || 'webhook'}`,
    summary,
    transcriptSnippet,
    transcriptFull,
    endedReason,
    startedAt,
    endedAt,
    durationSeconds,
    recordingUrl,
    updatedAt: new Date(updatedAtMs).toISOString(),
    updatedAtMs,
    provider: 'retell',
  };
}

function extractCallUpdateFromRetellCallStatusResponse(callId, data) {
  const call =
    data && typeof data === 'object'
      ? data
      : null;
  if (!call) return null;

  const extracted = extractCallUpdateFromRetellPayload({
    event: 'call_status_fetch',
    call,
  });
  if (!extracted) return null;

  return {
    ...extracted,
    callId: normalizeString(call?.call_id || callId || extracted.callId),
    messageType: 'retell.call_status_fetch',
    updatedAtMs: Number(call?.end_timestamp || call?.start_timestamp || extracted.updatedAtMs || Date.now()),
    updatedAt:
      toIsoFromUnixMilliseconds(call?.end_timestamp || call?.start_timestamp) ||
      new Date(
        Number(call?.end_timestamp || call?.start_timestamp || extracted.updatedAtMs || Date.now())
      ).toISOString(),
  };
}

function extractCallUpdateFromTwilioPayload(payload = {}, options = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const fallbackStack = normalizeColdcallingStack(options.stack);
  const callId = normalizeString(payload?.CallSid || payload?.sid || options.callId || '');
  const streamEvent = normalizeString(payload?.StreamEvent || payload?.stream_event || '').toLowerCase();
  const recordingStatus = normalizeString(payload?.RecordingStatus || payload?.recording_status || '').toLowerCase();
  const direction = normalizeString(
    payload?.Direction || payload?.direction || payload?.CallDirection || payload?.call_direction || options.direction || ''
  ).toLowerCase();
  let status = normalizeString(payload?.CallStatus || payload?.status || '').toLowerCase();
  if (!status && streamEvent) {
    if (streamEvent === 'stream-started') status = 'in_progress';
    else if (streamEvent === 'stream-stopped') status = 'completed';
    else if (streamEvent === 'stream-error') status = 'failed';
  }
  const toNumber = normalizeString(payload?.To || payload?.to || payload?.Called || '');
  const fromNumber = normalizeString(payload?.From || payload?.from || payload?.Caller || '');
  const phone = direction.includes('inbound') ? fromNumber || toNumber : toNumber || fromNumber;
  const startedAt =
    parseDateToIso(payload?.StartTime || payload?.start_time || payload?.date_created || payload?.Timestamp) || '';
  const endedAt =
    parseDateToIso(payload?.EndTime || payload?.end_time) ||
    (isTerminalColdcallingStatus(status, '') || streamEvent === 'stream-stopped' ? new Date().toISOString() : '');
  const endedReason = normalizeString(
    payload?.CallStatusReason ||
      payload?.ErrorMessage ||
      payload?.DialCallStatus ||
      payload?.SipResponseCode ||
      payload?.StreamError ||
      ''
  );
  const durationSeconds = parseNumberSafe(payload?.CallDuration || payload?.duration, null);
  const region = normalizeString(
    payload?.Region || payload?.region || payload?.LeadRegion || payload?.leadRegion || payload?.City || payload?.city || ''
  );
  const province = normalizeString(
    payload?.Province || payload?.province || payload?.State || payload?.state || ''
  );
  const address = normalizeString(
    payload?.Address || payload?.address || payload?.LeadAddress || payload?.leadAddress || payload?.Street || payload?.street || ''
  );
  const recordingSid = normalizeString(
    payload?.RecordingSid || payload?.recording_sid || extractTwilioRecordingSidFromUrl(payload?.RecordingUrl || '')
  );
  const recordingUrlRaw = normalizeString(payload?.RecordingUrl || payload?.recording_url || '');
  const recordingUrlProxy = buildTwilioRecordingProxyUrl(callId);
  const recordingUrl = recordingUrlProxy || recordingUrlRaw;
  const updatedAtMs = Date.now();
  const stackLabel = getColdcallingStackLabel(fallbackStack);
  const messageType = streamEvent
    ? `twilio.stream.${streamEvent}`
    : recordingStatus
      ? `twilio.recording.${recordingStatus}`
      : `twilio.status.${status || 'unknown'}`;

  if (!callId && !status && !phone) return null;

  return {
    callId: callId || `twilio-anon-${updatedAtMs}`,
    phone,
    company: normalizeString(payload?.Company || payload?.company || payload?.LeadCompany || payload?.leadCompany || ''),
    branche: normalizeString(
      payload?.Branche || payload?.branche || payload?.Sector || payload?.sector || payload?.LeadBranche || ''
    ),
    region,
    province,
    address,
    name: normalizeString(
      payload?.LeadName || payload?.name || payload?.CallerName || payload?.callerName || ''
    ),
    status,
    messageType,
    summary: normalizeString(payload?.summary || ''),
    transcriptSnippet: '',
    transcriptFull: '',
    endedReason,
    startedAt: startedAt || '',
    endedAt: endedAt || '',
    durationSeconds:
      Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) >= 0 ? Math.round(Number(durationSeconds)) : null,
    recordingUrl,
    recordingSid,
    recordingUrlProxy,
    updatedAt: new Date(updatedAtMs).toISOString(),
    updatedAtMs,
    provider: 'twilio',
    direction,
    stack: fallbackStack,
    stackLabel,
  };
}

function parseTwilioRecordingDurationSeconds(recording) {
  const rawSeconds = parseNumberSafe(
    recording?.duration || recording?.duration_seconds || recording?.Duration || recording?.DurationSeconds,
    null
  );
  return Number.isFinite(rawSeconds) && rawSeconds >= 0 ? Math.round(rawSeconds) : null;
}

function parseTwilioRecordingUpdatedAtMs(recording) {
  const candidates = [
    recording?.date_updated,
    recording?.date_created,
    recording?.start_time,
    recording?.startTime,
    recording?.created_at,
    recording?.updated_at,
  ];
  for (const candidate of candidates) {
    const raw = normalizeString(candidate);
    if (!raw) continue;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function choosePreferredTwilioRecording(recordings, preferredSid = '') {
  const list = Array.isArray(recordings) ? recordings.filter(Boolean) : [];
  if (!list.length) return null;
  const preferredSidNormalized = normalizeString(preferredSid);

  return list
    .slice()
    .sort((left, right) => {
      const leftCompleted = /completed/i.test(normalizeString(left?.status || '')) ? 1 : 0;
      const rightCompleted = /completed/i.test(normalizeString(right?.status || '')) ? 1 : 0;
      if (leftCompleted !== rightCompleted) return rightCompleted - leftCompleted;

      const leftDuration = parseTwilioRecordingDurationSeconds(left) || 0;
      const rightDuration = parseTwilioRecordingDurationSeconds(right) || 0;
      if (leftDuration !== rightDuration) return rightDuration - leftDuration;

      const leftPreferred = normalizeString(left?.sid || '') === preferredSidNormalized ? 1 : 0;
      const rightPreferred = normalizeString(right?.sid || '') === preferredSidNormalized ? 1 : 0;
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;

      const leftUpdated = parseTwilioRecordingUpdatedAtMs(left);
      const rightUpdated = parseTwilioRecordingUpdatedAtMs(right);
      return rightUpdated - leftUpdated;
    })[0];
}

function resolvePreferredRecordingUrl(...sources) {
  let callId = '';
  let recordingSid = '';
  let provider = '';
  const rawUrls = [];

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    callId = callId || normalizeString(source.callId || source.call_id || '');
    recordingSid =
      recordingSid ||
      normalizeString(source.recordingSid || source.recording_sid || extractTwilioRecordingSidFromUrl(source.recordingUrl || source.recording_url || ''));
    provider = provider || normalizeString(source.provider || '');

    const url = normalizeString(
      source.recordingUrl ||
        source.recording_url ||
        source.recordingUrlProxy ||
        source.audioUrl ||
        source.audio_url ||
        ''
    );
    if (url) rawUrls.push(url);
  }

  const firstRawUrl = rawUrls[0] || '';
  const hasProxyReference = rawUrls.some((url) => /\/api\/coldcalling\/recording-proxy/i.test(url));
  const isTwilioLike = provider === 'twilio' || Boolean(recordingSid) || hasProxyReference;

  if (callId && isTwilioLike) {
    return buildTwilioRecordingProxyUrl(callId);
  }
  if (!callId && recordingSid) {
    return buildTwilioRecordingProxyUrl('', recordingSid);
  }
  return firstRawUrl;
}

function extractCallUpdateFromTwilioCallStatusResponse(callId, data, options = {}) {
  if (!data || typeof data !== 'object') return null;
  const update = extractCallUpdateFromTwilioPayload(
    {
      CallSid: normalizeString(data?.sid || callId),
      CallStatus: normalizeString(data?.status || ''),
      Direction: normalizeString(data?.direction || options?.direction || ''),
      To: normalizeString(data?.to || ''),
      From: normalizeString(data?.from || ''),
      StartTime: normalizeString(data?.start_time || data?.date_created || ''),
      EndTime: normalizeString(data?.end_time || ''),
      CallDuration: normalizeString(data?.duration || ''),
      RecordingUrl: normalizeString(data?.recording_url || ''),
      ErrorMessage: normalizeString(data?.subresource_uris?.events || ''),
    },
    options
  );
  if (!update) return null;
  return {
    ...update,
    messageType: 'twilio.call_status_fetch',
  };
}

async function refreshCallUpdateFromRetellStatusApi(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;
  if (!normalizeString(process.env.RETELL_API_KEY)) return null;

  try {
    const { data } = await fetchRetellCallStatusById(normalizedCallId);
    const update = extractCallUpdateFromRetellCallStatusResponse(normalizedCallId, data);
    if (!update) return null;
    return upsertRecentCallUpdate(update);
  } catch (error) {
    console.warn(
      '[Retell Call Status Refresh Failed]',
      JSON.stringify(
        {
          callId: normalizedCallId,
          message: error?.message || 'Onbekende fout',
          status: error?.status || null,
        },
        null,
        2
      )
    );
    return null;
  }
}

async function refreshCallUpdateFromTwilioStatusApi(callId, options = {}) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;
  if (!isTwilioStatusApiConfigured()) return null;

  try {
    const { data } = await fetchTwilioCallStatusById(normalizedCallId);
    const update = extractCallUpdateFromTwilioCallStatusResponse(normalizedCallId, data, options);
    if (!update) return null;
    return upsertRecentCallUpdate(update);
  } catch (error) {
    console.warn(
      '[Twilio Call Status Refresh Failed]',
      JSON.stringify(
        {
          callId: normalizedCallId,
          message: error?.message || 'Onbekende fout',
          status: error?.status || null,
        },
        null,
        2
      )
    );
    return null;
  }
}

function shouldRefreshRetellCallStatus(update, nowMs = Date.now()) {
  const callId = normalizeString(update?.callId || '');
  if (!callId) return false;

  const provider = inferCallProvider(callId, normalizeString(update?.provider || 'retell').toLowerCase() || 'retell');
  if (provider !== 'retell' && provider !== 'twilio') return false;

  const status = normalizeString(update?.status || '').toLowerCase();
  const endedReason = normalizeString(update?.endedReason || '');
  if (isTerminalColdcallingStatus(status, endedReason)) {
    retellCallStatusRefreshByCallId.delete(callId);
    return false;
  }

  const updatedAtMs = Number(update?.updatedAtMs || 0);
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0 && nowMs - updatedAtMs < 2500) {
    return false;
  }

  const lastRefreshMs = Number(retellCallStatusRefreshByCallId.get(callId) || 0);
  if (Number.isFinite(lastRefreshMs) && nowMs - lastRefreshMs < RETELL_STATUS_REFRESH_COOLDOWN_MS) {
    return false;
  }

  retellCallStatusRefreshByCallId.set(callId, nowMs);
  return true;
}

function collectMissingCallUpdateRefreshCandidates(limit = 6) {
  const maxItems = Math.max(0, Math.min(30, Number(limit) || 6));
  if (maxItems <= 0) return [];

  const seenCallIds = new Set();
  const candidates = [];

  const registerCandidate = (item) => {
    const callId = normalizeString(item?.callId || item?.call_id || '');
    if (!callId || callId.startsWith('demo-')) return;
    if (callUpdatesById.has(callId) || seenCallIds.has(callId)) return;

    const stack = normalizeColdcallingStack(
      item?.coldcallingStack || item?.callingStack || item?.stack || item?.callingEngine || ''
    );
    const providerHint = normalizeString(item?.provider || inferCallProvider(callId, 'retell')).toLowerCase();
    const provider = inferCallProvider(callId, providerHint || 'retell');
    const updatedAtMs = getRuntimeSnapshotItemTimestampMs(item || {});

    seenCallIds.add(callId);
    candidates.push({
      callId,
      provider,
      direction: 'outbound',
      stack,
      updatedAtMs,
    });
  };

  generatedAgendaAppointments.forEach(registerCandidate);
  recentAiCallInsights.forEach(registerCandidate);

  return candidates
    .sort((a, b) => Number(b?.updatedAtMs || 0) - Number(a?.updatedAtMs || 0))
    .slice(0, maxItems);
}

function upsertRecentCallUpdate(update, options = {}) {
  if (!update) return null;

  const normalizedCallId = normalizeString(update?.callId || '');
  if (!normalizedCallId) return null;

  const persistRuntimeState = options?.persistRuntimeState !== false;
  const persistCallUpdateRow = options?.persistCallUpdateRow !== false;
  const persistReason = truncateText(normalizeString(options?.persistReason || ''), 80) || 'call_update';

  const existing = callUpdatesById.get(normalizedCallId);
  const { updatedAt: resolvedUpdatedAt, updatedAtMs: resolvedUpdatedAtMs } = resolveCallUpdateTimestamp(
    update,
    existing
  );

  const normalizedUpdate = {
    ...update,
    callId: normalizedCallId,
    updatedAt: resolvedUpdatedAt,
    updatedAtMs: resolvedUpdatedAtMs,
  };

  const merged = existing
    ? {
        ...existing,
        ...normalizedUpdate,
        phone: normalizedUpdate.phone || existing.phone || '',
        company: normalizedUpdate.company || existing.company || '',
        branche: normalizedUpdate.branche || existing.branche || '',
        region: normalizedUpdate.region || existing.region || '',
        province: normalizedUpdate.province || existing.province || '',
        address: normalizedUpdate.address || existing.address || '',
        name: normalizedUpdate.name || existing.name || '',
        status: normalizedUpdate.status || existing.status || '',
        summary: normalizedUpdate.summary || existing.summary || '',
        transcriptSnippet: normalizedUpdate.transcriptSnippet || existing.transcriptSnippet || '',
        transcriptFull: normalizedUpdate.transcriptFull || existing.transcriptFull || '',
        endedReason: normalizedUpdate.endedReason || existing.endedReason || '',
        startedAt: normalizedUpdate.startedAt || existing.startedAt || '',
        endedAt: normalizedUpdate.endedAt || existing.endedAt || '',
        durationSeconds:
          Number.isFinite(Number(normalizedUpdate.durationSeconds)) && Number(normalizedUpdate.durationSeconds) > 0
            ? Math.round(Number(normalizedUpdate.durationSeconds))
            : Number.isFinite(Number(existing.durationSeconds)) && Number(existing.durationSeconds) > 0
              ? Math.round(Number(existing.durationSeconds))
              : null,
        recordingUrl: normalizedUpdate.recordingUrl || existing.recordingUrl || '',
        recordingSid: normalizedUpdate.recordingSid || existing.recordingSid || '',
        recordingUrlProxy: normalizedUpdate.recordingUrlProxy || existing.recordingUrlProxy || '',
        provider: normalizedUpdate.provider || existing.provider || '',
        direction: normalizedUpdate.direction || existing.direction || '',
        stack: normalizedUpdate.stack || existing.stack || '',
        stackLabel: normalizedUpdate.stackLabel || existing.stackLabel || '',
        messageType: normalizedUpdate.messageType || existing.messageType || '',
        updatedAt: resolvedUpdatedAt,
        updatedAtMs: resolvedUpdatedAtMs,
      }
    : normalizedUpdate;

  callUpdatesById.set(merged.callId, merged);

  if (isTerminalColdcallingStatus(merged.status, merged.endedReason)) {
    retellCallStatusRefreshByCallId.delete(merged.callId);
  }

  const existingIndex = recentCallUpdates.findIndex((item) => item.callId === merged.callId);
  if (existingIndex >= 0) {
    recentCallUpdates.splice(existingIndex, 1);
  }
  recentCallUpdates.unshift(merged);
  if (recentCallUpdates.length > 500) {
    const removed = recentCallUpdates.pop();
    if (removed) {
      callUpdatesById.delete(removed.callId);
    }
  }

  if (persistRuntimeState) {
    queueRuntimeStatePersist(persistReason);
  }
  if (persistCallUpdateRow) {
    queueCallUpdateRowPersist(merged, persistReason);
  }

  return merged;
}

function normalizeNlPhoneToE164(input) {
  const raw = normalizeString(input);

  if (!raw) {
    throw new Error('Telefoonnummer ontbreekt');
  }

  let cleaned = raw.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith('+')) {
    const normalized = `+${cleaned.slice(1).replace(/\D/g, '')}`;

    if (!/^\+\d{8,15}$/.test(normalized)) {
      throw new Error(`Ongeldig E.164 nummer: ${raw}`);
    }

    if (normalized.startsWith('+31')) {
      const nlDigits = normalized.slice(3);
      if (nlDigits.length !== 9) {
        throw new Error(`NL nummer heeft niet 9 cijfers na +31: ${raw}`);
      }
    }

    return normalized;
  }

  const digits = cleaned.replace(/\D/g, '');

  if (digits.startsWith('31')) {
    const nlDigits = digits.slice(2);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 9 cijfers na 31: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.startsWith('0')) {
    const nlDigits = digits.slice(1);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 10 cijfers inclusief 0: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.length === 9 && digits.startsWith('6')) {
    return `+31${digits}`;
  }

  throw new Error(`Kan nummer niet omzetten naar NL E.164 formaat: ${raw}`);
}

function getRequiredRetellEnv() {
  return ['RETELL_API_KEY', 'RETELL_FROM_NUMBER', 'RETELL_AGENT_ID'];
}

function isRetellColdcallingConfigured() {
  return getRequiredRetellEnv().every((key) => normalizeString(process.env[key]));
}

function getRequiredTwilioEnv() {
  return ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
}

function isTwilioColdcallingConfigured() {
  return getRequiredTwilioEnv().every((key) => normalizeString(process.env[key]));
}

function isTwilioStatusApiConfigured() {
  return Boolean(normalizeString(process.env.TWILIO_ACCOUNT_SID) && normalizeString(process.env.TWILIO_AUTH_TOKEN));
}

function getColdcallingProvider() {
  const configured = normalizeString(process.env.COLDCALLING_PROVIDER).toLowerCase();
  if (configured === 'twilio' || configured === 'twilio_media' || configured === 'twilio_media_stream') {
    return 'twilio';
  }
  if (configured === 'retell') return 'retell';
  if (isRetellColdcallingConfigured()) return 'retell';
  if (isTwilioColdcallingConfigured()) return 'twilio';
  return 'retell';
}

function getMissingEnvVars(provider = getColdcallingProvider()) {
  if (provider === 'twilio') {
    return getRequiredTwilioEnv().filter((key) => !normalizeString(process.env[key]));
  }
  if (provider === 'retell') {
    return getRequiredRetellEnv().filter((key) => !normalizeString(process.env[key]));
  }
  return getRequiredRetellEnv().filter((key) => !normalizeString(process.env[key]));
}

function normalizeColdcallingStack(value) {
  const raw = normalizeString(value).toLowerCase();
  if (
    raw === 'gemini_flash_3_1_live' ||
    raw === 'gemini flash 3.1 live' ||
    raw === 'gemini_3_1_live' ||
    raw === 'gemini'
  ) {
    return 'gemini_flash_3_1_live';
  }
  if (
    raw === 'openai_realtime_1_5' ||
    raw === 'openai realtime 1.5' ||
    raw === 'openai_realtime' ||
    raw === 'openai'
  ) {
    return 'openai_realtime_1_5';
  }
  if (
    raw === 'hume_evi_3' ||
    raw === 'hume evi 3' ||
    raw === 'hume_evi' ||
    raw === 'hume'
  ) {
    return 'hume_evi_3';
  }
  return 'retell_ai';
}

function getColdcallingStackLabel(stack) {
  const normalized = normalizeColdcallingStack(stack);
  if (normalized === 'gemini_flash_3_1_live') return 'Gemini 3.1 Live';
  if (normalized === 'openai_realtime_1_5') return 'OpenAI Realtime 1.5';
  if (normalized === 'hume_evi_3') return 'Hume Evi 3';
  return 'Retell AI';
}

function resolveColdcallingProviderForCampaign(campaign = {}) {
  const stack = normalizeColdcallingStack(
    campaign?.coldcallingStack || campaign?.callingEngine || campaign?.callingStack
  );
  if (stack === 'retell_ai') return 'retell';
  if (stack === 'gemini_flash_3_1_live' || stack === 'openai_realtime_1_5' || stack === 'hume_evi_3') {
    return 'twilio';
  }
  return getColdcallingProvider();
}

function inferCallProvider(callId, fallbackProvider = 'retell') {
  const normalizedCallId = normalizeString(callId);
  if (/^call_/i.test(normalizedCallId)) return 'retell';
  if (/^CA[0-9a-f]{32}$/i.test(normalizedCallId)) return 'twilio';
  return fallbackProvider;
}

function toBooleanSafe(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'ja'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nee'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeDateYyyyMmDd(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // NL-invoer (dd-mm-jjjj of dd/mm/jjjj) — voorkomt lege normalisatie bij date-inputs buiten ISO.
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const asDate = new Date(raw);
  if (Number.isNaN(asDate.getTime())) return '';
  const y = asDate.getFullYear();
  const m = String(asDate.getMonth() + 1).padStart(2, '0');
  const d = String(asDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeTimeHhMm(value) {
  const raw = normalizeString(value);
  if (!raw) return '';

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hours = Math.max(0, Math.min(23, Number(hhmm[1])));
    const mins = Math.max(0, Math.min(59, Number(hhmm[2])));
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  const compact = raw.match(/^(\d{1,2})(\d{2})$/);
  if (compact) {
    const hours = Math.max(0, Math.min(23, Number(compact[1])));
    const mins = Math.max(0, Math.min(59, Number(compact[2])));
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  return '';
}

function formatEuroLabel(amount) {
  const numeric = parseNumberSafe(amount, null);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'Onbekend';

  try {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `EUR ${Math.round(numeric)}`;
  }
}

function getOpenAiApiKey() {
  return normalizeString(process.env.OPENAI_API_KEY);
}

function getAnthropicApiKey() {
  return normalizeString(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
}

function getWebsiteAnthropicModel() {
  const candidates = [
    normalizeString(process.env.WEBSITE_ANTHROPIC_MODEL || ''),
    normalizeString(process.env.ANTHROPIC_WEBSITE_MODEL || ''),
    normalizeString(WEBSITE_ANTHROPIC_MODEL || ''),
    normalizeString(process.env.ANTHROPIC_MODEL || ''),
    normalizeString(process.env.CLAUDE_MODEL || ''),
    normalizeString(ANTHROPIC_MODEL || ''),
    'claude-opus-4-6',
  ];
  return candidates.find((value) => Boolean(value)) || 'claude-opus-4-6';
}

function getWebsiteGenerationProvider() {
  if (WEBSITE_GENERATION_PROVIDER === 'anthropic' || WEBSITE_GENERATION_PROVIDER === 'claude') {
    return 'anthropic';
  }
  if (WEBSITE_GENERATION_PROVIDER === 'openai') {
    return 'openai';
  }
  return getAnthropicApiKey() ? 'anthropic' : 'openai';
}

function getDossierAnthropicModel() {
  const candidates = [
    normalizeString(process.env.DOSSIER_ANTHROPIC_MODEL || ''),
    normalizeString(process.env.ANTHROPIC_DOSSIER_MODEL || ''),
    normalizeString(process.env.CLAUDE_DOSSIER_MODEL || ''),
    normalizeString(DOSSIER_ANTHROPIC_MODEL || ''),
    normalizeString(process.env.ANTHROPIC_MODEL || ''),
    normalizeString(process.env.CLAUDE_MODEL || ''),
    normalizeString(ANTHROPIC_MODEL || ''),
    'claude-opus-4-6',
  ];
  return candidates.find((value) => Boolean(value)) || 'claude-opus-4-6';
}

function getAnthropicDossierMaxTokens() {
  const fallback = 6000;
  return Math.max(
    2000,
    Math.min(24000, Number(process.env.ANTHROPIC_DOSSIER_MAX_TOKENS || fallback) || fallback)
  );
}

function normalizeAiSummaryStyle(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return 'medium';
  if (['short', 'medium', 'long', 'bullets'].includes(raw)) return raw;
  return '';
}

function isDutchLanguageRequest(value) {
  const raw = normalizeString(value).toLowerCase();
  return raw === 'nl' || raw.startsWith('nl-');
}

function countRegexMatches(value, regex) {
  const matches = String(value || '').match(regex);
  return Array.isArray(matches) ? matches.length : 0;
}

function summaryContainsEnglishMarkers(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return false;
  const strongMatches = countRegexMatches(
    normalized,
    /\b(the|call|conversation|agent|user|brief|outbound|inbound|ended|shortly|mentioned|during|standards|expectations|activities|interaction|follow-up|meeting|appointment|summary|details)\b/g
  );
  const mildMatches = countRegexMatches(
    normalized,
    /\b(was|were|is|are|had|with|after|before|where|for)\b/g
  );
  return strongMatches >= 2 || (strongMatches >= 1 && mildMatches >= 3) || mildMatches >= 6;
}

async function generateTextSummaryWithAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const sourceText = truncateText(normalizeString(options.text || ''), 20000);
  const style = normalizeAiSummaryStyle(options.style) || 'medium';
  const language = normalizeString(options.language || 'nl') || 'nl';
  const maxSentences = Math.max(1, Math.min(12, parseIntSafe(options.maxSentences, style === 'short' ? 2 : 4)));
  const forceDutchOnly = isDutchLanguageRequest(language);
  const skipLanguageRewrite = Boolean(options.skipLanguageRewrite);

  const systemPrompt = [
    'Je bent een nauwkeurige tekstassistent.',
    'Vat de input samen op basis van de gevraagde stijl.',
    'Gebruik de gevraagde taal.',
    forceDutchOnly
      ? 'Schrijf uitsluitend in natuurlijk Nederlands. Gebruik geen Engels, behalve onvermijdelijke eigennamen, merknamen, productnamen, URLs of exacte onvertaalbare termen.'
      : '',
    'Verzin geen feiten die niet in de bron staan.',
    'Geef alleen de samenvatting terug (geen markdown-uitleg of extra labels).',
  ]
    .filter(Boolean)
    .join('\n');

  const userPayload = {
    task: 'summarize',
    style,
    language,
    maxSentences,
    extraInstructions: normalizeString(options.extraInstructions || ''),
    text: sourceText,
  };

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              `Maak een samenvatting in taal: ${language}.`,
              `Stijl: ${style}.`,
              style === 'bullets'
                ? `Geef maximaal ${Math.max(3, maxSentences)} bullets, elke regel start met "- ".`
                : `Geef maximaal ${maxSentences} zinnen.`,
              normalizeString(options.extraInstructions || '')
                ? `Extra instructies: ${normalizeString(options.extraInstructions || '')}`
                : '',
              '',
              'Brontekst:',
              sourceText,
              '',
              'JSON context (ter controle):',
              JSON.stringify(userPayload),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      }),
    },
    60000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI samenvatting mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = normalizeString(extractOpenAiTextContent(content));
  if (!text) {
    const err = new Error('OpenAI gaf een lege samenvatting terug.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  if (forceDutchOnly && !skipLanguageRewrite && summaryContainsEnglishMarkers(text)) {
    const rewritten = await generateTextSummaryWithAi({
      text,
      style,
      language,
      maxSentences,
      extraInstructions: [
        normalizeString(options.extraInstructions || ''),
        'Herschrijf deze samenvatting volledig in natuurlijk Nederlands.',
        'Behoud alle feiten en details.',
        'Gebruik geen Engels behalve onvermijdelijke eigennamen, merknamen, productnamen, URLs of exacte onvertaalbare termen.',
        style === 'bullets'
          ? `Behoud bullet-stijl met maximaal ${Math.max(3, maxSentences)} bullets.`
          : `Behoud doorlopende tekst met maximaal ${maxSentences} zinnen.`,
      ]
        .filter(Boolean)
        .join(' '),
      skipLanguageRewrite: true,
    });

    return {
      ...rewritten,
      summary: truncateText(normalizeString(rewritten.summary || text), 5000),
    };
  }

  return {
    summary: truncateText(text, 5000),
    style,
    language,
    maxSentences,
    source: 'openai',
    model: OPENAI_MODEL,
    usage: data?.usage || null,
  };
}

async function generateWebsitePreviewImageWithAi(scan = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const prompt = buildWebsitePreviewPromptFromScan(scan);
  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/images/generations`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt,
        size: '1536x1024',
        response_format: 'b64_json',
      }),
    },
    180000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI websitegenerator mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const imageEntry = Array.isArray(data?.data) ? data.data[0] : null;
  const b64 = normalizeString(imageEntry?.b64_json || '');
  if (!b64) {
    const err = new Error('OpenAI gaf geen afbeelding terug voor de websitegenerator.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    prompt,
    brief: buildWebsitePreviewBriefFromScan(scan),
    model: OPENAI_IMAGE_MODEL,
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${b64}`,
    fileName: buildWebsitePreviewDownloadFileName(scan),
    revisedPrompt: normalizeString(imageEntry?.revised_prompt || ''),
    usage: data?.usage || null,
  };
}

async function fetchWebsitePreviewScanFromUrl(targetUrlRaw) {
  const normalizedUrl = await assertWebsitePreviewUrlIsPublic(targetUrlRaw);
  const { response, text } = await fetchTextWithTimeout(
    normalizedUrl,
    {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SoftoraWebsitePreview/1.0; +https://softora.nl)',
        Accept: 'text/html,application/xhtml+xml',
      },
    },
    25000
  );

  if (!response.ok) {
    const err = new Error(`Kon deze website niet ophalen (${response.status}).`);
    err.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw err;
  }

  const contentType = normalizeString(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    const err = new Error('De opgegeven URL lijkt geen HTML-webpagina te zijn.');
    err.status = 400;
    throw err;
  }

  const html = String(text || '');
  if (!html) {
    const err = new Error('Deze website gaf geen leesbare HTML terug.');
    err.status = 502;
    throw err;
  }

  const scan = extractWebsitePreviewScanFromHtml(html, response.url || normalizedUrl);
  if (!scan.title && !scan.h1 && !scan.metaDescription && !scan.bodyTextSample) {
    const err = new Error('Er kon te weinig bruikbare inhoud uit deze website worden gelezen.');
    err.status = 422;
    throw err;
  }

  return {
    normalizedUrl,
    finalUrl: normalizeWebsitePreviewTargetUrl(response.url || normalizedUrl) || normalizedUrl,
    scan,
  };
}

async function generateWebsitePromptFromTranscriptWithAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const transcript = truncateText(normalizeString(options.transcript || options.text || ''), 20000);
  if (!transcript) {
    const err = new Error('Transcript ontbreekt');
    err.status = 400;
    throw err;
  }

  const language = normalizeString(options.language || 'nl') || 'nl';
  const context = truncateText(normalizeString(options.context || ''), 2000);

  const systemPrompt = [
    'Je bent een senior digital strategist en prompt engineer.',
    'Taak: zet een gesprekstranscript om naar EEN direct uitvoerbare prompt voor een AI die websites bouwt.',
    'Belangrijk:',
    '- Gebruik alleen feiten uit transcriptie/context, verzin niets.',
    '- Als info ontbreekt, gebruik placeholders in vorm [VUL IN: ...].',
    '- Output alleen de prompttekst, zonder markdown fences of extra uitleg.',
    '- Schrijf in duidelijke professionele taal in de gevraagde taal.',
  ].join('\n');

  const userPrompt = [
    `Taal: ${language}`,
    '',
    'Maak een complete prompt met deze secties en volgorde:',
    '1) Rol en doel van de website-AI',
    '2) Bedrijfscontext',
    '3) Doelgroep(en)',
    '4) Hoofddoel + conversiedoelen',
    '5) Paginastructuur (navigatie + secties per pagina)',
    '6) Copy-richting per sectie',
    '7) Designrichting (stijl, kleur, typografie, tone-of-voice)',
    '8) Functionaliteit (formulieren, CTA, contact, eventuele integraties)',
    '9) SEO-basis (title, meta, headings, keywords, interne links)',
    '10) Technische eisen (performance, mobile-first, toegankelijkheid)',
    '11) Opleverchecklist',
    '',
    'Regels voor nauwkeurigheid:',
    '- Gebruik concrete details uit de transcriptie waar beschikbaar.',
    '- Houd placeholders zichtbaar voor alles wat ontbreekt.',
    '- Schrijf zo dat de prompt direct in een AI website-builder geplakt kan worden.',
    context ? `- Extra context: ${context}` : '',
    '',
    'Transcriptie bron:',
    transcript,
  ]
    .filter(Boolean)
    .join('\n');

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    },
    30000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI prompt generatie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const prompt = normalizeString(extractOpenAiTextContent(content));
  if (!prompt) {
    const err = new Error('OpenAI gaf een lege prompt terug.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    prompt: truncateText(prompt, 12000),
    source: 'openai',
    model: OPENAI_MODEL,
    usage: data?.usage || null,
    language,
  };
}

async function extractMeetingNotesFromImageWithAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const imageDataUrl = normalizeString(options.imageDataUrl || options.image || '').replace(/\s+/g, '');
  if (!imageDataUrl) {
    const err = new Error('Afbeelding ontbreekt');
    err.status = 400;
    throw err;
  }
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(imageDataUrl)) {
    const err = new Error('Ongeldige afbeelding. Gebruik PNG, JPG of WEBP als data URL.');
    err.status = 400;
    throw err;
  }
  if (imageDataUrl.length > 900000) {
    const err = new Error('Afbeelding te groot. Lever een compactere foto aan.');
    err.status = 413;
    throw err;
  }

  const language = normalizeString(options.language || 'nl') || 'nl';
  const systemPrompt = [
    'Je bent een nauwkeurige notitie-assistent.',
    'Lees de geuploade foto van meetingnotities en zet dit om naar leesbare tekst.',
    'Verzin geen feiten. Als een woord onduidelijk is, gebruik [ONLEESBAAR].',
    'Output exact JSON met veld "transcript". Geen markdown, geen extra velden.',
  ].join('\n');

  const userPrompt = [
    `Taal voor transcript: ${language}.`,
    'Zet de notities om naar een compacte, duidelijke transcriptie met regeleinden.',
    'Behoud concrete wensen, functionaliteiten, planning, budget en stijlkeuzes als die zichtbaar zijn.',
    'Output JSON voorbeeld: {"transcript":"..."}',
  ].join('\n');

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    },
    70000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI image-notes extractie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const textContent = normalizeString(extractOpenAiTextContent(content));
  if (!textContent) {
    const err = new Error('OpenAI gaf geen notities terug uit de afbeelding.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  const parsed = parseJsonLoose(textContent);
  const transcript = truncateText(
    normalizeString(
      parsed && typeof parsed === 'object' && typeof parsed.transcript === 'string'
        ? parsed.transcript
        : textContent
    ),
    20000
  );

  if (!transcript) {
    const err = new Error('Er kon geen transcriptie uit de notitiefoto worden gehaald.');
    err.status = 502;
    throw err;
  }

  return {
    transcript,
    source: 'openai-vision',
    model: OPENAI_MODEL,
    usage: data?.usage || null,
    language,
  };
}

function buildWebsitePromptFallback(options = {}) {
  const language = normalizeString(options.language || 'nl') || 'nl';
  const context = truncateText(normalizeString(options.context || ''), 2000);
  const transcript = truncateText(normalizeString(options.transcript || options.text || ''), 12000);

  const headerNl = [
    'ROL',
    'Je bent een senior webdesigner + conversion copywriter + front-end developer.',
    '',
    'DOEL',
    'Bouw een conversiegerichte website op basis van de transcriptie hieronder.',
    'Gebruik alleen feiten uit de transcriptie. Als iets ontbreekt: gebruik [VUL IN: ...].',
    '',
    'OUTPUTVORM',
    'Lever concreet op in deze volgorde:',
    '1) Merkprofiel (bedrijf, dienst, propositie)',
    '2) Doelgroepen + pijnpunten',
    '3) Sitemap met pagina-doelen',
    '4) Wireframe per pagina (secties in volgorde)',
    '5) Definitieve copy per sectie',
    '6) Designrichting (kleur, typografie, sfeer, beeldstijl)',
    '7) Conversie-elementen (CTA, formulieren, vertrouwen)',
    '8) Technische bouwinstructies (responsive, performance, toegankelijkheid)',
    '9) SEO-basis (title, meta, H1-H3, keywords)',
    '10) TODO-lijst met open vragen [VUL IN: ...]',
    '',
    context ? `EXTRA CONTEXT\n${context}\n` : '',
    'BRONTRANSCRIPTIE (LETTERLIJK)',
    transcript || '[VUL IN: transcriptie ontbreekt]',
  ];

  if (language.toLowerCase().startsWith('en')) {
    return [
      'ROLE',
      'You are a senior web designer + conversion copywriter + front-end developer.',
      '',
      'GOAL',
      'Build a conversion-focused website from the transcript below.',
      'Use only facts from the transcript. If something is missing: use [FILL IN: ...].',
      '',
      'OUTPUT FORMAT',
      'Deliver in this order:',
      '1) Brand profile',
      '2) Target audiences + pain points',
      '3) Sitemap with page goals',
      '4) Wireframe per page',
      '5) Final copy per section',
      '6) Design direction',
      '7) Conversion elements',
      '8) Technical build instructions',
      '9) SEO basics',
      '10) Open questions [FILL IN: ...]',
      '',
      context ? `EXTRA CONTEXT\n${context}\n` : '',
      'SOURCE TRANSCRIPT (VERBATIM)',
      transcript || '[FILL IN: missing transcript]',
    ].join('\n');
  }

  return headerNl.join('\n');
}

function buildOrderDossierInput(options = {}) {
  const orderIdRaw = parseIntSafe(options.orderId, 0);
  const orderId = Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? orderIdRaw : 0;
  const language = normalizeString(options.language || 'nl') || 'nl';
  const title = clipText(normalizeString(options.title || ''), 180);
  const company = clipText(normalizeString(options.company || ''), 180);
  const contact = clipText(normalizeString(options.contact || ''), 180);
  const domainName = clipText(normalizeString(options.domainName || ''), 180);
  const deliveryTime = clipText(normalizeString(options.deliveryTime || ''), 180);
  const claimedBy = clipText(normalizeString(options.claimedBy || ''), 120);
  const claimedAt = clipText(normalizeString(options.claimedAt || ''), 120);
  const description = clipText(normalizeString(options.description || ''), 7000);
  const transcript = clipText(normalizeString(options.transcript || ''), 7000);
  const sourceAppointmentLabel = clipText(normalizeString(options.sourceAppointmentLabel || ''), 260);

  return {
    orderId,
    language,
    title: title || (orderId ? `Opdracht #${orderId}` : 'Opdracht'),
    company: company || 'Onbekend',
    contact,
    domainName,
    deliveryTime,
    claimedBy,
    claimedAt,
    description,
    transcript,
    sourceAppointmentLabel,
  };
}

function buildOrderDossierNarrative(input) {
  const description = normalizeString(input?.description || '');
  const transcript = normalizeString(input?.transcript || '');
  const chunks = [description];

  if (transcript) {
    if (description) {
      chunks.push(`Aanvullende gespreksnotities: ${transcript}`);
    } else {
      chunks.push(transcript);
    }
  }

  const merged = chunks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (merged) return clipText(merged, 5000);
  return 'Nog geen uitgebreide klantwensen vastgelegd. Neem direct contact op met de klant om ontbrekende details te verzamelen.';
}

function buildShortOrderDossierOpusPrompt(options = {}) {
  return 'Werk deze opdracht in Claude Opus 4.6 uit op basis van uitsluitend de gekoppelde lead- en dossierinformatie.';
}

function normalizeOrderDossierBlockTitle(value) {
  return normalizeString(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function shouldHideOrderDossierBlockTitle(value) {
  const normalized = normalizeOrderDossierBlockTitle(value);
  if (!normalized) return false;
  return normalized === 'uitvoerplan' ||
    normalized === 'uitvoerfocus' ||
    normalized.startsWith('ontbrekende informatie') ||
    normalized.startsWith('praktische aandachtspunten');
}

function normalizeOrderDossierPairLabel(value) {
  const label = normalizeString(value || '').replace(/\s+/g, ' ').trim();
  if (!label) return '';
  const normalized = label
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === 'accounthouder softora' || normalized === 'softora contactpersoon') return '';
  return normalized === 'geclaimd door' ? 'Aangewezen aan' : label;
}

function buildOrderDossierFallbackLayout(options = {}) {
  const input = buildOrderDossierInput(options);
  const narrative = buildOrderDossierNarrative(input);
  const promptText = buildShortOrderDossierOpusPrompt(input);

  return {
    documentTitle: input.title || (input.orderId ? `Opdracht #${input.orderId}` : 'Opdracht'),
    subtitle: 'Dynamisch uitvoerdossier op basis van actuele opdrachtinformatie en klantwensen.',
    opusPrompt: clipText(promptText, 20000),
    blocks: [
      {
        kind: 'meta',
        title: 'Projectkern',
        pairs: [
          { label: 'Bedrijf', value: input.company || '—' },
          { label: 'Contactpersoon', value: input.contact || '—' },
          { label: 'Domein', value: input.domainName || '—' },
          { label: 'Oplevertijd', value: input.deliveryTime || '—' },
          { label: 'Aangewezen aan', value: input.claimedBy || '—' },
          { label: 'Geclaimd op', value: input.claimedAt || '—' },
        ],
      },
      {
        kind: 'text',
        title: 'Klantwensen',
        text: narrative,
      },
    ],
  };
}

function normalizeOrderDossierPairs(pairs) {
  if (!Array.isArray(pairs)) return [];
  return pairs
    .map((pair) => {
      const label = clipText(normalizeOrderDossierPairLabel(pair?.label || ''), 80);
      const value = clipText(normalizeString(pair?.value || ''), 250);
      if (!label || !value) return null;
      return { label, value };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeOrderDossierItems(items, maxItems = 10) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => clipText(normalizeString(item || ''), 380))
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(20, Number(maxItems) || 10)));
}

function normalizeOrderDossierLayout(rawLayout, fallbackOptions = {}) {
  const fallback = buildOrderDossierFallbackLayout(fallbackOptions);
  if (!rawLayout || typeof rawLayout !== 'object') return fallback;

  const documentTitle = clipText(
    normalizeString(rawLayout.documentTitle || rawLayout.title || fallback.documentTitle),
    220
  ) || fallback.documentTitle;
  const subtitle = clipText(
    normalizeString(rawLayout.subtitle || rawLayout.lead || fallback.subtitle),
    320
  ) || fallback.subtitle;
  const opusPrompt = buildShortOrderDossierOpusPrompt(fallbackOptions);

  const sourceBlocks = Array.isArray(rawLayout.blocks) ? rawLayout.blocks : [];
  const blocks = sourceBlocks
    .map((block) => {
      const kind = normalizeString(block?.kind || block?.type || '').toLowerCase();
      const title = clipText(normalizeString(block?.title || ''), 120) || 'Sectie';
      if (shouldHideOrderDossierBlockTitle(title)) return null;

      if (kind === 'meta') {
        const pairs = normalizeOrderDossierPairs(block?.pairs || block?.items || []);
        if (!pairs.length) return null;
        return { kind: 'meta', title, pairs };
      }

      if (kind === 'bullets' || kind === 'checklist') {
        const items = normalizeOrderDossierItems(block?.items || [], 12);
        if (!items.length) return null;
        return { kind: 'bullets', title, items };
      }

      if (kind === 'steps' || kind === 'timeline') {
        const items = normalizeOrderDossierItems(block?.items || block?.steps || [], 12);
        if (!items.length) return null;
        return { kind: 'steps', title, items };
      }

      const text = clipText(normalizeString(block?.text || block?.content || ''), 5500);
      if (!text) return null;
      return { kind: 'text', title, text };
    })
    .filter(Boolean)
    .slice(0, 10);

  return {
    documentTitle,
    subtitle,
    opusPrompt,
    blocks: blocks.length ? blocks : fallback.blocks,
  };
}

function buildAnthropicOrderDossierPrompts(options = {}) {
  const input = buildOrderDossierInput(options);
  const fallback = buildOrderDossierFallbackLayout(input);

  const systemPrompt = [
    'Je bent een senior delivery writer voor Softora.',
    'Taak: maak een dynamisch uitvoerdossier in JSON voor een PDF-weergave.',
    'Belangrijk:',
    '- Schrijf in helder Nederlands.',
    '- Verzin geen feiten die niet in de input staan.',
    '- Gebruik alleen content die direct uit de input volgt; voeg geen generieke projectfasen of teamrichtlijnen toe.',
    '- Gebruik een indeling die past bij de hoeveelheid inhoud (dynamisch, niet template-achtig).',
    '- Gebruik geen bloktitels zoals "Uitvoerplan", "Ontbrekende informatie" of "Praktische aandachtspunten".',
    '- Voeg geen interne velden toe zoals "Accounthouder Softora" of "Softora-contactpersoon".',
    '- Lever een direct copy-paste prompt voor Claude Opus 4.6 die exact 1 zin lang is.',
    '- Gebruik NOOIT ellipsis zoals "...".',
    '- Geef ALLEEN geldig JSON terug, zonder markdown of extra tekst.',
    '',
    'JSON schema:',
    '{',
    '  "documentTitle": "string",',
    '  "subtitle": "string",',
    '  "opusPrompt": "string",',
    '  "blocks": [',
    '    {',
    '      "kind": "meta|text|bullets|steps",',
    '      "title": "string",',
    '      "pairs": [{"label":"string","value":"string"}],',
    '      "text": "string",',
    '      "items": ["string"]',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const userPrompt = [
    '<order_dossier_request>',
    `<order_id>${input.orderId || ''}</order_id>`,
    `<company>${escapeHtml(input.company || '')}</company>`,
    `<contact>${escapeHtml(input.contact || '')}</contact>`,
    `<title>${escapeHtml(input.title || '')}</title>`,
    `<domain>${escapeHtml(input.domainName || '')}</domain>`,
    `<delivery_time>${escapeHtml(input.deliveryTime || '')}</delivery_time>`,
    `<claimed_by>${escapeHtml(input.claimedBy || '')}</claimed_by>`,
    `<claimed_at>${escapeHtml(input.claimedAt || '')}</claimed_at>`,
    input.sourceAppointmentLabel
      ? `<source_appointment>${escapeHtml(input.sourceAppointmentLabel)}</source_appointment>`
      : '',
    '<customer_description>',
    input.description || '',
    '</customer_description>',
    '<customer_transcript>',
    input.transcript || '',
    '</customer_transcript>',
    '<required_output>',
    '- Maak een dynamische sectie-indeling op basis van de beschikbare content.',
    '- Zorg dat er altijd minimaal 1 meta-block en 1 inhoudsblock aanwezig is.',
    '- Gebruik alleen dossierblokken die direct op de invoer zijn gebaseerd.',
    '- Laat blokken met algemene projectplanning, ontbrekende-informatie-lijsten en praktische teamnotities weg.',
    '- Laat interne Softora-contactvelden zoals account- of contactpersoonlabels weg.',
    '- opusPrompt moet direct bruikbaar zijn voor Claude Opus 4.6 en exact 1 zin lang zijn.',
    '</required_output>',
    '<fallback_reference>',
    JSON.stringify(fallback),
    '</fallback_reference>',
    '</order_dossier_request>',
  ]
    .filter(Boolean)
    .join('\n');

  return { input, fallback, systemPrompt, userPrompt };
}

async function generateDynamicOrderDossierWithAnthropic(options = {}) {
  const promptPack = buildAnthropicOrderDossierPrompts(options);
  const model = normalizeString(options.model || getDossierAnthropicModel()) || 'claude-opus-4-6';
  const data = await sendAnthropicMessage({
    model,
    systemPrompt: promptPack.systemPrompt,
    userPrompt: promptPack.userPrompt,
    maxTokens: getAnthropicDossierMaxTokens(),
    stage: 'build',
  });

  const rawText = normalizeString(extractAnthropicTextContent(data?.content));
  const parsed = parseJsonLoose(rawText);
  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('Claude gaf geen geldig JSON-layout terug.');
    err.status = 502;
    throw err;
  }

  const layout = normalizeOrderDossierLayout(parsed, promptPack.input);
  return {
    layout,
    source: 'anthropic',
    model: normalizeString(data?.model || model) || model,
    usage: data?.usage || null,
  };
}

async function sendAnthropicMessage(options = {}) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const systemPrompt = normalizeString(options.systemPrompt || '');
  const userPrompt = normalizeString(options.userPrompt || '');
  if (!systemPrompt || !userPrompt) {
    const err = new Error('Anthropic prompt is onvolledig.');
    err.status = 500;
    throw err;
  }

  const maxTokens = Math.max(2000, Math.min(48000, Number(options.maxTokens || 12000) || 12000));
  const model = normalizeString(options.model || getWebsiteAnthropicModel());
  if (!model) {
    const err = new Error('Anthropic model voor website generatie ontbreekt.');
    err.status = 500;
    throw err;
  }
  const effort = getAnthropicWebsiteStageEffort(options.stage || 'build');
  const referenceImages = sanitizeReferenceImages(options.referenceImages || options.attachments || [], {
    maxItems: 6,
    maxBytesPerImage: 550 * 1024,
    maxTotalBytes: 3 * 1024 * 1024,
  });
  const imageBlocks = referenceImages
    .map((item) => {
      const parsed = parseImageDataUrl(item?.dataUrl || '');
      if (!parsed) return null;
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mimeType,
          data: parsed.base64Payload,
        },
      };
    })
    .filter(Boolean);
  const userContentBlocks = [
    ...imageBlocks,
    { type: 'text', text: userPrompt },
  ];

  const basePayload = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userContentBlocks,
      },
    ],
  };

  const enhancedPayload = supportsAnthropicAdaptiveThinking(model)
    ? {
        ...basePayload,
        thinking: { type: 'adaptive' },
        output_config: { effort },
      }
    : basePayload;

  const sendRequest = async (payload) =>
    fetchJsonWithTimeout(
      `${ANTHROPIC_API_BASE_URL}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': process.env.ANTHROPIC_API_VERSION || '2023-06-01',
        },
        body: JSON.stringify(payload),
      },
      WEBSITE_GENERATION_TIMEOUT_MS
    );

  let result = await sendRequest(enhancedPayload);
  if (
    !result.response.ok &&
    enhancedPayload !== basePayload &&
    Number(result.response.status) === 400
  ) {
    result = await sendRequest(basePayload);
  }

  if (!result.response.ok) {
    const err = new Error(`Anthropic website generatie mislukt (${result.response.status})`);
    err.status = result.response.status;
    err.data = result.data;
    throw err;
  }

  return result.data;
}

async function generateWebsiteHtmlWithOpenAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const { company, title, userPrompt, systemPrompt, referenceImages } = buildWebsiteGenerationPrompts(options);
  const userContent = referenceImages.length
    ? [
        { type: 'text', text: userPrompt },
        ...referenceImages.map((item) => ({
          type: 'image_url',
          image_url: { url: item.dataUrl },
        })),
      ]
    : userPrompt;

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    },
    WEBSITE_GENERATION_TIMEOUT_MS
  );

  if (!response.ok) {
    const err = new Error(`OpenAI website generatie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const generatedText = normalizeString(extractOpenAiTextContent(content));
  if (!generatedText) {
    const err = new Error('OpenAI gaf lege HTML terug.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  const html = ensureHtmlDocument(generatedText, { title, company });
  if (!html) {
    const err = new Error('Kon HTML output niet valideren.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    html,
    source: 'openai',
    model: OPENAI_MODEL,
    usage: data?.usage || null,
    apiCost:
      estimateOpenAiUsageCost(data?.usage || null, OPENAI_MODEL) ||
      estimateOpenAiTextCost(userPrompt, html, OPENAI_MODEL),
  };
}

async function generateWebsiteHtmlWithAnthropic(options = {}) {
  const blueprintText = buildLocalWebsiteBlueprint(options);
  const websiteModel = getWebsiteAnthropicModel();
  const buildPrompts = buildAnthropicWebsiteHtmlPrompts(options, blueprintText);
  const htmlData = await sendAnthropicMessage({
    model: websiteModel,
    systemPrompt: buildPrompts.systemPrompt,
    userPrompt: buildPrompts.userPrompt,
    referenceImages: buildPrompts.referenceImages,
    maxTokens: getAnthropicWebsiteStageMaxTokens('build'),
    stage: 'build',
  });

  const generatedText = normalizeString(extractAnthropicTextContent(htmlData?.content));
  if (!generatedText) {
    const err = new Error('Anthropic gaf lege HTML terug.');
    err.status = 502;
    err.data = htmlData;
    throw err;
  }

  const html = WEBSITE_GENERATION_STRICT_HTML
    ? ensureStrictAnthropicHtml(generatedText)
    : ensureHtmlDocument(generatedText, {
        title: buildPrompts.title,
        company: buildPrompts.company,
      });
  if (!html) {
    const err = new Error('Kon HTML output niet valideren.');
    err.status = 502;
    err.data = htmlData;
    throw err;
  }

  if (!isLikelyUsableWebsiteHtml(html)) {
    const err = new Error('AI output lijkt onvolledig of visueel defect.');
    err.status = 502;
    err.data = htmlData;
    throw err;
  }

  const resolvedModel = normalizeString(htmlData?.model || websiteModel || ANTHROPIC_MODEL);

  return {
    html,
    source: 'anthropic',
    model: resolvedModel,
    usage: htmlData?.usage || null,
    apiCost:
      estimateAnthropicUsageCost(htmlData?.usage || null, resolvedModel) ||
      estimateAnthropicTextCost(
        `${buildPrompts.userPrompt}\n\n${blueprintText}`,
        html,
        resolvedModel
      ),
  };
}

async function generateWebsiteHtmlWithAi(options = {}) {
  const provider = getWebsiteGenerationProvider();
  if (WEBSITE_GENERATION_STRICT_ANTHROPIC && provider !== 'anthropic') {
    const err = new Error('Website generatie is strict op Anthropic/Claude gezet.');
    err.status = 503;
    throw err;
  }
  if (provider === 'anthropic') {
    return generateWebsiteHtmlWithAnthropic(options);
  }
  return generateWebsiteHtmlWithOpenAi(options);
}

function shouldAnalyzeCallUpdateWithAi(callUpdate) {
  if (!callUpdate || !getOpenAiApiKey()) return false;

  const summary = normalizeString(callUpdate.summary);
  const transcriptSnippet = normalizeString(callUpdate.transcriptSnippet);
  if (!summary && transcriptSnippet.length < 20) return false;

  const statusText = `${normalizeString(callUpdate.status).toLowerCase()} ${normalizeString(
    callUpdate.messageType
  ).toLowerCase()} ${normalizeString(callUpdate.endedReason).toLowerCase()}`;
  const looksFinal = /(end|ended|complete|completed|hang|finish|final|analysis|summary)/i.test(
    statusText
  );

  // Analyseer pas op (waarschijnlijk) finale updates om webhook-load tijdens live calls te beperken.
  return looksFinal;
}

function getCallUpdateAiFingerprint(callUpdate) {
  return [
    normalizeString(callUpdate?.status),
    normalizeString(callUpdate?.endedReason),
    normalizeString(callUpdate?.summary),
    normalizeString(callUpdate?.transcriptSnippet),
    truncateText(normalizeString(callUpdate?.transcriptFull), 1200),
  ].join('|');
}

function addDaysToIsoDate(dateValue, days) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const next = new Date(date.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function extractLikelyAppointmentDateFromText(text, baseIso) {
  const raw = normalizeString(text);
  if (!raw) return '';

  const isoMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return normalizeDateYyyyMmDd(isoMatch[1]);
  }

  const dmyMatch = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmyMatch) {
    const now = new Date(baseIso || Date.now());
    const yearRaw = normalizeString(dmyMatch[3]);
    const year =
      yearRaw.length === 4
        ? Number(yearRaw)
        : yearRaw.length === 2
          ? 2000 + Number(yearRaw)
          : now.getFullYear();
    const month = Math.max(1, Math.min(12, Number(dmyMatch[2])));
    const day = Math.max(1, Math.min(31, Number(dmyMatch[1])));
    return normalizeDateYyyyMmDd(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }

  const lower = raw.toLowerCase();
  const baseDate = normalizeDateYyyyMmDd(baseIso) || normalizeDateYyyyMmDd(new Date().toISOString());
  if (!baseDate) return '';
  if (/\bovermorgen\b/.test(lower)) return addDaysToIsoDate(baseDate, 2);
  if (/\bmorgen\b/.test(lower)) return addDaysToIsoDate(baseDate, 1);
  if (/\bvandaag\b/.test(lower)) return addDaysToIsoDate(baseDate, 0);

  return '';
}

function extractLikelyAppointmentTimeFromText(text) {
  const raw = normalizeString(text);
  if (!raw) return '';

  const hhmm = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmm) {
    return normalizeTimeHhMm(`${hhmm[1]}:${hhmm[2]}`);
  }

  const lower = raw.toLowerCase();
  const uurMatch = lower.match(/\b(?:om\s+)?(\d{1,2})\s*uur(?:\s+([a-z]+(?:\s+[a-z]+)?))?\b/);
  if (!uurMatch) return '';

  let hour = Math.max(0, Math.min(23, Number(uurMatch[1])));
  const suffix = normalizeString(uurMatch[2] || '').toLowerCase();

  if (/(middag|des middags|vanmiddag|avond)/.test(suffix) && hour >= 1 && hour <= 11) {
    hour += 12;
  }
  if (/(ochtend|smorgens|morgens)/.test(suffix) && hour === 12) {
    hour = 0;
  }

  return normalizeTimeHhMm(`${String(hour).padStart(2, '0')}:00`);
}

function isOutboundOrUnknownCall(callUpdate) {
  const direction = normalizeString(callUpdate?.direction || '').toLowerCase();
  if (direction.includes('inbound')) return false;

  const messageType = normalizeString(callUpdate?.messageType || '').toLowerCase();
  if (/twilio\.inbound\./.test(messageType)) return false;

  return true;
}

function buildCallInterestSignalText(callUpdate, insight = null) {
  return normalizeString(
    [
      callUpdate?.summary,
      callUpdate?.transcriptSnippet,
      callUpdate?.transcriptFull,
      callUpdate?.status,
      callUpdate?.endedReason,
      insight?.summary,
      insight?.followUpReason,
    ]
      .filter(Boolean)
      .join(' ')
  ).toLowerCase();
}

function hasNegativeInterestSignal(text) {
  const source = normalizeString(text).toLowerCase();
  if (!source) return false;
  return /(geen interesse|niet geinteresseerd|niet geïnteresseerd|niet meer bellen|bel( me)? niet|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst)/.test(
    source
  );
}

function hasPositiveInterestSignal(text) {
  const source = normalizeString(text).toLowerCase();
  if (!source) return false;
  return /(wel interesse|geinteresseerd|geïnteresseerd|interesse|afspraak|demo|offerte|stuur (de )?(mail|info)|mail .* (offerte|informatie)|terugbellen|callback|terugbel)/.test(
    source
  );
}

function resolveLeadFollowUpDateAndTime(callUpdate) {
  const candidates = [callUpdate?.endedAt, callUpdate?.updatedAt, callUpdate?.startedAt];
  let reference = null;
  for (const value of candidates) {
    const iso = normalizeString(value || '');
    const ts = Date.parse(iso);
    if (Number.isFinite(ts)) {
      reference = new Date(ts);
      break;
    }
  }
  if (!reference) reference = new Date();

  let date = '';
  let time = '';
  try {
    date = normalizeDateYyyyMmDd(
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(reference)
    );
    time = normalizeTimeHhMm(
      new Intl.DateTimeFormat('nl-NL', {
        timeZone: 'Europe/Amsterdam',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(reference)
    );
  } catch (_) {
    date = normalizeDateYyyyMmDd(reference.toISOString());
    time = normalizeTimeHhMm(reference.toISOString().slice(11, 16));
  }

  return {
    date: date || normalizeDateYyyyMmDd(new Date().toISOString()) || '',
    time: time || '09:00',
  };
}

function isWeakAppointmentLocationText(value) {
  const text = normalizeString(value || '').trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  if (/^(onbekend|nog niet ingevuld|nvt|n\/a|null|undefined|-)$/.test(lower)) return true;
  if (/^\d+(?:[.,]\d+)?\s*(km|kilometer|kilometers|m|meter|meters)\b/.test(lower)) return true;
  return false;
}

function sanitizeResolvedLocationText(value) {
  const sanitized = truncateText(normalizeString(value || ''), 220);
  if (!sanitized) return '';
  if (isWeakAppointmentLocationText(sanitized)) return '';
  return sanitized;
}

function composeResolvedAppointmentLocation(addressValue, regionValue) {
  const address = sanitizeResolvedLocationText(addressValue || '');
  const region = sanitizeResolvedLocationText(regionValue || '');
  if (address && region) {
    const addressKey = normalizeString(address).toLowerCase();
    const regionKey = normalizeString(region).toLowerCase();
    if (addressKey.includes(regionKey)) return address;
    return truncateText(`${address}, ${region}`, 220);
  }
  return address || region;
}

function resolveAppointmentLocation(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    const explicit = sanitizeResolvedLocationText(
      source.location || source.appointmentLocation || source.locatie || ''
    );
    if (explicit) return explicit;

    const combined = composeResolvedAppointmentLocation(
      source.address || source.adres || source.street || source.straat || '',
      source.region ||
        source.regio ||
        source.city ||
        source.plaats ||
        source.stad ||
        source.province ||
        source.provincie ||
        source.state ||
        ''
    );
    if (combined) return combined;
  }

  return '';
}

function extractAddressLikeLocationFromText(value) {
  const text = normalizeString(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const streetMatch =
    text.match(
      /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*)*(?:straat|laan|weg|dreef|plein|markt|kade|gracht|singel|steeg|boulevard|pad|hof|baan|wal|plantsoen|poort)\s+\d{1,4}[a-zA-Z]?(?:\s*,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-\s]{1,60})?)/i
    ) ||
    text.match(
      /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*)*\s(?:straat|laan|weg|dreef|plein|markt|kade|gracht|singel|steeg|boulevard|pad|hof|baan|wal|plantsoen|poort)\s+\d{1,4}[a-zA-Z]?(?:\s*,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-\s]{1,60})?)/i
    );
  if (!streetMatch) return '';
  return truncateText(normalizeString(streetMatch[1] || ''), 220);
}

function shouldCreateLeadFollowUpFromCall(callUpdate, insight = null) {
  if (!callUpdate || !normalizeString(callUpdate.callId || '')) return false;
  if (!isOutboundOrUnknownCall(callUpdate)) return false;

  const status = normalizeString(callUpdate.status || '').toLowerCase();
  const endedReason = normalizeString(callUpdate.endedReason || '');
  const statusText = `${status} ${endedReason}`.trim();
  const hasConversationContent = Boolean(
    normalizeString(callUpdate.summary || '') ||
      normalizeString(callUpdate.transcriptSnippet || '') ||
      normalizeString(callUpdate.transcriptFull || '')
  );
  const hasKnownDuration =
    Number.isFinite(Number(callUpdate.durationSeconds)) && Number(callUpdate.durationSeconds) >= 15;

  if (
    /(not[_ -]?connected|no[_ -]?answer|unanswered|failed|dial[_ -]?failed|busy|voicemail|initiated|queued|ringing|cancelled|canceled|rejected|error)/.test(
      statusText
    )
  ) {
    return false;
  }
  if (!hasConversationContent && !hasKnownDuration) return false;

  const signalText = buildCallInterestSignalText(callUpdate, insight);
  if (!signalText) return false;
  if (hasNegativeInterestSignal(signalText)) return false;

  if (toBooleanSafe(insight?.appointmentBooked, false)) return true;
  if (toBooleanSafe(insight?.followUpRequired, false)) return true;
  return hasPositiveInterestSignal(signalText);
}

function buildGeneratedLeadFollowUpFromCall(callUpdate, insight = null) {
  if (!shouldCreateLeadFollowUpFromCall(callUpdate, insight)) return null;
  const callId = normalizeString(callUpdate?.callId || '');
  if (!callId) return null;
  const leadOwner = buildLeadOwnerFields(callId);

  const company =
    normalizeString(callUpdate?.company || insight?.company || insight?.leadCompany || '') || 'Onbekende lead';
  const contact =
    normalizeString(callUpdate?.name || insight?.contactName || insight?.leadName || '') || 'Onbekend';
  const phone = normalizeString(callUpdate?.phone || insight?.phone || '');
  const { date, time } = resolveLeadFollowUpDateAndTime(callUpdate);
  const summary = truncateText(
    normalizeString(
      insight?.summary ||
        callUpdate?.summary ||
        callUpdate?.transcriptSnippet ||
        'Lead toonde interesse tijdens het gesprek.'
    ),
    900
  );
  const normalizedStack = normalizeColdcallingStack(callUpdate?.stack || insight?.coldcallingStack || '');
  const stackLabel = getColdcallingStackLabel(normalizedStack);
  const createdAt =
    normalizeString(callUpdate?.endedAt || callUpdate?.updatedAt || callUpdate?.startedAt || '') ||
    new Date().toISOString();

  return {
    company,
    contact,
    phone,
    contactEmail: normalizeEmailAddress(insight?.contactEmail || insight?.email || insight?.leadEmail || ''),
    type: 'lead_follow_up',
    date,
    time,
    value: formatEuroLabel(insight?.estimatedValueEur || insight?.estimated_value_eur),
    branche: normalizeString(insight?.branche || insight?.sector || callUpdate?.branche || '') || 'Onbekend',
    source: 'AI Cold Calling (Lead opvolging)',
    summary: summary || 'Lead toonde interesse tijdens het gesprek.',
    aiGenerated: true,
    callId,
    createdAt,
    needsConfirmationEmail: true,
    confirmationTaskType: 'lead_follow_up',
    provider: normalizeString(callUpdate?.provider || ''),
    coldcallingStack: normalizedStack || '',
    coldcallingStackLabel: stackLabel || '',
    location: resolveAppointmentLocation(callUpdate, insight),
    durationSeconds: resolveCallDurationSeconds(callUpdate, insight),
    recordingUrl: resolvePreferredRecordingUrl(callUpdate, insight),
    ...leadOwner,
  };
}

function createRuleBasedInsightFromCallUpdate(callUpdate) {
  if (!callUpdate?.callId) return null;

  const summary = normalizeString(callUpdate.summary || '');
  const transcriptFull = normalizeString(callUpdate.transcriptFull || '');
  const transcriptSnippet = normalizeString(callUpdate.transcriptSnippet || '');
  const sourceText = [summary, transcriptFull, transcriptSnippet].filter(Boolean).join('\n');
  if (!sourceText) return null;

  const lower = sourceText.toLowerCase();
  const hasAppointmentLanguage =
    /(afspraak|intake|kennismaking|langs\s+kom)/.test(lower) &&
    /(ingepland|gepland|bevestigd|morgen|overmorgen|\bom\b\s*\d{1,2}(:\d{2})?\s*uur|\b\d{1,2}:\d{2}\b)/.test(
      lower
    );

  const callSummaryStrong =
    /er is een afspraak ingepland|afspraak ingepland|afspraak gepland|intake ingepland/.test(lower);

  const appointmentBooked = hasAppointmentLanguage || callSummaryStrong;
  const appointmentDate = extractLikelyAppointmentDateFromText(sourceText, callUpdate.updatedAt);
  const appointmentTime = extractLikelyAppointmentTimeFromText(sourceText);

  const ruleSummary =
    summary ||
    truncateText(
      transcriptSnippet || transcriptFull || 'Call verwerkt op basis van transcriptie.',
      900
    );

  return {
    callId: normalizeString(callUpdate.callId),
    company: normalizeString(callUpdate.company || ''),
    contactName: normalizeString(callUpdate.name || ''),
    phone: normalizeString(callUpdate.phone || ''),
    branche: normalizeString(callUpdate.branche || ''),
    region: normalizeString(callUpdate.region || ''),
    province: normalizeString(callUpdate.province || ''),
    address: normalizeString(callUpdate.address || ''),
    location: resolveAppointmentLocation(callUpdate),
    summary: ruleSummary,
    appointmentBooked: Boolean(appointmentBooked && appointmentDate),
    appointmentDate: appointmentBooked ? appointmentDate : '',
    appointmentTime: appointmentBooked ? appointmentTime : '',
    estimatedValueEur: null,
    followUpRequired: Boolean(appointmentBooked),
    followUpReason: appointmentBooked
      ? 'Bevestigingsmail sturen op basis van gedetecteerde afspraak in gesprekstranscriptie.'
      : '',
    source: 'rule',
    model: 'rule',
    analyzedAt: new Date().toISOString(),
  };
}

function ensureRuleBasedInsightAndAppointment(callUpdate) {
  if (!callUpdate || !callUpdate.callId) return null;

  const existingInsight = aiCallInsightsByCallId.get(callUpdate.callId) || null;
  const ruleInsight = createRuleBasedInsightFromCallUpdate(callUpdate);

  let nextInsight = existingInsight;

  if (!existingInsight && ruleInsight) {
    nextInsight = upsertAiCallInsight(ruleInsight);
  } else if (existingInsight && ruleInsight) {
    let changed = false;
    const merged = { ...existingInsight };

    if (!normalizeString(merged.summary) && normalizeString(ruleInsight.summary)) {
      merged.summary = ruleInsight.summary;
      changed = true;
    }

    if (!toBooleanSafe(merged.appointmentBooked, false) && toBooleanSafe(ruleInsight.appointmentBooked, false)) {
      merged.appointmentBooked = true;
      if (!normalizeDateYyyyMmDd(merged.appointmentDate)) merged.appointmentDate = ruleInsight.appointmentDate;
      if (!normalizeTimeHhMm(merged.appointmentTime)) merged.appointmentTime = ruleInsight.appointmentTime;
      if (!normalizeString(merged.followUpReason)) merged.followUpReason = ruleInsight.followUpReason;
      if (!toBooleanSafe(merged.followUpRequired, false)) merged.followUpRequired = true;
      if (!normalizeString(merged.model)) merged.model = 'rule';
      if (!normalizeString(merged.source)) merged.source = 'rule';
      changed = true;
    }

    if (changed) {
      merged.analyzedAt = new Date().toISOString();
      nextInsight = upsertAiCallInsight(merged);
    }
  }

  if (nextInsight && toBooleanSafe(nextInsight.appointmentBooked, false)) {
    const agendaAppointment = buildGeneratedAgendaAppointmentFromAiInsight({
      ...nextInsight,
      callId: callUpdate.callId,
      leadCompany: callUpdate.company,
      leadName: callUpdate.name,
      leadBranche: callUpdate.branche,
      provider: callUpdate.provider,
      coldcallingStack: callUpdate.stack,
      coldcallingStackLabel: callUpdate.stackLabel,
    });

    if (agendaAppointment) {
      const savedAppointment = upsertGeneratedAgendaAppointment(agendaAppointment, callUpdate.callId);
      if (savedAppointment) {
        if (nextInsight) {
          nextInsight = upsertAiCallInsight({
            ...nextInsight,
            agendaAppointmentId: savedAppointment.id,
          });
        }
      }
    }
  }

  const existingAppointmentId = agendaAppointmentIdByCallId.get(callUpdate.callId);
  if (!existingAppointmentId) {
    const followUpLeadAppointment = buildGeneratedLeadFollowUpFromCall(callUpdate, nextInsight);
    if (followUpLeadAppointment) {
      const savedLeadAppointment = upsertGeneratedAgendaAppointment(followUpLeadAppointment, callUpdate.callId);
      if (savedLeadAppointment && nextInsight) {
        nextInsight = upsertAiCallInsight({
          ...nextInsight,
          agendaAppointmentId: savedLeadAppointment.id,
        });
      }
    }
  }

  return nextInsight;
}

function backfillInsightsAndAppointmentsFromRecentCallUpdates() {
  let touched = 0;
  for (const callUpdate of recentCallUpdates) {
    const callId = normalizeString(callUpdate?.callId || '');
    if (!callId || callId.startsWith('demo-')) continue;

    const beforeInsight = aiCallInsightsByCallId.get(callId) || null;
    const beforeApptId = agendaAppointmentIdByCallId.get(callId) || null;
    const afterInsight = ensureRuleBasedInsightAndAppointment(callUpdate);
    const afterApptId = agendaAppointmentIdByCallId.get(callId) || null;

    if (
      (afterInsight && !beforeInsight) ||
      (afterInsight && beforeInsight && JSON.stringify(afterInsight) !== JSON.stringify(beforeInsight)) ||
      (!beforeApptId && afterApptId)
    ) {
      touched += 1;
    }
  }
  touched += backfillOpenLeadFollowUpAppointmentsFromLatestCalls();
  touched += repairAgendaAppointmentsFromDashboardActivities();
  return touched;
}

function isGeneratedAppointmentConfirmedForAgenda(appointment) {
  if (!appointment || typeof appointment !== 'object') return false;
  if (
    appointment.confirmationAppointmentCancelled ||
    appointment.confirmationAppointmentCancelledAt
  ) {
    return false;
  }
  if (!toBooleanSafe(appointment.aiGenerated, false)) return true;
  return Boolean(appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt);
}

function resolveCallDurationSeconds(...sources) {
  for (const source of sources) {
    const parsed = parseNumberSafe(
      source?.durationSeconds ??
        source?.duration_seconds ??
        source?.callDurationSeconds ??
        source?.duration ??
        null,
      null
    );
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.round(parsed));
    }
  }
  return null;
}


function getLatestCallUpdateByCallId(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;
  return callUpdatesById.get(normalizedCallId) || null;
}

function buildGeneratedAgendaAppointmentFromAiInsight(insight) {
  if (!insight || !toBooleanSafe(insight.appointmentBooked, false)) return null;

  const date = normalizeDateYyyyMmDd(insight.appointmentDate);
  if (!date) return null;

  const time = normalizeTimeHhMm(insight.appointmentTime) || '09:00';
  const timeWasGuessed = !normalizeTimeHhMm(insight.appointmentTime);
  const company = normalizeString(insight.company || insight.leadCompany || '') || 'Onbekende lead';
  const contact = normalizeString(insight.contactName || insight.leadName || '') || 'Onbekend';
  const phone = normalizeString(insight.phone || '');
  const branche = normalizeString(insight.branche || insight.sector || insight.leadBranche || '') || 'Onbekend';
  const provider = normalizeString(insight.provider || '');
  const coldcallingStack = normalizeColdcallingStack(insight.coldcallingStack || insight.stack || '');
  const coldcallingStackLabel = normalizeString(
    insight.coldcallingStackLabel || insight.stackLabel || getColdcallingStackLabel(coldcallingStack)
  );
  const summaryCore = truncateText(
    normalizeString(insight.summary || insight.shortSummary || insight.short_summary || ''),
    900
  );
  const summary = timeWasGuessed
    ? `${summaryCore}${summaryCore ? ' ' : ''}(Tijd niet expliciet genoemd; standaard op 09:00 gezet.)`
    : summaryCore;
  const callId = normalizeString(insight.callId);

  return {
    company,
    contact,
    phone,
    contactEmail: normalizeEmailAddress(insight.contactEmail || insight.email || insight.leadEmail || ''),
    type: 'meeting',
    date,
    time,
    value: formatEuroLabel(insight.estimatedValueEur || insight.estimated_value_eur),
    branche,
    source: 'AI Cold Calling (Retell + AI)',
    summary: summary || 'AI-samenvatting aangemaakt op basis van call update.',
    aiGenerated: true,
    callId,
    createdAt: new Date().toISOString(),
    confirmationTaskType: 'send_confirmation_email',
    provider: provider || '',
    coldcallingStack: coldcallingStack || '',
    coldcallingStackLabel: coldcallingStackLabel || '',
    location: resolveAppointmentLocation(insight),
    recordingUrl: resolvePreferredRecordingUrl(getLatestCallUpdateByCallId(callId), insight),
    ...buildLeadOwnerFields(callId),
  };
}

async function createAiInsightFromCallUpdate(callUpdate) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const nowIso = new Date().toISOString();
  const systemPrompt = [
    'Je bent een sales-operations assistent voor een Nederlands coldcalling team.',
    'Analyseer een call-update en geef EEN geldig JSON-object terug (geen markdown).',
    'Doelen:',
    '1) Maak een korte Nederlandse samenvatting van max 3 zinnen.',
    '2) Bepaal of er een afspraak is ingepland.',
    '3) Extraheer afspraakdatum en tijd alleen als deze expliciet of zeer duidelijk genoemd zijn.',
    '4) Gebruik null als datum/tijd onbekend zijn.',
    '5) Raad geen bedragen of branche als dit niet uit de tekst blijkt; gebruik null of lege string.',
    'JSON keys exact:',
    'summary, appointmentBooked, appointmentDate, appointmentTime, contactName, company, phone, branche, estimatedValueEur, followUpRequired, followUpReason',
    'Datumformaat: YYYY-MM-DD. Tijdsformaat: HH:MM (24u).',
    'Taal output: Nederlands.',
  ].join('\n');

  const userPayload = {
    nowIso,
    timezone: 'Europe/Amsterdam',
    callUpdate: {
      callId: callUpdate.callId,
      status: callUpdate.status,
      messageType: callUpdate.messageType,
      endedReason: callUpdate.endedReason,
      company: callUpdate.company,
      branche: callUpdate.branche,
      name: callUpdate.name,
      phone: callUpdate.phone,
      callSummary: callUpdate.summary,
      transcriptSnippet: callUpdate.transcriptSnippet,
      transcriptFull: truncateText(normalizeString(callUpdate.transcriptFull || ''), 5000),
      updatedAt: callUpdate.updatedAt,
    },
  };

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
      }),
    },
    25000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI analyse mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = extractOpenAiTextContent(content);
  const parsed = parseJsonLoose(text);

  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('OpenAI gaf geen geldig JSON-object terug.');
    err.data = { rawContent: text };
    throw err;
  }

  return {
    callId: normalizeString(callUpdate.callId),
    company: normalizeString(parsed.company || callUpdate.company),
    contactName: normalizeString(parsed.contactName || parsed.contact_name || callUpdate.name),
    phone: normalizeString(parsed.phone || callUpdate.phone),
    branche: normalizeString(parsed.branche || parsed.branch || callUpdate.branche || ''),
    summary: truncateText(
      normalizeString(parsed.summary || parsed.shortSummary || parsed.short_summary || callUpdate.summary),
      900
    ),
    appointmentBooked: toBooleanSafe(parsed.appointmentBooked ?? parsed.appointment_booked, false),
    appointmentDate: normalizeDateYyyyMmDd(parsed.appointmentDate || parsed.appointment_date),
    appointmentTime: normalizeTimeHhMm(parsed.appointmentTime || parsed.appointment_time),
    estimatedValueEur: parseNumberSafe(parsed.estimatedValueEur ?? parsed.estimated_value_eur, null),
    followUpRequired: toBooleanSafe(parsed.followUpRequired ?? parsed.follow_up_required, false),
    followUpReason: truncateText(
      normalizeString(parsed.followUpReason || parsed.follow_up_reason),
      300
    ),
    source: 'openai',
    model: OPENAI_MODEL,
    analyzedAt: new Date().toISOString(),
  };
}

function upsertAiCallInsight(insight) {
  if (!insight || !insight.callId) return null;

  const existing = aiCallInsightsByCallId.get(insight.callId);
  const merged = existing ? { ...existing, ...insight, callId: existing.callId } : insight;
  aiCallInsightsByCallId.set(merged.callId, merged);

  const idx = recentAiCallInsights.findIndex((item) => item.callId === merged.callId);
  if (idx >= 0) {
    recentAiCallInsights.splice(idx, 1);
  }
  recentAiCallInsights.unshift(merged);
  if (recentAiCallInsights.length > 500) {
    recentAiCallInsights.pop();
  }

  queueRuntimeStatePersist('ai_call_insight');

  return merged;
}

async function maybeAnalyzeCallUpdateWithAi(callUpdate) {
  if (!shouldAnalyzeCallUpdateWithAi(callUpdate)) return null;
  if (!callUpdate?.callId) return null;

  const fingerprint = getCallUpdateAiFingerprint(callUpdate);
  if (aiAnalysisFingerprintByCallId.get(callUpdate.callId) === fingerprint) {
    return aiCallInsightsByCallId.get(callUpdate.callId) || null;
  }
  if (aiAnalysisInFlightCallIds.has(callUpdate.callId)) {
    return null;
  }

  aiAnalysisInFlightCallIds.add(callUpdate.callId);
  try {
    let insight = null;
    let aiError = null;
    try {
      insight = await createAiInsightFromCallUpdate(callUpdate);
    } catch (error) {
      aiError = error;
      console.error(
        '[AI Call Insight Create Error]',
        JSON.stringify(
          {
            callId: callUpdate.callId,
            message: error?.message || 'Onbekende fout',
            status: error?.status || null,
            data: error?.data || null,
          },
          null,
          2
        )
      );
    }

    const ruleInsight = createRuleBasedInsightFromCallUpdate(callUpdate);
    if (!insight && ruleInsight) {
      insight = ruleInsight;
      console.log(
        '[AI Call Insight Fallback]',
        JSON.stringify(
          {
            callId: callUpdate.callId,
            source: 'rule',
            appointmentBooked: ruleInsight.appointmentBooked,
            appointmentDate: ruleInsight.appointmentDate || null,
            appointmentTime: ruleInsight.appointmentTime || null,
          },
          null,
          2
        )
      );
    } else if (insight && ruleInsight) {
      if (!insight.summary && ruleInsight.summary) {
        insight.summary = ruleInsight.summary;
      }
      if (!toBooleanSafe(insight.appointmentBooked, false) && toBooleanSafe(ruleInsight.appointmentBooked, false)) {
        insight.appointmentBooked = true;
        if (!normalizeDateYyyyMmDd(insight.appointmentDate)) insight.appointmentDate = ruleInsight.appointmentDate;
        if (!normalizeTimeHhMm(insight.appointmentTime)) insight.appointmentTime = ruleInsight.appointmentTime;
        if (!normalizeString(insight.followUpReason)) insight.followUpReason = ruleInsight.followUpReason;
        if (!toBooleanSafe(insight.followUpRequired, false)) insight.followUpRequired = true;
      }
    }

    if (!insight) {
      if (aiError) throw aiError;
      return null;
    }

    const savedInsight = upsertAiCallInsight(insight);
    aiAnalysisFingerprintByCallId.set(callUpdate.callId, fingerprint);

    if (!normalizeString(callUpdate.summary) && normalizeString(savedInsight?.summary)) {
      upsertRecentCallUpdate({
        callId: callUpdate.callId,
        summary: savedInsight.summary,
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      });
    }

    const agendaAppointment = buildGeneratedAgendaAppointmentFromAiInsight({
      ...savedInsight,
      callId: callUpdate.callId,
      leadCompany: callUpdate.company,
      leadName: callUpdate.name,
      leadBranche: callUpdate.branche,
      provider: callUpdate.provider,
      coldcallingStack: callUpdate.stack,
      coldcallingStackLabel: callUpdate.stackLabel,
    });
    if (agendaAppointment) {
      const savedAppointment = upsertGeneratedAgendaAppointment(agendaAppointment, callUpdate.callId);
      if (savedAppointment) {
        savedInsight.agendaAppointmentId = savedAppointment.id;
      }
    }

    console.log(
      '[AI Call Insight]',
      JSON.stringify(
        {
          callId: callUpdate.callId,
          appointmentBooked: savedInsight.appointmentBooked,
          appointmentDate: savedInsight.appointmentDate || null,
          appointmentTime: savedInsight.appointmentTime || null,
          hasSummary: Boolean(savedInsight.summary),
          agendaAppointmentId: savedInsight.agendaAppointmentId || null,
        },
        null,
        2
      )
    );

    return savedInsight;
  } finally {
    aiAnalysisInFlightCallIds.delete(callUpdate.callId);
  }
}

async function fetchJsonWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinaryWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, bytes };
  } finally {
    clearTimeout(timeout);
  }
}

async function createRetellOutboundCall(payload) {
  const endpoint = '/v2/create-phone-call';
  const { response, data } = await fetchJsonWithTimeout(
    buildRetellApiUrl(endpoint),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    15000
  );

  if (!response.ok) {
    const statusError = new Error(
      data?.message ||
        data?.error ||
        data?.detail ||
        data?.raw ||
        `Retell API fout (${response.status})`
    );
    statusError.status = response.status;
    statusError.endpoint = endpoint;
    statusError.data = data;
    throw statusError;
  }

  return { endpoint, data };
}

async function fetchRetellCallStatusById(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) {
    throw new Error('callId ontbreekt');
  }

  const endpoint = `/v2/get-call/${encodeURIComponent(normalizedCallId)}`;
  const { response, data } = await fetchJsonWithTimeout(
    buildRetellApiUrl(endpoint),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    },
    10000
  );

  if (!response.ok) {
    const statusError = new Error(
      data?.message || data?.error || data?.detail || data?.raw || `Retell call status fout (${response.status})`
    );
    statusError.status = response.status;
    statusError.endpoint = endpoint;
    statusError.data = data;
    throw statusError;
  }

  return { endpoint, data };
}

async function createTwilioOutboundCall(payload) {
  const accountSid = normalizeString(process.env.TWILIO_ACCOUNT_SID);
  const endpoint = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`;
  const form = new URLSearchParams();
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (!normalizeString(key)) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        const normalizedEntry = normalizeString(entry);
        if (!normalizedEntry) return;
        form.append(key, normalizedEntry);
      });
      return;
    }
    const normalizedValue = normalizeString(value);
    if (!normalizedValue) return;
    form.set(key, normalizedValue);
  });

  const { response, data } = await fetchJsonWithTimeout(
    buildTwilioApiUrl(endpoint),
    {
      method: 'POST',
      headers: {
        Authorization: getTwilioBasicAuthorizationHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    },
    15000
  );

  if (!response.ok) {
    const statusError = new Error(
      data?.message ||
        data?.error ||
        data?.detail ||
        data?.raw ||
        `Twilio API fout (${response.status})`
    );
    statusError.status = response.status;
    statusError.endpoint = endpoint;
    statusError.data = data;
    throw statusError;
  }

  return { endpoint, data };
}

async function fetchTwilioCallStatusById(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) {
    throw new Error('callId ontbreekt');
  }
  const accountSid = normalizeString(process.env.TWILIO_ACCOUNT_SID);
  const endpoint = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(
    normalizedCallId
  )}.json`;
  const { response, data } = await fetchJsonWithTimeout(
    buildTwilioApiUrl(endpoint),
    {
      method: 'GET',
      headers: {
        Authorization: getTwilioBasicAuthorizationHeader(),
        'Content-Type': 'application/json',
      },
    },
    10000
  );

  if (!response.ok) {
    const statusError = new Error(
      data?.message || data?.error || data?.detail || data?.raw || `Twilio call status fout (${response.status})`
    );
    statusError.status = response.status;
    statusError.endpoint = endpoint;
    statusError.data = data;
    throw statusError;
  }

  return { endpoint, data };
}

function classifyRetellFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  const detailText = JSON.stringify(error?.data || {}).toLowerCase();
  const combined = `${message} ${detailText}`;
  const status = Number(error?.status || 0);

  if (
    status === 402 ||
    /credit|credits|balance|billing|payment required|insufficient funds|no_valid_payment/.test(combined)
  ) {
    return {
      cause: 'credits',
      explanation: 'Waarschijnlijk onvoldoende Retell-credits/balance om de call te starten.',
    };
  }

  if (status === 401 || /unauthorized|invalid api key|bearer/.test(combined)) {
    return {
      cause: 'wrong retell api key',
      explanation: 'RETELL_API_KEY lijkt ongeldig of ontbreekt.',
    };
  }

  if (/override_agent_id|agent/.test(combined) && /(invalid|unknown|not found|missing|does not exist)/.test(combined)) {
    return {
      cause: 'wrong retell agent',
      explanation: 'RETELL_AGENT_ID lijkt ongeldig of niet beschikbaar.',
    };
  }

  if (
    /from_number|to_number|invalid_destination|e\\.164|phone|number|nummer/.test(combined) &&
    /(invalid|format|not found|permission|omzetten|ongeldig)/.test(combined)
  ) {
    return {
      cause: 'invalid number',
      explanation: 'Het doelnummer of belnummer voor Retell is ongeldig of niet toegestaan.',
    };
  }

  if (/dynamic variables?|retell_llm_dynamic_variables|key value pairs of strings/.test(combined)) {
    return {
      cause: 'invalid dynamic variables',
      explanation:
        'Retell verwacht platte dynamic variables met alleen string-waarden. De payload is nu aangepast om alleen string -> string mee te sturen.',
    };
  }

  if (
    status >= 500 ||
    /provider|carrier|telecom|twilio|sip|timeout|temporar|rate limit|service unavailable|unavailable/.test(
      combined
    )
  ) {
    return {
      cause: 'provider issue',
      explanation: 'Waarschijnlijk een issue bij Retell/provider/carrier (tijdelijk of extern).',
    };
  }

  return {
    cause: 'unknown',
    explanation:
      'Oorzaak kon niet eenduidig worden bepaald. Controleer de exacte foutmelding en Retell response body.',
  };
}

function classifyTwilioFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  const detailText = JSON.stringify(error?.data || {}).toLowerCase();
  const combined = `${message} ${detailText}`;
  const status = Number(error?.status || 0);

  if (status === 401 || status === 403 || /auth|token|credential|account sid|permission/i.test(combined)) {
    return {
      cause: 'wrong twilio credentials',
      explanation: 'TWILIO_ACCOUNT_SID of TWILIO_AUTH_TOKEN lijkt ongeldig.',
    };
  }

  if (/from|callerid|caller id|owned|verified|not a valid phone/i.test(combined)) {
    return {
      cause: 'invalid twilio from number',
      explanation: 'TWILIO_FROM_NUMBER is ongeldig of niet beschikbaar in het Twilio account.',
    };
  }

  if (/to|destination|e\\.164|invalid phone|phone number/i.test(combined)) {
    return {
      cause: 'invalid number',
      explanation: 'Het doelnummer is ongeldig of door Twilio/carrier geweigerd.',
    };
  }

  if (status === 429 || /rate limit|too many|throttle/i.test(combined)) {
    return {
      cause: 'rate limit',
      explanation: 'Twilio rate limit bereikt; probeer later opnieuw.',
    };
  }

  if (status >= 500 || /temporar|timeout|unavailable|carrier|provider/i.test(combined)) {
    return {
      cause: 'provider issue',
      explanation: 'Waarschijnlijk een tijdelijk probleem bij Twilio of de carrier.',
    };
  }

  return {
    cause: 'unknown',
    explanation: 'Controleer de exacte Twilio response body voor de foutoorzaak.',
  };
}

function buildVariableValues(lead, campaign) {
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);
  const minProjectValue = parseNumberSafe(campaign.minProjectValue, null);
  const maxDiscountPct = parseNumberSafe(campaign.maxDiscountPct, null);
  const rawValues = {
    name: normalizeString(lead.name),
    company: normalizeString(lead.company),
    branche: normalizeString(lead.branche || lead.branch || lead.sector || ''),
    sector: normalizeString(campaign.sector),
    region: effectiveRegion,
    minProjectValue: Number.isFinite(minProjectValue) ? String(minProjectValue) : '',
    maxDiscountPct: Number.isFinite(maxDiscountPct) ? String(maxDiscountPct) : '',
    extraInstructions: normalizeString(campaign.extraInstructions),
  };

  return Object.fromEntries(
    Object.entries(rawValues).filter(
      ([key, value]) => normalizeString(key) && typeof value === 'string'
    )
  );
}

function buildRetellApiUrl(relativePath, searchParams = null) {
  const normalizedBase = `${normalizeString(RETELL_API_BASE_URL).replace(/\/+$/, '')}/`;
  const url = new URL(String(relativePath || '').replace(/^\/+/, ''), normalizedBase);

  if (searchParams && typeof searchParams === 'object') {
    Object.entries(searchParams).forEach(([key, value]) => {
      const normalizedValue = normalizeString(value);
      if (!normalizedValue) return;
      url.searchParams.set(key, normalizedValue);
    });
  }

  return url;
}

function buildTwilioApiUrl(relativePath) {
  const normalizedBase = `${normalizeString(TWILIO_API_BASE_URL).replace(/\/+$/, '')}/`;
  return new URL(String(relativePath || '').replace(/^\/+/, ''), normalizedBase);
}

function getTwilioBasicAuthorizationHeader() {
  const accountSid = normalizeString(process.env.TWILIO_ACCOUNT_SID);
  const authToken = normalizeString(process.env.TWILIO_AUTH_TOKEN);
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  return `Basic ${basic}`;
}

function buildTwilioRecordingProxyUrl(callId, recordingSid = '') {
  const normalizedCallId = normalizeString(callId);
  const normalizedRecordingSid = normalizeString(recordingSid);
  if (!normalizedCallId && !normalizedRecordingSid) return '';
  const params = new URLSearchParams();
  if (normalizedCallId) params.set('callId', normalizedCallId);
  if (normalizedRecordingSid) params.set('recordingSid', normalizedRecordingSid);
  const qs = params.toString();
  return qs ? `/api/coldcalling/recording-proxy?${qs}` : '/api/coldcalling/recording-proxy';
}

function buildTwilioRecordingMediaUrl(recordingSid) {
  const accountSid = normalizeString(process.env.TWILIO_ACCOUNT_SID);
  const normalizedRecordingSid = normalizeString(recordingSid);
  if (!accountSid || !normalizedRecordingSid) return null;
  return buildTwilioApiUrl(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings/${encodeURIComponent(
      normalizedRecordingSid
    )}.mp3`
  );
}

async function fetchTwilioRecordingsByCallId(callId) {
  const accountSid = normalizeString(process.env.TWILIO_ACCOUNT_SID);
  const normalizedCallId = normalizeString(callId);
  if (!accountSid || !normalizedCallId) {
    throw new Error('TWILIO_ACCOUNT_SID of callId ontbreekt.');
  }

  const endpoint =
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings.json` +
    `?CallSid=${encodeURIComponent(normalizedCallId)}&PageSize=20`;

  const { response, data } = await fetchJsonWithTimeout(
    buildTwilioApiUrl(endpoint),
    {
      method: 'GET',
      headers: {
        Authorization: getTwilioBasicAuthorizationHeader(),
        'Content-Type': 'application/json',
      },
    },
    10000
  );

  if (!response.ok) {
    const statusError = new Error(
      data?.message || data?.error || data?.detail || data?.raw || `Twilio recordings fout (${response.status})`
    );
    statusError.status = response.status;
    statusError.endpoint = endpoint;
    statusError.data = data;
    throw statusError;
  }

  const recordings = Array.isArray(data?.recordings) ? data.recordings : [];
  return { endpoint, data, recordings };
}

function extractTwilioRecordingSidFromUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const match = raw.match(/\/Recordings\/(RE[0-9a-f]{32})/i);
  return normalizeString(match?.[1] || '');
}

function extractCallIdFromRecordingUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'https://softora.local');
    return normalizeString(parsed.searchParams.get('callId') || '');
  } catch {
    const match = raw.match(/[?&]callId=([^&#]+)/i);
    if (!match) return '';
    try {
      return normalizeString(decodeURIComponent(match[1] || ''));
    } catch {
      return normalizeString(match[1] || '');
    }
  }
}

function normalizeRecordingReference(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'https://softora.local');
    const pathname = normalizeString(parsed.pathname || '');
    const callId = normalizeString(parsed.searchParams.get('callId') || '');
    const recordingSid = normalizeString(parsed.searchParams.get('recordingSid') || '');
    if (callId) return `${pathname}?callId=${callId}`;
    if (recordingSid) return `${pathname}?recordingSid=${recordingSid}`;
    return pathname || raw;
  } catch {
    return raw;
  }
}

function findCallUpdateByRecordingReference(...sources) {
  const directCallIds = [];
  const recordingSids = [];
  const recordingRefs = [];
  const phoneKeys = [];
  const timestamps = [];

  (Array.isArray(sources) ? sources : []).forEach((source) => {
    if (!source || typeof source !== 'object') return;
    const directCallId =
      normalizeString(source.callId || source.call_id || source.sourceCallId || source.source_call_id || '') ||
      extractCallIdFromRecordingUrl(
        source.recordingUrl ||
          source.recording_url ||
          source.recordingUrlProxy ||
          source.audioUrl ||
          source.audio_url ||
          ''
      );
    if (directCallId) directCallIds.push(directCallId);

    const recordingSid =
      normalizeString(source.recordingSid || source.recording_sid || '') ||
      extractTwilioRecordingSidFromUrl(
        source.recordingUrl ||
          source.recording_url ||
          source.recordingUrlProxy ||
          source.audioUrl ||
          source.audio_url ||
          ''
      );
    if (recordingSid) recordingSids.push(recordingSid);

    [
      source.recordingUrl,
      source.recording_url,
      source.recordingUrlProxy,
      source.audioUrl,
      source.audio_url,
    ].forEach((candidate) => {
      const normalizedRef = normalizeRecordingReference(candidate);
      if (normalizedRef) recordingRefs.push(normalizedRef);
    });

    const phoneKey = normalizeLeadLikePhoneKey(source.phone || source.phoneNumber || source.phone_number || '');
    if (phoneKey) phoneKeys.push(phoneKey);

    [
      source.updatedAt,
      source.createdAt,
      source.confirmationTaskCreatedAt,
      source.startedAt,
      source.endedAt,
      source.date && source.time ? `${source.date}T${source.time}:00` : source.date,
    ].forEach((candidate) => {
      const parsed = Date.parse(normalizeString(candidate || ''));
      if (Number.isFinite(parsed) && parsed > 0) timestamps.push(parsed);
    });
  });

  for (const callId of directCallIds) {
    const matched = getLatestCallUpdateByCallId(callId);
    if (matched) return matched;
  }

  const recordingSidSet = new Set(recordingSids.filter(Boolean));
  if (recordingSidSet.size > 0) {
    for (const candidate of recentCallUpdates) {
      const candidateSid =
        normalizeString(candidate?.recordingSid || candidate?.recording_sid || '') ||
        extractTwilioRecordingSidFromUrl(
          candidate?.recordingUrl || candidate?.recording_url || candidate?.recordingUrlProxy || ''
        );
      if (candidateSid && recordingSidSet.has(candidateSid)) return candidate;
    }
  }

  const recordingRefSet = new Set(recordingRefs.filter(Boolean));
  if (recordingRefSet.size > 0) {
    for (const candidate of recentCallUpdates) {
      const candidateRefs = [
        candidate?.recordingUrl,
        candidate?.recording_url,
        candidate?.recordingUrlProxy,
        candidate?.audioUrl,
        candidate?.audio_url,
      ]
        .map((value) => normalizeRecordingReference(value))
        .filter(Boolean);
      if (candidateRefs.some((ref) => recordingRefSet.has(ref))) return candidate;
    }
  }

  const phoneKeySet = new Set(phoneKeys.filter(Boolean));
  if (phoneKeySet.size === 0) return null;

  const targetTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  let best = null;
  let bestScore = -Infinity;

  for (const candidate of recentCallUpdates) {
    const candidatePhoneKey = normalizeLeadLikePhoneKey(candidate?.phone || '');
    if (!candidatePhoneKey || !phoneKeySet.has(candidatePhoneKey)) continue;

    const candidateHasRecording = Boolean(
      normalizeString(candidate?.recordingUrl || candidate?.recording_url || candidate?.recordingUrlProxy || '')
    );
    const candidateTs = getRuntimeSnapshotItemTimestampMs(candidate);
    const distancePenalty =
      targetTs > 0 && candidateTs > 0 ? Math.min(10_000_000, Math.abs(candidateTs - targetTs)) / 1000 : 3600;
    const score = (candidateHasRecording ? 100000 : 0) - distancePenalty;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function resolveAppointmentCallId(appointment) {
  const direct = normalizeString(
    appointment?.callId || appointment?.call_id || appointment?.sourceCallId || appointment?.source_call_id || ''
  );
  if (direct) return direct;

  const fromRecordingUrl = extractCallIdFromRecordingUrl(
    appointment?.recordingUrl ||
      appointment?.recording_url ||
      appointment?.recordingUrlProxy ||
      appointment?.audioUrl ||
      appointment?.audio_url ||
      ''
  );
  if (fromRecordingUrl) return fromRecordingUrl;

  const matchedUpdate = findCallUpdateByRecordingReference(appointment);
  return normalizeString(matchedUpdate?.callId || '');
}

function parseDateToIso(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Date(ms).toISOString();
}

function getTwilioStackEnvSuffixes(stack) {
  const normalized = normalizeColdcallingStack(stack);
  if (normalized === 'gemini_flash_3_1_live') return ['GEMINI_FLASH_3_1_LIVE', 'GEMINI'];
  if (normalized === 'openai_realtime_1_5') return ['OPENAI_REALTIME_1_5', 'OPENAI_REALTIME', 'OPENAI'];
  if (normalized === 'hume_evi_3') return ['HUME_EVI_3', 'HUME_EVI', 'HUME'];
  return ['RETELL_AI', 'RETELL'];
}

function getTwilioMediaWsUrlForStack(stack) {
  const suffixes = getTwilioStackEnvSuffixes(stack);
  for (const suffix of suffixes) {
    const candidate = normalizeString(process.env[`TWILIO_MEDIA_WS_URL_${suffix}`]);
    if (candidate) return candidate;
  }
  return normalizeString(process.env.TWILIO_MEDIA_WS_URL || DEFAULT_TWILIO_MEDIA_WS_URL);
}

function getTwilioFromNumberForStack(stack) {
  const suffixes = getTwilioStackEnvSuffixes(stack);
  for (const suffix of suffixes) {
    const candidate = normalizeString(process.env[`TWILIO_FROM_NUMBER_${suffix}`]);
    if (candidate) return candidate;
  }
  return normalizeString(process.env.TWILIO_FROM_NUMBER);
}

function buildTwilioOutboundTwimlUrl(stack, campaign = {}) {
  const configuredUrl = normalizeString(process.env.TWILIO_OUTBOUND_TWIML_URL || process.env.TWILIO_TWIML_URL);
  const fallbackBaseUrl = getEffectivePublicBaseUrl(null, campaign?.publicBaseUrl);
  const baseUrl = configuredUrl || (fallbackBaseUrl ? `${fallbackBaseUrl}/api/twilio/voice` : '');
  const normalizedBase = normalizeAbsoluteHttpUrl(baseUrl);
  if (!normalizedBase) {
    throw new Error('TWILIO_OUTBOUND_TWIML_URL of PUBLIC_BASE_URL ontbreekt/ongeldig voor Twilio outbound calling.');
  }
  return appendQueryParamsToUrl(normalizedBase, { stack: normalizeColdcallingStack(stack) });
}

function buildTwilioStatusCallbackUrl(stack, campaign = {}) {
  const configuredUrl = normalizeString(process.env.TWILIO_STATUS_CALLBACK_URL);
  const fallbackBaseUrl = getEffectivePublicBaseUrl(null, campaign?.publicBaseUrl);
  const baseUrl = configuredUrl || (fallbackBaseUrl ? `${fallbackBaseUrl}/api/twilio/status` : '');
  const normalizedBase = normalizeAbsoluteHttpUrl(baseUrl);
  if (!normalizedBase) {
    throw new Error('TWILIO_STATUS_CALLBACK_URL of PUBLIC_BASE_URL ontbreekt/ongeldig voor Twilio status callbacks.');
  }
  const secret = normalizeString(process.env.TWILIO_WEBHOOK_SECRET);
  return appendQueryParamsToUrl(normalizedBase, {
    stack: normalizeColdcallingStack(stack),
    ...(secret ? { secret } : {}),
  });
}

function toIsoFromUnixMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  if (numeric < 1e11) {
    return new Date(numeric * 1000).toISOString();
  }
  return new Date(numeric).toISOString();
}

function isTerminalColdcallingStatus(status, endedReason = '') {
  const combined = `${normalizeString(status).toLowerCase()} ${normalizeString(endedReason).toLowerCase()}`;
  return /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected|done|error|not_connected|dial_)/.test(
    combined
  );
}

function buildRetellPayload(lead, campaign) {
  const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);
  const effectiveProvince = normalizeString(lead.province);
  const effectiveAddress = normalizeString(lead.address);
  const overrideAgentId = normalizeString(process.env.RETELL_AGENT_ID);
  const overrideAgentVersion = parseIntSafe(process.env.RETELL_AGENT_VERSION, 0);

  return {
    from_number: normalizeString(process.env.RETELL_FROM_NUMBER),
    to_number: normalizedPhone,
    ...(overrideAgentId ? { override_agent_id: overrideAgentId } : {}),
    ...(overrideAgentVersion > 0 ? { override_agent_version: overrideAgentVersion } : {}),
    retell_llm_dynamic_variables: buildVariableValues(
      {
        ...lead,
        phone: normalizedPhone,
      },
      campaign
    ),
    metadata: {
      source: 'softora-coldcalling-dashboard',
      leadCompany: normalizeString(lead.company),
      leadName: normalizeString(lead.name),
      leadBranche: normalizeString(lead.branche || lead.branch || lead.sector || ''),
      leadPhoneE164: normalizedPhone,
      leadRegion: effectiveRegion,
      leadProvince: effectiveProvince,
      leadAddress: effectiveAddress,
      sector: normalizeString(campaign.sector),
      region: effectiveRegion,
    },
  };
}

function buildTwilioOutboundPayload(lead, campaign) {
  const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
  const stack = normalizeColdcallingStack(campaign?.coldcallingStack);
  const twimlUrl = buildTwilioOutboundTwimlUrl(stack, campaign);
  const statusCallbackUrl = buildTwilioStatusCallbackUrl(stack, campaign);
  const fromNumber = getTwilioFromNumberForStack(stack);
  if (!fromNumber) {
    throw new Error('TWILIO_FROM_NUMBER ontbreekt voor geselecteerde stack.');
  }

  return {
    To: normalizedPhone,
    From: fromNumber,
    Url: twimlUrl,
    Method: 'POST',
    StatusCallback: statusCallbackUrl,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    Record: 'true',
    RecordingChannels: 'dual',
    RecordingStatusCallback: statusCallbackUrl,
    RecordingStatusCallbackMethod: 'POST',
    RecordingStatusCallbackEvent: ['in-progress', 'completed', 'absent'],
    Timeout: String(Math.max(15, Math.min(90, parseIntSafe(process.env.TWILIO_DIAL_TIMEOUT_SECONDS, 30)))),
  };
}

async function processRetellColdcallingLead(lead, campaign, index) {
  try {
    const payload = buildRetellPayload(lead, campaign);
    const normalizedPhone = payload.to_number;
    const { endpoint, data } = await createRetellOutboundCall(payload);
    const callId = normalizeString(data?.call_id || data?.callId || data?.id);
    const callStatus = normalizeString(data?.call_status || data?.status || 'registered');
    let latestUpdate = null;

    if (callId) {
      latestUpdate = upsertRecentCallUpdate({
        callId,
        phone: normalizedPhone,
        company: normalizeString(lead.company),
        branche: normalizeString(lead.branche || lead.branch || lead.sector || campaign.sector || ''),
        region: normalizeString(lead.region || campaign.region || ''),
        province: normalizeString(lead.province || ''),
        address: normalizeString(lead.address || ''),
        name: normalizeString(lead.name),
        status: callStatus,
        messageType: 'coldcalling.start.response',
        summary: '',
        transcriptSnippet: '',
        endedReason: '',
        startedAt: toIsoFromUnixMilliseconds(data?.start_timestamp) || new Date().toISOString(),
        endedAt: '',
        durationSeconds: null,
        recordingUrl: '',
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        provider: 'retell',
        direction: 'outbound',
      });

      // Bij sommige providerfouten (zoals dial_failed) wordt de call vrijwel direct terminal.
      // Een korte status-refresh voorkomt dat de UI vals "gestart" meldt.
      if (/^(registered|queued|initiated|dialing)$/i.test(callStatus)) {
        await sleep(1200);
        const refreshed = await refreshCallUpdateFromRetellStatusApi(callId);
        if (refreshed) {
          latestUpdate = refreshed;
        }
      }

      await waitForQueuedRuntimeStatePersist();
    }

    const effectiveStatus = normalizeString(latestUpdate?.status || callStatus).toLowerCase();
    const effectiveEndedReason = normalizeString(latestUpdate?.endedReason || '');
    const effectiveStartedAt = normalizeString(
      latestUpdate?.startedAt || toIsoFromUnixMilliseconds(data?.start_timestamp) || new Date().toISOString()
    );

    if (
      effectiveStatus === 'not_connected' ||
      /dial_failed|dial-failed|dial failed/.test(effectiveEndedReason.toLowerCase())
    ) {
      return {
        index,
        success: false,
        lead: {
          name: normalizeString(lead.name),
          company: normalizeString(lead.company),
          phone: normalizeString(lead.phone),
          region: normalizeString(lead.region),
          phoneE164: normalizedPhone,
        },
        error: `Call kon niet verbinden (${effectiveEndedReason || effectiveStatus || 'onbekende reden'}).`,
        statusCode: null,
        cause: 'dial failed',
        causeExplanation:
          'Retell kon het gesprek niet opzetten. Controleer outbound nummer/SIP-auth configuratie in Retell.',
        details: {
          endpoint,
          callId,
          status: effectiveStatus,
          endedReason: effectiveEndedReason,
          startedAt: effectiveStartedAt,
        },
      };
    }

    return {
      index,
      success: true,
      lead: {
        name: normalizeString(lead.name),
        company: normalizeString(lead.company),
        phone: normalizeString(lead.phone),
        region: normalizeString(lead.region),
        phoneE164: normalizedPhone,
      },
      call: {
        endpoint,
        callId,
        status: effectiveStatus || callStatus,
        endedReason: effectiveEndedReason,
      },
    };
  } catch (error) {
    const failure = classifyRetellFailure(error);
    console.error(
      '[Coldcalling][Lead Error]',
      JSON.stringify(
        {
          provider: 'retell',
          lead: {
            name: normalizeString(lead?.name),
            company: normalizeString(lead?.company),
            phone: normalizeString(lead?.phone),
          },
          error: error.message || 'Onbekende fout',
          statusCode: error.status || null,
          cause: failure.cause,
          explanation: failure.explanation,
          responseBody: error.data || null,
        },
        null,
        2
      )
    );

    return {
      index,
      success: false,
      lead: {
        name: normalizeString(lead?.name),
        company: normalizeString(lead?.company),
        phone: normalizeString(lead?.phone),
        region: normalizeString(lead?.region),
      },
      error: error.message || 'Onbekende fout',
      statusCode: error.status || null,
      cause: failure.cause,
      causeExplanation: failure.explanation,
      details: error.data || null,
    };
  }
}

async function processTwilioColdcallingLead(lead, campaign, index) {
  try {
    const payload = buildTwilioOutboundPayload(lead, campaign);
    const normalizedPhone = normalizeString(payload.To);
    const { endpoint, data } = await createTwilioOutboundCall(payload);
    const callId = normalizeString(data?.sid || data?.call_sid || data?.callSid || '');
    const callStatus = normalizeString(data?.status || 'queued').toLowerCase();
    const startedAt =
      parseDateToIso(data?.start_time || data?.date_created) || new Date().toISOString();
    let latestUpdate = null;

    if (callId) {
      latestUpdate = upsertRecentCallUpdate({
        callId,
        phone: normalizedPhone,
        company: normalizeString(lead.company),
        branche: normalizeString(lead.branche || lead.branch || lead.sector || campaign.sector || ''),
        region: normalizeString(lead.region || campaign.region || ''),
        province: normalizeString(lead.province || ''),
        address: normalizeString(lead.address || ''),
        name: normalizeString(lead.name),
        status: callStatus,
        messageType: 'twilio.start.response',
        summary: '',
        transcriptSnippet: '',
        endedReason: '',
        startedAt,
        endedAt: '',
        durationSeconds: null,
        recordingUrl: '',
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        provider: 'twilio',
        direction: 'outbound',
      });

      await waitForQueuedRuntimeStatePersist();
    }

    const effectiveStatus = normalizeString(latestUpdate?.status || callStatus).toLowerCase();
    const effectiveEndedReason = normalizeString(latestUpdate?.endedReason || '');
    const terminalFailureStatuses = new Set(['failed', 'busy', 'no-answer', 'canceled', 'cancelled']);

    if (terminalFailureStatuses.has(effectiveStatus)) {
      return {
        index,
        success: false,
        lead: {
          name: normalizeString(lead.name),
          company: normalizeString(lead.company),
          phone: normalizeString(lead.phone),
          region: normalizeString(lead.region),
          phoneE164: normalizedPhone,
        },
        error: `Call kon niet verbinden (${effectiveEndedReason || effectiveStatus || 'onbekende reden'}).`,
        statusCode: null,
        cause: 'dial failed',
        causeExplanation: 'Twilio kon het gesprek niet opzetten. Controleer nummer/call config in Twilio.',
        details: {
          endpoint,
          callId,
          status: effectiveStatus,
          endedReason: effectiveEndedReason,
          startedAt,
        },
      };
    }

    return {
      index,
      success: true,
      lead: {
        name: normalizeString(lead.name),
        company: normalizeString(lead.company),
        phone: normalizeString(lead.phone),
        region: normalizeString(lead.region),
        phoneE164: normalizedPhone,
      },
      call: {
        endpoint,
        callId,
        status: effectiveStatus || callStatus,
        endedReason: effectiveEndedReason,
      },
    };
  } catch (error) {
    const failure = classifyTwilioFailure(error);
    console.error(
      '[Coldcalling][Lead Error]',
      JSON.stringify(
        {
          provider: 'twilio',
          lead: {
            name: normalizeString(lead?.name),
            company: normalizeString(lead?.company),
            phone: normalizeString(lead?.phone),
          },
          error: error.message || 'Onbekende fout',
          statusCode: error.status || null,
          cause: failure.cause,
          explanation: failure.explanation,
          responseBody: error.data || null,
        },
        null,
        2
      )
    );

    return {
      index,
      success: false,
      lead: {
        name: normalizeString(lead?.name),
        company: normalizeString(lead?.company),
        phone: normalizeString(lead?.phone),
        region: normalizeString(lead?.region),
      },
      error: error.message || 'Onbekende fout',
      statusCode: error.status || null,
      cause: failure.cause,
      causeExplanation: failure.explanation,
      details: error.data || null,
    };
  }
}

async function processColdcallingLead(lead, campaign, index) {
  const provider = resolveColdcallingProviderForCampaign(campaign);
  if (provider === 'twilio') {
    return processTwilioColdcallingLead(lead, campaign, index);
  }
  return processRetellColdcallingLead(lead, campaign, index);
}

function validateStartPayload(body) {
  const campaign = body?.campaign ?? {};
  const leads = Array.isArray(body?.leads) ? body.leads : null;

  if (!leads) {
    return { error: 'Body moet een "leads" array bevatten.' };
  }

  if (leads.length === 0) {
    return { error: 'Leads array is leeg.' };
  }

  const dispatchModeRaw = normalizeString(campaign.dispatchMode).toLowerCase();
  const dispatchMode = ['parallel', 'sequential', 'delay'].includes(dispatchModeRaw)
    ? dispatchModeRaw
    : 'sequential';
  const dispatchDelaySecondsInput = parseNumberSafe(campaign.dispatchDelaySeconds, 0);
  const dispatchDelaySeconds = Number.isFinite(dispatchDelaySecondsInput)
    ? Math.max(0, Math.min(3600, dispatchDelaySecondsInput))
    : 0;

  const normalizedCampaign = {
    amount: Math.max(1, parseIntSafe(campaign.amount, leads.length)),
    sector: normalizeString(campaign.sector),
    region: normalizeString(campaign.region),
    minProjectValue: parseNumberSafe(campaign.minProjectValue, null),
    maxDiscountPct: parseNumberSafe(campaign.maxDiscountPct, null),
    extraInstructions: normalizeString(campaign.extraInstructions),
    dispatchMode,
    dispatchDelaySeconds,
    coldcallingStack: normalizeColdcallingStack(
      campaign.coldcallingStack || campaign.callingEngine || campaign.callingStack
    ),
  };
  normalizedCampaign.coldcallingStackLabel = getColdcallingStackLabel(normalizedCampaign.coldcallingStack);

  return {
    campaign: normalizedCampaign,
    leads,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function phoneDispatchKey(value) {
  return String(value || '').replace(/\D/g, '');
}

function isCallUpdateTerminalForSequentialDispatch(callUpdate) {
  if (!callUpdate) return false;

  const messageType = normalizeString(callUpdate.messageType).toLowerCase();
  const status = normalizeString(callUpdate.status).toLowerCase();
  const endedReason = normalizeString(callUpdate.endedReason).toLowerCase();

  if (endedReason) return true;
  if (messageType.includes('call.ended') || messageType.includes('end-of-call')) return true;

  if (
    /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected|error|not_connected|dial_)/.test(
      status
    )
  ) {
    return true;
  }

  return false;
}

function createSequentialDispatchQueue(campaign, leads) {
  const id = `seq-${nextSequentialDispatchQueueId++}`;
  const queue = {
    id,
    createdAt: new Date().toISOString(),
    campaign: { ...campaign },
    leads: Array.isArray(leads) ? leads.slice() : [],
    nextLeadIndex: 0,
    waitingForCallId: null,
    waitingForPhoneKey: null,
    isAdvancing: false,
    completed: false,
    results: [],
  };
  sequentialDispatchQueues.set(id, queue);
  return queue;
}

function finalizeSequentialDispatchQueueIfDone(queue) {
  if (!queue) return;
  if (queue.completed) return;
  if (queue.waitingForCallId || queue.waitingForPhoneKey) return;
  if (queue.nextLeadIndex < queue.leads.length) return;

  queue.completed = true;
  console.log(
    `[Coldcalling][Sequential Queue] Voltooid ${queue.id}: ${queue.results.filter((r) => r.success).length}/${
      queue.results.length
    } gestart`
  );

  // Opruimen na korte tijd zodat debugging nog even mogelijk blijft.
  const queueId = queue.id;
  setTimeout(() => {
    const current = sequentialDispatchQueues.get(queueId);
    if (!current || !current.completed) return;
    if (current.waitingForCallId) {
      sequentialDispatchQueueIdByCallId.delete(current.waitingForCallId);
    }
    sequentialDispatchQueues.delete(queueId);
  }, 10 * 60 * 1000);
}

async function advanceSequentialDispatchQueue(queueId, reason = 'unknown') {
  const queue = sequentialDispatchQueues.get(queueId);
  if (!queue || queue.completed) return queue || null;
  if (queue.isAdvancing) return queue;
  if (queue.waitingForCallId || queue.waitingForPhoneKey) return queue;

  queue.isAdvancing = true;
  try {
    console.log(
      `[Coldcalling][Sequential Queue] Advance ${queue.id} (reason=${reason}) idx=${queue.nextLeadIndex}/${queue.leads.length}`
    );

    while (
      !queue.completed &&
      !queue.waitingForCallId &&
      !queue.waitingForPhoneKey &&
      queue.nextLeadIndex < queue.leads.length
    ) {
      const index = queue.nextLeadIndex;
      const lead = queue.leads[index];
      queue.nextLeadIndex += 1;

      const result = await processColdcallingLead(lead, queue.campaign, index);
      queue.results.push(result);

      const callId = normalizeString(result?.call?.callId);
      const phoneKey = phoneDispatchKey(result?.lead?.phoneE164 || result?.lead?.phone);
      if (result.success && callId) {
        queue.waitingForCallId = callId;
        queue.waitingForPhoneKey = phoneKey || null;
        sequentialDispatchQueueIdByCallId.set(callId, queue.id);
        console.log(
          `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde (${callId}) voor lead ${index + 1}/${
            queue.leads.length
          }`
        );
        break;
      }

      if (result.success && phoneKey) {
        queue.waitingForPhoneKey = phoneKey;
        console.log(
          `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde via telefoon (${phoneKey}) voor lead ${
            index + 1
          }/${queue.leads.length} (geen callId ontvangen)`
        );
        break;
      }

      console.log(
        `[Coldcalling][Sequential Queue] ${queue.id} lead ${index + 1}/${queue.leads.length} ${
          result.success ? 'gestart (zonder callId)' : 'mislukt'
        }, ga door`
      );
    }

    finalizeSequentialDispatchQueueIfDone(queue);
    return queue;
  } finally {
    queue.isAdvancing = false;
  }
}

function handleSequentialDispatchQueueWebhookProgress(callUpdate) {
  if (!callUpdate || !isCallUpdateTerminalForSequentialDispatch(callUpdate)) return;

  const callId = normalizeString(callUpdate.callId);
  const webhookPhoneKey = phoneDispatchKey(callUpdate.phone);

  let queueId = callId ? sequentialDispatchQueueIdByCallId.get(callId) : null;
  let queue = queueId ? sequentialDispatchQueues.get(queueId) : null;

  if (!queue && callId) {
    sequentialDispatchQueueIdByCallId.delete(callId);
  }

  if (!queue && webhookPhoneKey) {
    for (const candidate of sequentialDispatchQueues.values()) {
      if (candidate.completed) continue;
      // Gebruik telefoon-fallback alleen als de webhook zelf geen callId heeft.
      // Als de webhook wel een callId heeft, willen we geen false positive match op telefoon.
      if (candidate.waitingForCallId && callId) continue;
      if (candidate.waitingForPhoneKey && candidate.waitingForPhoneKey === webhookPhoneKey) {
        queue = candidate;
        queueId = candidate.id;
        break;
      }
    }
  }

  if (!queue || !queueId) return;

  const matchesCallId = Boolean(callId && queue.waitingForCallId && queue.waitingForCallId === callId);
  const matchesPhone = Boolean(
    (!callId || !queue.waitingForCallId) &&
      webhookPhoneKey &&
      queue.waitingForPhoneKey &&
      queue.waitingForPhoneKey === webhookPhoneKey
  );
  if (!matchesCallId && !matchesPhone) return;

  if (queue.waitingForCallId) {
    sequentialDispatchQueueIdByCallId.delete(queue.waitingForCallId);
  }
  queue.waitingForCallId = null;
  queue.waitingForPhoneKey = null;

  console.log(
    `[Coldcalling][Sequential Queue] Call beëindigd (${callId || webhookPhoneKey}), volgende lead starten voor queue ${queueId}`
  );

  void advanceSequentialDispatchQueue(queueId, 'webhook-ended').catch((error) => {
    console.error(
      '[Coldcalling][Sequential Queue Error]',
      JSON.stringify(
        {
          queueId,
          callId: callId || null,
          message: error?.message || 'Onbekende fout',
        },
        null,
        2
      )
    );
  });
}

function triggerPostCallAutomation(callUpdate) {
  if (!callUpdate) return;

  handleSequentialDispatchQueueWebhookProgress(callUpdate);
  ensureRuleBasedInsightAndAppointment(callUpdate);

  void maybeAnalyzeCallUpdateWithAi(callUpdate).catch((error) => {
    console.error(
      '[AI Call Insight Error]',
      JSON.stringify(
        {
          callId: callUpdate.callId,
          message: error?.message || 'Onbekende fout',
          status: error?.status || null,
          data: error?.data || null,
        },
        null,
        2
      )
    );
  });
}

function isWebhookAuthorized(req) {
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    return true;
  }

  const headerCandidates = [req.get('x-retell-signature'), req.get('authorization')].filter(Boolean);

  for (const candidate of headerCandidates) {
    if (candidate === secret) return true;
    if (candidate.toLowerCase().startsWith('bearer ') && candidate.slice(7).trim() === secret) {
      return true;
    }
  }

  return false;
}

function parseRetellSignatureHeader(signatureHeader) {
  const raw = normalizeString(signatureHeader);
  if (!raw) return null;
  const match = raw.match(/v=(\d+),d=([a-fA-F0-9]+)/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  const digest = normalizeString(match[2]).toLowerCase();
  if (!Number.isFinite(timestamp) || !digest) return null;
  return { timestamp, digest };
}

function verifyRetellWebhookSignature(req, maxSkewMs = 5 * 60 * 1000) {
  const apiKey = normalizeString(process.env.RETELL_API_KEY);
  const signatureHeader = normalizeString(req.get('x-retell-signature'));
  if (!apiKey || !signatureHeader) return false;

  const parsed = parseRetellSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const now = Date.now();
  if (Math.abs(now - parsed.timestamp) > maxSkewMs) {
    return false;
  }

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : normalizeString(req.rawBody) || JSON.stringify(req.body || {});
  const expectedDigest = crypto
    .createHmac('sha256', apiKey)
    .update(`${rawBody}${parsed.timestamp}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedDigest, 'hex');
  const incomingBuffer = Buffer.from(parsed.digest, 'hex');
  if (expectedBuffer.length !== incomingBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
}

function isRetellWebhookAuthorized(req) {
  const hasSecret = Boolean(normalizeString(process.env.WEBHOOK_SECRET));
  const secretAuthorized = isWebhookAuthorized(req);
  const hasRetellSignature = Boolean(normalizeString(req.get('x-retell-signature')));
  const signatureAuthorized = hasRetellSignature ? verifyRetellWebhookSignature(req) : false;

  if (hasSecret) {
    return secretAuthorized || signatureAuthorized;
  }

  if (hasRetellSignature) {
    return signatureAuthorized;
  }

  return true;
}

async function sendColdcallingStatusResponse(res, callId) {
  const cached = callUpdatesById.get(callId) || null;
  const provider = normalizeString(cached?.provider || inferCallProvider(callId, getColdcallingProvider())).toLowerCase();

  const sendCached = (providerName) =>
    res.status(200).json({
      ok: true,
      source: 'cache',
      provider: providerName,
      callId: normalizeString(cached?.callId || callId),
      status: normalizeString(cached?.status || ''),
      endedReason: normalizeString(cached?.endedReason || ''),
      startedAt: normalizeString(cached?.startedAt || ''),
      endedAt: normalizeString(cached?.endedAt || ''),
      durationSeconds: parseNumberSafe(cached?.durationSeconds, null),
      recordingUrl: normalizeString(cached?.recordingUrl || ''),
    });

  if (provider === 'twilio') {
    if (!isTwilioStatusApiConfigured()) {
      if (cached) return sendCached('twilio');
      return res.status(500).json({ ok: false, error: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ontbreken op server.' });
    }

    try {
      const { endpoint, data } = await fetchTwilioCallStatusById(callId);
      const update = extractCallUpdateFromTwilioCallStatusResponse(callId, data, {
        stack: cached?.stack || '',
      });
      if (update) {
        upsertRecentCallUpdate(update);
        triggerPostCallAutomation(update);
        await waitForQueuedRuntimeStatePersist();
      }

      return res.status(200).json({
        ok: true,
        endpoint,
        source: 'twilio',
        provider: 'twilio',
        callId: normalizeString(update?.callId || data?.sid || callId),
        status: normalizeString(update?.status || data?.status || ''),
        endedReason: normalizeString(update?.endedReason || ''),
        startedAt: normalizeString(update?.startedAt || parseDateToIso(data?.start_time || data?.date_created)),
        endedAt: normalizeString(update?.endedAt || parseDateToIso(data?.end_time)),
        durationSeconds: parseNumberSafe(update?.durationSeconds || data?.duration, null),
        recordingUrl: normalizeString(update?.recordingUrl || data?.recording_url || ''),
      });
    } catch (error) {
      return res.status(Number(error?.status || 500)).json({
        ok: false,
        error: error?.message || 'Kon Twilio call status niet ophalen.',
        endpoint: error?.endpoint || null,
        details: error?.data || null,
      });
    }
  }

  if (!normalizeString(process.env.RETELL_API_KEY)) {
    if (cached) return sendCached('retell');
    return res.status(500).json({ ok: false, error: 'RETELL_API_KEY ontbreekt op server.' });
  }

  try {
    const { endpoint, data } = await fetchRetellCallStatusById(callId);
    const update = extractCallUpdateFromRetellCallStatusResponse(callId, data);
    if (update) {
      upsertRecentCallUpdate(update);
      triggerPostCallAutomation(update);
      await waitForQueuedRuntimeStatePersist();
    }

    return res.status(200).json({
      ok: true,
      endpoint,
      source: 'retell',
      provider: 'retell',
      callId: normalizeString(update?.callId || data?.call_id || callId),
      status: normalizeString(update?.status || data?.call_status || ''),
      endedReason: normalizeString(update?.endedReason || data?.disconnection_reason || ''),
      startedAt: normalizeString(update?.startedAt || toIsoFromUnixMilliseconds(data?.start_timestamp)),
      endedAt: normalizeString(update?.endedAt || toIsoFromUnixMilliseconds(data?.end_timestamp)),
      durationSeconds:
        parseNumberSafe(update?.durationSeconds, null) ||
        (Number.isFinite(Number(data?.duration_ms)) && Number(data.duration_ms) > 0
          ? Math.max(1, Math.round(Number(data.duration_ms) / 1000))
          : null),
      recordingUrl: normalizeString(
        update?.recordingUrl || data?.recording_url || data?.recording_multi_channel_url || data?.scrubbed_recording_url || ''
      ),
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: error?.message || 'Kon Retell call status niet ophalen.',
      endpoint: error?.endpoint || null,
      details: error?.data || null,
    });
  }
}

function buildTwilioAllowedCallerSet() {
  const raw = normalizeString(process.env.TWILIO_ALLOWED_CALLERS || '');
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\n]/)
      .map((item) => normalizePhoneForTwilioMatch(item))
      .filter(Boolean)
  );
}

function normalizePhoneForTwilioMatch(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `31${digits.slice(1)}`;
  return digits;
}

function isTwilioInboundCallerAllowed(rawCaller) {
  const allowed = buildTwilioAllowedCallerSet();
  if (allowed.size === 0) return true;
  const normalizedCaller = normalizePhoneForTwilioMatch(rawCaller);
  if (!normalizedCaller) return false;
  return allowed.has(normalizedCaller);
}

function sendTwimlXml(res, xml) {
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(xml);
}

function mapTwilioInboundDigitToStack(digitValue) {
  const digit = normalizeString(digitValue);
  if (digit === '1') return 'retell_ai';
  if (digit === '2') return 'gemini_flash_3_1_live';
  return '';
}

function buildTwilioInboundSelectionActionUrl(req) {
  const base = getEffectivePublicBaseUrl(req);
  const candidate = base ? `${base}/api/twilio/voice` : '';
  return normalizeAbsoluteHttpUrl(candidate) || '/api/twilio/voice';
}

function buildAbsoluteRequestUrl(req) {
  const originalUrl = normalizeString(req?.originalUrl || req?.url || req?.path || '');
  const publicBaseUrl = normalizeAbsoluteHttpUrl(getEffectivePublicBaseUrl(req));
  if (publicBaseUrl) {
    try {
      return new URL(originalUrl || '/', publicBaseUrl).toString();
    } catch {
      return `${publicBaseUrl.replace(/\/+$/, '')}${originalUrl || '/'}`;
    }
  }

  const protocol = isSecureHttpRequest(req) ? 'https' : 'http';
  const host = normalizeString(req?.get?.('host') || '');
  if (!host) return originalUrl || '/';
  return `${protocol}://${host}${originalUrl || '/'}`;
}

function isTwilioSignatureValid(req) {
  const twilioAuthToken = normalizeString(process.env.TWILIO_AUTH_TOKEN);
  const signatureHeader = normalizeString(req.get('x-twilio-signature'));
  if (!twilioAuthToken || !signatureHeader) return false;

  const absoluteUrl = buildAbsoluteRequestUrl(req);
  const params =
    req && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const sortedKeys = Object.keys(params).sort();
  const signaturePayload = sortedKeys.reduce((accumulator, key) => {
    const rawValue = params[key];
    if (Array.isArray(rawValue)) {
      return accumulator + rawValue.map((item) => `${key}${String(item ?? '')}`).join('');
    }
    return accumulator + key + String(rawValue ?? '');
  }, absoluteUrl);

  const expectedSignature = crypto
    .createHmac('sha1', twilioAuthToken)
    .update(signaturePayload, 'utf8')
    .digest('base64');

  return timingSafeEqualStrings(signatureHeader, expectedSignature);
}

function isTwilioWebhookAuthorized(req) {
  if (isTwilioSignatureValid(req)) return true;

  const secret = normalizeString(process.env.TWILIO_WEBHOOK_SECRET);
  if (!secret) return false;

  const headerSecret = normalizeString(req.get('x-webhook-secret'));
  const querySecret = normalizeString(req.query?.secret || req.body?.secret || '');
  const authorizationHeader = normalizeString(req.get('authorization'));
  const bearerSecret = /^bearer\s+/i.test(authorizationHeader)
    ? normalizeString(authorizationHeader.replace(/^bearer\s+/i, ''))
    : '';
  return secret === headerSecret || secret === querySecret || secret === bearerSecret;
}

function handleTwilioInboundVoice(req, res) {
  if (!isTwilioWebhookAuthorized(req)) {
    appendSecurityAuditEvent(
      {
        type: 'twilio_webhook_rejected',
        severity: 'warning',
        success: false,
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: req.get('user-agent'),
        detail: 'Twilio inbound voice webhook geweigerd door signature/secret check.',
      },
      'security_twilio_webhook_rejected'
    );
    return sendTwimlXml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="nl-NL" voice="alice">Verzoek niet toegestaan.</Say>
  <Hangup />
</Response>`
    );
  }

  const caller = normalizeString(req.body?.From || req.query?.From || '');
  const rawStack = normalizeString(req.query?.stack || req.body?.stack || '');
  const explicitStack = rawStack ? normalizeColdcallingStack(rawStack) : '';
  const rawDigits = normalizeString(req.body?.Digits || req.query?.Digits || '');
  const stackFromDigit = mapTwilioInboundDigitToStack(rawDigits);
  const stack = normalizeColdcallingStack(explicitStack || stackFromDigit || 'retell_ai');
  const callSid = normalizeString(req.body?.CallSid || req.query?.CallSid || '');
  const to = normalizeString(req.body?.To || req.query?.To || '');
  const from = normalizeString(req.body?.From || req.query?.From || '');

  if (!isTwilioInboundCallerAllowed(caller)) {
    return sendTwimlXml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Reject reason="rejected" />
</Response>`
    );
  }

  if (!explicitStack) {
    if (!rawDigits) {
      const actionUrl = buildTwilioInboundSelectionActionUrl(req);
      return sendTwimlXml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="7" action="${escapeHtml(actionUrl)}" method="POST">
    <Say language="nl-NL" voice="alice">Maak een keuze. Toets 1 voor Retell A I. Toets 2 voor Gemini 3 punt 1 Live.</Say>
  </Gather>
  <Say language="nl-NL" voice="alice">Geen keuze ontvangen. Het gesprek wordt nu beeindigd.</Say>
  <Hangup />
</Response>`
      );
    }

    if (!stackFromDigit) {
      return sendTwimlXml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="nl-NL" voice="alice">Ongeldige keuze. Het gesprek wordt nu beeindigd.</Say>
  <Hangup />
</Response>`
      );
    }
  }

  const mediaWsBaseUrl = getTwilioMediaWsUrlForStack(stack);
  const mediaWsUrl = appendQueryParamsToUrl(mediaWsBaseUrl, {
    stack,
    callSid,
    to,
    from,
  });
  const inboundStartedAt = new Date().toISOString();
  if (callSid) {
    upsertRecentCallUpdate({
      callId: callSid,
      phone: caller || from,
      company: normalizeString(req.body?.CallerName || req.query?.CallerName || caller || ''),
      name: normalizeString(req.body?.CallerName || req.query?.CallerName || ''),
      status: 'in_progress',
      messageType: 'twilio.inbound.selected',
      summary: `Inkomende call gestart via ${getColdcallingStackLabel(stack)}.`,
      transcriptSnippet: '',
      transcriptFull: '',
      endedReason: '',
      startedAt: inboundStartedAt,
      endedAt: '',
      durationSeconds: null,
      recordingUrl: '',
      updatedAt: inboundStartedAt,
      updatedAtMs: Date.now(),
      provider: 'twilio',
      direction: 'inbound',
      stack,
      stackLabel: getColdcallingStackLabel(stack),
    });
  }

  if (!/^wss?:\/\//i.test(mediaWsUrl)) {
    console.error(
      '[Twilio Voice] Ongeldige media WS URL',
      JSON.stringify({ stack, value: mediaWsBaseUrl || null }, null, 2)
    );
    return sendTwimlXml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="nl-NL" voice="alice">De provider is tijdelijk niet beschikbaar. Probeer het later opnieuw.</Say>
  <Hangup />
</Response>`
    );
  }

  let streamStatusCallbackUrl = '';
  try {
    streamStatusCallbackUrl = buildTwilioStatusCallbackUrl(stack, {
      publicBaseUrl: getEffectivePublicBaseUrl(req),
    });
  } catch (_) {
    streamStatusCallbackUrl = '';
  }
  const streamStatusAttributes = streamStatusCallbackUrl
    ? ` statusCallback="${escapeHtml(streamStatusCallbackUrl)}" statusCallbackMethod="POST"`
    : '';

  return sendTwimlXml(
    res,
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeHtml(mediaWsUrl)}"${streamStatusAttributes} />
  </Connect>
</Response>`
  );
}

async function handleTwilioStatusWebhook(req, res) {
  if (!isTwilioWebhookAuthorized(req)) {
    appendSecurityAuditEvent(
      {
        type: 'twilio_webhook_rejected',
        severity: 'warning',
        success: false,
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: req.get('user-agent'),
        detail: 'Twilio status webhook geweigerd door signature/secret check.',
      },
      'security_twilio_webhook_rejected'
    );
    return res.status(401).json({ ok: false, error: 'Twilio webhook signature/secret ongeldig.' });
  }

  const stack = normalizeColdcallingStack(req.query?.stack || req.body?.stack || 'retell_ai');
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const callUpdate = upsertRecentCallUpdate(extractCallUpdateFromTwilioPayload(payload, { stack }));

  recentWebhookEvents.unshift({
    receivedAt: new Date().toISOString(),
    messageType: `twilio.${normalizeString(payload?.CallStatus || 'status').toLowerCase() || 'status'}`,
    callId: normalizeString(payload?.CallSid || ''),
    callStatus: normalizeString(payload?.CallStatus || ''),
    payload,
  });
  if (recentWebhookEvents.length > 200) {
    recentWebhookEvents.pop();
  }

  if (callUpdate) {
    triggerPostCallAutomation(callUpdate);
  }

  await waitForQueuedRuntimeStatePersist();

  return res.status(200).json({ ok: true });
}

app.get('/api/twilio/voice', handleTwilioInboundVoice);
app.post('/api/twilio/voice', express.urlencoded({ extended: false }), handleTwilioInboundVoice);
app.post('/api/twilio/status', express.urlencoded({ extended: false }), handleTwilioStatusWebhook);

const premiumAuthRouteCoordinator = createPremiumAuthRouteCoordinator({
  sessionSecret: PREMIUM_SESSION_SECRET,
  premiumSessionTtlHours: PREMIUM_SESSION_TTL_HOURS,
  premiumSessionRememberTtlDays: PREMIUM_SESSION_REMEMBER_TTL_DAYS,
  premiumUsersStore,
  normalizePremiumSessionEmail,
  normalizeString,
  isPremiumMfaConfigured,
  isPremiumMfaCodeValid,
  getSafePremiumRedirectPath,
  getResolvedPremiumAuthState,
  buildPremiumAuthSessionPayload,
  isPremiumAdminIpAllowed,
  createPremiumSessionToken,
  setPremiumSessionCookie,
  clearPremiumSessionCookie,
  appendSecurityAuditEvent,
  getClientIpFromRequest,
  getRequestPathname,
  getRequestOriginFromHeaders,
});

registerPremiumAuthRoutes(app, {
  coordinator: premiumAuthRouteCoordinator,
  premiumLoginRateLimiter,
});

app.use('/api', requirePremiumApiAccess);

const premiumUserManagementCoordinator = createPremiumUserManagementCoordinator({
  premiumUsersStore,
  buildPremiumAuthSessionPayload,
  normalizeString,
  truncateText,
  appendSecurityAuditEvent,
  getClientIpFromRequest,
  getRequestPathname,
  getRequestOriginFromHeaders,
});

registerPremiumUserManagementRoutes(app, {
  coordinator: premiumUserManagementCoordinator,
  requirePremiumAdminApiAccess,
});


app.post('/api/coldcalling/start', async (req, res) => {
  const validated = validateStartPayload(req.body);
  if (validated.error) {
    return res.status(400).json({ ok: false, error: validated.error });
  }

  const { campaign, leads } = validated;
  campaign.publicBaseUrl = getEffectivePublicBaseUrl(req);
  const provider = resolveColdcallingProviderForCampaign(campaign);
  const missingEnv = getMissingEnvVars(provider);

  if (missingEnv.length > 0) {
    const providerLabel = provider === 'twilio' ? 'Twilio' : 'Retell';
    return res.status(500).json({
      ok: false,
      error: `Server mist vereiste environment variables voor ${providerLabel} outbound calling.`,
      missingEnv,
      provider,
    });
  }

  const leadsToProcess = leads.slice(0, Math.min(campaign.amount, leads.length));

  console.log(
    `[Coldcalling] Start campagne ontvangen via ${provider} (stack=${campaign.coldcallingStack}): ${leadsToProcess.length}/${leads.length} leads, sector="${campaign.sector}", regio="${campaign.region}", mode="${campaign.dispatchMode}", delay=${campaign.dispatchDelaySeconds}s`
  );

  let results = [];

  if (campaign.dispatchMode === 'parallel') {
    results = await Promise.all(
      leadsToProcess.map((lead, index) => processColdcallingLead(lead, campaign, index))
    );
  } else if (campaign.dispatchMode === 'sequential' && leadsToProcess.length > 1) {
    const queue = createSequentialDispatchQueue(campaign, leadsToProcess);
    await advanceSequentialDispatchQueue(queue.id, 'start-request');
    results = queue.results.slice();

    const startedNow = results.filter((item) => item.success).length;
    const failedNow = results.length - startedNow;
    const queuedRemaining = Math.max(0, queue.leads.length - queue.results.length);

    console.log(
      `[Coldcalling][Sequential Queue] ${queue.id} gestart: direct ${results.length}/${queue.leads.length} verwerkt, ${queuedRemaining} wachtend`
    );

    await waitForQueuedRuntimeStatePersist();

    return res.status(200).json({
      ok: true,
      summary: {
        requested: leads.length,
        attempted: leadsToProcess.length,
        started: startedNow,
        failed: failedNow,
        provider,
        coldcallingStack: campaign.coldcallingStack,
        coldcallingStackLabel: campaign.coldcallingStackLabel,
        dispatchMode: campaign.dispatchMode,
        dispatchDelaySeconds: 0,
        sequentialWaitForCallEnd: true,
        queueId: queue.id,
        queuedRemaining,
      },
      results,
    });
  } else {
    results = [];
    const delayMs =
      campaign.dispatchMode === 'delay' ? Math.round(campaign.dispatchDelaySeconds * 1000) : 0;

    for (let index = 0; index < leadsToProcess.length; index += 1) {
      const lead = leadsToProcess[index];
      const result = await processColdcallingLead(lead, campaign, index);
      results.push(result);

      const isLast = index === leadsToProcess.length - 1;
      if (!isLast && delayMs > 0) {
        console.log(
          `[Coldcalling] Wacht ${campaign.dispatchDelaySeconds}s voor volgende lead (${index + 1}/${leadsToProcess.length})`
        );
        await sleep(delayMs);
      }
    }
  }

  const started = results.filter((item) => item.success).length;
  const failed = results.length - started;

  await waitForQueuedRuntimeStatePersist();

  return res.status(200).json({
    ok: true,
    summary: {
      requested: leads.length,
      attempted: leadsToProcess.length,
      started,
      failed,
      provider,
      coldcallingStack: campaign.coldcallingStack,
      coldcallingStackLabel: campaign.coldcallingStackLabel,
      dispatchMode: campaign.dispatchMode,
      dispatchDelaySeconds: campaign.dispatchMode === 'delay' ? campaign.dispatchDelaySeconds : 0,
    },
    results,
  });
});

app.get('/api/coldcalling/call-status/:callId', async (req, res) => {
  const callId = normalizeString(req.params?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }
  return sendColdcallingStatusResponse(res, callId);
});

// Vercel route-fallback: sommige serverless route-combinaties geven NOT_FOUND op diepere paden.
// Deze variant gebruikt een ondiep pad met querystring en werkt betrouwbaarder.
app.get('/api/coldcalling/status', async (req, res) => {
  const callId = normalizeString(req.query?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }
  return sendColdcallingStatusResponse(res, callId);
});

app.get('/api/coldcalling/recording-proxy', async (req, res) => {
  if (!isTwilioStatusApiConfigured()) {
    return res.status(500).json({ ok: false, error: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ontbreken op server.' });
  }

  const callId = normalizeString(req.query?.callId || '');
  let recordingSid = normalizeString(req.query?.recordingSid || '');
  if (!callId && !recordingSid) {
    return res.status(400).json({ ok: false, error: 'callId of recordingSid ontbreekt.' });
  }

  const cached = callId ? callUpdatesById.get(callId) || null : null;
  if (!recordingSid) {
    recordingSid = normalizeString(cached?.recordingSid || '');
  }
  if (!recordingSid) {
    recordingSid = extractTwilioRecordingSidFromUrl(cached?.recordingUrl || cached?.recording_url || '');
  }

  if (callId) {
    try {
      const { recordings } = await fetchTwilioRecordingsByCallId(callId);
      const preferred = choosePreferredTwilioRecording(recordings, recordingSid);
      if (preferred) {
        recordingSid = normalizeString(preferred?.sid || '') || recordingSid;
      }
    } catch (error) {
      if (recordingSid) {
        // Fallback naar bekende opname als Twilio-lijst tijdelijk niet beschikbaar is.
      } else {
      return res.status(Number(error?.status || 502)).json({
        ok: false,
        error: error?.message || 'Kon Twilio recordinglijst niet ophalen.',
        endpoint: error?.endpoint || null,
        details: error?.data || null,
      });
      }
    }
  }

  if (!recordingSid) {
    return res.status(404).json({ ok: false, error: 'Nog geen opname beschikbaar voor deze call.' });
  }

  const mediaUrl = buildTwilioRecordingMediaUrl(recordingSid);
  if (!mediaUrl) {
    return res.status(500).json({ ok: false, error: 'Kon Twilio recording URL niet opbouwen.' });
  }

  try {
    const upstream = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        Authorization: getTwilioBasicAuthorizationHeader(),
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({
        ok: false,
        error: `Twilio opname ophalen mislukt (${upstream.status}).`,
        details: text || null,
      });
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    const contentType = normalizeString(upstream.headers.get('content-type') || '');
    res.set('Content-Type', contentType && /audio/i.test(contentType) ? contentType : 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=120');

    if (callId) {
      const proxyUrl = buildTwilioRecordingProxyUrl(callId);
      const existing = callUpdatesById.get(callId) || {};
      upsertRecentCallUpdate({
        ...existing,
        callId,
        recordingSid,
        recordingUrl: proxyUrl,
        recordingUrlProxy: proxyUrl,
        messageType: normalizeString(existing?.messageType || 'twilio.recording.resolved'),
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        provider: 'twilio',
      });
    }

    return res.status(200).send(bytes);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.message || 'Kon Twilio opname niet proxien.',
    });
  }
});

app.post('/api/retell/webhook', async (req, res) => {
  if (!isRetellWebhookAuthorized(req)) {
    appendSecurityAuditEvent(
      {
        type: 'retell_webhook_rejected',
        severity: 'warning',
        success: false,
        ip: getClientIpFromRequest(req),
        path: getRequestPathname(req),
        origin: getRequestOriginFromHeaders(req),
        userAgent: req.get('user-agent'),
        detail: 'Retell webhook geweigerd door signature/secret check.',
      },
      'security_retell_webhook_rejected'
    );
    return res.status(401).json({ ok: false, error: 'Retell webhook signature/secret ongeldig.' });
  }

  const eventType = normalizeString(req.body?.event || req.body?.type || 'unknown');
  const callData = req.body?.call && typeof req.body.call === 'object' ? req.body.call : null;

  const record = {
    receivedAt: new Date().toISOString(),
    messageType: `retell.${eventType || 'unknown'}`,
    callId: normalizeString(callData?.call_id || ''),
    callStatus: normalizeString(callData?.call_status || ''),
    payload: req.body,
  };

  recentWebhookEvents.unshift(record);
  if (recentWebhookEvents.length > 200) {
    recentWebhookEvents.pop();
  }

  if (VERBOSE_CALL_WEBHOOK_LOGS) {
    console.log(
      '[Retell Webhook]',
      JSON.stringify(
        {
          eventType,
          call: callData,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      '[Retell Webhook]',
      JSON.stringify({
        eventType,
        callId: normalizeString(callData?.call_id || ''),
        status: normalizeString(callData?.call_status || ''),
        endedReason: normalizeString(callData?.disconnection_reason || ''),
      })
    );
  }

  const callUpdate = upsertRecentCallUpdate(extractCallUpdateFromRetellPayload(req.body));
  if (callUpdate) {
    triggerPostCallAutomation(callUpdate);
  }

  await waitForQueuedRuntimeStatePersist();

  return res.status(200).json({ ok: true });
});

app.get('/api/coldcalling/call-updates', async (req, res) => {
  if (isSupabaseConfigured()) {
    await syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS });
    await syncCallUpdatesFromSupabaseRows({ maxAgeMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS });
  }
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 200)));
  const sinceMs = parseNumberSafe(req.query.sinceMs, null);
  const nowMs = Date.now();

  const refreshCandidates = [];
  const seenCallIds = new Set();
  for (const item of recentCallUpdates) {
    if (refreshCandidates.length >= 8) break;
    const callId = normalizeString(item?.callId || '');
    if (!callId || seenCallIds.has(callId)) continue;
    if (!shouldRefreshRetellCallStatus(item, nowMs)) continue;
    seenCallIds.add(callId);
    refreshCandidates.push({
      callId,
      provider: normalizeString(item?.provider || ''),
      direction: normalizeString(item?.direction || ''),
      stack: normalizeString(item?.stack || ''),
    });
  }

  const missingCandidates = collectMissingCallUpdateRefreshCandidates(6);
  for (const candidate of missingCandidates) {
    if (refreshCandidates.length >= 14) break;
    const callId = normalizeString(candidate?.callId || '');
    if (!callId || seenCallIds.has(callId)) continue;
    if (
      !shouldRefreshRetellCallStatus(
        {
          callId,
          status: 'queued',
          endedReason: '',
          provider: candidate?.provider || '',
          updatedAtMs: 0,
        },
        nowMs
      )
    ) {
      continue;
    }
    seenCallIds.add(callId);
    refreshCandidates.push({
      callId,
      provider: normalizeString(candidate?.provider || ''),
      direction: normalizeString(candidate?.direction || ''),
      stack: normalizeString(candidate?.stack || ''),
    });
  }

  if (refreshCandidates.length > 0) {
    await Promise.allSettled(
      refreshCandidates.map(async (candidate) => {
        const callId = normalizeString(candidate?.callId || '');
        if (!callId) return null;
        const cached = callUpdatesById.get(callId) || null;
        const provider = inferCallProvider(
          callId,
          normalizeString(candidate?.provider || cached?.provider || 'retell').toLowerCase() || 'retell'
        );
        const refreshed =
          provider === 'twilio'
            ? await refreshCallUpdateFromTwilioStatusApi(callId, {
                direction:
                  normalizeString(cached?.direction || candidate?.direction || '') || 'outbound',
                stack: normalizeString(cached?.stack || candidate?.stack || ''),
              })
            : await refreshCallUpdateFromRetellStatusApi(callId);
        if (refreshed) {
          triggerPostCallAutomation(refreshed);
        }
      })
    );
    await waitForQueuedRuntimeStatePersist();
  }

  const filtered = recentCallUpdates.filter((item) => {
    if (!Number.isFinite(sinceMs)) return true;
    return Number(item.updatedAtMs || 0) > Number(sinceMs);
  });

  return res.status(200).json({
    ok: true,
    count: Math.min(limit, filtered.length),
    updates: filtered.slice(0, limit),
  });
});

app.get('/api/coldcalling/call-detail', async (req, res) => {
  if (isSupabaseConfigured()) {
    await syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS });
    await syncCallUpdatesFromSupabaseRows({ maxAgeMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS });
  }

  const callId = normalizeString(req.query?.callId || '');
  if (!callId) {
    return res.status(400).json({
      ok: false,
      error: 'callId ontbreekt.',
    });
  }

  backfillInsightsAndAppointmentsFromRecentCallUpdates();

  try {
    const detail = await buildCallBackedLeadDetail(callId);
    if (!detail) {
      return res.status(404).json({
        ok: false,
        error: 'Call niet gevonden.',
      });
    }
    return res.status(200).json({
      ok: true,
      detail,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: normalizeString(error?.message || '') || 'Call detail laden mislukt.',
    });
  }
});

app.get('/api/coldcalling/webhook-debug', requireRuntimeDebugAccess, (req, res) => {
  const limit = Math.max(1, Math.min(100, parseIntSafe(req.query.limit, 20)));
  const demoCallIdPrefix = 'demo-';

  const latestWebhookEvents = recentWebhookEvents.slice(0, limit).map((event) => {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null;
    const call = payload?.call && typeof payload.call === 'object' ? payload.call : null;

    return {
      receivedAt: normalizeString(event?.receivedAt || ''),
      messageType: normalizeString(event?.messageType || ''),
      callId: normalizeString(event?.callId || call?.call_id || ''),
      callStatus: normalizeString(event?.callStatus || call?.call_status || ''),
      endedReason: normalizeString(call?.disconnection_reason || ''),
      topLevelKeys: payload ? Object.keys(payload).slice(0, 30) : [],
      callKeys: call ? Object.keys(call).slice(0, 30) : [],
    };
  });

  const latestRealCallUpdates = recentCallUpdates
    .filter((item) => {
      const callId = normalizeString(item?.callId || '');
      return callId && !callId.startsWith(demoCallIdPrefix);
    })
    .slice(0, limit)
    .map((item) => ({
      callId: normalizeString(item?.callId || ''),
      phone: normalizeString(item?.phone || ''),
      company: normalizeString(item?.company || ''),
      status: normalizeString(item?.status || ''),
      messageType: normalizeString(item?.messageType || ''),
      hasSummary: Boolean(normalizeString(item?.summary || '')),
      hasTranscriptSnippet: Boolean(normalizeString(item?.transcriptSnippet || '')),
      transcriptSnippetLen: normalizeString(item?.transcriptSnippet || '').length || 0,
      hasTranscriptFull: Boolean(normalizeString(item?.transcriptFull || '')),
      transcriptFullLen: normalizeString(item?.transcriptFull || '').length || 0,
      updatedAt: normalizeString(item?.updatedAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
    }));

  const allCallUpdateCount = recentCallUpdates.length;
  const realCallUpdateCount = recentCallUpdates.filter((item) => {
    const callId = normalizeString(item?.callId || '');
    return callId && !callId.startsWith(demoCallIdPrefix);
  }).length;

  return res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    webhookEventCount: recentWebhookEvents.length,
    callUpdateCount: allCallUpdateCount,
    realCallUpdateCount,
    demoOnlyCallUpdates: allCallUpdateCount > 0 && realCallUpdateCount === 0,
    latestWebhookEvents,
    latestRealCallUpdates,
  });
});

app.get('/api/ai/call-insights', async (req, res) => {
  if (isSupabaseConfigured()) {
    await syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS });
  }
  const touched = backfillInsightsAndAppointmentsFromRecentCallUpdates();
  if (touched > 0) {
    await waitForQueuedRuntimeStatePersist();
  }
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100)));
  return res.status(200).json({
    ok: true,
    count: Math.min(limit, recentAiCallInsights.length),
    insights: recentAiCallInsights.slice(0, limit),
    openAiEnabled: Boolean(getOpenAiApiKey()),
    model: OPENAI_MODEL,
  });
});

registerAiDashboardRoutes(app, {
  coordinator: aiDashboardCoordinator,
});

registerAiToolRoutes(app, {
  coordinator: aiToolsCoordinator,
});

registerWebsiteLinkRoutes(app, { coordinator: websiteLinkCoordinator });

registerActiveOrderRoutes(app, {
  coordinator: activeOrdersCoordinator,
});

registerRuntimeOpsRoutes(app, {
  coordinator: runtimeOpsCoordinator,
  requireRuntimeDebugAccess,
});

registerRuntimeDebugOpsRoutes(app, {
  coordinator: runtimeDebugOpsCoordinator,
  requireRuntimeDebugAccess,
});

registerSeoReadRoutes(app, {
  readCoordinator: seoReadCoordinator,
});
registerSeoWriteRoutes(app, {
  writeCoordinator: seoWriteCoordinator,
});

function normalizePostCallStatus(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return 'customer_wants_to_proceed';
  if (raw === 'customer_wants_to_proceed') return raw;
  if (raw === 'klant_wil_door') return 'customer_wants_to_proceed';
  return truncateText(raw, 80);
}

function sanitizePostCallText(value, maxLen = 20000) {
  return truncateText(normalizeString(value || ''), maxLen);
}

async function syncConfirmationMailResponse(req, res) {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  const result = await syncInboundConfirmationEmailsFromImap({
    force: true,
    maxMessages: Math.max(10, Math.min(400, parseIntSafe(req.body?.maxMessages, 120))),
  });
  return res.status(result?.ok === false && !result?.skipped ? 500 : 200).json({
    ok: result?.ok !== false,
    sync: result || null,
  });
}
agendaInterestedLeadStateService = createAgendaInterestedLeadStateService({
  dismissedInterestedLeadCallIds,
  dismissedInterestedLeadKeys,
  dismissedInterestedLeadKeyUpdatedAtMsByKey,
  normalizeString,
  buildLeadFollowUpCandidateKey: (...args) =>
    agendaInterestedLeadReadService?.buildLeadFollowUpCandidateKey(...args) || '',
  queueRuntimeStatePersist,
  persistDismissedLeadsToSupabase,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  mapAppointmentToConfirmationTask,
  setGeneratedAgendaAppointmentAtIndex,
});

const {
  cancelOpenLeadFollowUpTasksByIdentity,
  dismissInterestedLeadIdentity,
  isInterestedLeadDismissedForRow,
} = agendaInterestedLeadStateService;

agendaInterestedLeadReadService = createAgendaInterestedLeadReadService({
  getRecentCallUpdates: () => recentCallUpdates,
  getRecentAiCallInsights: () => recentAiCallInsights,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  mapAppointmentToConfirmationTask,
  compareConfirmationTasks,
  normalizeString,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  truncateText,
  toBooleanSafe,
  normalizeColdcallingStack,
  getColdcallingStackLabel,
  buildGeneratedLeadFollowUpFromCall,
  buildLeadOwnerFields,
  resolveAppointmentLocation,
  resolveCallDurationSeconds,
  resolvePreferredRecordingUrl,
  sanitizeAppointmentLocation,
  sanitizeAppointmentWhatsappInfo,
  resolveAgendaLocationValue,
  isInterestedLeadDismissedForRow: (...args) =>
    agendaInterestedLeadStateService.isInterestedLeadDismissedForRow(...args),
  hasNegativeInterestSignal,
  hasPositiveInterestSignal,
});

const {
  buildAllInterestedLeadRows,
  collectInterestedLeadCallIdsByIdentity,
  buildLatestInterestedLeadRowsByKey,
  buildLeadFollowUpCandidateKey,
  findInterestedLeadRowByCallId,
  getLeadLikeRecencyTimestamp,
  normalizeLeadLikePhoneKey,
} = agendaInterestedLeadReadService;

const agendaLeadFollowUpService = createAgendaLeadFollowUpService({
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  agendaAppointmentIdByCallId,
  mapAppointmentToConfirmationTask,
  normalizeString,
  buildLeadFollowUpCandidateKey,
  getLeadLikeRecencyTimestamp,
  buildLatestInterestedLeadRowsByKey,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  truncateText,
  resolveAppointmentLocation,
  resolveCallDurationSeconds,
  sanitizeAppointmentWhatsappInfo,
  resolvePreferredRecordingUrl,
  normalizeColdcallingStack,
  queueRuntimeStatePersist,
});

const {
  backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
  findReusableLeadFollowUpAppointmentIndex,
} = agendaLeadFollowUpService;

const agendaAppointmentUpsertService = createAgendaAppointmentUpsertService({
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  agendaAppointmentIdByCallId,
  getGeneratedAppointmentIndexById,
  setGeneratedAgendaAppointmentAtIndex,
  findReusableLeadFollowUpAppointmentIndex,
  buildConfirmationEmailDraftFallback,
  takeNextGeneratedAgendaAppointmentId: () => nextGeneratedAgendaAppointmentId++,
  queueRuntimeStatePersist,
  normalizeString,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  sanitizeAppointmentLocation,
  sanitizeAppointmentWhatsappInfo,
  toBooleanSafe,
  normalizeEmailAddress,
});

const { upsertGeneratedAgendaAppointment } = agendaAppointmentUpsertService;

const agendaInterestedLeadsCoordinator = createAgendaInterestedLeadsCoordinator({
  isSupabaseConfigured,
  getSupabaseStateHydrated: () => supabaseStateHydrated,
  forceHydrateRuntimeStateWithRetries,
  backfillInsightsAndAppointmentsFromRecentCallUpdates,
  normalizeString,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  sanitizeAppointmentLocation,
  sanitizeAppointmentWhatsappInfo,
  toBooleanSafe,
  agendaAppointmentIdByCallId,
  getGeneratedAppointmentIndexById,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  findInterestedLeadRowByCallId,
  buildAllInterestedLeadRows,
  buildLeadFollowUpCandidateKey,
  collectInterestedLeadCallIdsByIdentity,
  getLatestCallUpdateByCallId,
  aiCallInsightsByCallId,
  buildGeneratedLeadFollowUpFromCall,
  normalizeColdcallingStack,
  getColdcallingStackLabel,
  buildLeadOwnerFields,
  normalizeEmailAddress,
  formatEuroLabel,
  truncateText,
  resolveAppointmentLocation,
  resolveCallDurationSeconds,
  resolvePreferredRecordingUrl,
  resolveAgendaLocationValue,
  upsertGeneratedAgendaAppointment,
  buildLeadToAgendaSummary,
  setGeneratedAgendaAppointmentAtIndex,
  dismissInterestedLeadIdentity,
  persistDismissedLeadsToSupabase,
  appendDashboardActivity,
  cancelOpenLeadFollowUpTasksByIdentity,
  buildRuntimeStateSnapshotPayload,
  applyRuntimeStateSnapshotPayload,
  waitForQueuedRuntimeSnapshotPersist,
  invalidateSupabaseSyncTimestamp,
});

const {
  setInterestedLeadInAgendaResponse,
  dismissInterestedLeadResponse,
} = agendaInterestedLeadsCoordinator;

const agendaPostCallCoordinator = createAgendaPostCallCoordinator({
  normalizeString,
  truncateText,
  sanitizeLaunchDomainName,
  sanitizeReferenceImages,
  sanitizePostCallText,
  normalizePostCallStatus,
  getGeneratedAppointmentIndexById,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  setGeneratedAgendaAppointmentAtIndex,
  appendDashboardActivity,
  getUiStateValues,
  setUiStateValues,
  premiumActiveOrdersScope: PREMIUM_ACTIVE_ORDERS_SCOPE,
  premiumActiveCustomOrdersKey: PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY,
  helpers: agendaPostCallHelpers,
});

const {
  updateAgendaAppointmentPostCallDataById,
  addAgendaAppointmentToPremiumActiveOrders,
} = agendaPostCallCoordinator;

const agendaConfirmationCoordinator = createAgendaConfirmationCoordinator({
  openAiApiBaseUrl: OPENAI_API_BASE_URL,
  openAiModel: OPENAI_MODEL,
  runtimeSyncCooldownMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS,
  aiCallInsightsByCallId,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  getGeneratedAppointmentIndexById,
  setGeneratedAgendaAppointmentAtIndex,
  mapAppointmentToConfirmationTask,
  getLatestCallUpdateByCallId,
  pickReadableConversationSummaryForLeadDetail,
  getAppointmentTranscriptText,
  resolvePreferredRecordingUrl,
  sanitizeAppointmentLocation,
  resolveAgendaLocationValue,
  sanitizeAppointmentWhatsappInfo,
  resolveCallDurationSeconds,
  normalizeString,
  normalizeDateYyyyMmDd,
  normalizeTimeHhMm,
  normalizeEmailAddress,
  truncateText,
  toBooleanSafe,
  resolveAppointmentCallId,
  inferCallProvider,
  refreshCallUpdateFromTwilioStatusApi,
  refreshCallUpdateFromRetellStatusApi,
  buildCallBackedLeadDetail,
  buildConversationSummaryForLeadDetail,
  buildConfirmationEmailDraftFallback,
  getOpenAiApiKey,
  fetchJsonWithTimeout,
  extractOpenAiTextContent,
  isSupabaseConfigured,
  getSupabaseStateHydrated: () => supabaseStateHydrated,
  forceHydrateRuntimeStateWithRetries,
  syncRuntimeStateFromSupabaseIfNewer,
  isImapMailConfigured,
  syncInboundConfirmationEmailsFromImap,
  backfillInsightsAndAppointmentsFromRecentCallUpdates,
  isLikelyValidEmail,
  isSmtpMailConfigured,
  getMissingSmtpMailEnv,
  sendConfirmationEmailViaSmtp,
  appendDashboardActivity,
  buildLeadToAgendaSummary,
  dismissInterestedLeadIdentity,
  extractTwilioRecordingSidFromUrl,
  isTwilioStatusApiConfigured,
  fetchTwilioRecordingsByCallId,
  choosePreferredTwilioRecording,
  buildTwilioRecordingMediaUrl,
  fetchBinaryWithTimeout,
  getTwilioBasicAuthorizationHeader,
  buildRecordingFileNameForTranscription,
  getEffectivePublicBaseUrl,
  normalizeAbsoluteHttpUrl,
  getOpenAiTranscriptionModelCandidates,
  parseJsonLoose,
  buildRuntimeStateSnapshotPayload,
  applyRuntimeStateSnapshotPayload,
  waitForQueuedRuntimeSnapshotPersist,
  invalidateSupabaseSyncTimestamp,
});

const {
  ensureConfirmationEmailDraftAtIndex,
  sendConfirmationTaskDetailResponse,
  sendConfirmationTaskDraftEmailResponse,
  sendConfirmationTaskEmailResponse,
  markConfirmationTaskSentById,
  setLeadTaskInAgendaById,
  markConfirmationTaskResponseReceivedById,
  markLeadTaskCancelledById,
  completeConfirmationTaskById,
} = agendaConfirmationCoordinator;

const agendaReadCoordinator = createAgendaReadCoordinator({
  runtimeSyncCooldownMs: RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS,
  demoConfirmationTaskEnabled: DEMO_CONFIRMATION_TASK_ENABLED,
  isSupabaseConfigured,
  getSupabaseStateHydrated: () => supabaseStateHydrated,
  forceHydrateRuntimeStateWithRetries,
  syncRuntimeStateFromSupabaseIfNewer,
  isImapMailConfigured,
  syncInboundConfirmationEmailsFromImap,
  backfillInsightsAndAppointmentsFromRecentCallUpdates,
  refreshAgendaAppointmentCallSourcesIfNeeded,
  backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
  refreshGeneratedAgendaSummariesIfNeeded,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  isGeneratedAppointmentVisibleForAgenda,
  compareAgendaAppointments,
  mapAppointmentToConfirmationTask,
  ensureConfirmationEmailDraftAtIndex,
  compareConfirmationTasks,
  buildAllInterestedLeadRows,
  isInterestedLeadDismissedForRow: (...args) =>
    agendaInterestedLeadStateService.isInterestedLeadDismissedForRow(...args),
  normalizeString,
});

const agendaPageBootstrapService = createAgendaPageBootstrapService({
  isSupabaseConfigured,
  getSupabaseStateHydrated: () => supabaseStateHydrated,
  forceHydrateRuntimeStateWithRetries,
  getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
  isGeneratedAppointmentVisibleForAgenda,
  compareAgendaAppointments,
});

const customersPageBootstrapService = createCustomersPageBootstrapService({
  getUiStateValues,
  normalizeString,
  customerScope: PREMIUM_CUSTOMERS_SCOPE,
  customerKey: PREMIUM_CUSTOMERS_KEY,
  orderScope: PREMIUM_ACTIVE_ORDERS_SCOPE,
  orderKey: PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY,
});

const leadsPageBootstrapService = createLeadsPageBootstrapService({
  agendaReadCoordinator,
  isSupabaseConfigured,
  getSupabaseStateHydrated: () => supabaseStateHydrated,
  forceHydrateRuntimeStateWithRetries,
  getUiStateValues,
  normalizeString,
  leadDatabaseUiScope: 'coldcalling',
  leadDatabaseRowsStorageKey: 'softora_coldcalling_lead_rows_json',
});

const coldcallingDashboardBootstrapService = createColdcallingDashboardBootstrapService({
  agendaReadCoordinator,
  getUiStateValues,
  getRecentCallUpdates: () => recentCallUpdates,
  getRecentAiCallInsights: () => recentAiCallInsights,
  normalizeString,
});

getRuntimeHtmlPageBootstrapData = async (_req, fileName) => {
  if (fileName === 'premium-personeel-agenda.html') {
    return {
      marker: 'SOFTORA_AGENDA_BOOTSTRAP',
      scriptId: 'softoraAgendaBootstrap',
      data: await agendaPageBootstrapService.buildAgendaBootstrapPayload({ limit: 250 }),
    };
  }

  if (fileName === 'premium-klanten.html') {
    return {
      marker: 'SOFTORA_CUSTOMERS_BOOTSTRAP',
      scriptId: 'softoraCustomersBootstrap',
      data: await customersPageBootstrapService.buildCustomersBootstrapPayload(),
    };
  }

  if (fileName === 'premium-ai-coldmailing.html') {
    const leadsPayload = await leadsPageBootstrapService.buildLeadsBootstrapPayload();
    return {
      marker: 'SOFTORA_LEADS_BOOTSTRAP',
      scriptId: 'softoraLeadsBootstrap',
      data: leadsPayload,
      htmlReplacements: leadsPageBootstrapService.buildLeadsPageHtmlReplacements(leadsPayload),
    };
  }

  if (fileName === 'premium-ai-lead-generator.html') {
    const dashboardPayload = await coldcallingDashboardBootstrapService.buildBootstrapPayload();
    return {
      marker: 'SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP',
      scriptId: 'softoraColdcallingDashboardBootstrap',
      data: dashboardPayload,
      htmlReplacements: coldcallingDashboardBootstrapService.buildDashboardHtmlReplacements(dashboardPayload),
    };
  }

  return null;
};

registerAgendaReadRoutes(app, {
  readCoordinator: agendaReadCoordinator,
  sendConfirmationTaskDetailResponse,
});

registerAgendaMutationRoutes(app, {
  updateAgendaAppointmentPostCallDataById,
  addAgendaAppointmentToPremiumActiveOrders,
  setInterestedLeadInAgendaResponse,
  dismissInterestedLeadResponse,
  syncConfirmationMailResponse,
  sendConfirmationTaskDraftEmailResponse,
  sendConfirmationTaskEmailResponse,
  markConfirmationTaskSentById,
  setLeadTaskInAgendaById,
  markConfirmationTaskResponseReceivedById,
  markLeadTaskCancelledById,
  completeConfirmationTaskById,
});

registerHealthAndOpsRoutes(app, {
  appName: 'softora-retell-coldcalling-backend',
  appVersion: APP_VERSION,
  featureFlags: FEATURE_FLAGS,
  getPublicFeatureFlags,
  routeManifest,
  requireRuntimeDebugAccess,
  buildRuntimeStateSnapshotPayloadWithLimits,
  buildRuntimeBackupForOps,
  isProduction: IS_PRODUCTION,
  isServerlessRuntime,
  isSupabaseConfigured,
  getSupabaseStatus: () => ({
    enabled: isSupabaseConfigured(),
    hydrated: supabaseStateHydrated,
    table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
    stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
    lastHydrateError: supabaseLastHydrateError || null,
    lastPersistError: supabaseLastPersistError || null,
    lastCallUpdatePersistError: supabaseLastCallUpdatePersistError || null,
  }),
  getMailStatus: () => ({
    smtpConfigured: isSmtpMailConfigured(),
    imapConfigured: isImapMailConfigured(),
    imapMailbox: isImapMailConfigured() ? MAIL_IMAP_MAILBOX : null,
    imapPollCooldownMs: MAIL_IMAP_POLL_COOLDOWN_MS,
    imapNextPollAfterMs: confirmationMailRuntimeState.inboundConfirmationMailSyncNotBeforeMs,
    imapLastSync: confirmationMailRuntimeState.inboundConfirmationMailSyncLastResult || null,
  }),
  getAiStatus: () => ({
    coldcallingProvider: getColdcallingProvider(),
    openaiConfigured: Boolean(normalizeString(process.env.OPENAI_API_KEY)),
    anthropicConfigured: Boolean(normalizeString(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)),
    retellConfigured: Boolean(normalizeString(process.env.RETELL_API_KEY)),
    twilioConfigured: Boolean(
      normalizeString(process.env.TWILIO_ACCOUNT_SID) && normalizeString(process.env.TWILIO_AUTH_TOKEN)
    ),
    missingProviderEnv: getMissingEnvVars(getColdcallingProvider()),
  }),
  getSessionStatus: () => ({
    configured: Boolean(PREMIUM_SESSION_SECRET),
    cookieName: PREMIUM_SESSION_COOKIE_NAME,
    mfaConfigured: isPremiumMfaConfigured(),
  }),
  getRuntimeStatus: () => ({
    webhookEvents: recentWebhookEvents.length,
    callUpdates: recentCallUpdates.length,
    aiCallInsights: recentAiCallInsights.length,
    securityAuditEvents: recentSecurityAuditEvents.length,
    appointments: generatedAgendaAppointments.length,
    realCallUpdates: recentCallUpdates.filter((item) => {
      const callId = normalizeString(item?.callId || '');
      return callId && !callId.startsWith('demo-');
    }).length,
  }),
});

app.get('/robots.txt', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /premium-',
      'Disallow: /personeel-',
      'Disallow: /actieve-opdrachten',
      'Disallow: /ai-coldmailing',
      'Disallow: /ai-lead-generator',
      'Disallow: /seo-crm-system',
      '',
    ].join('\n')
  );
});

app.get('/.well-known/security.txt', (req, res) => {
  const publicBaseUrl = getEffectivePublicBaseUrl(req) || 'https://www.softora.nl';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send(
    [
      `Contact: mailto:${SECURITY_CONTACT_EMAIL || 'info@softora.nl'}`,
      `Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}`,
      `Canonical: ${publicBaseUrl}/.well-known/security.txt`,
      `Preferred-Languages: nl, en`,
      '',
    ].join('\n')
  );
});

// API routes eerst, daarna statische frontend assets/html serveren.
app.use(
  '/assets',
  express.static(path.join(__dirname, 'assets'), {
    maxAge: '7d',
    setHeaders(res, assetPath) {
      const originalUrl = String(res.req?.originalUrl || '');
      if (/\.(woff2?|ttf|otf|eot|svg|png|jpe?g|webp|avif)$/i.test(assetPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (originalUrl.includes('?v=')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
      }
    },
  })
);
app.get('/', async (req, res, next) => {
  return sendSeoManagedHtmlPageResponse(req, res, next, 'premium-website.html');
});

app.get('/:page', (req, res, next) => {
  const page = req.params.page;

  if (!/^[a-zA-Z0-9._-]+\.html$/.test(page)) {
    return next();
  }

  const slug = String(page || '').replace(/\.html$/i, '');
  const legacyTarget = resolveLegacyPrettyPageRedirect(slug);
  if (legacyTarget) {
    return res.redirect(301, appendOriginalQuery(`/${legacyTarget}`, req.originalUrl));
  }

  if (!knownHtmlPageFiles.has(page)) {
    return next();
  }

  const destination = toPrettyPagePathFromHtmlFile(page);
  return res.redirect(301, appendOriginalQuery(destination, req.originalUrl));
});

app.get('/:slug', async (req, res, next) => {
  const slug = String(req.params.slug || '').trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return next();
  }

  if (slug === 'index') {
    return res.redirect(301, '/');
  }

  const legacyTarget = resolveLegacyPrettyPageRedirect(slug);
  if (legacyTarget) {
    return res.redirect(301, appendOriginalQuery(`/${legacyTarget}`, req.originalUrl));
  }

  if (await websiteLinkCoordinator.sendPublishedWebsiteLinkResponse(req, res, slug)) return undefined;

  const fileName = knownPrettyPageSlugToFile.get(slug);
  if (!fileName) {
    return next();
  }

  return sendSeoManagedHtmlPageResponse(req, res, next, fileName);
});

app.use((req, res) => {
  const requestPath = String(req.path || req.originalUrl || req.url || '');
  if (requestPath === '/' || requestPath === '') {
    return res.redirect(302, '/premium-website');
  }
  res.status(404).json({ ok: false, error: 'Niet gevonden' });
});

app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    ok: false,
    error: 'Interne serverfout',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

function seedDemoConfirmationTaskForUiTesting() {
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProduction && !DEMO_CONFIRMATION_TASK_ENABLED) return;

  const demoCallId = 'demo-confirmation-task-call-1';
  if (generatedAgendaAppointments.some((item) => normalizeString(item?.callId) === demoCallId)) {
    return;
  }

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;

  upsertRecentCallUpdate({
    callId: demoCallId,
    phone: '+31612345678',
    company: 'Testbedrijf Demo BV',
    name: 'Servé Creusen',
    status: 'ended',
    messageType: 'call.ended',
    summary:
      'Afspraak ingepland voor een korte intake over de AI coldcalling setup. Klant wil eerst per mail bevestiging ontvangen.',
    transcriptSnippet:
      'AI: Zullen we morgen om 14:00 een intake plannen? | Klant: Ja, stuur even een bevestigingsmail dan bevestig ik per mail terug.',
    transcriptFull: [
      'assistant: Goedemiddag, u spreekt met de AI assistent van Softora.',
      'customer: Goedemiddag.',
      'assistant: Ik bel kort over het automatiseren van leadopvolging en intakeplanning.',
      'customer: Interessant, vertel.',
      'assistant: Zullen we een intake plannen om de workflow door te nemen?',
      'customer: Ja, dat is goed.',
      'assistant: Past morgen om 14:00 uur?',
      'customer: Ja, stuur even een bevestigingsmail. Als ik die heb, bevestig ik terug.',
      'assistant: Helemaal goed, dan zetten we dat zo door.',
    ].join('\n'),
    endedReason: 'completed',
    durationSeconds: 94,
    recordingUrl:
      'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==',
    updatedAt: now.toISOString(),
    updatedAtMs: now.getTime(),
  });

  const insight = upsertAiCallInsight({
    callId: demoCallId,
    company: 'Testbedrijf Demo BV',
    contactName: 'Servé Creusen',
    phone: '+31612345678',
    branche: 'Zakelijke Dienstverlening',
    summary:
      'Prospect staat open voor intake. Afspraak mondeling ingepland en wil eerst een bevestigingsmail ontvangen en daarna per mail bevestigen.',
    appointmentBooked: true,
    appointmentDate: date,
    appointmentTime: '14:00',
    estimatedValueEur: 2800,
    followUpRequired: true,
    followUpReason: 'Bevestigingsmail sturen en wachten op schriftelijke bevestiging.',
    source: 'seed',
    model: 'seed',
    analyzedAt: now.toISOString(),
  });

  const appointment = upsertGeneratedAgendaAppointment(
    {
      company: 'Testbedrijf Demo BV',
      contact: 'Servé Creusen',
      phone: '+31612345678',
      type: 'meeting',
      date,
      time: '14:00',
      value: '€2.800',
      branche: 'Zakelijke Dienstverlening',
      source: 'AI Cold Calling (Testdata UI)',
      summary:
        'Testafspraak voor UI-testen. Eerst bevestigingsmail sturen, daarna wachten op mailbevestiging voordat de afspraak in de agenda verschijnt.',
      aiGenerated: true,
      callId: demoCallId,
      createdAt: now.toISOString(),
    },
    demoCallId
  );

  if (appointment) {
    appointment.confirmationEmailDraft = [
      'Onderwerp: Bevestiging intakeafspraak Testbedrijf Demo BV - morgen 14:00',
      '',
      'Beste Servé,',
      '',
      'Bedankt voor het prettige telefoongesprek van zojuist.',
      'Hierbij bevestig ik onze intakeafspraak voor morgen om 14:00 uur.',
      '',
      'Zoals besproken lopen we tijdens de intake kort de AI coldcalling workflow door en bekijken we de opvolging in het dashboard.',
      '',
      'Wil je deze tijd per mail bevestigen? Dan zetten wij de afspraak definitief in de agenda.',
      '',
      'Met vriendelijke groet,',
      'Softora',
    ].join('\n');
    appointment.confirmationEmailDraftGeneratedAt = now.toISOString();
    appointment.confirmationEmailDraftSource = 'seed';
    if (insight) {
      insight.agendaAppointmentId = appointment.id;
    }
    queueRuntimeStatePersist('demo_seed_confirmation_task');
  }

  console.log('[Startup] Demo bevestigingstaak toegevoegd voor UI-testen.');
}

// In serverless (zoals Vercel) wordt startServer() niet aangeroepen, dus seed de
// demo-taak ook bij module-load. De functie is idempotent op basis van callId.
seedDemoConfirmationTaskForUiTesting();
void ensureRuntimeStateHydratedFromSupabase();

function startServer() {
  seedDemoConfirmationTaskForUiTesting();
  void ensureRuntimeStateHydratedFromSupabase();
  app.listen(PORT, () => {
    const provider = getColdcallingProvider();
    console.log(`Softora coldcalling backend draait op http://localhost:${PORT} (provider: ${provider})`);
    const missingEnv = getMissingEnvVars(provider);
    if (missingEnv.length > 0) {
      console.warn(
        `[Startup] Let op: ontbrekende env vars voor ${provider} (${missingEnv.join(', ')}). /api/coldcalling/start zal falen totdat deze zijn ingevuld.`
      );
    }
    if (isSupabaseConfigured()) {
      console.log(
        `[Startup] Supabase state persistence actief (${SUPABASE_STATE_TABLE}:${SUPABASE_STATE_KEY}).`
      );
    } else {
      console.log('[Startup] Supabase state persistence uit (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ontbreken).');
    }
  });
}

if (require.main === module && !isServerlessRuntime) {
  startServer();
}

module.exports = app;
module.exports.app = app;
module.exports.normalizeNlPhoneToE164 = normalizeNlPhoneToE164;
module.exports.startServer = startServer;
module.exports.buildRuntimeStateSnapshotPayloadWithLimits = buildRuntimeStateSnapshotPayloadWithLimits;
module.exports.buildRuntimeBackupForOps = buildRuntimeBackupForOps;
