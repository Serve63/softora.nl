const CHATBOT_HANDOFF_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'wat-is-chatbot-overdracht',
  title: 'Chatbot overdracht naar een medewerker goed inrichten',
  description:
    'Ontwerp chatbot overdracht met duidelijke triggers, bruikbare context, een menselijke eigenaar, eerlijke verwachtingen en herstel als de route niet lukt.',
  category: 'Chatbots',
  intent: 'Uitleg en implementatie',
  qualityVersion: 2,
  primaryIntent: 'Begrijpen en ontwerpen hoe een chatbotgesprek controleerbaar naar een medewerker of opvolgroute gaat',
  buyerTask:
    'Per gesprekstaak vastleggen wanneer de chatbot stopt, welke context mee mag, waar de overdracht landt, wie eigenaar is en welk bewijs gebruiker en team krijgen',
  funnelStage: 'consideration',
  targetMoneyPage: '/chatbot-laten-maken',
  uniqueClusterRole:
    'Leveranciersonafhankelijk overdrachtscontract voor het exacte moment tussen chatbot en mens; de CRM-gids behandelt de latere datawrite, de livechatvergelijking de kanaalkeuze en de offertegids de leveranciersselectie.',
  informationGain:
    'Een achtveldige overdrachtskaart voor trigger, gebruikerssignaal, bevestigde context, bestemming, menselijke eigenaar, reactieverwachting, foutpad en zichtbaar bewijs, plus afzonderlijke tests voor expliciete, impliciete en mislukte overdracht.',
  overlapReview: Object.freeze({
    checkedAt: '2026-08-27',
    closestPaths: Object.freeze([
      '/blog/chatbot-crm-koppeling-leads-opvolgen',
      '/vergelijkingen/chatbot-vs-livechat',
      '/blog/chatbot-offerte-vergelijken',
    ]),
    decision: 'distinct',
    rationale:
      'Deze pagina ontwerpt de realtime grens en verwachting tussen chatbot en mens. De CRM-gids begint bij een al gekozen overdracht, de vergelijking kiest tussen kanalen en de offertegids beoordeelt een leverancier.',
  }),
  sources: Object.freeze([
    Object.freeze({
      title: 'ACM en AP: Opinie over inzet AI-chatbots bij klantenservice',
      url: 'https://www.acm.nl/nl/publicaties/opinie-acm-en-ap-over-inzet-ai-chatbots-bij-klantenservice',
      observedAt: '2026-08-27',
    }),
    Object.freeze({
      title: 'Microsoft Learn: Hand off to a live agent',
      url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-hand-off',
      observedAt: '2026-08-27',
    }),
  ]),
  growthEventKind: 'substantial_refresh',
  growthEventAt: '2026-08-27',
  publishedAt: '2026-07-03',
  updatedAt: '2026-08-27',
  readTime: '9 min',
  image: Object.freeze({
    src: '/assets/seo-content/chatbot-menselijke-overdracht-klantcontact-softora.jpg',
    alt: 'Chatbotgesprek wordt met samenvatting en context overgedragen aan een medewerker voor opvolging.',
    width: 1600,
    height: 1000,
  }),
  summary:
    'Chatbot overdracht is een ontworpen statusovergang: de chatbot stopt op een afgesproken grens, maakt duidelijk wat er gebeurt, draagt alleen bruikbare context over en bevestigt pas menselijke opvolging wanneer de gekozen route die werkelijk heeft aangenomen.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: overdracht is een contract, geen noodzin',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Chatbot overdracht begint wanneer de automatische route niet verder mag of kan en een medewerker de volgende stap bezit. Dat kan een live gesprek, WhatsApp-route, terugbeltaak, mailboxwachtrij of CRM-taak zijn. Wie een chatbot laat maken, hoort daarom niet alleen een knop voor “mens spreken” te vragen, maar een overdrachtscontract met trigger, context, bestemming, eigenaar, verwachting en herstel.',
          links: Object.freeze([
            Object.freeze({ anchor: 'chatbot laat maken', href: '/chatbot-laten-maken' }),
          ]),
        }),
        'Een nette melding is nog geen geslaagde overdracht. De gebruiker moet weten of iemand nu beschikbaar is, later reageert of alleen een verzoek ontvangt. Het team moet tegelijk kunnen zien waarom de chatbot stopte, welke informatie is bevestigd en welke actie openstaat. Zonder die twee kanten ontstaat schijnzekerheid: de bezoeker verwacht hulp terwijl intern geen eigenaar of taak bestaat.',
      ]),
    }),
    Object.freeze({
      heading: 'Vul per route een achtveldige overdrachtskaart in',
      paragraphs: Object.freeze([
        'Leg eerst acht velden vast: trigger, gebruikerssignaal, bevestigde context, bestemming, menselijke eigenaar, reactieverwachting, foutpad en zichtbaar bewijs. De trigger is de regel die de automatische route stopt. Het gebruikerssignaal is wat de bezoeker ziet of vraagt. Bevestigde context is alleen informatie waarvan bron en status duidelijk zijn. De bestemming zegt waar de overdracht werkelijk landt.',
        'De menselijke eigenaar is een rol of wachtrij, niet alleen een algemeen team. De reactieverwachting beschrijft wat nu en later gebeurt zonder een snelheid te beloven die niet is ingericht. Het foutpad bepaalt de uitkomst wanneer livechat gesloten is, WhatsApp niet opent of een taak niet wordt opgeslagen. Zichtbaar bewijs kan een aangenomen chatsessie, taakstatus of referentie zijn. Met deze kaart wordt overdracht testbaar in plaats van een losse feature.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik expliciete en impliciete triggers bewust naast elkaar',
      paragraphs: Object.freeze([
        'Een expliciete trigger ontstaat wanneer de gebruiker zelf om een medewerker vraagt of een onderwerp kiest dat altijd menselijke behandeling vereist. Een impliciete trigger ontstaat bijvoorbeeld na herhaalde onzekerheid, tegenstrijdige broninformatie, een actie buiten de toegestane rechten of een koppeling die niet bevestigt. Voeg daarnaast harde procesgrenzen toe voor klachten, prijsafspraken, gevoelige situaties of een beslissing die Softora niet aan AI wil delegeren.',
        'Microsoft beschrijft in zijn huidige handoffdocumentatie zowel impliciete escalatie wanneer intentie niet wordt herkend als expliciete escalatie vanuit een gekozen onderwerp of mensverzoek. Het platform kan daarbij gesprekshistorie en contextvariabelen meegeven. Dat is nuttige technische broninformatie, geen universele blauwdruk. De proceseigenaar blijft bepalen welke signalen in de eigen situatie overdracht vereisen en welke context noodzakelijk en toegestaan is.',
      ]),
    }),
    Object.freeze({
      heading: 'Geef de medewerker een handoffkaart, geen onleesbaar transcript',
      paragraphs: Object.freeze([
        'Een volledig gesprek lijkt compleet, maar dwingt de medewerker om de vraag opnieuw uit alle tekst te halen. Maak daarom een compacte handoffkaart met kanaal, contactmogelijkheid wanneer die is bevestigd, vraag, gekozen onderwerp, relevante bronpagina, wat al is geprobeerd, open onzekerheid en gewenste vervolgstap. Houd letterlijk bevestigde gegevens apart van een AI-samenvatting of afgeleide categorie.',
        'Stuur het transcript alleen mee wanneer het voor de taak werkelijk nodig en passend is. Een samenvatting kan fouten bevatten en hoort daarom als samenvatting herkenbaar te blijven. Laat een medewerker de oorspronkelijke context kunnen raadplegen als daar een geldige reden voor is, maar maak brede opslag niet automatisch de standaard. De overdracht moet sneller begrip geven zonder extra persoonsgegevens te verzamelen die de volgende stap niet nodig heeft.',
      ]),
    }),
    Object.freeze({
      heading: 'Kies de bestemming op basis van de beloofde vervolgactie',
      paragraphs: Object.freeze([
        'Livechat past wanneer een medewerker werkelijk beschikbaar is en dezelfde sessie kan overnemen. WhatsApp kan een nieuwe contactroute openen, maar is geen bewijs dat het team het verzoek al heeft gelezen. Een mailbox is bruikbaar voor niet-spoedeisende opvolging wanneer onderwerp en eigenaar duidelijk zijn. Een CRM-taak past wanneer de medewerker een geplande actie, status en historie nodig heeft. Kies niet één kanaal omdat de connector toevallig bestaat.',
        Object.freeze({
          text:
            'Wanneer de overdracht een lead of klanttaak in CRM wordt, leg dan minimale velden, duplicatecontrole, eigenaar en foutwachtrij apart vast. De gids over chatbot en CRM koppelen behandelt die technische write en het herstel daarna. Deze pagina blijft eigenaar van het moment ervoor: waarom stopt de chatbot, wat hoort de gebruiker en welke menselijke route mag worden gestart?',
          links: Object.freeze([
            Object.freeze({
              anchor: 'chatbot en CRM koppelen',
              href: '/blog/chatbot-crm-koppeling-leads-opvolgen',
            }),
            Object.freeze({ anchor: 'CRM', href: '/crm-systeem-op-maat' }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Maak beschikbaarheid en verwachting zichtbaar vóór de klik',
      paragraphs: Object.freeze([
        'Een knop “praat met een medewerker” schept de verwachting dat iemand direct aansluit. Toon daarom vooraf of de route live, asynchroon of alleen als terugbelverzoek werkt. Buiten openingstijden hoort de gebruiker een andere, eerlijke keuze te krijgen. Vraag de minimale contactinformatie pas nadat duidelijk is waarvoor die wordt gebruikt en welke opvolging volgt.',
        'Ontwerp ook de toestand na de keuze. Bevestig bijvoorbeeld dat een verzoek is ontvangen en nog moet worden beoordeeld, of dat een medewerker de sessie werkelijk heeft aangenomen. Gebruik woorden als verbonden, ingepland of verzonden alleen wanneer het leidende systeem dat heeft bevestigd. Een animatie of succesmelding aan de voorkant mag geen bedrijfsuitkomst verzinnen die achter de schermen nog onzeker is.',
      ]),
    }),
    Object.freeze({
      heading: 'Bewaar tussenstatussen zodat een mislukte route herstelbaar blijft',
      paragraphs: Object.freeze([
        'Gebruik minimaal afzonderlijke statussen voor overdracht gevraagd, context gereed, bestemming aangeboden, aangenomen, afgerond en mislukt. Een livechat kan worden aangeboden maar niet aangenomen. Een CRM-write kan technisch slagen terwijl geen eigenaar is toegewezen. Een WhatsApp-link kan openen zonder dat een bericht wordt verzonden. Door die stappen niet samen te voegen, ziet het team waar herstel nodig is.',
        'Leg per mislukte status één veilige actie vast: opnieuw aanbieden, een alternatieve contactroute tonen, een menselijke taak maken of de gebruiker eerlijk vragen later contact op te nemen. Voorkom eindeloze automatische retries en dubbele taken. Bewaar een stabiele overdrachts-ID zodat hetzelfde gesprek niet bij iedere herhaalpoging als nieuwe lead of nieuw verzoek wordt aangemaakt.',
      ]),
    }),
    Object.freeze({
      heading: 'Houd menselijk contact bereikbaar zonder juridische garanties te verzinnen',
      paragraphs: Object.freeze([
        'ACM en de Autoriteit Persoonsgegevens schreven dat organisaties naast een AI-chatbot een mogelijkheid voor menselijk contact moeten bieden, regie moeten houden over verstrekte informatie en duidelijk moeten maken dat de gebruiker met een AI-systeem communiceert. Vertaal dat praktisch naar een zichtbare mensroute, inhoudseigenaarschap en een eerlijke opening. Deze pagina beoordeelt geen specifieke wettelijke positie of sectorsituatie.',
        'Bepaal daarnaast wie bronnen goedkeurt, wie overdrachtsregels wijzigt en wie incidenten beoordeelt. Een menselijke route beschermt de gebruiker alleen wanneer zij bemand, getest en herstelbaar is. Doe geen belofte over directe beschikbaarheid van een medewerker. Leg vast welke keuze de gebruiker krijgt bij drukte, buiten openingstijden en wanneer de normale route tijdelijk uitvalt.',
      ]),
    }),
    Object.freeze({
      heading: 'Test de succesroute, grens en storing afzonderlijk',
      paragraphs: Object.freeze([
        'Test minimaal een expliciet mensverzoek, herhaalde onzekerheid, een onderwerp dat menselijk besluit vereist, een gebruiker zonder contactgegevens, livechat buiten openingstijden, een dubbele aanvraag en een mislukte CRM- of mailboxactie. Noteer per scenario de zichtbare boodschap, overgedragen velden, bestemming, eigenaar, status en herstelactie. Laat de proceseigenaar bepalen welke afwijkingen livegang blokkeren.',
        Object.freeze({
          text:
            'Vergelijk ook chatbot en livechat op het werkelijke serviceproces. Een chatbot kan voorbereiden wanneer antwoorden herhaalbaar zijn; livechat is sterker wanneer een medewerker direct nuance moet geven. De acceptatie gaat niet om een vloeiende demo, maar om bewijs dat de juiste route wordt gekozen en dat de gebruiker niet tussen systemen verdwijnt.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'chatbot en livechat',
              href: '/vergelijkingen/chatbot-vs-livechat',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Meet overdracht als proces, niet als verzonnen conversie',
      paragraphs: Object.freeze([
        'Meet hoeveel overdrachten worden gevraagd, hoeveel contextkaarten compleet zijn, welke bestemmingen worden aangeboden, hoeveel routes werkelijk worden aangenomen, hoeveel mislukken en hoe lang een taak zonder eigenaar blijft. Kijk ook naar herhaald contact over dezelfde vraag en gevallen waarin een medewerker de samenvatting moet corrigeren. Deze signalen helpen de overdracht verbeteren zonder te doen alsof ieder verzoek een gekwalificeerde lead is.',
        'Koppel pas een commerciële uitkomst wanneer leaddefinitie, bron en menselijke beoordeling betrouwbaar worden vastgelegd. Een geopende WhatsApp-route is geen gesprek; een CRM-record is geen gekwalificeerde lead; een snelle reactie bewijst geen omzet. Houd technische levering, menselijke opvolging en latere bedrijfsuitkomst als aparte meetstappen. Dat voorkomt mooie dashboards met een causale claim die de data niet ondersteunt.',
      ]),
    }),
    Object.freeze({
      heading: 'Start met één overdrachtsroute die het team echt kan bezitten',
      paragraphs: Object.freeze([
        'Kies voor de eerste versie één klanttaak, één overdrachtstrigger, één bestemming en één menselijke eigenaar. Neem een normaal gesprek, een grensgeval en een storing door. Breid pas uit naar extra kanalen of afdelingen wanneer het team de context begrijpt, taken worden opgepakt en mislukte routes zichtbaar worden hersteld. Een kleine betrouwbare overdracht is waardevoller dan vijf kanalen zonder eigenaarschap.',
        Object.freeze({
          text:
            'Neem naar een gesprek met Softora één voorbeeld mee: wat vraagt de bezoeker, wanneer moet de chatbot stoppen, welke context mag mee en wie hoort daarna wat te doen? Daarmee kan Softora de chatbotroute, menselijke grens en systeemkoppeling afbakenen. Bekijk chatbot laten maken wanneer je deze overdracht als een controleerbare eerste scope wilt uitwerken zonder automatische resultaatbelofte.',
          links: Object.freeze([
            Object.freeze({ anchor: 'chatbot laten maken', href: '/chatbot-laten-maken' }),
          ]),
        }),
      ]),
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
    Object.freeze({ label: 'Chatbot en CRM koppelen', href: '/blog/chatbot-crm-koppeling-leads-opvolgen' }),
    Object.freeze({ label: 'Chatbot of livechat', href: '/vergelijkingen/chatbot-vs-livechat' }),
    Object.freeze({ label: 'Chatbot-offertes vergelijken', href: '/blog/chatbot-offerte-vergelijken' }),
    Object.freeze({ label: 'Wat kost een chatbot?', href: '/blog/chatbot-kosten-mkb' }),
    Object.freeze({ label: 'Menselijke overdracht bij AI-telefonie', href: '/blog/ai-telefonie-menselijke-overdracht' }),
  ]),
});

module.exports = {
  CHATBOT_HANDOFF_CONTENT_ITEM,
};
