# Softora SEO Machine Quality Gates

Deze poorten voorkomen dat productiesnelheid wordt verward met organische groei. Google-indexatie, unieke informatiewinst en gekwalificeerde impact gaan voor pagina- of woordenaantallen.

## Afdwingbare Waarheid

- Propertytotalen komen uit een GSC-query zonder dimensies.
- Zichtbare queryregels worden apart verdeeld in branded en non-branded; het verschil met propertytotalen heet `unclassified` en krijgt geen verzonnen merklabel.
- Sitemapcontrole bewaart `lastSubmitted`, `lastDownloaded`, errors, warnings en ingediende aantallen.
- Een publicatie kan afzonderlijk `live`, `discovered`, `indexed`, `impressing`, `clicking` en `converting` zijn.
- Alleen een live 200-HTML-route op de actuele productiecommit met self-canonical, indexeerbaarheid, sitemapvermelding en correcte publicatiedatum telt als live publicatie.

## Machine-Toestanden

De dagelijkse `seo:cadence:check` beslist in deze volgorde: `operations_p0`, `data_degraded`, `indexation_recovery`, `performance_recovery`, `quality_recovery`, `growth`, `scale`. Iedere succesvolle run levert een publieke verbetering. Daarnaast geldt een harde rollende nieuwe-URL-vloer: 0 in `operations_p0`, 1 in `data_degraded`, `indexation_recovery`, `performance_recovery` en `quality_recovery`, 3 in `growth` en 5 in `scale`.

In `indexation_recovery` blijven contextuele links, discovery, consolidatie, canonicalherstel en versterking van bestaande pagina's belangrijk. In `quality_recovery` worden automatische opvultekst, overlap en herhaalde alinea's vervangen door pagina-eigen informatie. Geen van beide hersteltoestanden mag eindeloos alle nieuwe publicaties verdringen: als de vloer is gemist, wordt de volgende veilige publieke actie een nieuwe URL.

In `performance_recovery` verbetert de machine eerst de query/pagina-match, snippet, interne route of positionering van bestaande output. Deze toestand start pas bij minimaal vijf reviewbare D28-URL's en minder dan 40% non-branded impressiedekking, of bij minimaal 100 cohortimpressies zonder klik. `scale` vereist minimaal 60% impressiedekking en ten minste een non-branded klik. Dit zijn interne capaciteitsgrenzen, geen Google-rankingfactoren.

Als `performance_recovery` en generieke corpusbrede `quality_recovery` tegelijk rood zijn, wint de meetbare D28-uitkomst. Kandidaatkwaliteit, cannibalisatie, claims, visuals en unieke informatiewinst blijven desondanks harde poorten; deze prioriteit voorkomt alleen dat historische templateschuld een concreet nulresultaat eindeloos maskeert.

De live ledger rapporteert `newUrls`, `substantialRefreshes` en `otherGrowthActions` apart. Alleen `newUrls` telt voor de vloer. Een refresh kan wel meetellen voor het totale ritme, maar nooit doen alsof er een nieuwe indexeerbare ingang is gemaakt.

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
- Auteur, reviewer, claims, CTA, mobiel gedrag, schema en publieke/private scheiding zijn groen.

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
- Iedere hoger gerangschikte skip gebruikt een begrensde reden plus controleerbaar bewijs. `recent_material_change` en `protect_proven_winner` vereisen `lastChangedAt`, `recheckAt` en een commit- of PR-referentie; overlap vereist drie concrete URL's; een nieuwe-URL-vloer vereist de echte cadence-deficitstaat.
- De geselecteerde actie benoemt bron, buyer task, verwachte gekwalificeerde impact en vergelijkingsbewijs. Ubersuggest kan deze keuze informeren maar nooit beslissen.
- `start-run` opent exact één invocation. Als `audit` eerst een oude actieve invocation vindt, sluit `recover-run` haar expliciet als `interrupted` en `unverified` met herstelbewijs voordat een nieuwe tellerstap mag beginnen. De automatische onderbreking in `start-run` blijft alleen een fail-safe, zodat een crash nooit stil als succes verdwijnt.
- `finish-run` sluit iedere outcome met publiek effect en bewijs. `published` vereist bovendien een PR-nummer, Softora-URL, live commit en zeven groene receipts uit exact dezelfde invocation: `cadence`, `selection`, `keywords`, `visuals`, `verify_critical`, `live_production` en `live_route`. Commitgebonden receipts delen dezelfde finale Git-tree; live receipts delen dezelfde live commit en gewijzigde URL.
- De actieve automation-task heeft een vastgelegd toolbindingbewijs en een echte read-only dataproef voor `mcp__ubersuggest__keyword_suggestions`, `mcp__ubersuggest__google_suggestions`, `mcp__ubersuggest__keyword_overview` en `mcp__ubersuggest__serp_analysis`. `record-tool-smoke --outcomes-json` bewaart per tool `ok` of `ok_empty` plus het echte resultaataantal. Alleen toolnamen, vrije tekst of `validate_site` zijn geen dataproef. Provider-auth of quota kan daarna nog degraderen; een ontbrekende task-toolset is een afzonderlijk bindingsdefect.

## Google-Aligned Visual System

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
- `npm run seo:selection:check` blokkeert een keuze zonder exacte top-drie GSC-afweging of met vaag skipbewijs.
- `npm run seo:live-route:check -- --url <gewijzigde-url> --live-commit <commit>` bewijst na productiepariteit dat de echte route, canonical, metadata, H1, indexeerbaarheid, sitemap, CTA en publieke scheiding groen zijn; SEO-content bewijst daarnaast haar twee beelden en image-searchsignalen.
- `npm run seo:automation-state -- audit` bewijst exact één ACTIVE heartbeat, een overeenkomende rotatietask, Ubersuggest-toolbinding en echte vier-tool dataproef, de vaste 08:15-planning en promptversie `SEO_MACHINE_PROMPT_VERSION=5` met verplichte kosten-, Qwen-, Edge/Codex-, selectie-, lifecycle-, deadline- en rotatiecontroles. `start-run` opent en telt de invocation idempotent vóór SEO-effecten; `recover-run` sluit oude uitvoeringsschuld expliciet; `finish-run published` vereist alle zeven dezelfde-runreceipts op dezelfde finale tree/live commit; `inspect` bewijst de actuele staat; `rotate-thread` vereist na run 15 eerst de receipt; `repair-thread-binding` behoudt de teller bij een bewezen connectorbindingsdefect; `record-tool-binding`, `record-tool-smoke` en `record-keywords` bewaken respectievelijk task-tools, echte datawerking en dagcaps zonder een tweede automation.
- De GSC-output bevat een deadlinebestendige `growthHorizon`: vóór 31 december 2026 gap/factor/tempo, erna geen fictief resterend tempo maar een expliciete doorlopende 28/90-daagse compoundingfase totdat Servé de automation pauzeert.
- `npm run seo:cadence:check` noemt toestand, verplichte actie, request evidence debt, nieuwe-URL-vloer, achterstand en maximum nieuwe URL's.
- Gerichte tests en `npm run verify:critical` zijn groen.
- PR, merge, productiecommit en live-routeverificatie zijn als dezelfde-runreceipts aantoonbaar; merged-but-not-live of een groene poort van een andere invocation/tree telt nooit als publicatie.
