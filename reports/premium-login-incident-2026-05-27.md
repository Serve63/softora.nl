# Premium Login Incident - 2026-05-27

## Samenvatting

Op 2026-05-27 meldde Servé dat inloggen met `serve@softora.nl` faalde met `Ongeldige inloggegevens.`. Read-only checks tonen dat productie zelf bereikbaar was, premium auth geconfigureerd was en 2FA uit stond. De opvallende afwijking zit in de Supabase-row `premium_auth_users`: die is direct bijgewerkt met meta `source=codex_autopilot_test`, buiten de normale premium-gebruikersroutes om.

Dit rapport bevat geen wachtwoordhashes, secrets of wachtwoorden.

## Tijdlijn

| Tijd NL | Tijd UTC | Bevinding |
| --- | --- | --- |
| 2026-05-27 22:01:56 | 2026-05-27T20:01:56.896Z | Laatste bekende `login_success` voor `serve@softora.nl` in de runtime security-audit. |
| 2026-05-27 23:25:10 | 2026-05-27T21:25:10.346Z | Eerste bekende recente `login_failed` voor `serve@softora.nl` met detail `Ongeldige inloggegevens.` |
| 2026-05-27 23:28:59 | 2026-05-27T21:28:59.426391Z | Supabase-row `premium_auth_users` bijgewerkt met `source=codex_autopilot_test`, `reason=remove temporary autopilot proof admin users`, `actorEmail=codex-autopilot-1779875563175@softora.test`. |
| 2026-05-27 23:43:37 | 2026-05-27T21:43:37Z | Live `/api/auth/session` gaf `configured=true`, `authenticated=false`, `mfaEnabled=false`. |

## Read-Only Productiecheck

- Live health endpoint: `ok=true`.
- Live deployment: commit `24d457b16cd87800f02a3a410f861f288c90a878`, ref `main`, provider `vercel`.
- Lokale `HEAD` en `origin/main` stonden op dezelfde commit tijdens onderzoek.
- `premium_auth_users` bevatte nog twee actieve adminaccounts: `serve@softora.nl` en `martijn@softora.nl`.
- Beide accounts hadden een aanwezige `scrypt` password-hash; hashwaarden zijn bewust niet vastgelegd.

## Automations

Rond 2026-05-27 23:20-23:45 NL zijn in de lokale Codex session/automation bestanden geen session- of logbestanden met filesystem-mtime in dat venster gevonden. De relevante bestaande automations:

- `softora-coldmail-hourly-monitor`: actief, hourly heartbeat, prompt gebruikt Supabase en mag alleen beperkte coldmail-autopilot state herstellen.
- `coldmail-autopilot-monitor`: gepauzeerd, 30-min heartbeat, read-only/monitoring intent.

Deze prompts zijn aangescherpt met een expliciet verbod om `premium_auth_users` te wijzigen.

## Conclusie

De auth-code zelf lijkt niet de primaire oorzaak: de gerichte auth-contracttests waren groen. De sterkste aanwijzing is een directe Supabase-write naar `premium_auth_users` met een test/autopilot-meta source. Dat hoort niet via automations of losse scripts te gebeuren. Premium gebruikersbeheer moet uitsluitend via de bestaande premium-gebruikersroutes/store lopen.

Tijdens herstel op 2026-05-28 bleek daarnaast dat een warme live-instance bij login eerst de bestaande premium-gebruikerscache gebruikte. Daardoor kon een correcte Supabase-reset nog steeds tijdelijk als ongeldig wachtwoord uitpakken. De loginflow is aangescherpt zodat hij vóór de wachtwoordcontrole eerst een verse hydrate forceert en alleen daarna terugvalt.

## Preventie

- Guardrails blokkeren nieuwe directe of ongeautoriseerde writes naar `premium_auth_users` in repo-diffs.
- Goedgekeurde write-sources blijven beperkt tot de officiële premium-gebruikersflow: `bootstrap_env`, `premium_profile_update`, `premium_users_api_create`, `premium_users_api_update`, `premium_users_api_delete`.
- Automations die Supabase raadplegen krijgen expliciet de instructie om `premium_auth_users` nooit te wijzigen.
