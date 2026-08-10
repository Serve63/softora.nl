const CHATBOT_OFFERTE_CONTENT_ITEM = Object.freeze({
  collection: 'blog',
  slug: 'chatbot-offerte-vergelijken',
  title: 'Chatbot-offertes vergelijken: scope, bewijs en beheer',
  description:
    'Vergelijk chatbotvoorstellen op dezelfde klanttaak, kennisbron, koppelingen, acceptatietests, menselijke overdracht, eigenaarschap en beheer.',
  category: 'Chatbots',
  intent: 'Koopintentie',
  qualityVersion: 2,
  primaryIntent: 'Chatbot-offertes en leveranciersvoorstellen op een gelijke scope vergelijken',
  buyerTask:
    'Twee chatbotvoorstellen normaliseren, bewijs opvragen en per beslispoort bepalen welk voorstel beheersbaar genoeg is voor een eerste versie',
  funnelStage: 'decision',
  targetMoneyPage: '/chatbot-laten-maken',
  uniqueClusterRole:
    'Leveranciersneutrale offerte- en bewijsvergelijking na kostenorientatie, los van de vraag of een chatbot zinvol is, de kostenopbouw en de technische CRM-overdracht.',
  informationGain:
    'Een herbruikbare normalisatiekaart met vier beslispoorten voor taakgrens, acceptatiebewijs, menselijke overdracht en beheer/exit, zodat functies en prijzen pas worden vergeleken nadat de voorstellen dezelfde opdracht beschrijven.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Microsoft Learn: Bekijk de implementatiechecklist',
      url: 'https://learn.microsoft.com/nl-nl/microsoft-copilot-studio/guidance/implement-checklist',
      observedAt: '2026-08-10',
    }),
    Object.freeze({
      title: 'Microsoft Learn: Review the plan checklist',
      url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/plan-checklist',
      observedAt: '2026-08-10',
    }),
    Object.freeze({
      title: 'ACM: Opinie ACM en AP over inzet AI-chatbots bij klantenservice',
      url: 'https://www.acm.nl/nl/publicaties/opinie-acm-en-ap-over-inzet-ai-chatbots-bij-klantenservice',
      observedAt: '2026-08-10',
    }),
    Object.freeze({
      title: 'Software Vrienden: WhatsApp AI Agent laten maken',
      url: 'https://softwarevrienden.nl/whatsapp-ai-agent-laten-maken',
      observedAt: '2026-08-10',
    }),
    Object.freeze({
      title: 'Appfront: Wat kost een chatbot laten maken?',
      url: 'https://appfront.nl/kennisbank/chatbot-laten-maken-kosten',
      observedAt: '2026-08-10',
    }),
  ]),
  publishedAt: '2026-08-10',
  updatedAt: '2026-08-10',
  visualQualityVersion: 2,
  visualBrief: Object.freeze({
    hero: Object.freeze({
      role: 'representative',
      visualType: 'object-study',
      visualFamily: 'forest-proposal-evidence-tabletop',
      composition:
        'Top-down objectstudie met twee offertefolders, een gedeelde meetlat en fysieke bewijsstukken op een donkergroene ondergrond.',
      informationGoal:
        'Laat zien dat twee voorstellen eerst naar dezelfde scope en bewijsrijen moeten worden teruggebracht voordat prijs of leverancier wordt gekozen.',
      differenceFromRecent:
        'Tactiele editorial fotografie met papier en fysieke tokens, zonder scherm, dashboard, isometrische tegels of kobaltblauwe transitkaart.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'minimal',
      previewSafe: true,
    }),
    support: Object.freeze({
      role: 'explanatory',
      visualType: 'decision-matrix',
      visualFamily: 'yellow-screenprint-evidence-grid',
      composition:
        'Volvlak gele zeefdrukmatrix met twee voorstelkolommen, vier grote pictogramrijen en een zwarte go-no-go-route.',
      informationGoal:
        'Leg uit dat taakgrens, acceptatiebewijs, menselijke overdracht en beheer/exit afzonderlijke beslispoorten zijn die een voorstel kunnen blokkeren.',
      differenceFromRecent:
        'Vlakke gele drukgrafiek met grove symbolen en zonder fotografie, UI-kaarten, 3D-perspectief, wit canvas of dominante blauw-paarse kleuren.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: false,
    }),
  }),
  image: Object.freeze({
    src: '/assets/seo-content/chatbot-offerte-vergelijking-bewijsstukken-softora.jpg',
    alt: 'Twee chatbot-offertes worden op een gedeelde meetlat vergeleken met bewijsstukken voor kennis, koppelingen, mensen, tests en exit.',
    width: 1600,
    height: 900,
  }),
  secondaryImage: Object.freeze({
    src: '/assets/seo-content/chatbot-offerte-beslismatrix-softora.jpg',
    alt: 'Beslismatrix vergelijkt twee chatbotvoorstellen op taakgrens, acceptatiebewijs, menselijke overdracht en beheer of exit.',
    width: 1600,
    height: 900,
    caption:
      'Een laagste prijs of langste functielijst passeert de vergelijking niet wanneer een noodzakelijke beslispoort geen controleerbaar bewijs heeft.',
  }),
  summary:
    'Vergelijk chatbot-offertes pas nadat klanttaak, bronnen, routes, koppelingen, acceptatie, overdracht, beheer en exit in beide voorstellen hetzelfde betekenen. Vraag per onderdeel om bewijs en laat open aannames niet als inbegrepen werk meetellen.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: normaliseer eerst de opdracht',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Twee chatbot-offertes zijn alleen vergelijkbaar wanneer ze dezelfde klanttaak oplossen. Leg daarom vóór prijs, techniek en planning vast wie de gebruiker is, welke vraag de chatbot afhandelt, welke uitkomst hij mag voorbereiden en wanneer een medewerker beslist. Wil je een chatbot laten maken, geef iedere leverancier deze ene opdracht in dezelfde woorden en laat afwijkingen expliciet markeren.',
          links: Object.freeze([
            Object.freeze({ anchor: 'chatbot laten maken', href: '/chatbot-laten-maken' }),
          ]),
        }),
        'Een voorstel voor een FAQ-bot, een intakeflow en een gekoppelde assistent kan er op het eerste gezicht hetzelfde uitzien, maar bevat ander kenniswerk, andere rechten, meer foutpaden en zwaardere acceptatie. Begin daarom met een normalisatiekaart. Zet per voorstel de klanttaak, ingang, toegestane bronnen, beslissingen, uitkomst, uitsluitingen en menselijke eigenaar naast elkaar. Een leeg vak is geen detail: het is een open aanname die de prijs en het risico kan veranderen.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak de eerste versie klein genoeg om te beoordelen',
      paragraphs: Object.freeze([
        'Beschrijf niet dat de chatbot vragen moet beantwoorden, leads moet kwalificeren of afspraken moet plannen. Schrijf een afgebakend scenario. Bijvoorbeeld: een zakelijke bezoeker kiest een softwarevraag, ontvangt alleen antwoorden uit goedgekeurde openbare bronnen, kan een terugbelverzoek achterlaten en krijgt bij onzekerheid een zichtbare contactroute. Dat scenario bevat een begin, stopregels en een controleerbare uitkomst.',
        Object.freeze({
          text:
            'Zet wensen voor later in een aparte kolom en laat ze niet stilletjes in de basisprijs verdwijnen. Meertaligheid, persoonlijke aanbevelingen, CRM-writes, agenda-acties en meerdere kanalen kunnen zinvol zijn, maar veranderen de benodigde data, uitzonderingen en tests. Gebruik de chatbotkostengids om eenmalige inrichting, platformgebruik en beheer apart te houden. Deze pagina beoordeelt vervolgens of ieder voorstel hetzelfde werk en dezelfde bewijslast heeft begroot.',
          links: Object.freeze([
            Object.freeze({ anchor: 'chatbotkostengids', href: '/blog/chatbot-kosten-mkb' }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Vergelijk kennisbronnen op eigenaarschap en verversing',
      paragraphs: Object.freeze([
        'Vraag niet alleen welke bestanden of webpagina\'s kunnen worden gekoppeld. Leg vast welke bronnen werkelijk gebruikt mogen worden, wie inhoud goedkeurt, hoe tegenstrijdige informatie wordt behandeld en hoe snel een wijziging zichtbaar hoort te zijn. Een voorstel dat alleen zegt dat documenten kunnen worden geüpload, beschrijft nog geen beheersbare kennisvoorziening.',
        'Microsoft noemt in zijn huidige implementatiechecklist onder meer gevalideerde kennisbronnen, governance voor toevoegen en verwijderen van content en grenzen voor door AI gegenereerde antwoorden. Vertaal dat naar bewijs dat ook buiten één platform begrijpelijk blijft: een bronregister, een eigenaar per bron, een wijzigingsroute, een lijst met uitgesloten informatie en testvragen waarmee het team controleert of een antwoord werkelijk uit de juiste bron komt.',
      ]),
    }),
    Object.freeze({
      heading: 'Laat routes en uitzonderingen zien, niet alleen een demo',
      paragraphs: Object.freeze([
        'Een goede demo toont meestal de ideale vraag. Een offerte moet ook uitleggen wat er gebeurt bij onvolledige input, een onderwerp buiten scope, tegenstrijdige bronnen, een boze bezoeker, een expliciet mensverzoek en een actie die niet mag worden uitgevoerd. Vraag per route om de verwachte reactie, stopregel, overdracht en registratie. Zo wordt zichtbaar hoeveel van het gespreksontwerp werkelijk is inbegrepen.',
        'Controleer ook de gekozen kanalen. Webchat, WhatsApp, Teams en een klantportaal verschillen in identiteit, berichtvorm, beschikbare knoppen en overdracht. Een leverancier hoeft niet ieder kanaal in de eerste versie aan te bieden. Het voorstel moet wel benoemen welk kanaal is inbegrepen, welke beperkingen daar gelden en welk herontwerp nodig wordt wanneer later een ander kanaal aansluit.',
      ]),
    }),
    Object.freeze({
      heading: 'Vraag voor iedere koppeling om een datacontract',
      paragraphs: Object.freeze([
        'Een logo van CRM, agenda of helpdesk is geen integratiebewijs. Laat per koppeling zien welke velden worden gelezen of geschreven, welk systeem leidend is, welke identiteit wordt gebruikt, welke rechten nodig zijn en wat er gebeurt bij een ongeldige waarde, dubbele match of time-out. Vraag ook of de chatbot direct een actie uitvoert of eerst een voorstel klaarzet voor menselijke controle.',
        Object.freeze({
          text:
            'Bij een leadroute hoort minimaal een controle op verplichte gegevens, deduplicatie, eigenaar, volgende actie en een zichtbare foutwachtrij. De gids over chatbot en CRM koppelen werkt dat overdrachtscontract verder uit. Gebruik die diepte alleen wanneer CRM-opvolging werkelijk deel van de eerste klanttaak is. Anders betaal je voor integratierisico voordat het basisgesprek is bewezen.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'chatbot en CRM koppelen',
              href: '/blog/chatbot-crm-koppeling-leads-opvolgen',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Maak acceptatiebewijs onderdeel van de offerte',
      paragraphs: Object.freeze([
        'Vraag om een acceptatieplan voordat de leverancier begint te bouwen. Dat plan benoemt de scenario\'s, invoer, verwachte uitkomst, toegestane variatie, blokkades en eigenaar van het go-no-go-besluit. Neem naast normale vragen ook ontbrekende gegevens, onbekende onderwerpen, foutieve bronnen, mislukte koppelingen en expliciete mensverzoeken op. Een technisch antwoord is pas bruikbaar wanneer het team de inhoud en vervolgstap kan controleren.',
        'Vergelijk daarna niet het aantal testcases, maar de dekking van de afgesproken taak. Welk bewijs laat zien dat antwoorden op de bron rusten? Hoe wordt aangetoond dat verboden acties uitblijven? Komt de overdracht met voldoende context aan? Kan een mislukte write worden hersteld zonder een dubbele lead? Laat ieder voorstel aangeven welke testomgeving, rapportage, hertest en herstelronde in de prijs zitten.',
      ]),
    }),
    Object.freeze({
      heading: 'Behandel menselijke overdracht als een primaire route',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een mensknop onderaan het venster is niet automatisch een goede overdracht. Leg vast wanneer de chatbot moet stoppen, welk kanaal de bezoeker krijgt, welke context meegaat, wie tijdens openingstijden reageert en wat buiten die tijden wordt beloofd. Vergelijk chatbot en livechat per gesprekstype wanneer vertrouwen, onderhandeling of uitzonderingen belangrijker zijn dan directe automatisering.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'chatbot en livechat per gesprekstype',
              href: '/vergelijkingen/chatbot-vs-livechat',
            }),
          ]),
        }),
        'ACM en AP benadrukken in hun gezamenlijke opinie transparantie over het gebruik van AI-chatbots, regie over de verstrekte informatie en toegang tot menselijk contact. Dit artikel geeft geen juridisch oordeel over een concreet systeem. Het maakt er wel een offerte-eis van: de leverancier moet laten zien hoe de bezoeker weet met een systeem te spreken en hoe de menselijke route in ontwerp, test en beheer is opgenomen.',
      ]),
    }),
    Object.freeze({
      heading: 'Splits bouw, gebruik en beheer in dezelfde meeteenheden',
      paragraphs: Object.freeze([
        'Zet eenmalige analyse, gespreksontwerp, kennisinrichting, interface, koppelingen, tests en livegang in een apart blok. Zet daar platformlicenties, gebruikers, berichten, modelgebruik, kanaalkosten en externe diensten naast. Maak ten slotte beheer zichtbaar: bronupdates, monitoring, foutanalyse, kleine wijzigingen, support, heracceptatie en technisch onderhoud. Vraag per terugkerende post welke meeteenheid, limiet en prijsregel geldt.',
        'Een lage startprijs kan logisch zijn wanneer veel werk bij het interne team ligt. Een hoger voorstel kan passend zijn wanneer bronopschoning, scenario\'s, koppelingen en beheer aantoonbaar zijn inbegrepen. De vergelijking gaat daarom niet over goedkoop of duur, maar over hetzelfde resultaat en dezelfde verantwoordelijkheden. Noteer intern benodigde uren ook, anders lijkt een voorstel goedkoper doordat werk buiten de offerte wordt neergelegd.',
      ]),
    }),
    Object.freeze({
      heading: 'Leg eigenaarschap en wijzigingsrechten vóór livegang vast',
      paragraphs: Object.freeze([
        'Wijs voor inhoud, gespreksroutes, integraties, toegang, rapportage en commerciële opvolging een eigenaar aan. Vraag wie een wijziging mag publiceren, welke controle daaraan voorafgaat en hoe een foutieve versie wordt teruggedraaid. Een voorstel dat alles bij de leverancier laat, kan snel starten maar maakt het team afhankelijk. Een voorstel dat alles bij de klant legt, kan beheer onderschatten.',
        'Controleer praktisch welke onderdelen het team zelf kan bekijken of aanpassen en welke kennis daarvoor nodig is. Vraag om documentatie van scope, bronnen, mappings, stopregels en bekende beperkingen. Leg ook vast wie incidenten beoordeelt, hoe kritieke routes tijdelijk worden uitgezet en wanneer een wijziging opnieuw door acceptatie moet. Menselijke controle is dan een werkwijze, niet alleen een zin in de offerte.',
      ]),
    }),
    Object.freeze({
      heading: 'Vergelijk exit op data, configuratie en continuiteit',
      paragraphs: Object.freeze([
        'Vraag wat er beschikbaar is wanneer het platform of de leverancier niet meer past. Denk aan bronbestanden, eigen content, gespreksroutes, prompt- of configuratiedocumentatie, integratiemappings, testsets, exporteerbare rapportage en verwijdering van toegangen. Niet ieder technisch onderdeel is overdraagbaar, maar het voorstel moet het verschil tussen klantbezit, licentie en leveranciersspecifieke configuratie duidelijk maken.',
        'Controleer ook de operationele stoproute. Kan de chatbot worden uitgezet zonder dat contactmogelijkheden verdwijnen? Blijft een gewone contactlink bereikbaar? Hoe worden open taken, foutwachtrijen en gekoppelde sleutels afgehandeld? Een goed exit-antwoord belooft geen probleemloze overstap. Het maakt zichtbaar welke stappen, afhankelijkheden en menselijke controles nodig zijn om het klantcontact beheersbaar te houden.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik vier beslispoorten in plaats van één totaalscore',
      paragraphs: Object.freeze([
        'Poort één is taakgrens: beschrijven beide voorstellen dezelfde gebruiker, route, uitkomst en uitsluitingen? Poort twee is bewijs: zijn bronnen, testscenario\'s, integraties en acceptatie controleerbaar? Poort drie is menselijke overdracht: blijft een medewerker bereikbaar en krijgt die bruikbare context? Poort vier is beheer en exit: zijn eigenaarschap, terugkerende kosten, wijzigingen, incidenten en overdraagbaarheid expliciet?',
        'Laat een voorstel niet compenseren voor een ontbrekende poort met extra functies. Een mooie interface maakt een onduidelijke databron niet goed. Veel automatisering herstelt geen ontbrekende mensroute. Een lage prijs vervangt geen acceptatiebewijs. Markeer iedere poort als voldoende, open vraag of blokkade. Pas wanneer alle blokkades zijn opgelost, is een gewogen voorkeur voor prijs, planning, werkwijze en technische route zinvol.',
      ]),
    }),
    Object.freeze({
      heading: 'Bereid het offertengesprek voor met één gedeeld werkblad',
      paragraphs: Object.freeze([
        'Stuur leveranciers vooraf dezelfde tabel met klanttaak, gebruikers, bronregister, kanalen, routes, stopregels, koppelingen, velden, menselijke overdracht, acceptatiescenario\'s, beheer en exit. Vraag per rij wat inbegrepen is, welk bewijs wordt geleverd, welke aanname nog geldt en wie eigenaar wordt. Laat prijs en planning pas daarna invullen. Zo voorkom je dat ieder voorstel een andere opdracht optimaliseert.',
        Object.freeze({
          text:
            'Softora kan één eerste chatbotroute, de benodigde bewijsstukken en de menselijke verantwoordelijkheden als een afgebakende scope uitwerken. Het doel is niet om een leverancier op naam tot winnaar te verklaren, maar om een voorstel te krijgen dat het team kan begrijpen, testen, beheren en zo nodig stoppen. Start gesprek is de passende vervolgstap wanneer je twee voorstellen wilt normaliseren of één controleerbare aanvraag wilt opstellen.',
          links: Object.freeze([
            Object.freeze({ anchor: 'chatbotroute', href: '/chatbot-laten-maken' }),
          ]),
        }),
      ]),
    }),
  ]),
  faq: Object.freeze([
    Object.freeze({
      question: 'Welke onderdelen moeten in iedere chatbot-offerte staan?',
      answer:
        'Minimaal de klanttaak, bronnen, routes, uitsluitingen, kanalen, koppelingen, acceptatiebewijs, menselijke overdracht, eigenaarschap, eenmalige en terugkerende kosten, beheer en exit. Open aannames horen apart zichtbaar te blijven.',
    }),
    Object.freeze({
      question: 'Hoe vergelijk je een platformoplossing met maatwerk?',
      answer:
        'Geef beide dezelfde taak en beslispoorten. Vergelijk daarna wat standaard beschikbaar is, welk aanvullend werk nodig is, wie beheer uitvoert, welke gebruikskosten gelden en welke configuratie of data overdraagbaar blijft.',
    }),
    Object.freeze({
      question: 'Welke bewijsstukken zijn nodig vóór livegang?',
      answer:
        'Vraag om een bronregister, route- en datastroom, testscenario\'s met verwachte uitkomsten, bewijs van koppeling en foutafhandeling, een geteste menselijke overdracht en een door de proceseigenaar vastgelegd acceptatiebesluit.',
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
    Object.freeze({ label: 'Wat kost een chatbot?', href: '/blog/chatbot-kosten-mkb' }),
    Object.freeze({ label: 'Wanneer is een chatbot zinvol?', href: '/blog/chatbot-laten-maken-wanneer-zinvol' }),
    Object.freeze({ label: 'Chatbot en CRM koppelen', href: '/blog/chatbot-crm-koppeling-leads-opvolgen' }),
    Object.freeze({ label: 'Chatbot of livechat', href: '/vergelijkingen/chatbot-vs-livechat' }),
    Object.freeze({ label: 'Wat is chatbot overdracht?', href: '/kennisbank/wat-is-chatbot-overdracht' }),
  ]),
});

module.exports = {
  CHATBOT_OFFERTE_CONTENT_ITEM,
};
