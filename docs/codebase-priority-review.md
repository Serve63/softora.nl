# Codebase priority review

Laatste review: 2026-04-28

Dit document vat de neutrale technische beoordeling samen en zet de eerstvolgende verbeteringen op volgorde van urgentie en impact. Het doel is een schonere, veiligere, schaalbare en agent-vriendelijke codebase.

## Compacte score-inschatting

- Backend guardrails en contracttests: sterk, ongeveer 8/10.
- Data-eigenaarschap en repository-migratie: goed op weg, ongeveer 7.5/10.
- Security-baseline: redelijk sterk door secrets-checks, request security en guardrails, ongeveer 7.5/10.
- Frontend onderhoudbaarheid: grootste open verbeterpunt, ongeveer 5.5/10.
- AI-agent werkbaarheid: backend goed, frontend nog te groot en te impliciet, gemiddeld ongeveer 7/10.

## Belangrijkste signalen uit de repo-scan

- De repo bevat honderden relevante bron- en documentbestanden; de JavaScript- en HTML-laag is groot genoeg dat automatische agent-guardrails noodzakelijk blijven.
- De backend heeft veel contracttests en duidelijke kwaliteitschecks via `verify:critical`.
- De grootste technische schuld zit in grote frontendbestanden en inline HTML-pagina's.
- `assets/coldcalling-dashboard.js` is het grootste losse frontendbestand en moet als eerste verder worden opgesplitst.
- Grote HTML-pagina's zoals `premium-ai-coldmailing.html`, `premium-personeel-dashboard.html`, `premium-website.html`, `premium-personeel-agenda.html` en `premium-database.html` blijven refactor-kandidaten.
- Er zijn veel `innerHTML`-renderpunten. Een deel is waarschijnlijk bewust of escaped, maar dit blijft een structurele XSS- en onderhoudsrisicozone.
- Browseropslag bestaat nog in bestaande frontendpaden. Nieuwe opslag wordt al door guardrails beperkt, maar bestaande plekken verdienen later migratie of expliciete documentatie.
- De serverlaag is beter opgesplitst dan eerder, maar enkele services blijven groot en verdienen gerichte domeinsplitsing.

## Prioriteiten van hoog naar lager

### P0: frontend DOM-veiligheid standaardiseren

Maak een centraal contract voor DOM-rendering in frontendcode. Nieuwe of aangepaste UI-code moet duidelijk onderscheid maken tussen veilige tekst, escaped HTML en bewust toegestane markup.

Waarom eerst: dit heeft directe security-impact en helpt elke volgende frontend-refactor veiliger worden.

Gewenste stappen:

- Leg een frontend DOM-safety contract vast.
- Bewaak dat nieuwe risicoflows geen ruwe externe data via `innerHTML` renderen.
- Gebruik centrale escape-helpers of veilige DOM-node builders.
- Maak uitzonderingen expliciet en testbaar.

### P1: `assets/coldcalling-dashboard.js` verder opsplitsen

Dit bestand is de grootste frontend-concentratie en raakt een belangrijk bedrijfsproces. Het moet stap voor stap opgesplitst worden in kleine modules voor API, state, renderers, modals en flow-control.

Waarom hoog: groot bestand betekent hoge regressiekans, trage agent-navigatie en meer kans op dubbele logica.

Gewenste stappen:

- Eerst alleen pure renderhelpers of configuratie verplaatsen.
- Daarna API-client helpers isoleren.
- Daarna modal- en statusrendering apart zetten.
- Elke stap met smoke- of contracttest borgen.

### P2: grote inline HTML-scripts migreren naar `assets/*`

De grootste HTML-pagina's bevatten nog veel gedrag naast markup. Nieuwe logica hoort niet meer inline te groeien.

Waarom belangrijk: HTML-bestanden worden anders moeilijk te reviewen, testen en veilig te wijzigen.

Eerste kandidaten:

- `premium-ai-coldmailing.html`
- `premium-personeel-dashboard.html`
- `premium-personeel-agenda.html`
- `premium-database.html`
- `premium-website.html`

### P3: grote backendservices verder opdelen op domein

De backend is veel beter bewaakt, maar enkele services blijven groot. Splits alleen wanneer er een duidelijke domeinnaad is en voeg contracttests toe.

Eerste kandidaten:

- `server/services/ai-remote.js`
- `server/services/coldmail-campaign.js`
- `server/services/premium-database-import.js`
- `server/services/seo-core.js`
- `server/services/call-provider-helpers.js`

### P4: repository-migratie verder afronden

De migratie weg van legacy UI-state naar repositories moet doorgaan, vooral bij klanten, leads, agenda en mailstatussen.

Waarom belangrijk: minder parallelle waarheid, betere schaalbaarheid en veiliger multi-instance gedrag.

### P5: security-verificatie uitbreiden naar vaste routine

`verify:critical` is sterk. Voor cyberveiligheid moet `verify:security` periodiek of voor releases expliciet meelopen, inclusief dependency-audit.

Waarom later: dependency-audit kan externe of tijdelijke ruis geven, maar hoort wel in release discipline.

### P6: frontend storage legacy opruimen

Bestaande `localStorage` en `sessionStorage`-paden moeten later per domein bekeken worden. Niet alles hoeft weg, maar eigenaarschap, TTL en privacy-impact moeten expliciet zijn.

Waarom later: bestaande storage kan functioneel nodig zijn; eerst DOM-safety en modulegrenzen aanpakken.

## Aanbevolen eerstvolgende technische stap

Begin met P0: maak DOM-rendering expliciet veilig en agent-vriendelijk. Daarna wordt het opsplitsen van grote frontendbestanden minder riskant, omdat agents dan een duidelijk contract hebben voor veilige UI-rendering.
