(function () {
  document.documentElement.setAttribute('data-personnel-loading', 'true');
  try {
    document.documentElement.setAttribute('data-theme-mode', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
  } catch (_) {
    /* ignore */
  }
})();
