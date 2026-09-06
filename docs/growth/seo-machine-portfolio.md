# Een SEO-automation voor tien sites

De bestaande `softora-seo-actiemachine` verzorgt Softora en de negen academies uit `seo-machine-sites.json`. Zij blijft dagelijks om 08:15 in dezelfde task draaien. Een ronde omvat alle tien sites, geen rotatie waarbij iedere site maar eens per tien dagen aan de beurt komt. Werk achtereenvolgens aan iedere site. Een onderbroken ronde hervat de nog openstaande site en resterende wachtrij; opnieuw beginnen wist geen werk. Er is geen garantie dat tien complete verbeteringen binnen een kalenderdag lukken.

## Besturing en bewijs

Voer de CLI uit vanuit de actuele automationcheckout van Softora. `inspect` is alleen-lezen; `init` registreert de task zonder SEO-invocation, publicatie of tellerverhoging. Tijdens het eenmalige installeren worden alleen `inspect` en `init` gebruikt.

```text
node scripts/seo-machine-portfolio.js inspect
node scripts/seo-machine-portfolio.js init --thread <bestaande-task>
node scripts/seo-machine-portfolio.js begin --thread <bestaande-task> --invocation-at <heartbeat-UTC-ISO>
node scripts/seo-machine-portfolio.js start-site --thread <bestaande-task> --site <volgende-id>
node scripts/seo-machine-portfolio.js record-site --thread <bestaande-task> --evidence <absoluut-bewijsbestand>
node scripts/seo-machine-portfolio.js record-softora --thread <bestaande-task> --evidence <absoluut-bewijsbestand>
node scripts/seo-machine-portfolio.js finish --thread <bestaande-task>
```

De wachtrij en afzonderlijke resultaten staan privé in `~/.codex/automations/softora-seo-actiemachine/portfolio/state.json`. Bewaar dossiers, brononderzoek, lokale backups, gewijzigde bestanden, testlogs en vervolgacties onder `portfolio/<site-id>/`; deze operationele gegevens horen niet in Git. Gebruik per site eigen backlog-, experiment-, onderzoeks- en meetbestanden. Alleen de onveranderlijke configuratie en besturingscode staan in de repo. De bestaande Softora-memory, teller, acht publicatiegates en reviewhistorie blijven de bron van waarheid voor Softora.

`begin` geeft `resume` bij onderbreking en `already_complete` wanneer de ronde voor die Amsterdamse kalenderdag al is afgerond. Start bij de eerste `pending` site. Een bestaande `activeSite` betekent eerst de daadwerkelijke branch, diff, eventuele publicatie en laatste controle reconciliëren. Maak dezelfde URL nooit opnieuw. `start-site` en `record-site` slaan de voortgang atomair op. Bij een onduidelijke tooluitkomst eerst `inspect`, nooit blind opnieuw uitvoeren. Een bestaande `.lock` blokkeert schrijvers; verwijder die pas na controle dat het geregistreerde proces niet meer actief is. Een defecte JSON-state wordt nooit vervangen door lege historie.

Iedere site krijgt één inhoudelijke hoofdverbetering plus een passende ondersteunende route. `blocked` vereist concreet bewijs en een volgende actie; ga daarna door naar de volgende site. De cyclus kan pas dicht als alle tien sites een resultaat of specifieke blokkade hebben. Schrijf bij compaction het bewijs en de exacte volgende opdracht weg en vervolg dezelfde cyclus. Sluit nooit alleen de Softora-stap af en vergeet daarna de academies.

## Tempo en onderzoeksbudget

Per site geldt maximaal één nieuwe URL per ronde, zeven nieuwe URL's per rollende zeven dagen en daarvan maximaal twee geldpagina's. Voor academies zijn geldpagina's de openbare e-book-, cursus- en andere echte aanbodpagina's. Er is geen verplicht publicatieminimum of vast aantal blogs: de best onderbouwde verbetering wint. De bestaande Softora-ledger blijft aanvullend haar eigen volledige weekhistorie handhaven. Lokaal voorbereide URL's en daadwerkelijk gepubliceerde URL's tellen afzonderlijk; lokaal werk mag nooit Google-publicatie of verkeer heten.

Ubersuggest wordt voor iedere geselecteerde site geraadpleegd wanneer beschikbaar en relevant, met eigen Nederlandse seeds, `locId=2528` en Dutch. Bewaar per site maximaal zes contentcalls en maximaal twee wekelijkse discoverycalls, met echte resultaten, datum, locale en beperkingen. Controleer gedeelde accountquota; bij quota/auth/providerfalen geldt die beperking voor verdere providercalls in de hele cyclus. Gebruik dan publieke Nederlandse zoekresultaten en eigen GSC waar beschikbaar. Geen aanschaf, opwaardering, API-key/PAYG, betaalde generatie of Qwen. Ubersuggest ondersteunt onderzoek; het bepaalt geen titel, selectie of publicatie. Houd per site bij wanneer de wekelijkse ontdekking voor het laatst werkelijk is uitgevoerd.

## Adapter Softora

Voer de volledige bestaande Softora-prompt en alle acht gates uit. Gebruik uitsluitend Softora's eigen GSC-property, huidige broncode en vaste operationele memory. Een bestaande onafgesloten invocation wordt met de bestaande recoveryprocedure gereconcilieerd. Een al afgeronde Softora-stap in de portfolio wordt overgeslagen, zonder nogmaals `start-run` of publicatie. `finish-run` sluit alleen de Softora-lifecycle; daarna volgt `record-softora` en de volgende portfoliosite.

Het detailbestand voor `record-softora` bevat `actionType`, `lane` en `nextAction`. De CLI leest zelf de verse Softora-finishreceipt en accepteert een live uitkomst alleen met alle acht bestaande gates. Schrijf academie-effecten, experimenten of Ubersuggestcalls nooit in Softora's teller, backlog, ledger, GSC-rapport of run-gates.

## Adapter academies: lokaal voorbereiden

Alle negen academies beginnen expliciet als `local_prelaunch`. Er is nog geen geconfigureerd publiek domein of GSC-property. Ontbrekende GSC is hier normaal: gebruik publiek zoekvraagonderzoek, Ubersuggest, aanwezige content en het eigen aanbod. Gebruik geen Softora-traffic als baseline voor een academie. Rankings, indexatie en omzet blijven onbekend. Nieuwe experimentreviews D14/D28/D56 beginnen pas bij een geverifieerde live publicatiedatum.

1. Lees de eigen projectinstructies, `package.json`, actuele Git-status, `app/blog-data.ts`, de artikelrenderer en bestaande openbare aanbodroutes. Respecteer `.openai/hosting.json` en toepasselijke Sites-skills. Bewaar bestaande merken, routes, cursussen, prijzen, checkout en het werk van andere taken. De academierepositories bevatten lopend lokaal werk: neem niet blind `origin/main` als bron en gooi geen wijzigingen weg. Softora's backendcommando's werken niet in deze Vinext/Next-projecten.
2. Maak vóór een gerichte wijziging een private kopie en hash van de betrokken niet-geheime bronbestanden. Verander alleen de gekozen scope en vergelijk voorafgaande met resulterende inhoud. Stage, commit of push nooit bestanden/hunks van andere taken. Bij een wijziging in een vooraf al gewijzigd bestand mag het lokale resultaat als controleerbare patch blijven staan. Voor een echte gelijktijdige wijziging of onveilige bronconflict: leg de siteblokkade vast en ga door naar de volgende site.
3. Onderhoud eigen briefs met doelgroep, zoekvraag, primaire bronnen, aanbodroute en drie dichtstbijzijnde bestaande artikelen; bouw de backlog op tot vijftien bruikbare onderwerpen per site. Kies een bruikbare verbetering: bestaande artikelen verdiepen, een ontbrekende unieke vraag beantwoorden, metadata herstellen of een onduidelijke artikel-naar-aanbodroute repareren. Geen alleen administratieve uitkomst als succesvol contentwerk, geen gekloonde tekst over alle negen merken en geen onderlinge linkfarm.
4. Schrijf voor de bezoeker en het specifieke onderwerp, met primaire bronnen en controleerbare claims. Gezondheid, zwangerschap, welzijn, dierverzorging en gevaarlijke klussen vragen passende betrouwbare vakbronnen en zo nodig aantoonbare deskundige beoordeling. Verzin geen auteur, medische werking, specialistische review, ervaringsclaim, testimonial of verkoopresultaat. Kies bij onvoldoende expertise een veiliger onderbouwd onderwerp. Maak nuttige eigen visuals als die helpen; voor nieuwe of grondig herwerkte blogs gelden dezelfde twee nuttige eigen visuals als kwaliteitsdoel, zonder stock- of betaalde fallback.
5. Toets in de eigen repo `npm run lint`, `npx --no-install tsc --noEmit` en `npm run build`; bewaar echte logs en exitcodes. Installeer uitsluitend ontbrekende normale projectafhankelijkheden, zonder node_modules te delen. Baselinefouten mogen niet worden weggefilterd. Herstel fouten binnen de gekozen scope of noteer `blocked` en ga verder.
6. Controleer de exacte lokale route en haar ondersteunende route in de interne browser op mobiel en desktop, met screenshots en echte visuele beoordeling. Test navigatie, inhoudsankers, FAQ en CTA tot het bestaande aanbod zonder betaling, echte lead of bericht te versturen. Bewaar bronhashes, HTTP-status, afbeeldingen, tekst, focus en ongehinderde bediening. Start zo nodig alleen de betreffende bestaande lokale server op de vastgelegde poort; controleer eerst de bestaande listener en projectbinding.
7. Registreer alleen met dit bewijs `local_ready`. Dit is bruikbaar lokaal SEO-werk, geen live publicatie. Iedere blokkade krijgt een concreet herstelpunt. Rond alle negen academies én Softora af voordat de portfolioronde dichtgaat.

Een `record-site` JSON bevat `siteId`, `outcome`, `evidence` (concreet, minstens twintig tekens), `nextAction` en bij succes: `actionType`, `lane`, `changedPath`, `verifiedOrigin`, `artifacts: [{path, sha256}]`, `checks: {lint, typecheck, build}` met per controle `exitCode: 0` en een absoluut `evidenceFile`, `research: {status, contentCalls, weeklyCalls, evidenceFile}`, `supportingAction: {path, verified: true}` en `pageExperience: {url, httpStatus: 200, mobile: true, desktop: true, interactionsPassed: true, mobileScreenshot, desktopScreenshot, review}`. Screenshots mogen concrete bestands- of toolreferenties zijn; booleans zijn de uitkomst van echte controles, geen te kopiëren standaardwaarden. De CLI controleert de verplichte onderdelen, aanwezige logbestanden en exacte bronhashes. Voor `blocked` volstaan identiteit, eerlijke reden en volgende actie.

## Aansluiten op publieke domeinen

Publiceer of registreer de negen lokale sites niet stilletjes. Zodra Servé een concreet domein/publicatie heeft geautoriseerd en bestaande hosting zonder ongeautoriseerde extra kosten beschikbaar is, verifieer bronrepo, deployment, eigen HTTPS-origin, indexeerbaarheid en GSC-property. Werk de canonieke siteconfig en tests gericht bij; pas daarna wordt `mode` voor die site `live`. Preview-URL's, localhost en opgegeven domeinwensen zijn geen bewijs van een geverifieerde productiesite. Verwijder geen bestaande noindex-beveiliging op previews.

Live academies gebruiken hun eigen GSC-data en indexatiebewijs, eigen D14/D28/D56-cohorten en hun bestaande beschermde releaseprocedure. Voeg aan het bewijs een volledige `liveCommit` en `liveProof: {versionMatches: true, canonical, indexable: true}` toe. Gebruik een sitegebonden read-only GSC-adapter; ontbreken van echte meetdata is onbekend, nooit nul. Een herkomst- of deployprobleem blokkeert alleen die site. De vier uitgesloten korte Softora-routes blijven uitsluitend binnen Softora uitgesloten; academie-aanbodroutes worden niet naar Softora doorgestuurd.

## Rapportage

Rapporteer één gezamenlijk resultaat met per site `live`, `lokaal klaar`, `geblokkeerd` of `nog open`, het werkelijke aantal nieuwe pagina's versus verbeteringen en de volgende actie. Houd verkeers-, lead- en omzetcijfers per domein gescheiden. Noem nooit een gedeeltelijke cyclus tien afgeronde sites. Wijzigingen in deze besturing gelden pas als de canonieke prompt, installatie-audit, portfolio-inspectie en contracttests samen kloppen.
