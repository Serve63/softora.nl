const PASSWORD_REGISTER_ENCRYPTED_KEY = 'entries_encrypted_v1';
const PASSWORD_REGISTER_LEGACY_KEY = 'entries_json';
const PASSWORD_REGISTER_ALLOWED_VALUE_KEYS = new Set([
  PASSWORD_REGISTER_ENCRYPTED_KEY,
  PASSWORD_REGISTER_LEGACY_KEY,
  'updated_at',
  'updated_by',
]);
const PASSWORD_REGISTER_ENVELOPE_FIELDS = new Set([
  'version',
  'algorithm',
  'kdf',
  'iterations',
  'salt',
  'iv',
  'ciphertext',
]);
const PASSWORD_REGISTER_ITERATIONS_BY_VERSION = Object.freeze({
  1: 210000,
  2: 600000,
});
const PASSWORD_REGISTER_CURRENT_VERSION = 2;
const PASSWORD_REGISTER_MAX_CIPHERTEXT_BYTES = 180000;

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function invalid(reason) {
  return {
    ok: false,
    code: 'PASSWORD_REGISTER_VAULT_INVALID',
    error: 'Versleutelde wachtwoordenkluis heeft een ongeldig of onveilig formaat.',
    reason,
  };
}

function decodeStrictBase64(value, expectedLength = null) {
  const encoded = normalizeString(value);
  if (!encoded || encoded.length > 260000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.toString('base64') !== encoded) return null;
    if (expectedLength !== null && bytes.length !== expectedLength) return null;
    return bytes;
  } catch (_error) {
    return null;
  }
}

function validatePasswordRegisterEnvelope(serializedEnvelope, options = {}) {
  const serialized = normalizeString(serializedEnvelope);
  if (!serialized || serialized.length > 250000) return invalid('encrypted envelope ontbreekt of is te groot');

  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch (_error) {
    return invalid('encrypted envelope bevat ongeldige JSON');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return invalid('encrypted envelope is geen object');
  }
  const keys = Object.keys(envelope);
  if (
    keys.length !== PASSWORD_REGISTER_ENVELOPE_FIELDS.size ||
    keys.some((key) => !PASSWORD_REGISTER_ENVELOPE_FIELDS.has(key))
  ) {
    return invalid('encrypted envelope bevat onverwachte velden');
  }

  const version = Number(envelope.version);
  const expectedIterations = PASSWORD_REGISTER_ITERATIONS_BY_VERSION[version];
  if (!expectedIterations) return invalid('encrypted envelope-versie wordt niet ondersteund');
  if (options.requireCurrentVersion && version !== PASSWORD_REGISTER_CURRENT_VERSION) {
    return invalid('nieuwe opslag moet het actuele encrypted envelope-formaat gebruiken');
  }
  if (normalizeString(envelope.algorithm) !== 'AES-GCM') return invalid('algoritme is ongeldig');
  if (normalizeString(envelope.kdf) !== 'PBKDF2-SHA256') return invalid('KDF is ongeldig');
  if (Number(envelope.iterations) !== expectedIterations) return invalid('KDF-iteraties zijn ongeldig');

  const salt = decodeStrictBase64(envelope.salt, 16);
  const iv = decodeStrictBase64(envelope.iv, 12);
  const ciphertext = decodeStrictBase64(envelope.ciphertext);
  if (!salt) return invalid('salt is ongeldig');
  if (!iv) return invalid('IV is ongeldig');
  if (!ciphertext || ciphertext.length < 17 || ciphertext.length > PASSWORD_REGISTER_MAX_CIPHERTEXT_BYTES) {
    return invalid('ciphertext is ongeldig of te groot');
  }

  return {
    ok: true,
    version,
    iterations: expectedIterations,
    ciphertextBytes: ciphertext.length,
  };
}

function validatePasswordRegisterValues(values, options = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return invalid('vault values zijn geen object');
  }
  const keys = Object.keys(values);
  if (keys.some((key) => !PASSWORD_REGISTER_ALLOWED_VALUE_KEYS.has(key))) {
    return invalid('vault values bevatten onverwachte velden');
  }
  if (normalizeString(values[PASSWORD_REGISTER_LEGACY_KEY])) {
    return invalid('legacy plaintext-opslag is niet toegestaan');
  }

  const encrypted = normalizeString(values[PASSWORD_REGISTER_ENCRYPTED_KEY]);
  if (!encrypted) {
    if (options.requireEncrypted) return invalid('encrypted envelope ontbreekt');
    if (keys.some((key) => key !== PASSWORD_REGISTER_LEGACY_KEY)) {
      return invalid('vault metadata zonder encrypted envelope is niet toegestaan');
    }
    return { ok: true, empty: true, version: null, ciphertextBytes: 0 };
  }

  if (Object.prototype.hasOwnProperty.call(values, 'updated_at')) {
    const updatedAt = normalizeString(values.updated_at);
    if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return invalid('updated_at is ongeldig');
  }
  if (Object.prototype.hasOwnProperty.call(values, 'updated_by')) {
    const updatedBy = normalizeString(values.updated_by);
    if (!updatedBy || updatedBy.length > 60 || !/^[a-z0-9:_-]+$/i.test(updatedBy)) {
      return invalid('updated_by is ongeldig');
    }
  }

  return validatePasswordRegisterEnvelope(encrypted, {
    requireCurrentVersion: Boolean(options.requireCurrentVersion),
  });
}

module.exports = {
  PASSWORD_REGISTER_CURRENT_VERSION,
  PASSWORD_REGISTER_ENCRYPTED_KEY,
  PASSWORD_REGISTER_LEGACY_KEY,
  validatePasswordRegisterEnvelope,
  validatePasswordRegisterValues,
};
