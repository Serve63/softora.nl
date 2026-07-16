(function () {
  var MARTIJN_WHATSAPP_URL = 'https://wa.me/31643262792';

  function getPagePath() {
    return String(window.location.pathname || '/') + String(window.location.search || '');
  }

  function getLandingPath() {
    var landing = getPagePath();
    window.__softoraPublicConversionLanding = window.__softoraPublicConversionLanding || landing;
    return window.__softoraPublicConversionLanding;
  }

  function getReferrerPath() {
    try {
      if (!document.referrer) return '';
      var url = new URL(document.referrer);
      if (url.origin !== window.location.origin) return document.referrer;
      return url.pathname + url.search;
    } catch {
      return '';
    }
  }

  function getAttr(element, name) {
    return String((element && element.getAttribute(name)) || '').trim();
  }

  function getAttribution() {
    try {
      var params = new URL(getPagePath(), window.location.origin).searchParams;
      return {
        gclid: String(params.get('gclid') || '').slice(0, 180),
        gbraid: String(params.get('gbraid') || '').slice(0, 180),
        wbraid: String(params.get('wbraid') || '').slice(0, 180),
        utmSource: String(params.get('utm_source') || '').slice(0, 80),
        utmMedium: String(params.get('utm_medium') || '').slice(0, 80),
        utmCampaign: String(params.get('utm_campaign') || '').slice(0, 160),
        utmTerm: String(params.get('utm_term') || '').slice(0, 160),
      };
    } catch {
      return {};
    }
  }

  function createEventId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch {
      /* Fall through to a non-identifying event key. */
    }
    return 'public-conversion-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  function isMartijnWhatsappUrl(url) {
    return /^https:\/\/wa\.me\/31643262792(?:[?#].*)?$/i.test(String(url || '').trim());
  }

  function recordConversion(element) {
    var isWhatsappLink = isMartijnWhatsappUrl(getAttr(element, 'href'));
    var eventData = Object.assign({
      id: createEventId(),
      name: getAttr(element, 'data-softora-conversion') || (isWhatsappLink ? 'public-whatsapp-link' : ''),
      page: getAttr(element, 'data-softora-conversion-page') || getPagePath(),
      target: getAttr(element, 'data-softora-conversion-target') || (isWhatsappLink ? 'whatsapp' : ''),
      landing: getLandingPath(),
      referrer: getReferrerPath(),
      path: getPagePath(),
      at: new Date().toISOString(),
    }, getAttribution());

    window.__softoraPublicLastConversion = eventData;
    window.__softoraPublicConversionEvents = window.__softoraPublicConversionEvents || [];
    window.__softoraPublicConversionEvents.push(eventData);

    try {
      window.dispatchEvent(new CustomEvent('softora:public-conversion', { detail: eventData }));
    } catch {
      /* Older browsers still get the WhatsApp route. */
    }

    try {
      if (
        window.SoftoraGoogleAdsConsent &&
        typeof window.SoftoraGoogleAdsConsent.recordConversion === 'function'
      ) {
        window.SoftoraGoogleAdsConsent.recordConversion(eventData);
      }
    } catch {
      /* Google-meting mag de first-party route nooit blokkeren. */
    }

    return eventData;
  }

  function sendFirstPartyConversion(eventData) {
    try {
      var body = JSON.stringify(eventData);
      if (
        window.navigator &&
        typeof window.navigator.sendBeacon === 'function' &&
        typeof window.Blob === 'function'
      ) {
        window.navigator.sendBeacon(
          '/api/public-conversion',
          new window.Blob([body], { type: 'application/json' })
        );
        return;
      }
      if (typeof window.fetch === 'function') {
        window.fetch('/api/public-conversion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch {
      /* De CTA mag nooit afhankelijk zijn van meting. */
    }
  }

  function handleConversionClick(event) {
    var link = event.target && event.target.closest
      ? event.target.closest('a[data-softora-conversion][data-softora-conversion-target="whatsapp"],a[href]')
      : null;
    if (!link) return;

    var href = getAttr(link, 'href');
    if (!isMartijnWhatsappUrl(href)) return;

    sendFirstPartyConversion(recordConversion(link));
    link.setAttribute('href', MARTIJN_WHATSAPP_URL);
  }

  function getSubmitControl(event) {
    var submitter = event && event.submitter;
    if (
      submitter &&
      submitter.matches &&
      submitter.matches('[data-softora-conversion][data-softora-whatsapp-action="submit"]')
    ) {
      return submitter;
    }

    var form = event && event.target;
    if (form && form.querySelector) {
      return form.querySelector('[data-softora-conversion][data-softora-whatsapp-action="submit"]');
    }

    return null;
  }

  function handleConversionSubmit(event) {
    var control = getSubmitControl(event);
    if (!control) return;

    var target = getAttr(control, 'data-softora-conversion-target');
    var whatsappUrl = getAttr(control, 'data-softora-whatsapp-url');
    if (target !== 'whatsapp' || !isMartijnWhatsappUrl(whatsappUrl)) return;

    var form = event && event.target;
    if (form && form.checkValidity && !form.checkValidity()) return;

    sendFirstPartyConversion(recordConversion(control));

    if (event && !event.defaultPrevented) {
      event.preventDefault();
      window.open(MARTIJN_WHATSAPP_URL, '_blank', 'noopener,noreferrer');
    }
  }

  getLandingPath();
  document.addEventListener('click', handleConversionClick, true);
  document.addEventListener('submit', handleConversionSubmit);
})();
