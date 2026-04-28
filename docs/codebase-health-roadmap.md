# Softora Codebase Health Roadmap

## Doel
Deze roadmap vertaalt de huidige codebase-gezondheid naar concrete, kleine verbeterstappen. Het doel is niet om alles in een keer te herschrijven, maar om de codebase voorspelbaar richting een professionele 100/100 baseline te brengen.

## Huidige nulmeting
- `npm run verify:critical` is groen op 28 april 2026.
- Contracttests: 746 geslaagd, 0 gefaald.
- Smoke-tests: 25 geslaagd, 0 gefaald.
- Secrets-check: geen verdachte secrets gevonden in tracked files.
- Backend-entrypoint is gezond klein: `server.js` is wiring-only.
- Grootste onderhoudsrisico zit in frontend-bestanden met veel HTML en client-side JavaScript.

## Score-inschatting
Huidige inschatting: 7,5 / 10.

Sterk:
- Er zijn guardrails, quality-locks, repo-hygiene checks en CI-poorten.
- Kritieke flows zijn expliciet vastgelegd in `server/routes/manifest.js`.
- Backendlogica is grotendeels gescheiden in routes, services, schemas en security.
- Auth, agenda, leads, runtime-sync en premium flows hebben veel contractdekking.

Nog niet professioneel genoeg:
- Grote root-level HTML-bestanden maken frontendwijzigingen risicovol.
- Grote assetbestanden, vooral dashboardlogica, zijn moeilijk te reviewen.
- Frontendstructuur is nog minder formeel dan backendstructuur.
- Legacy runtime-state en compatpaden bestaan nog naast gemigreerde opslag.
- Sommige domeinen zijn opgesplitst, maar nog niet altijd klein en doelgericht genoeg.

## Professionele 100/100 baseline
Een 100/100 Softora-codebase betekent:
- Elke kritieke flow heeft contract- of smoke-dekking.
- Grote frontendpagina's bevatten vooral markup en kleine bootstraps, geen grote gedragsscripts.
- Paginalogica staat in duidelijke modules onder `assets/` of een toekomstige `assets/pages/` structuur.
- Backendroutes zijn dun en delegeren naar services.
- Services zijn domeingericht, testbaar en niet afhankelijk van verborgen globale state.
- Securitychecks, validatie en rolcontroles zijn expliciet bij state-changing routes.
- Runtime-state heeft een duidelijke bron van waarheid, met legacy compat alleen tijdelijk en gedocumenteerd.
- CI en lokale verificatie blijven streng en mogen niet worden verzwakt om sneller te kunnen shippen.

## Aanpak
Werk in kleine, omkeerbare stappen. Elke stap moet de codebase overzichtelijker maken zonder bestaande response-shapes of kritieke flows te wijzigen.

### Stap 1: Bescherm de huidige groene baseline
- Verander kwaliteitschecks niet terwijl productcode wordt opgeschoond.
- Houd `npm run verify:critical` groen voor afronding van elke serie wijzigingen.
- Raak bestaande lokale wijzigingen niet aan tenzij ze bewust onderdeel zijn van de taak.

### Stap 2: Frontend modulariseren zonder redesign
- Begin met de grootste onderhoudsrisico's: grote HTML-pagina's en grote assetbestanden.
- Verplaats inline gedrag naar bestaande of nieuwe `assets/*` bestanden.
- Splits grote clientbestanden op per verantwoordelijkheid, bijvoorbeeld UI-rendering, API-client, state en event-binding.
- Houd visuele output en DOM-contracten stabiel, zodat smoke-tests blijven werken.

### Stap 3: Backend domeinen verder verfijnen
- Houd `server.js` en `server/services/server-app-runtime*.js` compositie-only.
- Verplaats nieuwe businesslogica naar bestaande domeinservices.
- Voeg bij productiewijzigingen gerichte contracttests toe.
- Vermijd nieuwe ad-hoc mappen onder `server/`.

### Stap 4: Legacy state afbouwen
- Documenteer per flow wat de formele bron van waarheid is.
- Laat database of formele repositories leidend zijn zodra een pad is gemigreerd.
- Houd compatpaden tijdelijk, expliciet en rollbackbaar.
- Verwijder legacy-paden pas nadat contracttests het nieuwe gedrag bewaken.

### Stap 5: Reviewbaarheid verhogen
- Houd diffs klein genoeg om menselijk te reviewen.
- Vermijd brede refactors met meerdere domeinen tegelijk.
- Gebruik bestandsnamen die direct uitleggen welk domein of welke pagina ze bedienen.
- Laat tests uitleggen welk gedrag beschermd wordt, niet alleen dat code uitvoert.

## Eerstvolgende aanbevolen werkpakket
Het eerste echte opschoonpakket na deze roadmap:
- Kies een groot frontendbestand dat niet tegelijk open lokale wijzigingen bevat.
- Splits alleen een duidelijke verantwoordelijkheid af.
- Voeg of behoud een gerichte contract- of smoke-test.
- Draai daarna pas de kritieke verificatie.

Aanbevolen startpunt:
- `assets/coldcalling-dashboard.js`, omdat dit een groot clientbestand is en waarschijnlijk veel onderhoudswinst oplevert.

Voorwaarde:
- Controleer eerst of er geen bestaande lokale wijzigingen in dat bestand staan.

## Voortgang frontend modularisatie
Eerste opgesplitste coldcalling dashboardmodules:
- `assets/coldcalling-dashboard-core.js`: kleine algemene helpers zoals DOM lookup, HTML escaping, tijdnotatie en veilige number parsing.
- `assets/coldcalling-dashboard-config.js`: vaste storage keys, Supabase ui-state scopes en business-mode volgorde.
- `assets/coldcalling-dashboard-modes.js`: business-mode normalisatie en coldcalling providerlabels.

Beschermende tests:
- `test/contracts/coldcalling-dashboard-modules.test.js`: bewaakt de nieuwe helper-, config- en mode-contracten.
- `test/contracts/ai-lead-generator-ui.test.js`: bewaakt de scriptvolgorde op de publieke leadgenerator.
- `test/contracts/coldcalling-regio-radius.test.js`: bewaakt dat regio-radius helpers voor de dashboardbootstrap geladen worden.
- `test/contracts/premium-ai-lead-generator-ui.test.js`: bewaakt de premium scriptvolgorde en dashboardcontracten.

Laatste groene verificatie:
- `npm run verify:critical` is groen na de dashboardmodule-splitsing.
- Contracttests: 749 geslaagd, 0 gefaald.
- Smoke-tests: 25 geslaagd, 0 gefaald.

## Volgende frontend-splitsingen
Werk pas verder nadat de baseline groen is. Splits telkens maar een verantwoordelijkheid af.

Aanbevolen volgorde:
1. Status- en meldinghelpers uit `assets/coldcalling-dashboard.js`.
2. Campagneformulier-state uit `assets/coldcalling-dashboard.js`.
3. Leadlijst-modal en spreadsheet-import uit `assets/coldcalling-dashboard.js`.
4. AI-notebook-modal uit `assets/coldcalling-dashboard.js`.
5. Lead-database records/rendering uit `assets/coldcalling-dashboard.js`.
6. Sequential dispatch en call-update polling uit `assets/coldcalling-dashboard.js`.

Regels voor elke splitsing:
- Houd bestaande scriptvolgorde contractueel bewaakt.
- Laat oversized HTML-bestanden niet netto groeien.
- Verplaats geen businessgedrag zonder bijpassende contracttest.
- Draai `npm run verify:critical` zodra een splitsing inhoudelijk klaar is.

## Voortgangsnotitie 2026-04-28: coldcalling dashboard modularisatie

De eerste veilige verbeterlijn is succesvol ingezet: de grote coldcalling-dashboardfile wordt stap voor stap dunner gemaakt zonder backend-, agenda-, auth-, leads- of Supabase-gedrag te wijzigen.

Afgerond in deze lijn:
- `assets/coldcalling-dashboard-core.js` bevat nu herbruikbare basishelpers voor HTML escaping, parsing, abortable fetches, lead-database formatting, bootstrap uitlezen, slider-ready-state en campagnemeldingen.
- `assets/coldcalling-dashboard-config.js` centraliseert opslagkeys, UI-state scopes en business-mode constants.
- `assets/coldcalling-dashboard-modes.js` centraliseert business-mode en coldcalling-stack normalisatie.
- `test/contracts/coldcalling-dashboard-modules.test.js` is opgesplitst in kleinere contracten, zodat iedere moduleverantwoordelijkheid apart zichtbaar is.
- De publieke en premium leadgeneratorpagina's laden de dashboardmodules expliciet in de juiste volgorde met bijgewerkte cacheversies.

Huidige kwaliteitsstand:
- De kritieke verificatie is na iedere stap groen gehouden.
- De hoofdroute blijft: kleine refactors, direct contractueel vastzetten, daarna `npm run verify:critical`.
- Vermijd voorlopig grote functionele wijzigingen in agenda, leads, auth, call-insights en Supabase-paden; deze domeinen blijven hoog-risico.

Aanbevolen volgende stappen:
- Blijf de grote `assets/coldcalling-dashboard.js` alleen verkleinen met pure, goed testbare helpers.
- Laat stateful helpers zoals `readStorage` en `writeStorage` voorlopig lokaal staan zolang ze aan remote UI-state gekoppeld zijn.
- Splits pas nieuwe browsermodules uit wanneer de winst groter is dan de extra script-load en HTML-contractimpact.

## Voortgangsnotitie 2026-04-28: modulecontracten aangescherpt

Na de eerste modularisatiestappen is de kwaliteitslaag rond de coldcalling-dashboardmodules verder verstevigd. De contracttests bewaken nu niet alleen gedrag, maar ook de publieke modulegrenzen.

Extra vastgelegd:
- `SoftoraColdcallingDashboardCore`, `SoftoraColdcallingDashboardConfig` en `SoftoraColdcallingDashboardModes` moeten als bevroren browserglobals beschikbaar blijven.
- De publieke exportlijsten van core, config en modes zijn expliciet vastgelegd, zodat helpers, storagekeys en mode-normalizers niet ongemerkt verdwijnen of hernoemd worden.
- Browser storage keys moeten uniek blijven en onder de `softora_` namespace vallen.
- Abortable fetches en campagnetiming zijn apart contractueel afgedekt.

Waarom dit belangrijk is:
- De grote dashboardfile kan nu veiliger verder worden opgesplitst, omdat de gedeelde modulecontracten strakker bewaakt zijn.
- Toekomstige refactors krijgen sneller duidelijke feedback wanneer ze per ongeluk een modulegrens breken.
- Dit verlaagt het risico op subtiele frontend regressies zonder de hoog-risico backenddomeinen aan te raken.
## Voortgangsnotitie 2026-04-28: modulegrenzen vastgelegd

De coldcalling-dashboard opsplitsing heeft nu een eigen gids: [coldcalling-dashboard-module-boundaries.md](coldcalling-dashboard-module-boundaries.md). Die legt vast welke code in `core`, `config`, `modes` en het hoofddashboardbestand hoort. Dit maakt toekomstige opschoning veiliger, omdat agents en ontwikkelaars dezelfde beslisregels volgen voordat er nieuwe frontendlogica bijkomt.
## Voortgangsnotitie 2026-04-28: frontend cleanup checklist toegevoegd

Er is nu een centrale frontend checklist: [frontend-cleanup-checklist.md](frontend-cleanup-checklist.md). Deze checklist legt vast hoe grote HTML-pagina's, dashboard-scripts, gedeelde assets, styling en contracttests veilig opgeschoond moeten worden. Dit helpt om de frontend breder dan alleen coldcalling stap voor stap kleiner en professioneler te maken.
## Voortgangsnotitie 2026-04-28: codebase quality index toegevoegd

Er is nu een praktische kwaliteitsindex: [codebase-quality-index.md](codebase-quality-index.md). Deze index vertaalt de ambitie "100/100 codebase" naar concrete gebieden, scores, risico's en eerstvolgende verbeterstappen. Zo kunnen toekomstige refactors worden gekozen op basis van kwaliteitswinst in plaats van gevoel.
## Voortgangsnotitie 2026-04-28: kwaliteitsdocumenten gekoppeld aan het protocol

De nieuwe kwaliteitsdocumenten zijn nu opgenomen in [quality-protocol.md](quality-protocol.md). Daardoor verwijst het centrale protocol niet alleen naar de bestaande guardrails en architectuurdocs, maar ook naar de roadmap, quality index, frontend cleanup checklist en coldcalling modulegrenzen. Dat maakt de schoonmaakafspraken beter vindbaar voor toekomstige agents en ontwikkelaars.
## Voortgangsnotitie 2026-04-28: oversized frontend-groei naar core-assets verplaatst

Tijdens de kwaliteitscontrole blokkeerden grote premium HTML-pagina's op verdere groei. De gedeelde klanten- en dashboardhelpers zijn daarom verplaatst naar kleine core-assets met contracttests. Dit houdt de grote pagina's kleiner en past bij de afspraak dat nieuwe frontendlogica niet verder in oversized HTML-bestanden hoort te groeien.
## Voortgangsnotitie 2026-04-28: premium frontend modulegrenzen toegevoegd

De opsplitsing van klanten-, database- en dashboardhelpers is nu geborgd in [premium-frontend-module-boundaries.md](premium-frontend-module-boundaries.md). Deze gids legt vast wanneer premium frontendlogica in HTML mag blijven en wanneer die naar kleine `assets/*-core.js` modules hoort te verhuizen. Daarmee wordt de nieuwe module-aanpak herhaalbaar voor toekomstige opschoning.
## Voortgangsnotitie 2026-04-28: premium modulegrenzen gekoppeld aan quality protocol

De premium frontend modulegrenzen zijn nu ook opgenomen in [quality-protocol.md](quality-protocol.md). Daardoor is de nieuwe afspraak voor `assets/*-core.js` modules onderdeel van het centrale kwaliteitsprotocol en wordt deze bewaakt via de guardrail-contracttest.

## Voortgangsnotitie 2026-04-28: frontend module-eigenaarschap expliciet gemaakt

Er is nu een aparte [frontend-module-ownership-map.md](frontend-module-ownership-map.md). Die kaart maakt per frontend-domein duidelijk welk asset-bestand eigenaar is van pure logica, welke HTML-pagina's die modules gebruiken en wanneer nieuwe logica naar een core-module moet verhuizen.

## Voortgangsnotitie 2026-04-28: module-eigenaarschap in quality protocol

De frontend module ownership map is nu ook onderdeel van [quality-protocol.md](quality-protocol.md). De guardrail-contracttest bewaakt daardoor dat deze eigenaarschapskaart gekoppeld blijft aan het centrale kwaliteitsprotocol.

## Voortgangsnotitie 2026-04-28: data-eigenaarschap expliciet gemaakt

Er is nu een aparte [data-ownership-map.md](data-ownership-map.md). Die kaart legt per kritisch datadomein vast welke opslaglaag eigenaar is, welke runtime-state alleen compatibel of ondersteunend hoort te zijn en welke migratievolgorde de codebase richting een professionelere database-architectuur brengt.

## Voortgangsnotitie 2026-04-28: repository-migratieplan toegevoegd

Er is nu een [repository-migration-plan.md](repository-migration-plan.md). Dit plan vertaalt data-eigenaarschap naar een veilige migratievolgorde: eerst premium klanten/database, daarna agenda/leads, en pas daarna het verkleinen van de runtime snapshot.

## Voortgangsnotitie 2026-04-28: eerste premium klanten repository-adapter

De eerste repository-adapter voor premium klanten/database staat nu in `server/repositories/premium-customers-repository.js`. Deze adapter kapselt de bestaande UI-state scope `premium_customers_database` in zonder routes of frontend-response-shapes te wijzigen, en wordt bewaakt met `test/contracts/premium-customers-repository.test.js`.

## Voortgangsnotitie 2026-04-28: premium klanten lifecycle-status in repository

De premium klanten repository normaliseert nu lifecycle-statussen zoals `klant`, `afspraak`, `gemaild` en `afgehaakt` centraal. Daardoor hoeft toekomstige database-migratie minder te leunen op losse frontend- of routehelpers voor dezelfde betekenis.

## Voortgangsnotitie 2026-04-28: premium klanten identiteit in repository

De premium klanten repository kan nu stabiele klant-identiteit bepalen via telefoon, e-mail, website of bedrijfsnaam en kan inkomende klantenrijen veilig samenvoegen met bestaande rows. Dit verkleint de kans op dubbele klanten wanneer de database later naar dedicated tabellen of rows migreert.

## Voortgangsnotitie 2026-04-28: premium klanten repository sanitization

De premium klanten repository bewaakt nu maximale rij-aantallen, veldnaamlengtes en veldwaardelengtes voordat klanten worden opgeslagen. Daarmee wordt de toekomstige database-migratie beschermd tegen oversized of vreemd gevormde records zonder bestaande frontendroutes te wijzigen.

## Voortgangsnotitie 2026-04-28: premium klanten repository upsert

De premium klanten repository heeft nu expliciete zoek- en upserthelpers op basis van stabiele klant-identiteit. Toekomstige routes hoeven daardoor niet zelf door UI-state JSON te lopen om een klant te vinden, bij te werken of toe te voegen.

## Voortgangsnotitie 2026-04-28: premium klanten statusupdate via repository

De premium klanten repository kan nu lifecycle-statussen bijwerken op basis van stabiele klant-identiteit. Daardoor kan toekomstige agenda-, lead- of klantlogica een klantstatus centraal wijzigen zonder zelf door JSON rows te lopen of losse statusnormalisatie te herhalen.

## Voortgangsnotitie 2026-04-28: premium klanten repository samenvattingen

De premium klanten repository kan nu status-tellingen en identiteit-dekking samenvatten zonder dat dashboards of toekomstige routes zelf ruwe UI-state JSON hoeven te interpreteren. Dit maakt rapportagecode later eenvoudiger en verkleint de kans op afwijkende tellingen.

## Voortgangsnotitie 2026-04-28: premium klanten verwijderen via repository

De premium klanten repository kan nu klanten veilig verwijderen op basis van stabiele klant-identiteit. Daardoor hoeft toekomstige klant-, lead- of opschoonlogica niet zelf UI-state JSON te filteren en blijft verwijdergedrag centraal testbaar.

## Voortgangsnotitie 2026-04-28: premium klanten gefilterd lezen via repository

De premium klanten repository ondersteunt nu gefilterde en begrensde reads op status, zoekterm, limit en offset. Toekomstige dashboards en routes kunnen daardoor via de repository queryen in plaats van zelf ruwe klantenrows te filteren.

## Voortgangsnotitie 2026-04-28: premium klanten gesorteerd lezen via repository

De premium klanten repository ondersteunt nu stabiele sortering op velden zoals bedrijf, status, e-mail, telefoon en website. Daarmee kan toekomstige dashboard- en routecode consistente klantlijsten ophalen zonder eigen sorteerlogica.

## Voortgangsnotitie 2026-04-28: premium klanten bulk-upsert via repository

De premium klanten repository kan nu bulk-upserts uitvoeren met aparte tellingen voor toegevoegde, bijgewerkte en overgeslagen klanten. Dit bereidt spreadsheet- en importflows voor op repositorygebruik zonder dat importcode zelf klant-identiteit of rijlimieten hoeft te beheren.

## Voortgangsnotitie 2026-04-28: klantenpagina bootstrap leest via repository seam

De klantenpagina bootstrap-service leest premium klanten nu primair via de repository seam en valt alleen terug op legacy/chunked UI-state wanneer de repository geen rijen teruggeeft. Daarmee is de eerste concrete consumer voorbereid op verdere migratie naar een explicieter datamodel zonder bestaande pagina-bootstrap of response-shapes te breken.

## Voortgangsnotitie 2026-04-28: AI-dashboard klantcontext leest via repository seam

De AI-dashboardcontext haalt premium klantdata nu eerst via de klantenrepository op en gebruikt ruwe UI-state alleen nog als fallback. Hierdoor hoeft de AI-context minder opslagdetails te kennen en wordt toekomstige migratie naar dedicated klanttabellen veiliger voor agents en eenvoudiger te testen.

## Voortgangsnotitie 2026-04-28: coldcalling eligibility gebruikt klantenrepository

De coldcalling-startflow gebruikt voor premium klantblokkades nu eerst de klantenrepository en valt conservatief terug op legacy UI-state wanneer de repository leeg is of een volledige scan nodig heeft. Dit verkleint de kans dat leads opnieuw worden benaderd terwijl klant-, afspraak- of mailcampagnestatussen al centraal bekend zijn.

## Voortgangsnotitie 2026-04-28: agenda post-call klantstatus via repository

Agenda/post-call statuswijzigingen voor premium klanten lopen nu eerst via de klantenrepository en gebruiken de oude UI-state update alleen nog als fallback. Daardoor worden `klant`- en `afgehaakt`-updates centraler testbaar terwijl de bestaande agenda-response-shapes en rollbackroute intact blijven.

## Voortgangsnotitie 2026-04-28: statusgeschiedenis in klantenrepository

De premium klantenrepository heeft nu een centrale helper voor begrensde, geschoonde statusgeschiedenis. Daarmee kunnen toekomstige agenda-, coldmail- en leadflows klantstatussen met historie vastleggen zonder ieder domein eigen `hist`-logica te laten bouwen.

## Voortgangsnotitie 2026-04-28: agenda post-call gebruikt centrale statusgeschiedenis

Agenda/post-call gebruikt nu de centrale statusgeschiedenis-helper uit de klantenrepository bij `klant`- en `afgehaakt`-updates. Daarmee verdwijnt lokale `hist`-opbouw uit dit kritieke domein en blijft de betekenis van statuslabels centraal contractueel bewaakt.

## Voortgangsnotitie 2026-04-28: coldmail-campaign gebruikt klantenrepository

Coldmail-campaign leest premium klantrecipients nu eerst via de klantenrepository en persisteert `gemaild`-updates via bulk-upsert wanneer die seam beschikbaar is. De bestaande UI-state opslag blijft als fallback bestaan, terwijl statusgeschiedenis via de centrale klantenrepository-helper wordt opgebouwd.

## Voortgangsnotitie 2026-04-28: coldmail auto-reply matcht via klantenrepository

De coldmail auto-reply sync gebruikt nu dezelfde klantenrepository-naad om inbound replies aan actieve coldmailcampagnes te koppelen. Daardoor hoeft reply-matching minder ruwe UI-state opslagdetails te kennen en blijft de oude opslagroute alleen als fallback nodig.

## Voortgangsnotitie 2026-04-28: statusupdate met historie als repository-helper

De premium klantenrepository heeft nu een pure helper om klantstatussen op identiteit bij te werken en tegelijk begrensde statusgeschiedenis toe te voegen. Dit maakt toekomstige migraties van agenda-, lead- en mailstatussen veiliger omdat agents dezelfde centrale status- en historiecontracten kunnen hergebruiken.

## Voortgangsnotitie 2026-04-28: immutability-contract voor klantstatussen

De nieuwe centrale klantstatus-helper heeft nu ook een expliciet contract dat bronrijen niet gemuteerd worden bij updates of missende matches. Dat maakt repository-migraties veiliger voor parallelle agents, rollback-scenario's en toekomstige statusflows rond agenda, leads en mail.

## Voortgangsnotitie 2026-04-28: invalid-status guard voor klantstatussen

De centrale klantstatus-helper heeft nu een expliciet contract dat lege of ongeldige statussen geen klantdata aanpassen. Dit voorkomt stille datavervuiling in toekomstige agenda-, lead- en mailmigraties en maakt het statuspad veiliger voor AI-agents.

## Voortgangsnotitie 2026-04-28: veilige lege invoer voor klantstatus-helper

De centrale klantstatus-helper heeft nu een contract voor lege of verkeerd gevormde rij-invoer. Daardoor blijven toekomstige statusmigraties fail-safe: kapotte input resulteert in een veilige no-op in plaats van een crash of gedeeltelijke datawijziging.

## Voortgangsnotitie 2026-04-28: agent-contract voor klantstatussen

Er is nu een kort agent-vriendelijk contractdocument voor klantstatusupdates. Dit maakt expliciet dat nieuwe agenda-, lead-, coldcalling- en mailflows centrale repository-helpers moeten gebruiken in plaats van eigen statuslogica, waardoor toekomstige AI-agents sneller en veiliger kunnen werken.

## Voortgangsnotitie 2026-04-28: klantstatus-contract bewaakt door tests

Het agent-contract voor klantstatussen wordt nu zelf door contracttests bewaakt. Daardoor kan het document niet stilletjes losraken van de centrale repository-helper, de no-ad-hoc-regels of de minimale regressiedekking die toekomstige agents moeten respecteren.

## Voortgangsnotitie 2026-04-28: klantstatus-contract gekoppeld aan agent-startinstructies

De root agent-instructies verwijzen nu expliciet naar het klantstatus-contract bij wijzigingen rond klantstatussen. Een contracttest bewaakt deze koppeling, zodat toekomstige agents direct de centrale statusroute volgen en niet terugvallen op losse statuslogica.

## Voortgangsnotitie 2026-04-28: klantstatus-contract gekoppeld aan repository-migratieplan

Het repository-migratieplan verwijst nu expliciet naar het klantstatus-contract en de centrale statushelper. Een contracttest bewaakt deze koppeling, zodat toekomstige migraties in agenda, leads, coldcalling en coldmailing geen nieuwe losse statuslogica introduceren.

## Voortgangsnotitie 2026-04-28: klantstatus-eigenaarschap vastgelegd

De data-eigenaarschapkaart legt nu vast dat klantstatussen bij de premium klantenrepository horen en niet bij losse agenda-, lead-, coldcalling- of mailflows. Een contracttest bewaakt deze afspraak, zodat toekomstige agents statusdata niet opnieuw als route-, frontend- of `server.js`-state gaan behandelen.

## Voortgangsnotitie 2026-04-28: klantstatus-contract gekoppeld aan kwaliteitsprotocol

Het algemene kwaliteitsprotocol verwijst nu bij grotere refactors naar het klantstatus-contract en de centrale repository-helper. Een contracttest bewaakt deze koppeling, zodat statuswijzigingen in agenda-, lead-, coldcalling-, coldmailing- en dashboardcontext niet buiten de afgesproken bron van waarheid belanden.

## Voortgangsnotitie 2026-04-28: directe klantstatusgeschiedenis geblokkeerd in risicoflows

De klantstatus-contracttests bewaken nu dat hoog-risico flows zoals agenda, coldcalling, coldmailing, dashboardcontext en klantenbootstrap geen directe `hist.push(...)`-achtige statusgeschiedenis toevoegen. Dit houdt statushistorie centraal in de premium klantenrepository en maakt toekomstige agent-wijzigingen veiliger.

## Voortgangsnotitie 2026-04-28: server.js buiten klantstatus-wiring gehouden

De klantstatus-contracttests bewaken nu dat `server.js` geen centrale klantstatushelpers rechtstreeks gaat gebruiken. Daardoor blijven statusupdates in repository-backed services en voorkomen we dat legacy wiring opnieuw businesslogica rond klantstatussen aantrekt.

## Voortgangsnotitie 2026-04-28: klantstatushelpers als publieke repository-API bewaakt

De klantstatus-contracttests bewaken nu dat de premium klantenrepository de centrale statushelpers blijft exporteren. Daardoor kan een toekomstige agent of refactor deze veilige API niet stilletjes verwijderen of hernoemen zonder dat de kritieke checks rood worden.

## Voortgangsnotitie 2026-04-28: update-resultaat klantstatussen expliciet gemaakt

Het klantstatus-contract legt nu vast dat alleen `updated === true` als succesvolle klantstatuswijziging telt. Een contracttest bewaakt deze afspraak, zodat toekomstige agents misses, lege input of geweigerde statussen niet per ongeluk als succesvolle updates behandelen.

## Voortgangsnotitie 2026-04-28: neutrale codebase-priority-review vastgelegd

Er is nu een aparte codebase-priority-review met een neutrale rangschikking van de belangrijkste resterende verbeterpunten. De hoogste prioriteit is frontend DOM-veiligheid, gevolgd door opsplitsing van de grootste frontendbestanden, verdere backendservice-splitsing, repository-migratie en releasegerichte security-verificatie. Contracttests bewaken dat deze prioriteiten zichtbaar blijven voor toekomstige agents.

## Voortgangsnotitie 2026-04-28: frontend DOM-safety contract toegevoegd

De hoogste prioriteit uit de neutrale codebase-review is nu omgezet naar een concreet frontend DOM-safety contract. Het contract legt vast wanneer `textContent`, DOM-node builders, escape-helpers en bewust `innerHTML`-gebruik passen. Contracttests bewaken dat toekomstige agents deze veilige rendering-route blijven volgen.

## Voortgangsnotitie 2026-04-28: P1 coldcalling-dashboard opsplitsroute gekoppeld aan DOM-safety

De modulegrenzen voor het coldcalling-dashboard verwijzen nu expliciet naar het frontend DOM-safety contract. De eerstvolgende opsplitsfase is vastgelegd als renderveiligheid eerst: kleine pure renderformatters en configuratie verplaatsen voordat stateful flow-control of modalgedrag wordt opgesplitst. Contracttests bewaken deze P1-route.
