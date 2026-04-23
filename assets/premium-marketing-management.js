(function () {
  const root = document.documentElement;
  const path = String(window.location.pathname || '').toLowerCase();
  const pageKind = path.indexOf('/premium-advertenties') === 0
    ? 'ads'
    : path.indexOf('/premium-socialmedia') === 0
      ? 'social'
      : '';

  if (!pageKind) {
    return;
  }

  const refs = {
    shell: document.getElementById('aiMarketingShell'),
    kicker: document.getElementById('aiMarketingKicker'),
    title: document.getElementById('aiMarketingTitle'),
    sub: document.getElementById('aiMarketingSub'),
    statusTitle: document.getElementById('aiMarketingStatusTitle'),
    statusNote: document.getElementById('aiMarketingStatusNote'),
    heroTitle: document.getElementById('aiMarketingHeroTitle'),
    summary: document.getElementById('aiMarketingSummary'),
    goal: document.getElementById('aiMarketingGoal'),
    goalNote: document.getElementById('aiMarketingGoalNote'),
    current: document.getElementById('aiMarketingCurrent'),
    currentNote: document.getElementById('aiMarketingCurrentNote'),
    progress: document.getElementById('aiMarketingProgress'),
    progressNote: document.getElementById('aiMarketingProgressNote'),
    next: document.getElementById('aiMarketingNext'),
    nextNote: document.getElementById('aiMarketingNextNote'),
    tools: document.getElementById('aiMarketingTools'),
  };

  if (!refs.shell || !refs.summary) {
    return;
  }

  const NAV_TARGETS = {
    ads_trustoo: '/premium-advertenties#trustoo',
    ads_pinterest: '/premium-advertenties#pinterest',
    ads_facebook: '/premium-advertenties#facebook',
    ads_twitter: '/premium-advertenties#twitter',
    ads_google: '/premium-advertenties#google',
    ads_linkedin: '/premium-advertenties#linkedin',
    social_instagram: '/premium-socialmedia#instagram',
    social_linkedin: '/premium-socialmedia#linkedin',
    social_facebook: '/premium-socialmedia#facebook',
    social_twitter: '/premium-socialmedia#twitter',
  };

  const PAGE_CONFIG = {
    ads: {
      familyLabel: 'Advertenties',
      pageSubtitle: 'AI beslist hier zelf welk advertentiekanaal, budget en moment het meeste oplevert voor je doel.',
      defaultKey: 'trustoo',
      tools: ['Advertenties', 'Leads', 'Database', 'Agenda'],
      platforms: {
        trustoo: {
          name: 'Trustoo',
          tone: 'monitoring',
          statusTitle: 'AI bewaakt Trustoo op de achtergrond',
          statusNote: 'Zichtbaarheid, reviewdruk en aanvraagkwaliteit worden alleen opgepakt als Trustoo echt toevoegt.',
          heroTitle: 'AI beslist zelf of Trustoo nu nodig is',
          summary: 'AI is hier actief aan het meekijken. Trustoo wordt alleen ingezet als extra vertrouwen of lokale zichtbaarheid sneller meer aanvragen oplevert.',
          goal: 'Meer betrouwbare aanvragen via Trustoo',
          goalNote: 'Jij geeft het doel; de AI kiest zelf of Trustoo nu slimmer is dan advertenties, coldcalling of coldmailing.',
          current: 'Profielpositie en reviewdruk bewaken',
          currentNote: 'De AI vergelijkt Trustoo met de rest van je acquisitiestack en laat dit kanaal alleen meelopen als het zin heeft.',
          progress: 'Kanaal staat stand-by voor extra vertrouwen',
          progressNote: 'Zodra Trustoo beter converteert dan andere routes, kan de AI hier automatisch opschalen.',
          next: 'Pas activeren zodra vertrouwen het verschil maakt',
          nextNote: 'Als andere kanalen sneller resultaat geven, laat de AI Trustoo hier bewust rustig.',
        },
        pinterest: {
          name: 'Pinterest advertenties',
          tone: 'idle',
          statusTitle: 'AI gebruikt Pinterest nu niet',
          statusNote: 'Dit kanaal blijft stil zolang Pinterest niet het snelste pad naar nieuwe aanvragen is.',
          heroTitle: 'AI zet Pinterest alleen aan als het echt toevoegt',
          summary: 'AI is momenteel hier niet mee bezig. Pinterest advertenties worden pas ingezet als visuele traffic of inspiratiecampagnes beter werken dan je andere tools.',
          goal: 'Pinterest alleen inzetten als visuele campagnes helpen',
          goalNote: 'AI hoeft hier niets te forceren; hij gebruikt Pinterest alleen wanneer dit je doel sneller dichterbij brengt.',
          current: 'Geen live Pinterest-campagne',
          currentNote: 'De AI ziet nu betere kansen via andere kanalen en laat Pinterest daarom uitgeschakeld.',
          progress: 'Kanaal staat volledig stand-by',
          progressNote: 'Geen budget of aandacht verspillen zolang de return elders hoger ligt.',
          next: 'Alleen testen als creatieve content meer tractie belooft',
          nextNote: 'Wordt Pinterest relevant, dan zet de AI hier zelf een eerste testbatch klaar.',
        },
        facebook: {
          name: 'Facebook advertenties',
          tone: 'active',
          statusTitle: 'AI stuurt Facebook advertenties nu actief',
          statusNote: 'Doelgroepen, creatives en follow-up worden live bijgestuurd op basis van resultaat.',
          heroTitle: 'AI gebruikt Facebook advertenties nu actief',
          summary: 'AI is hier actief aan het werk. Hij optimaliseert Facebook advertenties, filtert de beste reacties en zet warme leads automatisch door naar de juiste vervolgstap.',
          goal: 'Meer gekwalificeerde reacties via Facebook advertenties',
          goalNote: 'De AI mag hier zelfstandig budget, doelgroep en timing aanpassen zolang het je doel beter dient.',
          current: 'Creatives en doelgroepen finetunen',
          currentNote: 'De best presterende varianten krijgen meer ruimte; zwakke combinaties worden automatisch afgeremd.',
          progress: 'Actieve advertentieflow met live optimalisatie',
          progressNote: 'Leads uit Facebook worden meteen vergeleken met coldcalling, coldmailing en database-opvolging.',
          next: 'Winnende reacties direct doorzetten naar vervolg',
          nextNote: 'Zodra een andere tool meer oplevert, verschuift de AI de aandacht daarheen zonder jouw doel los te laten.',
        },
        twitter: {
          name: 'X / Twitter advertenties',
          tone: 'idle',
          statusTitle: 'AI gebruikt X / Twitter nu niet',
          statusNote: 'Dit kanaal draait niet zolang het geen duidelijk voordeel geeft boven je andere acquisitieroutes.',
          heroTitle: 'AI laat X / Twitter bewust uit zolang het niets toevoegt',
          summary: 'AI is momenteel hier niet mee bezig. X / Twitter advertenties worden alleen ingezet als snelheid of bereik daar aantoonbaar beter is.',
          goal: 'X / Twitter alleen inzetten als bereik echt helpt',
          goalNote: 'Niet elk kanaal hoeft live te staan; de AI kiest alleen wat je doel versnelt.',
          current: 'Geen actieve campagne op X / Twitter',
          currentNote: 'De AI ziet nu elders meer tractie en houdt dit kanaal bewust dicht.',
          progress: 'Kanaal staat gereed maar blijft uit',
          progressNote: 'Geen ruis, geen verspilling, alleen focus op wat nu werkt.',
          next: 'Alleen openen wanneer extra bereik nodig is',
          nextNote: 'Als een snelle awareness-push nodig wordt, kan de AI hier meteen opschalen.',
        },
        google: {
          name: 'Google Ads',
          tone: 'active',
          statusTitle: 'AI stuurt Google Ads nu actief',
          statusNote: 'Zoekintentie, zoekwoorden en doorstroom naar leads worden voortdurend bewaakt.',
          heroTitle: 'AI gebruikt Google Ads nu actief',
          summary: 'AI is hier actief aan het werk. Hij gebruikt Google Ads wanneer directe zoekintentie de snelste route naar nieuwe aanvragen of afspraken is.',
          goal: 'Meer intentiegedreven aanvragen via Google Ads',
          goalNote: 'De AI mag hier campagnes opschonen, zoekwoorden verschuiven en budget verleggen zolang het doel wint.',
          current: 'Zoekwoorden en landingroutes optimaliseren',
          currentNote: 'Zoekopdrachten met koopintentie krijgen voorrang; zwakke combinaties worden automatisch teruggeschakeld.',
          progress: 'Actieve zoekcampagnes met intentiefilter',
          progressNote: 'De AI vergelijkt Google-resultaten steeds met de opbrengst van andere Softora-kanalen.',
          next: 'Meer budget naar de sterkste zoekintentie schuiven',
          nextNote: 'Als Google even niet meer de beste route is, remt de AI dit kanaal automatisch af.',
        },
        linkedin: {
          name: 'LinkedIn advertenties',
          tone: 'monitoring',
          statusTitle: 'AI houdt LinkedIn advertenties warm',
          statusNote: 'LinkedIn blijft beschikbaar voor B2B-doelgroepen, maar wordt alleen opgeschaald als dat beter werkt.',
          heroTitle: 'AI beslist zelf of LinkedIn advertenties nu nodig zijn',
          summary: 'AI is hier actief aan het meekijken. LinkedIn advertenties worden vooral ingezet wanneer de doelgroep zakelijk scherper te raken is dan via andere kanalen.',
          goal: 'LinkedIn alleen inzetten als B2B-doelgroepen daar beter reageren',
          goalNote: 'Je hoeft niet handmatig te kiezen; de AI vergelijkt zelf wanneer LinkedIn meer kwaliteit oplevert.',
          current: 'Doelgroepfit en kost per reactie bewaken',
          currentNote: 'De AI houdt dit kanaal klaar voor momenten waarop zakelijke targeting de rest voorbijstreeft.',
          progress: 'Kanaal staat warm voor B2B-sprints',
          progressNote: 'Geen constante spend nodig; alleen inzetten zodra kwaliteit of dealgrootte dat rechtvaardigt.',
          next: 'Alleen opschalen als LinkedIn de scherpste route wordt',
          nextNote: 'Zolang andere kanalen efficiënter zijn, blijft LinkedIn in een bewaakte stand-by modus.',
        },
      },
    },
    social: {
      familyLabel: 'Socialmedia',
      pageSubtitle: 'AI bepaalt hier zelf wanneer organische socialmedia, inbox-opvolging en doorstroom naar leads zin hebben.',
      defaultKey: 'instagram',
      tools: ['Socialmedia', 'Mailbox', 'Leads', 'Agenda'],
      platforms: {
        instagram: {
          name: 'Instagram',
          tone: 'active',
          statusTitle: 'AI stuurt Instagram nu actief',
          statusNote: 'Contentritme, reacties en DM-opvolging worden live bewaakt en bijgestuurd.',
          heroTitle: 'AI gebruikt Instagram nu actief',
          summary: 'AI is hier actief aan het werk. Hij houdt Instagram levend, filtert de warmste reacties eruit en zet kansrijke gesprekken door naar leads of afspraken.',
          goal: 'Meer warme aandacht en DM-reacties via Instagram',
          goalNote: 'De AI kiest zelf of posts, stories, DM-opvolging of een ander kanaal meer effect heeft op jouw doel.',
          current: 'Contentritme en DM-signalen optimaliseren',
          currentNote: 'Reacties met koopintentie of concrete vragen krijgen sneller opvolging dan algemene interactie.',
          progress: 'Instagram draait mee als actieve aandachtstrekker',
          progressNote: 'De AI vergelijkt bereik en respons steeds met advertenties, database en outboundkanalen.',
          next: 'Warmste interacties omzetten naar concrete vervolgactie',
          nextNote: 'Als Instagram minder toevoegt, verschuift de AI automatisch naar een sterker kanaal.',
        },
        linkedin: {
          name: 'LinkedIn social',
          tone: 'monitoring',
          statusTitle: 'AI bewaakt LinkedIn op de achtergrond',
          statusNote: 'Zakelijke zichtbaarheid en reacties worden gevolgd, maar alleen opgepakt wanneer dit je doel helpt.',
          heroTitle: 'AI beslist zelf of LinkedIn nu mee moet draaien',
          summary: 'AI is hier actief aan het meekijken. LinkedIn wordt alleen ingezet wanneer zakelijke zichtbaarheid, autoriteit of reacties hier beter landen dan elders.',
          goal: 'LinkedIn alleen inzetten als zakelijke zichtbaarheid telt',
          goalNote: 'De AI laat dit kanaal rusten zodra andere tools sneller of directer bijdragen aan het doel.',
          current: 'Signalen uit zakelijke interacties bewaken',
          currentNote: 'Relevante comments, profielbezoek en inbound-signalen worden meegewogen in de routekeuze.',
          progress: 'Kanaal staat warm voor B2B-zichtbaarheid',
          progressNote: 'Geen druk om altijd te posten; alleen doorpakken wanneer LinkedIn daadwerkelijk rendement brengt.',
          next: 'Alleen opschalen als LinkedIn beter converteert dan de rest',
          nextNote: 'De AI kiest dan zelf voor social, outbound of ads op basis van wat het doel het best dient.',
        },
        facebook: {
          name: 'Facebook social',
          tone: 'monitoring',
          statusTitle: 'AI bewaakt Facebook social op de achtergrond',
          statusNote: 'Community-signalen en pagina-activiteit worden alleen opgepakt als dit nog echt iets toevoegt.',
          heroTitle: 'AI beslist zelf of Facebook social nu zin heeft',
          summary: 'AI is hier actief aan het meekijken. Facebook social blijft alleen aan als er nog nuttige aandacht, heractivatie of reacties uit te halen zijn.',
          goal: 'Bestaande aandacht benutten zonder onnodige ruis',
          goalNote: 'De AI hoeft dit kanaal niet te forceren; hij gebruikt het alleen als het jouw bredere doel sneller dichterbij brengt.',
          current: 'Community-reacties en oudere doelgroepen bewaken',
          currentNote: 'De AI houdt dit kanaal paraat voor heractivatie, maar drukt niet door als het weinig toevoegt.',
          progress: 'Kanaal staat in bewaakte stand-by',
          progressNote: 'Er wordt alleen aandacht gegeven wanneer de kans op reactie of vertrouwen hoog genoeg is.',
          next: 'Alleen activeren als Facebook opnieuw tractie geeft',
          nextNote: 'Zodra andere tools sterker zijn, blijft dit kanaal bewust op de achtergrond.',
        },
        twitter: {
          name: 'X / Twitter social',
          tone: 'idle',
          statusTitle: 'AI gebruikt X / Twitter nu niet',
          statusNote: 'Dit kanaal blijft stil zolang andere routes meer zin hebben voor je doel en doelgroep.',
          heroTitle: 'AI laat X / Twitter nu bewust uit',
          summary: 'AI is momenteel hier niet mee bezig. X / Twitter wordt pas benut als snelheid, actualiteit of zichtbaarheid daar echt meer oplevert.',
          goal: 'Alleen posten waar het iets toevoegt',
          goalNote: 'De AI hoeft niet overal tegelijk aanwezig te zijn; hij kiest alleen het kanaal dat nu echt helpt.',
          current: 'Geen live activiteit op X / Twitter',
          currentNote: 'De AI ziet op dit moment geen reden om hier energie in te stoppen.',
          progress: 'Kanaal staat volledig stand-by',
          progressNote: 'Dat voorkomt versnippering en houdt de focus op de routes die nu effect hebben.',
          next: 'Alleen opstarten als actualiteit of bereik dit vraagt',
          nextNote: 'Als er wel een momentum ontstaat, kan de AI dit kanaal direct meenemen.',
        },
        google: {
          name: 'Google Business-profiel',
          tone: 'monitoring',
          statusTitle: 'AI bewaakt het Google-profiel op de achtergrond',
          statusNote: 'Updates en zichtbaarheid worden alleen opgepakt als lokale zichtbaarheid hier beter converteert.',
          heroTitle: 'AI beslist zelf of Google Business nu aandacht nodig heeft',
          summary: 'AI is hier actief aan het meekijken. Google Business-profielupdates worden alleen gedaan als lokale zichtbaarheid of vertrouwen hier het verschil maakt.',
          goal: 'Lokale zichtbaarheid alleen versterken als het iets oplevert',
          goalNote: 'De AI gebruikt dit profiel slim als steunpunt, niet als verplicht extra kanaal.',
          current: 'Lokale signalen en profielimpact bewaken',
          currentNote: 'Zodra Google-profielupdates meer opleveren dan andere acties, pakt de AI dit meteen op.',
          progress: 'Kanaal staat klaar voor lokale pushmomenten',
          progressNote: 'Zolang de opbrengst elders hoger ligt, blijft het profiel in onderhoudsmodus.',
          next: 'Alleen opschalen wanneer lokale vraag toeneemt',
          nextNote: 'De AI combineert dit dan met leads, agenda of outbound als dat slimmer is.',
        },
      },
    },
  };

  function readMode() {
    if (window.SoftoraAiManagement && typeof window.SoftoraAiManagement.getMode === 'function') {
      return window.SoftoraAiManagement.getMode();
    }
    return root.getAttribute('data-ai-management-mode') === 'software' ? 'software' : 'personnel';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeHashKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/^#/, '')
      .trim();
  }

  function getPageConfig() {
    return PAGE_CONFIG[pageKind];
  }

  function getPlatformConfig() {
    const pageConfig = getPageConfig();
    const rawHash = normalizeHashKey(window.location.hash);
    if (rawHash && pageConfig.platforms[rawHash]) {
      return pageConfig.platforms[rawHash];
    }
    return pageConfig.platforms[pageConfig.defaultKey];
  }

  function setText(node, value) {
    if (node) {
      node.textContent = String(value || '').trim();
    }
  }

  function renderTools(tools) {
    if (!refs.tools) return;
    refs.tools.innerHTML = tools
      .map((tool) => `<span class="ai-marketing-tool">${escapeHtml(tool)}</span>`)
      .join('');
  }

  function updateAiWorkspace() {
    const pageConfig = getPageConfig();
    const platformConfig = getPlatformConfig();
    const tone = platformConfig.tone || 'idle';

    refs.shell.dataset.aiTone = tone;
    setText(refs.kicker, pageConfig.familyLabel);
    setText(refs.title, 'AI Beheer');
    setText(refs.sub, `${pageConfig.pageSubtitle} Kanaal nu: ${platformConfig.name}.`);
    setText(refs.statusTitle, platformConfig.statusTitle);
    setText(refs.statusNote, platformConfig.statusNote);
    setText(refs.heroTitle, platformConfig.heroTitle);
    setText(refs.summary, platformConfig.summary);
    setText(refs.goal, platformConfig.goal);
    setText(refs.goalNote, platformConfig.goalNote);
    setText(refs.current, platformConfig.current);
    setText(refs.currentNote, platformConfig.currentNote);
    setText(refs.progress, platformConfig.progress);
    setText(refs.progressNote, platformConfig.progressNote);
    setText(refs.next, platformConfig.next);
    setText(refs.nextNote, platformConfig.nextNote);
    renderTools(platformConfig.tools || pageConfig.tools || []);
  }

  function openTarget(target, event) {
    const openInNewTab = Boolean(
      event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
    );
    if (openInNewTab) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    window.location.assign(target);
  }

  function restoreMarketingSidebarLinksForAiMode() {
    Object.keys(NAV_TARGETS).forEach((key) => {
      const anchor = document.querySelector(`.sidebar a.sidebar-link[data-sidebar-key="${key}"]`);
      if (!anchor) return;
      anchor.removeAttribute('aria-disabled');
      anchor.setAttribute('tabindex', '0');
      anchor.setAttribute('role', 'link');
      anchor.dataset.aiMarketingHref = NAV_TARGETS[key];

      if (anchor.dataset.aiMarketingNavInit === '1') {
        return;
      }

      anchor.dataset.aiMarketingNavInit = '1';
      ['click', 'auxclick', 'keydown'].forEach((eventName) => {
        anchor.addEventListener(eventName, (event) => {
          if (readMode() !== 'software') return;
          if (eventName === 'auxclick' && event.button !== 1) return;
          if (eventName === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          openTarget(anchor.dataset.aiMarketingHref, event);
        });
      });
    });
  }

  function syncOverlayForMode() {
    const overlay = document.getElementById('contentLockOverlay');
    if (!overlay) return;
    if (readMode() === 'software') {
      overlay.style.display = 'none';
    }
  }

  function handleHashChange() {
    if (readMode() !== 'software') {
      return;
    }
    updateAiWorkspace();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  restoreMarketingSidebarLinksForAiMode();
  syncOverlayForMode();
  updateAiWorkspace();

  window.addEventListener('softora-ai-management-change', () => {
    syncOverlayForMode();
    updateAiWorkspace();
  });
  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('pageshow', () => {
    syncOverlayForMode();
    updateAiWorkspace();
  });
})();
