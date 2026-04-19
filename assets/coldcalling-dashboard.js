(function () {
  const launchBtn = document.getElementById('launchBtn');
  const leadSlider = document.getElementById('leadSlider');

  if (!launchBtn || !leadSlider) {
    return;
  }
  const topbarTitleEl = document.querySelector('.topbar .topbar-left h1');
  const topbarSubtitleEl = document.querySelector('.topbar .topbar-left p');
  const defaultTopbarTitleText = String(topbarTitleEl?.textContent || "Website's").trim();
  const defaultTopbarSubtitleText = String(topbarSubtitleEl?.textContent || '').trim();

  let isSubmitting = false;
  let uiLogCount = 0;
  let activeSheetInput = null;
  let lastCallUpdateSeenMs = 0;
  let callUpdatePollTimer = null;
  let isPollingCallUpdates = false;
  let isPollingSequentialClientDirectStatus = false;
  let statusMessageHideTimer = null;
  let activeSequentialClientDispatch = null;
  const defaultLaunchBtnHtml = launchBtn.innerHTML;
  const TEST_LEAD_STORAGE_KEY = 'softora_coldcalling_test_lead_phone';
  const LEAD_ROWS_STORAGE_KEY = 'softora_coldcalling_lead_rows_json';
  const AI_NOTEBOOK_ROWS_STORAGE_KEY = 'softora_ai_notebook_rows_json';
  const LEAD_DATABASE_OVERRIDES_STORAGE_KEY = 'softora_coldcalling_lead_database_overrides_json';
  const CALL_DISPATCH_MODE_STORAGE_KEY = 'softora_call_dispatch_mode';
  const CALL_DISPATCH_DELAY_STORAGE_KEY = 'softora_call_dispatch_delay_seconds';
  const STATS_RESET_BASELINE_STORAGE_KEY = 'softora_stats_reset_baseline_started';
  const CAMPAIGN_AMOUNT_SLIDER_INDEX_STORAGE_KEY = 'softora_campaign_amount_slider_index';
  const CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY = 'softora_campaign_amount_custom';
  const CAMPAIGN_BRANCHE_STORAGE_KEY = 'softora_campaign_branche';
  const CAMPAIGN_REGIO_STORAGE_KEY = 'softora_campaign_regio';
  const CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY = 'softora_campaign_regio_custom_km';
  const CAMPAIGN_MIN_PRICE_STORAGE_KEY = 'softora_campaign_min_price';
  const CAMPAIGN_MAX_DISCOUNT_STORAGE_KEY = 'softora_campaign_max_discount';
  const CAMPAIGN_INSTRUCTIONS_STORAGE_KEY = 'softora_campaign_instructions';
  const CAMPAIGN_COLDCALLING_STACK_STORAGE_KEY = 'softora_campaign_coldcalling_stack';
  const CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY = 'softora_campaign_fill_agenda_10_workdays';
  const BUSINESS_MODE_STORAGE_KEY = 'softora_business_mode';
  const DEFAULT_CAMPAIGN_REGIO_VALUE = 'unlimited';
  const CUSTOM_CAMPAIGN_REGIO_VALUE = 'custom';
  const REMOTE_UI_STATE_SCOPE_BASE = 'coldcalling';
  const REMOTE_UI_STATE_SCOPE_PREFERENCES = 'coldcalling_preferences';
  const BUSINESS_MODE_ORDER = ['websites', 'voice_software', 'business_software'];
  let activeBusinessMode = 'websites';
  let remoteUiStateCache = Object.create(null);
  let remoteUiStateLoaded = false;
  let remoteUiStateLoadingPromise = null;
  let remoteUiStateSaveTimer = null;
  let remoteUiStateFlushPromise = null;
  let remoteUiStatePendingPatch = Object.create(null);
  let remoteUiStateLastSource = '';
  let remoteUiStateLastError = '';
  let dashboardStatsPollTimer = null;
  let dashboardStatsRefreshPromise = null;
  let latestStatsSummary = {
    started: 0,
    answered: 0,
    interested: 0,
    conversionPct: 0,
  };
  let coldcallingDashboardBootstrapPayload = null;
  const sharedCallSummaryCacheByCallId = Object.create(null);

  function byId(id) {
    return document.getElementById(id);
  }

  function setLeadSliderReadyState(isReady) {
    const sliderStage = byId('leadSliderStage');
    if (!sliderStage) return;
    sliderStage.dataset.sliderReady = isReady ? '1' : '0';
    if (isReady) {
      sliderStage.removeAttribute('aria-hidden');
      return;
    }
    sliderStage.setAttribute('aria-hidden', 'true');
  }

  function readColdcallingDashboardBootstrapPayload() {
    const element = document.getElementById('softoraColdcallingDashboardBootstrap');
    if (!element) return null;
    try {
      const parsed = JSON.parse(String(element.textContent || '{}'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function openLeadDatabaseFromCampaignControl() {
    const dbModal = ensureLeadDatabaseModal();
    if (!dbModal || typeof dbModal.openLeadDatabaseModal !== 'function') return false;
    void dbModal.openLeadDatabaseModal();
    return true;
  }

  function prewarmLeadDatabaseFromCampaignControl(options = {}) {
    const dbModal = ensureLeadDatabaseModal();
    if (!dbModal || typeof dbModal.prewarmLeadDatabase !== 'function') return false;
    void dbModal.prewarmLeadDatabase(options);
    return true;
  }

  function bindLeadDatabaseOpenControl() {
    window.openLeadDatabaseModalFromCampaign = openLeadDatabaseFromCampaignControl;
    const button = byId('openLeadListModalBtn');
    if (button && button.dataset.dbOpenBound !== '1') {
      button.dataset.dbOpenBound = '1';
      const warmupLeadDatabase = () => {
        prewarmLeadDatabaseFromCampaignControl();
      };
      button.addEventListener('pointerenter', warmupLeadDatabase, { passive: true });
      button.addEventListener('focus', warmupLeadDatabase);
      button.addEventListener('touchstart', warmupLeadDatabase, { passive: true });
      button.addEventListener('pointerdown', warmupLeadDatabase, { passive: true });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        warmupLeadDatabase();
        openLeadDatabaseFromCampaignControl();
      });
    }
    return button;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getNowTime() {
    return new Date().toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeFreeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeSearchText(value) {
    return normalizeFreeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function looksLikeConversationTranscript(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const lower = normalizeSearchText(raw);
    if (/(^|\s)(user|bot|agent|klant)\s*:/.test(lower)) return true;
    if (raw.includes('|') && /(user|bot|agent|klant)\s*:/i.test(raw)) return true;
    if (raw.split(/\||\n/).length >= 4 && /(user|bot|agent|klant)\s*:/i.test(raw)) return true;
    return false;
  }

  function replaceGenericSoftoraSpeakerName(value) {
    return String(value || '')
      .replace(/\bde\s+agent van\s+softora\b/gi, 'Ruben Nijhuis van Softora')
      .replace(/\bsoftora[-\s]?agent\b/gi, 'Ruben Nijhuis van Softora')
      .replace(/\bde\s+agent\b/gi, 'Ruben Nijhuis')
      .replace(/\been\s+agent\b/gi, 'Ruben Nijhuis')
      .replace(/\bagent\b/gi, 'Ruben Nijhuis')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function stripConversationDialogueMarkers(value) {
    const stripped = String(value || '')
      .replace(/\s*\|\s*/g, ' ')
      .replace(/\b(user|bot|agent|klant)\s*:\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return replaceGenericSoftoraSpeakerName(stripped);
  }

  function stripActionableFollowUpSummarySentence(value) {
    return String(value || '')
      .replace(
        /\s*(?:De\s+)?(?:logische\s+)?vervolgstap(?:\s*:\s*|\s+is(?:\s+om)?\s+|\s+om\s+)[^.?!]*(?:[.?!]|$)/gi,
        ' '
      )
      .replace(
        /\s*(?:Aanbevolen|Beste|Volgende)\s+(?:vervolgstap|stap)(?:\s*:\s*|\s+is(?:\s+om)?\s+|\s+om\s+)[^.?!]*(?:[.?!]|$)/gi,
        ' '
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function sanitizeConversationSummaryCopy(value) {
    const stripped = stripConversationDialogueMarkers(value);
    return stripActionableFollowUpSummarySentence(stripped.replace(/\s*\n+\s*/g, ' ').trim());
  }

  function looksLikeDirectSpeechConversationSummary(value) {
    const raw = sanitizeConversationSummaryCopy(value);
    if (!raw) return false;
    const lower = raw.toLowerCase();
    if (/^(hallo|hoi|hey|goedemiddag|goedemorgen|goedenavond|met\s+\w+|ja[,\s]|nee[,\s]|oke?[,\s]|prima[,\s])/.test(lower)) {
      return true;
    }
    if (/\bje spreekt met\b|\bik bel je\b|\bkan ik\b|\bweet je wat we doen\b|\bik wil graag meteen\b/i.test(raw)) {
      return true;
    }
    const questionCount = (raw.match(/\?/g) || []).length;
    const commaCount = (raw.match(/,/g) || []).length;
    return questionCount >= 1 && commaCount >= 3 && raw.length >= 140;
  }

  function looksLikeAbruptConversationSummary(value) {
    const raw = sanitizeConversationSummaryCopy(value);
    if (!raw) return false;
    return /(\.\.\.|…)$/.test(raw);
  }

  function looksMixedLanguageConversationSummary(value) {
    const normalized = sanitizeConversationSummaryCopy(value).toLowerCase();
    if (!normalized) return false;
    const strongMatches =
      (
        normalized.match(
          /\b(the|call|conversation|agent|user|brief|outbound|inbound|ended|shortly|mentioned|during|standards|expectations|activities|interaction|follow-up|meeting|appointment|summary|details)\b/g
        ) || []
      ).length;
    const mildMatches = (normalized.match(/\b(was|were|is|are|had|with|after|before|where|for)\b/g) || []).length;
    return strongMatches >= 2 || (strongMatches >= 1 && mildMatches >= 3) || mildMatches >= 6;
  }

  function pickReadableConversationSummary() {
    const candidates = Array.from(arguments);
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      if (isGenericConversationPlaceholder(raw)) continue;
      if (looksLikeConversationTranscript(raw)) continue;
      const cleaned = sanitizeConversationSummaryCopy(raw);
      if (isGenericConversationPlaceholder(cleaned)) continue;
      if (looksLikeAgendaConfirmationSummary(cleaned)) continue;
      if (looksMixedLanguageConversationSummary(cleaned)) continue;
      if (looksLikeDirectSpeechConversationSummary(cleaned)) continue;
      if (looksLikeAbruptConversationSummary(cleaned)) continue;
      if (cleaned) return cleaned;
    }
    return '';
  }

  function isAbortLikeLoadError(error) {
    const text = normalizeSearchText(error?.message || error || '');
    return /abort|aborted|signal is aborted/.test(text);
  }

  function looksLikeAgendaConfirmationSummary(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(^op \d{4}-\d{2}-\d{2}\b|^namens\b|afspraak ingepland|bevestigingsbericht|definitieve bevestiging|twee collega|langskomen|volgactie|bevestigingsmail sturen|stuur(?:\s+\w+){0,3}\s+bevestigingsmail|gedetecteerde afspraak|afspraakbevestiging|agenda-item)/.test(
      text
    );
  }

  function isGenericConversationPlaceholder(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return (
      text === 'nog geen gesprekssamenvatting beschikbaar.' ||
      text === 'samenvatting volgt na verwerking van het gesprek.' ||
      text === 'samenvatting wordt opgesteld op basis van de transcriptie.'
    );
  }

  async function summarizeConversationTextNl(text, options = {}) {
    if (!window.SoftoraAI || typeof window.SoftoraAI.summarizeText !== 'function') return '';
    const payload = {
      text: String(text || ''),
      style: options.style || 'medium',
      language: 'nl',
      maxSentences: Number(options.maxSentences || 4),
      extraInstructions: String(options.extraInstructions || ''),
    };
    const result = await window.SoftoraAI.summarizeText(payload);
    return String(result?.summary || '').trim();
  }

  function readSharedCallSummaryCache() {
    return sharedCallSummaryCacheByCallId;
  }

  function getSharedCallSummary(callId) {
    const normalizedCallId = normalizeFreeText(callId);
    if (!normalizedCallId) return '';
    const cache = readSharedCallSummaryCache();
    const summary = String(cache?.[normalizedCallId] || '').trim();
    const cleanedSummary = pickReadableConversationSummary(summary);
    if (!cleanedSummary || looksLikeAgendaConfirmationSummary(cleanedSummary)) {
      if (summary) {
        delete cache[normalizedCallId];
      }
      return '';
    }
    return cleanedSummary;
  }

  function setSharedCallSummary(callId, summary) {
    const normalizedCallId = normalizeFreeText(callId);
    const normalizedSummary = pickReadableConversationSummary(summary);
    if (
      !normalizedCallId ||
      !normalizedSummary ||
      isGenericConversationPlaceholder(normalizedSummary) ||
      looksLikeAgendaConfirmationSummary(normalizedSummary)
    ) {
      return;
    }
    const cache = readSharedCallSummaryCache();
    if (String(cache?.[normalizedCallId] || '').trim() === normalizedSummary) return;
    cache[normalizedCallId] = normalizedSummary;
  }

  function normalizeBusinessMode(mode) {
    const raw = String(mode || '').trim().toLowerCase();
    if (raw === 'voice_software' || raw === 'voice software' || raw === 'voicesoftware') {
      return 'voice_software';
    }
    if (
      raw === 'business_software' ||
      raw === 'business software' ||
      raw === 'businesssoftware' ||
      raw === 'bedrijfssoftware' ||
      raw === 'bedrijfs_software' ||
      raw === 'bedrijfs software'
    ) {
      return 'business_software';
    }
    return 'websites';
  }

  function normalizeColdcallingStack(value) {
    const raw = String(value || '').trim().toLowerCase();
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

  function getColdcallingStackLabel(value) {
    const normalized = normalizeColdcallingStack(value);
    if (normalized === 'gemini_flash_3_1_live') return 'Gemini 3.1 Live';
    if (normalized === 'openai_realtime_1_5') return 'OpenAI Realtime 1.5';
    if (normalized === 'hume_evi_3') return 'Hume Evi 3';
    return 'Retell AI';
  }

  function syncCustomSelectUi(selectEl) {
    if (selectEl && typeof selectEl.__softoraSyncCustomFormSelect === 'function') {
      selectEl.__softoraSyncCustomFormSelect();
    }
  }

  function getCurrentBusinessMode() {
    return normalizeBusinessMode(activeBusinessMode);
  }

  function getCurrentUiStateScope() {
    const mode = getCurrentBusinessMode();
    if (mode === 'voice_software') {
      return `${REMOTE_UI_STATE_SCOPE_BASE}_voice_software`;
    }
    if (mode === 'business_software') {
      return `${REMOTE_UI_STATE_SCOPE_BASE}_business_software`;
    }
    return REMOTE_UI_STATE_SCOPE_BASE;
  }

  function getBusinessModeUiConfig(mode = getCurrentBusinessMode()) {
    const normalized = normalizeBusinessMode(mode);
    if (normalized === 'voice_software') {
      return {
        title: 'Voicesoftware',
        subtitle: 'Voice-agent campagne configureren & starten',
        leadListLabel: 'Bedrijvenregister',
        leadListGroup: 'Database',
        dbHint: 'Voice-agent bellijst met AI-status per bedrijf.',
      };
    }
    if (normalized === 'business_software') {
      return {
        title: 'Bedrijfssoftware',
        subtitle: 'AI coldcalling campagne voor bedrijfssoftware projecten',
        leadListLabel: 'Bedrijvenregister',
        leadListGroup: 'Database',
        dbHint: 'Bellijst voor bedrijfssoftware leads met AI-status per bedrijf.',
      };
    }

    return {
      title: defaultTopbarTitleText || "Website's",
      subtitle: defaultTopbarSubtitleText || 'Website-campagne configureren & starten',
      leadListLabel: 'Bedrijvenregister',
      leadListGroup: 'Database',
      dbHint: 'Zakelijke bellijst met AI-status per bedrijf.',
    };
  }

  function formatLeadDatabasePhone(phone) {
    const raw = normalizeFreeText(phone);
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('31')) {
      return `+31 ${digits.slice(2, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 10 && digits.startsWith('0')) {
      return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    }
    return raw;
  }

  function normalizeLeadDatabaseDecision(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^(pending|nieuw|new|not_called|nog[-_ ]?niet[-_ ]?gebeld)$/.test(raw)) return 'pending';
    if (/^(called|gebeld)$/.test(raw)) return 'called';
    if (/^(no_answer|niet[-_ ]?opgenomen|geen[-_ ]?gehoor|busy|voicemail|missed)$/.test(raw)) return 'no_answer';
    if (/^(callback|terugbellen|follow[-_ ]?up)$/.test(raw)) return 'callback';
    if (/^(appointment|afspraak|meeting)$/.test(raw)) return 'appointment';
    if (/^(customer|klant|closed|won)$/.test(raw)) return 'customer';
    if (/^(do_not_call|dnc|uit[-_ ]?bellijst|stop|blacklist|remove)$/.test(raw)) return 'do_not_call';
    return '';
  }

  function getLeadDatabaseDecisionLabel(decision) {
    const normalized = normalizeLeadDatabaseDecision(decision);
    if (normalized === 'pending') return 'Nog niet gebeld';
    if (normalized === 'called') return 'Gebeld';
    if (normalized === 'no_answer') return 'Niet opgenomen';
    if (normalized === 'callback') return 'Terugbellen';
    if (normalized === 'appointment') return 'Wil afspraak';
    if (normalized === 'customer') return 'Klant';
    if (normalized === 'do_not_call') return 'Uit bellijst';
    return 'Onbekend';
  }

  function getLeadDatabaseDecisionStyle(decision, theme) {
    const normalized = normalizeLeadDatabaseDecision(decision);
    if (normalized === 'pending') {
      return { bg: getConversationThemeMode() === 'light' ? '#f3f4f6' : 'rgba(143,149,163,0.2)', color: theme.textMuted };
    }
    if (normalized === 'called') {
      return { bg: getConversationThemeMode() === 'light' ? '#e8efff' : 'rgba(122,162,255,0.22)', color: theme.text };
    }
    if (normalized === 'no_answer') {
      return { bg: getConversationThemeMode() === 'light' ? '#f8d7de' : 'rgba(231,114,139,0.28)', color: theme.text };
    }
    if (normalized === 'callback') {
      return { bg: getConversationThemeMode() === 'light' ? '#fff1d8' : 'rgba(240,179,122,0.24)', color: theme.text };
    }
    if (normalized === 'appointment') {
      return { bg: getConversationThemeMode() === 'light' ? '#e2f7ed' : 'rgba(124,226,170,0.24)', color: theme.text };
    }
    if (normalized === 'customer') {
      return { bg: getConversationThemeMode() === 'light' ? '#d4f3e2' : 'rgba(68,202,140,0.32)', color: theme.text };
    }
    if (normalized === 'do_not_call') {
      return { bg: getConversationThemeMode() === 'light' ? '#ffdce1' : 'rgba(239,106,128,0.34)', color: theme.text };
    }
    return { bg: theme.blockBg, color: theme.textMuted };
  }

  function getSavedLeadDatabaseOverrides() {
    const raw = readStorage(LEAD_DATABASE_OVERRIDES_STORAGE_KEY).trim();
    if (!raw) return Object.create(null);
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.create(null);
      const normalized = Object.create(null);
      Object.entries(parsed).forEach(([key, value]) => {
        const phone = phoneKey(key);
        if (!phone) return;
        const row = value && typeof value === 'object' ? value : { decision: String(value || '') };
        const decision = normalizeLeadDatabaseDecision(row.decision || row.status || '');
        if (!decision) return;
        normalized[phone] = {
          decision,
          note: normalizeFreeText(row.note || ''),
          updatedAt: normalizeFreeText(row.updatedAt || ''),
        };
      });
      return normalized;
    } catch {
      return Object.create(null);
    }
  }

  function saveLeadDatabaseOverrides(overrides) {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    const out = Object.create(null);
    Object.entries(source).forEach(([key, value]) => {
      const phone = phoneKey(key);
      if (!phone) return;
      const decision = normalizeLeadDatabaseDecision(value?.decision || value?.status || '');
      if (!decision) return;
      out[phone] = {
        decision,
        note: normalizeFreeText(value?.note || ''),
        updatedAt: normalizeFreeText(value?.updatedAt || ''),
      };
    });
    writeStorage(LEAD_DATABASE_OVERRIDES_STORAGE_KEY, JSON.stringify(out));
  }

  function getDoNotCallPhoneKeys() {
    const overrides = getSavedLeadDatabaseOverrides();
    const blocked = new Set();
    Object.entries(overrides).forEach(([phone, value]) => {
      if (normalizeLeadDatabaseDecision(value?.decision) === 'do_not_call') {
        blocked.add(phoneKey(phone));
      }
    });
    return blocked;
  }

  function isDeprecatedTestLeadRowLike(row) {
    const companyKey = normalizeSearchText(row?.company || row?.name || '');
    const phoneDigits = phoneKey(row?.phone || '');
    if (companyKey === 'softora test' || companyKey === 'testco') return true;
    if (phoneDigits === '31999999999') return true;
    return false;
  }

  function isServeCreusenRowLike(row) {
    const haystack = normalizeSearchText(
      [
        row?.company || row?.name || '',
        row?.contactPerson || row?.contact || row?.contactName || row?.contactpersoon || '',
      ].join(' ')
    );
    return /\bserve creusen\b/.test(haystack);
  }

  function usesStandaloneCustomSliderValue() {
    return String(leadSlider.dataset?.customValueMode || '').toLowerCase() !== 'sync-slider';
  }

  function getLeadSliderAmount() {
    const rawValue = Math.max(1, parseNumber(leadSlider.value, 1));
    const customValue = Math.round(parseNumber(leadSlider.dataset?.customValue, NaN));
    if (usesStandaloneCustomSliderValue() && Number.isFinite(customValue) && customValue > 0) {
      return customValue;
    }
    const mapRaw = String(leadSlider.dataset?.valueMap || '').trim();

    if (!mapRaw) {
      return rawValue;
    }

    const mappedValues = mapRaw
      .split(',')
      .map((item) => Number(String(item).trim()))
      .filter((item) => Number.isFinite(item) && item > 0);

    if (mappedValues.length === 0) {
      return rawValue;
    }

    const rawIndex = Math.round(parseNumber(leadSlider.value, 0));
    const safeIndex = Math.max(0, Math.min(mappedValues.length - 1, rawIndex));
    return mappedValues[safeIndex];
  }

  function renderLeadAmountDisplay() {
    const leadValueEl = byId('leadValue');
    if (!leadValueEl) return;
    const amount = getLeadSliderAmount();
    const maxAmount = Math.max(1, Math.round(parseNumber(leadSlider?.max, 1)));
    const displayAmount = amount >= maxAmount ? '&infin;' : String(amount);
    const inlineInput = leadValueEl.querySelector('.slider-value-input');
    if (inlineInput) {
      inlineInput.value = displayAmount === '&infin;' ? '∞' : String(amount);
      const length = Math.max(1, String(inlineInput.value || '').length);
      inlineInput.style.width = `${Math.max(2, length)}ch`;
      return;
    }
    leadValueEl.innerHTML = `${displayAmount} <span>mensen</span>`;
  }

  function positionLeadSliderLabels(sliderEl = leadSlider) {
    if (!(sliderEl instanceof HTMLInputElement)) return;
    const labelsWrap = sliderEl.parentElement?.querySelector('.slider-labels');
    if (!labelsWrap) return;
    const min = Math.max(0, Math.round(parseNumber(sliderEl.min, 0)));
    const max = Math.max(min, Math.round(parseNumber(sliderEl.max, min)));
    labelsWrap.querySelectorAll('[data-slider-label-value]').forEach((labelEl) => {
      const rawValue = String(labelEl.getAttribute('data-slider-label-value') || '').trim();
      const parsedValue = Math.round(parseNumber(rawValue, NaN));
      if (!Number.isFinite(parsedValue)) return;
      const clampedValue = Math.max(min, Math.min(max, parsedValue));
      const ratio = max > min ? (clampedValue - min) / (max - min) : 0;
      labelEl.style.setProperty('--slider-label-position', `${ratio * 100}%`);
    });
  }

  function readPositiveIntStorage(key, fallback = null) {
    const raw = readStorage(key).trim();
    if (!raw) return fallback;
    const parsed = Math.round(Number(raw));
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
  }

  function getCampaignRegioOption(selectEl, value) {
    if (!(selectEl instanceof HTMLSelectElement)) return null;
    return Array.from(selectEl.options || []).find((option) => String(option.value) === String(value)) || null;
  }

  function formatCampaignCustomRegioLabel(km) {
    const normalizedKm = Math.max(1, Math.round(Number(km) || 1));
    return `Aangepast (${normalizedKm} km)`;
  }

  function applyCampaignRegioSelection(selectEl, selectedValue, customKm = null) {
    if (!(selectEl instanceof HTMLSelectElement)) return;

    const customOption = getCampaignRegioOption(selectEl, CUSTOM_CAMPAIGN_REGIO_VALUE);
    if (customOption) {
      customOption.textContent =
        Number.isFinite(customKm) && customKm > 0
          ? formatCampaignCustomRegioLabel(customKm)
          : 'Aangepast';
    }

    const safeValue = getCampaignRegioOption(selectEl, selectedValue)
      ? String(selectedValue)
      : DEFAULT_CAMPAIGN_REGIO_VALUE;

    selectEl.value = safeValue;
    selectEl.dataset.lastValue = safeValue;
    syncCustomSelectUi(selectEl);
  }

  async function promptForCustomCampaignRegioKm(initialValue = '') {
    const normalizedInitialValue = String(initialValue || '').trim();
    const validateCustomKm = (rawValue) => {
      const normalizedValue = String(rawValue || '').trim().replace(',', '.');
      const parsed = Math.round(Number(normalizedValue));
      if (!Number.isFinite(parsed) || parsed < 1) {
        return 'Vul een geldig aantal kilometers in.';
      }
      return '';
    };

    if (typeof window.openSiteInputDialog === 'function') {
      const rawValue = await window.openSiteInputDialog({
        title: 'Aangepaste straal',
        message: 'Vul het aantal kilometer in voor deze campagne.',
        initialValue: normalizedInitialValue,
        placeholder: 'Bijv. 35',
        confirmLabel: 'Opslaan',
        cancelLabel: 'Annuleren',
        validate: validateCustomKm,
      });
      if (rawValue == null) return null;
      return Math.round(Number(String(rawValue).trim().replace(',', '.')));
    }

    const fallbackValue = window.prompt('Vul het aantal kilometer in voor deze campagne.', normalizedInitialValue);
    if (fallbackValue == null) return null;
    const validationMessage = validateCustomKm(fallbackValue);
    if (validationMessage) {
      if (typeof window.alert === 'function') {
        window.alert(validationMessage);
      }
      return null;
    }
    return Math.round(Number(String(fallbackValue).trim().replace(',', '.')));
  }

  function restoreCampaignFormStateFromStorage() {
    const sliderIndexRaw = readStorage(CAMPAIGN_AMOUNT_SLIDER_INDEX_STORAGE_KEY).trim();
    const sliderIndex = Math.round(Number(sliderIndexRaw));
    if (sliderIndexRaw && Number.isFinite(sliderIndex) && sliderIndex >= 0) {
      const max = Math.max(0, Math.round(parseNumber(leadSlider.max, 0)));
      const min = Math.max(0, Math.round(parseNumber(leadSlider.min, 0)));
      const safeIndex = Math.max(min, Math.min(max, sliderIndex));
      leadSlider.value = String(safeIndex);
    }

    const customAmount = readPositiveIntStorage(CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY, null);
    if (usesStandaloneCustomSliderValue() && Number.isFinite(customAmount)) {
      leadSlider.dataset.customValue = String(customAmount);
    } else if (!usesStandaloneCustomSliderValue() && Number.isFinite(customAmount)) {
      const max = Math.max(1, Math.round(parseNumber(leadSlider.max, 1)));
      const min = Math.max(1, Math.round(parseNumber(leadSlider.min, 1)));
      leadSlider.value = String(Math.max(min, Math.min(max, customAmount)));
      delete leadSlider.dataset.customValue;
    } else {
      delete leadSlider.dataset.customValue;
    }

    const brancheEl = byId('branche');
    const regioEl = byId('regio');
    const minPriceEl = byId('minPrice');
    const maxDiscountEl = byId('maxDiscount');
    const instructionsEl = byId('instructions');
    const stackEl = byId('coldcallingStack');

    const savedBranche = readStorage(CAMPAIGN_BRANCHE_STORAGE_KEY).trim();
    if (brancheEl && savedBranche && Array.from(brancheEl.options || []).some((opt) => String(opt.value) === savedBranche)) {
      brancheEl.value = savedBranche;
    }

    const savedRegio = readStorage(CAMPAIGN_REGIO_STORAGE_KEY).trim();
    const savedCustomRegioKm = readPositiveIntStorage(CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY, null);
    if (regioEl) {
      if (savedRegio === CUSTOM_CAMPAIGN_REGIO_VALUE && Number.isFinite(savedCustomRegioKm) && savedCustomRegioKm > 0) {
        applyCampaignRegioSelection(regioEl, CUSTOM_CAMPAIGN_REGIO_VALUE, savedCustomRegioKm);
      } else if (savedRegio && Array.from(regioEl.options || []).some((opt) => String(opt.value) === savedRegio)) {
        applyCampaignRegioSelection(regioEl, savedRegio, savedCustomRegioKm);
      } else {
        applyCampaignRegioSelection(regioEl, DEFAULT_CAMPAIGN_REGIO_VALUE, savedCustomRegioKm);
      }
    }

    const savedMinPrice = readStorage(CAMPAIGN_MIN_PRICE_STORAGE_KEY);
    if (minPriceEl && savedMinPrice !== '') {
      minPriceEl.value = savedMinPrice;
    }

    const savedMaxDiscount = readStorage(CAMPAIGN_MAX_DISCOUNT_STORAGE_KEY);
    if (maxDiscountEl && savedMaxDiscount !== '') {
      maxDiscountEl.value = savedMaxDiscount;
    }

    const savedInstructions = readStorage(CAMPAIGN_INSTRUCTIONS_STORAGE_KEY);
    if (instructionsEl && savedInstructions !== '') {
      instructionsEl.value = savedInstructions;
    }

    if (stackEl) {
      const savedStackRaw = readStorage(CAMPAIGN_COLDCALLING_STACK_STORAGE_KEY).trim();
      const savedStack = normalizeColdcallingStack(savedStackRaw || stackEl.value);
      if (Array.from(stackEl.options || []).some((opt) => String(opt.value) === savedStack)) {
        stackEl.value = savedStack;
      } else {
        stackEl.value = 'retell_ai';
      }
      syncCustomSelectUi(stackEl);
    }

    const fillAgendaEl = byId('campaignFillAgendaWorkdays');
    if (fillAgendaEl) {
      const raw = readStorage(CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY).trim().toLowerCase();
      fillAgendaEl.checked = raw === '1' || raw === 'true' || raw === 'yes';
    }

    positionLeadSliderLabels();
    renderLeadAmountDisplay();
  }

  function persistCampaignAmountState() {
    const sliderIndex = Math.round(parseNumber(leadSlider.value, 0));
    writeStorage(CAMPAIGN_AMOUNT_SLIDER_INDEX_STORAGE_KEY, String(Math.max(0, sliderIndex)));

    const customValue = Math.round(parseNumber(leadSlider.dataset?.customValue, NaN));
    if (usesStandaloneCustomSliderValue() && Number.isFinite(customValue) && customValue > 0) {
      writeStorage(CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY, String(customValue));
    } else {
      delete leadSlider.dataset.customValue;
      writeStorage(CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY, '');
    }

    renderLeadAmountDisplay();
  }

  function bindCampaignFormStatePersistence() {
    if (leadSlider.dataset.campaignPersistenceBound === '1') return;
    leadSlider.dataset.campaignPersistenceBound = '1';

    const brancheEl = byId('branche');
    const regioEl = byId('regio');
    const minPriceEl = byId('minPrice');
    const maxDiscountEl = byId('maxDiscount');
    const instructionsEl = byId('instructions');
    const stackEl = byId('coldcallingStack');
    const fillAgendaEl = byId('campaignFillAgendaWorkdays');
    const leadValueEl = byId('leadValue');

    if (fillAgendaEl && fillAgendaEl.dataset.campaignPersistenceBound !== '1') {
      fillAgendaEl.dataset.campaignPersistenceBound = '1';
      fillAgendaEl.addEventListener('change', () => {
        writeStorage(CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY, fillAgendaEl.checked ? '1' : '0');
      });
    }

    leadSlider.addEventListener('input', () => {
      // De pagina-script verwijdert customValue al op slider beweging; wij persistten daarna de nieuwe state.
      persistCampaignAmountState();
    });
    leadSlider.addEventListener('change', persistCampaignAmountState);

    if (leadValueEl && leadValueEl.dataset.campaignPersistenceBound !== '1' && !leadValueEl.querySelector('.slider-value-input')) {
      leadValueEl.dataset.campaignPersistenceBound = '1';
      const persistAfterPrompt = () => {
        window.setTimeout(() => {
          persistCampaignAmountState();
          updateLeadListHint();
        }, 0);
      };
      leadValueEl.addEventListener('click', persistAfterPrompt);
      leadValueEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          persistAfterPrompt();
        }
      });
    }

    if (brancheEl) {
      brancheEl.addEventListener('change', () => writeStorage(CAMPAIGN_BRANCHE_STORAGE_KEY, brancheEl.value));
    }
    if (regioEl) {
      regioEl.addEventListener('change', async () => {
        const selectedValue = String(regioEl.value || '').trim() || DEFAULT_CAMPAIGN_REGIO_VALUE;
        const previousValue = String(regioEl.dataset.lastValue || DEFAULT_CAMPAIGN_REGIO_VALUE).trim() || DEFAULT_CAMPAIGN_REGIO_VALUE;
        const previousCustomKm = readPositiveIntStorage(CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY, null);

        if (selectedValue === CUSTOM_CAMPAIGN_REGIO_VALUE) {
          const initialCustomKm = Number.isFinite(previousCustomKm) && previousCustomKm > 0 ? String(previousCustomKm) : '';
          const customKm = await promptForCustomCampaignRegioKm(initialCustomKm);

          if (Number.isFinite(customKm) && customKm > 0) {
            writeStorage(CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY, String(customKm));
            writeStorage(CAMPAIGN_REGIO_STORAGE_KEY, CUSTOM_CAMPAIGN_REGIO_VALUE);
            applyCampaignRegioSelection(regioEl, CUSTOM_CAMPAIGN_REGIO_VALUE, customKm);
          } else {
            applyCampaignRegioSelection(regioEl, previousValue, previousCustomKm);
            writeStorage(CAMPAIGN_REGIO_STORAGE_KEY, previousValue);
          }

          updateLeadListHint();
          return;
        }

        writeStorage(CAMPAIGN_REGIO_STORAGE_KEY, selectedValue);
        applyCampaignRegioSelection(regioEl, selectedValue, previousCustomKm);
        updateLeadListHint();
      });
    }
    if (minPriceEl) {
      minPriceEl.addEventListener('input', () => writeStorage(CAMPAIGN_MIN_PRICE_STORAGE_KEY, minPriceEl.value));
    }
    if (maxDiscountEl) {
      maxDiscountEl.addEventListener('input', () =>
        writeStorage(CAMPAIGN_MAX_DISCOUNT_STORAGE_KEY, maxDiscountEl.value)
      );
    }
    if (instructionsEl) {
      instructionsEl.addEventListener('input', () =>
        writeStorage(CAMPAIGN_INSTRUCTIONS_STORAGE_KEY, instructionsEl.value)
      );
    }
    if (stackEl) {
      stackEl.addEventListener('change', () => {
        const normalizedStack = normalizeColdcallingStack(stackEl.value);
        if (stackEl.value !== normalizedStack) {
          stackEl.value = normalizedStack;
        }
        writeStorage(CAMPAIGN_COLDCALLING_STACK_STORAGE_KEY, normalizedStack);
        syncCustomSelectUi(stackEl);
      });
    }
  }

  function clearStatusMessageAutoHide() {
    if (statusMessageHideTimer) {
      window.clearTimeout(statusMessageHideTimer);
      statusMessageHideTimer = null;
    }
  }

  function formatClockTime(date) {
    return new Date(date).toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function estimateCampaignCompletionTime(startedCount, campaign) {
    const started = Math.max(0, Number(startedCount) || 0);
    if (started <= 0) return null;

    const avgCallSeconds = 90;
    const mode = String(campaign?.dispatchMode || 'sequential');
    const delaySeconds =
      mode === 'delay' ? Math.max(0, Number(campaign?.dispatchDelaySeconds) || 0) : 0;
    const requestSpreadSeconds = mode === 'parallel' ? 5 : Math.min(20, started);

    let estimateSeconds;
    if (mode === 'parallel') {
      estimateSeconds = avgCallSeconds + requestSpreadSeconds;
    } else if (mode === 'delay') {
      const staggerSeconds = started > 1 ? (started - 1) * delaySeconds : 0;
      estimateSeconds = avgCallSeconds + staggerSeconds + requestSpreadSeconds;
    } else {
      // "1 voor 1": calls happen in sequence, so duration scales roughly with count.
      estimateSeconds = started * avgCallSeconds + requestSpreadSeconds;
    }

    estimateSeconds = Math.max(30, estimateSeconds);

    return new Date(Date.now() + estimateSeconds * 1000);
  }

  function buildCampaignStartedMessage(startedCount, campaign, failedCount = 0) {
    const started = Math.max(0, Number(startedCount) || 0);
    const failed = Math.max(0, Number(failedCount) || 0);
    const personWord = started === 1 ? 'persoon' : 'personen';
    const eta = estimateCampaignCompletionTime(started, campaign);
    const etaText = eta ? ` Verwachte voltooiingstijd is rond ${formatClockTime(eta)}.` : '';
    const failedText = failed > 0 ? ` (${failed} niet gestart)` : '';
    return `Gestart met het bellen van ${started} ${personWord}${failedText}.${etaText}`;
  }

  function syncSequentialClientDispatchButtonState() {
    const run = activeSequentialClientDispatch;
    if (run && !run.completed) {
      setButtonLoading(true, 'Coldcalling bezig...');
      return;
    }
    setButtonLoading(false);
  }

  function clearCompletedSequentialClientDispatchUi() {
    syncSequentialClientDispatchButtonState();
    setStatusPill('idle', '');
    setStatusMessage('', '');
  }

  function cloneUiStateValues(values) {
    const nextValues = Object.create(null);
    if (!values || typeof values !== 'object') {
      return nextValues;
    }

    Object.entries(values).forEach(([k, v]) => {
      nextValues[String(k)] = String(v ?? '');
    });
    return nextValues;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function fetchUiStateGetWithFallback(scope) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    const urls = [`/api/ui-state-get?scope=${encodedScope}`, `/api/ui-state/${encodedScope}`];
    let lastError = null;

    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(
          url,
          {
            method: 'GET',
            cache: 'no-store',
          },
          12000
        );
        if (!response.ok) {
          throw new Error(`UI state GET mislukt (${response.status})`);
        }
        return await response.json().catch(() => ({}));
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('UI state GET mislukt');
  }

  async function fetchUiStateSetWithFallback(scope, body) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    const urls = [`/api/ui-state-set?scope=${encodedScope}`, `/api/ui-state/${encodedScope}`];
    let lastError = null;

    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body || {}),
          },
          12000
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(normalizeString(data?.error || '') || `UI state POST mislukt (${response.status})`);
        }
        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('UI state POST mislukt');
  }

  async function loadSavedStatusPillModeFromSupabase() {
    try {
      const data = await fetchUiStateGetWithFallback(REMOTE_UI_STATE_SCOPE_PREFERENCES);
      const source = String(data?.source || '').trim();
      if (!data?.ok || source !== 'supabase') {
        return 'websites';
      }
      return normalizeBusinessMode(data?.values?.[BUSINESS_MODE_STORAGE_KEY] || 'websites');
    } catch (error) {
      return 'websites';
    }
  }

  async function persistStatusPillModeToSupabase(mode) {
    const normalizedMode = normalizeBusinessMode(mode);
    const data = await fetchUiStateSetWithFallback(REMOTE_UI_STATE_SCOPE_PREFERENCES, {
      patch: {
        [BUSINESS_MODE_STORAGE_KEY]: normalizedMode,
      },
      source: 'assets/coldcalling-dashboard.js',
      actor: 'browser',
    });
    const source = String(data?.source || '').trim();
    if (!data?.ok || source !== 'supabase') {
      throw new Error('Geselecteerde service is niet in Supabase opgeslagen.');
    }
    return normalizedMode;
  }

  function readStorage(key) {
    if (!key) return '';
    return String(remoteUiStateCache[key] ?? '');
  }

  function writeStorage(key, value) {
    if (!key) return;
    const nextValue = String(value ?? '');
    remoteUiStateCache[key] = nextValue;
    remoteUiStatePendingPatch[key] = nextValue;
    scheduleRemoteUiStateSave();
  }

  async function loadRemoteUiState() {
    if (remoteUiStateLoaded) return true;
    if (remoteUiStateLoadingPromise) return remoteUiStateLoadingPromise;
    const scope = getCurrentUiStateScope();

    remoteUiStateLoadingPromise = (async () => {
      try {
        const data = await fetchUiStateGetWithFallback(scope);
        const values = data && data.ok && data.values && typeof data.values === 'object' ? data.values : {};
        remoteUiStateLastSource = String(data?.source || '').trim();
        if (remoteUiStateLastSource !== 'supabase') {
          remoteUiStateLastError = 'UI state wordt niet vanuit Supabase geladen.';
          remoteUiStateLoaded = true;
          return false;
        }

        remoteUiStateCache = cloneUiStateValues(values);
        remoteUiStateLastError = '';
        remoteUiStateLoaded = true;
        return true;
      } catch (error) {
        remoteUiStateLastSource = '';
        remoteUiStateLastError = normalizeString(error?.message || '') || 'UI state load crash';
        remoteUiStateLoaded = true;
        return false;
      } finally {
        remoteUiStateLoadingPromise = null;
      }
    })();

    return remoteUiStateLoadingPromise;
  }

  async function flushRemoteUiStateSave() {
    if (remoteUiStateFlushPromise) return remoteUiStateFlushPromise;
    const scope = getCurrentUiStateScope();

    const patch = remoteUiStatePendingPatch;
    const patchKeys = Object.keys(patch);
    if (patchKeys.length === 0) {
      if (remoteUiStateLoaded && remoteUiStateLastSource === 'supabase') {
        return { ok: true, source: 'supabase' };
      }
      // Nog niet geladen of niet vanuit Supabase — probeer opnieuw te laden
      remoteUiStateLoaded = false;
      const retryLoaded = await loadRemoteUiState();
      if (retryLoaded && remoteUiStateLastSource === 'supabase') {
        return { ok: true, source: 'supabase' };
      }
      return {
        ok: false,
        source: remoteUiStateLastSource || 'unloaded',
        error: remoteUiStateLastError || 'Dashboardconfiguratie is nog niet vanuit Supabase geladen.',
      };
    }

    remoteUiStatePendingPatch = Object.create(null);

    remoteUiStateFlushPromise = (async () => {
      try {
        const data = await fetchUiStateSetWithFallback(scope, {
          patch,
          source: 'assets/coldcalling-dashboard.js',
          actor: 'browser',
        });
        const source = String(data?.source || '').trim();
        if (source !== 'supabase') {
          throw new Error('UI state is niet in Supabase opgeslagen.');
        }

        remoteUiStateLastSource = source;
        remoteUiStateLastError = '';
        return { ok: true, source };
      } catch (error) {
        patchKeys.forEach((key) => {
          remoteUiStatePendingPatch[key] = String(patch[key] ?? '');
        });
        remoteUiStateLastError = normalizeString(error?.message || '') || 'UI state save failed';
        return {
          ok: false,
          source: remoteUiStateLastSource || 'pending',
          error: remoteUiStateLastError,
        };
      } finally {
        remoteUiStateFlushPromise = null;
        if (Object.keys(remoteUiStatePendingPatch).length > 0) {
          scheduleRemoteUiStateSave(800);
        }
      }
    })();

    return remoteUiStateFlushPromise;
  }

  function scheduleRemoteUiStateSave(delayMs = 250) {
    if (remoteUiStateSaveTimer) {
      window.clearTimeout(remoteUiStateSaveTimer);
    }
    remoteUiStateSaveTimer = window.setTimeout(() => {
      remoteUiStateSaveTimer = null;
      void flushRemoteUiStateSave();
    }, delayMs);
  }

  async function persistRemoteUiStateNow() {
    if (remoteUiStateSaveTimer) {
      window.clearTimeout(remoteUiStateSaveTimer);
      remoteUiStateSaveTimer = null;
    }
    return flushRemoteUiStateSave();
  }

  function getSavedDispatchMode() {
    const raw = readStorage(CALL_DISPATCH_MODE_STORAGE_KEY).trim().toLowerCase();
    if (raw === 'parallel' || raw === 'sequential' || raw === 'delay') {
      return raw;
    }
    return 'sequential';
  }

  function getSavedDispatchDelaySeconds() {
    const raw = readStorage(CALL_DISPATCH_DELAY_STORAGE_KEY).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 5;
    }
    return Math.round(parsed);
  }

  function updateDispatchDelayVisibility() {
    const modeEl = byId('callDispatchMode');
    const delayWrap = byId('callDispatchDelayWrap');
    const delayInput = byId('callDispatchDelaySeconds');
    const hintEl = byId('callDispatchHint');
    if (!modeEl || !delayWrap) return;

    const mode = String(modeEl.value || 'sequential');
    const isDelay = mode === 'delay';
    delayWrap.style.display = isDelay ? 'block' : 'none';

    if (delayInput) {
      delayInput.disabled = !isDelay;
    }

    if (!hintEl) return;

    if (mode === 'parallel') {
      hintEl.textContent = 'Alle geselecteerde leads worden direct tegelijk als outbound call-start verzoek verstuurd.';
      return;
    }

    if (mode === 'delay') {
      const delaySeconds = Math.max(0, parseNumber(delayInput?.value, getSavedDispatchDelaySeconds()));
      hintEl.textContent = `Leads worden 1 voor 1 gestart met ${delaySeconds} seconde(n) wachttijd tussen elk startverzoek.`;
      return;
    }

    hintEl.textContent = 'Leads worden 1 voor 1 gestart zonder extra wachttijd ertussen.';
  }

  function getSelectedText(selectId) {
    const el = byId(selectId);
    if (!el) return '';
    const option = el.options[el.selectedIndex];
    return option ? option.text.trim() : String(el.value || '').trim();
  }

  function normalizeCampaignRegionPromptValue(value) {
    const normalized = normalizeFreeText(value);
    if (!normalized) return '';
    if (/^geen limiet$/i.test(normalized)) return '';
    if (/^aangepast\b/i.test(normalized)) return '';
    if (/^\d+\s*km$/i.test(normalized)) return '';
    return normalized;
  }

  function ensureStatusMessageElement() {
    let statusEl = byId('campaignStatusMessage');
    if (statusEl) return statusEl;

    const launchSection = document.querySelector('.launch-section');
    if (!launchSection) return null;

    statusEl = document.createElement('div');
    statusEl.id = 'campaignStatusMessage';
    statusEl.style.display = 'none';
    statusEl.style.margin = '14px 0 18px';
    statusEl.style.padding = '10px 14px';
    statusEl.style.borderRadius = '12px';
    statusEl.style.fontSize = '13px';
    statusEl.style.lineHeight = '1.35';
    statusEl.style.fontWeight = '500';
    statusEl.style.border = '1px solid rgba(255,255,255,0.12)';
    statusEl.style.background = 'rgba(255,255,255,0.035)';
    statusEl.style.color = 'inherit';
    statusEl.style.width = '100%';
    statusEl.style.maxWidth = '100%';
    statusEl.style.textAlign = 'left';
    statusEl.style.boxSizing = 'border-box';
    statusEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)';
    statusEl.style.backdropFilter = 'blur(6px)';
    statusEl.style.webkitBackdropFilter = 'blur(6px)';
    statusEl.style.opacity = '0';
    statusEl.style.transform = 'translateY(-4px)';
    statusEl.style.transition = 'opacity 160ms ease, transform 160ms ease';
    statusEl.style.alignItems = 'center';
    statusEl.style.gap = '10px';
    statusEl.style.position = 'relative';
    statusEl.style.overflow = 'hidden';

    const indicator = document.createElement('div');
    indicator.id = 'campaignStatusMessageIndicator';
    indicator.style.width = '8px';
    indicator.style.height = '8px';
    indicator.style.borderRadius = '999px';
    indicator.style.flex = '0 0 auto';
    indicator.style.background = 'rgba(255,255,255,0.35)';

    const text = document.createElement('div');
    text.id = 'campaignStatusMessageText';
    text.style.minWidth = '0';
    text.style.flex = '1 1 auto';
    text.style.whiteSpace = 'normal';
    text.style.wordBreak = 'break-word';
    text.textContent = '';

    statusEl.appendChild(indicator);
    statusEl.appendChild(text);

    launchSection.insertAdjacentElement('afterend', statusEl);
    return statusEl;
  }

  function setStatusMessage(kind, message) {
    const el = ensureStatusMessageElement();
    if (!el) return;
    const textEl = byId('campaignStatusMessageText');
    const indicatorEl = byId('campaignStatusMessageIndicator');

    clearStatusMessageAutoHide();
    if (textEl) {
      textEl.textContent = message || '';
    } else {
      el.textContent = message || '';
    }
    el.style.display = message ? 'flex' : 'none';
    el.style.opacity = message ? '1' : '0';
    el.style.transform = message ? 'translateY(0)' : 'translateY(-4px)';

    if (kind === 'success') {
      el.style.borderColor = 'rgba(44, 207, 125, 0.20)';
      el.style.background =
        'linear-gradient(90deg, rgba(44, 207, 125, 0.07), rgba(44, 207, 125, 0.02) 48%, rgba(255,255,255,0.02))';
      el.style.boxShadow = 'inset 3px 0 0 rgba(44,207,125,0.65), 0 8px 24px rgba(0,0,0,0.10)';
      el.style.color = 'inherit';
      if (indicatorEl) indicatorEl.style.background = 'rgba(44,207,125,0.95)';
      statusMessageHideTimer = window.setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-4px)';
        window.setTimeout(() => {
          el.style.display = 'none';
        }, 180);
      }, 9000);
    } else if (kind === 'error') {
      el.style.borderColor = 'rgba(255, 99, 99, 0.22)';
      el.style.background =
        'linear-gradient(90deg, rgba(255, 99, 99, 0.07), rgba(255, 99, 99, 0.02) 48%, rgba(255,255,255,0.02))';
      el.style.boxShadow = 'inset 3px 0 0 rgba(255,99,99,0.65), 0 8px 24px rgba(0,0,0,0.10)';
      el.style.color = 'inherit';
      if (indicatorEl) indicatorEl.style.background = 'rgba(255,99,99,0.95)';
    } else if (kind === 'loading') {
      el.style.borderColor = 'rgba(255, 185, 0, 0.20)';
      el.style.background =
        'linear-gradient(90deg, rgba(255, 185, 0, 0.07), rgba(255, 185, 0, 0.02) 48%, rgba(255,255,255,0.02))';
      el.style.boxShadow = 'inset 3px 0 0 rgba(255,185,0,0.65), 0 8px 24px rgba(0,0,0,0.10)';
      el.style.color = 'inherit';
      if (indicatorEl) indicatorEl.style.background = 'rgba(255,185,0,0.95)';
    } else {
      el.style.borderColor = 'rgba(255,255,255,0.12)';
      el.style.background = 'rgba(255,255,255,0.04)';
      el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)';
      el.style.color = 'inherit';
      if (indicatorEl) indicatorEl.style.background = 'rgba(255,255,255,0.35)';
    }
  }

  function setStatusPill(kind, text) {
    const pill = byId('statusPill');
    if (!pill) return;
    if (pill instanceof HTMLSelectElement) {
      pill.dataset.runtimeStatus = String(kind || '');
      pill.dataset.runtimeText = String(text || '');
      return;
    }
    if (pill.dataset.modeToggle === '1') {
      pill.classList.add('active');
      return;
    }

    if (kind === 'success' || kind === 'loading') {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }

    pill.innerHTML = `<span class="dot"></span> ${escapeHtml(text)}`;
  }

  function getStatusPillModeLabel(mode) {
    const normalized = normalizeBusinessMode(mode);
    if (normalized === 'voice_software') return 'Voicesoftware';
    if (normalized === 'business_software') return 'Bedrijfssoftware';
    return "Website's";
  }

  function getSavedStatusPillMode() {
    return normalizeBusinessMode(activeBusinessMode || 'websites');
  }

  function saveStatusPillMode(mode) {
    activeBusinessMode = normalizeBusinessMode(mode);
  }

  function applyStatusPillMode(mode) {
    const pill = byId('statusPill');
    if (!pill) return;

    const normalizedMode = normalizeBusinessMode(mode);
    activeBusinessMode = normalizedMode;
    if (pill instanceof HTMLSelectElement) {
      if (Array.from(pill.options || []).some((opt) => String(opt.value) === normalizedMode)) {
        pill.value = normalizedMode;
      } else {
        pill.value = 'websites';
      }
      pill.dataset.modeToggle = '1';
      pill.dataset.mode = normalizedMode;
      syncCustomSelectUi(pill);
      return;
    }
    pill.dataset.modeToggle = '1';
    pill.dataset.mode = normalizedMode;
    pill.classList.add('active');
    pill.style.cursor = 'pointer';
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.setAttribute('aria-live', 'polite');
    pill.innerHTML = `<span class="dot"></span> ${escapeHtml(getStatusPillModeLabel(normalizedMode))}`;
  }

  function setupStatusPillModeToggle() {
    const pill = byId('statusPill');
    if (!pill) return;

    if (pill instanceof HTMLSelectElement) {
      applyStatusPillMode(getCurrentBusinessMode());
      if (pill.dataset.modeBound === '1') return;
      pill.dataset.modeBound = '1';
      pill.addEventListener('change', () => {
        void switchBusinessMode(pill.value);
      });
      return;
    }

    const toggleMode = async () => {
      const currentMode = normalizeBusinessMode(pill.dataset.mode || getCurrentBusinessMode());
      const currentIndex = Math.max(0, BUSINESS_MODE_ORDER.indexOf(currentMode));
      const nextMode = BUSINESS_MODE_ORDER[(currentIndex + 1) % BUSINESS_MODE_ORDER.length];
      await switchBusinessMode(nextMode);
    };

    applyStatusPillMode(getCurrentBusinessMode());

    if (pill.dataset.modeBound === '1') return;
    pill.dataset.modeBound = '1';
    pill.addEventListener('click', () => {
      void toggleMode();
    });
    pill.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void toggleMode();
      }
    });
  }

  function getActiveLeadPhoneKeys(rows = getSavedLeadRows()) {
    const parsed = parseLeadRows(rows);
    const keys = new Set();
    (Array.isArray(parsed?.leads) ? parsed.leads : []).forEach((lead) => {
      const key = phoneKey(lead?.phone || '');
      if (key) keys.add(key);
    });
    return keys;
  }

  function filterCallLikeRowsForMode(rows, allowedPhoneKeys, allowedCallIds = null) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const phoneKeys = allowedPhoneKeys instanceof Set ? allowedPhoneKeys : new Set();
    const callIds = allowedCallIds instanceof Set ? allowedCallIds : null;
    if (phoneKeys.size === 0 && (!callIds || callIds.size === 0)) return [];

    return rows.filter((row) => {
      const key = phoneKey(row?.phone || row?.lead?.phone || row?.lead?.phoneE164 || '');
      if (key && phoneKeys.has(key)) return true;
      if (callIds) {
        const callId = normalizeFreeText(row?.callId || row?.call_id || '');
        if (callId && callIds.has(callId)) return true;
      }
      return false;
    });
  }

  function resetRemoteUiStateForModeSwitch() {
    if (remoteUiStateSaveTimer) {
      window.clearTimeout(remoteUiStateSaveTimer);
      remoteUiStateSaveTimer = null;
    }
    remoteUiStateCache = Object.create(null);
    remoteUiStateLoaded = false;
    remoteUiStateLoadingPromise = null;
    remoteUiStateFlushPromise = null;
    remoteUiStatePendingPatch = Object.create(null);
    remoteUiStateLastSource = '';
    remoteUiStateLastError = '';
  }

  const FIXED_TOPBAR_TITLE = 'Coldcalling';
  const FIXED_TOPBAR_SUBTITLE =
    'Coldcalling blokkeert automatisch wanneer de agenda in de aankomende 10 werkdagen vol zit.';

  function applyBusinessModeUi() {
    const mode = getCurrentBusinessMode();
    const ui = getBusinessModeUiConfig(mode);

    const topTitle = document.querySelector('.topbar .topbar-left h1');
    const topSubtitle = document.querySelector('.topbar .topbar-left p');
    const leadListGroupLabel = byId('leadListControlLabel');
    const leadListOpenLabel = byId('leadListOpenLabel');
    const dbHint = byId('leadDatabaseHeaderHint');

    if (topTitle) topTitle.textContent = FIXED_TOPBAR_TITLE;
    if (topSubtitle) topSubtitle.textContent = FIXED_TOPBAR_SUBTITLE;
    if (leadListGroupLabel) leadListGroupLabel.textContent = ui.leadListGroup;
    if (leadListOpenLabel) leadListOpenLabel.textContent = ui.leadListLabel;
    if (dbHint) dbHint.textContent = ui.dbHint;
  }

  async function switchBusinessMode(nextModeInput) {
    const nextMode = normalizeBusinessMode(nextModeInput);
    const currentMode = getCurrentBusinessMode();
    if (nextMode === currentMode) {
      applyStatusPillMode(currentMode);
      applyBusinessModeUi();
      return;
    }

    const leadModal = byId('leadListModalOverlay');
    const dbModal = byId('leadDatabaseModalOverlay');
    const notebookModal = byId('aiNotebookModalOverlay');

    if (remoteUiStateLoaded) {
      const saveResult = await persistRemoteUiStateNow();
      if (!saveResult?.ok || String(saveResult?.source || '').trim() !== 'supabase') {
        setStatusPill('error', 'Opslaan mislukt');
        setStatusMessage(
          'error',
          saveResult?.error || 'Huidige dashboardwijzigingen staan nog niet veilig in Supabase.'
        );
        applyStatusPillMode(currentMode);
        applyBusinessModeUi();
        return;
      }
    }

    try {
      await persistStatusPillModeToSupabase(nextMode);
    } catch (error) {
      setStatusPill('error', 'Opslaan mislukt');
      setStatusMessage('error', error?.message || 'Geselecteerde service kon niet in Supabase opgeslagen worden.');
      applyStatusPillMode(currentMode);
      applyBusinessModeUi();
      return;
    }

    if (leadModal && leadModal.style.display !== 'none' && typeof leadModal.closeLeadListModal === 'function') {
      leadModal.closeLeadListModal();
    }
    if (dbModal && dbModal.style.display !== 'none' && typeof dbModal.closeLeadDatabaseModal === 'function') {
      dbModal.closeLeadDatabaseModal();
    }
    if (notebookModal && notebookModal.style.display !== 'none' && typeof notebookModal.closeAiNotebookModal === 'function') {
      notebookModal.closeAiNotebookModal();
    }

    activeBusinessMode = nextMode;
    saveStatusPillMode(nextMode);
    resetRemoteUiStateForModeSwitch();
    lastCallUpdateSeenMs = 0;
    setLeadSliderReadyState(false);

    await loadRemoteUiState();

    const modeEl = byId('callDispatchMode');
    const delayEl = byId('callDispatchDelaySeconds');
    if (modeEl) modeEl.value = getSavedDispatchMode();
    if (delayEl) delayEl.value = String(getSavedDispatchDelaySeconds());
    updateDispatchDelayVisibility();
    restoreCampaignFormStateFromStorage();
    renderLeadAmountDisplay();
    updateLeadListHint();
    updateAiNotebookHint();
    setLeadSliderReadyState(true);
    applyStatusPillMode(nextMode);
    applyBusinessModeUi();
    void refreshDashboardStatsFromSupabase({ force: true, silent: true });
  }

  function updateLogCountLabel() {
    const logCount = byId('logCount');
    if (logCount) {
      logCount.textContent = `${uiLogCount} calls`;
    }
  }

  function addUiLog(type, htmlMessage) {
    const logBody = byId('logBody');
    if (!logBody) return;

    const empty = logBody.querySelector('.log-empty');
    if (empty) empty.remove();

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = [
      `<div class="log-entry-dot ${escapeHtml(type)}"></div>`,
      `<div class="log-entry-text">${htmlMessage}</div>`,
      `<div class="log-entry-time">${escapeHtml(getNowTime())}</div>`,
    ].join('');

    logBody.insertBefore(entry, logBody.firstChild);
    uiLogCount += 1;
    updateLogCountLabel();

    const entries = logBody.querySelectorAll('.log-entry');
    if (entries.length > 80) {
      entries[entries.length - 1].remove();
    }
  }

  function normalizeStatsSummaryValue(value) {
    const parsed = Math.round(Number(value) || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function getStatsResetBaselineState() {
    const raw = readStorage(STATS_RESET_BASELINE_STORAGE_KEY).trim();
    if (!raw) {
      return { started: 0, answered: 0, interested: 0 };
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          started: normalizeStatsSummaryValue(parsed.started),
          answered: normalizeStatsSummaryValue(parsed.answered),
          interested: normalizeStatsSummaryValue(parsed.interested),
        };
      }
    } catch (error) {
      const legacyStarted = normalizeStatsSummaryValue(raw);
      if (legacyStarted > 0) {
        return { started: legacyStarted, answered: 0, interested: 0 };
      }
    }

    return { started: 0, answered: 0, interested: 0 };
  }

  function setStatsResetBaselineState(summary) {
    const normalized = {
      started: normalizeStatsSummaryValue(summary?.started),
      answered: normalizeStatsSummaryValue(summary?.answered),
      interested: normalizeStatsSummaryValue(summary?.interested),
    };
    if (!normalized.started && !normalized.answered && !normalized.interested) {
      writeStorage(STATS_RESET_BASELINE_STORAGE_KEY, '');
      return;
    }
    writeStorage(STATS_RESET_BASELINE_STORAGE_KEY, JSON.stringify(normalized));
  }

  function primeStatsFromBootstrap() {
    if (!coldcallingDashboardBootstrapPayload || typeof coldcallingDashboardBootstrapPayload !== 'object') {
      coldcallingDashboardBootstrapPayload = readColdcallingDashboardBootstrapPayload();
    }
    const payload = coldcallingDashboardBootstrapPayload;
    if (!payload || typeof payload !== 'object') return;

    const statsSummary =
      payload.statsSummary && typeof payload.statsSummary === 'object'
        ? payload.statsSummary
        : payload.statsDisplay && typeof payload.statsDisplay === 'object'
          ? payload.statsDisplay
          : null;
    const statsResetBaseline =
      payload.statsResetBaseline && typeof payload.statsResetBaseline === 'object'
        ? payload.statsResetBaseline
        : null;

    if (statsResetBaseline) {
      setStatsResetBaselineState(statsResetBaseline);
    }
    if (statsSummary) {
      latestStatsSummary = {
        started: normalizeStatsSummaryValue(statsSummary.started),
        answered: normalizeStatsSummaryValue(statsSummary.answered),
        interested: normalizeStatsSummaryValue(statsSummary.interested),
        conversionPct: normalizeStatsSummaryValue(statsSummary.conversionPct),
      };
      updateStats(latestStatsSummary);
    }
  }

  async function resetStatsRowToZero() {
    const previousBaseline = getStatsResetBaselineState();
    setStatsResetBaselineState(latestStatsSummary);
    updateStats(latestStatsSummary);
    const saveResult = await persistRemoteUiStateNow();

    if (!saveResult?.ok || String(saveResult?.source || '').trim() !== 'supabase') {
      setStatsResetBaselineState(previousBaseline);
      updateStats(latestStatsSummary);
      setStatusPill('error', 'Reset mislukt');
      setStatusMessage(
        'error',
        saveResult?.error || 'Dashboard-reset kon niet in Supabase opgeslagen worden.'
      );
      addUiLog('skip', '<strong>Dashboard</strong> - Reset afgewezen omdat Supabase-opslag mislukte.');
      return false;
    }

    setStatusPill('success', 'Reset opgeslagen');
    setStatusMessage('', '');
    addUiLog('skip', '<strong>Dashboard</strong> - Statistiekrij is gereset en opgeslagen in Supabase.');
    return true;
  }

  function setupStatsResetButton() {
    const button = byId('statsResetBtn');
    if (!button || button.dataset.statsResetReady === '1') return;

    button.dataset.statsResetReady = '1';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;

      const message =
        'Weet je zeker dat je de statistieken wilt resetten? De tellers (zoals Totaal gebeld) worden op nul gezet en dit wordt opgeslagen.';
      let confirmed = false;
      if (window.SoftoraDialogs && typeof window.SoftoraDialogs.confirm === 'function') {
        confirmed = await window.SoftoraDialogs.confirm(message, {
          title: 'Statistieken resetten',
          confirmText: 'Resetten',
          cancelText: 'Annuleren',
        });
      } else {
        confirmed = window.confirm(message);
      }
      if (!confirmed) return;

      button.disabled = true;
      button.style.opacity = '0.7';
      button.style.cursor = 'progress';
      try {
        await resetStatsRowToZero();
      } finally {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
      }
    });
  }

  function updateStats(summary) {
    const statCalled = byId('statCalled');
    const statInterested = byId('statInterested');
    const statBooked = byId('statBooked');
    const statConversion = byId('statConversion');
    const safeSummary = summary && typeof summary === 'object' ? summary : {};
    const previousSummary = latestStatsSummary && typeof latestStatsSummary === 'object' ? latestStatsSummary : {};
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(safeSummary, key);
    const startedRaw = hasOwn('started')
      ? normalizeStatsSummaryValue(safeSummary.started)
      : normalizeStatsSummaryValue(previousSummary.started);
    const answeredRaw = hasOwn('answered')
      ? normalizeStatsSummaryValue(safeSummary.answered)
      : normalizeStatsSummaryValue(previousSummary.answered);
    const interestedRaw = hasOwn('interested')
      ? normalizeStatsSummaryValue(safeSummary.interested)
      : normalizeStatsSummaryValue(previousSummary.interested);
    latestStatsSummary = {
      started: startedRaw,
      answered: answeredRaw,
      interested: interestedRaw,
      conversionPct: startedRaw > 0 ? Math.round((Math.min(interestedRaw, startedRaw) / startedRaw) * 100) : 0,
    };
    const baseline = getStatsResetBaselineState();
    const startedDisplay = Math.max(0, startedRaw - normalizeStatsSummaryValue(baseline.started));
    const answeredDisplay = Math.max(0, answeredRaw - normalizeStatsSummaryValue(baseline.answered));
    const interestedDisplay = Math.max(0, interestedRaw - normalizeStatsSummaryValue(baseline.interested));
    const conversionDisplay = startedDisplay > 0 ? Math.round((Math.min(interestedDisplay, startedDisplay) / startedDisplay) * 100) : 0;

    if (statCalled) statCalled.textContent = String(startedDisplay);
    if (statInterested) statInterested.textContent = String(interestedDisplay);
    if (statBooked) statBooked.textContent = String(answeredDisplay);
    if (statConversion) statConversion.textContent = `${conversionDisplay}%`;
  }

  function getDefaultLeadRow() {
    return {
      company: '',
      phone: '',
      region: '',
      contactPerson: '',
      branche: '',
      province: '',
      address: '',
      website: '',
    };
  }

  function normalizeLeadRow(row) {
    const company = String(row?.company || '').trim();
    const phone = String(row?.phone || '').trim();
    const region = String(row?.region || '').trim();
    const contactPerson = String(row?.contactPerson || row?.contact || row?.contactpersoon || '').trim();
    const branche = String(row?.branche || row?.branch || '').trim();
    const province = String(row?.province || row?.provincie || '').trim();
    const address = String(row?.address || row?.adres || '').trim();
    const website = String(row?.website || row?.webiste || '').trim();

    return {
      company,
      phone,
      // Keep legacy saved rows from showing prefilled region values when no lead data exists.
      region: company || phone ? region : '',
      contactPerson,
      branche,
      province,
      address,
      website,
    };
  }

  function ensureMinimumRows(rows, minRows) {
    const out = Array.isArray(rows) ? rows.slice() : [];
    while (out.length < minRows) {
      out.push(getDefaultLeadRow());
    }
    return out.map(normalizeLeadRow);
  }

  function getSavedLeadRows() {
    const raw = readStorage(LEAD_ROWS_STORAGE_KEY).trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const normalized = parsed.map(normalizeLeadRow);
      const filtered = normalized.filter((row) => !isDeprecatedTestLeadRowLike(row));
      if (filtered.length !== normalized.length) {
        saveLeadRows(filtered);
      }
      return filtered;
    } catch {
      return [];
    }
  }

  function saveLeadRows(rows) {
    const serialized = JSON.stringify((rows || []).map(normalizeLeadRow));
    writeStorage(LEAD_ROWS_STORAGE_KEY, serialized);
  }

  function persistLeadRowsDraft(rows) {
    const nextRows = Array.isArray(rows) ? rows : collectLeadRowsFromModal();
    saveLeadRows(nextRows);
    updateLeadListHint();
  }

  function setButtonSavingState(buttonId, isSaving, savingLabel = 'Opslaan...') {
    const button = byId(buttonId);
    if (!button) return;
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || '';
    }
    button.disabled = Boolean(isSaving);
    button.style.opacity = isSaving ? '0.7' : '1';
    button.style.cursor = isSaving ? 'progress' : 'pointer';
    button.textContent = isSaving ? savingLabel : button.dataset.defaultLabel;
  }

  function setLeadModalDraftHint(message) {
    const hint = byId('leadModalDraftHint');
    if (hint) {
      hint.textContent = message;
    }
  }

  function getSpreadsheetColumns() {
    return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
  }

  function getSpreadsheetCellRef(rowIndex, colIndex) {
    const cols = getSpreadsheetColumns();
    const col = cols[colIndex] || 'A';
    return `${col}${rowIndex + 1}`;
  }

  function setActiveSheetInput(input) {
    const formulaInput = byId('leadSheetFormulaInput');
    const nameBox = byId('leadSheetNameBox');

    if (activeSheetInput && activeSheetInput !== input) {
      activeSheetInput.style.outline = '';
      activeSheetInput.style.borderColor = 'transparent';
      activeSheetInput.style.background = '#ffffff';
    }

    activeSheetInput = input || null;

    if (!activeSheetInput) {
      if (formulaInput) formulaInput.value = '';
      if (nameBox) nameBox.textContent = 'A1';
      return;
    }

    activeSheetInput.style.outline = '2px solid #1a73e8';
    activeSheetInput.style.outlineOffset = '-2px';
    activeSheetInput.style.borderColor = 'transparent';
    activeSheetInput.style.background = '#ffffff';

    if (formulaInput) {
      formulaInput.value = activeSheetInput.value || '';
    }

    if (nameBox) {
      const rowIndex = Number(activeSheetInput.getAttribute('data-row-index') || 0);
      const colIndex = Number(activeSheetInput.getAttribute('data-col-index') || 0);
      nameBox.textContent = getSpreadsheetCellRef(rowIndex, colIndex);
    }
  }

  function collectLeadRowsFromModal() {
    const rowsWrap = byId('leadRowsWrap');
    if (!rowsWrap) return getSavedLeadRows();

    const rows = Array.from(rowsWrap.querySelectorAll('[data-lead-row]')).map((rowEl) => ({
      company: rowEl.querySelector('[data-field="company"]')?.value || '',
      phone: rowEl.querySelector('[data-field="phone"]')?.value || '',
      region: rowEl.querySelector('[data-field="region"]')?.value || '',
    }));

    return rows.map(normalizeLeadRow);
  }

  function parseClipboardGridText(text) {
    const raw = String(text || '').replace(/\r/g, '');
    if (!raw.trim()) return [];

    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split('\t').map((cell) => cell.trim()));
  }

  function parseDelimitedLine(line, delimiter) {
    const input = String(line || '');
    const out = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (ch === '"') {
        if (inQuotes && input[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    out.push(current.trim());
    return out;
  }

  function detectDocumentDelimiter(lines) {
    const sample = (Array.isArray(lines) ? lines : [])
      .map((line) => String(line || '').trim())
      .find((line) => line.length > 0);
    if (!sample) return '';
    const counts = {
      '\t': (sample.match(/\t/g) || []).length,
      ';': (sample.match(/;/g) || []).length,
      ',': (sample.match(/,/g) || []).length,
    };
    let best = '';
    let bestCount = 0;
    Object.entries(counts).forEach(([delimiter, count]) => {
      if (count > bestCount) {
        best = delimiter;
        bestCount = count;
      }
    });
    return bestCount > 0 ? best : '';
  }

  function looksLikePhoneNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 8;
  }

  function getLeadImportHeaderMap(cells) {
    const map = {
      company: -1,
      contactPerson: -1,
      phone: -1,
      region: -1,
      branche: -1,
      province: -1,
      address: -1,
      website: -1,
    };
    (Array.isArray(cells) ? cells : []).forEach((cell, index) => {
      const normalized = normalizeSearchText(cell);
      if (map.company < 0 && /(bedrijf|bedrijfsnaam|company|organization|organisatie|onderneming|naam)/.test(normalized)) {
        map.company = index;
      }
      if (
        map.contactPerson < 0 &&
        /(contactpersoon|contact person|contact|beslisser|decision maker|eigenaar|owner|persoon)/.test(normalized)
      ) {
        map.contactPerson = index;
      }
      if (map.phone < 0 && /(telefoon|phone|nummer|gsm|mobiel|mobile|tel)/.test(normalized)) {
        map.phone = index;
      }
      if (map.region < 0 && /(regio|region|plaats|stad|city|provincie|province|land|country)/.test(normalized)) {
        map.region = index;
      }
      if (map.branche < 0 && /(branche|sector|industry|niche)/.test(normalized)) {
        map.branche = index;
      }
      if (map.province < 0 && /(provincie|province|state)/.test(normalized)) {
        map.province = index;
      }
      if (map.address < 0 && /(adres|address|straat|street)/.test(normalized)) {
        map.address = index;
      }
      if (map.website < 0 && /(website|site|url|webiste|domain|domein)/.test(normalized)) {
        map.website = index;
      }
    });
    const hasHeader = map.phone >= 0 || (map.company >= 0 && map.region >= 0);
    return {
      hasHeader,
      company: map.company >= 0 ? map.company : 0,
      contactPerson: map.contactPerson >= 0 ? map.contactPerson : 3,
      phone: map.phone >= 0 ? map.phone : 1,
      region: map.region >= 0 ? map.region : map.province >= 0 ? map.province : 2,
      branche: map.branche >= 0 ? map.branche : 4,
      province: map.province >= 0 ? map.province : 5,
      address: map.address >= 0 ? map.address : 6,
      website: map.website >= 0 ? map.website : 7,
    };
  }

  function parseLeadRowsFromDelimitedText(rawText) {
    const cleanText = String(rawText || '').replace(/\r/g, '\n');
    const lines = cleanText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return { rows: [], detectedDelimiter: '', usedHeader: false };
    }

    const delimiter = detectDocumentDelimiter(lines);
    const grid = delimiter
      ? lines.map((line) => parseDelimitedLine(line, delimiter))
      : lines.map((line) => [line]);

    const header = getLeadImportHeaderMap(grid[0] || []);
    const startIndex = header.hasHeader ? 1 : 0;
    const rows = [];

    for (let i = startIndex; i < grid.length; i += 1) {
      const cells = grid[i] || [];
      const cellA = String(cells[header.company] || '').trim();
      const cellB = String(cells[header.phone] || '').trim();
      const cellC = String(cells[header.region] || '').trim();
      const cellD = String(cells[header.contactPerson] || '').trim();
      const cellE = String(cells[header.branche] || '').trim();
      const cellF = String(cells[header.province] || '').trim();
      const cellG = String(cells[header.address] || '').trim();
      const cellH = String(cells[header.website] || '').trim();

      let company = cellA;
      let phone = cellB;
      let region = cellC;
      let contactPerson = cellD;
      let branche = cellE;
      let province = cellF;
      let address = cellG;
      let website = cellH;

      if (cells.length === 1) {
        const single = String(cells[0] || '').trim();
        if (looksLikePhoneNumber(single)) {
          company = '';
          phone = single;
        } else {
          company = single;
          phone = '';
        }
        region = '';
        contactPerson = '';
        branche = '';
        province = '';
        address = '';
        website = '';
      }

      rows.push(
        normalizeLeadRow({
          company,
          phone,
          region,
          contactPerson,
          branche,
          province,
          address,
          website,
        })
      );
    }

    return {
      rows,
      detectedDelimiter: delimiter || 'line',
      usedHeader: header.hasHeader,
    };
  }

  function parseLeadRowsFromJsonText(rawText) {
    const parsed = JSON.parse(String(rawText || '{}'));
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.leads)
        ? parsed.leads
        : Array.isArray(parsed?.rows)
          ? parsed.rows
          : [];
    const rows = list
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const company = normalizeFreeText(
          item.company || item.bedrijf || item.bedrijfsnaam || item.name || item.naam || ''
        );
        const phone = normalizeFreeText(
          item.phone || item.telefoon || item.nummer || item.mobile || item.gsm || ''
        );
        const region = normalizeFreeText(item.region || item.regio || item.plaats || item.stad || '');
        const contactPerson = normalizeFreeText(item.contactPerson || item.contact || item.contactpersoon || '');
        const branche = normalizeFreeText(item.branche || item.branch || item.sector || '');
        const province = normalizeFreeText(item.province || item.provincie || '');
        const address = normalizeFreeText(item.address || item.adres || '');
        const website = normalizeFreeText(item.website || item.webiste || item.url || '');
        return normalizeLeadRow({ company, phone, region, contactPerson, branche, province, address, website });
      })
      .filter(Boolean);
    return {
      rows,
      detectedDelimiter: 'json',
      usedHeader: false,
    };
  }

  function parseLeadRowsFromUploadedDocument(text, fileName = '') {
    const name = String(fileName || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    if (ext === 'json') {
      return parseLeadRowsFromJsonText(text);
    }
    return parseLeadRowsFromDelimitedText(text);
  }

  function mergeLeadRows(existingRows, importedRows) {
    const out = (Array.isArray(existingRows) ? existingRows : []).map(normalizeLeadRow);
    const byPhone = new Map();
    out.forEach((row, index) => {
      const key = phoneKey(row.phone);
      if (key) byPhone.set(key, index);
    });

    let added = 0;
    let updated = 0;
    let skipped = 0;

    (Array.isArray(importedRows) ? importedRows : []).forEach((row) => {
      const next = normalizeLeadRow(row);
      if (!next.company && !next.phone) {
        skipped += 1;
        return;
      }
      const key = phoneKey(next.phone);
      if (key && byPhone.has(key)) {
        const idx = byPhone.get(key);
        const prev = out[idx];
        out[idx] = normalizeLeadRow({
          company: next.company || prev.company,
          phone: next.phone || prev.phone,
          region: next.region || prev.region,
          contactPerson: next.contactPerson || prev.contactPerson,
          branche: next.branche || prev.branche,
          province: next.province || prev.province,
          address: next.address || prev.address,
          website: next.website || prev.website,
        });
        updated += 1;
        return;
      }
      out.push(next);
      if (key) byPhone.set(key, out.length - 1);
      added += 1;
    });

    return {
      rows: out,
      added,
      updated,
      skipped,
    };
  }

  function applyPasteGridToRows(rows, startRowIndex, startColIndex, grid) {
    const nextRows = Array.isArray(rows) ? rows.map(normalizeLeadRow) : [];
    const fields = ['company', 'phone', 'region'];

    grid.forEach((gridRow, rowOffset) => {
      const targetRowIndex = startRowIndex + rowOffset;
      while (nextRows.length <= targetRowIndex) {
        nextRows.push(getDefaultLeadRow());
      }

      fields.forEach((field, fieldIndex) => {
        const sourceColIndex = fieldIndex - startColIndex;
        if (sourceColIndex < 0) return;
        if (sourceColIndex >= gridRow.length) return;

        const incomingValue = String(gridRow[sourceColIndex] || '').trim();
        nextRows[targetRowIndex][field] = incomingValue;
      });
    });

    return nextRows;
  }

  function renderLeadRows(rows) {
    const rowsWrap = byId('leadRowsWrap');
    if (!rowsWrap) return;

    activeSheetInput = null;
    rowsWrap.style.display = 'flex';
    rowsWrap.style.minHeight = '0';
    const normalizedRows = ensureMinimumRows(rows, 28);
    const columns = getSpreadsheetColumns();
    rowsWrap.innerHTML = '';

    const tableWrap = document.createElement('div');
    tableWrap.style.flex = '1 1 auto';
    tableWrap.style.border = '1px solid #c7c9cc';
    tableWrap.style.borderRadius = '6px';
    tableWrap.style.overflow = 'auto';
    tableWrap.style.background = '#ffffff';
    tableWrap.style.height = '100%';

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.minWidth = '1280px';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const corner = document.createElement('th');
    corner.style.position = 'sticky';
    corner.style.top = '0';
    corner.style.left = '0';
    corner.style.zIndex = '4';
    corner.style.width = '52px';
    corner.style.minWidth = '52px';
    corner.style.background = '#f1f3f4';
    corner.style.border = '1px solid #dadce0';
    corner.style.padding = '0';
    corner.textContent = '';
    headRow.appendChild(corner);

    columns.forEach((letter, colIndex) => {
      const th = document.createElement('th');
      th.style.position = 'sticky';
      th.style.top = '0';
      th.style.zIndex = '3';
      th.style.background = '#f1f3f4';
      th.style.border = '1px solid #dadce0';
      th.style.color = '#202124';
      th.style.fontWeight = '500';
      th.style.fontSize = '12px';
      th.style.height = '28px';
      th.style.padding = '0 8px';
      th.style.textAlign = 'center';
      th.style.minWidth = colIndex < 3 ? '240px' : '120px';
      th.textContent = letter;
      if (colIndex === 0) th.title = 'A = Bedrijfsnaam';
      if (colIndex === 1) th.title = 'B = Telefoonnummer';
      if (colIndex === 2) th.title = 'C = Regio';
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    normalizedRows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-lead-row', 'true');

      const rowNoCell = document.createElement('td');
      rowNoCell.style.position = 'sticky';
      rowNoCell.style.left = '0';
      rowNoCell.style.zIndex = '2';
      rowNoCell.style.background = '#f8f9fa';
      rowNoCell.style.border = '1px solid #e0e0e0';
      rowNoCell.style.width = '52px';
      rowNoCell.style.minWidth = '52px';
      rowNoCell.style.textAlign = 'center';
      rowNoCell.style.fontSize = '12px';
      rowNoCell.style.color = '#5f6368';
      rowNoCell.style.padding = '0';
      rowNoCell.style.height = '28px';
      rowNoCell.textContent = String(index + 1);
      tr.appendChild(rowNoCell);

      columns.forEach((_, colIndex) => {
        const td = document.createElement('td');
        td.style.border = '1px solid #e0e0e0';
        td.style.padding = '0';
        td.style.height = '28px';
        td.style.minWidth = colIndex < 3 ? '240px' : '120px';
        td.style.background = '#ffffff';

        if (colIndex < 3) {
          const fieldMap = ['company', 'phone', 'region'];
          const placeholders = ['Bedrijf BV', '0612345678 / +316...', 'Heel Nederland'];
          const input = document.createElement('input');
          input.type = 'text';
          input.setAttribute('data-field', fieldMap[colIndex]);
          input.setAttribute('data-col-index', String(colIndex));
          input.setAttribute('data-row-index', String(index));
          input.value = String(row[fieldMap[colIndex]] || '');
          input.placeholder = index < 2 ? placeholders[colIndex] : '';
          input.style.width = '100%';
          input.style.height = '27px';
          input.style.border = '0';
          input.style.margin = '0';
          input.style.padding = '0 8px';
          input.style.background = '#ffffff';
          input.style.color = '#202124';
          input.style.fontSize = '13px';
          input.style.outline = 'none';
          input.style.boxSizing = 'border-box';
          td.appendChild(input);
        } else {
          const emptyCell = document.createElement('div');
          emptyCell.style.height = '27px';
          emptyCell.style.background = '#ffffff';
          td.appendChild(emptyCell);
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    rowsWrap.appendChild(tableWrap);

    rowsWrap.querySelectorAll('input[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        setActiveSheetInput(input);
        persistLeadRowsDraft();
        setLeadModalDraftHint('Wijziging automatisch bewaard. Klik "Opslaan lijst" om direct te synchroniseren.');
      });

      input.addEventListener('focus', () => {
        setActiveSheetInput(input);
      });

      input.addEventListener('click', () => {
        setActiveSheetInput(input);
      });

      input.addEventListener('paste', (event) => {
        const clipboardText = event.clipboardData?.getData('text/plain') || '';
        if (!clipboardText) return;

        const grid = parseClipboardGridText(clipboardText);
        if (grid.length === 0) return;

        const startRowIndex = Number(input.getAttribute('data-row-index') || 0);
        const startColIndex = Number(input.getAttribute('data-col-index') || 0);
        const multiCellPaste = grid.length > 1 || (grid[0] && grid[0].length > 1);

        if (!multiCellPaste) {
          return;
        }

        event.preventDefault();
        const currentRows = collectLeadRowsFromModal();
        const nextRows = applyPasteGridToRows(currentRows, startRowIndex, startColIndex, grid);
        renderLeadRows(nextRows);
        persistLeadRowsDraft(nextRows);
        const nextFocus = rowsWrap.querySelector(
          `input[data-row-index="${startRowIndex}"][data-col-index="${startColIndex}"]`
        );
        if (nextFocus) setActiveSheetInput(nextFocus);
        setLeadModalDraftHint(
          `Excel/Sheets plak verwerkt: ${grid.length} rij(en) ingevoegd en bewaard. Klik "Opslaan lijst" om direct te synchroniseren.`
        );
      });
    });

    const firstInput = rowsWrap.querySelector('input[data-row-index="0"][data-col-index="0"]');
    if (firstInput) {
      setActiveSheetInput(firstInput);
    }
  }

  function ensureLeadListModal() {
    let modal = byId('leadListModalOverlay');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'leadListModalOverlay';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(8, 10, 16, 0.72)';
    modal.style.display = 'none';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '16px';
    modal.style.zIndex = '9999';

    modal.innerHTML = [
      '<div id="leadListModalCard" style="width:min(1680px, 99vw); height:min(920px, 94vh); overflow:hidden; border-radius:14px; border:1px solid #c7c9cc; background:#f1f3f4; box-shadow:0 20px 80px rgba(0,0,0,0.45); color:#202124; display:flex; flex-direction:column;">',
      '  <div style="height:56px; background:#ffffff; border-bottom:1px solid #dadce0; display:flex; align-items:center; justify-content:space-between; padding:0 16px; gap:8px;">',
      '    <button type="button" id="leadListCancelBtn" style="height:34px; border:1px solid #dadce0; background:#fff; border-radius:8px; padding:0 12px; cursor:pointer;">Sluiten</button>',
      '    <button type="button" id="leadListSaveBtn" style="height:34px; border:1px solid #c6dafc; background:#d2e3fc; color:#174ea6; border-radius:8px; padding:0 12px; font-weight:600; cursor:pointer;">Opslaan lijst</button>',
      '  </div>',
      '  <div style="padding:8px 12px 6px; background:#f1f3f4;">',
      '    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; font-size:11px; color:#3c4043;">',
      '      <span id="leadModalDraftHint" style="color:#5f6368;">Excel/Sheets plakken wordt ondersteund. Lege regels worden genegeerd.</span>',
      '    </div>',
      '  </div>',
      '  <div style="padding:0 12px 8px; flex:1; min-height:0; background:#f1f3f4;">',
      '    <div id="leadRowsWrap" style="height:100%;"></div>',
      '  </div>',
      '  <div style="height:46px; background:#ffffff; border-top:1px solid #dadce0; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 12px;">',
      '    <div style="display:flex; align-items:center; gap:8px;">',
      '      <button type="button" id="leadListAddRowBtn" style="height:30px; border:1px solid #dadce0; background:#fff; border-radius:6px; padding:0 10px; cursor:pointer;">+10 rijen</button>',
      '      <button type="button" id="leadListClearRowsBtn" style="height:30px; border:1px solid #dadce0; background:#fff; border-radius:6px; padding:0 10px; cursor:pointer;">Lijst wissen</button>',
      '    </div>',
      '    <div style="font-size:11px; color:#5f6368;">Tip: selecteer A1 en plak direct een 3-koloms bereik</div>',
      '  </div>',
      '</div>',
    ].join('');

    document.body.appendChild(modal);

    function closeModal() {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }

    function openModal() {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      renderLeadRows(getSavedLeadRows());
      setLeadModalDraftHint(
        remoteUiStateLastSource === 'supabase'
          ? 'Excel/Sheets plakken wordt ondersteund. Klik op "Opslaan lijst" om direct naar Supabase te bewaren.'
          : 'Excel/Sheets plakken wordt ondersteund. Opslaan werkt alleen als Supabase actief is.'
      );
    }

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    byId('leadListModalCloseTop')?.addEventListener('click', closeModal);
    byId('leadListCancelBtn')?.addEventListener('click', closeModal);

    byId('leadSheetFormulaInput')?.addEventListener('input', (event) => {
      if (!activeSheetInput) return;
      activeSheetInput.value = event.target.value;
      persistLeadRowsDraft();
      setLeadModalDraftHint('Cel aangepast en automatisch bewaard. Klik "Opslaan lijst" om direct te synchroniseren.');
    });

    byId('leadListAddRowBtn')?.addEventListener('click', () => {
      const rows = collectLeadRowsFromModal();
      for (let i = 0; i < 10; i += 1) {
        rows.push(getDefaultLeadRow());
      }
      renderLeadRows(rows);
      persistLeadRowsDraft(rows);
      setLeadModalDraftHint('10 rijen toegevoegd en automatisch bewaard.');
    });

    byId('leadListClearRowsBtn')?.addEventListener('click', () => {
      renderLeadRows([]);
      persistLeadRowsDraft([]);
      setLeadModalDraftHint('Lijst gewist en automatisch bewaard.');
    });

    byId('leadListSaveBtn')?.addEventListener('click', async () => {
      const rows = collectLeadRowsFromModal();
      saveLeadRows(rows);
      updateLeadListHint();
      setButtonSavingState('leadListSaveBtn', true, 'Opslaan...');
      setLeadModalDraftHint('Bezig met opslaan naar Supabase...');
      try {
        const saveResult = await persistRemoteUiStateNow();
        if (!saveResult.ok) {
          setLeadModalDraftHint(
            `Opslaan mislukt. Deze lijst staat nog niet in Supabase.${saveResult.error ? ` ${saveResult.error}` : ''}`
          );
          return;
        }
        const parsed = parseLeadRows(rows);
        if (!parsed.hasInput) {
          setLeadModalDraftHint('Lege lijst opgeslagen in Supabase. Er worden geen calls gestart zonder geldige leads.');
        } else {
          setLeadModalDraftHint(`Opgeslagen in Supabase: ${parsed.leads.length} geldige lead(s).`);
        }
        closeModal();
      } finally {
        setButtonSavingState('leadListSaveBtn', false);
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.style.display !== 'none') {
        closeModal();
      }
    });

    modal.openLeadListModal = openModal;
    modal.closeLeadListModal = closeModal;
    return modal;
  }

  function ensureLeadListPanel() {
    const regioSelect = byId('regio');
    const regioGroup = regioSelect ? regioSelect.closest('.form-group') : null;
    const targetParent = regioGroup?.parentElement || document.querySelector('.generator-grid .panel');
    if (!targetParent) return null;

    const modeUi = getBusinessModeUiConfig();
    let controlWrap = byId('leadListControlWrap');
    if (!controlWrap) {
      controlWrap = document.createElement('div');
      controlWrap.className = 'form-group form-group--lead-list';
      controlWrap.id = 'leadListControlWrap';
      controlWrap.innerHTML = [
        `<label class="form-label" id="leadListControlLabel">${escapeHtml(modeUi.leadListGroup)}</label>`,
        '<button type="button" class="form-input magnetic" id="openLeadListModalBtn" style="text-align:left; display:flex; align-items:center; justify-content:flex-start; gap:12px; cursor:pointer;">',
        `  <span id="leadListOpenLabel">${escapeHtml(modeUi.leadListLabel)}</span>`,
        '</button>',
        '<div id="leadListHint" style="margin-top:8px; font-size:12px; line-height:1.4; opacity:0.85; display:none;"></div>',
      ].join('');

      if (regioGroup) {
        regioGroup.insertAdjacentElement('beforebegin', controlWrap);
      } else {
        targetParent.appendChild(controlWrap);
      }
    }

    let dispatchWrap = byId('callDispatchControlWrap');
    if (!dispatchWrap) {
      dispatchWrap = document.createElement('div');
      dispatchWrap.className = 'form-group form-group--dispatch';
      dispatchWrap.id = 'callDispatchControlWrap';
      dispatchWrap.style.marginTop = '12px';
      dispatchWrap.innerHTML = [
        '<label class="form-label" for="callDispatchMode">Belstrategie</label>',
        '<select class="form-select magnetic" id="callDispatchMode">',
        '  <option value="parallel">Alles tegelijk</option>',
        '  <option value="sequential">1 voor 1</option>',
        '</select>',
        '<div id="callDispatchDelayWrap" style="margin-top:10px; display:none;">',
        '  <label class="form-label" for="callDispatchDelaySeconds">Wachttijd tussen starts (seconden)</label>',
        '  <input type="number" class="form-input magnetic" id="callDispatchDelaySeconds" min="0" step="1" value="5" placeholder="5">',
        '</div>',
      ].join('');

      if (regioGroup) {
        regioGroup.insertAdjacentElement('afterend', dispatchWrap);
      } else {
        controlWrap.insertAdjacentElement('afterend', dispatchWrap);
      }
    }

    // In de single-panel campagne-layout willen we 2 nette rijen:
    // links: Telefoonlijsten + Belstrategie, rechts: Doelgroep + Regio,
    // met de slider erboven over de volledige breedte.
    const generatorGrid = targetParent.closest('.generator-grid');
    const isSinglePanelLayout =
      Boolean(generatorGrid) && generatorGrid.querySelectorAll(':scope > .panel').length === 1;
    if (isSinglePanelLayout) {
      const agendaCapGroup = byId('campaignFillAgendaWorkdays')?.closest('.form-group');
      const sliderGroup = byId('leadSlider')?.closest('.form-group');
      const brancheGroup = byId('branche')?.closest('.form-group');
      const resolvedRegioGroup = byId('regio')?.closest('.form-group') || regioGroup;

      if (agendaCapGroup) {
        agendaCapGroup.style.gridColumn = '1 / -1';
        agendaCapGroup.style.gridRow = '2';
      }
      if (sliderGroup) {
        sliderGroup.style.gridColumn = '1 / -1';
        sliderGroup.style.gridRow = '3';
      }
      if (controlWrap) {
        controlWrap.style.gridColumn = '1';
        controlWrap.style.gridRow = '4';
      }
      if (dispatchWrap) {
        dispatchWrap.style.gridColumn = '1';
        dispatchWrap.style.gridRow = '5';
      }
      if (brancheGroup) {
        brancheGroup.style.gridColumn = '2';
        brancheGroup.style.gridRow = '4';
      }
      if (resolvedRegioGroup) {
        resolvedRegioGroup.style.gridColumn = '2';
        resolvedRegioGroup.style.gridRow = '5';
      }
    }

    const modeEl = byId('callDispatchMode');
    const delayEl = byId('callDispatchDelaySeconds');
    if (modeEl) {
      modeEl.value = getSavedDispatchMode();
      modeEl.addEventListener('change', () => {
        writeStorage(CALL_DISPATCH_MODE_STORAGE_KEY, modeEl.value);
        updateDispatchDelayVisibility();
      });
    }
    if (delayEl) {
      delayEl.value = String(getSavedDispatchDelaySeconds());
      delayEl.addEventListener('input', () => {
        writeStorage(CALL_DISPATCH_DELAY_STORAGE_KEY, delayEl.value);
        updateDispatchDelayVisibility();
      });
    }
    updateDispatchDelayVisibility();

    const button = bindLeadDatabaseOpenControl();

    restoreCampaignFormStateFromStorage();
    if (typeof window.initCustomFormSelects === 'function') {
      window.initCustomFormSelects();
    }
    bindCampaignFormStatePersistence();
    leadSlider.addEventListener('input', updateLeadListHint);
    leadSlider.addEventListener('change', updateLeadListHint);
    updateLeadListHint();
    return button;
  }

  function parseLeadRows(rowsInput) {
    const rows = Array.isArray(rowsInput) ? rowsInput.map(normalizeLeadRow) : [];
    const leads = [];
    const errors = [];
    const seenPhones = new Set();
    let duplicateCount = 0;
    let nonEmptyRowCount = 0;

    rows.forEach((row, idx) => {
      const rowNo = idx + 1;
      // Treat rows without company/phone as empty so prefilled region values don't become "input".
      const hasAnyData = Boolean(row.company || row.phone);
      if (!hasAnyData) {
        return;
      }
      if (isDeprecatedTestLeadRowLike(row)) {
        return;
      }

      const looksLikeHeaderRow =
        /bedrijf|company/i.test(row.company) &&
        /telefoon|phone|nummer/i.test(row.phone) &&
        /regio|region/i.test(row.region);
      if (looksLikeHeaderRow) {
        return;
      }

      nonEmptyRowCount += 1;

      if (!row.phone) {
        errors.push(`Regel ${rowNo}: telefoonnummer ontbreekt.`);
        return;
      }

      const dedupeKey = row.phone.replace(/[^\d+]/g, '');
      if (seenPhones.has(dedupeKey)) {
        duplicateCount += 1;
        return;
      }
      seenPhones.add(dedupeKey);

      const company = row.company || `Lead ${rowNo}`;
      leads.push({
        name: company,
        company,
        phone: row.phone,
        region: row.region || '',
        contactPerson: row.contactPerson || '',
        branche: row.branche || '',
        province: row.province || '',
        address: row.address || '',
        website: row.website || '',
      });
    });

    return {
      leads,
      errors,
      duplicateCount,
      nonEmptyLineCount: nonEmptyRowCount,
      hasInput: nonEmptyRowCount > 0,
    };
  }

  function updateLeadListHint() {
    const hint = byId('leadListHint');
    if (!hint) return;

    const parsed = parseLeadRows(getSavedLeadRows());

    if (!parsed.hasInput) {
      hint.textContent = '';
      hint.style.display = 'none';
      return;
    }

    if (parsed.leads.length === 0) {
      hint.style.display = 'block';
      hint.textContent = `0 geldige leads. ${parsed.errors[0] || 'Controleer Bedrijfsnaam/Telefoonnummer/Regio regels.'}`;
      return;
    }

    const warningBits = [];
    if (parsed.errors.length > 0) warningBits.push(`${parsed.errors.length} ongeldige regel(s)`);
    if (parsed.duplicateCount > 0) warningBits.push(`${parsed.duplicateCount} dubbel(e) nummers`);

    if (warningBits.length > 0) {
      hint.style.display = 'block';
      hint.textContent = `Let op: ${warningBits.join(', ')}.`;
      return;
    }

    hint.textContent = '';
    hint.style.display = 'none';
  }

  async function getManualLeadsFromDashboard(requestedAmount) {
    let parsed = parseLeadRows(getSavedLeadRows());

    if (!parsed.hasInput) {
      const manualInsert = await promptAndSaveSingleManualLead();
      if (!manualInsert?.ok) {
        throw new Error('Geen leadlijst opgeslagen en geen handmatige lead toegevoegd.');
      }
      parsed = parseLeadRows(getSavedLeadRows());
    }

    if (parsed.leads.length === 0) {
      throw new Error(parsed.errors[0] || 'Leadlijst bevat geen geldige regels.');
    }

    const blockedPhoneKeys = getDoNotCallPhoneKeys();
    const filteredLeads = parsed.leads.filter((lead) => {
      const key = phoneKey(lead?.phone);
      if (!key) return true;
      return !blockedPhoneKeys.has(key);
    });
    const excludedDoNotCall = Math.max(0, parsed.leads.length - filteredLeads.length);

    if (filteredLeads.length === 0) {
      throw new Error(
        'Alle leads staan op "Uit bellijst". Open Database en zet minimaal 1 lead terug naar een actieve belstatus.'
      );
    }

    return {
      mode: 'manual',
      leads: filteredLeads.slice(0, Math.max(1, requestedAmount)),
      parsed: {
        ...parsed,
        excludedDoNotCall,
      },
    };
  }

  async function promptForManualLeadDetails(defaults = {}) {
    if (typeof document === 'undefined' || !document.body) {
      const company = normalizeFreeText(window.prompt('Bedrijf', normalizeFreeText(defaults.company || '')));
      if (!company) return { ok: false, cancelled: true };
      const address = normalizeFreeText(window.prompt('Adres', normalizeFreeText(defaults.address || '')));
      const phone = normalizeFreeText(window.prompt('Telefoonnummer', normalizeFreeText(defaults.phone || '')));
      if (!phone) return { ok: false, cancelled: true };
      const website = normalizeFreeText(window.prompt('Website', normalizeFreeText(defaults.website || '')));
      return {
        ok: true,
        values: { company, address, phone, website },
      };
    }

    return new Promise((resolve) => {
      const theme = getConversationThemeTokens();
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '10020';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '24px';
      overlay.style.background = 'rgba(14, 16, 24, 0.5)';
      overlay.style.backdropFilter = 'blur(2px)';

      overlay.innerHTML = `
        <div style="width:min(920px, 100%); border-radius:16px; border:1px solid ${theme.border}; background:${theme.chromeBg}; box-shadow:0 28px 90px rgba(0,0,0,0.28); padding:26px 28px 22px;">
          <div style="font-family:Oswald,sans-serif; font-size:28px; line-height:1; letter-spacing:0.03em; text-transform:uppercase; color:${theme.text};">Lead handmatig toevoegen</div>
          <div style="margin-top:14px; font-size:15px; line-height:1.6; color:${theme.textMuted};">Vul de leadgegevens in. We nemen deze direct op in het bedrijvenregister.</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-top:22px;">
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Bedrijf</span>
              <input type="text" data-manual-lead-company inputmode="text" autocomplete="organization" value="${escapeHtml(normalizeFreeText(defaults.company || ''))}" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Adres</span>
              <input type="text" data-manual-lead-address inputmode="text" autocomplete="street-address" value="${escapeHtml(normalizeFreeText(defaults.address || ''))}" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Telefoonnummer</span>
              <input type="tel" data-manual-lead-phone inputmode="tel" autocomplete="tel" value="${escapeHtml(normalizeFreeText(defaults.phone || ''))}" placeholder="0612345678 of +31612345678" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Website</span>
              <input type="text" data-manual-lead-website inputmode="url" autocomplete="url" value="${escapeHtml(normalizeFreeText(defaults.website || ''))}" placeholder="voorbeeld.nl" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
          </div>
          <div data-manual-lead-error style="min-height:20px; margin-top:14px; font-size:13px; color:#b4235b;"></div>
          <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:12px;">
            <button type="button" data-manual-lead-cancel style="height:48px; min-width:148px; padding:0 22px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-family:Oswald,sans-serif; font-size:16px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer;">Annuleren</button>
            <button type="button" data-manual-lead-confirm style="height:48px; min-width:148px; padding:0 22px; border-radius:10px; border:1px solid transparent; background:${theme.accent}; color:#fff; font-family:Oswald,sans-serif; font-size:16px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer;">Opslaan</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const companyInput = overlay.querySelector('[data-manual-lead-company]');
      const addressInput = overlay.querySelector('[data-manual-lead-address]');
      const phoneInput = overlay.querySelector('[data-manual-lead-phone]');
      const websiteInput = overlay.querySelector('[data-manual-lead-website]');
      const errorEl = overlay.querySelector('[data-manual-lead-error]');
      const cancelBtn = overlay.querySelector('[data-manual-lead-cancel]');
      const confirmBtn = overlay.querySelector('[data-manual-lead-confirm]');

      let finished = false;

      function cleanup(result) {
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(result);
      }

      function setError(message) {
        if (!errorEl) return;
        errorEl.textContent = normalizeFreeText(message);
      }

      function submit() {
        const company = normalizeFreeText(companyInput?.value || '');
        const address = normalizeFreeText(addressInput?.value || '');
        const phone = normalizeFreeText(phoneInput?.value || '');
        const website = normalizeFreeText(websiteInput?.value || '');

        if (!company) {
          setError('Bedrijf ontbreekt.');
          companyInput?.focus();
          return;
        }
        if (!phone) {
          setError('Telefoonnummer ontbreekt.');
          phoneInput?.focus();
          return;
        }
        if (!looksLikePhoneNumber(phone)) {
          setError('Telefoonnummer lijkt ongeldig. Gebruik bijv. 0612345678 of +31612345678.');
          phoneInput?.focus();
          return;
        }

        cleanup({
          ok: true,
          values: {
            company,
            address,
            phone,
            website,
          },
        });
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup({ ok: false, cancelled: true });
          return;
        }
        if (event.key === 'Enter' && event.target && event.target.tagName !== 'TEXTAREA') {
          event.preventDefault();
          submit();
        }
      }

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          cleanup({ ok: false, cancelled: true });
        }
      });
      cancelBtn?.addEventListener('click', () => cleanup({ ok: false, cancelled: true }));
      confirmBtn?.addEventListener('click', submit);
      document.addEventListener('keydown', onKeyDown, true);
      window.setTimeout(() => {
        companyInput?.focus();
        companyInput?.select?.();
      }, 0);
    });
  }

  async function promptAndSaveSingleManualLead(defaults = {}) {
    const leadInput = await promptForManualLeadDetails(defaults);
    if (!leadInput?.ok) {
      return {
        ok: false,
        cancelled: true,
      };
    }

    const selectedRegion = normalizeCampaignRegionPromptValue(getSelectedText('regio'));
    const company = normalizeFreeText(leadInput.values?.company || defaults.company || '');
    const phone = normalizeFreeText(leadInput.values?.phone || defaults.phone || '');
    const address = normalizeFreeText(leadInput.values?.address || defaults.address || '');
    const website = normalizeFreeText(leadInput.values?.website || defaults.website || '');
    const region = normalizeFreeText(defaults.region || selectedRegion);

    const singleLead = {
      company,
      phone,
      region,
      address,
      website,
    };

    const merged = mergeLeadRows(getSavedLeadRows(), [singleLead]);
    saveLeadRows(merged.rows);
    updateLeadListHint();
    const saveResult = await persistRemoteUiStateNow().catch(() => ({ ok: false }));

    return {
      ok: true,
      lead: normalizeLeadRow(singleLead),
      merged,
      remoteSaved: Boolean(saveResult?.ok),
    };
  }

  function getDefaultAiNotebookRow() {
    return {
      company: '',
      phone: '',
      status: '',
      followUp: '',
      followUpReason: '',
      memory: '',
    };
  }

  function normalizeAiNotebookRow(row) {
    return {
      company: String(row?.company || '').trim(),
      phone: String(row?.phone || '').trim(),
      status: String(row?.status || '').trim(),
      followUp: String(row?.followUp || '').trim(),
      followUpReason: String(row?.followUpReason || '').trim(),
      memory: String(row?.memory || '').trim(),
    };
  }

  function ensureMinimumAiNotebookRows(rows, minRows) {
    const out = Array.isArray(rows) ? rows.slice() : [];
    while (out.length < minRows) {
      out.push(getDefaultAiNotebookRow());
    }
    return out.map(normalizeAiNotebookRow);
  }

  function getSavedAiNotebookRows() {
    const raw = readStorage(AI_NOTEBOOK_ROWS_STORAGE_KEY).trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeAiNotebookRow);
    } catch {
      return [];
    }
  }

  function saveAiNotebookRows(rows) {
    const serialized = JSON.stringify((rows || []).map(normalizeAiNotebookRow));
    writeStorage(AI_NOTEBOOK_ROWS_STORAGE_KEY, serialized);
  }

  function persistAiNotebookRowsDraft(rows) {
    const nextRows = Array.isArray(rows) ? rows : collectAiNotebookRowsFromModal();
    saveAiNotebookRows(nextRows);
    updateAiNotebookHint();
  }

  function setAiNotebookDraftHint(message) {
    const el = byId('aiNotebookDraftHint');
    if (el) el.textContent = message;
  }

  function collectAiNotebookRowsFromModal() {
    const rowsWrap = byId('aiNotebookRowsWrap');
    if (!rowsWrap) return getSavedAiNotebookRows();
    const rows = Array.from(rowsWrap.querySelectorAll('[data-ai-row="true"]')).map((rowEl) => ({
      company: rowEl.querySelector('[data-ai-field="company"]')?.value || '',
      phone: rowEl.querySelector('[data-ai-field="phone"]')?.value || '',
      status: rowEl.querySelector('[data-ai-field="status"]')?.value || '',
      followUp: rowEl.querySelector('[data-ai-field="followUp"]')?.value || '',
      followUpReason: rowEl.querySelector('[data-ai-field="followUpReason"]')?.value || '',
      memory: rowEl.querySelector('[data-ai-field="memory"]')?.value || '',
    }));
    return rows.map(normalizeAiNotebookRow);
  }

  function applyPasteGridToAiNotebookRows(rows, startRowIndex, startColIndex, grid) {
    const nextRows = Array.isArray(rows) ? rows.map(normalizeAiNotebookRow) : [];
    const fields = ['company', 'phone', 'status', 'followUp', 'followUpReason', 'memory'];

    grid.forEach((gridRow, rowOffset) => {
      const targetRowIndex = startRowIndex + rowOffset;
      while (nextRows.length <= targetRowIndex) {
        nextRows.push(getDefaultAiNotebookRow());
      }

      fields.forEach((field, fieldIndex) => {
        const sourceColIndex = fieldIndex - startColIndex;
        if (sourceColIndex < 0) return;
        if (sourceColIndex >= gridRow.length) return;
        nextRows[targetRowIndex][field] = String(gridRow[sourceColIndex] || '').trim();
      });
    });

    return nextRows;
  }

  function renderAiNotebookRows(rows) {
    const rowsWrap = byId('aiNotebookRowsWrap');
    if (!rowsWrap) return;

    activeSheetInput = null;
    rowsWrap.style.display = 'flex';
    rowsWrap.style.minHeight = '0';
    rowsWrap.innerHTML = '';

    const normalizedRows = ensureMinimumAiNotebookRows(rows, 28);
    const columns = getSpreadsheetColumns();
    const aiFieldMap = ['company', 'phone', 'status', 'followUp', 'followUpReason', 'memory'];
    const aiTitles = [
      'A = Bedrijfsnaam',
      'B = Telefoonnummer',
      'C = Status',
      'D = Nog een keer bellen? (Ja/Nee)',
      'E = Waarom (vervolgreden)',
      'F = Wat onthouden?',
    ];
    const aiPlaceholders = [
      'Bedrijf BV',
      '0612345678',
      'Gebeld / Geen gehoor / Geinteresseerd',
      'Ja / Nee',
      'Bijv. terugbellen volgende week',
      'Bijv. vroeg naar prijsrange / praat met eigenaar',
    ];

    const tableWrap = document.createElement('div');
    tableWrap.style.flex = '1 1 auto';
    tableWrap.style.border = '1px solid #c7c9cc';
    tableWrap.style.borderRadius = '6px';
    tableWrap.style.overflow = 'auto';
    tableWrap.style.background = '#ffffff';
    tableWrap.style.height = '100%';

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.minWidth = '1600px';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.style.position = 'sticky';
    corner.style.top = '0';
    corner.style.left = '0';
    corner.style.zIndex = '4';
    corner.style.width = '52px';
    corner.style.minWidth = '52px';
    corner.style.background = '#f1f3f4';
    corner.style.border = '1px solid #dadce0';
    corner.style.padding = '0';
    headRow.appendChild(corner);

    columns.forEach((letter, colIndex) => {
      const th = document.createElement('th');
      th.style.position = 'sticky';
      th.style.top = '0';
      th.style.zIndex = '3';
      th.style.background = '#f1f3f4';
      th.style.border = '1px solid #dadce0';
      th.style.color = '#202124';
      th.style.fontWeight = '500';
      th.style.fontSize = '12px';
      th.style.height = '28px';
      th.style.padding = '0 8px';
      th.style.textAlign = 'center';
      if (colIndex < 2) th.style.minWidth = '220px';
      else if (colIndex < 4) th.style.minWidth = '190px';
      else if (colIndex < 6) th.style.minWidth = '320px';
      else th.style.minWidth = '120px';
      th.textContent = letter;
      if (aiTitles[colIndex]) th.title = aiTitles[colIndex];
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    normalizedRows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-ai-row', 'true');

      const rowNoCell = document.createElement('td');
      rowNoCell.style.position = 'sticky';
      rowNoCell.style.left = '0';
      rowNoCell.style.zIndex = '2';
      rowNoCell.style.background = '#f8f9fa';
      rowNoCell.style.border = '1px solid #e0e0e0';
      rowNoCell.style.width = '52px';
      rowNoCell.style.minWidth = '52px';
      rowNoCell.style.textAlign = 'center';
      rowNoCell.style.fontSize = '12px';
      rowNoCell.style.color = '#5f6368';
      rowNoCell.style.padding = '0';
      rowNoCell.style.height = '28px';
      rowNoCell.textContent = String(index + 1);
      tr.appendChild(rowNoCell);

      columns.forEach((_, colIndex) => {
        const td = document.createElement('td');
        td.style.border = '1px solid #e0e0e0';
        td.style.padding = '0';
        td.style.height = '28px';
        if (colIndex < 2) td.style.minWidth = '220px';
        else if (colIndex < 4) td.style.minWidth = '190px';
        else if (colIndex < 6) td.style.minWidth = '320px';
        else td.style.minWidth = '120px';
        td.style.background = '#ffffff';

        if (colIndex < aiFieldMap.length) {
          const field = aiFieldMap[colIndex];
          const input = document.createElement('input');
          input.type = 'text';
          input.setAttribute('data-ai-field', field);
          input.setAttribute('data-col-index', String(colIndex));
          input.setAttribute('data-row-index', String(index));
          input.value = String(row[field] || '');
          input.placeholder = index < 2 ? aiPlaceholders[colIndex] : '';
          input.style.width = '100%';
          input.style.height = '27px';
          input.style.border = '0';
          input.style.margin = '0';
          input.style.padding = '0 8px';
          input.style.background = '#ffffff';
          input.style.color = '#202124';
          input.style.fontSize = '13px';
          input.style.outline = 'none';
          input.style.boxSizing = 'border-box';
          td.appendChild(input);
        } else {
          const emptyCell = document.createElement('div');
          emptyCell.style.height = '27px';
          emptyCell.style.background = '#ffffff';
          td.appendChild(emptyCell);
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    rowsWrap.appendChild(tableWrap);

    rowsWrap.querySelectorAll('input[data-ai-field]').forEach((input) => {
      input.addEventListener('input', () => {
        setActiveSheetInput(input);
        persistAiNotebookRowsDraft();
        setAiNotebookDraftHint('Kladblok automatisch bewaard. Klik "Opslaan lijst" om direct te synchroniseren.');
      });
      input.addEventListener('focus', () => setActiveSheetInput(input));
      input.addEventListener('click', () => setActiveSheetInput(input));
      input.addEventListener('paste', (event) => {
        const clipboardText = event.clipboardData?.getData('text/plain') || '';
        if (!clipboardText) return;
        const grid = parseClipboardGridText(clipboardText);
        if (grid.length === 0) return;
        const startRowIndex = Number(input.getAttribute('data-row-index') || 0);
        const startColIndex = Number(input.getAttribute('data-col-index') || 0);
        const multiCellPaste = grid.length > 1 || (grid[0] && grid[0].length > 1);
        if (!multiCellPaste) return;

        event.preventDefault();
        const currentRows = collectAiNotebookRowsFromModal();
        const nextRows = applyPasteGridToAiNotebookRows(currentRows, startRowIndex, startColIndex, grid);
        renderAiNotebookRows(nextRows);
        persistAiNotebookRowsDraft(nextRows);
        const nextFocus = rowsWrap.querySelector(
          `input[data-row-index="${startRowIndex}"][data-col-index="${startColIndex}"]`
        );
        if (nextFocus) setActiveSheetInput(nextFocus);
        setAiNotebookDraftHint(
          `Excel/Sheets plak verwerkt: ${grid.length} rij(en) in AI kladblok en bewaard. Klik "Opslaan lijst" om direct te synchroniseren.`
        );
      });
    });
  }

  function parseAiNotebookRows(rowsInput) {
    const rows = Array.isArray(rowsInput) ? rowsInput.map(normalizeAiNotebookRow) : [];
    let nonEmptyRowCount = 0;
    let rowsWithStatus = 0;
    let followUpYes = 0;

    rows.forEach((row) => {
      const hasAnyData = Boolean(
        row.company || row.phone || row.status || row.followUp || row.followUpReason || row.memory
      );
      if (!hasAnyData) return;
      nonEmptyRowCount += 1;
      if (row.status) rowsWithStatus += 1;
      if (/^ja$/i.test(row.followUp)) followUpYes += 1;
    });

    return {
      hasInput: nonEmptyRowCount > 0,
      nonEmptyRowCount,
      rowsWithStatus,
      followUpYes,
    };
  }

  function updateAiNotebookHint() {
    const hint = byId('aiNotebookHint');
    if (!hint) return;
    hint.textContent = '';
    hint.style.display = 'none';
  }

  function getConversationRecordUpdatedMs(record) {
    const updatedAtMs = Number(record?.updatedAtMs);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs;
    const updatedAt = Date.parse(String(record?.updatedAt || '').trim());
    return Number.isFinite(updatedAt) ? updatedAt : 0;
  }

  function getConversationRecordOccurredAt(record) {
    return String(record?.endedAt || record?.startedAt || record?.createdAt || record?.updatedAt || '').trim();
  }

  function getConversationRecordOccurredMs(record) {
    const occurredAt = Date.parse(getConversationRecordOccurredAt(record));
    if (Number.isFinite(occurredAt) && occurredAt > 0) return occurredAt;
    return getConversationRecordUpdatedMs(record);
  }

  function buildConversationRecordsFromUpdates(updates) {
    const byId = new Map();

    (Array.isArray(updates) ? updates : []).forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const callId = String(item.callId || `call-${index}`).trim() || `call-${index}`;
      const previous = byId.get(callId) || { callId };
      const durationSeconds = Number(item.durationSeconds);
      const updatedAtMs = getConversationRecordUpdatedMs(item);

      byId.set(callId, {
        ...previous,
        ...item,
        callId,
        company: String(item.company || previous.company || '').trim(),
        name: String(item.name || previous.name || '').trim(),
        phone: String(item.phone || previous.phone || '').trim(),
        status: String(item.status || previous.status || '').trim(),
        endedReason: String(item.endedReason || previous.endedReason || '').trim(),
        summary: String(item.summary || previous.summary || '').trim(),
        transcriptSnippet: String(item.transcriptSnippet || previous.transcriptSnippet || '').trim(),
        transcriptFull: String(item.transcriptFull || previous.transcriptFull || '').trim(),
        startedAt: String(item.startedAt || previous.startedAt || '').trim(),
        endedAt: String(item.endedAt || previous.endedAt || '').trim(),
        recordingUrl: String(item.recordingUrl || previous.recordingUrl || '').trim(),
        durationSeconds:
          Number.isFinite(durationSeconds) && durationSeconds > 0
            ? Math.round(durationSeconds)
            : Number.isFinite(Number(previous.durationSeconds)) && Number(previous.durationSeconds) > 0
              ? Math.round(Number(previous.durationSeconds))
              : null,
        updatedAt: String(item.updatedAt || previous.updatedAt || '').trim(),
        updatedAtMs,
      });
    });

    return Array.from(byId.values()).sort((a, b) => getConversationRecordOccurredMs(b) - getConversationRecordOccurredMs(a));
  }

  function inferConversationAnswered(record) {
    const status = String(record?.status || '').toLowerCase();
    const endedReason = String(record?.endedReason || '').toLowerCase();
    const hasConversationContent = Boolean(record?.summary || record?.transcriptFull || record?.transcriptSnippet);
    if (hasConversationContent) return true;
    if (Number(record?.durationSeconds) >= 15) return true;
    if (/(busy|voicemail|no[- ]?answer|failed|cancelled|canceled|rejected)/.test(`${status} ${endedReason}`)) {
      return false;
    }
    return null;
  }

  function formatConversationAnsweredLabel(record) {
    const answered = inferConversationAnswered(record);
    if (answered === true) return 'Ja';
    if (answered === false) return 'Nee';
    return 'Onbekend';
  }

  function formatConversationDuration(seconds) {
    const totalSeconds = Math.round(Number(seconds) || 0);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'Onbekend';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins <= 0) return `${secs}s`;
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }

  function getLeadDatabaseCallPartyIdentity(call) {
    const normalizedPhone = phoneKey(call?.phone || '');
    if (normalizedPhone) return `phone:${normalizedPhone}`;

    const companyKey = normalizeSearchText(call?.company || '');
    const nameKey = normalizeSearchText(call?.name || '');
    if (companyKey || nameKey) return `lead:${companyKey}|${nameKey}`;

    const callId = normalizeFreeText(call?.callId || '');
    return callId ? `call:${callId}` : '';
  }

  function formatLeadDatabaseAggregateDuration(totalSeconds) {
    const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (safeSeconds >= 3600) {
      const hours = Math.floor(safeSeconds / 3600);
      const minutes = Math.floor((safeSeconds % 3600) / 60);
      return minutes > 0 ? `${hours} uur ${minutes} min` : `${hours} uur`;
    }

    const minutes = Math.floor(safeSeconds / 60);
    if (minutes > 0) return `${minutes} min`;
    if (safeSeconds > 0) return `${safeSeconds} sec`;
    return '0 min';
  }

  function buildLeadDatabaseCallSummaryStats(calls) {
    const uniquePeople = new Set();
    let totalDurationSeconds = 0;

    (Array.isArray(calls) ? calls : []).forEach((call) => {
      const identity = getLeadDatabaseCallPartyIdentity(call);
      if (identity) uniquePeople.add(identity);

      const durationSeconds = Math.max(0, Math.round(Number(call?.durationSeconds) || 0));
      if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        totalDurationSeconds += durationSeconds;
      }
    });

    return {
      uniquePeopleCalled: uniquePeople.size,
      totalDurationLabel: formatLeadDatabaseAggregateDuration(totalDurationSeconds),
    };
  }

  function formatConversationTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Onbekend';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('nl-NL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getConversationConclusion(record) {
    const source = String(record?.summary || record?.transcriptSnippet || '').replace(/\s+/g, ' ').trim();
    if (!source) return 'Nog geen conclusie beschikbaar.';
    const match = source.match(/[^.!?]+[.!?]/);
    const sentence = String(match ? match[0] : source).trim();
    return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
  }

  function getConversationLeadLabel(record) {
    const company = String(record?.company || '').trim();
    const name = String(record?.name || '').trim();
    if (company && name && company !== name) return `${company} · ${name}`;
    return company || name || 'Onbekende lead';
  }

  function getConversationListLabel(record) {
    const company = String(record?.company || '').trim();
    if (company) return company;

    const name = String(record?.name || '').trim();
    if (name) {
      const [firstName] = name.split(/\s+/).filter(Boolean);
      if (firstName) return firstName;
    }

    return 'Onbekend';
  }

  function getConversationTranscript(record) {
    return String(record?.transcriptFull || record?.transcriptSnippet || '').trim();
  }

  function getConversationThemeMode() {
    const root = document.documentElement;
    const mode = String(root.getAttribute('data-theme') || root.getAttribute('data-theme-mode') || '').toLowerCase();
    return mode === 'light' ? 'light' : 'dark';
  }

  function getConversationThemeTokens() {
    const mode = getConversationThemeMode();
    if (mode === 'light') {
      return {
        overlay: 'rgba(232, 228, 221, 0.72)',
        shellBg: '#f8f7f4',
        shellBorder: 'rgba(0, 0, 0, 0.08)',
        shellShadow: '0 30px 90px rgba(33, 33, 44, 0.18)',
        text: '#1a1a2e',
        textSoft: '#606272',
        textMuted: '#9599a8',
        chromeBg: '#ffffff',
        chromeAltBg: '#f3f1ec',
        panelBg: '#ffffff',
        panelAltBg: '#faf8f4',
        blockBg: 'rgba(15, 23, 42, 0.03)',
        border: 'rgba(0, 0, 0, 0.08)',
        borderStrong: 'rgba(139, 34, 82, 0.24)',
        accent: '#8b2252',
        accentSoftBg: 'rgba(139, 34, 82, 0.08)',
        accentSoftBgActive: 'rgba(139, 34, 82, 0.12)',
        accentSoftText: '#8b2252',
        positive: '#2d8a5e',
        warning: '#b26b16',
        buttonBg: 'rgba(0, 0, 0, 0.03)',
        buttonBorder: 'rgba(0, 0, 0, 0.08)',
        buttonText: '#1a1a2e',
        buttonMutedText: '#606272',
        emptyBg: 'rgba(15, 23, 42, 0.03)',
      };
    }

    return {
      overlay: 'rgba(8, 10, 16, 0.82)',
      shellBg: '#0d0d0d',
      shellBorder: 'rgba(255,255,255,0.08)',
      shellShadow: '0 30px 90px rgba(0,0,0,0.55)',
      text: '#f5f5f5',
      textSoft: '#d6d6d6',
      textMuted: '#8f95a3',
      chromeBg: '#080808',
      chromeAltBg: '#080808',
      panelBg: '#0d0d0d',
      panelAltBg: '#0a0a0a',
      blockBg: 'rgba(255,255,255,0.02)',
      border: 'rgba(255,255,255,0.06)',
      borderStrong: 'rgba(139,34,82,0.42)',
      accent: '#a62d65',
      accentSoftBg: 'rgba(139,34,82,0.08)',
      accentSoftBgActive: 'rgba(139,34,82,0.12)',
      accentSoftText: '#f4d6e4',
      positive: '#7ce2aa',
      warning: '#f0b37a',
      buttonBg: 'rgba(255,255,255,0.03)',
      buttonBorder: 'rgba(255,255,255,0.08)',
      buttonText: '#f5f5f5',
      buttonMutedText: '#8f95a3',
      emptyBg: 'rgba(255,255,255,0.02)',
    };
  }

  function ensureAiNotebookModal() {
    let modal = byId('aiNotebookModalOverlay');
    if (modal) return modal;

    const state = {
      loading: false,
      error: '',
      calls: [],
      selectedCallId: '',
      detailLoadingId: '',
      detailErrorById: Object.create(null),
      detailsById: Object.create(null),
      pollTimer: null,
    };

    modal = document.createElement('div');
    modal.id = 'aiNotebookModalOverlay';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.display = 'none';
    modal.style.alignItems = 'stretch';
    modal.style.justifyContent = 'stretch';
    modal.style.padding = '0';
    modal.style.zIndex = '9999';

    modal.innerHTML = [
      '<div id="aiNotebookModalShell" style="width:100vw; height:100vh; overflow:hidden; display:flex; flex-direction:column;">',
      '  <div id="aiNotebookModalHeader" style="min-height:72px; display:flex; align-items:center; justify-content:space-between; padding:0 20px; gap:12px;">',
      '    <div>',
      '      <div id="aiNotebookModalTitle" style="font-family:Oswald,sans-serif; font-size:30px; line-height:1; letter-spacing:0.03em; text-transform:uppercase;">Telefoongesprekken</div>',
      '    </div>',
      '    <div style="display:flex; align-items:center; gap:10px;">',
      '      <button type="button" id="aiNotebookRefreshBtn" aria-label="Verversen" title="Verversen" style="height:40px; width:40px; padding:0; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; line-height:1; cursor:pointer;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg></button>',
      '      <button type="button" id="aiNotebookCancelBtn" style="height:40px; padding:0 14px; font-family:Oswald,sans-serif; letter-spacing:0.08em; text-transform:uppercase; cursor:pointer;">Sluiten</button>',
      '    </div>',
      '  </div>',
      '  <div style="display:grid; grid-template-columns:minmax(340px, 420px) 1fr; min-height:0; flex:1;">',
      '    <div id="aiNotebookConversationPane" style="min-height:0; display:flex; flex-direction:column;">',
      '      <div id="aiNotebookConversationPaneHeader" style="padding:16px 18px 12px; font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase;">Laatste gesprekken</div>',
      '      <div id="aiNotebookConversationList" style="flex:1; min-height:0; overflow:auto; padding:0;"></div>',
      '    </div>',
      '    <div id="aiNotebookConversationDetailPane" style="min-height:0; overflow:auto; padding:22px;">',
      '      <div id="aiNotebookConversationDetail"></div>',
      '    </div>',
      '  </div>',
      '  <div id="aiNotebookModalFooter" style="min-height:48px; display:flex; align-items:center; justify-content:flex-end; gap:12px; padding:0 20px; font-size:12px;">',
      '    <div id="aiNotebookModalFooterBrand" style="font-family:Oswald,sans-serif; letter-spacing:0.12em; text-transform:uppercase;">Softora.nl</div>',
      '  </div>',
      '</div>',
    ].join('');

    document.body.appendChild(modal);

    function applyConversationModalTheme() {
      const theme = getConversationThemeTokens();
      modal.style.background = theme.overlay;

      const shell = byId('aiNotebookModalShell');
      const header = byId('aiNotebookModalHeader');
      const listPane = byId('aiNotebookConversationPane');
      const listPaneHeader = byId('aiNotebookConversationPaneHeader');
      const detailPane = byId('aiNotebookConversationDetailPane');
      const footer = byId('aiNotebookModalFooter');
      const title = byId('aiNotebookModalTitle');
      const hint = byId('aiNotebookDraftHint');
      const footerBrand = byId('aiNotebookModalFooterBrand');
      const refreshBtn = byId('aiNotebookRefreshBtn');
      const cancelBtn = byId('aiNotebookCancelBtn');

      if (shell) {
        shell.style.border = 'none';
        shell.style.background = theme.shellBg;
        shell.style.boxShadow = 'none';
        shell.style.color = theme.text;
      }
      if (header) {
        header.style.background = theme.chromeBg;
        header.style.borderBottom = `1px solid ${theme.border}`;
      }
      if (listPane) {
        listPane.style.background = theme.panelAltBg;
        listPane.style.borderRight = `1px solid ${theme.border}`;
      }
      if (listPaneHeader) {
        listPaneHeader.style.borderBottom = `1px solid ${theme.border}`;
        listPaneHeader.style.color = theme.textMuted;
      }
      if (detailPane) {
        detailPane.style.background = theme.panelBg;
      }
      if (footer) {
        footer.style.background = theme.chromeBg;
        footer.style.borderTop = `1px solid ${theme.border}`;
        footer.style.color = theme.textMuted;
      }
      if (title) title.style.color = theme.text;
      if (hint) hint.style.color = theme.textMuted;
      if (footerBrand) footerBrand.style.color = theme.accent;

      [refreshBtn, cancelBtn].forEach((button, index) => {
        if (!button) return;
        button.style.border = `1px solid ${theme.buttonBorder}`;
        button.style.background = index === 0 ? theme.buttonBg : 'transparent';
        button.style.color = index === 0 ? theme.buttonText : theme.buttonMutedText;
      });
    }

    function getSelectedConversationRecord() {
      const selectedBase = state.calls.find((item) => item.callId === state.selectedCallId) || null;
      if (!selectedBase) return null;
      return {
        ...selectedBase,
        ...(state.detailsById[state.selectedCallId] || {}),
      };
    }

    function renderConversationDetail() {
      const theme = getConversationThemeTokens();
      const detailEl = byId('aiNotebookConversationDetail');
      if (!detailEl) return;

      const record = getSelectedConversationRecord();
      if (!record) {
        detailEl.innerHTML = [
          `<div style="height:100%; min-height:300px; display:flex; align-items:center; justify-content:center; border:1px solid ${theme.border}; background:${theme.emptyBg}; color:${theme.textMuted}; font-size:14px;">`,
          'Selecteer een gesprek om de details te bekijken.',
          '</div>',
        ].join('');
        return;
      }

      const callId = escapeHtml(record.callId);
      const transcript = escapeHtml(getConversationTranscript(record));
      const recordingUrl = String(record.recordingUrl || '').trim();
      const detailLoading = state.detailLoadingId === record.callId;
      const detailError = state.detailErrorById[record.callId] || '';

      detailEl.innerHTML = [
        '<div style="max-width:100%;">',
        `  <div style="font-family:Oswald,sans-serif; font-size:14px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:8px;">${escapeHtml(formatConversationTimestamp(getConversationRecordOccurredAt(record)))}</div>`,
        `  <div style="font-family:Oswald,sans-serif; font-size:34px; line-height:1; text-transform:uppercase; letter-spacing:0.03em; color:${theme.text};">${escapeHtml(getConversationLeadLabel(record))}</div>`,
        `  <div style="margin-top:12px; color:${theme.textMuted}; font-size:14px;">${escapeHtml(record.phone || 'Geen telefoonnummer beschikbaar')}</div>`,
        `  <div style="display:grid; grid-template-columns:repeat(2, minmax(220px, 1fr)); gap:14px 28px; margin-top:28px; margin-bottom:28px;">`,
        `    <div><div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:6px;">Gebelde lead</div><div style="font-size:15px; line-height:1.5; color:${theme.text};">${escapeHtml(getConversationLeadLabel(record))}</div></div>`,
        `    <div><div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:6px;">Opgenomen</div><div style="font-size:15px; line-height:1.5; color:${theme.text};">${escapeHtml(formatConversationAnsweredLabel(record))}</div></div>`,
        `    <div><div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:6px;">Gespreksduur</div><div style="font-size:15px; line-height:1.5; color:${theme.text};">${escapeHtml(formatConversationDuration(record.durationSeconds))}</div></div>`,
        `    <div><div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:6px;">Call ID</div><div style="font-size:15px; line-height:1.5; color:${theme.text}; word-break:break-all;">${callId}</div></div>`,
        '  </div>',
        `  <div style="margin-bottom:26px;">`,
        `    <div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:10px;">Samenvatting</div>`,
        `    <div style="font-size:15px; line-height:1.8; color:${theme.text};">${escapeHtml(getConversationConclusion(record))}</div>`,
        '  </div>',
        `  <div style="margin-bottom:26px;">`,
        '    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px;">',
        `      <div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted};">Volledige transcriptie</div>`,
        detailLoading ? `      <div style="font-size:12px; color:${theme.textMuted};">Extra details laden...</div>` : '',
        detailError ? `      <div style="font-size:12px; color:#d66f8b;">${escapeHtml(detailError)}</div>` : '',
        '    </div>',
        `    <div style="white-space:pre-wrap; font-size:14px; line-height:1.85; color:${transcript ? theme.text : theme.textMuted};">${transcript || 'Nog geen transcriptie beschikbaar voor dit gesprek.'}</div>`,
        '  </div>',
        `  <div>`,
        `    <div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:12px;">Gesprek terugluisteren</div>`,
        recordingUrl
          ? `    <audio id="conversationAudioPlayer" controls preload="none" style="width:100%; color-scheme:${getConversationThemeMode()};"><source src="${escapeHtml(recordingUrl)}"></audio>`
          : `    <div style="font-size:14px; color:${theme.textMuted};">Nog geen opname beschikbaar voor dit gesprek.</div>`,
        '  </div>',
        '</div>',
      ].join('');
    }

    function renderConversationList() {
      const theme = getConversationThemeTokens();
      const listEl = byId('aiNotebookConversationList');
      if (!listEl) return;

      if (!state.calls.length) {
        listEl.innerHTML = `<div style="padding:18px; color:${theme.textMuted}; font-size:14px; line-height:1.6;">Nog geen gesprekken beschikbaar. Zodra outbound calls terugschrijven verschijnen ze hier automatisch.</div>`;
        renderConversationDetail();
        return;
      }

      listEl.innerHTML = state.calls
        .map((record) => {
          const isActive = record.callId === state.selectedCallId;
          const label = escapeHtml(getConversationListLabel(record));
          const answered = inferConversationAnswered(record);
          const isDarkMode = getConversationThemeMode() === 'dark';
          const answeredBarColor =
            answered === true
              ? isDarkMode
                ? 'rgba(124, 226, 170, 0.38)'
                : '#d7f2e1'
              : answered === false
                ? isDarkMode
                  ? 'rgba(231, 114, 139, 0.38)'
                  : '#f8d7de'
                : isDarkMode
                  ? 'rgba(143, 149, 163, 0.28)'
                  : '#e8eaf0';
          return [
            `<button type="button" data-conversation-id="${escapeHtml(record.callId)}" style="width:100%; text-align:left; padding:11px 16px; border:none; border-bottom:1px solid ${theme.border}; border-left:3px solid ${isActive ? theme.accent : 'transparent'}; background:${isActive ? theme.accentSoftBgActive : 'transparent'}; color:${theme.text}; cursor:pointer; transition:background 0.2s ease, border-color 0.2s ease;">`,
            '  <div style="display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:12px;">',
            `    <div style="min-width:0; font-family:Oswald,sans-serif; font-size:15px; line-height:1; text-transform:uppercase; letter-spacing:0.04em; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${label}</div>`,
            `    <div style="font-size:12px; color:${theme.textMuted}; white-space:nowrap;">${escapeHtml(formatConversationDuration(record.durationSeconds))}</div>`,
            `    <div aria-label="${answered === true ? 'Opgenomen' : answered === false ? 'Niet opgenomen' : 'Onbekend'}" style="width:28px; height:8px; border-radius:999px; border:1px solid ${theme.border}; background:${answeredBarColor};"></div>`,
            '  </div>',
            '</button>',
          ].join('');
        })
        .join('');

      listEl.querySelectorAll('[data-conversation-id]').forEach((button) => {
        button.addEventListener('click', () => {
          const callId = String(button.getAttribute('data-conversation-id') || '').trim();
          if (!callId) return;
          state.selectedCallId = callId;
          renderConversationList();
          void loadConversationDetail(callId);
        });
      });

      renderConversationDetail();
    }

    async function loadConversationDetail(callId) {
      const record = state.calls.find((item) => item.callId === callId);
      if (!record) return;

      const alreadyHasDetail =
        (Number(record.durationSeconds) > 0 || Number(state.detailsById[callId]?.durationSeconds) > 0) &&
        (String(record.recordingUrl || '').trim() || String(state.detailsById[callId]?.recordingUrl || '').trim());
      if (alreadyHasDetail) return;

      state.detailLoadingId = callId;
      state.detailErrorById[callId] = '';
      renderConversationDetail();

      try {
        const response = await fetchWithTimeout(
          `/api/coldcalling/status?callId=${encodeURIComponent(callId)}`,
          { method: 'GET', cache: 'no-store' },
          12000
        );
        const data = await parseApiResponse(response);
        if (!response.ok || !data?.ok) {
          throw new Error(String(data?.error || `Call details laden mislukt (${response.status})`));
        }

        state.detailsById[callId] = {
          status: String(data.status || '').trim(),
          endedReason: String(data.endedReason || '').trim(),
          startedAt: String(data.startedAt || '').trim(),
          endedAt: String(data.endedAt || '').trim(),
          durationSeconds: Number.isFinite(Number(data.durationSeconds)) && Number(data.durationSeconds) > 0
            ? Math.round(Number(data.durationSeconds))
            : null,
          recordingUrl: String(data.recordingUrl || '').trim(),
        };
      } catch (error) {
        state.detailErrorById[callId] = error?.message || 'Kon extra details niet laden.';
      } finally {
        if (state.detailLoadingId === callId) {
          state.detailLoadingId = '';
        }
        renderConversationDetail();
      }
    }

    async function loadConversations() {
      state.loading = true;
      state.error = '';
      renderConversationList();

      try {
        const response = await fetchWithTimeout('/api/coldcalling/call-updates?limit=200', {
          method: 'GET',
          cache: 'no-store',
        }, 12000);
        const data = await parseApiResponse(response);
        if (!response.ok || !data?.ok || !Array.isArray(data?.updates)) {
          throw new Error(String(data?.error || `Telefoongesprekken laden mislukt (${response.status})`));
        }

        const allowedPhoneKeys = getActiveLeadPhoneKeys();
        const scopedUpdates = filterCallLikeRowsForMode(data.updates, allowedPhoneKeys);
        state.calls = buildConversationRecordsFromUpdates(scopedUpdates);
        if (!state.selectedCallId || !state.calls.some((item) => item.callId === state.selectedCallId)) {
          state.selectedCallId = state.calls[0]?.callId || '';
        }

        const hint = byId('aiNotebookHint');
        if (hint) {
          hint.dataset.callCount = String(state.calls.length);
        }
        updateAiNotebookHint();
      } catch (error) {
        state.calls = [];
        state.selectedCallId = '';
        state.error = error?.message || 'Kon telefoongesprekken niet laden.';
      } finally {
        state.loading = false;
        renderConversationList();
        if (state.selectedCallId) {
          void loadConversationDetail(state.selectedCallId);
        }
      }
    }

    function closeModal() {
      modal.style.display = 'none';
      document.body.style.overflow = '';
      if (state.pollTimer) {
        window.clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    }

    function openModal() {
      applyConversationModalTheme();
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      void loadConversations();
      if (state.pollTimer) {
        window.clearInterval(state.pollTimer);
      }
      state.pollTimer = window.setInterval(() => {
        void loadConversations();
      }, 15000);
    }

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    byId('aiNotebookCancelBtn')?.addEventListener('click', closeModal);
    byId('aiNotebookRefreshBtn')?.addEventListener('click', () => {
      void loadConversations();
    });

    const themeObserver = new MutationObserver(() => {
      applyConversationModalTheme();
      if (modal.style.display !== 'none') {
        renderConversationList();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-mode'],
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.style.display !== 'none') closeModal();
    });

    applyConversationModalTheme();
    modal.openAiNotebookModal = openModal;
    modal.closeAiNotebookModal = closeModal;
    modal.refreshAiNotebookModal = () => loadConversations();
    return modal;
  }

  function getCallLikeRecordUpdatedMs(record) {
    const candidates = [
      Number(record?.updatedAtMs || 0),
      Number(record?.analyzedAtMs || 0),
      Number(record?.timestampMs || 0),
    ];
    for (const candidate of candidates) {
      if (Number.isFinite(candidate) && candidate > 0) return candidate;
    }
    const dateCandidates = [
      record?.updatedAt,
      record?.analyzedAt,
      record?.endedAt,
      record?.startedAt,
      record?.createdAt,
    ];
    for (const raw of dateCandidates) {
      const ts = Date.parse(String(raw || '').trim());
      if (Number.isFinite(ts) && ts > 0) return ts;
    }
    return 0;
  }

  function inferLeadDatabaseDecisionFromSignals({ callCount = 0, latestUpdate = null, latestInsight = null }) {
    const updateStatusText = normalizeSearchText(
      `${latestUpdate?.status || ''} ${latestUpdate?.messageType || ''} ${latestUpdate?.endedReason || ''}`
    );
    const combinedText = normalizeSearchText(
      [
        latestInsight?.summary,
        latestInsight?.followUpReason,
        latestUpdate?.summary,
        latestUpdate?.transcriptSnippet,
        latestUpdate?.transcriptFull,
      ]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join(' ')
    );

    const insightAppointment = Boolean(latestInsight?.appointmentBooked || latestInsight?.appointment_booked);
    if (insightAppointment) return 'appointment';

    if (
      /(niet meer bellen|bel( me)? niet|geen interesse|niet geinteresseerd|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst)/.test(
        combinedText
      )
    ) {
      return 'do_not_call';
    }

    if (
      /(is klant|klant geworden|geworden klant|deal gesloten|offerte akkoord|getekend|abonnement afgesloten|conversie naar klant)/.test(
        combinedText
      )
    ) {
      return 'customer';
    }

    if (
      /(afspraak|intake gepland|meeting gepland|demo gepland|belafspraak|call ingepland|kalender afspraak)/.test(
        combinedText
      )
    ) {
      return 'appointment';
    }

    if (
      /(terugbellen|bel later|later terugbellen|follow up|follow-up|volgende week|later deze week|stuur mail|mail sturen)/.test(
        combinedText
      )
    ) {
      return 'callback';
    }

    if (
      /(no[-_ ]?answer|geen gehoor|voicemail|busy|bezet|failed|dial failed|dial_failed|rejected|cancelled|canceled|unanswered)/.test(
        updateStatusText
      )
    ) {
      return 'no_answer';
    }

    if (Number(callCount) > 0) return 'called';
    return 'pending';
  }

  function getLeadDatabaseDecisionSortOrder(decision) {
    const normalized = normalizeLeadDatabaseDecision(decision);
    if (normalized === 'pending') return 10;
    if (normalized === 'no_answer') return 20;
    if (normalized === 'callback') return 30;
    if (normalized === 'called') return 40;
    if (normalized === 'appointment') return 50;
    if (normalized === 'customer') return 60;
    if (normalized === 'do_not_call') return 70;
    return 999;
  }

  function buildLeadDatabaseRecords(leads, updates, insights) {
    const byKey = new Map();
    const byCompanyKey = new Map();
    const byCallId = new Map();

    function ensureEntry(key, seed = {}) {
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          company: normalizeFreeText(seed.company || ''),
          phone: normalizeFreeText(seed.phone || ''),
          phoneKey: phoneKey(seed.phoneKey || seed.phone || ''),
          region: normalizeFreeText(seed.region || ''),
          contactPerson: normalizeFreeText(seed.contactPerson || ''),
          branche: normalizeFreeText(seed.branche || ''),
          province: normalizeFreeText(seed.province || ''),
          address: normalizeFreeText(seed.address || ''),
          website: normalizeFreeText(seed.website || ''),
          updates: [],
          insights: [],
          fromLeadList: Boolean(seed.fromLeadList),
        });
      }
      return byKey.get(key);
    }

    (Array.isArray(leads) ? leads : []).forEach((lead, index) => {
      const normalizedPhoneKey = phoneKey(lead?.phone);
      const company = normalizeFreeText(lead?.company || lead?.name || '');
      const entryKey = normalizedPhoneKey ? `phone:${normalizedPhoneKey}` : `lead:${index}`;
      const entry = ensureEntry(entryKey, {
        company,
        phone: lead?.phone,
        phoneKey: normalizedPhoneKey,
        region: lead?.region,
        contactPerson: lead?.contactPerson,
        branche: lead?.branche,
        province: lead?.province,
        address: lead?.address,
        website: lead?.website,
        fromLeadList: true,
      });
      entry.fromLeadList = true;
      if (!entry.company && company) entry.company = company;
      if (!entry.phone && lead?.phone) entry.phone = normalizeFreeText(lead.phone);
      if (!entry.phoneKey && normalizedPhoneKey) entry.phoneKey = normalizedPhoneKey;
      if (!entry.region && lead?.region) entry.region = normalizeFreeText(lead.region);
      if (!entry.contactPerson && lead?.contactPerson) entry.contactPerson = normalizeFreeText(lead.contactPerson);
      if (!entry.branche && lead?.branche) entry.branche = normalizeFreeText(lead.branche);
      if (!entry.province && lead?.province) entry.province = normalizeFreeText(lead.province);
      if (!entry.address && lead?.address) entry.address = normalizeFreeText(lead.address);
      if (!entry.website && lead?.website) entry.website = normalizeFreeText(lead.website);
      if (company) {
        const companyKey = normalizeSearchText(company);
        if (companyKey && !byCompanyKey.has(companyKey)) {
          byCompanyKey.set(companyKey, entryKey);
        }
      }
    });

    (Array.isArray(updates) ? updates : []).forEach((update, index) => {
      const callId = normalizeFreeText(update?.callId || `update-${index}`);
      const company = normalizeFreeText(update?.company || update?.name || '');
      const phone = normalizeFreeText(update?.phone || '');
      const contactPerson = normalizeFreeText(update?.contactPerson || update?.contact || update?.contactpersoon || '');
      const branche = normalizeFreeText(update?.branche || update?.branch || update?.sector || '');
      const province = normalizeFreeText(update?.province || update?.provincie || update?.state || '');
      const address = normalizeFreeText(update?.address || update?.adres || '');
      const website = normalizeFreeText(update?.website || update?.webiste || update?.url || '');
      const normalizedPhoneKey = phoneKey(phone);
      const companyKey = normalizeSearchText(company);
      if (!normalizedPhoneKey && !companyKey) {
        return;
      }

      let entryKey = '';
      if (normalizedPhoneKey && byKey.has(`phone:${normalizedPhoneKey}`)) {
        entryKey = `phone:${normalizedPhoneKey}`;
      } else if (companyKey && byCompanyKey.has(companyKey)) {
        entryKey = String(byCompanyKey.get(companyKey) || '');
      } else if (normalizedPhoneKey) {
        entryKey = `phone:${normalizedPhoneKey}`;
      } else {
        return;
      }

      const entry = ensureEntry(entryKey, {
        company,
        phone,
        phoneKey: normalizedPhoneKey,
        contactPerson,
        branche,
        province,
        address,
        website,
        fromLeadList: false,
      });
      if (!entry.company && company) entry.company = company;
      if (!entry.phone && phone) entry.phone = phone;
      if (!entry.phoneKey && normalizedPhoneKey) entry.phoneKey = normalizedPhoneKey;
      if (!entry.contactPerson && contactPerson) entry.contactPerson = contactPerson;
      if (!entry.branche && branche) entry.branche = branche;
      if (!entry.province && province) entry.province = province;
      if (!entry.address && address) entry.address = address;
      if (!entry.website && website) entry.website = website;
      entry.updates.push(update);
      if (callId) byCallId.set(callId, entryKey);

      if (companyKey && !byCompanyKey.has(companyKey)) {
        byCompanyKey.set(companyKey, entryKey);
      }
    });

    (Array.isArray(insights) ? insights : []).forEach((insight, index) => {
      const callId = normalizeFreeText(insight?.callId || '');
      const company = normalizeFreeText(insight?.company || insight?.leadCompany || '');
      const phone = normalizeFreeText(insight?.phone || '');
      const contactPerson = normalizeFreeText(insight?.contactPerson || insight?.contact || insight?.contactpersoon || '');
      const branche = normalizeFreeText(insight?.branche || insight?.branch || insight?.sector || '');
      const province = normalizeFreeText(insight?.province || insight?.provincie || insight?.state || '');
      const address = normalizeFreeText(insight?.address || insight?.adres || '');
      const website = normalizeFreeText(insight?.website || insight?.webiste || insight?.url || '');
      const normalizedPhoneKey = phoneKey(phone);
      const companyKey = normalizeSearchText(company);
      if (!callId && !normalizedPhoneKey && !companyKey) {
        return;
      }

      let entryKey = '';
      if (callId && byCallId.has(callId)) {
        entryKey = String(byCallId.get(callId) || '');
      } else if (normalizedPhoneKey && byKey.has(`phone:${normalizedPhoneKey}`)) {
        entryKey = `phone:${normalizedPhoneKey}`;
      } else if (companyKey && byCompanyKey.has(companyKey)) {
        entryKey = String(byCompanyKey.get(companyKey) || '');
      } else if (normalizedPhoneKey) {
        entryKey = `phone:${normalizedPhoneKey}`;
      } else {
        return;
      }

      const entry = ensureEntry(entryKey, {
        company,
        phone,
        phoneKey: normalizedPhoneKey,
        contactPerson,
        branche,
        province,
        address,
        website,
        fromLeadList: false,
      });
      if (!entry.company && company) entry.company = company;
      if (!entry.phone && phone) entry.phone = phone;
      if (!entry.phoneKey && normalizedPhoneKey) entry.phoneKey = normalizedPhoneKey;
      if (!entry.contactPerson && contactPerson) entry.contactPerson = contactPerson;
      if (!entry.branche && branche) entry.branche = branche;
      if (!entry.province && province) entry.province = province;
      if (!entry.address && address) entry.address = address;
      if (!entry.website && website) entry.website = website;
      entry.insights.push(insight);
      if (callId) byCallId.set(callId, entryKey);
      if (companyKey && !byCompanyKey.has(companyKey)) {
        byCompanyKey.set(companyKey, entryKey);
      }
    });

    const overrides = getSavedLeadDatabaseOverrides();

    return Array.from(byKey.values())
      .map((entry) => {
        const sortedUpdates = entry.updates
          .slice()
          .sort((a, b) => getConversationRecordOccurredMs(b) - getConversationRecordOccurredMs(a));
        const sortedInsights = entry.insights
          .slice()
          .sort((a, b) => getCallLikeRecordUpdatedMs(b) - getCallLikeRecordUpdatedMs(a));
        const latestUpdate = sortedUpdates[0] || null;
        const latestInsight = sortedInsights[0] || null;
        const autoDecision = inferLeadDatabaseDecisionFromSignals({
          callCount: sortedUpdates.length,
          latestUpdate,
          latestInsight,
        });
        const override = entry.phoneKey ? overrides[entry.phoneKey] || null : null;
        const serveCreusenMatch = isServeCreusenRowLike({
          company: entry.company,
          contactPerson:
            entry.contactPerson ||
            latestInsight?.contactName ||
            latestInsight?.contact ||
            latestUpdate?.name ||
            latestUpdate?.contactName ||
            '',
        });
        const baseDecision = normalizeLeadDatabaseDecision(override?.decision || autoDecision || 'pending') || 'pending';
        const decision = serveCreusenMatch ? 'callback' : baseDecision;
        const summary = normalizeFreeText(
          override?.note ||
            latestInsight?.summary ||
            latestUpdate?.summary ||
            latestUpdate?.transcriptSnippet ||
            latestInsight?.followUpReason ||
            ''
        );
        const lastUpdatedMs = Math.max(
          getConversationRecordOccurredMs(latestUpdate),
          getCallLikeRecordUpdatedMs(latestInsight)
        );
        const lastUpdatedAt =
          normalizeFreeText(
            getConversationRecordOccurredAt(latestUpdate) || latestInsight?.analyzedAt || latestUpdate?.updatedAt || ''
          ) ||
          '';

        return {
          key: entry.key,
          phoneKey: entry.phoneKey || '',
          company: entry.company || (entry.phone ? `Lead ${entry.phone}` : 'Onbekend bedrijf'),
          phone: formatLeadDatabasePhone(entry.phone || ''),
          region: entry.region || '',
          contactPerson: entry.contactPerson || '',
          branche: entry.branche || '',
          province: entry.province || '',
          address: entry.address || '',
          website: entry.website || '',
          callCount: sortedUpdates.length,
          updates: sortedUpdates,
          insights: sortedInsights,
          decision,
          decisionSource: override ? 'handmatig' : 'ai',
          summary,
          lastUpdatedAt,
          lastUpdatedMs,
          latestStatus: normalizeFreeText(latestUpdate?.status || ''),
          latestEndedReason: normalizeFreeText(latestUpdate?.endedReason || ''),
          appointmentBooked: Boolean(latestInsight?.appointmentBooked || latestInsight?.appointment_booked),
          fromLeadList: Boolean(entry.fromLeadList),
        };
      })
      .filter((record) => {
        if (isDeprecatedTestLeadRowLike(record)) return false;
        if (!record.phoneKey) return false;
        if (!record.phone) return false;
        return true;
      })
      .sort((a, b) => {
        const decisionDelta = getLeadDatabaseDecisionSortOrder(a.decision) - getLeadDatabaseDecisionSortOrder(b.decision);
        if (decisionDelta !== 0) return decisionDelta;
        if (a.lastUpdatedMs !== b.lastUpdatedMs) return b.lastUpdatedMs - a.lastUpdatedMs;
        return normalizeSearchText(a.company).localeCompare(normalizeSearchText(b.company), 'nl');
      });
  }

  async function fetchLeadDatabaseRecords(options = {}) {
    const cacheBust = normalizeFreeText(options?.cacheBust || '');
    const cacheSuffix = cacheBust ? `&ts=${encodeURIComponent(cacheBust)}` : '';
    const parsed = parseLeadRows(getSavedLeadRows());
    const allowedPhoneKeys = new Set(
      (Array.isArray(parsed?.leads) ? parsed.leads : [])
        .map((lead) => phoneKey(lead?.phone || ''))
        .filter(Boolean)
    );
    const sourceErrors = [];

    let updates = [];
    try {
      const response = await fetchWithTimeout(
        `/api/coldcalling/call-updates?limit=500${cacheSuffix}`,
        { method: 'GET', cache: 'no-store' },
        15000
      );
      const data = await parseApiResponse(response);
      if (response.ok && data?.ok) {
        updates = Array.isArray(data.updates) ? data.updates : [];
      } else if (!response.ok) {
        sourceErrors.push(`Call-updates niet geladen (${response.status}).`);
      }
    } catch (error) {
      if (!isAbortLikeLoadError(error)) {
        sourceErrors.push(`Call-updates niet geladen (${error?.message || 'onbekende fout'}).`);
      }
    }

    let insights = [];
    try {
      const response = await fetchWithTimeout(
        `/api/ai/call-insights?limit=500${cacheSuffix}`,
        { method: 'GET', cache: 'no-store' },
        15000
      );
      const data = await parseApiResponse(response);
      if (response.ok && data?.ok) {
        insights = Array.isArray(data.insights) ? data.insights : [];
      } else if (!response.ok) {
        sourceErrors.push(`AI-insights niet geladen (${response.status}).`);
      }
    } catch (error) {
      if (!isAbortLikeLoadError(error)) {
        sourceErrors.push(`AI-insights niet geladen (${error?.message || 'onbekende fout'}).`);
      }
    }

    let interestedLeads = [];
    try {
      const response = await fetchWithTimeout(
        `/api/agenda/interested-leads?limit=500${cacheSuffix}`,
        { method: 'GET', cache: 'no-store' },
        15000
      );
      const data = await parseApiResponse(response);
      if (response.ok && data?.ok) {
        interestedLeads = Array.isArray(data.leads) ? data.leads : [];
      } else if (!response.ok) {
        sourceErrors.push(`Interesse-leads niet geladen (${response.status}).`);
      }
    } catch (error) {
      if (!isAbortLikeLoadError(error)) {
        sourceErrors.push(`Interesse-leads niet geladen (${error?.message || 'onbekende fout'}).`);
      }
    }

    const scopedUpdates = filterCallLikeRowsForMode(updates, allowedPhoneKeys);
    const scopedCallIds = new Set(
      scopedUpdates
        .map((item) => normalizeFreeText(item?.callId || item?.call_id || ''))
        .filter(Boolean)
    );
    const scopedInsights = filterCallLikeRowsForMode(insights, allowedPhoneKeys, scopedCallIds);
    const scopedInterestedLeads = (Array.isArray(interestedLeads) ? interestedLeads : []).filter((item) => {
      const callId = normalizeFreeText(item?.callId || item?.call_id || '');
      const normalizedPhoneKey = phoneKey(item?.phone || '');
      if (callId && scopedCallIds.has(callId)) return true;
      if (normalizedPhoneKey && allowedPhoneKeys.has(normalizedPhoneKey)) return true;
      return false;
    });

    const records = buildLeadDatabaseRecords(parsed.leads, scopedUpdates, scopedInsights);
    const calls = buildConversationRecordsFromUpdates(scopedUpdates);
    return {
      records,
      insights: scopedInsights,
      interestedLeads: scopedInterestedLeads,
      updates: scopedUpdates,
      calls,
      sourceErrors,
      parseErrors: parsed.errors || [],
      duplicateCount: parsed.duplicateCount || 0,
    };
  }

  function buildLeadDatabaseCounts(records) {
    const base = {
      total: 0,
      pending: 0,
      called: 0,
      no_answer: 0,
      callback: 0,
      appointment: 0,
      customer: 0,
      do_not_call: 0,
    };
    (Array.isArray(records) ? records : []).forEach((record) => {
      base.total += 1;
      const decision = normalizeLeadDatabaseDecision(record?.decision);
      if (decision && Object.prototype.hasOwnProperty.call(base, decision)) {
        base[decision] += 1;
      }
    });
    return base;
  }

  function isLeadOutsideReach(record) {
    const text = normalizeSearchText(
      `${record?.latestStatus || ''} ${record?.latestEndedReason || ''} ${record?.summary || ''}`
    );
    return /(buiten bereik|out of reach|out of service|not reachable|unreachable|invalid destination|no route|network unreachable)/.test(
      text
    );
  }

  function getCallRecordingUrl(call) {
    const callId = normalizeFreeText(call?.callId || '');
    const raw = normalizeFreeText(
      call?.recordingUrl || call?.recording_url || call?.recordingUrlProxy || call?.audioUrl || ''
    );
    if (raw) {
      if (callId && /\/api\/coldcalling\/recording-proxy/i.test(raw)) {
        return `/api/coldcalling/recording-proxy?callId=${encodeURIComponent(callId)}`;
      }
      if (/^https?:\/\//i.test(raw)) return raw;
      if (raw.startsWith('/')) return raw;
      return '';
    }

    const recordingSid = normalizeFreeText(call?.recordingSid || call?.recording_sid || '');
    if (callId && recordingSid) {
      return `/api/coldcalling/recording-proxy?callId=${encodeURIComponent(callId)}`;
    }
    if (!callId || !recordingSid) return '';
    return `/api/coldcalling/recording-proxy?recordingSid=${encodeURIComponent(recordingSid)}`;
  }

  function hasNegativePhoneConversationInterestSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(niet meer bellen|bel( me)? niet|geen interesse|geen behoefte|niet geinteresseerd|niet geïnteresseerd|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst|geen prioriteit|geen tijd voor|zijn voorzien|al voorzien|tevreden met huidige partij)/.test(
      text
    );
  }

  function hasPositivePhoneConversationInterestSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(interesse|geinteresseerd|geïnteresseerd|afspraak|demo|offerte|voorstel|prijsopgave|kennismaking|stuur (de )?(offerte|informatie|info|voorstel)|mail .* (offerte|informatie|info|voorstel))/i.test(
      text
    );
  }

  function hasUnavailablePhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(niet bereikbaar|buiten bereik|geen gehoor|geen antwoord|niet opgenomen|no answer|onbereikbaar|voicemail|antwoordapparaat|busy|bezet|missed)/.test(
      text
    );
  }

  function hasOutOfServicePhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(buiten gebruik|buiten[- ]?dienst|niet in gebruik|nummer niet in gebruik|niet aangesloten|not reachable|not connected|not_connected|failed|out of service|not in service|disconnected|number unavailable|ongeldig nummer|invalid number|nummer bestaat niet)/.test(
      text
    );
  }

  function hasAlertPhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(boos|kwaad|agressief|woedend|dreig|klacht|escalat|terugbellen|callback|bel (me )?later|later terug|later opnieuw|op de app|via de app|whatsapp|whats app|stuur .* (app|whatsapp)|andere service|andere dienst|ander product|andere vraag|ander onderwerp)/.test(
      text
    );
  }

  function hasOtherPhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(gaat (hier )?niet over|ga ik niet over|ben ik niet van|niet de juiste persoon|verkeerde persoon|verkeerd nummer|collega gaat hierover|ander contactpersoon|doorverbinden|doorverbonden|receptie|algemene mailbox|beslisser is er niet|eigenaar is er niet)/.test(
      text
    );
  }

  function inferPhoneConversationIntent(call, callIntentByCallId) {
    const text = `${call?.summary || ''} ${call?.transcriptSnippet || ''} ${call?.transcriptFull || ''} ${call?.status || ''} ${call?.endedReason || ''}`;
    const callId = normalizeFreeText(call?.callId || '');
    const callSpecificIntent = callId ? normalizeFreeText(callIntentByCallId?.get(callId) || '') : '';

    // Telefoongesprekken moeten het specifieke gesprek labelen, niet de huidige leadstatus op hetzelfde nummer.
    if (hasAlertPhoneConversationSignal(text)) return 'alert';
    if (hasOutOfServicePhoneConversationSignal(text)) return 'out_of_service';
    if (hasUnavailablePhoneConversationSignal(text)) return 'outside_range';
    if (hasNegativePhoneConversationInterestSignal(text)) return 'geen_interesse';
    if (callSpecificIntent === 'geen_interesse') return 'geen_interesse';
    if (hasPositivePhoneConversationInterestSignal(text)) return 'interesse';
    if (callSpecificIntent === 'interesse') return 'interesse';
    if (hasOtherPhoneConversationSignal(text)) return 'overig';
    return 'overig';
  }

  function buildCallIntentByCallId(records) {
    const result = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      (Array.isArray(record?.insights) ? record.insights : []).forEach((insight) => {
        const callId = normalizeFreeText(insight?.callId || '');
        if (!callId) return;
        const text = `${insight?.summary || ''} ${insight?.followUpReason || ''}`;
        const hasNegativeInsight = hasNegativePhoneConversationInterestSignal(text);
        const hasPositiveInsight =
          Boolean(
            insight?.appointmentBooked ||
              insight?.appointment_booked ||
              insight?.followUpRequired ||
              insight?.follow_up_required
          ) ||
          hasPositivePhoneConversationInterestSignal(text);
        const nextIntent = hasNegativeInsight ? 'geen_interesse' : hasPositiveInsight ? 'interesse' : '';
        const previousIntent = normalizeFreeText(result.get(callId) || '');
        if (!nextIntent || previousIntent === 'geen_interesse') return;
        if (nextIntent === 'geen_interesse' || !previousIntent) {
          result.set(callId, nextIntent);
        }
      });
    });
    return result;
  }

  function isQualifiedPhoneConversation(call) {
    const messageType = normalizeSearchText(String(call?.messageType || ''));
    const directionText = normalizeSearchText(String(call?.direction || ''));
    const callId = normalizeFreeText(call?.callId || '');
    const phone = normalizeFreeText(call?.phone || '');
    const status = normalizeSearchText(String(call?.status || ''));
    const endedReason = normalizeSearchText(String(call?.endedReason || ''));
    const hasConversationContent = Boolean(
      String(call?.summary || '').trim() ||
      String(call?.transcriptSnippet || '').trim() ||
      String(call?.transcriptFull || '').trim()
    );
    const hasRecording = Boolean(getCallRecordingUrl(call));
    const hasKnownDuration = Number.isFinite(Number(call?.durationSeconds)) && Number(call.durationSeconds) > 0;
    const looksLikeInboundStreamCall =
      /twilio\.(inbound\.selected|stream\.stream-started|stream\.stream-stopped|stream\.stream-error)/.test(
        messageType
      );

    // De Database view is alleen voor outbound campagne-calls.
    if (directionText.includes('inbound') || /twilio\.inbound\./.test(messageType)) {
      return false;
    }

    // Telefoongesprekken in de Database moeten niet verdwijnen wanneer een provider
    // later statuslabels bijwerkt (bijv. failed/no_answer/not_connected).
    if (hasRecording || hasConversationContent || hasKnownDuration) return true;
    if (callId && (status || endedReason || phone)) return true;
    if (looksLikeInboundStreamCall) return true;
    return false;
  }

  function getLeadDatabaseFilterBucket(record) {
    const decision = normalizeLeadDatabaseDecision(record?.decision);
    if (isLeadOutsideReach(record)) return 'outside_range';
    if (decision === 'pending') return 'not_called';
    if (decision === 'callback') return 'callback';
    if (decision === 'appointment' || decision === 'customer' || decision === 'called') return 'interesse';
    if (decision === 'do_not_call') return 'blacklist';
    if (decision === 'no_answer') return 'no_answer';
    return 'interesse';
  }

  function getLeadDatabaseFilterCards(records, calls) {
    const base = {
      all: 0,
      no_answer: 0,
      callback: 0,
      interesse: 0,
      blacklist: 0,
      outside_range: 0,
    };
    const totalCalls = Math.max(
      0,
      (Array.isArray(calls) ? calls : []).filter((call) => isQualifiedPhoneConversation(call)).length
    );

    (Array.isArray(records) ? records : []).forEach((record) => {
      base.all += 1;
      const bucket = getLeadDatabaseFilterBucket(record);
      if (bucket && Object.prototype.hasOwnProperty.call(base, bucket)) {
        base[bucket] += 1;
      }
    });

    return [
      { key: 'all', label: 'ALLE BEDRIJVEN', count: base.all },
      { key: 'callback', label: 'ACTUELE BELLIJST', count: base.callback },
      { key: 'interesse', label: 'INTERESSE', count: base.interesse },
      { key: 'blacklist', label: 'GEEN INTERRESSE', count: base.blacklist },
      { key: 'outside_range', label: 'BUITEN BEREIK', count: base.outside_range },
      { key: 'phone_calls', label: 'TELEFOONGESPREKKEN', count: totalCalls },
    ];
  }

  function getDashboardStatIdentity(item) {
    const callId = normalizeFreeText(item?.callId || item?.call_id || '');
    if (callId) return `call:${callId}`;
    const normalizedPhoneKey = phoneKey(item?.phone || item?.lead?.phone || item?.lead?.phoneE164 || '');
    if (normalizedPhoneKey) return `phone:${normalizedPhoneKey}`;
    return '';
  }

  function buildDashboardStatsSummaryFromPersistedSources(data) {
    const records = Array.isArray(data?.records) ? data.records : [];
    const calls = (Array.isArray(data?.calls) ? data.calls : []).filter((call) => isQualifiedPhoneConversation(call));
    const interestedLeads = Array.isArray(data?.interestedLeads) ? data.interestedLeads : [];
    const callIntentByCallId = buildCallIntentByCallId(records);
    const interestedKeys = new Set();

    calls.forEach((call) => {
      if (inferPhoneConversationIntent(call, callIntentByCallId) !== 'interesse') return;
      const identity = getDashboardStatIdentity(call);
      if (identity) interestedKeys.add(identity);
    });

    interestedLeads.forEach((lead) => {
      const identity = getDashboardStatIdentity(lead);
      if (identity) interestedKeys.add(identity);
    });

    const started = Math.max(0, calls.length);
    const answered = Math.max(
      0,
      calls.filter((call) => inferConversationAnswered(call) === true).length
    );
    const interested = Math.min(started, Math.max(0, interestedKeys.size));

    return {
      started,
      answered,
      interested,
      conversionPct: started > 0 ? Math.round((interested / started) * 100) : 0,
    };
  }

  async function refreshDashboardStatsFromSupabase(options = {}) {
    const silent = Boolean(options?.silent);
    const force = Boolean(options?.force);

    if (dashboardStatsRefreshPromise) return dashboardStatsRefreshPromise;

    dashboardStatsRefreshPromise = (async () => {
      try {
        const data = await fetchLeadDatabaseRecords({
          cacheBust: force ? String(Date.now()) : '',
        });
        const summary = buildDashboardStatsSummaryFromPersistedSources(data);
        updateStats(summary);
        return { ok: true, summary };
      } catch (error) {
        if (!silent) {
          setStatusMessage(
            'error',
            normalizeFreeText(error?.message || '') || 'Dashboardstatistieken konden niet uit Supabase geladen worden.'
          );
        }
        return {
          ok: false,
          error: normalizeFreeText(error?.message || '') || 'Dashboardstatistieken konden niet geladen worden.',
        };
      } finally {
        dashboardStatsRefreshPromise = null;
      }
    })();

    return dashboardStatsRefreshPromise;
  }

  function ensureLeadDatabaseModal() {
    let modal = byId('leadDatabaseModalOverlay');
    if (modal) return modal;

    const state = {
      loading: false,
      opening: false,
      importing: false,
      error: '',
      info: '',
      records: [],
      insights: [],
      interestedLeads: [],
      calls: [],
      search: '',
      filter: 'callback',
      sourceErrors: [],
      pollTimer: null,
      lastRefreshedAt: '',
      detailCallId: '',
      forceReloadAfterLoad: false,
      openRequestId: 0,
    };
    const callDetailSummaryByCallId = new Map();
    const callDetailSummaryPromiseByCallId = new Map();
    const callDetailPayloadByCallId = new Map();
    const callDetailPayloadPromiseByCallId = new Map();
    let leadDatabasePrewarmPromise = null;
    const leadDatabaseUiLabels = {
      all: 'Alle bedrijven',
      callback: 'Actuele bellijst',
      interesse: 'Interesse',
      blacklist: 'Geen interesse',
      outside_range: 'Buiten bereik',
      phone_calls: 'Telefoongesprekken',
    };

    function getLeadDatabaseUiLabel(key) {
      return leadDatabaseUiLabels[String(key || '').trim()] || 'Onbekend';
    }

    function ensureLeadDatabasePresentationAssets() {
      if (!document.getElementById('leadDatabaseModalFontLink')) {
        const fontLink = document.createElement('link');
        fontLink.id = 'leadDatabaseModalFontLink';
        fontLink.rel = 'stylesheet';
        fontLink.href =
          'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap';
        document.head.appendChild(fontLink);
      }

      if (!document.getElementById('leadDatabaseModalStyles')) {
        const style = document.createElement('style');
        style.id = 'leadDatabaseModalStyles';
        style.textContent = `
          #leadDatabaseModalShell {
            --lead-db-bg: #f0ede8;
            --lead-db-crimson: #9b2355;
            --lead-db-crimson-light: #c4346a;
            --lead-db-text-dark: #1a1a2e;
            --lead-db-text-mid: #555555;
            --lead-db-text-light: #999999;
            --lead-db-border: #e2ddd6;
            --lead-db-card: #ffffff;
            --lead-db-tag: #f5f0eb;
            --lead-db-green: #16733c;
            --lead-db-red: #c0392b;
            --lead-db-orange: #b45a00;
            --lead-db-blue: #1a5f8a;
            width: 100vw;
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: var(--lead-db-bg);
            color: var(--lead-db-text-dark);
            font-family: 'Barlow', sans-serif;
            overflow: hidden;
          }

          #leadDatabaseModalShell,
          #leadDatabaseModalShell * {
            box-sizing: border-box;
          }

          #leadDatabaseModalShell .lead-db-page {
            flex: 1;
            min-height: 0;
            overflow: auto;
            padding: 40px 48px 24px;
          }

          #leadDatabaseModalShell .lead-db-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 8px;
          }

          #leadDatabaseModalShell .lead-db-header-copy {
            min-width: 0;
          }

          #leadDatabaseModalShell .lead-db-page-title {
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 30px;
            font-weight: 800;
            letter-spacing: 1px;
            line-height: 1;
            text-transform: uppercase;
          }

          #leadDatabaseModalShell .lead-db-page-sub {
            margin-top: 6px;
            font-size: 13px;
            color: var(--lead-db-text-light);
          }

          #leadDatabaseModalShell .lead-db-close-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 42px;
            height: 42px;
            flex-shrink: 0;
            border: 1px solid var(--lead-db-border);
            border-radius: 999px;
            background: var(--lead-db-card);
            color: var(--lead-db-text-mid);
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 24px;
            line-height: 1;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          #leadDatabaseModalShell .lead-db-close-btn:hover {
            border-color: var(--lead-db-crimson);
            color: var(--lead-db-crimson);
          }

          #leadDatabaseModalShell .lead-db-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin: 20px 0 18px;
          }

          #leadDatabaseModalShell .lead-db-toolbar-left,
          #leadDatabaseModalShell .lead-db-toolbar-right {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
          }

          #leadDatabaseModalShell .lead-db-refresh-info {
            font-size: 12px;
            color: var(--lead-db-text-light);
          }

          #leadDatabaseModalShell .lead-db-btn {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 8px 16px;
            border: 1px solid var(--lead-db-border);
            border-radius: 4px;
            background: var(--lead-db-card);
            color: var(--lead-db-text-mid);
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
          }

          #leadDatabaseModalShell .lead-db-btn:hover {
            border-color: var(--lead-db-crimson);
            color: var(--lead-db-crimson);
          }

          #leadDatabaseModalShell .lead-db-btn--primary {
            background: var(--lead-db-crimson);
            border-color: var(--lead-db-crimson);
            color: #ffffff;
          }

          #leadDatabaseModalShell .lead-db-btn--primary:hover {
            background: var(--lead-db-crimson-light);
            border-color: var(--lead-db-crimson-light);
            color: #ffffff;
          }

          #leadDatabaseModalShell .lead-db-btn svg {
            width: 13px;
            height: 13px;
            flex-shrink: 0;
          }

          #leadDatabaseModalShell .lead-db-btn[disabled] {
            opacity: 0.55;
            cursor: progress;
          }

          #leadDatabaseModalShell .lead-db-status {
            display: none;
            margin-bottom: 18px;
            padding: 12px 16px;
            border: 1px solid var(--lead-db-border);
            border-radius: 6px;
            background: var(--lead-db-card);
            font-size: 13px;
            color: var(--lead-db-text-mid);
          }

          #leadDatabaseModalShell .lead-db-status--error {
            border-color: rgba(192, 57, 43, 0.18);
            background: rgba(192, 57, 43, 0.08);
            color: var(--lead-db-red);
          }

          #leadDatabaseModalShell .lead-db-status--info {
            border-color: rgba(22, 115, 60, 0.18);
            background: rgba(22, 115, 60, 0.08);
            color: var(--lead-db-green);
          }

          #leadDatabaseModalShell .lead-db-status--muted {
            border-color: var(--lead-db-border);
            background: var(--lead-db-tag);
            color: var(--lead-db-text-mid);
          }

          #leadDatabaseModalShell .lead-db-stats {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 28px;
          }

          #leadDatabaseModalShell .lead-db-stat {
            width: 100%;
            border: 1px solid var(--lead-db-border);
            border-radius: 6px;
            background: var(--lead-db-card);
            padding: 14px 16px;
            text-align: left;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          #leadDatabaseModalShell .lead-db-stat:hover {
            border-color: rgba(155, 35, 85, 0.35);
            transform: translateY(-1px);
          }

          #leadDatabaseModalShell .lead-db-stat.is-active {
            border-color: var(--lead-db-crimson);
            box-shadow: 0 0 0 1px rgba(155, 35, 85, 0.08);
          }

          #leadDatabaseModalShell .lead-db-stat-label {
            margin-bottom: 6px;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 1.5px;
            line-height: 1.3;
            text-transform: uppercase;
            color: var(--lead-db-text-light);
          }

          #leadDatabaseModalShell .lead-db-stat-val {
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 28px;
            font-weight: 800;
            line-height: 1;
            color: var(--lead-db-text-dark);
          }

          #leadDatabaseModalShell .lead-db-stat.is-active .lead-db-stat-val {
            color: var(--lead-db-crimson);
          }

          #leadDatabaseModalShell .lead-db-filter-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 16px;
          }

          #leadDatabaseModalShell .lead-db-search-wrap {
            position: relative;
            margin-left: 0;
          }

          #leadDatabaseModalShell .lead-db-search-wrap input {
            width: 220px;
            padding: 7px 12px 7px 30px;
            border: 1px solid var(--lead-db-border);
            border-radius: 4px;
            background: var(--lead-db-card);
            color: var(--lead-db-text-dark);
            font-family: 'Barlow', sans-serif;
            font-size: 12px;
            outline: none;
            transition: border-color 0.15s ease;
          }

          #leadDatabaseModalShell .lead-db-search-wrap input:focus {
            border-color: var(--lead-db-crimson);
          }

          #leadDatabaseModalShell .lead-db-search-wrap svg {
            position: absolute;
            left: 9px;
            top: 50%;
            width: 12px;
            height: 12px;
            color: var(--lead-db-text-light);
            transform: translateY(-50%);
            pointer-events: none;
          }

          #leadDatabaseModalShell .lead-db-table-card {
            overflow: hidden;
            border: 1px solid var(--lead-db-border);
            border-radius: 6px;
            background: var(--lead-db-card);
          }

          #leadDatabaseModalShell .lead-db-table-wrap {
            min-height: 180px;
            overflow: auto;
          }

          #leadDatabaseModalShell .lead-db-table-head,
          #leadDatabaseModalShell .lead-db-row {
            display: grid;
            gap: 0;
            align-items: center;
          }

          #leadDatabaseModalShell .lead-db-table-head {
            padding: 9px 20px;
            background: var(--lead-db-tag);
            border-bottom: 1px solid var(--lead-db-border);
          }

          #leadDatabaseModalShell .lead-db-table-head span {
            color: var(--lead-db-text-light);
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
          }

          #leadDatabaseModalShell .lead-db-table-head--records,
          #leadDatabaseModalShell .lead-db-row--records {
            grid-template-columns: 2fr 1.45fr 1.25fr 1fr;
            min-width: 900px;
          }

          #leadDatabaseModalShell .lead-db-table-head--calls,
          #leadDatabaseModalShell .lead-db-row--calls {
            grid-template-columns: 2fr 1.3fr 1.4fr 0.8fr 1.35fr;
            min-width: 980px;
          }

          #leadDatabaseModalShell .lead-db-row {
            padding: 13px 20px;
            border-bottom: 1px solid var(--lead-db-border);
            transition: background 0.12s ease;
          }

          #leadDatabaseModalShell .lead-db-row:last-child {
            border-bottom: none;
          }

          #leadDatabaseModalShell .lead-db-row:hover {
            background: var(--lead-db-tag);
          }

          #leadDatabaseModalShell .lead-db-row[role="button"] {
            cursor: pointer;
          }

          #leadDatabaseModalShell .lead-db-row[role="button"]:focus {
            outline: 2px solid rgba(155, 35, 85, 0.25);
            outline-offset: -2px;
          }

          #leadDatabaseModalShell .lead-db-cell-bedrijf {
            display: flex;
            align-items: center;
            min-width: 0;
          }

          #leadDatabaseModalShell .lead-db-company-name,
          #leadDatabaseModalShell .lead-db-cell,
          #leadDatabaseModalShell .lead-db-cell a {
            min-width: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          #leadDatabaseModalShell .lead-db-company-name {
            font-size: 13px;
            font-weight: 600;
            color: var(--lead-db-text-dark);
          }

          #leadDatabaseModalShell .lead-db-cell {
            font-size: 12px;
            color: var(--lead-db-text-mid);
          }

          #leadDatabaseModalShell .lead-db-cell--mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }

          #leadDatabaseModalShell .lead-db-cell--muted {
            color: var(--lead-db-text-light);
          }

          #leadDatabaseModalShell .lead-db-cell a {
            color: var(--lead-db-text-dark);
            text-decoration: underline;
            text-underline-offset: 2px;
          }

          #leadDatabaseModalShell .lead-db-table-summary {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            flex-wrap: wrap;
            padding: 12px 20px;
            border-top: 1px solid var(--lead-db-border);
            background: rgba(155, 35, 85, 0.03);
          }

          #leadDatabaseModalShell .lead-db-table-summary-item {
            min-width: 156px;
            padding: 8px 12px;
            border: 1px solid var(--lead-db-border);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.58);
          }

          #leadDatabaseModalShell .lead-db-table-summary-label {
            display: block;
            margin-bottom: 3px;
            color: var(--lead-db-text-light);
            font-size: 8px;
            font-weight: 700;
            letter-spacing: 1.3px;
            text-transform: uppercase;
          }

          #leadDatabaseModalShell .lead-db-table-summary-value {
            display: block;
            color: var(--lead-db-text-dark);
            font-family: 'Barlow', sans-serif;
            font-size: 20px;
            font-weight: 700;
            line-height: 1.1;
          }

          #leadDatabaseModalShell .lead-db-status-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            border-radius: 20px;
            white-space: nowrap;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
          }

          #leadDatabaseModalShell .lead-db-status-pill::before {
            content: '';
            width: 5px;
            height: 5px;
            border-radius: 50%;
            flex-shrink: 0;
          }

          #leadDatabaseModalShell .lead-db-status-pill--interesse {
            background: rgba(22, 115, 60, 0.1);
            color: var(--lead-db-green);
          }

          #leadDatabaseModalShell .lead-db-status-pill--interesse::before {
            background: var(--lead-db-green);
          }

          #leadDatabaseModalShell .lead-db-status-pill--geen {
            background: rgba(192, 57, 43, 0.1);
            color: var(--lead-db-red);
          }

          #leadDatabaseModalShell .lead-db-status-pill--geen::before {
            background: var(--lead-db-red);
          }

          #leadDatabaseModalShell .lead-db-status-pill--buiten {
            background: rgba(155, 35, 85, 0.08);
            color: var(--lead-db-crimson);
          }

          #leadDatabaseModalShell .lead-db-status-pill--buiten::before {
            background: var(--lead-db-crimson);
          }

          #leadDatabaseModalShell .lead-db-status-pill--niet-bereikbaar {
            background: rgba(192, 57, 43, 0.08);
            color: var(--lead-db-red);
          }

          #leadDatabaseModalShell .lead-db-status-pill--niet-bereikbaar::before {
            background: var(--lead-db-red);
          }

          #leadDatabaseModalShell .lead-db-status-pill--belt {
            background: rgba(26, 95, 138, 0.1);
            color: var(--lead-db-blue);
          }

          #leadDatabaseModalShell .lead-db-status-pill--belt::before {
            background: var(--lead-db-blue);
          }

          #leadDatabaseModalShell .lead-db-status-pill--alert {
            background: rgba(180, 90, 0, 0.12);
            color: var(--lead-db-orange);
          }

          #leadDatabaseModalShell .lead-db-status-pill--alert::before {
            background: var(--lead-db-orange);
          }

          #leadDatabaseModalShell .lead-db-empty {
            padding: 48px;
            text-align: center;
            color: var(--lead-db-text-light);
            font-size: 13px;
          }

          #leadDatabaseCallDetailOverlay {
            position: fixed;
            inset: 0;
            z-index: 10010;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 18px;
            background: rgba(0, 0, 0, 0.35);
          }

          #leadDatabaseCallDetailCard {
            width: min(860px, 100%);
            max-height: min(86vh, 920px);
            overflow: auto;
            border: 1px solid var(--lead-db-border);
            border-radius: 10px;
            background: var(--lead-db-card);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
          }

          #leadDatabaseCallDetailHeader {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            padding: 16px 20px;
            background: var(--lead-db-tag);
            border-bottom: 1px solid var(--lead-db-border);
          }

          #leadDatabaseCallDetailTitle {
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 26px;
            font-weight: 800;
            line-height: 1.05;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: var(--lead-db-text-dark);
          }

          #leadDatabaseCallDetailMeta {
            margin-top: 8px;
            font-size: 12px;
            color: var(--lead-db-text-light);
          }

          #leadDatabaseCallDetailCloseBtn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 8px 16px;
            border: 1px solid var(--lead-db-border);
            border-radius: 4px;
            background: var(--lead-db-card);
            color: var(--lead-db-text-mid);
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            cursor: pointer;
          }

          #leadDatabaseCallDetailBody {
            padding: 20px;
          }

          #leadDatabaseCallDetailBody .lead-db-detail-label {
            margin-bottom: 8px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1.4px;
            text-transform: uppercase;
            color: var(--lead-db-text-light);
          }

          #leadDatabaseCallDetailSummary {
            font-size: 15px;
            line-height: 1.75;
            color: var(--lead-db-text-dark);
          }

          #leadDatabaseCallDetailAudio {
            width: 100%;
            color-scheme: light;
          }

          @media (max-width: 1200px) {
            #leadDatabaseModalShell .lead-db-stats {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }

          @media (max-width: 820px) {
            #leadDatabaseModalShell .lead-db-page {
              padding: 24px 18px 18px;
            }

            #leadDatabaseModalShell .lead-db-toolbar {
              align-items: flex-start;
              flex-direction: column;
            }

            #leadDatabaseModalShell .lead-db-search-wrap {
              width: 100%;
              margin-left: 0;
            }

            #leadDatabaseModalShell .lead-db-search-wrap input {
              width: 100%;
            }

            #leadDatabaseModalShell .lead-db-stats {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }
        `;
        document.head.appendChild(style);
      }
    }

    modal = document.createElement('div');
    modal.id = 'leadDatabaseModalOverlay';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.display = 'none';
    modal.style.alignItems = 'stretch';
    modal.style.justifyContent = 'stretch';
    modal.style.padding = '0';
    modal.style.zIndex = '9999';
    const modeUi = getBusinessModeUiConfig();
    ensureLeadDatabasePresentationAssets();

    modal.innerHTML = `
      <div id="leadDatabaseModalShell">
        <div class="lead-db-page">
          <div class="lead-db-header">
            <div class="lead-db-header-copy">
              <div class="lead-db-page-title">Database</div>
              <div id="leadDatabaseHeaderHint" class="lead-db-page-sub">${escapeHtml(modeUi.dbHint)}</div>
            </div>
            <button type="button" id="leadDatabaseCancelBtn" class="lead-db-close-btn" aria-label="Sluiten" title="Sluiten">×</button>
          </div>

          <div class="lead-db-toolbar">
            <div class="lead-db-toolbar-left">
              <div id="leadDatabaseRefreshInfo" class="lead-db-refresh-info">Nog niet ververst</div>
            </div>
            <div class="lead-db-toolbar-right">
              <button type="button" id="leadDatabaseAddManualBtn" class="lead-db-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Handmatig toevoegen
              </button>
              <button type="button" id="leadDatabaseImportBtn" class="lead-db-btn lead-db-btn--primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                Upload
              </button>
              <input type="file" id="leadDatabaseImportInput" accept=".csv,.tsv,.txt,.json,.xls,.xlsx" style="display:none;">
            </div>
          </div>

          <div id="leadDatabaseStatusBar" class="lead-db-status" aria-live="polite"></div>

          <div id="leadDatabaseSummaryCards" class="lead-db-stats"></div>

          <div class="lead-db-filter-bar">
            <div class="lead-db-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="search" id="leadDatabaseSearchInput" placeholder="Zoek bedrijf of nummer...">
            </div>
          </div>

          <div class="lead-db-table-card">
            <div id="leadDatabaseTableWrap" class="lead-db-table-wrap"></div>
          </div>
        </div>

        <div id="leadDatabaseCallDetailOverlay">
          <div id="leadDatabaseCallDetailCard">
            <div id="leadDatabaseCallDetailHeader">
              <div>
                <div id="leadDatabaseCallDetailTitle">Telefoongesprek</div>
                <div id="leadDatabaseCallDetailMeta"></div>
              </div>
              <button type="button" id="leadDatabaseCallDetailCloseBtn">Sluiten</button>
            </div>
            <div id="leadDatabaseCallDetailBody">
              <div style="margin-bottom:16px;">
                <div class="lead-db-detail-label">Samenvatting</div>
                <div id="leadDatabaseCallDetailSummary"></div>
              </div>
              <div>
                <div class="lead-db-detail-label">Gesprek terugluisteren</div>
                <audio id="leadDatabaseCallDetailAudio" controls preload="metadata"></audio>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    function applyTheme() {
      modal.style.background = 'rgba(0, 0, 0, 0.08)';
      const shell = byId('leadDatabaseModalShell');
      const hint = byId('leadDatabaseHeaderHint');
      const detailOverlay = byId('leadDatabaseCallDetailOverlay');
      const detailCard = byId('leadDatabaseCallDetailCard');
      const detailHeader = byId('leadDatabaseCallDetailHeader');
      const detailMeta = byId('leadDatabaseCallDetailMeta');
      const detailSummary = byId('leadDatabaseCallDetailSummary');
      const detailCloseBtn = byId('leadDatabaseCallDetailCloseBtn');

      if (shell) {
        shell.style.background = '#f0ede8';
        shell.style.color = '#1a1a2e';
      }
      if (hint) hint.style.color = '#999999';
      if (detailOverlay) {
        detailOverlay.style.background = 'rgba(0, 0, 0, 0.35)';
      }
      if (detailCard) {
        detailCard.style.border = '1px solid #e2ddd6';
        detailCard.style.background = '#ffffff';
        detailCard.style.color = '#1a1a2e';
      }
      if (detailHeader) {
        detailHeader.style.borderBottom = '1px solid #e2ddd6';
        detailHeader.style.background = '#f5f0eb';
      }
      if (detailMeta) detailMeta.style.color = '#999999';
      if (detailSummary) detailSummary.style.color = '#1a1a2e';
      if (detailCloseBtn) {
        detailCloseBtn.style.border = '1px solid #e2ddd6';
        detailCloseBtn.style.background = '#ffffff';
        detailCloseBtn.style.color = '#555555';
      }
    }

    function getFilteredRecords() {
      const needle = normalizeSearchText(state.search);
      let rows = state.records.slice();
      if (state.filter && state.filter !== 'all') {
        rows = rows.filter((record) => getLeadDatabaseFilterBucket(record) === state.filter);
      }
      if (!needle) return rows;
      return rows.filter((record) => {
        const haystack = normalizeSearchText(
          [
            record.company,
            record.contactPerson,
            record.phone,
            record.branche,
            record.province,
            record.address,
            record.website,
            getLeadDatabaseDecisionLabel(record.decision),
            record.summary,
            record.latestStatus,
            record.latestEndedReason,
          ]
            .map((item) => String(item || ''))
            .join(' ')
        );
        return haystack.includes(needle);
      });
    }

    function getFilteredCalls() {
      const needle = normalizeSearchText(state.search);
      const rows = (Array.isArray(state.calls) ? state.calls : [])
        .filter((call) => isQualifiedPhoneConversation(call))
        .sort((a, b) => getConversationRecordOccurredMs(b) - getConversationRecordOccurredMs(a));
      if (!needle) return rows;
      return rows.filter((call) => {
        const haystack = normalizeSearchText(
          [
            call?.company,
            call?.name,
            call?.phone,
            call?.status,
            call?.endedReason,
            call?.summary,
            call?.transcriptSnippet,
          ]
            .map((item) => String(item || ''))
            .join(' ')
        );
        return haystack.includes(needle);
      });
    }

    function isPhoneCallAudioPlaying() {
      const detailAudio = byId('leadDatabaseCallDetailAudio');
      return Boolean(detailAudio && !detailAudio.paused && !detailAudio.ended);
    }

    function getCallDetailRecord(callId) {
      const normalizedCallId = normalizeFreeText(callId);
      if (!normalizedCallId) return null;
      return (
        (Array.isArray(state.calls) ? state.calls : []).find(
          (call) => normalizeFreeText(call?.callId || '') === normalizedCallId
        ) || null
      );
    }

    function getCallInsightRecord(callId) {
      const normalizedCallId = normalizeFreeText(callId);
      if (!normalizedCallId) return null;
      let latestInsight = null;
      (Array.isArray(state.insights) ? state.insights : []).forEach((insight) => {
        if (normalizeFreeText(insight?.callId || '') !== normalizedCallId) return;
        if (!latestInsight || getCallLikeRecordUpdatedMs(insight) > getCallLikeRecordUpdatedMs(latestInsight)) {
          latestInsight = insight;
        }
      });
      return latestInsight;
    }

    function getInterestedLeadRecord(callId) {
      const normalizedCallId = normalizeFreeText(callId);
      if (!normalizedCallId) return null;
      let latestLead = null;
      (Array.isArray(state.interestedLeads) ? state.interestedLeads : []).forEach((lead) => {
        if (normalizeFreeText(lead?.callId || lead?.call_id || '') !== normalizedCallId) return;
        if (!latestLead || getCallLikeRecordUpdatedMs(lead) > getCallLikeRecordUpdatedMs(latestLead)) {
          latestLead = lead;
        }
      });
      return latestLead;
    }

    function buildLeadDatabaseCallSummarySourceText(call, insight, interestedLead, remoteDetail = null) {
      const transcriptSource = [
        remoteDetail?.transcript,
        remoteDetail?.transcriptSnippet,
        call?.transcriptFull,
        call?.transcriptSnippet,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join('\n\n');

      if (transcriptSource) {
        return [`Gebruik de transcriptie hieronder als bron van waarheid voor de samenvatting.`, transcriptSource]
          .filter(Boolean)
          .join('\n\n');
      }

      return [
        remoteDetail?.summary,
        call?.summary,
        insight?.summary,
        interestedLead?.summary,
      ]
        .map((value) => String(value || '').trim())
        .filter((value) => value && !looksLikeAgendaConfirmationSummary(value))
        .join('\n\n');
    }

    function capitalizeLeadDatabaseSentenceStart(value) {
      const raw = normalizeFreeText(value || '');
      if (!raw) return '';
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    function buildLeadDatabaseTranscriptFallbackSummary(call, insight, interestedLead, remoteDetail = null) {
      const transcript = [
        remoteDetail?.transcript,
        remoteDetail?.transcriptSnippet,
        call?.transcriptFull,
        call?.transcriptSnippet,
        looksLikeConversationTranscript(call?.summary) || looksLikeDirectSpeechConversationSummary(call?.summary)
          ? call?.summary
          : '',
        looksLikeConversationTranscript(remoteDetail?.summary) ||
        looksLikeDirectSpeechConversationSummary(remoteDetail?.summary)
          ? remoteDetail?.summary
          : '',
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join('\n\n');

      if (!transcript || transcript.length < 24) return '';

      const company = normalizeFreeText(
        call?.company || interestedLead?.company || insight?.company || insight?.leadCompany || ''
      );
      const contact = normalizeFreeText(
        call?.name || interestedLead?.contact || insight?.contactName || insight?.leadName || ''
      );
      const prospectReference = contact || (company ? `de contactpersoon van ${company}` : 'de prospect');
      const prospectSubject = capitalizeLeadDatabaseSentenceStart(prospectReference);
      const websiteContext = /\bwebsite\b/i.test(transcript);
      const outdatedWebsiteContext = /\b(verouderd|verouderde|oud|ouderwets|technische opbouw|design)\b/i.test(
        transcript
      );
      const hasAppointmentIntent = /\b(afspraak|inplannen|langskomen|langs komen|op kantoor)\b/i.test(
        transcript
      );
      const hasPositiveInterest =
        hasAppointmentIntent ||
        /\b(interesse|geinteresseerd|geïnteresseerd|open voor|klinkt goed|ja graag|prima|helemaal goed)\b/i.test(
          transcript
        );
      const hasNoInterest = /\b(geen interesse|geen behoefte|niet nodig|hoeft niet|laat maar|we hebben al)\b/i.test(
        transcript
      );
      const hasCallbackRequest = /\b(later terug|terugbellen|terug bellen|bel later|volgende week|andere keer)\b/i.test(
        transcript
      );
      const hasOfficePreference = /\b(op kantoor|kantoor)\b/i.test(transcript);
      const hasWhatsappRequest = /\b(whatsapp|app(?:je)?|appen)\b/i.test(transcript);
      const hasEmailRequest = /\b(e-mail|email|mail|offerte)\b/i.test(transcript);
      const hasAlertSignal = /\b(boos|kwaad|woedend|geirriteerd|geïrriteerd|agressief|klacht)\b/i.test(
        transcript
      );
      const hasOtherServiceSignal = /\b(andere service|andere dienst|ander product|andere oplossing)\b/i.test(
        transcript
      );

      const appointmentDate = normalizeFreeText(interestedLead?.date || remoteDetail?.date || '');
      const appointmentTime = normalizeFreeText(interestedLead?.time || remoteDetail?.time || '');
      const appointmentLocation = normalizeFreeText(
        interestedLead?.location || remoteDetail?.location || remoteDetail?.appointmentLocation || ''
      );
      const appointmentParts = [];
      if (appointmentDate) appointmentParts.push(`op ${appointmentDate}`);
      if (appointmentTime) appointmentParts.push(`om ${appointmentTime}`);
      if (appointmentLocation) appointmentParts.push(`bij ${appointmentLocation}`);
      const appointmentLabel = appointmentParts.join(' ');

      const sentences = [];
      if (websiteContext && outdatedWebsiteContext) {
        sentences.push(
          `Ruben Nijhuis gaf aan dat de website ${company ? `van ${company}` : 'van de prospect'} verouderd oogt qua design en technische opbouw.`
        );
      } else if (websiteContext) {
        sentences.push(
          `Ruben Nijhuis besprak de huidige website en mogelijke verbeteringen met ${prospectReference}.`
        );
      } else {
        sentences.push(
          `Ruben Nijhuis voerde een inhoudelijk gesprek met ${prospectReference} over de huidige situatie en mogelijke vervolgstappen.`
        );
      }

      if (hasNoInterest) {
        sentences.push(`${prospectSubject} gaf aan op dit moment geen behoefte te hebben aan een vervolgstap.`);
      } else if (hasAppointmentIntent) {
        sentences.push(
          `${prospectSubject} reageerde positief en wilde een afspraak inplannen${
            appointmentLabel ? ` ${appointmentLabel}` : ''
          }.`
        );
        if (websiteContext) {
          sentences.push(
            `${prospectSubject} stond open om de vernieuwing van de website in een vervolggesprek verder door te nemen.`
          );
        }
        if (hasOfficePreference) {
          sentences.push('Een afspraak op kantoor had daarbij duidelijk de voorkeur.');
        }
      } else if (hasCallbackRequest) {
        sentences.push(`${prospectSubject} gaf aan dat later contact beter uitkomt.`);
      } else if (hasPositiveInterest) {
        sentences.push(`${prospectSubject} gaf aan geïnteresseerd te zijn in een vervolgstap.`);
      }

      if (!hasNoInterest) {
        if (hasWhatsappRequest && hasEmailRequest) {
          sentences.push('Er is besproken dat aanvullende informatie via WhatsApp of e-mail gedeeld kan worden.');
        } else if (hasWhatsappRequest) {
          sentences.push('Er is besproken dat verdere informatie via WhatsApp gedeeld kan worden.');
        } else if (hasEmailRequest) {
          sentences.push('Er is besproken dat verdere informatie per e-mail gedeeld kan worden.');
        }

        if (hasOtherServiceSignal) {
          sentences.push(`${prospectSubject} stuurde het gesprek richting een andere dienst of aanvullende vraag.`);
        }
        if (hasAlertSignal) {
          sentences.push('Het gesprek vroeg om extra zorgvuldigheid door de toon of gevoeligheid van de situatie.');
        }

      }

      const summary = Array.from(
        new Set(sentences.map((sentence) => sanitizeConversationSummaryCopy(sentence)).filter(Boolean))
      ).join(' ');
      return pickReadableConversationSummary(summary) || sanitizeConversationSummaryCopy(summary);
    }

    function getLeadDatabaseCallSummaryFallback(call, insight, interestedLead) {
      const normalizedCallId = normalizeFreeText(call?.callId || '');
      const cachedDetail = callDetailPayloadByCallId.get(normalizedCallId) || null;
      const cachedSummary = pickReadableConversationSummary(
        cachedDetail?.conversationSummary,
        callDetailSummaryByCallId.get(normalizedCallId),
        getSharedCallSummary(normalizedCallId),
        cachedDetail?.summary,
        cachedDetail?.callSummary,
        cachedDetail?.aiSummary,
        call?.summary,
        insight?.summary,
        interestedLead?.summary
      );
      if (cachedSummary && !looksLikeAgendaConfirmationSummary(cachedSummary)) return cachedSummary;
      const readableSummary = pickReadableConversationSummary(
        call?.summary,
        insight?.summary,
        interestedLead?.summary
      );
      if (readableSummary && !looksLikeAgendaConfirmationSummary(readableSummary)) return readableSummary;
      const transcriptFallback = buildLeadDatabaseTranscriptFallbackSummary(
        call,
        insight,
        interestedLead,
        cachedDetail
      );
      if (transcriptFallback && !looksLikeAgendaConfirmationSummary(transcriptFallback)) return transcriptFallback;
      return '';
    }

    function hasLeadDatabaseSnapshot() {
      return (
        Boolean(state.lastRefreshedAt) ||
        (Array.isArray(state.records) && state.records.length > 0) ||
        (Array.isArray(state.calls) && state.calls.length > 0)
      );
    }

    function prewarmLeadDatabase(options = {}) {
      const force = Boolean(options && options.force);
      if (leadDatabasePrewarmPromise && !force) {
        return leadDatabasePrewarmPromise;
      }

      leadDatabasePrewarmPromise = (async () => {
        if (!remoteUiStateLoaded || remoteUiStateLoadingPromise) {
          await loadRemoteUiState();
        }
        await loadData(false, force ? { force: true } : {});
        return true;
      })().finally(() => {
        leadDatabasePrewarmPromise = null;
      });

      return leadDatabasePrewarmPromise;
    }

    function getLeadDatabaseSummaryWarmupCandidates(limit = 1) {
      return (Array.isArray(state.calls) ? state.calls : [])
        .filter((call) => isQualifiedPhoneConversation(call))
        .sort((a, b) => getCallLikeRecordUpdatedMs(b) - getCallLikeRecordUpdatedMs(a))
        .filter((call) => {
          const normalizedCallId = normalizeFreeText(call?.callId || '');
          if (!normalizedCallId) return false;
          if (callDetailSummaryByCallId.has(normalizedCallId)) return false;
          if (getSharedCallSummary(normalizedCallId)) return false;
          const localSummary = pickReadableConversationSummary(call?.summary);
          if (localSummary && localSummary.length >= 90) return false;
          return Boolean(getCallRecordingUrl(call) || call?.transcriptFull || call?.transcriptSnippet);
        })
        .slice(0, Math.max(0, Number(limit || 0)));
    }

    function prewarmLeadDatabaseCallDetails(limit = 1) {
      getLeadDatabaseSummaryWarmupCandidates(limit).forEach((call) => {
        void ensureLeadDatabaseCallSummary(call);
      });
    }

    function shouldRefreshLeadDatabaseCallDetailPayload(detail) {
      if (!detail || typeof detail !== 'object') return true;
      const readableSummary = pickReadableConversationSummary(
        detail?.summary,
        detail?.callSummary,
        detail?.aiSummary,
        detail?.conversationSummary
      );
      if (readableSummary) return false;
      const transcript = normalizeFreeText(detail?.transcript || detail?.transcriptSnippet || '');
      if (transcript) return false;
      return Boolean(
        normalizeFreeText(detail?.recordingUrl || detail?.recording_url || detail?.audioUrl || detail?.audio_url || '')
      );
    }

    async function fetchLeadDatabaseCallDetailPayload(callId, options = {}) {
      const normalizedCallId = normalizeFreeText(callId);
      const force = Boolean(options && options.force);
      if (!normalizedCallId) return null;
      if (!force && callDetailPayloadByCallId.has(normalizedCallId)) {
        const cached = callDetailPayloadByCallId.get(normalizedCallId) || null;
        if (!shouldRefreshLeadDatabaseCallDetailPayload(cached)) {
          return cached;
        }
        callDetailPayloadByCallId.delete(normalizedCallId);
      }
      if (!force && callDetailPayloadPromiseByCallId.has(normalizedCallId)) {
        return callDetailPayloadPromiseByCallId.get(normalizedCallId);
      }

      const run = fetchWithTimeout(
        `/api/coldcalling/call-detail?callId=${encodeURIComponent(normalizedCallId)}`,
        { method: 'GET', cache: 'no-store' },
        45000
      )
        .then(async (response) => {
          const data = await parseApiResponse(response);
          if (!response.ok || !data?.ok || !data?.detail || typeof data.detail !== 'object') {
            return null;
          }
          const detail = data.detail;
          if (!shouldRefreshLeadDatabaseCallDetailPayload(detail)) {
            callDetailPayloadByCallId.set(normalizedCallId, detail);
          }
          return detail;
        })
        .catch(() => null)
        .finally(() => {
          callDetailPayloadPromiseByCallId.delete(normalizedCallId);
        });

      callDetailPayloadPromiseByCallId.set(normalizedCallId, run);
      return run;
    }

    async function ensureLeadDatabaseCallSummary(call) {
      const normalizedCallId = normalizeFreeText(call?.callId || '');
      const insight = getCallInsightRecord(normalizedCallId);
      const interestedLead = getInterestedLeadRecord(normalizedCallId);
      let remoteDetail = await fetchLeadDatabaseCallDetailPayload(normalizedCallId);
      let remoteSummary = pickReadableConversationSummary(
        remoteDetail?.conversationSummary,
        remoteDetail?.summary,
        remoteDetail?.callSummary,
        remoteDetail?.aiSummary,
        remoteDetail?.transcriptSnippet,
        remoteDetail?.transcript
      );
      if (!remoteSummary && shouldRefreshLeadDatabaseCallDetailPayload(remoteDetail)) {
        remoteDetail = await fetchLeadDatabaseCallDetailPayload(normalizedCallId, { force: true });
        remoteSummary = pickReadableConversationSummary(
          remoteDetail?.conversationSummary,
          remoteDetail?.summary,
          remoteDetail?.callSummary,
          remoteDetail?.aiSummary,
          remoteDetail?.transcriptSnippet,
          remoteDetail?.transcript
        );
      }
      if (remoteSummary && !looksLikeAgendaConfirmationSummary(remoteSummary)) {
        callDetailSummaryByCallId.set(normalizedCallId, remoteSummary);
        setSharedCallSummary(normalizedCallId, remoteSummary);
        return remoteSummary;
      }

      const remoteTranscriptFallback = buildLeadDatabaseTranscriptFallbackSummary(
        call,
        insight,
        interestedLead,
        remoteDetail
      );
      if (remoteTranscriptFallback && !looksLikeAgendaConfirmationSummary(remoteTranscriptFallback)) {
        callDetailSummaryByCallId.set(normalizedCallId, remoteTranscriptFallback);
        setSharedCallSummary(normalizedCallId, remoteTranscriptFallback);
        return remoteTranscriptFallback;
      }

      const sharedSummary = getSharedCallSummary(normalizedCallId);
      if (sharedSummary && !looksLikeAgendaConfirmationSummary(sharedSummary)) {
        callDetailSummaryByCallId.set(normalizedCallId, sharedSummary);
        return sharedSummary;
      }

      const fallbackSummary = getLeadDatabaseCallSummaryFallback(call, insight, interestedLead);
      const readableLeadSummary = pickReadableConversationSummary(
        call?.summary,
        insight?.summary,
        interestedLead?.summary
      );
      const leadSummaryLooksStrong =
        readableLeadSummary &&
        readableLeadSummary.length >= 160 &&
        !looksLikeAgendaConfirmationSummary(readableLeadSummary);
      if (leadSummaryLooksStrong) {
        callDetailSummaryByCallId.set(normalizedCallId, readableLeadSummary);
        setSharedCallSummary(normalizedCallId, readableLeadSummary);
        return readableLeadSummary;
      }

      const sourceText = buildLeadDatabaseCallSummarySourceText(call, insight, interestedLead, remoteDetail);
      const shouldRewrite =
        !fallbackSummary ||
        fallbackSummary.length < 160 ||
        looksLikeAgendaConfirmationSummary(fallbackSummary);
      if (!shouldRewrite || sourceText.length < 24 || !normalizedCallId) {
        return fallbackSummary;
      }

      if (callDetailSummaryByCallId.has(normalizedCallId)) {
        return String(callDetailSummaryByCallId.get(normalizedCallId) || '').trim() || fallbackSummary;
      }
      if (callDetailSummaryPromiseByCallId.has(normalizedCallId)) {
        return callDetailSummaryPromiseByCallId.get(normalizedCallId);
      }

      const run = summarizeConversationTextNl(sourceText, {
        style: 'medium',
        maxSentences: 4,
        extraInstructions:
          'Schrijf uitsluitend in natuurlijk Nederlands als interne belnotitie voor Softora. Gebruik de transcriptie als bron van waarheid als die aanwezig is. Schrijf in de derde persoon, bijvoorbeeld: "De prospect gaf aan..." of "Meneer X gaf aan...". Noem de medewerker van Softora bij naam als Ruben Nijhuis wanneer die in de samenvatting voorkomt. Gebruik nooit het woord "agent". Vat in een paar volledige zinnen samen waar het gesprek over ging, wat de prospect wilde of zei en welke interesse of bezwaren er waren, maar noem geen aanbevolen vervolgstap, geen instructie voor Softora en geen zin die uitlegt wat wij nu moeten doen. Gebruik nooit letterlijke dialoog, geen quotes, geen transcriptiestijl en geen labels zoals user:, bot:, agent: of klant:. Schrijf nadrukkelijk NIET als agenda-item, bevestigingsbericht of afspraakbevestiging. Eindig altijd met een volledige zin en nooit met ellips of afgebroken tekst.',
      })
        .then((summaryText) => {
          const rewrittenSummary = pickReadableConversationSummary(summaryText);
          const cleanedSummary =
            (rewrittenSummary && !looksLikeAgendaConfirmationSummary(rewrittenSummary)
              ? rewrittenSummary
              : '') || fallbackSummary;
          if (cleanedSummary && !isGenericConversationPlaceholder(cleanedSummary)) {
            callDetailSummaryByCallId.set(normalizedCallId, cleanedSummary);
            setSharedCallSummary(normalizedCallId, cleanedSummary);
          }
          return cleanedSummary || fallbackSummary;
        })
        .catch(() => fallbackSummary)
        .finally(() => {
          callDetailSummaryPromiseByCallId.delete(normalizedCallId);
        });

      callDetailSummaryPromiseByCallId.set(normalizedCallId, run);
      return run;
    }

    function closeCallDetail() {
      const detailOverlay = byId('leadDatabaseCallDetailOverlay');
      const detailAudio = byId('leadDatabaseCallDetailAudio');
      state.detailCallId = '';
      if (detailAudio) {
        detailAudio.pause();
        detailAudio.removeAttribute('src');
        detailAudio.load();
      }
      if (detailOverlay) {
        detailOverlay.style.display = 'none';
      }
    }

    function renderCallDetail() {
      const detailOverlay = byId('leadDatabaseCallDetailOverlay');
      const detailTitle = byId('leadDatabaseCallDetailTitle');
      const detailMeta = byId('leadDatabaseCallDetailMeta');
      const detailSummary = byId('leadDatabaseCallDetailSummary');
      const detailAudio = byId('leadDatabaseCallDetailAudio');
      if (!detailOverlay || !detailTitle || !detailMeta || !detailSummary || !detailAudio) return;

      const call = getCallDetailRecord(state.detailCallId);
      if (!call) {
        closeCallDetail();
        return;
      }

      const company = normalizeFreeText(call?.company || call?.name || 'Onbekend');
      const phone = formatLeadDatabasePhone(normalizeFreeText(call?.phone || ''));
      const duration = formatConversationDuration(call?.durationSeconds);
      const occurredAt = normalizeFreeText(getConversationRecordOccurredAt(call));
      const normalizedCallId = normalizeFreeText(call?.callId || '');
      const insight = getCallInsightRecord(normalizedCallId);
      const interestedLead = getInterestedLeadRecord(normalizedCallId);
      const metaLine = [phone || '-', duration, occurredAt ? formatConversationTimestamp(occurredAt) : 'Onbekend']
        .filter(Boolean)
        .join(' · ');
      const recordingUrl = getCallRecordingUrl(call);
      const immediateFallbackSummary = getLeadDatabaseCallSummaryFallback(call, insight, interestedLead);
      const summaryText =
        pickReadableConversationSummary(
          immediateFallbackSummary,
          callDetailSummaryByCallId.get(normalizedCallId),
          getSharedCallSummary(normalizedCallId)
        ) || '';

      detailTitle.textContent = company;
      detailMeta.textContent = metaLine;
      detailSummary.textContent = summaryText || 'Nog geen samenvatting beschikbaar.';
      detailAudio.style.colorScheme = 'light';
      detailAudio.src = recordingUrl;
      detailAudio.load();
      detailOverlay.style.display = 'flex';
      void ensureLeadDatabaseCallSummary(call).then((nextSummary) => {
        if (normalizeFreeText(state.detailCallId) !== normalizedCallId) return;
        const latestSummaryEl = byId('leadDatabaseCallDetailSummary');
        if (!latestSummaryEl) return;
        latestSummaryEl.textContent = String(nextSummary || '').trim() || 'Nog geen samenvatting beschikbaar.';
      });
    }

    function openCallDetail(callId) {
      state.detailCallId = normalizeFreeText(callId);
      const call = getCallDetailRecord(state.detailCallId);
      if (call) {
        const normalizedCallId = normalizeFreeText(call?.callId || '');
        const insight = getCallInsightRecord(normalizedCallId);
        const interestedLead = getInterestedLeadRecord(normalizedCallId);
        const immediateSummary = getLeadDatabaseCallSummaryFallback(call, insight, interestedLead);
        if (immediateSummary) {
          callDetailSummaryByCallId.set(normalizedCallId, immediateSummary);
          setSharedCallSummary(normalizedCallId, immediateSummary);
        }
      }
      renderCallDetail();
    }

    function render() {
      const tableWrap = byId('leadDatabaseTableWrap');
      const statusBar = byId('leadDatabaseStatusBar');
      const summaryCards = byId('leadDatabaseSummaryCards');
      const refreshInfo = byId('leadDatabaseRefreshInfo');
      const importBtn = byId('leadDatabaseImportBtn');
      const addManualBtn = byId('leadDatabaseAddManualBtn');
      const closeBtn = byId('leadDatabaseCancelBtn');
      if (!tableWrap || !summaryCards || !statusBar) return;

      const busy = state.importing || state.loading || state.opening;
      if (refreshInfo) {
        refreshInfo.textContent = state.lastRefreshedAt
          ? `Verversd om ${new Date(state.lastRefreshedAt).toLocaleTimeString('nl-NL', {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : state.loading || state.opening
            ? 'Database laden...'
            : 'Nog niet ververst';
      }

      if (importBtn) {
        importBtn.disabled = busy;
      }
      if (addManualBtn) {
        addManualBtn.disabled = busy;
      }
      if (closeBtn) {
        closeBtn.disabled = false;
      }

      const cards = getLeadDatabaseFilterCards(state.records, state.calls);
      if (!cards.some((card) => card.key === state.filter)) {
        state.filter = 'callback';
      }
      const filtered = getFilteredRecords();

      summaryCards.innerHTML = cards
        .map((card) => {
          const isActive = state.filter === card.key;
          return `
            <button type="button" data-db-filter="${escapeHtml(card.key)}" class="lead-db-stat${
              isActive ? ' is-active' : ''
            }">
              <div class="lead-db-stat-label">${escapeHtml(getLeadDatabaseUiLabel(card.key))}</div>
              <div class="lead-db-stat-val">${escapeHtml(String(card.count))}</div>
            </button>
          `;
        })
        .join('');

      summaryCards.querySelectorAll('[data-db-filter]').forEach((button) => {
        button.addEventListener('click', () => {
          const key = String(button.getAttribute('data-db-filter') || 'all').trim();
          state.filter = key || 'all';
          closeCallDetail();
          render();
        });
      });

      if (state.error) {
        statusBar.hidden = false;
        statusBar.style.display = 'block';
        statusBar.className = 'lead-db-status lead-db-status--error';
        statusBar.textContent = state.error;
      } else if (state.info && !/^Verversd om\b/i.test(String(state.info || ''))) {
        statusBar.hidden = false;
        statusBar.style.display = 'block';
        statusBar.className = 'lead-db-status lead-db-status--info';
        statusBar.textContent = state.info;
      } else if (state.sourceErrors.length > 0) {
        statusBar.hidden = false;
        statusBar.style.display = 'block';
        statusBar.className = 'lead-db-status lead-db-status--muted';
        statusBar.textContent = state.sourceErrors.join(' ');
      } else {
        statusBar.hidden = true;
        statusBar.style.display = 'none';
        statusBar.className = 'lead-db-status';
        statusBar.textContent = '';
      }

      if ((state.loading || state.opening) && state.records.length === 0) {
        tableWrap.innerHTML = `<div class="lead-db-empty">Database laden...</div>`;
        return;
      }

      if (state.filter === 'phone_calls') {
        const calls = getFilteredCalls();
        const callIntentByCallId = buildCallIntentByCallId(state.records);
        const callSummary = buildLeadDatabaseCallSummaryStats(calls);
        if (calls.length === 0) {
          tableWrap.innerHTML = `<div class="lead-db-empty">Geen telefoongesprekken gevonden.</div>`;
          return;
        }

        tableWrap.innerHTML = `
          <div class="lead-db-table-head lead-db-table-head--calls">
            <span>Bedrijf</span>
            <span>Telefoon</span>
            <span>Status</span>
            <span>Duur</span>
            <span>Tijd</span>
          </div>
          <div class="lead-db-table-body">
              ${calls
                .map((call) => {
                  const company = normalizeFreeText(call?.company || call?.name || 'Onbekend');
                  const phone = formatLeadDatabasePhone(normalizeFreeText(call?.phone || ''));
                  const intent = inferPhoneConversationIntent(call, callIntentByCallId);
                  const status =
                    intent === 'geen_interesse'
                      ? { label: 'Geen interesse', cls: 'lead-db-status-pill lead-db-status-pill--geen' }
                      : intent === 'interesse'
                        ? { label: 'Interesse', cls: 'lead-db-status-pill lead-db-status-pill--interesse' }
                        : intent === 'alert'
                          ? { label: 'Alert', cls: 'lead-db-status-pill lead-db-status-pill--alert' }
                        : intent === 'out_of_service'
                          ? { label: 'Buiten gebruik', cls: 'lead-db-status-pill lead-db-status-pill--buiten' }
                        : intent === 'outside_range'
                          ? { label: 'Niet bereikbaar', cls: 'lead-db-status-pill lead-db-status-pill--niet-bereikbaar' }
                          : { label: 'Overig', cls: 'lead-db-status-pill lead-db-status-pill--belt' };
                  const duration = formatConversationDuration(call?.durationSeconds);
                  const occurredAt = normalizeFreeText(getConversationRecordOccurredAt(call));
                  const callId = normalizeFreeText(call?.callId || '');
                  return `
                    <div class="lead-db-row lead-db-row--calls" data-db-call-open="${escapeHtml(
                      callId
                    )}" tabindex="0" role="button" aria-label="Open gesprek van ${escapeHtml(
                      company
                    )}">
                      <div class="lead-db-cell-bedrijf">
                        <div class="lead-db-company-name">${escapeHtml(company)}</div>
                      </div>
                      <div class="lead-db-cell lead-db-cell--mono">${escapeHtml(phone || '-')}</div>
                      <div class="lead-db-cell"><span class="${status.cls}">${escapeHtml(status.label)}</span></div>
                      <div class="lead-db-cell lead-db-cell--mono">${escapeHtml(duration)}</div>
                      <div class="lead-db-cell lead-db-cell--muted">${
                        occurredAt ? escapeHtml(formatConversationTimestamp(occurredAt)) : '-'
                      }</div>
                    </div>
                  `;
                })
                .join('')}
          </div>
          <div class="lead-db-table-summary" role="status" aria-live="polite">
            <div class="lead-db-table-summary-item">
              <span class="lead-db-table-summary-label">Unieke mensen gebeld</span>
              <span class="lead-db-table-summary-value">${escapeHtml(String(callSummary.uniquePeopleCalled))}</span>
            </div>
            <div class="lead-db-table-summary-item">
              <span class="lead-db-table-summary-label">Totale beltijd</span>
              <span class="lead-db-table-summary-value">${escapeHtml(callSummary.totalDurationLabel)}</span>
            </div>
          </div>
        `;
        tableWrap.querySelectorAll('[data-db-call-open]').forEach((row) => {
          const openRow = () => {
            const callId = normalizeFreeText(row.getAttribute('data-db-call-open') || '');
            if (!callId) return;
            void openCallDetail(callId);
          };
          row.addEventListener('click', openRow);
          row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openRow();
            }
          });
        });
        return;
      }

      if (filtered.length === 0) {
        tableWrap.innerHTML = `<div class="lead-db-empty">${
          state.records.length === 0
            ? 'Nog geen leads met telefoonnummer in de database. Upload een document of gebruik "Handmatig toevoegen".'
            : 'Geen resultaten voor je zoekopdracht.'
        }</div>`;
        return;
      }

      tableWrap.innerHTML = `
        <div class="lead-db-table-head lead-db-table-head--records">
          <span>Bedrijf</span>
          <span>Adres</span>
          <span>Telefoonnummer</span>
          <span>Website</span>
        </div>
        <div class="lead-db-table-body">
            ${filtered
              .map((record) => {
                const company = record.company || 'Onbekend bedrijf';
                const address = record.address || '-';
                const phone =
                  formatLeadDatabasePhone(normalizeFreeText(record.phone || '')) ||
                  normalizeFreeText(record.phone || '') ||
                  '-';
                const website = record.website || '';
                const websiteHref = /^https?:\/\//i.test(website) ? website : `https://${website}`;
                return `
                  <div class="lead-db-row lead-db-row--records">
                    <div class="lead-db-cell-bedrijf">
                      <div class="lead-db-company-name">${escapeHtml(company)}</div>
                    </div>
                    <div class="lead-db-cell" title="${escapeHtml(address)}">${escapeHtml(address)}</div>
                    <div class="lead-db-cell lead-db-cell--mono">${escapeHtml(phone)}</div>
                    <div class="lead-db-cell" title="${escapeHtml(website || '-')}">${
                      website
                        ? `<a href="${escapeHtml(
                            websiteHref
                          )}" target="_blank" rel="noopener noreferrer" style="color:#1a1a2e; text-decoration:underline; text-underline-offset:2px;">${escapeHtml(
                            website
                          )}</a>`
                        : '-'
                    }</div>
                  </div>
                `;
              })
              .join('')}
        </div>
      `;

    }

    function readFileAsText(file) {
      if (!file) return Promise.resolve('');
      if (typeof file.text === 'function') {
        return file.text();
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Bestand kon niet gelezen worden.'));
        reader.readAsText(file);
      });
    }

    async function importLeadDocumentFile(file) {
      if (!file) return;
      const fileName = String(file.name || 'document').trim();
      const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
      if (extension === 'xls' || extension === 'xlsx') {
        throw new Error('XLS/XLSX wordt hier niet direct gelezen. Exporteer eerst naar CSV en upload die.');
      }

      const rawText = await readFileAsText(file);
      const imported = parseLeadRowsFromUploadedDocument(rawText, fileName);
      const parsed = parseLeadRows(imported.rows);
      if (!parsed.hasInput) {
        throw new Error('Geen bruikbare regels gevonden in het document.');
      }
      if (parsed.leads.length === 0) {
        throw new Error(parsed.errors[0] || 'Geen geldige leads gevonden in het document.');
      }

      const merged = mergeLeadRows(
        getSavedLeadRows(),
        parsed.leads.map((lead) => ({
          company: lead.company,
          phone: lead.phone,
          region: lead.region || '',
          contactPerson: lead.contactPerson || '',
          branche: lead.branche || '',
          province: lead.province || '',
          address: lead.address || '',
          website: lead.website || '',
        }))
      );
      saveLeadRows(merged.rows);
      updateLeadListHint();

      const saveResult = await persistRemoteUiStateNow();
      if (!saveResult.ok) {
        throw new Error(
          `Import lokaal verwerkt maar opslaan naar Supabase mislukt.${saveResult.error ? ` ${saveResult.error}` : ''}`
        );
      }

      state.error = '';
      state.info = `Import klaar: ${parsed.leads.length} geldige lead(s), ${merged.added} toegevoegd, ${merged.updated} bijgewerkt.`;
      addUiLog(
        'success',
        `<strong>Database</strong> - Import ${escapeHtml(fileName)} verwerkt (${escapeHtml(
          String(parsed.leads.length)
        )} lead(s), ${escapeHtml(String(merged.added))} toegevoegd, ${escapeHtml(String(merged.updated))} bijgewerkt).`
      );
      await loadData(false);
    }

    async function loadData(showLoader = true, options = {}) {
      const force = Boolean(options && options.force);
      if (state.loading) {
        if (force) {
          state.forceReloadAfterLoad = true;
          state.info = 'Verversen ingepland...';
          render();
        }
        return;
      }
      if (showLoader) {
        state.loading = true;
        render();
      }
      state.error = '';
      try {
        const data = await fetchLeadDatabaseRecords({
          cacheBust: force ? String(Date.now()) : '',
        });
        state.records = Array.isArray(data.records) ? data.records : [];
        state.insights = Array.isArray(data.insights) ? data.insights : [];
        state.interestedLeads = Array.isArray(data.interestedLeads) ? data.interestedLeads : [];
        state.calls = Array.isArray(data.calls) ? data.calls : Array.isArray(data.updates) ? data.updates : [];
        state.sourceErrors = Array.isArray(data.sourceErrors) ? data.sourceErrors : [];
        callDetailSummaryByCallId.clear();
        callDetailSummaryPromiseByCallId.clear();
        callDetailPayloadByCallId.clear();
        callDetailPayloadPromiseByCallId.clear();
        state.lastRefreshedAt = new Date().toISOString();
        if (force) {
          state.info = `Verversd om ${new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}.`;
        }
        prewarmLeadDatabaseCallDetails(4);
      } catch (error) {
        state.error = normalizeFreeText(error?.message || '') || 'Database kon niet geladen worden.';
      } finally {
        state.loading = false;
        const shouldForceReloadAgain = state.forceReloadAfterLoad;
        state.forceReloadAfterLoad = false;
        render();
        if (shouldForceReloadAgain) {
          void loadData(true, { force: true });
        }
      }
    }

    function closeModal() {
      closeCallDetail();
      state.opening = false;
      state.openRequestId += 1;
      modal.style.display = 'none';
      document.body.style.overflow = '';
      if (state.pollTimer) {
        window.clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    }

    async function openModal() {
      applyTheme();
      state.filter = 'callback';
      const hadSnapshot = hasLeadDatabaseSnapshot();
      const openRequestId = state.openRequestId + 1;
      state.openRequestId = openRequestId;
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      if (!hadSnapshot) {
        state.opening = true;
        state.error = '';
        render();
        if (!remoteUiStateLoaded || remoteUiStateLoadingPromise) {
          await loadRemoteUiState();
        }
        if (state.openRequestId !== openRequestId || modal.style.display === 'none') return;
        state.opening = false;
        render();
        await loadData(true);
      } else {
        state.opening = false;
        render();
        void prewarmLeadDatabase({ force: true });
      }
      if (state.openRequestId !== openRequestId || modal.style.display === 'none') return;
      if (state.pollTimer) {
        window.clearInterval(state.pollTimer);
      }
      state.pollTimer = window.setInterval(() => {
        if (state.filter === 'phone_calls' && isPhoneCallAudioPlaying()) return;
        void loadData(false);
      }, 12000);
    }

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    byId('leadDatabaseCancelBtn')?.addEventListener('click', closeModal);
    byId('leadDatabaseCallDetailCloseBtn')?.addEventListener('click', closeCallDetail);
    byId('leadDatabaseImportBtn')?.addEventListener('click', () => {
      if (state.importing || state.loading) return;
      byId('leadDatabaseImportInput')?.click();
    });
    byId('leadDatabaseAddManualBtn')?.addEventListener('click', async () => {
      if (state.importing || state.loading) return;
      state.importing = true;
      state.error = '';
      state.info = '';
      render();
      try {
        const result = await promptAndSaveSingleManualLead();
        if (result?.ok && result.remoteSaved === false) {
          state.info = 'Lead lokaal toegevoegd. Opslaan naar Supabase volgt zodra verbinding beschikbaar is.';
        } else if (result?.ok) {
          state.info = 'Handmatige lead toegevoegd.';
        }
        await loadData(false);
      } catch (error) {
        state.error = normalizeFreeText(error?.message || '') || 'Handmatige lead toevoegen mislukt.';
      } finally {
        state.importing = false;
        render();
      }
    });
    byId('leadDatabaseImportInput')?.addEventListener('change', async (event) => {
      const input = event.target;
      const file = input?.files?.[0] || null;
      if (!file) return;
      state.importing = true;
      state.error = '';
      state.info = '';
      render();
      try {
        await importLeadDocumentFile(file);
      } catch (error) {
        state.error = normalizeFreeText(error?.message || '') || 'Import mislukt.';
      } finally {
        state.importing = false;
        if (input) input.value = '';
        render();
      }
    });
    byId('leadDatabaseSearchInput')?.addEventListener('input', (event) => {
      state.search = String(event.target?.value || '');
      render();
    });
    byId('leadDatabaseCallDetailOverlay')?.addEventListener('click', (event) => {
      if (event.target?.id === 'leadDatabaseCallDetailOverlay') {
        closeCallDetail();
      }
    });

    const themeObserver = new MutationObserver(() => {
      applyTheme();
      if (modal.style.display !== 'none') {
        render();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-mode'],
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.style.display !== 'none') {
        closeModal();
      }
    });

    applyTheme();
    render();
    modal.openLeadDatabaseModal = openModal;
    modal.closeLeadDatabaseModal = closeModal;
    modal.prewarmLeadDatabase = prewarmLeadDatabase;
    modal.refreshLeadDatabaseModal = () => loadData(false);
    return modal;
  }

  function ensureAiNotebookPanel() {
    let button = byId('openAiNotebookModalBtn');
    if (button) return button;

    const leadControl = byId('leadListControlWrap');
    if (!leadControl) return null;
    const dispatchControl = byId('callDispatchControlWrap');

    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    wrap.id = 'aiNotebookControlWrap';
    wrap.style.marginTop = '12px';
    wrap.innerHTML = [
      '<label class="form-label">Telefoongesprekken</label>',
      '<button type="button" class="form-input magnetic" id="openAiNotebookModalBtn" style="text-align:left; display:flex; align-items:center; justify-content:flex-start; gap:12px; cursor:pointer;">',
      '  <span>Open gesprekken</span>',
      '</button>',
      '<div id="aiNotebookHint" data-call-count="0" style="display:none;"></div>',
    ].join('');

    if (dispatchControl) {
      dispatchControl.insertAdjacentElement('beforebegin', wrap);
    } else {
      leadControl.insertAdjacentElement('afterend', wrap);
    }

    button = byId('openAiNotebookModalBtn');
    const modal = ensureAiNotebookModal();
    if (button && modal) {
      button.addEventListener('click', () => {
        if (typeof modal.openAiNotebookModal === 'function') {
          modal.openAiNotebookModal();
        }
      });
    }

    updateAiNotebookHint();
    return button;
  }

  function phoneKey(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0031')) return `31${digits.slice(4)}`;
    if (digits.startsWith('31')) return digits;
    if (digits.startsWith('0') && digits.length >= 10) return `31${digits.slice(1)}`;
    if (digits.startsWith('6') && digits.length === 9) return `31${digits}`;
    return digits;
  }

  function upsertAiNotebookRowsFromCallResults(results) {
    if (!Array.isArray(results) || results.length === 0) return;

    const rows = getSavedAiNotebookRows();

    results.forEach((result) => {
      const company = String(result?.lead?.company || result?.lead?.name || '').trim();
      const phone = String(result?.lead?.phoneE164 || result?.lead?.phone || '').trim();
      const key = phoneKey(phone);
      const existingIndex = rows.findIndex((row) => {
        const rowKey = phoneKey(row.phone);
        return (key && rowKey === key) || (!key && company && row.company === company);
      });

      const base = existingIndex >= 0 ? rows[existingIndex] : getDefaultAiNotebookRow();
      const next = normalizeAiNotebookRow(base);
      if (company) next.company = company;
      if (phone) next.phone = phone;

      if (result?.success) {
        const status = String(result?.call?.status || 'queued').trim();
        next.status = `Call gestart (${status})`;
        if (!next.followUp) next.followUp = 'Nee';
      } else {
        next.status = 'Fout';
        if (!next.followUp) next.followUp = 'Ja';
        if (!next.followUpReason) {
          next.followUpReason = String(result?.error || '').trim().slice(0, 220);
        }
      }

      if (existingIndex >= 0) rows[existingIndex] = next;
      else rows.push(next);
    });

    saveAiNotebookRows(rows);
    updateAiNotebookHint();
  }

  function getAiNotebookRowMatchIndex(rows, candidate) {
    const candidatePhoneKey = phoneKey(candidate?.phone);
    const candidateCompany = String(candidate?.company || '').trim();

    return rows.findIndex((row) => {
      const rowPhoneKey = phoneKey(row.phone);
      if (candidatePhoneKey && rowPhoneKey && rowPhoneKey === candidatePhoneKey) {
        return true;
      }
      if (!candidatePhoneKey && candidateCompany && row.company === candidateCompany) {
        return true;
      }
      if (candidatePhoneKey && !rowPhoneKey && candidateCompany && row.company === candidateCompany) {
        return true;
      }
      return false;
    });
  }

  function formatWebhookStatusForNotebook(update) {
    const status = String(update?.status || '').trim();
    const messageType = String(update?.messageType || '').trim();
    const endedReason = String(update?.endedReason || '').trim();

    if (!status && !messageType) return '';

    let label = status ? `Call status: ${status}` : messageType;
    if (endedReason) {
      label += ` (${endedReason})`;
    }
    return label;
  }

  function formatWebhookMemoryForNotebook(update) {
    const summary = String(update?.summary || '').trim();
    const transcriptFull = String(update?.transcriptFull || '').trim();
    const transcriptSnippet = String(update?.transcriptSnippet || '').trim();
    const transcriptText = (transcriptFull || transcriptSnippet)
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .join(' | ');

    if (!summary && !transcriptText) return '';

    const parts = [];
    if (summary) parts.push(`Samenvatting: ${summary}`);
    if (transcriptText) {
      parts.push(
        `${transcriptFull ? 'Volledige transcriptie' : 'Transcript (kort)'}: ${transcriptText}`
      );
    }
    return parts.join(' || ');
  }

  function upsertAiNotebookRowsFromWebhookUpdates(updates) {
    if (!Array.isArray(updates) || updates.length === 0) return;

    const modal = byId('aiNotebookModalOverlay');
    const modalOpen = Boolean(modal && modal.style.display !== 'none');
    if (modalOpen) {
      // Voorkom dat polling tijdens handmatig editen de concept-grid overschrijft.
      return;
    }

    const rows = getSavedAiNotebookRows();
    let changed = false;

    updates.forEach((update) => {
      const company = String(update?.company || update?.name || '').trim();
      const phone = String(update?.phone || '').trim();
      const idx = getAiNotebookRowMatchIndex(rows, { company, phone });
      const existing = idx >= 0 ? rows[idx] : getDefaultAiNotebookRow();
      const next = normalizeAiNotebookRow(existing);

      if (company && next.company !== company) {
        next.company = company;
        changed = true;
      }
      if (phone && next.phone !== phone) {
        next.phone = phone;
        changed = true;
      }

      const statusText = formatWebhookStatusForNotebook(update);
      if (statusText && next.status !== statusText) {
        next.status = statusText;
        changed = true;
      }

      const memoryText = formatWebhookMemoryForNotebook(update);
      if (memoryText && next.memory !== memoryText) {
        next.memory = memoryText;
        changed = true;
      }

      if (idx >= 0) {
        rows[idx] = next;
      } else if (company || phone || statusText || memoryText) {
        rows.push(next);
        changed = true;
      }
    });

    if (changed) {
      saveAiNotebookRows(rows);
      updateAiNotebookHint();
    }
  }

  function isTerminalCallUpdateForSequentialClient(update) {
    if (!update) return false;
    const status = String(update.status || '').toLowerCase();
    const messageType = String(update.messageType || '').toLowerCase();
    const endedReason = String(update.endedReason || '').toLowerCase();
    const endedAt = String(update.endedAt || '').trim();

    if (endedAt) return true;
    if (endedReason) return true;
    if (messageType.includes('call.ended') || messageType.includes('end-of-call')) return true;

    return /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected)/.test(
      status
    );
  }

  function updateSequentialClientDispatchStatus() {
    const run = activeSequentialClientDispatch;
    if (!run || run.completed) return;
    syncSequentialClientDispatchButtonState();
    setStatusPill('loading', 'Coldcalling bezig');
    setStatusMessage('', '');
  }

  function matchesSequentialClientWaitingUpdate(run, update) {
    if (!run || !run.waiting || !update) return false;
    if (!isTerminalCallUpdateForSequentialClient(update)) return false;

    const updateCallId = String(update.callId || '').trim();
    const updatePhoneKey = phoneKey(update.phone);
    const updateTs = Number(update.updatedAtMs || 0);

    if (Number.isFinite(updateTs) && run.waitingSinceMs && updateTs + 1000 < run.waitingSinceMs) {
      return false;
    }

    if (run.waitingCallId && updateCallId && run.waitingCallId === updateCallId) {
      return true;
    }

    if (run.waitingPhoneKey && updatePhoneKey && run.waitingPhoneKey === updatePhoneKey) {
      return true;
    }

    return false;
  }

  async function startSingleLeadRequestForSequential(run, lead, leadIndex) {
    const response = await fetch('/api/coldcalling/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaign: {
          ...run.campaign,
          amount: 1,
        },
        leads: [lead],
      }),
    });

    const data = await parseApiResponse(response);

    if (!response.ok || !data || data.ok === false) {
      throw new Error(data?.error || `API fout (${response.status})`);
    }

    const results = Array.isArray(data.results) ? data.results : [];
    upsertAiNotebookRowsFromCallResults(results);

    results.forEach((result) => {
      const company = escapeHtml(result?.lead?.company || result?.lead?.name || 'Onbekende lead');

      if (result.success) {
        const callId = result?.call?.callId ? ` (callId: ${escapeHtml(result.call.callId)})` : '';
        addUiLog('success', `<strong>${company}</strong> - Outbound call gestart${callId}.`);
      } else {
        const cause = result?.cause ? ` Oorzaak: ${escapeHtml(result.cause)}.` : '';
        const causeExplanation = result?.causeExplanation ? ` ${escapeHtml(result.causeExplanation)}` : '';
        addUiLog(
          'skip',
          `<strong>${company}</strong> - Fout: ${escapeHtml(result.error || 'Onbekende fout')}.${cause}${causeExplanation}`
        );
      }
    });

    const primaryResult = results[0] || null;
    if (!primaryResult) {
      run.failed += 1;
      return { success: false };
    }

    if (!primaryResult.success) {
      run.failed += 1;
      updateStats({ started: run.started });
      return { success: false };
    }

    run.started += 1;
    updateStats({ started: run.started });

    run.waiting = true;
    run.waitingSinceMs = Date.now();
    run.waitingCallId = String(primaryResult?.call?.callId || '').trim();
    run.waitingPhoneKey = phoneKey(primaryResult?.lead?.phoneE164 || primaryResult?.lead?.phone || lead?.phone);
    run.currentLeadIndex = leadIndex;

    updateSequentialClientDispatchStatus();
    return { success: true };
  }

  async function advanceSequentialClientDispatch(reason) {
    const run = activeSequentialClientDispatch;
    if (!run || run.completed) return;
    if (run.isAdvancing || run.waiting) return;

    run.isAdvancing = true;
    try {
      while (!run.completed && !run.waiting && run.nextLeadIndex < run.leads.length) {
        const leadIndex = run.nextLeadIndex;
        const lead = run.leads[leadIndex];
        run.nextLeadIndex += 1;

        setButtonLoading(true);
        isSubmitting = true;
        updateSequentialClientDispatchStatus();

        try {
          await startSingleLeadRequestForSequential(run, lead, leadIndex);
        } catch (error) {
          run.failed += 1;
          const company = escapeHtml(lead?.company || lead?.name || 'Onbekende lead');
          addUiLog('skip', `<strong>${company}</strong> - Fout: ${escapeHtml(error.message || 'Onbekende fout')}.`);
        } finally {
          syncSequentialClientDispatchButtonState();
          isSubmitting = false;
        }

        if (run.waiting) {
          break;
        }
      }

      if (!run.waiting && run.nextLeadIndex >= run.leads.length) {
        run.completed = true;
        const completedCount = run.started;
        if (run.started > 0) {
          const failedText = run.failed > 0 ? `, ${run.failed} mislukt` : '';
          addUiLog(
            'success',
            `<strong>Campagne</strong> - Coldcalling afgerond (${escapeHtml(
              `${completedCount}/${run.total}`
            )} gestart${escapeHtml(failedText)}).`
          );
          activeSequentialClientDispatch = null;
          clearCompletedSequentialClientDispatchUi();
          void refreshDashboardStatsFromSupabase({ silent: true, force: true });
        } else {
          setStatusPill('error', 'Fout');
          setStatusMessage('error', 'Geen calls gestart. Controleer outbound-configuratie en logs.');
          activeSequentialClientDispatch = null;
          syncSequentialClientDispatchButtonState();
        }
      }
    } finally {
      if (run) run.isAdvancing = false;
    }
  }

  function handleSequentialClientDispatchWebhookUpdates(updates) {
    const run = activeSequentialClientDispatch;
    if (!run || run.completed || !run.waiting || !Array.isArray(updates) || updates.length === 0) return;

    const matchedUpdate = updates.find((update) => matchesSequentialClientWaitingUpdate(run, update));
    if (!matchedUpdate) return;

    run.waiting = false;
    run.waitingSinceMs = 0;
    run.waitingCallId = '';
    run.waitingPhoneKey = '';

    if (run.nextLeadIndex < run.total) {
      addUiLog(
        'call',
        `<strong>Campagne</strong> - Gesprek afgerond. Volgende lead wordt gestart (${escapeHtml(
          `${run.nextLeadIndex + 1}/${run.total}`
        )}).`
      );
    } else {
      addUiLog('call', '<strong>Campagne</strong> - Gesprek afgerond. Campagne wordt afgerond.');
    }
    updateSequentialClientDispatchStatus();
    void advanceSequentialClientDispatch('webhook-ended');
  }

  async function pollSequentialClientDirectCallStatusOnce() {
    const run = activeSequentialClientDispatch;
    if (!run || run.completed || !run.waiting || !run.waitingCallId) return;
    if (isPollingSequentialClientDirectStatus) return;

    isPollingSequentialClientDirectStatus = true;
    try {
      const response = await fetch(
        `/api/coldcalling/status?callId=${encodeURIComponent(run.waitingCallId)}`,
        { method: 'GET' }
      );
      if (!response.ok) return;

      const data = await response.json().catch(() => ({}));
      if (!data || data.ok === false) return;

      const statusUpdate = {
        callId: String(data.callId || run.waitingCallId || '').trim(),
        status: String(data.status || '').trim(),
        endedReason: String(data.endedReason || '').trim(),
        startedAt: String(data.startedAt || '').trim(),
        messageType: 'direct.call.status',
        endedAt: String(data.endedAt || '').trim(),
        durationSeconds: Number(data.durationSeconds || 0) || 0,
        updatedAtMs: Date.now(),
      };

      if (!matchesSequentialClientWaitingUpdate(run, statusUpdate)) return;

      run.waiting = false;
      run.waitingSinceMs = 0;
      run.waitingCallId = '';
      run.waitingPhoneKey = '';

      if (run.nextLeadIndex < run.total) {
        addUiLog(
          'call',
          `<strong>Campagne</strong> - Gesprek afgerond. Volgende lead wordt gestart (${escapeHtml(
            `${run.nextLeadIndex + 1}/${run.total}`
          )}).`
        );
      } else {
        addUiLog('call', '<strong>Campagne</strong> - Gesprek afgerond. Campagne wordt afgerond.');
      }
      updateSequentialClientDispatchStatus();
      void advanceSequentialClientDispatch('direct-status-ended');
    } catch {
      // Stil houden; webhook/polling fallback kan nog steeds de queue vervolgen.
    } finally {
      isPollingSequentialClientDirectStatus = false;
    }
  }

  async function pollCallUpdatesOnce() {
    if (isPollingCallUpdates) return;
    isPollingCallUpdates = true;

    try {
      const url = `/api/coldcalling/call-updates?limit=200${lastCallUpdateSeenMs ? `&sinceMs=${lastCallUpdateSeenMs}` : ''}`;
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) return;

      const data = await response.json().catch(() => ({}));
      const updates = Array.isArray(data?.updates) ? data.updates : [];
      if (updates.length > 0) {
        let maxSeen = lastCallUpdateSeenMs;
        updates.forEach((item) => {
          const ts = Number(item?.updatedAtMs || 0);
          if (Number.isFinite(ts) && ts > maxSeen) {
            maxSeen = ts;
          }
        });
        lastCallUpdateSeenMs = maxSeen;
        const allowedPhoneKeys = getActiveLeadPhoneKeys();
        const scopedUpdates = filterCallLikeRowsForMode(updates, allowedPhoneKeys);
        if (scopedUpdates.length > 0) {
          upsertAiNotebookRowsFromWebhookUpdates(scopedUpdates);
          handleSequentialClientDispatchWebhookUpdates(scopedUpdates);
        }
      }
      await pollSequentialClientDirectCallStatusOnce();
    } catch {
      // Stil houden in UI; polling is best-effort.
    } finally {
      isPollingCallUpdates = false;
    }
  }

  function startCallUpdatePolling() {
    if (callUpdatePollTimer) return;
    void pollCallUpdatesOnce();
    callUpdatePollTimer = window.setInterval(() => {
      void pollCallUpdatesOnce();
    }, 1500);

    if (!dashboardStatsPollTimer) {
      void refreshDashboardStatsFromSupabase({ silent: true });
      dashboardStatsPollTimer = window.setInterval(() => {
        void refreshDashboardStatsFromSupabase({ silent: true });
      }, 12000);
    }
  }

  async function getOrAskTestLeadPhone() {
    const existing = readStorage(TEST_LEAD_STORAGE_KEY).trim();

    if (existing) {
      return existing;
    }

    const input = window.SoftoraDialogs && typeof window.SoftoraDialogs.prompt === 'function'
      ? await window.SoftoraDialogs.prompt(
        'Voer je eigen testnummer in (NL formaat, bijv. 0612345678 of +31612345678). Er wordt tijdelijk exact 1 testlead gebruikt.',
        '',
        {
          title: 'Testnummer invoeren',
          confirmText: 'Opslaan',
          cancelText: 'Annuleren',
        }
      )
      : null;
    const phone = String(input || '').trim();

    if (!phone) {
      return '';
    }

    writeStorage(TEST_LEAD_STORAGE_KEY, phone);
    return phone;
  }

  async function buildTestLeads() {
    const phone = await getOrAskTestLeadPhone();

    if (!phone) {
      throw new Error('Geen testnummer ingevuld. Campagne geannuleerd.');
    }

    return [
      {
        name: 'Eigen Test Lead',
        company: 'Softora Test',
        phone,
      }
    ];
  }

  function collectCampaignFormData() {
    const amount = getLeadSliderAmount();
    const minProjectValue = parseNumber(byId('minPrice')?.value, 0);
    const maxDiscountPct = parseNumber(byId('maxDiscount')?.value, 0);
    const extraInstructions = String(byId('instructions')?.value || '').trim();
    const dispatchMode = String(byId('callDispatchMode')?.value || 'sequential');
    const dispatchDelaySeconds = Math.max(0, parseNumber(byId('callDispatchDelaySeconds')?.value, 5));
    const coldcallingStack = normalizeColdcallingStack(byId('coldcallingStack')?.value || 'retell_ai');

    return {
      amount,
      sector: getSelectedText('branche'),
      region: getSelectedText('regio'),
      minProjectValue,
      maxDiscountPct,
      extraInstructions,
      dispatchMode,
      dispatchDelaySeconds,
      coldcallingStack,
      coldcallingStackLabel: getColdcallingStackLabel(coldcallingStack),
    };
  }

  function setButtonLoading(isLoading, label = 'Coldcalling bezig...') {
    launchBtn.disabled = isLoading;

    if (isLoading) {
      launchBtn.classList.add('running');
      launchBtn.innerHTML = [
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">',
        '<path d="M12 6v6l4 2"/></svg>',
        escapeHtml(label || 'Coldcalling bezig...')
      ].join('');
      return;
    }

    launchBtn.classList.remove('running');
    launchBtn.innerHTML = defaultLaunchBtnHtml;
  }

  async function parseApiResponse(response) {
    const text = await response.text();

    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  async function startCampaignRequest() {
    if (isSubmitting) return;
    if (activeSequentialClientDispatch && !activeSequentialClientDispatch.completed) {
      setStatusPill('loading', '1 voor 1 actief');
      setStatusMessage('loading', 'Er loopt al een 1 voor 1 campagne. Wacht tot deze klaar is.');
      return;
    }

    try {
      const stateSaveResult = await persistRemoteUiStateNow();
      if (!stateSaveResult?.ok || String(stateSaveResult?.source || '').trim() !== 'supabase') {
        throw new Error(
          stateSaveResult?.error || 'Dashboardconfiguratie staat nog niet veilig in Supabase.'
        );
      }

      const campaign = collectCampaignFormData();
      const stackLabel = String(
        campaign.coldcallingStackLabel || getColdcallingStackLabel(campaign.coldcallingStack) || ''
      ).trim();
      const leadSelection = await getManualLeadsFromDashboard(campaign.amount);
      const leads = leadSelection.leads;
      campaign.amount = leads.length;

      isSubmitting = true;
      setButtonLoading(true, 'Coldcalling bezig...');
      setStatusPill('loading', 'Coldcalling bezig');
      setStatusMessage('', '');
      if (leadSelection.parsed.errors.length > 0) {
        addUiLog(
          'skip',
          `<strong>Leadlijst</strong> - ${escapeHtml(
            `${leadSelection.parsed.errors.length} ongeldige regel(s) overgeslagen tijdens parsing.`
          )}`
        );
      }
      if (leadSelection.parsed.duplicateCount > 0) {
        addUiLog(
          'skip',
          `<strong>Leadlijst</strong> - ${escapeHtml(
            `${leadSelection.parsed.duplicateCount} dubbel(e) nummer(s) overgeslagen.`
          )}`
        );
      }
      if (Number(leadSelection.parsed.excludedDoNotCall || 0) > 0) {
        addUiLog(
          'skip',
          `<strong>Database</strong> - ${escapeHtml(
            `${leadSelection.parsed.excludedDoNotCall} lead(s) met status "Uit bellijst" overgeslagen.`
          )}`
        );
      }
      addUiLog(
        'call',
        `<strong>Campagne</strong> - Startverzoek verzonden voor ${escapeHtml(leads.length)} lead(s) uit je telefoonlijst (${escapeHtml(
          campaign.dispatchMode === 'parallel'
            ? 'alles tegelijk'
            : campaign.dispatchMode === 'delay'
              ? `${campaign.dispatchDelaySeconds}s tussen calls`
              : '1 voor 1'
        )}) via ${escapeHtml(stackLabel || 'onbekende provider')}.`
      );

      if (campaign.dispatchMode === 'sequential' && leads.length > 1) {
        activeSequentialClientDispatch = {
          id: `seq-client-${Date.now()}`,
          campaign: { ...campaign },
          leads: leads.slice(),
          total: leads.length,
          nextLeadIndex: 0,
          started: 0,
          failed: 0,
          waiting: false,
          waitingCallId: '',
          waitingPhoneKey: '',
          waitingSinceMs: 0,
          currentLeadIndex: -1,
          isAdvancing: false,
          completed: false,
        };

        setStatusPill('loading', '1 voor 1 actief');
        setStatusMessage('', '');

        await advanceSequentialClientDispatch('start-request');
        return;
      }

      const response = await fetch('/api/coldcalling/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaign,
          leads,
        }),
      });

      const data = await parseApiResponse(response);

      if (!response.ok || !data || data.ok === false) {
        throw new Error(data?.error || `API fout (${response.status})`);
      }

      const summary = data.summary || {};
      const started = Number(summary.started || 0);
      const failed = Number(summary.failed || 0);
      const plannedCount = Number(
        summary.sequentialWaitForCallEnd ? summary.attempted || summary.requested || started : started
      );
      updateStats(summary);

      const results = Array.isArray(data.results) ? data.results : [];
      upsertAiNotebookRowsFromCallResults(results);
      results.forEach((result) => {
        const company = escapeHtml(result?.lead?.company || result?.lead?.name || 'Onbekende lead');

        if (result.success) {
          const callId = result?.call?.callId ? ` (callId: ${escapeHtml(result.call.callId)})` : '';
          addUiLog(
            'success',
            `<strong>${company}</strong> - Outbound call gestart${callId}.`
          );
        } else {
          const cause = result?.cause ? ` Oorzaak: ${escapeHtml(result.cause)}.` : '';
          const causeExplanation = result?.causeExplanation
            ? ` ${escapeHtml(result.causeExplanation)}`
            : '';
          addUiLog(
            'skip',
            `<strong>${company}</strong> - Fout: ${escapeHtml(result.error || 'Onbekende fout')}.${cause}${causeExplanation}`
          );
        }
      });

      if (started > 0 && failed === 0) {
        setStatusPill('success', 'Campagne gestart');
        setStatusMessage('success', buildCampaignStartedMessage(plannedCount, campaign, failed));
      } else if (started > 0) {
        setStatusPill('success', 'Campagne gestart (deels)');
        setStatusMessage('success', buildCampaignStartedMessage(plannedCount, campaign, failed));
      } else {
        setStatusPill('error', 'Fout');
        const firstFailure = results.find((item) => !item.success);
        const failMessage = firstFailure?.error ? ` Exacte fout: ${firstFailure.error}.` : '';
        const failCause = firstFailure?.cause ? ` Oorzaak: ${firstFailure.cause}.` : '';
        setStatusMessage(
          'error',
          `Geen calls gestart. Controleer outbound-configuratie en logs.${failMessage}${failCause}`
        );
      }
      void refreshDashboardStatsFromSupabase({ silent: true, force: true });
    } catch (error) {
      setStatusPill('error', 'Fout');
      setStatusMessage('error', `Fout bij starten campagne: ${error.message}`);
      addUiLog('skip', `<strong>Campagne</strong> - Fout: ${escapeHtml(error.message)}.`);
    } finally {
      setButtonLoading(false);
      isSubmitting = false;
    }
  }

  // Overschrijf bestaande demo-functie uit de pagina zodat de knop de backend aanroept.
  window.toggleCampaign = function toggleCampaignColdcalling() {
    void startCampaignRequest();
  };

  async function bootstrapColdcallingUi() {
    try {
      primeStatsFromBootstrap();
      setStatusPill('idle', '');
      setStatusMessage('', '');
      activeBusinessMode = await loadSavedStatusPillModeFromSupabase();
      applyStatusPillMode(activeBusinessMode);
      const uiStateLoaded = await loadRemoteUiState();
      setupStatsResetButton();
      ensureLeadListPanel();
      setLeadSliderReadyState(true);
      setupStatusPillModeToggle();
      applyBusinessModeUi();
      startCallUpdatePolling();
      if (!uiStateLoaded || remoteUiStateLastSource !== 'supabase') {
        setStatusPill('error', 'Supabase vereist');
        setStatusMessage(
          'error',
          remoteUiStateLastError || 'Dashboardconfiguratie kon niet uit Supabase geladen worden.'
        );
        // Automatisch opnieuw proberen na 5 seconden
        window.setTimeout(async () => {
          remoteUiStateLoaded = false;
          const retried = await loadRemoteUiState();
          if (retried && remoteUiStateLastSource === 'supabase') {
            setStatusPill('idle', '');
            setStatusMessage('', '');
            void refreshDashboardStatsFromSupabase({ force: true, silent: true });
            const leadDatabaseModal = ensureLeadDatabaseModal();
            if (leadDatabaseModal && typeof leadDatabaseModal.prewarmLeadDatabase === 'function') {
              void leadDatabaseModal.prewarmLeadDatabase();
            }
          }
        }, 5000);
      } else {
        void refreshDashboardStatsFromSupabase({ force: true, silent: true });
        const leadDatabaseModal = ensureLeadDatabaseModal();
        if (leadDatabaseModal && typeof leadDatabaseModal.prewarmLeadDatabase === 'function') {
          void leadDatabaseModal.prewarmLeadDatabase();
        }
      }

      // Zorg dat het loglabel direct "calls" toont in plaats van "mails".
      updateLogCountLabel();
    } finally {
      if (
        window.SoftoraPremiumBoot &&
        typeof window.SoftoraPremiumBoot.setShellBooting === 'function'
      ) {
        window.SoftoraPremiumBoot.setShellBooting(false);
      }
    }
  }

  bindLeadDatabaseOpenControl();
  void bootstrapColdcallingUi();
})();
