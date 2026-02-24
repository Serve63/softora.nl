/* Softora Premium Site Engine
 * Deterministic, per-order isolated pipeline:
 * discovery -> concepts -> style seed -> copy -> render -> premium QA gate (+seed retry)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PremiumSiteEngine = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var nodeFs = null;
  var nodePath = null;
  try {
    if (typeof module !== 'undefined' && module.exports) {
      nodeFs = require('fs');
      nodePath = require('path');
    }
  } catch (err) {
    nodeFs = null;
    nodePath = null;
  }

  var LOCAL_SIGNATURE_KEY = 'softora-premium-signatures-v2';
  var RECENT_SIGNATURES = [];

  var FORBIDDEN_WORDS = [
    'lorem',
    'placeholder',
    'todo',
    'vul later',
    'coming soon',
    'tbd',
    '[...]',
    '<placeholder>'
  ];

  var FLUFF_CLICHES = [
    'wij zijn gepassioneerd',
    'jouw succes is onze missie',
    'op maat gemaakt voor jouw bedrijf',
    'innovatieve oplossingen',
    'state-of-the-art',
    'best-in-class',
    'wereldklasse',
    'one-stop-shop',
    'end-to-end solution',
    'next-level',
    'game changer',
    'synergie',
    'holistische aanpak',
    'volledig ontzorgd',
    'grenzeloze mogelijkheden',
    'revolutionair',
    'future-proof',
    'toonaangevend',
    'hoogwaardige kwaliteit',
    'unieke ervaring',
    'digitale transformatie',
    'ongekende resultaten',
    'alles-in-een',
    'premium kwaliteit voor iedereen',
    'innovatief maatwerk',
    'kwaliteit staat voorop',
    'de kracht van',
    'visie en strategie',
    'impact maken',
    'samen bouwen aan groei',
    'alles draait om jouw klant',
    'maximale resultaten',
    'excellente service',
    'wij denken met je mee',
    'persoonlijke aanpak',
    'unieke oplossing',
    'onze experts',
    'krachtige combinatie',
    'hoogste niveau',
    'geen grenzen',
    'premium ervaring',
    'hoogstaande service',
    'volledige expertise',
    'onverslaanbare kwaliteit',
    'optimale klantbeleving',
    'transformeer jouw bedrijf',
    'de ultieme oplossing',
    'resultaatgericht maatwerk',
    'jouw partner in groei',
    'naar een hoger niveau',
    'grip op groei'
  ];

  var SPECIFICITY_TERMS = [
    'intake', 'scope', 'planning', 'oplevering', 'werkwijze', 'stap', 'fases', 'checklist',
    'materiaal', 'afwerking', 'ondergrond', 'primer', 'lak', 'kleuradvies', 'voorbereiding',
    'demo', 'use-case', 'integratie', 'onboarding', 'migratie', 'api', 'database', 'workflow',
    'beslisser', 'commercie', 'operations', 'management', 'formulier', 'offerte', 'opname',
    'prijsindicatie', 'doorlooptijd', 'risico', 'garantie', 'voorwaarden', 'feedback', 'qa',
    'responsive', 'contrast', 'focus state', 'hover state', 'active state', 'component',
    'navigatie', 'contentstructuur', 'cta', 'bezwaren', 'faq', 'contactformulier',
    'levering', 'implementatie', 'rollback', 'testfase', 'release'
  ];

  var SPECIFICITY_CATEGORIES = {
    process: ['proces', 'planning', 'intake', 'fases', 'stap', 'werkwijze', 'testfase', 'release'],
    materials_or_stack: ['materiaal', 'afwerking', 'primer', 'lak', 'api', 'database', 'integratie', 'stack'],
    choices: ['keuze', 'route', 'matrix', 'selectie', 'variant', 'scope', 'kwalificatie'],
    delivery: ['oplevering', 'levering', 'doorlooptijd', 'planning', 'rollback'],
    risk_reversal: ['risico', 'garantie', 'voorwaarden', 'bezwaren', 'faq']
  };

  var TYPE_PAIRS = [
    { name: 'executive-sans', headings: '"Arial Black", "Segoe UI", Arial, sans-serif', body: '"Segoe UI", "Helvetica Neue", Arial, sans-serif' },
    { name: 'impact-modern', headings: '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif', body: '"Trebuchet MS", "Segoe UI", sans-serif' },
    { name: 'editorial-contrast', headings: 'Georgia, "Times New Roman", serif', body: '"Segoe UI", "Trebuchet MS", sans-serif' },
    { name: 'humanist-clean', headings: '"Gill Sans", "Trebuchet MS", sans-serif', body: '"Segoe UI", Tahoma, sans-serif' },
    { name: 'system-precision', headings: 'system-ui, -apple-system, "Segoe UI", sans-serif', body: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    { name: 'narrow-command', headings: '"Arial Narrow", Arial, sans-serif', body: '"Helvetica Neue", Arial, sans-serif' },
    { name: 'classic-authority', headings: '"Palatino Linotype", "Book Antiqua", serif', body: '"Segoe UI", "Helvetica Neue", Arial, sans-serif' },
    { name: 'garamond-sharp', headings: 'Garamond, "Times New Roman", serif', body: '"Segoe UI", Arial, sans-serif' }
  ];

  var LAYOUT_VARIANTS = [
    'bento-command',
    'editorial-rail',
    'split-showcase',
    'process-cascade',
    'proof-atlas',
    'contrast-runway',
    'chapter-editorial',
    'matrix-decision',
    'timeline-spotlight',
    'minimal-authority',
    'conversion-rail',
    'product-tour-cabinet'
  ];

  var SPACING_SCALES = ['tight', 'balanced', 'airy', 'wide'];
  var RADIUS_SCALES = ['0px', '8px', '14px', '20px'];
  var GRID_STYLES = ['asymmetric', '12-col', 'bento', 'timeline', 'editorial'];
  var BUTTON_STYLES = ['solid', 'outline', 'pill', 'underline'];
  var CARD_STYLES = ['flat', 'elevated', 'panel', 'glass'];

  var DEFAULT_SECTION_ORDER = ['hero', 'value', 'pain', 'benefits', 'signatureA', 'process', 'signatureB', 'trust', 'faq', 'cta'];

  function fnv1a(input) {
    var str = String(input || '');
    var hash = 2166136261;
    var i;
    for (i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(list, seed) {
    var out = (list || []).slice();
    var rng = mulberry32(seed >>> 0);
    var i;
    for (i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function uniq(list) {
    var seen = Object.create(null);
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (!seen[list[i]]) {
        seen[list[i]] = true;
        out.push(list[i]);
      }
    }
    return out;
  }

  function safeJsonParse(input, fallback) {
    try {
      return JSON.parse(input);
    } catch (err) {
      return fallback;
    }
  }

  function loadStoredSignatures() {
    var out = [];

    if (typeof localStorage !== 'undefined') {
      var raw = localStorage.getItem(LOCAL_SIGNATURE_KEY);
      var parsed = safeJsonParse(raw || '[]', []);
      if (Array.isArray(parsed)) out = out.concat(parsed);
    }

    if (nodeFs && nodePath && typeof process !== 'undefined' && process.cwd) {
      var outputRoot = nodePath.resolve(process.cwd(), 'output');
      if (nodeFs.existsSync(outputRoot)) {
        try {
          var dirs = nodeFs.readdirSync(outputRoot, { withFileTypes: true });
          dirs.forEach(function (entry) {
            if (!entry.isDirectory()) return;
            var qaPath = nodePath.join(outputRoot, entry.name, 'qa.json');
            if (!nodeFs.existsSync(qaPath)) return;
            var qaRaw = nodeFs.readFileSync(qaPath, 'utf8');
            var qaParsed = safeJsonParse(qaRaw, null);
            if (qaParsed && qaParsed.signature && Array.isArray(qaParsed.signature.tokens)) {
              out.push(qaParsed.signature);
            }
          });
        } catch (err) {
          // ignore filesystem signature scan failures
        }
      }
    }

    return out;
  }

  function persistStoredSignatures(history) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(LOCAL_SIGNATURE_KEY, JSON.stringify((history || []).slice(-120)));
    } catch (err) {
      // ignore storage quota errors
    }
  }

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  function inferIndustry(order) {
    var pool = [order.title, order.description, order.clientName, order.location].join(' ').toLowerCase();
    if (/(software|platform|saas|database|api|dashboard|webapp|applicatie|integratie|crm|erp|automation|cloud)/.test(pool)) return 'software';
    if (/(schilder|painting|stukadoor|renovatie|afwerking|interieurwerk)/.test(pool)) return 'contractor';
    if (/(kapper|kapsalon|barber|haar|beauty)/.test(pool)) return 'salon';
    if (/(restaurant|menu|reservering|cafe|bistro|brasserie)/.test(pool)) return 'restaurant';
    if (/(sportschool|gym|fitness|trainer|rooster)/.test(pool)) return 'gym';
    if (/(interieur|studio|portfolio|architect|designbureau)/.test(pool)) return 'interior';
    if (/(bakkerij|brood|gebak|patisserie)/.test(pool)) return 'bakery';
    return 'local-service';
  }

  function normalizeOrder(meta, fallbackId) {
    var id = String((meta && meta.id) || fallbackId || 'order').trim() || 'order';
    var clientName = String((meta && meta.clientName) || '').trim();
    var title = String((meta && meta.title) || '').trim();
    var description = String((meta && meta.description) || '').trim();
    var location = String((meta && meta.location) || '').trim();
    var budget = Number((meta && meta.budget) || 0);

    if (!clientName) clientName = title ? title.split(' ')[0] + ' Studio' : 'Premium Studio';
    if (!title) title = 'Premium Website traject';
    if (!description) description = 'Conversiegerichte website met premium positionering en duidelijke vervolgstappen.';

    return {
      id: id,
      clientName: clientName,
      title: title,
      description: description,
      location: location,
      budget: budget
    };
  }

  function industryPack(industry) {
    if (industry === 'software') {
      return {
        audience: 'B2B beslissers die productwaarde snel willen toetsen',
        primaryAction: 'Plan een technische demo',
        secondaryAction: 'Bekijk implementatie-aanpak',
        pains: [
          'Bezoekers zien losse features maar begrijpen te laat de zakelijke impact.',
          'Demo-aanvragen missen context waardoor sales veel tijd verliest in de eerste call.',
          'Verschillende doelgroepen vinden niet direct hun eigen route.',
          'Copy is te algemeen en adresseert bezwaren pas laat.',
          'De overgang van interesse naar afspraak bevat te veel frictie.'
        ],
        outcomes: [
          'Snellere route van eerste bezoek naar gekwalificeerde demo.',
          'Duidelijke positionering per doelgroep zonder technische ruis.',
          'Consistente direct-response copy over alle kernpagina\'s.',
          'Bezwaren worden behandeld vóór de afspraakfase.',
          'Schaalbare inhoudsstructuur voor nieuwe proposities.'
        ],
        differentiator: 'Productverhaal wordt vertaald naar beslisacties in plaats van feature-overzichten.',
        faq: [
          ['Past dit naast onze huidige stack?', 'Ja. We schrijven de website rond je bestaande processen, zodat je huidige tooling logisch blijft aansluiten.'],
          ['Wordt dit een marketinglaag zonder diepgang?', 'Nee. Elke sectie koppelt productwaarde aan een concrete zakelijke uitkomst en vervolgstap.'],
          ['Kunnen meerdere beslissers tegelijk landen?', 'Ja. De structuur splitst routes per rol zodat operations, management en commercie direct relevante informatie zien.'],
          ['Moeten we eerst alles technisch uitwerken?', 'Nee. We starten met kernpropositie, bezwaren en besliskaders en verdiepen daarna gericht.'],
          ['Hoe voorkomen we generieke B2B-taal?', 'Door copy te bouwen op echte salesvragen, risico\'s en keuzecriteria in je funnel.'],
          ['Wat gebeurt er na livegang?', 'Je houdt een modulaire basis waarmee je nieuwe use-cases toevoegt zonder de conversielogica te breken.']
        ],
        signature: [
          {
            id: 'use-case-matrix',
            title: 'Use-case Matrix per Beslisser',
            lead: 'Per rol een eigen route van probleem naar volgende stap.',
            bullets: [
              'Commercie: sneller van bezoek naar gekwalificeerde demo.',
              'Operations: minder handmatig uitlegwerk in het voortraject.',
              'Management: snellere toets op impact, risico en prioriteit.'
            ]
          },
          {
            id: 'product-tour',
            title: 'Product Tour Cards met Beslispunten',
            lead: 'Geen featuredump, wel een route waarin elke stap eindigt in een concrete actie.',
            bullets: [
              'Start met context en pijn, niet met losse functionaliteit.',
              'Koppel capability aan een zakelijke uitkomst.',
              'Sluit af met één heldere vervolgstap.'
            ]
          },
          {
            id: 'integration-approach',
            title: 'Integratie-aanpak zonder Lock-in Taal',
            lead: 'Legt uit hoe je oplossing aansluit op bestaande processen zonder opgeblazen claims.',
            bullets: [
              'Heldere rolverdeling tussen teams.',
              'Realistische adoptiestappen in begrijpelijke taal.',
              'Transparante verwachting rond implementatie.'
            ]
          },
          {
            id: 'demo-qualifier',
            title: 'Demo Qualifier Flow',
            lead: 'Filtert intentie vooraf zodat gesprekken sneller inhoudelijk worden.',
            bullets: [
              'Vooraf kernvragen in de contactflow.',
              'Minder algemene aanvragen, meer bruikbare context.',
              'Kortere route naar beslisinformatie.'
            ]
          }
        ]
      };
    }

    if (industry === 'contractor') {
      return {
        audience: 'huiseigenaren en ondernemers die strak gepland vakwerk zoeken',
        primaryAction: 'Plan een opname',
        secondaryAction: 'Bekijk werkwijze',
        pains: [
          'Aanvragen komen binnen zonder duidelijke scope of timing.',
          'Bezoekers twijfelen over afwerking en materiaalkeuze.',
          'Kwaliteit is online niet concreet genoeg zichtbaar.',
          'Mobiele bezoekers haken af vóór ze contact opnemen.',
          'Verwachtingen over voorbereiding en planning blijven vaag.'
        ],
        outcomes: [
          'Meer serieuze aanvragen met duidelijke projectcontext.',
          'Sneller vertrouwen door transparante aanpak en voorbereiding.',
          'Minder losse vragen door praktische keuzehulp.',
          'Sterkere lokale conversie op mobiel en desktop.',
          'Premium uitstraling die vakmanschap inhoudelijk onderbouwt.'
        ],
        differentiator: 'Van vrijblijvende interesse naar concrete aanvraag met duidelijke voorbereiding en planning.',
        faq: [
          ['Moet ik alles exact weten vóór contact?', 'Nee. De intake is bedoeld om scope, planning en keuzes samen concreet te maken.'],
          ['Krijg ik snel duidelijkheid over de aanpak?', 'Ja. Na je aanvraag volgt direct een heldere vervolgstap met praktische route.'],
          ['Wat als ik nog twijfel over materiaal of afwerking?', 'Daarvoor gebruiken we keuzehulp-secties die opties praktisch vergelijken zonder verkooppraat.'],
          ['Is de website alleen visueel sterk of ook commercieel?', 'Commercie is leidend: elke sectie ondersteunt een concrete stap richting opname of offerte.'],
          ['Werkt dit goed op mobiel?', 'Ja. Navigatie, contentvolgorde en CTA\'s zijn mobiel eerst ontworpen.'],
          ['Kan ik later diensten toevoegen?', 'Ja. De structuur is modulair zodat nieuwe diensten logisch blijven aansluiten.']
        ],
        signature: [
          {
            id: 'kleur-afwerking',
            title: 'Kleur & Afwerking Keuzehulp',
            lead: 'Bezoekers kiezen sneller als afwerking en gebruik direct praktisch worden uitgelegd.',
            bullets: [
              'Binnen en buiten apart uitgewerkt.',
              'Onderhoud en duurzaamheid in begrijpelijke taal.',
              'Keuze direct te koppelen aan intake.'
            ]
          },
          {
            id: 'planning-voorbereiding',
            title: 'Planning & Voorbereiding in 5 Stappen',
            lead: 'Laat exact zien wat jij regelt en wat de klant voorbereidt voor een soepele start.',
            bullets: [
              'Heldere startvolgorde per projecttype.',
              'Minder vertraging door concrete voorbereiding.',
              'Transparante communicatiemomenten per fase.'
            ]
          },
          {
            id: 'materiaal-kader',
            title: 'Materiaalkeuze per Ruimtetype',
            lead: 'Maakt materiaalkeuzes concreet zodat bezoekers met vertrouwen richting kiezen.',
            bullets: [
              'Praktische verschillen in uitstraling en levensduur.',
              'Keuzes gekoppeld aan gebruiksintensiteit.',
              'Direct bruikbaar in opnamegesprek.'
            ]
          },
          {
            id: 'werkvolgorde',
            title: 'Werkvolgorde van Opname tot Oplevering',
            lead: 'Verwachtingen staan vooraf scherp waardoor trajecten rustiger verlopen.',
            bullets: [
              'Vaste fases met beslismomenten.',
              'Geen vage overgangen in planning.',
              'Duidelijke route naar oplevering.'
            ]
          }
        ]
      };
    }

    return {
      audience: 'bezoekers die snel willen begrijpen wat je levert en hoe ze starten',
      primaryAction: 'Vraag een offerte aan',
      secondaryAction: 'Bekijk aanpak',
      pains: [
        'Aanbod wordt te breed gepresenteerd waardoor bezoekers niet kiezen.',
        'Belangrijke bezwaren worden pas laat behandeld.',
        'Contactroute is te algemeen en levert lage kwaliteit aanvragen op.',
        'Website laat onvoldoende zien wat je anders maakt.',
        'Mobiele flow mist duidelijke beslispunten.'
      ],
      outcomes: [
        'Sneller begrip van aanbod en positionering.',
        'Hogere kwaliteit van aanvragen.',
        'Minder twijfel door concrete bezwaarbehandeling.',
        'Duidelijke route naar actie op iedere pagina.',
        'Modulaire structuur die meegroeit met nieuw aanbod.'
      ],
      differentiator: 'Commerciële structuur en copy die bezoekers sneller naar de juiste stap brengen.',
      faq: [
        ['Wordt dit niet weer een standaard template?', 'Nee. Layout, sectievolgorde, copytone en signature sections worden per opdracht deterministisch gevarieerd.'],
        ['Is dit vooral design of ook conversiegericht?', 'Conversie is leidend. Elke sectie heeft een duidelijke functie in de beslisroute.'],
        ['Kan ik later onderdelen wijzigen?', 'Ja. De opbouw is modulair zodat nieuwe blokken zonder breuk kunnen worden toegevoegd.'],
        ['Hoe snel staat een complete basis live?', 'Zodra de richting akkoord is, kan de volledige statische basis direct worden opgeleverd.'],
        ['Hoe voorkomen we vage aanvragen?', 'Door keuzehulp, heldere CTA\'s en formulieren die op context sturen.'],
        ['Wat is de stap na oplevering?', 'Je gebruikt dezelfde structuur om campagnes en nieuwe proposities gecontroleerd uit te rollen.']
      ],
      signature: [
        {
          id: 'route-kiezer',
          title: 'Routekiezer voor Snelle Beslissing',
          lead: 'Helpt bezoekers binnen enkele seconden de juiste vervolgstap kiezen.',
          bullets: ['Minder twijfel in de eerste minuut.', 'Duidelijke segmentatie van behoeften.', 'Elke route eindigt in een concrete CTA.']
        },
        {
          id: 'aanpak-kader',
          title: 'Aanpak in Heldere Fases',
          lead: 'Maakt samenwerking voorspelbaar en verlaagt drempels richting contact.',
          bullets: ['Concreet begin, midden en eind.', 'Transparante verwachting per fase.', 'Minder ruis in intake en opvolging.']
        },
        {
          id: 'scope-filter',
          title: 'Scope Filter voor Serieuze Aanvragen',
          lead: 'Voorkomt vrijblijvende aanvragen door direct op context te sturen.',
          bullets: ['Kwaliteit boven volume.', 'Meer bruikbare informatie per aanvraag.', 'Snellere opvolging door duidelijke input.']
        },
        {
          id: 'trust-rail',
          title: 'Trust Rail zonder Nepbewijslast',
          lead: 'Bouwt vertrouwen met proces, transparantie en realistische verwachtingen.',
          bullets: ['Geen opgeblazen claims.', 'Wel duidelijke werkwijze en afspraken.', 'Eerlijke communicatie over volgende stappen.']
        }
      ]
    };
  }

  function makeBrief(order, opts) {
    var industry = inferIndustry(order);
    var pack = industryPack(industry);

    return {
      order_id: String(opts.orderId),
      source: opts.source || 'ui-click',
      run_id: opts.runId,
      theme: opts.theme,
      industry: industry,
      offer: order.title,
      location: order.location || 'Nederland',
      audience: pack.audience,
      primary_action: pack.primaryAction,
      secondary_action: pack.secondaryAction,
      top_pains: pack.pains,
      desired_outcomes: pack.outcomes,
      differentiator_angle: pack.differentiator,
      forbidden_claims: [
        'Geen verzonnen aantallen of groeicijfers.',
        'Geen klantlogo\'s of testimonials zonder brondata.',
        'Geen certificeringen of keurmerken zonder bewijs in opdrachtdata.',
        'Geen fictieve SLA- of responstijdclaims buiten expliciete input.'
      ],
      faq: pack.faq,
      signature_pool: pack.signature,
      sitemap: ['index.html', industry === 'software' ? 'features.html' : 'services.html', 'about.html', 'contact.html']
    };
  }

  function makeConcepts(brief) {
    return [
      {
        id: 'authority-atelier',
        name: 'Authority Atelier',
        vibe: 'high-trust, disciplined, strategic',
        layoutSet: [0, 3, 4, 9],
        copyEdge: 'risicovermindering'
      },
      {
        id: 'campaign-laboratory',
        name: 'Campaign Laboratory',
        vibe: 'creative-marketing, bold-hooks, premium rhythm',
        layoutSet: [1, 5, 6, 11],
        copyEdge: 'aandacht + conversie'
      },
      {
        id: 'conversion-machine',
        name: 'Conversion Machine',
        vibe: 'direct-response, action-centric, frictionless',
        layoutSet: [2, 7, 8, 10],
        copyEdge: 'snel van intentie naar actie'
      }
    ];
  }

  function chooseConcept(brief, concepts, seed) {
    var idx = (seed ^ fnv1a(brief.industry)) % concepts.length;
    if (idx < 0) idx += concepts.length;
    return concepts[idx];
  }

  function pickSignatures(brief, seed) {
    var pool = brief.signature_pool || [];
    if (!pool.length) return [{ title: 'Signature A', lead: '', bullets: [] }, { title: 'Signature B', lead: '', bullets: [] }];
    var a = seed % pool.length;
    var b = (a + 2) % pool.length;
    if (b === a) b = (a + 1) % pool.length;
    return [pool[a], pool[b]];
  }

  function makePalette(industry, theme, seed) {
    var lightBase = { bg: '#f7f6f2', surface: '#ffffff', text: '#111426', muted: '#5f647d', border: 'rgba(17,20,38,0.12)' };
    var darkBase = { bg: '#090a11', surface: '#101423', text: '#eef2ff', muted: '#a3abc6', border: 'rgba(255,255,255,0.13)' };

    var accents = {
      software: ['#4a5fd7', '#5b6ee0', '#3f53c7', '#6477f0'],
      contractor: ['#2f5bd4', '#3a6fe4', '#2a6dd6', '#4a5fd7'],
      salon: ['#8b2252', '#a62d65', '#c43a78', '#b83280'],
      restaurant: ['#d97706', '#e67e22', '#f59e0b', '#b45309'],
      gym: ['#10b981', '#27ae60', '#16a34a', '#059669'],
      interior: ['#5b57d6', '#6d63f0', '#4f46e5', '#7c3aed'],
      bakery: ['#b45309', '#d97706', '#f59e0b', '#fb923c'],
      'local-service': ['#4a5fd7', '#5b6ee0', '#3f53c7', '#6477f0']
    };

    var base = theme === 'dark' ? darkBase : lightBase;
    var list = accents[industry] || accents['local-service'];
    var i = seed % list.length;

    return {
      bg: base.bg,
      surface: base.surface,
      text: base.text,
      muted: base.muted,
      border: base.border,
      accent: list[i],
      accentAlt: list[(i + 1) % list.length]
    };
  }

  function makeStyleSeed(order, brief, concept, opts, seed) {
    var layoutVariant = seed % 12;
    var typePair = seed % 8;

    if (concept && concept.layoutSet && concept.layoutSet.length) {
      layoutVariant = concept.layoutSet[seed % concept.layoutSet.length];
    }

    var middle = DEFAULT_SECTION_ORDER.slice(1, -1);
    var shuffled = seededShuffle(middle, seed ^ 0x9e3779b9);
    var sectionOrder = ['hero'].concat(shuffled).concat(['cta']);

    if (sectionOrder.join('|') === DEFAULT_SECTION_ORDER.join('|')) {
      shuffled.push(shuffled.shift());
      sectionOrder = ['hero'].concat(shuffled).concat(['cta']);
    }

    sectionOrder = uniq(sectionOrder);
    if (sectionOrder[0] !== 'hero') sectionOrder.unshift('hero');
    if (sectionOrder[sectionOrder.length - 1] !== 'cta') {
      sectionOrder = sectionOrder.filter(function (x) { return x !== 'cta'; }).concat(['cta']);
    }

    var signatures = pickSignatures(brief, seed);

    return {
      seed: seed,
      run_id: opts.runId,
      layoutVariant: layoutVariant,
      layout_variant: layoutVariant,
      layoutVariantKey: LAYOUT_VARIANTS[layoutVariant],
      layout_pattern: LAYOUT_VARIANTS[layoutVariant],
      sectionOrder: sectionOrder,
      section_order: sectionOrder,
      typePair: typePair,
      type_pair: typePair,
      typography_pairing: {
        name: TYPE_PAIRS[typePair].name,
        headings: TYPE_PAIRS[typePair].headings,
        body: TYPE_PAIRS[typePair].body
      },
      spacingScale: SPACING_SCALES[seed % SPACING_SCALES.length],
      spacing_scale: SPACING_SCALES[seed % SPACING_SCALES.length],
      borderRadius: RADIUS_SCALES[seed % RADIUS_SCALES.length],
      border_radius: RADIUS_SCALES[seed % RADIUS_SCALES.length],
      gridStyle: GRID_STYLES[seed % GRID_STYLES.length],
      grid_style: GRID_STYLES[seed % GRID_STYLES.length],
      buttonStyle: BUTTON_STYLES[seed % BUTTON_STYLES.length],
      button_style: BUTTON_STYLES[seed % BUTTON_STYLES.length],
      cardStyle: CARD_STYLES[seed % CARD_STYLES.length],
      card_style: CARD_STYLES[seed % CARD_STYLES.length],
      signatureSections: [signatures[0].title, signatures[1].title],
      signature_sections: [signatures[0].title, signatures[1].title],
      signature_payload: { a: signatures[0], b: signatures[1] },
      microinteractions: 'subtiele reveal, duidelijke focus, functionele hover-feedback',
      animation_rules: 'subtiel, functioneel, geen circus',
      palette: makePalette(brief.industry, opts.theme, seed),
      concept_id: concept ? concept.id : 'none',
      mood_words: concept ? concept.vibe.split(',').map(function (x) { return x.trim(); }) : []
    };
  }

  function splitHeadline(title, industry) {
    var words = String(title || '').split(/\s+/).filter(Boolean);
    if (!words.length) {
      words = industry === 'software' ? ['Persoonlijke', 'Software'] : ['Premium', 'Webdesign'];
    }
    if (words.length === 1) {
      return { top: words[0], accent: industry === 'software' ? 'Platform' : 'Resultaat' };
    }
    var cut = Math.max(1, Math.floor(words.length * 0.55));
    return {
      top: words.slice(0, cut).join(' '),
      accent: words.slice(cut).join(' ')
    };
  }

  function copyBlueprintForIndustry(industry) {
    var commonFaq = [
      ['Hoe houden jullie het project strak zonder eindeloze revisierondes?', 'We werken met vaste beslismomenten per fase. Je krijgt per fase een heldere keuze met impact, zodat feedback concreet blijft en doorlooptijd voorspelbaar is.'],
      ['Hoe voorkomen we dat de site mooi is maar niet converteert?', 'Elke sectie krijgt een commerciële functie: aandacht pakken, bezwaar wegnemen of actie uitlokken. We schrijven eerst op basis van intentie, daarna pas op stijl.'],
      ['Wat als onze input nog niet compleet is?', 'We starten met een compacte intake en vullen gaten pragmatisch op met marktlogica. Onzekere punten worden expliciet gemaakt zodat je gericht kunt beslissen.'],
      ['Hoe zit het met uitbreiding na livegang?', 'De structuur is modulair opgezet. Nieuwe diensten, proposities of campagnes kunnen worden toegevoegd zonder volledige herbouw.'],
      ['Wat gebeurt er als timing kritisch is?', 'Planning wordt opgesplitst in harde opleverpunten met duidelijke afhankelijkheden. Zo weet je precies wat wanneer nodig is om livegang te halen.'],
      ['Hoe borgen jullie kwaliteit op mobiel?', 'De layout en copy worden mobile-first gecontroleerd op hiërarchie, leesritme en CTA-bereik, inclusief hover/focus/active states waar relevant.']
    ];

    if (industry === 'software') {
      return {
        heroClaim: 'Positioneer complexe software in heldere beslistaal die demo-aanvragen versnelt.',
        heroSub: 'Voor teams die productwaarde snel moeten overbrengen aan meerdere beslissers.',
        ctaPrimary: 'Plan Product Demo',
        ctaSecondary: 'Bekijk Use-Cases',
        riskReversal: 'Eerst structuur en messaging scherp, daarna pas schalen op verkeer.',
        specifics: [
          'Use-case matrix per rol: directie, operations, IT en commercie.',
          'Demo-intake met verplichte contextvelden voor huidige stack en doelstelling.',
          'Integratieblokken in begrijpelijke taal zonder technische ruis.',
          'Migratie- en implementatierisico expliciet behandeld in FAQ.',
          'Releaseflow met testfase, rollback-pad en oplevercriteria.',
          'CTA-routing per intentie: oriënteren, evalueren of beslissen.'
        ],
        benefits: [
          'Bezoekers zien binnen seconden welke use-case op hun situatie past.',
          'Features worden vertaald naar operationele impact in plaats van jargon.',
          'Bezwaren over security, implementatie en adoptie worden vooraf opgevangen.',
          'Salesgesprekken starten inhoudelijker door betere voorselectie in formulieren.',
          'Site blijft bruikbaar voor zowel korte demo-cycli als enterprise trajecten.',
          'Design ondersteunt authority zonder afstandelijk of generiek te worden.'
        ],
        process: [
          { step: '01', title: 'Discovery', text: 'Besluitproces, stakeholders en huidige bottlenecks in kaart brengen.' },
          { step: '02', title: 'Messaging', text: 'Per use-case een concrete belofte plus risico-reversal formuleren.' },
          { step: '03', title: 'Architectuur', text: 'Paginaflow bouwen die van herkenning naar demo-intentie beweegt.' },
          { step: '04', title: 'Build', text: 'Premium front-end met component states, visuals en heldere copyblokken.' },
          { step: '05', title: 'QA', text: 'Gate op specificiteit, bezwaren, CTA-logica en mobile conversie.' }
        ],
        trust: [
          'Geen fictieve klantlogo\'s of verzonnen performance claims.',
          'Elke pagina toont welke actie logisch is per fase van de funnel.',
          'Technische diepgang blijft aanwezig zonder verkoopverhaal te vertragen.',
          'Structuur is gemaakt voor snelle updates van features en proposities.'
        ],
        features: [
          { title: 'Use-Case Matrix', text: 'Sorteert productwaarde per doelgroep zodat elke rol direct relevante context ziet.' },
          { title: 'Decision Narrative', text: 'Leidt bezoekers van probleemherkenning naar concrete evaluatiecriteria.' },
          { title: 'Demo Qualifier', text: 'Formulier vraagt alleen informatie die salesgesprekken direct verbetert.' },
          { title: 'Objection Handling', text: 'FAQ en microcopy tackelen implementatie-, timing- en risicovragen vooraf.' },
          { title: 'Product Tour Blocks', text: 'Visuele kaarten combineren kernfeature, impact en vervolgstap.' },
          { title: 'Expansion-ready Layout', text: 'Nieuwe modules kunnen toegevoegd worden zonder het conversieritme te breken.' }
        ],
        about: [
          'Deze website is opgezet als commerciële productnarratief, niet als losse informatiepagina.',
          'Typografie en spacing sturen leesprioriteit voor zowel C-level als operationele teams.',
          'Elke component heeft een rol in beslisversnelling: uitleg, bewijs of actie.',
          'De basis blijft onderhoudbaar terwijl propositie en markt evolueren.'
        ],
        faq: commonFaq.concat([
          ['Hoe spreken jullie zowel business als IT aan?', 'We splitsen copy op beslisniveau: zakelijke impact voor business, technische haalbaarheid voor implementatieteams.'],
          ['Kunnen jullie rekening houden met lange salescycli?', 'Ja. CTA\'s zijn gelaagd: van verkenning tot demo, zodat bezoekers kunnen instappen op hun beslisniveau.']
        ])
      };
    }

    if (industry === 'contractor') {
      return {
        heroClaim: 'Zet schilderwerk om naar vertrouwen en concrete offerte-aanvragen zonder prijsraces.',
        heroSub: 'Voor opdrachtgevers die kwaliteit, planning en afwerking vooraf helder willen hebben.',
        ctaPrimary: 'Plan Opname',
        ctaSecondary: 'Bekijk Werkwijze',
        riskReversal: 'Heldere voorbereiding en opleverafspraken voorkomen verrassingen in uitvoering.',
        specifics: [
          'Keuzehulp voor binnenwerk, buitenwerk en houtafwerking.',
          'Materiaalkeuze uitgelegd: primer, lak, dekking en onderhoud.',
          'Voorbereidingschecklist: wat wij doen en wat de klant regelt.',
          'Planning per fase: opname, voorbereiding, uitvoering, oplevering.',
          'Schriftelijke scope zodat meerwerk vooraf bespreekbaar wordt.',
          'Contactformulier kwalificeert type object en gewenste termijn.'
        ],
        benefits: [
          'Je website filtert beter op serieuze aanvragen in plaats van prijs-shoppers.',
          'Bezoekers zien direct welke route past bij hun type klus.',
          'Kwaliteit en werkwijze worden tastbaar zonder lange lappen tekst.',
          'Veelgestelde vragen nemen twijfel over planning en overlast weg.',
          'CTA\'s staan op logische punten waar bezoekers bereid zijn om te plannen.',
          'Lokale uitstraling blijft professioneel en onderscheidend.'
        ],
        process: [
          { step: '01', title: 'Opname', text: 'Situatie en ondergrond beoordelen, inclusief gewenste uitstraling en timing.' },
          { step: '02', title: 'Advies', text: 'Materiaal, afwerking en aanpak kiezen op basis van gebruik en onderhoud.' },
          { step: '03', title: 'Planning', text: 'Fases en randvoorwaarden vastzetten zodat uitvoering voorspelbaar blijft.' },
          { step: '04', title: 'Uitvoering', text: 'Nette werkroutine met duidelijke communicatie per dagdeel.' },
          { step: '05', title: 'Oplevering', text: 'Controle op afwerking, puntenlijst en overdracht van onderhoudsadvies.' }
        ],
        trust: [
          'Geen loze kwaliteitsclaims, wel transparantie over proces en keuzes.',
          'Vooraf duidelijk over planning, voorbereiding en oplevermomenten.',
          'Scope en verwachtingen zijn expliciet om discussie achteraf te voorkomen.',
          'Informatie is geschreven voor woningeigenaren én zakelijke opdrachtgevers.'
        ],
        features: [
          { title: 'Kleur & Afwerking Keuzehulp', text: 'Helpt bezoekers sneller kiezen op stijl, slijtvastheid en onderhoud.' },
          { title: 'Projecttype Routing', text: 'Leidt woning, VvE en zakelijk vastgoed naar de juiste intakeflow.' },
          { title: 'Planningsoverzicht', text: 'Toont een heldere fasestructuur met beslismomenten en doorlooptijdcontext.' },
          { title: 'Voorbereidingschecklist', text: 'Maakt verantwoordelijkheden vooraf duidelijk voor minder ruis tijdens uitvoering.' },
          { title: 'Risico-reversal FAQ', text: 'Beantwoordt vragen over overlast, kwaliteit en garanties in begrijpelijke taal.' },
          { title: 'Lokale Conversieblokken', text: 'CTA\'s en copy sluiten aan op bezoekers die direct een opname willen plannen.' }
        ],
        about: [
          'De site stuurt op vertrouwen door duidelijkheid, niet door opgeblazen claims.',
          'Copy helpt opdrachtgevers beslissen op kwaliteit en aanpak, niet alleen op prijs.',
          'Visuele hiërarchie houdt focus op de volgende logische actie.',
          'Structuur is klaar voor uitbreiding met extra diensten of regio\'s.'
        ],
        faq: commonFaq.concat([
          ['Kunnen we vooraf weten wat onder voorbereiding valt?', 'Ja, de website en intakeflow benoemen precies welke voorbereidingen wij uitvoeren en welke input van de klant nodig is.'],
          ['Hoe gaan jullie om met veranderingen tijdens de klus?', 'Wij werken met een duidelijke scope en beslismomenten. Wijzigingen worden besproken voordat uitvoering doorgaat.']
        ])
      };
    }

    return {
      heroClaim: 'Positioneer je aanbod met commerciële copy die twijfel verlaagt en actie verhoogt.',
      heroSub: 'Voor teams die een website willen die zowel merkuitstraling als conversie serieus neemt.',
      ctaPrimary: 'Plan Kennismaking',
      ctaSecondary: 'Bekijk Aanpak',
      riskReversal: 'Eerst een heldere route, daarna pas schalen op campagne of content.',
      specifics: [
        'Heldere intake met doel, doelgroep en gewenste uitkomst.',
        'Pagina-architectuur op basis van beslismomenten.',
        'FAQ met concrete bezwaarafhandeling per fase.',
        'Contactflow met kwalificatie in plaats van losse leadverzameling.',
        'Responsive uitwerking met states en contrastcontrole.',
        'Modulaire secties voor snelle campagne-uitbreiding.'
      ],
      benefits: [
        'Bezoekers begrijpen sneller wat je levert en waarom dat relevant is.',
        'Commerciële copy stuurt op actie zonder schreeuwerige toon.',
        'Bezwaren worden vroeg geadresseerd zodat contactkwaliteit stijgt.',
        'Structuur werkt voor zowel desktop als mobiel.',
        'Design en boodschap versterken elkaar in plaats van concurreren.',
        'Site blijft uitbreidbaar voor nieuwe proposities.'
      ],
      process: [
        { step: '01', title: 'Brief', text: 'Doel, doelgroep en gewenste conversie compact uitlijnen.' },
        { step: '02', title: 'Hook', text: 'Commerciële invalshoek kiezen die direct herkenning triggert.' },
        { step: '03', title: 'Structuur', text: 'Secties op volgorde zetten van aandacht naar actie.' },
        { step: '04', title: 'Build', text: 'Volledige premium uitwerking in statische HTML, CSS en JS.' },
        { step: '05', title: 'Polish', text: 'QA op copykwaliteit, design states en conversieritme.' }
      ],
      trust: [
        'Geen verzonnen bewijsblokken, wel duidelijke keuzes en argumentatie.',
        'Contactroute is ontworpen voor kwaliteit van gesprekken.',
        'Scope en verwachtingen zijn zichtbaar in de pagina-opbouw.',
        'Copy blijft concreet en besluitgericht.'
      ],
      features: [
        { title: 'Positionering Blokken', text: 'Vertalen aanbod naar directe relevantie voor de juiste doelgroep.' },
        { title: 'Objection Framework', text: 'FAQ en trustsecties verminderen twijfel op kritieke beslispunten.' },
        { title: 'CTA Architecture', text: 'Primair en secundair pad begeleiden bezoekers naar passende actie.' },
        { title: 'Process Storyline', text: 'Toont hoe traject verloopt van intake tot oplevering.' },
        { title: 'Signature Components', text: 'Unieke secties versterken merkbeleving en commerciële helderheid.' },
        { title: 'Scalable Foundation', text: 'Klaar voor nieuwe pagina\'s, campagnes en contentuitbreiding.' }
      ],
      about: [
        'Deze uitwerking combineert marketingrichting met uitvoerbare structuur.',
        'Design system bewaakt consistentie over alle pagina\'s en devices.',
        'Copy is geschreven op intentie, bezwaren en volgende stap.',
        'De site blijft bruikbaar als basis voor toekomstige groei.'
      ],
      faq: commonFaq
    };
  }

  function makeCopy(brief, styleSeed, order, concept) {
    var h = splitHeadline(order.title, brief.industry);
    var pack = copyBlueprintForIndustry(brief.industry);

    var heroClaim = pack.heroClaim;
    var heroSub = pack.heroSub + ' ' + brief.desired_outcomes[0] + '.';

    var valueLadder = [
      brief.desired_outcomes[0],
      pack.riskReversal,
      pack.specifics[0]
    ];

    var painCards = brief.top_pains.slice(0, 5).map(function (p, i) {
      return {
        title: 'Knelpunt ' + (i + 1),
        text: p,
        outcome: brief.desired_outcomes[i] || brief.desired_outcomes[brief.desired_outcomes.length - 1]
      };
    });

    var faqItems = pack.faq.slice(0, 8).map(function (q) {
      return { q: q[0], a: q[1] };
    });

    if (faqItems.length < 6) {
      faqItems = faqItems.concat(brief.faq.slice(0, 6 - faqItems.length).map(function (q) {
        return { q: q[0], a: q[1] };
      }));
    }

    return {
      brand: order.clientName,
      city: order.location || 'Nederland',
      businessType: order.title,
      conceptName: concept ? concept.name : 'Premium Concept',
      conceptVibe: concept ? concept.vibe : 'premium',
      hero: {
        kicker: order.location || (brief.industry === 'software' ? 'B2B Software Positionering' : 'Premium Positionering'),
        titleTop: h.top,
        titleAccent: h.accent,
        claim: heroClaim,
        subtitle: heroSub,
        primaryCta: pack.ctaPrimary || brief.primary_action,
        secondaryCta: pack.ctaSecondary || brief.secondary_action
      },
      valueLadder: valueLadder,
      painCards: painCards,
      benefits: pack.benefits,
      process: pack.process,
      trust: pack.trust.concat(pack.specifics.slice(0, 2)),
      faq: faqItems,
      signatureA: styleSeed.signature_payload.a,
      signatureB: styleSeed.signature_payload.b,
      featureCards: pack.features,
      aboutPoints: pack.about.concat([
        'Differentiator-hoek: ' + brief.differentiator_angle,
        'Praktische specifics: ' + pack.specifics[1]
      ]),
      directSpecifics: pack.specifics,
      riskReversal: pack.riskReversal,
      contactPromise: 'Binnen 1 werkdag reactie.'
    };
  }

  function navHtml(brief, active) {
    var servicesFile = brief.industry === 'software' ? 'features.html' : 'services.html';
    var servicesLabel = brief.industry === 'software' ? 'Features' : 'Services';
    var links = [
      ['index.html', 'Home'],
      [servicesFile, servicesLabel],
      ['about.html', 'Over'],
      ['contact.html', 'Contact']
    ];
    return links.map(function (row) {
      return '<a href="' + row[0] + '"' + (row[0] === active ? ' class="active"' : '') + '>' + esc(row[1]) + '</a>';
    }).join('');
  }

  function renderHero(copy, variantKey) {
    var ctas = '' +
      '<div class="hero-ctas">' +
      '  <a class="btn btn-primary" data-hero-cta="1" href="contact.html">' + esc(copy.hero.primaryCta) + '</a>' +
      '  <a class="btn btn-secondary" data-hero-cta="2" href="about.html">' + esc(copy.hero.secondaryCta) + '</a>' +
      '</div>';

    if (variantKey === 'editorial-rail' || variantKey === 'chapter-editorial') {
      return '' +
        '<section class="section hero hero-' + esc(variantKey) + '" data-section="hero">' +
        '  <div class="container hero-editorial">' +
        '    <aside class="hero-kicker reveal"><p class="eyebrow">' + esc(copy.hero.kicker) + '</p><p>' + esc(copy.riskReversal) + '</p></aside>' +
        '    <div class="hero-main reveal">' +
        '      <h1>' + esc(copy.hero.titleTop) + ' <span>' + esc(copy.hero.titleAccent) + '</span></h1>' +
        '      <p class="hero-claim">' + esc(copy.hero.claim) + '</p>' +
        '      <p class="hero-sub">' + esc(copy.hero.subtitle) + '</p>' +
        ctas +
        '    </div>' +
        '    <aside class="hero-side reveal"><h2>Strategische Specifics</h2><ul>' + copy.directSpecifics.slice(0, 4).map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') + '</ul></aside>' +
        '  </div>' +
        '</section>';
    }

    if (variantKey === 'timeline-spotlight' || variantKey === 'process-cascade') {
      return '' +
        '<section class="section hero hero-' + esc(variantKey) + '" data-section="hero">' +
        '  <div class="container hero-timeline-shell">' +
        '    <div class="hero-main reveal">' +
        '      <p class="eyebrow">' + esc(copy.hero.kicker) + '</p>' +
        '      <h1>' + esc(copy.hero.titleTop) + ' <span>' + esc(copy.hero.titleAccent) + '</span></h1>' +
        '      <p class="hero-claim">' + esc(copy.hero.claim) + '</p>' +
        '      <p class="hero-sub">' + esc(copy.hero.subtitle) + '</p>' +
        ctas +
        '    </div>' +
        '    <div class="hero-timeline reveal">' +
        copy.process.slice(0, 3).map(function (item) {
          return '<article><span>' + esc(item.step) + '</span><h3>' + esc(item.title) + '</h3><p>' + esc(item.text) + '</p></article>';
        }).join('') +
        '    </div>' +
        '  </div>' +
        '</section>';
    }

    if (variantKey === 'product-tour-cabinet' || variantKey === 'matrix-decision' || variantKey === 'conversion-rail') {
      return '' +
        '<section class="section hero hero-' + esc(variantKey) + '" data-section="hero">' +
        '  <div class="container hero-product-shell">' +
        '    <div class="hero-main reveal">' +
        '      <p class="eyebrow">' + esc(copy.hero.kicker) + '</p>' +
        '      <h1>' + esc(copy.hero.titleTop) + ' <span>' + esc(copy.hero.titleAccent) + '</span></h1>' +
        '      <p class="hero-claim">' + esc(copy.hero.claim) + '</p>' +
        '      <p class="hero-sub">' + esc(copy.hero.subtitle) + '</p>' +
        ctas +
        '    </div>' +
        '    <div class="hero-tour reveal">' +
        copy.featureCards.slice(0, 3).map(function (card, i) {
          return '<article class="hero-tour-card"><span>0' + (i + 1) + '</span><h3>' + esc(card.title) + '</h3><p>' + esc(card.text) + '</p></article>';
        }).join('') +
        '    </div>' +
        '  </div>' +
        '</section>';
    }

    return '' +
      '<section class="section hero hero-' + esc(variantKey) + '" data-section="hero">' +
      '  <div class="container hero-grid">' +
      '    <div class="hero-main reveal">' +
      '      <p class="eyebrow">' + esc(copy.hero.kicker) + '</p>' +
      '      <h1>' + esc(copy.hero.titleTop) + ' <span>' + esc(copy.hero.titleAccent) + '</span></h1>' +
      '      <p class="hero-claim">' + esc(copy.hero.claim) + '</p>' +
      '      <p class="hero-sub">' + esc(copy.hero.subtitle) + '</p>' +
      ctas +
      '    </div>' +
      '    <aside class="hero-side reveal">' +
      '      <h2>Commerciële Focus</h2>' +
      '      <ul>' + copy.valueLadder.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') + '</ul>' +
      '      <p class="note">' + esc(copy.contactPromise) + '</p>' +
      '    </aside>' +
      '  </div>' +
      '</section>';
  }

  function renderValue(copy) {
    return '' +
      '<section class="section section-alt" data-section="value">' +
      '  <div class="container value-strip reveal">' +
      '    <p>' + esc(copy.businessType) + ' · ' + esc(copy.city) + '</p>' +
      '    <a class="btn btn-primary" href="contact.html">' + esc(copy.hero.primaryCta) + '</a>' +
      '  </div>' +
      '</section>';
  }

  function renderPain(copy) {
    return '' +
      '<section class="section" data-section="pain">' +
      '  <div class="container">' +
      '    <div class="section-head">' +
      '      <p class="eyebrow">Knelpunten</p>' +
      '      <h2>Waar routes vaak vastlopen</h2>' +
      '      <p>Deze structuur vertaalt frictie naar duidelijke keuzes en vervolgstappen.</p>' +
      '    </div>' +
      '    <div class="card-grid">' +
      copy.painCards.map(function (card, i) {
        return '<article class="card reveal"><span class="idx">0' + (i + 1) + '</span><h3>' + esc(card.title) + '</h3><p>' + esc(card.text) + '</p><p class="outcome">' + esc(card.outcome) + '</p></article>';
      }).join('') +
      '    </div>' +
      '  </div>' +
      '</section>';
  }

  function renderBenefits(copy) {
    return '' +
      '<section class="section section-alt" data-section="benefits">' +
      '  <div class="container">' +
      '    <div class="section-head">' +
      '      <p class="eyebrow">Voordelen</p>' +
      '      <h2>Waarom dit commercieel werkt</h2>' +
      '    </div>' +
      '    <div class="benefit-grid">' +
      copy.benefits.map(function (b, i) {
        return '<article class="benefit reveal"><span class="idx">0' + (i + 1) + '</span><p>' + esc(b) + '</p></article>';
      }).join('') +
      '    </div>' +
      '  </div>' +
      '</section>';
  }

  function renderSignature(copy, key) {
    var payload = key === 'signatureA' ? copy.signatureA : copy.signatureB;
    var marker = key === 'signatureA' ? 'a' : 'b';
    var specifics = (copy.directSpecifics || []).slice(key === 'signatureA' ? 0 : 3, key === 'signatureA' ? 3 : 6);
    return '' +
      '<section class="section signature" data-section="' + esc(key) + '">' +
      '  <div class="container">' +
      '    <article class="signature-card reveal" data-signature="' + marker + '">' +
      '      <p class="eyebrow">Signature Section</p>' +
      '      <h2>' + esc(payload.title) + '</h2>' +
      '      <p>' + esc(payload.lead) + '</p>' +
      '      <ul>' + payload.bullets.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '      <div class="signature-specifics">' + specifics.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
      '    </article>' +
      '  </div>' +
      '</section>';
  }

  function renderProcess(copy) {
    return '' +
      '<section class="section" data-section="process">' +
      '  <div class="container">' +
      '    <div class="section-head">' +
      '      <p class="eyebrow">Proces</p>' +
      '      <h2>Van briefing naar livegang</h2>' +
      '    </div>' +
      '    <div class="process-list">' +
      copy.process.map(function (s) {
        return '<article class="process reveal"><span>' + esc(s.step) + '</span><div><h3>' + esc(s.title) + '</h3><p>' + esc(s.text) + '</p></div></article>';
      }).join('') +
      '    </div>' +
      '  </div>' +
      '</section>';
  }

  function renderTrust(copy) {
    return '' +
      '<section class="section section-alt" data-section="trust">' +
      '  <div class="container trust-wrap reveal">' +
      '    <div>' +
      '      <p class="eyebrow">Trust Framework</p>' +
      '      <h2>Transparant in plaats van opgeblazen</h2>' +
      '      <p>Geen nep-bewijsblokken. Wel heldere aanpak, voorwaarden en duidelijke vervolgstap.</p>' +
      '    </div>' +
      '    <ul>' + copy.trust.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '  </div>' +
      '</section>';
  }

  function renderFaq(copy) {
    return '' +
      '<section class="section" data-section="faq">' +
      '  <div class="container">' +
      '    <div class="section-head">' +
      '      <p class="eyebrow">FAQ</p>' +
      '      <h2>Bezwaren vooraf opgelost</h2>' +
      '    </div>' +
      '    <div class="faq-list">' +
      copy.faq.map(function (f, i) {
        return '<article class="faq-item reveal"><button type="button" class="faq-question" data-faq-question="' + i + '">' + esc(f.q) + '</button><div class="faq-answer"><p>' + esc(f.a) + '</p></div></article>';
      }).join('') +
      '    </div>' +
      '  </div>' +
      '</section>';
  }

  function renderCta(copy) {
    return '' +
      '<section class="section section-cta" data-section="cta">' +
      '  <div class="container">' +
      '    <article class="cta-card reveal">' +
      '      <h2>Klaar voor de volgende stap?</h2>' +
      '      <p>Beschrijf je situatie in het formulier. Je krijgt een concrete vervolgstap zonder omwegen.</p>' +
      '      <div class="hero-ctas">' +
      '        <a class="btn btn-primary" href="contact.html">' + esc(copy.hero.primaryCta) + '</a>' +
      '        <a class="btn btn-secondary" href="about.html">Bekijk aanpak</a>' +
      '      </div>' +
      '      <p class="note">' + esc(copy.contactPromise) + '</p>' +
      '    </article>' +
      '  </div>' +
      '</section>';
  }

  function renderSection(section, copy, variantKey) {
    if (section === 'hero') return renderHero(copy, variantKey);
    if (section === 'value') return renderValue(copy);
    if (section === 'pain') return renderPain(copy);
    if (section === 'benefits') return renderBenefits(copy);
    if (section === 'signatureA') return renderSignature(copy, 'signatureA');
    if (section === 'process') return renderProcess(copy);
    if (section === 'signatureB') return renderSignature(copy, 'signatureB');
    if (section === 'trust') return renderTrust(copy);
    if (section === 'faq') return renderFaq(copy);
    if (section === 'cta') return renderCta(copy);
    return '';
  }

  function layoutRender(variant, sectionOrder, map) {
    var middle = sectionOrder.filter(function (s) { return s !== 'hero' && s !== 'cta'; });
    var first = middle.slice(0, 3);
    var second = middle.slice(3, 6);
    var third = middle.slice(6);

    function join(list) {
      return list.map(function (k) { return map[k] || ''; }).join('');
    }

    var hero = map.hero || '';
    var cta = map.cta || '';

    if (variant === 0) {
      return hero + '<section class="variant variant-bento"><div class="container bento-layout"><div class="bento-main">' + join(first) + '</div><aside class="bento-side"><div class="bento-kpi">Strategie</div>' + join(second) + '</aside><div class="bento-foot">' + join(third) + '</div></div></section>' + cta;
    }
    if (variant === 1) {
      return hero + '<section class="variant variant-editorial"><div class="container editorial-layout"><aside class="editorial-rail"><div>Hook</div><div>Proof</div><div>Action</div></aside><div class="editorial-main"><div class="editorial-block">' + join(first) + '</div><div class="editorial-block">' + join(second.concat(third)) + '</div></div></div></section>' + cta;
    }
    if (variant === 2) {
      return hero + '<section class="variant variant-split"><div class="container split-layout"><div class="split-left"><div class="split-stack">' + join(first.concat(second.slice(0, 1))) + '</div></div><div class="split-right"><div class="split-stack">' + join(second.slice(1).concat(third)) + '</div></div></div></section>' + cta;
    }
    if (variant === 3) {
      return hero + '<section class="variant variant-cascade"><div class="container cascade-layout"><article class="cascade-intro">Fasegedreven structuur</article>' + join(first) + '<div class="cascade-break"></div>' + join(second) + '<div class="cascade-break"></div>' + join(third) + '</div></section>' + cta;
    }
    if (variant === 4) {
      return hero + '<section class="variant variant-proof"><div class="container proof-layout"><div class="proof-top"><article class="proof-stamp">Scope -> Besluit -> Actie</article>' + join(second) + '</div><div class="proof-grid"><div class="proof-col">' + join(first) + '</div><div class="proof-col">' + join(third) + '</div></div></div></section>' + cta;
    }
    if (variant === 5) {
      return hero + '<section class="variant variant-contrast"><div class="container contrast-layout"><div class="contrast-row">' + join(first.slice(0, 2)) + '</div><div class="contrast-row contrast-alt">' + join(first.slice(2).concat(second.slice(0, 1))) + '</div><div class="contrast-stream">' + join(second.slice(1).concat(third)) + '</div></div></section>' + cta;
    }
    if (variant === 6) {
      return hero + '<section class="variant variant-chapter"><div class="container chapter-layout"><div class="chapter-1"><h3 class="chapter-title">Act I</h3>' + join(first) + '</div><div class="chapter-marker"></div><div class="chapter-2"><h3 class="chapter-title">Act II</h3>' + join(second) + '</div><div class="chapter-marker"></div><div class="chapter-3"><h3 class="chapter-title">Act III</h3>' + join(third) + '</div></div></section>' + cta;
    }
    if (variant === 7) {
      return hero + '<section class="variant variant-matrix"><div class="container matrix-layout"><div class="matrix-col matrix-sticky"><article class="matrix-note">Beslisroute</article>' + join(first.concat(second.slice(0, 1))) + '</div><div class="matrix-col">' + join(second.slice(1).concat(third)) + '</div></div></section>' + cta;
    }
    if (variant === 8) {
      return hero + '<section class="variant variant-timeline"><div class="container timeline-layout"><div class="timeline-track"></div><div class="timeline-content"><article class="timeline-intro">Van intake naar oplevering</article>' + join(first.concat(second).concat(third)) + '</div></div></section>' + cta;
    }
    if (variant === 9) {
      return hero + '<section class="variant variant-minimal"><div class="container minimal-layout"><article class="minimal-lead">Essentiële informatie, minimale ruis.</article>' + join(middle) + '</div></section>' + cta;
    }
    if (variant === 10) {
      return hero + '<section class="variant variant-conversion"><div class="container conversion-layout"><div class="conversion-main">' + join(first.concat(second)) + '</div><aside class="conversion-rail"><div class="rail-block">Intentie</div><div class="rail-block">Kwalificatie</div><div class="rail-block">Commitment</div></aside></div><div class="conversion-tail"><div class="conversion-divider"></div>' + join(third) + '</div></section>' + cta;
    }
    return hero + '<section class="variant variant-tour"><div class="container tour-layout"><div class="tour-top"><article class="tour-header">Product Tour</article>' + join(first) + '</div><div class="tour-mid">' + join(second) + '</div><div class="tour-bot"><article class="tour-footer">Actieblok</article>' + join(third) + '</div></div></section>' + cta;
  }

  function shell(params) {
    return '' +
      '<!DOCTYPE html>\n<html lang="nl">\n<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + esc(params.title) + '</title>\n' +
      '  <meta name="description" content="' + esc(params.description) + '">\n' +
      '  <meta name="theme-color" content="' + esc(params.themeColor) + '">\n' +
      '  <link rel="stylesheet" href="assets/styles.css">\n' +
      '</head>\n<body data-theme="' + esc(params.theme) + '" data-layout-variant="' + esc(params.layoutVariant) + '" data-layout-key="' + esc(params.layoutKey) + '" data-section-order="' + esc(params.sectionOrder.join('|')) + '" data-type-pair="' + esc(params.typePair) + '" data-button-style="' + esc(params.buttonStyle) + '" data-card-style="' + esc(params.cardStyle) + '" data-grid-style="' + esc(params.gridStyle) + '" data-spacing-scale="' + esc(params.spacingScale) + '">\n' +
      '  <header class="site-header">\n' +
      '    <div class="container nav-wrap">\n' +
      '      <a class="logo" href="index.html">' + esc(params.brand) + '<span>.</span></a>\n' +
      '      <nav class="site-nav" aria-label="Hoofdnavigatie">' + params.nav + '</nav>\n' +
      '      <a class="btn btn-primary nav-cta" href="contact.html">' + esc(params.primaryCta) + '</a>\n' +
      '      <button class="nav-toggle" type="button" aria-label="Menu">☰</button>\n' +
      '    </div>\n' +
      '  </header>\n' +
      '  <main>' + params.body + '</main>\n' +
      '  <footer class="site-footer">\n' +
      '    <div class="container footer-grid">\n' +
      '      <div><h3>' + esc(params.brand) + '</h3><p>' + esc(params.footerText) + '</p></div>\n' +
      '      <div><h4>Navigatie</h4><ul><li><a href="index.html">Home</a></li><li><a href="' + esc(params.servicesFile) + '">' + esc(params.servicesLabel) + '</a></li><li><a href="about.html">Over</a></li><li><a href="contact.html">Contact</a></li></ul></div>\n' +
      '      <div><h4>Volgende stap</h4><ul><li><a href="contact.html">' + esc(params.primaryCta) + '</a></li><li>' + esc(params.contactPromise) + '</li></ul></div>\n' +
      '    </div>\n' +
      '  </footer>\n' +
      '  <script src="assets/app.js"></script>\n' +
      '</body>\n</html>\n';
  }

  function renderIndex(order, brief, copy, seed) {
    var servicesFile = brief.industry === 'software' ? 'features.html' : 'services.html';
    var servicesLabel = brief.industry === 'software' ? 'Features' : 'Services';

    var map = {};
    seed.sectionOrder.forEach(function (section) {
      map[section] = renderSection(section, copy, seed.layoutVariantKey);
    });

    var body = layoutRender(seed.layoutVariant, seed.sectionOrder, map);

    return shell({
      title: order.clientName + ' | ' + order.title,
      description: copy.hero.claim,
      themeColor: seed.palette.accent,
      theme: brief.theme,
      layoutVariant: String(seed.layoutVariant),
      layoutKey: seed.layoutVariantKey,
      sectionOrder: seed.sectionOrder,
      typePair: String(seed.typePair),
      buttonStyle: seed.buttonStyle,
      cardStyle: seed.cardStyle,
      gridStyle: seed.gridStyle,
      spacingScale: seed.spacingScale,
      brand: order.clientName,
      nav: navHtml(brief, 'index.html'),
      primaryCta: copy.hero.primaryCta,
      body: body,
      footerText: order.title + ' in ' + (order.location || 'jouw regio') + ', gebouwd voor duidelijke keuzes en betere conversie.',
      servicesFile: servicesFile,
      servicesLabel: servicesLabel,
      contactPromise: copy.contactPromise
    });
  }

  function renderServices(order, brief, copy, seed) {
    var file = brief.industry === 'software' ? 'features.html' : 'services.html';
    var label = brief.industry === 'software' ? 'Features' : 'Services';
    var title = brief.industry === 'software'
      ? 'Features die besluitvorming versnellen'
      : 'Services die aanvragen kwalificeren';

    var intro = brief.industry === 'software'
      ? 'Elke featurekaart koppelt productwaarde aan concrete beslisactie in de funnel.'
      : 'Elke servicekaart is direct-response geschreven op duidelijk voordeel en vervolgstap.';

    var cards = copy.featureCards.map(function (card, i) {
      return '<article class="feature-card reveal"><span class="idx">0' + (i + 1) + '</span><h3>' + esc(card.title) + '</h3><p>' + esc(card.text) + '</p></article>';
    }).join('');

    return shell({
      title: title + ' | ' + order.clientName,
      description: intro,
      themeColor: seed.palette.accent,
      theme: brief.theme,
      layoutVariant: String(seed.layoutVariant),
      layoutKey: seed.layoutVariantKey,
      sectionOrder: seed.sectionOrder,
      typePair: String(seed.typePair),
      buttonStyle: seed.buttonStyle,
      cardStyle: seed.cardStyle,
      gridStyle: seed.gridStyle,
      spacingScale: seed.spacingScale,
      brand: order.clientName,
      nav: navHtml(brief, file),
      primaryCta: copy.hero.primaryCta,
      body: '<section class="section"><div class="container"><div class="section-head"><p class="eyebrow">' + esc(label) + '</p><h1>' + esc(title) + '</h1><p>' + esc(intro) + '</p></div><div class="feature-grid">' + cards + '</div></div></section>' + renderCta(copy),
      footerText: 'Concreet aanbod voor ' + order.clientName + ' met focus op duidelijkheid en actie.',
      servicesFile: file,
      servicesLabel: label,
      contactPromise: copy.contactPromise
    });
  }

  function renderAbout(order, brief, copy, seed) {
    var points = copy.aboutPoints.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    var file = brief.industry === 'software' ? 'features.html' : 'services.html';
    var label = brief.industry === 'software' ? 'Features' : 'Services';

    return shell({
      title: 'Over | ' + order.clientName,
      description: 'Strategische aanpak voor premium webconversie.',
      themeColor: seed.palette.accent,
      theme: brief.theme,
      layoutVariant: String(seed.layoutVariant),
      layoutKey: seed.layoutVariantKey,
      sectionOrder: seed.sectionOrder,
      typePair: String(seed.typePair),
      buttonStyle: seed.buttonStyle,
      cardStyle: seed.cardStyle,
      gridStyle: seed.gridStyle,
      spacingScale: seed.spacingScale,
      brand: order.clientName,
      nav: navHtml(brief, 'about.html'),
      primaryCta: copy.hero.primaryCta,
      body: '<section class="section"><div class="container about-layout"><article class="about-card reveal"><p class="eyebrow">Over de aanpak</p><h1>Design en copy als één systeem</h1><p>Geen losse pagina\'s, maar een commerciële route die bezoekers richting actie beweegt.</p><ul>' + points + '</ul></article><article class="about-card reveal"><h2>Positionering</h2><p>' + esc(brief.differentiator_angle) + '</p><p>Creatieve marketingstijl blijft gekoppeld aan concrete conversiedoelen.</p></article></div></section>' + renderCta(copy),
      footerText: 'Commerciële webarchitectuur voor voorspelbare groei en betere aanvragen.',
      servicesFile: file,
      servicesLabel: label,
      contactPromise: copy.contactPromise
    });
  }

  function renderContact(order, brief, copy, seed) {
    var file = brief.industry === 'software' ? 'features.html' : 'services.html';
    var label = brief.industry === 'software' ? 'Features' : 'Services';

    return shell({
      title: 'Contact | ' + order.clientName,
      description: 'Start met een compacte intake en duidelijke vervolgstap.',
      themeColor: seed.palette.accent,
      theme: brief.theme,
      layoutVariant: String(seed.layoutVariant),
      layoutKey: seed.layoutVariantKey,
      sectionOrder: seed.sectionOrder,
      typePair: String(seed.typePair),
      buttonStyle: seed.buttonStyle,
      cardStyle: seed.cardStyle,
      gridStyle: seed.gridStyle,
      spacingScale: seed.spacingScale,
      brand: order.clientName,
      nav: navHtml(brief, 'contact.html'),
      primaryCta: copy.hero.primaryCta,
      body: '<section class="section"><div class="container contact-layout"><article class="contact-card reveal"><p class="eyebrow">Contact</p><h1>' + esc(copy.hero.primaryCta) + '</h1><p>Omschrijf kort je situatie, doel en gewenste timing. Je krijgt een heldere vervolgstap.</p><ul><li>Focus: ' + esc(brief.differentiator_angle) + '</li><li>Uitkomst: ' + esc(brief.desired_outcomes[0]) + '</li><li>' + esc(copy.contactPromise) + '</li></ul></article><form class="contact-card contact-form reveal" data-demo-form><label>Naam<input type="text" name="name" required></label><label>E-mail<input type="email" name="email" required></label><label>Bedrijf<input type="text" name="company"></label><label>Vraag<textarea name="message" rows="5" required></textarea></label><button class="btn btn-primary" type="submit">' + esc(copy.hero.primaryCta) + '</button><p class="form-feedback" hidden>Bedankt. Je bericht is ontvangen.</p></form></div></section>',
      footerText: 'Contactroute die snel van vraag naar inhoudelijk gesprek beweegt.',
      servicesFile: file,
      servicesLabel: label,
      contactPromise: copy.contactPromise
    });
  }

  function buildStyles(seed) {
    var p = seed.palette;

    var space = seed.spacingScale === 'wide'
      ? ['0.35rem', '0.65rem', '1rem', '1.35rem', '1.8rem', '2.5rem', '3.4rem', '4.8rem']
      : seed.spacingScale === 'airy'
        ? ['0.3rem', '0.55rem', '0.9rem', '1.25rem', '1.65rem', '2.25rem', '3rem', '4.2rem']
        : seed.spacingScale === 'tight'
          ? ['0.2rem', '0.45rem', '0.75rem', '1rem', '1.35rem', '1.8rem', '2.4rem', '3.2rem']
          : ['0.25rem', '0.5rem', '0.82rem', '1.12rem', '1.5rem', '2rem', '2.7rem', '3.8rem'];

    var visualByVariant = [
      ['radial-gradient(circle at 11% 8%, color-mix(in srgb, var(--color-accent) 26%, transparent) 0%, transparent 46%)', 'repeating-linear-gradient(90deg, transparent 0 52px, color-mix(in srgb, var(--color-accent) 9%, transparent) 52px 53px)'],
      ['linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 20%, transparent) 0%, transparent 60%)', 'radial-gradient(circle at 89% 22%, color-mix(in srgb, var(--color-accent-alt) 20%, transparent) 0%, transparent 48%)'],
      ['radial-gradient(circle at 83% 12%, color-mix(in srgb, var(--color-accent-alt) 24%, transparent) 0%, transparent 52%)', 'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 11%, transparent), transparent 35%)'],
      ['radial-gradient(circle at 20% 80%, color-mix(in srgb, var(--color-accent) 22%, transparent) 0%, transparent 58%)', 'repeating-linear-gradient(45deg, transparent 0 34px, color-mix(in srgb, var(--color-accent-alt) 10%, transparent) 34px 35px)'],
      ['linear-gradient(160deg, color-mix(in srgb, var(--color-accent) 18%, transparent), transparent 66%)', 'radial-gradient(circle at 76% 32%, color-mix(in srgb, var(--color-accent-alt) 18%, transparent) 0%, transparent 50%)'],
      ['radial-gradient(circle at 48% 9%, color-mix(in srgb, var(--color-accent) 19%, transparent) 0%, transparent 45%)', 'repeating-linear-gradient(120deg, transparent 0 58px, color-mix(in srgb, var(--color-accent) 9%, transparent) 58px 59px)'],
      ['linear-gradient(180deg, color-mix(in srgb, var(--color-accent-alt) 16%, transparent), transparent 58%)', 'radial-gradient(circle at 14% 86%, color-mix(in srgb, var(--color-accent) 20%, transparent) 0%, transparent 50%)'],
      ['radial-gradient(circle at 89% 84%, color-mix(in srgb, var(--color-accent) 18%, transparent) 0%, transparent 56%)', 'repeating-linear-gradient(90deg, transparent 0 44px, color-mix(in srgb, var(--color-accent-alt) 8%, transparent) 44px 45px)'],
      ['linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 15%, transparent), transparent 60%)', 'radial-gradient(circle at 71% 16%, color-mix(in srgb, var(--color-accent-alt) 18%, transparent) 0%, transparent 44%)'],
      ['radial-gradient(circle at 14% 18%, color-mix(in srgb, var(--color-accent-alt) 18%, transparent) 0%, transparent 52%)', 'repeating-linear-gradient(0deg, transparent 0 56px, color-mix(in srgb, var(--color-accent) 8%, transparent) 56px 57px)'],
      ['linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 42%)', 'radial-gradient(circle at 82% 50%, color-mix(in srgb, var(--color-accent-alt) 20%, transparent) 0%, transparent 50%)'],
      ['radial-gradient(circle at 42% 12%, color-mix(in srgb, var(--color-accent) 15%, transparent) 0%, transparent 48%)', 'repeating-linear-gradient(135deg, transparent 0 50px, color-mix(in srgb, var(--color-accent-alt) 10%, transparent) 50px 51px)']
    ];

    var variantVisual = visualByVariant[seed.layoutVariant] || visualByVariant[0];
    var variantId = String(seed.layoutVariant);

    return [
      ':root {',
      '  --color-bg: ' + p.bg + ';',
      '  --color-surface-0: color-mix(in srgb, ' + p.surface + ' 40%, transparent);',
      '  --color-surface-1: ' + p.surface + ';',
      '  --color-surface-2: color-mix(in srgb, ' + p.surface + ' 82%, transparent);',
      '  --color-surface-3: color-mix(in srgb, ' + p.surface + ' 62%, transparent);',
      '  --color-surface-4: color-mix(in srgb, ' + p.surface + ' 48%, transparent);',
      '  --color-text: ' + p.text + ';',
      '  --color-muted: ' + p.muted + ';',
      '  --color-border: ' + p.border + ';',
      '  --color-accent: ' + p.accent + ';',
      '  --color-accent-alt: ' + p.accentAlt + ';',
      '  --color-success: #1f9e5b;',
      '  --color-warning: #d18b1f;',
      '  --color-danger: #c44747;',
      '  --type-h1: clamp(2.2rem, 6.2vw, 5.4rem);',
      '  --type-h2: clamp(1.7rem, 4.4vw, 3.2rem);',
      '  --type-h3: clamp(1.05rem, 2.2vw, 1.42rem);',
      '  --type-body: 1rem;',
      '  --type-small: .86rem;',
      '  --type-display: clamp(2.6rem, 8.4vw, 7rem);',
      '  --type-label: .72rem;',
      '  --space-1: ' + space[0] + ';',
      '  --space-2: ' + space[1] + ';',
      '  --space-3: ' + space[2] + ';',
      '  --space-4: ' + space[3] + ';',
      '  --space-5: ' + space[4] + ';',
      '  --space-6: ' + space[5] + ';',
      '  --space-7: ' + space[6] + ';',
      '  --space-8: ' + space[7] + ';',
      '  --space-9: calc(var(--space-8) * 1.2);',
      '  --radius-sm: calc(' + seed.borderRadius + ' * .55);',
      '  --radius-md: ' + seed.borderRadius + ';',
      '  --radius-lg: calc(' + seed.borderRadius + ' * 1.45);',
      '  --radius-xl: calc(' + seed.borderRadius + ' * 2.1);',
      '  --radius-pill: 999px;',
      '  --shadow-soft: 0 10px 28px rgba(0,0,0,.08);',
      '  --shadow-strong: 0 20px 48px rgba(0,0,0,.16);',
      '  --shadow-panel: 0 14px 34px rgba(0,0,0,.11);',
      '  --border-1: 1px solid var(--color-border);',
      '  --border-2: 2px solid color-mix(in srgb, var(--color-accent) 24%, var(--color-border));',
      '  --motion-fast: .18s ease;',
      '  --motion-base: .28s cubic-bezier(.2,.7,.2,1);',
      '  --motion-slow: .42s cubic-bezier(.2,.7,.2,1);',
      '  --mesh-1: ' + variantVisual[0] + ';',
      '  --mesh-2: ' + variantVisual[1] + ';',
      '}',
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; }',
      'body {',
      '  font-family: ' + seed.typography_pairing.body + ';',
      '  font-size: var(--type-body);',
      '  color: var(--color-text);',
      '  background: var(--color-bg);',
      '  line-height: 1.68;',
      '  text-rendering: optimizeLegibility;',
      '  position: relative;',
      '}',
      'body[data-grid-style="asymmetric"] .container { width: min(1280px, calc(100% - 3rem)); }',
      'body[data-grid-style="bento"] .container { width: min(1320px, calc(100% - 3rem)); }',
      'body[data-grid-style="timeline"] .container { width: min(1200px, calc(100% - 3rem)); }',
      'body::before, body::after {',
      '  content: "";',
      '  position: fixed;',
      '  inset: 0;',
      '  pointer-events: none;',
      '  z-index: 0;',
      '}',
      'body::before { background: var(--mesh-1); opacity: .95; }',
      'body::after { background: var(--mesh-2); opacity: .62; mix-blend-mode: multiply; }',
      'main, header, footer { position: relative; z-index: 1; }',
      'h1, h2, h3, h4 { font-family: ' + seed.typography_pairing.headings + '; text-transform: uppercase; letter-spacing: .02em; line-height: 1.04; margin: 0; }',
      'h1 { font-size: var(--type-h1); }',
      'h2 { font-size: var(--type-h2); }',
      'h3 { font-size: var(--type-h3); }',
      'p { margin: 0; }',
      'a { color: inherit; text-decoration: none; }',
      '.container { width: min(1240px, calc(100% - 3rem)); margin: 0 auto; }',
      '.site-header {',
      '  position: sticky; top: 0; z-index: 40;',
      '  border-bottom: var(--border-1);',
      '  backdrop-filter: blur(12px);',
      '  background: color-mix(in srgb, var(--color-bg) 84%, transparent);',
      '}',
      '.nav-wrap { min-height: 78px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }',
      '.logo { font-family: ' + seed.typography_pairing.headings + '; font-size: 1.3rem; font-weight: 700; }',
      '.logo span { color: var(--color-accent); }',
      '.site-nav { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }',
      '.site-nav a { font-size: .74rem; text-transform: uppercase; letter-spacing: .11em; color: var(--color-muted); padding: var(--space-1) 0; border-bottom: 2px solid transparent; transition: color var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast); }',
      '.site-nav a:hover, .site-nav a:focus, .site-nav a.active { color: var(--color-text); border-bottom-color: var(--color-accent); }',
      '.site-nav a:active { transform: translateY(1px); }',
      '.nav-toggle { display: none; width: 38px; height: 38px; border: var(--border-1); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text); }',
      '.section { padding: var(--space-8) 0; }',
      '.section-alt { background: var(--color-surface-2); border-top: var(--border-1); border-bottom: var(--border-1); }',
      '.section-cta { padding-top: calc(var(--space-8) * .78); }',
      '.eyebrow { font-family: ' + seed.typography_pairing.headings + '; font-size: .72rem; text-transform: uppercase; letter-spacing: .14em; color: var(--color-accent); margin-bottom: var(--space-2); }',
      '.section-head { max-width: 760px; margin-bottom: var(--space-5); }',
      '.section-head p { color: var(--color-muted); max-width: 70ch; }',
      '.hero-grid { display: grid; gap: var(--space-4); grid-template-columns: 1.08fr .92fr; }',
      '.hero-editorial { display: grid; grid-template-columns: .26fr .52fr .22fr; gap: var(--space-4); align-items: start; }',
      '.hero-timeline-shell { display: grid; grid-template-columns: .62fr .38fr; gap: var(--space-4); }',
      '.hero-product-shell { display: grid; grid-template-columns: .58fr .42fr; gap: var(--space-4); align-items: start; }',
      '.hero-kicker { background: var(--color-surface-2); border: var(--border-1); border-radius: var(--radius-lg); padding: var(--space-4); color: var(--color-muted); position: sticky; top: 108px; }',
      '.hero-tour { display: grid; gap: var(--space-3); }',
      '.hero-tour-card { background: var(--color-surface-1); border: var(--border-1); border-radius: var(--radius-lg); padding: var(--space-4); display: grid; gap: var(--space-2); box-shadow: var(--shadow-soft); }',
      '.hero-tour-card span { font-family: ' + seed.typography_pairing.headings + '; color: var(--color-accent); letter-spacing: .09em; }',
      '.hero-timeline { display: grid; gap: var(--space-3); }',
      '.hero-timeline article { background: var(--color-surface-1); border: var(--border-1); border-radius: var(--radius-lg); padding: var(--space-4); display: grid; gap: var(--space-2); }',
      '.hero-timeline article span { font-family: ' + seed.typography_pairing.headings + '; color: var(--color-accent); }',
      '.hero-main, .hero-side, .value-strip, .card, .benefit, .signature-card, .process, .trust-wrap, .faq-item, .cta-card, .feature-card, .about-card, .contact-card, .rail-block { background: var(--color-surface-1); border: var(--border-1); border-radius: var(--radius-md); }',
      '.hero-main, .hero-side { padding: var(--space-6); }',
      '.hero-main h1 span { color: var(--color-accent); }',
      '.hero-claim { font-size: clamp(1.05rem, 2vw, 1.28rem); margin-bottom: var(--space-2); }',
      '.hero-sub { color: var(--color-muted); margin-bottom: var(--space-4); max-width: 62ch; }',
      '.hero-ctas { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
      '.hero-side ul { margin: 0; padding-left: var(--space-4); display: grid; gap: var(--space-2); color: var(--color-muted); }',
      '.note { color: var(--color-muted); margin-top: var(--space-2); font-size: var(--type-small); }',
      '.value-strip { padding: var(--space-4) var(--space-5); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }',
      '.value-strip p { color: var(--color-muted); }',
      '.card-grid, .benefit-grid, .feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: var(--space-4); }',
      '.card, .benefit, .feature-card { padding: var(--space-5); display: grid; gap: var(--space-2); transition: transform var(--motion-base), border-color var(--motion-base), box-shadow var(--motion-base), background var(--motion-base); }',
      '.card:hover, .benefit:hover, .feature-card:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--color-accent) 42%, var(--color-border)); box-shadow: var(--shadow-soft); }',
      '.card:active, .benefit:active, .feature-card:active { transform: translateY(-1px); }',
      '.idx { font-family: ' + seed.typography_pairing.headings + '; color: var(--color-accent); font-size: 1.02rem; letter-spacing: .08em; }',
      '.card p, .benefit p, .feature-card p, .process p, .about-card p, .contact-card p, .signature-card p { color: var(--color-muted); }',
      '.outcome { color: var(--color-text) !important; }',
      '.signature-card { padding: var(--space-6); display: grid; gap: var(--space-2); }',
      '.signature-card ul { margin: 0; padding-left: var(--space-4); display: grid; gap: var(--space-2); color: var(--color-muted); }',
      '.signature-specifics { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }',
      '.signature-specifics span { font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; border: var(--border-1); border-radius: var(--radius-pill); padding: .32rem .72rem; color: var(--color-muted); }',
      '.process-list { display: grid; gap: var(--space-3); }',
      '.process { padding: var(--space-4) var(--space-5); display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); align-items: start; }',
      '.process span { color: var(--color-accent); font-family: ' + seed.typography_pairing.headings + '; font-size: 1.12rem; }',
      '.trust-wrap { padding: var(--space-6); display: grid; grid-template-columns: 1fr .95fr; gap: var(--space-4); }',
      '.trust-wrap ul { margin: 0; padding-left: var(--space-4); display: grid; gap: var(--space-2); color: var(--color-muted); }',
      '.faq-list { display: grid; gap: var(--space-3); }',
      '.faq-item { overflow: hidden; }',
      '.faq-question { width: 100%; border: 0; background: transparent; text-align: left; padding: var(--space-4) var(--space-5); font-family: ' + seed.typography_pairing.headings + '; text-transform: uppercase; letter-spacing: .03em; font-size: .92rem; color: var(--color-text); cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast); }',
      '.faq-question:hover, .faq-question:focus { background: var(--color-surface-3); color: var(--color-accent); }',
      '.faq-question:active { transform: translateY(1px); }',
      '.faq-answer { max-height: 0; overflow: hidden; transition: max-height var(--motion-slow); }',
      '.faq-answer p { padding: 0 var(--space-5) var(--space-4); }',
      '.faq-item.open .faq-answer { max-height: 280px; }',
      '.cta-card { padding: var(--space-6); display: grid; gap: var(--space-3); }',
      '.about-layout, .contact-layout { display: grid; grid-template-columns: 1.02fr .98fr; gap: var(--space-4); }',
      '.about-card, .contact-card { padding: var(--space-5); display: grid; gap: var(--space-2); }',
      '.about-card ul, .contact-card ul { margin: 0; padding-left: var(--space-4); display: grid; gap: var(--space-2); color: var(--color-muted); }',
      '.contact-form label { display: grid; gap: var(--space-1); color: var(--color-muted); font-size: var(--type-small); }',
      '.contact-form input, .contact-form textarea { width: 100%; font: inherit; color: var(--color-text); background: var(--color-surface-2); border: var(--border-1); border-radius: var(--radius-sm); padding: var(--space-3) var(--space-3); transition: border-color var(--motion-fast), box-shadow var(--motion-fast), background var(--motion-fast); }',
      '.contact-form input:hover, .contact-form textarea:hover { border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border)); }',
      '.contact-form input:focus, .contact-form textarea:focus { outline: none; border-color: var(--color-accent); background: var(--color-surface-1); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 24%, transparent); }',
      '.contact-form input:active, .contact-form textarea:active { border-color: color-mix(in srgb, var(--color-accent-alt) 34%, var(--color-border)); }',
      '.form-feedback { color: var(--color-accent); font-size: .9rem; }',
      '.site-footer { border-top: var(--border-1); background: var(--color-surface-2); margin-top: var(--space-7); padding: var(--space-7) 0; }',
      '.footer-grid { display: grid; grid-template-columns: 1.2fr .8fr .8fr; gap: var(--space-4); }',
      '.footer-grid ul { margin: 0; padding-left: var(--space-4); display: grid; gap: var(--space-2); }',
      '.footer-grid p, .footer-grid li { color: var(--color-muted); }',
      '.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-3) var(--space-5); border-radius: var(--radius-md); border: 1px solid transparent; text-transform: uppercase; letter-spacing: .08em; font-family: ' + seed.typography_pairing.headings + '; font-size: .78rem; transition: transform var(--motion-base), background var(--motion-base), color var(--motion-base), border-color var(--motion-base), box-shadow var(--motion-base); }',
      '.btn-primary { background: var(--color-accent); color: #fff; }',
      '.btn-primary:hover, .btn-primary:focus { transform: translateY(-2px); background: color-mix(in srgb, var(--color-accent) 88%, var(--color-accent-alt)); box-shadow: var(--shadow-strong); }',
      '.btn-primary:active { transform: translateY(0); }',
      '.btn-secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }',
      '.btn-secondary:hover, .btn-secondary:focus { border-color: var(--color-accent); color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); }',
      '.btn-secondary:active { transform: translateY(1px); }',
      'body[data-button-style="pill"] .btn { border-radius: 999px; }',
      'body[data-button-style="underline"] .btn-primary { background: transparent; color: var(--color-text); border: 0; border-bottom: 2px solid var(--color-accent); border-radius: 0; padding-inline: 0; box-shadow: none; }',
      'body[data-card-style="glass"] .card, body[data-card-style="glass"] .benefit, body[data-card-style="glass"] .feature-card, body[data-card-style="glass"] .signature-card { background: color-mix(in srgb, var(--color-surface-1) 72%, transparent); backdrop-filter: blur(8px); }',
      'body[data-card-style="panel"] .card, body[data-card-style="panel"] .benefit, body[data-card-style="panel"] .feature-card, body[data-card-style="panel"] .signature-card { border-width: 2px; }',
      'body[data-card-style="elevated"] .card, body[data-card-style="elevated"] .benefit, body[data-card-style="elevated"] .feature-card, body[data-card-style="elevated"] .signature-card { box-shadow: var(--shadow-panel); }',
      '.variant { padding: 0 0 var(--space-6); }',
      '.variant-bento .bento-layout { display: grid; grid-template-columns: 1.15fr .85fr; gap: var(--space-4); }',
      '.variant-bento .bento-kpi { font-family: ' + seed.typography_pairing.headings + '; text-transform: uppercase; letter-spacing: .1em; color: var(--color-accent); border: var(--border-2); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-3); text-align: center; }',
      '.variant-bento .bento-foot { grid-column: 1 / -1; }',
      '.variant-editorial .editorial-layout { display: grid; grid-template-columns: .25fr .75fr; gap: var(--space-4); }',
      '.variant-editorial .editorial-block { display: grid; gap: var(--space-4); }',
      '.editorial-rail { position: sticky; top: 94px; align-self: start; border: var(--border-1); border-radius: var(--radius-md); background: var(--color-surface-1); padding: var(--space-4); font-family: ' + seed.typography_pairing.headings + '; font-size: .72rem; text-transform: uppercase; letter-spacing: .12em; color: var(--color-muted); display: grid; gap: var(--space-2); }',
      '.variant-split .split-layout { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }',
      '.split-stack { display: grid; gap: var(--space-4); }',
      '.variant-cascade .cascade-intro { margin-bottom: var(--space-4); background: var(--color-surface-1); border: var(--border-2); border-radius: var(--radius-lg); padding: var(--space-4); font-family: ' + seed.typography_pairing.headings + '; text-transform: uppercase; letter-spacing: .08em; color: var(--color-accent); }',
      '.variant-cascade .cascade-break, .variant-chapter .chapter-marker { height: 2px; background: color-mix(in srgb, var(--color-accent) 44%, var(--color-border)); margin: var(--space-2) 0; }',
      '.chapter-title { color: var(--color-accent); margin-bottom: var(--space-3); font-size: .84rem; letter-spacing: .12em; }',
      '.variant-proof .proof-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }',
      '.proof-stamp { margin-bottom: var(--space-4); border: var(--border-2); border-radius: var(--radius-pill); padding: .5rem 1rem; display: inline-flex; font-family: ' + seed.typography_pairing.headings + '; font-size: .74rem; letter-spacing: .1em; color: var(--color-accent); }',
      '.proof-col { display: grid; gap: var(--space-4); }',
      '.variant-contrast .contrast-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }',
      '.variant-contrast .contrast-alt { transform: translateX(var(--space-3)); }',
      '.variant-matrix .matrix-layout { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }',
      '.matrix-note { border: var(--border-2); border-radius: var(--radius-md); padding: var(--space-3); text-transform: uppercase; letter-spacing: .08em; color: var(--color-accent); font-family: ' + seed.typography_pairing.headings + '; }',
      '.matrix-sticky { position: sticky; top: 96px; align-self: start; display: grid; gap: var(--space-4); }',
      '.variant-timeline .timeline-layout { position: relative; padding-left: var(--space-6); }',
      '.variant-timeline .timeline-track { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(to bottom, var(--color-accent), var(--color-accent-alt)); border-radius: 999px; }',
      '.timeline-intro { margin-bottom: var(--space-4); border: var(--border-2); border-radius: var(--radius-lg); padding: var(--space-4); color: var(--color-accent); font-family: ' + seed.typography_pairing.headings + '; text-transform: uppercase; letter-spacing: .08em; }',
      '.variant-minimal .minimal-layout { max-width: 980px; margin: 0 auto; }',
      '.minimal-lead { margin-bottom: var(--space-4); color: var(--color-muted); font-size: 1.08rem; }',
      '.variant-conversion .conversion-layout { display: grid; grid-template-columns: 1fr .34fr; gap: var(--space-4); align-items: start; }',
      '.variant-conversion .conversion-rail { position: sticky; top: 96px; display: grid; gap: var(--space-2); }',
      '.conversion-divider { height: 2px; width: 100%; margin-bottom: var(--space-4); background: linear-gradient(90deg, var(--color-accent), transparent); }',
      '.rail-block { padding: var(--space-3) var(--space-3); text-transform: uppercase; letter-spacing: .1em; font-family: ' + seed.typography_pairing.headings + '; font-size: .72rem; color: var(--color-muted); }',
      '.variant-tour .tour-layout { display: grid; gap: var(--space-4); }',
      '.tour-header, .tour-footer { border: var(--border-2); border-radius: var(--radius-md); padding: var(--space-3); color: var(--color-accent); font-family: ' + seed.typography_pairing.headings + '; text-transform: uppercase; letter-spacing: .09em; margin-bottom: var(--space-3); }',
      '.reveal { opacity: 0; transform: translateY(12px); transition: opacity var(--motion-slow), transform var(--motion-slow); }',
      '.reveal.in { opacity: 1; transform: translateY(0); }',
      '.hero::before, .signature::before { content: ""; position: absolute; inset: auto 0 0 0; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-accent) 65%, transparent), transparent); pointer-events: none; }',
      '.hero { position: relative; overflow: clip; }',
      '.signature { position: relative; overflow: clip; }',
      '.hero::after { content: ""; position: absolute; width: 420px; height: 420px; right: -140px; top: -140px; background: radial-gradient(circle, color-mix(in srgb, var(--color-accent) 22%, transparent) 0%, transparent 66%); pointer-events: none; }',
      '.signature::after { content: ""; position: absolute; width: 360px; height: 360px; left: -120px; bottom: -160px; background: radial-gradient(circle, color-mix(in srgb, var(--color-accent-alt) 18%, transparent) 0%, transparent 68%); pointer-events: none; }',
      'body[data-layout-variant="0"] .hero-main { box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent), var(--shadow-soft); }',
      'body[data-layout-variant="1"] .editorial-rail { background: color-mix(in srgb, var(--color-surface-1) 70%, transparent); backdrop-filter: blur(8px); }',
      'body[data-layout-variant="2"] .hero-grid { grid-template-columns: 1fr 1fr; }',
      'body[data-layout-variant="3"] .hero-side { border-style: dashed; }',
      'body[data-layout-variant="4"] .trust-wrap { box-shadow: var(--shadow-soft); }',
      'body[data-layout-variant="5"] .card, body[data-layout-variant="5"] .benefit { border-width: 2px; }',
      'body[data-layout-variant="6"] .signature-card { border-radius: var(--radius-lg); }',
      'body[data-layout-variant="7"] .matrix-col { display: grid; gap: var(--space-4); }',
      'body[data-layout-variant="8"] .process { position: relative; }',
      'body[data-layout-variant="9"] .hero-main, body[data-layout-variant="9"] .hero-side { border-width: 2px; }',
      'body[data-layout-variant="10"] .rail-block { border-left: 3px solid var(--color-accent); }',
      'body[data-layout-variant="11"] .feature-card { background: color-mix(in srgb, var(--color-surface-1) 86%, transparent); backdrop-filter: blur(6px); }',
      'body[data-layout-variant="' + variantId + '"] .hero { --variant-focus: var(--color-accent); }',
      'body[data-layout-variant="' + variantId + '"] .signature-card { border-image: linear-gradient(120deg, color-mix(in srgb, var(--color-accent) 62%, transparent), transparent) 1; }',
      'body[data-layout-variant="' + variantId + '"] .hero-main { background-image: linear-gradient(145deg, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 46%); }',
      'body[data-layout-variant="' + variantId + '"] .signature-card::after { content: ""; display: block; height: 1px; background: linear-gradient(90deg, var(--color-accent), transparent); margin-top: var(--space-3); }',
      '@media (max-width: 1080px) {',
      '  .container { width: min(1240px, calc(100% - 2rem)); }',
      '  .site-nav { display: none; }',
      '  .nav-toggle { display: inline-flex; align-items: center; justify-content: center; }',
      '  .hero-grid, .hero-editorial, .hero-timeline-shell, .hero-product-shell, .card-grid, .benefit-grid, .feature-grid, .about-layout, .contact-layout, .footer-grid, .trust-wrap, .variant-bento .bento-layout, .variant-editorial .editorial-layout, .variant-split .split-layout, .variant-proof .proof-grid, .variant-contrast .contrast-row, .variant-matrix .matrix-layout, .variant-conversion .conversion-layout { grid-template-columns: 1fr; }',
      '  .variant-conversion .conversion-rail, .editorial-rail { position: static; }',
      '  .matrix-sticky { position: static; }',
      '  .variant-contrast .contrast-alt { transform: none; }',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }',
      '}'
    ].join('\n');
  }

  function buildAppJs() {
    return [
      '(function(){',
      '  var io = new IntersectionObserver(function(entries){',
      '    entries.forEach(function(entry){ if(entry.isIntersecting) entry.target.classList.add("in"); });',
      '  }, { threshold: 0.12 });',
      '  document.querySelectorAll(".reveal").forEach(function(el){ io.observe(el); });',
      '',
      '  document.querySelectorAll(".faq-question").forEach(function(btn){',
      '    btn.addEventListener("click", function(){',
      '      var item = btn.closest(".faq-item");',
      '      document.querySelectorAll(".faq-item").forEach(function(el){ if(el !== item) el.classList.remove("open"); });',
      '      item.classList.toggle("open");',
      '    });',
      '  });',
      '',
      '  var navToggle = document.querySelector(".nav-toggle");',
      '  var nav = document.querySelector(".site-nav");',
      '  if(navToggle && nav){',
      '    navToggle.addEventListener("click", function(){',
      '      if(nav.style.display === "flex"){ nav.style.display = "none"; }',
      '      else { nav.style.display = "flex"; nav.style.flexDirection = "column"; nav.style.alignItems = "flex-start"; }',
      '    });',
      '  }',
      '',
      '  document.querySelectorAll("form[data-demo-form]").forEach(function(form){',
      '    form.addEventListener("submit", function(e){',
      '      e.preventDefault();',
      '      var msg = form.querySelector(".form-feedback");',
      '      if(msg) msg.hidden = false;',
      '      form.reset();',
      '    });',
      '  });',
      '})();'
    ].join('\n');
  }

  function renderSite(order, brief, copy, seed) {
    var files = {};
    var servicesFile = brief.industry === 'software' ? 'features.html' : 'services.html';

    files['index.html'] = renderIndex(order, brief, copy, seed);
    files[servicesFile] = renderServices(order, brief, copy, seed);
    files['about.html'] = renderAbout(order, brief, copy, seed);
    files['contact.html'] = renderContact(order, brief, copy, seed);
    files['assets/styles.css'] = buildStyles(seed);
    files['assets/app.js'] = buildAppJs();

    return files;
  }

  function parseTokensFromIndex(indexHtml) {
    var wrappers = [];
    var m;
    var regex = /class="([^"]+)"/g;
    while ((m = regex.exec(indexHtml)) !== null) {
      var parts = m[1].split(/\s+/);
      parts.forEach(function (p) {
        if (/^(variant|hero|section|signature|bento|editorial|split|matrix|timeline|conversion|tour|rail)/.test(p)) {
          wrappers.push(p);
        }
      });
    }
    return uniq(wrappers);
  }

  function parseSectionSequence(indexHtml) {
    var seq = [];
    var re = /data-section="([^"]+)"/g;
    var m;
    while ((m = re.exec(indexHtml)) !== null) {
      seq.push(String(m[1]));
    }
    return seq;
  }

  function jaccard(a, b) {
    var A = Object.create(null);
    var B = Object.create(null);
    var i;
    for (i = 0; i < a.length; i++) A[a[i]] = true;
    for (i = 0; i < b.length; i++) B[b[i]] = true;

    var inter = 0;
    var union = 0;
    var key;
    var all = Object.create(null);
    for (key in A) all[key] = true;
    for (key in B) all[key] = true;

    for (key in all) {
      union += 1;
      if (A[key] && B[key]) inter += 1;
    }

    if (!union) return 0;
    return inter / union;
  }

  function makeSignature(styleSeed, files) {
    var index = String(files['index.html'] || '');
    var sequence = parseSectionSequence(index);
    var wrappers = parseTokensFromIndex(index);
    var heroStructure = index.indexOf('hero-editorial') !== -1 ? 'hero-editorial'
      : index.indexOf('hero-timeline-shell') !== -1 ? 'hero-timeline'
      : index.indexOf('hero-product-shell') !== -1 ? 'hero-product'
      : 'hero-grid';
    var tokens = [
      'layout:' + styleSeed.layoutVariant,
      'type:' + styleSeed.typePair,
      'sigA:' + (styleSeed.signature_payload && styleSeed.signature_payload.a ? styleSeed.signature_payload.a.id : 'none'),
      'sigB:' + (styleSeed.signature_payload && styleSeed.signature_payload.b ? styleSeed.signature_payload.b.id : 'none')
    ]
      .concat((styleSeed.sectionOrder || []).map(function (s, i) { return 's' + i + ':' + s; }))
      .concat(sequence.map(function (s, i) { return 'dom' + i + ':' + s; }))
      .concat('hero-structure:' + heroStructure)
      .concat(wrappers);

    return {
      tokens: uniq(tokens),
      section_order: (styleSeed.sectionOrder || []).slice(),
      dom_section_sequence: sequence,
      hero_structure: heroStructure,
      layout_variant: styleSeed.layoutVariant,
      type_pair: styleSeed.typePair,
      signature_sections: (styleSeed.signatureSections || []).slice()
    };
  }

  function runQAGates(files, styleSeed, brief, previousSignatures) {
    var checks = [];
    var findings = [];

    var allText = Object.keys(files).map(function (k) { return String(files[k] || ''); }).join('\n');
    var lower = allText.toLowerCase();

    FORBIDDEN_WORDS.forEach(function (w) {
      if (lower.indexOf(w) !== -1) findings.push('Verboden term gevonden: ' + w);
    });
    checks.push('Geen verboden placeholder-termen in output');

    var fluffHits = [];
    var fluffCount = 0;
    FLUFF_CLICHES.forEach(function (c) {
      var escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp(escaped, 'gi');
      var matches = lower.match(re);
      if (matches && matches.length) {
        fluffHits.push(c + ' x' + matches.length);
        fluffCount += matches.length;
      }
    });
    if (fluffCount > 2) {
      findings.push('Te veel copy-cliches gevonden (' + fluffCount + '): ' + fluffHits.slice(0, 8).join(', '));
    }
    checks.push('Fluff detector <= 2 clichés');

    var specificityFound = [];
    SPECIFICITY_TERMS.forEach(function (term) {
      if (lower.indexOf(term) !== -1) specificityFound.push(term);
    });
    specificityFound = uniq(specificityFound);
    if (specificityFound.length < 6) {
      findings.push('Specificity te laag (' + specificityFound.length + '/6).');
    }
    var categoryHits = [];
    Object.keys(SPECIFICITY_CATEGORIES).forEach(function (cat) {
      var ok = SPECIFICITY_CATEGORIES[cat].some(function (term) {
        return lower.indexOf(term) !== -1;
      });
      if (ok) categoryHits.push(cat);
    });
    if (categoryHits.length < 4) {
      findings.push('Specificity-categorieën onvoldoende afgedekt (' + categoryHits.length + '/5).');
    }
    checks.push('Specificity check >= 6 concrete termen');

    var required = ['index.html', 'about.html', 'contact.html', 'assets/styles.css', 'assets/app.js', 'brief.json', 'style-seed.json', 'copy.json', 'qa.json'];
    required.forEach(function (f) {
      if (!files[f] && f !== 'qa.json') findings.push('Ontbrekend required bestand: ' + f);
    });
    if (!files['services.html'] && !files['features.html']) {
      findings.push('Ontbrekend services.html/features.html bestand.');
    }
    checks.push('Output-structuur compleet');

    var htmlKeys = Object.keys(files).filter(function (k) { return /\.html$/.test(k); });
    htmlKeys.forEach(function (k) {
      var txt = String(files[k] || '');
      if (txt.indexOf('<!DOCTYPE html>') === -1 || txt.indexOf('<html') === -1 || txt.indexOf('<body') === -1) {
        findings.push('Geen volledig HTML document: ' + k);
      }
    });
    checks.push('Alle pagina\'s zijn volledige HTML documenten');

    var index = String(files['index.html'] || '');
    var heroCtaCount = (index.match(/data-hero-cta=/g) || []).length;
    if (heroCtaCount < 2) findings.push('Hero bevat minder dan 2 CTA\'s.');
    checks.push('Hero bevat 2 CTA\'s');

    var faqCount = (index.match(/data-faq-question=/g) || []).length;
    if (faqCount < 6) findings.push('FAQ bevat minder dan 6 items.');
    checks.push('FAQ >= 6');

    if (index.indexOf('data-signature="a"') === -1 || index.indexOf('data-signature="b"') === -1) {
      findings.push('Signature sections ontbreken.');
    }
    var signatureSpecificCount = (index.match(/class="signature-specifics"/g) || []).length;
    if (signatureSpecificCount < 2) {
      findings.push('Signature sections missen premium specifics blokken.');
    }
    checks.push('Signature sections aanwezig');

    var usedOrder = (styleSeed.sectionOrder || []).join('|');
    var defaultOrder = DEFAULT_SECTION_ORDER.join('|');
    if (usedOrder === defaultOrder) findings.push('Section order is gelijk aan default volgorde.');
    checks.push('Section order gebruikt seeded variatie');

    if (index.indexOf('data-layout-variant="' + styleSeed.layoutVariant + '"') === -1) {
      findings.push('layoutVariant ontbreekt op index body.');
    }
    checks.push('layoutVariant toegepast');

    var css = String(files['assets/styles.css'] || '');
    var tokenChecks = [
      '--type-h1', '--type-display', '--space-1', '--space-8', '--radius-sm', '--radius-pill', '--shadow-soft', '--shadow-panel', '--border-1', '--border-2', '--motion-base', '--color-surface-1', '--color-surface-4', '--mesh-1', '--mesh-2'
    ];
    tokenChecks.forEach(function (t) {
      if (css.indexOf(t) === -1) findings.push('Design token ontbreekt: ' + t);
    });

    if (css.indexOf(':hover') === -1 || css.indexOf(':focus') === -1 || css.indexOf(':active') === -1) {
      findings.push('Component states ontbreken (hover/focus/active).');
    }

    var typeUsage = (css.match(/var\(--type-/g) || []).length;
    var spaceUsage = (css.match(/var\(--space-/g) || []).length;
    if (typeUsage < 6 || spaceUsage < 18) {
      findings.push('Typografie/spacing usage te laag voor premium consistentie.');
    }
    checks.push('Design polish checks (tokens + states + consistentie)');

    var variantSelectorBefore = 'body[data-layout-variant="' + styleSeed.layoutVariant + '"]';
    var hasVariantSpecific = css.indexOf(variantSelectorBefore) !== -1;
    var variantVisualPatterns = [
      variantSelectorBefore + ' .hero-main { background-image',
      variantSelectorBefore + ' .signature-card { border-image',
      variantSelectorBefore + ' .signature-card::after',
      'body::before { background: var(--mesh-1);',
      'body::after { background: var(--mesh-2);'
    ];
    var premiumVisualHits = 0;
    variantVisualPatterns.forEach(function (snippet) {
      if (css.indexOf(snippet) !== -1) premiumVisualHits += 1;
    });

    if (!hasVariantSpecific || premiumVisualHits < 2) {
      findings.push('Premium visual requirement niet gehaald voor layout variant (' + premiumVisualHits + '/2).');
    }
    checks.push('Premium visual requirement: variant + minimaal 2 css visuals');

    var signature = makeSignature(styleSeed, files);
    var history = [];
    if (Array.isArray(previousSignatures)) history = history.concat(previousSignatures);
    history = history.concat(RECENT_SIGNATURES);

    var maxSimilarity = 0;
    var i;
    for (i = 0; i < history.length; i++) {
      if (!history[i] || !Array.isArray(history[i].tokens)) continue;
      var score = jaccard(signature.tokens, history[i].tokens);
      if (score > maxSimilarity) maxSimilarity = score;
    }

    if (maxSimilarity > 0.66) {
      findings.push('Uniqueness score te laag. Max similarity: ' + maxSimilarity.toFixed(3));
    }
    checks.push('Uniqueness score gate <= 0.66');

    return {
      passed: findings.length === 0,
      checks: checks,
      findings: findings,
      fluff_hits: fluffHits,
      fluff_total: fluffCount,
      specificity_hits: specificityFound,
      specificity_category_hits: categoryHits,
      uniqueness_score: Number(maxSimilarity.toFixed(3)),
      signature: signature,
      fail_reason: findings.length ? findings.join(' | ') : null
    };
  }

  function buildSiteBundle(input) {
    var options = {
      orderId: String(input.orderId || (input.meta && input.meta.id) || 'order'),
      mode: input.mode === 'quick' ? 'quick' : 'premium',
      theme: input.theme === 'dark' ? 'dark' : 'light',
      source: input.source || 'ui-click',
      runId: String(input.runId || ('run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))),
      previousSignatures: Array.isArray(input.previousSignatures) ? input.previousSignatures : []
    };

    var order = normalizeOrder(input.meta || {}, options.orderId);
    var stableSource = order.id || slugify(order.clientName + '-' + order.title);
    var baseSeed = fnv1a(stableSource);

    var storedSignatures = loadStoredSignatures();
    var signatureHistory = [].concat(options.previousSignatures || [], storedSignatures || [], RECENT_SIGNATURES || []);

    var lastBundle = null;
    var attempt;

    for (attempt = 0; attempt < 3; attempt++) {
      var attemptSeed = (baseSeed + attempt) >>> 0;

      var brief = makeBrief(order, options);
      var concepts = makeConcepts(brief);
      var chosen = chooseConcept(brief, concepts, attemptSeed);
      var styleSeed = makeStyleSeed(order, brief, chosen, options, attemptSeed);
      var copy = makeCopy(brief, styleSeed, order, chosen);

      var files = renderSite(order, brief, copy, styleSeed);
      files['brief.json'] = JSON.stringify(brief, null, 2);
      files['style-seed.json'] = JSON.stringify(styleSeed, null, 2);
      files['copy.json'] = JSON.stringify(copy, null, 2);

      var qa = runQAGates(files, styleSeed, brief, signatureHistory);
      qa.attempt = attempt + 1;
      files['qa.json'] = JSON.stringify(qa, null, 2);

      var bundle = {
        order_id: options.orderId,
        run_id: options.runId,
        mode: options.mode,
        theme: options.theme,
        generated_at: new Date().toISOString(),
        brief: brief,
        concepts: concepts,
        chosen_concept: chosen,
        style_seed: styleSeed,
        copy: copy,
        qa: qa,
        signature: qa.signature,
        files: files,
        output_hint: '/output/' + options.orderId + '/'
      };

      lastBundle = bundle;
      if (qa.passed) {
        RECENT_SIGNATURES.push(qa.signature);
        if (RECENT_SIGNATURES.length > 80) RECENT_SIGNATURES = RECENT_SIGNATURES.slice(-80);
        signatureHistory.push(qa.signature);
        persistStoredSignatures(signatureHistory);
        return bundle;
      }
    }

    return lastBundle;
  }

  return {
    makeBrief: makeBrief,
    makeStyleSeed: makeStyleSeed,
    makeCopy: makeCopy,
    renderSite: renderSite,
    runQAGates: runQAGates,
    buildSiteBundle: buildSiteBundle
  };
}));
