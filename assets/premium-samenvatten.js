(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fileInput = $('audioFileInput');
  const dropzone = $('audioDropzone');
  const selectedAudio = $('selectedAudio');
  const button = $('summarizeButton');
  if (!fileInput || !dropzone || !selectedAudio || !button) return;
  const types = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', webm: 'audio/webm' };
  let file = null;
  let busy = false;
  let enabled = false;
  let maxBytes = 100 * 1024 * 1024;
  const status = (message) => { $('summarizeStatus').textContent = message; };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setBusy(value) {
    busy = value;
    button.disabled = busy || !enabled || !file;
    $('removeAudioButton').disabled = busy;
    fileInput.disabled = busy;
    dropzone.tabIndex = busy ? -1 : 0;
  }

  function select(value) {
    if (busy) return;
    file = value || null;
    selectedAudio.hidden = !file;
    button.disabled = !enabled || !file;
    if (!file) {
      fileInput.value = '';
      $('selectedAudioName').textContent = '';
      $('selectedAudioMeta').textContent = '';
    } else {
      $('selectedAudioName').textContent = file.name || 'Audiobestand';
      $('selectedAudioMeta').textContent = `${(file.size / 1048576).toFixed(1)} MB · klaar voor samenvatten`;
    }
    status(enabled ? '' : 'Samenvatten is nog niet geactiveerd.');
  }

  async function api(path, options) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || 'De aanvraag is mislukt.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  const post = (path, body) => api(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });

  async function uploadAudio(plan, audio, type) {
    if (audio.size <= 6 * 1024 * 1024) {
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', audio.slice(0, audio.size, type), audio.name);
      const response = await fetch(plan.signedUrl, { method: 'PUT', body: form });
      if (!response.ok) throw new Error('Uploaden is mislukt. Probeer het opnieuw.');
      return;
    }
    const signed = new URL(plan.signedUrl);
    const endpoint = `${signed.origin}/storage/v1/upload/resumable`;
    const signature = plan.uploadToken;
    const metadata = [
      ['bucketName', plan.bucket], ['objectName', plan.objectPath],
      ['contentType', type], ['cacheControl', '3600']
    ].map(([name, value]) => `${name} ${btoa(value)}`).join(',');
    const created = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0', 'Upload-Length': String(audio.size),
        'Upload-Metadata': metadata, 'x-signature': signature
      }
    });
    if (!created.ok || !created.headers.get('Location')) throw new Error('De grote upload kon niet starten.');
    const uploadUrl = new URL(created.headers.get('Location'), endpoint).toString();
    let offset = 0;
    const chunkSize = 6 * 1024 * 1024;
    let failures = 0;
    while (offset < audio.size) {
      try {
        const chunk = audio.slice(offset, Math.min(offset + chunkSize, audio.size));
        const response = await fetch(uploadUrl, {
          method: 'PATCH',
          headers: {
            'Tus-Resumable': '1.0.0', 'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream', 'x-signature': signature
          },
          body: chunk
        });
        if (!response.ok) throw new Error('Upload onderbroken');
        offset = Number(response.headers.get('Upload-Offset'));
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > audio.size) throw new Error('Ongeldige uploadvoortgang');
        status(`Opname uploaden… ${Math.floor(offset / audio.size * 100)}%`);
        failures = 0;
      } catch (_) {
        failures += 1;
        if (failures > 3) throw new Error('Uploaden is mislukt. Probeer het opnieuw.');
        await pause(1000 * failures);
        const head = await fetch(uploadUrl, {
          method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0', 'x-signature': signature }
        });
        if (!head.ok) throw new Error('Uploaden is mislukt. Probeer het opnieuw.');
        offset = Number(head.headers.get('Upload-Offset'));
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > audio.size) throw new Error('Ongeldige uploadvoortgang');
      }
    }
  }

  function render(data) {
    $('summaryEmptyState').hidden = true;
    $('summaryResult').hidden = false;
    const chapters = $('summaryChapters');
    const actions = $('summaryActions');
    chapters.replaceChildren();
    actions.replaceChildren();
    for (const part of data.summary || []) {
      const section = document.createElement('section');
      const title = document.createElement('h4');
      const text = document.createElement('p');
      title.textContent = part.title || 'Onderwerp';
      text.textContent = part.text || '';
      section.append(title, text);
      chapters.append(section);
    }
    if (!chapters.children.length) chapters.textContent = 'Geen aparte samenvatting ontvangen; bekijk het transcript hieronder.';
    for (const item of data.actionItems || []) {
      const row = document.createElement('li');
      row.textContent = item.text || '';
      if (item.quote) {
        const quote = document.createElement('small');
        quote.textContent = `Bron: “${item.quote}”`;
        row.append(quote);
      }
      actions.append(row);
    }
    if (!actions.children.length) {
      const row = document.createElement('li');
      row.textContent = 'Geen duidelijke actiepunten of besluiten gevonden.';
      actions.append(row);
    }
    $('summaryTranscript').textContent = data.transcript || 'Geen transcript beschikbaar.';
  }

  async function poll(id) {
    let temporaryFailures = 0;
    for (;;) {
      let data;
      try {
        data = await api(`/api/samenvatten/jobs/${encodeURIComponent(id)}`);
        temporaryFailures = 0;
      } catch (error) {
        if (error.status >= 500 && temporaryFailures < 5) {
          temporaryFailures += 1;
          status('Verbinding tijdelijk onderbroken; voortgang wordt opnieuw opgehaald…');
          await pause(5000);
          continue;
        }
        throw error;
      }
      if (data.status === 'completed') {
        render(data);
        status(data.truncated
          ? 'De opname was langer dan 2 uur; alleen de eerste 2 uur zijn verwerkt.'
          : data.summaryError
            ? 'Het transcript is klaar, maar de samenvatting is mislukt. Je kunt het transcript downloaden.'
            : 'Samenvatting klaar. Controleer namen, afspraken en acties met het transcript.');
        return;
      }
      if (data.status === 'failed') {
        throw new Error('De opname kon niet worden verwerkt. Probeer een ander bestand.');
      }
      status(data.status === 'submitting' ? 'Transcriptie wordt gestart…'
        : data.status === 'summarizing' ? 'Transcript is klaar; samenvatting wordt gemaakt…'
          : 'Gesprek wordt getranscribeerd…');
      await pause(4000);
    }
  }

  async function summarize() {
    if (!enabled || !file || busy) return;
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (!types[extension] || file.size < 1 || file.size > maxBytes) {
      status('Kies een ondersteund audiobestand van maximaal 100 MB.');
      return;
    }
    setBusy(true);
    try {
      const type = file.type || types[extension];
      status('Privé-upload voorbereiden…');
      const plan = await post('/api/samenvatten/plan', { name: file.name, size: file.size, type });
      status('Opname uploaden… Dit kan bij grote bestanden even duren.');
      await uploadAudio(plan, file, type);
      status('Transcriptie starten…');
      await post(`/api/samenvatten/jobs/${encodeURIComponent(plan.id)}/start`, {});
      await poll(plan.id);
    } catch (error) {
      status(error.message || 'Samenvatten is mislukt.');
    } finally { setBusy(false); }
  }

  fileInput.addEventListener('change', () => select(fileInput.files?.[0]));
  dropzone.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!busy) fileInput.click();
  });
  for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    if (!busy) dropzone.classList.add('is-dragging');
  });
  for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
  });
  dropzone.addEventListener('drop', (event) => select(event.dataTransfer?.files?.[0]));
  $('removeAudioButton').addEventListener('click', () => select(null));
  button.addEventListener('click', summarize);
  $('downloadTranscript').addEventListener('click', () => {
    const blob = new Blob([$('summaryTranscript').textContent || ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gesprek-transcript.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  api('/api/samenvatten/config').then((config) => {
    enabled = config.enabled === true;
    maxBytes = Number(config.maxBytes) || maxBytes;
    button.disabled = !enabled || !file;
    if (!enabled) status('Samenvatten is nog niet geactiveerd.');
    return api('/api/samenvatten/jobs/recent').then(({ job }) => {
      if (!job) return;
      setBusy(true);
      return poll(job.id).catch((error) => {
        status(error.message || 'De eerdere opname is niet meer beschikbaar.');
      }).finally(() => setBusy(false));
    });
  }).catch(() => status('Samenvatten is tijdelijk niet beschikbaar.'));
})();
