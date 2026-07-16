(function () {
  'use strict';

  var root = document.querySelector('[data-health-dossier]');
  if (!root) return;

  var statusBox = root.querySelector('[data-health-status]');
  var statusText = root.querySelector('[data-health-status-text]');

  function setText(selector, value) {
    var element = root.querySelector(selector);
    if (element) element.textContent = value == null || value === '' ? '—' : String(value);
  }

  function number(value, digits) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(digits || 0) : '—';
  }

  function formatDate(value, withTime) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('nl-NL', withTime
      ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }
      : { day: '2-digit', month: 'short', timeZone: 'Europe/Amsterdam' }
    ).format(date);
  }

  async function request(url, options) {
    var response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.ok === false) throw new Error(payload.error || 'De WHOOP-koppeling antwoordt niet.');
    return payload;
  }

  function setStatus(state, text) {
    statusBox.dataset.state = state || '';
    statusText.textContent = text;
  }

  function summary(record) {
    return record && record.summary && typeof record.summary === 'object' ? record.summary : {};
  }

  function latest(records, type) {
    return records.find(function (record) { return record.source_type === type; }) || null;
  }

  function recoveryClass(score) {
    if (!Number.isFinite(score)) return '';
    return score >= 67 ? 'health-kpi--high' : score >= 34 ? 'health-kpi--medium' : 'health-kpi--low';
  }

  function renderChart(records) {
    var chart = root.querySelector('[data-health-chart]');
    var byDay = new Map();
    records.filter(function (record) { return record.source_type === 'recovery'; }).forEach(function (record) {
      if (!byDay.has(record.local_day)) byDay.set(record.local_day, record);
    });
    var items = Array.from(byDay.values()).slice(0, 14).reverse();
    chart.replaceChildren();
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'health-empty';
      empty.textContent = 'Na de eerste koppeling verschijnt hier je hersteltrend.';
      chart.appendChild(empty);
      return;
    }
    items.forEach(function (record) {
      var score = Number(summary(record).recovery_score);
      var item = document.createElement('div');
      item.className = 'health-chart__item';
      var value = document.createElement('span');
      value.className = 'health-chart__value';
      value.textContent = Number.isFinite(score) ? String(Math.round(score)) : '—';
      var bar = document.createElement('span');
      bar.className = 'health-chart__bar ' + (score >= 67 ? '' : score >= 34 ? 'health-chart__bar--medium' : 'health-chart__bar--low');
      bar.style.height = Math.max(3, Number.isFinite(score) ? score : 3) + '%';
      var day = document.createElement('span');
      day.className = 'health-chart__day';
      day.textContent = formatDate(record.local_day + 'T12:00:00Z', false);
      item.append(value, bar, day);
      chart.appendChild(item);
    });
  }

  function renderSleep(record) {
    var facts = root.querySelector('[data-health-sleep-facts]');
    var values = facts ? facts.querySelectorAll('dd') : [];
    var data = summary(record);
    var stages = data.stage_summary || {};
    var durationMs = Number(stages.total_in_bed_time_milli || stages.total_sleep_time_milli);
    var hours = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 3600000 : NaN;
    if (values[0]) values[0].textContent = Number.isFinite(hours) ? hours.toFixed(1) + ' uur' : '—';
    if (values[1]) values[1].textContent = number(data.sleep_efficiency_percentage, 0) + (Number.isFinite(Number(data.sleep_efficiency_percentage)) ? '%' : '');
    if (values[2]) values[2].textContent = number(data.sleep_consistency_percentage, 0) + (Number.isFinite(Number(data.sleep_consistency_percentage)) ? '%' : '');
  }

  function renderWorkouts(records) {
    var container = root.querySelector('[data-health-workouts]');
    var workouts = records.filter(function (record) { return record.source_type === 'workout'; }).slice(0, 6);
    container.replaceChildren();
    if (!workouts.length) {
      var empty = document.createElement('p');
      empty.className = 'health-empty';
      empty.textContent = 'Nog geen trainingen ingeladen.';
      container.appendChild(empty);
      return;
    }
    workouts.forEach(function (record) {
      var data = summary(record);
      var card = document.createElement('article');
      card.className = 'health-workout';
      var top = document.createElement('div');
      top.className = 'health-workout__top';
      var title = document.createElement('h3');
      title.textContent = data.sport_name || ('Sport ' + (data.sport_id == null ? '' : data.sport_id));
      var time = document.createElement('time');
      time.textContent = formatDate(record.start_at || record.local_day, false);
      top.append(title, time);
      var strain = document.createElement('strong');
      strain.textContent = number(data.strain, 1);
      var detail = document.createElement('p');
      detail.textContent = 'strain · gem. hartslag ' + number(data.average_heart_rate, 0);
      card.append(top, strain, detail);
      container.appendChild(card);
    });
  }

  function renderData(payload) {
    var records = Array.isArray(payload.records) ? payload.records : [];
    var recovery = latest(records, 'recovery');
    var sleep = latest(records, 'sleep');
    var cycle = latest(records, 'cycle');
    var recoveryData = summary(recovery);
    var sleepData = summary(sleep);
    var cycleData = summary(cycle);
    var recoveryScore = Number(recoveryData.recovery_score);
    setText('[data-health-recovery]', number(recoveryScore, 0));
    setText('[data-health-hrv]', number(recoveryData.hrv_rmssd_milli, 0));
    setText('[data-health-rhr]', number(recoveryData.resting_heart_rate, 0));
    setText('[data-health-sleep]', number(sleepData.sleep_performance_percentage, 0));
    setText('[data-health-strain]', number(cycleData.strain, 1));
    setText('[data-health-recovery-note]', recovery ? recovery.local_day : 'Laatste WHOOP-score');
    setText('[data-health-sleep-note]', sleep ? sleep.local_day : 'Laatste nacht');
    setText('[data-health-latest-day]', recovery ? recovery.local_day : '—');
    var recoveryCard = root.querySelector('.health-kpi--recovery');
    recoveryCard.classList.remove('health-kpi--high', 'health-kpi--medium', 'health-kpi--low');
    var healthClass = recoveryClass(recoveryScore);
    if (healthClass) recoveryCard.classList.add(healthClass);
    renderChart(records);
    renderSleep(sleep);
    renderWorkouts(records);
  }

  async function load() {
    var status = await request('/api/health/whoop/status');
    setText('[data-health-last-sync]', formatDate(status.lastSyncCompletedAt, true));
    setText('[data-health-last-day]', status.lastSyncedDay);
    if (!status.configured) setStatus('error', 'WHOOP-app is nog niet volledig geconfigureerd.');
    else if (!status.connected) setStatus('', 'Koppel je WHOOP één keer; daarna loopt de import dagelijks automatisch om 08:00.');
    else if (status.lastSyncError) setStatus('error', 'WHOOP is gekoppeld, maar de laatste sync gaf: ' + status.lastSyncError);
    else setStatus('connected', 'WHOOP gekoppeld · de data van gisteren wordt dagelijks om 08:00 bijgewerkt.');
    if (status.connected) renderData(await request('/api/health/whoop/data?days=90'));
    return status;
  }

  async function sync(mode) {
    setStatus('', mode === 'backfill' ? 'Volledige WHOOP-geschiedenis wordt ingeladen…' : 'WHOOP-data wordt bijgewerkt…');
    try {
      var result = await request('/api/health/whoop/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode || 'manual' })
      });
      setStatus('connected', 'Bijgewerkt: ' + (result.records || 0) + ' WHOOP-records verwerkt en naar de spreadsheet geschreven.');
      await load();
    } catch (error) {
      setStatus('error', error.message);
    }
  }

  var params = new URLSearchParams(window.location.search);
  var whoopResult = params.get('whoop');
  load().then(function (status) {
    if (whoopResult === 'connected' && status.connected) return sync('backfill');
    if (whoopResult === 'error') setStatus('error', params.get('message') || 'WHOOP-koppeling afgebroken.');
  }).catch(function (error) {
    setStatus('error', error.message);
  }).finally(function () {
    if (whoopResult) window.history.replaceState({}, document.title, window.location.pathname);
  });
})();
