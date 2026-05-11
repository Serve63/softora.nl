# Softora verbeterplan dynamische logica

Datum plan: 2026-05-11

Doel: de kleinste veilige set verbeteringen doorvoeren die de gevonden hoge risico's fundamenteel verlaagt, zonder bestaande UI of databasevorm destructief te wijzigen.

## Prioriteit 1 - Kritieke datalogica

### 1.1 Coldmail replies moeten lifecycle-status krijgen

- Status: direct uitvoeren.
- Probleem:
  - Inbound coldmail replies krijgen wel auto-reply, maar de database-status wordt niet bijgewerkt.
- Aanpak:
  - Voeg intentclassificatie toe in `server/services/coldmail-campaign.js`.
  - Positieve reply markeert het database record als `interesse`.
  - Stop/afmeld/geen-interesse markeert als `geblokkeerd`.
  - Onduidelijke reply blijft neutraal maar wordt wel gelogd in reply-state.
  - Statusupdate moet idempotent zijn per inbound message.
  - Statusupdate mag niet afhangen van succesvol verzenden van de auto-reply.
- Tests:
  - Contracttest voor positieve inbound reply.
  - Contracttest voor opt-out/geen-interesse reply.
  - Bestaande coldmail send tests moeten groen blijven.
- Verwacht effect:
  - E-mailinteresse blokkeert vervolgcampagnes/coldcalling en is zichtbaar in database.

### 1.2 Duplicates in structured customer storage samenvoegen

- Status: direct uitvoeren.
- Probleem:
  - `softora_customers` upsert op `customer_id`; dezelfde identiteit met andere id kan dubbel blijven bestaan.
- Aanpak:
  - Voeg veilige dedupe toe in `server/services/data-ops-store.js` voordat rows naar Supabase gaan.
  - Dedupe alleen als `identity_key` bruikbaar is.
  - Bewaar klantstatus boven afspraak/interesse boven prospect.
  - Combineer history zonder dubbele entries.
  - Markeer niet-canonical duplicate ids als deleted via bestaande replace-logica.
- Tests:
  - Contracttest met fake Supabase client of helpertest voor dedupe.
- Verwacht effect:
  - Een klant kan niet tegelijk als duplicate lead zichtbaar blijven binnen dezelfde replace-operatie.

## Prioriteit 2 - Statusovergangen

### 2.1 Backendstatussen centraliseren

- Status: deels nu, verder later.
- Probleem:
  - Statussets staan in coldcalling, coldmail, agenda en klantenbootstrap los van elkaar.
- Aanpak:
  - Maak een backend lifecycle helper met canonieke statusnormalisatie en statusprioriteit.
  - Gebruik deze helper in nieuwe wijzigingen.
  - Migreren van alle bestaande modules moet in kleine stappen gebeuren om regressies te voorkomen.
- Tests:
  - Statusalias tests.
  - Coldcalling/coldmailing eligibility tests.
- Verwacht effect:
  - Minder kans dat status `interesse` of `klant` in de ene flow anders werkt dan in de andere.

### 2.2 Coldmail en coldcalling eindigen in dezelfde lifecycle

- Status: eerst positieve/negatieve e-mailreply fix.
- Probleem:
  - Coldcalling heeft agenda/follow-up routing; coldmail had alleen auto-reply.
- Aanpak:
  - Fase 1: database-status correct zetten.
  - Fase 2: positieve e-mailreply ook als lead-follow-up of taak tonen op leads-pagina.
- Tests:
  - Inbound mailreply toont minimaal status `interesse` in database.
  - Later: inbound mailreply verschijnt als follow-up taak.

## Prioriteit 3 - Dubbele/verspreide logica centraliseren

### 3.1 Gedeelde lifecycle helper backend

- Status: uitvoeren als klein bestand.
- Bestanden:
  - Nieuw: `server/services/customer-lifecycle.js`.
  - Eerste gebruik in coldmail en data-ops.
- Inhoud:
  - Canonieke statuslijst.
  - Aliassen naar `interesse`, `afspraak`, `klant`, `afgehaakt`, `geblokkeerd`, `buiten`.
  - Statusprioriteit voor dedupe.
  - Outreach blocklists.
- Randvoorwaarde:
  - Geen grote refactor in alle modules tegelijk.

### 3.2 Frontendstatussen later koppelen

- Status: later.
- Probleem:
  - Frontendstatussets blijven nog hardcoded.
- Aanpak:
  - Eerst tests toevoegen die frontendstatussen vergelijken met backendstatussen.
  - Daarna eventueel build-time gedeelde JSON/statusconfig gebruiken.

## Prioriteit 4 - UI-sync en badges

### 4.1 Database status na coldmail reply zichtbaar houden

- Status: direct gevolg van prioriteit 1.
- Aanpak:
  - Coldmail reply statusupdate schrijft `status`, `databaseStatus`, timestamps en history.
  - Database UI leest bestaande gedeelde customer payload en toont daardoor nieuwe status.
- Tests:
  - Coldmail contracttest controleert opgeslagen row.

### 4.2 Leads-badge voor e-mailinteresse

- Status: later, tenzij directe infrastructuur eenvoudig blijkt.
- Aanpak:
  - Na statusfix onderzoeken of positieve e-mailreplies als lead-follow-up taak moeten verschijnen.
  - Dit moet via hetzelfde agenda/lead-follow-up pad als coldcalling, niet via losse UI-only state.
- Risico als uitgesteld:
  - Interesse staat wel veilig in database, maar mogelijk nog niet in leads inbox als taak.

## Prioriteit 5 - Edge cases en fallback-logica

### 5.1 Auto-reply faalt maar lifecycle moet blijven staan

- Status: direct uitvoeren.
- Aanpak:
  - Lifecycle update uitvoeren zodra inbound reply matcht en intent duidelijk is.
  - Reply-state verwerkt pas na reply, maar row-history gebruikt message-key zodat herverwerking niet meerdere historyregels maakt.

### 5.2 Opt-out/stop veilig blokkeren

- Status: direct uitvoeren.
- Aanpak:
  - Herken `stop`, `afmelden`, `uitschrijven`, `unsubscribe`, `geen interesse`.
  - Zet `mail = false`, `doNotMail = true`, `databaseStatus = geblokkeerd`.
  - Laat bestaande klantstatus niet degraderen naar geblokkeerd.

### 5.3 Bestaande klant niet degraderen door latere mailreply

- Status: direct uitvoeren.
- Aanpak:
  - Statusprioriteit respecteren.
  - `klant` blijft `klant`, ook als een oud bericht later opnieuw gelezen wordt.

## Prioriteit 6 - Tests en QA

### Automatische checks

- Gerichte tests:
  - `node --test test/contracts/coldmail-campaign.test.js`
  - `node --test test/contracts/data-ops-ui-state-bridge.test.js` of nieuwe data-ops store test.
  - `node --test test/contracts/coldcalling-lead-eligibility.test.js`
  - `node --test test/contracts/agenda-post-call.test.js`
  - `node --test test/contracts/customers-page-bootstrap.test.js`
- Projectcheck:
  - `npm run verify:critical`

### Handmatige scenario-checklist

Na implementatie controleren:

1. Lead wordt aangemaakt.
2. Lead wordt gebeld.
3. Lead toont interesse via cold call.
4. Lead toont interesse via mail.
5. Afspraak wordt ingepland.
6. Afspraak wordt akkoord/deal.
7. Afspraak wordt geen deal.
8. Lead wordt klant.
9. Lead verdwijnt uit gewone leadlijsten zodra die klant is.
10. Klant verschijnt correct in klantenmodule.
11. Handmatige afspraak `overig` blijft niet-sales.
12. Handmatige afspraak `meeting` houdt dealacties beschikbaar.
13. Duplicaat lead/klant wordt voorkomen of samengevoegd.
14. UI badges, aantallen en filters volgen status.
15. Refresh toont dezelfde data.
16. Dubbele webhook/automatische actie maakt geen dubbele records.
17. Cold call-flow en mail-flow gebruiken dezelfde lifecyclestatus waar logisch.

## Niet doen in deze fase

- Geen destructieve Supabase migratie.
- Geen visuele redesign.
- Geen volledige frontendstatusrefactor in één keer.
- Geen massale rewrite van agenda of coldcalling; bestaande geteste flow is grotendeels gezond.
- Geen automatische klantaanmaak bij alleen e-mailinteresse.
