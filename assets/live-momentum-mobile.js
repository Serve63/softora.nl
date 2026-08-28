(() => {
  const mobileQuery = window.matchMedia('(max-width: 900px)');
  const page = document.querySelector('[data-live-momentum-page]');
  const grid = document.querySelector('.habit-grid');
  const habitBoard = document.querySelector('.habit-board');
  const chartViewport = document.querySelector('.bar-chart-viewport');
  const viewButtons = Array.from(document.querySelectorAll('[data-momentum-mobile-view-target]'));
  const dateLabel = document.querySelector('[data-momentum-mobile-date]');
  const scoreRing = document.querySelector('[data-momentum-mobile-score-ring]');
  const scoreValue = document.querySelector('[data-momentum-mobile-score]');
  const completedValue = document.querySelector('[data-momentum-mobile-completed]');
  const message = document.querySelector('[data-momentum-mobile-message]');
  const nextStep = document.querySelector('[data-momentum-mobile-next]');

  if (!page || !grid || !viewButtons.length) return;

  const sections = {
    hero: document.querySelector('.momentum-hero'),
    habits: habitBoard,
    listHeading: document.querySelector('.momentum-mobile-list-heading'),
    endGameHeading: document.querySelector('.end-game-heading'),
    endGameHint: document.querySelector('.end-game-scroll-hint'),
    endGameGoals: document.querySelector('.end-game-goals')
  };

  function getMessage(score, completed, total, noData = false) {
    if (noData) return ['Deze dag staat op geen data en telt niet mee.', 'Klik op de datum om te herstellen.'];
    if (!total || !completed) return ['Kies één doel en zet de dag in beweging.', 'Begin met één.'];
    if (score < 50) return ['De eerste winst staat. Pak nu het volgende doel.', `${total - completed} te gaan.`];
    if (score < 100) return ['Je hebt momentum. Maak de dag nu af.', `${total - completed} te gaan.`];
    return ['Alles afgevinkt. Deze dag is van jou.', 'Dag gewonnen.'];
  }

  function syncSummary() {
    const todayCells = Array.from(grid.querySelectorAll('.status.is-today'));
    const noData = todayCells.some((cell) => cell.classList.contains('is-on-hold'));
    const completed = todayCells.filter((cell) => cell.classList.contains('is-done')).length;
    const total = noData ? 0 : todayCells.length;
    const score = total ? Math.round((completed / total) * 100) : 0;
    const [summaryMessage, summaryNextStep] = getMessage(score, completed, total, noData);

    scoreRing?.style.setProperty('--momentum-mobile-score', `${score * 3.6}deg`);
    scoreRing?.setAttribute('aria-valuenow', String(score));
    if (noData) scoreRing?.setAttribute('aria-valuetext', 'Geen data');
    else scoreRing?.removeAttribute('aria-valuetext');
    if (scoreValue) scoreValue.textContent = noData ? '—' : `${score}%`;
    if (completedValue) completedValue.textContent = noData ? 'Geen data' : `${completed} / ${total}`;
    if (message) message.textContent = summaryMessage;
    if (nextStep) nextStep.textContent = summaryNextStep;
  }

  function focusMonthOnToday() {
    window.requestAnimationFrame(() => {
      const todayHeader = grid.querySelector('.habit-day.is-today');
      const firstColumnWidth = grid.querySelector('.habit-spacer')?.offsetWidth || 0;
      const todayBar = document.querySelector('.bar.is-today')?.closest('.bar-wrap');
      if (todayHeader && habitBoard) {
        habitBoard.scrollLeft = Math.max(0, todayHeader.offsetLeft - firstColumnWidth - 12);
      }
      if (todayBar && chartViewport) {
        chartViewport.scrollLeft = Math.max(
          0,
          todayBar.offsetLeft - (chartViewport.clientWidth / 2) + (todayBar.offsetWidth / 2)
        );
      }
    });
  }

  function syncSectionAccessibility(view) {
    if (!mobileQuery.matches) {
      Object.values(sections).forEach((section) => section?.removeAttribute('aria-hidden'));
      return;
    }
    Object.values(sections).forEach((section) => section?.removeAttribute('aria-hidden'));
    focusMonthOnToday();
  }

  function setView(view) {
    const requestedView = ['today', 'month', 'endgame'].includes(view) ? view : 'today';
    const nextView = mobileQuery.matches ? 'endgame' : requestedView;
    page.dataset.momentumMobileView = nextView;
    viewButtons.forEach((button) => {
      const active = button.dataset.momentumMobileViewTarget === nextView;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    syncSectionAccessibility(nextView);
  }

  viewButtons.forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.momentumMobileViewTarget));
  });
  if (dateLabel) {
    dateLabel.textContent = new Intl.DateTimeFormat('nl-NL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(new Date());
  }

  const gridObserver = new MutationObserver(syncSummary);
  gridObserver.observe(grid, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true
  });

  mobileQuery.addEventListener('change', () => {
    setView(page.dataset.momentumMobileView || 'today');
    syncSummary();
  });

  setView(page.dataset.momentumMobileView || 'today');
  syncSummary();
})();
