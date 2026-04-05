const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAddActiveOrderRequest,
  validateConfirmationMailSyncRequest,
  validateInterestedLeadDismissRequest,
  validatePostCallRequest,
  validateSendEmailRequest,
} = require('../../server/schemas/agenda');

test('post-call validator normalizes fallback appointment payloads', () => {
  const result = validatePostCallRequest({
    params: {},
    query: { appointmentId: ' 42 ' },
    body: {
      actor: ' Serve ',
      transcript: ' transcript ',
      prompt: ' prompt ',
      domain: ' demo.nl ',
      attachments: [{ id: 'img-1' }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.query.appointmentId, '42');
  assert.equal(result.body.actor, 'Serve');
  assert.equal(result.body.doneBy, 'Serve');
  assert.equal(result.body.postCallNotesTranscript, 'transcript');
  assert.equal(result.body.postCallPrompt, 'prompt');
  assert.equal(result.body.postCallDomainName, 'demo.nl');
  assert.deepEqual(result.body.referenceImages, [{ id: 'img-1' }]);
});

test('add-active-order validator keeps only agenda-relevant fields', () => {
  const result = validateAddActiveOrderRequest({
    params: { id: '88' },
    query: {},
    body: {
      doneBy: ' Admin ',
      amount: '2499.4',
      status: 'wacht',
      title: ' Nieuwe opdracht ',
      prompt: ' Bouw een site ',
      attachments: [{ id: 'img-2' }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.params.id, '88');
  assert.equal(result.body.actor, 'Admin');
  assert.equal(result.body.amount, 2499);
  assert.equal(result.body.title, 'Nieuwe opdracht');
  assert.equal(result.body.postCallPrompt, 'Bouw een site');
  assert.deepEqual(result.body.referenceImages, [{ id: 'img-2' }]);
});

test('interested-lead dismiss validator requires a callId', () => {
  const missing = validateInterestedLeadDismissRequest({
    params: {},
    query: {},
    body: {},
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /callId ontbreekt/i);

  const valid = validateInterestedLeadDismissRequest({
    params: {},
    query: { callId: ' call-123 ' },
    body: { doneBy: ' Admin ' },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.body.callId, 'call-123');
  assert.equal(valid.body.actor, 'Admin');
});

test('confirmation mail sync validator clamps maxMessages to safe limits', () => {
  const low = validateConfirmationMailSyncRequest({
    body: { maxMessages: '2', actor: ' Sync ' },
  });
  assert.equal(low.ok, true);
  assert.equal(low.body.maxMessages, 10);
  assert.equal(low.body.actor, 'Sync');

  const high = validateConfirmationMailSyncRequest({
    body: { maxMessages: '9999' },
  });
  assert.equal(high.ok, true);
  assert.equal(high.body.maxMessages, 400);
});

test('send email validator normalizes recipient aliases and task fallback id', () => {
  const result = validateSendEmailRequest({
    params: {},
    query: { taskId: ' 17 ' },
    body: {
      email: ' klant@example.com ',
      actor: ' Medewerker ',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.query.taskId, '17');
  assert.equal(result.body.recipientEmail, 'klant@example.com');
  assert.equal(result.body.email, 'klant@example.com');
  assert.equal(result.body.actor, 'Medewerker');
});
