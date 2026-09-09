const fs = require('node:fs');
const path = require('node:path');
const { EXTRA_MODULES } = require('../../assets/settings-module-routes');
const { sortExtraSettingsItems } = require('../../assets/premium-extra-modules');

const bootstrap = fs.readFileSync(path.join(__dirname, '../../assets/premium-settings-first-paint.js'), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const svg = (contents, className = '') => `<svg class="${className}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${contents}</svg>`;

function renderPremiumSettingsShell(html) {
  if (html.includes('id="screen-extra"')) return html;
  const marker = '<div class="screen" id="screen-personeel">';
  if (!html.includes(marker)) return html;
  const cards = sortExtraSettingsItems(EXTRA_MODULES).map((item, index) => {
    const linked = item.unlocked === true && Boolean(item.href);
    const tag = linked ? 'a' : 'div';
    const attributes = linked ? `href="${escape(item.href)}" data-settings-extra-href="${escape(item.href)}"`
      : 'data-settings-extra-locked="true" aria-disabled="true"';
    const status = linked ? svg('<polyline points="9 18 15 12 9 6"/>', 'tegel-arrow')
      : svg('<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', 'settings-extra-lock');
    return `<${tag} class="tegel settings-extra-card${linked ? '' : ' settings-extra-card--locked'}" ${attributes}>${status}<div class="tegel-icon-wrap">${svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5"/>')}</div><div class="tegel-label">${escape(item.label)}</div><div class="tegel-desc">${escape(item.description)}</div><div class="tegel-count">${linked ? 'Extra ' + String(index + 1).padStart(2, '0') : 'Vergrendeld'}</div></${tag}>`;
  }).join('');
  const screen = `<div class="screen" id="screen-extra" data-settings-extra-static="1"><div class="beheer-header"><div><div class="beheer-title">Extra</div><div class="beheer-subtitle">Interne modules en placeholders</div></div><div class="beheer-header-actions"><button type="button" class="settings-lock-btn magnetic" data-settings-extra-back="true" title="Terug naar instellingenoverzicht" aria-label="Terug naar instellingen">${svg('<path d="M15 18l-6-6 6-6"/>')}Naar instellingen</button></div></div><div class="settings-extra-grid">${cards}</div></div>`;
  return html.replace(marker, `${screen}<script>${bootstrap}</script>\n${marker}`);
}

module.exports = { renderPremiumSettingsShell };
