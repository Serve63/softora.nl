(function (global) {
  "use strict";

  const FALLBACK_THEME = {
    border: 'rgba(22,25,44,0.12)',
    chromeBg: '#fff',
    blockBg: '#fff',
    text: '#16192c',
    textMuted: '#606272',
    accent: '#8b2252',
  };

  function fallbackNormalize(value) {
    return String(value || '').trim();
  }

  function fallbackEscapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fallbackLooksLikePhoneNumber(value) {
    const normalized = fallbackNormalize(value).replace(/[^\d+]/g, '');
    return /^(?:\+31|0031|0)?[1-9]\d{8,10}$/.test(normalized);
  }

  function getPromptDeps(deps = {}) {
    return {
      normalizeFreeText: typeof deps.normalizeFreeText === 'function' ? deps.normalizeFreeText : fallbackNormalize,
      escapeHtml: typeof deps.escapeHtml === 'function' ? deps.escapeHtml : fallbackEscapeHtml,
      looksLikePhoneNumber: typeof deps.looksLikePhoneNumber === 'function' ? deps.looksLikePhoneNumber : fallbackLooksLikePhoneNumber,
      getThemeTokens: typeof deps.getThemeTokens === 'function' ? deps.getThemeTokens : () => FALLBACK_THEME,
    };
  }

  async function promptForManualLeadDetails(defaults = {}, deps = {}) {
    const {
      normalizeFreeText,
      escapeHtml,
      looksLikePhoneNumber,
      getThemeTokens,
    } = getPromptDeps(deps);

    if (typeof document === 'undefined' || !document.body) {
      const company = normalizeFreeText(global.prompt('Bedrijf', normalizeFreeText(defaults.company || '')));
      if (!company) return { ok: false, cancelled: true };
      const address = normalizeFreeText(global.prompt('Adres', normalizeFreeText(defaults.address || '')));
      const phone = normalizeFreeText(global.prompt('Telefoonnummer', normalizeFreeText(defaults.phone || '')));
      if (!phone) return { ok: false, cancelled: true };
      const website = normalizeFreeText(global.prompt('Website', normalizeFreeText(defaults.website || '')));
      return {
        ok: true,
        values: { company, address, phone, website },
      };
    }

    return new Promise((resolve) => {
      const theme = { ...FALLBACK_THEME, ...getThemeTokens() };
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '10020';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '24px';
      overlay.style.background = 'rgba(14, 16, 24, 0.5)';
      overlay.style.backdropFilter = 'blur(2px)';

      overlay.innerHTML = `
        <div style="width:min(920px, 100%); border-radius:16px; border:1px solid ${theme.border}; background:${theme.chromeBg}; box-shadow:0 28px 90px rgba(0,0,0,0.28); padding:26px 28px 22px;">
          <div style="font-family:Oswald,sans-serif; font-size:28px; line-height:1; letter-spacing:0.03em; text-transform:uppercase; color:${theme.text};">Lead handmatig toevoegen</div>
          <div style="margin-top:14px; font-size:15px; line-height:1.6; color:${theme.textMuted};">Vul de leadgegevens in. We nemen deze direct op in het bedrijvenregister.</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-top:22px;">
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Bedrijf</span>
              <input type="text" data-manual-lead-company inputmode="text" autocomplete="organization" value="${escapeHtml(normalizeFreeText(defaults.company || ''))}" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Adres</span>
              <input type="text" data-manual-lead-address inputmode="text" autocomplete="street-address" value="${escapeHtml(normalizeFreeText(defaults.address || ''))}" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Telefoonnummer</span>
              <input type="tel" data-manual-lead-phone inputmode="tel" autocomplete="tel" value="${escapeHtml(normalizeFreeText(defaults.phone || ''))}" placeholder="0612345678 of +31612345678" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
            <label style="display:flex; flex-direction:column; gap:7px;">
              <span style="font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.textMuted};">Website</span>
              <input type="text" data-manual-lead-website inputmode="url" autocomplete="url" value="${escapeHtml(normalizeFreeText(defaults.website || ''))}" placeholder="voorbeeld.nl" style="height:56px; padding:0 16px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-size:16px;">
            </label>
          </div>
          <div data-manual-lead-error style="min-height:20px; margin-top:14px; font-size:13px; color:#b4235b;"></div>
          <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:12px;">
            <button type="button" data-manual-lead-cancel style="height:48px; min-width:148px; padding:0 22px; border-radius:10px; border:1px solid ${theme.border}; background:${theme.blockBg}; color:${theme.text}; font-family:Oswald,sans-serif; font-size:16px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer;">Annuleren</button>
            <button type="button" data-manual-lead-confirm style="height:48px; min-width:148px; padding:0 22px; border-radius:10px; border:1px solid transparent; background:${theme.accent}; color:#fff; font-family:Oswald,sans-serif; font-size:16px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer;">Opslaan</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const companyInput = overlay.querySelector('[data-manual-lead-company]');
      const addressInput = overlay.querySelector('[data-manual-lead-address]');
      const phoneInput = overlay.querySelector('[data-manual-lead-phone]');
      const websiteInput = overlay.querySelector('[data-manual-lead-website]');
      const errorEl = overlay.querySelector('[data-manual-lead-error]');
      const cancelBtn = overlay.querySelector('[data-manual-lead-cancel]');
      const confirmBtn = overlay.querySelector('[data-manual-lead-confirm]');

      let finished = false;

      function cleanup(result) {
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(result);
      }

      function setError(message) {
        if (!errorEl) return;
        errorEl.textContent = normalizeFreeText(message);
      }

      function submit() {
        const company = normalizeFreeText(companyInput?.value || '');
        const address = normalizeFreeText(addressInput?.value || '');
        const phone = normalizeFreeText(phoneInput?.value || '');
        const website = normalizeFreeText(websiteInput?.value || '');

        if (!company) {
          setError('Bedrijf ontbreekt.');
          companyInput?.focus();
          return;
        }
        if (!phone) {
          setError('Telefoonnummer ontbreekt.');
          phoneInput?.focus();
          return;
        }
        if (!looksLikePhoneNumber(phone)) {
          setError('Telefoonnummer lijkt ongeldig. Gebruik bijv. 0612345678 of +31612345678.');
          phoneInput?.focus();
          return;
        }

        cleanup({
          ok: true,
          values: {
            company,
            address,
            phone,
            website,
          },
        });
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup({ ok: false, cancelled: true });
          return;
        }
        if (event.key === 'Enter' && event.target && event.target.tagName !== 'TEXTAREA') {
          event.preventDefault();
          submit();
        }
      }

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          cleanup({ ok: false, cancelled: true });
        }
      });
      cancelBtn?.addEventListener('click', () => cleanup({ ok: false, cancelled: true }));
      confirmBtn?.addEventListener('click', submit);
      document.addEventListener('keydown', onKeyDown, true);
      global.setTimeout(() => {
        companyInput?.focus();
        companyInput?.select?.();
      }, 0);
    });
  }

  global.SoftoraColdcallingManualLeadPrompt = {
    promptForManualLeadDetails,
  };
})(window);
