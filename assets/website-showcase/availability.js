(() => {
  'use strict';
  const availability = document.querySelector('[data-website-availability]');
  if (!availability) return;

  const monthFormatter = new Intl.DateTimeFormat('nl-NL', {
    month: 'long',
    timeZone: 'Europe/Amsterdam'
  });
  function updateAvailability() {
    availability.textContent = `4 plekken beschikbaar in ${monthFormatter.format(new Date())}.`;
  }

  updateAvailability();
  window.setInterval(updateAvailability, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateAvailability();
  });
})();
