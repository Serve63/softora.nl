(() => {
  const VIDEO_ID = 'XwtdR-oW6XA';
  const trigger = document.querySelector('.momentum-video-trigger');
  const dialog = document.querySelector('#momentum-video-dialog');
  const closeButton = dialog?.querySelector('.momentum-video-close');
  const player = dialog?.querySelector('[data-momentum-video-player]');
  let iframe = null;
  let revealTimer = null;

  if (!trigger || !dialog || !closeButton || !player || typeof dialog.showModal !== 'function') {
    return;
  }

  function createPlayer() {
    const interactionLayer = document.createElement('div');
    iframe = document.createElement('iframe');
    player.classList.remove('is-ready');
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '1',
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
    interactionLayer.setAttribute('aria-hidden', 'true');
    interactionLayer.addEventListener('click', activateVideo);
    iframe.addEventListener('load', () => {
      iframe?.contentWindow?.postMessage(JSON.stringify({
        event: 'listening',
        id: 'softora-momentum-player'
      }), '*');
      scheduleReveal();
    });
    player.replaceChildren(iframe, interactionLayer);
  }

  function stopPlayer() {
    window.clearTimeout(revealTimer);
    revealTimer = null;
    iframe = null;
    player.classList.remove('is-ready');
    player.replaceChildren();
  }

  function sendPlayerCommand(command, args = []) {
    iframe?.contentWindow?.postMessage(JSON.stringify({
      event: 'command',
      func: command,
      args
    }), '*');
  }

  function scheduleReveal() {
    window.clearTimeout(revealTimer);
    revealTimer = window.setTimeout(() => {
      player.classList.add('is-ready');
    }, 5200);
  }

  function activateVideo() {
    player.classList.remove('is-ready');
    sendPlayerCommand('playVideo');
    sendPlayerCommand('unMute');
    sendPlayerCommand('setVolume', [100]);
    scheduleReveal();
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
