(() => {
  'use strict';
  const $ = (s, parent = document) => parent.querySelector(s);
  const $$ = (s, parent = document) => [...parent.querySelectorAll(s)];
  const header = $('.Nav_header__xs5hx');
  const words = $$('.Probleem_word__Qnvuh');
  const statement = $('.Probleem_statement__8Vs9d');
  function scrollState() {
    header.classList.toggle('Nav_transparent__9icSl', window.scrollY < 40);
    if (statement) {
      const progress = (innerHeight * .85 - statement.getBoundingClientRect().top) / (innerHeight * .55);
      words.forEach((word, i) => { word.style.opacity = Math.max(.18, Math.min(1, (progress * words.length - i) / 3)); });
    }
  }
  addEventListener('scroll', scrollState, { passive: true });
  addEventListener('resize', scrollState);
  scrollState();
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-in'); observer.unobserve(entry.target); }
  }), { threshold: .08 });
  $$('[data-reveal]').forEach(el => observer.observe(el));
  const overlay = $('.Nav_overlay__H80VT');
  const burger = $('.Nav_burger__v332v');
  function toggleNav(open) {
    overlay.classList.toggle('Nav_overlayOpen__f3oz8', open);
    overlay.setAttribute('aria-hidden', String(!open));
    overlay.inert = !open;
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }
  toggleNav(false);
  burger.addEventListener('click', () => toggleNav(burger.getAttribute('aria-expanded') !== 'true'));
  $('.Nav_overlayClose__g7SZ8').addEventListener('click', () => toggleNav(false));
  $$('.Nav_overlayToggle__3CZin').forEach(button => button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    const sub = button.parentElement.parentElement.querySelector('.Nav_overlaySub___Bi_3');
    if (sub) sub.classList.toggle('Nav_overlaySubOpen__VnVpS', expanded);
  }));
  $$('a[href^="#"]', overlay).forEach(link => link.addEventListener('click', () => toggleNav(false)));
  $$('.Werkwijze_trigger__x67J2').forEach(button => button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    button.parentElement.classList.toggle('Werkwijze_rowOpen__aJQd_', open);
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    panel.classList.toggle('Werkwijze_panelOpen__F_oYF', open);
    panel.setAttribute('aria-hidden', String(!open));
  }));
  const follow = $('.Werkwijze_follow__nm_90');
  if (follow && matchMedia('(hover:hover)').matches) {
    $$('.Werkwijze_row__6cXRy').forEach((row, i) => {
      row.addEventListener('pointermove', event => {
        follow.style.left = `${event.clientX + 100}px`;
        follow.style.top = `${event.clientY}px`;
        follow.classList.add('Werkwijze_followOn__KfaD1');
        $$('.Werkwijze_followImg__BVcz6', follow).forEach((img, n) => { img.style.opacity = n === i ? '1' : '0'; });
      });
      row.addEventListener('pointerleave', () => follow.classList.remove('Werkwijze_followOn__KfaD1'));
    });
  }
  let modal;
  let previousFocus;
  function closeModal() {
    modal?.remove(); modal = null; document.body.style.overflow = ''; previousFocus?.focus();
  }
  function openModal() {
    toggleNav(false); previousFocus = document.activeElement;
    modal = document.createElement('div');
    modal.className = 'cosmos-bg RedesignWizard_overlay__n52yH';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Gratis redesign aanvragen');
    modal.innerHTML = `<header class="RedesignWizard_bar__2MTLe"><span class="RedesignWizard_brand__cKFC6">SOFTORA</span><button type="button" class="RedesignWizard_close__cIMT9" aria-label="Sluiten"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></header><div class="RedesignWizard_stageWrap___H0ht"><div class="RedesignWizard_step__Qu3pF"><span class="RedesignWizard_badge__VGsvf"><span class="RedesignWizard_dot__uqmto"></span>Binnen 2 minuten aangevraagd</span><h2 class="RedesignWizard_introTitle__xx04Q">Wij ontwerpen je hero-sectie <span class="accent accent--orange">volledig gratis.</span></h2><p class="RedesignWizard_introBody__A_tjh">Je hero-sectie is het eerste wat bezoekers zien. Wij ontwerpen die opnieuw, zodat je met eigen ogen ziet hoe het sterker kan. Je zit nergens aan vast, en het kost je niets.</p><a class="btn btn-primary" href="/contact"><span class="btn-label">Start je gratis re-design</span><span class="btn-ico" aria-hidden="true">↗</span></a></div></div>`;
    document.body.append(modal); document.body.style.overflow = 'hidden';
    $('button', modal).addEventListener('click', closeModal); $('button', modal).focus();
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = $$('button,a', modal); const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  $$('.Nav_cta__gBZXl,.Nav_overlayCta__mfK3I').forEach(button => button.addEventListener('click', openModal));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { toggleNav(false); closeModal(); }
  });
})();
