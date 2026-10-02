(() => {
  'use strict';
  document.querySelectorAll('[data-followup]').forEach((button) => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    const question = button.textContent.trim().replace(/\s*↗$/, '');
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      panel.hidden = !expanded;
      button.setAttribute('aria-expanded', String(expanded));
      button.replaceChildren(document.createTextNode(expanded ? 'Gesprek opnieuw beginnen ' : question + ' '));
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = expanded ? '↺' : '↗';
      button.append(icon);
    });
  });
})();
