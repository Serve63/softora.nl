(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const roles = [
    { title: 'Jouw receptionist', detail: 'Neemt op en helpt verder', preview: 'Goedemiddag! Waar kan ik je mee helpen?', lines: ['Goedemiddag! Je spreekt met de AI-receptionist. Waar kan ik je mee helpen?', 'Een afspraak maken? Natuurlijk. Welke dag komt je goed uit?', 'Zo kan jouw medewerker straks de telefoon aannemen en afspraken plannen. Dit is een voorbeeld; er wordt niets geboekt.'] },
    { title: 'Jouw klantenservice', detail: 'Luistert en denkt met je mee', preview: 'Vertel gerust. Ik kijk graag met je mee.', lines: ['Goedemiddag, je spreekt met de AI-klantenservice. Vertel gerust waar je tegenaan loopt.', 'Ik begrijp het. Laten we samen stap voor stap naar een oplossing kijken.', 'Komt er een collega bij kijken? Dan kan je medewerker de vraag overdragen. In deze demo wordt er niets doorgestuurd.'] },
    { title: 'Jouw verkoopassistent', detail: 'Helpt je klant de juiste keuze maken', preview: 'Wat zoek je? Ik help je graag kiezen.', lines: ['Leuk dat je interesse hebt. Ik ben de AI-verkoopassistent. Waar ben je naar op zoek?', 'Wat is voor jou het belangrijkst? Dan kan ik de mogelijkheden met je vergelijken.', 'Wil je verder kennismaken met een adviseur? Dan kan jouw medewerker straks een afspraak plannen. Deze demo boekt nog niets.'] }
  ];
  const employees = [
    { name: 'Emma', photo: 'reception-portrait.webp' },
    { name: 'Daan', photo: 'employee-daan.webp' },
    { name: 'Sam', photo: 'employee-sam.webp' },
    { name: 'Lina', photo: 'employee-lina.webp' },
    { name: 'Thomas', photo: 'employee-thomas.webp' }
  ];
  let employeeIndex = 0;
  const synth = window.speechSynthesis;
  function updateEmployee() {
    const employee = employees[employeeIndex];
    $('employee-photo').src = `/assets/voicesoftware/${employee.photo}`;
    $('employee-photo').alt = `${employee.name}, AI-medewerker met headset aan een ontvangstbalie`;
    $('employee-name').textContent = employee.name;
    $('employee-count').textContent = `${employeeIndex + 1} / ${employees.length}`;
    $('role-title').textContent = `${employee.name} · ${roles[selected].title.replace('Jouw ', '')}`;
  }
  function changeEmployee(step) {
    stop();
    employeeIndex = (employeeIndex + step + employees.length) % employees.length;
    updateEmployee();
  }
  $('employee-prev').addEventListener('click', () => changeEmployee(-1));
  $('employee-next').addEventListener('click', () => changeEmployee(1));
  document.querySelector('.employee-picker').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      changeEmployee(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  employees.slice(1).forEach((employee) => { const image = new Image(); image.src = `/assets/voicesoftware/${employee.photo}`; });
  let selected = 0, playing = false, run = 0, timer, utterance;
  synth?.getVoices();
  function renderButtons() {
    document.body.classList.toggle('playing', playing);
    document.querySelector('.play-copy').textContent = playing ? 'Stop de demo' : 'Beluister de demo';
    document.querySelectorAll('[data-play]').forEach((button) => button.setAttribute('aria-label', playing ? 'Demo stoppen' : 'Demo afspelen'));
  }
  function stop(reset = true) {
    run += 1;
    clearTimeout(timer);
    synth?.cancel();
    utterance = null;
    playing = false;
    renderButtons();
    if (reset) {
      $('transcript').textContent = `“${roles[selected].preview}”`;
      $('call-status').textContent = 'Klaar voor het eerste gesprek';
    }
  }
  function line(index, token) {
    if (token !== run || !playing) return;
    const text = roles[selected].lines[index];
    if (!text) {
      playing = false;
      renderButtons();
      $('call-status').textContent = 'Demo afgelopen · Beluister gerust een andere rol';
      return;
    }
    $('transcript').textContent = `“${text}”`;
    const voice = synth?.getVoices().find((v) => /^nl/i.test(v.lang) && v.localService);
    let advanced = false;
    const next = () => {
      if (token !== run || advanced) return;
      advanced = true;
      clearTimeout(timer);
      timer = setTimeout(() => line(index + 1, token), 350);
    };
    $('call-status').textContent = voice ? `Voorbeeldgesprek · ${index + 1} van 3` : 'Geen lokale Nederlandse stem · Lees de demo mee';
    if (voice) {
      utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = 'nl-NL';
      utterance.rate = .96;
      utterance.onend = next;
      utterance.onerror = () => {
        if (token !== run) return;
        clearTimeout(timer);
        $('call-status').textContent = 'Stem niet beschikbaar · Lees de demo mee';
        timer = setTimeout(next, Math.max(4500, text.split(' ').length * 260));
      };
      synth.speak(utterance);
      timer = setTimeout(() => { if (token === run) { synth.cancel(); next(); } }, 25000);
    } else timer = setTimeout(next, Math.max(4500, text.split(' ').length * 260));
  }
  document.querySelectorAll('[data-play]').forEach((button) => button.addEventListener('click', () => {
    if (playing) { stop(); return; }
    stop();
    playing = true;
    renderButtons();
    $('demo').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    line(0, run);
  }));
  document.querySelectorAll('[data-role]').forEach((button) => button.addEventListener('click', () => {
    stop();
    selected = Number(button.dataset.role);
    document.querySelectorAll('[data-role]').forEach((item) => {
      const active = Number(item.dataset.role) === selected;
      item.classList.toggle('selected', active);
      item.setAttribute('aria-pressed', String(active));
    });
    updateEmployee();
    $('role-detail').textContent = roles[selected].detail;
    $('demo').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    $('transcript').textContent = `“${roles[selected].preview}”`;
  }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && playing) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', () => stop());
})();
