(function () {
  var MARTIJN_WHATSAPP_URL = 'https://wa.me/31643262792';
  function getValue(id) {
    var element = document.getElementById(id);
    return String((element && element.value) || '').trim();
  }
  function setStatus(element, message, isError) {
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('is-error', Boolean(isError));
  }
  function setSending(button, isSending) {
    if (!button) return;
    if (isSending) {
      button.dataset.originalText = button.textContent || '';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Bericht versturen…';
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = button.dataset.originalText || 'Verstuur je bericht ↗';
  }
  function openWhatsapp() {
    var openedWindow = window.open(MARTIJN_WHATSAPP_URL, '_blank', 'noopener,noreferrer');
    if (!openedWindow) window.location.href = MARTIJN_WHATSAPP_URL;
  }
  function wireTopicSelectAccessibility(form) {
    var select = form.querySelector('#contact-topic');
    var wrapper = select && select.closest('.site-select');
    var trigger = wrapper && wrapper.querySelector('.site-select-trigger');
    var value = wrapper && wrapper.querySelector('.site-select-value');
    var menu = wrapper && wrapper.querySelector('.site-select-menu');
    if (!trigger || !value || !menu) return;
    value.id = 'contact-topic-value';
    menu.id = 'contact-topic-options';
    trigger.setAttribute('aria-controls', menu.id);
    trigger.setAttribute('aria-labelledby', 'contact-topic-label ' + value.id);
    menu.setAttribute('aria-labelledby', 'contact-topic-label');
  }
  function initContactForm() {
    var form = document.getElementById('contact-form');
    if (!form) return;
    wireTopicSelectAccessibility(form);
    var statusElement = form.querySelector('[data-contact-status]');
    var submitButton = form.querySelector('[data-contact-submit]');
    var successPanel = document.querySelector('[data-contact-success]');
    form.addEventListener('input', function () {
      if (statusElement && statusElement.textContent) setStatus(statusElement, '', false);
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (getValue('contact-company-website')) {
        form.hidden = true;
        if (successPanel) {
          successPanel.hidden = false;
          successPanel.focus();
        }
        return;
      }
      var name = getValue('contact-name');
      var email = getValue('contact-email');
      var phone = getValue('contact-phone');
      var topic = getValue('contact-topic') || 'Algemene vraag';
      var message = getValue('contact-message');
      if (!name || !email || !message) {
        setStatus(statusElement, 'Vul je naam, e-mailadres en bericht in.', true);
        return;
      }
      setStatus(statusElement, 'Je bericht wordt veilig verstuurd…', false);
      setSending(submitButton, true);
      openWhatsapp();
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timeoutId = controller
        ? window.setTimeout(function () {
            controller.abort();
          }, 15000)
        : null;
      try {
        var response = await fetch('/api/public-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            email: email,
            phone: phone,
            message: 'Onderwerp: ' + topic + '\n\n' + message,
            page: '/contact',
          }),
          signal: controller ? controller.signal : undefined,
        });
        var result = await response.json().catch(function () {
          return {};
        });
        if (!response.ok || !result.ok) {
          throw new Error(result.error || 'Bericht verzenden mislukt.');
        }
        form.reset();
        form.hidden = true;
        if (successPanel) {
          successPanel.hidden = false;
          successPanel.focus();
        }
      } catch (error) {
        var isTimeout = error && error.name === 'AbortError';
        setStatus(
          statusElement,
          isTimeout
            ? 'Het versturen duurt te lang. Mail ons via info@softora.nl.'
            : error && error.message
              ? error.message + ' Mail ons eventueel via info@softora.nl.'
              : 'Bericht verzenden mislukt. Mail ons via info@softora.nl.',
          true
        );
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
        setSending(submitButton, false);
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContactForm);
  } else {
    initContactForm();
  }
})();
