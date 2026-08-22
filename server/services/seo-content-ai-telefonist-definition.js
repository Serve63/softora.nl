const AI_TELEFONIST_DEFINITION_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'wat-is-een-ai-telefonist',
  title: 'Wat is een AI telefonist en wat kan die verantwoord doen?',
  description:
    'Begrijp hoe een AI telefonist luistert, antwoordt, acties voorbereidt en overdraagt, en baken taak, bewijs, systeemactie en menselijke grens af.',
  category: 'AI telefonie',
  intent: 'Uitleg en keuze',
  qualityVersion: 2,
  primaryIntent: 'Begrijpen wat een AI telefonist technisch en operationeel is en bepalen welke eerste telefoontaak verantwoord af te bakenen is',
  buyerTask:
    'Een concrete telefoonroute beoordelen op gesprekstaak, benodigde informatie, toegestane uitkomst, systeemactie, menselijke grens en zichtbaar afrondingsbewijs voordat software of een leverancier wordt gekozen',
  funnelStage: 'consideration',
  targetMoneyPage: '/ai-telefonist',
  uniqueClusterRole:
    'Leveranciersonafhankelijke definitie- en afbakeningsgids voor de volledige gespreksketen; de afspraakintakepagina behandelt één toepassing, de kostengids de begroting, de CRM-gids de levering na het gesprek en de overdrachtspagina de grens naar een medewerker.',
  informationGain:
    'Een zesveldige gesprekskaart voor taak, benodigde informatie, toegestane uitkomst, systeemactie, menselijke grens en afrondingsbewijs, gekoppeld aan de vijf technische lagen van lijn, spraak, gesprekslogica, integratie en menselijk herstel.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Twilio Docs: Media Streams Overview',
      url: 'https://www.twilio.com/docs/voice/media-streams',
      observedAt: '2026-08-22',
    }),
    Object.freeze({
      title: 'Retell AI Docs: Webhooks overview',
      url: 'https://docs.retellai.com/features/webhook-overview',
      observedAt: '2026-08-22',
    }),
    Object.freeze({
      title: 'Google Calendar API: Create events',
      url: 'https://developers.google.com/workspace/calendar/api/guides/create-events',
      observedAt: '2026-08-22',
    }),
    Object.freeze({
      title: 'European Commission: Guidelines for transparency obligations for AI systems',
      url: 'https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems',
      observedAt: '2026-08-22',
    }),
    Object.freeze({
      title: 'AI Receptionisten: live test and appointment buyer language',
      url: 'https://ai-receptionisten.nl/',
      observedAt: '2026-08-22',
    }),
    Object.freeze({
      title: 'Voicelabs: virtual receptionist buyer language',
      url: 'https://voicelabs.nl/virtuele-receptionist',
      observedAt: '2026-08-22',
    }),
  ]),
  growthEventKind: 'substantial_refresh',
  growthEventAt: '2026-08-22',
  publishedAt: '2026-05-20',
  updatedAt: '2026-08-22',
  readTime: '10 min',
  summary:
    'Een AI telefonist is een begrensde softwareketen die live telefoonaudio verwerkt, een ingerichte gesprekstaak uitvoert, informatie controleert en een afgesproken vervolgactie voorbereidt of start. De oplossing is pas bruikbaar wanneer ook duidelijk is wat zij niet beslist, welk bewijs het team ontvangt en wanneer een medewerker het gesprek of herstel overneemt.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: vijf technische lagen rond één gesprekstaak',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een AI telefonist is geen digitale medewerker met onbeperkt inzicht. Het is een samenstelling van een telefoonlijn, live spraakverwerking, ingerichte gesprekslogica, eventuele koppelingen en een menselijke overdrachts- of herstelroute. Die lagen voeren samen één of meer vooraf gekozen telefoontaken uit. Op AI telefonist laten maken staat de commerciële route; deze kennisbankpagina helpt eerst vaststellen welke taak en grens je eigenlijk wilt inkopen.',
          links: Object.freeze([
            Object.freeze({ anchor: 'AI telefonist laten maken', href: '/ai-telefonist' }),
          ]),
        }),
        'De techniek kan bijvoorbeeld een oproep aannemen, het doel van de beller uitvragen, ontbrekende gegevens opvragen, een antwoord uit een goedgekeurde bron formuleren en een terugbelverzoek vastleggen. Dat betekent niet dat ieder gesprek automatisch mag eindigen. Bij twijfel, gevoelige onderwerpen, een onbeschikbare koppeling of een verzoek buiten de afgesproken taak hoort een duidelijke stop- of overdrachtsroute.',
      ]),
    }),
    Object.freeze({
      heading: 'Zo loopt een gesprek van telefoonlijn naar antwoord',
      paragraphs: Object.freeze([
        'De inkomende lijn levert het gesprek als audio aan de spraaklaag. Die zet het geluid om in bruikbare gesprekseenheden, houdt rekening met beurtwisseling en geeft de gesprekslogica genoeg context om een volgende vraag of reactie te kiezen. Daarna wordt het antwoord weer als spraak naar de beller gestuurd. Vertraging, onderbrekingen, stilte, achtergrondgeluid, uitspraak en wisselende formuleringen beïnvloeden deze route en moeten daarom in echte telefoontests worden meegenomen.',
        'Twilio beschrijft Media Streams als het in bijna realtime ontvangen en versturen van ruwe telefoonaudio via WebSockets. Dat is een technisch bouwdeel, geen bewijs dat een complete klanttaak betrouwbaar werkt. De kwaliteit van het gesprek hangt ook af van de gekozen instructies, kennis, toegestane acties, foutafhandeling en overdracht. Vraag een leverancier daarom niet alleen welke stem of modelnaam wordt gebruikt, maar hoe de hele keten op jouw scenario wordt getest en bewaakt.',
      ]),
    }),
    Object.freeze({
      heading: 'Vul vóór een demo een zesveldige gesprekskaart in',
      paragraphs: Object.freeze([
        'Beschrijf voor iedere gewenste route zes velden: gesprekstaak, benodigde informatie, toegestane uitkomst, systeemactie, menselijke grens en afrondingsbewijs. De taak kan zijn openingstijden beantwoorden, een storing rubriceren, een terugbelverzoek opnemen of een afspraakaanvraag voorbereiden. Benodigde informatie zijn alleen de gegevens die voor die taak echt nodig zijn. De toegestane uitkomst zegt of de telefonist informeert, voorstelt, registreert, doorverbindt of daadwerkelijk iets wijzigt.',
        'De systeemactie benoemt waar de uitkomst terechtkomt en welke rechten daarvoor nodig zijn. De menselijke grens legt vast wanneer de software stopt, terugvraagt of overdraagt. Het afrondingsbewijs vertelt wat de beller en het team zien: bijvoorbeeld een referentie, samenvatting, taakstatus of nog te bevestigen tijdvoorstel. Met deze kaart worden twee demo’s vergelijkbaar; een soepel gesprek zonder controleerbare uitkomst is dan niet langer genoeg.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak onderscheid tussen informeren, voorbereiden en beslissen',
      paragraphs: Object.freeze([
        'Informeren is het beantwoorden van een vraag uit aangewezen en actuele bronnen. Voorbereiden betekent dat de telefonist gegevens verzamelt, een concept of voorstel maakt en een medewerker of systeem de definitieve stap laat bevestigen. Beslissen betekent dat de software zelf een uitkomst kiest met gevolgen voor de beller. Die drie niveaus vragen andere kennis, rechten, controles en foutpaden. Zet ze niet onder één algemene claim dat de telefonist “alles afhandelt”.',
        Object.freeze({
          text:
            'Afspraakintake laat dit verschil goed zien. De telefonist kan alleen voorkeursmomenten verzamelen, beschikbare tijden lezen, één tijdelijk voorstel doen of werkelijk een afspraak aanmaken. Bij AI automatisering hoort iedere vervolgstap een expliciete eigenaar en herstelroute te hebben. Deze definitiepagina blijft breder en helpt eerst bepalen welk handelingsniveau bij iedere telefoontaak past.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'AI automatisering',
              href: '/ai-automatisering',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Koppelingen maken van een gesprek een bedrijfsproces',
      paragraphs: Object.freeze([
        'Na het gesprek kan een gebeurtenis een taak, CRM-notitie, agenda-actie of waarschuwing starten. Retell documenteert onder meer gebeurtenissen voor gesprek gestart, beëindigd, geanalyseerd en verschillende fasen van overdracht. De documentatie vermeldt ook retries wanneer een webhook niet tijdig succesvol wordt ontvangen. Een ontvangend systeem moet daarom afzendercontrole, dubbele levering, time-outs en herstel ontwerpen; alleen een webhook instellen maakt de opvolging nog niet betrouwbaar.',
        Object.freeze({
          text:
            'Leg per koppeling vast welk systeem leidend is, welke velden worden gelezen of geschreven, welke identiteit de actie uitvoert en wat bij een gedeeltelijke fout gebeurt. Bij een CRM-systeem op maat horen gebeurtenissleutel, duplicatecontrole en een menselijke herstelwachtrij onderdeel van de acceptatie te zijn. De verdiepende gids over AI telefonie koppelen aan CRM of agenda werkt dit contract uit. Houd op deze pagina de hoofdregel vast: het gesprek is pas afgerond wanneer de beloofde vervolgstatus aantoonbaar bestaat of eerlijk als herstelwerk is gemarkeerd.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'CRM-systeem op maat',
              href: '/crm-systeem-op-maat',
            }),
            Object.freeze({
              anchor: 'AI telefonie koppelen aan CRM of agenda',
              href: '/kennisbank/ai-telefonist-crm-koppeling',
              availableFrom: '2026-08-18',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Een agenda-afspraak vraagt meer dan een vrij tijdvak vinden',
      paragraphs: Object.freeze([
        'Een afspraakroute moet eerst bepalen welke agenda leidend is, welke duur en buffers gelden, welke medewerkers of locaties geschikt zijn en welke gegevens nodig zijn. Beschrijf daarna of de beller een voorstel, reservering of bevestigde afspraak krijgt. Test wat er gebeurt wanneer het tijdvak tijdens het gesprek bezet raakt, de beller een ander e-mailadres noemt, de bevestiging niet kan worden verstuurd of dezelfde actie na een time-out opnieuw binnenkomt.',
        'Google Calendar documenteert dat een toepassing bij het aanmaken van een event een eigen event-ID kan kiezen en noemt dit als manier om dubbele creatie te voorkomen wanneer een bewerking na uitvoering lijkt te mislukken. De API maakt ook onderscheid tussen deelnemers toevoegen en updates versturen. Vertaal zulke technische mogelijkheden naar een zichtbaar afspraakcontract: unieke aanvraag, actuele beschikbaarheidscontrole, controleerbare bevestiging en een eigenaar voor conflicten of wijzigingen.',
      ]),
    }),
    Object.freeze({
      heading: 'Menselijke overdracht is een ontworpen route, geen noodzin',
      paragraphs: Object.freeze([
        'Bepaal vooraf welke signalen tot overdracht leiden: de beller vraagt om een medewerker, de taak valt buiten scope, noodzakelijke informatie blijft onzeker, een gevoelige beslissing is nodig, de koppeling faalt of de gesprekskwaliteit wordt te laag. Leg vast waarheen wordt overgedragen, welke openingstijden gelden, welke context de medewerker ontvangt en wat de beller hoort wanneer niemand beschikbaar is. Een warme overdracht heeft andere acceptatiecriteria dan een terugbeltaak.',
        Object.freeze({
          text:
            'Bij voicesoftware op maat hoort het beslismoment voor menselijke overdracht samen met de context voor de medewerker te worden ontworpen. De gids over menselijke overdracht werkt de acceptatie van die route verder uit. Vraag bij selectie ook hoe een mislukte transfer wordt waargenomen en hersteld. Retell onderscheidt bijvoorbeeld gestart, verbonden, geannuleerd en beëindigd bij overdrachtsgebeurtenissen. Die statussen zijn pas nuttig wanneer iemand of een workflow eigenaar is van de geannuleerde route; een technisch event zonder opvolging beschermt de beller niet.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'voicesoftware op maat',
              href: '/voicesoftware-op-maat',
            }),
            Object.freeze({
              anchor: 'gids over menselijke overdracht',
              href: '/blog/ai-telefonie-menselijke-overdracht',
              availableFrom: '2026-07-02',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Wees transparant en verzamel niet automatisch alles',
      paragraphs: Object.freeze([
        'Laat de opening eerlijk maken dat de beller met een geautomatiseerde assistent spreekt en wat het doel van het gesprek is. De Europese Commissie heeft richtlijnen gepubliceerd over de reikwijdte van transparantieverplichtingen voor aanbieders en gebruikers van AI-systemen onder artikel 50 van de AI-verordening. Welke wettelijke verplichtingen in een concreet gesprek gelden, vraagt een eigen deskundige beoordeling; deze uitleg beoordeelt jouw specifieke positie niet. Een duidelijke opening is daarnaast gewoon een betere basis voor vertrouwen en een bewuste keuze om door te gaan of een mens te vragen.',
        'Bepaal per taak welke persoonsgegevens nodig zijn, waar zij terechtkomen, wie toegang heeft en hoe lang opname, transcript, samenvatting en technische logs worden bewaard. Maak opname niet automatisch de standaard wanneer een kort taakresultaat volstaat. Gebruik passende testgegevens en vermijd echte klantacties in een simulatie. Een leverancier die veel data kan opslaan, bewijst daarmee niet dat die opslag voor jouw doel nodig of verantwoord is.',
      ]),
    }),
    Object.freeze({
      heading: 'Test normaal gesprek, grensgeval en herstel afzonderlijk',
      paragraphs: Object.freeze([
        'Maak per gesprekskaart minimaal een normaal scenario, een grensgeval en een mislukt scenario. Test verschillende formuleringen, onderbreken, stilte, achtergrondgeluid, onvolledige gegevens, een onverwachte vraag en een onbereikbare koppeling. Noteer per scenario de verwachte gesproken reactie, verzamelde velden, systeemstatus, melding aan het team en eventuele overdracht. Laat de proceseigenaar bepalen welke afwijkingen een livegang blokkeren.',
        'Een live demo met één ingestudeerde vraag is vraagbewijs, geen acceptatiebewijs. Vraag om herhaalbare scenario’s, een lijst bekende beperkingen, een regressieset na wijzigingen en zicht op fouten na livegang. Meet niet alleen of gesprekken worden aangenomen, maar ook taakafronding, ontbrekende gegevens, verkeerde routering, dubbele acties, herstelduur en hoeveel gesprekken alsnog door een mens moeten worden gecorrigeerd.',
      ]),
    }),
    Object.freeze({
      heading: 'Kies een eerste taak die klein genoeg is om eerlijk te beoordelen',
      paragraphs: Object.freeze([
        'Een geschikte eerste taak komt vaak voor, heeft een duidelijke eigenaar, gebruikt actuele bronnen en kan met een beperkt aantal uitkomsten eindigen. Openingstijden, een terugbelverzoek of een strak afgebakende afspraakaanvraag zijn beter te beoordelen dan klachten, uitzonderlijke prijsafspraken en meerdere bedrijfsprocessen in één gesprek. Wanneer iedere beller maatwerkoverleg nodig heeft, kan een goede routering naar een mens waardevoller zijn dan meer automatisering.',
        Object.freeze({
          text:
            'Neem naar een eerste scopegesprek één echte telefoonroute mee: de startvraag, verplichte informatie, toegestane uitkomst, twee lastige uitzonderingen, gewenste systeemstatus en menselijke eigenaar. Softora kan daarmee gesprek, koppeling, overdracht en testgrens afbakenen. Bekijk daarna de pakketten om de gekozen taak langs een concrete scope, investering en vorm van begeleiding te leggen zonder een resultaatgarantie te verzinnen.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'pakketten',
              href: '/pakketten',
            }),
          ]),
        }),
      ]),
    }),
  ]),
  faq: Object.freeze([
    Object.freeze({
      question: 'Wat kan een AI telefonist doen?',
      answer:
        'Een goed afgebakende AI telefonist kan gesprekken aannemen, vragen stellen, informatie uit aangewezen bronnen geven, gegevens structureren en een afgesproken vervolgactie voorbereiden of starten. Wat verantwoord is, hangt af van taak, rechten, bewijs, uitzonderingen en menselijke controle.',
    }),
    Object.freeze({
      question: 'Kan een AI telefonist zelf afspraken inplannen?',
      answer:
        'Technisch kan een agenda-actie mogelijk zijn, maar leg eerst vast of de telefonist alleen voorkeuren verzamelt, vrije tijden leest, een voorstel reserveert of definitief boekt. Beschikbaarheid, dubbele acties, bevestiging, wijzigen, annuleren en menselijk herstel moeten afzonderlijk zijn ontworpen en getest.',
    }),
    Object.freeze({
      question: 'Wanneer moet een AI telefonist een medewerker inschakelen?',
      answer:
        'Onder meer wanneer de beller daarom vraagt, de taak buiten scope valt, informatie onvoldoende zeker is, een gevoelige beslissing nodig is, de gesprekskwaliteit te laag wordt of een koppeling faalt. Leg ook vast wat gebeurt wanneer de medewerker niet bereikbaar is.',
    }),
    Object.freeze({
      question: 'Wanneer is een AI telefonist interessant voor mijn bedrijf?',
      answer:
        'Wanneer een terugkerende telefoontaak een duidelijke eigenaar, beperkte uitkomsten, actuele informatie en een toetsbare menselijke terugvalroute heeft. Begin niet bij de stem of demo, maar bij een gesprekskaart en acceptatiescenario\'s voor één concrete route.',
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'AI telefonist laten maken', href: '/ai-telefonist' }),
    Object.freeze({ label: 'AI telefonist voor afspraakintake', href: '/blog/ai-telefonist-voor-afspraakintake', availableFrom: '2026-05-29' }),
    Object.freeze({ label: 'AI telefonie koppelen aan CRM of agenda', href: '/kennisbank/ai-telefonist-crm-koppeling', availableFrom: '2026-08-18' }),
    Object.freeze({ label: 'gids over menselijke overdracht', href: '/blog/ai-telefonie-menselijke-overdracht', availableFrom: '2026-07-02' }),
    Object.freeze({ label: 'Kosten van een AI telefonist', href: '/blog/ai-telefonist-kosten-mkb', availableFrom: '2026-08-17' }),
    Object.freeze({ label: 'AI telefonist vs receptionist', href: '/vergelijkingen/ai-telefonist-vs-receptionist' }),
  ]),
});

module.exports = {
  AI_TELEFONIST_DEFINITION_CONTENT_ITEM,
};
