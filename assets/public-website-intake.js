(function () {
  function value(form, name) {
    var field = form.elements && form.elements[name];
    return String((field && field.value) || '').trim();
  }

  function setStatus(element, message, isError) {
    if (!element) return;
    element.textContent = message;
    element.className = 'growth-intake-status' + (isError ? ' is-error' : ' is-success');
  }

  function createEventId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return 'website-intake-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  function attribution() {
    try {
      var params = new URL(window.location.href).searchParams;
      return {
        gclid: String(params.get('gclid') || '').slice(0, 180),
        gbraid: String(params.get('gbraid') || '').slice(0, 180),
        wbraid: String(params.get('wbraid') || '').slice(0, 180),
        utmSource: String(params.get('utm_source') || '').slice(0, 80),
        utmMedium: String(params.get('utm_medium') || '').slice(0, 80),
        utmCampaign: String(params.get('utm_campaign') || '').slice(0, 160),
        utmTerm: String(params.get('utm_term') || '').slice(0, 160),
      };
    } catch (_) {
      return {};
    }
  }

  function recordConversion() {
    var eventData = Object.assign({
      id: createEventId(),
      name: 'website-intake-complete',
      page: window.location.pathname || '/website-laten-maken',
      target: 'website-intake',
      landing: String(window.__softoraPublicConversionLanding || window.location.pathname || ''),
      referrer: String(document.referrer || '').slice(0, 500),
      path: String(window.location.pathname || '') + String(window.location.search || ''),
      at: new Date().toISOString(),
    }, attribution());

    try {
      window.dispatchEvent(new CustomEvent('softora:public-conversion', { detail: eventData }));
    } catch (_) {}
    try {
      if (window.SoftoraGoogleAdsConsent && typeof window.SoftoraGoogleAdsConsent.recordConversion === 'function') {
        window.SoftoraGoogleAdsConsent.recordConversion(eventData);
      }
    } catch (_) {}
    fetch('/api/public-conversion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
      keepalive: true,
    }).catch(function () {});
  }

  function buildMessage(form) {
    return [
      'Aanvraag Softora Groeiwebsite - vaste scope € 3.950 excl. btw',
      '',
      'Bedrijf: ' + value(form, 'company'),
      'Bestaande website: ' + (value(form, 'website') || 'Geen'),
      'Belangrijkste doel: ' + value(form, 'goal'),
      'Gewenste start: ' + value(form, 'timing'),
      'Beslisser: ' + value(form, 'decisionMaker'),
      '',
      'Toelichting:',
      value(form, 'details'),
      '',
      'De aanvrager bevestigt de vaste scope en heeft de algemene voorwaarden en het privacybeleid gelezen.',
    ].join('\n');
  }

  function init() {
    var form = document.getElementById('growth-website-intake');
    if (!form) return;
    var status = document.getElementById('growth-website-intake-status');
    var button = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      setStatus(status, 'Aanvraag veilig versturen…', false);

      try {
        var response = await fetch('/api/public-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: value(form, 'name'),
            email: value(form, 'email'),
            phone: value(form, 'phone'),
            message: buildMessage(form),
            page: window.location.pathname || '/website-laten-maken',
          }),
        });
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Aanvraag versturen mislukt.');

        recordConversion();
        form.reset();
        setStatus(status, 'Aanvraag ontvangen. Softora toetst hem nu aan de vaste scope.', false);
      } catch (error) {
        setStatus(status, error && error.message ? error.message : 'Aanvraag versturen mislukt.', true);
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
