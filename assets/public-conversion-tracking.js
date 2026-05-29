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

  function buildWhatsappText(element) {
    var page = getAttr(element, 'data-softora-conversion-page') || getPagePath();
    var label = String((element && element.textContent) || '').replace(/\s+/g, ' ').trim();
    var lines = [
      'Hoi Martijn, ik wil graag contact via Softora.nl.',
      label ? 'CTA: ' + label : '',
      'Landingspagina: ' + getLandingPath(),
      'CTA-pagina: ' + page,
      getReferrerPath() ? 'Referrer: ' + getReferrerPath() : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  function withWhatsappText(urlRaw, text) {
    try {
      var url = new URL(urlRaw, window.location.href);
      if (!url.searchParams.get('text')) {
        url.searchParams.set('text', text);
      }
      return url.toString();
    } catch {
      return urlRaw;
    }
  }

  function recordConversion(element) {
    var eventData = {
      name: getAttr(element, 'data-softora-conversion'),
      page: getAttr(element, 'data-softora-conversion-page') || getPagePath(),
      target: getAttr(element, 'data-softora-conversion-target'),
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
      ? event.target.closest('a[data-softora-conversion][data-softora-conversion-target="whatsapp"]')
      : null;
    if (!link) return;

    var href = getAttr(link, 'href');
    if (!isMartijnWhatsappUrl(href)) return;

    recordConversion(link);
    link.setAttribute('href', withWhatsappText(href, buildWhatsappText(link)));
  }

  getLandingPath();
  document.addEventListener('click', handleConversionClick, true);
})();
