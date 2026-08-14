const LEAD_QUALIFICATION_CONTENT_ITEM = Object.freeze({
  collection: 'blog',
  slug: 'ai-automatisering-leadkwalificatie-mkb',
  title: 'AI-leadkwalificatie: maak criteria toetsbaar voor het MKB',
  description:
    'Richt AI-leadkwalificatie in met een bewijskaart, drie uitkomsten, menselijke controle en een controleerbare overdracht naar CRM.',
  category: 'AI automatisering',
  intent: 'Koopintentie',
  qualityVersion: 2,
  primaryIntent: 'AI-leadkwalificatie inrichten met toetsbare criteria en menselijke controle',
  buyerTask:
    'Een aanvraag op zichtbaar bewijs naar verkoop, een gerichte vervolgvraag of een andere route sturen zonder een ondoorzichtige AI-score',
  funnelStage: 'consideration',
  targetMoneyPage: '/ai-automatisering',
  uniqueClusterRole:
    'Praktische beslispoort tussen intake en opvolging: deze pagina ontwerpt criteria, bewijs en review, terwijl de intakepagina gegevens verzamelt en de opvolgingspagina taken uitvoert nadat een route is gekozen.',
  informationGain:
    'Een toetskaart die harde uitsluitingen, ontbrekend bewijs en contextuele fit scheidt en per aanvraag de reden, eigenaar, volgende actie, menselijke override en auditspoor zichtbaar maakt.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Microsoft Learn: Qualify or convert leads',
      url: 'https://learn.microsoft.com/en-us/dynamics365/sales/qualify-lead-convert-opportunity-sales',
      observedAt: '2026-08-14',
    }),
    Object.freeze({
      title: 'Microsoft Learn: Define lead qualification criteria',
      url: 'https://learn.microsoft.com/en-us/dynamics365/customer-insights/journeys/real-time-marketing-qualify-leads',
      observedAt: '2026-08-14',
    }),
    Object.freeze({
      title: 'Autoriteit Persoonsgegevens: betekenisvolle menselijke tussenkomst',
      url: 'https://www.autoriteitpersoonsgegevens.nl/system/files?file=2025-03%2FHoofdlijnen+betekenisvolle+menselijke+tussenkomst_AP.pdf',
      observedAt: '2026-08-14',
    }),
  ]),
  growthEventKind: 'substantial_refresh',
  growthEventAt: '2026-08-14',
  publishedAt: '2026-06-02',
  updatedAt: '2026-08-14',
  readTime: '10 min',
  visualQualityVersion: 2,
  visualBrief: Object.freeze({
    hero: Object.freeze({
      role: 'representative',
      visualType: 'product-interface',
      visualFamily: 'translucent-human-review-console',
      composition:
        'Brede transparante reviewconsole met één binnenkomende aanvraag, vijf bewijsregels en drie fysieke routeknoppen waarvan een mens er één bedient.',
      informationGoal:
        'Toont dat AI bewijs voorbereidt en dat een medewerker bewust kiest tussen verkoop, extra informatie of een andere route.',
      differenceFromRecent:
        'Heldere glazen interface op ooghoogte met een echte hand, zonder donkere operations-UI, productielijn, voorstelmap, werktafel, isometrische tegels of tekstlabels.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: true,
    }),
    support: Object.freeze({
      role: 'explanatory',
      visualType: 'process-diagram',
      visualFamily: 'woven-evidence-gate-tapestry',
      composition:
        'Vijf geweven bewijsstrengen komen samen in een centrale menselijke reviewknoop en lopen daarna uit naar drie duidelijk verschillende routes.',
      informationGoal:
        'Legt zonder tekst uit dat meerdere soorten bewijs eerst samen worden beoordeeld voordat precies één vervolgroute ontstaat.',
      differenceFromRecent:
        'Tactiele textielkaart op zwarte stof, zonder fotografie, dashboard, risograph, patchpaneel, papier, embossed onderdelen of dezelfde camerahoek als het hoofdbeeld.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: false,
    }),
  }),
  image: Object.freeze({
    src: '/assets/seo-content/ai-leadkwalificatie-menselijke-beslispoort-softora.jpg',
    alt: 'Mens kiest in een transparante AI-reviewconsole tussen verkoop, extra informatie en een andere route.',
    width: 1600,
    height: 900,
  }),
  secondaryImage: Object.freeze({
    src: '/assets/seo-content/ai-leadkwalificatie-bewijsroute-softora.jpg',
    alt: 'Vijf geweven bewijsstromen komen samen bij menselijke controle en splitsen daarna naar drie vervolgroutes.',
    width: 1600,
    height: 900,
    caption:
      'Laat criteria eerst bewijs verzamelen; kies daarna bewust tussen verkoop, een vervolgvraag en een andere route.',
  }),
  summary:
    'Goede AI-leadkwalificatie is geen verborgen score. Zij maakt per aanvraag zichtbaar welk criterium is getoetst, welk bewijs aanwezig of onbekend is, wie de route beoordeelt en welke concrete vervolgstap is toegestaan.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: ontwerp drie uitkomsten',
      paragraphs: Object.freeze([
        Object.freeze({
          text: 'Laat een kwalificatie niet eindigen in alleen warm of koud. Gebruik minimaal drie werkbare routes: klaar voor verkoop, eerst één gerichte vraag stellen, of doorzetten naar een andere eigenaar of nette afwijzing. AI automatisering kan de informatie voor die keuze ordenen, maar de uitkomst moet voor een medewerker leesbaar en corrigeerbaar blijven.',
          links: Object.freeze([
            Object.freeze({ anchor: 'AI automatisering', href: '/ai-automatisering' }),
          ]),
        }),
        'Schrijf per route op wat er daarna werkelijk gebeurt. Klaar voor verkoop betekent bijvoorbeeld dat een eigenaar, reden en reactietaak in het CRM staan. Extra informatie betekent dat precies de ontbrekende vraag wordt gesteld en de aanvraag wacht zonder al als kansrijk te worden geteld. Een andere route betekent dat de juiste afdeling of reactie bekend is. Zo kwalificeert het systeem een werkstap in plaats van een abstract profiel.',
      ]),
    }),
    Object.freeze({
      heading: 'Scheid intake, kwalificatie en opvolging',
      paragraphs: Object.freeze([
        Object.freeze({
          text: 'Intake verzamelt de minimale feiten: contactgegevens, vraag, context en toestemming waar die nodig is. Kwalificatie toetst daarna of die feiten voldoende zijn voor een route. Leadopvolging start pas nadat een eigenaar en volgende actie zijn gekozen. Door die drie momenten apart te ontwerpen, voorkom je dat een chatbot of formulier ongemerkt al een commerciële beslissing neemt.',
          links: Object.freeze([
            Object.freeze({ anchor: 'Leadopvolging', href: '/blog/ai-automatisering-leadopvolging' }),
          ]),
        }),
        'De kennisbankuitleg over leadkwalificatie beschrijft de basisbegrippen. Voor de automatisering heb je daarnaast een expliciet contract tussen de stappen nodig: welke invoer is geldig, welke status mag worden geschreven, wie mag overrulen en wanneer wordt niets verzonden. De klantintake kan informatie verzamelen, maar mag ontbrekende gegevens niet stilzwijgend invullen om een route alsnog passend te maken.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak één bewijskaart per aanvraag',
      paragraphs: Object.freeze([
        'Een bruikbare bewijskaart heeft per criterium vijf velden: de vraag, het ontvangen bewijs, de toestand bekend of onbekend, de bron en de mogelijke gevolgen. Voor een softwareaanvraag kan een criterium bijvoorbeeld gaan over het proces dat vastloopt. Het bewijs is dan niet het woord urgent, maar een beschreven werkstap, betrokken rol en zichtbaar gevolg. Bewaar de oorspronkelijke formulering naast de samenvatting zodat een reviewer kan terugkijken.',
        'Voeg op kaartniveau de voorgestelde route, een korte reden, open onzekerheden, eigenaar, volgende actie en tijdstip van beoordeling toe. Gebruik geen totaalscore wanneer niemand kan uitleggen hoe twee verschillende aanvragen hetzelfde getal kregen. Een score kan intern helpen sorteren, maar een route hoort te steunen op herkenbare criteria en bewijs dat een medewerker kan controleren. Microsoft Dynamics ondersteunt aanpasbare kwalificatieprocessen en bewaart de uitkomst als statusovergang; het relevante principe is de controleerbare overgang, niet het kopiëren van één CRM-product.',
      ]),
    }),
    Object.freeze({
      heading: 'Scheid harde grenzen van contextuele signalen',
      paragraphs: Object.freeze([
        'Harde grenzen zijn feiten die een route blokkeren of verplicht veranderen, zoals een dienst die niet wordt geleverd, een noodzakelijke regio die buiten bereik valt of een aanvraag die bij ondersteuning in plaats van verkoop hoort. Houd deze lijst kort, controleerbaar en zichtbaar. Een harde grens moet niet uit toon, schrijfstijl of een door AI geraden bedrijfsomvang volgen. Wanneer het bewijs ontbreekt, is de toestand onbekend en niet automatisch ongeschikt.',
        'Contextuele signalen helpen een medewerker prioriteren zonder zelfstandig een definitief oordeel te vormen. Denk aan een concrete procesbeschrijving, een bekende eigenaar, gewenste timing of een bestaande technische afhankelijkheid. Leg per signaal vast wat het wel en niet bewijst. Een genoemd budget toont bijvoorbeeld niet automatisch koopbereidheid; een snelle gewenste start zegt niets over haalbaarheid. Zo blijft het model ondersteunend en voorkom je dat losse woorden tot schijnzekerheid worden opgeteld.',
      ]),
    }),
    Object.freeze({
      heading: 'Behandel ontbrekende informatie als eigen toestand',
      paragraphs: Object.freeze([
        'Een onbekend gegeven verdient een eigen status. Ontbreekt de huidige werkwijze, vraag dan niet opnieuw om een algemene toelichting maar om één voorbeeld: welke stap kost nu herstelwerk of blijft liggen? Ontbreekt de beslisser, vraag wie het proces dagelijks gebruikt en wie een wijziging mag goedkeuren. Een gerichte vraag levert bewijs op; een lang extra formulier vergroot vooral de kans dat iemand afhaakt of willekeurige velden invult.',
        'Bepaal vooraf hoeveel vervolgvraagrondes zijn toegestaan en wanneer een mens overneemt. Laat het systeem geen details verzinnen uit een website, e-mailadres of bedrijfsnaam om lege velden te vullen. Externe verrijking kan een onderzoekssignaal zijn, maar hoort herkenbaar als aparte bron en met passende gegevenscontrole te worden behandeld. De bewijskaart moet duidelijk maken wat de aanvrager zei, wat een systeem afleidde en wat nog niet bekend is.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak menselijke controle betekenisvol',
      paragraphs: Object.freeze([
        'Een knop met goedkeuren is geen serieuze controle wanneer de medewerker alleen een eindscore ziet, geen tijd heeft of de uitkomst niet kan wijzigen. Toon de oorspronkelijke aanvraag, criteria, bewijs, onzekerheden en voorgestelde route naast elkaar. Geef de reviewer bevoegdheid om te corrigeren, een vraag terug te sturen of de route te wijzigen, en laat die persoon een korte reden kiezen of noteren. Dan ontstaat feedback waarmee criteria later gericht kunnen worden verbeterd.',
        'De Autoriteit Persoonsgegevens noemt bij betekenisvolle menselijke tussenkomst onder meer voldoende informatie, bevoegdheid, tijd en monitoring. Of specifieke regels voor geautomatiseerde besluitvorming op een concrete verwerking van toepassing zijn, vraagt een eigen juridische en privacybeoordeling. Voor de procesinrichting is de veilige grens eenvoudiger: laat AI geen verstrekkende keuze zelfstandig verbergen en zorg dat een bevoegde medewerker het bewijs en de gevolgen werkelijk kan beoordelen.',
      ]),
    }),
    Object.freeze({
      heading: 'Schrijf een controleerbaar CRM-resultaat',
      paragraphs: Object.freeze([
        Object.freeze({
          text: 'Gebruik in een CRM-systeem op maat of bestaand CRM aparte velden voor kwalificatiestatus, route, reden, ontbrekend bewijs, eigenaar, volgende actie, reviewmoment en model- of regelversie. Bewaar de ruwe aanvraag als bron. Zet een lead pas om naar een opportunity of verkoopkans wanneer de afgesproken criteria en menselijke review dat toestaan; Microsoft beschrijft kwalificeren en diskwalificeren eveneens als expliciete, aanpasbare statusstappen met een controleerbaar vervolg.',
          links: Object.freeze([
            Object.freeze({ anchor: 'CRM-systeem op maat', href: '/crm-systeem-op-maat' }),
          ]),
        }),
        'Maak schrijven idempotent: dezelfde aanvraag mag bij een retry geen tweede contact, taak of kans aanmaken. Definieer wat er gebeurt wanneer het CRM tijdelijk niet reageert. Een veilige flow bewaart de gebeurtenis in een foutwachtrij, toont dat de overdracht nog niet is voltooid en laat een medewerker opnieuw proberen. Een chatbevestiging aan de bezoeker mag niet beweren dat verkoop de aanvraag heeft ontvangen wanneer alleen de kwalificatie lokaal is berekend.',
      ]),
    }),
    Object.freeze({
      heading: 'Test routes met acceptatiescenario’s',
      paragraphs: Object.freeze([
        'Schrijf voor livegang minimaal normale, onvolledige, tegenstrijdige en ongeschikte voorbeelden uit. Een normale aanvraag bevat voldoende bewijs en krijgt na review één verkooptaak. Een onvolledige aanvraag krijgt één specifieke vraag en nog geen verkoopstatus. Een tegenstrijdige aanvraag toont beide signalen en wordt naar menselijke beoordeling gestuurd. Een ongeschikte aanvraag krijgt de afgesproken andere route zonder dat het systeem kwetsende of speculatieve redenen formuleert.',
        'Test ook dubbele verzending, een gewijzigde aanvraag, een onbereikbaar CRM, een reviewer die de suggestie terugdraait en een criterium dat later verandert. Noteer per scenario invoer, verwachte status, zichtbaar bewijs, toegestane externe actie, eigenaar en herstelstap. Controleer met echte maar zorgvuldig geselecteerde voorbeelden uit het eigen proces; een demo met keurige fictieve leads bewijst niet hoe de route omgaat met rommelige taal en ontbrekende context.',
      ]),
    }),
    Object.freeze({
      heading: 'Meet routekwaliteit zonder omzet te verzinnen',
      paragraphs: Object.freeze([
        'Volg hoeveel aanvragen per route gaan, hoeveel informatie ontbreekt, hoe vaak medewerkers een suggestie wijzigen, welke criteria de meeste discussie geven en hoeveel overdrachten technisch mislukken. Bekijk wijzigingen per criterium en per kanaal, niet alleen als één succespercentage. Een hoge automatische acceptatiegraad kan juist betekenen dat grenzen te ruim staan; veel overrides kunnen wijzen op een onduidelijk criterium, onvolledige intake of veranderde marktcontext.',
        'Koppel pas aan verkoopresultaten wanneer de attributie betrouwbaar is en definities stabiel zijn. Een gewonnen opdracht kan niet zonder meer aan de AI-route worden toegeschreven, en een afgewezen aanvraag bewijst niet dat de kwalificatie fout was. Gebruik vroege data daarom voor procescontrole: kwam de juiste informatie bij de juiste eigenaar, was de reden begrijpelijk en kon een fout worden hersteld? Beoordeel commerciële richting later over een voldoende lange periode en met menselijke context.',
      ]),
    }),
    Object.freeze({
      heading: 'Begin met één smalle kwalificatiepoort',
      paragraphs: Object.freeze([
        'Kies één aanvraagtype met een herkenbare eigenaar en beperkte schade bij een verkeerde suggestie. Verzamel tien tot twintig geanonimiseerde of fictief nagemaakte voorbeelden die de variatie in het proces dekken. Laat verkoop en operatie samen drie routes, maximaal vijf kerncriteria, toegestane vervolgvragen en escalatiegrenzen vastleggen. Bouw eerst een reviewweergave en oefen zonder automatische externe acties; voeg CRM-schrijven pas toe wanneer de acceptatiescenario’s herhaalbaar werken.',
        Object.freeze({
          text: 'Softora kan de bewijskaart, reviewpoort, CRM-overdracht en foutafhandeling als één afgebakende AI-workflow uitwerken. Neem voor een eerste gesprek drie voorbeelden mee: een duidelijke match, een aanvraag met ontbrekende informatie en een aanvraag die naar een andere route hoort. Daarmee kunnen we criteria en menselijke grenzen concreet maken zonder vooraf conversie, besparing of autonome besluitvorming te beloven.',
          links: Object.freeze([
            Object.freeze({ anchor: 'afgebakende AI-workflow', href: '/ai-automatisering' }),
          ]),
        }),
      ]),
    }),
  ]),
  faq: Object.freeze([
    Object.freeze({
      question: 'Welke criteria heb je nodig voor AI-leadkwalificatie?',
      answer:
        'Begin met maximaal vijf controleerbare criteria die een echte route veranderen. Scheid harde grenzen van contextuele signalen en leg per criterium vast welk bewijs telt, wat onbekend betekent en wie mag corrigeren.',
    }),
    Object.freeze({
      question: 'Wat gebeurt er als informatie voor kwalificatie ontbreekt?',
      answer:
        'Gebruik onbekend als aparte toestand en stel één gerichte vervolgvraag. Schrijf nog geen verkoopstatus en vul lege gegevens niet met onbewezen AI-aannames.',
    }),
    Object.freeze({
      question: 'Mag AI een lead zelfstandig afwijzen?',
      answer:
        'Gebruik voor commerciële en mogelijk verstrekkende keuzes een zichtbare menselijke review met voldoende bewijs, tijd en wijzigingsbevoegdheid. Laat voor de concrete verwerking ook privacy en toepasselijke regels beoordelen.',
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
    Object.freeze({ label: 'CRM-systeem op maat', href: '/crm-systeem-op-maat' }),
    Object.freeze({
      label: 'Wat is leadkwalificatie?',
      href: '/kennisbank/wat-is-leadkwalificatie',
      availableFrom: '2026-06-03',
    }),
    Object.freeze({ label: 'AI leadopvolging automatiseren', href: '/blog/ai-automatisering-leadopvolging' }),
    Object.freeze({
      label: 'AI automatisering voor klantintake',
      href: '/blog/ai-automatisering-klantintake-mkb',
      availableFrom: '2026-06-23',
    }),
  ]),
});

module.exports = {
  LEAD_QUALIFICATION_CONTENT_ITEM,
};
