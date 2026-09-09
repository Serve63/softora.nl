(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraKvkLocationProgress = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function count(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function percentage(completed, total) {
    if (completed === null || total === null || total <= 0 || completed > total) return null;
    return completed === total ? 100 : Math.min(99, Math.round(completed / total * 100));
  }

  function getProgress(location, flags = {}) {
    const progress = location && location.stage_progress;
    const total = count(progress && progress.total);
    const researched = count(progress && progress.researched);
    const reviewed = count(progress && progress.reviewed);
    const valid = total !== null && total > 0 && researched !== null && reviewed !== null
      && reviewed <= researched && researched <= total;
    let stage;
    let completed = null;
    if (!flags.kvkComplete || flags.kvkLimited) {
      stage = 'KVK';
    } else if (valid) {
      stage = researched < total ? 'Onderzoek' : reviewed < total ? 'Controle' : 'Afgerond';
      completed = stage === 'Onderzoek' ? researched : reviewed;
    } else {
      stage = flags.reviewComplete ? 'Afgerond' : flags.researchComplete ? 'Controle' : 'Onderzoek';
    }
    return {
      stage,
      completed,
      total: valid ? total : null,
      percent: completed !== null ? percentage(completed, total) : stage === 'Afgerond' ? 100 : null,
      updatedAt: progress && typeof progress.updated_at === 'string' ? progress.updated_at : '',
    };
  }

  function completionFlags(location, flags = {}) {
    const progress = getProgress(location, flags);
    if (progress.completed === null) return flags;
    return {
      ...flags,
      researchComplete: progress.stage !== 'Onderzoek',
      reviewComplete: progress.stage === 'Afgerond',
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function render(location, flags) {
    const progress = getProgress(location, flags);
    const percent = progress.percent === null ? '—' : `${progress.percent}%`;
    const label = `${progress.stage}: ${percent}`;
    const countLabel = progress.completed !== null
      ? `${progress.completed.toLocaleString('nl-NL')} van ${progress.total.toLocaleString('nl-NL')} bedrijven afgerond in deze fase.`
      : progress.percent === 100 ? 'Alle fasen afgerond.' : 'Nog geen betrouwbare aantallen voor deze fase beschikbaar.';
    const parsedDate = new Date(progress.updatedAt);
    const dateLabel = progress.updatedAt && Number.isFinite(parsedDate.getTime())
      ? ` Bijgewerkt: ${parsedDate.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}.` : '';
    return `<span class="location-stage-progress" title="${escapeHtml(countLabel + dateLabel)}" aria-label="${escapeHtml(label + '. ' + countLabel)}">${label}</span>`;
  }

  return { getProgress, completionFlags, percentage, render };
});
