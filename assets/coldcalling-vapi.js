(function () {
  const launchBtn = document.getElementById('launchBtn');
  const leadSlider = document.getElementById('leadSlider');

  if (!launchBtn || !leadSlider) {
    return;
  }

  let isSubmitting = false;
  let uiLogCount = 0;
  let activeSheetInput = null;
  let lastVapiCallUpdateSeenMs = 0;
  let vapiCallUpdatePollTimer = null;
  let isPollingVapiCallUpdates = false;
  let isPollingSequentialClientDirectStatus = false;
  let statusMessageHideTimer = null;
  let activeSequentialClientDispatch = null;
  const defaultLaunchBtnHtml = launchBtn.innerHTML;
  const TEST_LEAD_STORAGE_KEY = 'softora_vapi_test_lead_phone';
  const LEAD_ROWS_STORAGE_KEY = 'softora_vapi_lead_rows_json';
  const AI_NOTEBOOK_ROWS_STORAGE_KEY = 'softora_ai_notebook_rows_json';
  const CALL_DISPATCH_MODE_STORAGE_KEY = 'softora_call_dispatch_mode';
  const CALL_DISPATCH_DELAY_STORAGE_KEY = 'softora_call_dispatch_delay_seconds';
  const CAMPAIGN_AMOUNT_SLIDER_INDEX_STORAGE_KEY = 'softora_campaign_amount_slider_index';
  const CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY = 'softora_campaign_amount_custom';
  const CAMPAIGN_BRANCHE_STORAGE_KEY = 'softora_campaign_branche';
  const CAMPAIGN_REGIO_STORAGE_KEY = 'softora_campaign_regio';
  const CAMPAIGN_MIN_PRICE_STORAGE_KEY = 'softora_campaign_min_price';
  const CAMPAIGN_MAX_DISCOUNT_STORAGE_KEY = 'softora_campaign_max_discount';
  const CAMPAIGN_INSTRUCTIONS_STORAGE_KEY = 'softora_campaign_instructions';
  const REMOTE_UI_STATE_SCOPE = 'coldcalling';
  let remoteUiStateCache = Object.create(null);
  let remoteUiStateLoaded = false;
  let remoteUiStateLoadingPromise = null;
  let remoteUiStateSaveTimer = null;
  let remoteUiStateSaveInFlight = false;
  let remoteUiStatePendingPatch = Object.create(null);

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

  function getLeadSliderAmount() {
    const rawValue = Math.max(1, parseNumber(leadSlider.value, 1));
    const customValue = Math.round(parseNumber(leadSlider.dataset?.customValue, NaN));
    if (Number.isFinite(customValue) && customValue > 0) {
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
    leadValueEl.innerHTML = `${getLeadSliderAmount()} <span>mensen</span>`;
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
    if (Number.isFinite(customAmount)) {
      leadSlider.dataset.customValue = String(customAmount);
    } else {
      delete leadSlider.dataset.customValue;
    }

    const brancheEl = byId('branche');
    const regioEl = byId('regio');
    const minPriceEl = byId('minPrice');
    const maxDiscountEl = byId('maxDiscount');
    const instructionsEl = byId('instructions');

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

    renderLeadAmountDisplay();
  }

  function persistCampaignAmountState() {
    const sliderIndex = Math.round(parseNumber(leadSlider.value, 0));
    writeStorage(CAMPAIGN_AMOUNT_SLIDER_INDEX_STORAGE_KEY, String(Math.max(0, sliderIndex)));

    const customValue = Math.round(parseNumber(leadSlider.dataset?.customValue, NaN));
    if (Number.isFinite(customValue) && customValue > 0) {
      writeStorage(CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY, String(customValue));
    } else {
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
    const leadValueEl = byId('leadValue');

    leadSlider.addEventListener('input', () => {
      // De pagina-script verwijdert customValue al op slider beweging; wij persistten daarna de nieuwe state.
      persistCampaignAmountState();
    });
    leadSlider.addEventListener('change', persistCampaignAmountState);

    if (leadValueEl && leadValueEl.dataset.campaignPersistenceBound !== '1') {
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

    remoteUiStateLoadingPromise = (async () => {
      try {
        const response = await fetch(`/api/ui-state/${encodeURIComponent(REMOTE_UI_STATE_SCOPE)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) return false;

        const data = await response.json().catch(() => ({}));
        const values = data && data.ok && data.values && typeof data.values === 'object' ? data.values : {};
        const nextCache = Object.create(null);
        Object.entries(values).forEach(([k, v]) => {
          nextCache[String(k)] = String(v ?? '');
        });
        remoteUiStateCache = nextCache;
        remoteUiStateLoaded = true;
        return true;
      } catch {
        remoteUiStateLoaded = true;
        return false;
      } finally {
        remoteUiStateLoadingPromise = null;
      }
    })();

    return remoteUiStateLoadingPromise;
  }

  async function flushRemoteUiStateSave() {
    if (remoteUiStateSaveInFlight) return;

    const patch = remoteUiStatePendingPatch;
    const patchKeys = Object.keys(patch);
    if (patchKeys.length === 0) return;

    remoteUiStatePendingPatch = Object.create(null);
    remoteUiStateSaveInFlight = true;

    try {
      await fetch(`/api/ui-state/${encodeURIComponent(REMOTE_UI_STATE_SCOPE)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          patch,
          source: 'assets/coldcalling-vapi.js',
          actor: 'browser',
        }),
      });
    } catch {
      patchKeys.forEach((key) => {
        remoteUiStatePendingPatch[key] = String(patch[key] ?? '');
      });
    } finally {
      remoteUiStateSaveInFlight = false;
      if (Object.keys(remoteUiStatePendingPatch).length > 0) {
        scheduleRemoteUiStateSave(800);
      }
    }
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

    if (kind === 'success' || kind === 'loading') {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }

    pill.innerHTML = `<span class="dot"></span> ${escapeHtml(text)}`;
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

  function updateStats(summary) {
    const statCalled = byId('statCalled');
    const statInterested = byId('statInterested');
    const statBooked = byId('statBooked');
    const statConversion = byId('statConversion');

    if (statCalled) statCalled.textContent = String(summary.started ?? 0);
    if (statInterested) statInterested.textContent = '0';
    if (statBooked) statBooked.textContent = '0';
    if (statConversion) statConversion.textContent = '0%';
  }

  function getDefaultLeadRow() {
    return {
      company: '',
      phone: '',
      region: '',
    };
  }

  function normalizeLeadRow(row) {
    const company = String(row?.company || '').trim();
    const phone = String(row?.phone || '').trim();
    const region = String(row?.region || '').trim();

    return {
      company,
      phone,
      // Keep legacy saved rows from showing prefilled region values when no lead data exists.
      region: company || phone ? region : '',
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
      return parsed.map(normalizeLeadRow);
    } catch {
      return [];
    }
  }

  function saveLeadRows(rows) {
    writeStorage(LEAD_ROWS_STORAGE_KEY, JSON.stringify((rows || []).map(normalizeLeadRow)));
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
        setLeadModalDraftHint('Concept aangepast. Klik "Opslaan lijst" om te bewaren.');
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
        const nextFocus = rowsWrap.querySelector(
          `input[data-row-index="${startRowIndex}"][data-col-index="${startColIndex}"]`
        );
        if (nextFocus) setActiveSheetInput(nextFocus);
        setLeadModalDraftHint(
          `Excel/Sheets plak verwerkt: ${grid.length} rij(en) ingevoegd. Klik "Opslaan lijst".`
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
      setLeadModalDraftHint('Excel/Sheets plakken wordt ondersteund. Lege regels worden genegeerd.');
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
      setLeadModalDraftHint('Cel aangepast via formulebalk. Klik "Opslaan lijst" om te bewaren.');
    });

    byId('leadListAddRowBtn')?.addEventListener('click', () => {
      const rows = collectLeadRowsFromModal();
      for (let i = 0; i < 10; i += 1) {
        rows.push(getDefaultLeadRow());
      }
      renderLeadRows(rows);
      setLeadModalDraftHint('10 rijen toegevoegd. Klik "Opslaan lijst" om te bewaren.');
    });

    byId('leadListClearRowsBtn')?.addEventListener('click', () => {
      renderLeadRows([]);
      setLeadModalDraftHint('Lijst geleegd in concept. Klik "Opslaan lijst" om leeg op te slaan.');
    });

    byId('leadListSaveBtn')?.addEventListener('click', () => {
      const rows = collectLeadRowsFromModal();
      saveLeadRows(rows);
      updateLeadListHint();
      const parsed = parseLeadRows(rows);
      if (!parsed.hasInput) {
        setLeadModalDraftHint('Lege lijst opgeslagen. Er worden geen calls gestart zonder geldige leads.');
      } else {
        setLeadModalDraftHint(`Opgeslagen: ${parsed.leads.length} geldige lead(s).`);
      }
      closeModal();
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
    controlWrap.innerHTML = [
      '<label class="form-label">Telefoonlijsten</label>',
      '<button type="button" class="form-input magnetic" id="openLeadListModalBtn" style="text-align:left; display:flex; align-items:center; justify-content:flex-start; gap:12px; cursor:pointer;">',
      '  <span>Open spreadsheet</span>',
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
    const modal = ensureLeadListModal();
    if (button && modal) {
      button.addEventListener('click', () => {
        if (typeof modal.openLeadListModal === 'function') {
          modal.openLeadListModal();
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
    ensureAiNotebookPanel();
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

  function getManualLeadsFromDashboard(requestedAmount) {
    const parsed = parseLeadRows(getSavedLeadRows());

    if (!parsed.hasInput) {
      throw new Error('Geen leadlijst opgeslagen. Open spreadsheet, voeg leads toe en klik "Opslaan lijst".');
    }

    if (parsed.leads.length === 0) {
      throw new Error(parsed.errors[0] || 'Leadlijst bevat geen geldige regels.');
    }

    return {
      mode: 'manual',
      leads: parsed.leads.slice(0, Math.max(1, requestedAmount)),
      parsed,
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
    writeStorage(AI_NOTEBOOK_ROWS_STORAGE_KEY, JSON.stringify((rows || []).map(normalizeAiNotebookRow)));
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
        setAiNotebookDraftHint('Kladblok aangepast. Klik "Opslaan lijst" om te bewaren.');
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
        const nextFocus = rowsWrap.querySelector(
          `input[data-row-index="${startRowIndex}"][data-col-index="${startColIndex}"]`
        );
        if (nextFocus) setActiveSheetInput(nextFocus);
        setAiNotebookDraftHint(
          `Excel/Sheets plak verwerkt: ${grid.length} rij(en) in AI kladblok. Klik "Opslaan lijst".`
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

    const parsed = parseAiNotebookRows(getSavedAiNotebookRows());
    if (!parsed.hasInput) {
      hint.style.display = 'block';
      hint.textContent =
        'Nog leeg. Gebruik dit kladblok om callstatus, terugbelreden en geheugenpunten voor AI bij te houden.';
      return;
    }

    hint.textContent = '';
    hint.style.display = 'none';
  }

  function ensureAiNotebookModal() {
    let modal = byId('aiNotebookModalOverlay');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'aiNotebookModalOverlay';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(8, 10, 16, 0.72)';
    modal.style.display = 'none';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '16px';
    modal.style.zIndex = '9999';

    modal.innerHTML = [
      '<div style="width:min(1680px, 99vw); height:min(920px, 94vh); overflow:hidden; border-radius:14px; border:1px solid #c7c9cc; background:#f1f3f4; box-shadow:0 20px 80px rgba(0,0,0,0.45); color:#202124; display:flex; flex-direction:column;">',
      '  <div style="height:56px; background:#ffffff; border-bottom:1px solid #dadce0; display:flex; align-items:center; justify-content:space-between; padding:0 16px; gap:8px;">',
      '    <button type="button" id="aiNotebookCancelBtn" style="height:34px; border:1px solid #dadce0; background:#fff; border-radius:8px; padding:0 12px; cursor:pointer;">Sluiten</button>',
      '    <button type="button" id="aiNotebookSaveBtn" style="height:34px; border:1px solid #c6dafc; background:#d2e3fc; color:#174ea6; border-radius:8px; padding:0 12px; font-weight:600; cursor:pointer;">Opslaan lijst</button>',
      '  </div>',
      '  <div style="padding:8px 12px 6px; background:#f1f3f4;">',
      '    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; font-size:11px; color:#3c4043;">',
      '      <span id="aiNotebookDraftHint" style="color:#5f6368;">Excel/Sheets plakken wordt ondersteund. Kolommen A-F: bedrijf, telefoon, status, terugbellen, reden, onthouden.</span>',
      '    </div>',
      '  </div>',
      '  <div style="padding:0 12px 8px; flex:1; min-height:0; background:#f1f3f4;">',
      '    <div id="aiNotebookRowsWrap" style="height:100%;"></div>',
      '  </div>',
      '  <div style="height:46px; background:#ffffff; border-top:1px solid #dadce0; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 12px;">',
      '    <div style="display:flex; align-items:center; gap:8px;">',
      '      <button type="button" id="aiNotebookAddRowBtn" style="height:30px; border:1px solid #dadce0; background:#fff; border-radius:6px; padding:0 10px; cursor:pointer;">+10 rijen</button>',
      '      <button type="button" id="aiNotebookClearRowsBtn" style="height:30px; border:1px solid #dadce0; background:#fff; border-radius:6px; padding:0 10px; cursor:pointer;">Lijst wissen</button>',
      '      <div style="margin-left:8px; width:1px; height:18px; background:#dadce0;"></div>',
      '      <div style="padding:0 10px; height:30px; border:1px solid #dadce0; border-radius:6px; display:flex; align-items:center; font-size:12px; background:#f8f9fa;">AI Kladblok</div>',
      '    </div>',
      '    <div style="font-size:11px; color:#5f6368;">A-F: Bedrijf, Telefoon, Status, Opnieuw bellen?, Waarom, Onthouden</div>',
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
      renderAiNotebookRows(getSavedAiNotebookRows());
      setAiNotebookDraftHint(
        'Excel/Sheets plakken wordt ondersteund. Kolommen A-F: bedrijf, telefoon, status, terugbellen, reden, onthouden.'
      );
    }

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    byId('aiNotebookCancelBtn')?.addEventListener('click', closeModal);

    byId('aiNotebookAddRowBtn')?.addEventListener('click', () => {
      const rows = collectAiNotebookRowsFromModal();
      for (let i = 0; i < 10; i += 1) rows.push(getDefaultAiNotebookRow());
      renderAiNotebookRows(rows);
      setAiNotebookDraftHint('10 rijen toegevoegd. Klik "Opslaan lijst" om te bewaren.');
    });

    byId('aiNotebookClearRowsBtn')?.addEventListener('click', () => {
      renderAiNotebookRows([]);
      setAiNotebookDraftHint('AI kladblok geleegd in concept. Klik "Opslaan lijst" om te bewaren.');
    });

    byId('aiNotebookSaveBtn')?.addEventListener('click', () => {
      const rows = collectAiNotebookRowsFromModal();
      saveAiNotebookRows(rows);
      updateAiNotebookHint();
      const parsed = parseAiNotebookRows(rows);
      setAiNotebookDraftHint(
        parsed.hasInput
          ? `AI kladblok opgeslagen: ${parsed.nonEmptyRowCount} regel(s).`
          : 'Leeg AI kladblok opgeslagen.'
      );
      closeModal();
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.style.display !== 'none') closeModal();
    });

    modal.openAiNotebookModal = openModal;
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
      '<label class="form-label">Kladblok voor AI</label>',
      '<button type="button" class="form-input magnetic" id="openAiNotebookModalBtn" style="text-align:left; display:flex; align-items:center; justify-content:flex-start; gap:12px; cursor:pointer;">',
      '  <span>Open kladblok</span>',
      '</button>',
      '<div id="aiNotebookHint" style="margin-top:8px; font-size:12px; line-height:1.4; opacity:0.85;">Nog leeg. Gebruik dit kladblok om callstatus, terugbelreden en geheugenpunten voor AI bij te houden.</div>',
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
    return String(value || '').replace(/\D/g, '');
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
        const status = String(result?.vapi?.status || 'queued').trim();
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
        const callId = result?.vapi?.callId ? ` (callId: ${escapeHtml(result.vapi.callId)})` : '';
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
    run.waitingCallId = String(primaryResult?.vapi?.callId || '').trim();
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
          setStatusMessage('error', 'Geen calls gestart. Controleer Vapi-configuratie en logs.');
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

  async function pollVapiCallUpdatesOnce() {
    if (isPollingVapiCallUpdates) return;
    isPollingVapiCallUpdates = true;

    try {
      const url = `/api/vapi/call-updates?limit=200${lastVapiCallUpdateSeenMs ? `&sinceMs=${lastVapiCallUpdateSeenMs}` : ''}`;
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) return;

      const data = await response.json().catch(() => ({}));
      const updates = Array.isArray(data?.updates) ? data.updates : [];
      if (updates.length > 0) {
        let maxSeen = lastVapiCallUpdateSeenMs;
        updates.forEach((item) => {
          const ts = Number(item?.updatedAtMs || 0);
          if (Number.isFinite(ts) && ts > maxSeen) {
            maxSeen = ts;
          }
        });
        lastVapiCallUpdateSeenMs = maxSeen;
        upsertAiNotebookRowsFromWebhookUpdates(updates);
        handleSequentialClientDispatchWebhookUpdates(updates);
      }
      await pollSequentialClientDirectCallStatusOnce();
    } catch {
      // Stil houden in UI; polling is best-effort.
    } finally {
      isPollingVapiCallUpdates = false;
    }
  }

  function startVapiCallUpdatePolling() {
    if (vapiCallUpdatePollTimer) return;
    void pollVapiCallUpdatesOnce();
    vapiCallUpdatePollTimer = window.setInterval(() => {
      void pollVapiCallUpdatesOnce();
    }, 1500);
  }

  function getOrAskTestLeadPhone() {
    const existing = readStorage(TEST_LEAD_STORAGE_KEY).trim();

    if (existing) {
      return existing;
    }

    const input = window.prompt(
      'Voer je eigen testnummer in (NL formaat, bijv. 0612345678 of +31612345678). Er wordt tijdelijk exact 1 testlead gebruikt.'
    );
    const phone = String(input || '').trim();

    if (!phone) {
      return '';
    }

    writeStorage(TEST_LEAD_STORAGE_KEY, phone);
    return phone;
  }

  function buildTestLeads() {
    const phone = getOrAskTestLeadPhone();

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

    return {
      amount,
      sector: getSelectedText('branche'),
      region: getSelectedText('regio'),
      minProjectValue,
      maxDiscountPct,
      extraInstructions,
      dispatchMode,
      dispatchDelaySeconds,
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
      const leadSelection = getManualLeadsFromDashboard(campaign.amount);
      const leads = leadSelection.leads;
      campaign.amount = leads.length;

      isSubmitting = true;
      setButtonLoading(true);
      setStatusPill('loading', 'Bezig met starten');
      setStatusMessage('loading', 'Campagne wordt gestart via Vapi...');
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
      addUiLog(
        'call',
        `<strong>Campagne</strong> - Startverzoek verzonden voor ${escapeHtml(leads.length)} lead(s) uit je telefoonlijst (${escapeHtml(
          campaign.dispatchMode === 'parallel'
            ? 'alles tegelijk'
            : campaign.dispatchMode === 'delay'
              ? `${campaign.dispatchDelaySeconds}s tussen calls`
              : '1 voor 1'
        )}).`
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
          const callId = result?.vapi?.callId ? ` (callId: ${escapeHtml(result.vapi.callId)})` : '';
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
          `Geen calls gestart. Controleer Vapi-configuratie en logs.${failMessage}${failCause}`
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
  window.toggleCampaign = function toggleCampaignVapi() {
    void startCampaignRequest();
  };

  async function bootstrapColdcallingUi() {
    await loadRemoteUiState();
    ensureLeadListPanel();
    ensureAiNotebookPanel();
    startVapiCallUpdatePolling();

    // Zorg dat het loglabel direct "calls" toont in plaats van "mails".
    updateLogCountLabel();
  }

  void bootstrapColdcallingUi();
})();
