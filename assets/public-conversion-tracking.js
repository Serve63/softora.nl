(function () {
  var ENDPOINT = '/api/public-conversion';

  function safeText(value, maxLength) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength || 160);
  }

  function getLandingPage() {
    var currentPath = window.location.pathname || '/';
    try {
      if (!document.referrer) return currentPath;
      var referrer = new URL(document.referrer);
      if (referrer.origin === window.location.origin) return referrer.pathname || currentPath;
    } catch (_) {
      return currentPath;
    }
    return currentPath;
  }

  function getPayload(element, eventType) {
    var href = element && element.href ? element.href : element && element.getAttribute ? element.getAttribute('href') : '';
    return {
      event: eventType,
      conversion: element.getAttribute('data-softora-conversion') || '',
      page: element.getAttribute('data-softora-conversion-page') || window.location.pathname || '/',
      landingPage: getLandingPage(),
      target: element.getAttribute('data-softora-conversion-target') || '',
      href: href || '',
      label: safeText(element.getAttribute('aria-label') || element.textContent || element.value || '', 160),
    };
  }

  function sendPayload(payload) {
    if (!payload || !payload.conversion || !payload.page) return;
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
    } catch (_) {}

    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'same-origin',
      }).catch(function () {});
    } catch (_) {}
  }

  function closestConversionElement(target) {
    if (!target || !target.closest) return null;
    return target.closest('[data-softora-conversion]');
  }

  document.addEventListener(
    'click',
    function (event) {
      var element = closestConversionElement(event.target);
      if (!element) return;
      sendPayload(getPayload(element, 'click'));
    },
    true
  );

  document.addEventListener(
    'submit',
    function (event) {
      var submitter = event.submitter || null;
      var element = submitter && submitter.matches && submitter.matches('[data-softora-conversion]')
        ? submitter
        : event.target && event.target.querySelector
          ? event.target.querySelector('[data-softora-conversion]')
          : null;
      if (!element) return;
      sendPayload(getPayload(element, 'submit'));
    },
    true
  );
})();
