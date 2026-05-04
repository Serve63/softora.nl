# Softora Agent Guardrails

Deze repo is agent-vriendelijk aan het worden, maar nog niet volledig opgesplitst. Werk daarom volgens deze regels:

## Altijd eerst
- Lees bij grotere refactors ook [docs/quality-protocol.md](docs/quality-protocol.md).
- Draai `npm run verify:critical` voor je afrondt.
- Commit en push elke succesvolle wijziging direct naar de huidige branch, tenzij de gebruiker expliciet vraagt om lokaal te blijven.
- Productie deployen mag alleen via `npm run deploy:production`; dat script blokkeert alles behalve een schone checkout die exact gelijk is aan de actuele `origin/main`.
- Na een productie-deploy moet `npm run check:live-production-version` groen zijn; `www.softora.nl` moet exact dezelfde commit draaien als `origin/main`.
- Elke push/merge naar `main` moet automatisch door Vercel naar productie gaan; `.github/workflows/live-production-version.yml` wacht daarna en faalt rood als `www.softora.nl` niet exact op die nieuwe `main` staat.
- `main` is beschermd via de GitHub ruleset "Softora main quality gate"; werk vanaf `codex/*` branches en merge naar `main` alleen via PR nadat verplichte checks groen zijn.
- Draai bij wijzigingen in `server.js`, `server/routes`, `server/security`, `agenda`, `auth`, `leads` of `coldcalling` eerst `npm run backup:runtime`.
- Gebruik [server/routes/manifest.js](server/routes/manifest.js) als lijst van kritieke flows.
- Behandel agenda, leads, call-insights en auth als hoog-risico domeinen.
- Laat `npm run check:guardrails` groen blijven; die check draait ook mee in `verify:critical`.
- Laat `npm run check:repo-hygiene` groen blijven; ruim lokale build-cache en OS-bestanden op met `npm run clean:local`.
- Laat `npm run check:quality-lock` groen blijven; deze check bewaakt dat CI, tests en premium sidebar-assets niet stilletjes verzwakken.
- Verzwak tests nooit met `.only`, `.skip` of `todo` in vaste testbestanden; de guardrails blokkeren dit.
- Beschouw workflows, verificatiescripts en protocoldocs als beschermde kwaliteitscode.

## Bron van waarheid
- Database en formele repositories zijn leidend zodra een pad is gemigreerd.
- In-memory state in [server.js](server.js) is legacy en mag niet verder worden uitgebouwd als business-truth.
- Voeg geen nieuwe parallelle opslagpaden toe zonder expliciete compat-flag of rollback-pad.

## Wijzigen zonder regressies
- Verander bestaande routes niet zomaar; houd response-shapes stabiel.
- Voeg nieuwe logica bij voorkeur toe via `server/routes`, `server/services`, `server/repositories`, `server/security`, `server/schemas`.
- Nieuwe frontendlogica hoort uiteindelijk in losse bestanden, niet in grote inline scripts.
- Nieuwe businesshelpers horen niet meer in [server.js](server.js); houd dat bestand zoveel mogelijk wiring-only.
- Houd [server/services/server-app-runtime.js](server/services/server-app-runtime.js) en `server/services/server-app-runtime-*.js` compositie-only; nieuwe domeinlogica hoort daar niet thuis.
- Nieuwe servercode hoort niet in nieuwe ad-hoc mappen onder `server/`; gebruik de bestaande architectuurmappen.
- Productiecodewijzigingen horen samen te gaan met contract- of smoke-testupdates.
- Grote productiewijzigingen moeten worden opgeknipt; `check:guardrails` blokkeert brede diffs boven de ingestelde limiet.
- Grote nieuwe inline scripts in HTML zijn niet toegestaan; verplaats paginalogica naar `assets/*`.
- Wijzigingen aan premium shell/sidebar bestanden vragen een gerichte update in `test/contracts/premium-sidebar-shell-scope.test.js`.
- Wijzigingen aan guardrail- of verificatiescripts vragen een gerichte update in `test/contracts/agent-guardrails.test.js`.
- Wijzigingen aan CI-workflows, protocoldocs of kwaliteitschecks mogen de baseline niet verlagen: `verify:critical`, `check:guardrails`, contracttests, smoke-tests en secrets-checks moeten onderdeel blijven van de automatische poort.
- Zet geen guardrail-bypass env vars zoals `ALLOW_UNTESTED_CHANGES` of `SKIP_RUNTIME_BACKUP_CHECK` in GitHub Actions; uitzonderingen horen lokaal en bewust genoteerd te zijn.
- Direct pushen naar `main` hoort geblokkeerd te zijn; als dat niet zo is, behandel dat als kwaliteitsincident en herstel de ruleset.

## Rollback
- Voor risicovolle veranderingen: eerst `npm run backup:runtime`.
- Gebruik feature flags of compat-switches voor paden die oud en nieuw gedrag tijdelijk naast elkaar nodig hebben.
- Als een kritieke flow faalt, eerst terug naar de laatst werkende compatibele staat en daarna pas verder debuggen.
- Alleen bij een bewuste uitzondering mag je guardrails tijdelijk overrulen via env flags zoals `SKIP_RUNTIME_BACKUP_CHECK=1` of `ALLOW_SERVER_JS_GROWTH=1`, en noteer dan waarom.

## Security
- Secrets nooit in tracked files.
- Service-role keys alleen server-side.
- State-changing routes moeten uiteindelijk via expliciete validatie en role checks lopen.
- Nieuwe debug of admin routes altijd achter bestaande admin/debug toegang.
