(function () {
  const root = document.documentElement;
  const topbarTitleEl = document.querySelector('.topbar .topbar-left h1');
  const topbarSubtitleEl = document.querySelector('.topbar .topbar-left p');
  const summaryEl = document.getElementById('aiManagementSummary');
  const goalEl = document.getElementById('aiManagementGoal');
  const goalNoteEl = document.getElementById('aiManagementGoalNote');
  const currentActionEl = document.getElementById('aiManagementCurrentAction');
  const currentActionNoteEl = document.getElementById('aiManagementCurrentActionNote');
  const progressEl = document.getElementById('aiManagementProgress');
  const progressNoteEl = document.getElementById('aiManagementProgressNote');
  const nextStepEl = document.getElementById('aiManagementNextStep');
  const nextStepNoteEl = document.getElementById('aiManagementNextStepNote');
  const topbarStatusTitleEl = document.getElementById('aiModeTopbarStatusTitle');
  const topbarStatusCopyEl = document.getElementById('aiModeTopbarStatusCopy');
  const logBodyEl = document.getElementById('logBody');

  if (!topbarTitleEl || !topbarSubtitleEl || !summaryEl) {
    return;
  }

  const defaultTopbarTitleHtml = topbarTitleEl.innerHTML;
  const defaultTopbarSubtitleHtml = topbarSubtitleEl.innerHTML;

  function readMode() {
    if (window.SoftoraAiManagement && typeof window.SoftoraAiManagement.getMode === 'function') {
      return window.SoftoraAiManagement.getMode();
    }
    return root.getAttribute('data-ai-management-mode') === 'software' ? 'software' : 'personnel';
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('nl-NL').format(Math.max(0, Number(value) || 0));
  }

  function readNumericText(id) {
    const text = String(byId(id)?.textContent || '').trim();
    const normalized = text.replace(/[^\d]/g, '');
    return normalized ? Number(normalized) : 0;
  }

  function readSelectedText(id, fallback) {
    const select = byId(id);
    const option = select && select.selectedOptions ? select.selectedOptions[0] : null;
    return String((option && option.textContent) || fallback || '').trim();
  }

  function getTargetAmount() {
    const slider = byId('leadSlider');
    const rawValue = slider ? Number(slider.value) : 0;
    return Math.max(1, Math.round(rawValue || 100));
  }

  function updateAiWorkspace() {
    const targetAmount = getTargetAmount();
    const called = readNumericText('statCalled');
    const interested = readNumericText('statInterested');
    const booked = readNumericText('statBooked');
    const openResponses = Math.max(0, called - interested - booked);
    const branchLabel = readSelectedText('branche', 'Alles');
    const regionLabel = readSelectedText('regio', 'Geen limiet');
    const stackLabel = readSelectedText('coldcallingStack', 'Retell AI');
    const agendaGuardEnabled = Boolean(byId('campaignFillAgendaWorkdays')?.checked);
    const totalFollowUps = Math.max(openResponses, interested);

    if (called > 0) {
      summaryEl.textContent = `AI is actief bezig met leads verzamelen. Hij heeft ${formatNumber(called)} bedrijven benaderd en bewaakt nu ${formatNumber(totalFollowUps)} open reacties, callbacks en vervolgacties.`;
      currentActionEl.textContent = openResponses > 0
        ? `${formatNumber(openResponses)} reacties en callbacks bewaken`
        : `${formatNumber(Math.max(1, interested))} warme leads opvolgen`;
      currentActionNoteEl.textContent = 'De AI kiest zelf wanneer hij coldcalling, coldmailing, agenda-opvolging of een advertentiepush inzet.';
      progressEl.textContent = `${formatNumber(called)} benaderd, ${formatNumber(interested)} geinteresseerd`;
      progressNoteEl.textContent = booked > 0
        ? `${formatNumber(booked)} afspraken of concrete vervolgstappen staan al klaar.`
        : 'De AI wacht nu vooral op de beste vervolgmomenten en reacties.';
      nextStepEl.textContent = interested > 0
        ? `${formatNumber(interested)} warme leads doorzetten naar afspraak of bevestigingsmail`
        : 'Automatisch de volgende beste batch leads benaderen';
      nextStepNoteEl.textContent = `Voorkeursstack op deze pagina: ${stackLabel}. In AI-beheer mag hij breder sturen dan alleen coldcalling.`;
      if (topbarStatusTitleEl) {
        topbarStatusTitleEl.textContent = 'AI verwerkt nu leadactiviteit';
      }
      if (topbarStatusCopyEl) {
        topbarStatusCopyEl.textContent = `${formatNumber(totalFollowUps)} open vervolgacties bewaakt`;
      }
    } else {
      summaryEl.textContent = `AI staat klaar om zelfstandig leads te verzamelen. Zodra je doel actief is, kiest hij zelf tussen database, coldcalling, coldmailing en advertenties om resultaat te halen.`;
      currentActionEl.textContent = `${formatNumber(targetAmount)} leads klaarzetten voor eerste benadering`;
      currentActionNoteEl.textContent = `Branche nu: ${branchLabel}. Regio nu: ${regionLabel}.`;
      progressEl.textContent = `${formatNumber(targetAmount)} leads als huidig richtdoel`;
      progressNoteEl.textContent = 'De AI kiest zelf welk kanaal per lead de grootste kans op reactie geeft.';
      nextStepEl.textContent = 'Database verrijken en eerste batch automatisch starten';
      nextStepNoteEl.textContent = `Voorkeursstack op deze pagina: ${stackLabel}. In AI-beheer mag hij alle tools op Softora combineren.`;
      if (topbarStatusTitleEl) {
        topbarStatusTitleEl.textContent = 'AI staat klaar voor autonome acquisitie';
      }
      if (topbarStatusCopyEl) {
        topbarStatusCopyEl.textContent = 'Wacht op doel, capaciteit en eerste batch';
      }
    }

    goalEl.textContent = agendaGuardEnabled
      ? 'Agenda vullen tot 10 werkdagen vooruit'
      : `Meer afspraken uit ${formatNumber(targetAmount)} geselecteerde leads`;
    goalNoteEl.textContent = `Jij stuurt op uitkomst; de AI bepaalt zelf via welke tool of software hij dat doel haalt.`;

    if (logBodyEl) {
      const emptyState = logBodyEl.querySelector('.log-empty');
      if (emptyState) {
        emptyState.textContent = readMode() === 'software'
          ? 'AI bewaakt hier zelfstandig de eerste batch leads en kiest zelf het juiste vervolgmoment.'
          : 'Start een campagne om activiteit te zien.';
      }
    }
  }

  function applyMode(mode) {
    const normalizedMode = mode === 'software' ? 'software' : 'personnel';
    root.setAttribute('data-ai-management-mode', normalizedMode);

    if (normalizedMode === 'software') {
      topbarTitleEl.textContent = 'AI Beheer';
      topbarSubtitleEl.innerHTML = 'AI gebruikt hier zelfstandig coldcalling, coldmailing, advertenties en de database om je doel te halen.<br>Jij stuurt op uitkomst; de AI kiest zelf de route, timing en tool.';
      updateAiWorkspace();
      return;
    }

    topbarTitleEl.innerHTML = defaultTopbarTitleHtml;
    topbarSubtitleEl.innerHTML = defaultTopbarSubtitleHtml;
    if (logBodyEl) {
      const emptyState = logBodyEl.querySelector('.log-empty');
      if (emptyState) {
        emptyState.textContent = 'Start een campagne om activiteit te zien.';
      }
    }
  }

  function bindAiWorkspaceRefresh() {
    const watchedElements = [
      byId('leadSlider'),
      byId('branche'),
      byId('regio'),
      byId('coldcallingStack'),
      byId('campaignFillAgendaWorkdays'),
    ];

    watchedElements.forEach((element) => {
      if (!element) return;
      ['input', 'change'].forEach((eventName) => {
        element.addEventListener(eventName, () => {
          if (readMode() === 'software') {
            updateAiWorkspace();
          }
        });
      });
    });

    const observer = new MutationObserver(() => {
      if (readMode() === 'software') {
        updateAiWorkspace();
      }
    });

    ['statCalled', 'statInterested', 'statBooked', 'statConversion', 'logBody'].forEach((id) => {
      const element = byId(id);
      if (!element) return;
      observer.observe(element, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
  }

  bindAiWorkspaceRefresh();
  applyMode(readMode());

  window.addEventListener('softora-ai-management-change', (event) => {
    const nextMode = event && event.detail ? event.detail.mode : readMode();
    applyMode(nextMode);
  });
})();
