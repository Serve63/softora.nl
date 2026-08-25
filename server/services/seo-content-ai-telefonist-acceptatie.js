const AI_TELEFONIST_ACCEPTATIE_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'ai-telefonist-acceptatietest-opstellen',
  title: 'AI telefonist testen vóór livegang',
  description:
    'Maak een acceptatietest voor verstaanbaarheid, gesprekspaden, systeemacties, overdracht, dubbele events en menselijk herstel vóór livegang.',
  category: 'AI telefonie',
  intent: 'Acceptatie en livegang',
  qualityVersion: 2,
  primaryIntent:
    'Een AI telefonist met herhaalbare gespreks-, audio-, actie-, overdrachts- en herstelscenario’s accepteren voordat echte bellers de route gebruiken',
  buyerTask:
    'Een compacte acceptatieset opstellen met invoer, verwacht gedrag, zichtbaar bewijs, eigenaar en go-no-go-regel voor normale gesprekken, grensgevallen en storingen',
  funnelStage: 'consideration',
  targetMoneyPage: '/ai-telefonist',
  uniqueClusterRole:
    'Leveranciersonafhankelijke acceptatiegids voor de volledige voice-route vóór livegang; de definitiepagina bakent de taak af, de afspraakpagina behandelt één toepassing, de CRM-gids de gegevensoverdracht, de kostengids de begroting en de overdrachtspagina de menselijke grens.',
  informationGain:
    'Een zeslaagse voice-acceptatieset die gesprek, spraak, systeemactie, menselijke overdracht, foutgedrag en herstel apart beoordeelt en ieder scenario koppelt aan verwacht bewijs, eigenaar, blokkeringsniveau en regressietest.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Retell AI Docs: Testing overview',
      url: 'https://docs.retellai.com/test/test-overview',
      observedAt: '2026-08-25',
    }),
    Object.freeze({
      title: 'Retell AI Docs: Automatically test your agent',
      url: 'https://docs.retellai.com/test/llm-simulation-testing',
      observedAt: '2026-08-25',
    }),
  ]),
  growthEventKind: 'new_url',
  growthEventAt: '2026-08-25',
  publishedAt: '2026-08-25',
  updatedAt: '2026-08-25',
  readTime: '11 min',
  summary:
    'Test een AI telefonist niet met één soepel proefgesprek. Bouw een vaste acceptatieset met normale routes, grensgevallen en storingen. Beoordeel apart wat de beller hoort, welke actie het systeem uitvoert, wanneer een mens overneemt en welk herstelbewijs zichtbaar blijft. Een proceseigenaar beslist daarna op vastgelegde criteria over livegang.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: accepteer zes lagen, niet één demo',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een goede demo laat zien dat één gesprek kan lukken. Een acceptatietest moet juist aantonen hoe de route reageert op verwachte variatie en fouten. Splits daarom zes lagen: gespreksinhoud, spraakkwaliteit, systeemactie, menselijke overdracht, foutgedrag en herstel. Op AI telefonist laten maken staat de commerciële route; deze gids helpt eerst bepalen welk bewijs nodig is voordat een begrensde telefonieflow live mag.',
          links: Object.freeze([
            Object.freeze({ anchor: 'AI telefonist laten maken', href: '/ai-telefonist' }),
          ]),
        }),
        'Laat iedere laag een eigen eindbewijs hebben. Een passend antwoord is niet genoeg wanneer de verkeerde afspraak wordt geschreven. Een correcte CRM-taak is niet genoeg wanneer de beller door lange stilte afhaakt. Een geslaagde overdracht is niet genoeg wanneer een niet-bereikbare medewerker de beller zonder vervolg laat eindigen. Het go-no-go-besluit kijkt naar de hele keten, maar verbergt niet in welke laag een bevinding zit.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak eerst een kleine maar representatieve testset',
      paragraphs: Object.freeze([
        'Begin met de echte gesprekstaak en de variatie die daarbij hoort. Voor een terugbelroute zijn dat bijvoorbeeld een normale aanvraag, ontbrekende naam, verkeerd verstaan telefoonnummer, vraag buiten scope, onzekere urgentie, herhaalde vraag, expliciete mensvraag en een beller die halverwege van onderwerp wisselt. Voeg alleen scenario’s toe die een besluit, risico of terugkerend praktijkpatroon toetsen; een lange lijst zonder verwacht bewijs geeft schijnzekerheid.',
        'Beschrijf per scenario een herkenbare startsituatie, toegestane testgegevens, verplichte informatie, verwachte gespreksstappen, verboden actie, verwacht systeemresultaat, overdrachtsregel en bewijs. Noteer ook wie de uitkomst beoordeelt. De proceseigenaar kan bepalen of de zakelijke route klopt, een medewerker beoordeelt of de overdracht werkbaar is en de technische eigenaar controleert events, logs en herstel. Eén algemene score vervangt die verschillende oordelen niet.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik vier testvormen voor vier verschillende vragen',
      paragraphs: Object.freeze([
        'De actuele Retell-documentatie onderscheidt handmatige teksttests, gescoorde simulaties, webcalls en echte telefoongesprekken. Een handmatige teksttest is geschikt om snel instructies, toolkeuze en overgang tussen stappen te onderzoeken. Herhaalbare simulaties kunnen vaste scenario’s met succescriteria uitvoeren en regressies zichtbaar maken. Beide vormen missen echter het echte geluid, de timing en de telefoonketen.',
        'Een webcall laat stem, vertraging en onderbreken horen zonder dat al een telefoonnummer nodig is. Een echte telefoontest voegt carrier-audio, DTMF en transfers toe. Gebruik dus niet één methode als vervanging voor alle andere. Ga van goedkoop en controleerbaar naar werkelijk: eerst logica, daarna herhaalbaarheid, vervolgens audio en ten slotte de complete telefoonroute. Een scenario gaat pas door naar een duurdere testlaag wanneer de eerdere laag voldoende stabiel is.',
      ]),
    }),
    Object.freeze({
      heading: 'Test gesprek en spraak met hoorbare criteria',
      paragraphs: Object.freeze([
        'Controleer of de opening eerlijk en begrijpelijk is, de eerste vraag bij de taak past en de telefonist niet te vroeg gegevens verzamelt. Varieer met korte antwoorden, lange uitleg, stilte, een correctie, onderbreken, cijfers, namen, een andere volgorde van informatie en een vraag buiten scope. Noteer niet alleen of het gesprek “natuurlijk” voelt, maar of de juiste informatie wordt bevestigd, twijfel zichtbaar blijft en de route op het afgesproken moment stopt of overdraagt.',
        'Test audio onder omstandigheden die voor de doelgroep aannemelijk zijn: een stille ruimte, achtergrondgeluid, een mobiele verbinding en meerdere spreeksnelheden. Beoordeel wachttijd, door elkaar praten, herstel na een onderbreking, verstaan van kritieke gegevens en hoorbaarheid van de overdrachtsmelding. Leg per kritisch veld vast of mondelinge bevestiging nodig is. Een naam verkeerd verstaan kan herstelbaar zijn; een verkeerd telefoonnummer of tijdstip mag niet stil naar een echte actie doorlopen.',
      ]),
    }),
    Object.freeze({
      heading: 'Mock functies voordat je echte systemen laat schrijven',
      paragraphs: Object.freeze([
        'Een gespreksflow kan tijdens een simulatie functies aanroepen voor CRM, agenda, e-mail of routering. Laat de eerste tests geen echte klantactie uitvoeren. Gebruik vaste testvariabelen en mocks die gecontroleerde uitkomsten teruggeven: succes, niets gevonden, meerdere matches, ongeldig veld, timeout en tijdelijke storing. Retell documenteert function mocks binnen simulaties, maar waarschuwt ook dat ontbrekende mocks bepaalde echte functies wel kunnen aanroepen. Controleer daarom per tool of de mock werkelijk wordt toegepast voordat je een test start.',
        Object.freeze({
          text:
            'Ga daarna naar een afgeschermde testomgeving met fictieve records en unieke scenario-id’s. Controleer bij iedere schrijfroute zowel de actie als de afwezigheid van ongewenste neveneffecten. De gids over AI telefonie koppelen aan CRM of agenda werkt eventsleutels, duplicatecontrole, minimale velden en herstelwachtrijen verder uit. De acceptatietest gebruikt dat contract als verwacht bewijs en test ook wat de beller hoort wanneer de systeemactie niet lukt.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'AI telefonie koppelen aan CRM of agenda',
              href: '/kennisbank/ai-telefonist-crm-koppeling',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Maak geslaagde, dubbele en mislukte acties zichtbaar',
      paragraphs: Object.freeze([
        'Een actie is pas geslaagd wanneer het afgesproken eindbewijs bestaat. Controleer bijvoorbeeld exact één CRM-taak met juiste bron en eigenaar, of één agenda-item met het juiste tijdvak en een herkenbare bevestigingsstatus. Test dezelfde eventlevering twee keer en controleer dat geen tweede lead, taak of afspraak ontstaat. Test ook een antwoord dat te laat komt nadat de route al naar herstel is gegaan; late levering mag niet ongemerkt een tweede uitkomst schrijven.',
        'Behandel fouten per categorie. Een tijdelijke netwerkstoring kan een beperkte retry krijgen. Ontbrekende toestemming, meerdere klantmatches, een bezet tijdvak of ongeldige gegevens vraagt menselijke beoordeling. Controleer dat de foutstatus, veilige context, eerdere stappen, eigenaar en volgende actie zichtbaar zijn. Een technisch foutbericht zonder herstelroute is geen acceptatiebewijs, ook niet wanneer de beller een vriendelijke slotzin heeft gehoord.',
      ]),
    }),
    Object.freeze({
      heading: 'Test menselijke overdracht als volledige klantreis',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Maak afzonderlijke scenario’s voor een directe mensvraag, taak buiten scope, onvoldoende zekerheid, gevoelig besluit, lage gesprekskwaliteit en een mislukte koppeling. Test vervolgens een bereikbare medewerker, een bezette bestemming, buiten openingstijd en een transfer die technisch start maar niet verbindt. De praktische gids over menselijke overdracht helpt de trigger, meegegeven context en fallback per route af te bakenen.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'gids over menselijke overdracht',
              href: '/blog/ai-telefonie-menselijke-overdracht',
            }),
          ]),
        }),
        'Controleer wat de beller vóór, tijdens en na de poging hoort. De medewerker hoort voldoende context te ontvangen zonder dat de AI een onzekere conclusie als feit presenteert. Wanneer niemand opneemt, moet een vooraf afgesproken vervolg ontstaan, zoals een terugbeltaak met eigenaar en status. Meet dus niet alleen transfer gestart of verbonden; beoordeel of de klantreis eindigt in een begrijpelijke, herstelbare en intern toegewezen uitkomst.',
      ]),
    }),
    Object.freeze({
      heading: 'Leg blokkeringsniveaus en eigenaar vooraf vast',
      paragraphs: Object.freeze([
        'Classificeer iedere bevinding voordat de test begint. Een blocker kan een verkeerde systeemactie, ontbrekende transparantie, onbeheersbare duplicate, verloren overdracht of onbeschermde klantdata zijn. Een zware bevinding kan de taak onbetrouwbaar maken zonder direct extern effect, bijvoorbeeld een verkeerd bevestigde kritieke waarde. Een lichte bevinding kan een formulering of timingdetail zijn dat binnen de beperkte taak geen verkeerde uitkomst veroorzaakt. De context bepaalt de ernst; gebruik geen universele lijst zonder proceseigenaar.',
        'Wijs per laag een herstelaar en een beslisser aan. De bouwer kan een defect oplossen, maar hoort niet alleen te bepalen of de bedrijfsroute aanvaardbaar is. De proceseigenaar beslist over taak en risico, de data- of systeemeigenaar over velden en rechten en de ontvangende medewerker over overdrachtsbruikbaarheid. Noteer open aannames apart. “Bekend probleem” is geen acceptatie wanneer niet duidelijk is wie het draagt en welke tijdelijke grens live voorkomt.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak van goedgekeurde scenario’s een regressieset',
      paragraphs: Object.freeze([
        'Bewaar na acceptatie de scenario-id, invoer, verwachte uitkomst, bewijs, testvorm, versie van instructies en functies, datum en beoordelaar. Gescoorde simulaties zijn nuttig om veel logische regressies herhaalbaar te signaleren, maar een automatische score bewijst geen audiokwaliteit of echte transfer. Houd daarom een kleine vaste set web- en telefoontests naast de simulaties. Voeg een productiebevinding pas toe wanneer zij een relevante route of foutgrens vertegenwoordigt.',
        'Draai de passende set opnieuw na wijzigingen aan instructies, kennis, stem, telefonie, functies, veldmapping, overdrachtsbestemming of fallback. Niet iedere tekstwijziging vraagt een volledig belprogramma, maar iedere wijziging moet de geraakte laag en risico’s benoemen. Leg vast welke tests groen waren en wat nog niet is onderzocht. Zo blijft “getest” gekoppeld aan een versie en scope in plaats van een blijvend kwaliteitslabel.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik een concrete go-no-go-kaart',
      paragraphs: Object.freeze([
        'Vat het besluit samen per laag: aantal scenario’s uitgevoerd, blockers open, zware bevindingen met tijdelijke grens, bewijs compleet, eigenaar akkoord en regressieset opgeslagen. Voeg afhankelijkheden toe zoals bereikbaarheid van de ontvangende medewerker, geldige testaccounts, actuele kennisbron en een werkende herstelwachtrij. Een route is niet klaar omdat een leverancier alle punten heeft afgevinkt; de aangewezen Softora-klant of proceseigenaar moet het bewijs bij de eigen taak accepteren.',
        Object.freeze({
          text:
            'Softora kan de eerste gespreksroute, testset, systeemgrenzen en menselijke overdracht als één beperkte oplevering ontwerpen. Het doel is niet om perfecte verstaanbaarheid, foutloze acties of gegarandeerde bereikbaarheid te beloven. Het doel is aantoonbaar maken welke scenario’s werken, waar de software stopt en hoe een medewerker fouten kan zien en herstellen. Bespreek via AI telefonist welke ene route genoeg waarde en beheersbaarheid heeft voor een gecontroleerde start.',
          links: Object.freeze([
            Object.freeze({ anchor: 'AI telefonist', href: '/ai-telefonist' }),
          ]),
        }),
      ]),
    }),
  ]),
  faq: Object.freeze([
    Object.freeze({
      question: 'Welke gesprekken moet je vóór livegang testen?',
      answer:
        'Test minimaal de normale taak, ontbrekende of gecorrigeerde informatie, stilte en onderbreken, een vraag buiten scope, een expliciete mensvraag, een mislukte systeemactie en een niet-bereikbare overdrachtsbestemming. Voeg alleen varianten toe met een eigen risico of verwacht bewijs.',
    }),
    Object.freeze({
      question: 'Hoe test je CRM- en agenda-acties zonder echte klantdata?',
      answer:
        'Begin met functie-mocks en vaste testvariabelen. Gebruik daarna een afgeschermde testomgeving met fictieve records en unieke scenario-id’s. Controleer succes, dubbele levering, foutstatus en herstel voordat productierechten of echte klantacties in beeld komen.',
    }),
    Object.freeze({
      question: 'Wie beslist of een AI telefonist klaar is voor gebruik?',
      answer:
        'De aangewezen proceseigenaar neemt het go-no-go-besluit op basis van het vastgelegde bewijs. Technische, data- en ontvangende eigenaren beoordelen hun laag. De bouwer kan herstellen en adviseren, maar hoort het zakelijke risico niet alleen te accepteren.',
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'AI telefonist laten maken', href: '/ai-telefonist' }),
    Object.freeze({ label: 'Wat is een AI telefonist?', href: '/kennisbank/wat-is-een-ai-telefonist' }),
    Object.freeze({ label: 'AI telefonist koppelen aan CRM of agenda', href: '/kennisbank/ai-telefonist-crm-koppeling' }),
    Object.freeze({ label: 'Menselijke overdracht bij AI-telefonie', href: '/blog/ai-telefonie-menselijke-overdracht' }),
    Object.freeze({ label: 'Kosten van een AI telefonist', href: '/blog/ai-telefonist-kosten-mkb' }),
    Object.freeze({ label: 'Voicesoftware op maat', href: '/voicesoftware-op-maat' }),
  ]),
});

module.exports = {
  AI_TELEFONIST_ACCEPTATIE_CONTENT_ITEM,
};
