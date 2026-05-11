const REDACTED_EMAIL = '[redacted-email]';
const REDACTED_PHONE = '[redacted-phone]';
const REDACTED_SECRET = '[redacted-secret]';
const REDACTED_TOKEN = '[redacted-token]';
const REDACTED_RECORDING_URL = '[redacted-recording-url]';

function redactSensitiveLogText(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED_EMAIL)
    .replace(
      /\b(?:sk-[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|github_pat_[A-Za-z0-9_]{16,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,})\b/g,
      REDACTED_SECRET
    )
    .replace(/(?:\+?\d[\s().-]?){8,}\d/g, REDACTED_PHONE)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*\b/gi, `$1 ${REDACTED_TOKEN}`)
    .replace(
      /https?:\/\/[^\s"'<>]*(?:recording|recordings|audio|media)[^\s"'<>]*/gi,
      REDACTED_RECORDING_URL
    );
}

module.exports = {
  REDACTED_EMAIL,
  REDACTED_PHONE,
  REDACTED_RECORDING_URL,
  REDACTED_SECRET,
  REDACTED_TOKEN,
  redactSensitiveLogText,
};
