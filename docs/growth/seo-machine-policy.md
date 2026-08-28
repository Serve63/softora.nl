# Softora SEO Machine Policy

Dit document maakt de dagelijkse SEO-automation meetbaar en herhaalbaar. De automation leest daarnaast altijd `AGENTS.md`; bij conflict zijn de strengste veiligheidsregels leidend.

## Doelvolgorde

Optimaliseer in deze volgorde:

1. gekwalificeerde organische leads en organische pipeline zodra betrouwbare attributie beschikbaar is;
2. non-branded klikken naar money pages;
3. relevante non-branded vertoningen en posities;
4. totale organische klikken.

De ambitie is 100.000 organische klikken per 28 dagen uiterlijk 31 december 2026. Dit is een agressieve stretch-doelstelling, geen garantie. Informatief verkeer zonder aantoonbare relatie met Softora's diensten krijgt geen voorrang op commercieel relevant verkeer.

De automation blijft na het halen of verstrijken van die datum actief totdat Servé haar expliciet pauzeert. Na 31 december 2026 legt zij het deadline-resultaat eenmaal vast op basis van het toen beschikbare GSC-venster, stopt zij met een fictief "resterend tempo" en stuurt zij verder op rollende 28- en 90-daagse non-branded groei, gekwalificeerde money-pageklikken, betrouwbare conversies en bewijsgebaseerde kwartaalprognoses. Een gemiste stretchdeadline is geen reden om productie op te jagen; een gehaalde referentie is geen reden om te stoppen.

## Runritme

### Dagelijks

- Werk binnen de ene bestaande `softora-seo-actiemachine`; maak geen tweede SEO-automation, blogbot of parallel schema.
- Voer twee sporen in dezelfde run uit: een kort operationeel spoor en een publiek groeispoor.
- Operationeel spoor: controleer Git/GSC/productie-preflight, open SEO-PR's, kritieke live signalen en experimenten waarvan een reviewdatum is bereikt.
- Publiek groeispoor: lever per succesvolle run precies een publieke SEO-groeiverbetering op. De machine-toestand bepaalt of dit een nieuwe pagina, substantiële refresh, consolidatie, interne-linkverbetering, indexatieverbetering, visual/designverbetering of conversieverbetering is.
- Onderhoud aan een oude PR, rapportage, URL Inspection, scorecards en technische controles tellen niet als publieke groeilevering.
- De cooldown geldt alleen voor dezelfde URL en blokkeert nooit een nieuw, uniek ondersteunend onderwerp binnen hetzelfde cluster.
- Een no-op is alleen toegestaan bij een operationele P0 die veilige publicatie blokkeert, een onoplosbaar claim- of expertiseprobleem, aantoonbare cannibalisatie zonder uniek alternatief, of een merge/deployblokkade buiten de automation. Leg dan exact vast wat blokkeert, wie eigenaar is en welke actie nodig is.
- Een tweede opeenvolgende content-no-op met dezelfde reden is niet toegestaan: los de blokkade op of kies de hoogst scorende publicatieklare kandidaat uit de backlog.
- Gebruik bij kandidaatarmoede de vaste fallback-ladder hieronder; "geen duidelijke GSC-query" en "de money page staat in cooldown" zijn nooit geldige redenen om niets te shippen.
- Iedere heartbeat voert eerst `audit` uit. Als daar nog een actieve invocation uit een eerdere heartbeat staat, sluit `recover-run` die expliciet als `interrupted` en `unverified` met controleerbaar herstelbewijs; pas daarna mag de nieuwe heartbeat `start-run` uitvoeren. Iedere nieuwe invocation sluit vóór het eindrapport met `finish-run`. De noodrem in `start-run` kan een vergeten invocation nog automatisch zichtbaar onderbreken, maar is nooit het normale herstelpad en nooit stil bewijs van succes.
- Een bewezen ontbrekende connector-toolset in de actieve task mag tussen twee runs via `repair-thread-binding` naar exact één setup-only vervangtask worden hersteld. De bestaande automation-id, planning, ACTIVE-status, batch en teller blijven behouden; dit is geen normale vroege rotatie en maakt geen tweede automation.

### Wekelijks

- Draai de brede publieke link-, metadata-, visual- en CTA-controles.
- Vergelijk 7, 28 en 90 dagen voor non-branded verkeer, money pages en queryclusters.
- Beoordeel welke experimenten voldoende data hebben en plan het volgende cluster.
- Bewaak nieuwe URL's en refreshes apart. Een substantiële refresh, interne-linkactie of designverbetering mag de minimumvloer voor echt nieuwe URL's nooit invullen.
- Houd per rollende 7 dagen minimaal 1 nieuwe URL in `data_degraded`, `indexation_recovery`, `quality_recovery` en `performance_recovery`, 3 in `growth` en 5 in `scale`, binnen de maxima uit de control-plane-tabel.
- Als de vloer is gemist, publiceert de eerstvolgende veilige run de hoogst scorende unieke backlogkandidaat. Alleen een echte operationele P0, aantoonbare cannibalisatie van alle veilige kandidaten of een externe merge/deployblokkade mag dit tegenhouden.
- Houd minimaal 15 unieke, gescoorde en publicatieklare kandidaatbriefs vooruit in `docs/growth/seo-machine-backlog.json`, verdeeld over de commerciële clusters. Dit versieerbare JSON-register is de enige backlogbron; de automation memory bewaart alleen runhistorie, experimenten en beslissingen.
- Zorg dat minimaal 70% van de nieuwe content directe koop-, vergelijkings-, kosten-, implementatie-, integratie- of probleemoplossingsintentie heeft. Algemene uitleg is maximaal 30%.
- Backlinks en off-site linkbuilding vallen volledig buiten deze automation. Doe geen backlinkanalyse als actielijn, outreach, gastblogs, directoryplaatsingen, partner-/leveranciersprofielen, linkruil of betaalde links. Natuurlijke interne links binnen `softora.nl` blijven wel onderdeel van iedere relevante publicatie.
- Bereken tot en met 31 december 2026 vanaf het actuele 28-daagse klikniveau de vereiste samengestelde groeicurve. Gebruik daarna de deadlinebestendige `growthHorizon` uit het GSC-rapport: geen negatieve resterende maanden of verzonnen inhaaltempo, wel een eerlijke deadline-evaluatie en rollende 28/90-daagse voortgang.

### Maandelijks

- Controleer cannibalisatie, overlap, orphan pages, stale content en indexatie-dekking.
- Beoordeel echte trust-, case-, review-, citation- en authority-kansen.
- Verbeter, consolideer, redirect of noindex alleen met aantoonbaar bewijs.

### Blijvend compoundinggedrag

- Bescherm bewezen winnaars. Wijzig URL, primaire intent, titel of H1 van een winnende pagina niet op dagelijkse ruis; eis een technisch/claimprobleem, duidelijke query-paginamismatch of consistente verslechtering in vergelijkbare vensters.
- Laat D56-besluiten echt doorwerken: `won` leidt naar een unieke aangrenzende koperstaak of money-pageversterking, `neutral` en `insufficient-data` blijven op hold, en `lost` leidt alleen met bewijs tot iteratie, consolidatie of revert.
- Zodra minimaal drie D56-experimenten `won` zijn, verdeelt de machine haar niet-bindende groeiruimte over een rollend venster: ongeveer 70% verdedigen/uitbouwen van bewezen clusters, 20% aangrenzende commerciële experimenten en 10% technische, trust- of corpusverbetering. Een control-planehersteltoestand en de nieuwe-URL-vloer gaan altijd voor deze portefeuillerichtlijn.
- Voor die bewijsdrempel ligt de nadruk op betrouwbare indexatie, eerste relevante non-branded signalen en voldoende verschillende experimenten om echte winnaars te herkennen. Publicatievolume alleen is nooit compoundingbewijs.

De werkstandaard is een publieke groeilevering per succesvolle dagelijkse run. Alleen de expliciete no-op-uitzonderingen hierboven mogen het tempo doorbreken.

## Adaptieve Machine-Toestand

`npm run seo:cadence:check` kiest exact een toestand in deze prioriteit:

| Toestand | Trigger | Publieke actie | Minimum nieuwe URL's per 7 dagen | Maximum nieuwe URL's per 7 dagen |
| --- | --- | --- | --- | --- |
| `operations_p0` | Live-versie, crawlbaarheid, sitemap, backlog of verplichte tooling blokkeert veilige uitvoering | Alleen de blocker repareren | 0 | 0 |
| `data_degraded` | GSC- of URL Inspection-data ontbreekt of is onvoldoende betrouwbaar | Meting repareren en alleen eerder bewijsdekte veilige verbetering uitvoeren | 1 | 2 |
| `indexation_recovery` | Minimaal vijf D14/D28-URL's zijn inspecteerbaar en minder dan 60% is geïndexeerd | Een bewijsdekte nieuwe ingang behouden; vooral discovery, canonicals, consolidatie en contextuele links verbeteren | 1 | 2 |
| `performance_recovery` | Minimaal vijf D28-URL's zijn reviewbaar en minder dan 40% krijgt non-branded impressies, of de cohort heeft minstens 100 impressies zonder klik | Een bewijsdekte nieuwe ingang behouden; vooral query/pagina-match, snippets, interne routes en consolidatie verbeteren | 1 | 2 |
| `quality_recovery` | Templateaandeel, herhaalde paragrafen of dichtstbijzijnde pagina-overlap overschrijdt de interne kwaliteitsgrens | Een bewijsdekte nieuwe ingang behouden; vooral unieke informatiewinst toevoegen of overlap consolideren | 1 | 2 |
| `growth` | Techniek en herstelpoorten zijn groen | Hoogste verwachte gekwalificeerde impact kiezen | 3 | 5 |
| `scale` | Minimaal vijf reviewbare URL's, minstens 80% D14/D28-indexatie, minstens 60% D28-dekking met non-branded impressies, ten minste een non-branded klik en groene kwaliteit | Gecontroleerd opschalen | 5 | 7 |

Deze percentages zijn interne operationele veiligheidsgrenzen, geen door Google gepubliceerde rankingfactoren. Iedere niet-geindexeerde nieuwe URL krijgt een bewijsstatus `already_indexed`, `requested`, `quota_blocked`, `browser_blocked` of `failed` in de automation memory. Een status anders dan `already_indexed` of `requested` blijft openstaan voor de volgende run. Vraag niet opnieuw aan zonder materiele wijziging of gedocumenteerd vervolgvenster.

Meetbare D28-uitkomstzwakte heeft na data- en indexatieherstel voorrang op generieke corpuskwaliteitsschuld. Daardoor kan een blijvend hoge historische templatescore niet eindeloos verbergen dat reviewbare pagina's geen relevante non-branded zichtbaarheid of klikken krijgen. Kandidaat-, claim-, overlap- en visualpoorten blijven wel harde publicatiepoorten: `performance_recovery` is nooit toestemming om zwakke of overlappende content te publiceren.

`npm run seo:publications:report` rapporteert daarom afzonderlijk `newUrls`, `substantialRefreshes` en `otherGrowthActions`. Alleen `newUrls` verlaagt de nieuwe-URL-achterstand. Zodra `newUrlDeficit` groter is dan nul, overschrijft `publish_new_url_from_highest_scoring_safe_ready_candidate` de normale herstelactie voor die run.

### Dagelijkse fallback-ladder

Kies van boven naar beneden de eerste unieke, veilige en uitvoerbare kans:

1. money page met bewezen CTR-, positie-, intent- of conversieprobleem;
2. ondersteunend blog met commerciële of probleemoplossende intentie;
3. diep kennisbankartikel dat een echte beslis- of implementatievraag afvangt;
4. vergelijking, kosten-, migratie-, integratie- of alternatiefpagina;
5. unieke commerciële landingspagina voor een echte dienst/branche/regio-combinatie zonder city-swap;
6. bronvaste nieuws- of marktupdate binnen Softora's expertise, met primaire bronnen en een duurzame uitleg voor MKB-kopers;
7. substantiële refresh van verouderde of overlappende supportcontent;
8. natuurlijke interne-linkverbetering vanuit geindexeerde pagina's naar een prioriteitscluster;
9. publieke visual-, mobile-, CTA-, trust/entity- of contentdesignverbetering op een indexeerbare route.

Een nieuwsupdatesamenvatting mag nooit bestaan uit overgeschreven berichtgeving. Controleer datum en primaire bron, voeg eigen praktische duiding toe, link naar de passende money page en gebruik alleen feiten die de bron werkelijk ondersteunt.

## Contentmotor

De machine mag niet stilvallen wanneer GSC nog weinig top-20-query's toont. Bouw en onderhoud daarom een actieve publicatiebacklog met deze bronvolgorde:

1. `queries.prioritized`, query/page-mismatches en pagina's met impressies maar zwakke CTR of positie;
2. ontbrekende supportrollen rond bestaande money pages, maar alleen wanneer aanvullend vraagbewijs bestaat; een inventarisgat alleen is geen publicatiebewijs;
3. actuele SERP-, concurrent-, autocomplete-, nieuws- en buyer-question-analyse voor Nederlandse commerciële zoekintentie;
4. echte vragen over kosten, keuze, implementatie, koppelingen, migratie, risico's, doorlooptijd, beheer en menselijke controle;
5. lokale of branchespecifieke intentie, maar alleen wanneer de pagina aantoonbaar unieke regionale of operationele waarde heeft.

Scoor iedere kandidaat op business fit, conversienabijheid, vraagbewijs, verwachte non-branded klikruimte, haalbaarheid, unieke clusterrol en cannibalisatierisico. Ruwe zoekvolumes of concurrentieverkeer zijn nooit genoeg zonder Softora-fit.

### Adviserend keywordbewijs

Iedere nieuwe URL en iedere substantiële contentrefresh krijgt vóór het schrijven een machineleesbare `keywordEvidence`-brief. GSC blijft de eerste bron voor bestaande zichtbaarheid. Ubersuggest is uitsluitend een read-only hulpmiddel voor extra Nederlandse vraag-, taal- en SERP-signalen en neemt nooit een publicatie-, afwijzings-, score-, URL-, titel- of tekstbesluit.

- Gebruik voor Nederland `locId: 2528` met `language: Dutch` en accepteer een resultaat alleen als de response de effectieve locatie `Netherlands` en taal `Dutch` bevestigt waar de tool die velden teruggeeft. Een Global- of United States-fallback telt niet als Nederlands bewijs.
- Start met één tot drie onderbouwde seeds uit GSC, de buyer task, de backlogbrief en normale kopertaal. Een door Codex bedachte exacte formulering alleen is geen keywordbrief.
- Gebruik wanneer Ubersuggest beschikbaar is minimaal `keyword_suggestions`, `google_suggestions`, `keyword_overview` en `serp_analysis`. Bij nulmetingen, ontbrekende intentie of een onduidelijke intentmatch mogen maximaal twee aanvullende read-only controles volgen, zoals `match_keywords`, een tweede overview of een tweede SERP. De totale Ubersuggest-cap is zes calls voor het gekozen contentitem en acht calls voor de volledige dagrun wanneer ook de wekelijkse discovery-pass nodig is.
- De wekelijkse discovery-pass mag read-only domain-, competitor-, top-page- en content-idea-data gebruiken om nieuwe seeds te vinden. Geen gevonden term promoveert automatisch naar `ready`; iedere kandidaat doorloopt nog steeds vraagbewijs, business fit, buyer task, unieke clusterrol, live overlap en cannibalisatie.
- `0` zoekvolume betekent alleen dat Ubersuggest voor die formulering geen meetbaar volume rapporteert. Het is geen bewijs van nul vraag en mag een kandidaat nooit zelfstandig blokkeren. CPC, difficulty, intent en traffic zijn eveneens providerschattingen, geen GSC-waarheid of conversiebewijs.
- Gebruik nooit `keyword_metrics`, `generate_article`, projectmutaties, backlinktools, site audits, aankopen, upgrades, credit-top-ups of betaalde fallbacks. Als Ubersuggest niet beschikbaar is, leg `external_research_unavailable` vast en gebruik GSC plus normale openbare SERP-, autocomplete- en bronresearch; dit is geen operationele P0 en geen reden voor een no-op.
- De brief bewaart minimaal retrievaldatum, toolnamen, effectieve locale, seeds, primaire zoekintentie, primaire term, relevante secundaire buyer language, echte vragen, SERP-paginatypen, afgewezen ruis, beperkingen en de uiteindelijke menselijke/machine-afweging buiten Ubersuggest.
- Iedere researchcall staat apart in de brief met tool, datum, niet-geheime argumenten en doel; `callsUsed` moet exact met die callledger overeenkomen. Iedere beoordeelde term verwijst terug naar de tool(s) waarin hij is gezien.
- Verwerk alleen termen die de koperstaak nauwkeuriger uitdrukken. Gebruik ze natuurlijk in titel, H1, intro, secties, metadata of ankertekst wanneer dat inhoudelijk klopt; er geldt geen keyworddichtheid, verplichte exact-matchtelling of lijst met varianten die koste wat kost in de pagina moet staan. Google kan betekenis en varianten begrijpen.
- Minimaal een bewezen term krijgt `used` en moet aantoonbaar in de zichtbare paginacopy staan. De voorlopige primaire term krijgt altijd een expliciet niet-afgewezen besluit; `covered_semantically` blijft beschikbaar wanneer exact gebruik onnatuurlijk zou zijn.

Ieder hoofdcluster bestaat uit een money page met ondersteunende rollen zoals:

- kosten en budgetkeuzes;
- vergelijken en alternatieven;
- implementatie en doorlooptijd;
- koppelingen, migratie en datakwaliteit;
- concrete use cases en procesproblemen;
- risico's, beheer, privacy en menselijke controle;
- beslisvragen voor MKB-kopers.

Spreid de productie bewust over blogs, kennisbank, vergelijkingen en commerciële landingspagina's. Nieuwsupdates zijn alleen geschikt wanneer de ontwikkeling actueel, bronbaar, relevant voor een Softora-dienst en nuttig na de eerste nieuwspiek is.

Een kandidaat is pas publicatieklaar wanneer de zoekintentie, primaire money page, onderscheid met bestaande URL's, controleerbare vraagbronnen, unieke informatiewinst, contextuele interne links, conversiepad, claimrisico en twee nuttige visualconcepten vooraf zijn vastgelegd. Nieuwe content gebruikt `qualityVersion: 2`: geen automatische opvulsecties, geen verplichte generieke FAQ en geen vaste woordtelling als kwaliteitsbewijs. Publiceer geen synoniempagina, dunne city-swap of tekst die alleen een bestaand artikel herschrijft.

Vanaf `2026-08-05` gebruikt iedere nieuwe of substantieel vernieuwde blog ook `visualQualityVersion: 2` en een machineleesbare `visualBrief`. Het hero-beeld is een onderwerp-eigen, tekstarm 16:9-beeld van minimaal 1200 pixels breed; het supportbeeld legt een beslissing, vergelijking, proces, interface, architectuur of dataset uit. Beide beelden verschillen in rol, beeldvorm en visuele familie. De machine roteert families over de zes recentste blogs en blokkeert een kandidaat wanneer de interne pixelovereenkomst `0.85` of hoger is. Die drempel en het exacte aantal van twee beelden zijn Softora-kwaliteitsregels, geen Google-rankingfactoren. Historische herhaling wordt als `quality_recovery` gerapporteerd zodat zij planbaar wordt zonder nieuwe publicatie structureel stil te leggen.

Google-techniek blijft onderdeel van de beeldpoort: lokale crawlbare `<img src>`-bestanden, betekenisvolle alt, beschrijvende bestandsnaam, vaste dimensies, relevante omringende tekst, gecontroleerd gewicht, `max-image-preview:large`, representatieve `og:image`, `ImageObject`-schema en een image sitemap. AI-herkomst wordt eerlijk als `trainedAlgorithmicMedia` vastgelegd; de automation fabriceert geen provenance-metadata.

## Machine Enforcement

De instructietekst is niet de poort. Deze negen commando's leveren de afdwingbare staat:

- `npm run seo:backlog:check` valideert het JSON-schema, minimaal 15 `ready` briefs, unieke URL's en ID's, de vaste scoreformule, exact drie overlap-URL's, publicatiebriefvelden en minimaal 70% commerciële intentie. Deze validator draait ook tegen het echte register in de contracttests van `verify:critical`.
- `npm run seo:publications:report` bouwt een live cohortledger voor 7 en 28 dagen en splitst nieuwe URL's, substantiële refreshes en overige groei-acties. Een event telt uitsluitend wanneer productie exact op `origin/main` draait, de route HTTP 200 en HTML geeft, indexeerbaar is, self-canonical is, in de sitemap staat en de passende `datePublished` of `dateModified` toont.
- `npm run seo:indexation:report` inspecteert money pages en recente D14/D28-cohorten met de officiele read-only URL Inspection API, zonder een gewone pagina via de Indexing API aan te melden.
- `npm run seo:visuals:check` valideert beeldrollen, formaat, informatiewinst, familie-rotatie en pixelgelijkenis met de zes recentste blogs; vanaf de ingangsdatum blokkeert een rode kandidaat de publicatie.
- `npm run seo:keywords:check` blokkeert toekomstige nieuwe en substantieel vernieuwde content zonder geldige Nederlandse `keywordEvidence`, zonder Ubersuggest ooit beslissingsmacht te geven.
- `npm run seo:selection:check` vergelijkt de machineleesbare keuze vóór implementatie met het verse GSC-rapport. Minimaal de exacte top drie uit `queries.prioritized` wordt in volgorde beoordeeld; iedere skip heeft een toegestane reden en controleerbaar bewijs, en recency-bescherming vereist wijzigingsdatum, hercontroledatum en commit- of PR-referentie.
- `npm run seo:live-route:check` controleert na productiepariteit de werkelijk gewijzigde URL op HTTP, self-canonical, metadata, H1, indexeerbaarheid, sitemap, CTA en publieke tekst. Voor bekende SEO-content controleert hij ook de twee lokale beelden, alt en dimensies, image sitemap, `max-image-preview:large` en Article-afbeeldingsschema.
- `npm run seo:automation-state -- audit` bewijst dat exact één canonieke ACTIVE heartbeat bestaat, planning/task/Ubersuggest-toolbinding en een echte vier-tool dataproef overeenkomen, en promptversie `SEO_MACHINE_PROMPT_VERSION=5` de kosten-, Qwen-, Edge/Codex-, selectie-, lifecycle-, langetermijn- en rotatiecontroles bevat. `start-run` telt iedere heartbeat vóór SEO-effecten precies eenmaal; `recover-run` sluit een aangetroffen vorige invocation expliciet en zichtbaar; `finish-run published` accepteert alleen dezelfde invocation wanneer `cadence`, `selection`, `keywords`, `visuals`, `verify_critical`, `live_production` en `live_route` elk een groene receipt hebben. De commitgebonden receipts moeten bij dezelfde finale Git-tree horen en de twee live receipts bij dezelfde live commit en URL. `inspect` valideert lifecycle, 15-runrotatie en discovery-status; `rotate-thread` roteert uitsluitend na run 15 met een geldige receipt; `repair-thread-binding` behoudt bij een bewezen connectorbindingsdefect de bestaande teller; `record-tool-binding` vereist de vier afgesproken read-only Ubersuggest-tools; `record-tool-smoke` bewaart per verplichte tool een machineleesbare `ok`/`ok_empty`-uitkomst en echt resultaataantal uit de actieve task; `record-keywords` bewaart het begrensde adviserende gebruik.
- `npm run seo:cadence:check` combineert backlog, live ledger, indexatie, corpusoriginaliteit en non-branded D28-cohortprestaties. Exitcode `0` is gezond, exitcode `2` is `GROWTH_ACTION_REQUIRED` volgens de gekozen toestand en exitcode `1` is een operationele P0 die eerst veilig moet worden hersteld.

Iedere poort die voor de definitieve publicatieclaim telt, draait met `--record-run-gate --run-thread <task-id> --run-invocation-at <invocation-at>`. De finale keyword-, visual-, `verify:critical`-, productie- en routepoorten worden tegen de schone uiteindelijke commit/tree geregistreerd. Een losse groene commandoregel, een oudere run, een andere tree of alleen een Vercel-status kan daardoor nooit meer een `published` receipt vrijgeven.

De live cadence-check draait bewust niet als mergeblokker in CI. De dagelijkse automation behandelt exitcode `2` als uitvoeropdracht. Bij `newUrlRequired=true` is dat expliciet een nieuwe URL uit de gevalideerde backlog; anders volgt zij de normale actie van de gekozen toestand.

`scale` is dus geen beloning voor publicatieaantallen. De machine schaalt pas wanneer een D28-cohort van minimaal vijf nieuwe URL's zowel indexeerbaar als aantoonbaar vindbaar is: minimaal 60% heeft non-branded impressies en de cohort heeft ten minste een non-branded klik. Minder dan 40% impressiedekking, of minimaal 100 impressies zonder klik, activeert `performance_recovery`. Dit zijn interne leer- en capaciteitsgrenzen, geen Google-rankingfactoren en geen causaliteitsclaim.

## Opportunity Ranking

Gebruik `queries.prioritized` uit `scripts/seo-agent-report.js` als eerste datagedreven kandidatenlijst. Deze queue:

- gebruikt dimensieloze propertytotalen voor het echte klik- en impressietotaal;
- rapporteert zichtbare branded/non-branded query's apart van geanonimiseerde of anderszins niet-classificeerbare klikken;

- sluit branded queries uit van de groeiprioritering;
- neemt ook 0% CTR mee;
- voegt overlappende CTR- en striking-distance-acties samen;
- weegt verwachte klikwinst, business fit, positiehefboom en dataconfidence;
- geeft positie 5-20 meer hefboom dan grote aantallen vertoningen ver buiten pagina een.
- houdt alleen commercieel passende queries op positie 20-40 als lagere-prioriteit `emerging` kans vast wanneer er nog geen top-20-kans is.

De score is een beslissingshulpmiddel, geen bewijs van toekomstige groei. Controleer voor de uiteindelijke keuze altijd intentmatch, bestaande paginakwaliteit, recente experimenten, cannibalisatie en veilige uitvoerbaarheid.

Voor implementatie schrijft iedere run `reports/seo-agent/selection-evidence.json` en draait `npm run seo:selection:check`. De brief koppelt aan exact dezelfde `generatedAt` als het actuele GSC-rapport, benoemt buyer task en verwachte gekwalificeerde impact, en neemt minimaal de eerste drie `queries.prioritized` in ongewijzigde volgorde en met hun echte score over. Een lager gerangschikte of niet-GSC-actie is toegestaan, maar alleen nadat iedere hoger gerangschikte kans expliciet en controleerbaar is afgevallen. "Recent gewijzigd" zonder datum, hercontroledatum en PR/commit is geen bewijs.

Wanneer `queries.prioritized` geen sterke publicatiekandidaat bevat, is dat geen reden voor een no-op. Ga dan door naar de contentinventaris, actuele SERP-gaps en de gescoorde backlog. Noteer in de PR welk bewijs de keuze droeg.

## Scorecard

Iedere score bevat `score`, `confidence` en een korte `evidence`-regel. Gebruik `n/a` wanneer bewijs ontbreekt; verzin geen cijfer.

| Onderdeel | Objectieve basis |
| --- | --- |
| Technische crawlbaarheid | Start op 10; -5 als robots publieke crawl blokkeert, -3 bij onbereikbare/lege sitemap, -2 bij kritieke canonical- of statusfouten. |
| Indexatie/discovery | `10 x geindexeerde geinspecteerde prioriteits-URL's / geinspecteerde prioriteits-URL's`; `n/a` zonder inspecties. |
| GSC performance | Start op 5; gebruik non-branded 28-daagse clicks, CTR, top-20 dekking en kritieke dalingen voor aantoonbare plus- of minpunten. Lage volumes krijgen lage confidence. |
| Money-page intent depth | Een punt per bewezen onderdeel: unieke intent, H1/H2, kosten, doorlooptijd, koppelingen, veiligheid, bewijs, FAQ, interne links en duidelijke CTA. |
| Support-content uniqueness | Meet unieke zoekintentie, eigen voorbeelden, overlap/cannibalisatie, nuttige diepte en natuurlijke money-page links op een benoemde steekproef. |
| Internal links | Meet orphan pages, klikdiepte, relevante inkomende money-page links en natuurlijke context; geen losse SEO-balken als bewijs. |
| Visuals | Meet betekenis, eigen karakter, alt-tekst, vaste dimensies en bestandsgrootte op de gecontroleerde URL's. |
| Trust/entity | Alleen geverifieerde NAP/KvK/legal/entity-data, echt bewijs en echte profielen tellen mee. |
| Page experience | Gebruik meetbare mobiele layout, overflow, beeldgewicht en Lighthouse/CrUX waar beschikbaar. |
| AI-search readiness | Meet normale SEO-signalen: heldere antwoorden, buyer questions, voorbeelden, betrouwbare entity-data en correcte structured data. |

Rapporteer daarnaast als productie- en leersignalen: nieuwe of substantieel vernieuwde URL's in de laatste 7 en 28 dagen, indexatiegraad van die cohort, aandeel met non-branded impressies, interne links naar money pages en betrouwbare organische conversies wanneer beschikbaar. Dit zijn geen extra scorecardcijfers zonder vaste definitie.

Rapporteer tot en met de deadline de afstand tot 100.000 organische klikken per 28 dagen op 31 december 2026 als een stretch gap, inclusief huidig niveau, benodigde factor, benodigde samengestelde groei per resterende maand en een bewijsgebaseerde scenarioforecast. Na de deadline rapporteer je het bewaarde deadline-resultaat en de actuele rollende 28/90-daagse richting zonder resterende-maandberekening. Presenteer dit nooit als garantie of als reden om kwaliteit, veiligheid of intentfit te verlagen.

## Experimentregister

Schrijf iedere live wijziging in de vaste automation memory met dit compacte schema:

```text
Experiment: <URL of cluster>
Hypothese: <verwachte verandering en waarom>
Baseline: <live-datum, commit, 28d non-brand clicks/impressions/CTR/position>
Wijziging: <korte omschrijving en PR>
Review: <14d datum>, <28d datum>, <56d datum>
Status: active | won | neutral | lost | insufficient-data
Besluit: hold | iterate | expand | revert
```

- Herschrijf dezelfde pagina normaal niet opnieuw binnen 28 dagen.
- Pas de cooldown nooit toe op een heel onderwerpcluster; een nieuwe URL met een unieke intentie en clusterrol mag wel gepubliceerd worden.
- Een technische fout, verkeerde claim, indexatieblokkade of duidelijke query/page-mismatch mag de cooldown doorbreken.
- Trek na een dag geen rankingconclusies; 14 dagen is een vroeg signaal, 28 dagen richting en 56 dagen een bruikbaarder oordeel.
- Schrijf na iedere run een memory-entry, ook bij een no-op of fout, zodat blockers en reviewdatums niet verdwijnen.

## Operationele P0

Live-versieverschil, security, publieke crawlblokkades, kapotte canonicals en een onbruikbare sitemap zijn publicatieblokkerende P0's. Een meetstoring zonder publicatierisico is `data_degraded`: claim geen actuele prestaties, maar laat eerder bewijsdekt veilig herstelwerk doorgaan.

- Eerste fout: diagnoseer, leg exacte oorzaak vast en probeer de veilige reparatie.
- Tweede opeenvolgende run met dezelfde P0: repareer de operatie of rapporteer exact welke menselijke actie, eigenaar en credential/scope/configuratie nodig is. Publiceer alleen wanneer onderzoek, kwaliteitscontrole en live verificatie ondanks die P0 betrouwbaar en veilig blijven.
- Print nooit secrets en plaats ze nooit in tracked files.

Een open technische of conversie-PR mag niet dagelijks de groeilevering vervangen. Werk zo'n PR alleen bij wanneer er echte inhoudelijke drift, reviewfeedback of een mergevereiste is; houd high-risk backendwerk review-gated.

## Menselijk Bewijs

De automation mag een bewijsqueue maken voor echte cases, reviews, partnerships en leadkwaliteit die op Softora's eigen site bruikbaar zijn. De automation voert geen backlinkwerk of externe SEO-publicatie uit en verzint nooit klanten, resultaten, profielen, credentials of citaties.
