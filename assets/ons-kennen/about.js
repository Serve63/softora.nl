'use strict';
(() => {
  const projects = {
    aster: {
      name: 'Studio Aster', category: 'WEBSITE CONCEPT',
      description: 'Een denkbeeldige architectenstudio met een rustige, redactionele website. Grote projectbeelden, heldere typografie en een korte route naar kennismaken laten het werk spreken.',
      features: ['Een eigen visuele identiteit', 'Ruimte voor projecten en hun verhaal', 'Een heldere route naar contact'],
    },
    flow: {
      name: 'Flowdesk', category: 'SOFTWARE CONCEPT',
      description: 'Een denkbeeldige werkplek voor een projectteam. Dit dashboard laat zien hoe projecten, planning en taken bij elkaar kunnen komen, afgestemd op de manier waarop een bedrijf werkt.',
      features: ['Projecten en taken in één overzicht', 'Inzicht in planning en voortgang', 'Een interface op maat voor je team'],
    },
    milo: {
      name: 'Milo', category: 'AI CONCEPT',
      description: 'Een denkbeeldige digitale assistent voor een dienstverlener. Het voorbeeldgesprek laat zien hoe een bezoeker van een eerste vraag naar een passende vervolgstap kan worden geholpen.',
      features: ['Antwoorden in de toon van je bedrijf', 'Begeleiding naar een afspraak of contact', 'Een toegankelijke chat op je website'],
    },
  };
  const cards = Array.from(document.querySelectorAll('.project'));
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const controls = document.querySelector('.portfolio-controls');
  const counter = document.querySelector('.portfolio-count');
  const dialog = document.querySelector('.project-dialog');
  const closeButton = dialog.querySelector('.dialog-close');
  let opener;

  controls.hidden = false;
  filters.forEach((button) => button.addEventListener('click', () => {
    filters.forEach((filter) => filter.setAttribute('aria-pressed', String(filter === button)));
    let count = 0;
    cards.forEach((card) => {
      card.hidden = button.dataset.filter !== 'all' && card.dataset.category !== button.dataset.filter;
      if (!card.hidden) count += 1;
    });
    counter.textContent = count === 1 ? '1 concept' : `${count} concepten`;
  }));

  document.querySelectorAll('[data-project]').forEach((button) => {
    button.hidden = false;
    button.addEventListener('click', () => {
      const project = projects[button.dataset.project];
      if (!project) return;
      opener = button;
      document.querySelector('#dialog-title').textContent = project.name;
      document.querySelector('#dialog-category').textContent = project.category;
      document.querySelector('#dialog-description').textContent = project.description;
      const features = project.features.map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      });
      dialog.querySelector('.dialog-features').replaceChildren(...features);
      const visual = button.closest('.project').querySelector('.project-visual').cloneNode(true);
      dialog.querySelector('.dialog-visual').replaceChildren(visual);
      dialog.showModal();
      document.body.classList.add('dialog-is-open');
    });
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const first = closeButton;
    const last = dialog.querySelector('a[href]');
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-is-open');
    opener?.focus({ preventScroll: true });
  });
})();
