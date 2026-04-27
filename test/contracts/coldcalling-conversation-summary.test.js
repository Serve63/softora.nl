const test = require('node:test');
const assert = require('node:assert/strict');

const summaryHelpers = require('../../assets/coldcalling-conversation-summary.js');

test('coldcalling conversation summary helpers clean speaker labels and follow-up boilerplate', () => {
  assert.equal(
    summaryHelpers.sanitizeConversationSummaryCopy(
      'Agent: De klant wil een nieuwe website bespreken. De logische vervolgstap is om de afspraak intern op te volgen.'
    ),
    'De klant wil een nieuwe website bespreken.'
  );
  assert.equal(
    summaryHelpers.sanitizeConversationSummaryCopy('De agent van Softora heeft de websitewens besproken.'),
    'Ruben Nijhuis van Softora heeft de websitewens besproken.'
  );
});

test('coldcalling conversation summary picker rejects noisy summaries before accepting readable Dutch copy', () => {
  const readable = summaryHelpers.pickReadableConversationSummary(
    'Samenvatting wordt opgesteld op basis van de transcriptie.',
    'User: hallo | bot: goedemiddag | user: ik wil een site | bot: prima',
    'Op 2026-04-27 is de afspraak ingepland en de bevestigingsmail sturen is de volgactie.',
    'The call was with a user and the agent mentioned follow-up details.',
    'Hoi, ik bel je even, kan ik je iets vragen, heb je tijd, weet je wat we doen?',
    'De klant heeft interesse in een nieuwe website en wil volgende week teruggebeld worden.'
  );

  assert.equal(
    readable,
    'De klant heeft interesse in een nieuwe website en wil volgende week teruggebeld worden.'
  );
});

test('coldcalling shared call summary cache stores only readable summaries', () => {
  const cache = Object.create(null);
  const accessors = summaryHelpers.createSharedCallSummaryAccessors(cache);

  accessors.setSharedCallSummary(
    ' call-1 ',
    'De klant wil een nieuwe website bespreken. De logische vervolgstap is om de afspraak te bevestigen.'
  );
  accessors.setSharedCallSummary('call-2', 'Op 2026-04-27 is de afspraak ingepland.');

  cache['call-3'] = 'Bevestigingsmail sturen na afspraakbevestiging.';

  assert.equal(accessors.getSharedCallSummary('call-1'), 'De klant wil een nieuwe website bespreken.');
  assert.equal(cache['call-2'], undefined);
  assert.equal(accessors.getSharedCallSummary('call-3'), '');
  assert.equal(cache['call-3'], undefined);
});

test('coldcalling summary helper delegates Dutch AI summaries through the shared browser adapter', async () => {
  let seenPayload = null;
  globalThis.SoftoraAI = {
    summarizeText: async (payload) => {
      seenPayload = payload;
      return { summary: 'Korte Nederlandse samenvatting.' };
    },
  };

  try {
    const summary = await summaryHelpers.summarizeConversationTextNl('Lang gesprek', {
      style: 'short',
      maxSentences: 2,
      extraInstructions: 'Noem Ruben Nijhuis.',
    });

    assert.equal(summary, 'Korte Nederlandse samenvatting.');
    assert.deepEqual(seenPayload, {
      text: 'Lang gesprek',
      style: 'short',
      language: 'nl',
      maxSentences: 2,
      extraInstructions: 'Noem Ruben Nijhuis.',
    });
  } finally {
    delete globalThis.SoftoraAI;
  }
});
