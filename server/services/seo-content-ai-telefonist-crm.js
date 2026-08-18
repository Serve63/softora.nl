const AI_TELEFONIST_CRM_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'ai-telefonist-crm-koppeling',
  title: 'AI telefonist koppelen aan CRM of agenda',
  description:
    'Bepaal welke gespreksuitkomsten naar CRM of agenda gaan, welke velden leidend zijn en hoe je dubbele, mislukte en onzekere acties herstelt.',
  category: 'AI telefonie',
  intent: 'Integratie',
  qualityVersion: 2,
  primaryIntent: 'Een AI-telefonistkoppeling met CRM of agenda veilig afbakenen en accepteren',
  buyerTask:
    'Vastleggen welk gespreksevent welke minimale gegevens mag doorzetten, hoe dubbele levering wordt voorkomen en wanneer een medewerker een CRM- of agenda-actie controleert of herstelt',
  funnelStage: 'consideration',
  targetMoneyPage: '/ai-telefonist',
  uniqueClusterRole:
    'Integratie- en herstelgids voor de route tussen een afgerond telefoongesprek en gecontroleerde opvolging in CRM of agenda, los van algemene CRM-integratie, kosten, afspraakintake en menselijke gespreksoverdracht.',
  informationGain:
    'Een leveranciersneutrale gespreksuitkomstkaart die eventkeuze, minimale veldmapping, leidend systeem, unieke gebeurtenissleutel, schrijfbevoegdheid, agenda-conflictcontrole, retry, herstelwachtrij en menselijke acceptatie in een toetsbare route samenbrengt.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Retell AI Docs: Retell webhooks overview',
      url: 'https://docs.retellai.com/features/webhook-overview',
      observedAt: '2026-08-18',
    }),
    Object.freeze({
      title: 'Retell AI Docs: Secure the webhook',
      url: 'https://docs.retellai.com/features/secure-webhook',
      observedAt: '2026-08-18',
    }),
    Object.freeze({
      title: 'NeemtOp: AI-telefoniste voor MKB',
      url: 'https://www.neemtop.nl/',
      observedAt: '2026-08-18',
    }),
    Object.freeze({
      title: 'Next Telecom: AI Telefoniste',
      url: 'https://next-telecom.nl/ai-telefoniste',
      observedAt: '2026-08-18',
    }),
  ]),
  growthEventKind: 'new_url',
  growthEventAt: '2026-08-18',
  publishedAt: '2026-08-18',
  updatedAt: '2026-08-18',
  visualQualityVersion: 2,
  visualBrief: Object.freeze({
    hero: Object.freeze({
      role: 'representative',
      visualType: 'editorial-scene',
      visualFamily: 'documentary-call-routing-workbench',
      composition:
        'Brede documentaire werkbanksituatie waarin een medewerker één gesprekskaart controleert voordat deze naar een CRM-bak, agenda-overzicht of rode herstelbak gaat.',
      informationGoal:
        'Verbeeld dat een gespreksuitkomst pas na een zichtbare controle een bedrijfsactie wordt en dat een menselijke herstelroute naast CRM en agenda bestaat.',
      differenceFromRecent:
        'Menselijke handeling in een tactiele operationele scène met donkere werkbank en fysieke routering, zonder witte isometrische tegels, zwevende dashboards, akoestische testbank of losse voorstelmappen.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: true,
    }),
    support: Object.freeze({
      role: 'explanatory',
      visualType: 'process-diagram',
      visualFamily: 'swiss-stepped-recovery-signal-map',
      composition:
        'Asymmetrische getrapte signaalroute op een donker kersenrood veld: gesprek, afzendercontrole, minimale velden en duplicatecontrole leiden naar CRM of agenda, terwijl een mintgroene lus twijfel naar menselijk herstel terugvoert.',
      informationGoal:
        'Laat zien dat validatie, deduplicatie en herstel vóór de schrijfactie horen en dat mislukte of onzekere uitkomsten gecontroleerd terugkeren.',
      differenceFromRecent:
        'Contrastrijke Zwitserse signaleringsposter met een getrapte witte route en mintgroene herstelboog, zonder crèmekleurige horizontale rij, fotografie, 3D, dashboard, stadsplattegrond of donkere lijntekening.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: false,
    }),
  }),
  image: Object.freeze({
    src: '/assets/seo-content/ai-telefonist-crm-routering-softora.jpg',
    alt: 'Medewerker controleert een gesprekskaart voordat de uitkomst naar CRM, agenda of een rode herstelbak gaat.',
    width: 1600,
    height: 900,
    sourceType: 'trainedAlgorithmicMedia',
  }),
  secondaryImage: Object.freeze({
    src: '/assets/seo-content/ai-telefonist-crm-herstelroute-softora.jpg',
    alt: 'Procesroute van telefoongesprek via afzender-, veld- en duplicatecontrole naar CRM of agenda met een aparte menselijke herstelroute.',
    width: 1600,
    height: 900,
    sourceType: 'trainedAlgorithmicMedia',
    caption:
      'Laat alleen een gevalideerde, unieke uitkomst schrijven; stuur twijfel en fouten met context naar een eigenaar die kan herstellen of afwijzen.',
  }),
  summary:
    'Koppel een AI telefonist niet rechtstreeks aan elk beschikbaar CRM-veld. Kies per gesprekstaak één bruikbaar event, een minimale veldset, een unieke gebeurtenissleutel en een begrensde actie. Laat twijfel, dubbele levering en mislukte acties zichtbaar naar een menselijke herstelwachtrij gaan.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: koppel een uitkomst, geen volledig gesprek',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een bruikbare koppeling begint met één zakelijke uitkomst, bijvoorbeeld een terugbelverzoek registreren, een bestaande contactkaart aanvullen of een afspraakvoorstel klaarzetten. Schrijf niet automatisch ieder transcript, iedere modelinschatting en ieder herkend detail naar CRM. Op AI telefonist laten maken staat de commerciële route; deze gids helpt om de gegevensroute erachter controleerbaar af te bakenen.',
          links: Object.freeze([
            Object.freeze({ anchor: 'AI telefonist laten maken', href: '/ai-telefonist' }),
          ]),
        }),
        'Beschrijf vóór de techniek wat na een geslaagd gesprek zichtbaar moet zijn, wie dat resultaat gebruikt en welke beslissing nog bij een medewerker blijft. De AI mag bijvoorbeeld een samenvatting en voorgestelde vervolgtaak opleveren, terwijl een medewerker de juiste klant, urgentie of definitieve afspraak bevestigt. Zo wordt de koppeling een begrensde werkroute in plaats van een brede belofte dat ieder gesprek vanzelf goed wordt verwerkt.',
      ]),
    }),
    Object.freeze({
      heading: 'Begin met één gesprekstaak en één toegestaan resultaat',
      paragraphs: Object.freeze([
        'Kies eerst een route die vaak genoeg voorkomt om te testen en weinig schade veroorzaakt wanneer de automatisering stopt. Een terugbelverzoek voor verkoop kan bijvoorbeeld eindigen in een CRM-taak met naam, telefoonnummer, onderwerp, beschikbaar moment en bron. Een klacht, medische vraag, prijsafspraak of wijziging met financiële gevolgen vraagt een andere grens en hoort niet stilzwijgend dezelfde automatische schrijfrechten te krijgen.',
        Object.freeze({
          text:
            'Leg voor afspraakintake apart vast of de telefonist alleen gegevens verzamelt, vrije tijden leest, een tijdelijk voorstel plaatst of werkelijk boekt. De bestaande gids over afspraakintake behandelt de vragen en gesprekgrenzen; deze integratiepagina begint waar het gesprek eindigt en bepaalt welke systeemactie daarna verantwoord en herstelbaar is.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'gids over afspraakintake',
              href: '/blog/ai-telefonist-voor-afspraakintake',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Kies het event dat bij de volgende actie past',
      paragraphs: Object.freeze([
        'Een telefonieplatform kan meerdere gebeurtenissen leveren. De actuele Retell-documentatie onderscheidt onder meer call_started, call_ended, call_analyzed en overdrachtsevents. Een call_ended-event kan geschikt zijn om de technische gespreksstatus vast te leggen; een call_analyzed-event bevat pas de analyse-uitkomst. Wacht dus niet op analyse wanneer alleen een technische eindstatus nodig is en start geen CRM-besluit op een startevent dat nog geen gespreksuitkomst kent.',
        'Leg per route één start-event vast met de vereiste status. Noteer ook welke latere gebeurtenis dezelfde record mag aanvullen. Events kunnen in volgorde worden verstuurd zonder elkaar te blokkeren; een fout op het ene event voorkomt niet vanzelf dat een volgend event aankomt. De ontvangende route moet daarom iedere levering zelfstandig herkennen en mag een latere update niet verwarren met een tweede lead of afspraak.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak een minimale veldmapping met bron en beslisstatus',
      paragraphs: Object.freeze([
        'Maak per uitkomst een veldkaart met: veldnaam, bron, verplicht of optioneel, toegestane waarde, doelsysteem, doelveld, bewerking, eigenaar en gedrag bij ontbreken. Een terugbeltaak kan bijvoorbeeld het telefoonnummer uit de telefonielaag nemen, het onderwerp uit een gecontroleerde categorie en de samenvatting als voorstel opslaan. Een door AI afgeleide urgentie blijft herkenbaar als voorstel totdat een medewerker of vaste procesregel haar bevestigt.',
        Object.freeze({
          text:
            'Wijs per gegeven één leidend systeem aan. CRM kan eigenaar en verkoopfase beheren, terwijl de agenda de bezetting en afspraakstatus bepaalt. De algemene uitleg over een CRM-integratie helpt om richting, identifiers, rechten en foutafhandeling voor alle systeemkoppelingen vast te leggen. Deze route voegt daar de telefonie-events en gespreksuitkomst aan toe.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'uitleg over een CRM-integratie',
              href: '/kennisbank/wat-is-een-crm-integratie',
            }),
          ]),
        }),
        'Neem alleen gegevens op die de volgende taak werkelijk nodig heeft. Een volledig transcript in CRM kan zoeken en controleren juist moeilijker maken en vergroot de gegevenslast. Bewaar waar nodig een veilige verwijzing naar de bron en laat bewaartermijnen, opnames, toestemming en gevoelige gegevens beoordelen door de verantwoordelijke specialist. Deze pagina biedt technisch en operationeel ontwerp, geen juridisch oordeel.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik een unieke gebeurtenissleutel vóór je schrijft',
      paragraphs: Object.freeze([
        'Webhooks kunnen opnieuw worden aangeboden wanneer de ontvanger niet snel genoeg bevestigt. Retell noemt een timeout van tien seconden en maximaal drie retries wanneer geen succesvolle 2xx-status terugkomt. Daardoor kan exact dezelfde gebeurtenis meer dan één keer bij de integratie arriveren. Zonder duplicatecontrole kunnen één gesprek en één beller meerdere contacten, taken of afspraken veroorzaken.',
        'Maak de consument idempotent. Voor een lifecycle-event is de combinatie van eventtype en call-id een bruikbare unieke sleutel; voor meerdere overdrachtspogingen kan ook de starttijd en bestemming nodig zijn. Sla de sleutel op vóór de externe schrijfactie of in dezelfde gecontroleerde transactie. Wanneer dezelfde sleutel terugkomt, geef de eerder bekende uitkomst terug in plaats van opnieuw te schrijven.',
        'Houd recordherkenning apart van gebeurtenisherkenning. De eventsleutel voorkomt dat dezelfde levering dubbel wordt uitgevoerd; de klantmatch bepaalt of een nieuw of bestaand CRM-record hoort bij de beller. Een telefoonnummer kan gedeeld of gewijzigd zijn. Laat nul, één en meerdere matches daarom verschillend afhandelen en zet twijfel niet automatisch om in een samenvoeging.',
      ]),
    }),
    Object.freeze({
      heading: 'Laat CRM en agenda niet dezelfde waarheid beheren',
      paragraphs: Object.freeze([
        'Bepaal voor iedere schrijfactie welk systeem leidend is. CRM kan de contactpersoon, herkomst en opvolgtaak beheren; de agenda beheert beschikbare tijden, reserveringsstatus en wijzigingen. Sla een agenda-id na een geslaagde actie terug op in CRM, zodat een latere wijziging dezelfde afspraak kan vinden. Gebruik niet alleen naam en datum als zoekcombinatie, want die zijn niet stabiel genoeg voor herstel.',
        'Maak onderscheid tussen lezen, voorstellen en definitief schrijven. Een veilige eerste versie kan vrije tijden lezen en een afspraakvoorstel met vervaltijd opslaan. Direct boeken past pas wanneer identiteit, tijdzone, beschikbaarheid, verplichte velden, bevestiging door de beller en wijzigingsregels aantoonbaar werken. Bij twijfel of conflict maakt de route een taak voor een medewerker; de AI kiest niet zelfstandig tussen twee mogelijke klanten of dubbele boekingen.',
      ]),
    }),
    Object.freeze({
      heading: 'Controleer de afzender en accepteer snel in een wachtrij',
      paragraphs: Object.freeze([
        'Controleer dat het event van de verwachte leverancier komt voordat je gegevens verwerkt. Retell beschrijft verificatie met de X-Retell-Signature-header, de ruwe request body en een geschikte API-sleutel. Verifieer dus niet op een opnieuw opgebouwde JSON-string wanneer de leverancier de oorspronkelijke bytes ondertekent. Beheer sleutels server-side, beperk toegang en leg vast hoe intrekken en vernieuwen werken.',
        'Doe geen lang CRM- of agendawerk voordat je het webhook-event bevestigt. Sla een geldig event eerst duurzaam in een wachtrij op en antwoord daarna snel succesvol. Een worker kan vervolgens valideren, matchen en schrijven. Zo veroorzaakt een traag doelsysteem minder snel een retry terwijl de eerste verwerking nog loopt. Een succesvolle ontvangst betekent alleen dat het event veilig is aangenomen, niet dat de bedrijfsactie al is gelukt.',
      ]),
    }),
    Object.freeze({
      heading: 'Ontwerp time-out, retry en menselijke herstelwachtrij samen',
      paragraphs: Object.freeze([
        'Verdeel fouten in categorieën die een andere reactie vragen. Een tijdelijke netwerkfout kan beperkt opnieuw worden geprobeerd. Een ongeldig veld, verlopen toestemming, meerdere klantmatches, agenda-conflict of ontbrekende proceseigenaar vraagt beoordeling. Bewaar bij iedere mislukking de eventsleutel, veilige foutcategorie, stap, poging, tijdstip, betrokken systeem en eigenaar, zonder onnodige gespreksinhoud in technische logs te kopiëren.',
        'Een retry mag dezelfde externe actie niet opnieuw aanmaken. Controleer vóór iedere poging de eventsleutel en een eventuele externe record- of afspraak-id. Stel een maximum en wachttijd in en verplaats daarna naar een zichtbare herstelwachtrij. De medewerker moet bron, voorgestelde actie, onzekerheid en eerder uitgevoerde stappen kunnen zien en vervolgens herstellen, afwijzen of escaleren. Alleen “mislukt” tonen is te weinig om veilig te beslissen.',
      ]),
    }),
    Object.freeze({
      heading: 'Test de systeemuitkomst, niet alleen het gesprek',
      paragraphs: Object.freeze([
        'Maak vóór livegang vaste acceptatiescenario’s: normaal terugbelverzoek, bestaand contact, geen match, meerdere matches, ontbrekend telefoonnummer, dubbele webhook, analyse die later komt, ongeldig CRM-veld, tijdelijk onbereikbaar CRM, bezet agendaslot, verlopen afspraakvoorstel en een herstelpoging. Gebruik fictieve testgegevens en voorkom dat simulaties echte klantacties uitvoeren.',
        'Controleer per scenario het zichtbare eindbewijs: exact één CRM-record of taak, juiste bron en eigenaar, correcte agenda-id, geen overschreven leidende velden, een herkenbare foutstatus en een werkende herstelactie. Test ook dat een ongeldige handtekening niets verwerkt en dat een dubbele delivery wel succesvol kan worden bevestigd zonder een tweede resultaat te maken.',
        Object.freeze({
          text:
            'Begroot deze acceptatie en het latere beheer als eigen werklaag. De kostengids voor een AI telefonist laat zien waarom telefonie, gesprekslogica, koppelingen, menselijke overdracht en beheer afzonderlijke scopevragen zijn. Een demo waarin één gesprek goed eindigt bewijst nog niet dat retries, agenda-conflicten en herstel onder echte omstandigheden beheersbaar zijn.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'kostengids voor een AI telefonist',
              href: '/blog/ai-telefonist-kosten-mkb',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Maak één gespreksuitkomstkaart voor de offerte',
      paragraphs: Object.freeze([
        'Vat de eerste route op één kaart samen: gesprekstaak, start-event, vereiste status, minimale velden, bron per veld, leidend systeem, eventsleutel, recordmatch, toegestane lees- en schrijfacties, agenda-conflictregel, afzendercontrole, timeout, retrylimiet, foutcategorieën, herstelwachtrij, beide eigenaren en acceptatiescenario’s. Laat iedere leverancier op dezelfde kaart aangeven wat standaard is, wat maatwerk is en welk bewijs bij oplevering zichtbaar wordt.',
        Object.freeze({
          text:
            'Softora kan zo’n kaart vertalen naar één beperkte AI-telefonieflow met CRM- of agenda-opvolging, menselijke beslisgrenzen en toetsbare acceptatie. Het doel is geen volledig autonome of foutloze route beloven, maar een koppeling bouwen die bij een geslaagde, dubbele, onzekere en mislukte levering voorspelbaar reageert. Bespreek via AI telefonist welke eerste gespreksuitkomst voldoende waarde heeft om gecontroleerd te koppelen.',
          links: Object.freeze([
            Object.freeze({ anchor: 'AI telefonist', href: '/ai-telefonist' }),
          ]),
        }),
      ]),
    }),
  ]),
  faq: Object.freeze([
    Object.freeze({
      question: 'Welke gespreksgegevens horen in CRM?',
      answer:
        'Alleen de minimale gegevens die de volgende taak nodig heeft, met bron en status. Denk aan contactroute, onderwerp, afgesproken vervolgactie en een gecontroleerde samenvatting. Sla modelinschattingen herkenbaar als voorstel op en zet niet automatisch het volledige transcript in CRM.',
    }),
    Object.freeze({
      question: 'Wanneer mag een AI telefonist direct een afspraak boeken?',
      answer:
        'Pas wanneer identiteit, beschikbaarheid, verplichte velden, tijdzone, bevestiging door de beller, conflictcontrole en wijzigingsregels aantoonbaar werken. Anders is een afspraakvoorstel of taak voor menselijke bevestiging veiliger.',
    }),
    Object.freeze({
      question: 'Hoe voorkom je dubbele leads of taken na een webhookretry?',
      answer:
        'Bewaar vóór de schrijfactie een unieke sleutel op basis van eventtype en call-id en geef bij herhaling de bestaande uitkomst terug. Houd dit apart van de klantmatch, die bepaalt of het gesprek bij een nieuw of bestaand CRM-record hoort.',
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'AI telefonist laten maken', href: '/ai-telefonist' }),
    Object.freeze({ label: 'AI telefonist voor afspraakintake', href: '/blog/ai-telefonist-voor-afspraakintake' }),
    Object.freeze({ label: 'Kosten van een AI telefonist', href: '/blog/ai-telefonist-kosten-mkb' }),
    Object.freeze({ label: 'Wat is een CRM-integratie?', href: '/kennisbank/wat-is-een-crm-integratie' }),
    Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
    Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
  ]),
});

module.exports = {
  AI_TELEFONIST_CRM_CONTENT_ITEM,
};
