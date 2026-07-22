const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMailboxDraftRewriteSystemPrompt,
  buildMailboxReplySystemPrompt,
  inferMailboxReplyFirstName,
} = require('../../server/services/mailbox-reply-prompt');

test('mailbox reply prompt kiest de ondertekende voornaam uit de nieuwste reactie', () => {
  assert.equal(
    inferMailboxReplyFirstName({
      from: 'De Vyldre',
      body: [
        'Hoi Servé,',
        '',
        'We hebben al een goede partij waar we tevreden mee zijn.',
        '',
        'Groet,',
        'Daffy',
        '',
        'Op 20 jul 2026 heeft Servé Creusen het volgende geschreven:',
        'Goedendag,',
      ].join('\n'),
    }),
    'Daffy'
  );
});

test('mailbox reply prompt gebruikt geen bedrijfsnaam als aanhefnaam', () => {
  assert.equal(inferMailboxReplyFirstName({ from: 'De Vyldre', body: 'Geen interesse.' }), '');
  assert.equal(inferMailboxReplyFirstName({ from: 'Rijs Textiles', body: 'Bedankt.' }), '');
});

test('Malik reply prompt dwingt een informele en contextspecifieke reactie af', () => {
  const prompt = buildMailboxReplySystemPrompt({ senderName: 'Servé Creusen' });

  assert.match(prompt, /Je bent Malik Mailing/);
  assert.match(prompt, /Begin met "Hoi \[voornaam\],"/);
  assert.match(prompt, /Gebruik nooit Beste, Geachte, meneer, mevrouw/);
  assert.match(prompt, /fijn dat je al een goede partij hebt waar je tevreden mee bent 😁/);
  assert.match(prompt, /Ik zal je niet meer mailen/);
  assert.match(prompt, /je gegevens niet verder mailen/);
  assert.match(prompt, /Met vriendelijke groet,[\s\S]*Servé Creusen/);
});

test('los concept houdt de gewone herschrijfprompt', () => {
  const prompt = buildMailboxDraftRewriteSystemPrompt({ senderName: 'Martijn van de Ven' });

  assert.match(prompt, /mailherschrijver van Softora/);
  assert.match(prompt, /afzenderProfiel\.aiInstructions/);
  assert.doesNotMatch(prompt, /Malik Mailing/);
});
