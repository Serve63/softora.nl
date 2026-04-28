const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardCore = require('../../assets/coldcalling-dashboard-core.js');
const dashboardConfig = require('../../assets/coldcalling-dashboard-config.js');
const dashboardModes = require('../../assets/coldcalling-dashboard-modes.js');

test('coldcalling dashboard core normaliseert kleine pure waarden', () => {
  assert.equal(dashboardCore.byId('missing-without-document'), null);
  assert.equal(
    dashboardCore.escapeHtml('<button data-x="1">Serve & Softora</button>'),
    '&lt;button data-x=&quot;1&quot;&gt;Serve &amp; Softora&lt;/button&gt;'
  );
  assert.equal(dashboardCore.escapeHtml("Softora's"), 'Softora&#39;s');
  assert.equal(dashboardCore.parseNumber('42.5', 0), 42.5);
  assert.equal(dashboardCore.parseNumber('geen getal', 7), 7);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(dashboardCore.cloneUiStateValues({ count: 3, empty: null, mode: 'websites' }))
    ),
    { count: '3', empty: '', mode: 'websites' }
  );
  assert.deepEqual(Object.keys(dashboardCore.cloneUiStateValues(null)), []);
  assert.match(dashboardCore.getNowTime(), /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(dashboardCore.readColdcallingDashboardBootstrapPayload(), null);
});

test('coldcalling dashboard core formatteert lead database waarden centraal', () => {
  assert.equal(dashboardCore.formatLeadDatabasePhone('+31 6 1234 5678'), '+31 6 1234 5678');
  assert.equal(dashboardCore.formatLeadDatabasePhone('0612345678'), '061 234 5678');
  assert.equal(dashboardCore.formatLeadDatabasePhone('Softora receptie'), 'Softora receptie');
  assert.equal(dashboardCore.normalizeLeadDatabaseDecision('geen gehoor'), 'no_answer');
  assert.equal(dashboardCore.normalizeLeadDatabaseDecision('follow up'), 'callback');
  assert.equal(dashboardCore.normalizeLeadDatabaseDecision('uit bellijst'), 'do_not_call');
  assert.equal(dashboardCore.getLeadDatabaseDecisionLabel('appointment'), 'Wil afspraak');
  assert.equal(dashboardCore.getLeadDatabaseDecisionLabel('onbekend'), 'Onbekend');
});

test('coldcalling dashboard core houdt netwerkverzoeken abortable via fetchWithTimeout', async () => {
  const previousFetch = global.fetch;
  let capturedFetch = null;
  try {
    global.fetch = async (url, options) => {
      capturedFetch = { url, options };
      return { ok: true, source: 'contract-fetch' };
    };

    const fetchResponse = await dashboardCore.fetchWithTimeout('/api/ui-state/test', { method: 'POST' }, 25);
    assert.deepEqual(fetchResponse, { ok: true, source: 'contract-fetch' });
    assert.equal(capturedFetch.url, '/api/ui-state/test');
    assert.equal(capturedFetch.options.method, 'POST');
    assert.equal(typeof capturedFetch.options.signal.aborted, 'boolean');
  } finally {
    global.fetch = previousFetch;
  }
});

test('coldcalling dashboard core bouwt campagne voortgangsmeldingen centraal', () => {
  assert.equal(dashboardCore.estimateCampaignCompletionTime(0, { dispatchMode: 'parallel' }), null);
  assert.equal(dashboardCore.estimateCampaignCompletionTime(2, { dispatchMode: 'parallel' }) instanceof Date, true);
  assert.match(
    dashboardCore.buildCampaignStartedMessage(2, { dispatchMode: 'parallel' }, 1, 3),
    /^Gestart met het bellen van 2 personen \(3 overgeslagen, 1 niet gestart\)\. Verwachte voltooiingstijd is rond \d{2}:\d{2}\.$/
  );
});

test('coldcalling dashboard core leest bootstrap payload defensief uit de pagina', () => {
  const previousDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id !== 'softoraColdcallingDashboardBootstrap') return null;
        return {
          textContent: '{"stats":{"started":3},"source":"contract"}',
        };
      },
    };

    assert.deepEqual(dashboardCore.readColdcallingDashboardBootstrapPayload(), {
      stats: { started: 3 },
      source: 'contract',
    });

    global.document = {
      getElementById() {
        return {
          textContent: '{ongeldige json',
        };
      },
    };

    assert.equal(dashboardCore.readColdcallingDashboardBootstrapPayload(), null);
  } finally {
    global.document = previousDocument;
  }
});

test('coldcalling dashboard core beheert de lead slider ready-state defensief', () => {
  const previousDocument = global.document;
  const attributeCalls = [];
  const sliderStage = {
    dataset: {},
    removeAttribute(name) {
      attributeCalls.push({ type: 'remove', name });
    },
    setAttribute(name, value) {
      attributeCalls.push({ type: 'set', name, value });
    },
  };

  try {
    global.document = {
      getElementById(id) {
        return id === 'leadSliderStage' ? sliderStage : null;
      },
    };

    dashboardCore.setLeadSliderReadyState(true);
    assert.equal(sliderStage.dataset.sliderReady, '1');
    assert.deepEqual(attributeCalls, [{ type: 'remove', name: 'aria-hidden' }]);

    attributeCalls.length = 0;
    dashboardCore.setLeadSliderReadyState(false);
    assert.equal(sliderStage.dataset.sliderReady, '0');
    assert.deepEqual(attributeCalls, [{ type: 'set', name: 'aria-hidden', value: 'true' }]);

    global.document = {
      getElementById() {
        return null;
      },
    };
    assert.doesNotThrow(() => dashboardCore.setLeadSliderReadyState(true));
  } finally {
    global.document = previousDocument;
  }
});

test('coldcalling dashboard config centraliseert opslag- en scope-contracten', () => {
  assert.equal(dashboardConfig.LEAD_ROWS_STORAGE_KEY, 'softora_coldcalling_lead_rows_json');
  assert.equal(dashboardConfig.AI_NOTEBOOK_ROWS_STORAGE_KEY, 'softora_ai_notebook_rows_json');
  assert.equal(dashboardConfig.REMOTE_UI_STATE_SCOPE_BASE, 'coldcalling');
  assert.equal(dashboardConfig.REMOTE_UI_STATE_SCOPE_PREFERENCES, 'coldcalling_preferences');
  assert.deepEqual(dashboardConfig.BUSINESS_MODE_ORDER, [
    'websites',
    'voice_software',
    'business_software',
  ]);
  assert.equal(Object.isFrozen(dashboardConfig), true);
  assert.equal(Object.isFrozen(dashboardConfig.BUSINESS_MODE_ORDER), true);
});

test('coldcalling dashboard mode helpers normaliseren business modes en providerlabels', () => {
  assert.equal(dashboardModes.normalizeBusinessMode('Voice Software'), 'voice_software');
  assert.equal(dashboardModes.normalizeBusinessMode('bedrijfs software'), 'business_software');
  assert.equal(dashboardModes.normalizeBusinessMode('onbekend'), 'websites');

  assert.equal(dashboardModes.normalizeColdcallingStack('gemini'), 'gemini_flash_3_1_live');
  assert.equal(dashboardModes.normalizeColdcallingStack('OpenAI Realtime 1.5'), 'openai_realtime_1_5');
  assert.equal(dashboardModes.normalizeColdcallingStack('hume'), 'hume_evi_3');
  assert.equal(dashboardModes.normalizeColdcallingStack('retell'), 'retell_ai');

  assert.equal(dashboardModes.getColdcallingStackLabel('gemini'), 'Gemini 3.1 Live');
  assert.equal(dashboardModes.getColdcallingStackLabel('openai'), 'OpenAI Realtime 1.5');
  assert.equal(dashboardModes.getColdcallingStackLabel('hume'), 'Hume Evi 3');
  assert.equal(dashboardModes.getColdcallingStackLabel('retell'), 'Retell AI');
  assert.equal(Object.isFrozen(dashboardModes), true);
});

test('coldcalling dashboard core berekent campagnetiming voorspelbaar per belmethode', () => {
  const previousDateNow = Date.now;
  try {
    Date.now = () => 1777400000000;

    assert.equal(
      dashboardCore.estimateCampaignCompletionTime(3, { dispatchMode: 'sequential' }).getTime(),
      1777400000000 + 273000
    );
    assert.equal(
      dashboardCore.estimateCampaignCompletionTime(3, { dispatchMode: 'parallel' }).getTime(),
      1777400000000 + 95000
    );
    assert.equal(
      dashboardCore.estimateCampaignCompletionTime(4, { dispatchMode: 'delay', dispatchDelaySeconds: 10 }).getTime(),
      1777400000000 + 124000
    );
  } finally {
    Date.now = previousDateNow;
  }
});

test('coldcalling dashboard core breekt hangende fetches af via fetchWithTimeout', async () => {
  const previousFetch = global.fetch;
  try {
    let capturedSignal = null;
    global.fetch = async (_url, options) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('Fetch afgebroken door timeout');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };

    await assert.rejects(
      dashboardCore.fetchWithTimeout('/api/ui-state/hangend', { method: 'GET' }, 1),
      { name: 'AbortError' }
    );
    assert.equal(capturedSignal.aborted, true);
  } finally {
    global.fetch = previousFetch;
  }
});

test('coldcalling dashboard core publiceert een expliciet bevroren helper-contract', () => {
  assert.equal(Object.isFrozen(dashboardCore), true);
  assert.deepEqual(
    Object.keys(dashboardCore).sort(),
    [
      'buildCampaignStartedMessage',
      'byId',
      'cloneUiStateValues',
      'escapeHtml',
    'estimateCampaignCompletionTime',
    'fetchWithTimeout',
    'formatCampaignCustomRegioLabel',
    'formatClockTime',
    'formatConversationDuration',
      'formatLeadDatabasePhone',
      'getLeadDatabaseDecisionLabel',
      'getNowTime',
      'normalizeLeadDatabaseDecision',
      'parseNumber',
      'readColdcallingDashboardBootstrapPayload',
      'setLeadSliderReadyState',
    ].sort()
  );
});

test('coldcalling dashboard core registreert hetzelfde contract op de browser-global', () => {
  assert.equal(global.SoftoraColdcallingDashboardCore, dashboardCore);
  assert.equal(Object.isFrozen(global.SoftoraColdcallingDashboardCore), true);
});

test('coldcalling dashboard config en modes registreren hetzelfde bevroren contract op de browser-global', () => {
  assert.equal(global.SoftoraColdcallingDashboardConfig, dashboardConfig);
  assert.equal(global.SoftoraColdcallingDashboardModes, dashboardModes);
  assert.equal(Object.isFrozen(global.SoftoraColdcallingDashboardConfig), true);
  assert.equal(Object.isFrozen(global.SoftoraColdcallingDashboardModes), true);
});

test('coldcalling dashboard config en modes houden een expliciet publiek exportcontract', () => {
  assert.deepEqual(
    Object.keys(dashboardConfig).sort(),
    [
      'AI_NOTEBOOK_ROWS_STORAGE_KEY',
      'AUTO_CAMPAIGN_REGIO_VALUE',
      'BUSINESS_MODE_ORDER',
      'BUSINESS_MODE_STORAGE_KEY',
      'CALL_DISPATCH_DELAY_STORAGE_KEY',
      'CALL_DISPATCH_MODE_STORAGE_KEY',
      'CAMOUNT_Q_AFSPRAKEN',
      'CAMOUNT_Q_BELLEN',
      'CAMPAIGN_AMOUNT_CUSTOM_STORAGE_KEY',
      'CAMPAIGN_AMOUNT_QUESTION_MODE_STORAGE_KEY',
      'CAMPAIGN_AMOUNT_SLIDER_INDEX_STORAGE_KEY',
      'CAMPAIGN_BRANCHE_STORAGE_KEY',
      'CAMPAIGN_COLDCALLING_STACK_STORAGE_KEY',
      'CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY',
      'CAMPAIGN_INSTRUCTIONS_STORAGE_KEY',
      'CAMPAIGN_MAX_DISCOUNT_STORAGE_KEY',
      'CAMPAIGN_MIN_PRICE_STORAGE_KEY',
      'CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY',
      'CAMPAIGN_REGIO_STORAGE_KEY',
      'CUSTOM_CAMPAIGN_REGIO_VALUE',
      'DEFAULT_CAMPAIGN_REGIO_VALUE',
      'LEAD_DATABASE_OVERRIDES_STORAGE_KEY',
      'LEAD_ROWS_STORAGE_KEY',
      'REMOTE_UI_STATE_SCOPE_BASE',
      'REMOTE_UI_STATE_SCOPE_PREFERENCES',
      'STATS_RESET_BASELINE_STORAGE_KEY',
      'TEST_LEAD_STORAGE_KEY',
    ].sort()
  );
  assert.deepEqual(
    Object.keys(dashboardModes).sort(),
    ['getColdcallingStackLabel', 'normalizeBusinessMode', 'normalizeColdcallingStack'].sort()
  );
});

test('coldcalling dashboard config houdt browser storage keys uniek en herkenbaar', () => {
  const storageKeys = Object.entries(dashboardConfig)
    .filter(([key]) => key.endsWith('_STORAGE_KEY'))
    .map(([, value]) => value);

  assert.equal(storageKeys.length, new Set(storageKeys).size);
  storageKeys.forEach((value) => {
    assert.match(value, /^softora_/);
  });
});

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

test('coldcalling dashboard module boundaries volgen het frontend DOM-safety contract', () => {
  const boundaries = fs.readFileSync(path.join(repoRoot, 'docs/coldcalling-dashboard-module-boundaries.md'), 'utf8');

  assert.match(boundaries, /docs\/frontend-dom-safety-contract\.md/);
  assert.match(boundaries, /renderveiligheid eerst/);
  assert.match(boundaries, /textContent/);
  assert.match(boundaries, /escapeHtml/);
  assert.match(boundaries, /geen nieuwe ruwe `innerHTML`-rendering/);
});

test('coldcalling dashboard module boundaries houden de volgende splitsvolgorde expliciet', () => {
  const boundaries = fs.readFileSync(path.join(repoRoot, 'docs/coldcalling-dashboard-module-boundaries.md'), 'utf8');

  assert.match(boundaries, /Verplaats kleine, pure renderformatters/);
  assert.match(boundaries, /coldcalling-dashboard-core\.js/);
  assert.match(boundaries, /coldcalling-dashboard-config\.js/);
  assert.match(boundaries, /modals, lead-database rendering of dispatch UI/);
  assert.match(boundaries, /wiring-laag blijven/);
});

test('coldcalling dashboard core exporteert pure regio-label formatter buiten de grote dashboardfile', () => {
  const core = require('../../assets/coldcalling-dashboard-core.js');

  assert.equal(core.formatCampaignCustomRegioLabel(12.4), 'Aangepast (12 km)');
  assert.equal(core.formatCampaignCustomRegioLabel(0), 'Aangepast (1 km)');
  assert.equal(core.formatCampaignCustomRegioLabel('18'), 'Aangepast (18 km)');
});

test('coldcalling dashboard core exporteert pure gespreksduur formatter buiten de grote dashboardfile', () => {
  const core = require('../../assets/coldcalling-dashboard-core.js');

  assert.equal(core.formatConversationDuration(0), 'Onbekend');
  assert.equal(core.formatConversationDuration(9), '9s');
  assert.equal(core.formatConversationDuration(75), '1m 15s');
});
