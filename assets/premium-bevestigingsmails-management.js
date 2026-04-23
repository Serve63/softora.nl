(function () {
  const root = document.documentElement;
  const refs = {
    statusTitle: document.getElementById('ai-coldmailing-status-title'),
    statusNote: document.getElementById('ai-coldmailing-status-note'),
    summary: document.getElementById('ai-coldmailing-summary'),
    goal: document.getElementById('ai-coldmailing-goal'),
    goalNote: document.getElementById('ai-coldmailing-goal-note'),
    current: document.getElementById('ai-coldmailing-current'),
    currentNote: document.getElementById('ai-coldmailing-current-note'),
    progress: document.getElementById('ai-coldmailing-progress'),
    progressNote: document.getElementById('ai-coldmailing-progress-note'),
    next: document.getElementById('ai-coldmailing-next'),
    nextNote: document.getElementById('ai-coldmailing-next-note'),
  };

  if (!refs.summary) {
    return;
  }

  function readMode() {
    if (window.SoftoraAiManagement && typeof window.SoftoraAiManagement.getMode === 'function') {
      return window.SoftoraAiManagement.getMode();
    }
    return root.getAttribute('data-ai-management-mode') === 'software' ? 'software' : 'personnel';
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(node, value) {
    if (node) node.textContent = String(value || '').trim();
  }

  function readText(id) {
    const element = byId(id);
    return element ? String(element.textContent || '').trim() : '';
  }

  function readNumber(id) {
    const raw = readText(id).replace(/[^\d]/g, '');
    return raw ? Number(raw) : 0;
  }

  function readSelectedText(id, fallback) {
    const select = byId(id);
    const option = select && select.selectedOptions ? select.selectedOptions[0] : null;
    return String((option && option.textContent) || fallback || '').trim();
  }

  function getTargetAmount() {
    const sliderValue = readText('slider-val');
    if (sliderValue) return sliderValue;
    const slider = byId('mail-slider');
    return slider ? String(Math.max(0, Number(slider.value) || 0)) : '100';
  }

  function isRunningCampaign() {
    try {
      return typeof running !== 'undefined' && Boolean(running);
    } catch (_) {
      return false;
    }
  }

  function isFinishedCampaign() {
    try {
      return typeof campaignFinished !== 'undefined' && Boolean(campaignFinished);
    } catch (_) {
      return false;
    }
  }

  function getNextTimelineTitle() {
    try {
      if (typeof campaignTimeline === 'undefined' || !Array.isArray(campaignTimeline) || !campaignTimeline.length) {
        return '';
      }
      const currentIndex = typeof campaignStepIndex !== 'undefined' ? Number(campaignStepIndex) : -1;
      const nextIndex = Math.max(0, Math.min(campaignTimeline.length - 1, currentIndex + 1));
      const step = campaignTimeline[nextIndex];
      return step ? String(step.title || '').trim() : '';
    } catch (_) {
      return '';
    }
  }

  function updateAiColdmailingWorkspace() {
    if (readMode() !== 'software') {
      return;
    }

    const zone1 = readNumber('z1-count');
    const zone2 = readNumber('z2-count');
    const zone4 = readNumber('z4-count');
    const interest = readNumber('z5-count');
    const total = zone1 + zone2 + zone4 + interest;
    const conversion = readText('conv-zone-pct') || '0%';
    const targetAmount = getTargetAmount();
    const branch = readSelectedText('branche', 'Alles') || 'Alles';
    const region = readText('km-val') || '50 km';
    const service = readSelectedText('service', "Website's");
    const database = readSelectedText('database', 'Bedrijvenregister');
    const duration = readSelectedText('campaignDurationDays', '14 dagen');
    const liveText = readText('campaign-live-text');
    const checkpointTitle = readText('campaign-status-title');
    const checkpointDay = readText('campaign-status-day');
    const nextTimelineTitle = getNextTimelineTitle();
    const appointmentsMode = /afspraken/i.test(readText('campaign-count-mode-label'));
    const activeCampaign = isRunningCampaign();
    const finishedCampaign = isFinishedCampaign();

    if (activeCampaign) {
      setText(refs.statusTitle, 'AI verwerkt nu coldmailreacties');
      setText(refs.statusNote, `${checkpointDay || 'Checkpoint actief'} · ${checkpointTitle || 'Coldmailing loopt'}`);
      setText(refs.summary, `AI is hier actief bezig met coldmailing. Hij heeft ${total} bedrijven in deze flow en wacht nu op nieuwe antwoorden, interesse en de beste vervolgmomenten.`);
      setText(
        refs.goal,
        appointmentsMode
          ? `${targetAmount} afspraken via coldmailing ondersteunen`
          : `${targetAmount} bedrijven automatisch opvolgen via coldmailing`
      );
      setText(refs.goalNote, 'Jij stuurt op de uitkomst; de AI kiest zelf wanneer mail logisch is en wanneer een andere tool beter werkt.');
      setText(refs.current, checkpointTitle || 'Checkpoint actief');
      setText(refs.currentNote, liveText || 'De AI bewaakt nu replies, stopverzoeken en vervolgmomenten zonder dubbele opvolging.');
      setText(refs.progress, `${interest} interesse · ${conversion} conversie`);
      setText(refs.progressNote, `${zone2 + zone4} bedrijven zitten nu in follow-up of extra checkpoints.`);
      setText(refs.next, nextTimelineTitle || 'Nieuwe antwoorden verwerken en de volgende stap bepalen');
      setText(refs.nextNote, 'Na coldmailing kan de AI zelf doorschakelen naar agenda, coldcalling of een andere route.');
      return;
    }

    if (finishedCampaign || total > 0) {
      setText(refs.statusTitle, 'AI bewaart de eindstatus van coldmailing');
      setText(refs.statusNote, `${interest} interesse · ${conversion} conversie`);
      setText(refs.summary, `AI heeft hier al een coldmailcampagne gedraaid. Hij bewaart nu de eindstatus en beslist zelf of opnieuw mailen nog zin heeft.`);
      setText(
        refs.goal,
        appointmentsMode
          ? `${targetAmount} afspraken ondersteunen binnen ${duration}`
          : `${targetAmount} contacten verwerken binnen ${duration}`
      );
      setText(refs.goalNote, 'De AI voorkomt dubbele opvolging en gebruikt coldmailing alleen opnieuw als dit echt bijdraagt aan het doel.');
      setText(refs.current, checkpointTitle || 'Campagne afgelopen');
      setText(refs.currentNote, liveText || 'De laatste reactiecheck is gedaan en de huidige stand blijft bewaard.');
      setText(refs.progress, `${total} bedrijven verwerkt · ${interest} interesse`);
      setText(refs.progressNote, `Zone 2: ${zone2} · Zone 4: ${zone4} · conversie ${conversion}.`);
      setText(refs.next, 'Alleen opnieuw starten als het doel dit vraagt');
      setText(refs.nextNote, 'Als andere tools meer effect hebben, laat de AI coldmailing hier bewust rusten.');
      return;
    }

    setText(refs.statusTitle, 'AI gebruikt coldmailing nu niet');
    setText(refs.statusNote, 'Geen actieve coldmailcampagne');
    setText(refs.summary, 'AI is momenteel hier niet mee bezig. Coldmailing wordt pas ingezet als dit helpt om je doel sneller of slimmer te halen.');
    setText(
      refs.goal,
      appointmentsMode
        ? `${targetAmount} afspraken bewaken voor als mail logisch wordt`
        : `${targetAmount} bedrijven klaarhouden voor als e-mail de beste route wordt`
    );
    setText(refs.goalNote, 'Jij geeft het doel; de AI beslist zelf of coldmailing op dit moment wel of juist niet moet meedoen.');
    setText(refs.current, 'Geen live coldmailstap');
    setText(refs.currentNote, `Eerst kijkt de AI of ${service.toLowerCase()} via database, advertenties of coldcalling sneller resultaat geeft.`);
    setText(refs.progress, `${targetAmount} klaar als coldmailing nodig wordt`);
    setText(refs.progressNote, `Branche ${branch} · regio ${region} · database ${database} · looptijd ${duration}.`);
    setText(refs.next, 'Pas starten als timing en intentie kloppen');
    setText(refs.nextNote, 'Als coldmailing niet de beste route is, laat de AI deze pagina bewust stil.');
  }

  function bindRefreshTriggers() {
    const watchedIds = [
      'z1-count',
      'z2-count',
      'z4-count',
      'z5-count',
      'conv-zone-pct',
      'campaign-status-day',
      'campaign-status-title',
      'campaign-live-text',
      'slider-val',
      'mail-slider',
      'branche',
      'km-val',
      'service',
      'database',
      'campaignDurationDays',
      'campaign-count-mode-label',
    ];

    const observer = new MutationObserver(updateAiColdmailingWorkspace);
    watchedIds.forEach((id) => {
      const element = byId(id);
      if (!element) return;
      observer.observe(element, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      ['input', 'change'].forEach((eventName) => {
        element.addEventListener(eventName, updateAiColdmailingWorkspace);
      });
    });
  }

  bindRefreshTriggers();
  updateAiColdmailingWorkspace();

  window.addEventListener('softora-ai-management-change', updateAiColdmailingWorkspace);
  window.addEventListener('pageshow', updateAiColdmailingWorkspace);
})();
