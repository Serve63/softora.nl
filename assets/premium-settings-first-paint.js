(function (initialize) {
    if (typeof module === 'object' && module.exports) module.exports = { initialize };
    else initialize(window, document);
})(function (window, document) {
  const extra = document.querySelector('[data-settings-extra-static="1"]');
  const overview = document.getElementById('screen-overzicht');
  if (!extra || !overview || extra.dataset.navigationBound === '1') return;
  extra.dataset.navigationBound = '1';

  function sync() {
    if (window.location.hash === '#extra') {
      document.querySelectorAll('.screen.active').forEach(screen => screen.classList.remove('active'));
      extra.classList.add('active');
    } else if (extra.classList.contains('active')) {
      extra.classList.remove('active');
      overview.classList.add('active');
    }
  }
  document.addEventListener('click', function (event) {
    const control = event.target.closest?.('[data-settings-extra-open], [data-settings-extra-back]');
    if (!control) return;
    event.preventDefault();
    if (control.hasAttribute('data-settings-extra-open')) {
      if (window.location.hash !== '#extra') window.history.pushState(null, '', '#extra');
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    sync();
  });
  window.addEventListener('hashchange', sync);
  sync();
});
