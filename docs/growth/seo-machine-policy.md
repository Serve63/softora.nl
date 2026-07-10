# Softora SEO Machine Policy

Dit document maakt de dagelijkse SEO-automation meetbaar en herhaalbaar. De automation leest daarnaast altijd `AGENTS.md`; bij conflict zijn de strengste veiligheidsregels leidend.

## Doelvolgorde

Optimaliseer in deze volgorde:

1. gekwalificeerde organische leads en organische pipeline zodra betrouwbare attributie beschikbaar is;
2. non-branded klikken naar money pages;
3. relevante non-branded vertoningen en posities;
4. totale organische klikken.

De ambitie van 100.000 klikken per maand is richtinggevend, geen dagelijkse optimalisatie-KPI en nooit een garantie. Informatief verkeer zonder aantoonbare relatie met Softora's diensten krijgt geen voorrang op commercieel relevant verkeer.

## Runritme

### Dagelijks

- Controleer Git/GSC/productie-preflight en open SEO-PR's.
- Controleer alleen kritieke live signalen: productiecommit, robots, sitemap en de routes die door recente experimenten geraakt zijn.
- Kies maximaal een nieuwe actie op basis van de geprioriteerde GSC-kansen en het experimentregister.
- Maak geen contentwijziging wanneer een operationele P0 eerst opgelost moet worden.

### Wekelijks

- Draai de brede publieke link-, metadata-, visual- en CTA-controles.
- Vergelijk 7, 28 en 90 dagen voor non-branded verkeer, money pages en queryclusters.
- Beoordeel welke experimenten voldoende data hebben en plan het volgende cluster.

### Maandelijks

- Controleer cannibalisatie, overlap, orphan pages, stale content en indexatie-dekking.
- Beoordeel echte trust-, case-, review-, citation- en authority-kansen.
- Verbeter, consolideer, redirect of noindex alleen met aantoonbaar bewijs.

Vijf publicaties per week is een plafond, geen quotum. Nul nieuwe publicaties is correct wanneer refreshes, indexatie, conversie of authority meer waarde leveren.

## Opportunity Ranking

Gebruik `queries.prioritized` uit `scripts/seo-agent-report.js` als eerste datagedreven kandidatenlijst. Deze queue:

- sluit branded queries uit van de groeiprioritering;
- neemt ook 0% CTR mee;
- voegt overlappende CTR- en striking-distance-acties samen;
- weegt verwachte klikwinst, business fit, positiehefboom en dataconfidence;
- geeft positie 5-20 meer hefboom dan grote aantallen vertoningen ver buiten pagina een.
- houdt alleen commercieel passende queries op positie 20-40 als lagere-prioriteit `emerging` kans vast wanneer er nog geen top-20-kans is.

De score is een beslissingshulpmiddel, geen bewijs van toekomstige groei. Controleer voor de uiteindelijke keuze altijd intentmatch, bestaande paginakwaliteit, recente experimenten, cannibalisatie en veilige uitvoerbaarheid.

## Scorecard

Iedere score bevat `score`, `confidence` en een korte `evidence`-regel. Gebruik `n/a` wanneer bewijs ontbreekt; verzin geen cijfer.

| Onderdeel | Objectieve basis |
| --- | --- |
| Technische crawlbaarheid | Start op 10; -5 als robots publieke crawl blokkeert, -3 bij onbereikbare/lege sitemap, -2 bij kritieke canonical- of statusfouten. |
| Indexatie/discovery | `10 x geindexeerde geinspecteerde prioriteits-URL's / geinspecteerde prioriteits-URL's`; `n/a` zonder inspecties. |
| GSC performance | Start op 5; gebruik non-branded 28-daagse clicks, CTR, top-20 dekking en kritieke dalingen voor aantoonbare plus- of minpunten. Lage volumes krijgen lage confidence. |
| Money-page intent depth | Een punt per bewezen onderdeel: unieke intent, H1/H2, kosten, doorlooptijd, koppelingen, veiligheid, bewijs, FAQ, interne links en duidelijke CTA. |
| Support-content uniqueness | Meet unieke zoekintentie, eigen voorbeelden, overlap/cannibalisatie, nuttige diepte en natuurlijke money-page links op een benoemde steekproef. |
| Internal links | Meet orphan pages, klikdiepte, relevante inkomende money-page links en natuurlijke context; geen losse SEO-balken als bewijs. |
| Visuals | Meet betekenis, eigen karakter, alt-tekst, vaste dimensies en bestandsgrootte op de gecontroleerde URL's. |
| Trust/entity | Alleen geverifieerde NAP/KvK/legal/entity-data, echt bewijs en echte profielen tellen mee. |
| Page experience | Gebruik meetbare mobiele layout, overflow, beeldgewicht en Lighthouse/CrUX waar beschikbaar. |
| AI-search readiness | Meet normale SEO-signalen: heldere antwoorden, buyer questions, voorbeelden, betrouwbare entity-data en correcte structured data. |

## Experimentregister

Schrijf iedere live wijziging in de vaste automation memory met dit compacte schema:

```text
Experiment: <URL of cluster>
Hypothese: <verwachte verandering en waarom>
Baseline: <live-datum, commit, 28d non-brand clicks/impressions/CTR/position>
Wijziging: <korte omschrijving en PR>
Review: <14d datum>, <28d datum>, <56d datum>
Status: active | won | neutral | lost | insufficient-data
Besluit: hold | iterate | expand | revert
```

- Herschrijf dezelfde pagina normaal niet opnieuw binnen 28 dagen.
- Een technische fout, verkeerde claim, indexatieblokkade of duidelijke query/page-mismatch mag de cooldown doorbreken.
- Trek na een dag geen rankingconclusies; 14 dagen is een vroeg signaal, 28 dagen richting en 56 dagen een bruikbaarder oordeel.
- Schrijf na iedere run een memory-entry, ook bij een no-op of fout, zodat blockers en reviewdatums niet verdwijnen.

## Operationele P0

GSC OAuth, live-versiecontrole, sitemap/indexatieblokkades en ontbrekende verplichte tooling zijn P0 wanneer ze betrouwbare besluitvorming blokkeren.

- Eerste fout: diagnoseer, leg exacte oorzaak vast en probeer de veilige reparatie.
- Tweede opeenvolgende run met dezelfde P0: maak geen content-PR; repareer de operatie of rapporteer exact welke menselijke actie, eigenaar en credential/scope/configuratie nodig is.
- Print nooit secrets en plaats ze nooit in tracked files.

## Menselijk Bewijs

De automation mag een bewijsqueue maken voor echte cases, reviews, partnerships, lokale vermeldingen en leadkwaliteit. Publicatie of externe outreach vereist geverifieerde informatie en de normale goedkeuring; de automation verzint nooit klanten, resultaten, profielen, credentials of citaties.
