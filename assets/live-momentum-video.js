(() => {
  const VIDEO_ID = 'XwtdR-oW6XA';
  const trigger = document.querySelector('.momentum-video-trigger');
  const dialog = document.querySelector('#momentum-video-dialog');
  const closeButton = dialog?.querySelector('.momentum-video-close');
  const player = dialog?.querySelector('[data-momentum-video-player]');
  let iframe = null;
  let playbackState = 'playing';

  if (!trigger || !dialog || !closeButton || !player || typeof dialog.showModal !== 'function') {
    return;
  }

  function createPlayer() {
    const interactionLayer = document.createElement('button');
    iframe = document.createElement('iframe');
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '0',
      controls: '0',
      disablekb: '1',
      enablejsapi: '1',
      fs: '0',
      playsinline: '1',
      rel: '0',
      modestbranding: '1',
      showinfo: '0',
      iv_load_policy: '3',
      cc_load_policy: '0',
      loop: '1',
      playlist: VIDEO_ID,
      origin: window.location.origin
    });
    iframe.src = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?${params.toString()}`;
    iframe.title = 'Softora motivatievideo';
    iframe.allow = 'autoplay; encrypted-media';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    interactionLayer.className = 'momentum-video-interaction';
    interactionLayer.type = 'button';
    interactionLayer.setAttribute('aria-label', 'Video pauzeren');
    interactionLayer.addEventListener('click', togglePlayback);
    iframe.addEventListener('load', () => {
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'softora-momentum-player' }), '*');
    });
    player.replaceChildren(iframe, interactionLayer);
  }

  function stopPlayer() {
    iframe = null;
    playbackState = 'playing';
    player.replaceChildren();
  }

  function sendPlayerCommand(command) {
    iframe?.contentWindow?.postMessage(JSON.stringify({
      event: 'command',
      func: command,
      args: []
    }), '*');
  }

  function setPlaybackState(state) {
    playbackState = state;
    const interactionLayer = player.querySelector('.momentum-video-interaction');
    interactionLayer?.setAttribute('aria-label', state === 'playing' ? 'Video pauzeren' : 'Video afspelen');
  }

  function togglePlayback() {
    const shouldPause = playbackState === 'playing';
    sendPlayerCommand(shouldPause ? 'pauseVideo' : 'playVideo');
    setPlaybackState(shouldPause ? 'paused' : 'playing');
  }

  function openVideo() {
    createPlayer();
    document.body.classList.add('momentum-video-open');
    dialog.showModal();
    closeButton.focus();
  }

  function closeVideo() {
    if (dialog.open) {
      dialog.close();
    }
  }

  trigger.addEventListener('click', openVideo);
  closeButton.addEventListener('click', closeVideo);
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) {
      closeVideo();
    }
  });
  dialog.addEventListener('close', () => {
    stopPlayer();
    document.body.classList.remove('momentum-video-open');
    trigger.focus();
  });
  window.addEventListener('message', (event) => {
    if (!['https://www.youtube-nocookie.com', 'https://www.youtube.com'].includes(event.origin)) {
      return;
    }
    let payload = event.data;
    try {
      payload = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
      return;
    }
    const playerState = Number(payload?.info);
    if (payload?.event !== 'onStateChange' || !Number.isFinite(playerState)) {
      return;
    }
    if (playerState === 1) {
      setPlaybackState('playing');
    } else if ([0, 2, 5].includes(playerState)) {
      setPlaybackState('paused');
    }
  });
})();
