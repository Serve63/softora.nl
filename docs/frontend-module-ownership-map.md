# Frontend module ownership map

Deze kaart maakt de huidige frontend-grenzen expliciet. Het doel is simpel: toekomstige wijzigingen moeten snel kunnen zien waar logica thuishoort, zonder opnieuw grote inline scripts of parallelle helperpaden te maken.

## Basisregel

HTML-pagina's blijven zoveel mogelijk verantwoordelijk voor markup, data-attributen en initialisatie. Herbruikbare of testbare logica hoort in `assets/*-core.js` of in een bestaande gespecialiseerde asset-module.

## Huidige module-eigenaren

| Gebied | Eigenaarbestand | Rol | Gebruikt door |
| --- | --- | --- | --- |
| Coldcalling dashboard core | `assets/coldcalling-dashboard-core.js` | Pure helpers, statusnormalisatie en gedeelde dashboardlogica. | `assets/coldcalling-dashboard.js` |
| Coldcalling configuratie | `assets/coldcalling-dashboard-config.js` | Campagne- en providerconfiguratie zonder pagina-wiring. | Leadgenerator- en coldmailingpagina's |
| Coldcalling modi | `assets/coldcalling-dashboard-modes.js` | Paginaspecifieke modusselectie en featuregedrag. | Leadgenerator- en coldmailingpagina's |
| Coldcalling wiring | `assets/coldcalling-dashboard.js` | DOM-koppeling, event handlers en runtime-integratie. | Publieke en premium leadgenerator/coldmailingpagina's |
| Premium klanten core | `assets/premium-customers-core.js` | Pure klanten-, order- en renderhelpers. | `premium-klanten.html`, `premium-database.html` |
| Premium dashboard core | `assets/premium-dashboard-core.js` | Pure dashboardhelpers voor labels, metrics en presentatie. | `premium-personeel-dashboard.html` |

## Wanneer je nieuwe frontendlogica toevoegt

1. Zet pure helpers eerst in een bestaand `assets/*-core.js` bestand als het domein al bestaat.
2. Maak alleen een nieuw core-bestand wanneer het domein duidelijk apart is en door meer dan een pagina gebruikt kan worden.
3. Laat HTML geen nieuwe grote inline scripts krijgen; HTML mag hooguit initialiseren en bestaande modules aanroepen.
4. Voeg of update een contracttest die bewaakt dat de pagina de juiste asset gebruikt.
5. Werk deze kaart bij wanneer een nieuw frontend-domein of nieuw core-bestand ontstaat.

## Signalen dat een pagina opnieuw opgeschoond moet worden

- De inline scriptsectie groeit door met helpers die geen directe DOM-wiring zijn.
- Twee pagina's hebben bijna dezelfde formatter, parser of renderer.
- Een test moet door HTML-tekst heen zoeken naar businesslogica.
- Een helper is lastig los te testen omdat hij in een pagina verstopt zit.

## Niet doen

- Geen nieuwe businesshelpers direct in HTML plakken.
- Geen tweede opslag- of statepad introduceren omdat dat sneller lijkt.
- Geen bestaande response-shapes aanpassen om frontend-opruiming makkelijker te maken.
- Geen modulegrenzen verzwakken zonder contracttest en roadmap-notitie.
