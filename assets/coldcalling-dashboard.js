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
  const CAMPAIGN_MIN_PRICE_STORAGE_KEY = 'softora_campaign_min_price';
  const CAMPAIGN_MAX_DISCOUNT_STORAGE_KEY = 'softora_campaign_max_discount';
  const CAMPAIGN_INSTRUCTIONS_STORAGE_KEY = 'softora_campaign_instructions';
  const CAMPAIGN_COLDCALLING_STACK_STORAGE_KEY = 'softora_campaign_coldcalling_stack';
  const REMOTE_UI_STATE_SCOPE_BASE = 'coldcalling';
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
  let latestStatsSummary = { started: 0 };

  function byId(id) {
    return document.getElementById(id);
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

  function readPositiveIntStorage(key, fallback = null) {
    const raw = readStorage(key).trim();
    if (!raw) return fallback;
    const parsed = Math.round(Number(raw));
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
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
    if (regioEl && savedRegio && Array.from(regioEl.options || []).some((opt) => String(opt.value) === savedRegio)) {
      regioEl.value = savedRegio;
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
    const leadValueEl = byId('leadValue');

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
      regioEl.addEventListener('change', () => {
        writeStorage(CAMPAIGN_REGIO_STORAGE_KEY, regioEl.value);
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
    if (patchKeys.length === 0) return { ok: true, source: remoteUiStateLastSource || 'supabase' };

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

  function ensureStatusMessageElement() {
    let statusEl = byId('campaignStatusMessage');
    if (statusEl) return statusEl;

    const launchSection = document.querySelector('.launch-section');
    if (!launchSection) return null;

    statusEl = document.createElement('div');
    statusEl.id = 'campaignStatusMessage';
    statusEl.style.display = 'none';
    statusEl.style.margin = '14px 0 0';
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
    return 'websites';
  }

  function saveStatusPillMode(mode) {
    return;
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

  function applyBusinessModeUi() {
    const mode = getCurrentBusinessMode();
    const ui = getBusinessModeUiConfig(mode);

    const topTitle = document.querySelector('.topbar .topbar-left h1');
    const topSubtitle = document.querySelector('.topbar .topbar-left p');
    const leadListGroupLabel = byId('leadListControlLabel');
    const leadListOpenLabel = byId('leadListOpenLabel');
    const dbHint = byId('leadDatabaseHeaderHint');

    if (topTitle) topTitle.textContent = ui.title;
    if (topSubtitle) topSubtitle.textContent = ui.subtitle;
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
      await persistRemoteUiStateNow();
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
    applyStatusPillMode(nextMode);
    applyBusinessModeUi();
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

  function getStatsResetBaselineStarted() {
    const raw = readStorage(STATS_RESET_BASELINE_STORAGE_KEY).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return Math.round(parsed);
  }

  function setStatsResetBaselineStarted(value) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    writeStorage(STATS_RESET_BASELINE_STORAGE_KEY, String(normalized));
  }

  function resetStatsRowToZero() {
    const latestStarted = Math.max(0, Math.round(Number(latestStatsSummary?.started || 0)));
    setStatsResetBaselineStarted(latestStarted);

    const statInterested = byId('statInterested');
    const statBooked = byId('statBooked');
    const statConversion = byId('statConversion');

    if (statInterested) statInterested.textContent = '0';
    if (statBooked) statBooked.textContent = '0';
    if (statConversion) statConversion.textContent = '0%';

    updateStats(latestStatsSummary);
    addUiLog('skip', '<strong>Dashboard</strong> - Statistiekrij is gereset.');
  }

  function setupStatsResetButton() {
    const button = byId('statsResetBtn');
    if (!button || button.dataset.statsResetReady === '1') return;

    button.dataset.statsResetReady = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetStatsRowToZero();
    });
  }

  function updateStats(summary) {
    const statCalled = byId('statCalled');
    const statInterested = byId('statInterested');
    const statBooked = byId('statBooked');
    const statConversion = byId('statConversion');
    const safeSummary = summary && typeof summary === 'object' ? summary : {};
    const startedRaw = Math.max(0, Math.round(Number(safeSummary.started ?? 0)));
    latestStatsSummary = {
      ...safeSummary,
      started: startedRaw,
    };
    const startedBaseline = getStatsResetBaselineStarted();
    const startedDisplay = Math.max(0, startedRaw - startedBaseline);

    if (statCalled) statCalled.textContent = String(startedDisplay);
    if (statInterested) statInterested.textContent = '0';
    if (statBooked) statBooked.textContent = '0';
    if (statConversion) statConversion.textContent = '0%';
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
    let button = byId('openLeadListModalBtn');
    if (button) return button;

    const regioSelect = byId('regio');
    const regioGroup = regioSelect ? regioSelect.closest('.form-group') : null;
    const targetParent = regioGroup?.parentElement || document.querySelector('.generator-grid .panel');
    if (!targetParent) return null;

    const controlWrap = document.createElement('div');
    controlWrap.className = 'form-group';
    controlWrap.id = 'leadListControlWrap';
    const modeUi = getBusinessModeUiConfig();
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

    const dispatchWrap = document.createElement('div');
    dispatchWrap.className = 'form-group';
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

    // In de single-panel campagne-layout willen we 2 nette rijen:
    // links: Telefoonlijsten + Belstrategie, rechts: Doelgroep + Regio,
    // met de slider erboven over de volledige breedte.
    const generatorGrid = targetParent.closest('.generator-grid');
    const isSinglePanelLayout =
      Boolean(generatorGrid) && generatorGrid.querySelectorAll(':scope > .panel').length === 1;
    if (isSinglePanelLayout) {
      const sliderGroup = byId('leadSlider')?.closest('.form-group');
      const brancheGroup = byId('branche')?.closest('.form-group');
      const resolvedRegioGroup = byId('regio')?.closest('.form-group') || regioGroup;

      if (sliderGroup) {
        sliderGroup.style.gridColumn = '1 / -1';
        sliderGroup.style.gridRow = '2';
      }
      if (controlWrap) {
        controlWrap.style.gridColumn = '1';
        controlWrap.style.gridRow = '3';
      }
      if (dispatchWrap) {
        dispatchWrap.style.gridColumn = '1';
        dispatchWrap.style.gridRow = '4';
      }
      if (brancheGroup) {
        brancheGroup.style.gridColumn = '2';
        brancheGroup.style.gridRow = '3';
      }
      if (resolvedRegioGroup) {
        resolvedRegioGroup.style.gridColumn = '2';
        resolvedRegioGroup.style.gridRow = '4';
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

    button = byId('openLeadListModalBtn');
    const dbModal = ensureLeadDatabaseModal();
    if (button && dbModal) {
      button.addEventListener('click', () => {
        if (typeof dbModal.openLeadDatabaseModal === 'function') {
          dbModal.openLeadDatabaseModal();
        }
      });
    }

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

  async function promptManualLeadInput(message, initialValue = '', dialogOptions = {}) {
    if (window.SoftoraDialogs && typeof window.SoftoraDialogs.prompt === 'function') {
      const value = await window.SoftoraDialogs.prompt(
        message,
        initialValue,
        {
          title: dialogOptions.title || 'Lead handmatig toevoegen',
          confirmText: dialogOptions.confirmText || 'Opslaan',
          cancelText: dialogOptions.cancelText || 'Annuleren',
        }
      );
      return normalizeFreeText(value);
    }
    const fallbackValue = window.prompt(message, initialValue);
    return normalizeFreeText(fallbackValue);
  }

  async function promptAndSaveSingleManualLead(defaults = {}) {
    const phone = await promptManualLeadInput(
      'Voer telefoonnummer in (NL formaat, bijv. 0612345678 of +31612345678).',
      normalizeFreeText(defaults.phone || ''),
      {
        title: 'Lead handmatig toevoegen',
        confirmText: 'Volgende',
      }
    );

    if (!phone) {
      return {
        ok: false,
        cancelled: true,
      };
    }

    if (!looksLikePhoneNumber(phone)) {
      throw new Error('Telefoonnummer lijkt ongeldig. Gebruik bijv. 0612345678 of +31612345678.');
    }

    const company = await promptManualLeadInput(
      'Bedrijfsnaam (optioneel).',
      normalizeFreeText(defaults.company || ''),
      {
        title: 'Lead handmatig toevoegen',
        confirmText: 'Volgende',
      }
    );

    const selectedRegion = getSelectedText('regio');
    const region = await promptManualLeadInput(
      'Regio (optioneel).',
      normalizeFreeText(defaults.region || selectedRegion),
      {
        title: 'Lead handmatig toevoegen',
        confirmText: 'Opslaan',
      }
    );

    const singleLead = {
      company: company || 'Handmatige lead',
      phone,
      region,
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

    return Array.from(byId.values()).sort((a, b) => getConversationRecordUpdatedMs(b) - getConversationRecordUpdatedMs(a));
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
        `  <div style="font-family:Oswald,sans-serif; font-size:14px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.textMuted}; margin-bottom:8px;">${escapeHtml(formatConversationTimestamp(record.updatedAt || record.endedAt || record.startedAt))}</div>`,
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
          .sort((a, b) => getCallLikeRecordUpdatedMs(b) - getCallLikeRecordUpdatedMs(a));
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
          getCallLikeRecordUpdatedMs(latestUpdate),
          getCallLikeRecordUpdatedMs(latestInsight)
        );
        const lastUpdatedAt =
          normalizeFreeText(latestUpdate?.updatedAt || latestInsight?.analyzedAt || latestUpdate?.endedAt || '') ||
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
      sourceErrors.push(`Call-updates niet geladen (${error?.message || 'onbekende fout'}).`);
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
      sourceErrors.push(`AI-insights niet geladen (${error?.message || 'onbekende fout'}).`);
    }

    const scopedUpdates = filterCallLikeRowsForMode(updates, allowedPhoneKeys);
    const scopedCallIds = new Set(
      scopedUpdates
        .map((item) => normalizeFreeText(item?.callId || item?.call_id || ''))
        .filter(Boolean)
    );
    const scopedInsights = filterCallLikeRowsForMode(insights, allowedPhoneKeys, scopedCallIds);

    const records = buildLeadDatabaseRecords(parsed.leads, scopedUpdates, scopedInsights);
    const calls = buildConversationRecordsFromUpdates(scopedUpdates);
    return {
      records,
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
    const raw = normalizeFreeText(
      call?.recordingUrl || call?.recording_url || call?.recordingUrlProxy || call?.audioUrl || ''
    );
    if (raw) {
      if (/^https?:\/\//i.test(raw)) return raw;
      if (raw.startsWith('/')) return raw;
      return '';
    }

    const callId = normalizeFreeText(call?.callId || '');
    const recordingSid = normalizeFreeText(call?.recordingSid || call?.recording_sid || '');
    if (!callId || !recordingSid) return '';
    return `/api/coldcalling/recording-proxy?callId=${encodeURIComponent(callId)}&recordingSid=${encodeURIComponent(
      recordingSid
    )}`;
  }

  function inferPhoneConversationIntent(call, decisionByPhoneKey) {
    const text = normalizeSearchText(
      `${call?.summary || ''} ${call?.transcriptSnippet || ''} ${call?.transcriptFull || ''} ${call?.status || ''} ${call?.endedReason || ''}`
    );
    const callPhoneKey = phoneKey(call?.phone);
    const linkedDecision = callPhoneKey ? normalizeLeadDatabaseDecision(decisionByPhoneKey?.get(callPhoneKey) || '') : '';

    if (linkedDecision === 'do_not_call') return 'geen_interesse';
    if (linkedDecision === 'appointment' || linkedDecision === 'customer') {
      return 'interesse';
    }

    if (
      /(niet meer bellen|bel( me)? niet|geen interesse|niet geinteresseerd|niet geïnteresseerd|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst)/.test(
        text
      )
    ) {
      return 'geen_interesse';
    }

    if (
      /(interesse|geinteresseerd|geïnteresseerd|afspraak|demo|offerte|stuur (de )?(mail|info)|mail .* (offerte|informatie)|terugbellen|callback)/.test(
        text
      )
    ) {
      return 'interesse';
    }

    return 'onbekend';
  }

  function isQualifiedPhoneConversation(call) {
    const statusText = normalizeSearchText(`${call?.status || ''} ${call?.endedReason || ''}`);
    const messageType = normalizeSearchText(String(call?.messageType || ''));
    const directionText = normalizeSearchText(String(call?.direction || ''));
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

    if (
      /(not[_ -]?connected|no[_ -]?answer|unanswered|failed|dial[_ -]?failed|busy|voicemail|initiated|queued|ringing|cancelled|canceled|rejected|error)/.test(
        statusText
      )
    ) {
      return false;
    }

    const answered = inferConversationAnswered(call);
    if (answered === false) return false;

    if (hasRecording || hasConversationContent || hasKnownDuration) return true;
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

  function ensureLeadDatabaseModal() {
    let modal = byId('leadDatabaseModalOverlay');
    if (modal) return modal;

    const state = {
      loading: false,
      importing: false,
      error: '',
      info: '',
      records: [],
      calls: [],
      search: '',
      filter: 'callback',
      sourceErrors: [],
      pollTimer: null,
      lastRefreshedAt: '',
      detailCallId: '',
      forceReloadAfterLoad: false,
    };

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

    modal.innerHTML = `
      <div id="leadDatabaseModalShell" style="width:100vw; height:100vh; overflow:hidden; display:flex; flex-direction:column;">
        <div id="leadDatabaseModalHeader" style="min-height:60px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 14px;">
          <div>
            <div style="font-family:Oswald,sans-serif; font-size:23px; line-height:1; letter-spacing:0.03em; text-transform:uppercase;">Database</div>
            <div id="leadDatabaseHeaderHint" style="margin-top:4px; font-size:12px;">${escapeHtml(modeUi.dbHint)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" id="leadDatabaseRefreshBtn" aria-label="Verversen" title="Verversen" style="height:36px; width:36px; padding:0; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; line-height:1; cursor:pointer;"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg></button>
            <button type="button" id="leadDatabaseCancelBtn" style="height:34px; padding:0 11px; font-family:Oswald,sans-serif; letter-spacing:0.06em; text-transform:uppercase; font-size:12px; cursor:pointer;">Sluiten</button>
          </div>
        </div>
        <div id="leadDatabaseModalBody" style="flex:1; min-height:0; overflow:auto; padding:12px;">
          <div id="leadDatabaseStatusBar" style="display:none; margin-bottom:8px; padding:8px 10px; border-radius:6px; font-size:12px;"></div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">
            <input type="search" id="leadDatabaseSearchInput" class="form-input magnetic" placeholder="Zoek bedrijf of nummer..." style="max-width:420px; height:34px;">
            <button type="button" id="leadDatabaseImportBtn" style="height:34px; padding:0 11px; border-radius:6px; font-family:Oswald,sans-serif; letter-spacing:0.06em; text-transform:uppercase; font-size:12px; cursor:pointer;">Upload</button>
            <button type="button" id="leadDatabaseAddManualBtn" style="height:34px; padding:0 11px; border-radius:6px; font-family:Oswald,sans-serif; letter-spacing:0.06em; text-transform:uppercase; font-size:12px; cursor:pointer;">Handmatig toevoegen</button>
            <button type="button" id="leadDatabaseTemplateBtn" style="height:34px; padding:0 11px; border-radius:6px; font-family:Oswald,sans-serif; letter-spacing:0.06em; text-transform:uppercase; font-size:12px; cursor:pointer;">Template download</button>
            <input type="file" id="leadDatabaseImportInput" accept=".csv,.tsv,.txt,.json,.xls,.xlsx" style="display:none;">
          </div>
          <div id="leadDatabaseSummaryCards" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:10px;"></div>
          <div id="leadDatabaseTableWrap" style="border:1px solid rgba(255,255,255,0.08); border-radius:8px; overflow:auto; min-height:180px;"></div>
        </div>
        <div id="leadDatabaseCallDetailOverlay" style="position:fixed; inset:0; z-index:10010; display:none; align-items:center; justify-content:center; padding:18px; background:rgba(0,0,0,0.55);">
          <div id="leadDatabaseCallDetailCard" style="width:min(820px, 100%); max-height:min(86vh, 920px); overflow:auto; border-radius:12px; border:1px solid rgba(255,255,255,0.14); background:rgba(20,20,30,0.96); box-shadow:0 24px 80px rgba(0,0,0,0.45);">
            <div id="leadDatabaseCallDetailHeader" style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,0.1);">
              <div>
                <div id="leadDatabaseCallDetailTitle" style="font-family:Oswald,sans-serif; font-size:24px; line-height:1.1; letter-spacing:0.03em; text-transform:uppercase;">Telefoongesprek</div>
                <div id="leadDatabaseCallDetailMeta" style="margin-top:6px; font-size:12px; opacity:0.85;"></div>
              </div>
              <button type="button" id="leadDatabaseCallDetailCloseBtn" style="height:34px; padding:0 12px; border-radius:8px; font-family:Oswald,sans-serif; letter-spacing:0.06em; text-transform:uppercase; font-size:12px; cursor:pointer;">Sluiten</button>
            </div>
            <div id="leadDatabaseCallDetailBody" style="padding:16px;">
              <div style="margin-bottom:16px;">
                <div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; opacity:0.75; margin-bottom:8px;">Samenvatting</div>
                <div id="leadDatabaseCallDetailSummary" style="font-size:14px; line-height:1.75;"></div>
              </div>
              <div>
                <div style="font-family:Oswald,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; opacity:0.75; margin-bottom:8px;">Gesprek terugluisteren</div>
                <audio id="leadDatabaseCallDetailAudio" controls preload="metadata" style="width:100%; color-scheme:dark;"></audio>
              </div>
            </div>
          </div>
        </div>
        <div id="leadDatabaseModalFooter" style="min-height:38px; display:flex; align-items:center; justify-content:flex-end; padding:0 14px; font-size:11px;">
          <div style="font-family:Oswald,sans-serif; letter-spacing:0.12em; text-transform:uppercase;">Softora.nl</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    function applyTheme() {
      const theme = getConversationThemeTokens();
      modal.style.background = theme.overlay;
      const shell = byId('leadDatabaseModalShell');
      const header = byId('leadDatabaseModalHeader');
      const body = byId('leadDatabaseModalBody');
      const footer = byId('leadDatabaseModalFooter');
      const hint = byId('leadDatabaseHeaderHint');
      const refreshBtn = byId('leadDatabaseRefreshBtn');
      const importBtn = byId('leadDatabaseImportBtn');
      const addManualBtn = byId('leadDatabaseAddManualBtn');
      const templateBtn = byId('leadDatabaseTemplateBtn');
      const cancelBtn = byId('leadDatabaseCancelBtn');
      const statusBar = byId('leadDatabaseStatusBar');
      const detailOverlay = byId('leadDatabaseCallDetailOverlay');
      const detailCard = byId('leadDatabaseCallDetailCard');
      const detailHeader = byId('leadDatabaseCallDetailHeader');
      const detailMeta = byId('leadDatabaseCallDetailMeta');
      const detailSummary = byId('leadDatabaseCallDetailSummary');
      const detailCloseBtn = byId('leadDatabaseCallDetailCloseBtn');

      if (shell) {
        shell.style.background = theme.shellBg;
        shell.style.color = theme.text;
      }
      if (header) {
        header.style.background = theme.chromeBg;
        header.style.borderBottom = `1px solid ${theme.border}`;
      }
      if (body) {
        body.style.background = theme.panelBg;
      }
      if (footer) {
        footer.style.background = theme.chromeBg;
        footer.style.borderTop = `1px solid ${theme.border}`;
        footer.style.color = theme.accent;
      }
      if (hint) hint.style.color = theme.textMuted;
      [refreshBtn, importBtn, addManualBtn, templateBtn].forEach((button) => {
        if (!button) return;
        button.style.border = `1px solid ${theme.buttonBorder}`;
        button.style.background = theme.buttonBg;
        button.style.color = theme.buttonText;
      });
      if (cancelBtn) {
        cancelBtn.style.border = `1px solid ${theme.buttonBorder}`;
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.color = theme.buttonMutedText;
      }
      if (statusBar) {
        statusBar.style.border = `1px solid ${theme.border}`;
        statusBar.style.background = theme.blockBg;
        statusBar.style.color = theme.textMuted;
      }
      if (detailOverlay) {
        detailOverlay.style.background = getConversationThemeMode() === 'light' ? 'rgba(17,22,33,0.5)' : 'rgba(0,0,0,0.62)';
      }
      if (detailCard) {
        detailCard.style.border = `1px solid ${theme.border}`;
        detailCard.style.background = theme.shellBg;
        detailCard.style.color = theme.text;
      }
      if (detailHeader) {
        detailHeader.style.borderBottom = `1px solid ${theme.border}`;
        detailHeader.style.background = theme.chromeBg;
      }
      if (detailMeta) detailMeta.style.color = theme.textMuted;
      if (detailSummary) detailSummary.style.color = theme.text;
      if (detailCloseBtn) {
        detailCloseBtn.style.border = `1px solid ${theme.buttonBorder}`;
        detailCloseBtn.style.background = 'transparent';
        detailCloseBtn.style.color = theme.buttonMutedText;
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
        .sort(
        (a, b) => getCallLikeRecordUpdatedMs(b) - getCallLikeRecordUpdatedMs(a)
      );
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
      const updatedAt = normalizeFreeText(call?.updatedAt || '');
      const metaLine = [phone || '-', duration, updatedAt ? formatConversationTimestamp(updatedAt) : 'Onbekend']
        .filter(Boolean)
        .join(' · ');
      const recordingUrl = getCallRecordingUrl(call);
      const summaryText = getConversationConclusion(call);

      detailTitle.textContent = company;
      detailMeta.textContent = metaLine;
      detailSummary.textContent = summaryText || 'Nog geen samenvatting beschikbaar.';
      detailAudio.style.colorScheme = getConversationThemeMode();
      detailAudio.src = recordingUrl;
      detailAudio.load();
      detailOverlay.style.display = 'flex';
    }

    function openCallDetail(callId) {
      state.detailCallId = normalizeFreeText(callId);
      renderCallDetail();
    }

    function render() {
      const theme = getConversationThemeTokens();
      const tableWrap = byId('leadDatabaseTableWrap');
      const statusBar = byId('leadDatabaseStatusBar');
      const summaryCards = byId('leadDatabaseSummaryCards');
      const refreshBtn = byId('leadDatabaseRefreshBtn');
      const importBtn = byId('leadDatabaseImportBtn');
      const addManualBtn = byId('leadDatabaseAddManualBtn');
      if (!tableWrap || !summaryCards || !statusBar) return;

      if (refreshBtn) {
        refreshBtn.style.opacity = state.loading ? '0.7' : '1';
        refreshBtn.style.cursor = state.loading ? 'progress' : 'pointer';
      }
      if (importBtn) {
        const busy = state.importing || state.loading;
        importBtn.disabled = busy;
        importBtn.style.opacity = busy ? '0.7' : '1';
        importBtn.style.cursor = busy ? 'progress' : 'pointer';
      }
      if (addManualBtn) {
        const busy = state.importing || state.loading;
        addManualBtn.disabled = busy;
        addManualBtn.style.opacity = busy ? '0.7' : '1';
        addManualBtn.style.cursor = busy ? 'progress' : 'pointer';
      }

      const cards = getLeadDatabaseFilterCards(state.records, state.calls);
      if (!cards.some((card) => card.key === state.filter)) {
        state.filter = 'callback';
      }
      const filtered = getFilteredRecords();
      summaryCards.innerHTML = cards
        .map(
          (card) => {
            const isActive = state.filter === card.key;
            const isActueleBellijst = card.key === 'callback';
            const borderColor = isActueleBellijst
              ? isActive
                ? '#2d8a5e'
                : '#7ecfa8'
              : isActive
                ? theme.text
                : theme.border;
            return `
            <button type="button" data-db-filter="${escapeHtml(card.key)}" style="text-align:left; border:2px solid ${borderColor}; background:${theme.blockBg}; border-radius:6px; padding:7px 9px; cursor:pointer;">
              <div style="font-family:Oswald,sans-serif; font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">${escapeHtml(
                card.label
              )}</div>
              <div style="margin-top:4px; font-size:18px; line-height:1; color:${theme.text};">${escapeHtml(
                String(card.count)
              )}</div>
            </button>
          `;
          }
        )
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
        statusBar.style.display = 'block';
        statusBar.style.borderColor = 'rgba(255,99,99,0.25)';
        statusBar.style.background = getConversationThemeMode() === 'light' ? '#ffe9ed' : 'rgba(255,99,99,0.14)';
        statusBar.style.color = theme.text;
        statusBar.textContent = state.error;
      } else if (state.info) {
        statusBar.style.display = 'block';
        statusBar.style.borderColor = 'rgba(44,207,125,0.24)';
        statusBar.style.background = getConversationThemeMode() === 'light' ? '#e3f6ea' : 'rgba(44,207,125,0.14)';
        statusBar.style.color = theme.text;
        statusBar.textContent = state.info;
      } else if (state.sourceErrors.length > 0) {
        statusBar.style.display = 'block';
        statusBar.style.borderColor = theme.border;
        statusBar.style.background = theme.blockBg;
        statusBar.style.color = theme.textMuted;
        statusBar.textContent = state.sourceErrors.join(' ');
      } else {
        statusBar.style.display = 'none';
        statusBar.textContent = '';
      }

      if (state.loading && state.records.length === 0) {
        tableWrap.innerHTML = `<div style="padding:18px; color:${theme.textMuted};">Database laden...</div>`;
        return;
      }

      if (state.filter === 'phone_calls') {
        const calls = getFilteredCalls();
        const decisionByPhoneKey = new Map(
          (Array.isArray(state.records) ? state.records : [])
            .filter((record) => record?.phoneKey)
            .map((record) => [record.phoneKey, normalizeLeadDatabaseDecision(record.decision)])
        );
        if (calls.length === 0) {
          tableWrap.innerHTML = `<div style="padding:18px; color:${theme.textMuted};">Geen telefoongesprekken gevonden.</div>`;
          return;
        }

        tableWrap.innerHTML = `
          <table style="width:100%; border-collapse:collapse; min-width:760px;">
            <thead>
              <tr>
                <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Bedrijf</th>
                <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Telefoon</th>
                <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Status</th>
                <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Duur</th>
                <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Tijd</th>
              </tr>
            </thead>
            <tbody>
              ${calls
                .map((call) => {
                  const company = normalizeFreeText(call?.company || call?.name || 'Onbekend');
                  const phone = formatLeadDatabasePhone(normalizeFreeText(call?.phone || ''));
                  const intent = inferPhoneConversationIntent(call, decisionByPhoneKey);
                  const isNegative = intent === 'geen_interesse';
                  const isPositive = intent === 'interesse';
                  const status = isNegative ? 'Geen interesse' : isPositive ? 'Interesse' : 'Geen duidelijke interesse';
                  const statusBg = isNegative
                    ? getConversationThemeMode() === 'light'
                      ? '#ffe9ed'
                      : 'rgba(255,99,99,0.14)'
                    : isPositive
                      ? getConversationThemeMode() === 'light'
                        ? '#e3f6ea'
                        : 'rgba(44,207,125,0.14)'
                      : getConversationThemeMode() === 'light'
                        ? '#eef1f6'
                        : 'rgba(150,166,188,0.2)';
                  const duration = formatConversationDuration(call?.durationSeconds);
                  const updatedAt = normalizeFreeText(call?.updatedAt || '');
                  const callId = normalizeFreeText(call?.callId || '');
                  return `
                    <tr data-db-call-open="${escapeHtml(callId)}" tabindex="0" role="button" aria-label="Open gesprek van ${escapeHtml(
                      company
                    )}" style="cursor:pointer;">
                      <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; max-width:220px; font-size:13px; font-weight:600; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(
                        company
                      )}">${escapeHtml(company)}</td>
                      <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; font-size:13px; color:${theme.text}; white-space:nowrap;">${escapeHtml(
                        phone || '-'
                      )}</td>
                      <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; white-space:nowrap;">
                        <span style="display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; font-size:11px; background:${statusBg}; color:${theme.text};">${status}</span>
                      </td>
                      <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; font-size:12px; color:${theme.textMuted}; white-space:nowrap;">${escapeHtml(
                        duration
                      )}</td>
                      <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; font-size:12px; color:${theme.textMuted}; white-space:nowrap;">${
                        updatedAt ? escapeHtml(formatConversationTimestamp(updatedAt)) : '-'
                      }</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        `;
        tableWrap.querySelectorAll('[data-db-call-open]').forEach((row) => {
          const openRow = () => {
            const callId = normalizeFreeText(row.getAttribute('data-db-call-open') || '');
            if (!callId) return;
            openCallDetail(callId);
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
        tableWrap.innerHTML = `<div style="padding:18px; color:${theme.textMuted};">${
          state.records.length === 0
            ? 'Nog geen leads met telefoonnummer in de database. Upload een document of gebruik "Handmatig toevoegen".'
            : 'Geen resultaten voor je zoekopdracht.'
        }</div>`;
        return;
      }

      tableWrap.innerHTML = `
        <table style="width:100%; border-collapse:collapse; min-width:1180px;">
          <thead>
            <tr>
              <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Bedrijf</th>
              <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Contactpersoon</th>
              <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Telefoonnummer</th>
              <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Branche</th>
              <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Provincie</th>
              <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Adres</th>
              <th style="position:sticky; top:0; z-index:2; text-align:left; padding:7px 8px; border-bottom:1px solid ${theme.border}; background:${theme.chromeBg}; font-family:Oswald,sans-serif; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:${theme.textMuted};">Webiste</th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map((record) => {
                const company = record.company || 'Onbekend bedrijf';
                const contactPerson = record.contactPerson || '-';
                const phone = record.phone || '-';
                const branche = record.branche || '-';
                const province = record.province || record.region || '-';
                const address = record.address || '-';
                const website = record.website || '';
                const websiteHref = /^https?:\/\//i.test(website) ? website : `https://${website}`;
                return `
                  <tr>
                    <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; max-width:220px; font-size:14px; font-weight:600; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(
                      company
                    )}">${escapeHtml(company)}</td>
                    <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; max-width:170px; font-size:13px; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(
                      contactPerson
                    )}">${escapeHtml(contactPerson)}</td>
                    <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; font-size:13px; color:${theme.text}; white-space:nowrap;">${escapeHtml(
                      phone
                    )}</td>
                    <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; max-width:140px; font-size:13px; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(
                      branche
                    )}">${escapeHtml(branche)}</td>
                    <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; max-width:130px; font-size:13px; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(
                      province
                    )}">${escapeHtml(province)}</td>
                    <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; max-width:280px; font-size:13px; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(
                      address
                    )}">${escapeHtml(address)}</td>
                    <td style="padding:7px 8px; border-bottom:1px solid ${theme.border}; vertical-align:middle; max-width:220px; font-size:13px; color:${theme.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(
                      website || '-'
                    )}">${
                      website
                        ? `<a href="${escapeHtml(
                            websiteHref
                          )}" target="_blank" rel="noopener noreferrer" style="color:${theme.text}; text-decoration:underline; text-underline-offset:2px;">${escapeHtml(
                            website
                          )}</a>`
                        : '-'
                    }</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
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

    function downloadLeadDatabaseTemplate() {
      const lines = [
        'bedrijf;telefoonnummer;regio;contactpersoon;branche;provincie;adres;website',
        'Voorbeeld BV;0612345678;Utrecht;Jan Jansen;Installatie;Utrecht;Voorbeeldstraat 12 Utrecht;voorbeeld.nl',
      ];
      const csv = `\uFEFF${lines.join('\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'bedrijvenregister_template.csv';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
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
        state.calls = Array.isArray(data.calls) ? data.calls : Array.isArray(data.updates) ? data.updates : [];
        state.sourceErrors = Array.isArray(data.sourceErrors) ? data.sourceErrors : [];
        state.lastRefreshedAt = new Date().toISOString();
        if (force) {
          state.info = `Verversd om ${new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}.`;
        }
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
      modal.style.display = 'none';
      document.body.style.overflow = '';
      if (state.pollTimer) {
        window.clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    }

    function openModal() {
      applyTheme();
      state.filter = 'callback';
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      void loadData(true);
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
    byId('leadDatabaseRefreshBtn')?.addEventListener('click', () => {
      state.info = '';
      state.error = '';
      void loadData(true, { force: true });
    });
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
        if (!result?.ok) {
          state.info = 'Geen handmatige lead toegevoegd.';
        } else if (result.remoteSaved === false) {
          state.info = 'Lead lokaal toegevoegd. Opslaan naar Supabase volgt zodra verbinding beschikbaar is.';
        } else {
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
    byId('leadDatabaseTemplateBtn')?.addEventListener('click', () => {
      downloadLeadDatabaseTemplate();
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

    if (endedReason) return true;
    if (messageType.includes('call.ended') || messageType.includes('end-of-call')) return true;

    return /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected)/.test(
      status
    );
  }

  function updateSequentialClientDispatchStatus() {
    const run = activeSequentialClientDispatch;
    if (!run || run.completed) return;

    const processed = run.started + run.failed;
    const total = run.total;
    if (run.waiting) {
      setStatusPill('loading', '1 voor 1 actief');
      setStatusMessage(
        'loading',
        `1 voor 1 actief: ${processed}/${total} verwerkt. Wacht tot het huidige gesprek is afgelopen om de volgende call te starten.`
      );
      return;
    }

    setStatusPill('loading', 'Bezig met starten');
    setStatusMessage('loading', `1 voor 1 actief: ${processed}/${total} verwerkt. Volgende call wordt gestart...`);
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
          setButtonLoading(false);
          isSubmitting = false;
        }

        if (run.waiting) {
          break;
        }
      }

      if (!run.waiting && run.nextLeadIndex >= run.leads.length) {
        run.completed = true;
        const completedCount = run.started;
        if (run.started > 0 && run.failed === 0) {
          setStatusPill('success', 'Campagne gestart');
          setStatusMessage('success', buildCampaignStartedMessage(completedCount, run.campaign, run.failed));
        } else if (run.started > 0) {
          setStatusPill('success', 'Campagne gestart (deels)');
          setStatusMessage('success', buildCampaignStartedMessage(completedCount, run.campaign, run.failed));
        } else {
          setStatusPill('error', 'Fout');
          setStatusMessage('error', 'Geen calls gestart. Controleer outbound-configuratie en logs.');
        }
        activeSequentialClientDispatch = null;
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
        messageType: 'direct.call.status',
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

  function setButtonLoading(isLoading) {
    launchBtn.disabled = isLoading;

    if (isLoading) {
      launchBtn.classList.add('running');
      launchBtn.innerHTML = [
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">',
        '<path d="M12 6v6l4 2"/></svg>',
        'Campagne starten...'
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
      const campaign = collectCampaignFormData();
      const stackLabel = campaign.coldcallingStackLabel || getColdcallingStackLabel(campaign.coldcallingStack);
      const leadSelection = await getManualLeadsFromDashboard(campaign.amount);
      const leads = leadSelection.leads;
      campaign.amount = leads.length;

      isSubmitting = true;
      setButtonLoading(true);
      setStatusPill('loading', 'Bezig met starten');
      setStatusMessage('loading', `Campagne wordt gestart via ${stackLabel}...`);
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
        )}) via ${escapeHtml(stackLabel)}.`
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
        setStatusMessage(
          'loading',
          `1 voor 1 actief: 0/${leads.length} verwerkt. Eerste call wordt gestart...`
        );

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
    activeBusinessMode = getSavedStatusPillMode();
    applyStatusPillMode(activeBusinessMode);
    await loadRemoteUiState();
    setupStatsResetButton();
    ensureLeadListPanel();
    setupStatusPillModeToggle();
    applyBusinessModeUi();
    startCallUpdatePolling();

    // Zorg dat het loglabel direct "calls" toont in plaats van "mails".
    updateLogCountLabel();
  }

  void bootstrapColdcallingUi();
})();
