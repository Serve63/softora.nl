const PROCESS_AUTOMATION_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'wat-is-procesautomatisering',
  title: 'Wat is procesautomatisering?',
  description:
    'Leer procesautomatisering afbakenen met een proceskaart voor trigger, status, beslisrecht, foutpad, menselijke controle en acceptatiebewijs.',
  category: 'Procesautomatisering',
  intent: 'Uitleg en afbakening',
  qualityVersion: 2,
  primaryIntent: 'Procesautomatisering begrijpen, afbakenen en als eerste gecontroleerde workflow beoordelen',
  buyerTask:
    'Een terugkerend bedrijfsproces vertalen naar een toetsbare proceskaart met duidelijke toestanden, beslisrechten, uitzonderingen, eigenaren en acceptatiescenario\'s voordat tooling of maatwerk wordt gekozen',
  funnelStage: 'consideration',
  targetMoneyPage: '/ai-automatisering',
  uniqueClusterRole:
    'Leveranciersneutrale afbakenings- en acceptatiegids voor het volledige bedrijfsproces; de AI-automatiseringspagina verklaart de technieklaag, de AI-workflowpagina de concrete AI-stappen en de leadopvolgingsgids één commerciële toepassing.',
  informationGain:
    'Een negendelige proceskaart die trigger, invoer, toestand, beslisrecht, actie, leidend systeem, uitzondering, eigenaar en acceptatiebewijs samenbrengt, plus een fout- en herstelroute waarmee een MKB-team vaste regels, AI-voorstellen en menselijke besluiten vóór de bouw uit elkaar houdt.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Microsoft Learn: Create a business process flow in Power Apps',
      url: 'https://learn.microsoft.com/en-us/power-automate/create-business-process-flow',
      observedAt: '2026-08-20',
    }),
    Object.freeze({
      title: 'AWS Builders Library: Making retries safe with idempotent APIs',
      url: 'https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/',
      observedAt: '2026-08-20',
    }),
    Object.freeze({
      title: 'NIST AI RMF Playbook: Map',
      url: 'https://airc.nist.gov/airmf-resources/playbook/map/',
      observedAt: '2026-08-20',
    }),
  ]),
  growthEventKind: 'substantial_refresh',
  growthEventAt: '2026-08-20',
  publishedAt: '2026-06-24',
  updatedAt: '2026-09-02',
  visualQualityVersion: 2,
  visualBrief: Object.freeze({
    hero: Object.freeze({
      role: 'representative',
      visualType: 'object-study',
      visualFamily: 'tactile-accordion-process-bench',
      composition:
        'Bovenaanzicht van een uitgevouwen papieren procesroute op een donkergroene werktafel, met een blauwe controlepoort, aparte rode uitzonderingsbak en één menselijke goedkeuringsfiche.',
      informationGoal:
        'Maakt zichtbaar dat een proces één doorlopende route heeft, maar dat uitzondering en menselijke goedkeuring als aparte onderdelen moeten worden ontworpen.',
      differenceFromRecent:
        'Tactiele objectstudie zonder personen, kantoor, scherm, zwevende interface of witte isometrische tegels; de diagonale papieren route en donkergroene werkbank wijken af van recente telefonie- en dashboardbeelden.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: true,
    }),
    support: Object.freeze({
      role: 'explanatory',
      visualType: 'process-diagram',
      visualFamily: 'swiss-yellow-exception-route',
      composition:
        'Brede zwarte proceslijn op geel papier met drie controlepunten, een beslisdiamant, blauwe uitkomst en een rode foutlus via menselijke controle terug naar de succesroute.',
      informationGoal:
        'Legt zonder tekst uit dat bewijs per stap, een expliciete uitzonderingsroute en menselijke acceptatie vóór de uiteindelijke systeemactie horen.',
      differenceFromRecent:
        'Vlakke Zwitserse zeefdrukposter in geel, zwart, rood en blauw, zonder fotografie, donker dashboard, 3D, tekstlabels, stadskaart of witte kaartcompositie.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: false,
    }),
  }),
  image: Object.freeze({
    src: '/assets/seo-content/procesautomatisering-proceskaart-softora.jpg',
    alt: 'Uitgevouwen proceskaart met controlepoort, aparte uitzonderingsbak en menselijke goedkeuringsfiche op een donkergroene werktafel.',
    width: 1600,
    height: 900,
    sourceType: 'trainedAlgorithmicMedia',
  }),
  secondaryImage: Object.freeze({
    src: '/assets/seo-content/procesautomatisering-foutpad-softora.jpg',
    alt: 'Procesdiagram met drie controlepunten en een rode fout- en herstelroute via menselijke goedkeuring naar de uiteindelijke actie.',
    width: 1600,
    height: 900,
    sourceType: 'trainedAlgorithmicMedia',
    caption:
      'Een bruikbare automatisering ontwerpt het bewijs, de uitzondering en de herstelactie tegelijk met de normale route.',
  }),
  summary:
    'Procesautomatisering is het bestuurbaar maken van een terugkerende werkroute: een bekende trigger brengt informatie door expliciete toestanden, beslissingen en acties naar een controleerbare uitkomst. De automatisering is pas compleet wanneer ook uitzonderingen, eigenaarschap, menselijke beslisgrenzen en herstel aantoonbaar zijn ontworpen.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: automatiseer een bestuurbare werkroute',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Procesautomatisering betekent dat een terugkerend bedrijfsproces volgens vooraf vastgelegde regels wordt voorbereid, uitgevoerd en doorgezet. Het gaat dus niet alleen om een taak sneller laten lopen. De trigger, benodigde invoer, tussenstatussen, beslissingen, acties, uitzonderingen en eigenaar moeten samen één bestuurbare route vormen. Bij AI automatisering kan een taalmodel een deel voorbereiden, maar de procesafspraken bepalen wat daarna wel en niet mag gebeuren.',
          links: Object.freeze([
            Object.freeze({ anchor: 'AI automatisering', href: '/ai-automatisering' }),
          ]),
        }),
        'Een eenvoudig voorbeeld is een websiteaanvraag. De route kan invoer valideren, een bestaand contact herkennen, een eigenaar kiezen, een opvolgtaak klaarzetten en ontvangst bevestigen. Maar dezelfde route moet ook weten wat er gebeurt bij ontbrekende gegevens, meerdere klantmatches, een onbereikbaar CRM of twijfel over de juiste afdeling. Zonder die foutpaden is slechts het ideale voorbeeld geautomatiseerd.',
      ]),
    }),
    Object.freeze({
      heading: 'Kies één zakelijke uitkomst voordat je stappen tekent',
      paragraphs: Object.freeze([
        'Begin niet met een lijst tools of met het brede doel “minder handwerk”. Kies één zichtbare uitkomst die het team in de praktijk kan controleren. Bijvoorbeeld: iedere geldige offerteaanvraag heeft exact één eigenaar en volgende actie, of iedere afgeronde klantintake staat met bron en ontbrekende punten klaar voor beoordeling. De uitkomst maakt duidelijk waar het proces eindigt en welk bewijs nodig is om het geslaagd te noemen.',
        'Baken daarna de eerste versie af. Noteer welke aanvragen, teams, kanalen en uitzonderingen wel meedoen en welke nog niet. Een flow voor nieuwe Nederlandse verkoopaanvragen is een andere opdracht dan alle bestaande klanten, klachten, internationale aanvragen en wijzigingen met financiële gevolgen verwerken. Een kleine scope is niet automatisch veilig; zij wordt veilig doordat grensgevallen herkenbaar stoppen en bij een passende eigenaar terechtkomen.',
      ]),
    }),
    Object.freeze({
      heading: 'Vul een proceskaart met negen vaste velden',
      paragraphs: Object.freeze([
        'Leg de eerste route op één kaart vast met negen velden: trigger, invoer, huidige toestand, beslisrecht, toegestane actie, leidend systeem, uitzondering, eigenaar en acceptatiebewijs. De trigger is de gebeurtenis die de route start. De toestand beschrijft wat al bekend en afgerond is. Het beslisrecht bepaalt of een vaste regel, AI-voorstel of medewerker de volgende stap kiest. Het acceptatiebewijs laat zien wat na uitvoering controleerbaar moet bestaan.',
        'Microsoft laat in zijn documentatie over business process flows zien dat processen uit zichtbare fasen en stappen kunnen bestaan, dat invoer verplicht kan worden gemaakt en dat toegangsrechten per procesrol kunnen verschillen. Dat product is niet automatisch de juiste oplossing voor ieder bedrijf. De onderliggende ontwerpvragen zijn wel bruikbaar: welke fase is actief, wat moet vóór doorgang bekend zijn en wie mag de processtatus veranderen?',
        'Gebruik per veld concrete werktaal. “CRM bijwerken” is te breed. “Maak na een geldige aanvraag één opvolgtaak voor de gekozen eigenaar en bewaar bron, aanvraag-id en gewenste contactdag” is toetsbaar. Voeg bij de uitzondering toe wat de medewerker ziet, welke eerdere acties al zijn uitgevoerd en hoe de route kan worden hervat of afgewezen.',
      ]),
    }),
    Object.freeze({
      heading: 'Scheid vaste regels, AI-voorstellen en menselijke besluiten',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Gewone automatisering past bij voorspelbare voorwaarden: een verplicht veld controleren, een datum berekenen, een status wijzigen of gegevens volgens een vaste mapping doorzetten. AI helpt wanneer tekst, gesprek of context eerst moet worden samengevat of geclassificeerd. De kennisbankpagina over een AI workflow behandelt die AI-stappen; procesautomatisering bepaalt de bredere bedrijfsroute waarin zo’n voorstel terechtkomt.',
          links: Object.freeze([
            Object.freeze({ anchor: 'een AI workflow', href: '/kennisbank/wat-is-een-ai-workflow' }),
          ]),
        }),
        'Markeer iedere AI-uitkomst als feit, afleiding of voorstel. Een telefoonnummer uit een geldig formulier kan een brongegeven zijn. Een door AI herkende koopintentie is een afleiding. Een voorgestelde prioriteit of antwoordtekst blijft een voorstel totdat een medewerker of expliciete regel haar accepteert. Laat de route stoppen wanneer de betrouwbaarheid, bron of toegestane vervolgstap niet past bij de situatie.',
        'NIST adviseert in zijn vrijwillige AI RMF Playbook om context, grenzen, rollen en verantwoordelijkheden voor menselijke controle expliciet te maken. Vertaal dat praktisch naar de proceskaart: wie beoordeelt onverwachte invoer, wie mag een AI-voorstel corrigeren, welke informatie ziet die persoon en welke actie blijft altijd menselijk? Dat is procesontwerp, geen belofte dat menselijke controle ieder risico uitsluit.',
      ]),
    }),
    Object.freeze({
      heading: 'Wijs per gegeven en status één leidend systeem aan',
      paragraphs: Object.freeze([
        'Een proces loopt vaak door formulier, mailbox, CRM, agenda en maatwerksoftware. Kies per gegeven welk systeem de waarheid beheert. CRM kan eigenaar en verkoopstatus beheren, terwijl de agenda beschikbaarheid en afspraak-id beheert. De automatisering mag informatie verplaatsen of aanvullen, maar mag niet stilzwijgend twee verschillende waarheden onderhouden. Noteer ook welke identifier dezelfde aanvraag, klant of afspraak in elk systeem verbindt.',
        Object.freeze({
          text:
            'Beschrijf een koppeling als richting, gebeurtenis, minimale veldset, recht en foutgedrag. De gids over een CRM-integratie gaat dieper in op veldmapping, identifiers en herstel. Kies bedrijfssoftware op maat pas wanneer de proceskaart laat zien dat configuratie of een gerichte koppeling de noodzakelijke status, rechten of herstelroute aantoonbaar niet kan dragen.',
          links: Object.freeze([
            Object.freeze({ anchor: 'gids over een CRM-integratie', href: '/kennisbank/wat-is-een-crm-integratie' }),
            Object.freeze({ anchor: 'bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Ontwerp de fout- en herstelroute vóór de succesroute live gaat',
      paragraphs: Object.freeze([
        'Verdeel fouten in categorieën met een eigen reactie. Ontbrekende invoer kan terug naar de aanvrager of naar handmatige aanvulling. Meerdere klantmatches vragen beoordeling. Een tijdelijke netwerkfout kan beperkt opnieuw worden geprobeerd. Een afgewezen actie, verlopen toestemming of ongeldige status hoort niet eindeloos opnieuw te starten. Iedere categorie krijgt een eigenaar, veilige context, uiterste wachttijd en toegestane herstelactie.',
        'Voorkom dat opnieuw proberen dezelfde externe actie dubbel uitvoert. AWS beschrijft bij idempotente API’s hoe een unieke aanvraag-id kan helpen om herhaalde verzoeken dezelfde betekenis te laten houden zonder extra neveneffect. Voor een MKB-flow betekent dit bijvoorbeeld dat dezelfde formulier-id, webhook-id of combinatie van bron en gebeurtenis niet twee CRM-taken of afspraken mag maken. Test die eigenschap; alleen een technisch retrylabel bewijst haar niet.',
        'Maak de herstelwachtrij bruikbaar voor een mens. Toon processtap, foutcategorie, bron-id, eerdere acties, voorgestelde oplossing en eigenaar zonder onnodige persoonsgegevens in technische logs te kopiëren. De medewerker moet kunnen herstellen, afwijzen of escaleren. “Er ging iets mis” is geen herstelroute en een verborgen fout in een logboek is geen bestuurbare processtatus.',
      ]),
    }),
    Object.freeze({
      heading: 'Test toestanden en bewijs in plaats van alleen schermen',
      paragraphs: Object.freeze([
        'Schrijf vóór de bouw acceptatiescenario’s voor het normale pad en de belangrijkste afwijkingen. Gebruik bijvoorbeeld: volledige nieuwe aanvraag, ontbrekend verplicht veld, bestaand contact, meerdere matches, dubbele levering, tijdelijk onbereikbaar doelsysteem, onbevoegde gebruiker, afgewezen AI-voorstel en herstel na een fout. Noteer per scenario invoer, verwachte toestand, zichtbare uitkomst, externe actie, eigenaar en bewijs dat geen dubbele actie is ontstaan.',
        'Test met fictieve gegevens in een omgeving waar geen echte klantactie kan ontstaan. Controleer na iedere stap zowel wat de gebruiker ziet als wat het systeem heeft vastgelegd. Een succesmelding terwijl het CRM niets ontving is een defect. Een correct CRM-record zonder zichtbare bevestiging kan leiden tot opnieuw indienen. Procesacceptatie verbindt dus interface, data, koppeling en menselijk werk; een losse demo van één knop is onvoldoende.',
      ]),
    }),
    Object.freeze({
      heading: 'Meet doorlooptijd, herstel en kwaliteit apart',
      paragraphs: Object.freeze([
        'Kies vóór de pilot een kleine set metingen: aantal gestarte en afgeronde routes, wachttijd per toestand, percentage menselijke beoordelingen, aantal fouten per categorie, herstelduur en dubbele of ontbrekende acties. Voeg alleen een kwaliteitsmaat toe wanneer het team dezelfde definitie gebruikt. Een snellere route is niet automatisch beter wanneer meer aanvragen verkeerd worden toegewezen of medewerkers extra correctiewerk krijgen.',
        'Vergelijk de pilot met de huidige werkwijze over een passende periode en noteer veranderingen in volume of teamsamenstelling. Beoordeel eerst of eventregistratie en bewijs compleet zijn, daarna of de route voorspelbaar werkt en pas vervolgens of uitbreiding logisch is. Dagelijkse verschillen bewijzen niet dat één automatiseringsstap tijd, omzet of leadkwaliteit heeft veroorzaakt.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik de proceskaart om oplossing en offerte te vergelijken',
      paragraphs: Object.freeze([
        'Geef iedere leverancier dezelfde proceskaart en scenario’s. Laat per onderdeel aangeven wat standaard, configureerbaar, via een bestaande koppeling of als maatwerk wordt geleverd. Vraag ook wie na oplevering regels, toegang, foutcategorieën en dashboards kan beheren; welke externe diensten nodig zijn; hoe gegevens kunnen worden geëxporteerd; en welk acceptatiebewijs bij de oplevering hoort. Zo vergelijk je oplossingen op dezelfde zakelijke route in plaats van op een lijst losse functies.',
        Object.freeze({
          text:
            'Begroot daarna de kosten van een eerste AI-automatisering met dezelfde proceskaart. Scheid afbakening en realisatie van workflow-executies, moduleacties, modelgebruik, menselijke beoordeling en beheer. Zo wordt een offerteverschil herleidbaar naar volume, verantwoordelijkheid of bewijs in plaats van naar een onvergelijkbare pakketnaam.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'kosten van een eerste AI-automatisering',
              href: '/blog/ai-automatisering-kosten-mkb',
            }),
          ]),
        }),
        Object.freeze({
          text:
            'Softora kan één terugkerend proces samen met het team afbakenen, de proceskaart en foutpaden uitwerken en daarna bepalen of vaste automatisering, een begrensde AI-laag, een integratie of maatwerk past. De bredere gids over AI-processen automatiseren zonder controle te verliezen helpt bij de invoeringsgrenzen. Neem voor een eerste gesprek één echte route, een representatieve uitzondering en het systeem waarin de uitkomst moet landen mee.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'AI-processen automatiseren zonder controle te verliezen',
              href: '/blog/ai-processen-automatiseren-zonder-controle-verliezen',
            }),
          ]),
        }),
      ]),
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
    Object.freeze({ label: 'Wat is AI automatisering?', href: '/kennisbank/wat-is-ai-automatisering' }),
    Object.freeze({ label: 'Wat is een AI workflow?', href: '/kennisbank/wat-is-een-ai-workflow' }),
    Object.freeze({ label: 'Wat is een CRM-integratie?', href: '/kennisbank/wat-is-een-crm-integratie' }),
    Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    Object.freeze({
      label: 'AI-processen automatiseren zonder controle te verliezen',
      href: '/blog/ai-processen-automatiseren-zonder-controle-verliezen',
    }),
  ]),
});

module.exports = {
  PROCESS_AUTOMATION_CONTENT_ITEM,
};
