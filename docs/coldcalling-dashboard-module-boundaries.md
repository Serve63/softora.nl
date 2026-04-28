# Coldcalling dashboard modulegrenzen

Deze gids legt vast waar nieuwe frontendlogica voor het coldcalling-dashboard hoort. Het doel is simpel: kleine, voorspelbare bestanden die elk een eigen verantwoordelijkheid hebben, zodat toekomstige wijzigingen minder risico geven.

## Waarom dit bestaat

Het coldcalling-dashboard is een belangrijk onderdeel van Softora. Omdat er veel gedrag samenkomt op dezelfde pagina's, kan frontendcode snel onoverzichtelijk worden als helpers, instellingen, browserstatus en schermlogica door elkaar groeien.

De huidige opsplitsing moet daarom bewaakt blijven:

- `assets/coldcalling-dashboard-core.js`: pure helpers en kleine browserveilige utilities.
- `assets/coldcalling-dashboard-config.js`: opslagkeys, vaste waarden en gedeelde configuratie.
- `assets/coldcalling-dashboard-modes.js`: normalisatie en labels voor business modes en coldcalling stacks.
- `assets/coldcalling-dashboard.js`: schermgedrag, event handlers en dashboard-wiring.

## Beslisregel voor nieuwe code

Gebruik deze volgorde bij elke nieuwe frontendwijziging:

1. Is het een pure helper zonder DOM-afhankelijkheid? Zet het in `coldcalling-dashboard-core.js`.
2. Is het een vaste key, scope, standaardwaarde of gedeelde constante? Zet het in `coldcalling-dashboard-config.js`.
3. Gaat het over business modes, stack-normalisatie of labels? Zet het in `coldcalling-dashboard-modes.js`.
4. Heeft het directe interactie met knoppen, velden, modals of rendering? Laat het in `coldcalling-dashboard.js` of splits later naar een nieuw gericht schermmodulebestand.

Als code in meerdere categorieën lijkt te passen, kies de plek met de minste afhankelijkheden. Een helper die zonder pagina kan draaien is bijna altijd beter af buiten het hoofddashboardbestand.

## Wat we bewust niet willen

- Geen nieuwe opslagkeys rechtstreeks in `coldcalling-dashboard.js`.
- Geen grote inline scripts terugplaatsen in HTML.
- Geen businesslogica mengen met DOM-rendering als die ook puur getest kan worden.
- Geen nieuwe globals toevoegen zonder contracttest.
- Geen bestaande response-shapes of browser-global namen wijzigen zonder compatibele tussenstap.

## Contracten die mee moeten bewegen

Bij wijzigingen aan deze modules hoort minimaal een gerichte update in:

- `test/contracts/coldcalling-dashboard-modules.test.js`

Bij wijzigingen aan scriptvolgorde of assetversies hoort ook controle op:

- `test/contracts/ai-lead-generator-ui.test.js`
- `test/contracts/premium-ai-lead-generator-ui.test.js`
- `test/contracts/coldcalling-regio-radius.test.js`

Deze tests zijn niet alleen technische checks. Ze zijn de veiligheidsriem die voorkomt dat toekomstige opschoning per ongeluk de pagina's breekt.

## Praktische kwaliteitslat

Een wijziging is pas "netjes" als aan deze punten is voldaan:

- De naam van de helper of constante vertelt wat die doet.
- De module heeft geen onnodige kennis van de pagina.
- De public export is bewust en getest.
- Browser-globals blijven stabiel voor bestaande pagina's.
- Opslagkeys blijven uniek en volgen de bestaande `softora_` namespace.
- De wijziging maakt een volgend refactor-stapje makkelijker, niet moeilijker.

## Wanneer een nieuwe module logisch wordt

Maak pas een extra module wanneer er een duidelijke verantwoordelijkheid ontstaat, bijvoorbeeld:

- campagneformulier en campagnevalidatie;
- lead-database rendering;
- notebook/AI-notities;
- dispatch-instellingen;
- modal- of toastgedrag.

Een nieuwe module moet klein beginnen. Liever een smalle module met duidelijke grenzen dan een tweede groot dashboardbestand.

## Werkafspraak voor agents

Voor toekomstige agents geldt:

- Lees deze gids voordat je het coldcalling-dashboard verder opsplitst.
- Houd wijzigingen klein en gericht.
- Breid contracttests mee uit wanneer je een nieuwe grens introduceert.
- Laat `coldcalling-dashboard.js` langzaam kleiner worden, maar forceer geen grote refactor in één keer.


## Volgende opsplitsfase: renderveiligheid eerst

De volgende opsplitsfase moet starten bij kleine renderhelpers en configuratie, niet bij stateful flow-control. Dit sluit aan op [docs/frontend-dom-safety-contract.md](frontend-dom-safety-contract.md).

Voor nieuwe of verplaatste renderlogica geldt:

- Gebruik `textContent` of DOM-node builders voor dynamische tekst.
- Gebruik `escapeHtml` wanneer bestaande template-rendering nog nodig is.
- Introduceer geen nieuwe ruwe `innerHTML`-rendering met lead-, klant-, call-, AI- of API-data.
- Houd nieuwe modules klein, gericht en zonder eigen browser storage.
- Breid `test/contracts/coldcalling-dashboard-modules.test.js` uit zodra een nieuwe modulegrens ontstaat.

Aanbevolen volgorde voor `assets/coldcalling-dashboard.js`:

1. Verplaats kleine, pure renderformatters naar `assets/coldcalling-dashboard-core.js`.
2. Verplaats vaste labels of configuratie naar `assets/coldcalling-dashboard-config.js`.
3. Maak pas daarna nieuwe gerichte modules voor modals, lead-database rendering of dispatch UI.
4. Laat `assets/coldcalling-dashboard.js` voorlopig de wiring-laag blijven.
