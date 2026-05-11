# Softora Security Hardening Runbook

Datum: 11 mei 2026

Dit runbook hoort bij `security-reports/softora-securityrapport-2026-05-11.pdf`. Het beschrijft alleen veilige vervolgstappen. Productie-instellingen, secrets en databasepolicies worden niet live aangepast zonder aparte expliciete toestemming.

## P0 Uitvoering

1. Draai altijd eerst `npm run backup:runtime` voor wijzigingen in server, auth, agenda, leads of coldcalling.
2. Draai daarna de gerichte test voor de gewijzigde module.
3. Draai vóór afronding `npm run verify:critical`.
4. Commit alleen de bestanden die bij de securitybatch horen.
5. Push naar een `codex/*` branch en open daarna een PR naar `main`.

## Key Rotation Checklist

Roteer handmatig in de provider dashboards, niet via code:

- Supabase anon/publishable key als frontend bundle of logs verdacht zijn.
- Supabase service-role key na iedere mogelijke blootstelling; service-role blijft alleen server-side.
- OpenAI/Anthropic/AI provider keys.
- Retell/Vapi/Twilio keys en webhook secrets.
- IMAP/SMTP/mailbox credentials.
- Vercel/hosting tokens en project environment variables.

Na rotatie:

- Update alleen hosting secret storage, niet tracked files.
- Redeploy staging.
- Controleer login, mailbox, AI, coldcalling en Supabase storage met testdata.
- Trek oude keys in nadat staging en productie gezond zijn.

## Supabase RLS Policyplan

Niet live toepassen zonder aparte toestemming.

| Tabel | Minimale policy-eis | Test |
| --- | --- | --- |
| `softora_runtime_state` | alleen server/service-role of expliciete admin tenant-scope | gewone gebruiker mag geen brede state lezen |
| `softora_customers` | `company_id`/tenant of eigenaar-koppeling verplicht bij select/update/delete | gebruiker A ziet klant B niet |
| `softora_active_orders` | order moet bij toegestane klant/tenant horen | IDOR met order-ID faalt |
| `softora_order_runtime` | gekoppeld aan toegestane order | runtime van andere order faalt |
| `softora_design_photos` | object hoort bij toegestane klant/tenant | directe storage/path toegang faalt |
| `softora_webdesign_jobs` | `owner_key` of tenant-eigenaar verplicht | job van andere eigenaar faalt |

Veilige aanpak:

1. Maak twee testgebruikers en twee gescheiden testklanten.
2. Maak policies eerst op staging.
3. Test `select`, `insert`, `update`, `delete` per tabel.
4. Controleer dat server/service-role flows nog werken.
5. Pas daarna een migration toe op productie.

## Rollback

- Code: revert de batchcommit.
- Headers: verwijder of versoepel alleen de laatst toegevoegde headerwaarde.
- Rate limits: verhoog tijdelijk `max` of verwijder alleen de gerichte limiter.
- RLS: revert de migration of zet de vorige policy terug.
- Keys: oude key alleen tijdelijk heractiveren als productie stilvalt; daarna alsnog roteren.

## Monitoring

Maak alerts op:

- login rate-limit hits;
- admin-only UI-state denials;
- mailbox send rate-limit hits;
- AI endpoint rate-limit hits;
- exports/downloads;
- delete/launch/generate acties;
- Supabase storage access errors;
- webhook signature failures.
