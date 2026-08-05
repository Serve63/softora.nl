(() => {
  'use strict';

  const baseDataset = window.TRANSFERWERELD_DATA;
  const scopeDataset = window.TRANSFERWERELD_SCOPE_DATA;
  const dataset = scopeDataset?.clubs?.length
    ? {
      ...baseDataset,
      clubs: [...(baseDataset.clubs || []), ...scopeDataset.clubs],
      scopeLeagues: scopeDataset.scopeLeagues || baseDataset.scopeLeagues,
    }
    : baseDataset;
  if (!dataset?.clubs?.length) {
    document.querySelector('main').insertAdjacentHTML('beforeend', '<p class="empty">De transferdata wordt nog opgebouwd. Ververs de pagina over een moment.</p>');
    return;
  }

  const ROLE_LABELS = {
    GK: 'Keeper', CB: 'Centrale verdediger', LB: 'Linksback', RB: 'Rechtsback',
    DM: 'Controlerende middenvelder', CM: 'Centrale middenvelder', AM: 'Aanvallende middenvelder',
    LW: 'Linksbuiten', RW: 'Rechtsbuiten', CF: 'Spits',
  };
  const ROLE_ORDER = Object.keys(ROLE_LABELS);
  const scopeLeagues = Array.isArray(dataset.scopeLeagues) && dataset.scopeLeagues.length ? dataset.scopeLeagues : dataset.leagues;
  const state = { transferLimit: 80, depthClub: dataset.clubs[0]?.name };

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

  const clubByName = new Map(clubs.map((club) => [normalize(club.name), club]));
  const clubByTransfermarktId = new Map(clubs.map((club) => [Number(club.transfermarkt?.id), club]));
  const transfers = clubs.flatMap((club) => [
    ...(club.arrivals || []).map((transfer) => ({ ...transfer, club })),
    ...(club.departures || []).map((transfer) => ({ ...transfer, club })),
  ]);
  const rumours = clubs.flatMap((club) => (club.rumours || []).map((rumour) => ({ ...rumour, club })))
    .sort((left, right) => right.probability - left.probability);

  function setHeroStats() {
    const totalSpent = clubs.reduce((total, club) => total + club.spend, 0);
    const transferCoverage = clubs.filter((club) => (club.arrivals?.length || 0) + (club.departures?.length || 0) > 0).length;
    const squadCoverage = clubs.filter((club) => club.depth.available).length;
    document.querySelector('[data-stat="moves"]').textContent = transfers.length.toLocaleString('nl-NL');
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
    const rank = Number(club.rank) > 0 && Number(club.rank) < 10000 ? `#${club.rank} wereldwijd` : 'geen wereldrang';
    const meta = [club.country, club.league].filter(Boolean).join(' · ');
    return `<div class="club-cell"><img class="crest" src="${escapeHtml(club.badge)}" alt="" loading="lazy" onerror="this.hidden=true"><div><strong>${escapeHtml(club.name)}</strong><small>${escapeHtml(meta)}${meta ? ' · ' : ''}${escapeHtml(rank)}</small></div></div>`;
  }

  function populateTransferFilters() {
    const competitions = [...new Set(clubs.map((club) => club.league).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    const countries = [...new Set(clubs.map((club) => club.country))].sort((left, right) => left.localeCompare(right));
    document.querySelector('#transfer-competition').insertAdjacentHTML('beforeend', competitions.map((competition) => `<option value="${escapeHtml(competition)}">${escapeHtml(competition)}</option>`).join(''));
    document.querySelector('#transfer-country').insertAdjacentHTML('beforeend', countries.map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join(''));
    document.querySelectorAll('#transfer-filters input, #transfer-filters select').forEach((control) => control.addEventListener('input', () => {
      state.transferLimit = 80;
      renderTransfers();
    }));
    document.querySelector('#transfer-more').addEventListener('click', () => {
      state.transferLimit += 100;
      renderTransfers();
    });
  }

  function filteredTransfers() {
    const query = normalize(document.querySelector('#transfer-search').value.trim());
    const direction = document.querySelector('#transfer-direction').value;
    const competition = document.querySelector('#transfer-competition').value;
    const country = document.querySelector('#transfer-country').value;
    const sort = document.querySelector('#transfer-sort').value;
    const filtered = transfers.filter((transfer) => {
      if (direction !== 'all' && transfer.direction !== direction) return false;
      if (competition !== 'all' && transfer.club.league !== competition) return false;
      if (country !== 'all' && transfer.club.country !== country) return false;
      if (!query) return true;
      return [transfer.player, transfer.club.name, transfer.counterpart, transfer.position].some((value) => normalize(value).includes(query));
    });
    filtered.sort((left, right) => {
      if (sort === 'fee') return right.feeValue - left.feeValue || left.club.rank - right.club.rank;
      if (sort === 'club') return left.club.name.localeCompare(right.club.name) || right.feeValue - left.feeValue;
      return left.club.rank - right.club.rank || (left.direction === 'in' ? -1 : 1) || right.feeValue - left.feeValue;
    });
    return filtered;
  }

  function renderTransfers() {
    const filtered = filteredTransfers();
    const visible = filtered.slice(0, state.transferLimit);
    document.querySelector('#transfer-summary').innerHTML = `<span><strong>${filtered.length.toLocaleString('nl-NL')}</strong> bewegingen gevonden</span><span>${Math.min(visible.length, filtered.length)} zichtbaar</span>`;
    document.querySelector('#transfer-list').innerHTML = visible.length ? visible.map((transfer) => `
      <article class="transfer-row">
        <span class="rank-num">${Number(transfer.club.rank) < 10000 ? String(transfer.club.rank).padStart(2, '0') : '—'}</span>
        ${clubCell(transfer.club)}
        <div class="player-cell"><strong>${escapeHtml(transfer.player)}</strong><small>${escapeHtml(transfer.position)}${transfer.age ? ` · ${transfer.age}` : ''}</small></div>
        <span class="direction ${transfer.direction === 'out' ? 'out' : ''}">${transfer.direction === 'in' ? 'In' : 'Uit'}</span>
        <div class="counterpart"><small>${transfer.direction === 'in' ? 'Van' : 'Naar'}</small>${escapeHtml(transfer.counterpart || 'Onbekend')}</div>
        <div class="fee">${escapeHtml(transfer.fee)}</div>
      </article>`).join('') : '<p class="empty">Geen transfers gevonden met deze filters.</p>';
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
    document.querySelector('#rumour-grid').innerHTML = filtered.length ? filtered.map((rumour) => `
      <article class="rumour-card" data-chance="${rumour.probability}">
        <div class="rumour-top"><span class="direction">Gerucht</span><span class="chance">${rumour.probability}%</span></div>
        <h3>${escapeHtml(rumour.player)}</h3>
        <p class="rumour-route">${escapeHtml(rumour.currentClub || 'Huidige club onbekend')} → <strong>${escapeHtml(rumour.club.name)}</strong></p>
        <div class="rumour-meta"><span>${escapeHtml(rumour.marketValue || 'Waarde onbekend')}</span>${rumour.source ? `<a href="${escapeHtml(rumour.source)}" target="_blank" rel="noopener noreferrer">Bekijk signaal ↗</a>` : `<span>${escapeHtml(rumour.updated)}</span>`}</div>
      </article>`).join('') : '<p class="empty">Geen geruchten boven deze waarschijnlijkheid gevonden.</p>';
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

  function setupDepth() {
    const select = document.querySelector('#depth-club');
    const coveredClubs = clubs.filter((club) => club.depth.available);
    if (!coveredClubs.some((club) => club.name === state.depthClub)) state.depthClub = coveredClubs[0]?.name;
    select.innerHTML = coveredClubs.map((club) => `<option value="${escapeHtml(club.name)}">${Number(club.rank) < 10000 ? `#${club.rank} ` : ''}${escapeHtml(club.name)}</option>`).join('');
    select.addEventListener('change', () => {
      state.depthClub = select.value;
      renderDepthDetail();
    });
    const ranked = [...coveredClubs].sort((left, right) => right.depth.score - left.depth.score);
    document.querySelector('#depth-leaderboard').innerHTML = ranked.map((club, index) => `<div class="mini-row"><span>${index + 1}</span><button type="button" data-depth-club="${escapeHtml(club.name)}">${escapeHtml(club.name)}</button><strong>${club.depth.score}%</strong></div>`).join('');
    document.querySelectorAll('[data-depth-club]').forEach((button) => button.addEventListener('click', () => {
      state.depthClub = button.dataset.depthClub;
      select.value = state.depthClub;
      renderDepthDetail();
    }));
    renderDepthDetail();
  }

  function renderDepthDetail() {
    const club = clubs.find((item) => item.name === state.depthClub) || clubs[0];
    const roles = ROLE_ORDER.map((role) => {
      const players = club.depth.roles[role].slice(0, 2);
      const good = players.length >= 2 && players[1].marketValueNumber >= club.depth.threshold;
      return `<article class="role-card ${good ? 'good' : 'weak'}"><div class="role-head"><div><span class="role-code">${role}</span><small>${ROLE_LABELS[role]}</small></div><span class="role-status" title="${good ? 'Dubbel op niveau' : 'Nog niet dubbel op niveau'}"></span></div>${players.length ? players.map((player) => `<div class="role-player"><span>${escapeHtml(player.player)}</span><span>${formatMoney(player.marketValueNumber)}</span></div>`).join('') : '<small>Geen primaire speler</small>'}</article>`;
    }).join('');
    const coach = club.context?.coach?.name ? `Trainer ${escapeHtml(club.context.coach.name)}` : 'Trainer onbekend';
    document.querySelector('#depth-detail').innerHTML = `<div class="depth-summary"><div><p class="eyebrow">#${club.rank} wereldwijd</p><h3>${escapeHtml(club.name)}</h3><small>Drempel tweede speler: ${formatMoney(club.depth.threshold)} · ${coach} · ${club.context?.injuries?.length || 0} afwezig</small></div><div class="depth-score">${club.depth.score}<small>/100</small></div></div><div class="role-grid">${roles}</div>`;
  }

  function forecastScore(team, league) {
    const club = clubByTransfermarktId.get(Number(team.transfermarktId)) || clubByName.get(normalize(team.name));
    const base = team.rating * .68 + team.seasonAverageRating * .22 + team.lastWeekRating * .10;
    const transferModifier = club ? Math.max(-2.5, Math.min(2.5, club.impactScore / 40)) : 0;
    const depthModifier = club?.depth.available ? Math.max(-1.2, Math.min(1.2, (club.depth.score - 55) / 37.5)) : 0;
    const progress = Math.min(1, (Number(team.played) || 0) / 12);
    const standingScale = league.teams.length > 1 ? .5 - ((Number(team.standingPosition) || league.teams.length) - 1) / (league.teams.length - 1) : 0;
    const standingModifier = standingScale * 2.4 * progress;
    const injuryModifier = club ? -Math.min(1.8, club.injuryBurden * 7) : 0;
    const recentMatches = Number(club?.context?.recentMatches) || 0;
    const recentPpg = recentMatches ? Number(club.context.recentFormPoints) / recentMatches : 1.5;
    const formModifier = recentMatches >= 3 ? Math.max(-.8, Math.min(.8, (recentPpg - 1.5) * .55)) : 0;
    const fixtureModifier = club ? -Math.max(-.5, Math.min(.5, (Number(club.context?.fixtureDifficulty) || 0) / 12)) : 0;
    const tenure = Number(club?.context?.coachTenureDays);
    const coachModifier = Number.isFinite(tenure) ? (tenure < 60 ? -.25 : (tenure < 120 ? -.1 : (tenure > 730 ? .12 : 0))) : 0;
    return {
      score: base + transferModifier + depthModifier + standingModifier + injuryModifier + formModifier + fixtureModifier + coachModifier,
      club,
    };
  }

  function renderForecasts() {
    document.querySelector('#forecast-grid').innerHTML = scopeLeagues.map((league) => {
      const ranked = league.teams.map((team) => ({ ...team, ...forecastScore(team, league) })).sort((left, right) => right.score - left.score);
      const maxScore = ranked[0]?.score || 0;
      const weights = ranked.map((team) => Math.exp((team.score - maxScore) * .78));
      const weightTotal = weights.reduce((total, value) => total + value, 0);
      const rows = ranked.slice(0, 7).map((team, index) => {
        const chance = Math.round(weights[index] / weightTotal * 100);
        const context = [];
        if (team.played > 0) context.push(`#${team.standingPosition} · ${team.points} pt/${team.played}`);
        if (team.club?.context?.injuries?.length) context.push(`${team.club.context.injuries.length} afwezig`);
        if (team.club?.context?.coach?.name) context.push(team.club.context.coach.name);
        const displayName = team.club?.name || team.name;
        return `<div class="forecast-row"><span class="forecast-rank">${index + 1}</span><strong><span>${escapeHtml(displayName)}${team.club?.isTop100 ? '<span class="top100-chip">T100</span>' : ''}</span>${context.length ? `<small>${escapeHtml(context.join(' · '))}</small>` : ''}</strong><span class="model">${team.score.toFixed(1)}</span><span class="chance">${index === 0 ? `${chance}% kampioen` : `${chance}%`}</span></div>`;
      }).join('');
      return `<article class="forecast-card"><div class="forecast-head"><h3>${escapeHtml(league.name)}</h3><span>${escapeHtml(league.country)} · ${league.teams.length} clubs</span></div>${rows}</article>`;
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
  populateTransferFilters();
  renderTransfers();
  renderMoneyRanking('#spend-ranking', 'spend', 'income');
  renderMoneyRanking('#income-ranking', 'income', 'spend');
  document.querySelector('#rumour-probability').addEventListener('input', renderRumours);
  document.querySelector('#rumour-search').addEventListener('input', renderRumours);
  renderRumours();
  renderImpact();
  setupDepth();
  renderForecasts();
  setupDialog();
})();
