(() => {
  const numberFormat = new Intl.NumberFormat('nl-NL');
  const elements = {
    treated: document.getElementById('companies-treated-last60'),
    usable: document.getElementById('companies-usable-last60'),
    withWebsite: document.getElementById('companies-with-website-last60'),
    withoutWebsite: document.getElementById('companies-without-website-last60'),
    unusableGrade1: document.getElementById('companies-unusable-grade-1'),
    unusableGrade2: document.getElementById('companies-unusable-grade-2'),
    unusableGrade3: document.getElementById('companies-unusable-grade-3'),
    unusableGrade1Last60: document.getElementById('companies-unusable-grade-1-last60'),
    unusableGrade2Last60: document.getElementById('companies-unusable-grade-2-last60'),
    unusableGrade3Last60: document.getElementById('companies-unusable-grade-3-last60'),
  };

  function getActiveState() {
    try {
      if (typeof activeSnapshot === 'undefined') return null;
      return activeSnapshot && typeof activeSnapshot.state === 'object'
        ? activeSnapshot.state
        : null;
    } catch {
      return null;
    }
  }

  function renderLast60Delta(element, value) {
    if (!element) return;
    const count = Math.max(0, Number(value || 0));
    element.innerHTML = `<span class="stat-delta-number">+${numberFormat.format(count)}</span> <span class="stat-delta-label">laatste 60 min</span>`;
    element.classList.toggle('is-zero', count === 0);
  }

  function renderUnusableGradeLast60(element, activity, fallbackAdded = 0, showRemoved = true) {
    if (!element) return;
    const added = Math.max(0, Number(activity?.added ?? fallbackAdded ?? 0));
    const removed = Math.max(0, Number(activity?.removed ?? 0));
    const removedMarkup = showRemoved
      ? `<span class="unusable-grade-delta-removed">-${numberFormat.format(removed)}</span>`
      : '';
    element.innerHTML = `
      <span class="unusable-grade-delta-values">
        <span class="unusable-grade-delta-added">+${numberFormat.format(added)}</span>
        ${removedMarkup}
      </span>
      <span class="unusable-grade-delta-label">laatste 60 min</span>
    `;
  }

  function renderMetrics() {
    const scraperState = getActiveState();
    if (!scraperState) return;
    const last60 = scraperState.last_60_minutes || {};
    const unusableGrades = scraperState.unusable_grades || {};
    const unusableGradeLast60 = last60.unusable_grades || {};
    const unusableGradeActivity = last60.unusable_grade_activity || {};

    renderLast60Delta(elements.treated, last60.treated);
    renderLast60Delta(elements.usable, last60.usable);
    renderLast60Delta(elements.withWebsite, last60.with_website);
    renderLast60Delta(elements.withoutWebsite, last60.without_website);

    elements.unusableGrade1.textContent = numberFormat.format(Number(unusableGrades['1'] || 0));
    elements.unusableGrade2.textContent = numberFormat.format(Number(unusableGrades['2'] || 0));
    elements.unusableGrade3.textContent = numberFormat.format(Number(unusableGrades['3'] || 0));
    renderUnusableGradeLast60(
      elements.unusableGrade1Last60,
      unusableGradeActivity['1'],
      unusableGradeLast60['1'],
    );
    renderUnusableGradeLast60(
      elements.unusableGrade2Last60,
      unusableGradeActivity['2'],
      unusableGradeLast60['2'],
    );
    renderUnusableGradeLast60(
      elements.unusableGrade3Last60,
      unusableGradeActivity['3'],
      unusableGradeLast60['3'],
      false,
    );
  }

  renderMetrics();
  window.setInterval(renderMetrics, 1000);
  window.addEventListener('focus', renderMetrics);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderMetrics();
  });
})();
