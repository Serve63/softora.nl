(() => {
  const VIDEOS = [
    {
      title: 'ATTACK MODE',
      type: 'local',
      source: '/assets/momentum-attack-mode.mp4?v=20260722a'
    },
    {
      title: 'ALL GLORY TO JESUS CHRIST',
      type: 'youtube',
      source: 'https://www.youtube-nocookie.com/embed/Lo-lVbf6XxI?start=12&autoplay=1&playsinline=1&rel=0'
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

  function createLocalPlayer(item) {
    const interactionLayer = document.createElement('button');
    video = document.createElement('video');
    video.src = item.source;
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

  function createYoutubePlayer(item) {
    const frame = document.createElement('iframe');
    frame.src = item.source;
    frame.title = item.title;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    player.replaceChildren(frame);
  }

  function renderActiveVideo() {
    stopPlayer();
    const item = VIDEOS[activeVideoIndex];
    title.textContent = item.title;
    if (item.type === 'youtube') {
      createYoutubePlayer(item);
      return;
    }
    createLocalPlayer(item);
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
