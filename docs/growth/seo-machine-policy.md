# Softora SEO Machine Policy

Dit document maakt de dagelijkse SEO-automation meetbaar en herhaalbaar. De automation leest daarnaast altijd `AGENTS.md`; bij conflict zijn de strengste veiligheidsregels leidend.

## Doelvolgorde

Optimaliseer in deze volgorde:

1. gekwalificeerde organische leads en organische pipeline zodra betrouwbare attributie beschikbaar is;
2. non-branded klikken naar money pages;
3. relevante non-branded vertoningen en posities;
4. totale organische klikken.

De ambitie is 100.000 organische klikken per 28 dagen uiterlijk 31 december 2026. Dit is een agressieve stretch-doelstelling, geen garantie. Informatief verkeer zonder aantoonbare relatie met Softora's diensten krijgt geen voorrang op commercieel relevant verkeer.

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

### Wekelijks

- Draai de brede publieke link-, metadata-, visual- en CTA-controles.
- Vergelijk 7, 28 en 90 dagen voor non-branded verkeer, money pages en queryclusters.
- Beoordeel welke experimenten voldoende data hebben en plan het volgende cluster.
- Houd in `scale` 5 tot 7 sterke nieuwe of substantieel vernieuwde contentleveringen per week aan. In `growth`, `quality_recovery` en `indexation_recovery` gelden lagere maxima; een publicatiequotum mag nooit indexatie- of kwaliteitsherstel verdringen.
- Houd minimaal 15 unieke, gescoorde en publicatieklare kandidaatbriefs vooruit in `docs/growth/seo-machine-backlog.json`, verdeeld over de commerciële clusters. Dit versieerbare JSON-register is de enige backlogbron; de automation memory bewaart alleen runhistorie, experimenten en beslissingen.
- Zorg dat minimaal 70% van de nieuwe content directe koop-, vergelijkings-, kosten-, implementatie-, integratie- of probleemoplossingsintentie heeft. Algemene uitleg is maximaal 30%.
- Backlinks en off-site linkbuilding vallen volledig buiten deze automation. Doe geen backlinkanalyse als actielijn, outreach, gastblogs, directoryplaatsingen, partner-/leveranciersprofielen, linkruil of betaalde links. Natuurlijke interne links binnen `softora.nl` blijven wel onderdeel van iedere relevante publicatie.
- Bereken vanaf het actuele 28-daagse klikniveau en de resterende tijd tot 31 december 2026 de vereiste samengestelde groeicurve. Vergelijk werkelijke voortgang met die curve zonder dagelijkse ruis als causaliteit te presenteren.

### Maandelijks

- Controleer cannibalisatie, overlap, orphan pages, stale content en indexatie-dekking.
- Beoordeel echte trust-, case-, review-, citation- en authority-kansen.
- Verbeter, consolideer, redirect of noindex alleen met aantoonbaar bewijs.

De werkstandaard is een publieke groeilevering per succesvolle dagelijkse run. Alleen de expliciete no-op-uitzonderingen hierboven mogen het tempo doorbreken.

## Adaptieve Machine-Toestand

`npm run seo:cadence:check` kiest exact een toestand in deze prioriteit:

| Toestand | Trigger | Publieke actie | Maximum nieuwe URL's per 7 dagen |
| --- | --- | --- | --- |
| `operations_p0` | Live-versie, crawlbaarheid, sitemap, backlog of verplichte tooling blokkeert veilige uitvoering | Alleen de blocker repareren | 0 |
| `data_degraded` | GSC- of URL Inspection-data ontbreekt of is onvoldoende betrouwbaar | Meting repareren en alleen eerder bewijsdekte veilige verbetering uitvoeren | 2 |
| `indexation_recovery` | Minimaal vijf D14/D28-URL's zijn inspecteerbaar en minder dan 60% is geïndexeerd | Discovery, kwaliteit, canonicals, consolidatie en contextuele links verbeteren | 2 |
| `quality_recovery` | Templateaandeel, herhaalde paragrafen of dichtstbijzijnde pagina-overlap overschrijdt de interne kwaliteitsgrens | Unieke informatiewinst toevoegen of overlappende pagina's samenvoegen | 3 |
| `growth` | Techniek en herstelpoorten zijn groen | Hoogste verwachte gekwalificeerde impact kiezen | 5 |
| `scale` | Minimaal vijf reviewbare URL's en minstens 80% D14/D28-indexatie, plus groene kwaliteit | Gecontroleerd opschalen | 7 |

Deze percentages zijn interne operationele veiligheidsgrenzen, geen door Google gepubliceerde rankingfactoren. Iedere niet-geindexeerde nieuwe URL krijgt een bewijsstatus `already_indexed`, `requested`, `quota_blocked`, `browser_blocked` of `failed` in de automation memory. Een status anders dan `already_indexed` of `requested` blijft openstaan voor de volgende run. Vraag niet opnieuw aan zonder materiele wijziging of gedocumenteerd vervolgvenster.

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

## Machine Enforcement

De instructietekst is niet de poort. Deze vier commando's leveren de afdwingbare staat:

- `npm run seo:backlog:check` valideert het JSON-schema, minimaal 15 `ready` briefs, unieke URL's en ID's, de vaste scoreformule, exact drie overlap-URL's, publicatiebriefvelden en minimaal 70% commerciële intentie. Deze validator draait ook tegen het echte register in de contracttests van `verify:critical`.
- `npm run seo:publications:report` bouwt een live cohortledger voor 7 en 28 dagen. Een URL telt uitsluitend wanneer productie exact op `origin/main` draait, de route HTTP 200 en HTML geeft, indexeerbaar is, self-canonical is, in de sitemap staat en dezelfde `datePublished` toont als het contentregister.
- `npm run seo:indexation:report` inspecteert money pages en recente D14/D28-cohorten met de officiele read-only URL Inspection API, zonder een gewone pagina via de Indexing API aan te melden.
- `npm run seo:cadence:check` combineert backlog, live ledger, indexatie en corpusoriginaliteit. Exitcode `0` is gezond, exitcode `2` is `GROWTH_ACTION_REQUIRED` volgens de gekozen toestand en exitcode `1` is een operationele P0 die eerst veilig moet worden hersteld.

De live cadence-check draait bewust niet als mergeblokker in CI. De dagelijkse automation moet exitcode `2` als uitvoeropdracht voor de genoemde toestand behandelen, nooit automatisch als opdracht om een nieuwe URL te maken.

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

Rapporteer de afstand tot 100.000 organische klikken per 28 dagen op 31 december 2026 als een stretch gap, inclusief huidig niveau, benodigde factor, benodigde samengestelde groei per resterende maand en een bewijsgebaseerde scenarioforecast. Presenteer dit nooit als garantie of als reden om kwaliteit, veiligheid of intentfit te verlagen.

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
