# Retell AI Agenda Koppeling

Deze koppeling laat een Retell-agent:

1. vrije plekken in de Softora-agenda controleren
2. een afspraak direct in de agenda zetten

De backend-routes zijn:

- `POST /api/retell/functions/agenda/availability`
- `POST /api/retell/functions/agenda/book`

Gebruik altijd je publieke basis-URL ervoor, bijvoorbeeld:

- `https://jouwdomein.nl/api/retell/functions/agenda/availability`
- `https://jouwdomein.nl/api/retell/functions/agenda/book`

## Belangrijk in Retell

- Gebruik bij voorkeur `Payload: args only` = `uit`
  Dan stuurt Retell ook het `call` object mee, inclusief `call_id` en metadata.
- Laat Retell de standaard `X-Retell-Signature` meesturen.
- Als je handmatig wilt testen, kun je ook `Authorization: Bearer <WEBHOOK_SECRET>` gebruiken als `WEBHOOK_SECRET` op de server staat.

## Functie 1: Agenda Beschikbaarheid

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

## Functie 2: Afspraak Inboeken

Maak in Retell een tweede custom function aan:

- Naam: `book_softora_appointment`
- Methode: `POST`
- URL: `https://jouwdomein.nl/api/retell/functions/agenda/book`

Parameter schema:

```json
{
  "type": "object",
  "required": ["date", "time", "location"],
  "properties": {
    "date": {
      "type": "string",
      "description": "Afspraakdatum in YYYY-MM-DD formaat"
    },
    "time": {
      "type": "string",
      "description": "Afspraaktijd in HH:MM formaat"
    },
    "location": {
      "type": "string",
      "description": "Adres of locatie van de afspraak"
    },
    "company": {
      "type": "string",
      "description": "Bedrijfsnaam van de prospect"
    },
    "contact": {
      "type": "string",
      "description": "Naam van de contactpersoon"
    },
    "phone": {
      "type": "string",
      "description": "Telefoonnummer van de prospect"
    },
    "contactEmail": {
      "type": "string",
      "description": "E-mailadres van de prospect"
    },
    "branche": {
      "type": "string",
      "description": "Branche of sector"
    },
    "summary": {
      "type": "string",
      "description": "Korte samenvatting van de afspraak"
    },
    "whatsappInfo": {
      "type": "string",
      "description": "Extra notities voor route of bevestiging"
    },
    "whatsappConfirmed": {
      "type": "boolean",
      "description": "Of WhatsApp-bevestiging al besproken is"
    },
    "timezone": {
      "type": "string",
      "description": "Tijdzone van de afspraak, standaard Europe/Amsterdam"
    }
  }
}
```

De route gebruikt automatisch de `call.call_id` van Retell om de afspraak aan de juiste call te koppelen.

## Prompt-aanvulling voor je agent

Zet iets in deze richting in je agent-instructie:

```text
Als de prospect een datum of tijd noemt, controleer eerst de agenda met `check_softora_agenda`.

Boek een afspraak pas als je datum, tijd en locatie expliciet hebt bevestigd.

Als het gekozen moment bezet is, geef maximaal 2 concrete alternatieven uit de functie terug.

Gebruik daarna `book_softora_appointment` om de afspraak definitief in te plannen.
```

## Handige standaard voor de eerste versie

- Tijdzone: `Europe/Amsterdam`
- Duur: `60` minuten
- Werkuren: `09:00` t/m `17:00`

## Wat deze versie wel en niet doet

Wel:

- bestaande agenda-afspraken controleren
- conflicten op exact dezelfde datum en tijd blokkeren
- alternatieve slots teruggeven
- afspraak direct in Softora opslaan

Nog niet:

- reistijd tussen afspraken berekenen
- verschillende afspraakduren per type afspraak
- meerdere agenda's of medewerkers apart plannen

Als je dat later wilt, kun je deze koppeling uitbreiden met medewerker-keuze, afspraaktypes en buffers tussen meetings.
