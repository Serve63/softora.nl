const fs = require('node:fs');
const path = require('node:path');
const { getLeadRadarSidebarLink, getSummarizeSidebarLink } = require('../../assets/premium-sidebar-links');

function normalizeSidebarLinks(html) {
  return html.replace(/(<aside\b[^>]*data-static-sidebar="1"[^>]*>)([\s\S]*?)(<\/aside>)/gi, (_match, open, body, close) => {
    for (const [link, beforeKey] of [[getLeadRadarSidebarLink(), 'database'], [getSummarizeSidebarLink(), 'seo']]) {
      if (body.includes(`data-sidebar-key="${link.key}"`)) continue;
      const anchor = `<a href="${link.href}" class="sidebar-link magnetic" data-sidebar-key="${link.key}">${link.icon}<span class="sidebar-link-text">${link.label}</span></a>`;
      body = body.replace(new RegExp(`<a\\b[^>]*data-sidebar-key="${beforeKey}"`), match => anchor + match);
    }
    return open + body + close;
  });
}

// Reuse the existing canonical shell; empty module hosts must not wait for JS
// before acquiring their navigation, profile and first-paint geometry.
function createPremiumSidebarShell() {
  let template;
  return function renderPremiumSidebarShell(html, authState) {
    const emptyHost = /<aside\b([^>]*\bclass=["'][^"']*\bsidebar\b[^"']*["'][^>]*)>\s*<\/aside>/i;
    if (!emptyHost.test(html)) return normalizeSidebarLinks(html);
    if (template === undefined) {
      const source = fs.readFileSync(path.join(__dirname, '../../premium-lead-radar-shell.html'), 'utf8');
      template = source.match(/<aside\b[^>]*data-static-sidebar="1"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
      if (!template) throw new Error('Canonical premium sidebar ontbreekt');
    }
    let navigation = template;
    if (!authState?.authenticated || authState.role !== 'admin') {
      navigation = navigation.replace(/<a\b[^>]*data-sidebar-key="passwords"[^>]*>[\s\S]*?<\/a>/g, '');
    }
    navigation = navigation.replace(/\bclass="([^"]*)\bactive\b([^"]*)"/g, 'class="$1$2"');
    return normalizeSidebarLinks(html.replace(emptyHost, (_match, attributes) => {
      const attrs = attributes.replace(/\sdata-static-sidebar=["'][^"']*["']/g, '');
      return `<aside${attrs} data-static-sidebar="1">${navigation}</aside><script src="/assets/premium-sidebar-profile-prefill.js?v=20260909a"></script>`;
    }));
  };
}

module.exports = { createPremiumSidebarShell };
