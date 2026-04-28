# Premium frontend modulegrenzen

Deze gids legt vast hoe premium frontend-pagina's verder opgesplitst moeten worden. De directe aanleiding is de opschoning van klanten-, database- en dashboardhelpers naar kleine core-assets.

## Waarom dit belangrijk is

Premium HTML-pagina's zijn historisch groot geworden. Ze bevatten structuur, styling, bootstrapdata, DOM-wiring, pure helpers en soms businessregels door elkaar. Dat werkt, maar maakt elke volgende wijziging kwetsbaarder.

De kwaliteitsrichting is daarom:

- HTML blijft vooral structuur, styling en scriptvolgorde.
- Pure helpers gaan naar kleine `assets/*-core.js` modules.
- Rendering en DOM-gedrag mogen in paginabestanden blijven totdat er een duidelijke modulegrens ontstaat.
- Elke nieuwe modulegrens krijgt een contracttest.

## Huidige premium core-assets

- `assets/premium-customers-core.js`: gedeelde klantenhelpers voor service-labels, verantwoordelijke normalisatie, lifecycle-statussen en veilige veldnormalisatie.
- `assets/premium-dashboard-core.js`: gedeelde dashboardhelpers voor HTML escaping, datum/tijd-normalisatie, chunked state reads en eenvoudige dashboardformattering.

Deze modules zijn bewust klein. Ze moeten pure helpers bevatten en geen directe DOM-wiring, fetch-side-effects of modalgedrag.

## Beslisregel voor nieuwe premium frontendlogica

1. Is het een pure helper zonder DOM? Zet het in een bestaande of nieuwe `*-core.js` asset.
2. Is het een vaste key, scope of cacheversie? Zet het in een config-achtige asset zodra die grens bestaat.
3. Is het rendering van een specifiek schermdeel? Houd het tijdelijk bij de pagina of verplaats het naar een gerichte renderer-asset.
4. Is het event handling, modals of formuliergedrag? Splits pas af als het een duidelijke eigen verantwoordelijkheid heeft.
5. Is het premium shell/sidebar gedrag? Behandel het als beschermd en update de gerichte sidebar-contracttest.

## Wat niet meer terug mag groeien

- Geen nieuwe pure helperblokken in oversized premium HTML als een core-asset logischer is.
- Geen nieuwe lifecycle- of statusnormalisatie inline in HTML.
- Geen nieuwe verantwoordelijke/eigenaar-normalisatie dubbel in meerdere pagina's.
- Geen contracttests die eisen dat helpers inline in HTML staan.
- Geen groei van grote premium HTML-bestanden zonder opsplitsing of bewuste uitzondering.

## Contracttest-afspraak

Bij module-opruiming hoort het testcontract mee te verschuiven:

- Test pure helpergedrag in een core-test, bijvoorbeeld `test/contracts/premium-customers-core.test.js`.
- Test in de pagina alleen dat de juiste asset wordt geladen en gebruikt.
- Test geen interne implementatiedetails van HTML wanneer die helper naar een module is verhuisd.
- Houd assetversies expliciet als browsercache anders oud gedrag kan vasthouden.

## Volgende logische modulekandidaten

De beste volgende kandidaten voor verdere premium frontend-opruiming zijn:

- database foto-preview en fotokosten-rendering;
- klantenformulier-validatie;
- dashboard omzetgrafiek-formattering;
- bevestigingstaak-rendering;
- AI-management configuratiehelpers.

Pak deze niet allemaal tegelijk op. Kies steeds een kleine pure helpergroep, verplaats die naar een module, voeg contracttests toe en draai daarna `verify:critical`.

