(() => {
  const VIDEO_SOURCE = '/assets/momentum-attack-mode.mp4?v=20260722a';
  const trigger = document.querySelector('.momentum-video-trigger');
  const dialog = document.querySelector('#momentum-video-dialog');
  const closeButton = dialog?.querySelector('.momentum-video-close');
  const player = dialog?.querySelector('[data-momentum-video-player]');
  let video = null;
  let playbackState = 'playing';

  if (!trigger || !dialog || !closeButton || !player || typeof dialog.showModal !== 'function') {
    return;
  }

  function createPlayer() {
    const interactionLayer = document.createElement('button');
    video = document.createElement('video');
    video.src = VIDEO_SOURCE;
    video.autoplay = true;
    video.controls = false;
    video.loop = true;
    video.muted = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-label', 'Softora motivatievideo');
    interactionLayer.className = 'momentum-video-interaction';
    interactionLayer.type = 'button';
    interactionLayer.setAttribute('aria-label', 'Video pauzeren');
    interactionLayer.addEventListener('click', togglePlayback);
    video.addEventListener('play', () => setPlaybackState('playing'));
    video.addEventListener('pause', () => setPlaybackState('paused'));
    player.replaceChildren(video, interactionLayer);
    video.play().catch(() => setPlaybackState('paused'));
  }

  function stopPlayer() {
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    video = null;
    playbackState = 'playing';
    player.replaceChildren();
  }

  function setPlaybackState(state) {
    playbackState = state;
    const interactionLayer = player.querySelector('.momentum-video-interaction');
    interactionLayer?.setAttribute('aria-label', state === 'playing' ? 'Video pauzeren' : 'Video afspelen');
  }

  function togglePlayback() {
    if (!video) return;
    const shouldPause = playbackState === 'playing';
    if (shouldPause) {
      video.pause();
    } else {
      video.play().catch(() => setPlaybackState('paused'));
    }
  }

  function openVideo() {
    document.body.classList.add('momentum-video-open');
    dialog.showModal();
    createPlayer();
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
})();
