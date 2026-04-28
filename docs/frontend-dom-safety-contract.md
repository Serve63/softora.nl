# Frontend DOM safety contract

Laatste update: 2026-04-28

Dit document is het agent-vriendelijke contract voor veilige DOM-rendering in de frontend.

## Doel

De frontend bevat grote HTML-pagina's en grote `assets/*` scripts met veel dynamische rendering. Dat is normaal voor deze codebase, maar het maakt `innerHTML`-gebruik een belangrijk onderhouds- en security-risico.

Nieuwe of aangepaste frontendcode moet daarom expliciet kiezen tussen veilige tekst, escaped HTML en bewust toegestane markup.

## Veilige standaard

Gebruik `textContent` wanneer je gewone tekst uit data, gebruikersinvoer, API-responses, AI-output, mailinhoud, leadinformatie, klantdata of agenda-informatie toont.

Gebruik DOM-node builders zoals `document.createElement`, `appendChild`, `replaceChildren` en attributen via `setAttribute` wanneer markup dynamisch opgebouwd wordt.

Gebruik bestaande escape-helpers zoals `escapeHtml`, `esc` of domeinspecifieke sanitizers wanneer een bestaande renderer nog met HTML-templates werkt.

## `innerHTML` alleen bewust

`innerHTML` mag alleen als:

- de inhoud volledig statische markup is;
- alle dynamische waarden vooraf aantoonbaar escaped zijn;
- er een domeinspecifieke sanitizer wordt gebruikt;
- het om een bestaande legacy-renderer gaat die niet veilig in dezelfde stap opgesplitst kan worden.

Nieuwe `innerHTML`-rendering met ruwe externe data is niet toegestaan.

## Externe of risicovolle data

Behandel de volgende bronnen altijd als onveilig totdat ze escaped of gesanitized zijn:

- gebruikersinvoer;
- API-responses;
- AI-output;
- e-mailinhoud;
- website-scanresultaten;
- lead- en klantvelden;
- agenda- en call-notities;
- query parameters;
- data uit browser storage.

## Niet doen

Gebruik geen ruwe template string met externe data direct in `innerHTML`.

Gebruik geen `eval` of `new Function` voor frontendgedrag.

Plaats geen nieuwe grote inline scripts in HTML-pagina's.

Voeg geen nieuwe browser storage toe zonder eigenaarschap, privacy-impact en testbare reden.

## Verwachte testdekking

Frontendwijzigingen met dynamische rendering horen minimaal een contract- of smoke-test te hebben voor:

- de pagina of asset die geraakt wordt;
- escaping of veilige tekstweergave van dynamische data;
- afwezigheid van nieuwe ruwe `innerHTML`-rendering waar mogelijk;
- behoud van bestaande route- of response-shapes wanneer frontend en backend samenwerken.

## Aanpak voor refactors

Splits grote frontendbestanden in kleine stappen. Begin met pure helpers, configuratie en renderfuncties voordat je state of API-calls verplaatst.

Voor `assets/coldcalling-dashboard.js` geldt: verplaats eerst kleine renderhelpers of configuratie naar losse modules, met gerichte contracttests. Vermijd brede gedragswijzigingen in dezelfde stap.
