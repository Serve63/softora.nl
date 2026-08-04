(() => {
  const form = document.querySelector('[data-momentum-access-form]');
  const input = document.querySelector('[data-momentum-access-input]');
  const dots = document.querySelector('[data-momentum-access-dots]');
  const message = document.querySelector('[data-momentum-access-message]');
  const buttons = Array.from(document.querySelectorAll('.momentum-access-numpad button'));
  if (!form || !input || !dots || !message) return;

  let code = '';
  let checking = false;

  function setMessage(text, checkingState = false) {
    message.textContent = text;
    message.classList.toggle('is-checking', checkingState);
  }

  function syncDots(state = '') {
    dots.classList.toggle('is-error', state === 'error');
    dots.classList.toggle('is-success', state === 'success');
    dots.querySelectorAll('span').forEach((dot, index) => {
      dot.classList.toggle('is-filled', index < code.length);
    });
    dots.setAttribute('aria-label', `${code.length} van 6 cijfers ingevuld`);
    input.value = code;
  }

  function setChecking(nextChecking) {
    checking = nextChecking;
    buttons.forEach((button) => {
      button.disabled = nextChecking;
    });
  }

  function clearCode() {
    if (checking) return;
    code = '';
    setMessage('');
    syncDots();
    input.focus({ preventScroll: true });
  }

  function removeDigit() {
    if (checking) return;
    code = code.slice(0, -1);
    setMessage('');
    syncDots();
    input.focus({ preventScroll: true });
  }

  async function verifyCode() {
    if (checking || code.length !== 6) return;
    setChecking(true);
    setMessage('Controleren…', true);
    try {
      const response = await fetch('/api/live-momentum/access', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || 'Toegangscode is onjuist.');
      }
      syncDots('success');
      setMessage('Toegang verleend.', true);
      window.setTimeout(() => window.location.replace('/winnen'), 180);
    } catch (error) {
      setChecking(false);
      syncDots('error');
      setMessage(error?.message || 'Toegangscode controleren lukt niet.');
      window.setTimeout(() => {
        code = '';
        syncDots();
        input.focus({ preventScroll: true });
      }, 420);
    }
  }

  function addDigit(digit) {
    if (checking || code.length >= 6 || !/^\d$/.test(digit)) return;
    code += digit;
    setMessage('');
    syncDots();
    if (code.length === 6) window.setTimeout(verifyCode, 100);
  }

  document.querySelectorAll('[data-momentum-access-digit]').forEach((button) => {
    button.addEventListener('click', () => addDigit(button.dataset.momentumAccessDigit || ''));
  });
  document.querySelector('[data-momentum-access-clear]')?.addEventListener('click', clearCode);
  document.querySelector('[data-momentum-access-back]')?.addEventListener('click', removeDigit);

  input.addEventListener('input', () => {
    if (checking) return;
    code = input.value.replace(/\D/g, '').slice(0, 6);
    syncDots();
    if (code.length === 6) window.setTimeout(verifyCode, 100);
  });

  document.addEventListener('keydown', (event) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      addDigit(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      removeDigit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (code) clearCode();
      else window.location.assign('/premium-instellingen');
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void verifyCode();
  });

  syncDots();
  input.focus({ preventScroll: true });
})();
