# Softora SEO Machine Quality Gates

Deze poorten voorkomen dat productiesnelheid wordt verward met organische groei. Google-indexatie, unieke informatiewinst en gekwalificeerde impact gaan voor pagina- of woordenaantallen.

## Afdwingbare Waarheid

- Propertytotalen komen uit een GSC-query zonder dimensies.
- Zichtbare queryregels worden apart verdeeld in branded en non-branded; het verschil met propertytotalen heet `unclassified` en krijgt geen verzonnen merklabel.
- Sitemapcontrole bewaart `lastSubmitted`, `lastDownloaded`, errors, warnings en ingediende aantallen.
- Een publicatie kan afzonderlijk `live`, `discovered`, `indexed`, `impressing`, `clicking` en `converting` zijn.
- Alleen een live 200-HTML-route op de actuele productiecommit met self-canonical, indexeerbaarheid, sitemapvermelding en correcte publicatiedatum telt als live publicatie.

## Machine-Toestanden

De dagelijkse `seo:cadence:check` beslist in deze volgorde: `operations_p0`, `data_degraded`, `indexation_recovery`, `quality_recovery`, `growth`, `scale`. Iedere succesvolle run levert een publieke verbetering. Daarnaast geldt een harde rollende nieuwe-URL-vloer: 0 in `operations_p0`, 1 in `data_degraded`, 2 in `indexation_recovery`, 2 in `quality_recovery`, 3 in `growth` en 5 in `scale`.

In `indexation_recovery` blijven contextuele links, discovery, consolidatie, canonicalherstel en versterking van bestaande pagina's belangrijk. In `quality_recovery` worden automatische opvultekst, overlap en herhaalde alinea's vervangen door pagina-eigen informatie. Geen van beide hersteltoestanden mag eindeloos alle nieuwe publicaties verdringen: als de vloer is gemist, wordt de volgende veilige publieke actie een nieuwe URL.

De live ledger rapporteert `newUrls`, `substantialRefreshes` en `otherGrowthActions` apart. Alleen `newUrls` telt voor de vloer. Een refresh kan wel meetellen voor het totale ritme, maar nooit doen alsof er een nieuwe indexeerbare ingang is gemaakt.

## Nieuwe Content: Quality Version 2

Nieuwe en substantieel vernieuwde content gebruikt `qualityVersion: 2` en voldoet aan alle volgende punten:

- Unieke intent, koperstaak, funnelstap, money page en clusterrol zijn vooraf vastgelegd.
- `informationGain` beschrijft concreet welke eigen analyse, beslismethode, praktijkkennis of bronduiding nergens anders op Softora staat.
- Controleerbare bronnen ondersteunen actuele of externe feiten; een intern inventarisgat alleen is onvoldoende vraagbewijs.
- De drie dichtstbijzijnde Softora-URL's zijn vergeleken met een expliciet `distinct`, `merge` of `reject`-besluit.
- Hoofdsecties zijn pagina-eigen. Quality version 2 krijgt geen generieke verrijkingssecties en geen automatische FAQ.
- FAQ wordt alleen toegevoegd wanneer echte kopersvragen nuttig worden beantwoord; FAQ-schema volgt alleen zichtbare FAQ-inhoud.
- Vaste woordenaantallen zijn geen kwaliteitsbewijs. De pagina moet de taak volledig, praktisch en zonder opvulling beantwoorden.
- De hoofdtekst bevat minimaal twee natuurlijke contextuele links, waaronder een logische route naar de money page.
- Nieuwe of substantieel vernieuwde blogs gebruiken exact twee nuttige eigen Softora-visuals met beschrijvende bestandsnaam, betekenisvolle alt, vaste dimensies en gecontroleerd gewicht.
- Geen stockfoto's, placeholders, generieke kantoorbeelden of decoratieve filler.
- Auteur, reviewer, claims, CTA, mobiel gedrag, schema en publieke/private scheiding zijn groen.

## Corpusoriginaliteit

De machine meet op de volledige contentverzameling:

- gemiddeld aandeel automatisch toegevoegde hoofdcontent, met interne herstelgrens 35%;
- aandeel herhaalde hoofdparagrafen, met interne herstelgrens 10%;
- lexicale Jaccard-overlap van het dichtstbijzijnde paginapaar, met interne herstelgrens 0,72.

Dit zijn interne alarmsignalen, geen Google-rankingfactoren. Overschrijding zet de machine in `quality_recovery`; zij bewijst niet automatisch dat een pagina spam is.

## Indexatie En Aanvraagbewijs

- `seo:indexation:report` inspecteert money pages en recente contentcohorten via URL Inspection.
- Voor iedere nieuwe live niet-geindexeerde URL wordt via Search Console eenmaal indexering aangevraagd wanneer browser en quota beschikbaar zijn.
- De automation memory bewaart `already_indexed`, `requested`, `quota_blocked`, `browser_blocked` of `failed`, plus datum en bewijs.
- Een geblokkeerde of mislukte aanvraag blijft schuld voor de volgende run.
- Herhaal een aanvraag niet zonder materiele wijziging of gedocumenteerd vervolgvenster.
- Gebruik de Google Indexing API nooit voor gewone blogs, kennisbank-, vergelijkings- of landingspagina's.

## Claims, Conversie En Veiligheid

- Geen ranking-, lead- of omzetgaranties, absolute security/uptimeclaims, onbewezen certificeringen, marktleiderschap, klantenaantallen of autonome-AI-beloften.
- Publieke identiteit blijft Softora/Martijn waar nodig; noem Serve Creusen niet op frontstage SEO-pagina's.
- Klant-CTA's gebruiken `https://wa.me/31643262792` zonder vooraf ingevulde tekst en hebben meetlabels.
- Homepage-content en high-risk lead/auth/agenda/coldcalling blijven buiten automatische SEO-wijzigingen.
- Doe geen backlink-outreach; gastblogs, directories, linkruil, betaalde links en andere off-site linkbuilding blijven volledig buiten scope.

## Definition Of Done

- `npm run seo:backlog:check` is groen.
- `npm run seo:publications:report -- --json` geeft een betrouwbare live ledger.
- `npm run seo:indexation:report -- --json` geeft verse inspectiestatus of expliciet `data_degraded`.
- `npm run seo:cadence:check` noemt toestand, verplichte actie, request evidence debt, nieuwe-URL-vloer, achterstand en maximum nieuwe URL's.
- Gerichte tests en `npm run verify:critical` zijn groen.
- PR, merge, productiecommit en live verificatie zijn aantoonbaar; merged-but-not-live telt nooit als publicatie.
