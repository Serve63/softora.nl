(function () {
  'use strict';

  var REMOTE_SCOPE = 'premium_toto_lab';
  var REMOTE_KEY = 'softora_premium_toto_lab_v1';
  var math = window.SoftoraTotoMath;
  var state = math ? math.normalizeState({}) : null;
  var isLoaded = false;
  var isSaving = false;
  var settlementEntryId = '';
  var toastTimer = null;
  var elements = {};

  function euro(value) {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function signedEuro(value) {
    var number = Number(value) || 0;
    return (number > 0 ? '+' : '') + euro(number);
  }

  function percent(value, fallback) {
    return value === null || value === undefined
      ? (fallback || '—')
      : new Intl.NumberFormat('nl-NL', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(Number(value) || 0) + '%';
  }

  function decimal(value) {
    return new Intl.NumberFormat('nl-NL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function todayLocal() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function createElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function createMetric(label, value) {
    var metric = createElement('div', 'toto-cohort__metric');
    metric.appendChild(createElement('span', '', label));
    metric.appendChild(createElement('strong', '', value));
    return metric;
  }

  function getClient() {
    if (!window.SoftoraUiStateClient) throw new Error('Softora opslagclient ontbreekt.');
    return window.SoftoraUiStateClient;
  }

  function setSyncStatus(message, tone) {
    if (!elements.syncStatus) return;
    elements.syncStatus.textContent = String(message || '');
    elements.syncStatus.dataset.tone = tone || '';
  }

  function setInteractiveEnabled(enabled) {
    document.querySelectorAll('#screen-toto [data-toto-persist]').forEach(function (element) {
      element.disabled = !enabled || isSaving;
    });
  }

  function setSaving(saving, message) {
    isSaving = Boolean(saving);
    setInteractiveEnabled(isLoaded);
    if (saving) setSyncStatus(message || 'Opslaan…', '');
  }

  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = String(message || '');
    elements.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      elements.toast.classList.remove('is-visible');
    }, 3200);
  }

  function parseRemoteState(payload) {
    var values = payload && payload.values && typeof payload.values === 'object'
      ? payload.values
      : {};
    var raw = String(values[REMOTE_KEY] || '');
    if (!raw) return math.normalizeState({});
    try {
      return math.normalizeState(JSON.parse(raw));
    } catch (_error) {
      throw new Error('Het opgeslagen TOTO-logboek bevat ongeldige data.');
    }
  }

  async function persistState(nextState, actor) {
    var normalized = math.normalizeState(nextState);
    var values = {};
    values[REMOTE_KEY] = JSON.stringify(normalized);
    values.updated_at = new Date().toISOString();
    values.updated_by = String(actor || 'browser');
    var result = await getClient().set(REMOTE_SCOPE, {
      values: values,
      replace: true,
      source: 'premium-toto',
      actor: String(actor || 'browser')
    }, { timeoutMs: 12000 });
    if (String(result && result.source || '').toLowerCase() !== 'supabase') {
      throw new Error('Opslag is niet door de database bevestigd; er is niets lokaal geforceerd.');
    }
    return normalized;
  }

  function getMissionDay(config) {
    var start = Date.parse(config.startDate + 'T00:00:00');
    var target = Date.parse(config.targetDate + 'T00:00:00');
    var now = Date.parse(todayLocal() + 'T00:00:00');
    var total = Math.max(1, Math.round((target - start) / 86400000));
    var elapsed = Math.max(0, Math.min(total, Math.floor((now - start) / 86400000)));
    return { day: elapsed + 1, total: total };
  }

  function setText(selector, value) {
    var element = document.querySelector(selector);
    if (element) element.textContent = String(value);
  }

  function renderMission(metrics) {
    var timing = getMissionDay(state.config);
    setText('[data-toto-mission-day]', 'Dag ' + timing.day + ' / ' + timing.total);
    setText('[data-toto-bankroll]', euro(metrics.currentBankroll));
    setText('[data-toto-target]', 'Doel ' + euro(state.config.targetBankroll));
    setText('[data-toto-progress-label]', percent(metrics.targetProgressPct));
    setText('[data-toto-daily-required]', percent(metrics.requiredDailyGrowthPct));
    if (elements.goalProgress) {
      elements.goalProgress.style.width = Math.max(0, Math.min(100, metrics.targetProgressPct)) + '%';
    }
  }

  function renderKpis(metrics) {
    setText('[data-toto-kpi-bankroll]', euro(metrics.currentBankroll));
    setText('[data-toto-kpi-profit]', signedEuro(metrics.profit));
    setText('[data-toto-kpi-proof]', metrics.proof.label);
    setText('[data-toto-kpi-risk]', euro(metrics.openRisk));
    setText('[data-toto-kpi-profit-note]', percent(metrics.roiPct) + ' paper-ROI');
    setText('[data-toto-kpi-proof-note]', metrics.settledCount + ' / ' + state.config.evidenceTarget + ' gesloten');
    setText('[data-toto-kpi-risk-note]', metrics.pendingCount + ' open voorspelling' + (metrics.pendingCount === 1 ? '' : 'en'));
    var profitCard = document.querySelector('[data-toto-kpi="profit"]');
    if (profitCard) profitCard.dataset.tone = metrics.profit > 0 ? 'positive' : metrics.profit < 0 ? 'negative' : '';
  }

  function renderProof(metrics) {
    setText('[data-toto-proof-label]', metrics.proof.label);
    setText('[data-toto-proof-detail]', metrics.proof.detail);
    setText('[data-toto-proof-count]', metrics.settledCount + '/' + state.config.evidenceTarget);
    if (elements.evidenceProgress) elements.evidenceProgress.style.width = metrics.evidenceProgressPct + '%';
    setText('[data-toto-brier]', metrics.brierScore === null ? '—' : decimal(metrics.brierScore));
    setText('[data-toto-calibration]', percent(metrics.calibrationErrorPct));
    setText('[data-toto-clv]', percent(metrics.averageClvPct));
    setText('[data-toto-drawdown]', percent(metrics.maxDrawdownPct));
  }

  function getDraftFromForm() {
    var form = elements.entryForm;
    var data = new FormData(form);
    return {
      eventDate: data.get('eventDate'),
      competition: data.get('competition'),
      event: data.get('event'),
      market: data.get('market'),
      selection: data.get('selection'),
      odds: data.get('odds'),
      modelProbability: (Number(data.get('modelProbability')) || 0) / 100,
      stake: data.get('stake'),
      closingOdds: null,
      note: data.get('note')
    };
  }

  function renderDraftPreview() {
    if (!elements.entryForm || !isLoaded) return;
    var draft = getDraftFromForm();
    var odds = Number(draft.odds) || 0;
    var probability = Number(draft.modelProbability) || 0;
    var analysisEntry = { odds: odds, modelProbability: probability };
    setText('[data-toto-preview-implied]', odds > 1 ? percent((1 / odds) * 100) : '—');
    setText('[data-toto-preview-edge]', odds > 1 ? percent(math.getEntryEdgePoints(analysisEntry)) : '—');
    setText('[data-toto-preview-ev]', odds > 1 ? percent(math.getEntryExpectedValuePct(analysisEntry)) : '—');
  }

  function renderRisk(metrics) {
    var risk = math.getRiskSnapshot(state, new Date().toISOString());
    setText('[data-toto-max-stake]', euro(risk.maxAllowedStake));
    setText('[data-toto-daily-risk]', euro(risk.dailyRiskUsed));
    setText('[data-toto-open-room]', euro(risk.openRemaining));
    var stakeInput = elements.entryForm && elements.entryForm.elements.stake;
    if (stakeInput) {
      stakeInput.max = risk.maxAllowedStake.toFixed(2);
      stakeInput.placeholder = risk.maxAllowedStake.toFixed(2);
      if (!stakeInput.value && risk.maxAllowedStake > 0) {
        stakeInput.value = Math.min(0.1, risk.maxAllowedStake).toFixed(2);
      }
    }
    setText('[data-toto-available-bankroll]', euro(metrics.availableBankroll) + ' beschikbaar');
  }

  function statusLabel(status) {
    return {
      pending: 'Open',
      won: 'Gewonnen',
      lost: 'Verloren',
      void: 'Ongeldig'
    }[status] || status;
  }

  function renderEntries() {
    if (!elements.entryTableBody || !elements.entryEmpty) return;
    elements.entryTableBody.replaceChildren();
    var entries = state.entries.slice().sort(function (a, b) {
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
    elements.entryEmpty.hidden = entries.length > 0;
    elements.entryTable.hidden = entries.length === 0;

    entries.forEach(function (entry) {
      var row = document.createElement('tr');
      var eventCell = document.createElement('td');
      var eventWrap = createElement('div', 'toto-event');
      eventWrap.appendChild(createElement('strong', '', entry.event));
      eventWrap.appendChild(createElement(
        'span',
        '',
        [entry.eventDate, entry.competition].filter(Boolean).join(' · ')
      ));
      eventCell.appendChild(eventWrap);
      row.appendChild(eventCell);

      var selectionCell = document.createElement('td');
      var selectionWrap = createElement('div', 'toto-event');
      selectionWrap.appendChild(createElement('strong', '', entry.selection));
      selectionWrap.appendChild(createElement('span', '', entry.market));
      selectionCell.appendChild(selectionWrap);
      row.appendChild(selectionCell);

      var analysisCell = document.createElement('td');
      var analysisWrap = createElement('div', 'toto-analysis-cell');
      analysisWrap.appendChild(createElement('span', 'toto-chip', 'Odds ' + decimal(entry.odds)));
      analysisWrap.appendChild(createElement(
        'span',
        'toto-chip toto-chip--positive',
        'Edge ' + percent(math.getEntryEdgePoints(entry))
      ));
      analysisWrap.appendChild(createElement(
        'span',
        'toto-chip',
        'EV ' + percent(math.getEntryExpectedValuePct(entry))
      ));
      analysisCell.appendChild(analysisWrap);
      row.appendChild(analysisCell);

      var stakeCell = document.createElement('td');
      stakeCell.textContent = euro(entry.stake);
      row.appendChild(stakeCell);

      var resultCell = document.createElement('td');
      var badge = createElement('span', 'toto-status-badge', statusLabel(entry.status));
      badge.dataset.status = entry.status;
      resultCell.appendChild(badge);
      if (entry.status !== 'pending') {
        resultCell.appendChild(createElement(
          'div',
          'toto-kpi__note',
          signedEuro(math.getEntryProfit(entry))
        ));
      }
      row.appendChild(resultCell);

      var actionCell = document.createElement('td');
      if (entry.status === 'pending') {
        var settleButton = createElement('button', 'toto-row-action', 'Afwikkelen');
        settleButton.type = 'button';
        settleButton.dataset.totoPersist = 'true';
        settleButton.addEventListener('click', function () { openSettlement(entry.id); });
        actionCell.appendChild(settleButton);
      } else {
        var clv = math.getEntryClvPct(entry);
        actionCell.textContent = clv === null ? 'CLV —' : 'CLV ' + percent(clv);
      }
      row.appendChild(actionCell);
      elements.entryTableBody.appendChild(row);
    });
  }

  function renderCohorts() {
    if (!elements.cohorts) return;
    elements.cohorts.replaceChildren();
    var cohorts = math.computeCohorts(state, 'market').slice(0, 6);
    if (!cohorts.length) {
      elements.cohorts.appendChild(createElement(
        'div',
        'toto-empty',
        'Cohortanalyse verschijnt zodra voorspellingen zijn afgewikkeld.'
      ));
      return;
    }
    cohorts.forEach(function (cohort) {
      var row = createElement('div', 'toto-cohort');
      row.appendChild(createElement('div', 'toto-cohort__name', cohort.label));
      row.appendChild(createMetric('N', cohort.count));
      row.appendChild(createMetric('ROI', percent(cohort.roiPct)));
      row.appendChild(createMetric('CLV', percent(cohort.averageClvPct)));
      row.appendChild(createMetric('Brier', decimal(cohort.brierScore)));
      elements.cohorts.appendChild(row);
    });
  }

  function renderAll() {
    if (!state) return;
    var metrics = math.computeMetrics(state);
    renderMission(metrics);
    renderKpis(metrics);
    renderProof(metrics);
    renderRisk(metrics);
    renderEntries();
    renderCohorts();
    renderDraftPreview();
    setInteractiveEnabled(isLoaded);
  }

  function showFormErrors(errors) {
    if (!elements.formErrors) return;
    var messages = Array.isArray(errors) ? errors : [];
    elements.formErrors.hidden = messages.length === 0;
    elements.formErrors.replaceChildren();
    if (messages.length) {
      var list = document.createElement('ul');
      messages.forEach(function (message) {
        list.appendChild(createElement('li', '', message));
      });
      elements.formErrors.appendChild(list);
    }
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'toto-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  async function submitEntry(event) {
    event.preventDefault();
    if (!isLoaded || isSaving) return;
    var nowIso = new Date().toISOString();
    var validation = math.validateDraft(getDraftFromForm(), state, nowIso);
    showFormErrors(validation.errors);
    if (!validation.ok) return;

    var nextState = math.normalizeState({
      config: state.config,
      entries: state.entries.concat([Object.assign({}, validation.entry, {
        id: newId(),
        createdAt: nowIso,
        status: 'pending'
      })])
    });
    setSaving(true, 'Forward log opslaan…');
    try {
      state = await persistState(nextState, 'paper-entry-create');
      elements.entryForm.reset();
      elements.entryForm.elements.eventDate.value = todayLocal();
      showFormErrors([]);
      setSyncStatus('Opgeslagen in Supabase', 'success');
      showToast('Paper-voorspelling staat onveranderbaar in het forward log.');
      renderAll();
    } catch (error) {
      setSyncStatus('Opslag mislukt', 'error');
      showFormErrors([error.message || 'Opslaan mislukt.']);
    } finally {
      setSaving(false);
    }
  }

  function openSettlement(entryId) {
    var entry = state.entries.find(function (item) { return item.id === entryId; });
    if (!entry || entry.status !== 'pending') return;
    settlementEntryId = entry.id;
    setText('[data-toto-settle-event]', entry.event + ' · ' + entry.selection);
    elements.settlementForm.reset();
    elements.settlementModal.hidden = false;
    elements.settlementForm.elements.result.focus();
  }

  function closeSettlement() {
    settlementEntryId = '';
    if (elements.settlementModal) elements.settlementModal.hidden = true;
  }

  async function submitSettlement(event) {
    event.preventDefault();
    if (!settlementEntryId || !isLoaded || isSaving) return;
    var formData = new FormData(elements.settlementForm);
    var result = String(formData.get('result') || '');
    var closingOddsRaw = String(formData.get('closingOdds') || '').trim();
    var closingOdds = closingOddsRaw ? Number(closingOddsRaw) : null;
    var note = String(formData.get('settlementNote') || '').trim().slice(0, 300);
    var errors = [];
    if (!['won', 'lost', 'void'].includes(result)) errors.push('Kies winst, verlies of ongeldig.');
    if (closingOdds !== null && (!Number.isFinite(closingOdds) || closingOdds <= 1.01 || closingOdds > 50)) {
      errors.push('Closing odds moeten leeg zijn of tussen 1,02 en 50 liggen.');
    }
    if (errors.length) {
      showToast(errors.join(' '));
      return;
    }

    var resolvedAt = new Date().toISOString();
    var nextEntries = state.entries.map(function (entry) {
      if (entry.id !== settlementEntryId) return entry;
      return Object.assign({}, entry, {
        status: result,
        closingOdds: closingOdds,
        resolvedAt: resolvedAt,
        note: [entry.note, note].filter(Boolean).join(' · ').slice(0, 500)
      });
    });
    setSaving(true, 'Resultaat opslaan…');
    try {
      state = await persistState({ config: state.config, entries: nextEntries }, 'paper-entry-settle');
      closeSettlement();
      setSyncStatus('Resultaat bevestigd in Supabase', 'success');
      showToast('Resultaat toegevoegd; de oorspronkelijke voorspelling blijft behouden.');
      renderAll();
    } catch (error) {
      setSyncStatus('Opslag mislukt', 'error');
      showToast(error.message || 'Resultaat opslaan mislukt.');
    } finally {
      setSaving(false);
    }
  }

  function openScreen() {
    document.body.classList.add('toto-lab-active');
    document.querySelectorAll('.screen').forEach(function (screen) {
      screen.classList.remove('active');
    });
    var screen = document.getElementById('screen-toto');
    if (screen) {
      screen.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  function backToExtra() {
    document.body.classList.remove('toto-lab-active');
    document.querySelectorAll('.screen').forEach(function (screen) {
      screen.classList.remove('active');
    });
    var target = document.getElementById('screen-extra') || document.getElementById('screen-overzicht');
    if (target) target.classList.add('active');
  }

  function buildScreen() {
    var host = document.querySelector('#settings-screen-app .premium-boot-shell');
    if (!host || document.getElementById('screen-toto')) return;
    var screen = document.createElement('div');
    screen.className = 'screen';
    screen.id = 'screen-toto';
    screen.innerHTML = [
      '<div class="toto-shell">',
      '  <div class="toto-toolbar">',
      '    <button type="button" class="toto-back" data-toto-back><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Terug naar Extra</button>',
      '    <span class="toto-sync-status" data-toto-sync-status>Tracker laden…</span>',
      '  </div>',
      '  <section class="toto-hero">',
      '    <div class="toto-hero__copy">',
      '      <p class="toto-eyebrow">Ruben · Toto Forward Lab</p>',
      '      <h1 class="toto-title">€10 <span>→</span> €100.000</h1>',
      '      <p class="toto-subtitle">Geen glazen bol en geen achterafverhaal. Iedere voorspelling wordt vooraf vastgelegd, daarna meten we kalibratie, closing-line value, rendement en drawdown. Alleen aantoonbaar bewijs telt.</p>',
      '      <span class="toto-mode">Simulatie · geen echte inzetten</span>',
      '    </div>',
      '    <div class="toto-hero__mission">',
      '      <div>',
      '        <div class="toto-mission__top"><span class="toto-mission__label">Virtuele bankroll</span><span class="toto-mission__day" data-toto-mission-day>Dag 1 / 365</span></div>',
      '        <strong class="toto-mission__balance" data-toto-bankroll>€10,00</strong>',
      '        <span class="toto-mission__target" data-toto-target>Doel €100.000,00</span>',
      '      </div>',
      '      <div>',
      '        <div class="toto-progress" aria-label="Logaritmische doelvoortgang"><span data-toto-goal-progress></span></div>',
      '        <div class="toto-progress__meta"><span><span data-toto-progress-label>0,0%</span> log-doelpad</span><span><span data-toto-daily-required>2,6%</span> per dag vereist</span></div>',
      '      </div>',
      '    </div>',
      '  </section>',
      '  <aside class="toto-honesty"><span class="toto-honesty__mark">!</span><div><strong>Harde realiteitscheck</strong><p>€10 naar €100.000 is 10.000×. Dat vraagt circa 2,56% samengestelde groei per dag en 113,2% per 30 dagen. De interface toont die wiskunde bewust; hij zal nooit geluk als bewezen strategie verkopen.</p></div></aside>',
      '  <section class="toto-kpis" aria-label="TOTO kerncijfers">',
      '    <article class="toto-kpi"><span class="toto-kpi__label">Bankroll</span><strong data-toto-kpi-bankroll>€10,00</strong><span class="toto-kpi__note" data-toto-available-bankroll>€10,00 beschikbaar</span></article>',
      '    <article class="toto-kpi" data-toto-kpi="profit"><span class="toto-kpi__label">Netto resultaat</span><strong data-toto-kpi-profit>€0,00</strong><span class="toto-kpi__note" data-toto-kpi-profit-note>0,0% paper-ROI</span></article>',
      '    <article class="toto-kpi"><span class="toto-kpi__label">Bewijsstatus</span><strong data-toto-kpi-proof>Onbewezen</strong><span class="toto-kpi__note" data-toto-kpi-proof-note>0 / 200 gesloten</span></article>',
      '    <article class="toto-kpi"><span class="toto-kpi__label">Open risico</span><strong data-toto-kpi-risk>€0,00</strong><span class="toto-kpi__note" data-toto-kpi-risk-note>0 open voorspellingen</span></article>',
      '  </section>',
      '  <div class="toto-main-grid">',
      '    <div class="toto-stack">',
      '      <section class="toto-panel">',
      '        <header class="toto-panel__header"><div><p class="toto-panel__eyebrow">Evidence engine</p><h2>Is er werkelijk een edge?</h2></div></header>',
      '        <div class="toto-panel__body">',
      '          <div class="toto-proof"><div><div class="toto-proof__label" data-toto-proof-label>Onbewezen</div><p class="toto-proof__detail" data-toto-proof-detail>Te weinig gesloten voorspellingen voor een serieuze conclusie.</p></div><div class="toto-proof__count" data-toto-proof-count>0/200</div></div>',
      '          <div class="toto-proof__meter"><span data-toto-evidence-progress></span></div>',
      '          <div class="toto-model-grid" style="margin-top:16px">',
      '            <div class="toto-model-metric"><span>Brier-score</span><strong data-toto-brier>—</strong></div>',
      '            <div class="toto-model-metric"><span>Kalibratiefout</span><strong data-toto-calibration>—</strong></div>',
      '            <div class="toto-model-metric"><span>Gem. CLV</span><strong data-toto-clv>—</strong></div>',
      '            <div class="toto-model-metric"><span>Max drawdown</span><strong data-toto-drawdown>0,0%</strong></div>',
      '          </div>',
      '        </div>',
      '      </section>',
      '      <section class="toto-panel">',
      '        <header class="toto-panel__header"><div><p class="toto-panel__eyebrow">Forward log</p><h2>Alle voorspellingen</h2></div></header>',
      '        <div class="toto-table-wrap">',
      '          <div class="toto-empty" data-toto-entry-empty><strong>Nog geen bewijs</strong><p>Log de eerste paper-voorspelling vóór de wedstrijd. Resultaten komen er later append-only bij; de oorspronkelijke kans en odds blijven intact.</p></div>',
      '          <table class="toto-table" data-toto-entry-table hidden><thead><tr><th>Event</th><th>Selectie</th><th>Vooraf-analyse</th><th>Virtueel</th><th>Resultaat</th><th>Actie / CLV</th></tr></thead><tbody data-toto-entry-body></tbody></table>',
      '        </div>',
      '      </section>',
      '      <section class="toto-panel">',
      '        <header class="toto-panel__header"><div><p class="toto-panel__eyebrow">Strategy attribution</p><h2>Waar komt resultaat vandaan?</h2></div></header>',
      '        <div class="toto-panel__body"><div class="toto-cohorts" data-toto-cohorts></div></div>',
      '      </section>',
      '    </div>',
      '    <div class="toto-stack">',
      '      <section class="toto-panel">',
      '        <header class="toto-panel__header"><div><p class="toto-panel__eyebrow">Voor de aftrap</p><h2>Voorspelling loggen</h2></div></header>',
      '        <div class="toto-panel__body">',
      '          <form class="toto-form" data-toto-entry-form>',
      '            <div class="toto-form__row"><div class="toto-field"><label for="toto-event-date">Wedstrijddatum</label><input id="toto-event-date" name="eventDate" type="date" required data-toto-persist></div><div class="toto-field"><label for="toto-competition">Competitie</label><input id="toto-competition" name="competition" type="text" maxlength="80" placeholder="Eredivisie" data-toto-persist></div></div>',
      '            <div class="toto-field"><label for="toto-event">Wedstrijd / event</label><input id="toto-event" name="event" type="text" maxlength="140" placeholder="Ajax – PSV" required data-toto-persist></div>',
      '            <div class="toto-form__row"><div class="toto-field"><label for="toto-market">Markt</label><input id="toto-market" name="market" type="text" maxlength="100" placeholder="Matchresultaat" required data-toto-persist></div><div class="toto-field"><label for="toto-selection">Paper-selectie</label><input id="toto-selection" name="selection" type="text" maxlength="100" placeholder="Thuis" required data-toto-persist></div></div>',
      '            <div class="toto-form__row"><div class="toto-field"><label for="toto-odds">Decimal odds</label><input id="toto-odds" name="odds" type="number" min="1.02" max="50" step="0.01" placeholder="2.00" required data-toto-persist></div><div class="toto-field"><label for="toto-probability">Modelkans %</label><input id="toto-probability" name="modelProbability" type="number" min="1" max="99.5" step="0.1" placeholder="55.0" required data-toto-persist></div></div>',
      '            <div class="toto-form__row"><div class="toto-field"><label for="toto-stake">Virtuele inzet €</label><input id="toto-stake" name="stake" type="number" min="0.01" step="0.01" required data-toto-persist></div><div class="toto-field"><label for="toto-note">Modelversie / bron</label><input id="toto-note" name="note" type="text" maxlength="500" placeholder="v1 · pre-match dataset" data-toto-persist></div></div>',
      '            <div class="toto-form__preview"><div><span>Implied</span><strong data-toto-preview-implied>—</strong></div><div><span>Model-edge</span><strong data-toto-preview-edge>—</strong></div><div><span>EV per €1</span><strong data-toto-preview-ev>—</strong></div></div>',
      '            <div class="toto-form__errors" data-toto-form-errors hidden role="alert"></div>',
      '            <button class="toto-primary" type="submit" data-toto-persist>Vastleggen in forward log</button>',
      '          </form>',
      '        </div>',
      '      </section>',
      '      <section class="toto-panel">',
      '        <header class="toto-panel__header"><div><p class="toto-panel__eyebrow">Fail-closed</p><h2>Actieve rails</h2></div></header>',
      '        <div class="toto-panel__body">',
      '          <ul class="toto-rails"><li>Alleen simulatie; geen bookmakerkoppeling en geen automatische echte inzet.</li><li>Maximaal 2% per paper-test, 5% per dag en 8% gelijktijdig open risico.</li><li>Minimaal 3 procentpunt model-edge én 2% verwachte waarde.</li><li>Geen combi’s of bet builders; één hypothese per regel.</li><li>Append-only forward log: oorspronkelijke odds en kans worden niet achteraf herschreven.</li><li>Pas vanaf 200 gesloten voorspellingen begint een voorzichtige edge-audit.</li></ul>',
      '          <div class="toto-risk-line"><span>Max nu <strong data-toto-max-stake>€0,20</strong></span><span>Vandaag <strong data-toto-daily-risk>€0,00</strong></span><span>Open ruimte <strong data-toto-open-room>€0,80</strong></span></div>',
      '        </div>',
      '      </section>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="toto-modal" data-toto-settlement-modal hidden>',
      '  <div class="toto-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="toto-settlement-title">',
      '    <header class="toto-modal__header"><div><h2 id="toto-settlement-title">Resultaat vastleggen</h2><p data-toto-settle-event></p></div><button class="toto-modal__close" type="button" data-toto-settlement-close aria-label="Sluiten">×</button></header>',
      '    <div class="toto-modal__body">',
      '      <form class="toto-form" data-toto-settlement-form>',
      '        <div class="toto-field"><label for="toto-result">Resultaat</label><select id="toto-result" name="result" required data-toto-persist><option value="">Kies…</option><option value="won">Gewonnen</option><option value="lost">Verloren</option><option value="void">Ongeldig / void</option></select></div>',
      '        <div class="toto-field"><label for="toto-closing-odds">Closing odds (optioneel)</label><input id="toto-closing-odds" name="closingOdds" type="number" min="1.02" max="50" step="0.01" placeholder="1.90" data-toto-persist></div>',
      '        <div class="toto-field"><label for="toto-settlement-note">Notitie</label><textarea id="toto-settlement-note" name="settlementNote" maxlength="300" placeholder="Dataprobleem, blessure-informatie, modelobservatie…" data-toto-persist></textarea></div>',
      '        <div class="toto-modal__actions"><button class="toto-secondary" type="button" data-toto-settlement-close>Annuleren</button><button class="toto-primary" type="submit" data-toto-persist>Resultaat toevoegen</button></div>',
      '      </form>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="toto-toast" data-toto-toast role="status" aria-live="polite"></div>'
    ].join('');
    host.appendChild(screen);

    elements = {
      screen: screen,
      syncStatus: screen.querySelector('[data-toto-sync-status]'),
      goalProgress: screen.querySelector('[data-toto-goal-progress]'),
      evidenceProgress: screen.querySelector('[data-toto-evidence-progress]'),
      entryForm: screen.querySelector('[data-toto-entry-form]'),
      formErrors: screen.querySelector('[data-toto-form-errors]'),
      entryEmpty: screen.querySelector('[data-toto-entry-empty]'),
      entryTable: screen.querySelector('[data-toto-entry-table]'),
      entryTableBody: screen.querySelector('[data-toto-entry-body]'),
      cohorts: screen.querySelector('[data-toto-cohorts]'),
      settlementModal: screen.querySelector('[data-toto-settlement-modal]'),
      settlementForm: screen.querySelector('[data-toto-settlement-form]'),
      toast: screen.querySelector('[data-toto-toast]')
    };

    screen.querySelector('[data-toto-back]').addEventListener('click', backToExtra);
    elements.entryForm.addEventListener('submit', submitEntry);
    elements.entryForm.addEventListener('input', renderDraftPreview);
    elements.settlementForm.addEventListener('submit', submitSettlement);
    screen.querySelectorAll('[data-toto-settlement-close]').forEach(function (button) {
      button.addEventListener('click', closeSettlement);
    });
    elements.settlementModal.addEventListener('click', function (event) {
      if (event.target === elements.settlementModal) closeSettlement();
    });
    elements.entryForm.elements.eventDate.value = todayLocal();
    setInteractiveEnabled(false);
  }

  async function load() {
    if (!math) return;
    setSyncStatus('Tracker laden…', '');
    try {
      var payload = await getClient().get(REMOTE_SCOPE);
      state = parseRemoteState(payload);
      isLoaded = true;
      setSyncStatus('Supabase verbonden', 'success');
      renderAll();
    } catch (error) {
      isLoaded = false;
      setSyncStatus('Opslag niet beschikbaar', 'error');
      showFormErrors([
        (error && error.message) || 'TOTO-logboek laden mislukt.',
        'Fail-closed: invoer blijft geblokkeerd tot de database weer bereikbaar is.'
      ]);
      setInteractiveEnabled(false);
    }
  }

  if (!math) {
    console.error('TOTO math engine ontbreekt.');
    return;
  }

  buildScreen();
  window.SoftoraToto = {
    open: openScreen,
    getState: function () { return math.normalizeState(state); }
  };
  void load();
})();
