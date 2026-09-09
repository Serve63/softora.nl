const fs = require('node:fs');
const path = require('node:path');
const { getPremiumSidebarSections, renderSidebarLink, renderPremiumSidebarNavigation } = require('../../assets/premium-sidebar-links');

function normalizeSidebarLinks(html, authState, fileName) {
  const pagePath = '/' + String(fileName || '').replace(/\.html$/, '');
  const pageKey = /premium-lead-radar/.test(pagePath) ? 'lead_radar'
    : /premium-(?:world-watcher|flynow|wereldmap|gezondheidsdossier|kvk-)|\/kvk-database/.test(pagePath) ? 'settings'
      : getPremiumSidebarSections(authState).flatMap(section => section.links).find(link => link.href === pagePath)?.key;

  const rendered = html.replace(/(<aside\b[^>]*data-static-sidebar="1"[^>]*>)([\s\S]*?)(<\/aside>)/gi, (_match, open, body, close) => {
    const activeKey = pageKey || body.match(/<a\b(?=[^>]*class="[^"]*\bactive\b)(?=[^>]*data-sidebar-key="([^"]+)")[^>]*>/)?.[1] || '';
    if (/<nav\b[^>]*class="[^"]*\bsidebar-nav\b/.test(body)) {
      body = body.replace(/(<nav\b[^>]*class="[^"]*\bsidebar-nav\b[^>]*>)[\s\S]*?(<\/nav>)/, (_nav, start, end) => start + renderPremiumSidebarNavigation(authState, activeKey) + end);
    } else {
      const links = new Map(getPremiumSidebarSections(authState).flatMap(section => section.links).map(link => [link.key, link]));
      body = body.replace(/<a\b[^>]*data-sidebar-key="([^"]+)"[^>]*>[\s\S]*?<\/a>/g, (anchor, key) => links.has(key) ? renderSidebarLink(links.get(key), activeKey) : (key === 'passwords' ? '' : anchor));
    }
    return open + body + close;
  });
  if (!rendered.includes('data-static-sidebar="1"')) return rendered;
  return rendered.replace(/<body\b([^>]*)>/i, (_body, attributes) => {
    const attrs = attributes.replace(/\sdata-sidebar-nav-ready="[^"]*"/g, '');
    return `<body${attrs} data-sidebar-nav-ready="1">`;
  });
}

// Reuse the existing canonical shell; empty module hosts must not wait for JS
// before acquiring their navigation, profile and first-paint geometry.
function createPremiumSidebarShell() {
  let template;
  return function renderPremiumSidebarShell(html, authState, fileName) {
    const emptyHost = /<aside\b([^>]*\bclass=["'][^"']*\bsidebar\b[^"']*["'][^>]*)>\s*<\/aside>/i;
    if (!emptyHost.test(html)) return normalizeSidebarLinks(html, authState, fileName);
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
      return `<aside${attrs} data-static-sidebar="1">${navigation}</aside><script src="/assets/premium-sidebar-profile-prefill.js?v=20260909b"></script>`;
    }), authState, fileName);
  };
}

module.exports = { createPremiumSidebarShell };
