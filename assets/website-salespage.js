(function (initialize) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { initWebsiteSalespage: initialize };
  } else if (typeof window === 'object' && window.document) {
    initialize(window);
  }
})(function (window) {
  'use strict';
  var document = window.document;
  var fetch = window.fetch.bind(window);
  var AbortController = window.AbortController;
  var IntersectionObserver = window.IntersectionObserver;
  var form = document.getElementById('website-intake');
  if (!form) return;
  var button = form.querySelector('[data-intake-submit]');
  var status = form.querySelector('[data-intake-status]');
  var success = document.querySelector('[data-intake-success]');
  var originalButton = button.innerHTML;
  var sending = false;

  function value(name) {
    return String(form.elements.namedItem(name).value || '').trim();
  }
  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(isError));
  }
  function markSuccess() {
    form.hidden = true;
    success.hidden = false;
    success.focus();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    if (value('company_website')) {
      markSuccess();
      return;
    }
    var name = value('name');
    var message = value('message');
    if (name.length < 2 || message.length < 5) {
      setStatus('Vul je naam in en vertel kort wat je wilt bereiken.', true);
      return;
    }
    sending = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Je aanvraag wordt verstuurd…';
    setStatus('Even geduld. We versturen je aanvraag.', false);
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 15000);
    try {
      var website = value('website');
      var response = await fetch('/api/public-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          name: name,
          email: value('email'),
          message: 'Websiteaanvraag via /website\n' + (website ? 'Huidige website: ' + website + '\n' : '') + '\n' + message,
          page: '/website',
        }),
      });
      var result = await response.json().catch(function () { return {}; });
      if (!response.ok || !result.ok) throw new Error('request_failed');
      form.reset();
      markSuccess();
    } catch (error) {
      setStatus(
        error && error.name === 'AbortError'
          ? 'We konden de ontvangst nog niet bevestigen. Je invoer blijft staan. Neem bij twijfel contact op via info@softora.nl of WhatsApp.'
          : 'Je aanvraag kon niet worden bevestigd. Je invoer blijft staan. Probeer het opnieuw of neem contact op via info@softora.nl of WhatsApp.',
        true
      );
    } finally {
      window.clearTimeout(timeout);
      sending = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = originalButton;
    }
  });

  var mobileContact = document.querySelector('[data-mobile-contact]');
  var contactSection = document.getElementById('website-gesprek');
  var hero = document.querySelector('.hero');
  if (mobileContact && contactSection && typeof IntersectionObserver === 'function') {
    var heroVisible = Boolean(hero);
    var contactVisible = false;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.target === hero) heroVisible = entry.isIntersecting;
        if (entry.target === contactSection) contactVisible = entry.isIntersecting;
      });
      mobileContact.classList.toggle('is-hidden', heroVisible || contactVisible);
    }, { threshold: 0 });
    if (hero) observer.observe(hero);
    observer.observe(contactSection);
    form.addEventListener('focusin', function () { mobileContact.classList.add('is-hidden'); });
  }
});
