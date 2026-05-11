# Softora logica-map

Datum audit: 2026-05-11

Deze map beschrijft de dynamische businesslogica die tijdens de codebase-scan is gevonden. De focus ligt op lead-, klant-, coldcalling-, coldmail-, agenda-, CRM/database- en actieve-opdrachtstromen.

## 1. Modules en pagina's

### Backend routes

- `server/routes/coldcalling.js`
  - Start coldcalling-campagnes.
  - Leest database-eligibility zodat bestaande klanten, afspraken, interesse en geblokkeerde records niet opnieuw worden gebeld.
  - Leest callstatus, callupdates, callkosten en lead-detaildata.
- `server/routes/coldmailing.js`
  - Previewt coldmail-ontvangers.
  - Verstuurd coldmail-campagnes.
  - Synchroniseert inbound replies via IMAP.
- `server/routes/agenda.js`
  - Schrijft agenda-afspraken, handmatige afspraken, bevestigingen en afspraakstatussen.
  - Is kernpad voor datum/tijd/status-mutaties.
- `server/routes/agenda-read.js`
  - Leest agenda-overzicht, bevestigingstaken en interesse-leads via een centrale coordinator.
- `server/routes/active-orders.js`
  - Leest/schrijft actieve opdrachten.
- `server/routes/premium-database-import.js`
  - Importeert databasebedrijven via CSV/XLSX/spreadsheet/zoekacties.
- `server/routes/mailbox.js`
  - Mailboxweergave en mailacties; indirect relevant voor e-mailopvolging.
- `server/routes/manifest.js`
  - Lijst kritieke flows en smoke-testdoelen.

### Backend services

- `server/services/agenda-runtime.js`
  - Centrale compositie voor agenda, leads, afspraken, bevestigingen en post-call.
- `server/services/agenda-read.js`
  - Centrale read-coordinator voor agenda, bevestigingstaken en interested leads.
  - Refresht Supabase runtime state en dismissed leads voor leesacties.
- `server/services/agenda-appointment-upsert.js`
  - Idempotente upsert van gegenereerde agenda-afspraken op `callId`.
  - Hergebruikt open lead-follow-up afspraken.
  - Beschermt handmatig bevestigde of lopende afspraakdata tegen overschrijven.
- `server/services/agenda-interested-leads.js`
  - Zet interested leads in de agenda.
  - Dismissed bijbehorende lead-identiteit zodat dezelfde lead niet dubbel blijft staan.
  - Annuleert open follow-up taken via state-service.
- `server/services/agenda-interested-lead-state.js`
  - Bewaart dismissed lead-identiteiten met timestamps.
  - Voorkomt dat oude calls blijven terugkomen, maar laat nieuwe activiteit voor dezelfde lead opnieuw verschijnen.
- `server/services/agenda-interested-lead-read.js`
  - Materialiseert interested lead data uit call/insight/appointment state.
- `server/services/agenda-lead-follow-up.js`
  - Bouwt en hergebruikt opvolgafspraken voor leads die niet meteen ingepland zijn.
- `server/services/agenda-manual-appointment.js`
  - Maakt handmatige afspraken.
  - Onderscheidt `meeting` van `overig`.
  - Alleen salesachtige meetings met businesslegend vereisen lead-owner velden.
- `server/services/agenda-post-call.js`
  - Slaat post-call notities, prompt, domein en referentiebeelden op.
  - Zet afspraak op `afgehaakt` bij geen deal.
  - Maakt of hergebruikt actieve opdracht bij akkoord/deal.
  - Synchroniseert afspraak naar database-status `klant` of `afgehaakt`.
- `server/services/ai-call-insights.js`
  - Analyseert call transcripts.
  - Herkent interesse, afspraken, no-answer en negatieve intent.
  - Maakt agenda-afspraken of lead-follow-up afspraken.
- `server/services/call-update-store.js`
  - Idempotente callupdate opslag per `callId`.
  - Merged lege updates niet over bestaande bruikbare data heen.
- `server/services/coldcalling-runtime.js`
  - Start outbound calls en verwerkt providerupdates.
  - Triggert post-call automatisering.
- `server/services/call-webhooks.js`
  - Ontvangt Twilio/Retell webhooks.
  - Autoriseert webhooks en upsert callupdates.
  - Triggert post-call automatisering.
- `server/services/coldcalling-lead-eligibility.js`
  - Centrale backendblokkade voor coldcalling.
  - Blokkeert op database-statussen en actieve coldmailcampagnes.
- `server/services/coldmail-campaign.js`
  - Selecteert coldmailontvangers.
  - Markeert verzonden mail als `gemaild`.
  - Houdt STRATO/daglimieten bij.
  - Verwerkt inbound replies en stuurt automatische replies.
- `server/services/leads-page-bootstrap.js`
  - Combineert bevestigingstaken, interested leads en database-identiteit voor de leads-pagina.
  - Dedupe op call/id/lead-identiteit.
- `server/services/customers-page-bootstrap.js`
  - Toont alleen echte klantlifecycle-records in klantenmodule.
  - Presenteert database-status `klant` als klantrecord.
- `server/services/data-ops-store.js`
  - Supabase structured opslag voor klanten/databasebedrijven, actieve opdrachten, order-runtime, designfoto's en webdesign-jobs.
- `server/services/data-ops-ui-state-bridge.js`
  - Compat-laag tussen oude UI-state JSON en nieuwe structured Supabase-tabellen.
- `server/services/premium-database-import.js`
  - Normaliseert spreadsheet/importdata voor databasebedrijven.
- `server/services/active-orders.js`
  - Active-order coordinator en opslagkoppeling.
- `server/services/google-calendar-sync.js`
  - Synchroniseert agenda-items met Google Calendar waar toegestaan.

### Frontend/UI

- `premium-ai-lead-generator.html` + `assets/coldcalling-dashboard.js`
  - Coldcalling dashboard, lead database, callhistorie, call-insights, filtercards en callstatus-badges.
- `premium-ai-coldmailing.html`
  - Legacy/alias naar leads-flow.
- `premium-leads.html`
  - Leads inbox voor bevestigingstaken en interested leads.
- `premium-bevestigingsmails.html`
  - Coldmail UI.
- `premium-database.html`
  - CRM/database overzicht, filters, statusbadges, import, handmatige records, websitefoto-acties.
- `premium-klanten.html`
  - Klantenmodule; filtert gedeelde database naar echte klanten.
- `premium-personeel-agenda.html`
  - Agenda, handmatige afspraken, post-call afronding, deal/geen-deal acties.
- `premium-actieve-opdrachten.html` + `assets/premium-actieve-opdrachten.js`
  - Actieve opdrachten en order-runtime.
- `premium-dashboard.html` + dashboard assets
  - Tellingen, badges, sidebar-notificaties en statusoverzichten.
- `assets/premium-customers-core.js`
  - Gedeelde frontendhelpers voor klant/database-status normalisatie.
- `assets/premium-database-import.js`
  - Import en dedupe helpers voor databasebedrijven.
- `assets/premium-mailbox.js`
  - Mailboxweergave; indirect relevant voor e-mailinteractie.

## 2. Tabellen, opslagvelden en statusvelden

### Structured Supabase-tabellen

- `softora_customers`
  - `customer_id`: technische sleutel.
  - `identity_key`: genormaliseerde bedrijfs/contact/telefoon-identiteit.
  - `company`, `contact_name`, `phone`, `email`, `website`.
  - `database_status`: expliciete database/lifecycle-status.
  - `lifecycle_status`: afgeleide status.
  - `payload`: volledige legacy-compatible klant/database payload.
  - `source`, `version`, `updated_at`, `deleted_at`.
- `softora_active_orders`
  - `order_id`, `customer_id`, klant/bedrijf/titel/status velden.
  - `payload`, `source`, `version`, `updated_at`, `deleted_at`.
- `softora_order_runtime`
  - `order_id`, `status_key`, `progress_pct`, `payload`, `updated_at`, `deleted_at`.
- `softora_design_photos`
  - `customer_id`, `identity_key`, storage metadata, `legacy_meta`, `updated_at`, `deleted_at`.
- `softora_webdesign_jobs`
  - Webdesignfoto-jobstatus per klant/owner.
- `softora_runtime_state`
  - Runtime snapshots, callupdates, dismissed leads en legacy UI-state compat.

### Legacy/compat UI-state keys

- Scope `premium_customers_database`, key `softora_customers_premium_v1`
  - Gedeelde CRM/database/klantenlijst.
- Scope `premium_active_orders`, key `softora_custom_orders_premium_v1`
  - Actieve opdrachten.
- Scope `premium_active_orders`, key `softora_order_runtime_premium_v1`
  - Order-runtime status.
- Scope `premium_database_photos`, key `softora_database_photos_v1`
  - Websitefoto metadata en chunks.
- Scope `coldcalling`, key `softora_coldcalling_lead_rows_json`
  - Lead rows voor coldcalling.
- Scope `premium_coldmail_auto_replies`, key `softora_coldmail_auto_replies_v1`
  - Verwerkte inbound coldmail replies.
- Scope `premium_coldmail_send_guard`, key `softora_coldmail_send_guard_v1`
  - Daglimiet en verzendguard.

### Belangrijkste statuswaarden

- Database/contactstatussen:
  - `nieuw`
  - `prospect`
  - `benaderbaar`
  - `gebeld`
  - `geengehoor`
  - `gemaild`
  - `interesse`
  - `afspraak`
  - `klant`
  - `afgehaakt`
  - `geblokkeerd`
  - `buiten`
  - `mailcampagne` als afgeleide blokkadestatus bij actieve coldmailcampagne.
- Afspraak/post-call:
  - `afgehaakt`
  - `klant`
  - post-call status via agenda UI.
- Active orders:
  - `wacht`
  - `bezig`
  - `actief`
  - `klaar`
- Manual appointment kind:
  - `meeting`
  - `overig`
- Bron/source velden:
  - Coldcalling: `AI Cold Calling (Retell + AI)`, `AI Cold Calling (Lead opvolging)`.
  - Agenda/post-call: `premium-personeel-agenda`.
  - Coldmail: `coldmail-campaign`, `coldmail-auto-reply`.
  - Data ops compat: `ui-state-compat`.

## 3. Bestaande statusovergangen

### Database naar coldmail

1. Record staat in database als `prospect`, `benaderbaar`, `nieuw` of vergelijkbaar.
2. Coldmail preview selecteert alleen records met geldig e-mailadres, mail toegestaan, juiste branche/radius en geen uitgesloten status.
3. Na succesvolle mail wordt record:
   - `status = gemaild`
   - `databaseStatus = gemaild`
   - `lastColdmailSentAt`, `coldmailCampaignStartedAt`, `activeColdmailCampaignUntil`.
   - history entry `Mail verstuurd`.
4. Actieve coldmailcampagne blokkeert coldcalling via `coldcalling-lead-eligibility.js`.

### Inbound coldmail reply

1. IMAP leest recente/unseen berichten.
2. Bericht wordt gematcht op afzender e-mailadres en actieve coldmailcontext.
3. Auto-reply wordt met OpenAI gegenereerd en via SMTP verzonden.
4. Verwerkt bericht wordt vastgelegd in `premium_coldmail_auto_replies`.
5. Tijdens de audit was geen database-lifecycle update naar `interesse`, `afgehaakt` of `geblokkeerd` zichtbaar voor inbound reply intent.

### Coldcalling naar callupdate

1. Coldcalling start alleen voor leads die niet door database-status of actieve campagne geblokkeerd zijn.
2. Provider webhook/status wordt idempotent opgeslagen in callupdate store.
3. Post-call automation analyseert calls en vult insights aan.

### Coldcalling naar follow-up of afspraak

1. `ai-call-insights.js` analyseert transcript/status.
2. Bij afspraaktaal of duidelijke afspraakdetails wordt agenda-afspraak gemaakt/upsert.
3. Bij interesse zonder datum/tijd wordt lead-follow-up of interested lead gemaakt.
4. Bij negatieve/no-answer signalen wordt geen follow-up aangemaakt.
5. `agenda-appointment-upsert.js` dedupet op `callId` en hergebruikt bestaande follow-ups.

### Interested lead naar agenda

1. Leads-pagina leest interested leads via `agenda-read.js`.
2. UI stuurt `set-in-agenda` met datum/tijd/locatie.
3. Backend materialiseert lead als agenda-afspraak.
4. Lead-identiteit wordt dismissed zodat gewone leadlijst niet dubbel blijft tonen.
5. Eventuele open follow-up taken voor dezelfde identiteit worden geannuleerd.

### Afspraak naar geen deal

1. Personeel-agenda slaat post-call status op.
2. Als status normaliseert naar `afgehaakt`, sync naar klanten/database:
   - bestaand matching record wordt bijgewerkt, of
   - nieuw database record wordt aangemaakt met `databaseStatus = afgehaakt`.
3. Hiermee wordt toekomstige coldcalling/coldmailing geblokkeerd.

### Afspraak naar deal/klant

1. Personeel-agenda voegt afspraak toe aan actieve opdrachten.
2. Active order wordt aangemaakt of hergebruikt op `sourceAppointmentId`.
3. Afspraak krijgt `activeOrderId`, `activeOrderAddedAt`, `activeOrderAddedBy`.
4. Database record wordt bijgewerkt of aangemaakt met `databaseStatus = klant`.
5. Klantenmodule toont dit record als klant.

### Handmatige afspraak

1. Manual appointment service normaliseert input.
2. `appointmentKind = meeting` met sales/business-legend vraagt lead-owner velden.
3. `overig` wordt niet als salesmeeting behandeld.
4. Google Calendar sync is gericht getest voor het overslaan van `overig`.

## 4. Data die op meerdere plekken wordt gebruikt

- `softora_customers_premium_v1`
  - Databasepagina.
  - Klantenpagina.
  - Coldmail campagne selectie.
  - Coldcalling blokkade.
  - Agenda deal/geen-deal sync.
  - Active-orders klantkoppeling.
  - Dashboard/sidebar tellingen.
- Agenda/generated appointments
  - Agenda UI.
  - Leads follow-up.
  - Bevestigingstaken.
  - Active order omzetting.
  - Call detail/lead detail.
- Call updates en insights
  - Coldcalling dashboard.
  - Leads pagina.
  - Agenda afspraakgeneratie.
  - Call detail audio/transcript/samenvatting.
- Active orders
  - Actieve opdrachten.
  - Klantenmodule.
  - Dashboard.
  - Agenda post-call dealactie.
- Dismissed interested lead state
  - Leads inbox.
  - Agenda reads.
  - Lead-follow-up cancellation.

## 5. Automatische triggers en side effects

- Coldmail send:
  - Schrijft status `gemaild`.
  - Zet campaign timestamps.
  - Zet send guard.
- Coldmail inbound reply:
  - Stuurt auto-reply.
  - Markeert inbound bericht als verwerkt en gezien.
  - Tijdens audit: intent werd nog niet als lifecycle-status verwerkt.
- Coldcalling start:
  - Blokkeert records met status `interesse`, `afspraak`, `klant`, `afgehaakt`, `geblokkeerd`, `buiten` of actieve coldmailcampagne.
- Call webhook:
  - Upsert callupdate.
  - Triggert post-call automation.
- AI call insights:
  - Maakt agenda-afspraak of lead-follow-up.
  - Kan call-backed lead detail vullen.
- Interested lead in agenda:
  - Maakt agenda-afspraak.
  - Dismissed lead.
  - Annuleert open follow-up taken.
- Afspraak afgerond als geen deal:
  - Schrijft database-status `afgehaakt`.
- Afspraak akkoord/deal:
  - Maakt/upsert actieve opdracht.
  - Schrijft database-status `klant`.
- Handmatige afspraak:
  - Kan Google Calendar event maken.
  - `overig` hoort sales/dealacties niet automatisch te activeren.
- Structured data-ops bridge:
  - Leest structured Supabase eerst.
  - Schrijft structured tabellen vanuit legacy UI-state patches.

## 6. UI-onderdelen afhankelijk van deze logica

- Sidebar notificatiebadge voor leads.
- Leads inbox cards en filters.
- Coldcalling dashboard:
  - callstatus badges.
  - lead database modal.
  - interested-lead indicators.
- Coldmailing UI:
  - preview aantallen.
  - verzendresultaten.
  - sender accounts.
  - campagnebeperkingen.
- Database UI:
  - statusfilters.
  - statusbadges.
  - import/dedupe.
  - call/mail kanaalindicaties.
- Klanten UI:
  - toont alleen `klant` lifecycle records.
  - behoudt niet-klant database rows bij opslaan.
- Agenda UI:
  - afspraakstatus.
  - post-call prompt/transcript.
  - akkoord/deal en geen-deal acties.
  - handmatige afspraak type `meeting`/`overig`.
- Actieve opdrachten UI:
  - orderstatus.
  - klantkoppeling.
  - runtime voortgang.
- Dashboard UI:
  - aantallen, statusoverzichten en recente activiteiten.

## 7. Risico's op inconsistente data

- Coldmail inbound replies werden niet zichtbaar als lifecycle-status verwerkt. Daardoor kan iemand interesse tonen via mail maar nog als gewone lead/databaseprospect blijven staan.
- Statusnormalisatie is verspreid over meerdere bestanden. Daardoor kan een status in de ene module geblokkeerd zijn en in de andere module nog selecteerbaar blijven.
- Structured customer store gebruikt `customer_id` als upsert conflict en heeft alleen een niet-unieke `identity_key` index. Dubbele bedrijven/contacten met andere id's kunnen naast elkaar blijven bestaan.
- Agenda post-call sync werkt op eerste match op telefoon of bedrijf. Bij dubbele records wordt maar één record bijgewerkt.
- Frontend database-statusopties en serverstatussets zijn niet volledig centraal gedeeld.
- Coldcalling en coldmailing hebben vergelijkbare einddoelen, maar aparte intent/statuspaden.
- UI-state compat en structured Supabase bestaan naast elkaar. De bridge beperkt risico, maar dubbele bron-van-waarheid blijft migratiegevoelig.
- Inbound e-mailverwerking was gekoppeld aan auto-reply. Als auto-reply faalt, kan lifecycleverwerking ook uitblijven.
- Idempotency is goed aanwezig bij callId/appointment/order, maar minder expliciet bij coldmail inbound lifecycle updates.

## 8. Vermoedelijk ontbrekende logica

- Centrale lifecycle helper voor database/contactstatussen die backendmodules delen.
- Intentclassificatie voor inbound coldmail replies naar:
  - `interesse`
  - `geblokkeerd` of `afgehaakt`
  - neutraal/onduidelijk
- Idempotente statusupdate voor inbound coldmail replies.
- Dedupe of merge op `identity_key` in structured customer opslag.
- Test die garandeert dat e-mailinteresse dezelfde blokkade activeert als coldcallinginteresse.
- Test die garandeert dat dubbele database/customer records niet naast elkaar blijven bestaan in structured storage.
- Volledige centrale statusbron voor frontend en backend samen.

## 9. Aannames

- `softora_customers_premium_v1` blijft voorlopig de compatibele payloadvorm die UI's verwachten, ook wanneer structured Supabase leidend wordt.
- `databaseStatus` is de belangrijkste status voor lifecyclebeslissingen; `status` blijft legacy/visual compat.
- `klant` in `databaseStatus` betekent dat het record uit gewone leadlijsten/campagnes moet verdwijnen en in de klantenmodule mag verschijnen.
- `afgehaakt` en `geblokkeerd` betekenen dat automatische benadering moet stoppen.
- Een inbound coldmail reply met positieve intent hoort minimaal database-status `interesse` te krijgen, ook als er nog geen afspraakdatum is.
- Een inbound coldmail reply met stop/afmeld/geen-interesse hoort geen klantdata te maken en moet toekomstige outreach blokkeren.
- Supabase schemawijzigingen moeten veilig en additive zijn; destructieve migraties zijn niet passend voor deze fase.
