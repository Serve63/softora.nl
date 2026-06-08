const DEFAULT_SITE_ORIGIN = 'https://www.softora.nl';
const DEFAULT_OG_IMAGE_PATH = '/assets/seo-content/website-leads-analytics-softora.jpg';
const DEFAULT_LOGO_PATH = '/assets/61C2BCF5-70E9-4789-AFDE-FA18C862D58A.PNG';
const SOFTORA_PUBLIC_EMAIL = 'info@softora.nl';
const SOFTORA_PUBLIC_PHONE = '+31643262792';
const SOFTORA_LOCALITY = 'Oisterwijk';
const SOFTORA_REGION = 'Noord-Brabant';

const SEO_CONTENT_COLLECTIONS = Object.freeze({
  blog: Object.freeze({
    key: 'blog',
    path: '/blog',
    title: 'Softora Blog over websites, software en AI groei',
    description:
      'Praktische inzichten over websites, AI automatisering, bedrijfssoftware, chatbots en digitale groei voor ondernemers.',
    eyebrow: 'Inzichten',
    heading: 'Artikelen over websites, software en AI groei',
    intro:
      'Hier verzamelen we concrete lessen uit projecten, keuzes en veelgestelde vragen. Geen losse hype, maar bruikbare richting voor ondernemers die slimmer willen groeien.',
  }),
  kennisbank: Object.freeze({
    key: 'kennisbank',
    path: '/kennisbank',
    title: 'Softora Kennisbank voor digitale groei',
    description:
      'Heldere uitleg over websites, bedrijfssoftware, AI automatisering en digitale processen voor ondernemers en teams.',
    eyebrow: 'Kennisbank',
    heading: 'Heldere uitleg voor betere digitale keuzes',
    intro:
      'De kennisbank is bedoeld als vaste SEO-basis: gerichte, duidelijke uitlegpagina’s die intern linken naar diensten en verdiepende artikelen.',
  }),
  vergelijkingen: Object.freeze({
    key: 'vergelijkingen',
    path: '/vergelijkingen',
    title: 'Softora Vergelijkingen voor websites en AI',
    description:
      'Vergelijkingspagina’s voor ondernemers die twijfelen tussen website-, software- en AI-oplossingen en een betere keuze willen maken.',
    eyebrow: 'Vergelijkingen',
    heading: 'Kiezen tussen digitale oplossingen',
    intro:
      'Vergelijkingspagina’s vangen koopintentie af: bezoekers weten al dat ze iets willen verbeteren, maar zoeken nog welke route het beste past.',
  }),
  branches: Object.freeze({
    key: 'branches',
    path: '/branches',
    title: 'Softora Branchepagina’s voor digitale groei',
    description:
      'SEO-landingspagina’s per branche voor ondernemers die websites, AI automatisering en bedrijfssoftware slimmer willen inzetten.',
    eyebrow: 'Branches',
    heading: 'Digitale groei per branche',
    intro:
      'Iedere branche zoekt anders. Daarom bouwen we sectorpagina’s met concrete problemen, oplossingen en interne links naar de juiste Softora-diensten.',
  }),
  regio: Object.freeze({
    key: 'regio',
    path: '/regio',
    title: 'Softora Regio voor lokale digitale groei',
    description:
      'Lokale SEO-pagina’s voor bedrijven in Brabant die meer leads willen uit websites, AI automatisering en maatwerk software.',
    eyebrow: 'Lokale SEO',
    heading: 'Softora voor bedrijven in de regio',
    intro:
      'Deze lokale pagina’s maken onze dienstverlening vindbaar voor ondernemers in de regio, zonder dunne plaatsnaamcontent of loze claims.',
  }),
});

const SEO_CONTENT_PILLARS = Object.freeze([
  Object.freeze({
    title: 'Websites die leads opleveren',
    description: 'Alles rond website laten maken, conversie, SEO-structuur, pagina-opbouw en groeibare content.',
    href: '/website-laten-maken',
    category: 'Websites',
  }),
  Object.freeze({
    title: 'AI automatisering voor het MKB',
    description: 'Praktische AI flows voor intake, opvolging, administratie, klantcontact en interne processen.',
    href: '/ai-automatisering',
    category: 'AI automatisering',
  }),
  Object.freeze({
    title: 'Software, CRM en dashboards',
    description: 'Maatwerk software, CRM-systemen en dashboards die handwerk vervangen en data bruikbaar maken.',
    href: '/bedrijfssoftware-op-maat',
    category: 'Software',
  }),
  Object.freeze({
    title: 'AI communicatie',
    description: 'Chatbots, AI telefonie en slimme klantgesprekken die sneller kwalificeren en beter opvolgen.',
    href: '/chatbot-laten-maken',
    category: 'AI contact',
  }),
]);

const SEO_CONTENT_CLUSTERS = Object.freeze([
  Object.freeze({
    key: 'websites',
    label: 'Website groei',
    description: 'Website, SEO-structuur, conversie en lokale vindbaarheid.',
    href: '/website-laten-maken',
    ctaLabel: 'Website laten maken',
    ctaHref: '/website-laten-maken',
  }),
  Object.freeze({
    key: 'ai-automatisering',
    label: 'AI automatisering',
    description: 'Slimmere intake, opvolging, mailbox, rapportages en overdracht.',
    href: '/ai-automatisering',
    ctaLabel: 'AI automatisering',
    ctaHref: '/ai-automatisering',
  }),
  Object.freeze({
    key: 'software-crm',
    label: 'Software en CRM',
    description: 'Maatwerk software, CRM, dashboards en bedrijfsprocessen.',
    href: '/bedrijfssoftware-op-maat',
    ctaLabel: 'Bedrijfssoftware op maat',
    ctaHref: '/bedrijfssoftware-op-maat',
  }),
  Object.freeze({
    key: 'ai-contact',
    label: 'AI klantcontact',
    description: 'Chatbots, AI telefonie, voiceflows en veilige menselijke overdracht.',
    href: '/chatbot-laten-maken',
    ctaLabel: 'Chatbot laten maken',
    ctaHref: '/chatbot-laten-maken',
  }),
  Object.freeze({
    key: 'branches',
    label: 'Branches',
    description: 'Sectorpagina’s die diensten vertalen naar herkenbare praktijkproblemen.',
    href: '/branches',
    ctaLabel: 'Bekijk diensten',
    ctaHref: '/diensten',
  }),
  Object.freeze({
    key: 'lokaal',
    label: 'Lokale SEO',
    description: 'Regiopagina’s voor Oisterwijk, Tilburg, Den Bosch en Brabant.',
    href: '/regio',
    ctaLabel: 'Website laten maken',
    ctaHref: '/website-laten-maken',
  }),
]);

const SEO_CONTENT_IMAGES_BY_CLUSTER = Object.freeze({
  websites: Object.freeze({
    src: '/assets/seo-content/website-leads-analytics-softora.jpg',
    alt: 'Laptop met website analytics en meetbare leadgroei voor ondernemers die meer aanvragen willen.',
    width: 1600,
    height: 1000,
  }),
  'ai-automatisering': Object.freeze({
    src: '/assets/seo-content/ai-automatisering-workflow-softora.jpg',
    alt: 'Overleg aan tafel over workflow, planning en procesautomatisering voor het MKB.',
    width: 1600,
    height: 1000,
  }),
  'software-crm': Object.freeze({
    src: '/assets/seo-content/crm-software-dashboard-softora.jpg',
    alt: 'Dashboard met klantdata en prestatiegrafieken voor CRM, maatwerk software en leadopvolging.',
    width: 1600,
    height: 1000,
  }),
  'ai-contact': Object.freeze({
    src: '/assets/seo-content/ai-klantcontact-chatbot-telefonie-softora.jpg',
    alt: 'Team werkt samen met laptops en headset aan klantcontact, chatbots en telefonieflows.',
    width: 1600,
    height: 1000,
  }),
  branches: Object.freeze({
    src: '/assets/seo-content/branche-digitalisering-planning-softora.jpg',
    alt: 'Team aan een werktafel met laptops voor digitalisering van brancheprocessen.',
    width: 1600,
    height: 1000,
  }),
  lokaal: Object.freeze({
    src: '/assets/seo-content/lokale-seo-brabant-groei-softora.jpg',
    alt: 'Modern kantoorinterieur voor lokale SEO, regionale vindbaarheid en digitale groei.',
    width: 1600,
    height: 1000,
  }),
});

const SEO_CONTENT_AUTHOR = Object.freeze({
  name: 'Martijn van de Ven',
  role: 'Digitale strategie en automatisering',
  href: '/over-softora',
});

const SEO_CONTENT_REVIEWER = Object.freeze({
  name: 'Martijn van de Ven',
  role: 'Inhoudelijke controle',
  href: '/over-softora',
});

const SEO_CONTENT_MIN_WORDS_BY_COLLECTION = Object.freeze({
  blog: 1500,
  kennisbank: 850,
  vergelijkingen: 1200,
  branches: 1100,
  regio: 1100,
});

const SEO_CONTENT_ITEMS = Object.freeze([
  Object.freeze({
    collection: 'blog',
    slug: 'ai-automatisering-mkb-waar-beginnen',
    title: 'AI automatisering voor het MKB: waar begin je?',
    description:
      'Een praktische startgids voor ondernemers die AI automatisering willen inzetten zonder direct hun hele bedrijf te verbouwen.',
    category: 'AI ontwikkelingen',
    intent: 'Orientatie',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'AI automatisering werkt het beste wanneer je begint bij herhaalbaar werk, duidelijke overdrachtsmomenten en meetbare tijdswinst.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Begin niet bij de tool, maar bij het proces',
        paragraphs: Object.freeze([
          'Veel bedrijven beginnen met de vraag welke AI tool ze moeten gebruiken. Dat voelt logisch, maar het is zelden het beste startpunt. De betere vraag is: welk terugkerend werk kost veel tijd, is duidelijk te beschrijven en levert direct waarde op als het sneller of consistenter gaat?',
          'Voor Softora-projecten kijken we daarom eerst naar processen zoals leadopvolging, offertevoorbereiding, klantenservice, intake, planning, rapportage en interne administratie. Daar zitten vaak taken die iedere week terugkomen en waar automatisering snel rust brengt.',
        ]),
      }),
      Object.freeze({
        heading: 'Kies eerst een klein maar belangrijk automatiseringspad',
        paragraphs: Object.freeze([
          'Een goede eerste AI automatisering is niet meteen een compleet bedrijfssysteem. Sterker nog: klein beginnen maakt de kans groter dat het goed werkt. Denk aan een intakeformulier dat automatisch een samenvatting maakt, een lead kwalificeert en een vervolgactie klaarzet.',
          'Ook een AI telefonist, chatbot of interne assistent kan klein starten. De basis is steeds hetzelfde: invoer verzamelen, beoordelen wat ermee moet gebeuren en het resultaat netjes doorzetten naar een mens of systeem.',
        ]),
      }),
      Object.freeze({
        heading: 'Maak succes meetbaar voordat je opschaalt',
        paragraphs: Object.freeze([
          'AI automatisering wordt pas serieus waardevol als je kunt meten wat er beter gaat. Meet bijvoorbeeld hoeveel minuten handwerk verdwijnen, hoeveel leads sneller opvolging krijgen, hoeveel fouten worden voorkomen en hoeveel klantvragen zonder vertraging worden beantwoord.',
          'Daarna kun je veilig uitbreiden. Niet door overal AI overheen te leggen, maar door bewezen workflows stap voor stap te koppelen aan je website, CRM, agenda of maatwerk software.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'website-laten-maken-kosten-2026',
    title: 'Website laten maken in 2026: wat bepaalt de prijs?',
    description:
      'Een nuchtere uitleg over websitekosten, van simpele bedrijfssite tot maatwerk platform met conversie, SEO en automatisering.',
    category: 'Websites',
    intent: 'Koopintentie',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '7 min',
    summary:
      'De prijs van een website wordt vooral bepaald door strategie, ontwerp, techniek, content, koppelingen en hoeveel groei de site moet ondersteunen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een website is niet alleen een paar schermen',
        paragraphs: Object.freeze([
          'Een goedkope website kan prima zijn als je alleen online vindbaar wilt zijn met basisinformatie. Maar zodra de website leads moet opleveren, sneller moet laden, goed moet indexeren en overtuigend moet aanvoelen, verandert de opdracht.',
          'Dan betaal je niet alleen voor pagina’s, maar voor structuur, tekst, techniek, conversiepunten, meetbaarheid en een systeem dat makkelijk kan meegroeien met nieuwe diensten, cases en SEO-content.',
        ]),
      }),
      Object.freeze({
        heading: 'Waar de meeste kosten in zitten',
        paragraphs: Object.freeze([
          'De grootste kosten zitten meestal in voorbereiding en afwerking. Denk aan de juiste paginastructuur, duidelijke teksten, mobiele layouts, formulieren, snelheid, redirects, metadata, analytics en koppelingen met bijvoorbeeld CRM of automatisering.',
          'Ook maatwerk maakt verschil. Een standaard landingspagina is eenvoudiger dan een offerteflow, klantportaal, dashboard of kennisbank die automatisch nieuwe content kan tonen.',
        ]),
      }),
      Object.freeze({
        heading: 'Goedkoper starten, slim uitbreiden',
        paragraphs: Object.freeze([
          'Voor SEO is het vaak slimmer om de basis eerst strak neer te zetten en daarna gericht uit te bouwen. Begin met sterke dienstenpagina’s, heldere interne links en een structuur waarin toekomstige artikelen logisch passen.',
          'Daarna kun je blogs, kennisbankartikelen, branchepagina’s en tools toevoegen zonder dat de site rommelig wordt. Zo groeit de website mee zonder dat je later alles opnieuw hoeft te bouwen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Wat is bedrijfssoftware op maat?', href: '/kennisbank/wat-is-bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Welke MKB-pagina’s heb je nodig?', href: '/blog/website-laten-maken-mkb-paginas' }),
      Object.freeze({ label: 'Wat is een conversiegerichte website?', href: '/kennisbank/wat-is-een-conversiegerichte-website' }),
      Object.freeze({ label: 'Website laten maken of zelf maken', href: '/vergelijkingen/website-laten-maken-vs-zelf-maken' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'chatbot-laten-maken-wanneer-zinvol',
    title: 'Chatbot laten maken: wanneer is het slim?',
    description:
      'Wanneer een chatbot echt waarde toevoegt, welke vragen je vooraf moet beantwoorden en hoe je voorkomt dat bezoekers vastlopen.',
    category: 'Chatbots',
    intent: 'Orientatie',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Een goede chatbot is geen gimmick, maar een duidelijke route voor veelgestelde vragen, intake, leadkwalificatie en snelle opvolging.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een chatbot is zinvol bij herhaalde vragen',
        paragraphs: Object.freeze([
          'Een chatbot werkt goed wanneer bezoekers vaak dezelfde vragen stellen. Denk aan prijzen, werkwijze, levertijd, beschikbaarheid, voorwaarden, intake of het verschil tussen diensten.',
          'Als die vragen nu via mail, telefoon of WhatsApp binnenkomen, kan een chatbot de eerste laag overnemen. Niet om mensen weg te houden, maar om sneller duidelijkheid te geven en betere leads door te sturen.',
        ]),
      }),
      Object.freeze({
        heading: 'De chatbot moet weten wanneer hij moet stoppen',
        paragraphs: Object.freeze([
          'De fout die veel bedrijven maken is dat een chatbot alles moet kunnen. Daardoor worden antwoorden vaag en raken bezoekers sneller gefrustreerd. Een sterke chatbot heeft juist duidelijke grenzen.',
          'Hij moet weten wanneer hij een vraag kan beantwoorden, wanneer hij een formulier moet starten en wanneer een mens moet overnemen. Die overdracht is vaak belangrijker dan de AI zelf.',
        ]),
      }),
      Object.freeze({
        heading: 'Koppel de chatbot aan echte vervolgstappen',
        paragraphs: Object.freeze([
          'Een chatbot levert pas veel op als het gesprek ergens eindigt. Bijvoorbeeld in een offerteaanvraag, afspraak, CRM-notitie, samenvatting of taak voor het team.',
          'Daarom kijken we bij Softora niet alleen naar het chatvenster, maar naar de hele flow erachter. De chatbot moet bijdragen aan omzet, tijdwinst of betere service.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'AI automatisering voor het MKB', href: '/blog/ai-automatisering-mkb-waar-beginnen' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-bedrijfssoftware-op-maat',
    title: 'Wat is bedrijfssoftware op maat?',
    description:
      'Een duidelijke uitleg van bedrijfssoftware op maat, wanneer het zinvol is en hoe je voorkomt dat software onnodig complex wordt.',
    category: 'Bedrijfssoftware',
    intent: 'Uitleg',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '5 min',
    summary:
      'Bedrijfssoftware op maat is software die precies aansluit op je processen, rollen en data in plaats van andersom.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De heldere uitleg',
        paragraphs: Object.freeze([
          'Bedrijfssoftware op maat is een digitaal systeem dat wordt gebouwd rondom de manier waarop jouw bedrijf werkt. Het kan gaan om een dashboard, CRM, planningstool, klantportaal, database, offertemodule of een combinatie daarvan.',
          'Het verschil met standaard software is dat je niet hoeft te werken volgens vaste schermen en beperkingen van een pakket. De software volgt je proces, mits dat proces duidelijk genoeg is om te vertalen naar logica, schermen en gegevens.',
        ]),
      }),
      Object.freeze({
        heading: 'Wanneer maatwerk logisch wordt',
        paragraphs: Object.freeze([
          'Maatwerk wordt interessant wanneer standaard software te veel omwegen veroorzaakt. Bijvoorbeeld wanneer medewerkers informatie dubbel invoeren, klantdata verspreid staat over meerdere tools of belangrijke rapportages handmatig worden gemaakt.',
          'Ook groei kan een reden zijn. Als een bedrijf meer aanvragen, klanten of interne taken krijgt, worden kleine handmatige stappen ineens duur. Een goed systeem haalt die herhaling eruit en maakt de belangrijkste informatie sneller zichtbaar.',
        ]),
      }),
      Object.freeze({
        heading: 'Zo houd je maatwerk beheersbaar',
        paragraphs: Object.freeze([
          'Goede maatwerk software begint niet met zoveel mogelijk functies. Het begint met de kernflow: welke informatie komt binnen, wie moet iets doen, welke status hoort erbij en wanneer is het klaar?',
          'Vanuit die kern kun je uitbreiden met automatisering, rollen, rapportages en koppelingen. Zo blijft het systeem bruikbaar en wordt het geen groot project dat niemand durft aan te passen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
      Object.freeze({ label: 'AI automatisering voor het MKB', href: '/blog/ai-automatisering-mkb-waar-beginnen' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'website-laten-maken-mkb-paginas',
    title: 'Welke pagina’s heeft een MKB-website nodig?',
    description:
      'Een praktische indeling voor MKB-websites die gevonden moeten worden, vertrouwen moeten wekken en aanvragen moeten opleveren.',
    category: 'Websites',
    intent: 'Koopintentie',
    publishedAt: '2026-05-20',
    updatedAt: '2026-05-20',
    readTime: '7 min',
    summary:
      'Een sterke MKB-website begint met een duidelijke basisstructuur: diensten, bewijs, proces, veelgestelde vragen en contactmomenten.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Begin met pagina’s die een keuze makkelijker maken',
        paragraphs: Object.freeze([
          'Veel websites starten vanuit wat een bedrijf zelf wil vertellen. Voor SEO en leads werkt het beter om te starten vanuit wat een bezoeker nodig heeft om vertrouwen te krijgen. Denk aan een duidelijke dienstenpagina, voorbeelden van werk, uitleg over het proces en een laagdrempelige manier om contact op te nemen.',
          'De homepage hoeft niet alles te dragen. Juist aparte pagina’s voor diensten, branches, prijzen, werkwijze en veelgestelde vragen zorgen ervoor dat Google beter begrijpt waar je voor gevonden wilt worden.',
        ]),
      }),
      Object.freeze({
        heading: 'Maak iedere belangrijke dienst een eigen landingspagina',
        paragraphs: Object.freeze([
          'Als je gevonden wilt worden op “website laten maken”, “bedrijfssoftware op maat” of “AI automatisering”, dan verdienen die onderwerpen een eigen pagina. Zo kan elke pagina scherp inspelen op een zoekvraag, met een eigen titel, H1, interne links en duidelijke CTA.',
          'Daarna kun je ondersteunende blogs en kennisbankartikelen naar die pagina’s laten wijzen. Dat maakt de dienstpagina sterker zonder dat de tekst onnodig lang of rommelig wordt.',
        ]),
      }),
      Object.freeze({
        heading: 'Bouw de site alsof er later veel content bij komt',
        paragraphs: Object.freeze([
          'Een SEO-site moet kunnen groeien. Daarom is het verstandig om vanaf het begin ruimte te maken voor blogartikelen, kennisbankuitleg, cases, branchepagina’s en tools. Als die onderdelen logisch aan elkaar linken, ontstaat er een netwerk waar Google makkelijk doorheen kan.',
          'Voor Softora betekent dit dat commerciële pagina’s de hoofdroute blijven, terwijl artikelen en kennisbankstukken helpen om vragen af te vangen en bezoekers richting een aanvraag te sturen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Diensten van Softora', href: '/diensten' }),
      Object.freeze({ label: 'Website kosten in 2026', href: '/blog/website-laten-maken-kosten-2026' }),
      Object.freeze({ label: 'Conversiegerichte website', href: '/kennisbank/wat-is-een-conversiegerichte-website' }),
      Object.freeze({
        label: 'Interne linkstructuur',
        href: '/kennisbank/wat-is-interne-linkstructuur',
        availableFrom: '2026-06-01',
      }),
      Object.freeze({ label: 'Website laten maken Oisterwijk', href: '/website-laten-maken-oisterwijk' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-ai-automatisering',
    title: 'Wat is AI automatisering?',
    description:
      'Een heldere uitleg van AI automatisering, met voorbeelden van processen die je als bedrijf slimmer kunt laten verlopen.',
    category: 'AI automatisering',
    intent: 'Uitleg',
    publishedAt: '2026-05-21',
    updatedAt: '2026-05-21',
    readTime: '5 min',
    summary:
      'AI automatisering combineert slimme software met vaste bedrijfsprocessen, zodat terugkerend werk sneller en consistenter verloopt.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De simpele definitie',
        paragraphs: Object.freeze([
          'AI automatisering betekent dat kunstmatige intelligentie wordt ingezet om stappen in een proces zelfstandig voor te bereiden, uit te voeren of door te sturen. Denk aan samenvatten, classificeren, antwoorden formuleren, leads beoordelen of taken klaarzetten.',
          'Het verschil met gewone automatisering is dat AI beter kan omgaan met tekst, gesprekken, context en variatie. Daardoor kun je processen automatiseren die vroeger te rommelig waren voor vaste regels.',
        ]),
      }),
      Object.freeze({
        heading: 'Waar bedrijven meestal beginnen',
        paragraphs: Object.freeze([
          'Goede startpunten zijn intake, klantvragen, leadopvolging, offertevoorbereiding, planning en interne rapportage. Dat zijn processen met duidelijke input en output, waardoor je snel kunt meten of de automatisering waarde oplevert.',
          'Een AI workflow hoeft niet meteen alles zelf te beslissen. Vaak is het beter als AI voorbereidt en een medewerker de laatste keuze maakt.',
        ]),
      }),
      Object.freeze({
        heading: 'Waarom structuur belangrijker is dan hype',
        paragraphs: Object.freeze([
          'AI werkt pas goed als de route eromheen klopt. Welke informatie komt binnen? Wanneer is iets urgent? Naar welk systeem moet het resultaat? Wie krijgt een melding? Zonder die proceskeuzes blijft AI een losse tool.',
          'Daarom begint Softora AI automatisering bij de workflow en pas daarna bij het model of de techniek.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'crm-systeem-op-maat-spreadsheets-vervangen',
    title: 'CRM systeem op maat: wanneer vervang je spreadsheets?',
    description:
      'Signalen dat losse spreadsheets je groei vertragen en wanneer een CRM systeem op maat slimmer wordt.',
    category: 'CRM',
    intent: 'Koopintentie',
    publishedAt: '2026-05-22',
    updatedAt: '2026-05-22',
    readTime: '6 min',
    summary:
      'Spreadsheets zijn handig om te starten, maar worden kwetsbaar zodra opvolging, status, eigenaarschap en rapportage belangrijk worden.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Spreadsheets zijn prima totdat ze het proces worden',
        paragraphs: Object.freeze([
          'Veel bedrijven starten met spreadsheets omdat ze snel en flexibel zijn. Dat is logisch. Het probleem ontstaat wanneer klantstatussen, opvolgmomenten, offertes, taken en rapportages allemaal verspreid raken over losse bestanden.',
          'Dan is niet meer duidelijk wie wat moet doen, welke lead prioriteit heeft en of de laatste informatie wel klopt. Een CRM systeem op maat brengt die informatie terug naar één duidelijke workflow.',
        ]),
      }),
      Object.freeze({
        heading: 'Wanneer maatwerk logisch wordt',
        paragraphs: Object.freeze([
          'Maatwerk wordt interessant als standaard CRM te veel ruis geeft of belangrijke stappen mist. Bijvoorbeeld wanneer je eigen fases, rollen, berekeningen, klanttypes of automatiseringen nodig hebt.',
          'Een goed CRM hoeft niet groot te beginnen. De kern is vaak: contactgegevens, status, taken, notities, afspraken, offertefase en rapportage.',
        ]),
      }),
      Object.freeze({
        heading: 'Maak opvolging meetbaar',
        paragraphs: Object.freeze([
          'De grootste winst zit vaak in opvolging. Welke leads staan open? Welke afspraken zijn gemaakt? Welke offerte wacht op reactie? Welke klant heeft opnieuw aandacht nodig?',
          'Als die vragen direct zichtbaar zijn, wordt een CRM niet alleen administratie, maar een systeem dat omzetkansen beschermt.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Wat is bedrijfssoftware op maat?', href: '/kennisbank/wat-is-bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Wat is een CRM systeem?', href: '/kennisbank/wat-is-een-crm-systeem' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-een-ai-telefonist',
    title: 'Wat is een AI telefonist?',
    description:
      'Heldere uitleg van AI telefonie, wanneer het nuttig is en hoe je voorkomt dat gesprekken onpersoonlijk worden.',
    category: 'AI telefonie',
    intent: 'Uitleg',
    publishedAt: '2026-05-20',
    updatedAt: '2026-05-20',
    readTime: '5 min',
    summary:
      'Een AI telefonist neemt gesprekken aan, stelt vaste vragen, vat informatie samen en zet vervolgacties klaar.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een digitale eerste lijn',
        paragraphs: Object.freeze([
          'Een AI telefonist is software die telefoongesprekken kan voeren op basis van vooraf ingerichte doelen. Denk aan opnemen, vragen stellen, informatie verzamelen, een afspraak voorbereiden of een samenvatting naar het team sturen.',
          'Het doel is niet om persoonlijk contact te vervangen, maar om bereikbaarheid en opvolging betrouwbaarder te maken.',
        ]),
      }),
      Object.freeze({
        heading: 'Wanneer AI telefonie waarde toevoegt',
        paragraphs: Object.freeze([
          'AI telefonie is vooral interessant als je vaak dezelfde vragen krijgt, leads snel wilt kwalificeren of buiten werktijd bereikbaar wilt blijven. Ook voor drukke teams kan het helpen om gesprekken alvast te structureren.',
          'De beste toepassingen hebben duidelijke grenzen: wanneer mag de AI helpen en wanneer moet een medewerker terugbellen?',
        ]),
      }),
      Object.freeze({
        heading: 'Koppeling met je proces',
        paragraphs: Object.freeze([
          'De echte waarde ontstaat na het gesprek. Een goede AI telefonist maakt een samenvatting, herkent vervolgacties en kan informatie doorzetten naar CRM, agenda of mailbox.',
          'Zonder die opvolging blijft het een los telefoonsysteem. Met goede koppelingen wordt het onderdeel van je commerciële proces.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'AI telefonist vs receptionist', href: '/vergelijkingen/ai-telefonist-vs-receptionist' }),
      Object.freeze({ label: 'Wanneer is een chatbot zinvol?', href: '/blog/chatbot-laten-maken-wanneer-zinvol' }),
      Object.freeze({
        label: 'AI telefonist voor afspraakintake',
        href: '/blog/ai-telefonist-voor-afspraakintake',
        availableFrom: '2026-05-29',
      }),
      Object.freeze({ label: 'Voicesoftware op maat', href: '/voicesoftware-op-maat' }),
    ]),
  }),
  Object.freeze({
    collection: 'vergelijkingen',
    slug: 'website-laten-maken-vs-zelf-maken',
    title: 'Website laten maken of zelf maken: wat is slimmer?',
    description:
      'Een praktische vergelijking tussen zelf een website bouwen en een website laten maken voor ondernemers die verkeer, vertrouwen en aanvragen willen.',
    category: 'Websites',
    intent: 'Vergelijking',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '7 min',
    summary:
      'Zelf bouwen kan snel en goedkoop starten, maar een professionele website wordt sterker wanneer strategie, techniek, SEO en conversie samenkomen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Zelf maken is logisch bij een eenvoudige start',
        paragraphs: Object.freeze([
          'Een website zelf maken kan prima zijn als je vooral online aanwezig wilt zijn en nog weinig eisen hebt aan SEO, snelheid, design of aanvragen. Je kunt snel iets publiceren en leert meteen wat je wel en niet belangrijk vindt.',
          'De grens komt meestal wanneer de site meer moet doen dan bestaan. Zodra je gevonden wilt worden op meerdere diensten, vertrouwen wilt opbouwen en aanvragen wilt meten, wordt structuur belangrijker dan alleen een mooi scherm.',
        ]),
      }),
      Object.freeze({
        heading: 'Laten maken is sterker wanneer de site omzet moet dragen',
        paragraphs: Object.freeze([
          'Een professionele website wordt gebouwd vanuit zoekintentie, paginaopbouw, techniek, interne links en conversiepunten. Dat is vooral belangrijk wanneer de website een echte bron van leads moet worden.',
          'Daarbij hoort ook een fundering voor groei: dienstenpagina’s, blog, kennisbank, branchepagina’s, lokale pagina’s, canonicals, sitemap en duidelijke CTA’s. Als dat vanaf het begin klopt, kun je later veel sneller opschalen.',
        ]),
      }),
      Object.freeze({
        heading: 'De beste keuze hangt af van risico en groeidoel',
        paragraphs: Object.freeze([
          'Als de website nog niet belangrijk is voor omzet, kan zelf starten logisch zijn. Als je site structureel verkeer en aanvragen moet opleveren, is laten maken vaak goedkoper dan maanden verliezen aan een zwakke basis.',
          'Softora kiest daarom voor een groeibare aanpak: eerst de commerciële basis goed neerzetten, daarna content, tools, lokale SEO en automatisering toevoegen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Website kosten in 2026', href: '/blog/website-laten-maken-kosten-2026' }),
      Object.freeze({ label: 'Wat is een conversiegerichte website?', href: '/kennisbank/wat-is-een-conversiegerichte-website' }),
      Object.freeze({ label: 'MKB website pagina’s', href: '/blog/website-laten-maken-mkb-paginas' }),
      Object.freeze({ label: 'Website laten maken Oisterwijk', href: '/website-laten-maken-oisterwijk' }),
    ]),
  }),
  Object.freeze({
    collection: 'vergelijkingen',
    slug: 'ai-telefonist-vs-receptionist',
    title: 'AI telefonist vs receptionist: wat past beter?',
    description:
      'Een vergelijking tussen een AI telefonist en een receptionist voor bedrijven die bereikbaar willen blijven zonder opvolging te verliezen.',
    category: 'AI telefonie',
    intent: 'Vergelijking',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Een receptionist is persoonlijk en flexibel, terwijl een AI telefonist vooral sterk is in bereikbaarheid, vaste intake en snelle samenvatting.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een receptionist blijft het sterkst in menselijk contact',
        paragraphs: Object.freeze([
          'Voor complexe gesprekken, gevoelige situaties en persoonlijke relatieopbouw blijft een receptionist of medewerker vaak de beste keuze. Mensen kunnen nuance herkennen, doorvragen en vertrouwen opbouwen.',
          'De beperking zit vooral in beschikbaarheid en schaal. Buiten werktijd, tijdens drukte of bij veel herhalende vragen kan opvolging alsnog blijven liggen.',
        ]),
      }),
      Object.freeze({
        heading: 'Een AI telefonist is sterk in vaste routes',
        paragraphs: Object.freeze([
          'Een AI telefonist kan altijd opnemen, basisvragen stellen, urgentie bepalen en een samenvatting klaarzetten. Dat maakt hem interessant voor intake, terugbelverzoeken, veelgestelde vragen en leadkwalificatie.',
          'De AI moet wel duidelijke grenzen hebben. Hij moet weten wanneer hij informatie verzamelt en wanneer een mens moet terugbellen.',
        ]),
      }),
      Object.freeze({
        heading: 'Vaak is combinatie de slimste oplossing',
        paragraphs: Object.freeze([
          'De beste oplossing is vaak niet AI of mens, maar een duidelijke verdeling. De AI vangt de eerste laag op en het team neemt over waar persoonlijk contact waarde toevoegt.',
          'Softora bouwt zulke flows rond het echte proces: gesprek, samenvatting, CRM, agenda, taak en opvolging.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'Wat is een AI telefonist?', href: '/kennisbank/wat-is-een-ai-telefonist' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'Voicesoftware op maat', href: '/voicesoftware-op-maat' }),
      Object.freeze({ label: 'AI automatisering startgids', href: '/blog/ai-automatisering-mkb-waar-beginnen' }),
      Object.freeze({
        label: 'AI telefonist voor afspraakintake',
        href: '/blog/ai-telefonist-voor-afspraakintake',
        availableFrom: '2026-05-29',
      }),
    ]),
  }),
  Object.freeze({
    collection: 'vergelijkingen',
    slug: 'maatwerk-software-vs-standaard-software',
    title: 'Maatwerk software vs standaard software: wat past beter?',
    description:
      'Een vergelijking tussen maatwerk en standaard software voor bedrijven die willen groeien zonder onnodige complexiteit.',
    category: 'Bedrijfssoftware',
    intent: 'Vergelijking',
    publishedAt: '2026-05-24',
    updatedAt: '2026-05-24',
    readTime: '7 min',
    summary:
      'Standaard software is snel en betaalbaar, maar maatwerk wordt sterker zodra je proces uniek, schaalbaar of onderscheidend is.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Standaard software is vaak de beste eerste stap',
        paragraphs: Object.freeze([
          'Voor veel bedrijven is standaard software logisch. Je kunt snel starten, de kosten zijn voorspelbaar en je profiteert van functies die al gebouwd zijn.',
          'Het nadeel is dat je je proces moet aanpassen aan het pakket. Dat is prima zolang de werkwijze eenvoudig blijft, maar kan gaan knellen bij groei.',
        ]),
      }),
      Object.freeze({
        heading: 'Maatwerk wordt interessant bij eigen processen',
        paragraphs: Object.freeze([
          'Als jouw bedrijf werkt met eigen statussen, rollen, berekeningen, klantstromen of rapportages, kan maatwerk veel rust geven. Het systeem volgt dan de manier waarop je team echt werkt.',
          'Ook koppelingen zijn vaak een reden. Denk aan CRM, agenda, klantportaal, offertes, AI automatisering en dashboards in één lijn.',
        ]),
      }),
      Object.freeze({
        heading: 'De slimste keuze kan hybride zijn',
        paragraphs: Object.freeze([
          'Je hoeft niet altijd alles zelf te bouwen. Vaak is een combinatie verstandig: standaard tools waar ze goed in zijn, met maatwerk voor de processen die jouw bedrijf uniek maken.',
          'Softora kijkt daarom eerst naar de kernflow en kiest daarna pas welke delen maatwerk verdienen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-een-conversiegerichte-website',
    title: 'Wat is een conversiegerichte website?',
    description:
      'Een uitleg van conversiegerichte websites: hoe structuur, tekst, bewijs en CTA’s samen meer aanvragen opleveren.',
    category: 'Websites',
    intent: 'Uitleg',
    publishedAt: '2026-05-20',
    updatedAt: '2026-05-20',
    readTime: '5 min',
    summary:
      'Een conversiegerichte website helpt bezoekers sneller begrijpen, vertrouwen en actie ondernemen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Conversie begint met duidelijkheid',
        paragraphs: Object.freeze([
          'Een website converteert beter wanneer bezoekers snel zien wat je doet, voor wie het is en welke volgende stap logisch is. Mooie vormgeving helpt, maar duidelijkheid is de basis.',
          'Daarom moet een pagina niet alleen informatie tonen, maar twijfels wegnemen. Denk aan bewijs, werkwijze, voorbeelden, veelgestelde vragen en een duidelijke aanvraagroute.',
        ]),
      }),
      Object.freeze({
        heading: 'Elke pagina heeft een taak',
        paragraphs: Object.freeze([
          'Een homepage oriënteert, een dienstenpagina overtuigt, een kennisbankartikel legt uit en een contactpagina maakt de stap makkelijk. Als iedere pagina zijn taak kent, voelt de site rustiger en presteert hij beter.',
          'Voor SEO helpt dit ook, omdat Google beter kan begrijpen welke pagina bij welke zoekvraag hoort.',
        ]),
      }),
      Object.freeze({
        heading: 'Meten maakt verbeteren mogelijk',
        paragraphs: Object.freeze([
          'Een conversiegerichte website is nooit echt af. Je kijkt naar klikken, aanvragen, scrollgedrag, zoekopdrachten en vragen van bezoekers.',
          'Die signalen gebruik je om titels, CTA’s, interne links en content stap voor stap sterker te maken.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Website laten maken kosten 2026', href: '/blog/website-laten-maken-kosten-2026' }),
      Object.freeze({ label: 'Diensten van Softora', href: '/diensten' }),
      Object.freeze({ label: 'MKB website pagina’s', href: '/blog/website-laten-maken-mkb-paginas' }),
      Object.freeze({
        label: 'Interne linkstructuur',
        href: '/kennisbank/wat-is-interne-linkstructuur',
        availableFrom: '2026-06-01',
      }),
      Object.freeze({ label: 'Website laten maken Oisterwijk', href: '/website-laten-maken-oisterwijk' }),
    ]),
  }),
  Object.freeze({
    collection: 'vergelijkingen',
    slug: 'chatbot-vs-livechat',
    title: 'Chatbot vs livechat: wat past beter bij je bedrijf?',
    description:
      'Een praktische vergelijking tussen chatbots en livechat voor bedrijven die sneller willen reageren op websitebezoekers.',
    category: 'Chatbots',
    intent: 'Vergelijking',
    publishedAt: '2026-05-26',
    updatedAt: '2026-05-26',
    readTime: '6 min',
    summary:
      'Livechat is sterk voor persoonlijk contact, terwijl een chatbot vooral waarde toevoegt bij herhaalde vragen en gestructureerde intake.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Livechat werkt goed als iemand beschikbaar is',
        paragraphs: Object.freeze([
          'Livechat voelt persoonlijk en direct. Het werkt vooral goed wanneer je team snel kan reageren en gesprekken echt maatwerk vragen.',
          'Het nadeel is beschikbaarheid. Als niemand reageert, verandert livechat snel in frustratie of een gemiste lead.',
        ]),
      }),
      Object.freeze({
        heading: 'Een chatbot is sterk in vaste routes',
        paragraphs: Object.freeze([
          'Een chatbot kan altijd dezelfde basisvragen stellen, antwoorden geven en bezoekers naar de juiste vervolgroute sturen. Dat is handig voor prijzen, intake, veelgestelde vragen en leadkwalificatie.',
          'De chatbot moet wel duidelijke grenzen hebben. Voor complexe of gevoelige vragen blijft overdracht naar een mens belangrijk.',
        ]),
      }),
      Object.freeze({
        heading: 'De beste oplossing is vaak combinatie',
        paragraphs: Object.freeze([
          'Veel bedrijven hebben baat bij een hybride aanpak. De chatbot vangt de eerste laag op en livechat of terugbelverzoek neemt over wanneer dat nodig is.',
          'Zo blijft de website bereikbaar zonder dat persoonlijk contact verdwijnt.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-een-crm-systeem',
    title: 'Wat is een CRM systeem?',
    description:
      'Een heldere uitleg van CRM-systemen, wat je erin bijhoudt en wanneer maatwerk CRM slimmer wordt dan losse lijsten.',
    category: 'CRM',
    intent: 'Uitleg',
    publishedAt: '2026-05-27',
    updatedAt: '2026-05-27',
    readTime: '5 min',
    summary:
      'Een CRM systeem geeft overzicht over leads, klanten, afspraken, offertes en opvolging, zodat kansen minder snel blijven liggen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De simpele betekenis van CRM',
        paragraphs: Object.freeze([
          'CRM staat voor customer relationship management. In gewone taal: een systeem waarin je klantcontact, leads, notities, afspraken, offertes en opvolgmomenten bijhoudt.',
          'Het doel is niet alleen administratie. Een goed CRM maakt zichtbaar welke kans openstaat, wie eigenaar is van de volgende stap en waar opvolging nodig is.',
        ]),
      }),
      Object.freeze({
        heading: 'Wat je meestal in een CRM bijhoudt',
        paragraphs: Object.freeze([
          'De basis bestaat uit contactgegevens, bedrijfsinformatie, status, notities, taken, afspraken, offertefase en historie. Voor groeiende teams worden dashboards en reminders daarna belangrijk.',
          'Zonder CRM staat die informatie vaak verspreid over mailboxen, spreadsheets en losse berichten. Dat werkt tot het moment dat er te veel leads of klanten tegelijk lopen.',
        ]),
      }),
      Object.freeze({
        heading: 'Wanneer maatwerk CRM logisch wordt',
        paragraphs: Object.freeze([
          'Maatwerk CRM wordt interessant wanneer je eigen stappen, rollen, dashboards, berekeningen of koppelingen nodig hebt. Denk aan offerteflows, intakeformulieren, agenda, AI-samenvattingen of automatische opvolgtaken.',
          'Softora kijkt dan eerst naar de kernflow: van nieuwe lead naar duidelijke actie. Pas daarna bouwen we extra schermen of automatisering.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'ai-automatisering-leadopvolging',
    title: 'AI leadopvolging automatiseren: zo bouw je de flow',
    description:
      'Een praktische uitleg van een AI leadopvolging-flow, van intake en kwalificatie tot CRM-taak, samenvatting en menselijke controle.',
    category: 'AI automatisering',
    intent: 'Koopintentie',
    publishedAt: '2026-05-28',
    updatedAt: '2026-05-28',
    readTime: '7 min',
    summary:
      'AI leadopvolging werkt het beste als de route achter de aanvraag duidelijk is: verzamelen, beoordelen, samenvatten en opvolgen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Begin bij het moment waarop een lead binnenkomt',
        paragraphs: Object.freeze([
          'Een lead kan binnenkomen via formulier, chatbot, telefoon, mail of WhatsApp. Als die kanalen los blijven, ontstaat snel ruis. De eerste stap is daarom niet AI, maar één duidelijke route voor nieuwe aanvragen.',
          'Die route bepaalt welke informatie minimaal nodig is: naam, bedrijf, vraag, urgentie, dienst, budgetindicatie en de gewenste vervolgstap.',
        ]),
      }),
      Object.freeze({
        heading: 'Laat AI voorbereiden, niet blind beslissen',
        paragraphs: Object.freeze([
          'AI kan een aanvraag samenvatten, de intentie herkennen, ontbrekende informatie signaleren en een voorstel doen voor de volgende taak. Dat scheelt tijd en maakt opvolging consistenter.',
          'Voor belangrijke commerciële keuzes blijft menselijke controle verstandig. De beste flow laat AI voorbereiden en geeft het team daarna een helder beslismoment.',
        ]),
      }),
      Object.freeze({
        heading: 'Koppel de uitkomst aan CRM of agenda',
        paragraphs: Object.freeze([
          'Een AI-flow is pas echt nuttig als het resultaat ergens landt. Denk aan een CRM-status, taak voor een medewerker, afspraakvoorstel of mailconcept.',
          'Softora bouwt dit soort flows rondom het bestaande proces, zodat automatisering niet voelt als extra tool maar als versneller van opvolging.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({
        label: 'Wat is leadkwalificatie?',
        href: '/kennisbank/wat-is-leadkwalificatie',
        availableFrom: '2026-06-03',
      }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'ai-telefonist-voor-afspraakintake',
    title: 'AI telefonist voor afspraakintake: waar moet je op letten?',
    description:
      'Waar een AI telefonist sterk in is bij afspraakintake, welke grenzen je moet zetten en hoe opvolging naar CRM of agenda werkt.',
    category: 'AI telefonie',
    intent: 'Koopintentie',
    publishedAt: '2026-05-29',
    updatedAt: '2026-05-29',
    readTime: '6 min',
    summary:
      'Een AI telefonist kan afspraakintake versnellen, maar alleen als vragen, overdracht en menselijke controle vooraf goed zijn ingericht.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een goede intake begint met vaste vragen',
        paragraphs: Object.freeze([
          'Bij afspraakintake wil je niet dat elk gesprek anders eindigt. De AI telefonist moet weten welke informatie nodig is: naam, contactgegevens, reden van contact, gewenste datum, urgentie en eventuele bijzonderheden.',
          'Hoe duidelijker die vragen zijn, hoe bruikbaarder de samenvatting wordt voor het team.',
        ]),
      }),
      Object.freeze({
        heading: 'Grenzen zijn belangrijker dan stoer klinkende AI',
        paragraphs: Object.freeze([
          'Een AI telefonist moet niet doen alsof hij alles kan oplossen. Hij moet weten wanneer hij informatie verzamelt, wanneer hij een terugbelverzoek aanmaakt en wanneer een medewerker nodig is.',
          'Dat voorkomt frustratie en houdt het gesprek betrouwbaar. Vooral bij commerciële of gevoelige vragen blijft overdracht naar een mens belangrijk.',
        ]),
      }),
      Object.freeze({
        heading: 'De waarde zit na het telefoongesprek',
        paragraphs: Object.freeze([
          'Na het gesprek moet de informatie bruikbaar worden. Denk aan een CRM-notitie, agenda-aanvraag, taak of korte samenvatting in de mailbox.',
          'Softora richt AI telefonie daarom niet los in, maar als onderdeel van bereikbaarheid, leadkwalificatie en opvolging.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'Voicesoftware op maat', href: '/voicesoftware-op-maat' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'Wat is een AI telefonist?', href: '/kennisbank/wat-is-een-ai-telefonist' }),
      Object.freeze({ label: 'AI telefonist vs receptionist', href: '/vergelijkingen/ai-telefonist-vs-receptionist' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-interne-linkstructuur',
    title: 'Wat is een interne linkstructuur?',
    description:
      'Een duidelijke uitleg van interne linkstructuur en waarom goede links tussen diensten, blogs en kennisbankpagina’s belangrijk zijn voor SEO.',
    category: 'Websites',
    intent: 'Uitleg',
    publishedAt: '2026-06-01',
    updatedAt: '2026-06-01',
    readTime: '5 min',
    summary:
      'Interne linkstructuur helpt bezoekers en Google begrijpen welke pagina’s bij elkaar horen en welke pagina’s commercieel belangrijk zijn.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Interne links zijn de routes binnen je website',
        paragraphs: Object.freeze([
          'Een interne link is een link van de ene pagina op je website naar een andere pagina op dezelfde website. Denk aan een blog die verwijst naar een dienstpagina of een kennisbankartikel dat doorlinkt naar een passende uitleg.',
          'Voor bezoekers maakt dat navigeren makkelijker. Voor Google laat het zien welke onderwerpen samenhangen en welke pagina’s belangrijk zijn.',
        ]),
      }),
      Object.freeze({
        heading: 'Money pages hebben ondersteunende pagina’s nodig',
        paragraphs: Object.freeze([
          'Een dienstpagina zoals website laten maken of AI automatisering hoeft niet elke vraag zelf te beantwoorden. Blogs en kennisbankstukken kunnen die vragen opvangen en daarna teruglinken naar de dienstpagina.',
          'Zo blijft de commerciële pagina scherp, terwijl de site toch veel nuttige uitleg biedt.',
        ]),
      }),
      Object.freeze({
        heading: 'Vermijd losse pagina’s zonder route',
        paragraphs: Object.freeze([
          'Een pagina die nergens logisch naartoe linkt, voelt voor bezoekers als een dood einde. Ook voor SEO is dat zwakker, omdat de pagina minder duidelijk onderdeel is van een cluster.',
          'Softora bouwt content daarom rondom clusters: websites, AI automatisering, software, CRM, chatbots, AI telefonie en lokale SEO.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Blog', href: '/blog' }),
      Object.freeze({ label: 'Diensten', href: '/diensten' }),
      Object.freeze({ label: 'MKB website pagina’s', href: '/blog/website-laten-maken-mkb-paginas' }),
      Object.freeze({ label: 'Conversiegerichte website', href: '/kennisbank/wat-is-een-conversiegerichte-website' }),
    ]),
  }),
  Object.freeze({
    collection: 'branches',
    slug: 'installateurs',
    schemaType: 'Service',
    serviceType: 'Websites en automatisering voor installateurs',
    title: 'Websites en automatisering voor installateurs',
    description:
      'Een branchepagina voor installatiebedrijven die online beter gevonden willen worden en aanvragen slimmer willen opvolgen.',
    category: 'Installateurs',
    intent: 'Branche',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Installateurs hebben vooral baat bij duidelijke dienstenpagina’s, lokale vindbaarheid, snelle offerteaanvragen en minder handmatige opvolging.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Van vindbaarheid naar aanvraag',
        paragraphs: Object.freeze([
          'Veel installatiebedrijven worden gevonden op concrete problemen: storing, onderhoud, verduurzaming, laadpalen, airco, zonnepanelen of elektra. Een goede website maakt die diensten apart vindbaar en stuurt bezoekers snel naar een aanvraag.',
          'Voor SEO betekent dit dat de site niet alleen een algemene dienstenlijst nodig heeft, maar ook duidelijke pagina’s per dienst en regio. Zo begrijpt Google beter waarvoor het bedrijf relevant is.',
        ]),
      }),
      Object.freeze({
        heading: 'Minder handwerk in opvolging',
        paragraphs: Object.freeze([
          'Aanvragen komen vaak binnen via telefoon, mail, WhatsApp en formulieren. Zonder systeem raakt opvolging snel verspreid. Een simpele intakeflow kan alvast type klus, locatie, urgentie en foto’s verzamelen.',
          'Daarna kan AI een samenvatting maken, een prioriteit voorstellen of een taak klaarzetten in een CRM. Dat scheelt tijd en voorkomt dat warme aanvragen blijven liggen.',
        ]),
      }),
      Object.freeze({
        heading: 'Wat Softora hiervoor neerzet',
        paragraphs: Object.freeze([
          'De basis is een conversiegerichte website met lokale SEO, duidelijke dienstpagina’s en een contactflow die bij installatiewerk past. Daarna kunnen CRM, planning, AI telefonie of automatisering worden toegevoegd.',
          'Zo groeit de website van online visitekaartje naar een systeem dat nieuwe aanvragen beter verwerkt.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Softora in Oisterwijk', href: '/regio/oisterwijk' }),
      Object.freeze({ label: 'Website laten maken Oisterwijk', href: '/website-laten-maken-oisterwijk' }),
    ]),
  }),
  Object.freeze({
    collection: 'branches',
    slug: 'makelaars',
    schemaType: 'Service',
    serviceType: 'Websites en AI automatisering voor makelaars',
    title: 'Websites en AI automatisering voor makelaars',
    description:
      'Een branchepagina voor makelaars die beter zichtbaar willen zijn, leads sneller willen opvolgen en processen willen automatiseren.',
    category: 'Makelaars',
    intent: 'Branche',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Voor makelaars draait digitale groei om vertrouwen, lokale zichtbaarheid, snelle reactie op leads en duidelijke opvolging.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Lokale zichtbaarheid is de basis',
        paragraphs: Object.freeze([
          'Makelaars concurreren sterk op plaats, wijk en specialisme. Een website moet daarom niet alleen mooi zijn, maar ook helder uitleggen waar het kantoor actief is en welke dienstverlening het beste past bij kopers, verkopers of verhuurders.',
          'Sterke pagina’s voor verkoop, aankoop, waardebepaling en lokale werkgebieden helpen bezoekers sneller kiezen en geven Google duidelijke context.',
        ]),
      }),
      Object.freeze({
        heading: 'Leads moeten direct vervolg krijgen',
        paragraphs: Object.freeze([
          'Een waardebepaling of bezichtigingsaanvraag is vaak tijdgevoelig. Als opvolging te laat komt, is de lead kouder. Automatisering kan aanvragen samenvatten, segmenteren en direct een vervolgstap klaarzetten.',
          'Een chatbot of AI telefonist kan buiten kantooruren de eerste vragen verzamelen, terwijl het team de menselijke opvolging behoudt.',
        ]),
      }),
      Object.freeze({
        heading: 'Meer vertrouwen op de pagina zelf',
        paragraphs: Object.freeze([
          'Voor makelaars zijn bewijs en helderheid belangrijk. Denk aan cases, lokale kennis, veelgestelde vragen, stappenplannen en duidelijke contactmomenten.',
          'Softora bouwt zulke pagina’s als onderdeel van een bredere leadflow, zodat SEO-verkeer niet alleen binnenkomt maar ook richting afspraak of aanvraag beweegt.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'Softora in Tilburg', href: '/regio/tilburg' }),
      Object.freeze({ label: 'Vergelijk AI telefonist en receptionist', href: '/vergelijkingen/ai-telefonist-vs-receptionist' }),
    ]),
  }),
  Object.freeze({
    collection: 'branches',
    slug: 'zakelijke-dienstverleners',
    schemaType: 'Service',
    serviceType: 'Websites en software voor zakelijke dienstverleners',
    title: 'Websites en software voor zakelijke dienstverleners',
    description:
      'Een branchepagina voor adviseurs, bureaus en dienstverleners die meer vertrouwen, betere intake en sterkere leadopvolging willen.',
    category: 'Zakelijke dienstverlening',
    intent: 'Branche',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Zakelijke dienstverleners winnen online vooral met expertise, duidelijke positionering, bewijs en een soepel intakeproces.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Expertise moet snel zichtbaar zijn',
        paragraphs: Object.freeze([
          'Bij zakelijke dienstverlening koopt een bezoeker vaak geen product, maar vertrouwen. De website moet daarom snel laten zien voor wie je werkt, welk probleem je oplost en waarom jouw aanpak geloofwaardig is.',
          'Blogs, kennisbankartikelen, cases en duidelijke dienstpagina’s versterken elkaar. Ze helpen Google het onderwerp begrijpen en geven bezoekers meer reden om contact op te nemen.',
        ]),
      }),
      Object.freeze({
        heading: 'Intake bepaalt de kwaliteit van de lead',
        paragraphs: Object.freeze([
          'Niet elke aanvraag is even waardevol. Een goede intake verzamelt daarom budget, behoefte, timing en context zonder de bezoeker af te schrikken.',
          'AI kan helpen om antwoorden samen te vatten, leads te kwalificeren en taken klaar te zetten. Zo blijft opvolging snel, maar niet onpersoonlijk.',
        ]),
      }),
      Object.freeze({
        heading: 'Van website naar werkproces',
        paragraphs: Object.freeze([
          'Voor dienstverleners wordt de website sterker wanneer hij aansluit op CRM, planning, offertes of klantportalen. Dan stopt de flow niet bij het formulier.',
          'Softora bouwt dit stap voor stap: eerst de commerciële basis, daarna automatisering en software waar die echt waarde toevoegt.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Softora in Den Bosch', href: '/regio/den-bosch' }),
      Object.freeze({ label: 'Wat is bedrijfssoftware op maat?', href: '/kennisbank/wat-is-bedrijfssoftware-op-maat' }),
    ]),
  }),
  Object.freeze({
    collection: 'regio',
    slug: 'oisterwijk',
    schemaType: 'Service',
    serviceType: 'Websites, AI automatisering en software in Oisterwijk',
    areaServed: 'Oisterwijk',
    title: 'Website laten maken en AI automatisering in Oisterwijk',
    description:
      'Softora helpt bedrijven in Oisterwijk met websites, AI automatisering, CRM en bedrijfssoftware die verkeer en leads moeten opleveren.',
    category: 'Oisterwijk',
    intent: 'Lokale SEO',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Voor bedrijven in Oisterwijk draait online groei om lokale vindbaarheid, vertrouwen en snelle opvolging van nieuwe aanvragen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Lokale vindbaarheid zonder standaard plaatsnaampagina',
        paragraphs: Object.freeze([
          'Een lokale SEO-pagina moet meer doen dan alleen een plaatsnaam herhalen. Bezoekers uit Oisterwijk willen snel zien welke diensten relevant zijn, hoe contact werkt en waarom Softora de juiste digitale partner kan zijn.',
          'Daarom combineren we lokale context met concrete diensten: websites, AI automatisering, CRM, chatbots en maatwerk software.',
        ]),
      }),
      Object.freeze({
        heading: 'Wat dit betekent voor Oisterwijkse ondernemers',
        paragraphs: Object.freeze([
          'In Oisterwijk, Moergestel, Heukelom en de route richting Tilburg zoeken veel bedrijven niet naar een groot bureau op afstand, maar naar iemand die snel begrijpt hoe de aanvraag binnenkomt en wat er daarna moet gebeuren. Dat maakt lokale SEO vooral praktisch: de pagina moet vertrouwen geven en direct naar de juiste dienst sturen.',
          'Voor een dienstverlener kan dat een conversiegerichte website zijn. Voor een groeiend team kan het juist gaan om CRM, offerte-opvolging of AI die intakes voorbereidt. De lokale basis wordt sterker wanneer die keuzes zichtbaar naast elkaar staan in plaats van verstopt raken in algemene marketingtekst.',
        ]),
      }),
      Object.freeze({
        heading: 'Van aanvraag naar opvolging',
        paragraphs: Object.freeze([
          'Lokale ondernemers hebben vaak geen behoefte aan ingewikkelde systemen, maar wel aan duidelijkheid. Wie heeft contact opgenomen, wat is de vraag en welke vervolgstap hoort erbij?',
          'Met een goede website en slimme automatisering wordt die route korter. Leads komen beter binnen en worden sneller opgevolgd.',
        ]),
      }),
      Object.freeze({
        heading: 'Een basis die kan groeien',
        paragraphs: Object.freeze([
          'De eerste stap is een sterke lokale dienstpagina en een duidelijke contactflow. Daarna kunnen blogartikelen, cases, branchepagina’s en softwarekoppelingen de autoriteit verder versterken.',
          'Zo blijft lokale SEO onderdeel van een groter groeisysteem, niet een losse pagina.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Diensten', href: '/diensten' }),
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Website laten maken Oisterwijk', href: '/website-laten-maken-oisterwijk' }),
      Object.freeze({ label: 'Softora in Tilburg', href: '/regio/tilburg' }),
      Object.freeze({ label: 'Branches', href: '/branches' }),
      Object.freeze({ label: 'Installateurs', href: '/branches/installateurs' }),
    ]),
  }),
  Object.freeze({
    collection: 'regio',
    slug: 'tilburg',
    schemaType: 'Service',
    serviceType: 'Websites, AI automatisering en software in Tilburg',
    areaServed: 'Tilburg',
    title: 'Website laten maken en AI automatisering in Tilburg',
    description:
      'Softora bouwt websites, AI automatisering en maatwerk software voor bedrijven in Tilburg die meer leads en overzicht willen.',
    category: 'Tilburg',
    intent: 'Lokale SEO',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Tilburgse bedrijven winnen online met een sterke website, duidelijke dienstpagina’s en opvolging die niet afhankelijk is van losse handelingen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Meer dan een mooie website',
        paragraphs: Object.freeze([
          'Voor bedrijven in Tilburg is een website pas waardevol wanneer hij aanvragen oplevert. Dat vraagt om goede tekst, snelle laadtijd, duidelijke CTA’s, interne links en pagina’s die aansluiten op echte zoekvragen.',
          'Een pagina over “website laten maken Tilburg” moet daarom inhoudelijk uitleggen wat er gebouwd wordt en hoe bezoekers richting contact gaan.',
        ]),
      }),
      Object.freeze({
        heading: 'Lokale intent rond Tilburg goed afbakenen',
        paragraphs: Object.freeze([
          'Tilburg is groot genoeg voor eigen zoekintentie, maar ligt ook dichtbij Oisterwijk, Berkel-Enschot, Udenhout, Goirle en Hilvarenbeek. Daarom werkt de pagina het best wanneer hij Tilburg niet als losse city-swap behandelt, maar als onderdeel van een regionaal netwerk van ondernemers die websites, CRM en automatisering willen verbeteren.',
          'Die afbakening helpt bezoekers kiezen: wie vooral een vindbare website nodig heeft, gaat naar de websitepagina; wie aanvragen beter wil opvolgen, gaat richting CRM of AI automatisering. Zo blijft de regiopagina behulpzaam en voorkom je dat lokale content dun of herhaald voelt.',
        ]),
      }),
      Object.freeze({
        heading: 'Automatisering maakt groei beheersbaar',
        paragraphs: Object.freeze([
          'Als er meer aanvragen binnenkomen, groeit ook de opvolging. AI automatisering kan helpen met intake, samenvattingen, leadkwalificatie en taken voor het team.',
          'Voor lokale bedrijven is dat vaak de stap van losse inboxen naar een betrouwbaar proces.',
        ]),
      }),
      Object.freeze({
        heading: 'Tilburg als onderdeel van een regio-aanpak',
        paragraphs: Object.freeze([
          'Lokale SEO werkt beter wanneer plaats, dienst en branche logisch aan elkaar gekoppeld zijn. Tilburg kan bijvoorbeeld linken naar websites, CRM, AI telefonie en branchepagina’s voor dienstverleners.',
          'Zo ontstaat een netwerk van pagina’s dat bezoekers helpt en Google duidelijke context geeft.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Softora in Oisterwijk', href: '/regio/oisterwijk' }),
      Object.freeze({ label: 'Branches', href: '/branches' }),
      Object.freeze({ label: 'Zakelijke dienstverleners', href: '/branches/zakelijke-dienstverleners' }),
      Object.freeze({ label: 'Makelaars', href: '/branches/makelaars' }),
    ]),
  }),
  Object.freeze({
    collection: 'regio',
    slug: 'den-bosch',
    schemaType: 'Service',
    serviceType: 'Websites, CRM en automatisering in Den Bosch',
    areaServed: 'Den Bosch',
    title: 'Website, CRM en AI automatisering in Den Bosch',
    description:
      'Softora helpt bedrijven in Den Bosch met websites, CRM-systemen en AI automatisering die processen en leadopvolging sterker maken.',
    category: 'Den Bosch',
    intent: 'Lokale SEO',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Voor bedrijven in Den Bosch ligt de kans vaak in betere vindbaarheid én betere opvolging na de eerste aanvraag.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een lokale pagina met commerciële taak',
        paragraphs: Object.freeze([
          'Lokale SEO is pas waardevol als de pagina ook verkoopt. Bezoekers moeten begrijpen welke diensten Softora levert, welke problemen daarmee worden opgelost en hoe ze laagdrempelig contact opnemen.',
          'Daarom koppelen we Den Bosch niet alleen aan websitebouw, maar ook aan CRM, dashboards en automatisering.',
        ]),
      }),
      Object.freeze({
        heading: 'CRM en software voor meer overzicht',
        paragraphs: Object.freeze([
          'Bedrijven die groeien merken vaak dat klantinformatie verspreid raakt. Een CRM of maatwerk dashboard kan leads, afspraken, offertes en opvolging overzichtelijk maken.',
          'Die software hoeft niet groot te starten. De eerste versie moet vooral het belangrijkste proces betrouwbaar maken.',
        ]),
      }),
      Object.freeze({
        heading: 'SEO-content die verder bouwt',
        paragraphs: Object.freeze([
          'De lokale pagina is een startpunt. Daarna versterken kennisbankartikelen, branchepagina’s en blogs de context rond dezelfde diensten.',
          'Zo groeit Den Bosch mee binnen de bredere Softora-structuur.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Kennisbank', href: '/kennisbank' }),
      Object.freeze({ label: 'Zakelijke dienstverleners', href: '/branches/zakelijke-dienstverleners' }),
      Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'ai-automatisering-leadkwalificatie-mkb',
    title: 'AI automatisering voor leadkwalificatie in het MKB',
    description:
      'Hoe MKB-bedrijven AI kunnen gebruiken om leads beter voor te bereiden, te beoordelen en netjes over te dragen aan een mens.',
    category: 'AI automatisering',
    intent: 'Koopintentie',
    publishedAt: '2026-06-02',
    updatedAt: '2026-06-02',
    image: Object.freeze({
      src: '/assets/seo-content/ai-leadopvolging-workflow-mkb-softora.jpg',
      alt: 'MKB-team bespreekt een AI workflow voor leadkwalificatie en opvolging aan een kantoorwerktafel.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'AI leadkwalificatie werkt vooral goed wanneer de criteria vooraf helder zijn en een medewerker de commerciële keuzes blijft controleren.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Leadkwalificatie begint met duidelijke criteria',
        paragraphs: Object.freeze([
          'AI kan pas nuttig helpen bij leadkwalificatie wanneer duidelijk is wat een goede aanvraag voor je bedrijf betekent. Denk aan dienst, regio, timing, budgetindicatie, urgentie, beslisser en de informatie die nodig is voor een sterke vervolgstap.',
          'Zonder die criteria gaat AI vooral samenvatten wat er binnenkomt. Dat kan handig zijn, maar het maakt de opvolging nog niet scherper. De echte waarde ontstaat wanneer de aanvraag direct wordt vertaald naar een duidelijke status, taak of vervolgvraag.',
        ]),
      }),
      Object.freeze({
        heading: 'Laat AI voorbereiden en mensen beslissen',
        paragraphs: Object.freeze([
          'Voor commerciële keuzes blijft menselijke controle belangrijk. AI kan signalen herkennen, ontbrekende informatie benoemen en een voorstel doen voor prioriteit, maar het team moet kunnen zien waarom die suggestie logisch is.',
          'Daarom bouwt Softora leadflows met een duidelijke overdracht. De AI maakt een samenvatting, geeft context en zet een volgende stap klaar. Daarna kan een medewerker beoordelen of de lead direct opvolging krijgt, eerst extra vragen nodig heeft of beter naar een andere route gaat.',
        ]),
      }),
      Object.freeze({
        heading: 'Koppel kwalificatie aan CRM en opvolging',
        paragraphs: Object.freeze([
          'Leadkwalificatie is pas waardevol als het resultaat in het werkproces landt. Een losse AI-score in een chatvenster verdwijnt snel. Een CRM-status, taak, notitie of agenda-actie maakt de informatie bruikbaar voor het team.',
          'Voor MKB-bedrijven is dat vaak de praktische winst: minder zoeken, minder losse berichten en sneller overzicht over welke aanvragen aandacht nodig hebben. Zo ondersteunt AI de opvolging zonder dat het de commerciële verantwoordelijkheid overneemt.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'AI leadopvolging flow', href: '/blog/ai-automatisering-leadopvolging' }),
      Object.freeze({
        label: 'Wat is leadkwalificatie?',
        href: '/kennisbank/wat-is-leadkwalificatie',
        availableFrom: '2026-06-03',
      }),
      Object.freeze({ label: 'Wat is AI automatisering?', href: '/kennisbank/wat-is-ai-automatisering' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-leadkwalificatie',
    title: 'Wat is leadkwalificatie?',
    description:
      'Een duidelijke uitleg van leadkwalificatie, waarom het belangrijk is en hoe website, CRM en AI hierbij kunnen helpen.',
    category: 'MKB lead generation',
    intent: 'Uitleg',
    publishedAt: '2026-06-03',
    updatedAt: '2026-06-03',
    image: Object.freeze({
      src: '/assets/seo-content/chatbot-menselijke-overdracht-klantcontact-softora.jpg',
      alt: 'Medewerkers plannen klantcontact en leadkwalificatie met headset, laptop en praktische overdrachtsnotities.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Leadkwalificatie betekent dat je bepaalt welke aanvraag kansrijk is, welke informatie nog mist en welke opvolging logisch is.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De simpele betekenis',
        paragraphs: Object.freeze([
          'Leadkwalificatie is het beoordelen van een nieuwe aanvraag. Je kijkt of de vraag past bij je dienstverlening, hoe concreet de behoefte is, hoe snel iemand geholpen wil worden en welke informatie nodig is om goed te reageren.',
          'Voor een MKB-bedrijf voorkomt dit dat alle aanvragen op dezelfde stapel belanden. Sommige leads verdienen directe aandacht, andere vragen eerst om extra context en weer andere passen misschien niet bij de dienst.',
        ]),
      }),
      Object.freeze({
        heading: 'Welke informatie je meestal nodig hebt',
        paragraphs: Object.freeze([
          'Goede kwalificatie vraagt niet om een ingewikkeld formulier. De basis is vaak genoeg: naam, bedrijf, contactgegevens, vraag, gewenste dienst, regio, timing en eventuele bijzonderheden.',
          'Daarna kun je aanvullende signalen gebruiken. Komt iemand via een dienstenpagina, blog, chatbot, telefonie of WhatsApp binnen? Die context helpt om de aanvraag beter te begrijpen en sneller bij de juiste vervolgstap te krijgen.',
        ]),
      }),
      Object.freeze({
        heading: 'Hoe AI kan ondersteunen',
        paragraphs: Object.freeze([
          'AI kan helpen door tekst of gesprekken samen te vatten, ontbrekende informatie te signaleren en een voorstel te doen voor een vervolgtaak. Dat is vooral handig wanneer leads via meerdere kanalen binnenkomen.',
          'De AI moet daarbij niet doen alsof hij alles zeker weet. De beste aanpak is dat AI voorbereidt en het team de uiteindelijke keuze maakt. Zo blijft het proces snel, maar ook controleerbaar.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'AI automatisering voor leadkwalificatie', href: '/blog/ai-automatisering-leadkwalificatie-mkb' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'Wat is een CRM systeem?', href: '/kennisbank/wat-is-een-crm-systeem' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'website-leadgeneratie-mkb-meten',
    title: 'Website leadgeneratie voor het MKB: wat moet je meten?',
    description:
      'Welke signalen laten zien of een MKB-website niet alleen bezoekers krijgt, maar ook betere aanvragen en opvolging ondersteunt.',
    category: 'Websites',
    intent: 'Koopintentie',
    publishedAt: '2026-06-04',
    updatedAt: '2026-06-04',
    image: Object.freeze({
      src: '/assets/seo-content/website-leadgeneratie-wireframes-softora.jpg',
      alt: 'Website wireframes en analytics op een werktafel voor het meten van MKB leadgeneratie.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Website leadgeneratie wordt pas stuurbaar wanneer je meet welke pagina’s bezoekers aantrekken, overtuigen en richting contact brengen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Begin met de route naar contact',
        paragraphs: Object.freeze([
          'Veel ondernemers kijken eerst naar bezoekersaantallen. Dat is nuttig, maar voor leadgeneratie is de route belangrijker: via welke pagina komt iemand binnen, welke informatie bekijkt die persoon en welke CTA krijgt aandacht?',
          'Een MKB-website moet daarom niet alleen verkeer meten, maar ook contactklikken, formulierstarts, WhatsApp-klikken, doorkliks naar diensten en de vragen die daarna binnenkomen.',
        ]),
      }),
      Object.freeze({
        heading: 'Combineer SEO-data met leadkwaliteit',
        paragraphs: Object.freeze([
          'Google Search Console laat zien op welke zoekopdrachten en pagina’s je vertoningen en klikken krijgt. Analytics laat zien wat bezoekers daarna doen. Maar de belangrijkste feedback komt vaak uit de lead zelf: past de aanvraag bij je dienst?',
          'Als een pagina veel verkeer krijgt maar weinig passende aanvragen, kan de zoekintentie te breed zijn of mist de pagina overtuigende uitleg. Dan moet je niet alleen meer content maken, maar vooral scherper sturen.',
        ]),
      }),
      Object.freeze({
        heading: 'Meet ook opvolging na de aanvraag',
        paragraphs: Object.freeze([
          'Leadgeneratie stopt niet bij een formulier of WhatsApp-klik. Als opvolging traag of onduidelijk is, verlies je alsnog waarde. Daarom hoort de website gekoppeld te zijn aan een proces voor intake, CRM, taakverdeling of terugbelactie.',
          'Softora kijkt daarom naar de hele lijn: zoekvraag, pagina, CTA, aanvraag en opvolging. Pas als die route klopt, kun je gericht nieuwe blogs, kennisbankpagina’s of landingspagina’s toevoegen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Wat is een conversiegerichte website?', href: '/kennisbank/wat-is-een-conversiegerichte-website' }),
      Object.freeze({ label: 'Diensten van Softora', href: '/diensten' }),
      Object.freeze({ label: 'Website laten maken kosten 2026', href: '/blog/website-laten-maken-kosten-2026' }),
      Object.freeze({ label: 'Wat is leadkwalificatie?', href: '/kennisbank/wat-is-leadkwalificatie' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-crm-datakwaliteit',
    title: 'Wat is CRM datakwaliteit?',
    description:
      'Een praktische uitleg van CRM datakwaliteit: waarom klantdata schoon moet blijven en hoe betere data opvolging ondersteunt.',
    category: 'CRM',
    intent: 'Uitleg',
    publishedAt: '2026-06-05',
    updatedAt: '2026-06-05',
    image: Object.freeze({
      src: '/assets/seo-content/crm-datakwaliteit-klantopvolging-softora.jpg',
      alt: 'Twee medewerkers bespreken CRM datakwaliteit en klantopvolging met dashboard en procesnotities.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'CRM datakwaliteit gaat over betrouwbare klantinformatie, duidelijke statussen en data die je team echt kan gebruiken.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'CRM-data moet dagelijks bruikbaar zijn',
        paragraphs: Object.freeze([
          'CRM datakwaliteit betekent dat klantgegevens, leadstatussen, notities, taken en afspraken actueel en begrijpelijk zijn. Het gaat dus niet alleen om nette velden, maar om informatie waar medewerkers op kunnen vertrouwen.',
          'Slechte data maakt opvolging zwaarder. Leads staan dubbel in het systeem, statussen kloppen niet meer of belangrijke context zit nog in iemands mailbox. Dan wordt een CRM alsnog een plek waar mensen omheen gaan werken.',
        ]),
      }),
      Object.freeze({
        heading: 'Wat meestal misgaat',
        paragraphs: Object.freeze([
          'Veel CRM-problemen ontstaan klein. Een medewerker vult een veld anders in, een lead krijgt geen eigenaar, een afspraak wordt niet gekoppeld of een oud spreadsheet blijft naast het CRM bestaan.',
          'Na een tijdje is niet meer duidelijk welke informatie leidend is. Daarom moet een CRM niet alleen schermen hebben, maar ook duidelijke regels voor invoer, statusovergangen en verantwoordelijkheden.',
        ]),
      }),
      Object.freeze({
        heading: 'Hoe automatisering kan helpen',
        paragraphs: Object.freeze([
          'Automatisering kan dubbele invoer beperken, ontbrekende velden signaleren en samenvattingen klaarzetten na formulieren, telefoongesprekken of chats. Dat maakt het makkelijker om CRM-data actueel te houden.',
          'AI kan daarbij ondersteunen, maar blijft afhankelijk van goede proceskeuzes. Softora bouwt CRM-flows daarom rond vaste statussen, duidelijke rollen en menselijke controle op belangrijke beslissingen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Wat is een CRM systeem?', href: '/kennisbank/wat-is-een-crm-systeem' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
    ]),
  }),
  Object.freeze({
    collection: 'regio',
    slug: 'midden-brabant',
    schemaType: 'Service',
    serviceType: 'Websites, CRM en AI automatisering in Midden-Brabant',
    areaServed: 'Midden-Brabant',
    title: 'Website, CRM en AI automatisering in Midden-Brabant',
    description:
      'Softora helpt MKB-bedrijven in Midden-Brabant met websites, CRM, maatwerk software en AI automatisering voor betere opvolging.',
    category: 'Midden-Brabant',
    intent: 'Lokale SEO',
    publishedAt: '2026-06-08',
    updatedAt: '2026-06-08',
    image: Object.freeze({
      src: '/assets/seo-content/midden-brabant-digitale-groei-softora.jpg',
      alt: 'Ondernemer en digitale consultant bespreken een groeiplan voor websites, CRM en AI automatisering in Midden-Brabant.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Voor bedrijven in Midden-Brabant ligt de kans vaak in een betere websitebasis, duidelijke leadopvolging en automatisering die past bij het team.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een regionale pagina moet dienstwaarde hebben',
        paragraphs: Object.freeze([
          'Een sterke regiopagina is meer dan een plaatsnaam met algemene tekst. Bedrijven in Midden-Brabant zoeken een partner die begrijpt hoe websites, CRM en automatisering samen de route van bezoeker naar opvolging kunnen verbeteren.',
          'Daarom koppelt deze pagina lokale relevantie aan concrete Softora-diensten: website laten maken, AI automatisering, CRM op maat, chatbots en bedrijfssoftware.',
        ]),
      }),
      Object.freeze({
        heading: 'Van Oisterwijk en Tilburg naar bredere groei',
        paragraphs: Object.freeze([
          'Softora heeft al lokale context rond Oisterwijk, Tilburg en Den Bosch. Midden-Brabant verbindt die route voor ondernemers die regionaal zoeken, maar vooral willen weten welke digitale stap nu verstandig is.',
          'Voor de ene organisatie begint dat met een betere website. Voor een ander bedrijf is CRM, leadkwalificatie of AI telefonie logischer. De pagina moet helpen kiezen zonder te doen alsof één oplossing altijd past.',
        ]),
      }),
      Object.freeze({
        heading: 'Praktische digitalisering voor het MKB',
        paragraphs: Object.freeze([
          'MKB-bedrijven hebben meestal geen behoefte aan onnodig grote systemen. Ze willen dat aanvragen beter binnenkomen, klantinformatie overzichtelijk blijft en terugkerend werk minder tijd kost.',
          'Softora benadert dit stap voor stap: eerst de commerciële basis en meetbaarheid, daarna automatisering of software waar die echt waarde toevoegt. Zo blijft digitale groei beheersbaar en bruikbaar voor het team.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Softora in Oisterwijk', href: '/regio/oisterwijk' }),
      Object.freeze({ label: 'Softora in Tilburg', href: '/regio/tilburg' }),
      Object.freeze({ label: 'Diensten van Softora', href: '/diensten' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'ai-processen-automatiseren-zonder-controle-verliezen',
    title: 'AI processen automatiseren zonder controle te verliezen',
    description:
      'Hoe MKB-bedrijven AI processen kunnen automatiseren met duidelijke grenzen, menselijke controle en bruikbare opvolging.',
    category: 'AI automatisering',
    intent: 'Koopintentie',
    publishedAt: '2026-06-09',
    updatedAt: '2026-06-09',
    image: Object.freeze({
      src: '/assets/seo-content/ai-automatisering-workflow-softora.jpg',
      alt: 'Team bespreekt een AI automatiseringsworkflow met duidelijke processtappen, overdracht en menselijke controle.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'AI processen automatiseren werkt alleen verantwoord wanneer input, beslismomenten, systeemkoppelingen en menselijke controle vooraf helder zijn.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Begin bij het proces dat elke week terugkomt',
        paragraphs: Object.freeze([
          'Een proces automatiseren met AI begint niet bij een model of prompt, maar bij terugkerend werk dat nu tijd kost. Denk aan aanvragen samenvatten, klantvragen sorteren, offertes voorbereiden, taken klaarzetten of gesprekken vertalen naar CRM-notities.',
          'Voor MKB-bedrijven is vooral herhaalbaarheid belangrijk. Als dezelfde informatie steeds opnieuw binnenkomt en dezelfde vervolgstap nodig is, kan AI helpen om de eerste voorbereiding sneller en consistenter te maken.',
        ]),
      }),
      Object.freeze({
        heading: 'Leg vast wat AI wel en niet mag doen',
        paragraphs: Object.freeze([
          'De sterkste AI processen hebben duidelijke grenzen. AI mag bijvoorbeeld informatie samenvatten, ontbrekende velden signaleren of een vervolgtaak voorstellen. Belangrijke keuzes, uitzonderingen en gevoelige beslissingen blijven zichtbaar voor een medewerker.',
          'Die verdeling voorkomt dat automatisering oncontroleerbaar wordt. Het team ziet welke informatie is gebruikt, welke suggestie AI doet en waar menselijke beoordeling nodig blijft voordat er actie wordt genomen.',
        ]),
      }),
      Object.freeze({
        heading: 'Koppel de uitkomst aan je bestaande werkroute',
        paragraphs: Object.freeze([
          'Een AI proces wordt pas nuttig wanneer het resultaat ergens landt. Een samenvatting in een los venster is kwetsbaar. Een CRM-taak, agenda-actie, mailboxconcept of dashboardmelding maakt de informatie bruikbaar voor opvolging.',
          'Softora bouwt AI automatisering daarom rond de route die al belangrijk is: website, formulier, chatbot, telefonie, CRM, mailbox of planning. Zo ondersteunt AI het proces zonder dat het team grip kwijtraakt.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'AI automatisering voor leadopvolging', href: '/blog/ai-automatisering-leadopvolging' }),
      Object.freeze({ label: 'Wat is AI automatisering?', href: '/kennisbank/wat-is-ai-automatisering' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-een-ai-workflow',
    title: 'Wat is een AI workflow?',
    description:
      'Een heldere uitleg van AI workflows: hoe invoer, AI-stappen, menselijke controle en systeemkoppelingen samen een proces vormen.',
    category: 'AI automatisering',
    intent: 'Uitleg',
    publishedAt: '2026-06-10',
    updatedAt: '2026-06-10',
    image: Object.freeze({
      src: '/assets/seo-content/ai-leadopvolging-workflow-mkb-softora.jpg',
      alt: 'Werktafel met procesnotities voor een AI workflow die leads samenvat, kwalificeert en overdraagt aan een medewerker.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Een AI workflow is een vaste route waarin AI informatie verwerkt, een taak voorbereidt en de uitkomst doorzet naar een mens of systeem.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De simpele betekenis',
        paragraphs: Object.freeze([
          'Een AI workflow is een proces waarin kunstmatige intelligentie een duidelijke stap uitvoert binnen een vaste route. De workflow bepaalt welke informatie binnenkomt, wat AI ermee mag doen en waar de uitkomst daarna terechtkomt.',
          'Voorbeelden zijn een formulier dat automatisch wordt samengevat, een telefoongesprek dat een CRM-notitie wordt of een chatbotgesprek dat eindigt in een taak voor opvolging.',
        ]),
      }),
      Object.freeze({
        heading: 'Welke onderdelen erbij horen',
        paragraphs: Object.freeze([
          'Een goede AI workflow bestaat uit input, instructies, controle, output en overdracht. Input kan tekst, een gesprek, een formulier of klantdata zijn. De instructies bepalen hoe AI die informatie moet beoordelen of samenvatten.',
          'Daarna volgt de controle: mag AI alleen voorbereiden of ook iets klaarzetten? De output moet vervolgens bruikbaar zijn, bijvoorbeeld als taak, status, mailconcept, agenda-actie of CRM-notitie.',
        ]),
      }),
      Object.freeze({
        heading: 'Waarom menselijke controle nodig blijft',
        paragraphs: Object.freeze([
          'AI kan helpen om herhaling sneller te verwerken, maar context en verantwoordelijkheid verdwijnen niet. Bij commerciële keuzes, uitzonderingen of gevoelige klantvragen moet een medewerker kunnen meekijken.',
          'Daarom werkt een AI workflow het beste als hij transparant is. Je wilt kunnen zien wat AI heeft gedaan, welke informatie is gebruikt en welke stap daarna logisch is.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'AI processen automatiseren', href: '/blog/ai-processen-automatiseren-zonder-controle-verliezen' }),
      Object.freeze({ label: 'Wat is AI automatisering?', href: '/kennisbank/wat-is-ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'website-crm-koppeling-leadopvolging-mkb',
    title: 'Website en CRM koppelen voor betere MKB leadopvolging',
    description:
      'Waarom een website sterker wordt wanneer aanvragen direct landen in CRM, taken, statusoverzicht en meetbare opvolging.',
    category: 'CRM',
    intent: 'Koopintentie',
    publishedAt: '2026-06-11',
    updatedAt: '2026-06-11',
    image: Object.freeze({
      src: '/assets/seo-content/crm-datakwaliteit-klantopvolging-softora.jpg',
      alt: 'Medewerkers bespreken CRM klantopvolging met websiteaanvragen, leadstatussen en duidelijke vervolgtaken.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Een website-CRM-koppeling voorkomt dat aanvragen blijven hangen in losse inboxen en maakt opvolging beter zichtbaar voor het team.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een aanvraag is pas waardevol als opvolging klopt',
        paragraphs: Object.freeze([
          'Een MKB-website kan bezoekers aantrekken, uitleg geven en contactmomenten verzamelen. Maar als aanvragen daarna in losse mailboxen, WhatsApp-gesprekken of spreadsheets blijven hangen, wordt leadopvolging alsnog kwetsbaar.',
          'Door de website aan CRM te koppelen, krijgt elke aanvraag sneller een plek. Het team ziet wie contact heeft opgenomen, welke dienst relevant is, welke status erbij hoort en welke vervolgstap nodig is.',
        ]),
      }),
      Object.freeze({
        heading: 'Welke informatie je direct wilt vastleggen',
        paragraphs: Object.freeze([
          'De basis hoeft niet ingewikkeld te zijn. Naam, bedrijf, contactgegevens, dienst, vraag, bronpagina, urgentie en gewenste opvolging geven vaak al genoeg context om sneller te reageren.',
          'Daarna kun je uitbreiden met automatische samenvattingen, leadkwalificatie, taken, agenda-acties en rapportages. De koppeling moet vooral voorkomen dat informatie opnieuw handmatig wordt overgetypt.',
        ]),
      }),
      Object.freeze({
        heading: 'Maak leadkwaliteit meetbaar',
        paragraphs: Object.freeze([
          'Een CRM-koppeling maakt ook duidelijk welke pagina’s passende aanvragen opleveren. Niet alleen het aantal leads telt, maar ook de kwaliteit van de vraag, de snelheid van opvolging en de stap die daarna wordt gezet.',
          'Softora kijkt daarom naar de hele route: zoekvraag, websitepagina, CTA, aanvraag, CRM-status en actie. Zo wordt websitegroei beter verbonden met het echte verkoopproces.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Website leadgeneratie meten', href: '/blog/website-leadgeneratie-mkb-meten' }),
      Object.freeze({ label: 'Wat is CRM datakwaliteit?', href: '/kennisbank/wat-is-crm-datakwaliteit' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-een-sales-pipeline-crm',
    title: 'Wat is een sales pipeline in CRM?',
    description:
      'Een praktische uitleg van sales pipelines in CRM: fases, taken, eigenaarschap en opvolging van nieuwe lead tot klant.',
    category: 'CRM',
    intent: 'Uitleg',
    publishedAt: '2026-06-12',
    updatedAt: '2026-06-12',
    image: Object.freeze({
      src: '/assets/seo-content/crm-software-dashboard-softora.jpg',
      alt: 'CRM-dashboard met sales pipeline, leadfases en opvolgtaken voor overzichtelijke commerciële opvolging.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Een sales pipeline is de vaste route waarmee een team ziet in welke fase een lead zit en welke actie nodig is.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De simpele betekenis',
        paragraphs: Object.freeze([
          'Een sales pipeline is een overzicht van commerciële fases. Een lead komt bijvoorbeeld binnen als nieuwe aanvraag, gaat daarna naar kwalificatie, afspraak, voorstel, opvolging en uiteindelijk gewonnen of verloren.',
          'In een CRM helpt zo’n pipeline om overzicht te houden. Je ziet welke kansen openstaan, wie eigenaar is en welke taak als volgende moet gebeuren.',
        ]),
      }),
      Object.freeze({
        heading: 'Waarom fases duidelijk moeten zijn',
        paragraphs: Object.freeze([
          'Een pipeline werkt alleen wanneer iedereen dezelfde betekenis geeft aan een fase. Als “opvolgen” voor de ene medewerker iets anders betekent dan voor de andere, wordt rapportage onbetrouwbaar.',
          'Daarom begint een goed CRM niet met zoveel mogelijk velden, maar met heldere statusovergangen. Welke informatie is nodig om naar de volgende fase te gaan en wie beslist dat?',
        ]),
      }),
      Object.freeze({
        heading: 'Hoe automatisering kan ondersteunen',
        paragraphs: Object.freeze([
          'Automatisering kan helpen door taken klaar te zetten, ontbrekende informatie te signaleren of een samenvatting te maken na een formulier, chatbotgesprek of telefoontje.',
          'AI kan daarbij ondersteunen, maar de pipeline blijft een proceskeuze. Het team moet kunnen controleren of de fase klopt en welke commerciële stap verstandig is.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Wat is een CRM systeem?', href: '/kennisbank/wat-is-een-crm-systeem' }),
      Object.freeze({ label: 'Wat is CRM datakwaliteit?', href: '/kennisbank/wat-is-crm-datakwaliteit' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Website en CRM koppelen', href: '/blog/website-crm-koppeling-leadopvolging-mkb' }),
    ]),
  }),
  Object.freeze({
    collection: 'vergelijkingen',
    slug: 'crm-op-maat-vs-standaard-crm',
    title: 'CRM op maat vs standaard CRM: wanneer kies je wat?',
    description:
      'Een nuchtere vergelijking tussen standaard CRM en CRM op maat voor MKB-bedrijven die leads, klanten en opvolging beter willen organiseren.',
    category: 'CRM',
    intent: 'Vergelijking',
    publishedAt: '2026-06-15',
    updatedAt: '2026-06-15',
    image: Object.freeze({
      src: '/assets/seo-content/crm-software-dashboard-softora.jpg',
      alt: 'CRM-dashboard en procesoverzicht waarmee standaard CRM en CRM op maat praktisch worden vergeleken.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Standaard CRM is vaak sterk om snel te starten, terwijl CRM op maat logischer wordt wanneer je eigen proces leidend moet zijn.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Standaard CRM is vaak logisch bij een duidelijke basis',
        paragraphs: Object.freeze([
          'Een standaard CRM kan een goede keuze zijn wanneer je vooral contactgegevens, notities, taken en eenvoudige opvolging wilt vastleggen. Je kunt relatief snel starten en hoeft minder keuzes zelf te maken.',
          'De beperking ontstaat wanneer je werkwijze niet goed past in de vaste schermen, fases of rapportages. Dan gaan teams alsnog werken met extra spreadsheets, losse notities of handmatige omwegen.',
        ]),
      }),
      Object.freeze({
        heading: 'CRM op maat wordt interessant bij eigen processen',
        paragraphs: Object.freeze([
          'CRM op maat is vooral logisch wanneer je eigen leadfases, rollen, berekeningen, klanttypes, automatiseringen of koppelingen nodig hebt. Het systeem volgt dan de manier waarop je team werkt in plaats van andersom.',
          'Dat betekent niet dat maatwerk altijd groter moet zijn. De beste eerste versie is vaak compact: duidelijke pipeline, klantkaart, taken, statusoverzicht en koppeling met website, mailbox of agenda.',
        ]),
      }),
      Object.freeze({
        heading: 'Vergelijk vooral op procesfit',
        paragraphs: Object.freeze([
          'De juiste keuze hangt niet alleen af van prijs of functies. Belangrijker is of het CRM ervoor zorgt dat leads sneller duidelijkheid krijgen, klantinformatie betrouwbaar blijft en medewerkers minder dubbel werk doen.',
          'Softora kijkt daarom eerst naar de route van aanvraag naar opvolging. Als standaard CRM die route goed draagt, is dat prima. Als het proces onderscheidend is of veel omwegen vraagt, wordt CRM op maat sterker.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Wat is een sales pipeline?', href: '/kennisbank/wat-is-een-sales-pipeline-crm' }),
      Object.freeze({ label: 'Wat is een CRM systeem?', href: '/kennisbank/wat-is-een-crm-systeem' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Maatwerk software vs standaard software', href: '/vergelijkingen/maatwerk-software-vs-standaard-software' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'ai-automatisering-offerte-opvolging-mkb',
    title: 'AI automatisering voor offerte opvolging in het MKB',
    description:
      'Hoe MKB-bedrijven offerte opvolging slimmer kunnen voorbereiden met AI, CRM-taken en menselijke controle zonder drukker te worden.',
    category: 'AI automatisering',
    intent: 'Koopintentie',
    publishedAt: '2026-06-16',
    updatedAt: '2026-06-16',
    image: Object.freeze({
      src: '/assets/seo-content/ai-leadopvolging-workflow-mkb-softora.jpg',
      alt: 'Werktafel met laptop en procesnotities voor AI automatisering van offerte opvolging en leadtaken in het MKB.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'AI kan offerte opvolging ondersteunen door signalen te ordenen, taken klaar te zetten en conceptberichten voor te bereiden.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Offertes blijven vaak liggen na het versturen',
        paragraphs: Object.freeze([
          'Veel MKB-bedrijven hebben genoeg aandacht voor de offerte zelf, maar minder voor de route erna. Een aanvraag komt binnen, er wordt een voorstel gemaakt en daarna verdwijnt opvolging soms in losse agenda’s, inboxen of geheugen van medewerkers.',
          'Daar zit een kans voor AI automatisering. Niet omdat AI de commerciële keuze moet overnemen, maar omdat de voorbereiding beter kan. Denk aan een samenvatting van de aanvraag, een reminder op het juiste moment en een conceptbericht dat een medewerker kan controleren.',
        ]),
      }),
      Object.freeze({
        heading: 'Gebruik AI als voorbereiding, niet als automatische drukknop',
        paragraphs: Object.freeze([
          'Offerte opvolging vraagt context. Soms is snel bellen logisch, soms eerst een korte mail en soms juist wachten omdat de klant nog informatie moest aanleveren. Daarom hoort AI hier vooral te ondersteunen: informatie verzamelen, prioriteit voorstellen en vervolgtaken zichtbaar maken.',
          'De medewerker blijft eigenaar van toon, timing en inhoud. Dat maakt de workflow betrouwbaarder en voorkomt dat klanten onpersoonlijke opvolging krijgen die niet past bij het gesprek.',
        ]),
      }),
      Object.freeze({
        heading: 'Koppel opvolging aan CRM en status',
        paragraphs: Object.freeze([
          'De sterkste verbetering ontstaat wanneer offerte opvolging niet los staat van CRM. Elke offerte krijgt dan een status, eigenaar, volgende actie en laatste contactmoment. AI kan helpen om ontbrekende informatie te signaleren of een korte samenvatting klaar te zetten.',
          'Voor Softora-projecten is de kern meestal compact: aanvraag vastleggen, offertefase kiezen, taak plannen, concept opvolging maken en pas versturen nadat iemand heeft meegekeken. Zo wordt opvolging consistenter zonder dat het team grip verliest.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Website en CRM koppelen', href: '/blog/website-crm-koppeling-leadopvolging-mkb' }),
      Object.freeze({ label: 'Wat is offerte automatisering?', href: '/kennisbank/wat-is-offerte-automatisering', availableFrom: '2026-06-17' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-offerte-automatisering',
    title: 'Wat is offerte automatisering?',
    description:
      'Een praktische uitleg van offerte automatisering: van aanvraag en voorstel tot opvolgtaak, CRM-status en controle door het team.',
    category: 'CRM',
    intent: 'Uitleg',
    publishedAt: '2026-06-17',
    updatedAt: '2026-06-17',
    image: Object.freeze({
      src: '/assets/seo-content/crm-datakwaliteit-klantopvolging-softora.jpg',
      alt: 'Medewerkers bespreken offerte automatisering met CRM-statussen, klantinformatie en opvolgtaken op een laptop.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Offerte automatisering is het slimmer voorbereiden, vastleggen en opvolgen van offertes zonder de menselijke beoordeling te verliezen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De simpele betekenis',
        paragraphs: Object.freeze([
          'Offerte automatisering betekent dat terugkerende stappen rond offertes worden ondersteund door software. Denk aan aanvraaggegevens verzamelen, een voorstel voorbereiden, een status bijwerken, een taak plannen of een opvolgmail als concept klaarzetten.',
          'Het doel is niet dat elke offerte automatisch uit een systeem rolt. Het doel is vooral dat informatie niet zoekraakt en dat medewerkers minder handwerk hebben rond dezelfde stappen.',
        ]),
      }),
      Object.freeze({
        heading: 'Welke onderdelen je kunt automatiseren',
        paragraphs: Object.freeze([
          'Een goede basis bestaat uit een duidelijke aanvraag, klantgegevens, gewenste dienst, offertefase, eigenaar en volgende actie. Vanuit die basis kun je templates, CRM-taken, herinneringen en samenvattingen toevoegen.',
          'AI kan helpen bij tekst en context, bijvoorbeeld door een aanvraag samen te vatten of een concept voor opvolging te maken. Een medewerker controleert daarna of de inhoud klopt en past bij de klant.',
        ]),
      }),
      Object.freeze({
        heading: 'Wanneer het zinvol wordt',
        paragraphs: Object.freeze([
          'Offerte automatisering wordt zinvol wanneer voorstellen vaak blijven liggen, informatie verspreid staat of opvolging afhankelijk is van losse notities. Vooral groeiende teams merken dat een vaste workflow rust geeft.',
          'Begin compact. Leg eerst de offertefases, verantwoordelijkheden en opvolgmomenten vast. Daarna kun je koppelen met websiteformulieren, CRM, mailbox, agenda of maatwerk software.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'AI offerte opvolging', href: '/blog/ai-automatisering-offerte-opvolging-mkb' }),
      Object.freeze({ label: 'Wat is een sales pipeline?', href: '/kennisbank/wat-is-een-sales-pipeline-crm' }),
      Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'chatbot-crm-koppeling-leads-opvolgen',
    title: 'Chatbot en CRM koppelen om leads beter op te volgen',
    description:
      'Waarom een chatbot sterker wordt wanneer gesprekken direct eindigen in CRM, leadstatus, samenvatting en een duidelijke opvolgtaak.',
    category: 'Chatbots',
    intent: 'Koopintentie',
    publishedAt: '2026-06-18',
    updatedAt: '2026-06-18',
    image: Object.freeze({
      src: '/assets/seo-content/chatbot-menselijke-overdracht-klantcontact-softora.jpg',
      alt: 'Team bekijkt chatbotgesprekken en CRM-opvolging met duidelijke overdracht van leadvragen naar medewerkers.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Een chatbot wordt waardevoller wanneer elk passend gesprek wordt samengevat, opgeslagen en opgevolgd in CRM.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een chatbotgesprek moet ergens landen',
        paragraphs: Object.freeze([
          'Een chatbot kan bezoekers sneller helpen met vragen, intake en kwalificatie. Maar als het gesprek daarna alleen in een chatgeschiedenis blijft staan, mist het team alsnog context voor opvolging.',
          'Door de chatbot aan CRM te koppelen, wordt het gesprek onderdeel van de commerciële route. De samenvatting, contactgegevens, interesse en vervolgstap staan dan op een plek waar iemand ermee verder kan.',
        ]),
      }),
      Object.freeze({
        heading: 'Leg niet alles vast, maar wel het juiste',
        paragraphs: Object.freeze([
          'Een CRM-koppeling hoeft niet elk woord te bewaren. Meestal zijn de belangrijkste velden voldoende: naam, bedrijf, vraag, dienst, urgentie, bronpagina, samenvatting en voorgestelde actie.',
          'AI kan helpen om die informatie uit het gesprek te halen. De workflow moet daarbij duidelijk aangeven wanneer een gesprek geschikt is voor opvolging en wanneer een medewerker eerst moet controleren.',
        ]),
      }),
      Object.freeze({
        heading: 'Maak overdracht naar mensen expliciet',
        paragraphs: Object.freeze([
          'De beste chatbotflow heeft een duidelijke grens. Veelgestelde vragen kan de chatbot zelfstandig voorbereiden, maar bij twijfel, complexiteit of commerciële intentie moet overdracht naar een mens logisch zijn.',
          'Softora bouwt chatbot en CRM daarom samen: de chatbot vangt de eerste laag op, CRM houdt status en taak vast en het team blijft verantwoordelijk voor de klantrelatie.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Chatbot vs livechat', href: '/vergelijkingen/chatbot-vs-livechat' }),
      Object.freeze({ label: 'Website en CRM koppelen', href: '/blog/website-crm-koppeling-leadopvolging-mkb' }),
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-een-klantportaal',
    title: 'Wat is een klantportaal?',
    description:
      'Heldere uitleg van klantportalen: wanneer een portal handig is, welke functies vaak nodig zijn en hoe het samenhangt met CRM.',
    category: 'Bedrijfssoftware',
    intent: 'Uitleg',
    publishedAt: '2026-06-19',
    updatedAt: '2026-06-19',
    image: Object.freeze({
      src: '/assets/seo-content/crm-software-dashboard-softora.jpg',
      alt: 'Dashboard op laptop voor klantportaal, CRM-informatie, taken en overzichtelijke digitale klantprocessen.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Een klantportaal is een beveiligde digitale omgeving waar klanten informatie, documenten, status of acties kunnen terugvinden.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De simpele definitie',
        paragraphs: Object.freeze([
          'Een klantportaal is een online omgeving waar klanten kunnen inloggen om informatie te bekijken of acties uit te voeren. Denk aan documenten, opdrachten, afspraken, berichten, statusupdates, formulieren of factuurinformatie.',
          'Voor bedrijven is een portaal vooral interessant wanneer veel klantvragen gaan over dezelfde informatie. In plaats van steeds losse mails te sturen, staat de belangrijkste informatie op een vaste plek.',
        ]),
      }),
      Object.freeze({
        heading: 'Welke functies vaak nodig zijn',
        paragraphs: Object.freeze([
          'De inhoud hangt af van het proces. Een eenvoudig portaal kan starten met status, documenten en berichten. Een uitgebreider portaal kan ook formulieren, goedkeuringen, taken, rapportages of koppelingen met CRM bevatten.',
          'Belangrijk is dat het portaal niet los staat van de interne workflow. Als medewerkers informatie dubbel moeten invoeren, verschuift het probleem alleen naar een ander scherm.',
        ]),
      }),
      Object.freeze({
        heading: 'Wanneer maatwerk logisch wordt',
        paragraphs: Object.freeze([
          'Maatwerk wordt logisch wanneer standaard klantportalen niet passen bij je proces, rollen of data. Bijvoorbeeld omdat klanten verschillende rechten hebben, statussen specifiek zijn of het portaal moet koppelen met CRM, planning of offertes.',
          'Een goed klantportaal begint klein: welke informatie wil de klant terugzien, welke actie moet minder handmatig worden en welke gegevens moeten intern betrouwbaar blijven?',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Wat is bedrijfssoftware op maat?', href: '/kennisbank/wat-is-bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'CRM op maat vs standaard CRM', href: '/vergelijkingen/crm-op-maat-vs-standaard-crm' }),
    ]),
  }),
  Object.freeze({
    collection: 'regio',
    slug: 'tilburg-ai-automatisering',
    title: 'AI automatisering Tilburg voor MKB-processen',
    description:
      'Softora helpt bedrijven in Tilburg en omgeving met AI automatisering voor leadopvolging, klantcontact, CRM en terugkerende processen.',
    category: 'AI automatisering Tilburg',
    intent: 'Lokale koopintentie',
    schemaType: 'Service',
    areaServed: 'Tilburg',
    publishedAt: '2026-06-22',
    updatedAt: '2026-06-22',
    image: Object.freeze({
      src: '/assets/seo-content/midden-brabant-digitale-groei-softora.jpg',
      alt: 'Kantooroverleg in Midden-Brabant over AI automatisering, CRM en digitale groei voor bedrijven in Tilburg.',
      width: 1600,
      height: 1000,
    }),
    summary:
      'Voor Tilburgse MKB-bedrijven is AI automatisering vooral waardevol wanneer klantvragen, leads en interne taken slimmer samenkomen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Lokale automatisering moet meer zijn dan een plaatsnaam',
        paragraphs: Object.freeze([
          'Een pagina over AI automatisering in Tilburg moet niet alleen zeggen dat Softora in de regio werkt. De inhoud moet laten zien welke processen voor lokale MKB-bedrijven herkenbaar zijn: aanvragen opvolgen, klantvragen verwerken, afspraken voorbereiden en CRM actueel houden.',
          'Softora zit in Oisterwijk en werkt voor ondernemers in Midden-Brabant. Daardoor is Tilburg logisch als regiofocus, maar de waarde blijft hetzelfde: een praktische workflow die minder handwerk oplevert en betere opvolging mogelijk maakt.',
        ]),
      }),
      Object.freeze({
        heading: 'Waar Tilburgse bedrijven vaak starten',
        paragraphs: Object.freeze([
          'Een goed startpunt is vaak leadopvolging. Websiteaanvragen, belnotities, chatbotgesprekken en mailvragen kunnen sneller worden samengevat en klaargezet voor opvolging in CRM of agenda.',
          'Ook interne processen zijn geschikt: statusupdates, intake, offertevoorbereiding, rapportages en taakverdeling. AI ondersteunt dan de voorbereiding, terwijl medewerkers controle houden over de uiteindelijke beslissing.',
        ]),
      }),
      Object.freeze({
        heading: 'Koppel AI aan website, CRM en team',
        paragraphs: Object.freeze([
          'Losse AI-tools leveren meestal weinig structurele rust op. Het wordt pas interessant wanneer de uitkomst op de juiste plek terechtkomt: een CRM-status, taak, mailboxconcept, agenda-actie of dashboardmelding.',
          'Daarom bouwt Softora AI automatisering rond de bestaande groeiroute van het bedrijf. Voor Tilburg betekent dat lokale vindbaarheid combineren met goede opvolging, zodat verkeer, aanvragen en processen elkaar versterken.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
      Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
      Object.freeze({ label: 'Softora in Tilburg', href: '/regio/tilburg' }),
      Object.freeze({ label: 'Website laten maken Oisterwijk', href: '/website-laten-maken-oisterwijk' }),
      Object.freeze({ label: 'AI processen automatiseren', href: '/blog/ai-processen-automatiseren-zonder-controle-verliezen' }),
    ]),
  }),
]);

function normalizeSiteOrigin(valueRaw = DEFAULT_SITE_ORIGIN) {
  const raw = String(valueRaw || '').trim() || DEFAULT_SITE_ORIGIN;
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return DEFAULT_SITE_ORIGIN;
    return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, '');
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

function normalizePath(valueRaw) {
  const raw = String(valueRaw || '').trim();
  if (!raw) return '';
  let pathName = raw.split('?')[0].split('#')[0];
  if (!pathName.startsWith('/')) pathName = `/${pathName}`;
  pathName = pathName.replace(/\/{2,}/g, '/');
  if (pathName.length > 1) pathName = pathName.replace(/\/+$/, '');
  return pathName || '/';
}

function buildAbsoluteUrl(siteOriginRaw, pathNameRaw) {
  const siteOrigin = normalizeSiteOrigin(siteOriginRaw);
  const pathName = normalizePath(pathNameRaw) || '/';
  return pathName === '/' ? `${siteOrigin}/` : `${siteOrigin}${pathName}`;
}

function escapeHtml(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getSeoContentCollection(collectionRaw) {
  const key = String(collectionRaw || '').trim().toLowerCase();
  return SEO_CONTENT_COLLECTIONS[key] || null;
}

function getSeoContentCollectionPaths() {
  return Object.values(SEO_CONTENT_COLLECTIONS).map((collection) => collection.path);
}

function getSeoContentPillars() {
  return SEO_CONTENT_PILLARS;
}

function getSeoContentClusters() {
  return SEO_CONTENT_CLUSTERS;
}

function getSeoContentClusterForItem(item) {
  const collection = String(item && item.collection ? item.collection : '').trim().toLowerCase();
  const category = String(item && item.category ? item.category : '').trim().toLowerCase();
  const slug = String(item && item.slug ? item.slug : '').trim().toLowerCase();
  const title = String(item && item.title ? item.title : '').trim().toLowerCase();
  const combined = `${collection} ${category} ${slug} ${title}`;
  let clusterKey = 'websites';

  if (collection === 'regio') {
    clusterKey = 'lokaal';
  } else if (collection === 'branches') {
    clusterKey = 'branches';
  } else if (/chatbot|telefonie|telefonist|voice|klantcontact|livechat/.test(combined)) {
    clusterKey = 'ai-contact';
  } else if (/crm|bedrijfssoftware|software|platform|spreadsheet/.test(combined)) {
    clusterKey = 'software-crm';
  } else if (/ai automatisering|automatisering/.test(combined)) {
    clusterKey = 'ai-automatisering';
  }

  return SEO_CONTENT_CLUSTERS.find((cluster) => cluster.key === clusterKey) || SEO_CONTENT_CLUSTERS[0];
}

function getSeoContentImageForItem(item) {
  if (item && item.image && item.image.src) {
    return item.image;
  }
  const cluster = getSeoContentClusterForItem(item);
  return SEO_CONTENT_IMAGES_BY_CLUSTER[cluster.key] || SEO_CONTENT_IMAGES_BY_CLUSTER.websites;
}

function countWords(valueRaw) {
  return String(valueRaw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countSeoContentWords(item) {
  if (!item) return 0;
  const sectionWords = (item.sections || []).reduce((total, section) => {
    const paragraphWords = (section.paragraphs || []).reduce((sum, paragraph) => sum + countWords(paragraph), 0);
    return total + countWords(section.heading) + paragraphWords;
  }, 0);
  const faqWords = (item.faq || []).reduce((total, entry) => total + countWords(entry.question) + countWords(entry.answer), 0);
  return (
    countWords(item.title) +
    countWords(item.description) +
    countWords(item.summary) +
    sectionWords +
    faqWords
  );
}

function getSeoContentMinimumWordCount(item) {
  const collection = String(item && item.collection ? item.collection : '').trim().toLowerCase();
  return SEO_CONTENT_MIN_WORDS_BY_COLLECTION[collection] || 650;
}

function formatSeoReadTime(wordCountRaw) {
  const wordCount = Number(wordCountRaw) || 0;
  const minutes = Math.max(4, Math.ceil(wordCount / 190));
  return `${minutes} min`;
}

function buildSeoContentDepthSections(item) {
  const cluster = getSeoContentClusterForItem(item);
  const topic = String(item.title || 'dit onderwerp').trim();
  const category = String(item.category || cluster.label || 'digitale groei').trim();
  const intent = String(item.intent || 'orientatie').trim().toLowerCase();
  const commercialRoute = cluster.ctaLabel || 'de juiste oplossing';
  const clusterContext = {
    websites:
      'Bij websites gaat het uiteindelijk om vindbaarheid, vertrouwen en aanvraagmomenten. Een pagina moet dus niet alleen mooi zijn, maar ook snel duidelijk maken waarom iemand contact zou opnemen.',
    'ai-automatisering':
      'Bij AI automatisering draait de waarde vooral om herhaalbaar werk: intake, beoordeling, samenvatting, overdracht en opvolging. De techniek is pas nuttig wanneer de route eromheen strak staat.',
    'software-crm':
      'Bij software en CRM zit de winst in overzicht. Leads, klanten, taken, offertes en rapportages moeten op een plek samenkomen, zodat een team minder hoeft te zoeken en sneller kan handelen.',
    'ai-contact':
      'Bij AI klantcontact gaat het niet om een slim trucje, maar om bereikbaarheid, duidelijke antwoorden en veilige overdracht naar een mens wanneer dat beter is.',
    branches:
      'Bij branchepagina’s is herkenbaarheid belangrijk. Een ondernemer moet direct voelen dat de voorbeelden aansluiten op de dagelijkse praktijk van zijn of haar bedrijf.',
    lokaal:
      'Bij lokale SEO telt vertrouwen extra zwaar. De pagina moet duidelijk maken voor welke regio Softora relevant is en welke concrete digitale stap een bedrijf daar kan zetten.',
  }[cluster.key] || 'De waarde zit in duidelijke keuzes, goede techniek en een logische route van bezoeker naar aanvraag.';

  return Object.freeze([
    Object.freeze({
      heading: 'Wat deze keuze in de praktijk betekent',
      paragraphs: Object.freeze([
        `${topic} is geen los onderwerp dat je alleen op gevoel moet beoordelen. Voor ondernemers wordt het pas interessant wanneer het helpt om meer aanvragen te krijgen, minder handwerk te doen of sneller de juiste vervolgstap te kiezen. Daarom kijken we bij ${category} altijd naar de combinatie van zoekvraag, klantvraag en bedrijfsproces.`,
        `${clusterContext} Een goed artikel of goede landingspagina moet die samenhang uitleggen zonder te vervallen in vaktaal. De bezoeker moet na het lezen beter weten wat verstandig is, welke valkuilen er zijn en wanneer ${commercialRoute} logisch wordt.`,
      ]),
    }),
    Object.freeze({
      heading: 'Welke signalen maken dit belangrijk',
      paragraphs: Object.freeze([
        `Dit onderwerp wordt meestal belangrijk zodra losse keuzes groei beginnen af te remmen. Denk aan bezoekers die niet converteren, leads die te laat worden opgevolgd, klantinformatie die versnipperd raakt of medewerkers die dezelfde taken steeds opnieuw handmatig uitvoeren.`,
        `Voor zoekintentie ${intent} betekent dat de content niet alleen moet uitleggen wat iets is. De pagina moet ook helpen met beslissen: wat levert het op, wanneer is het te vroeg, welke basis moet eerst staan en welke stap geeft de meeste waarde zonder onnodige complexiteit?`,
      ]),
    }),
    Object.freeze({
      heading: 'Hoe Softora dit benadert',
      paragraphs: Object.freeze([
        `Softora kijkt eerst naar de route van bezoeker, lead of klant. Waar komt iemand binnen, welke informatie mist nog, welke actie moet daarna gebeuren en welk systeem moet dat vasthouden? Pas daarna kiezen we welke pagina, automatisering of softwarelaag nodig is.`,
        `Die aanpak voorkomt dat content alleen maar tekst wordt. Een artikel over ${category} moet linken naar de juiste dienst, een dienstpagina moet vragen wegnemen en een systeem moet de opvolging meetbaar maken. Zo ontstaat stap voor stap een website die niet alleen verkeer aantrekt, maar ook betere aanvragen oplevert.`,
      ]),
    }),
    Object.freeze({
      heading: 'Waar je vooraf helderheid over moet hebben',
      paragraphs: Object.freeze([
        `Voordat je hierin investeert, wil je minimaal drie dingen scherp hebben: wie de ideale klant is, welke vraag die klant in Google intikt en welke actie na het bezoek het meest waardevol is. Zonder die keuzes wordt de pagina breder, maar niet sterker.`,
        `Daarna kijk je naar bewijs en vertrouwen. Denk aan duidelijke voorbeelden, heldere uitleg, realistische fotografie, logische interne links, goede metadata en een contactroute die niet voelt als een drempel. Dat zijn geen losse details; samen bepalen ze of SEO-verkeer ook echt leadwaarde krijgt.`,
      ]),
    }),
    Object.freeze({
      heading: 'Hoe je resultaat meet',
      paragraphs: Object.freeze([
        `Een pagina is pas klaar om op te schalen wanneer je kunt meten wat hij doet. Belangrijke signalen zijn vertoningen, klikken, gemiddelde positie, CTR, scrollgedrag, contactklikken en de kwaliteit van aanvragen die eruit voortkomen. Ook vragen uit gesprekken, offertes en intakeformulieren tellen mee, omdat die laten zien welke informatie bezoekers nog missen voordat ze vertrouwen genoeg hebben om actie te ondernemen.`,
        `Als een pagina veel vertoningen krijgt maar weinig klikken, moet de titel of meta description scherper. Als bezoekers wel komen maar niet aanvragen, moet de inhoud, CTA of interne linkroute beter. Zo groeit content niet willekeurig, maar op basis van echte signalen, duidelijke prioriteiten en meetbare verbeteringen.`,
      ]),
    }),
  ]);
}

function buildSeoContentPerformanceSections(item) {
  const cluster = getSeoContentClusterForItem(item);
  const topic = String(item.title || 'dit onderwerp').trim();
  const collection = String(item.collection || '').trim().toLowerCase();
  const serviceLabel = cluster.ctaLabel || 'de juiste vervolgstap';
  const serviceHref = cluster.ctaHref || cluster.href || '/diensten';
  const commercialContext = {
    blog:
      'Een goed blogartikel moet meer doen dan uitleg geven. Het moet een vraag afvangen, vertrouwen opbouwen en daarna natuurlijk doorverwijzen naar een dienstpagina waar de bezoeker verder kan.',
    kennisbank:
      'Een kennisbankpagina mag korter en praktischer zijn dan een blog, maar moet nog steeds genoeg context geven om een ondernemer te helpen beslissen of het onderwerp relevant is.',
    vergelijkingen:
      'Een vergelijkingspagina heeft extra koopintentie. De bezoeker twijfelt vaak tussen twee routes en wil vooral weten welke keuze in zijn situatie verstandiger is.',
    branches:
      'Een branchepagina moet concreet voelen. Algemene SEO-tekst is niet genoeg; de voorbeelden moeten aansluiten op de manier waarop die ondernemers leads, klanten en opvolging organiseren.',
    regio:
      'Een regiopagina moet lokale relevantie combineren met echte dienstwaarde. Alleen een plaatsnaam toevoegen is dun; de pagina moet uitleggen welke digitale stap voor bedrijven in die regio logisch is.',
  }[collection] || 'Een sterke pagina moet zoekintentie, vertrouwen en vervolgstap in balans brengen.';
  const serviceContext = {
    websites:
      'Voor websitegroei betekent dit dat structuur, copy, snelheid, interne links en aanvraagmomenten samen moeten werken. Een mooie pagina zonder duidelijke route naar contact blijft onder zijn waarde.',
    'ai-automatisering':
      'Voor AI automatisering betekent dit dat de flow vooraf helder moet zijn: welke input komt binnen, welke samenvatting of kwalificatie mag AI maken en waar blijft menselijke controle nodig?',
    'software-crm':
      'Voor software en CRM betekent dit dat de pagina moet laten zien welke informatie vastgelegd wordt, wie ermee werkt en hoe taken, offertes of klantmomenten daarna minder versnipperd worden.',
    'ai-contact':
      'Voor AI klantcontact betekent dit dat bereikbaarheid, antwoordkwaliteit en overdracht naar WhatsApp, CRM of een mens duidelijk moeten zijn. Juist die grenzen maken de oplossing betrouwbaar.',
    branches:
      'Voor branchepagina’s betekent dit dat voorbeelden herkenbaar moeten zijn: aanvragen, planning, offertes, klantvragen en opvolging verschillen per sector en verdienen dus concrete taal.',
    lokaal:
      'Voor lokale SEO betekent dit dat de pagina niet alleen “in de buurt” moet zeggen, maar ook moet laten zien welke website-, software- of AI-route voor ondernemers in die regio waardevol is.',
  }[cluster.key] || 'Voor digitale groei betekent dit dat de pagina moet helpen kiezen, vertrouwen wekken en doorsturen naar een logische actie.';

  return Object.freeze([
    Object.freeze({
      heading: 'Welke fouten je beter voorkomt',
      paragraphs: Object.freeze([
        `Bij ${topic} gaat het vaak mis wanneer een pagina alleen vanuit de aanbieder is geschreven. Dan staat er veel over functies, techniek of algemene voordelen, maar weinig over de vraag van de bezoeker. Voor SEO is dat zwak, omdat Google en bezoekers willen begrijpen welk probleem wordt opgelost en welke vervolgstap logisch is.`,
        `Een tweede fout is te snel naar tools of losse oplossingen springen. ${serviceContext} Daarom moet de uitleg steeds terug naar het proces: wat gebeurt er voor de aanvraag, wat gebeurt er erna en wie moet welke informatie kunnen gebruiken?`,
      ]),
    }),
    Object.freeze({
      heading: 'Welke content en interne links erbij horen',
      paragraphs: Object.freeze([
        `${commercialContext} Daarom hoort deze pagina niet los te zweven. Hij moet linken naar ondersteunende uitleg, vergelijkingen of voorbeelden, maar ook terug naar ${serviceLabel} wanneer de bezoeker klaar is om concreter te worden.`,
        `Andersom moet de commerciële pagina op ${serviceHref} dit onderwerp ook ondersteunen. Die combinatie maakt de site sterker: informatieve content vangt vragen af, money pages dragen de aanvraag en interne links laten Google zien welke pagina’s binnen Softora het belangrijkst zijn.`,
      ]),
    }),
    Object.freeze({
      heading: 'Welke informatie een bezoeker nodig heeft',
      paragraphs: Object.freeze([
        `Een bezoeker wil meestal vier dingen weten: wat betekent dit precies, wanneer is het relevant, wat zijn de risico’s of beperkingen en welke stap is verstandig als hij verder wil. Als een artikel die vragen niet beantwoordt, voelt het snel als dunne SEO-content.`,
        `Daarom moet ${topic} altijd praktisch blijven. Gebruik duidelijke taal, concrete situaties, realistische verwachtingen en een contactroute die logisch voelt. Geen garanties, geen loze claims en geen tekst die alleen voor zoekmachines geschreven is.`,
      ]),
    }),
    Object.freeze({
      heading: 'Hoe je dit blijft verbeteren na publicatie',
      paragraphs: Object.freeze([
        `Publiceren is pas het begin. Na indexatie kijk je naar vertoningen, zoekopdrachten, CTR, positie en het gedrag op de pagina. Als Google de pagina toont maar mensen niet klikken, moeten titel en meta description scherper. Als mensen wel klikken maar niet doorgaan, moet de inhoud, interne link of CTA beter.`,
        `Die verbeterloop is belangrijker dan in één keer perfect willen zijn. Softora kan pagina’s blijven aanscherpen op basis van echte GSC-data, klantvragen en leadkwaliteit. Zo groeit de contentlaag niet als losse stapel artikelen, maar als een systeem dat steeds beter verkeer en aanvragen ondersteunt.`,
      ]),
    }),
    Object.freeze({
      heading: 'Welke eerste stap meestal het meeste oplevert',
      paragraphs: Object.freeze([
        `De beste eerste stap is meestal niet de grootste stap, maar de stap die het snelst duidelijkheid geeft. Bij ${topic} betekent dat: kies één concrete route, maak de informatie volledig genoeg om vertrouwen te winnen en koppel de pagina aan een meetbare actie. Zo kun je zien of bezoekers begrijpen wat je aanbiedt en of ze doorklikken naar de juiste vervolgstap.`,
        `Daarna wordt opschalen veel veiliger. Je kunt extra artikelen, kennisbankvragen, vergelijkingen of lokale pagina’s toevoegen zonder dat de site rommelig wordt. Elke nieuwe publicatie moet dan een duidelijke taak hebben: een vraag beantwoorden, een bezwaar wegnemen, een money page versterken of een betere lead naar WhatsApp of een intakeflow brengen.`,
        `Als die taak niet scherp is, publiceren we liever niet. Dat klinkt streng, maar het houdt de contentstrategie gezond: minder losse pagina’s, meer inhoud die echt helpt, en meer kans dat nieuwe vertoningen uiteindelijk verkeer en betere aanvragen voor Softora worden in de praktijk.`,
      ]),
    }),
  ]);
}

function buildSeoContentFaqTopic(item) {
  const title = String(item && item.title ? item.title : '').trim();
  if (!title) return 'dit onderwerp';
  return title
    .replace(/[?!]+$/g, '')
    .replace(/^Wat is\s+/i, '')
    .replace(/^Wat zijn\s+/i, '')
    .replace(/:\s*waar begin je$/i, '')
    .replace(/:\s*waar let je op$/i, '')
    .replace(/:\s*wat kies je$/i, '')
    .replace(/:\s*wanneer is het slimmer$/i, '')
    .trim() || 'dit onderwerp';
}

function buildSeoContentFaq(item) {
  const topic = buildSeoContentFaqTopic(item);
  const cluster = getSeoContentClusterForItem(item);
  const serviceLabel = cluster.ctaLabel || 'een passende oplossing';
  return Object.freeze([
    Object.freeze({
      question: `Wanneer is ${topic} interessant voor mijn bedrijf?`,
      answer:
        'Het wordt interessant wanneer het onderwerp direct invloed heeft op vindbaarheid, opvolging, tijdwinst of betere aanvragen. Als je merkt dat bezoekers afhaken, processen blijven liggen of keuzes onduidelijk zijn, is dit vaak een logische plek om te verbeteren.',
    }),
    Object.freeze({
      question: 'Moet ik hiermee meteen groot starten?',
      answer:
        'Nee. De sterkste aanpak is meestal klein maar scherp beginnen: een duidelijke pagina, een meetbare flow of een beperkte automatisering die direct waarde bewijst. Daarna kun je veilig uitbreiden zonder dat de site of het proces rommelig wordt.',
    }),
    Object.freeze({
      question: `Hoe hangt dit samen met ${serviceLabel}?`,
      answer:
        'De content helpt bezoekers begrijpen wat verstandig is, terwijl de dienstpagina de commerciële vervolgstap draagt. Door die twee logisch aan elkaar te koppelen, krijgt Google meer context en krijgt de bezoeker een duidelijker pad naar contact.',
    }),
    Object.freeze({
      question: 'Hoe weet ik of de pagina goed genoeg is?',
      answer:
        'Kijk naar zoekdata, klikgedrag, aanvragen en de inhoud zelf. Een goede pagina heeft een duidelijke zoekintentie, genoeg diepgang, echte interne links, een sterke CTA, betrouwbare uitleg, goede afbeeldingen en geen tekst die alleen voor zoekmachines geschreven voelt.',
    }),
  ]);
}

function getSeoContentPublicationDayMs(valueRaw) {
  const value = String(valueRaw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function isSeoContentRelatedLinkAvailable(link, nowMs) {
  const availableFrom = String(link && link.availableFrom ? link.availableFrom : '').trim();
  if (!availableFrom) return true;
  const availableMs = getSeoContentPublicationDayMs(availableFrom);
  return Number.isFinite(availableMs) && availableMs <= nowMs;
}

function filterSeoContentRelatedLinks(linksRaw, nowMs) {
  const links = Array.isArray(linksRaw) ? linksRaw : [];
  return Object.freeze(links.filter((link) => isSeoContentRelatedLinkAvailable(link, nowMs)));
}

function enrichSeoContentItem(item, { nowMs = Date.now() } = {}) {
  if (!item) return item;
  const sections = Object.freeze([
    ...(item.sections || []),
    ...buildSeoContentDepthSections(item),
    ...buildSeoContentPerformanceSections(item),
  ]);
  const faq = item.faq ? Object.freeze([...(item.faq || [])]) : buildSeoContentFaq(item);
  const base = Object.freeze({
    ...item,
    author: item.author || SEO_CONTENT_AUTHOR,
    reviewedBy: item.reviewedBy || SEO_CONTENT_REVIEWER,
    relatedLinks: filterSeoContentRelatedLinks(item.relatedLinks, nowMs),
    sections,
    faq,
  });
  const wordCount = countSeoContentWords(base);
  return Object.freeze({
    ...base,
    minWordCount: getSeoContentMinimumWordCount(base),
    readTime: formatSeoReadTime(wordCount),
    wordCount,
  });
}

function getSeoContentItems({ collection, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return SEO_CONTENT_ITEMS.filter((item) => {
    if (collection && item.collection !== collection) return false;
    const publishedMs = getSeoContentPublicationDayMs(item.publishedAt);
    return Number.isFinite(publishedMs) && publishedMs <= nowMs;
  }).map((item) => enrichSeoContentItem(item, { nowMs }));
}

function getSeoContentItem(collectionRaw, slugRaw, options = {}) {
  const collection = String(collectionRaw || '').trim().toLowerCase();
  const slug = String(slugRaw || '').trim().toLowerCase();
  if (!collection || !slug) return null;
  return getSeoContentItems({ collection, now: options.now }).find((item) => item.slug === slug) || null;
}

function getSeoContentPathForItem(item) {
  const collection = getSeoContentCollection(item && item.collection);
  if (!collection || !item || !item.slug) return '';
  return `${collection.path}/${item.slug}`;
}

function getSeoContentPublicPaths(options = {}) {
  const collectionPaths = getSeoContentCollectionPaths();
  const itemPaths = getSeoContentItems(options).map(getSeoContentPathForItem).filter(Boolean);
  return [...collectionPaths, ...itemPaths, '/premium-blog'];
}

function getSeoContentSitemapEntries(options = {}) {
  const collectionEntries = Object.values(SEO_CONTENT_COLLECTIONS).map((collection) => ({
    path: collection.path,
  }));
  const itemEntries = getSeoContentItems(options).map((item) => ({
    path: getSeoContentPathForItem(item),
    lastmod: item.updatedAt || item.publishedAt,
  }));
  return [...collectionEntries, ...itemEntries].filter((entry) => entry.path);
}

function getSeoContentPublicationPlan({ now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return SEO_CONTENT_ITEMS.map((item) => {
    const publishedMs = getSeoContentPublicationDayMs(item.publishedAt);
    return {
      collection: item.collection,
      slug: item.slug,
      path: getSeoContentPathForItem(item),
      title: item.title,
      cluster: getSeoContentClusterForItem(item).key,
      publishedAt: item.publishedAt,
      status: Number.isFinite(publishedMs) && publishedMs <= nowMs ? 'live' : 'scheduled',
    };
  }).sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)) || a.slug.localeCompare(b.slug));
}

function buildBaseHead({ title, description, canonicalUrl, ogType = 'website', structuredData, imagePath }) {
  const imageUrl = buildAbsoluteUrl(canonicalUrl, imagePath || DEFAULT_OG_IMAGE_PATH);
  return [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    '<meta name="robots" content="index, follow">',
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    '<link rel="icon" type="image/png" href="/assets/softora-favicon-round.png?v=20260606b" sizes="any">',
    '<link rel="stylesheet" href="/assets/fonts.css?v=20260409a">',
    '<link rel="stylesheet" href="/assets/seo-content.css?v=20260527a">',
    `<meta property="og:type" content="${escapeHtml(ogType)}">`,
    '<meta property="og:site_name" content="Softora">',
    '<meta property="og:locale" content="nl_NL">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
    `<script type="application/ld+json" data-softora-public-seo="structured-data">${escapeHtmlJson(
      structuredData
    )}</script>`,
  ].join('\n    ');
}

function buildOrganizationGraph(siteOrigin) {
  return [
    {
      '@type': 'Organization',
      '@id': `${siteOrigin}/#organization`,
      name: 'Softora',
      url: `${siteOrigin}/`,
      logo: buildAbsoluteUrl(siteOrigin, DEFAULT_LOGO_PATH),
      email: SOFTORA_PUBLIC_EMAIL,
      telephone: SOFTORA_PUBLIC_PHONE,
      address: {
        '@type': 'PostalAddress',
        addressLocality: SOFTORA_LOCALITY,
        addressRegion: SOFTORA_REGION,
        addressCountry: 'NL',
      },
      areaServed: [
        { '@type': 'AdministrativeArea', name: SOFTORA_LOCALITY },
        { '@type': 'AdministrativeArea', name: 'Tilburg' },
        { '@type': 'AdministrativeArea', name: 'Midden-Brabant' },
        { '@type': 'Country', name: 'Nederland' },
      ],
      contactPoint: {
        '@type': 'ContactPoint',
        telephone: SOFTORA_PUBLIC_PHONE,
        email: SOFTORA_PUBLIC_EMAIL,
        contactType: 'sales',
        areaServed: 'NL',
        availableLanguage: ['nl'],
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${siteOrigin}/#website`,
      url: `${siteOrigin}/`,
      name: 'Softora',
      inLanguage: 'nl-NL',
      publisher: { '@id': `${siteOrigin}/#organization` },
    },
  ];
}

function buildBreadcrumbItems(siteOrigin, entries) {
  return entries.map((entry, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: entry.name,
    item: buildAbsoluteUrl(siteOrigin, entry.path),
  }));
}

function buildContentShell({ title, description, canonicalUrl, structuredData, body, ogType = 'website', imagePath }) {
  return [
    '<!DOCTYPE html>',
    '<html lang="nl">',
    '<head>',
    `    ${buildBaseHead({ title, description, canonicalUrl, structuredData, ogType, imagePath })}`,
    '</head>',
    '<body>',
    '  <nav>',
    '    <a class="nav-logo" href="/" aria-label="Softora homepage">SOFTORA.NL</a>',
    '    <div class="nav-links" aria-label="Content navigatie">',
    '      <a href="/diensten">Diensten</a>',
    '      <a href="/pakketten">Pakketten</a>',
    '      <a href="/website-laten-maken">Websites</a>',
    '      <a href="/ai-automatisering">AI</a>',
    '      <a href="/bedrijfssoftware-op-maat">Software</a>',
    '      <a href="/blog">Blog</a>',
    '      <a href="/kennisbank">Kennisbank</a>',
    '      <a href="/vergelijkingen">Vergelijkingen</a>',
    '      <a href="/branches">Branches</a>',
    '      <a href="/regio">Regio</a>',
    '    </div>',
    '  </nav>',
    '  <div class="seo-shell">',
    body,
    '  </div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function renderRelatedLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  return [
    '<section class="meer-wrap" aria-label="Verder lezen">',
    '  <div class="meer-label">Verder lezen</div>',
    '  <div class="meer-grid">',
    ...links.map(
      (link) => `    <a class="blog-card compact-card" href="${escapeHtml(link.href)}"><span>${escapeHtml(link.label)}</span></a>`
    ),
    '  </div>',
    '</section>',
  ].join('\n');
}

function resolvePrimaryCtaLink(item) {
  const commercialTargets = new Set([
    '/website-laten-maken',
    '/ai-automatisering',
    '/bedrijfssoftware-op-maat',
    '/crm-systeem-op-maat',
    '/chatbot-laten-maken',
    '/ai-telefonist',
    '/voicesoftware-op-maat',
    '/diensten',
  ]);
  const relatedLinks = Array.isArray(item && item.relatedLinks) ? item.relatedLinks : [];
  const cluster = getSeoContentClusterForItem(item);
  return relatedLinks.find((link) => commercialTargets.has(String(link.href || ''))) || {
    label: cluster.ctaLabel || 'Bekijk wat Softora kan bouwen',
    href: cluster.ctaHref || '/diensten',
  };
}

function renderConversionCta(item) {
  const primary = resolvePrimaryCtaLink(item);
  const contentPath = getSeoContentPathForItem(item);
  return [
    '<section class="content-cta" data-softora-public-seo="conversion-cta">',
    '  <div>',
    '    <div class="meer-label">Volgende stap</div>',
    '    <h2>Wil je dit toepassen op jouw bedrijf?</h2>',
    '    <p>Gebruik deze pagina als richting, maar laat de keuze afhangen van je echte proces, doelen en leadflow.</p>',
    '  </div>',
    '  <div class="content-cta-actions">',
    `    <a class="content-cta-primary" href="${escapeHtml(primary.href)}" data-softora-conversion="content-primary" data-softora-conversion-page="${escapeHtml(contentPath)}" data-softora-conversion-target="service">${escapeHtml(primary.label)}</a>`,
    `    <a class="content-cta-secondary" href="https://wa.me/31643262792" target="_blank" rel="noopener noreferrer" data-softora-conversion="content-contact" data-softora-conversion-page="${escapeHtml(contentPath)}" data-softora-conversion-target="whatsapp">Contact</a>`,
    '  </div>',
    '</section>',
  ].join('\n');
}

function renderPillarCards() {
  return [
    '<section class="pillar-wrap" aria-label="SEO groeipijlers">',
    '  <div class="pillar-heading-row">',
    '    <div>',
    '      <div class="meer-label">SEO groeipijlers</div>',
    '      <h2>De onderwerpen waar Softora autoriteit op bouwt</h2>',
    '    </div>',
    '    <a href="/diensten">Alle diensten</a>',
    '  </div>',
    '  <div class="pillar-grid">',
    ...SEO_CONTENT_PILLARS.map(
      (pillar) =>
        `    <a class="pillar-card" href="${escapeHtml(pillar.href)}"><span>${escapeHtml(pillar.category)}</span><strong>${escapeHtml(
          pillar.title
        )}</strong><em>${escapeHtml(pillar.description)}</em></a>`
    ),
    '  </div>',
    '</section>',
  ].join('\n');
}

function renderContentClusterNav() {
  return [
    '<section class="cluster-nav" data-softora-public-seo="content-clusters" aria-label="Content clusters">',
    ...SEO_CONTENT_CLUSTERS.map(
      (cluster) =>
        `    <a class="cluster-link" data-content-cluster="${escapeHtml(cluster.key)}" href="${escapeHtml(
          cluster.href
        )}"><span>${escapeHtml(cluster.label)}</span><em>${escapeHtml(cluster.description)}</em></a>`
    ),
    '</section>',
  ].join('\n');
}

function getBackLabelForCollection(collection) {
  if (!collection) return 'overzicht';
  if (collection.key === 'blog') return 'blog';
  if (collection.key === 'kennisbank') return 'kennisbank';
  if (collection.key === 'vergelijkingen') return 'vergelijkingen';
  if (collection.key === 'branches') return 'branches';
  if (collection.key === 'regio') return 'regio';
  return 'overzicht';
}

function buildPersonSchema(person, site) {
  if (!person || !person.name) return undefined;
  return {
    '@type': 'Person',
    name: person.name,
    jobTitle: person.role,
    url: buildAbsoluteUrl(site, person.href || '/over-softora'),
    worksFor: { '@id': `${site}/#organization` },
  };
}

function buildMainEntityForItem(item, site, canonicalUrl) {
  const cluster = getSeoContentClusterForItem(item);
  const image = getSeoContentImageForItem(item);
  const imageUrl = buildAbsoluteUrl(site, image.src);
  if (item.schemaType === 'Service') {
    const entity = {
      '@type': 'Service',
      '@id': `${canonicalUrl}#service`,
      name: item.title,
      description: item.description,
      provider: { '@id': `${site}/#organization` },
      serviceType: item.serviceType || cluster.label || item.category,
      image: imageUrl,
      about: {
        '@type': 'Thing',
        name: cluster.label,
        url: buildAbsoluteUrl(site, cluster.href),
      },
    };
    if (item.areaServed) {
      entity.areaServed = {
        '@type': 'AdministrativeArea',
        name: item.areaServed,
      };
    }
    return entity;
  }

  return {
    '@type': 'Article',
    '@id': `${canonicalUrl}#article`,
    headline: item.title,
    description: item.description,
    articleSection: cluster.label,
    image: [imageUrl],
    wordCount: Number(item.wordCount) || countSeoContentWords(item),
    about: {
      '@type': 'Thing',
      name: cluster.label,
      url: buildAbsoluteUrl(site, cluster.href),
    },
    datePublished: item.publishedAt,
    dateModified: item.updatedAt || item.publishedAt,
    inLanguage: 'nl-NL',
    author: buildPersonSchema(item.author || SEO_CONTENT_AUTHOR, site),
    reviewedBy: buildPersonSchema(item.reviewedBy || SEO_CONTENT_REVIEWER, site),
    publisher: { '@id': `${site}/#organization` },
    mainEntityOfPage: { '@id': `${canonicalUrl}#webpage` },
  };
}

function renderArticleCards(items) {
  return items
    .map((item, index) => {
      const href = getSeoContentPathForItem(item);
      const featured = index === 0;
      const cluster = getSeoContentClusterForItem(item);
      const image = getSeoContentImageForItem(item);
      const imageLoading = featured ? 'eager' : 'lazy';
      const imagePriority = featured ? 'high' : 'low';
      const imageDimensions =
        Number(image.width) > 0 && Number(image.height) > 0
          ? ` width="${Number(image.width)}" height="${Number(image.height)}"`
          : '';
      return [
        `<article class="blog-card${featured ? ' featured' : ''}" data-content-cluster="${escapeHtml(cluster.key)}">`,
        `  <a href="${escapeHtml(href)}">`,
        `    <div class="blog-card-img${featured ? ' featured' : ''}">`,
        `      <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"${imageDimensions} loading="${imageLoading}" decoding="async" fetchpriority="${imagePriority}">`,
        `      <div class="blog-card-img-label">${escapeHtml(item.category)}</div>`,
        '    </div>',
        '    <div class="blog-card-body">',
        `      <div class="blog-card-cluster">${escapeHtml(cluster.label)}</div>`,
        `      <div class="blog-card-cat">${escapeHtml(item.category)}</div>`,
        `      <div class="blog-card-title">${escapeHtml(item.title)}</div>`,
        `      <div class="blog-card-excerpt">${escapeHtml(item.description)}</div>`,
        '      <div class="blog-card-meta">',
        `        <div class="blog-card-date">${escapeHtml(item.publishedAt)}</div>`,
        '        <div class="blog-card-dot"></div>',
        `        <div class="blog-card-read">${escapeHtml(item.readTime)}</div>`,
        '      </div>',
        '    </div>',
        '  </a>',
        '</article>',
      ].join('\n');
    })
    .join('\n');
}

function buildSeoContentIndexHtml(collectionRaw, { siteOrigin = DEFAULT_SITE_ORIGIN, now } = {}) {
  const collection = getSeoContentCollection(collectionRaw);
  if (!collection) return '';
  const site = normalizeSiteOrigin(siteOrigin);
  const canonicalUrl = buildAbsoluteUrl(site, collection.path);
  const items = getSeoContentItems({ collection: collection.key, now });
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      ...buildOrganizationGraph(site),
      {
        '@type': 'CollectionPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: collection.title,
        description: collection.description,
        inLanguage: 'nl-NL',
        isPartOf: { '@id': `${site}/#website` },
      },
      {
        '@type': 'ItemList',
        '@id': `${canonicalUrl}#itemlist`,
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: buildAbsoluteUrl(site, getSeoContentPathForItem(item)),
          name: item.title,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: buildBreadcrumbItems(site, [
          { name: 'Home', path: '/' },
          { name: collection.title, path: collection.path },
        ]),
      },
    ],
  };
  const body = [
    '<main class="screen active" id="screen-overzicht">',
    '  <section class="hero-banner">',
    '    <div class="hero-content">',
    `      <div class="hero-eyebrow">${escapeHtml(collection.eyebrow)}</div>`,
    `      <h1 class="hero-title">${escapeHtml(collection.heading)}</h1>`,
    `      <p class="hero-sub">${escapeHtml(collection.intro)}</p>`,
    '    </div>',
    '  </section>',
    '  <div class="filter-bar" aria-label="Content onderdelen">',
    `    <a class="filter-tab${collection.key === 'blog' ? ' active' : ''}" href="/blog">Blog</a>`,
    `    <a class="filter-tab${collection.key === 'kennisbank' ? ' active' : ''}" href="/kennisbank">Kennisbank</a>`,
    `    <a class="filter-tab${collection.key === 'vergelijkingen' ? ' active' : ''}" href="/vergelijkingen">Vergelijkingen</a>`,
    `    <a class="filter-tab${collection.key === 'branches' ? ' active' : ''}" href="/branches">Branches</a>`,
    `    <a class="filter-tab${collection.key === 'regio' ? ' active' : ''}" href="/regio">Regio</a>`,
    '    <a class="filter-tab" href="/website-laten-maken">Websites</a>',
    '    <a class="filter-tab" href="/bedrijfssoftware-op-maat">Software</a>',
    '  </div>',
    renderContentClusterNav(),
    '  <section class="blog-grid-wrap">',
    `    <div class="blog-grid">${renderArticleCards(items)}</div>`,
    '  </section>',
    renderPillarCards(),
    renderRelatedLinks([
      { label: 'Website laten maken', href: '/website-laten-maken' },
      { label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' },
      { label: 'Bekijk vergelijkingen', href: '/vergelijkingen' },
      { label: 'Bekijk branches', href: '/branches' },
      { label: 'Bekijk regio', href: '/regio' },
      { label: collection.key === 'blog' ? 'Bekijk de kennisbank' : 'Bekijk de blog', href: collection.key === 'blog' ? '/kennisbank' : '/blog' },
    ]),
    '</main>',
  ].join('\n');

  return buildContentShell({
    title: collection.title,
    description: collection.description,
    canonicalUrl,
    structuredData,
    body,
  });
}

function renderAuthorityBlock(item) {
  const author = item.author || SEO_CONTENT_AUTHOR;
  const reviewer = item.reviewedBy || SEO_CONTENT_REVIEWER;
  return [
    '    <section class="artikel-eeat" data-softora-public-seo="eeat">',
    '      <div>',
    '        <span>Praktijkbasis</span>',
    '        <p>Deze uitleg is geschreven vanuit Softora-werk aan websites, CRM, AI automatisering, klantcontact en digitale opvolging voor ondernemers.</p>',
    '      </div>',
    '      <div>',
    '        <span>Auteur en controle</span>',
    `        <p>Geschreven en inhoudelijk gecontroleerd door ${escapeHtml(
      reviewer.name || author.name
    )}. We verbeteren deze pagina op basis van zoekdata, klantvragen en wat in echte trajecten duidelijker moet.</p>`,
    '      </div>',
    '      <div>',
    '        <span>Waarom dit helpt</span>',
    `        <p>Het doel is niet om tekst te vullen, maar om bezoekers beter te laten kiezen en de stap naar ${escapeHtml(
      getSeoContentClusterForItem(item).ctaLabel || 'contact'
    )} logisch te maken.</p>`,
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderFaqBlock(item) {
  const faq = Array.isArray(item.faq) ? item.faq : [];
  if (faq.length === 0) return '';
  return [
    '    <section class="artikel-faq" data-softora-public-seo="faq">',
    '      <h2>Veelgestelde vragen</h2>',
    ...faq.map((entry) =>
      [
        '      <div class="artikel-faq-item">',
        `        <h3>${escapeHtml(entry.question)}</h3>`,
        `        <p>${escapeHtml(entry.answer)}</p>`,
        '      </div>',
      ].join('\n')
    ),
    '    </section>',
  ].join('\n');
}

function buildSeoContentArticleHtml(item, { siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  if (!item) return '';
  const collection = getSeoContentCollection(item.collection);
  if (!collection) return '';
  const site = normalizeSiteOrigin(siteOrigin);
  const pathName = getSeoContentPathForItem(item);
  const canonicalUrl = buildAbsoluteUrl(site, pathName);
  const mainEntity = buildMainEntityForItem(item, site, canonicalUrl);
  const cluster = getSeoContentClusterForItem(item);
  const image = getSeoContentImageForItem(item);
  const imageDimensions =
    Number(image.width) > 0 && Number(image.height) > 0
      ? ` width="${Number(image.width)}" height="${Number(image.height)}"`
      : '';
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      ...buildOrganizationGraph(site),
      mainEntity,
      {
        '@type': 'WebPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: item.title,
        description: item.description,
        isPartOf: { '@id': `${site}/#website` },
        mainEntity: { '@id': mainEntity['@id'] },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: buildBreadcrumbItems(site, [
          { name: 'Home', path: '/' },
          { name: collection.title, path: collection.path },
          { name: item.title, path: pathName },
        ]),
      },
      ...(Array.isArray(item.faq) && item.faq.length > 0
        ? [
            {
              '@type': 'FAQPage',
              '@id': `${canonicalUrl}#faq`,
              mainEntity: item.faq.map((entry) => ({
                '@type': 'Question',
                name: entry.question,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: entry.answer,
                },
              })),
            },
          ]
        : []),
    ],
  };
  const body = [
    '<main class="screen active" id="screen-artikel">',
    '  <section class="artikel-hero">',
    `    <a class="nav-back show inline-back" href="${escapeHtml(collection.path)}">Terug naar ${escapeHtml(getBackLabelForCollection(collection))}</a>`,
    `    <a class="artikel-cluster" data-content-cluster="${escapeHtml(cluster.key)}" href="${escapeHtml(cluster.href)}">${escapeHtml(
      cluster.label
    )}</a>`,
    `    <div class="artikel-cat">${escapeHtml(item.category)}</div>`,
    `    <h1 class="artikel-title">${escapeHtml(item.title)}</h1>`,
    '    <div class="artikel-meta">',
    `      <span>${escapeHtml(item.publishedAt)}</span>`,
    '      <div class="artikel-meta-dot"></div>',
    `      <span>${escapeHtml(item.readTime)}</span>`,
    '      <div class="artikel-meta-dot"></div>',
    `      <span>${escapeHtml((item.author || SEO_CONTENT_AUTHOR).name)}</span>`,
    '    </div>',
    '  </section>',
    '  <figure class="artikel-img">',
    `    <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"${imageDimensions} loading="eager" decoding="async" fetchpriority="high">`,
    `    <figcaption>${escapeHtml(item.title)}</figcaption>`,
    '  </figure>',
    '  <article class="artikel-body">',
    `    <p><strong>${escapeHtml(item.summary)}</strong></p>`,
    renderAuthorityBlock(item),
    ...item.sections.map((section) =>
      [
        `    <h2>${escapeHtml(section.heading)}</h2>`,
        ...section.paragraphs.map((paragraph) => `    <p>${escapeHtml(paragraph)}</p>`),
      ].join('\n')
    ),
    renderFaqBlock(item),
    '  </article>',
    renderConversionCta(item),
    renderRelatedLinks(item.relatedLinks),
    '</main>',
  ].join('\n');

  return buildContentShell({
    title: `${item.title} | Softora`,
    description: item.description,
    canonicalUrl,
    structuredData,
    body,
    ogType: item.schemaType === 'Service' ? 'website' : 'article',
    imagePath: image.src,
  });
}

module.exports = {
  SEO_CONTENT_CLUSTERS,
  SEO_CONTENT_COLLECTIONS,
  SEO_CONTENT_AUTHOR,
  SEO_CONTENT_IMAGES_BY_CLUSTER,
  SEO_CONTENT_ITEMS,
  SEO_CONTENT_MIN_WORDS_BY_COLLECTION,
  SEO_CONTENT_PILLARS,
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  countSeoContentWords,
  getSeoContentClusterForItem,
  getSeoContentClusters,
  getSeoContentCollection,
  getSeoContentCollectionPaths,
  getSeoContentImageForItem,
  getSeoContentItem,
  getSeoContentItems,
  getSeoContentMinimumWordCount,
  getSeoContentPathForItem,
  getSeoContentPillars,
  getSeoContentPublicationPlan,
  getSeoContentPublicPaths,
  getSeoContentSitemapEntries,
};
