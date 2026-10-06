(() => {
  'use strict';
  function startAvailability(pageDocument, timers, currentDate = () => new Date()) {
    const availability = pageDocument.querySelector('[data-website-availability]');
    if (!availability) return;

    const monthFormatter = new Intl.DateTimeFormat('nl-NL', {
      month: 'long',
      timeZone: 'Europe/Amsterdam'
    });
    function updateAvailability() {
      availability.textContent = `4 plekken beschikbaar in ${monthFormatter.format(currentDate())}.`;
    }

    updateAvailability();
    timers.setInterval(updateAvailability, 60_000);
    pageDocument.addEventListener('visibilitychange', () => {
      if (!pageDocument.hidden) updateAvailability();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { startAvailability };
  } else {
    startAvailability(document, window);
  }
})();
