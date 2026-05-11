# Softora logica-audit

Datum audit: 2026-05-11

Legenda:

- GOED: werkt logisch en consistent.
- GOED MAAR KWETSBAAR: werkt nu, maar is nog te verspreid of breekbaar.
- ONDUIDELIJK: niet hard genoeg vast te stellen zonder productiegegevens of externe koppeling.
- ONTBREEKT: hoort er te zijn, maar is niet geregeld.
- FOUT / RISICO: kan leiden tot verkeerde data, dubbele data, verkeerde statussen of kapotte flows.

## 1. Lead wordt gebeld

- Classificatie: GOED
- Bestanden:
  - `server/routes/coldcalling.js`
  - `server/services/coldcalling-runtime.js`
  - `server/services/coldcalling-lead-eligibility.js`
  - `server/services/call-update-store.js`
  - `server/services/call-webhooks.js`
- Huidig gedrag:
  - Coldcalling start alleen na database-eligibility check.
  - Callupdates worden idempotent op `callId` opgeslagen.
  - Provider webhooks triggeren post-call automation.
- Gewenst gedrag:
  - Leads die al klant, afspraak, interesse, geen deal, geblokkeerd of buiten gebruik zijn worden niet opnieuw gebeld.
- Waarom belangrijk:
  - Voorkomt dubbele benadering en statusvervuiling.
- Risico: laag

## 2. Coldcalling blokkeert bestaande klanten/interesse/afspraken

- Classificatie: GOED
- Bestanden:
  - `server/services/coldcalling-lead-eligibility.js`
  - `server/routes/coldcalling.js`
  - `test/contracts/coldcalling-lead-eligibility.test.js`
- Huidig gedrag:
  - Statussen `interesse`, `afspraak`, `klant`, `afgehaakt`, `geblokkeerd`, `buiten` en actieve `mailcampagne` blokkeren coldcalling.
  - Matching gebeurt op telefoon en bedrijf.
- Gewenst gedrag:
  - Zelfde.
- Waarom belangrijk:
  - Dit is de belangrijkste bescherming tegen opnieuw bellen van mensen die al in een latere lifecyclefase zitten.
- Risico: laag

## 3. Coldmail campagne selecteert alleen geschikte records

- Classificatie: GOED MAAR KWETSBAAR
- Bestanden:
  - `server/services/coldmail-campaign.js`
  - `server/routes/coldmailing.js`
  - `test/contracts/coldmail-campaign.test.js`
- Huidig gedrag:
  - Records met `gemaild`, `interesse`, `afspraak`, `klant`, `afgehaakt`, `geblokkeerd`, `buiten` worden uitgesloten.
  - Na verzenden wordt status `gemaild` gezet en campagneperiode opgeslagen.
- Gewenst gedrag:
  - Zelfde, maar statussets moeten gedeeld worden met de rest van de backend.
- Waarom belangrijk:
  - Statusdrift tussen coldmailing en coldcalling kan leiden tot dubbele outreach.
- Risico: middel

## 4. Inbound coldmail reply wordt als lifecycle verwerkt

- Classificatie: ONTBREEKT
- Bestanden:
  - `server/services/coldmail-campaign.js`
  - `test/contracts/coldmail-campaign.test.js`
- Huidig gedrag:
  - Inbound replies worden gematcht en er wordt een automatische reply gestuurd.
  - Verwerkte messages worden opgeslagen.
  - De database-status van de lead wordt niet zichtbaar bijgewerkt naar `interesse`, `afgehaakt` of `geblokkeerd`.
- Gewenst gedrag:
  - Positieve reply zet database-status idempotent op `interesse`.
  - Stop/afmeld/geen-interesse zet database-status op `geblokkeerd`.
  - Negatieve maar niet-opt-out reply zet database-status op `afgehaakt` of blijft neutraal als intent onduidelijk is.
  - De statusupdate mag niet afhangen van het slagen van de auto-reply.
- Waarom belangrijk:
  - Iemand kan via e-mail interesse tonen maar daarna toch als gewone lead blijven meetellen of opnieuw benaderd worden.
- Risico: hoog

## 5. Interested coldcall lead naar agenda

- Classificatie: GOED
- Bestanden:
  - `server/services/agenda-interested-leads.js`
  - `server/services/agenda-interested-lead-state.js`
  - `server/services/agenda-read.js`
  - `premium-leads.html`
  - `test/contracts/agenda-interested-leads.test.js`
  - `test/contracts/agenda-interested-lead-state.test.js`
- Huidig gedrag:
  - Lead kan met datum/tijd/locatie naar agenda.
  - Dismissed state voorkomt dubbele leadweergave.
  - Open follow-up taken voor dezelfde identiteit worden geannuleerd.
- Gewenst gedrag:
  - Zelfde.
- Waarom belangrijk:
  - Dit zorgt dat een lead die opgevolgd is niet tegelijk als losse lead blijft hangen.
- Risico: laag

## 6. Afspraak wordt deal/klant

- Classificatie: GOED
- Bestanden:
  - `server/services/agenda-post-call.js`
  - `assets/premium-actieve-opdrachten.js`
  - `premium-personeel-agenda.html`
  - `premium-klanten.html`
  - `test/contracts/agenda-post-call.test.js`
  - `test/contracts/customers-page-bootstrap.test.js`
- Huidig gedrag:
  - Active order wordt aangemaakt of hergebruikt op `sourceAppointmentId`.
  - Database-status wordt `klant`.
  - Klantenmodule toont records met lifecycle `klant`.
- Gewenst gedrag:
  - Zelfde.
- Waarom belangrijk:
  - Lead mag na akkoord niet meer als normale prospect behandeld worden.
- Risico: laag

## 7. Afspraak wordt geen deal

- Classificatie: GOED
- Bestanden:
  - `server/services/agenda-post-call.js`
  - `premium-personeel-agenda.html`
  - `test/contracts/agenda-post-call.test.js`
- Huidig gedrag:
  - Status normaliseert naar `afgehaakt`.
  - Database-status wordt bijgewerkt of record wordt aangemaakt.
- Gewenst gedrag:
  - Geen klantdata aanmaken; wel outreach blokkeren.
- Waarom belangrijk:
  - Geen-deal mag niet later als klant of nieuwe lead terugkomen.
- Risico: laag

## 8. Handmatige afspraak type meeting/overig

- Classificatie: GOED
- Bestanden:
  - `server/services/agenda-manual-appointment.js`
  - `test/contracts/agenda-manual-appointment.test.js`
  - `test/contracts/google-calendar-sync.test.js`
- Huidig gedrag:
  - Salesachtige `meeting` vraagt lead-owner velden.
  - `overig` wordt niet als salesmeeting behandeld.
  - Google Calendar sync is gericht getest voor het overslaan van `overig`.
- Gewenst gedrag:
  - Zelfde.
- Waarom belangrijk:
  - Interne afspraken mogen niet per ongeluk lead/deal-logica activeren.
- Risico: laag

## 9. Klantenmodule gebruikt gedeelde database zonder gewone leads kwijt te raken

- Classificatie: GOED
- Bestanden:
  - `premium-klanten.html`
  - `assets/premium-customers-core.js`
  - `server/services/customers-page-bootstrap.js`
  - `test/contracts/premium-customers-core.test.js`
  - `test/contracts/customers-page-bootstrap.test.js`
- Huidig gedrag:
  - Alleen `databaseStatus = klant` wordt als klant gezien.
  - Niet-klant database rows worden bij opslaan behouden.
- Gewenst gedrag:
  - Zelfde.
- Waarom belangrijk:
  - Klantbeheer mag de CRM/databasevoorraad niet leegschrijven.
- Risico: laag

## 10. Gedeelde statusnormalisatie

- Classificatie: GOED MAAR KWETSBAAR
- Bestanden:
  - `assets/premium-customers-core.js`
  - `premium-database.html`
  - `server/services/customers-page-bootstrap.js`
  - `server/services/coldmail-campaign.js`
  - `server/services/coldcalling-lead-eligibility.js`
  - `server/services/agenda-post-call.js`
- Huidig gedrag:
  - Elke module normaliseert statussen grotendeels zelf.
  - De statussets lijken inhoudelijk op elkaar, maar zijn niet centraal gegarandeerd.
- Gewenst gedrag:
  - Minimaal backendstatussen centraliseren.
  - Later frontend en backend uit dezelfde bron laten genereren of testen.
- Waarom belangrijk:
  - Een status die in de ene flow geblokkeerd is maar in de andere niet, veroorzaakt inconsistentie.
- Risico: middel

## 11. Dubbele leads/klanten in structured storage

- Classificatie: FOUT / RISICO
- Bestanden:
  - `server/services/data-ops-store.js`
  - `server/services/data-ops-serialization.js`
  - `supabase/data-ops-schema.sql`
  - `docs/data-ops-storage.md`
- Huidig gedrag:
  - `softora_customers` upsert op `customer_id`.
  - `identity_key` heeft een index, maar geen uniqueness guard.
  - Twee records met andere id maar dezelfde identiteit kunnen naast elkaar blijven bestaan.
- Gewenst gedrag:
  - Binnen een replace-operatie records met dezelfde identiteit veilig samenvoegen voordat ze naar Supabase gaan.
  - Klantstatus moet winnen van afspraak/interesse/prospect als duplicates samengevoegd worden.
- Waarom belangrijk:
  - Bij duplicates kan slechts één record status `klant` krijgen terwijl een ander duplicate record nog als lead zichtbaar blijft.
- Risico: hoog

## 12. Agenda post-call matcht bij duplicates maar één record

- Classificatie: GOED MAAR KWETSBAAR
- Bestanden:
  - `server/services/agenda-post-call.js`
- Huidig gedrag:
  - Matcht op telefoon of bedrijf en werkt de eerste match bij.
- Gewenst gedrag:
  - Dedupe in de opslaglaag beperkt dit risico.
  - Later kan post-call sync alle exact matches of canonical record gebruiken.
- Waarom belangrijk:
  - Bij dubbele records kunnen badges en filters uiteenlopen.
- Risico: middel

## 13. Data-ops bridge als bron van waarheid

- Classificatie: GOED MAAR KWETSBAAR
- Bestanden:
  - `server/services/data-ops-ui-state-bridge.js`
  - `server/services/data-ops-store.js`
  - `docs/data-ops-storage.md`
- Huidig gedrag:
  - Structured tabellen worden eerst gelezen.
  - Legacy UI-state blijft compat/fallback.
- Gewenst gedrag:
  - Structured opslag blijft leidend zodra beschikbaar.
  - Legacy fallback alleen gebruiken als structured data ontbreekt.
- Waarom belangrijk:
  - Twee opslagvormen naast elkaar vragen extra discipline.
- Risico: middel

## 14. Active-order idempotency

- Classificatie: GOED
- Bestanden:
  - `server/services/agenda-post-call.js`
  - `server/services/data-ops-store.js`
  - `test/contracts/agenda-post-call.test.js`
- Huidig gedrag:
  - Active order wordt hergebruikt op `sourceAppointmentId`.
  - Structured active orders upserten op `order_id`.
- Gewenst gedrag:
  - Zelfde.
- Waarom belangrijk:
  - Dubbel klikken of opnieuw verwerken mag geen dubbele opdracht maken.
- Risico: laag

## 15. UI badges, filters en counts

- Classificatie: GOED MAAR KWETSBAAR
- Bestanden:
  - `assets/premium-customers-core.js`
  - `premium-database.html`
  - `assets/coldcalling-dashboard.js`
  - `premium-leads.html`
  - `test/contracts/premium-sidebar-leads-count.test.js`
  - `test/contracts/premium-database-ui.test.js`
  - `test/contracts/premium-ai-lead-generator-ui.test.js`
- Huidig gedrag:
  - Er zijn veel UI-tests die labels en badges bewaken.
  - Statuslabels staan wel verspreid.
- Gewenst gedrag:
  - UI moet dezelfde statusbron blijven volgen als backend.
- Waarom belangrijk:
  - Verkeerde badge betekent dat de gebruiker een verkeerde actie kan nemen.
- Risico: middel

## 16. Mailbox en algemene e-mailinteractie

- Classificatie: ONDUIDELIJK
- Bestanden:
  - `server/services/mailbox.js`
  - `assets/premium-mailbox.js`
  - `server/routes/mailbox.js`
- Huidig gedrag:
  - Mailbox is vooral weergave/actie.
  - Geen volledige lifecyclekoppeling met database-status gevonden buiten coldmail-replies.
- Gewenst gedrag:
  - Belangrijke replies die salesintentie tonen moeten uiteindelijk dezelfde lifecyclelogica aanroepen.
- Waarom belangrijk:
  - E-mailinteresse moet niet afhankelijk zijn van welke inboxmodule de mail ziet.
- Risico: middel

## Samenvatting audit

- GOED:
  - Coldcalling blokkade.
  - Callupdate idempotency.
  - Interested lead naar agenda.
  - Afspraak naar klant.
  - Afspraak naar geen deal.
  - Handmatige `meeting`/`overig` scheiding.
  - Klantenmodule filtert gewone leads correct uit.
- GOED MAAR KWETSBAAR:
  - Coldmailselectie.
  - Statusnormalisatie.
  - Data-ops bridge.
  - UI badges/filters.
  - Post-call matching bij duplicates.
- ONDUIDELIJK:
  - Algemene mailbox lifecycle buiten coldmailcampagnes.
- ONTBREEKT:
  - Inbound coldmail reply lifecycle-statusupdate.
- FOUT / RISICO:
  - Duplicate customer/database records in structured storage.
