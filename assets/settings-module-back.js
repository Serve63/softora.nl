(() => {
  const routes = window.SoftoraSettingsModuleRoutes;
  const module = routes?.findByPath?.(window.location.pathname);
  const hosts = Array.from(document.querySelectorAll('[data-settings-module-back-host]'));
  if (!module || hosts.length !== 1 || document.querySelector('.settings-module-back')) return;

  const link = document.createElement('a');
  link.className = 'settings-module-back';
  link.href = routes.RETURN_HREF;
  link.setAttribute('aria-label', 'Terug naar instellingen');
  link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg><span>Terug naar instellingen</span>';
  hosts[0].replaceChildren(link);
})();
