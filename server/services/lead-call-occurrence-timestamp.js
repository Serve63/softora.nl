'use strict';

// Pure helper om het stabiele "moment van het gesprek" te bepalen voor een
// interessante-lead-rij. Deze timestamp is het anker waartegen de dismiss-filter
// vergelijkt, en moet daarom ONveranderlijk zijn voor de identiteit van een call.
//
// Reden van bestaan: de bestaande recency-helpers mengen gespreks-tijd met
// procesmatige tijden (AI `analyzedAt`, generieke `updatedAt`, fallback naar
// `Date.now()`). Dat betekent dat een late AI-reanalyse of een passieve sync
// de waargenomen "rowTs" stil kon oprekken tot NA het dismiss-moment, waardoor
// eerder verwijderde leads spontaan terugkwamen in het overzicht.
//
// Contract:
//   - Wij accepteren N bronnen (update, insight, task, appointment, row).
//   - Wij kijken alleen naar velden die *het gesprek zelf* beschrijven:
//       `callOccurredAtMs`, `endedAtMs`, `startedAtMs`,
//       `callOccurredAt`, `endedAt`, `startedAt`,
//       `confirmationTaskCreatedAt` (stabiel na aanmaken, niet updated).
//   - Wij kijken NIET naar `analyzedAt`, `updatedAt`, `createdAt` of
//     `updatedAtMs`, omdat die door processen ná het gesprek verhoogd kunnen
//     worden en dus niet het gespreksmoment representeren.
//   - Wij retourneren de HOOGSTE stabiele tijd die we vinden (meestal gelijk
//     aan endedAt, tenzij er toch een hardere tijd uit een andere bron komt).
//   - Als geen enkele bron een stabiele tijd oplevert, retourneren we 0.

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

function parseIsoToMs(value) {
  const text = normalizeString(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function pickPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function stableMsFromSource(source) {
  if (!source || typeof source !== 'object') return 0;

  const explicit = [
    pickPositiveNumber(source.callOccurredAtMs),
    pickPositiveNumber(source.endedAtMs),
    pickPositiveNumber(source.startedAtMs),
  ].filter((value) => value > 0);

  if (explicit.length) return Math.max(...explicit);

  const parsed = [
    parseIsoToMs(source.callOccurredAt),
    parseIsoToMs(source.endedAt),
    parseIsoToMs(source.startedAt),
    parseIsoToMs(source.confirmationTaskCreatedAt),
  ].filter((value) => value > 0);

  if (parsed.length) return Math.max(...parsed);

  return 0;
}

function resolveStableCallOccurrenceMs(...sources) {
  let best = 0;
  for (const source of sources) {
    const candidate = stableMsFromSource(source);
    if (candidate > best) best = candidate;
  }
  return best;
}

function resolveStableCallOccurrenceIso(...sources) {
  const ms = resolveStableCallOccurrenceMs(...sources);
  if (ms > 0) return new Date(ms).toISOString();
  return '';
}

module.exports = {
  resolveStableCallOccurrenceMs,
  resolveStableCallOccurrenceIso,
};
