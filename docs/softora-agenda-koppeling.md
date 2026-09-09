# Softora Agenda in ChatGPT en Codex

MCP URL: `https://www.softora.nl/integrations/agenda/mcp`.

Voeg in ChatGPT een eigen plugin toe met de naam **Softora Agenda**, deze server-URL en OAuth. Log bij de koppeling in op Softora met een actief Full Access-account. De toestemmingspagina benoemt de gedeelde agenda en de aangevraagde rechten. Codex kan dezelfde HTTP MCP-server gebruiken; de persoonlijke plugin `softora-agenda` bevat de configuratie zonder geheimen.

Tools: `list_appointments`, `create_appointment`, `update_appointment`. Tijdzone: Europe/Amsterdam. Wijzigen geldt alleen voor handmatige afspraken; afspraken met herhaling of een aparte activiteitstijd blijven in de Agenda App. Verwijderen wordt niet aangeboden. Eindtijden zijn niet altijd bekend, dus een lijst bewijst geen beschikbaarheid. Een overzicht kan na 1000 afspraken afgekapt zijn en vermeldt dat expliciet.

De bestaande agenda-coördinatoren blijven de bron voor lezen, muteren, opslag en bestaande Google Calendar-synchronisatie. De koppeling verstuurt geen uitnodigingsmails en gebruikt geen AI-API. Er is geen nieuwe hostingdienst nodig.

OAuth gebruikt authorization code + S256 PKCE, een expliciete toestemmingspagina, exacte OpenAI/loopback-redirects, afzonderlijke agendascopes, tokens met een agendadoel en verse gebruikersvalidatie. Codes en tokens worden alleen gehasht opgeslagen in `softora_agenda_mcp_records`; gewone gebruikers en anon hebben geen tabelrechten. Een grant vervalt na 30 dagen, access tokens na een uur. Een geblokkeerd account of gewijzigde authVersion blokkeert toegang. Het OAuth revoke-endpoint trekt de volledige grant in.

Schrijfacties eisen een unieke `request_id`. Herhaal dezelfde aanvraag alleen met dezelfde ID. Een centrale unieke reservering voorkomt opnieuw uitvoeren na een timeout; bij onbekende of pending opslag moet eerst de agenda worden gecontroleerd. Resultaat `saved` bevestigt opslag; een 202 doet dat niet.

Release: pas de bijbehorende Supabase-migratie toe, doorloop `npm run verify:critical`, merge via de beschermde PR-route en controleer `npm run check:live-production-version`. Controleer OAuth discovery, een ongeautoriseerde 401 en na gebruikerskoppeling een echte leesactie in beide clients. Tokens/cookies nooit kopiëren tussen browsers of in bestanden bewaren.

Bronnen: https://developers.openai.com/apps-sdk/build/auth en https://developers.openai.com/codex/mcp.
