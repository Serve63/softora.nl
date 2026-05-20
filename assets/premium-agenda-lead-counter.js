(() => {
  const styleId = 'softora-agenda-lead-counter-style';

  function injectStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .topbar-right{display:flex;align-items:center;justify-content:flex-end;gap:1rem;flex-wrap:wrap}
      .agenda-lead-counter{min-width:220px;padding:.72rem .85rem;border:1px solid var(--border);background:var(--bg-secondary);opacity:0;transform:translateY(15px);animation:fadeUp .5s var(--ease-out-expo) .08s forwards}
      .agenda-lead-counter-label{font-family:'Oswald',sans-serif;font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--text-tertiary);margin-bottom:.45rem}
      .agenda-lead-counter-row{display:flex;align-items:center;justify-content:space-between;gap:.9rem;font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.08em;line-height:1.1}
      .agenda-lead-counter-row+.agenda-lead-counter-row{margin-top:.32rem}
      .agenda-lead-counter-name{font-size:.82rem;font-weight:700;color:var(--text-primary)}
      .agenda-lead-counter-count{font-size:.78rem;font-weight:700;color:var(--text-secondary);white-space:nowrap}
      .agenda-lead-counter-row.is-leading .agenda-lead-counter-name,.agenda-lead-counter-row.is-leading .agenda-lead-counter-count{color:var(--accent-light)}
      @media (max-width:768px){.topbar-right{width:100%;justify-content:flex-start}.agenda-lead-counter{width:100%;min-width:0}}
    `;
    document.head.appendChild(style);
  }

  function ensureCounterRows() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return null;
    let monthNav = Array.from(topbar.children).find((child) => child.classList?.contains('month-nav'));
    let wrap = Array.from(topbar.children).find((child) => child.classList?.contains('topbar-right'));
    if (!wrap) {
      if (!monthNav) return null;
      wrap = document.createElement('div');
      wrap.className = 'topbar-right';
      topbar.insertBefore(wrap, monthNav);
      wrap.appendChild(monthNav);
    } else if (!monthNav) {
      monthNav = wrap.querySelector('.month-nav');
    }
    let counter = document.getElementById('agendaLeadCounter');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'agenda-lead-counter';
      counter.id = 'agendaLeadCounter';
      counter.setAttribute('aria-label', 'Leadstand in agenda');
      counter.innerHTML = '<div class="agenda-lead-counter-label">Leadstand</div><div id="agendaLeadCounterRows"></div>';
      wrap.insertBefore(counter, monthNav || null);
    }
    return counter.querySelector('#agendaLeadCounterRows');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeLeadOwnerKey(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (normalized.includes('martijn')) return 'martijn';
    if (normalized.includes('serve')) return 'serve';
    return '';
  }

  function resolveLeadOwnerKey(appointment) {
    if (!appointment || typeof appointment !== 'object') return '';
    return normalizeLeadOwnerKey(
      appointment.leadOwnerKey ||
      appointment.manualLeadOwnerKey ||
      appointment.leadOwnerName ||
      appointment.leadOwnerFullName ||
      appointment.manualLeadOwnerName ||
      ''
    );
  }

  function getAppointments() {
    const source = window.SoftoraAgendaLeadCounterSource;
    if (typeof source !== 'function') return [];
    const appointments = source();
    return Array.isArray(appointments) ? appointments : [];
  }

  function renderLeadCounter(appointments = getAppointments()) {
    injectStyles();
    const rows = ensureCounterRows();
    if (!rows) return;
    const counts = appointments.reduce((result, appointment) => {
      const key = resolveLeadOwnerKey(appointment);
      if (key === 'serve' || key === 'martijn') result[key] += 1;
      return result;
    }, { serve: 0, martijn: 0 });
    const entries = [
      { key: 'serve', label: 'Servé', count: counts.serve },
      { key: 'martijn', label: 'Martijn', count: counts.martijn },
    ].sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.key === 'serve' ? -1 : 1;
    });

    rows.innerHTML = entries.map((entry, index) => `
      <div class="agenda-lead-counter-row${index === 0 && entry.count > 0 ? ' is-leading' : ''}">
        <span class="agenda-lead-counter-name">${escapeHtml(entry.label)}</span>
        <span class="agenda-lead-counter-count">${entry.count} ${entry.count === 1 ? 'lead' : 'leads'}</span>
      </div>
    `).join('');
  }

  window.SoftoraAgendaLeadCounter = {
    render: renderLeadCounter,
    resolveLeadOwnerKey,
  };

  document.addEventListener('softora:agenda-rendered', () => renderLeadCounter());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderLeadCounter(), { once: true });
  } else {
    renderLeadCounter();
  }
})();
