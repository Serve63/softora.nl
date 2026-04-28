# Softora Quality Protocol

## Doel
Dit protocol houdt de codebase stabiel, veilig en agent-vriendelijk terwijl we gefaseerd opschonen. Continuiteit van de site gaat altijd voor refactor-snelheid of cosmetische netheid.

## Prioriteitsvolgorde
1. Werkende site en rollback-pad behouden.
2. Kritieke contracts en response-shapes stabiel houden.
3. Security en toegangscontrole aanscherpen.
4. Onderhoudbaarheid en logische bestandsindeling verbeteren.
5. Performance optimaliseren zonder gedrag of veiligheid te beschadigen.

## Kernregels
- `server.js` blijft een klein entrypoint en export-layer, geen businesslogica.
- `server/services/server-app-runtime.js` en `server/services/server-app-runtime-*.js` blijven compositie- en wiringlagen, geen nieuwe domeinlogica.
- Nieuwe businesslogica hoort in gerichte `server/services/*` modules met bijbehorende contract- of smoke-tests.
- Nieuwe routes horen in `server/routes/*`, validatie in `server/schemas/*`, beveiligingscontrole in `server/security/*`.
- Root-level HTML mag kleine bootstrap bevatten, maar grotere paginalogica hoort in `assets/*`.
- Frontend-bestanden boven de guardrail-limiet mogen niet verder groeien; nieuwe logica hoort eerst in kleinere modules of in een bewuste, genoteerde uitzondering.
- Database of formele repositories zijn leidend zodra een pad is gemigreerd; voeg geen tweede bron van waarheid toe.

## Hoog-risico workflow
- Lees altijd eerst [AGENTS.md](../AGENTS.md), [docs/repo-map.md](repo-map.md) en [server/routes/manifest.js](../server/routes/manifest.js).
- Maak bij high-risk wijzigingen eerst een runtime-backup.
- Knip refactors op in kleine, omkeerbare stappen met gerichte tests per stap.
- Laat compat-paden of feature flags tijdelijk naast nieuw gedrag bestaan als een domein nog half gemigreerd is.
- Als een kritieke flow wankelt, eerst terug naar de laatst bewezen compatibele staat en dan pas verder verbeteren.

## Verboden vervuiling
- Geen nieuwe businesshelpers in `server.js` of in runtime-compositiebestanden.
- Geen stille response-shape wijzigingen op bestaande routes.
- Geen nieuwe ad-hoc mappen onder `server/`.
- Geen browser-opslag als systeem-van-record voor productiegedrag.
- Geen debug- of adminpaden zonder bestaande auth-, rol- en auditcontroles.
- Geen `.only`, `.skip` of `todo` in vaste tests om falende dekking te ontwijken.
- Geen verzwakking van package scripts, CI-workflows of protocoldocs zonder gerichte guardrail-test.

## Security baseline
- Secrets blijven uit tracked files en service-role keys blijven server-side.
- State-changing routes valideren input expliciet en controleren rollen of scopes.
- Debug/admin functionaliteit vereist bestaande premium-auth of admin-guarding en audit-events waar relevant.
- Nieuwe externe webhooks of providerkoppelingen krijgen expliciete verificatie, foutafhandeling en veilige defaults.

## Performance baseline
- Optimaliseer pas na contractstabiliteit en security-checks.
- Vermijd onnodige synchronous hot-path logica in request-handlers als er al gedeelde async helpers bestaan.
- Houd runtime-compositie compact; grote setupblokken moeten naar kleinere modules zodat startup en debugging begrijpelijk blijven.
- Pagina-assets horen gedeeld en cachebaar te zijn zodra inline scripts of styles substantieel worden.

## Definition Of Done
- Productiegedrag krijgt of behoudt contract- of smoke-testdekking.
- `npm run check:guardrails` blijft groen.
- `npm run check:repo-hygiene` blijft groen; lokale rommel kan worden opgeschoond met `npm run clean:local`.
- `npm run check:quality-lock` blijft groen; CI-bypasses, testverzwakking en premium sidebar asset-drift worden geblokkeerd.
- `npm run verify:critical` is groen voor afronding.
- De kwaliteitsbaseline blijft intact: guardrails, contracttests, smoke-tests en secrets-checks blijven onderdeel van `verify:critical`.
- `main` blijft beschermd via de GitHub ruleset "Softora main quality gate"; wijzigingen landen via PR vanaf `codex/*` branches.
- Grote wijzigingen landen in kleine stappen; brede productiediffs en grote inline scripts worden door guardrails geblokkeerd tenzij bewust overruled.
- Oversized frontend-bestanden mogen standaard niet netto groeien; splits eerst op of noteer bewust waarom `ALLOW_OVERSIZED_FRONTEND_GROWTH` nodig is.
- Premium shell/sidebar wijzigingen houden `test/contracts/premium-sidebar-shell-scope.test.js` actueel.
- Quality-gate wijzigingen houden `test/contracts/agent-guardrails.test.js` actueel.
- Tests worden niet verzwakt met `.only`, `.skip` of `todo`.
- Voor high-risk wijzigingen bestaat een verse rollback-backup.
- Nieuwe code landt op de juiste architectuurplek en maakt bestaande centrale bestanden niet weer zwaarder.
- Succesvolle wijzigingen worden direct gecommit en gepusht, tenzij de gebruiker expliciet om lokaal werk vraagt.
- GitHub Actions mogen kwaliteitschecks niet omzeilen met `continue-on-error`, `|| true`, `exit 0` of guardrail-bypass env vars.

## Handhaving
Dit protocol wordt geborgd via:
- [AGENTS.md](../AGENTS.md)
- [docs/repo-map.md](repo-map.md)
- [docs/architecture.md](architecture.md)
- [docs/codebase-health-roadmap.md](codebase-health-roadmap.md)
- [docs/codebase-quality-index.md](codebase-quality-index.md)
- [docs/data-ownership-map.md](data-ownership-map.md)
- [docs/repository-migration-plan.md](repository-migration-plan.md)
- [docs/frontend-cleanup-checklist.md](frontend-cleanup-checklist.md)
- [docs/coldcalling-dashboard-module-boundaries.md](coldcalling-dashboard-module-boundaries.md)
- [docs/premium-frontend-module-boundaries.md](premium-frontend-module-boundaries.md)
- [scripts/check-agent-guardrails.js](../scripts/check-agent-guardrails.js)
- [scripts/check-quality-lock.js](../scripts/check-quality-lock.js)
- [scripts/check-repo-hygiene.sh](../scripts/check-repo-hygiene.sh)
- [scripts/clean-local-artifacts.sh](../scripts/clean-local-artifacts.sh)
- [server/routes/manifest.js](../server/routes/manifest.js)
- GitHub ruleset "Softora main quality gate" op `main`: PR verplicht, deletion/force-push geblokkeerd, en `agent-guardrails`, `verify-critical` en `repo-hygiene` verplicht groen.
- [.github/workflows/agent-guardrails.yml](../.github/workflows/agent-guardrails.yml)
- [.github/workflows/verify-critical.yml](../.github/workflows/verify-critical.yml)
- [.github/workflows/repo-hygiene.yml](../.github/workflows/repo-hygiene.yml)

## Frontend module-eigenaarschap

Gebruik [docs/frontend-module-ownership-map.md](frontend-module-ownership-map.md) naast de modulegrensdocumenten. Deze kaart maakt expliciet welk asset-bestand eigenaar is van pure frontendlogica, welke pagina's die modules gebruiken en wanneer nieuwe logica naar een bestaande of nieuwe core-module moet verhuizen.

## Data-eigenaarschap

Gebruik [docs/data-ownership-map.md](data-ownership-map.md) naast dit protocol. Deze kaart maakt expliciet welke domeinen al richting Supabase of formele opslag bewegen, welke state tijdelijk of compatibel is en waar geen nieuwe parallelle bron van waarheid mag ontstaan.

## Repository-migratie

Gebruik [docs/repository-migration-plan.md](repository-migration-plan.md) voor database- en repository-opruiming. Nieuwe repositories moeten een duidelijk domein, stabiele response-shapes, rollback- of compat-afspraak en gerichte contracttests hebben.

## Klantstatussen bij grotere refactors

Bij grotere refactors rond agenda, leads, coldcalling, coldmailing of dashboardcontext moeten klantstatussen volgens [docs/customer-status-contract.md](customer-status-contract.md) behandeld worden.

Gebruik de premium klantenrepository als bron van waarheid voor klantstatussen. Nieuwe of aangepaste statusflows moeten de centrale helper `updateCustomerStatusWithHistoryInRows` of een expliciet getest repository-contract gebruiken.

Voeg geen nieuwe route-state, frontend-state, inline statusnormalisatie of `server.js` businesslogica toe voor klantstatussen. Als een refactor extra gedrag nodig heeft, breid eerst het klantstatus-contract, de repository-contracttests en het rollback-pad uit.
