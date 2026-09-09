(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSettingsNavigation = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function initialize(target, goTo) {
    // Categories are local UI, independent of session/team request latency.
    if (target.SoftoraPremiumBoot) target.SoftoraPremiumBoot.setShellBooting(false);
    target.addEventListener('hashchange', function () {
      if (target.location.hash === '#extra') goTo('screen-extra');
      else if (target.document.getElementById('screen-extra')?.classList.contains('active')) goTo('screen-overzicht');
    });
  }
  return { initialize };
});
