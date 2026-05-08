(function () {
  const state = {
    config: null,
    recorder: null,
    stream: null,
    chunks: [],
    busy: false,
    recording: false,
    boundButton: null,
  };

  function getElement(id) {
    return document.getElementById(id);
  }

  function injectStyles() {
    if (document.getElementById('orderDossierPromptVoiceStyles')) return;
    const style = document.createElement('style');
    style.id = 'orderDossierPromptVoiceStyles';
    style.textContent = `
      .prompt-layout-block {
        position: relative;
      }

      .prompt-block-head {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .prompt-voice-btn {
        align-items: center;
        background: #fff;
        border: 1px solid rgba(139, 34, 82, 0.32);
        border-radius: 999px;
        color: #8b2252;
        cursor: pointer;
        display: inline-flex;
        flex: 0 0 auto;
        height: 2.65rem;
        justify-content: center;
        transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, opacity 0.18s ease;
        width: 2.65rem;
      }

      .prompt-voice-btn svg {
        display: block;
        height: 1.1rem;
        width: 1.1rem;
      }

      .prompt-voice-btn:hover {
        border-color: rgba(139, 34, 82, 0.72);
      }

      .prompt-voice-btn.is-recording {
        background: #8b2252;
        border-color: #8b2252;
        color: #fff;
      }

      .prompt-voice-btn:disabled {
        cursor: wait;
        opacity: 0.55;
      }

      .prompt-voice-status {
        color: #8f93a5;
        font-size: 0.78rem;
        line-height: 1.45;
        margin-top: 0.65rem;
      }

      .prompt-voice-status.is-error {
        color: #9a2747;
      }

      .prompt-voice-status.is-success {
        color: #6a7f3f;
      }

      @media (min-width: 1200px) {
        .prompt-block-head {
          display: block;
        }

        .prompt-voice-btn {
          position: absolute;
          right: -3.6rem;
          top: 0.1rem;
        }
      }

      @media print {
        .prompt-voice-btn,
        .prompt-voice-status {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setStatus(message, kind) {
    const status = getElement('opusPromptVoiceStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.className = ['prompt-voice-status screen-only', kind ? `is-${kind}` : '']
      .filter(Boolean)
      .join(' ');
  }

  function setButtonState() {
    const button = getElement('opusPromptVoiceBtn');
    if (!button) return;
    button.disabled = Boolean(state.busy);
    button.classList.toggle('is-recording', Boolean(state.recording));
    button.setAttribute('aria-pressed', state.recording ? 'true' : 'false');
    button.title = state.recording
      ? 'Opname stoppen en prompt herschrijven'
      : 'Website-bouwprompt aanpassen met spraak';
  }

  function createSvgElement(tag, attrs) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    return element;
  }

  function ensureButtonIcon(button) {
    if (!button || button.querySelector('svg')) return;
    const svg = createSvgElement('svg', {
      'aria-hidden': 'true',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-width': '1.9',
      viewBox: '0 0 24 24',
    });
    [
      ['path', { d: 'M12 3.75a2.75 2.75 0 0 0-2.75 2.75v5a2.75 2.75 0 0 0 5.5 0v-5A2.75 2.75 0 0 0 12 3.75Z' }],
      ['path', { d: 'M5.75 10.5a6.25 6.25 0 0 0 12.5 0' }],
      ['path', { d: 'M12 16.75v3.5' }],
      ['path', { d: 'M8.75 20.25h6.5' }],
    ].forEach(([tag, attrs]) => {
      svg.appendChild(createSvgElement(tag, attrs));
    });
    button.appendChild(svg);
  }

  function stopStream() {
    if (!state.stream) return;
    state.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {
        // ignore stop errors
      }
    });
    state.stream = null;
  }

  function getCurrentPrompt() {
    if (state.config && typeof state.config.getCurrentPrompt === 'function') {
      const prompt = String(state.config.getCurrentPrompt() || '').trim();
      if (prompt) return prompt;
    }
    const promptEl = getElement('opusPromptDisplay');
    return promptEl ? String(promptEl.textContent || '').trim() : '';
  }

  function setCurrentPrompt(prompt) {
    const promptEl = getElement('opusPromptDisplay');
    if (promptEl) promptEl.textContent = String(prompt || '').trim();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Audio kon niet worden gelezen.'));
      reader.readAsDataURL(blob);
    });
  }

  function getSupportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
    ];
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
  }

  function buildRewriteContext(currentPrompt) {
    const config = state.config || {};
    return [
      'Je werkt het veld "Website-bouwprompt" in een Softora-uitvoerdossier bij.',
      'De transcriptie van de spraakopname is een wijzigingsinstructie van de gebruiker.',
      'Gebruik die instructie om de volledige website-bouwprompt opnieuw logisch, professioneel en samenhangend te herschrijven.',
      'Voeg de wijziging dus niet simpelweg onderaan toe.',
      'Bewaar concrete namen, bedragen, datums, locaties en bestaande afspraken als ze niet worden tegengesproken.',
      'Verzin geen nieuwe feiten. Als informatie ontbreekt, gebruik duidelijke placeholders.',
      '',
      `Order: ${config.orderId || 'onbekend'}`,
      `Bedrijf: ${config.company || 'onbekend'}`,
      `Titel: ${config.title || 'onbekend'}`,
      `Locatie/contact: ${config.contact || 'onbekend'}`,
      config.description ? `Opdrachtomschrijving: ${config.description}` : '',
      config.transcript ? `Klantgesprek/transcript: ${config.transcript}` : '',
      '',
      'Huidige website-bouwprompt:',
      currentPrompt,
    ]
      .filter(Boolean)
      .join('\n');
  }

  async function rewritePromptFromAudio(blob) {
    const currentPrompt = getCurrentPrompt();
    if (!currentPrompt) {
      throw new Error('Er staat nog geen bouwprompt om bij te werken.');
    }

    const audioDataUrl = await blobToDataUrl(blob);
    const response = await fetch('/api/ai/notes-audio-to-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioDataUrl,
        fileName: `dossier-prompt-${state.config?.orderId || 'update'}.webm`,
        mimeType: blob.type || 'audio/webm',
        language: 'nl',
        context: buildRewriteContext(currentPrompt),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || result?.detail || 'Prompt herschrijven mislukt.');
    }

    const rewrittenPrompt = String(result?.prompt || '').trim();
    if (!rewrittenPrompt) {
      throw new Error('De AI gaf geen herschreven prompt terug.');
    }

    setCurrentPrompt(rewrittenPrompt);
    if (state.config && typeof state.config.onPromptUpdated === 'function') {
      await state.config.onPromptUpdated(rewrittenPrompt, result);
    }
    setStatus('Prompt herschreven en opgeslagen.', 'success');
  }

  async function handleRecordingStop() {
    state.recording = false;
    state.busy = true;
    setButtonState();
    stopStream();

    try {
      const mimeType = state.recorder?.mimeType || state.chunks[0]?.type || 'audio/webm';
      const blob = new Blob(state.chunks, { type: mimeType });
      state.chunks = [];
      if (!blob.size) throw new Error('Geen audio ontvangen.');
      setStatus('Audio verwerken en prompt herschrijven...');
      await rewritePromptFromAudio(blob);
    } catch (error) {
      setStatus(String(error?.message || 'Spraakopname verwerken mislukt.'), 'error');
    } finally {
      state.busy = false;
      state.recorder = null;
      setButtonState();
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Spraakopname wordt niet ondersteund in deze browser.', 'error');
      return;
    }

    state.busy = true;
    setButtonState();
    setStatus('Microfoon openen...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      state.stream = stream;
      state.recorder = recorder;
      state.chunks = [];

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) state.chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        void handleRecordingStop();
      });

      recorder.start();
      state.recording = true;
      state.busy = false;
      setStatus('Luisteren... klik opnieuw op de microfoon om te stoppen.');
      setButtonState();
    } catch (error) {
      state.busy = false;
      state.recording = false;
      stopStream();
      setButtonState();
      setStatus(String(error?.message || 'Microfoon kon niet worden geopend.'), 'error');
    }
  }

  function stopRecording() {
    if (!state.recorder || state.recorder.state === 'inactive') return;
    setStatus('Opname stoppen...');
    state.recorder.stop();
  }

  function handleButtonClick() {
    if (state.busy) return;
    if (state.recording) {
      stopRecording();
      return;
    }
    void startRecording();
  }

  function bind(config) {
    injectStyles();
    state.config = config || {};
    const button = getElement('opusPromptVoiceBtn');
    if (!button) return;
    ensureButtonIcon(button);
    if (state.boundButton !== button) {
      if (state.boundButton) {
        state.boundButton.removeEventListener('click', handleButtonClick);
      }
      button.addEventListener('click', handleButtonClick);
      state.boundButton = button;
    }
    setButtonState();
  }

  window.SoftoraOrderDossierPromptVoice = { bind };

  if (window.SoftoraOrderDossierPromptVoiceConfig) {
    bind(window.SoftoraOrderDossierPromptVoiceConfig);
  }
})();
