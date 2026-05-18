(function () {
  'use strict';

  var currentType = 'zon';
  var trips = [];
  var rejected = [];
  var collagePhotos = [];

  var PHOTO_LAYOUTS = [
    { top: '-5%', left: '-5%', width: '42%', height: '55%', rotate: -5 },
    { top: '-8%', left: '30%', width: '36%', height: '48%', rotate: 3 },
    { top: '-4%', left: '58%', width: '48%', height: '52%', rotate: -3 },
    { top: '35%', left: '-8%', width: '38%', height: '52%', rotate: 4 },
    { top: '32%', left: '25%', width: '44%', height: '40%', rotate: -2 },
    { top: '30%', left: '62%', width: '46%', height: '48%', rotate: 3 },
    { top: '68%', left: '-5%', width: '40%', height: '48%', rotate: -3 },
    { top: '65%', left: '32%', width: '36%', height: '46%', rotate: 5 },
    { top: '62%', left: '62%', width: '45%', height: '52%', rotate: -4 },
  ];

  var DESTINATION_PHOTOS = {
    zon: {
      Santorini: '/assets/flynow/flynow-zon-photo-1.jpg',
      Curacao: '/assets/flynow/flynow-zon-photo-2.jpg',
      Tenerife: '/assets/flynow/flynow-zon-photo-3.jpg',
      Mykonos: '/assets/flynow/flynow-zon-photo-4.jpg',
      Mallorca: '/assets/flynow/flynow-zon-photo-5.jpg',
      Zanzibar: '/assets/flynow/flynow-zon-photo-6.jpg',
      Dubai: '/assets/flynow/flynow-zon-photo-7.jpg',
      Algarve: '/assets/flynow/flynow-zon-photo-8.jpg',
      Kreta: '/assets/flynow/flynow-zon-photo-9.jpg',
      Ibiza: '/assets/flynow/flynow-zon-photo-10.jpg',
    },
    sneeuw: {
      Zermatt: '/assets/flynow/flynow-sneeuw-photo-1.jpg',
      Chamonix: '/assets/flynow/flynow-sneeuw-photo-2.jpg',
      'Val Thorens': '/assets/flynow/flynow-sneeuw-photo-3.jpg',
      Verbier: '/assets/flynow/flynow-sneeuw-photo-4.jpg',
      Innsbruck: '/assets/flynow/flynow-sneeuw-photo-5.jpg',
      Bansko: '/assets/flynow/flynow-sneeuw-photo-6.jpg',
      'St. Moritz': '/assets/flynow/flynow-sneeuw-photo-7.jpg',
      'Zell am See': '/assets/flynow/flynow-sneeuw-photo-8.jpg',
      Courchevel: '/assets/flynow/flynow-sneeuw-photo-9.jpg',
    },
  };

  var COLLAGE_PHOTOS = {
    zon: [
      DESTINATION_PHOTOS.zon.Santorini,
      DESTINATION_PHOTOS.zon.Curacao,
      DESTINATION_PHOTOS.zon.Tenerife,
      DESTINATION_PHOTOS.zon.Mykonos,
      DESTINATION_PHOTOS.zon.Mallorca,
      DESTINATION_PHOTOS.zon.Zanzibar,
      DESTINATION_PHOTOS.zon.Dubai,
      DESTINATION_PHOTOS.zon.Algarve,
      DESTINATION_PHOTOS.zon.Kreta,
    ],
    sneeuw: [
      DESTINATION_PHOTOS.sneeuw.Zermatt,
      DESTINATION_PHOTOS.sneeuw.Chamonix,
      DESTINATION_PHOTOS.sneeuw['Val Thorens'],
      DESTINATION_PHOTOS.sneeuw.Verbier,
      DESTINATION_PHOTOS.sneeuw.Innsbruck,
      DESTINATION_PHOTOS.sneeuw.Bansko,
      DESTINATION_PHOTOS.sneeuw['St. Moritz'],
      DESTINATION_PHOTOS.sneeuw['Zell am See'],
      DESTINATION_PHOTOS.sneeuw.Courchevel,
    ],
  };

  var TRIP_POOL = {
    zon: [
      { dest: 'Santorini', land: 'Griekenland', photo: DESTINATION_PHOTOS.zon.Santorini, tags: ['7 nachten', 'All-inclusive', 'Vliegtuig'], price: 749, was: 1199, score: 96, deal: 'best' },
      { dest: 'Curacao', land: 'Caribbean', photo: DESTINATION_PHOTOS.zon.Curacao, tags: ['10 nachten', 'Ontbijt', 'Vliegtuig'], price: 1249, was: 1899, score: 94, deal: 'rare' },
      { dest: 'Tenerife', land: 'Spanje', photo: DESTINATION_PHOTOS.zon.Tenerife, tags: ['7 nachten', 'Halfpension', 'Vliegtuig'], price: 499, was: 749, score: 91, deal: null },
      { dest: 'Mykonos', land: 'Griekenland', photo: DESTINATION_PHOTOS.zon.Mykonos, tags: ['5 nachten', 'Ontbijt', 'Vliegtuig'], price: 889, was: 1299, score: 88, deal: 'hot' },
      { dest: 'Mallorca', land: 'Spanje', photo: DESTINATION_PHOTOS.zon.Mallorca, tags: ['10 nachten', 'Halfpension', 'Vliegtuig'], price: 649, was: 899, score: 87, deal: null },
      { dest: 'Zanzibar', land: 'Tanzania', photo: DESTINATION_PHOTOS.zon.Zanzibar, tags: ['9 nachten', 'All-inclusive', 'Vliegtuig'], price: 1499, was: 2199, score: 93, deal: 'rare' },
      { dest: 'Dubai', land: 'VAE', photo: DESTINATION_PHOTOS.zon.Dubai, tags: ['6 nachten', 'Ontbijt', 'Vliegtuig'], price: 999, was: 1499, score: 86, deal: null },
      { dest: 'Algarve', land: 'Portugal', photo: DESTINATION_PHOTOS.zon.Algarve, tags: ['8 nachten', 'Halfpension', 'Vliegtuig'], price: 579, was: 799, score: 85, deal: null },
      { dest: 'Kreta', land: 'Griekenland', photo: DESTINATION_PHOTOS.zon.Kreta, tags: ['7 nachten', 'All-inclusive', 'Vliegtuig'], price: 699, was: 949, score: 89, deal: 'hot' },
      { dest: 'Ibiza', land: 'Spanje', photo: DESTINATION_PHOTOS.zon.Ibiza, tags: ['5 nachten', 'Ontbijt', 'Vliegtuig'], price: 599, was: 899, score: 84, deal: null },
    ],
    sneeuw: [
      { dest: 'Zermatt', land: 'Zwitserland', photo: DESTINATION_PHOTOS.sneeuw.Zermatt, tags: ['7 nachten', 'Halfpension', 'Ski-pass'], price: 1299, was: 1899, score: 95, deal: 'rare' },
      { dest: 'Chamonix', land: 'Frankrijk', photo: DESTINATION_PHOTOS.sneeuw.Chamonix, tags: ['7 nachten', 'Halfpension', 'Ski-pass'], price: 999, was: 1399, score: 91, deal: 'hot' },
      { dest: 'Val Thorens', land: 'Frankrijk', photo: DESTINATION_PHOTOS.sneeuw['Val Thorens'], tags: ['7 nachten', 'Halfpension', 'Ski-pass'], price: 1099, was: 1599, score: 90, deal: null },
      { dest: 'Verbier', land: 'Zwitserland', photo: DESTINATION_PHOTOS.sneeuw.Verbier, tags: ['5 nachten', 'Ontbijt', 'Ski-pass'], price: 1199, was: 1799, score: 88, deal: null },
      { dest: 'Innsbruck', land: 'Oostenrijk', photo: DESTINATION_PHOTOS.sneeuw.Innsbruck, tags: ['5 nachten', 'Ontbijt', 'Ski-pass'], price: 699, was: 999, score: 87, deal: null },
      { dest: 'Bansko', land: 'Bulgarije', photo: DESTINATION_PHOTOS.sneeuw.Bansko, tags: ['7 nachten', 'All-in', 'Vliegtuig'], price: 449, was: 799, score: 83, deal: 'cheap' },
      { dest: 'St. Moritz', land: 'Zwitserland', photo: DESTINATION_PHOTOS.sneeuw['St. Moritz'], tags: ['6 nachten', 'Halfpension', 'Ski-pass'], price: 1599, was: 2199, score: 93, deal: 'rare' },
    ],
  };

  var AI_MESSAGES = {
    zon: [
      'Ik heb <strong>247 vluchten en hotels</strong> vergeleken. Dit zijn de topdeals van vandaag.',
      'Gefilterd op <strong>prijs, kwaliteit en beschikbaarheid</strong>. Score 90+ is extra interessant.',
      'Alle hotels hebben minimaal <strong>4 sterren en 8.5+ beoordeling</strong>. Geen rommel in de selectie.',
      'Curacao en Zanzibar zijn schaars. Deze prijzen verdwijnen meestal snel.',
    ],
    sneeuw: [
      'Gecontroleerd op <strong>sneeuwdiepte, pistelengte en bereikbaarheid</strong>. Alleen sterke opties blijven over.',
      'Ski-pass is meegenomen in de vergelijking. Zo zie je eerlijkere prijzen.',
      'Minimaal <strong>200cm sneeuwzekerheid</strong> in de beste deals van deze selectie.',
      'Bansko scoort lager in prestige, maar is extreem scherp geprijsd tegenover de Alpenklassiekers.',
    ],
  };

  var DEAL_LABELS = {
    hot: 'Hot deal',
    best: 'Beste deal',
    rare: 'Zeldzaam',
    cheap: 'Scherpste prijs',
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(el, value) {
    if (el) el.textContent = String(value || '');
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function loadCollagePhotos() {
    collagePhotos = COLLAGE_PHOTOS[currentType].slice();
    renderCollage();
  }

  function renderCollage() {
    var collage = byId('flynow-collage');
    if (!collage || !collagePhotos.length) return;
    collage.replaceChildren();
    PHOTO_LAYOUTS.forEach(function (layout, index) {
      var wrap = document.createElement('div');
      var img = document.createElement('img');
      var duration = 10 + Math.random() * 14;
      var delayOffset = -(Math.random() * duration);
      wrap.className = 'collage-photo';
      wrap.style.top = layout.top;
      wrap.style.left = layout.left;
      wrap.style.width = layout.width;
      wrap.style.height = layout.height;
      wrap.style.transform = 'rotate(' + layout.rotate + 'deg)';
      wrap.style.zIndex = String(index % 3);
      wrap.style.animation = 'collageDrift ' + duration + 's ' + delayOffset + 's ease-in-out infinite alternate';
      wrap.style.setProperty('--fx', ((Math.random() - 0.5) * 14) + 'px');
      wrap.style.setProperty('--fy', ((Math.random() - 0.5) * 14) + 'px');
      img.src = collagePhotos[index % collagePhotos.length];
      img.alt = '';
      wrap.appendChild(img);
      collage.appendChild(wrap);
    });
    collage.classList.add('visible');
  }

  function addCollagePhotos(files) {
    var fileList = Array.from(files || []);
    if (!fileList.length) return;
    Promise.all(fileList.map(function (file) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function (event) {
          resolve(String(event.target && event.target.result || ''));
        };
        reader.readAsDataURL(file);
      });
    })).then(function (urls) {
      collagePhotos = urls.filter(Boolean);
      renderCollage();
      toast(urls.length + ' foto' + (urls.length === 1 ? '' : "'s") + ' toegevoegd aan achtergrond');
    });
  }

  function setType(type) {
    currentType = type === 'sneeuw' ? 'sneeuw' : 'zon';
    var bg = byId('flynow-bg');
    var title = byId('flynow-title');
    var sub = byId('flynow-sub');
    var search = byId('flynow-search');
    var dot = byId('flynow-ai-dot');
    if (bg) bg.className = 'bg-canvas ' + currentType;
    if (title) title.className = 'hero-title ' + currentType;
    if (search) search.className = 'btn-zoek ' + currentType;
    if (dot) dot.className = 'ai-dot ' + currentType;
    if (document.body) document.body.setAttribute('data-flynow-type', currentType);
    document.querySelectorAll('[data-flynow-type]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.flynowType === currentType);
    });
    if (currentType === 'zon') {
      if (title) title.innerHTML = 'De beste trip<br>voor de<br>beste prijs';
      setText(sub, 'De AI vergelijkt honderden aanbiedingen en serveert alleen de absolute topdeals. Jij kiest of je gaat.');
    } else {
      if (title) title.innerHTML = 'Verse sneeuw.<br>Scherpe prijs.<br>Gewoon gaan.';
      setText(sub, 'Van Zermatt tot Bansko: de AI vindt de beste ski deals zodat jij alleen nog hoeft te pakken.');
    }
    rejected = [];
    loadCollagePhotos();
    if (trips.length) searchTrips();
  }

  function formatEuro(value) {
    return '\u20ac' + String(value) + ',-';
  }

  function scoreClass(score) {
    if (score >= 95) return 's-high';
    if (score >= 90) return 's-good';
    if (score >= 85) return 's-mid';
    return 's-low';
  }

  function tripId(dest) {
    return 'flynow-trip-' + String(dest || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }

  function createTextElement(tagName, className, value) {
    var el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = String(value || '');
    return el;
  }

  function createTripCard(trip, index) {
    var card = document.createElement('article');
    var imageWrap = document.createElement('div');
    var image = document.createElement('img');
    var fallback = createTextElement('div', 'trip-img-fallback', trip.dest.charAt(0));
    var overlay = document.createElement('div');
    var score = document.createElement('div');
    var info = document.createElement('div');
    var actions = document.createElement('div');
    var book = document.createElement('button');
    var pass = document.createElement('button');

    card.className = 'trip-card';
    card.id = tripId(trip.dest);
    card.style.animationDelay = (index * 0.08) + 's';
    imageWrap.className = 'trip-img';
    image.src = trip.photo;
    image.alt = trip.dest + ' reisbeeld';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', function () {
      image.style.display = 'none';
      fallback.style.display = 'flex';
    });
    overlay.className = 'trip-overlay';
    imageWrap.append(image, fallback, overlay);

    if (trip.deal) {
      imageWrap.appendChild(createTextElement('div', 'deal-tag ' + trip.deal, DEAL_LABELS[trip.deal]));
    }

    score.className = 'score-ring';
    score.append(
      createTextElement('div', 'score-num ' + scoreClass(trip.score), trip.score),
      createTextElement('div', 'score-lbl', 'score')
    );
    imageWrap.appendChild(score);

    info.className = 'trip-info';
    info.append(
      createTextElement('div', 'trip-dest', trip.dest),
      createTextElement('div', 'trip-land', trip.land),
      createTags(trip.tags),
      createPriceRow(trip)
    );
    imageWrap.appendChild(info);

    book.type = 'button';
    book.className = 'btn-book ' + currentType;
    book.textContent = 'Deal bekijken ->';
    book.addEventListener('click', function () {
      bookTrip(trip.dest);
    });
    pass.type = 'button';
    pass.className = 'btn-pass';
    pass.title = 'Nee, geef me iets beters';
    pass.setAttribute('aria-label', trip.dest + ' overslaan');
    pass.addEventListener('click', function () {
      rejectTrip(trip.dest);
    });
    actions.className = 'trip-actions';
    actions.append(book, pass);
    card.append(imageWrap, actions);
    return card;
  }

  function createTags(tags) {
    var wrap = document.createElement('div');
    wrap.className = 'trip-tags';
    (tags || []).forEach(function (tag) {
      wrap.appendChild(createTextElement('span', 'trip-tag', tag));
    });
    return wrap;
  }

  function createPriceRow(trip) {
    var row = document.createElement('div');
    var left = document.createElement('div');
    var saving = trip.was - trip.price;
    row.className = 'prijs-row';
    left.className = 'prijs-left';
    left.append(
      createTextElement('div', 'prijs-was', 'was ' + formatEuro(trip.was)),
      createTextElement('div', 'prijs-val', formatEuro(trip.price)),
      createTextElement('div', 'prijs-sub', 'p.p. - 2 personen')
    );
    row.append(left, createTextElement('div', 'prijs-bespaar ' + currentType, 'Bespaar ' + formatEuro(saving)));
    return row;
  }

  function renderTrips() {
    var wrap = byId('flynow-trips-wrap');
    var grid = document.createElement('div');
    if (!wrap) return;
    wrap.replaceChildren();
    if (!trips.length) {
      var empty = document.createElement('div');
      empty.className = 'state-msg';
      empty.append(
        createTextElement('div', 'state-mark', currentType === 'zon' ? 'SUN' : 'SKI'),
        createTextElement('div', 'state-title', 'Geen trips meer'),
        createTextElement('div', 'state-sub', 'Klik op opnieuw zoeken voor nieuwe opties.')
      );
      wrap.appendChild(empty);
      return;
    }
    grid.className = 'trips-grid';
    trips.forEach(function (trip, index) {
      grid.appendChild(createTripCard(trip, index));
    });
    wrap.appendChild(grid);
  }

  function setSearchButtonLoading(isLoading) {
    var button = byId('flynow-search');
    if (!button) return;
    button.disabled = isLoading;
    button.replaceChildren();
    if (isLoading) {
      button.append(createTextElement('span', 'btn-busy-mark', ''), document.createTextNode('Zoeken...'));
    } else {
      button.append(createTextElement('span', 'btn-bolt', ''), document.createTextNode(trips.length ? 'Opnieuw zoeken' : 'AI laten zoeken'));
    }
  }

  async function searchTrips() {
    var results = byId('flynow-results');
    var scrollHint = byId('flynow-scroll-hint');
    var messages = AI_MESSAGES[currentType];
    setSearchButtonLoading(true);
    trips = [];
    if (results) results.hidden = true;
    await delay(900);
    trips = TRIP_POOL[currentType]
      .filter(function (trip) { return rejected.indexOf(trip.dest) === -1; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 6);
    byId('flynow-ai-text').innerHTML = messages[Math.floor(Math.random() * messages.length)];
    if (results) results.hidden = false;
    if (scrollHint) scrollHint.hidden = false;
    setSearchButtonLoading(false);
    renderTrips();
    setTimeout(function () {
      if (results) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 140);
  }

  async function rejectTrip(dest) {
    var card = byId(tripId(dest));
    rejected.push(dest);
    if (card) {
      card.classList.add('removing');
      await delay(380);
    }
    trips = trips.filter(function (trip) { return trip.dest !== dest; });
    var next = TRIP_POOL[currentType]
      .filter(function (trip) {
        return rejected.indexOf(trip.dest) === -1 && !trips.some(function (existing) { return existing.dest === trip.dest; });
      })
      .sort(function (a, b) { return b.score - a.score; })[0];
    if (next) {
      trips.push(next);
      byId('flynow-ai-text').innerHTML = '<strong>' + dest + '</strong> overgeslagen. Ik heb <strong>' + next.dest + ' (score: ' + next.score + ')</strong> als betere optie gevonden.';
      toast('Overgeslagen - ' + next.dest + ' gevonden');
    } else {
      toast('Overgeslagen');
    }
    renderTrips();
  }

  function bookTrip(dest) {
    toast('Deal voor ' + dest + ' openen...');
    setTimeout(function () {
      window.open('https://www.google.com/travel/search?q=' + encodeURIComponent(dest + ' all inclusive vakantie'), '_blank', 'noopener');
    }, 500);
  }

  function toast(message) {
    var el = byId('flynow-toast');
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.add('on');
    setTimeout(function () {
      el.classList.remove('on');
    }, 2600);
  }

  function bindEvents() {
    var search = byId('flynow-search');
    var photoButton = byId('flynow-photo-button');
    var photoInput = byId('flynow-photo-input');
    if (search) search.addEventListener('click', searchTrips);
    if (photoButton && photoInput) {
      photoButton.addEventListener('click', function () {
        photoInput.click();
      });
      photoInput.addEventListener('change', function () {
        addCollagePhotos(photoInput.files);
      });
    }
    document.querySelectorAll('[data-flynow-type]').forEach(function (button) {
      button.addEventListener('click', function () {
        setType(button.dataset.flynowType);
      });
    });
  }

  bindEvents();
  setType(currentType);
})();


(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function lockFlyNowSidebarShell() {
    var sidebar = document.querySelector(".flynow-layout > .sidebar[data-flynow-sidebar-host='1']");
    if (!sidebar || !sidebar.children.length) return false;
    sidebar.setAttribute("data-static-sidebar", "1");
    sidebar.setAttribute("data-sidebar-ready", "true");
    sidebar.classList.remove("sidebar-fit-compact", "sidebar-fit-tight");
    sidebar.style.transform = "";
    sidebar.style.translate = "";
    sidebar.style.willChange = "";
    return true;
  }

  function initFlyNowSidebarShell() {
    if (lockFlyNowSidebarShell()) return;
    var sidebar = document.querySelector(".flynow-layout > .sidebar[data-flynow-sidebar-host='1']");
    if (!sidebar || typeof MutationObserver === "undefined") return;
    var observer = new MutationObserver(function () {
      if (!lockFlyNowSidebarShell()) return;
      observer.disconnect();
    });
    observer.observe(sidebar, { childList: true });
  }

  function setActiveDealPanel(mode) {
    var selectedMode = mode === "snow" ? "snow" : "zon";
    document.body.setAttribute("data-flynow-type", selectedMode);
    document.querySelectorAll("[data-flynow-tab]").forEach(function (button) {
      var isActive = button.getAttribute("data-flynow-tab") === selectedMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll("[data-flynow-panel]").forEach(function (panel) {
      var isActive = panel.getAttribute("data-flynow-panel") === selectedMode;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
    });
  }

  function bindTabs() {
    document.querySelectorAll("[data-flynow-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setActiveDealPanel(button.getAttribute("data-flynow-tab"));
      });
    });
  }

  function bindFilters() {
    document.querySelectorAll(".deals-filters").forEach(function (filtersEl) {
      filtersEl.querySelectorAll(".chip").forEach(function (chip) {
        chip.addEventListener("click", function () {
          filtersEl.querySelectorAll(".chip").forEach(function (item) {
            item.classList.remove("active");
          });
          chip.classList.add("active");
        });
      });
    });
  }

  function showToast(message) {
    var toast = byId("flynow-toast");
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.classList.add("on");
    window.clearTimeout(showToast.lastTimer);
    showToast.lastTimer = window.setTimeout(function () {
      toast.classList.remove("on");
    }, 2600);
  }

  function bindDealActions() {
    document.querySelectorAll(".deal-action").forEach(function (button) {
      button.addEventListener("click", function () {
        var title = button.getAttribute("data-deal-title") || "deze deal";
        showToast(title + " staat klaar om te boeken.");
      });
    });
  }

  function bindScrollButtons() {
    document.querySelectorAll("[data-scroll-target]").forEach(function (button) {
      button.addEventListener("click", function () {
        var target = byId(button.getAttribute("data-scroll-target"));
        if (target && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  initFlyNowSidebarShell();
  bindTabs();
  bindFilters();
  bindDealActions();
  bindScrollButtons();
  setActiveDealPanel("zon");
})();
