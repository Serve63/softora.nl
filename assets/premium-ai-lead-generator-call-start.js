(function (global) {
  'use strict';

  function isLeadGeneratorAlias() {
    return document.documentElement.getAttribute('data-softora-lead-generator-alias') === '1';
  }

  function getButtonLabel(isAlias) {
    return isAlias ? 'Bedrijven bellen' : 'Mails Versturen';
  }

  function getBusyLabel(isAlias) {
    return isAlias ? 'Bellen...' : 'Verzenden...';
  }

  function isTestModeEnabled() {
    return Boolean(global.SoftoraCampaignTestMode && typeof global.SoftoraCampaignTestMode.isEnabled === 'function' && global.SoftoraCampaignTestMode.isEnabled());
  }

  function buildTestCallCampaignResult() {
    return {
      ok: true,
      testMode: true,
      summary: {
        requested: 1,
        attempted: 1,
        skipped: 0,
        started: 1,
        failed: 0,
        provider: 'test_mode',
        coldcallingStack: 'test_mode',
        coldcallingStackLabel: 'Testmodus',
        dispatchMode: 'sequential',
        dispatchDelaySeconds: 0,
        queuedRemaining: 0,
      },
      results: [{
        index: 0,
        success: true,
        testMode: true,
        lead: { company: 'Softora Testmodus', email: 'servec321@gmail.com' },
        message: 'Testmodus: geen echte bedrijven gebeld.',
      }],
    };
  }

  function buildTestCallLeads() {
    const testPhone = global.SoftoraCampaignTestMode && typeof global.SoftoraCampaignTestMode.getTestPhone === 'function'
      ? String(global.SoftoraCampaignTestMode.getTestPhone() || '').trim()
      : '';
    return [{
      name: 'Softora Testmodus',
      company: 'Softora Testmodus',
      phone: testPhone || '0629917185',
      email: 'servec321@gmail.com',
      region: 'Testmodus',
    }];
  }

  function buildStartButtonHtml(label) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> ' + label;
  }

  function syncStartButton() {
    const button = document.getElementById('start-campaign-btn');
    if (!button || !isLeadGeneratorAlias()) return;
    button.innerHTML = buildStartButtonHtml(getButtonLabel(true));
  }

  function getRequestedCompanyCount() {
    const slider = document.getElementById('mail-slider');
    const count = Number.parseInt(slider ? slider.value : '0', 10);
    return Number.isFinite(count) && count > 0 ? count : 100;
  }

  function getSelectedRadiusKm() {
    if (typeof global.getSelectedCampaignRadiusKm === 'function') {
      return global.getSelectedCampaignRadiusKm();
    }
    return 50;
  }

  function getRecipientPreviewUrl() {
    if (typeof global.getColdmailRecipientPreviewUrl === 'function') {
      return global.getColdmailRecipientPreviewUrl();
    }
    const params = new URLSearchParams({
      count: String(getRequestedCompanyCount()),
      mode: 'call',
      radiusKm: String(getSelectedRadiusKm()),
    });
    return '/api/coldmailing/campaigns/recipients?' + params.toString();
  }

  function normalizePhone(value) {
    const text = String(value || '').trim();
    return text && text.replace(/\D/g, '').length >= 8 ? text : '';
  }

  function getRecipientPhone(recipient) {
    if (typeof global.getCampaignRowPhone === 'function') {
      return global.getCampaignRowPhone(recipient);
    }
    return normalizePhone(recipient && (
      recipient.phone ||
      recipient.phoneE164 ||
      recipient.tel ||
      recipient.telefoon ||
      recipient.telefoonnummer
    ));
  }

  function buildCallLeads(recipients) {
    return (Array.isArray(recipients) ? recipients : []).map((recipient, index) => {
      const company = String(recipient && (recipient.bedrijf || recipient.company || recipient.name) || '').trim();
      return {
        name: company,
        company: company || 'Bedrijf ' + (index + 1),
        phone: getRecipientPhone(recipient),
        email: String(recipient && recipient.email || '').trim(),
        region: Number.isFinite(Number(recipient && recipient.distanceKm))
          ? Math.round(Number(recipient.distanceKm) * 10) / 10 + ' km vanaf Oisterwijk'
          : '',
      };
    }).filter((lead) => lead.phone);
  }

  function getCampaignPayload(count) {
    const serviceSelect = document.getElementById('service');
    const stackSelect = document.getElementById('coldcallingStack');
    const modeSelect = document.getElementById('callDispatchMode');
    const body = document.getElementById('body1');
    const stack = typeof global.normalizeColdcallingStack === 'function'
      ? global.normalizeColdcallingStack(stackSelect ? stackSelect.value : 'retell_ai')
      : 'retell_ai';
    const mode = String(modeSelect ? modeSelect.value : '').trim().toLowerCase() === 'parallel'
      ? 'parallel'
      : 'sequential';
    return {
      amount: Math.max(1, Number.parseInt(String(count || 0), 10) || 1),
      sector: serviceSelect ? serviceSelect.value : '',
      region: 'Straal vanuit Oisterwijk - ' + getSelectedRadiusKm() + ' km',
      extraInstructions: body ? body.value : '',
      dispatchMode: mode,
      dispatchDelaySeconds: 0,
      coldcallingStack: stack,
      testMode: isTestModeEnabled(),
    };
  }

  async function postColdcallingStart(campaign, leads, startConfirmPin) {
    const startResponse = await fetch('/api/coldcalling/start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaign,
        leads,
        testMode: isTestModeEnabled(),
        startConfirmPin: String(startConfirmPin || '').trim(),
      }),
    });
    const startPayload = await startResponse.json().catch(() => null);
    if (!startResponse.ok || !startPayload || startPayload.ok === false) {
      throw new Error(startPayload && (startPayload.error || startPayload.message) ? (startPayload.error || startPayload.message) : 'Bedrijven bellen is mislukt.');
    }
    return startPayload;
  }

  async function startCallCampaign(startConfirmPin) {
    if (isTestModeEnabled()) {
      return postColdcallingStart(getCampaignPayload(1), buildTestCallLeads(), startConfirmPin);
    }

    const recipientsResponse = await fetch(getRecipientPreviewUrl(), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const recipientsPayload = await recipientsResponse.json().catch(() => null);
    if (!recipientsResponse.ok || !recipientsPayload || recipientsPayload.ok === false) {
      throw new Error('Bellijst laden is mislukt.');
    }

    const leads = buildCallLeads(recipientsPayload.recipients);
    if (!leads.length) {
      throw new Error('Geen bedrijven met telefoonnummer gevonden om te bellen.');
    }

    return postColdcallingStart(getCampaignPayload(leads.length), leads, startConfirmPin);
  }

  function getStartedCount(result) {
    const summary = result && result.summary ? result.summary : null;
    if (summary) {
      return Math.max(0, Number(summary.attempted) || Number(summary.started) || 0);
    }
    return getRequestedCompanyCount();
  }

  function showToast(message) {
    if (typeof global.showToast === 'function') {
      global.showToast(message);
    }
  }

  async function requestCallStartConfirmPin() {
    if (!global.SoftoraRiskyActionPin || typeof global.SoftoraRiskyActionPin.requestPin !== 'function') {
      showToast('Beveiligingspopup kon niet worden geladen. Actie niet gestart.');
      return '';
    }
    return global.SoftoraRiskyActionPin.requestPin({
      title: 'Bedrijven bellen bevestigen',
      description: 'Typ de pincode voordat de belactie wordt gestart.',
      confirmLabel: 'Start bellen',
    });
  }

  async function startBeforeTimeline(original, context, args) {
    const button = document.getElementById('start-campaign-btn');
    if (button && button.dataset.callStartInProgress === '1') return undefined;
    const startConfirmPin = await requestCallStartConfirmPin();
    if (!startConfirmPin) return undefined;
    if (button) button.dataset.callStartInProgress = '1';
    if (typeof global.setCampaignStartButtonBusy === 'function') {
      global.setCampaignStartButtonBusy(true);
    }
    try {
      showToast(isTestModeEnabled() ? 'Testmodus wordt gestart...' : 'Bedrijven bellen wordt gestart...');
      const result = await startCallCampaign(startConfirmPin);
      const count = getStartedCount(result);
      if (!count) throw new Error('Er zijn geen belpogingen gestart.');
      showToast(result && result.testMode ? 'Testmodus klaar: geen echte bedrijven gebeld.' : '✓ ' + count + ' bedrijven klaargezet om te bellen');
      if (typeof global.hydrateCampaignCompanyCountFromSupabase === 'function') {
        await global.hydrateCampaignCompanyCountFromSupabase();
      }
    } catch (error) {
      showToast(String(error && error.message || 'Bedrijven bellen is mislukt.'));
      return undefined;
    } finally {
      if (button) button.dataset.callStartInProgress = '';
      if (typeof global.setCampaignStartButtonBusy === 'function') {
        global.setCampaignStartButtonBusy(false);
      }
    }
    return original.apply(context, args);
  }

  function installStartWrapper() {
    const original = global.startCampagneImmediate;
    if (typeof original !== 'function' || original.__softoraAiLeadGeneratorWrapped) return;
    function wrappedStartCampagneImmediate() {
      if (!isLeadGeneratorAlias()) {
        return original.apply(this, arguments);
      }
      return startBeforeTimeline(original, this, arguments);
    }
    wrappedStartCampagneImmediate.__softoraAiLeadGeneratorWrapped = true;
    global.startCampagneImmediate = wrappedStartCampagneImmediate;
  }

  function install() {
    syncStartButton();
    installStartWrapper();
  }

  global.SoftoraAiLeadGeneratorCallStart = {
    getButtonLabel,
    getBusyLabel,
    syncStartButton,
    startCallCampaign,
    install,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window);
