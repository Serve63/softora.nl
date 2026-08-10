(() => {
  'use strict';

  const baseDataset = window.TRANSFERWERELD_DATA;
  const scopeDataset = window.TRANSFERWERELD_SCOPE_DATA;
  const dataset = window.TransferwereldScope?.buildScopedDataset(baseDataset, scopeDataset) || baseDataset;
  if (!dataset?.clubs?.length) {
    document.querySelector('main').insertAdjacentHTML('beforeend', '<p class="empty">De transferdata wordt nog opgebouwd. Ververs de pagina over een moment.</p>');
    return;
  }

  const ROLE_ORDER = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'CF'];
  const scopeLeagues = Array.isArray(dataset.scopeLeagues) && dataset.scopeLeagues.length ? dataset.scopeLeagues : dataset.leagues;
  const state = { transferLimit: 80 };

  function formatMoney(value, compact = true) {
    if (!Number.isFinite(value) || value === 0) return '€0';
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency', currency: 'EUR', notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
    }).format(value);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function sum(items, key) {
    return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
  }

  function crestInitials(name) {
    const words = String(name || 'Club').match(/[\p{L}\p{N}]+/gu) || ['C'];
    return words.length > 1
      ? `${words[0][0]}${words[1][0]}`.toUpperCase()
      : words[0].slice(0, 2).toUpperCase();
  }

  function crestMarkup(club, name, className) {
    const shellClass = className === 'crest' ? 'crest-shell' : 'route-crest-shell';
    const initials = escapeHtml(crestInitials(name));
    const badge = club?.badge
      ? `<img class="${className}" src="${escapeHtml(club.badge)}" alt="" loading="lazy" onerror="this.remove()">`
      : '';
    return `<span class="${shellClass}" aria-hidden="true"><span class="${className} ${className}-fallback">${initials}</span>${badge}</span>`;
  }

  function roleFor(position) {
    const value = normalize(position).replace(/[–—]/g, '-');
    if (/goalkeeper|goalie|keeper|portero|torwart|gardien|portiere|doelman|arquero|goleiro/.test(value)) return 'GK';
    if (/centre-back|center-back|central defender|defensa central|innenverteidiger|centrale verdediger|defenseur central|difensore centrale|zentrale/.test(value)) return 'CB';
    if (/left-back|left wing-back|lateral izquierdo|linker verteidiger|linksback|lateral esquerdo|terzino sinistro|defenseur gauche/.test(value)) return 'LB';
    if (/right-back|right wing-back|lateral derecho|rechter verteidiger|rechtsback|lateral direito|terzino destro|defenseur droit/.test(value)) return 'RB';
    if (/defensive midfield|defensive midfielder|defensives mittelfeld|controlerende middenvelder|pivote|pivo|milieu defensif|mediano|volante defensivo|meio-campista defensivo/.test(value)) return 'DM';
    if (/central midfield|central midfielder|zentrales mittelfeld|mediocentro$|centrale middenvelder|milieu central|centrocampista central|meio-campista central/.test(value)) return 'CM';
    if (/attacking midfield|attacking midfielder|offensive midfield|offensives mittelfeld|mediocentro ofensivo|aanvallende middenvelder|milieu offensif|trequartista|mezzala/.test(value)) return 'AM';
    if (/left winger|left midfield|linksau(s|ß)en|linksaussen|extremo izquierdo|extremo esquerdo|linksbuiten|ailier gauche|ala sinistra/.test(value)) return 'LW';
    if (/right winger|right midfield|rechtsau(s|ß)en|rechtsaussen|extremo derecho|extremo direito|rechtsbuiten|ailier droit|ala destra/.test(value)) return 'RW';
    if (/centre-forward|center-forward|striker|centre avant|delantero centro|mittelsturmer|spits|buteur|punta|avancado|centroavante|second striker|hangende spitze/.test(value)) return 'CF';
    return null;
  }

  function depthAnalysis(club) {
    const squad = Array.isArray(club.squad) ? club.squad : [];
    const squadValue = sum(squad, 'marketValueNumber');
    const threshold = Math.max(1_000_000, squadValue * .018);
    const roles = Object.fromEntries(ROLE_ORDER.map((role) => [role, []]));
    squad.forEach((player) => {
      const role = roleFor(player.position);
      if (role) roles[role].push(player);
    });
    Object.values(roles).forEach((players) => players.sort((left, right) => right.marketValueNumber - left.marketValueNumber));
    const roleScores = ROLE_ORDER.map((role) => {
      const players = roles[role];
      if (!players.length) return 0;
      if (players.length === 1) return Math.min(.48, (players[0].marketValueNumber / threshold) * .38);
      return Math.min(1, players[1].marketValueNumber / threshold);
    });
    const score = Math.round(roleScores.reduce((total, value) => total + value, 0) / ROLE_ORDER.length * 100);
    return { roles, threshold, score, squadValue, available: squad.length >= 16 };
  }

  const clubs = dataset.clubs.map((club) => {
    const spend = sum(club.arrivals || [], 'feeValue');
    const income = sum(club.departures || [], 'feeValue');
    const depth = depthAnalysis(club);
    const valueScale = Math.max(15_000_000, depth.squadValue * .08);
    const investment = (spend - income) / valueScale * 25;
    const movement = ((club.arrivals?.length || 0) - (club.departures?.length || 0)) * 2.3;
    const depthAdjustment = depth.available ? (depth.score - 50) * .14 : 0;
    const impactScore = Math.max(-100, Math.min(100, Math.round(investment + movement + depthAdjustment)));
    const injuryValue = Number(club.context?.injuryValue) || 0;
    const injuryBurden = depth.squadValue ? injuryValue / depth.squadValue : 0;
    return { ...club, spend, income, netSpend: spend - income, depth, impactScore, injuryBurden };
  });

  const deals = window.TransferwereldDeals?.buildUniqueDeals(clubs) || [];
  const rumours = clubs.flatMap((club) => (club.rumours || []).map((rumour) => ({ ...rumour, club })))
    .sort((left, right) => right.probability - left.probability);

  function setHeroStats() {
    const totalSpent = clubs.reduce((total, club) => total + club.spend, 0);
    const transferCoverage = clubs.filter((club) => (club.arrivals?.length || 0) + (club.departures?.length || 0) > 0).length;
    const squadCoverage = clubs.filter((club) => club.depth.available).length;
    document.querySelector('[data-stat="moves"]').textContent = deals.length.toLocaleString('nl-NL');
    document.querySelector('[data-stat="spent"]').textContent = formatMoney(totalSpent);
    document.querySelector('[data-stat="rumours"]').textContent = rumours.length.toLocaleString('nl-NL');
    document.querySelector('[data-meta-coverage]').textContent = `· ${transferCoverage}/${clubs.length} transfers · ${squadCoverage}/${clubs.length} selecties · ${scopeLeagues.length} competities in scope`;
    const fetched = new Date(dataset.meta.transfersFetchedAt);
    if (!Number.isNaN(fetched.valueOf())) {
      document.querySelector('[data-meta-date]').textContent = fetched.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }

  function setupTabs() {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    function activate(tab, updateHash = true) {
      tabs.forEach((item) => {
        const active = item === tab;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
        document.querySelector(`[data-panel="${item.dataset.tab}"]`).hidden = !active;
      });
      if (updateHash) history.replaceState(null, '', `#${tab.dataset.tab}`);
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let target = index;
        if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') target = 0;
        if (event.key === 'End') target = tabs.length - 1;
        activate(tabs[target]);
        tabs[target].focus();
      });
    });
    const requested = location.hash.slice(1);
    const requestedTab = tabs.find((tab) => tab.dataset.tab === requested);
    if (requestedTab) activate(requestedTab, false);
  }

  function clubCell(club) {
    const rank = Number(club.rank) > 0 && Number(club.rank) < 10000 ? `#${club.rank} wereldwijd` : 'wereldrang niet beschikbaar';
    const meta = [club.country, club.league].filter(Boolean).join(' · ');
    return `<div class="club-cell">${crestMarkup(club, club.name, 'crest')}<div><strong>${escapeHtml(club.name)}</strong><small>${escapeHtml(meta)}${meta ? ' · ' : ''}${escapeHtml(rank)}</small></div></div>`;
  }

  function routeClub(name, club, label) {
    return `<div class="route-club">${crestMarkup(club, name, 'route-crest')}<div><small>${label}</small><strong>${escapeHtml(name || 'Onbekend')}</strong></div></div>`;
  }

  function dealTypeLabel(kind) {
    return ({ transfer: 'Transfer', loan: 'Huur', return: 'Huurreturn', free: 'Transfervrij' })[kind] || 'Transfer';
  }

  function dealFee(deal) {
    if (deal.feeValue > 0) return formatMoney(deal.feeValue);
    if (deal.kind === 'free') return 'Transfervrij';
    if (deal.kind === 'loan') return 'Huur';
    if (deal.kind === 'return') return 'Einde huur';
    return deal.fee || 'Onbekend';
  }

  function setupTransferList() {
    document.querySelector('#transfer-more').addEventListener('click', () => {
      state.transferLimit += 100;
      renderTransfers();
    });
  }

  function filteredTransfers() {
    return [...deals].sort((left, right) => right.feeValue - left.feeValue || left.rank - right.rank);
  }

  function renderTransfers() {
    const filtered = filteredTransfers();
    const visible = filtered.slice(0, state.transferLimit);
    document.querySelector('#transfer-list').innerHTML = visible.length ? visible.map((deal, index) => `
      <article class="transfer-row">
        <span class="rank-num">${String(index + 1).padStart(2, '0')}</span>
        <div class="player-cell"><strong>${escapeHtml(deal.player)}</strong><small>${escapeHtml(deal.position)}${deal.age ? ` · ${deal.age}` : ''}</small></div>
        <div class="deal-route">
          ${routeClub(deal.sourceName, deal.sourceClub, 'Van')}
          <span class="route-arrow" aria-hidden="true">→</span>
          ${routeClub(deal.destinationName, deal.destinationClub, 'Naar')}
        </div>
        <span class="deal-type ${deal.kind}">${dealTypeLabel(deal.kind)}</span>
        <div class="fee">${escapeHtml(dealFee(deal))}</div>
      </article>`).join('') : '<p class="empty">Geen transfers gevonden.</p>';
    document.querySelector('#transfer-more').hidden = visible.length >= filtered.length;
  }

  function renderMoneyRanking(target, key, secondaryKey) {
    const sorted = [...clubs].sort((left, right) => right[key] - left[key]);
    const max = Math.max(...sorted.map((club) => club[key]), 1);
    document.querySelector(target).innerHTML = sorted.map((club, index) => `
      <article class="ranking-row" style="--width:${Math.max(1, club[key] / max * 100).toFixed(1)}%">
        <span class="position">${String(index + 1).padStart(2, '0')}</span>
        ${clubCell(club)}
        <div class="bar" aria-hidden="true"><i style="--width:${(club[key] / max * 100).toFixed(1)}%"></i></div>
        <div class="amount">${formatMoney(club[key])}</div>
        <div class="substat">${secondaryKey === 'income' ? 'verdiend' : 'uitgegeven'} ${formatMoney(club[secondaryKey])}</div>
      </article>`).join('');
  }

  function renderRumours() {
    const minimum = Number(document.querySelector('#rumour-probability').value);
    const query = normalize(document.querySelector('#rumour-search').value.trim());
    document.querySelector('#rumour-output').textContent = `${minimum}%`;
    const filtered = rumours.filter((rumour) => rumour.probability >= minimum && (!query || normalize(`${rumour.player} ${rumour.club.name} ${rumour.currentClub}`).includes(query)));
    document.querySelector('#rumour-list').innerHTML = filtered.length ? `
      <div class="rumour-list-head" aria-hidden="true"><span>#</span><span>Speler</span><span>Betrokken clubs</span><span>Kans</span><span>Waarde</span><span>Bron</span></div>
      ${filtered.map((rumour, index) => {
        const currentClub = rumour.currentClub || 'Huidige club onbekend';
        const sameClub = normalize(currentClub) === normalize(rumour.club.name);
        const route = sameClub ? rumour.club.name : `${currentClub} → ${rumour.club.name}`;
        return `<article class="rumour-row">
          <span class="rumour-index">${String(index + 1).padStart(2, '0')}</span>
          <div class="rumour-player"><strong>${escapeHtml(rumour.player)}</strong><small>Gerucht</small></div>
          <div class="rumour-route">${escapeHtml(route)}</div>
          <span class="rumour-chance">${rumour.probability}%</span>
          <span class="rumour-value">${escapeHtml(rumour.marketValue || 'Onbekend')}</span>
          ${rumour.source ? `<a class="rumour-source" href="${escapeHtml(rumour.source)}" target="_blank" rel="noopener noreferrer">Bekijk ↗</a>` : `<span class="rumour-updated">${escapeHtml(rumour.updated || '—')}</span>`}
        </article>`;
      }).join('')}` : '<p class="empty">Geen geruchten boven deze waarschijnlijkheid gevonden.</p>';
  }

  function impactLabel(score) {
    if (score >= 25) return 'Sterk versterkt';
    if (score >= 8) return 'Versterkt';
    if (score <= -25) return 'Sterk verzwakt';
    if (score <= -8) return 'Verzwakt';
    return 'Vrij stabiel';
  }

  function renderImpact() {
    const sorted = [...clubs].sort((left, right) => right.impactScore - left.impactScore);
    const max = Math.max(...sorted.map((club) => Math.abs(club.impactScore)), 1);
    document.querySelector('#impact-ranking').innerHTML = sorted.map((club, index) => {
      const negative = club.impactScore < -7;
      return `<article class="ranking-row ${negative ? 'negative' : ''}" style="--width:${Math.abs(club.impactScore) / max * 100}%">
        <span class="position">${String(index + 1).padStart(2, '0')}</span>
        ${clubCell(club)}
        <div class="bar"><i style="--width:${Math.abs(club.impactScore) / max * 100}%;background:${negative ? 'var(--red)' : 'var(--acid)'}"></i></div>
        <div class="amount">${club.impactScore > 0 ? '+' : ''}${club.impactScore}</div>
        <div class="substat">${impactLabel(club.impactScore)} · netto ${formatMoney(club.netSpend)} · ${club.context?.injuries?.length || 0} afwezig</div>
      </article>`;
    }).join('');
  }

  function setupDialog() {
    const dialog = document.querySelector('#method-dialog');
    document.querySelector('#method-button').addEventListener('click', () => dialog.showModal());
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  setHeroStats();
  setupTabs();
  setupTransferList();
  renderTransfers();
  renderMoneyRanking('#spend-ranking', 'spend', 'income');
  renderMoneyRanking('#income-ranking', 'income', 'spend');
  document.querySelector('#rumour-probability').addEventListener('input', renderRumours);
  document.querySelector('#rumour-search').addEventListener('input', renderRumours);
  renderRumours();
  renderImpact();
  setupDialog();
})();
