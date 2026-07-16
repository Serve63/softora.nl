(() => {
  const VIDEO_ID = 'XwtdR-oW6XA';
  const trigger = document.querySelector('.momentum-video-trigger');
  const dialog = document.querySelector('#momentum-video-dialog');
  const closeButton = dialog?.querySelector('.momentum-video-close');
  const player = dialog?.querySelector('[data-momentum-video-player]');

  if (!trigger || !dialog || !closeButton || !player || typeof dialog.showModal !== 'function') {
    return;
  }

  function createPlayer() {
    const iframe = document.createElement('iframe');
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '0',
      controls: '1',
      playsinline: '1',
      rel: '0',
      modestbranding: '1',
      iv_load_policy: '3'
    });
    iframe.src = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?${params.toString()}`;
    iframe.title = 'Softora motivatievideo';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    player.replaceChildren(iframe);
  }

  function stopPlayer() {
    player.replaceChildren();
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
})();
