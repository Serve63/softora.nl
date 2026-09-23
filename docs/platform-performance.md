# Websitebrede prestatiearchitectuur

## Gebruikerscontract

Een scherm is pas gereed wanneer alle voor dat scherm vereiste gegevens en beelden
beschikbaar zijn en de bijbehorende acties reageren. Een verdwenen loader, een lege
omhulling of alleen de eerste rijen bewijst geen volledige gereedheid.

Doel: een directe opening is volledig bruikbaar binnen 3000 ms onder vastgelegde
testcondities. Navigatie binnen het platform voelt onmiddellijk aan: een voorbereid
scherm is compleet binnen 100–300 ms, zonder zichtbaar laadscherm of gegevens die
later nog binnendruppelen. Meet vanaf de klik, vermeld voorbereidingstijd/verbruik
apart en test ook een koude directe URL. Dit zijn doelen, geen huidige resultaten.

De opdracht omvat het hele platform en de publieke website. De database en formele
repositories blijven de bron van waarheid. Gedeelde browserdata is afgeleide data.

## Verplichte richting voor nieuwe functionaliteit

- Ingelogde modules delen navigatie, sessieafbakening, gegevensverzoeken en versies.
- Een module krijgt prepare, mount, ready, update en dispose; timers, listeners en aanvragen
  hebben een eigenaar en worden bij verlaten opgeruimd.
- De gereedheidscontrole krijgt een begrensd tijdsbudget. De shell toont de nieuwe
  module pas als alle vereiste inhoud en bediening aantoonbaar klaar zijn; een
  onvolledig scherm blijft verborgen en de bestaande module blijft zichtbaar.
- Ook een routewissel binnen dezelfde module bouwt met `update` een nieuwe verborgen
  root op. De zichtbare root mag tijdens die voorbereiding niet worden gewijzigd.
- Prepare voert uitsluitend geregistreerde reads uit, met begrensde bytes, aanvragen
  en geheugen; nooit provider-sync, mails, uploads of betaalde generatie.
- Expliciete wijzigingen maken alle betrokken leesresultaten ongeldig. Een eerder
  begonnen read mag een nieuw resultaat niet overschrijven of als actueel teruggeven.
- Sessiewissel/uitloggen wist gedeelde data. Browser-terug, directe links, rechten,
  snelle navigatie en niet-opgeslagen formulieren blijven correct werken.
- Publieke inhoud blijft direct als indexeerbare HTML leverbaar met passend CDN-beleid.
- Geïsoleerde beveiligde schermen behouden hun isolatie, waaronder de wachtwoordenkluis.
- Nieuwe abonnementen, compute-upgrades, betaalde API's, runners en extra gebruik
  buiten bestaande betaalde ruimte zijn niet toegestaan zonder aparte toestemming.

## Eerste geïmplementeerde beschermingslaag

`server/config/platform-pages.json` registreert de 77 bestaande rootdocumenten als
`legacy-document`. Geen daarvan is hiermee gecertificeerd als snel of gemigreerd.
`server/config/platform-navigation.js` levert de aliases die de echte page router
gebruikt. `check:platform-architecture` vergelijkt de registratie met dezelfde
bestandsinventaris als de server: ook een nieuw HTML-bestand zonder handmatige
routerwijziging wordt zo gedetecteerd.

De check blokkeert ontbrekende registratie, nieuwe legacy-uitzonderingen, terugval
na migratie, ontbrekende contracts en het vergroten van gereedheidsbudgetten.
De legacy-baseline komt uit de gezamenlijke basis met origin/main, in GitHub uit
de eerste ouder uit de Git-headers van de exact gecontroleerde GitHub-mergecommit.
Bij een shallow checkout haalt de check alleen die basiscommit op via bestaande
Git-leestoegang. Een eigen commit legitimeert dus geen
nieuwe uitzondering. Bij de eerste introductie tellen alleen documenten op de basis.
De gate draait in verify:critical en de aansluiting wordt beschermd door quality-lock.

De bestaande gedeelde UI-state-client coördineert nu ook reads tijdens writes,
voorkomt terugschrijven van achterhaalde antwoorden en wist zijn cache op pagehide.
Dit werkt binnen het huidige document. Het is nog geen blijvende applicatieshell,
geen cross-tab-sessieprotocol en geen volledige vervanging voor domein-readmodels.

`assets/premium-application-runtime.js` bevat een geteste modulelevenscyclus voor
geregistreerde reads, begrensde voorbereiding, montage, gereedheidscontrole, updates,
formulierblokkades en sessiegebonden cache wissen. `assets/premium-application-host.js`
bouwt een volgend scherm verborgen op en houdt het huidige scherm zichtbaar tot de
nieuwe module gereed is. `assets/premium-application-navigation.js` bevat een
geteste router voor geregistreerde routes, browsergeschiedenis en navigatieblokkades.
De twee kernen zijn nog niet door Dashboard of Opdrachten geladen. Die routes blijven
`legacy-document` tot de blijvende shell en complete browsergedrag bewezen zijn. Een
wijziging van alleen metadata mag een scherm niet als gemigreerd bestempelen.

`assets/premium-screen-readiness.js` legt daarnaast een expliciet gereedmoment vast.
Dashboard en Opdrachten melden pas `ready` als hun volledige vereiste data en
bediening beschikbaar zijn en de documentresources, gebruikte fonts en opgegeven
afbeeldingen klaar zijn. De gedeelde personeelszijbalk moet eveneens zijn afgerond;
een vastgelopen zijbalk kan geen `ready` produceren. `performance.mark('softora:screen-ready')` en
`data-softora-screen-ready-ms` maken het moment meetbaar. Een mislukte datastroom blijft
apart herkenbaar als `degraded`; waar een loader aanwezig is, verdwijnt die pas nadat
de foutweergave beschikbaar is. Opdrachten toont tijdens een koude hydratie nog
statische nullen. De gereedheidsmarkering lost die zichtbare tussenstand niet op;
daarvoor is de blijvende shell nodig. Deze stap bewijst evenmin dat alle routes de
3-secondennorm halen.

## Nog te implementeren en te bewijzen

1. Volledige nulmeting per hoofdmodule en inhoudstype; data, beelden, acties en
   geldigheid concreet benoemen. De registry dekt rootdocumenten en pretty aliases.
   Dynamisch gegenereerde SEO-collecties/artikelen, gepubliceerde klantlinks en
   persoonlijke sites houden hun bestaande routetests; volledige runtime-inventaris
   en prestatiedekking van die routefamilies volgen nog.
2. De lifecycle- en navigatiekernen met een blijvende shell koppelen voor Dashboard
   en Opdrachten, daarna Klanten. De broncode moet eerst uit de grote
   pagina-initialisaties worden losgemaakt; geen willekeurige HTML-injectie of
   verborgen frames als prefetch.
3. Gedeelde versiegebonden readmodels, gelijktijdige reads, mutatie-invalidation,
   sessiewissels, dirty-form navigatie en begrensde voorbereiding ook met echte
   browseruitvoering bewijzen. Lever dan het modulesjabloon/aanmaakscript.
4. Mailsysteem volledig aansluiten, vervolgens Mailbox, Agenda, Lead Radar,
   instellingen en overige modules. Miniaturen vooraf op maat maken en netwerk-
   en opslagbudgetten meten. Publieke pagina's en assets apart controleren.
5. Negatieve gedragstests voor onvolledige data/afbeeldingen, verborgen schrijfacties,
   ontbrekende cleanup en omzeilde gedeelde clients toevoegen. De huidige structurele
   gate kan deze uitvoeringsfouten nog niet detecteren.
6. Complete navigatieketens meten, desktop/mobiel en koude/warme scenario's; pas
   daarna de gemigreerde status verlenen en route-specifiek productie accepteren.

Grote wijzigingen blijven kleine, omkeerbare PR's met de bestaande kwaliteitschecks.
Geen bypass van verify:critical, geen uitbreiding van de legacy-lijst om een nieuwe
feature makkelijker toe te voegen, en geen claim dat de 3-secondennorm al gehaald is.
