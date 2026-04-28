# Repository migration plan

Dit plan vertaalt de data ownership map naar concrete migratiestappen. Het doel is om de codebase gecontroleerd richting een professionelere database- en repositorylaag te brengen, zonder bestaande routes, response-shapes of kritieke flows te breken.

## Doelbeeld

Een volwassen repositorylaag betekent dat businessdata via expliciete server-side modules loopt. Frontendpagina's en routes hoeven dan niet te weten of data uit Supabase, een compat-snapshot of een tijdelijke fallback komt.

## Principes

1. Migreer per domein, niet alles tegelijk.
2. Houd bestaande responses stabiel totdat contracttests bewust worden aangepast.
3. Laat oude en nieuwe opslag tijdelijk naast elkaar bestaan met een expliciete compat-afspraak.
4. Maak repositories server-side; stuur geen service-role of auth-gevoelige opslagdetails naar de browser.
5. Voeg per migratiestap contracttests toe voor lezen, schrijven, merge-regels en fallbackgedrag.

## Gewenste repositorygrenzen

| Domein | Gewenste grens | Eerste veilige stap |
| --- | --- | --- |
| Premium klanten/database | `server/repositories/premium-customers-repository.js` | Server-side lees/schrijfadapter rond de bestaande UI-state scope maken. |
| Premium database foto's | `server/repositories/premium-customer-photos-repository.js` | Eigendom, limieten en retentie expliciet maken voordat opslag wordt verplaatst. |
| Agenda afspraken | `server/repositories/agenda-appointments-repository.js` | Bestaande agenda services eerst via een repository-interface laten lezen. |
| Leads en follow-ups | `server/repositories/leads-repository.js` | Lead-identiteit en dismiss-state scheiden van grote runtime snapshots. |
| Call updates | `server/repositories/call-updates-repository.js` | Dedicated `call_update:` rows achter een repository-interface zetten. |
| UI voorkeuren | `server/repositories/ui-preferences-repository.js` | Scopes classificeren als voorkeur in plaats van businessdatabase. |

## Fase 1: premium klanten/database

Premium klanten/database is de beste eerste migratiekandidaat omdat het domein zichtbaar belangrijk is, al tests heeft en nu nog te veel voelt als UI-state met databasefunctie.

1. Voeg een server-side repository-interface toe rond de bestaande scope. Eerste adapter: `server/repositories/premium-customers-repository.js`.
2. Laat bestaande routes en frontend dezelfde response-shapes houden.
3. Voeg contracttests toe voor statusnormalisatie, identiteit, upserts, bulk-upserts, statusupdates, verwijdering, gefilterd lezen, sortering, samenvattingen, sanitization, lees/schrijfgedrag en fallback bij Supabase-timeouts. Eerste contract: `test/contracts/premium-customers-repository.test.js`; lifecycle-statusnormalisatie, klant-identiteit, upsertgedrag, bulk-importgedrag, statusupdates, verwijdering, gefilterde en gesorteerde reads, status-samenvattingen en rijlimieten zitten nu in de repository-adapter.
4. Verplaats daarna pas opslagdetails naar een explicieter tabelmodel of dedicated rows.
5. Houd een compat-pad totdat de oude UI-state scope niet meer als primaire bron nodig is.

## Fase 2: agenda en leads

Agenda en leads zijn hoog-risico domeinen. Hier is de juiste aanpak kleiner en conservatiever.

1. Leg eerst repository-interfaces over bestaande services heen.
2. Verander geen response-shapes.
3. Verplaats alleen onderdelen die al dedicated state hebben, zoals dismissed leads of call updates.
4. Bewaak multi-instance gedrag met regressietests.
5. Verklein de runtime snapshot pas nadat dedicated opslag aantoonbaar stabiel is.

## Fase 3: runtime snapshot verkleinen

De runtime snapshot blijft nuttig als compat- en herstelmechanisme, maar hoort op termijn kleiner te worden.

1. Meet welke domeinen nog afhankelijk zijn van de snapshot.
2. Verplaats domeinen pas als dedicated repositorytests groen zijn.
3. Laat de snapshot geen nieuwe businessvelden opnemen zonder expliciete uitzondering.
4. Documenteer elke verwijdering of downgrade in de roadmap.

## Niet doen

- Geen grote database-migratie zonder domeinspecifieke tests.
- Geen frontend direct aan nieuwe opslagdetails koppelen.
- Geen bestaande UI-state scope stilletjes hergebruiken voor nieuwe businessdata.
- Geen snapshotvelden verwijderen zolang oude flows daar nog uit kunnen lezen.
- Geen repository maken die alleen een dunne naamlaag is zonder eigenaarschap of tests.

## Klantstatussen: centrale repository-route

Wijzigingen rond klantstatussen moeten het contract in [docs/customer-status-contract.md](customer-status-contract.md) volgen.

Gebruik `updateCustomerStatusWithHistoryInRows` als veilige standaard voor statusupdates op bestaande klanten. Nieuwe migraties in agenda, leads, coldcalling of coldmailing mogen geen eigen statusnormalisatie, losse `hist.push(...)` logica of parallel opslagpad introduceren zonder contracttest, compat-flag en rollback-pad.

Deze afspraak voorkomt dat klantstatussen opnieuw verspreid raken over routes, coordinators, frontend scripts of `server.js`.
