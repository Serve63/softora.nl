(() => {
  'use strict';
  document.querySelectorAll('[data-demo-toggle]').forEach((button) => {
    const result = document.getElementById(button.getAttribute('aria-controls'));
    const label = button.querySelector('[data-demo-action-label]');
    if (!result || !label) return;
    const original = label.textContent;
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      result.hidden = !expanded;
      button.setAttribute('aria-expanded', String(expanded));
      label.textContent = expanded ? button.dataset.resetLabel : original;
    });
  });
  const complete = document.querySelector('[data-demo-complete]');
  if (complete) {
    const task = document.querySelector('[data-example-task]');
    const state = document.querySelector('[data-task-state]');
    const count = document.querySelector('[data-open-count]');
    const label = complete.querySelector('[data-complete-label]');
    const status = document.querySelector('[data-complete-status]');
    complete.addEventListener('click', () => {
      const done = complete.getAttribute('aria-pressed') !== 'true';
      complete.setAttribute('aria-pressed', String(done));
      task.classList.toggle('is-complete', done);
      state.textContent = done ? 'Afgerond' : 'Open';
      count.textContent = done ? '2' : '3';
      label.textContent = done ? 'Zet de voorbeeldtaak terug' : 'Rond de voorbeeldtaak af';
      status.textContent = done ? 'Voorbeeldtaak afgerond. Je overzicht is bijgewerkt.' : 'Probeer het: je overzicht beweegt mee.';
    });
  }
  const voiceButtons = [...document.querySelectorAll('[data-voice]')];
  if (!voiceButtons.length) return;
  const synth = window.speechSynthesis;
  let active = null, utterance = null, generation = 0, watchdog = null;
  function stop() {
    generation++;
    clearTimeout(watchdog);
    if (active) {
      active.setAttribute('aria-pressed', 'false');
      active.querySelector('[data-voice-label]').textContent = 'Beluister het stemvoorbeeld';
      active.closest('[role="tabpanel"]').querySelector('[data-voice-status]').textContent = 'Een stemvoorbeeld, geen echte oproep.';
      synth?.cancel();
    }
    active = null;
    utterance = null;
  }
  voiceButtons.forEach((button) => {
    const panel = button.closest('[role="tabpanel"]');
    const status = panel.querySelector('[data-voice-status]');
    if (!synth || !window.SpeechSynthesisUtterance) {
      button.hidden = true;
      status.textContent = 'Deze browser kan geen stemvoorbeeld afspelen. Je kunt het gesprek hierboven lezen.';
      return;
    }
    button.addEventListener('click', () => {
      const same = active === button;
      stop();
      if (same) return;
      const dutch = synth.getVoices().find((voice) => /^nl(?:-|_)/i.test(voice.lang));
      if (!dutch) {
        status.textContent = 'Er is geen Nederlandse stem beschikbaar in deze browser. Je kunt het gesprek hierboven lezen.';
        return;
      }
      active = button;
      button.setAttribute('aria-pressed', 'true');
      button.querySelector('[data-voice-label]').textContent = 'Stop het stemvoorbeeld';
      status.textContent = 'Je hoort de voorbeeldantwoorden van de AI-telefonist.';
      const text = [...panel.querySelectorAll('[data-voice-line]')].map((line) => line.textContent).join(' ');
      utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = 'nl-NL';
      utterance.voice = dutch;
      utterance.rate = 0.95;
      const token = generation;
      utterance.onend = () => { if (token === generation) stop(); };
      utterance.onerror = () => {
        if (token !== generation) return;
        stop();
        status.textContent = 'Het stemvoorbeeld kon niet worden afgespeeld. Probeer opnieuw of lees het gesprek.';
      };
      watchdog = setTimeout(() => {
        if (token !== generation) return;
        stop();
        status.textContent = 'Het stemvoorbeeld is gestopt. Je kunt het opnieuw starten.';
      }, 60000);
      synth.speak(utterance);
    });
  });
  synth?.getVoices();
  document.addEventListener('click', (event) => { if (event.target.closest('[data-tab], [data-select-tab]')) stop(); });
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('keydown', (event) => {
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) stop();
  }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
})();
