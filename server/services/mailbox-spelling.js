const MAX_BODY_LENGTH = 20000;
const SPELLCHECK_TIMEOUT_MESSAGE = 'Spellingscontrole is tijdelijk niet beschikbaar.';

let defaultCheckerPromise = null;

async function loadDefaultChecker() {
  if (!defaultCheckerPromise) {
    defaultCheckerPromise = Promise.all([
      import('nspell'),
      import('dictionary-nl'),
    ]).then(([nspellModule, dictionaryModule]) => {
      const createSpell = nspellModule.default || nspellModule;
      return createSpell(dictionaryModule.default || dictionaryModule);
    });
  }
  return defaultCheckerPromise;
}

function splitProtectedSignature(text) {
  const signature = /^[ \t]*(?:met vriendelijke groet(?:en)?|vriendelijke groet(?:en)?|hartelijke groet(?:en)?|hoogachtend|groet(?:en)?|mvg)[,!]?[ \t]*(?:\r?\n|\r|$)/im.exec(text);
  if (!signature) return { editable: text, signature: '' };
  return {
    editable: text.slice(0, signature.index),
    signature: text.slice(signature.index),
  };
}

function protectLiteralTokens(text) {
  const values = [];
  const monthNames = 'januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december';
  const pattern = new RegExp([
    'https?:\\/\\/[^\\s<>]+',
    'www\\.[^\\s<>]+',
    "[a-z0-9.!#$%&'*+\\/=?^_`{|}~-]+@[a-z0-9.-]+\\.[a-z]{2,}",
    '(?:€|\\bEUR\\b)[ \\t]*\\d[\\d.,]*',
    `\\b\\d{1,2}[ \\t]+(?:${monthNames})[ \\t]+\\d{4}\\b`,
    '\\b\\d{4}-\\d{2}-\\d{2}\\b',
    '\\b\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{2,4}\\b',
    '\\b\\d{1,2}:\\d{2}\\b',
  ].join('|'), 'giu');
  const protectedText = text.replace(pattern, (value) => {
    const index = values.push(value) - 1;
    return `\uE000${index}\uE001`;
  });
  return {
    text: protectedText,
    restore(value) {
      return value.replace(/\uE000(\d+)\uE001/g, (_match, index) => values[Number(index)] || '');
    },
  };
}

function applyGrammarRules(text) {
  const rules = [
    [/\b(Ik|ik) vindt\b/g, (_match, subject) => `${subject} vind`],
    [/\b(Jij|jij|Je|je) vind\b/g, (_match, subject) => `${subject} vindt`],
    [/\b(Hij|hij|Het|het) heb\b/g, (_match, subject) => `${subject} heeft`],
    [/\b(Hun|hun) hebben\b/g, (_match, subject) => `${subject === 'Hun' ? 'Zij' : 'zij'} hebben`],
    [/\b(Dit|dit|Dat|dat) betekend\b/g, (_match, subject) => `${subject} betekent`],
  ];
  return rules.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

function applyPunctuationSpacing(text) {
  return text
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=\p{L})/gu, '$1 ')
    .replace(/([.!?])(?=\p{L})/gu, '$1 ');
}

function applyCapitalization(text) {
  const safeMidSentenceWords = 'Excuses|Bedankt|Dankjewel|Natuurlijk|Echter|Daarom|Daarnaast|Graag|Helaas|Prima|Klopt';
  let result = text.replace(
    new RegExp(`([,;:][ \\t]+)(${safeMidSentenceWords})\\b`, 'g'),
    (_match, prefix, word) => `${prefix}${word.toLocaleLowerCase('nl-NL')}`
  );
  result = result.replace(
    /(^|[.!?][ \t]+)(["'([{]*)(\p{Ll})/gmu,
    (_match, prefix, opening, letter) => `${prefix}${opening}${letter.toLocaleUpperCase('nl-NL')}`
  );
  return result;
}

function isAdjacentTransposition(source, target) {
  if (source.length !== target.length || source === target) return false;
  const mismatches = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== target[index]) mismatches.push(index);
  }
  return mismatches.length === 2
    && mismatches[1] === mismatches[0] + 1
    && source[mismatches[0]] === target[mismatches[1]]
    && source[mismatches[1]] === target[mismatches[0]];
}

function isSingleInsertionOrDeletion(source, target) {
  if (Math.abs(source.length - target.length) !== 1) return false;
  const shorter = source.length < target.length ? source : target;
  const longer = source.length < target.length ? target : source;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

function isSafeSuggestion(source, suggestion) {
  if (!/^[\p{Ll}]+$/u.test(source) || !/^[\p{Ll}]+$/u.test(suggestion)) return false;
  return isSingleInsertionOrDeletion(source, suggestion) || isAdjacentTransposition(source, suggestion);
}

function applySafeDictionaryCorrections(text, checker) {
  if (!checker || typeof checker.correct !== 'function' || typeof checker.suggest !== 'function') return text;
  return text.replace(/\b[\p{L}][\p{L}'’]{2,}\b/gu, (word) => {
    if (word !== word.toLocaleLowerCase('nl-NL') || word.length < 4 || checker.correct(word)) return word;
    const safeSuggestions = checker.suggest(word)
      .slice(0, 8)
      .map((suggestion) => String(suggestion || '').toLocaleLowerCase('nl-NL'))
      .filter((suggestion, index, values) => values.indexOf(suggestion) === index)
      .filter((suggestion) => isSafeSuggestion(word, suggestion));
    return safeSuggestions.length === 1 ? safeSuggestions[0] : word;
  });
}

async function correctDutchDraft(body, options = {}) {
  const original = typeof body === 'string' ? body : '';
  if (!original.trim()) {
    const error = new Error('Typ eerst je mailtekst.');
    error.status = 400;
    throw error;
  }
  if (original.length > MAX_BODY_LENGTH) {
    const error = new Error('De mailtekst is te lang voor spellingscontrole.');
    error.status = 413;
    throw error;
  }

  const checker = await (options.loadChecker || loadDefaultChecker)();
  const parts = splitProtectedSignature(original);
  const protectedTokens = protectLiteralTokens(parts.editable);
  let corrected = protectedTokens.text;
  corrected = applyPunctuationSpacing(corrected);
  corrected = applyGrammarRules(corrected);
  corrected = applySafeDictionaryCorrections(corrected, checker);
  corrected = applyCapitalization(corrected);
  corrected = protectedTokens.restore(corrected) + parts.signature;

  return {
    text: corrected,
    changed: corrected !== original,
  };
}

function createMailboxSpellingService(options = {}) {
  const logger = options.logger || console;
  const loadChecker = options.loadChecker || loadDefaultChecker;

  async function correctDraftResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await correctDutchDraft(body.body || body.text || '', { loadChecker });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      logger.error('[Mailbox][Spelling]', error?.message || error);
      const status = Number(error?.status) || 500;
      return res.status(status).json({
        ok: false,
        error: status >= 500 ? SPELLCHECK_TIMEOUT_MESSAGE : String(error?.message || 'Controleer de mailtekst.'),
      });
    }
  }

  return { correctDraftResponse };
}

module.exports = {
  MAX_BODY_LENGTH,
  applyCapitalization,
  applyGrammarRules,
  applyPunctuationSpacing,
  applySafeDictionaryCorrections,
  correctDutchDraft,
  createMailboxSpellingService,
  isSafeSuggestion,
  splitProtectedSignature,
};
