const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isOriginalCampaignOutboundMessage,
  isSentCampaignDesignImage,
  tagSentCampaignBodyImages,
} = require('../../server/services/mailbox-image-ownership');

test('mailbox media herkent uitsluitend de oorspronkelijke verzonden coldmail als eigenaar', () => {
  const original = {
    folder: 'sent',
    subject: 'Kleine vraag over jullie website',
    body: [
      'Goedendag,',
      'Afgelopen week kwam ik jullie website salontof.nl tegen.',
      'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    ].join('\n'),
  };
  const followUp = {
    ...original,
    subject: 'Re: Kleine vraag over jullie website',
    body: 'Dank voor je reactie.\n\nOp vrijdag schreef Servé:\n' + original.body,
    inReplyTo: '<reply@example.nl>',
    references: '<original@example.nl> <reply@example.nl>',
  };

  assert.equal(isOriginalCampaignOutboundMessage(original), true);
  assert.equal(isOriginalCampaignOutboundMessage(followUp), false);
  assert.equal(isOriginalCampaignOutboundMessage({ ...original, folder: 'inbox' }), false);
});

test('mailbox media behandelt een designlink of placeholder nooit als beeldbewijs', () => {
  const body = [
    'Goedendag,',
    'Afgelopen week kwam ik jullie website kboheikantquirijnstok.nl tegen.',
    'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
    'Je kunt het webdesign hier bekijken:',
    'https://www.softora.nl/webdesign/kbo-heikant-quirijnstok',
    '[image: www.softora.nl-preview]',
  ].join('\n');

  assert.equal(isOriginalCampaignOutboundMessage({
    folder: 'sent',
    subject: 'Kleine vraag over jullie website',
    body,
  }), true);
  assert.deepEqual(tagSentCampaignBodyImages([], {
    folder: 'sent',
    looksLikeCampaign: true,
  }), []);
});

test('mailbox media markeert alleen werkelijk geparste quote-images als campagnebeeld', () => {
  const actualMimeImage = {
    alt: 'salontof.nl-preview',
    cid: 'salontof-preview@softora',
    dataUrl: 'data:image/png;base64,aW1hZ2U=',
  };
  const tagged = tagSentCampaignBodyImages([actualMimeImage], {
    folder: 'inbox',
    looksLikeCampaign: true,
  });

  assert.equal(isSentCampaignDesignImage(actualMimeImage), true);
  assert.equal(tagged.length, 1);
  assert.equal(tagged[0].owner, 'sent-campaign');
});
