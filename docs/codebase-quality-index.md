# Codebase quality index

Deze index is een praktisch stuurdocument voor de kwaliteit van de Softora-codebase. Het is geen eindrapport, maar een levend overzicht dat helpt bepalen welke verbeteringen eerst moeten gebeuren om richting een 100/100 codebase te groeien.

## Scoremodel

Gebruik deze schaal per gebied:

- `5`: professioneel, klein, duidelijk, getest en moeilijk per ongeluk te breken.
- `4`: sterk, maar nog met enkele bekende onderhoudspunten.
- `3`: werkbaar, maar gevoelig voor rommel of regressies bij groei.
- `2`: kwetsbaar, te groot of onvoldoende beschermd.
- `1`: hoog risico, onduidelijk of nauwelijks bewaakt.

Een gebied krijgt pas een hogere score als de structuur, documentatie en tests meebewegen. Alleen "het werkt" is dus niet genoeg.

## Huidige kwaliteitsfoto

| Gebied | Indicatie | Waarom |
| --- | ---: | --- |
| Kritieke checks | 5 | `verify:critical` bewaakt guardrails, repo-hygiene, quality lock, contracttests, smoketests en secrets. |
| Backend guardrails | 4 | Er zijn sterke grenzen voor servergroei, high-risk paden en kwaliteitschecks. Verdere winst zit in nog kleinere domeinmodules. |
| Contracttests | 4 | De dekking is breed en bewaakt veel regressies. Volgende winst zit in meer expliciete frontend-modulecontracten per nieuw opgesplitst gebied. |
| Smoke-tests | 4 | Belangrijke pagina's worden geraakt. Volgende stap is gericht uitbreiden wanneer nieuwe frontendflows worden opgesplitst. |
| Coldcalling dashboard structuur | 3.5 | De eerste modules zijn afgesplitst en beschermd. Het hoofdbestand kan stap voor stap verder kleiner worden. |
| Frontend HTML omvang | 3 | Er zijn guardrails en cleanup-afspraken, maar grote pagina's blijven een structurele onderhoudsrisico. |
| Documentatie voor agents | 4 | Roadmap, modulegrenzen en cleanup checklist geven richting. Verdere winst zit in domeinspecifieke gidsen per groot onderdeel. |
| Security hygiene | 4 | Secrets-check en request/security-tests zijn aanwezig. Nieuwe admin/debug routes moeten strikt achter bestaande bescherming blijven. |
| Data ownership | 3.5 | De richting is duidelijk: database en formele repositories zijn leidend. Legacy in-memory state moet niet verder groeien. |

## Belangrijkste verbeterhefboom

De grootste winst zit voorlopig niet in "meer features", maar in gecontroleerd kleiner maken van grote frontend- en runtimebestanden.

Prioriteit:

1. Grote frontendbestanden stap voor stap opsplitsen.
2. Elke nieuwe modulegrens direct contractueel vastleggen.
3. Legacy state niet uitbreiden.
4. Kritieke flows alleen klein en testgedreven aanpassen.
5. Documentatie kort houden, maar precies genoeg om agents op koers te houden.

## Wanneer de score omhoog mag

Een gebied mag pas worden opgewaardeerd als:

- de verantwoordelijkheid duidelijker is dan ervoor;
- het aantal verborgen afhankelijkheden afneemt;
- er een test of guardrail is die de nieuwe grens bewaakt;
- de wijziging door `verify:critical` komt;
- een volgende ontwikkelaar sneller begrijpt waar nieuwe code hoort.

## Wanneer de score omlaag moet

Verlaag de score als:

- een bestand groter of belangrijker wordt zonder nieuwe grens;
- productiegedrag verandert zonder test;
- HTML opnieuw meer inline logica krijgt;
- storage keys of globals ongecontroleerd bijkomen;
- guardrails, CI of kwaliteitschecks worden verzwakt;
- legacy in-memory state als nieuwe waarheid wordt gebruikt.

## Eerstvolgende aanbevolen stappen

De volgende stappen geven de meeste kwaliteitswinst met beperkt risico:

1. Kies een tweede frontendgebied met veel inline of dashboardlogica.
2. Maak alleen pure helpers of configuratie los, geen brede gedragsrefactor.
3. Voeg direct een contracttest toe voor de nieuwe grens.
4. Werk de roadmap bij met wat is afgesplitst en waarom.
5. Draai `verify:critical` als afsluiting.

Dit patroon is bewust herhaalbaar. Kleine professionele stappen stapelen beter dan een grote risicovolle schoonmaak.

