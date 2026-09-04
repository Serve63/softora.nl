(() => {
  const VIDEOS = [
    {
      title: 'ATTACK MODE',
      source: '/assets/momentum-attack-mode.mp4?v=20260722a'
    },
    {
      title: 'ALL GLORY TO JESUS CHRIST',
      source: '/assets/momentum-all-glory-to-jesus-christ.mp4?v=20260904a'
    },
    {
      title: 'THE HUNGER IS THE MOST DIFFICULT',
      source: '/assets/momentum-hunger-is-the-most-difficult.mp4?v=20260904a'
    },
    {
      title: '15-8-2026',
      source: '/assets/momentum-15-8-2026.mp4?v=20260904a'
    }
  ];
  const trigger = document.querySelector('.momentum-video-trigger');
  const dialog = document.querySelector('#momentum-video-dialog');
  const closeButton = dialog?.querySelector('.momentum-video-close');
  const title = dialog?.querySelector('#momentum-video-title');
  const player = dialog?.querySelector('[data-momentum-video-player]');
  const previousButton = dialog?.querySelector('[data-momentum-video-previous]');
  const nextButton = dialog?.querySelector('[data-momentum-video-next]');
  let video = null;
  let activeVideoIndex = 0;
  let playbackState = 'playing';

  if (!trigger || !dialog || !closeButton || !title || !player || !previousButton || !nextButton || typeof dialog.showModal !== 'function') {
    return;
  }

  function createPlayer(item) {
    const interactionLayer = document.createElement('button');
    video = document.createElement('video');
    video.src = item.source;
    video.autoplay = true;
    video.controls = false;
    video.loop = true;
    video.muted = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.currentTime = 0;
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

  function renderActiveVideo() {
    stopPlayer();
    const item = VIDEOS[activeVideoIndex];
    title.textContent = item.title;
    createPlayer(item);
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

  function showVideoAtOffset(offset) {
    activeVideoIndex = (activeVideoIndex + offset + VIDEOS.length) % VIDEOS.length;
    renderActiveVideo();
  }

  function openVideo() {
    activeVideoIndex = 0;
    document.body.classList.add('momentum-video-open');
    dialog.showModal();
    renderActiveVideo();
    closeButton.focus();
  }

  function closeVideo() {
    if (dialog.open) {
      dialog.close();
    }
  }

  trigger.addEventListener('click', openVideo);
  closeButton.addEventListener('click', closeVideo);
  previousButton.addEventListener('click', () => showVideoAtOffset(-1));
  nextButton.addEventListener('click', () => showVideoAtOffset(1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showVideoAtOffset(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      showVideoAtOffset(1);
    }
  });
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
