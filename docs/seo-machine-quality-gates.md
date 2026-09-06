# Softora SEO Machine Quality Gates

Deze poorten voorkomen dat productiesnelheid wordt verward met organische groei. Google-indexatie, unieke informatiewinst en gekwalificeerde impact gaan voor pagina- of woordenaantallen.

## Afdwingbare Waarheid

- Propertytotalen komen uit een GSC-query zonder dimensies.
- Zichtbare queryregels worden apart verdeeld in branded en non-branded; het verschil met propertytotalen heet `unclassified` en krijgt geen verzonnen merklabel.
- Sitemapcontrole bewaart `lastSubmitted`, `lastDownloaded`, errors, warnings en ingediende aantallen.
- Een publicatie kan afzonderlijk `live`, `discovered`, `indexed`, `impressing`, `clicking` en `converting` zijn.
- Alleen een live 200-HTML-route op de actuele productiecommit met self-canonical, indexeerbaarheid, sitemapvermelding en correcte publicatiedatum telt als live publicatie.
- `/website`, `/bedrijfssoftware`, `/voicesoftware` en `/chatbot` zijn permanent uitgesloten van alle routegerichte SEO-rapportage en -acties. Zij mogen niet worden geselecteerd, aangemaakt, gewijzigd, vergeleken, geïnspecteerd, gelinkt, als target gebruikt of in backlog, sitemap en SEO-inventory worden opgenomen; de actieve alternatieven zijn `/website-laten-maken`, `/bedrijfssoftware-op-maat`, `/voicesoftware-op-maat` en `/chatbot-laten-maken`.

## Machine-Toestanden

De dagelijkse `seo:cadence:check` beslist in deze volgorde: `operations_p0`, `data_degraded`, `indexation_recovery`, `performance_recovery`, `quality_recovery`, `growth`, `scale`. Iedere succesvolle niet-P0-run levert de beste bewijsdekte publieke groeiverbetering. Er geldt geen nieuwe-URL-minimum: een bestaande GSC-kans kan voorgaan. De harde cap blijft zeven nieuwe groei-URL's en maximaal twee `money_page` per rollende 7 dagen.

De toestand verlaagt het veilige dagelijkse publicatieritme niet, maar bepaalt de verplichte begeleidende optimalisatie. In `indexation_recovery` blijven contextuele links, discovery, consolidatie, canonicalherstel en versterking van bestaande pagina's belangrijk. In `quality_recovery` worden automatische opvultekst, overlap en herhaalde alinea's vervangen door pagina-eigen informatie. Iedere geselecteerde groei-actie benoemt in `selected.supportingAction` welke andere bestaande publieke pagina in dezelfde gerichte wijziging wordt versterkt en waarom.

In `performance_recovery` blijft de dagelijkse nieuwe-URL-lane actief en wordt query/pagina-match, snippetwerk, interne routing of positionering van bestaande output de `companionAction`. Deze toestand start pas bij minimaal vijf reviewbare D28-URL's en minder dan 40% non-branded impressiedekking, of bij minimaal 100 cohortimpressies zonder klik. `scale` vereist minimaal 60% impressiedekking en minimaal tien zichtbare non-branded klikken over ten minste drie URLs. Dit zijn interne capaciteitsgrenzen, geen Google-rankingfactoren.

Als `performance_recovery` en generieke corpusbrede `quality_recovery` tegelijk rood zijn, wint de meetbare D28-uitkomst. Kandidaatkwaliteit, cannibalisatie, claims, visuals en unieke informatiewinst blijven desondanks harde poorten; deze prioriteit voorkomt alleen dat historische templateschuld een concreet nulresultaat eindeloos maskeert.

De live ledger rapporteert `newUrls`, `growthNewUrls`, `editorialNewUrls`, `moneyPageNewUrls`, `otherNewUrls`, `unclassifiedNewUrls`, `substantialRefreshes` en `otherGrowthActions` apart. Alleen `editorialNewUrls` en `moneyPageNewUrls` tellen voor de harde cap; een refresh of utility-URL doet nooit alsof er een nieuwe redactionele of commerciële zoekingang is gemaakt. Een ongeclassificeerde nieuwe URL is een operationele fout en mag de geldpagina-cap niet omzeilen. Meer dan zeven groei-URL's of meer dan twee geldpagina's in het inclusieve rollende 7-daagse UTC-datumvenster is eveneens een operationele P0.

## Nieuwe Content: Quality Version 2

Nieuwe en substantieel vernieuwde content gebruikt `qualityVersion: 2` en voldoet aan alle volgende punten:

- Unieke intent, koperstaak, funnelstap, money page en clusterrol zijn vooraf vastgelegd.
- `informationGain` beschrijft concreet welke eigen analyse, beslismethode, praktijkkennis of bronduiding nergens anders op Softora staat.
- Controleerbare bronnen ondersteunen actuele of externe feiten; een intern inventarisgat alleen is onvoldoende vraagbewijs.
- De drie dichtstbijzijnde Softora-URL's zijn vergeleken met een expliciet `distinct`, `merge` of `reject`-besluit.
- Hoofdsecties zijn pagina-eigen. Quality version 2 krijgt geen generieke verrijkingssecties en geen automatische FAQ.
- FAQ wordt alleen toegevoegd wanneer echte kopersvragen nuttig worden beantwoord; FAQ-schema volgt alleen zichtbare FAQ-inhoud.
- Vaste woordenaantallen zijn geen kwaliteitsbewijs. De pagina moet de taak volledig, praktisch en zonder opvulling beantwoorden.
- De hoofdtekst bevat minimaal twee natuurlijke contextuele links, waaronder een logische route naar de money page.
- Nieuwe of substantieel vernieuwde blogs gebruiken exact twee nuttige eigen Softora-visuals met beschrijvende bestandsnaam, betekenisvolle alt, vaste dimensies en gecontroleerd gewicht.
- Geen stockfoto's, placeholders, generieke kantoorbeelden of decoratieve filler.
- De verantwoordelijke auteur of organisatie, claims, CTA, mobiel gedrag, schema en publieke/private scheiding zijn groen. Standaard staat Softora als organisatie vermeld; menselijke auteurschap of controle wordt nooit automatisch toegeschreven. Een optionele review vereist `reviewedBy` en `reviewEvidence` met `reviewedAt` en `reference` voor de actuele inhoud. Zonder dat bewijs verschijnt geen reviewclaim in tekst of schema.

## Keywordbewijs En Natuurlijke Taal

Voor iedere nieuwe URL en substantiële contentrefresh bestaat vóór het schrijven een `keywordEvidence`-brief. Ubersuggest is daarin adviserend en read-only; het mag nooit zelfstandig een kandidaat publiceren, afwijzen, scoren of woorden in de tekst afdwingen.

- De vaste Nederlandse basis is `locId: 2528` met `language: Dutch`. Controleer de effectieve locale in iedere response die deze teruggeeft; Global- of United States-data wordt afgewezen als Nederlands bewijs.
- Gebruik één tot drie onderbouwde seeds en combineer keyword suggestions, Google suggestions, keyword overview en SERP analysis. Alleen bij ontbrekende of conflicterende data zijn maximaal twee aanvullende read-only controles toegestaan.
- `0` geschat volume is `no_measurable_provider_volume`, niet `no_demand`. Geen enkele volume-, CPC-, difficulty-, intent- of trafficwaarde mag op zichzelf de keuze bepalen.
- De uiteindelijke afweging combineert GSC, buyer task, business fit, Nederlandse SERP-intentie, actuele openbare bronnen, unieke informatiewinst, bestaande Softora-URL's en cannibalisatierisico.
- Relevante termen krijgen per term `used`, `covered_semantically` of `rejected` met een korte reden. Er bestaat geen minimale keyworddichtheid, verplichte exact-matchtelling, meta-keywordsveld of automatische FAQ met varianten.
- De callledger moet exact aansluiten op `callsUsed`; termen verwijzen naar hun researchtool. Minimaal één als `used` gemarkeerde term staat werkelijk in de zichtbare paginacopy en de voorlopige primaire term heeft een expliciet niet-afgewezen besluit.
- Lees de definitieve tekst als mens: verwijder onnatuurlijke herhaling, losse keywordlijsten en secties die alleen bestaan om een variant te plaatsen. Titel, H1, intro, secties, metadata en ankertekst blijven primair helder en behulpzaam voor de koper.
- `keyword_metrics`, `generate_article`, projectmutaties, backlinks, site audits en iedere betaalde fallback blijven verboden. Onbeschikbaarheid wordt als `external_research_unavailable` gerapporteerd en blokkeert een veilige GSC- en SERP-onderbouwde actie niet.

## Kandidaatkeuze En Uitvoeringsreceipt

- Vóór implementatie koppelt `selection-evidence.json` aan de exacte `generatedAt` van het verse GSC-rapport en beoordeelt het minimaal de top drie `queries.prioritized` in dezelfde volgorde, met ongewijzigde query, pagina en score.
- Iedere hoger gerangschikte skip gebruikt een begrensde reden plus controleerbaar bewijs. `recent_material_change` en `protect_proven_winner` vereisen `lastChangedAt`, `recheckAt` en een commit- of PR-referentie; overlap vereist drie concrete URL's; `binding_new_url_floor` is verboden; publicatiequota zijn geen skipbewijs. De gekozen capaciteit moet overeenkomen met de echte cadence-receipt.
- De geselecteerde actie benoemt bron, buyer task, verwachte gekwalificeerde impact en vergelijkingsbewijs. Ubersuggest kan deze keuze informeren maar nooit beslissen.
- `start-run` opent exact één invocation. Als `audit` eerst een oude actieve invocation vindt, sluit `recover-run` haar expliciet als `interrupted` en `unverified` met herstelbewijs voordat een nieuwe tellerstap mag beginnen. `start-run` weigert iedere nieuwe invocation zolang die expliciete recovery ontbreekt.
- `finish-run` sluit iedere outcome met publiek effect en bewijs. `published` vereist bovendien een PR-nummer, Softora-URL, live commit en acht groene receipts uit exact dezelfde invocation: `cadence`, `reviews`, `selection`, `keywords`, `visuals`, `verify_critical`, `live_production` en `live_route`. De geselecteerde URL is exact de gecontroleerde live route en iedere geselecteerde ondersteunende actie heeft overeenkomend groen live bewijs. Commitgebonden receipts delen dezelfde finale Git-tree; live receipts delen dezelfde live commit en gewijzigde URL.
- De actieve automation-task heeft een vastgelegd toolbindingbewijs en een echte read-only dataproef voor `mcp__ubersuggest__keyword_suggestions`, `mcp__ubersuggest__google_suggestions`, `mcp__ubersuggest__keyword_overview` en `mcp__ubersuggest__serp_analysis`. `record-tool-smoke --outcomes-json` bewaart per tool `ok` of `ok_empty` plus het echte resultaataantal. Alleen toolnamen, vrije tekst of `validate_site` zijn geen dataproef. Provider-auth of quota kan daarna nog degraderen; een ontbrekende task-toolset is een afzonderlijk bindingsdefect.

## Google-Aligned Visual System

### Pagina-ervaring en conversie

Een geslaagde HTML- of afbeeldingscontrole bewijst geen bruikbare pagina. Vanaf run-gateversie 3 bevat `live_route` ook gecontroleerd browserbewijs uit `reports/seo-agent/page-experience.json`. `seo:live-route:check --page-experience reports/seo-agent/page-experience.json` en `finish-run published` valideren dat bewijs opnieuw; historische receipts met versie 1/2 blijven geldig.

Het bestand heeft `schemaVersion: 1`, de exacte `url`, volledige `liveCommit`, echte `capturedAt`, expliciete `browser: iab|chrome` en precies twee `views`. Chrome vereist `chromeReason: authenticated_session|user_step|explicit_request`. Bewijs is maximaal een uur oud en hoort bij de actieve invocation. Iedere view bevat:

- `device: mobile|desktop`, `viewport: {width,height}` (mobiel 320-430px, desktop minimaal 1280px, hoogte minimaal 600px), gemeten `documentWidth`, `h1Count`, `brokenImages` en `bodyFontSize` van de hoofdtekst.
- `firstScreenAnswer: true` na zichtbare beoordeling van het antwoord of aanbod, zonder horizontale overflow en met leesbare tekst van minimaal 16px.
- `contact: {href,label,rect:{x,y,width,height},unobscured,keyboardFocusVisible}`. De schone contactroute is `https://wa.me/31643262792`; de knop is volledig in beeld, minimaal 44x44px en niet bedekt. Controleer het daadwerkelijke hit-element en bedien het toetsenbord; een link in HTML is onvoldoende.
- `navigation: {passed,evidence}` na het uitvoeren van een menu-, inhoudsopgave- of relevante interne navigatieactie. Controleer de bestemming en scrollpositie.
- `visualReview: {passed,evidence,screenshotReference}` met concrete bevindingen en een echte lokale screenshotreferentie of de vindplaats van de bekeken CUA-screenshot in de huidige task. Geen verzonnen meetwaarden, bestanden, toolresultaten of vinkjes. Deze visuele beoordeling blijft een waarneming, geen automatisch bewezen conversiewinst.

`fieldData` is expliciet `{status: unavailable, reason}` of bevat `status: measured`, bron-URL `source`, `scope: url|origin`, `percentile: 75`, `windowDays: 28`, `lcpMs`, `inpMs` en `cls`. Bij LCP boven 2500ms, INP boven 200ms of CLS boven 0.1 is een concrete `nextAction` verplicht. Een laboratoriumscore geldt nooit als velddata; ontbrekende gegevens worden niet nul. Review beschikbare velddata wekelijks en leg technische vervolgacties vast.

Ontwerp voor de bezoeker: antwoord/aanbod vóór decoratieve beelden, rustige navigatie, duidelijke koppen, nuttige ongecropte beelden en een begrijpelijke vervolgstap. Contactknoppen mogen tekst niet bedekken. FAQ, keurmerken, menselijke controle en resultaten worden alleen getoond wanneer ze kloppen. WhatsApp-klik, aanvraag, gekwalificeerde lead, opdracht en ontvangen betaling blijven afzonderlijke signalen; tests sturen geen synthetische conversies of berichten.

Google onderbouwt dit in [helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content?hl=en), [page experience](https://developers.google.com/search/docs/appearance/page-experience?hl=en) en [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals?hl=en). Google heeft geen voorkeurswoordenaantal; E-E-A-T is geen losse rankingfactor en goede ervaring garandeert geen toppositie. Quality Version 2 heeft daarom geen automatische woordvloer; inhoudelijke bronnen, unieke informatiewinst, zoekintentie, claims en nuttige interne routes blijven harde controles.

Vanaf `2026-08-05` draait voor iedere nieuwe of substantieel vernieuwde blog eerst `npm run seo:visuals:check`. De regel van exact twee beelden is een interne Softora-kwaliteitskeuze, geen door Google gepubliceerde rankingfactor.

- Het hero-beeld is representatief voor het concrete onderwerp, minimaal 1200 pixels breed, groter dan 300.000 pixels, 16:9, tekstarm en veilig als grote zoekpreview.
- Het tweede beeld is verklarend: bijvoorbeeld een beslismatrix, beslisboom, procesdiagram, geannoteerde interface, architectuurplaat of datavisualisatie.
- Hero en supportbeeld gebruiken verschillende `visualType`- en `visualFamily`-waarden. Een volgende publicatie hergebruikt geen visuele familie uit de zes recentste blogs.
- Iedere beeldbrief beschrijft compositie, informatiedoel en het concrete verschil met recente Softora-beelden. Alleen "in Softora-stijl" is geen bruikbare brief.
- De validator vergelijkt pixelkenmerken met de zes recentste blogs. Een gecombineerde overeenkomst van `0.85` of hoger blokkeert een nieuwe kandidaat. Dit is een interne kwaliteitsdrempel tegen repeterende beeldformules, geen Google-rankingfactor.
- Historische gelijkenis van voor de ingangsdatum wordt als `quality_recovery`-schuld gerapporteerd en blokkeert niet stilletjes iedere toekomstige publicatie.
- Bestanden blijven lokaal eigendom van Softora, hebben een beschrijvende bestandsnaam, betekenisvolle alt, vaste dimensies, gecontroleerd gewicht, een gewone `<img src>` en relevante omringende tekst.
- Contentpagina's bieden `max-image-preview:large`, `og:image` met dimensies, een `ImageObject` in structured data en afbeeldingslocaties in de XML-sitemap.
- AI-gegenereerde beelden krijgen broncode `trainedAlgorithmicMedia`. De machine verzint geen C2PA- of IPTC-bewijs dat niet werkelijk in het bestand aanwezig is.

Deze poort volgt Google's openbare richtlijnen over [Google Images](https://developers.google.com/search/docs/appearance/google-images), [grote Discover-afbeeldingen](https://developers.google.com/search/docs/appearance/google-discover), [generatieve content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) en [image metadata](https://developers.google.com/search/docs/appearance/structured-data/image-license-metadata). Visuele afwisseling is hier een middel voor relevantie, informatiewinst en bruikbaarheid; niet een verzonnen directe rankingbelofte.

## Corpusoriginaliteit

De machine meet op de volledige contentverzameling:

- gemiddeld aandeel automatisch toegevoegde hoofdcontent, met interne herstelgrens 35%;
- aandeel herhaalde hoofdparagrafen, met interne herstelgrens 10%;
- lexicale Jaccard-overlap van het dichtstbijzijnde paginapaar, met interne herstelgrens 0,72.

Dit zijn interne alarmsignalen, geen Google-rankingfactoren. Overschrijding zet de machine in `quality_recovery`; zij bewijst niet automatisch dat een pagina spam is.

## Indexatie En Aanvraagbewijs

- `seo:indexation:report` inspecteert money pages en recente contentcohorten via URL Inspection.
- Voor iedere nieuwe live niet-geindexeerde URL wordt via Search Console eenmaal indexering aangevraagd wanneer browser en quota beschikbaar zijn.
- De automation memory bewaart `already_indexed`, `requested`, `quota_blocked`, `browser_blocked` of `failed`, plus datum en bewijs.
- Een geblokkeerde of mislukte aanvraag blijft schuld voor de volgende run.
- Herhaal een aanvraag niet zonder materiele wijziging of gedocumenteerd vervolgvenster.
- Gebruik de Google Indexing API nooit voor gewone blogs, kennisbank-, vergelijkings- of landingspagina's.

## Claims, Conversie En Veiligheid

- Geen ranking-, lead- of omzetgaranties, absolute security/uptimeclaims, onbewezen certificeringen, marktleiderschap, klantenaantallen of autonome-AI-beloften.
- Publieke identiteit blijft Softora/Martijn waar nodig; noem Serve Creusen niet op frontstage SEO-pagina's.
- Klant-CTA's gebruiken `https://wa.me/31643262792` zonder vooraf ingevulde tekst en hebben meetlabels.
- Homepage-content en high-risk lead/auth/agenda/coldcalling blijven buiten automatische SEO-wijzigingen.
- Doe geen backlink-outreach; gastblogs, directories, linkruil, betaalde links en andere off-site linkbuilding blijven volledig buiten scope.

## Definition Of Done

- `npm run seo:backlog:check` is groen.
- `npm run seo:publications:report -- --json` geeft een betrouwbare live ledger.
- `npm run seo:indexation:report -- --json` geeft verse inspectiestatus of expliciet `data_degraded`.
- `npm run seo:visuals:check` blokkeert nieuwe repeterende beeldfamilies, zwakke beeldbriefs en ongeschikte previewformaten.
- `npm run seo:keywords:check` blokkeert toekomstige nieuwe of substantieel vernieuwde content zonder geldige `keywordEvidence`; een bewezen `external_research_unavailable`-fallback blijft toegestaan.
- `npm run seo:reviews:check` leidt alle verschuldigde D14/D28/D56-items uit de vaste memory af en blokkeert totdat exact die set een gestructureerde uitkomst, baselinevergelijking, indexatiestatus, non-branded signalen, besluit en volgende actie bevat. Rapport, bewijs en werkelijk ingelezen repopad moeten overeenkomen en binnen hetzelfde verse venster van 30 minuten vallen.
- `npm run seo:selection:check` blokkeert een keuze zonder exacte top-drie GSC-afweging, met ouder dan 30 minuten of verkeerd gekoppeld rapportbewijs, met vaag skipbewijs, buiten `allowedPublicationLanes`, boven de money-pagecap of zonder concrete `selected.supportingAction` op een route uit de canonieke publieke inventaris plus machineleesbaar live verificatieplan. Een bestaande primaire route moet in die inventaris staan; `new_url` moet juist nog niet live zijn en exact in de ready backlog voorkomen.
- `npm run seo:live-route:check -- --url <gewijzigde-url> --live-commit <commit>` laadt hetzelfde selectiebewijs en bewijst na productiepariteit dat de geselecteerde URL exact de echte route is en dat route, canonical, metadata, H1, indexeerbaarheid, sitemap, CTA en publieke scheiding groen zijn. De bestaande ondersteuningsroute moet eveneens live, indexeerbaar, self-canonical en in de sitemap zijn en het beloofde link-, tekst- of snippetbewijs bevatten; SEO-content bewijst daarnaast haar beelden en image-searchsignalen.
- `npm run seo:automation-state -- audit` bewijst exact één ACTIVE heartbeat, dezelfde vaste task zonder runlimiet, Ubersuggest-toolbinding en echte vier-tool dataproef, de vaste 08:15-planning en promptversie `SEO_MACHINE_PROMPT_VERSION=10` met verplichte kosten-, Qwen-, browser-, review-, selectie-, lifecycle-, deadline- en vaste-taskcontroles. Openbaar onderzoek en paginatests gebruiken standaard de interne Codex-browser via `cua.createBrowserTab("iab", url, { visible: false })`; gewone Chrome is voor een benodigde ingelogde sessie, gebruikersstap of expliciet verzoek. Edge, cloud- en generieke fallbackroutes blijven verboden. De audit weigert verouderde Chrome-only-instructies. `start-run` opent en telt de invocation idempotent vóór SEO-effecten en weigert een open oude run; `recover-run` sluit oude uitvoeringsschuld expliciet; `finish-run published` vereist alle acht dezelfde-runreceipts op dezelfde finale tree/live commit en bindt de geselecteerde URL plus ondersteunende actie aan het live bewijs; `inspect` bewijst de actuele staat; `keep-thread` verwijdert de legacy runlimiet onder lock, bewaart teller/historie/receipts en zet schema 2 met `threadPolicy=same_thread` en `maxRunsPerThread=null`; `rotate-thread` en `repair-thread-binding` blokkeren taskwissels voor deze staat; `record-tool-binding`, `record-tool-smoke` en `record-keywords` bewaken respectievelijk task-tools, echte datawerking en dagcaps zonder een tweede automation.
- De GSC-output bevat een deadlinebestendige `growthHorizon`: vóór 31 december 2026 gap/factor/tempo, erna geen fictief resterend tempo maar een expliciete doorlopende 28/90-daagse compoundingfase totdat Servé de automation pauzeert.
- `npm run seo:cadence:check` noemt toestand, verplichte actie, request evidence debt, groei-URL-target, redactionele achterstand, money-pagecapaciteit, verplichte lane en begeleidende optimalisatie.
- Gerichte tests en `npm run verify:critical` zijn groen.
- PR, merge, productiecommit en live-routeverificatie zijn als dezelfde-runreceipts aantoonbaar; merged-but-not-live of een groene poort van een andere invocation/tree telt nooit als publicatie.

## Brongetrouwe feedback

Reviewcijfers moeten exact overeenkomen met `deriveExperimentReviewMetrics` op de gekoppelde `pages.nonBranded`-rijen en experimentpaden. Ontbrekende rijen betekenen `null` plus `insufficient_data`/`hold`, niet nul verkeer. Een afwezige bronrij mag nooit een gewonnen experiment opleveren. Posities worden op vertoningen gewogen. Schalen vereist minimaal tien non-branded klikken verdeeld over drie URL's, naast de bestaande indexatie- en kwaliteitsvoorwaarden.
