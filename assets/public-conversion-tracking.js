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

  function isMartijnWhatsappUrl(url) {
    return /^https:\/\/wa\.me\/31643262792(?:[?#].*)?$/i.test(String(url || '').trim());
  }

  function recordConversion(element) {
    var isWhatsappLink = isMartijnWhatsappUrl(getAttr(element, 'href'));
    var eventData = {
      name: getAttr(element, 'data-softora-conversion') || (isWhatsappLink ? 'public-whatsapp-link' : ''),
      page: getAttr(element, 'data-softora-conversion-page') || getPagePath(),
      target: getAttr(element, 'data-softora-conversion-target') || (isWhatsappLink ? 'whatsapp' : ''),
      landing: getLandingPath(),
      referrer: getReferrerPath(),
      path: getPagePath(),
      at: new Date().toISOString(),
    };

    window.__softoraPublicLastConversion = eventData;
    window.__softoraPublicConversionEvents = window.__softoraPublicConversionEvents || [];
    window.__softoraPublicConversionEvents.push(eventData);

    try {
      window.dispatchEvent(new CustomEvent('softora:public-conversion', { detail: eventData }));
    } catch {
      /* Older browsers still get the WhatsApp route. */
    }

    return eventData;
  }

  function handleConversionClick(event) {
    var link = event.target && event.target.closest
      ? event.target.closest('a[data-softora-conversion][data-softora-conversion-target="whatsapp"],a[href]')
      : null;
    if (!link) return;

    var href = getAttr(link, 'href');
    if (!isMartijnWhatsappUrl(href)) return;

    recordConversion(link);
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

    recordConversion(control);

    if (event && !event.defaultPrevented) {
      event.preventDefault();
      window.open(MARTIJN_WHATSAPP_URL, '_blank', 'noopener,noreferrer');
    }
  }

  getLandingPath();
  document.addEventListener('click', handleConversionClick, true);
  document.addEventListener('submit', handleConversionSubmit);
})();
