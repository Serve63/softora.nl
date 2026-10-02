(() => {
  'use strict';
  const links = [...document.querySelectorAll('.index-list a[href^="#"]')];
  const headings = [...document.querySelectorAll('.article-prose h2[id]')];
  if (!headings.length) return;
  let scheduled = false;

  function updateCurrentSection() {
    scheduled = false;
    let current = null;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > 160) break;
      current = heading.id;
    }
    links.forEach((link) => {
      if (link.hash === '#' + current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateCurrentSection);
  }

  links.forEach((link) => {
    link.addEventListener('click', () => {
      const target = document.getElementById(link.hash.slice(1));
      if (!target) return;
      const mobileIndex = link.closest('.mobile-index');
      if (mobileIndex) mobileIndex.open = false;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
  });
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('load', scheduleUpdate);
  updateCurrentSection();
})();
