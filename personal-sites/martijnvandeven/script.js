(() => {
  const body = document.body;
  const menuButton = document.querySelector('.menu-button');
  const nav = document.querySelector('.site-nav');
  const copyButton = document.querySelector('.copy-email');
  const copyStatus = document.querySelector('.copy-status');

  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  const setMenuOpen = (open) => {
    body.classList.toggle('menu-open', open);
    menuButton?.setAttribute('aria-expanded', String(open));
  };

  menuButton?.addEventListener('click', () => setMenuOpen(!body.classList.contains('menu-open')));
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenuOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenuOpen(false);
  });

  copyButton?.addEventListener('click', async () => {
    const email = copyButton.dataset.email || '';
    try {
      await navigator.clipboard.writeText(email);
      copyStatus.textContent = 'E-mailadres gekopieerd.';
    } catch {
      copyStatus.textContent = email;
    }
  });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealNodes = document.querySelectorAll('.reveal');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealNodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  revealNodes.forEach((node) => observer.observe(node));
})();
