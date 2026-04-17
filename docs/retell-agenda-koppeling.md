# Retell AI Agenda Koppeling

Deze koppeling laat een Retell-agent vrije plekken in de Softora-agenda controleren. **Inplannen via Retell gebeurt niet meer:** afspraken vastleggen doe je in het dashboard of via je bestaande workflow buiten deze HTTP-functie.

De backend-route is:

- `POST /api/retell/functions/agenda/availability`

Gebruik altijd je publieke basis-URL ervoor, bijvoorbeeld:

- `https://jouwdomein.nl/api/retell/functions/agenda/availability`

## Belangrijk in Retell

- Gebruik bij voorkeur `Payload: args only` = `uit`
  Dan stuurt Retell ook het `call` object mee, inclusief `call_id` en metadata.
- Laat Retell de standaard `X-Retell-Signature` meesturen.
- Als je handmatig wilt testen, kun je ook `Authorization: Bearer <WEBHOOK_SECRET>` gebruiken als `WEBHOOK_SECRET` op de server staat.

## Custom function: agenda beschikbaarheid

Maak in Retell een custom function aan:

- Naam: `check_softora_agenda`
- Methode: `POST`
- URL: `https://jouwdomein.nl/api/retell/functions/agenda/availability`

Parameter schema:

```json
{
  "type": "object",
  "properties": {
    "date": {
      "type": "string",
      "description": "Gewenste datum in YYYY-MM-DD formaat"
    },
    "time": {
      "type": "string",
      "description": "Gewenste tijd in HH:MM formaat"
    },
    "timezone": {
      "type": "string",
      "description": "Tijdzone van de afspraak, standaard Europe/Amsterdam"
    },
    "slotMinutes": {
      "type": "number",
      "description": "Duur van een afspraak in minuten, standaard 60"
    },
    "maxSuggestions": {
      "type": "number",
      "description": "Maximaal aantal alternatieve tijdsloten"
    },
    "businessHoursStart": {
      "type": "string",
      "description": "Start werktijd in HH:MM, standaard 09:00"
    },
    "businessHoursEnd": {
      "type": "string",
      "description": "Einde werktijd in HH:MM, standaard 17:00"
    }
  }
}
```

Retell krijgt terug:

- `available`
- `requestedSlot`
- `availableSlots`
- `message`

## Prompt-aanvulling voor je agent

Zet iets in deze richting in je agent-instructie:

```text
Als de prospect een datum of tijd noemt, controleer eerst de agenda met `check_softora_agenda`.

Als het gekozen moment bezet is, geef maximaal 2 concrete alternatieven uit de functie terug.

Leg de afspraak vast in Softora zoals jullie dat normaal doen (dashboard of interne flow); deze server-endpoint boekt niet automatisch in.
```

Verwijder in Retell eventuele oude custom function `book_softora_appointment` en bijbehorende URL’s; die route bestaat niet meer.

## Handige standaard voor de eerste versie

- Tijdzone: `Europe/Amsterdam`
- Duur: `60` minuten
- Werkuren: `09:00` t/m `17:00`

## Wat deze versie wel en niet doet

Wel:

- bestaande agenda-afspraken controleren
- conflicten op exact dezelfde datum en tijd signaleren
- alternatieve slots teruggeven

Nog niet:

- afspraken via Retell wegschrijven naar de agenda
- reistijd tussen afspraken berekenen
- verschillende afspraakduren per type afspraak
- meerdere agenda's of medewerkers apart plannen

Als je dat later wilt, kun je deze koppeling uitbreiden met medewerker-keuze, afspraaktypes en buffers tussen meetings.
