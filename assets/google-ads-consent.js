(function () {
  'use strict';

  var COOKIE_NAME = 'softora_cookie_consent';
  var MAX_AGE_SECONDS = 15552000;
  var config = null;
  var state = 'unknown';
  var tagLoaded = false;
  var banner = null;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });

  function readChoice() {
    var prefix = COOKIE_NAME + '=';
    var parts = String(document.cookie || '').split(';');
    for (var index = 0; index < parts.length; index += 1) {
      var value = parts[index].trim();
      if (value.indexOf(prefix) !== 0) continue;
      var choice = value.slice(prefix.length);
      if (choice === 'accepted') return 'granted';
      if (choice === 'declined') return 'denied';
    }
    return 'unknown';
  }

  function writeChoice(choice) {
    var storedChoice = choice === 'granted' ? 'accepted' : 'declined';
    document.cookie = COOKIE_NAME + '=' + storedChoice
      + '; Max-Age=' + MAX_AGE_SECONDS
      + '; Path=/; SameSite=Lax; Secure';
  }

  function updateConsent(choice) {
    var granted = choice === 'granted' ? 'granted' : 'denied';
    window.gtag('consent', 'update', {
      ad_storage: granted,
      analytics_storage: granted,
      ad_user_data: granted,
      ad_personalization: granted,
    });
  }

  function loadTag() {
    if (tagLoaded || !config || !config.enabled || state !== 'granted') return;
    tagLoaded = true;
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.tagId);
    document.head.appendChild(script);
    window.gtag('js', new Date());
    window.gtag('config', config.tagId);
  }

  function removeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function button(label, className, onClick) {
    var control = document.createElement('button');
    control.type = 'button';
    control.className = className;
    control.textContent = label;
    control.addEventListener('click', onClick);
    return control;
  }

  function choose(choice) {
    state = choice;
    writeChoice(choice);
    updateConsent(choice);
    removeBanner();
    if (choice === 'granted') loadTag();
  }

  function showBanner() {
    removeBanner();
    var existingBanner = document.getElementById('cookieConsent');
    if (existingBanner) {
      existingBanner.hidden = false;
      return;
    }
    banner = document.createElement('section');
    banner.className = 'softora-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie-instellingen');

    var copy = document.createElement('div');
    copy.className = 'softora-consent__copy';
    var title = document.createElement('strong');
    title.textContent = 'Mogen we Google Ads-resultaten meten?';
    var text = document.createElement('p');
    text.textContent = 'Met toestemming laden we Google om te zien welke advertentie tot contact leidt. Weigeren heeft geen invloed op de website.';
    var privacy = document.createElement('a');
    privacy.href = '/privacybeleid';
    privacy.textContent = 'Privacybeleid';
    copy.appendChild(title);
    copy.appendChild(text);
    copy.appendChild(privacy);

    var actions = document.createElement('div');
    actions.className = 'softora-consent__actions';
    actions.appendChild(button('Weigeren', 'softora-consent__button softora-consent__button--quiet', function () {
      choose('denied');
    }));
    actions.appendChild(button('Accepteren', 'softora-consent__button softora-consent__button--accept', function () {
      choose('granted');
    }));
    banner.appendChild(copy);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  function addSettingsControl() {
    if (document.querySelector('.softora-consent-settings, [data-cookie-settings]')) return;
    var control = button('Cookie-instellingen', 'softora-consent-settings', showBanner);
    document.body.appendChild(control);
  }

  function bindExistingControls() {
    var controls = document.querySelectorAll('[data-cookie-choice]');
    for (var index = 0; index < controls.length; index += 1) {
      controls[index].addEventListener('click', function () {
        choose(this.getAttribute('data-cookie-choice') === 'accepted' ? 'granted' : 'denied');
      });
    }
  }

  function recordConversion(eventData) {
    if (!config || !config.enabled || state !== 'granted' || !tagLoaded) return false;
    var eventId = String((eventData && eventData.id) || '').slice(0, 80);
    window.gtag('event', 'conversion', {
      send_to: config.tagId + '/' + config.conversionLabel,
      transaction_id: eventId,
    });
    return true;
  }

  window.SoftoraGoogleAdsConsent = {
    getState: function () { return state; },
    recordConversion: recordConversion,
  };

  fetch('/api/google-ads/public-config', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (payload) {
      if (!payload || !payload.enabled || payload.consentMode !== 'basic-v2') return;
      if (!/^AW-[A-Za-z0-9_-]+$/.test(String(payload.tagId || ''))) return;
      if (!String(payload.conversionLabel || '').trim()) return;
      config = payload;
      state = readChoice();
      bindExistingControls();
      addSettingsControl();
      if (state === 'granted') {
        updateConsent('granted');
        loadTag();
      } else if (state === 'denied') {
        updateConsent('denied');
      } else {
        showBanner();
      }
    })
    .catch(function () {
      /* Fail-closed: zonder geldige configuratie blijft Google volledig uit. */
    });
})();
