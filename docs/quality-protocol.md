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
- Voor klanten, actieve opdrachten, order-runtime, database-designfoto's en webdesign-jobs is [docs/data-ops-storage.md](data-ops-storage.md) leidend: oude `ui_state:*` JSON is daar alleen tijdelijke compat/fallback.

## Hoog-risico workflow
- Lees altijd eerst [AGENTS.md](../AGENTS.md), [docs/repo-map.md](repo-map.md) en [server/routes/manifest.js](../server/routes/manifest.js).
- Maak bij high-risk wijzigingen eerst een runtime-backup.
- Knip refactors op in kleine, omkeerbare stappen met gerichte tests per stap.
- Laat compat-paden of feature flags tijdelijk naast nieuw gedrag bestaan als een domein nog half gemigreerd is.
- Als een kritieke flow wankelt, eerst terug naar de laatst bewezen compatibele staat en dan pas verder verbeteren.

## Versie- en deploy-veiligheid
- Iedere agent werkt vanaf de allerlaatste actuele `origin/main` of een verse `codex/*` branch die daarop gebaseerd is.
- Oude lokale kopieen, oude branches, vervuilde worktrees en losse bureaubladmappen mogen nooit als productiebron worden gebruikt.
- Recente live wijzigingen mogen niet verdwijnen door een merge, rebase, reset, checkout of deploy vanaf een oude staat.
- Voor push/deploy controleert de agent dat alleen de bedoelde diff meegaat en dat recente wijzigingen behouden blijven.
- Na merge/deploy controleert de agent dat `www.softora.nl` exact op de nieuwste `origin/main` draait; bij afwijking eerst branch, bron en Vercel-deployment vergelijken.

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
- Productie deploys lopen alleen via `npm run deploy:production`; dat script weigert alles behalve een schone checkout die exact gelijk is aan de actuele `origin/main`.
- Na productie-deploys controleert `npm run check:live-production-version` dat `www.softora.nl` exact dezelfde commit draait als `origin/main`.
- Elke push/merge naar `main` hoort automatisch via Vercel productie te worden; `.github/workflows/live-production-version.yml` wacht op die automatische deploy en faalt als live productie niet exact op `origin/main` staat.
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
- [scripts/check-agent-guardrails.js](../scripts/check-agent-guardrails.js)
- [scripts/check-quality-lock.js](../scripts/check-quality-lock.js)
- [scripts/check-repo-hygiene.sh](../scripts/check-repo-hygiene.sh)
- [scripts/guard-production-deploy-source.js](../scripts/guard-production-deploy-source.js)
- [scripts/deploy-production-safe.js](../scripts/deploy-production-safe.js)
- [scripts/wait-live-production-version.js](../scripts/wait-live-production-version.js)
- [scripts/clean-local-artifacts.sh](../scripts/clean-local-artifacts.sh)
- [server/routes/manifest.js](../server/routes/manifest.js)
- GitHub ruleset "Softora main quality gate" op `main`: PR verplicht, deletion/force-push geblokkeerd, en `agent-guardrails`, `verify-critical` en `repo-hygiene` verplicht groen.
- [.github/workflows/agent-guardrails.yml](../.github/workflows/agent-guardrails.yml)
- [.github/workflows/live-production-version.yml](../.github/workflows/live-production-version.yml)
- [.github/workflows/verify-critical.yml](../.github/workflows/verify-critical.yml)
- [.github/workflows/repo-hygiene.yml](../.github/workflows/repo-hygiene.yml)
