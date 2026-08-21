const CUSTOMER_PORTAL_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'wat-is-een-klantportaal',
  title: 'Wat is een klantportaal? Functies, rechten en keuze',
  description:
    'Leer wanneer een klantportaal zinvol is en leg taken, brondata, rollen, uitzonderingen en acceptatietests vast voordat je software kiest.',
  category: 'Bedrijfssoftware',
  intent: 'Uitleg en keuze',
  qualityVersion: 2,
  primaryIntent: 'Een klantportaal begrijpen en bepalen of een eerste afgebakende versie zinvol is',
  buyerTask:
    'Een terugkerende klanttaak vertalen naar een toetsbare portaalkaart met gebruiker, actie, brondata, toegangsrecht, bewijs en menselijke uitzonderingsroute voordat standaardsoftware of maatwerk wordt gekozen',
  funnelStage: 'consideration',
  targetMoneyPage: '/bedrijfssoftware-op-maat',
  uniqueClusterRole:
    'Beslis- en afbakeningsgids voor de klantgerichte selfservicelaag; de bedrijfssoftwaredefinitie behandelt interne maatwerksoftware, de CRM-definitie het interne klantdossier en de CRM-vergelijking de keuze tussen standaard en maatwerk CRM.',
  informationGain:
    'Een zesveldige portaalkaart voor gebruiker, taak, leidend systeem, recht, zichtbaar bewijs en uitzondering, aangevuld met een eerste-releasefilter en acceptatiescenario\'s waarmee een MKB-team een portaal op klanttaak en beheersbaarheid beoordeelt in plaats van op een losse functielijst.',
  sources: Object.freeze([
    Object.freeze({
      title: 'NCSC: ICT-beveiligingsrichtlijnen voor webapplicaties',
      url: 'https://www.ncsc.nl/webapplicaties/ict-beveiligingsrichtlijnen-webapplicaties',
      observedAt: '2026-08-21',
    }),
    Object.freeze({
      title: 'Autoriteit Persoonsgegevens: verantwoordingsplicht, privacy by design en privacy by default',
      url: 'https://autoriteitpersoonsgegevens.nl/nl/onderwerpen/algemene-informatie-avg/verantwoordingsplicht',
      observedAt: '2026-08-21',
    }),
  ]),
  growthEventKind: 'substantial_refresh',
  growthEventAt: '2026-08-21',
  publishedAt: '2026-06-19',
  updatedAt: '2026-08-21',
  visualQualityVersion: 2,
  visualBrief: Object.freeze({
    hero: Object.freeze({
      role: 'representative',
      visualType: 'documentary-process',
      visualFamily: 'documentary-access-rights-workbench',
      composition:
        'Donkere fysieke werktafel van bovenaf met rolkaarten, transparante rechtenlagen, drie gescheiden klantdossiers, routepijlen, hardwarebeveiligingssleutel en auditnotitie.',
      informationGoal:
        'Maakt zichtbaar dat een portaal niet bij schermen begint, maar bij de vraag welke rol welk dossier en welke actie mag bereiken.',
      differenceFromRecent:
        'Documentaire objectfotografie zonder persoon, laptop, zwevend dashboard, witte isometrische tegels of centraal scherm; materiaal, schaduw en horizontale rechtenroute bepalen de compositie.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: true,
    }),
    support: Object.freeze({
      role: 'explanatory',
      visualType: 'architecture-diagram',
      visualFamily: 'vermilion-bauhaus-permission-route',
      composition:
        'Asymmetrische zwarte zigzagroute over full-bleed vermiljoen zeefdrukpapier met zes grote crèmekleurige controlepunten en een mintgroene menselijke uitzonderingslus.',
      informationGoal:
        'Legt zonder tekst de route uit van klantactie via identiteit, rechten en leidend systeem naar workflow, bevestiging en auditbewijs.',
      differenceFromRecent:
        'Full-bleed vermiljoen Bauhaus-zeefdruk met korrel en een asymmetrische route; geen witte achtergrond, fotografie, 3D, dashboard, rij gelijke cirkels, blauwe signaalkaart of tekstlabels.',
      sourceType: 'trainedAlgorithmicMedia',
      textDensity: 'none',
      previewSafe: false,
    }),
  }),
  image: Object.freeze({
    src: '/assets/seo-content/klantportaal-rechtenwerktafel-softora.jpg',
    alt: 'Werktafel met rolkaarten, gescheiden klantdossiers, rechtencontroles en een beveiligingssleutel voor een klantportaal.',
    width: 1600,
    height: 900,
    sourceType: 'trainedAlgorithmicMedia',
  }),
  secondaryImage: Object.freeze({
    src: '/assets/seo-content/klantportaal-toegangsflow-controle-softora.jpg',
    alt: 'Architectuur van een klantportaal met identiteit, rechten, bronsysteem, workflow, bevestiging, auditlog en menselijke uitzonderingsroute.',
    width: 1600,
    height: 900,
    sourceType: 'trainedAlgorithmicMedia',
    caption:
      'Een beheerste portaalactie passeert identiteit, rechten en broncontrole voordat het systeem iets wijzigt of bevestigt.',
  }),
  summary:
    'Een klantportaal is een afgeschermde webapplicatie waarin een klant na identificatie eigen informatie kan bekijken of afgesproken acties kan uitvoeren. Het portaal is pas zinvol wanneer het een concrete klanttaak eenvoudiger maakt, gegevens uit een aangewezen bronsysteem toont en toegang, uitzonderingen en menselijk herstel aantoonbaar zijn ontworpen.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Het korte antwoord: een persoonlijke werklaag voor klanten',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een openbare website toont in beginsel dezelfde informatie aan iedere bezoeker. Een klantportaal toont na inloggen alleen de informatie en acties die bij een specifieke klant, organisatie en rol horen. Denk aan een status bekijken, een document aanleveren, gegevens controleren, een afspraak aanvragen of een akkoord vastleggen. Het portaal is daarmee geen losse map achter een wachtwoord, maar een klantgerichte werklaag boven bestaande bedrijfssoftware.',
          links: Object.freeze([
            Object.freeze({ anchor: 'bedrijfssoftware', href: '/bedrijfssoftware-op-maat' }),
          ]),
        }),
        'De waarde ontstaat niet doordat alle mogelijke functies beschikbaar zijn. Zij ontstaat wanneer een terugkerende klanttaak aantoonbaar duidelijker wordt en het interne team dezelfde, betrouwbare status gebruikt. Een portaal kan daarom klein starten. Een goed afgebakende eerste versie met één taak, één gegevensbron en een bruikbaar foutpad is vaak beter te beoordelen dan een brede omgeving met documenten, berichten, planning, betalingen en dashboards tegelijk.',
      ]),
    }),
    Object.freeze({
      heading: 'Begin bij de klantvraag die nu heen en weer blijft gaan',
      paragraphs: Object.freeze([
        'Verzamel gedurende een representatieve periode welke vragen via mail en telefoon terugkomen. Noteer niet alleen het onderwerp, maar ook wat de klant probeert af te ronden, welke informatie een medewerker opzoekt, in welk systeem die informatie staat en welke uitzondering extra uitleg vraagt. Voorbeelden zijn de actuele opdrachtstatus, een ontbrekend document, een wijziging van contactpersoon of een afspraak die opnieuw moet worden gepland.',
        'Kies daarna één taak die vaak genoeg voorkomt, een duidelijke eigenaar heeft en zonder onbegrensde beoordeling kan worden uitgevoerd. Een portaal is minder geschikt als iedere aanvraag maatwerkoverleg vereist of als de brondata structureel onbetrouwbaar is. Los dan eerst het proces of de data op. Anders krijgt de klant vooral sneller zicht op dezelfde onduidelijkheid en moet het team naast het portaal alsnog via losse kanalen corrigeren.',
      ]),
    }),
    Object.freeze({
      heading: 'Vul voor iedere portaaltaak zes velden in',
      paragraphs: Object.freeze([
        'Gebruik een compacte portaalkaart met zes velden: gebruiker, taak, leidend systeem, recht, zichtbaar bewijs en uitzondering. De gebruiker beschrijft niet alleen de klant, maar ook de rol binnen een klantorganisatie. De taak benoemt het gewenste resultaat. Het leidende systeem bepaalt waar de actuele status of het document wordt beheerd. Het recht legt vast wie mag kijken, toevoegen, wijzigen, goedkeuren of verwijderen.',
        'Het zichtbare bewijs vertelt de klant wat daadwerkelijk is gebeurd: bijvoorbeeld een ontvangen document met datum en referentie, of een wijzigingsverzoek met status in behandeling. De uitzondering beschrijft wat gebeurt bij ontbrekende gegevens, verlopen toegang, een conflict met de brondata of een actie die menselijke beoordeling vereist. Met deze zes velden kan een leverancier een schermontwerp koppelen aan echte gegevens, bevoegdheden en acceptatie in plaats van alleen aan een lijst gewenste knoppen.',
      ]),
    }),
    Object.freeze({
      heading: 'Kies de eerste release met een taakfilter, niet met een wensenlijst',
      paragraphs: Object.freeze([
        'Beoordeel iedere gewenste functie op vier vragen. Kan de klant de taak zonder extra uitleg begrijpen? Is de benodigde brondata betrouwbaar en tijdig beschikbaar? Kan het toegangsrecht eenduidig worden getest? Is er een veilige en werkbare route wanneer de normale stap niet lukt? Alleen functies die op alle vier vragen een duidelijk antwoord hebben, horen in de eerste release. De rest blijft zichtbaar op een latere beslislijst.',
        'Een eerste versie kan bijvoorbeeld alleen status en ontbrekende documenten tonen, plus één gecontroleerde uploadactie. Berichten, facturen, afspraken en goedkeuringen volgen pas wanneer eigenaarschap, brondata en rechten daarvoor zijn uitgewerkt. Dat is geen kunstmatige beperking. Het maakt het mogelijk om met echte gebruikssituaties te testen of klanten de omgeving begrijpen, medewerkers de uitzonderingen kunnen behandelen en gegevens niet buiten het afgesproken proces worden bijgehouden.',
      ]),
    }),
    Object.freeze({
      heading: 'Laat CRM, planning of dossier het leidende systeem blijven',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een portaal bewaart bij voorkeur niet stilletjes een tweede versie van klantstatus, contactgegevens of afspraken. Wijs per gegeven een leidend systeem aan en beschrijf richting, moment en foutgedrag van de koppeling. CRM kan bijvoorbeeld klant en contactrollen beheren, terwijl planning de afspraakstatus beheert en documentopslag het originele bestand bewaart. De gids over een CRM-integratie helpt om identifiers, veldmapping en herstel vooraf expliciet te maken.',
          links: Object.freeze([
            Object.freeze({ anchor: 'gids over een CRM-integratie', href: '/kennisbank/wat-is-een-crm-integratie' }),
          ]),
        }),
        'Toon de klant wanneer informatie voor het laatst is bijgewerkt als actualiteit niet direct gegarandeerd kan worden. Laat een wijziging niet automatisch als voltooid zien wanneer zij alleen is aangevraagd. Gebruik een stabiele gebeurtenis- of aanvraag-id zodat opnieuw verzenden niet ongemerkt een tweede taak, document of afspraak maakt. Test ook wat de gebruiker ziet wanneer het bronsysteem tijdelijk niet bereikbaar is; een nette foutmelding zonder herstel of eigenaar is nog geen beheerst proces.',
      ]),
    }),
    Object.freeze({
      heading: 'Ontwerp rollen, minimale gegevens en toegang vanaf de tekentafel',
      paragraphs: Object.freeze([
        'Maak een rechtenmatrix met klantrol en handeling. Een gewone gebruiker, financiële contactpersoon en klantbeheerder hoeven niet dezelfde dossiers of acties te zien. Controleer zowel de interface als de serverkant: een verborgen knop is geen toegangscontrole. Neem ook de levenscyclus mee. Wie nodigt een gebruiker uit, wie trekt toegang in bij functiewijziging en hoe wordt gecontroleerd dat iemand nog bij de juiste klantorganisatie hoort?',
        'De Autoriteit Persoonsgegevens beschrijft privacy by design als gegevensbescherming meenemen bij het ontwerp en privacy by default als standaard alleen noodzakelijke persoonsgegevens verwerken. Vertaal dat naar de portaalkaart: toon en bewaar per taak alleen wat nodig is, leg bewaartermijnen en verwijdering vast en voorkom dat technische logs onnodig volledige documenten of gevoelige velden kopiëren. Dit is geen automatische AVG-goedkeuring; de verantwoordelijke organisatie moet de concrete verwerking, risico’s en maatregelen zelf beoordelen.',
        'De actuele NCSC-richtlijnen voor webapplicaties zijn bedoeld als brede leidraad voor veiliger ontwikkelen, beheren en aanbieden van webapplicaties en kunnen ook bij opdrachtverlening en afspraken worden gebruikt. Neem authenticatie, sessiebeheer, autorisatie, logging, updates, incidentafhandeling en beheer daarom als aantoonbare eisen op. Geen losse beveiligingsfunctie maakt een portaal absoluut veilig; de combinatie van ontwerp, implementatie, testen en beheer bepaalt welke risico’s overblijven.',
      ]),
    }),
    Object.freeze({
      heading: 'Bouw een menselijke uitzonderingsroute die echt uitvoerbaar is',
      paragraphs: Object.freeze([
        'Niet iedere klantactie mag automatisch door. Een afwijkend rekeningnummer, conflicterende organisatiekoppeling, onleesbaar document of verzoek met financiële gevolgen kan beoordeling vereisen. Leg vast welke actie stopt, welke medewerker eigenaar wordt, welke context die persoon ziet en welke uitkomsten zijn toegestaan. De klant krijgt een eerlijke status zoals ontvangen, controle nodig, goedgekeurd of afgewezen, zonder dat het portaal een besluit voorspiegelt dat nog niet is genomen.',
        'Maak herstel zichtbaar voor beheer. Een medewerker moet een fout kunnen categoriseren, ontbrekende informatie opvragen, een veilige correctie uitvoeren en de route hervatten of sluiten. Bewaar voldoende auditbewijs om te reconstrueren wie welke actie heeft gestart en welke systeemstap volgde, maar verzamel niet meer gegevens dan nodig. Meet uitzonderingen apart; een hoog percentage handmatige behandeling kan betekenen dat de taak verkeerd is afgebakend of dat brondata en regels nog niet volwassen genoeg zijn.',
      ]),
    }),
    Object.freeze({
      heading: 'Test de portaalroute met rollen, fouten en bewijs',
      paragraphs: Object.freeze([
        'Schrijf acceptatiescenario’s vóór de bouw. Test minimaal: juiste gebruiker en juist dossier, gebruiker van een andere klantorganisatie, ingetrokken toegang, verlopen uitnodiging, ontbrekend verplicht veld, dubbel ingediend verzoek, onbereikbaar bronsysteem, fout bestandstype, menselijke beoordeling en herstel na een fout. Noteer per scenario de startdata, zichtbare uitkomst, wijziging in het leidende systeem, melding aan de eigenaar en auditbewijs.',
        'Gebruik fictieve of passende testgegevens en controleer niet alleen het scherm. Een succesmelding terwijl de bron niet is bijgewerkt is een defect. Een correct opgeslagen aanvraag zonder begrijpelijke bevestiging kan leiden tot opnieuw indienen. Laat medewerkers en enkele representatieve gebruikers de taak zonder mondelinge hulp uitvoeren. Noteer waar zij zoeken, twijfelen of een ander kanaal kiezen; die observaties zijn bruikbaarder dan alleen vragen of het portaal er duidelijk uitziet.',
      ]),
    }),
    Object.freeze({
      heading: 'Kies standaard, configuratie of maatwerk op procesfit en beheer',
      paragraphs: Object.freeze([
        'Een standaardportaal past wanneer rollen, taken, documenten en koppelingen grotendeels overeenkomen met wat het pakket ondersteunt. Configuratie past wanneer schermen, velden en workflows aangepast moeten worden zonder een eigen applicatie te onderhouden. Maatwerk wordt relevanter wanneer klantrollen, processtappen, databronnen of uitzonderingen aantoonbaar niet in een bestaande oplossing passen en die verschillen belangrijk genoeg zijn voor de klanttaak.',
        Object.freeze({
          text:
            'Vergelijk opties met dezelfde portaalkaart en acceptatiescenario’s. Vraag wat standaard, configureerbaar, via integratie of als maatwerk wordt geleverd; wie rechten en inhoud beheert; hoe gegevens worden geëxporteerd; welke externe diensten nodig zijn; en hoe fouten en wijzigingen na livegang worden behandeld. Een maatwerk platform kan passend zijn wanneer meerdere klanttaken op hetzelfde rollen- en datafundament moeten groeien, maar begin ook dan met één toetsbare eerste route.',
          links: Object.freeze([
            Object.freeze({ anchor: 'maatwerk platform', href: '/maatwerk-platform' }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Meet taakafronding en herstel voordat je uitbreidt',
      paragraphs: Object.freeze([
        'Leg vóór de pilot een nulmeting vast voor de gekozen taak: aantal vragen via mail of telefoon, gemiddelde wachttijd, aantal overdrachten, ontbrekende gegevens en correcties. Meet daarna hoeveel portaalroutes starten en afronden, waar gebruikers stoppen, hoeveel uitzonderingen ontstaan, hoe lang herstel duurt en hoeveel mensen alsnog een ander kanaal gebruiken. Registreer alleen gegevens die voor die beoordeling nodig zijn en spreek af wie de uitkomst interpreteert.',
        'Een verschuiving in dagelijks volume bewijst niet direct dat het portaal tijd, tevredenheid of omzet heeft veroorzaakt. Kijk over een passende periode, controleer eerst of de meting compleet is en bespreek kwalitatieve feedback naast aantallen. Breid pas uit wanneer de eerste taak begrijpelijk werkt, de brondata betrouwbaar blijft, toegangscontroles aantoonbaar zijn getest en het team uitzonderingen binnen de afgesproken route kan herstellen.',
      ]),
    }),
    Object.freeze({
      heading: 'Neem één echte klanttaak mee naar een eerste scopegesprek',
      paragraphs: Object.freeze([
        'Bereid geen volledige schermenlijst voor. Neem één terugkerende klantvraag, de betrokken rollen, het huidige bronsysteem, een normale route en twee lastige uitzonderingen mee. Daarmee kan worden bepaald of een openbare pagina, betere communicatie, een standaardportaal, configuratie, integratie of maatwerk het passende antwoord is. Soms is een nieuw portaal niet nodig; die uitkomst is waardevoller dan een omgeving bouwen die het bestaande probleem verplaatst.',
        Object.freeze({
          text:
            'Softora kan de portaalkaart, rechten, brondata, eerste-releasegrens en acceptatiescenario’s samen met het team uitwerken. Daarna wordt pas gekozen welke techniek past en hoe het klantportaal aansluit op CRM of andere bedrijfssoftware. Het gesprek levert geen garantie op een vaste doorlooptijd of bedrijfsresultaat op, maar wel een concreet besluitdocument waarmee scope en offertes inhoudelijk kunnen worden vergeleken.',
          links: Object.freeze([
            Object.freeze({ anchor: 'CRM', href: '/crm-systeem-op-maat' }),
            Object.freeze({ anchor: 'bedrijfssoftware', href: '/bedrijfssoftware-op-maat' }),
          ]),
        }),
      ]),
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
    Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
    Object.freeze({ label: 'Wat is een CRM-integratie?', href: '/kennisbank/wat-is-een-crm-integratie' }),
    Object.freeze({ label: 'Wat is bedrijfssoftware op maat?', href: '/kennisbank/wat-is-bedrijfssoftware-op-maat' }),
    Object.freeze({ label: 'CRM-eisen en wensenlijst', href: '/blog/crm-eisen-wensenlijst-mkb' }),
  ]),
});

module.exports = {
  CUSTOMER_PORTAL_CONTENT_ITEM,
};
