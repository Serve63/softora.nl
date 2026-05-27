(function (global) {
  'use strict';

  const TEST_RECIPIENT_EMAILS = Object.freeze(['serve@softora.nl', 'servec321@gmail.com']);
  const TEST_RECIPIENT_LABEL = TEST_RECIPIENT_EMAILS.join(' en ');
  const TEST_CALL_PHONE = '0629917185';

  function isLeadGeneratorAlias() {
    return document.documentElement.getAttribute('data-softora-lead-generator-alias') === '1';
  }

  function getEnabledCopy() {
    if (isLeadGeneratorAlias()) {
      return {
        shortLabel: 'Testmodus aan: testoproep naar ' + TEST_CALL_PHONE,
        toast: 'Testmodus aan: testoproep gaat naar ' + TEST_CALL_PHONE + '.',
      };
    }
    return {
      shortLabel: 'Testmodus aan: alleen naar ' + TEST_RECIPIENT_LABEL,
      toast: 'Testmodus aan: verzending gaat alleen naar ' + TEST_RECIPIENT_LABEL + '.',
    };
  }

  function getToggleButton() {
    return document.getElementById('campaignTestModeToggle');
  }

  function isEnabled() {
    const button = getToggleButton();
    return Boolean(button && button.getAttribute('aria-pressed') === 'true');
  }

  function getSelectedCount() {
    return isLeadGeneratorAlias() ? 1 : TEST_RECIPIENT_EMAILS.length;
  }

  function setToggleState(enabled) {
    const button = getToggleButton();
    if (!button) return;
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('is-active', enabled);
    button.title = enabled
      ? getEnabledCopy().shortLabel
      : 'Testmodus uit: normale campagne';
    button.setAttribute('aria-label', button.title);
  }

  function refreshCampaignPreview() {
    if (typeof global.renderCampaignCompanyCount === 'function') {
      global.renderCampaignCompanyCount(isEnabled() ? getSelectedCount() : undefined);
    }
    if (typeof global.hydrateCampaignCompanyCountFromSupabase === 'function') {
      void global.hydrateCampaignCompanyCountFromSupabase();
    }
    if (typeof global.hydrateCampaignRecipientListSoon === 'function') {
      global.hydrateCampaignRecipientListSoon();
    }
  }

  function setEnabled(enabled, options = {}) {
    setToggleState(Boolean(enabled));
    if (!options.silent && typeof global.showToast === 'function') {
      global.showToast(
        isEnabled()
          ? getEnabledCopy().toast
          : 'Testmodus uit: normale campagne actief.'
      );
    }
    refreshCampaignPreview();
  }

  function install() {
    const button = getToggleButton();
    if (!button || button.dataset.testModeReady === '1') return;
    button.dataset.testModeReady = '1';
    setToggleState(isEnabled());
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setEnabled(!isEnabled());
    });
  }

  global.SoftoraCampaignTestMode = {
    getRecipientEmail: function () { return TEST_RECIPIENT_LABEL; },
    getRecipientEmails: function () { return TEST_RECIPIENT_EMAILS.slice(); },
    getRecipientLabel: function () { return TEST_RECIPIENT_LABEL; },
    getTestPhone: function () { return TEST_CALL_PHONE; },
    getSelectedCount,
    install,
    isEnabled,
    setEnabled,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window);
