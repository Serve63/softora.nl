const CHATBOT_KOSTEN_CONTENT_ITEM = Object.freeze({
  collection: 'blog',
  slug: 'chatbot-kosten-mkb',
  title: 'Wat kost een chatbot laten maken?',
  description:
    'Bepaal een realistisch chatbotbudget op basis van doel, kennis, gespreksroutes, koppelingen, menselijke overdracht, testen en doorlopend beheer.',
  category: 'Chatbots',
  intent: 'Koopintentie',
  qualityVersion: 2,
  primaryIntent: 'Kosten en scope van een zakelijke chatbot laten maken',
  buyerTask: 'Een eerste chatbotscope afbakenen en voorstellen op dezelfde werkzaamheden vergelijken',
  funnelStage: 'decision',
  targetMoneyPage: '/chatbot-laten-maken',
  uniqueClusterRole:
    'Kosten- en scopegids voor chatbotkopers, los van orientatie, chatbot-versus-livechat, CRM-opvolging en de definitie van menselijke overdracht.',
  informationGain:
    'Een controleerbaar kostenmodel dat drie chatbotscopes vertaalt naar kenniswerk, gespreksontwerp, koppelingen, acceptatie, menselijke overdracht en beheer zonder geleende prijsrange of ROI-belofte.',
  sources: Object.freeze([
    Object.freeze({
      title: 'AICG: Wat kost een maatwerk AI-chatbot voor het MKB?',
      url: 'https://aicg.nl/kosten-maatwerk-ai-chatbot-mkb/',
      observedAt: '2026-08-04',
    }),
    Object.freeze({
      title: 'do-IT: Kosten chatbot laten maken',
      url: 'https://doitdigital.nl/kosten/chatbot-laten-maken',
      observedAt: '2026-08-04',
    }),
    Object.freeze({
      title: 'Searchlab: Wat kost een AI-chatbot?',
      url: 'https://searchlab.nl/kosten/wat-kost-een-ai-chatbot',
      observedAt: '2026-08-04',
    }),
    Object.freeze({
      title: 'Intercom: Pricing FAQs',
      url: 'https://www.intercom.com/help/en/articles/8344190-pricing-faqs',
      observedAt: '2026-08-04',
    }),
    Object.freeze({
      title: 'Autoriteit Persoonsgegevens en ACM: Laat de mens bereikbaar blijven',
      url: 'https://www.autoriteitpersoonsgegevens.nl/system/files?file=2025-10%2FOproep+ACM+en+AP+AI-chatbots.pdf',
      observedAt: '2026-08-04',
    }),
  ]),
  publishedAt: '2026-08-04',
  updatedAt: '2026-08-04',
  image: Object.freeze({
    src: '/assets/seo-content/chatbot-kosten-kostenlagen-softora.jpg',
    alt: 'Kostenlagen van een zakelijke chatbot met interface, kennisbronnen, tests, koppelingen, menselijke overdracht en monitoring.',
    width: 1600,
    height: 1000,
  }),
  secondaryImage: Object.freeze({
    src: '/assets/seo-content/chatbot-kosten-scopevergelijking-softora.jpg',
    alt: 'Vergelijking van een FAQ-chatbot, intakechatbot en gekoppelde assistent met oplopende scope en menselijke controle.',
    width: 1600,
    height: 1000,
    caption:
      'De juiste begroting begint bij het kleinste chatbotsysteem dat de gekozen klanttaak betrouwbaar kan uitvoeren en overdragen.',
  }),
  summary:
    'Een chatbot heeft geen eerlijke standaardprijs. Het budget wordt pas vergelijkbaar wanneer doel, kennis, routes, koppelingen, uitzonderingen, menselijke overdracht, acceptatie en beheer op dezelfde scope staan.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: de gekozen klanttaak bepaalt de kosten',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een chatbot kan alleen veelgestelde vragen beantwoorden, maar ook een intake uitvoeren, gegevens controleren, een afspraak voorbereiden en een samenvatting naar CRM sturen. Dat zijn verschillende opdrachten. Een bedrag zonder de beoogde klanttaak zegt daarom weinig. Begin bij de concrete chatbot die je wilt laten maken: welke bezoeker krijgt hulp, welke uitkomst moet het gesprek hebben en wanneer neemt een medewerker over?',
          links: Object.freeze([
            Object.freeze({ anchor: 'chatbot die je wilt laten maken', href: '/chatbot-laten-maken' }),
          ]),
        }),
        'Nederlandse kostenpagina\'s die op 4 augustus 2026 zichtbaar waren, verdelen het budget vrijwel allemaal over inrichting, kennis, integraties en doorlopend gebruik. Hun bedragen lopen sterk uiteen doordat definities en aannames verschillen. Deze gids neemt daarom geen externe prijsrange over. Je krijgt een model waarmee een bureau per onderdeel kan uitleggen welk werk nodig is, welke onzekerheid nog onderzocht wordt en wat bewust buiten de eerste versie blijft.',
      ]),
    }),
    Object.freeze({
      heading: 'Kies eerst tussen drie duidelijk verschillende scopes',
      paragraphs: Object.freeze([
        'Een FAQ-chatbot gebruikt een afgebakende kennisbron en beantwoordt herkenbare vragen. Een intakechatbot stelt daarnaast vaste vervolgvragen, controleert of vereiste gegevens aanwezig zijn en maakt een overdraagbare samenvatting. Een gekoppelde assistent leest of schrijft gegevens in CRM, agenda, helpdesk of een ander bedrijfssysteem. Iedere stap voegt ontwerp, rechten, uitzonderingen, tests en beheer toe.',
        Object.freeze({
          text:
            'Twijfel je nog of een chatbot de juiste route is, bepaal dan eerst wanneer een chatbot zinvol is. Kies pas daarna de kleinste scope die een aantoonbare taak afrondt. Een simpele bot met scherpe grenzen kan waardevoller zijn dan een brede assistent die veel bronnen en systemen raakt maar geen duidelijk acceptatiebesluit heeft.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'wanneer een chatbot zinvol is',
              href: '/blog/chatbot-laten-maken-wanneer-zinvol',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Begroot het werk aan de kennisbron apart',
      paragraphs: Object.freeze([
        'Een chatbot kan alleen betrouwbaar antwoorden binnen de informatie die beschikbaar, actueel en geschikt voor klanten is. Breng daarom in kaart welke pagina\'s, handleidingen, productgegevens en antwoorden gebruikt mogen worden. Wijs per bron een inhoudseigenaar aan en markeer tegenstrijdige, verouderde of interne informatie voordat die in de chatbot terechtkomt.',
        'Kenniswerk bestaat uit meer dan bestanden uploaden. Vragen moeten aan bruikbare antwoorden worden gekoppeld, uitzonderingen moeten worden herkend en wijzigingen moeten een vaste route krijgen. Wanneer prijzen, voorwaarden of aanbod vaak veranderen, hoort onderhoud van de bron in de terugkerende begroting. Zonder eigenaar wordt de bot na livegang langzaam minder betrouwbaar, ook als de techniek gelijk blijft.',
      ]),
    }),
    Object.freeze({
      heading: 'Gespreksontwerp maakt een demo bruikbaar in echte situaties',
      paragraphs: Object.freeze([
        'Schrijf per route de beginsituatie, benodigde vraag, toegestane antwoorden en gewenste uitkomst uit. Een bezoeker kan informatie missen, een term anders formuleren, tussendoor van onderwerp veranderen of direct een mens vragen. De chatbot moet dan niet improviseren alsof alles zeker is. Hij moet verduidelijken, begrenzen of overdragen volgens een herkenbare regel.',
        'Begroot ook microcopy en foutpaden: welkomsttekst, uitleg over wat de bot kan, toestemming waar nodig, herstel na ongeldige invoer en een duidelijke afsluiting. Een conversatiescherm is snel getekend; een route die onder verschillende formuleringen dezelfde betrouwbare beslissing neemt, vraagt scenario\'s, herziening en tests met echte vragen van het team.',
      ]),
    }),
    Object.freeze({
      heading: 'Koppelingen voegen datacontracten, rechten en herstel toe',
      paragraphs: Object.freeze([
        'Een CRM- of agendakoppeling is niet alleen een technisch stekkertje. Leg vast welke velden worden gelezen of geschreven, welk systeem leidend is, welke gebruiker toestemming heeft en wat er gebeurt bij dubbele, ontbrekende of ongeldige gegevens. Bepaal ook of de bot direct een actie uitvoert of eerst een voorstel klaarzet voor menselijke controle.',
        Object.freeze({
          text:
            'Wanneer een gesprek als lead moet landen, beschrijf dan welke samenvatting, status, bronpagina, interesse en vervolgstap nodig zijn. De route voor een chatbot met CRM-koppeling laat zien waarom opslag en opvolging samen moeten worden ontworpen. Als het CRM zelf niet op het werkproces aansluit, kan eerst een CRM-scope nodig zijn voordat een diepe chatbotintegratie logisch wordt.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'chatbot met CRM-koppeling',
              href: '/blog/chatbot-crm-koppeling-leads-opvolgen',
            }),
            Object.freeze({ anchor: 'CRM-scope', href: '/crm-systeem-op-maat' }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Menselijke overdracht is een kernfunctie, geen noodknop',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Definieer wanneer overdracht verplicht is: een expliciet verzoek om een medewerker, onvoldoende betrouwbare kennis, een bestaande klantkwestie, gevoelige context, duidelijke koopintentie of een actie die niet zonder controle mag worden uitgevoerd. Leg ook vast naar welk kanaal het gesprek gaat, binnen welk proces iemand reageert en welke context wordt meegestuurd. Zo hoeft de klant niet opnieuw te beginnen.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'wanneer overdracht verplicht is',
              href: '/kennisbank/wat-is-chatbot-overdracht',
            }),
          ]),
        }),
        'AP en ACM hebben bedrijven publiek opgeroepen om menselijk contact bereikbaar te houden en transparant te zijn over chatbots. Deze gids maakt daar geen juridisch advies van, maar wel een ontwerpeis: de menselijke route moet zichtbaar, getest en beheerd zijn. Dat vraagt tijd voor routering, notificaties, beschikbaarheidsafspraken en controle van de meegegeven samenvatting.',
      ]),
    }),
    Object.freeze({
      heading: 'Test antwoorden, acties en overdracht met acceptatiescenario’s',
      paragraphs: Object.freeze([
        'Maak vóór livegang een set vragen uit echte klanttaal. Neem normale vragen, onvolledige input, onbekende onderwerpen, tegenstrijdige bronnen, privacygevoelige verzoeken, boze reacties en expliciete mensverzoeken op. Noteer per scenario de verwachte reactie, toegestane actie, overdrachtsregel en eigenaar van het acceptatiebesluit.',
        'Meet niet alleen of de bot technisch antwoord geeft. Controleer of het antwoord door de bron wordt ondersteund, of de juiste vervolgvraag verschijnt, of verboden acties uitblijven en of de samenvatting bruikbaar aankomt. Een fout kan in kennis, instructie, integratie of proces zitten. Door die categorieën apart te registreren, wordt zichtbaar welk herstel nodig is en welk onderdeel het budget gebruikt.',
      ]),
    }),
    Object.freeze({
      heading: 'Splits eenmalige bouw, platformgebruik en doorlopend beheer',
      paragraphs: Object.freeze([
        'Maak drie begrotingsblokken. Eenmalig werk omvat doelbepaling, scenario\'s, interface, kennisinrichting, koppelingen, beveiligingskeuzes, tests en livegang. Platform- en gebruikskosten kunnen bestaan uit licenties, gebruikers, berichten, uitkomsten, modelgebruik of kanaalkosten. Beheer omvat monitoring, bronupdates, evaluatie van mislukte gesprekken, wijzigingen en technisch onderhoud.',
        'Het actuele prijsmodel van een platform als Intercom laat zien waarom alleen een maandbedrag niet genoeg is: er kunnen seats, gebruiksafhankelijke kanalen, uitkomsten en uitbreidingen naast elkaar bestaan. Dat is slechts één leveranciersvoorbeeld, geen Softora-prijsadvies. Vraag bij ieder voorstel welke meeteenheid wordt afgerekend, welke limiet geldt, wie gebruik controleert en hoe je data en configuratie kunt meenemen bij een latere overstap.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik een scopekaart in plaats van een lange functielijst',
      paragraphs: Object.freeze([
        'Zet voor iedere gewenste functie acht velden naast elkaar: klanttaak, kennisbron, invoer, beslissing, uitkomst, gekoppeld systeem, menselijke eigenaar en acceptatiebewijs. Een functie hoort pas in de eerste versie wanneer het team deze velden concreet kan invullen. Open wensen worden onderzoeksvragen of gaan naar een latere fase.',
        'Een praktische eerste scope kan bijvoorbeeld bestaan uit tien veelgestelde vraaggroepen, één intake voor een terugbelverzoek, één samenvatting naar de mailbox en overdracht via een schone contactroute. Agenda boeken, CRM schrijven, meertaligheid en persoonlijke aanbevelingen blijven dan buiten scope totdat de basis aantoonbaar werkt. Dit is een fictief afbakeningsvoorbeeld, geen belofte over doorlooptijd, prijs of resultaat.',
      ]),
    }),
    Object.freeze({
      heading: 'Vergelijk chatbotvoorstellen op dezelfde bewijsstukken',
      paragraphs: Object.freeze([
        'Geef leveranciers dezelfde klanttaken, bronnen, routes, integraties, overdrachtsregels en uitsluitingen. Vraag vervolgens om een scenario-overzicht, datastroom, verantwoordelijkheden, acceptatieplan en beheerafspraken. Een voorstel met meer AI-functies is niet automatisch beter; een voorstel dat het gekozen gesprek controleerbaar uitvoert en veilig stopt, is beter vergelijkbaar.',
        'Laat ieder voorstel ook aangeven wie eigenaar blijft van broncontent, gespreksroutes, configuratie, loggegevens en koppelingen. Vraag hoe wijzigingen worden aangevraagd, welke controle vóór publicatie plaatsvindt en welke export beschikbaar is wanneer de samenwerking stopt. Zet aannames, meerwerkregels en afhankelijkheden naast de prijs. Noteer bovendien welke medewerker fouten mag herstellen en hoe snel een kritieke route kan worden uitgezet. Zo vergelijk je niet alleen de eerste oplevering, maar ook de bestuurbaarheid van de chatbot nadat bezoekers ermee werken.',
        Object.freeze({
          text:
            'Vergelijk ook met livechat wanneer het grootste deel van de waarde juist uit direct menselijk gesprek komt. De afweging tussen chatbot en livechat voorkomt dat automatisering wordt gekocht voor vragen die veel interpretatie, vertrouwen of onderhandeling vragen. Een hybride route kan passend zijn, maar alleen wanneer duidelijk is wanneer de bot helpt en wanneer een medewerker beschikbaar wordt.',
          links: Object.freeze([
            Object.freeze({ anchor: 'afweging tussen chatbot en livechat', href: '/vergelijkingen/chatbot-vs-livechat' }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Bereid een scopegesprek voor met tien concrete antwoorden',
      paragraphs: Object.freeze([
        'Schrijf op welke klanttaak nu vertraging oplevert; welke vragen vaak terugkomen; welke bron leidend is; welke gegevens nodig zijn; welke uitkomst het gesprek moet hebben; welke actie de bot nooit zelfstandig mag doen; wanneer een mens overneemt; welk systeem informatie ontvangt; wie inhoud en gebruik beheert; en welk scenario als voldoende wordt geaccepteerd. Onbekende punten blijven zichtbaar als onderzoeksvraag.',
        Object.freeze({
          text:
            'Met deze antwoorden kan Softora een compacte eerste chatbotscope, afhankelijkheden en beslispoorten uitwerken. Het doel is niet om zoveel mogelijk gesprekken te automatiseren, maar om één nuttige route betrouwbaar te ondersteunen en de menselijke opvolging intact te houden. Bekijk chatbot laten maken of bespreek via Contact welke eerste klanttaak geschikt is om af te bakenen.',
          links: Object.freeze([
            Object.freeze({ anchor: 'chatbot laten maken', href: '/chatbot-laten-maken' }),
          ]),
        }),
      ]),
    }),
  ]),
  faq: Object.freeze([
    Object.freeze({
      question: 'Welke onderdelen maken een zakelijke chatbot duurder?',
      answer:
        'Vooral extra klanttaken, meerdere kennisbronnen, complexe gespreksroutes, systeemkoppelingen, rechten, uitzonderingen, acceptatietests en zwaarder beheer voegen werk toe. De interface alleen zegt weinig over de totale scope.',
    }),
    Object.freeze({
      question: 'Welke kosten blijven na de livegang bestaan?',
      answer:
        'Denk aan platform- of modelgebruik, hosting, monitoring, bronupdates, analyse van mislukte gesprekken, support, beveiligingsupdates en onderhoud wanneer gekoppelde systemen veranderen.',
    }),
    Object.freeze({
      question: 'Wanneer is een CRM-koppeling de extra scope waard?',
      answer:
        'Wanneer passende gesprekken structureel als lead, klantvraag of taak moeten worden opgeslagen en opgevolgd. Leg eerst vast welke velden, status, eigenaar en herstelroute nodig zijn.',
    }),
    Object.freeze({
      question: 'Kan een chatbot klein beginnen?',
      answer:
        'Ja. Kies één klanttaak, een beperkte kennisbron, duidelijke stopregels, één overdrachtsroute en toetsbare scenario’s. Breid pas uit nadat medewerkers de basis in echt gebruik hebben gecontroleerd.',
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
    Object.freeze({ label: 'Wanneer is een chatbot zinvol?', href: '/blog/chatbot-laten-maken-wanneer-zinvol' }),
    Object.freeze({ label: 'Chatbot of livechat', href: '/vergelijkingen/chatbot-vs-livechat' }),
    Object.freeze({ label: 'Chatbot en CRM koppelen', href: '/blog/chatbot-crm-koppeling-leads-opvolgen' }),
    Object.freeze({ label: 'Wat is chatbot overdracht?', href: '/kennisbank/wat-is-chatbot-overdracht' }),
    Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
  ]),
});

module.exports = {
  CHATBOT_KOSTEN_CONTENT_ITEM,
};
