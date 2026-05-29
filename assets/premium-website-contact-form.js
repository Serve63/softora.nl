(function () {
  var MARTIJN_WHATSAPP_URL = 'https://wa.me/31643262792';

  function getValue(id) {
    var element = document.getElementById(id);
    return String((element && element.value) || '').trim();
  }

  function buildWhatsappUrl(name, email, message) {
    var landing = String(window.__softoraPublicConversionLanding || window.location.pathname || '/');

    var lines = [
      'Hoi Martijn, ik heb een vraag via Softora.nl.',
      name ? 'Naam: ' + name : '',
      email ? 'E-mail: ' + email : '',
      message ? 'Vraag: ' + message : '',
      'Landingspagina: ' + landing,
      'CTA-pagina: ' + (window.location.pathname || '/'),
    ].filter(Boolean);
    return MARTIJN_WHATSAPP_URL + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  function openWhatsapp(url) {
    var openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      window.location.href = url;
    }
  }

  function setStatus(statusElement, message, isError) {
    if (!statusElement) return;
    statusElement.textContent = message || '';
    statusElement.style.minHeight = '1.2em';
    statusElement.style.margin = '0';
    statusElement.style.fontFamily = "'Inter', sans-serif";
    statusElement.style.fontSize = '0.82rem';
    statusElement.style.lineHeight = '1.45';
    statusElement.style.color = isError ? 'var(--accent)' : 'var(--text-secondary)';
  }

  function setSubmitState(button, isSending) {
    if (!button) return;
    if (isSending) {
      button.dataset.originalText = button.textContent || '';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.style.cursor = 'wait';
      button.style.opacity = '0.72';
      button.textContent = 'Versturen...';
      return;
    }

    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.style.cursor = '';
    button.style.opacity = '';
    button.textContent = button.dataset.originalText || 'Verstuur bericht';
  }

  function initFaqContactForm() {
    var form = document.getElementById('faq-contact-form');
    if (!form) return;

    var statusElement = document.getElementById('faq-contact-status');
    var submitButton = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;

      var name = getValue('faq-contact-name');
      var email = getValue('faq-contact-email');
      var message = getValue('faq-contact-message');

      if (!name || !email || !message) {
        setStatus(statusElement, 'Vul je naam, e-mailadres en vraag in.', true);
        return;
      }

      openWhatsapp(buildWhatsappUrl(name, email, message));
      setStatus(statusElement, 'WhatsApp wordt geopend. We bewaren je vraag ook veilig.', false);
      setSubmitState(submitButton, true);

      try {
        var response = await fetch('/api/public-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            email: email,
            message: message,
            page: window.location.pathname || '/premium-website',
          }),
        });
        var result = await response.json().catch(function () {
          return {};
        });

        if (!response.ok || !result.ok) {
          throw new Error(result.error || 'Bericht verzenden mislukt.');
        }

        form.reset();
        form.style.display = 'none';
        var sendSuccess = document.getElementById('send-success');
        if (sendSuccess) sendSuccess.classList.add('show');
      } catch (error) {
        setStatus(
          statusElement,
          error && error.message
            ? error.message
            : 'Bericht verzenden mislukt. Probeer het later opnieuw.',
          true
        );
      } finally {
        setSubmitState(submitButton, false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFaqContactForm);
  } else {
    initFaqContactForm();
  }
})();
