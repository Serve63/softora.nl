const BUSINESS_SOFTWARE_EXPLAINER = Object.freeze({
  collection: 'kennisbank',
  slug: 'wat-is-bedrijfssoftware-op-maat',
  title: 'Wat is bedrijfssoftware op maat?',
  description: 'Begrijp bedrijfssoftware op maat met een concreet procesvoorbeeld, rollen, gegevens, systeemgrenzen en de afspraken die je vóór de bouw nodig hebt.',
  category: 'Bedrijfssoftware',
  intent: 'Uitleg',
  qualityVersion: 2,
  primaryIntent: 'Begrijpen wat bedrijfssoftware op maat is en welke procesafspraken eraan voorafgaan',
  buyerTask: 'Eén werkroute beschrijven met invoer, rollen, beslisregels, gegevensbron, fouten en grenzen voordat een leverancier bouwt',
  funnelStage: 'consideration',
  targetMoneyPage: '/bedrijfssoftware-op-maat',
  uniqueClusterRole: 'Definitie en concrete procesbeschrijving vóór de oplossingskeuze; geen dienstenaanbod, kostenraming, pakketvergelijking of offertebeoordeling.',
  informationGain: 'Een expliciet fictieve serviceaanvraag en een invulbare proceszin maken het verschil zichtbaar tussen een schermwens, een bedrijfsregel en een toetsbare softwareopdracht, inclusief fout- en systeemgrenzen.',
  sources: Object.freeze([
    Object.freeze({ title: 'GOV.UK Service Manual: Choosing technology', url: 'https://www.gov.uk/service-manual/technology/choosing-technology-an-introduction', observedAt: '2026-09-25' }),
    Object.freeze({ title: 'Google Search Central: helpful, reliable, people-first content', url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content', observedAt: '2026-09-25' }),
  ]),
  publishedAt: '2026-05-19',
  updatedAt: '2026-09-25',
  growthEventKind: 'substantial_refresh',
  growthEventAt: '2026-09-25',
  keywordEvidence: Object.freeze({
  "version": 1,
  "researchedAt": "2026-09-25",
  "status": "ready",
  "provider": "ubersuggest",
  "locale": {
    "locId": 2528,
    "language": "Dutch",
    "verified": true
  },
  "seeds": [
    "bedrijfssoftware op maat",
    "maatwerk software"
  ],
  "tools": [
    "keyword_suggestions",
    "google_suggestions",
    "keyword_overview",
    "serp_analysis"
  ],
  "callsUsed": 4,
  "calls": [
    {
      "tool": "keyword_suggestions",
      "observedAt": "2026-09-25T09:29:50.066Z",
      "arguments": {
        "keywords": [
          "bedrijfssoftware op maat",
          "maatwerk software"
        ],
        "locId": 2528,
        "language": "nl"
      },
      "purpose": "Advisory Dutch definition and commercial intent check; full result in keyword-evidence-run15.json."
    },
    {
      "tool": "google_suggestions",
      "observedAt": "2026-09-25T09:29:54.853Z",
      "arguments": {
        "keywords": [
          "bedrijfssoftware op maat"
        ],
        "country": "nl",
        "language": "nl"
      },
      "purpose": "Advisory Dutch definition and commercial intent check; full result in keyword-evidence-run15.json."
    },
    {
      "tool": "keyword_overview",
      "observedAt": "2026-09-25T09:29:55.169Z",
      "arguments": {
        "keyword": "bedrijfssoftware op maat",
        "locId": 2528,
        "language": "nl"
      },
      "purpose": "Advisory Dutch definition and commercial intent check; full result in keyword-evidence-run15.json."
    },
    {
      "tool": "serp_analysis",
      "observedAt": "2026-09-25T09:29:55.846Z",
      "arguments": {
        "keyword": "bedrijfssoftware op maat",
        "locId": 2528,
        "language": "nl",
        "limit": 5
      },
      "purpose": "Advisory Dutch definition and commercial intent check; full result in keyword-evidence-run15.json."
    }
  ],
  "primaryIntent": "Bedrijfssoftware op maat begrijpen en een concrete procesgrens beschrijven vóór oplossingskeuze.",
  "provisionalPrimaryTerm": "bedrijfssoftware op maat",
  "secondaryBuyerLanguage": [
    "wat is maatwerk software",
    "software op maat ontwikkelen"
  ],
  "buyerQuestions": [
    "Wat is maatwerk softwareontwikkeling?",
    "Wat zijn maatwerk applicaties?"
  ],
  "dominantPageTypes": [
    "definition guide",
    "commercial software service"
  ],
  "serpFeatures": [
    "organic_results",
    "people_also_ask",
    "ai_overview"
  ],
  "limitations": [
    "Netherlands/Dutch verified in overview and SERP; suggestions do not report effective locale.",
    "SERP cached2026-08-11; ordinary Dutch Google Sep25 independently shows definition guides.",
    "Volume90 commercial root and70 definition variant are provider estimates, not traffic or leads; no causal forecast.",
    "Zero-volume variants are no_measurable_provider_volume, not proof of no demand."
  ],
  "terms": [
    {
      "phrase": "bedrijfssoftware op maat",
      "disposition": "used",
      "reason": "Definition title and direct answer match existing page intent; commercial offer stays on service.",
      "observedIn": [
        "keyword_overview",
        "serp_analysis",
        "google_suggestions"
      ],
      "metrics": {
        "volume": 90
      }
    },
    {
      "phrase": "wat is maatwerk software",
      "disposition": "covered_semantically",
      "reason": "Definition variant covered naturally without a synonym page.",
      "observedIn": [
        "keyword_suggestions"
      ],
      "metrics": {
        "volume": 70
      }
    },
    {
      "phrase": "software op maat ontwikkelen",
      "disposition": "covered_semantically",
      "reason": "Explain process specification rather than a duplicate service offer.",
      "observedIn": [
        "google_suggestions"
      ]
    },
    {
      "phrase": "sst software maatwerk software her ontwikkeling",
      "disposition": "rejected",
      "reason": "Other-brand navigation unrelated to Softora buyer task.",
      "observedIn": [
        "keyword_suggestions"
      ]
    }
  ],
  "decision": {
    "owner": "softora_control_plane",
    "ubersuggest": "advisory_only",
    "rationale": "Fresh GSC cluster relevance, directly observed generic SEO padding and primary-source process guidance justify a substantial refresh of an existing definition route; no new URL, no forced volume."
  }
}),
  summary: 'Bedrijfssoftware op maat is software die wordt ontwikkeld voor de werkprocessen, rollen en gegevens van een organisatie. Denk aan een planning, klantportaal of goedkeuringsroute. Het hoeft geen compleet nieuw systeem te zijn: een specifieke aanvulling op bestaande pakketten kan genoeg zijn. Begin met de procesafspraak, niet met een lijst schermen.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Wat wordt er eigenlijk op maat gemaakt?',
      paragraphs: Object.freeze([
        'Bij maatwerk leg je vast welke informatie iemand ziet, wat die persoon mag veranderen en onder welke voorwaarden een volgende stap mogelijk is. De eigen logica kan bijvoorbeeld bepalen wie een aanvraag goedkeurt, welke capaciteit meetelt of wanneer een opdracht klaarstaat voor planning. Een dashboard maakt die afspraken zichtbaar; het is niet de afspraak zelf.',
        { text: 'Een CRM, planningstool, database of klantportaal kan onderdeel van bedrijfssoftware op maat zijn. Ook bestaande software laat vaak inrichting en uitbreidingen toe. Het onderscheid is dus niet simpelweg een eigen scherm tegenover een gekocht pakket, maar welke regels je met configuratie kunt afdekken en waarvoor eigen ontwikkeling en onderhoud nodig zijn.', links: [{ anchor: 'bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }] },
      ]),
    }),
    Object.freeze({
      heading: 'Een fictief voorbeeld: van servicemelding naar werkopdracht',
      paragraphs: Object.freeze([
        'Stel dat een onderhoudsbedrijf meldingen uit een klantportaal ontvangt. Dit is een fictief uitlegvoorbeeld, geen klantcase of bewezen resultaat. De melding bevat een klantnummer, object, probleemomschrijving en gewenste periode. De planner controleert de informatie; alleen een bevoegde medewerker mag de opdracht vrijgeven.',
        'De bedrijfseigen regel kan zijn: een melding zonder bekend object of met een ontbrekende veiligheidsbeoordeling mag niet automatisch naar de planning. De software zet haar apart met een reden en een eigenaar. De verantwoordelijke persoon beoordeelt de uitzondering; het systeem verzint geen ontbrekende gegevens of goedkeuring.',
        'Het klantenbestand kan in het bestaande CRM blijven en de factuur in de boekhouding. De maatwerklaag hoeft dan alleen de melding, controle, vrijgave en overdracht te ondersteunen. Bij een mislukte koppeling moet zichtbaar blijven wat al verwerkt is en wat opnieuw moet worden geprobeerd, zonder dezelfde werkopdracht dubbel aan te maken.',
      ]),
    }),
    Object.freeze({
      heading: 'Beschrijf één route in zes afspraken',
      paragraphs: Object.freeze([
        'Gebruik deze invulzin: “Wanneer [aanleiding] optreedt, ontvangt [rol] de gegevens [invoer] uit [leidende bron]. De stap mag verder als [bedrijfsregel] klopt. Bij een afwijking beslist [eigenaar] en is [herstelhandeling] nodig.” Vul de zin met een echte terugkerende taak; vermijd woorden als slim, flexibel of automatisch zolang niet duidelijk is wat er moet gebeuren.',
        'Werk daarna zes punten uit: de gewenste uitkomst; de personen en hun rechten; de benodigde gegevens en hun bron; de normale beslisregels; de uitzonderingen en herstelstappen; en wat nadrukkelijk buiten de opdracht valt. Noteer bij iedere stap welk resultaat de gebruiker moet kunnen controleren. Zo wordt “een planningsdashboard” een bespreekbare opdracht.',
        'Maak ook één voorbeeld waarin de route niet mag doorgaan. Denk aan een ontbrekend klantnummer, onvoldoende bevoegdheid, een gewijzigde afspraak of een onbereikbare koppeling. Spreek af wie dan handelt en hoe die persoon kan zien dat herstel is gelukt.',
      ]),
    }),
    Object.freeze({
      heading: 'Wanneer is maatwerk niet de eerste stap?',
      paragraphs: Object.freeze([
        'Wanneer niemand het eens is over de eigenaar of de werkwijze, automatiseert nieuwe software vooral de onduidelijkheid. Leg eerst het proces vast. Controleer vervolgens of betere inrichting van een bestaand pakket of een eenvoudiger werkafspraak het probleem al oplost. Meer functies zijn geen bewijs dat eigen ontwikkeling nodig is.',
        { text: 'Blijven er concrete regels of overdrachten over die de bestaande oplossing niet goed ondersteunt? Vergelijk dan standaardsoftware, een hybride route en maatwerk per onderdeel. Deze uitleg helpt je de taak te beschrijven; het aparte besliskader helpt daarna een oplossingsroute kiezen.', links: [{ anchor: 'standaardsoftware, een hybride route en maatwerk', href: '/vergelijkingen/maatwerk-software-vs-standaard-software' }] },
      ]),
    }),
    Object.freeze({
      heading: 'Welke verantwoordelijkheid blijft na oplevering?',
      paragraphs: Object.freeze([
        'Maatwerk neemt beheer niet weg. Bespreek wie wijzigingen beoordeelt, toegangsrechten beheert, back-ups en herstel test, koppelingen bijwerkt en gebruikers helpt. Maak duidelijk welke documentatie, beheeraccounts en exportmogelijkheden beschikbaar zijn als je later een andere beheerder kiest. Kosten bestaan niet alleen uit bouw, maar ook uit gebruik, onderhoud en interne inzet.',
        { text: 'GOV.UK noemt aanpasbaarheid, totale eigendomskosten en controle over gegevens als aandachtspunten bij technologiekeuzes. Dat is overheidsrichtlijn, geen verplicht MKB-keurmerk. De bruikbare vertaling voor jouw opdracht is concreet: leg systeemgrenzen vast, test belangrijke aannames met een prototype en houd een werkbaar verander- en vertrekpad open.', links: [{ anchor: 'GOV.UK', href: 'https://www.gov.uk/service-manual/technology/choosing-technology-an-introduction' }] },
        'Een prototype bewijst nog geen veilige productieomgeving. Toegangscontrole, privacy, beveiliging, herstel en acceptatie vragen een beoordeling passend bij de gegevens en de gevolgen van fouten. Beloof geen tijdwinst voordat je de bestaande werkwijze en het werkende resultaat op dezelfde manier hebt gemeten.',
      ]),
    }),
    Object.freeze({
      heading: 'Neem een procesbeschrijving mee naar het eerste gesprek',
      paragraphs: Object.freeze([
        { text: 'Neem één ingevulde proceszin, de gebruikte systemen, een normale situatie en een foutscenario mee. Geef aan welke beslissingen mensen moeten blijven nemen. Daarmee kan een bouwer gerichter aangeven wat inrichting is, waar een koppeling nodig is en welk deel ontwikkeling vraagt. Bespreek een afgebakende softwareopdracht zodra die grens duidelijk is.', links: [{ anchor: 'afgebakende softwareopdracht', href: '/bedrijfssoftware-op-maat' }] },
      ]),
    }),
  ]),
  faq: Object.freeze([]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
    Object.freeze({ label: 'AI automatisering voor het MKB', href: '/blog/ai-automatisering-mkb-waar-beginnen' }),
    Object.freeze({ label: 'Standaard, hybride of maatwerk kiezen', href: '/vergelijkingen/maatwerk-software-vs-standaard-software', availableFrom: '2026-05-24' }),
    Object.freeze({ label: 'Softwareoffertes beoordelen', href: '/blog/maatwerk-software-offerte-beoordelen', availableFrom: '2026-07-17' }),
  ]),
});

module.exports = { BUSINESS_SOFTWARE_EXPLAINER };
