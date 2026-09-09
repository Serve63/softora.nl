(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(root);
})(typeof window === 'object' ? window : null, function () {
  function mount(browserWindow) {
    const document = browserWindow?.document;
    const shell = document?.querySelector('.kvk-database-shell[data-sidebar-shell="canonical"]');
    const button = document?.getElementById('kvk-sidebar-toggle');
    if (!shell || !button || button.dataset.mounted) return;
    button.dataset.mounted = 'true';
    let collapsed = browserWindow.history?.state?.kvkSidebarCollapsed === true;
    function render() {
      shell.classList.toggle('is-sidebar-collapsed', collapsed);
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? 'Sidebar uitklappen' : 'Sidebar inklappen');
      button.title = collapsed ? 'Sidebar uitklappen' : 'Sidebar inklappen';
    }
    button.addEventListener('click', () => {
      collapsed = !collapsed;
      render();
      browserWindow.history?.replaceState({ ...browserWindow.history.state, kvkSidebarCollapsed: collapsed }, '');
    });
    render();
  }
  return { mount };
});
