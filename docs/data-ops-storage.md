# Softora Data Ops Storage

## Bron Van Waarheid
Nieuwe klant-, database-, dashboard- en designfoto-data hoort niet meer als business-truth in `softora_runtime_state` of losse `ui_state:*` JSON te leven.

De gestructureerde bronnen zijn:
- `softora_customers`: klanten en database-bedrijven.
- `softora_active_orders`: actieve opdrachten.
- `softora_order_runtime`: runtime-status per opdracht.
- `softora_design_photos`: metadata van database-designfoto's.
- Supabase Storage bucket `softora-design-photos`: de echte afbeeldingsbestanden.
- `softora_webdesign_jobs`: status van AI-webdesignfoto-jobs.
- `softora_mailbox_messages`: snelle mailbox-index met metadata en recente tekstbody's.
- `softora_mailbox_sync_state`: status en lockinformatie voor IMAP-naar-index synchronisatie.
- `softora_outbound_recipient_guards`: server-side duplicate-guard voor Softora/Gmail/Strato en Instantly-outbound.

## Compatibiliteit
De oude UI-state scopes blijven tijdelijk fallback:
- `premium_customers_database`
- `premium_active_orders`
- `premium_database_photos`

De compat-laag zit achter de bestaande `/api/ui-state*` routes. Daardoor blijven bestaande pagina's dezelfde response-shape ontvangen terwijl de server de data ook naar de nieuwe tabellen spiegelt.

## Migratie
1. Pas `supabase/data-ops-schema.sql` toe in Supabase.
2. Controleer `/api/data-health` met debug/admin-toegang.
3. Draai `node scripts/migrate-data-ops.js` voor dry-run tellingen.
4. Draai `node scripts/migrate-data-ops.js --write` pas als de tellingen kloppen.
5. Laat de oude UI-state minimaal één release als fallback bestaan.
