(function () {
  'use strict';
  const destinations = [
    { id: 'santorini', name: 'Santorini', country: 'Griekenland', mode: 'zon', photo: 'zon-photo-1', tag: 'Voor de zonsondergang', period: 'Mei – oktober', airport: 'Santorini (JTR)', mood: 'Uitzicht & romantiek',
      alt: 'Witte huizen en windmolens in Oia bij zonsondergang', summary: 'Witte dorpjes. Blauwe koepels. Gouden avonden.', description: 'Dwaal door de steegjes van Oia, lunch met uitzicht op de caldera en laat de avond langzaam beginnen. Santorini is een eiland om de tijd te vergeten.', tip: 'Loop een deel van het kustpad tussen Fira en Oia. Ga vroeg op pad en neem water mee.' },
    { id: 'algarve', name: 'Algarve', country: 'Portugal', mode: 'zon', photo: 'zon-photo-8', tag: 'Voor de kleine baaien', period: 'Mei – oktober', airport: 'Faro (FAO)', mood: 'Kust & roadtrip',
      alt: 'Rotsformaties aan de blauwe Atlantische kust bij Lagos', summary: 'Verscholen baaien en kilometers kust.', description: 'Volg de kust langs goudkleurige kliffen, kleine vissersplaatsen en stranden waar je langer wilt blijven. In de Algarve combineer je rustige dagen aan zee met een roadtrip zonder haast.', tip: 'Gebruik Lagos als uitvalsbasis voor de westelijke kust. Controleer het getij voordat je naar kleine stranden gaat.' },
    { id: 'mallorca', name: 'Mallorca', country: 'Spanje', mode: 'zon', photo: 'zon-photo-5', tag: 'Het beste van twee werelden', period: 'Mei – oktober', airport: 'Palma de Mallorca (PMI)', mood: 'Strand & stad',
      alt: 'De kathedraal van Palma de Mallorca aan het water', summary: 'Een ochtend in Palma, een middag aan zee.', description: 'Begin met koffie in Palma en eindig aan een rustige baai. Tussen die twee liggen bergdorpen, olijfgaarden en de bochtige wegen van de Serra de Tramuntana.', tip: 'Huur een auto als je het eiland wilt verkennen. Neem ook een dag voor Sóller en de dorpen in de Tramuntana.' },
    { id: 'ibiza', name: 'Ibiza', country: 'Spanje', mode: 'zon', photo: 'zon-photo-10', tag: 'Op jouw tempo', period: 'Mei – oktober', airport: 'Ibiza (IBZ)', mood: 'Baaien & lange avonden',
      alt: 'Uitzicht op Ibiza en de Middellandse Zee', summary: 'Blote voeten, kleine baaien, lange avonden.', description: 'Ibiza heeft meerdere ritmes. Zoek de rust op aan de noordkust, struin door Dalt Vila en kies zelf of de dag eindigt bij zonsondergang of pas veel later.', tip: 'Kies je verblijf op basis van je tempo: het noorden voor rust, de omgeving van Ibiza-stad voor meer levendigheid.' },
    { id: 'tenerife', name: 'Tenerife', country: 'Spanje', mode: 'zon', photo: 'zon-photo-3', tag: 'Een eiland vol contrast', period: 'Het hele jaar', airport: 'Tenerife Zuid (TFS)', mood: 'Natuur & oceaan',
      alt: 'De kust van Tenerife met de oceaan op de achtergrond', summary: 'Van vulkaanlandschap naar de oceaan.', description: 'Rijd van de kust naar het vulkanische landschap van de Teide. Tenerife geeft je stranddagen, bergwegen en groene wandelroutes op één eiland.', tip: 'Neem een warme laag mee voor de bergen. Voor sommige routes op de Teide heb je vooraf een vergunning nodig.' },
    { id: 'kreta', name: 'Kreta', country: 'Griekenland', mode: 'zon', photo: 'zon-photo-9', tag: 'Nog één dag blijven', period: 'Mei – oktober', airport: 'Chania (CHQ) of Heraklion (HER)', mood: 'Strand & Grieks eten',
      alt: 'De kust en het landschap van Kreta', summary: 'Taverna’s, turquoise water en alle tijd.', description: 'Een lange lunch onder de bomen, een baai met helder water en een haven vol leven. Kreta is groot genoeg voor een avontuur en ontspannen genoeg om weinig te plannen.', tip: 'Kies eerst een kant van het eiland. De afstanden zijn groter dan je denkt; een verblijf bij Chania of Rethymnon is een fijn begin.' },
    { id: 'zermatt', name: 'Zermatt', country: 'Zwitserland', mode: 'snow', photo: 'sneeuw-photo-1', tag: 'Met de Matterhorn als decor', period: 'December – april', airport: 'Genève (GVA) + trein', mood: 'Alpen & uitzicht',
      alt: 'Zermatt bij avondlicht met de Matterhorn op de achtergrond', summary: 'Grote bergen. Kleine zorgen.', description: 'Een autovrij dorp, warme chalets en de Matterhorn die boven alles uitsteekt. Zermatt maakt van een paar dagen in de bergen een reis die bijblijft.', tip: 'Je bereikt het dorp per trein. Vergelijk vlucht én treinreis, en controleer sneeuwcondities en geopende liften voor vertrek.' },
    { id: 'chamonix', name: 'Chamonix', country: 'Frankrijk', mode: 'snow', photo: 'sneeuw-photo-2', tag: 'Voor het berggevoel', period: 'December – april', airport: 'Genève (GVA) + transfer', mood: 'Avontuur & bergdorp',
      alt: 'Alpenlandschap bij Chamonix', summary: 'Wakker worden aan de voet van de Mont Blanc.', description: 'Chamonix is levendig, sportief en omringd door indrukwekkende pieken. Combineer dagen in de sneeuw met goede koffie en lange avonden in het dorp.', tip: 'De skigebieden liggen verspreid door de vallei. Kies een verblijf dat past bij het gebied waar je wilt skiën.' },
    { id: 'innsbruck', name: 'Innsbruck', country: 'Oostenrijk', mode: 'snow', photo: 'sneeuw-photo-5', tag: 'Stad met berglucht', period: 'December – maart', airport: 'Innsbruck (INN)', mood: 'Stad & ski',
      alt: 'Innsbruck in het Oostenrijkse Alpenlandschap', summary: 'Een stedentrip met de bergen om de hoek.', description: 'Middeleeuwse straatjes beneden, bergtoppen boven je. In Innsbruck hoef je niet te kiezen tussen een stad ontdekken en de sneeuw opzoeken.', tip: 'Bekijk vooraf welke skigebieden en bussen bij je skipas horen. Een centrale uitvalsbasis geeft veel flexibiliteit.' },
    { id: 'val-thorens', name: 'Val Thorens', country: 'Frankrijk', mode: 'snow', photo: 'sneeuw-photo-3', tag: 'Voor lange skidagen', period: 'December – april', airport: 'Genève (GVA) + transfer', mood: 'Ski & hooggebergte',
      alt: 'Berglandschap bij Val Thorens in de Franse Alpen', summary: 'Hoog in de Alpen, midden in de sneeuw.', description: 'Val Thorens ligt midden in het grote skigebied Les 3 Vallées. Een bestemming voor wie het liefst vroeg op de piste staat en de hele dag buiten is.', tip: 'Plan voldoende tijd voor de transfer en boek deze vooraf. Controleer het actuele lift- en pisteoverzicht.' },
    { id: 'st-moritz', name: 'St. Moritz', country: 'Zwitserland', mode: 'snow', photo: 'sneeuw-photo-7', tag: 'Een vleugje alpine luxe', period: 'December – maart', airport: 'Zürich (ZRH) + trein', mood: 'Comfort & berglucht',
      alt: 'St. Moritz in het Zwitserse Engadin', summary: 'Heldere berglucht en een rustig tempo.', description: 'Het Engadin combineert grote vergezichten met stijlvolle hotels en rustige bergdorpen. St. Moritz is een fijne uitvalsbasis voor skiën, wandelen en lange lunches.', tip: 'De treinreis door Graubünden is een deel van de ervaring. Houd rekening met een langere reistijd vanaf de luchthaven.' },
    { id: 'zell-am-see', name: 'Zell am See', country: 'Oostenrijk', mode: 'snow', photo: 'sneeuw-photo-8', tag: 'Aan het meer, in de bergen', period: 'December – maart', airport: 'Salzburg (SZG) + transfer', mood: 'Bergdorp & ontspanning',
      alt: 'Zell am See met het meer en omliggende bergen', summary: 'Een meer, een bergdorp en frisse berglucht.', description: 'Zell am See geeft je het klassieke Oostenrijkse wintergevoel. Slenter langs het meer, zoek de pistes op en kom thuis in een warm bergdorp.', tip: 'Bekijk ook de mogelijkheden bij Kaprun. Controleer welke gebieden onder je skipas vallen en hoe je er komt.' }
  ];
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function selectDestinations(mode, country, query) {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return destinations.filter((item) => item.mode === mode && (!country || item.country === country) && words.every((word) => normalize([item.name, item.country, item.mood, item.summary, item.tag].join(' ')).includes(word)));
  }
  function travelUrl(item, kind) {
    const query = kind === 'flights' ? 'Vluchten naar ' + item.airport : 'Hotels in ' + item.name + ' ' + item.country;
    return 'https://www.google.com/travel/' + (kind === 'flights' ? 'flights' : 'search') + '?q=' + encodeURIComponent(query);
  }
  if (typeof module === 'object' && module.exports) module.exports = { destinations, selectDestinations, travelUrl };
  if (typeof document === 'undefined') return;
  const byId = (id) => document.getElementById(id);
  const photoUrl = (item) => '/assets/flynow/flynow-' + item.photo + '.jpg';
  const state = { mode: 'zon', country: '', query: '' };
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function renderCountries() {
    const countries = ['', ...new Set(destinations.filter((item) => item.mode === state.mode).map((item) => item.country))];
    byId('fn-countries').replaceChildren(...countries.map((country) => {
      const button = element('button', 'fn-country', country || 'Alles ontdekken');
      button.type = 'button'; button.dataset.country = country;
      button.setAttribute('aria-pressed', String(state.country === country));
      return button;
    }));
  }
  function renderDestinations() {
    const items = selectDestinations(state.mode, state.country, state.query);
    byId('fn-grid').replaceChildren(...items.map((item) => {
      const card = element('article', 'fn-card'), button = element('button', 'fn-card-button'), media = element('div', 'fn-card-media');
      button.type = 'button'; button.dataset.destination = item.id; button.setAttribute('aria-label', 'Ontdek ' + item.name);
      const image = element('img'); image.src = photoUrl(item); image.alt = item.alt; image.width = 800; image.height = 540; image.loading = 'lazy'; image.decoding = 'async';
      media.append(image, element('span', 'fn-card-tag', item.tag));
      const info = element('div', 'fn-card-info'), top = element('div', 'fn-card-top'), title = element('div');
      title.append(element('span', 'fn-card-country', item.country), element('h3', '', item.name));
      const arrow = element('span', 'fn-card-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true'); top.append(title, arrow);
      const meta = element('div', 'fn-card-meta'); meta.append(element('span', '', item.period), element('span', '', item.mood));
      info.append(top, element('p', '', item.summary), meta); button.append(media, info); card.append(button); return card;
    }));
    byId('fn-empty').hidden = items.length > 0;
    byId('fn-count').textContent = items.length + (items.length === 1 ? ' bestemming' : ' bestemmingen');
  }
  function setMode(mode) {
    state.mode = mode === 'snow' ? 'snow' : 'zon'; state.country = ''; state.query = ''; byId('fn-search').value = '';
    const snow = state.mode === 'snow', featured = destinations.find((item) => item.id === (snow ? 'zermatt' : 'santorini'));
    document.body.setAttribute('data-flynow-type', state.mode);
    document.querySelectorAll('[data-flynow-tab]').forEach((tab) => { const active = tab.dataset.flynowTab === state.mode; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    byId('fn-explore').setAttribute('aria-labelledby', 'fn-tab-' + state.mode);
    byId('fn-hero-image').src = photoUrl(featured); byId('fn-hero-image').alt = featured.alt;
    const emphasis = element('em', '', snow ? 'frisse berglucht.' : 'vliegtuigstand.');
    byId('fn-hero-title').replaceChildren(document.createTextNode(snow ? 'Een hoofd vol' : 'Alles even op'), element('br'), emphasis);
    byId('fn-hero-description').textContent = snow ? 'Hoge toppen. Warme chalets. Helemaal buiten.' : 'Zoute lucht. Lange avonden. Nergens haast.';
    byId('fn-hero-kicker').textContent = snow ? 'Waar je vanzelf dieper ademhaalt' : 'Een beetje verder van alledag';
    byId('fn-hero-open').replaceChildren(document.createTextNode('Ontdek ' + featured.name + ' '), element('span', '', '↗'));
    byId('fn-hero-open').dataset.destination = featured.id;
    byId('fn-hero-location').replaceChildren(document.createTextNode(snow ? 'Zermatt, Matterhorn' : 'Oia, Santorini'), element('br'), element('small', '', snow ? 'Zwitserland · 46.02° N, 7.75° E' : 'Griekenland · 36.46° N, 25.38° E'));
    byId('fn-hero-index').textContent = snow ? '02 / 02' : '01 / 02'; byId('fn-collection-label').textContent = snow ? 'De bergcollectie' : 'De zoncollectie';
    renderCountries(); renderDestinations();
  }
  let detailTrigger;
  function openDestination(id, trigger) {
    const item = destinations.find((destination) => destination.id === id); if (!item) return;
    detailTrigger = trigger;
    byId('fn-detail-image').src = photoUrl(item); byId('fn-detail-image').alt = item.alt;
    byId('fn-detail-country').textContent = item.country; byId('fn-detail-title').textContent = item.name;
    byId('fn-detail-description').textContent = item.description; byId('fn-detail-tip').textContent = item.tip;
    byId('fn-detail-facts').replaceChildren(...[['Reisperiode', item.period], ['Aankomst & verder reizen', item.airport]].map(([label, value]) => { const fact = element('dl'); fact.append(element('dt', '', label), element('dd', '', value)); return fact; }));
    byId('fn-flights').href = travelUrl(item, 'flights'); byId('fn-stays').href = travelUrl(item, 'stays');
    byId('fn-dialog').showModal();
  }
  function lockFlyNowSidebarShell() {
    const sidebar = document.querySelector('.flynow-layout > .sidebar[data-flynow-sidebar-host="1"]');
    if (!sidebar || !sidebar.children.length) return false;
    sidebar.setAttribute('data-static-sidebar', '1'); sidebar.setAttribute('data-sidebar-ready', 'true');
    sidebar.classList.remove('sidebar-fit-compact', 'sidebar-fit-tight'); sidebar.style.transform = ''; sidebar.style.translate = ''; sidebar.style.willChange = ''; return true;
  }
  const sidebar = document.querySelector('.flynow-layout > .sidebar');
  function syncFlyNowNavigation() {
    sidebar.querySelectorAll('.sidebar-link').forEach((link) => { const active = link.getAttribute('href') === '/premium-instellingen'; if (link.classList.contains('active') !== active) link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
  }
  if (sidebar) { syncFlyNowNavigation(); const navigationObserver = new MutationObserver(syncFlyNowNavigation); navigationObserver.observe(sidebar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); }
  if (!lockFlyNowSidebarShell() && sidebar) { const observer = new MutationObserver(() => { if (lockFlyNowSidebarShell()) observer.disconnect(); }); observer.observe(sidebar, { childList: true }); }
  document.querySelector('.flynow-main').addEventListener('click', (event) => {
    const destination = event.target.closest('[data-destination]'); if (destination) openDestination(destination.dataset.destination, destination);
    const tab = event.target.closest('[data-flynow-tab]'); if (tab) setMode(tab.dataset.flynowTab);
    const country = event.target.closest('[data-country]');
    if (country) { state.country = country.dataset.country; byId('fn-countries').querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button === country))); renderDestinations(); }
  });
  document.querySelector('.fn-modes').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const mode = event.key === 'Home' ? 'zon' : event.key === 'End' ? 'snow' : state.mode === 'zon' ? 'snow' : 'zon'; setMode(mode); byId('fn-tab-' + mode).focus();
  });
  byId('fn-search').addEventListener('input', (event) => { state.query = event.target.value; renderDestinations(); });
  byId('fn-reset').addEventListener('click', () => { setMode(state.mode); byId('fn-search').focus(); });
  byId('fn-close').addEventListener('click', () => byId('fn-dialog').close());
  byId('fn-dialog').addEventListener('click', (event) => { if (event.target !== byId('fn-dialog')) return; const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); });
  byId('fn-dialog').addEventListener('close', () => { if (detailTrigger && detailTrigger.isConnected) detailTrigger.focus(); });
  function toggleNavigation(open) {
    document.body.classList.toggle('fn-nav-open', open);
    byId('fn-menu').setAttribute('aria-expanded', String(open)); byId('fn-menu').setAttribute('aria-label', open ? 'Sluit navigatie' : 'Open navigatie');
    byId('fn-menu').textContent = open ? '×' : '☰'; byId('fn-nav-backdrop').hidden = !open;
    if (!open) byId('fn-menu').focus();
  }
  byId('fn-menu').addEventListener('click', () => toggleNavigation(!document.body.classList.contains('fn-nav-open')));
  byId('fn-nav-backdrop').addEventListener('click', () => toggleNavigation(false));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('fn-nav-open')) toggleNavigation(false); });
  window.matchMedia('(max-width:900px)').addEventListener('change', () => { if (document.body.classList.contains('fn-nav-open')) toggleNavigation(false); });
  setMode('zon');
})();
