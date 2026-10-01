(function () {
  'use strict';
  const form = document.getElementById('analytics-filters');
  if (!form) return;
  const results = document.getElementById('analytics-results'), status = document.getElementById('analytics-status'), error = document.getElementById('analytics-error');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const number = value => Number(value || 0).toLocaleString('nl-NL');
  const percentage = value => value == null ? '—' : `${Number(value).toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%`;
  let controller, revision = 0;
  function render(data) {
    const total = data.totals;
    const kpis = [ ['Verstuurde mails', `${total.minimumOnly ? '≥ ' : ''}${number(total.sent)}`, total.minimumOnly ? 'Minimaal bevestigd in de historie' : 'Bevestigde acquisitiemails'], ['Unieke ontvangers', number(total.contacted), 'Benaderd in deze periode'], ['Ontvangers met reactie', number(total.replied), 'Met bewezen berichtkoppeling'], ['Reactiepercentage', percentage(total.replyRate), 'Van de benaderde ontvangers'], ['Klikpercentage', 'Niet gemeten', 'Tracking nog niet aangesloten'], ['Bevestigde bounces', total.bounces == null ? 'Niet beschikbaar' : number(total.bounces), 'Softora; Instantly nog onbekend'] ];
    document.getElementById('analytics-kpis').innerHTML = kpis.map(([label,value,detail]) => `<article class="analytics-kpi"><span>${escape(label)}</span><strong class="${['Niet gemeten','Niet beschikbaar'].includes(value) ? 'analytics-text-value' : ''}">${escape(value)}</strong><small>${escape(detail)}</small></article>`).join('');
    document.getElementById('analytics-rows').innerHTML = data.rows.length ? data.rows.map(row => `<tr><td>${row.provider === 'instantly' ? 'Instantly' : 'Softora'}</td><td>${escape(row.account)}</td><td>${row.minimumOnly ? '≥ ' : ''}${number(row.sent)}</td><td>${number(row.contacted)}</td><td>${number(row.replied)}</td><td>${percentage(row.replyRate)}</td><td>Niet gemeten</td><td>${row.bounces == null ? 'Niet beschikbaar' : number(row.bounces)}</td></tr>`).join('') : '<tr><td colspan="8" class="analytics-empty">Geen bevestigde acquisitieverzendingen gevonden voor deze selectie.</td></tr>';
    const daily = new Map(data.daily.map(item => [item.date,item])), series = [];
    const lastDate = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Amsterdam', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(data.filters.until));
    const base = Date.parse(`${lastDate}T12:00:00Z`);
    for (let offset = data.filters.days - 1; offset >= 0; offset--) { const date = new Date(base - offset * 86400000).toISOString().slice(0,10); series.push(daily.get(date) || { date, sent:0, replies:0 }); }
    const max = Math.max(1, ...series.map(d => Math.max(d.sent,d.replies)));
    document.getElementById('analytics-chart').innerHTML = series.map((d,index) => `<div class="analytics-day" aria-label="${escape(d.date)}: ${d.sent} verstuurd, ${d.replies} reactieberichten"><div class="analytics-bars" aria-hidden="true"><div class="analytics-bar" style="height:${d.sent/max*130}px" title="${d.sent} verstuurd"></div><div class="analytics-bar reply" style="height:${d.replies/max*130}px" title="${d.replies} reacties"></div></div><time datetime="${escape(d.date)}">${index % Math.ceil(series.length/10) === 0 ? escape(d.date.slice(8))+'/'+escape(d.date.slice(5,7)) : ''}</time></div>`).join('');
    const selected = form.elements.account.value;
    form.elements.account.innerHTML = '<option value="">Alle mailboxen</option>' + data.accounts.map(account => `<option value="${escape(account)}">${escape(account)}</option>`).join('');
    form.elements.account.value = selected;
    document.getElementById('analytics-coverage').textContent = `${total.minimumOnly ? 'Een deel van de berichtgeschiedenis ontbreekt: ≥ betekent minimaal bevestigd; ontbrekende follow-ups worden niet geschat. ' : ''}Reactiepercentages volgen de ontvangers die in deze periode zijn benaderd. De grafiek toont de datum van verzending en ontvangen reactieberichten. Alleen reacties met een berichtkoppeling tellen mee. ${number(total.automaticReplies)} automatische antwoorden apart herkend. Softora-bounces vereisen een bezorgfout met een bewezen ontvanger en verzendmailbox. Instantly-bounces zijn nog niet aangesloten; klikken worden nog niet gemeten.`;
    status.textContent = `Bijgewerkt op ${new Date(data.fetchedAt).toLocaleString('nl-NL', { timeZone:'Europe/Amsterdam' })} · Beschikbare bevestigde historie`;
    results.dataset.ready = 'true'; results.hidden = false;
  }
  async function load() {
    const current = ++revision;
    controller?.abort(); const requestController = new AbortController(); controller = requestController;
    const timer = setTimeout(() => requestController.abort(), 20000);
    results.setAttribute('aria-busy','true'); error.hidden = true; status.textContent = 'Mailhistorie laden…';
    try {
      const query = new URLSearchParams(new FormData(form));
      const response = await fetch(`/api/mailbox/analytics?${query}`, { credentials:'same-origin', signal:requestController.signal, headers:{ Accept:'application/json' } });
      if (response.status === 401 || response.status === 403) throw new Error('Log in met een beheerdersaccount om Analytics te bekijken.');
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Analytics kon niet geladen worden.');
      if (current === revision) render(data);
    } catch (e) {
      if (current !== revision) return;
      results.hidden = true; error.hidden = false; results.dataset.ready = 'false';
      error.textContent = e.name === 'AbortError' ? 'Laden duurt te lang. Probeer opnieuw met Vernieuwen.' : e.message;
      status.textContent = 'Geen actuele cijfers beschikbaar.';
    } finally { clearTimeout(timer); if (current === revision) results.setAttribute('aria-busy','false'); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); load(); });
  form.addEventListener('change', load);
  window.addEventListener('pagehide', () => { revision++; controller?.abort(); });
  load();
}());
