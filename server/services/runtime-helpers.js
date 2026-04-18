function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function defaultParseNumberSafe(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function createRuntimeHelpers(options = {}) {
  const {
    env = process.env,
    normalizeString = defaultNormalizeString,
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    parseNumberSafe = defaultParseNumberSafe,
    websiteAnthropicModel = '',
    anthropicModel = '',
    websiteGenerationProvider = '',
    dossierAnthropicModel = '',
  } = options;

  const getRequiredRetellEnv = () => ['RETELL_API_KEY', 'RETELL_FROM_NUMBER', 'RETELL_AGENT_ID'];

  const isRetellColdcallingConfigured = () => {
    return getRequiredRetellEnv().every((key) => normalizeString(env[key]));
  };

  const hasTwilioRegionalApiKeyPair = () => {
    return Boolean(
      normalizeString(env.TWILIO_API_KEY_SID) && normalizeString(env.TWILIO_API_KEY_SECRET)
    );
  };

  const hasTwilioLegacyAuth = () => {
    return Boolean(normalizeString(env.TWILIO_ACCOUNT_SID) && normalizeString(env.TWILIO_AUTH_TOKEN));
  };

  const getRequiredTwilioEnv = () => [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_FROM_NUMBER',
    'TWILIO_AUTH_TOKEN of TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET',
  ];

  const isTwilioColdcallingConfigured = () => {
    return Boolean(
      normalizeString(env.TWILIO_ACCOUNT_SID) &&
        normalizeString(env.TWILIO_FROM_NUMBER) &&
        (hasTwilioLegacyAuth() || hasTwilioRegionalApiKeyPair())
    );
  };

  const isTwilioStatusApiConfigured = () => {
    return Boolean(
      normalizeString(env.TWILIO_ACCOUNT_SID) &&
        (hasTwilioLegacyAuth() || hasTwilioRegionalApiKeyPair())
    );
  };

  const getColdcallingProvider = () => {
    const configured = normalizeString(env.COLDCALLING_PROVIDER).toLowerCase();
    if (
      configured === 'twilio' ||
      configured === 'twilio_media' ||
      configured === 'twilio_media_stream'
    ) {
      return 'twilio';
    }
    if (configured === 'retell') return 'retell';
    if (isRetellColdcallingConfigured()) return 'retell';
    if (isTwilioColdcallingConfigured()) return 'twilio';
    return 'retell';
  };

  const getMissingEnvVars = (provider = getColdcallingProvider()) => {
    if (provider === 'twilio') {
      const missing = [];
      if (!normalizeString(env.TWILIO_ACCOUNT_SID)) missing.push('TWILIO_ACCOUNT_SID');
      if (!normalizeString(env.TWILIO_FROM_NUMBER)) missing.push('TWILIO_FROM_NUMBER');
      if (!hasTwilioLegacyAuth() && !hasTwilioRegionalApiKeyPair()) {
        missing.push('TWILIO_AUTH_TOKEN of TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET');
      }
      return missing;
    }
    if (provider === 'retell') {
      return getRequiredRetellEnv().filter((key) => !normalizeString(env[key]));
    }
    return getRequiredRetellEnv().filter((key) => !normalizeString(env[key]));
  };

  const getColdcallingStackLabel = (stack) => {
    const normalized = normalizeColdcallingStack(stack);
    if (normalized === 'gemini_flash_3_1_live') return 'Gemini 3.1 Live';
    if (normalized === 'openai_realtime_1_5') return 'OpenAI Realtime 1.5';
    if (normalized === 'hume_evi_3') return 'Hume Evi 3';
    return 'Retell AI';
  };

  const resolveColdcallingProviderForCampaign = (campaign = {}) => {
    const stack = normalizeColdcallingStack(
      campaign?.coldcallingStack || campaign?.callingEngine || campaign?.callingStack
    );
    if (stack === 'retell_ai') return 'retell';
    if (
      stack === 'gemini_flash_3_1_live' ||
      stack === 'openai_realtime_1_5' ||
      stack === 'hume_evi_3'
    ) {
      return 'twilio';
    }
    return getColdcallingProvider();
  };

  const inferCallProvider = (callId, fallbackProvider = 'retell') => {
    const normalizedCallId = normalizeString(callId);
    if (/^call_/i.test(normalizedCallId)) return 'retell';
    if (/^CA[0-9a-f]{32}$/i.test(normalizedCallId)) return 'twilio';
    return fallbackProvider;
  };

  const toBooleanSafe = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'ja'].includes(normalized)) return true;
      if (['false', '0', 'no', 'nee'].includes(normalized)) return false;
    }
    return fallback;
  };

  const normalizeDateYyyyMmDd = (value) => {
    const raw = normalizeString(value);
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

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
  };

  const normalizeTimeHhMm = (value) => {
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
  };

  const formatEuroLabel = (amount) => {
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
  };

  const getOpenAiApiKey = () => normalizeString(env.OPENAI_API_KEY);
  const getAnthropicApiKey = () => normalizeString(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY);

  const getWebsiteAnthropicModel = () => {
    const candidates = [
      normalizeString(env.WEBSITE_ANTHROPIC_MODEL || ''),
      normalizeString(env.ANTHROPIC_WEBSITE_MODEL || ''),
      normalizeString(websiteAnthropicModel || ''),
      normalizeString(env.ANTHROPIC_MODEL || ''),
      normalizeString(env.CLAUDE_MODEL || ''),
      normalizeString(anthropicModel || ''),
      'claude-opus-4-6',
    ];
    return candidates.find((value) => Boolean(value)) || 'claude-opus-4-6';
  };

  const getWebsiteGenerationProvider = () => {
    if (websiteGenerationProvider === 'anthropic' || websiteGenerationProvider === 'claude') {
      return 'anthropic';
    }
    if (websiteGenerationProvider === 'openai') {
      return 'openai';
    }
    return getAnthropicApiKey() ? 'anthropic' : 'openai';
  };

  const getDossierAnthropicModel = () => {
    const candidates = [
      normalizeString(env.DOSSIER_ANTHROPIC_MODEL || ''),
      normalizeString(env.ANTHROPIC_DOSSIER_MODEL || ''),
      normalizeString(env.CLAUDE_DOSSIER_MODEL || ''),
      normalizeString(dossierAnthropicModel || ''),
      normalizeString(env.ANTHROPIC_MODEL || ''),
      normalizeString(env.CLAUDE_MODEL || ''),
      normalizeString(anthropicModel || ''),
      'claude-opus-4-6',
    ];
    return candidates.find((value) => Boolean(value)) || 'claude-opus-4-6';
  };

  const getAnthropicDossierMaxTokens = () => {
    const fallback = 6000;
    return Math.max(
      2000,
      Math.min(24000, Number(env.ANTHROPIC_DOSSIER_MAX_TOKENS || fallback) || fallback)
    );
  };

  return {
    formatEuroLabel,
    getAnthropicApiKey,
    getAnthropicDossierMaxTokens,
    getColdcallingProvider,
    getColdcallingStackLabel,
    getDossierAnthropicModel,
    getMissingEnvVars,
    getOpenAiApiKey,
    getRequiredRetellEnv,
    getRequiredTwilioEnv,
    getWebsiteAnthropicModel,
    getWebsiteGenerationProvider,
    inferCallProvider,
    isRetellColdcallingConfigured,
    isTwilioColdcallingConfigured,
    isTwilioStatusApiConfigured,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    resolveColdcallingProviderForCampaign,
    toBooleanSafe,
  };
}

module.exports = {
  createRuntimeHelpers,
};
