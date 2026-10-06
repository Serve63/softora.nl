(() => {
  const root = document.querySelector('.work-carousel');
  if (!root) return;
  const cards = [...root.querySelectorAll('[data-work-card]')];
  const dots = [...root.querySelectorAll('[data-work-dot]')];
  const descriptions = ['Het karakter van de salon, vertaald naar een eigen online uitstraling.', 'Een duidelijke, sterke presentatie van persoonlijke begeleiding.', 'Direct een overzichtelijk beeld dat vertrouwen geeft.', 'Medewerkers aandacht geven en waardering laten zien.', 'Technische kennis voor industriële machinebouw.', 'Kleinschalige dagbeleving met aandacht voor de persoon.'];
  const names = ['Salon TOF', 'LinsZorgT', 'Administratieportaal', 'Aangedacht', 'IMOTA', 'Dagbeleving LevensKracht'];
  let active = 0;
  function show(index) {
    active = (index + cards.length) % cards.length;
    cards.forEach((card, i) => {
      let position = (i - active + cards.length) % cards.length;
      card.dataset.position = String(position);
      const visible = position < 4;
      card.style.order = String(position);
      card.inert = !visible;
      card.setAttribute('aria-hidden', String(!visible));
      card.setAttribute('aria-label', `Bekijk website van ${names[i]} (nieuw tabblad)`);
    });
    dots.forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === active)));
    root.querySelector('.work-caption h3').textContent = names[active];
    root.querySelector('.work-caption p').textContent = descriptions[active];
  }
  root.querySelector('.work-prev').addEventListener('click', () => show(active - 1));
  root.querySelector('.work-next').addEventListener('click', () => show(active + 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));
  root.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(active + (event.key === 'ArrowRight' ? 1 : -1)); }
  });
  show(0);
})();
