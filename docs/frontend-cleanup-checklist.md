# Frontend cleanup checklist

Deze checklist is bedoeld voor elke wijziging aan grote HTML-pagina's, dashboard-scripts en gedeelde frontend-assets. Het doel is om de frontend stap voor stap kleiner, duidelijker en professioneler te maken zonder regressies te veroorzaken.

## Basisprincipe

Maak elke wijziging kleiner dan je eigenlijk zou willen. Een kleine, goed geteste verbetering is waardevoller dan een grote refactor die moeilijk te controleren is.

## Voor je begint

- Bepaal welke pagina of flow geraakt wordt.
- Controleer of de wijziging bij een bestaand dashboard-script, gedeeld asset of nieuw klein modulebestand hoort.
- Vermijd nieuwe inline scripts in HTML.
- Vermijd nieuwe opslagkeys zonder bestaande namespace en contracttest.
- Behandel premium sidebar, agenda, leads, call-insights en auth als extra gevoelig.

## Tijdens het wijzigen

- Verplaats herbruikbare helpers uit HTML of grote scripts naar een gericht assetbestand.
- Houd DOM-code gescheiden van pure helpers wanneer dat praktisch kan.
- Geef functies namen die het gedrag uitleggen zonder extra context.
- Laat bestaande browser-globals stabiel, tenzij er bewust een compatibele overgang is.
- Laat bestaande response-shapes en data-attributen stabiel.
- Voeg geen nieuwe parallelle opslag of tijdelijke waarheid toe.

## Wanneer je een nieuw frontendbestand maakt

- Kies een naam op basis van verantwoordelijkheid, niet op basis van de pagina alleen.
- Begin klein en exporteer alleen wat echt nodig is.
- Documenteer impliciete browser-afhankelijkheden in de bestandsstructuur of testnaam.
- Voeg een contracttest toe voor public exports, globale namen of scriptvolgorde.

## Wanneer je HTML aanraakt

- Gebruik HTML vooral als structuur en laadpunt.
- Plaats geen nieuwe grote logica in `<script>` blokken.
- Houd scriptvolgorde expliciet en getest wanneer meerdere assets samenwerken.
- Bump assetversies wanneer browsercache anders oud gedrag kan vasthouden.

## Wanneer je styling aanraakt

- Hergebruik bestaande designvariabelen en componentpatronen.
- Vermijd eenmalige uitzonderingen als een gedeelde class of component logischer is.
- Controleer mobile gedrag in dezelfde wijziging wanneer layout geraakt wordt.
- Houd premium shell/sidebar styling extra stabiel.

## Testverwachting

Een frontend cleanup is pas veilig als de juiste beschermlaag meebeweegt:

- Scriptvolgorde of assetversies gewijzigd: update gerichte contract- of smoke-tests.
- Nieuwe modulegrens toegevoegd: test public exports en browser-global compatibiliteit.
- Premium sidebar geraakt: update de premium sidebar scope-test.
- Guardrails of checks geraakt: update de agent guardrails contracttest.
- Productiegedrag gewijzigd: voeg of update een contracttest of smoke-test.

## Niet doen

- Geen `.only`, `.skip` of `todo` in vaste testbestanden.
- Geen guardrail-bypass in CI.
- Geen nieuwe grote inline scripts.
- Geen nieuwe ad-hoc frontendmappen zonder duidelijke reden.
- Geen brede refactors waarbij meerdere kritieke flows tegelijk veranderen.

## Definitie van netjes

Een wijziging voelt professioneel wanneer:

- de verantwoordelijkheid van elk bestand duidelijker is dan ervoor;
- een volgende ontwikkelaar sneller begrijpt waar code hoort;
- tests het nieuwe contract bewaken;
- de app hetzelfde blijft werken voor gebruikers;
- het totaalplaatje kleiner, voorspelbaarder en makkelijker te onderhouden wordt.


## Module ownership map

Gebruik [frontend-module-ownership-map.md](frontend-module-ownership-map.md) als snelle kaart voor bestaande frontend-modulegrenzen. Werk die kaart bij wanneer een nieuw `assets/*-core.js` bestand ontstaat of wanneer een HTML-pagina een bestaand core-bestand gaat gebruiken.
