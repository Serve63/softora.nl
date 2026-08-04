function getLineNumber(source, index) {
  return String(source || '').slice(0, Math.max(0, Number(index) || 0)).split('\n').length;
}

function findUnsafeCredentialFixtures(source, options = {}) {
  const text = String(source || '');
  const findings = [];

  for (const match of text.matchAll(/[A-Z0-9._%+-]+@softora\.nl\b/gi)) {
    findings.push({ kind: 'production-email', line: getLineNumber(text, match.index) });
  }

  for (const match of text.matchAll(/[A-Za-z0-9!@#$%^&*+?~_-]{8,}/g)) {
    const token = match[0];
    const looksLikeCredential =
      /[A-Z]/.test(token) &&
      /[a-z]/.test(token) &&
      /\d/.test(token) &&
      /[!@#$%^&*+?~]/.test(token);
    if (looksLikeCredential) {
      findings.push({ kind: 'production-shaped-secret', line: getLineNumber(text, match.index) });
    }
  }

  if (!options.allowPasswordFields) {
    for (const match of text.matchAll(/\bpw\s*:\s*(['"`])([^\n]*?)\1/g)) {
      if (!String(match[2] || '').startsWith('fixture-')) {
        findings.push({ kind: 'non-fixture-password-field', line: getLineNumber(text, match.index) });
      }
    }
  }

  return findings;
}

module.exports = {
  findUnsafeCredentialFixtures,
};
