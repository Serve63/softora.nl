# Softora eindcontrole dynamische logica

Datum eindcontrole: 2026-05-11

## 1. Wat is gevonden

- Coldcalling, agenda, interested-leads, deal/geen-deal en klantenfiltering zijn grotendeels goed en actief getest.
- Coldmail verzending markeerde records al als `gemaild`, maar inbound replies kregen nog geen database-lifecycle status.
- Na correctie van de productgrens is vastgelegd dat `/premium-leads` alleen coldcalling is; mailinteresse hoort in coldmailing.
- Structured Supabase opslag kon binnen een replace-operatie dubbele customer/database identities met verschillende id's bewaren.
- Statusnormalisatie bestaat op meerdere plekken en is daardoor kwetsbaar voor drift.
- UI badges en filters hebben veel contracttests, maar frontendstatussen zijn nog niet volledig uit één centrale bron opgebouwd.

## 2. Wat stond al goed

- Coldcalling blokkeert bestaande `interesse`, `afspraak`, `klant`, `afgehaakt`, `geblokkeerd`, `buiten` en actieve mailcampagne-records.
- Callupdates worden idempotent per `callId` verwerkt.
- Interested leads kunnen naar agenda worden gezet en verdwijnen daarna uit de losse interested-lead staat.
- Afspraak akkoord/deal maakt of hergebruikt een active order en zet database-status op `klant`.
- Geen-deal zet database-status op `afgehaakt` zonder klantorder aan te maken.
- Handmatige afspraak `overig` wordt niet als salesmeeting behandeld.
- Klantenmodule toont alleen lifecycle `klant` en behoudt gewone database/leads rows.

## 3. Wat kwetsbaar was

- Coldmail en coldcalling gebruikten vergelijkbare, maar niet centraal gedeelde statusnormalisatie.
- Duplicates konden ertoe leiden dat één record klant werd, terwijl een duplicate nog als lead/prospect bleef bestaan.
- Coldmail inbound processing was vooral auto-reply gericht; lifecycle-status stond daar nog los van.
- Positieve coldmail replies stonden na de eerste fix wel als `interesse` in de database, maar hadden nog geen eigen coldmailing-opvolgplek.
- Algemene mailboxreacties buiten coldmailcampagnes zijn nog niet volledig gekoppeld aan lead/customer lifecycle.

## 4. Wat ontbrak

- Positieve inbound coldmail reply naar `databaseStatus = interesse`.
- Opt-out/geen-interesse inbound coldmail reply naar `databaseStatus = geblokkeerd`.
- Idempotente coldmail-reply history via message-key.
- Eigen coldmailing-follow-up lijst voor mailinteresse, zonder `/premium-leads` te gebruiken.
- App-layer dedupe voor customer/database records met dezelfde identiteit in structured storage.
- Een gedeelde backend lifecycle-helper voor statusnormalisatie en statusprioriteit.

## 5. Wat is aangepast

- Nieuwe backend helper `server/services/customer-lifecycle.js`
  - Canonieke contactstatussen.
  - Statusalias-normalisatie.
  - Statusprioriteit.
  - Bescherming tegen downgraden van `klant`.
- `server/services/coldmail-campaign.js`
  - Inbound replies worden geclassificeerd.
  - Positieve replies zetten de database row op `interesse`.
  - Stop/afmelden/geen-interesse zet de row op `geblokkeerd` en schakelt mailing voor die row uit.
  - Lifecycle update gebeurt vóór de auto-reply en is niet afhankelijk van succesvol reply-verzenden.
  - History gebruikt `messageKey`, zodat dezelfde inbound mail niet dubbele historyregels blijft maken.
  - Geeft positieve mailinteresse terug via `listColdmailReplyFollowUps`.
- `server/routes/coldmailing.js`
  - Nieuwe read-only route `GET /api/coldmailing/replies/follow-ups`.
- `premium-bevestigingsmails.html` en `assets/premium-coldmail-followups.js`
  - Tonen mailinteresse op de coldmailingpagina.
  - Verbergen dit expliciet op de lead-generator/coldcalling alias.
- `server/services/data-ops-store.js`
  - Customer/database rows worden vóór structured upsert gededuped op bruikbare `identity_key`.
  - Sterkere lifecycle-status wint, met `klant` bovenaan.
  - History en nuttige ontbrekende velden worden samengevoegd.
  - Duplicate ids vallen uit de incoming id-lijst en worden via bestaande soft-delete replace-logica gemarkeerd.
- Tests uitgebreid:
  - Coldmail positive reply.
  - Coldmail opt-out reply.
  - Structured customer dedupe.

## 6. Gewijzigde bestanden

- `docs/logic-audit/LOGICA_MAP.md`
- `docs/logic-audit/LOGICA_AUDIT.md`
- `docs/logic-audit/LOGICA_VERBETERPLAN.md`
- `docs/logic-audit/LOGICA_EINDCONTROLE.md`
- `server/services/customer-lifecycle.js`
- `server/services/coldmail-campaign.js`
- `server/routes/coldmailing.js`
- `server/services/data-ops-store.js`
- `premium-bevestigingsmails.html`
- `assets/premium-coldmail-followups.js`
- `test/contracts/coldmail-campaign.test.js`
- `test/contracts/coldmailing-routes.test.js`
- `test/contracts/data-ops-store.test.js`
- `test/contracts/premium-bevestigingsmails-ui.test.js`
- `test/contracts/premium-leads-ui.test.js`

Let op: de worktree bevat ook bestaande, niet door deze audit gewijzigde bestanden. Die zijn niet teruggedraaid en horen buiten deze wijzigingsset.

## 7. Databasewijzigingen/migraties

- Geen database-migratie uitgevoerd.
- Geen destructieve Supabase wijziging gedaan.
- De duplicate-bescherming is bewust in de applicatielaag toegevoegd, zodat bestaande Supabase-data niet door een harde unique constraint of migratie kan breken.

## 8. Tests en checks uitgevoerd

- `npm run backup:runtime`
  - Backup gemaakt: `backups/runtime-backup-2026-05-11T13-40-33-436Z.json`.
- Gericht:
  - `node --test test/contracts/coldmail-campaign.test.js`
  - `node --test test/contracts/coldmailing-routes.test.js`
  - `node --test test/contracts/premium-bevestigingsmails-ui.test.js`
  - `node --test test/contracts/premium-leads-ui.test.js`
  - `node --test test/contracts/premium-sidebar-leads-count.test.js`
  - `node --test test/contracts/data-ops-store.test.js`
  - `node --test test/contracts/coldcalling-lead-eligibility.test.js`
  - `node --test test/contracts/agenda-post-call.test.js`
  - `node --test test/contracts/customers-page-bootstrap.test.js`
  - `node --test test/contracts/data-ops-ui-state-bridge.test.js`
  - `node --test test/contracts/premium-customers-core.test.js`
  - `node --check server/services/coldmail-campaign.js`
  - `node --check server/routes/coldmailing.js`
  - `node --check assets/premium-coldmail-followups.js`
  - `node --check server/services/data-ops-store.js`
- Volledige kritieke poort:
  - `npm run verify:critical`
  - Resultaat: geslaagd.
  - Contracttests: 851 geslaagd.
  - Smoke-tests: 26 geslaagd.
  - Guardrails, repo hygiene, quality lock en secrets-check: geslaagd.
- Afhankelijkheden:
  - `npm run check:deps`
  - Resultaat: 0 kwetsbaarheden.

Er zijn geen aparte `lint`, `typecheck` of `build` scripts aanwezig in `package.json`.

## 9. Scenario's succesvol gecontroleerd

1. Lead wordt aangemaakt: gecontroleerd via bestaande database/import/customer contracten.
2. Lead wordt gebeld: gecontroleerd via coldcalling eligibility/start tests.
3. Lead toont interesse via cold call: gecontroleerd via agenda interested-lead en lead-follow-up contracten in `verify:critical`.
4. Lead toont interesse via mail: nieuw getest; inbound coldmail reply zet status `interesse`.
5. Afspraak wordt ingepland: gecontroleerd via agenda upsert/interested-leads/manual appointment tests.
6. Afspraak wordt akkoord/deal: gecontroleerd via agenda post-call active-order test.
7. Afspraak wordt geen deal: gecontroleerd via agenda post-call `afgehaakt` test.
8. Lead wordt klant: gecontroleerd via agenda post-call en customers bootstrap tests.
9. Lead verdwijnt uit gewone outreach zodra die klant is: gecontroleerd via coldcalling eligibility en customer lifecycle statusprioriteit.
10. Klant verschijnt correct in klantenmodule: gecontroleerd via customers bootstrap en premium customers core tests.
11. Handmatige afspraak `overig` wordt niet behandeld als salesmeeting: gecontroleerd via bestaande manual appointment/Google Calendar tests in `verify:critical`.
12. Handmatige afspraak `meeting` krijgt juiste sales/deal-context: gecontroleerd via manual appointment tests.
13. Duplicate lead/klant wordt voorkomen of samengevoegd: nieuw getest in data-ops store.
14. UI-badges, aantallen en filters blijven onder contracttests vallen: gecontroleerd via `verify:critical`.
15. Refresh/persistent data: gecontroleerd via runtime/data-ops/ui-state contracten.
16. Dubbele automatische acties: callId/appointment/order idempotency blijft getest; coldmail reply history is nu message-key idempotent.
17. Cold call-flow en mail-flow delen nu minimaal dezelfde lifecycle-statussen voor `interesse`, `klant`, `afgehaakt` en blokkades, maar blijven in de UI gescheiden: `/premium-leads` voor coldcalling en coldmailing voor mailinteresse.

## 10. Overblijvende risico's

- Positieve e-mailreply staat nu veilig als `interesse` in de database en is zichtbaar in coldmailing. Er wordt bewust geen lead-follow-up taak in `/premium-leads` gemaakt, omdat die pagina coldcalling-only is.
- Algemene mailboxreacties buiten coldmailcampagnes zijn nog niet volledig aan de lifecycle-helper gekoppeld.
- Frontend en backend gebruiken nog niet overal dezelfde statusconfig als één gedeelde bron.
- Supabase heeft nog geen unieke databaseconstraint op `identity_key`; duplicate-bescherming zit nu in de applicatielaag.
- Bestaande productiegegevens kunnen oude duplicates bevatten die pas bij een volgende replace/save worden samengevoegd.

## 11. Aannames

- `databaseStatus` blijft leidend voor lifecyclebeslissingen.
- `status` blijft legacy/visuele compat en wordt bij coldmail reply meegezet om oude UI-paden consistent te houden.
- E-mailinteresse hoeft nog geen klantrecord of active order te maken zolang er geen akkoord/deal is.
- E-mailinteresse hoort niet in `/premium-leads`; die pagina blijft alleen voor coldcalling.
- Opt-out/geen-interesse via mail moet toekomstige mailing blokkeren en mag een bestaande `klant` status niet downgraden.
- Geen destructieve migratie is veiliger dan een directe unique constraint zolang bestaande data niet eerst apart opgeschoond is.

## Korte conclusie

- Status: geslaagd binnen de gecontroleerde codebase en automatische checks.
- Belangrijkste fixes:
  - Inbound coldmail lifecycle-status.
  - Aparte coldmailing-follow-up voor mailinteresse.
  - Customer/database duplicate merge in structured opslag.
  - Gedeelde backend lifecycle-helper.
- Tests uitgevoerd:
  - Gerichte contracttests.
  - Volledige `verify:critical`.
  - Dependency audit.
- Openstaande risico's:
  - Algemene mailboxreacties buiten coldmailcampagnes zijn nog niet volledig gekoppeld.
  - Volledige frontend/backend statuscentralisatie nog vervolgwerk.
- Advies volgende stap:
  - Koppel later ook algemene mailboxreacties buiten coldmailcampagnes aan dezelfde lifecycle-helper, met dezelfde kanaalscheiding.
