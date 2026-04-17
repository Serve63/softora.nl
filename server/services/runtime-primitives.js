function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeColdcallingStack(value) {
  const raw = normalizeString(value).toLowerCase();
  if (
    raw === 'gemini_flash_3_1_live' ||
    raw === 'gemini flash 3.1 live' ||
    raw === 'gemini_3_1_live' ||
    raw === 'gemini'
  ) {
    return 'gemini_flash_3_1_live';
  }
  if (
    raw === 'openai_realtime_1_5' ||
    raw === 'openai realtime 1.5' ||
    raw === 'openai_realtime' ||
    raw === 'openai'
  ) {
    return 'openai_realtime_1_5';
  }
  if (
    raw === 'hume_evi_3' ||
    raw === 'hume evi 3' ||
    raw === 'hume_evi' ||
    raw === 'hume'
  ) {
    return 'hume_evi_3';
  }
  return 'retell_ai';
}

function normalizeNlPhoneToE164(input) {
  const raw = normalizeString(input);

  if (!raw) {
    throw new Error('Telefoonnummer ontbreekt');
  }

  let cleaned = raw.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith('+')) {
    const normalized = `+${cleaned.slice(1).replace(/\D/g, '')}`;

    if (!/^\+\d{8,15}$/.test(normalized)) {
      throw new Error(`Ongeldig E.164 nummer: ${raw}`);
    }

    if (normalized.startsWith('+31')) {
      const nlDigits = normalized.slice(3);
      if (nlDigits.length !== 9) {
        throw new Error(`NL nummer heeft niet 9 cijfers na +31: ${raw}`);
      }
    }

    return normalized;
  }

  const digits = cleaned.replace(/\D/g, '');

  if (digits.startsWith('31')) {
    const nlDigits = digits.slice(2);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 9 cijfers na 31: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.startsWith('0')) {
    const nlDigits = digits.slice(1);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 10 cijfers inclusief 0: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.length === 9 && digits.startsWith('6')) {
    return `+31${digits}`;
  }

  throw new Error(`Kan nummer niet omzetten naar NL E.164 formaat: ${raw}`);
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function clipText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  if (!Number.isFinite(Number(maxLength)) || Number(maxLength) <= 0) return '';
  const limit = Math.floor(Number(maxLength));
  return text.length > limit ? text.slice(0, limit) : text;
}

module.exports = {
  clipText,
  escapeHtml,
  normalizeColdcallingStack,
  normalizeNlPhoneToE164,
  normalizeString,
  parseIntSafe,
  parseNumberSafe,
  truncateText,
};
