# Softora SEO Agent Measurement

Deze meting is niet bedoeld als dashboard voor gebruikers. Het is een agent-only kompas waarmee Codex SEO-werk kan prioriteren op basis van echte Search Console-data.

## Wat het meet

- organische klikken, vertoningen, CTR en gemiddelde positie
- huidige periode tegenover de vorige periode
- beste zoekopdrachten en landingspagina's
- zoekopdrachten met veel vertoningen maar lage CTR
- zoekopdrachten rond positie 5 tot 20 waar content of interne links kunnen helpen
- dalende pagina's die een refresh nodig hebben
- sitemap- en robots.txt-signalen

## Lokale run

```bash
node scripts/seo-agent-report.js
```

Zonder Google-koppeling draait het script alleen de publieke technische check. Met Google Search Console OAuth haalt het ook prestatiedata op.

## Benodigde Search Console-configuratie

Secrets mogen niet in tracked files. Gebruik lokale env vars of de geheime omgeving van de runner:

```bash
GSC_SITE_URL=sc-domain:softora.nl
GSC_CLIENT_ID=...
GSC_CLIENT_SECRET=...
GSC_REFRESH_TOKEN=...
```

Voor een worktree-onafhankelijke lokale setup op deze laptop kan hetzelfde blok ook in een gedeeld bestand staan:

```bash
~/.config/softora/search-console.env
```

De SEO-agent laadt eerst repo-lokale `.env*` bestanden en valt daarna terug op dit gedeelde bestand. Zo blijven nieuwe Codex-worktrees ook toegang houden tot dezelfde Search Console OAuth-config zonder secrets te tracken.

Optioneel kan tijdelijk een kortlevende access token gebruikt worden:

```bash
GSC_ACCESS_TOKEN=...
```

De benodigde OAuth-scope is:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

## Output

Het script schrijft:

- `reports/seo-agent/latest.json`
- `reports/seo-agent/latest.md`

Deze bestanden zijn lokaal agent-werkmateriaal en worden niet mee gecommit.

## Werkwijze

1. Draai het rapport.
2. Gebruik de actiequeue als prioriteitenlijst.
3. Bouw SEO-aanpassingen in kleine PR's.
4. Controleer na livegang opnieuw sitemap, robots en Search Console-data.
5. Herhaal wekelijks of dagelijks zodra de Google-koppeling stabiel is.
