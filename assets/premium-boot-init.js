(function () {
  var root = document.documentElement;
  root.setAttribute('data-personnel-loading', 'true');

  try {
    root.setAttribute('data-theme-mode', 'light');
    root.setAttribute('data-theme', 'light');
  } catch (_) {
    /* ignore */
  }
})();
