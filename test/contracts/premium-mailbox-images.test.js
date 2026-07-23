const test = require('node:test');
const assert = require('node:assert/strict');

function loadModuleWithImage(ImageClass) {
  const modulePath = require.resolve('../../assets/premium-mailbox-images.js');
  delete require.cache[modulePath];
  const originalImage = global.Image;
  const originalInbox = global.SoftoraMailboxCampaignInbox;
  global.Image = ImageClass;
  global.SoftoraMailboxCampaignInbox = {
    isSafeImageSource: (source) => String(source || '').startsWith('/api/mailbox/message-image?'),
  };
  const module = require(modulePath);
  return {
    module,
    restore() {
      global.Image = originalImage;
      global.SoftoraMailboxCampaignInbox = originalInbox;
      delete global.SoftoraMailboxImages;
      delete require.cache[modulePath];
    },
  };
}

function proxyImage(id, alt, owner = '') {
  return {
    alt,
    dataUrl: `/api/mailbox/message-image?mail=${id}`,
    ...(owner ? { owner } : {}),
  };
}

function sentCampaignMessage(bodyImages = []) {
  return {
    folder: 'sent',
    body: [
      'Goedendag,',
      'Afgelopen week kwam ik jullie website voorbeeld.nl tegen.',
      'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
      'Ik ben oprecht benieuwd wat je ervan vindt.',
    ].join('\n\n'),
    bodyImages,
  };
}

test('mailbox image loader haalt een afbeelding eenmalig op en wacht op decode', async () => {
  let created = 0;
  let decoded = 0;
  class FakeImage {
    constructor() {
      created += 1;
      this.complete = false;
      this.naturalWidth = 0;
    }

    set src(_value) {
      this.complete = true;
      this.naturalWidth = 1200;
      queueMicrotask(() => this.onload());
    }

    async decode() {
      decoded += 1;
    }
  }

  const loaded = loadModuleWithImage(FakeImage);
  try {
    const images = [{ dataUrl: '/api/mailbox/message-image?account=serve&id=inbox%3A1&index=0' }];
    await loaded.module.prepare(images);
    assert.equal(loaded.module.prepare(images), null);
    assert.equal(created, 1);
    assert.equal(decoded, 1);
  } finally {
    loaded.restore();
  }
});

test('mailbox image loader warmt alleen de eerste twee beeldmails vooruit', async () => {
  const requested = [];
  class FakeImage {
    set src(value) {
      requested.push(value);
      this.complete = true;
      this.naturalWidth = 1200;
      queueMicrotask(() => this.onload());
    }

    async decode() {}
  }

  const loaded = loadModuleWithImage(FakeImage);
  try {
    loaded.module.prewarm([
      { bodyImages: [] },
      {
        bodyImages: [],
        threadMessages: [{
          bodyImages: [{ dataUrl: '/api/mailbox/message-image?mail=1' }],
        }],
      },
      { bodyImages: [{ dataUrl: '/api/mailbox/message-image?mail=2' }] },
      { bodyImages: [{ dataUrl: '/api/mailbox/message-image?mail=3' }] },
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(requested, [
      '/api/mailbox/message-image?mail=1',
      '/api/mailbox/message-image?mail=2',
    ]);
  } finally {
    loaded.restore();
  }
});

test('mailbox image loader toont alleen de laatst gekozen mail na de decode', async () => {
  const pending = [];
  class FakeImage {
    set src(_value) {
      this.complete = false;
      this.naturalWidth = 0;
      pending.push(() => this.onload());
    }
  }

  const loaded = loadModuleWithImage(FakeImage);
  try {
    const rendered = [];
    const first = [{ dataUrl: '/api/mailbox/message-image?mail=first' }];
    const second = [{ dataUrl: '/api/mailbox/message-image?mail=second' }];
    assert.equal(loaded.module.stage(first, () => true, () => rendered.push('first')), true);
    assert.equal(loaded.module.stage(second, () => true, () => rendered.push('second')), true);
    pending.forEach((finish) => finish());
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rendered, ['second']);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom zet herstelde campagnebeelden onder het verzonden bericht', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const sent = sentCampaignMessage();
    const design = proxyImage('design', 'voorbeeld.nl preview');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [sent],
    }, [design], true);
    assert.equal(plan.owner, sent);
    assert.deepEqual(plan.mainImages, []);
    assert.deepEqual(plan.fallbackImages, [design]);
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom bewaart echte antwoordfoto en verplaatst alleen campagnebeeld', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const sent = sentCampaignMessage();
    const recipientPhoto = proxyImage('recipient-photo', 'Foto van de nieuwe winkel');
    const campaignDesign = proxyImage('campaign-design', 'Ontwerp', 'sent-campaign');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [sent],
    }, [recipientPhoto, campaignDesign], true);
    assert.equal(plan.owner, sent);
    assert.deepEqual(plan.mainImages, [recipientPhoto]);
    assert.deepEqual(plan.fallbackImages, [campaignDesign]);
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom laat gewone ontvangen foto bij de ontvanger', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const recipientPhoto = proxyImage('recipient-photo-only', 'Teamfoto');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [{
        folder: 'sent',
        body: 'Bedankt voor je bericht.',
      }],
    }, [recipientPhoto], true);
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, [recipientPhoto]);
    assert.deepEqual(plan.fallbackImages, []);
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom zet geciteerde campagnebeelden nooit onder een ontvangen reactie', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const campaignDesign = proxyImage('quoted-campaign-design', 'dirvenschoenen.nl preview', 'sent-campaign');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [{
        folder: 'sent',
        body: 'Hoi,\n\nDankjewel voor je reactie.',
      }],
    }, [campaignDesign], false);
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, []);
    assert.deepEqual(plan.fallbackImages, []);
    assert.deepEqual(plan.quoteImages, [campaignDesign]);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom bewaart expliciete inline placeholders in het zichtbare bericht', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const inlineDesign = proxyImage('inline-campaign-design', 'softora.nl preview', 'sent-campaign');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [],
    }, [inlineDesign], true);
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, [inlineDesign]);
    assert.deepEqual(plan.fallbackImages, []);
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom zet placeholders uit jouw eerdere mail in dat eigen blok', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const quotedDesign = proxyImage('quoted-inline-design', 'dirvenschoenen.nl preview', 'sent-campaign');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [],
    }, [quotedDesign], true, { hasOwnQuotePlaceholders: true });
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, []);
    assert.deepEqual(plan.fallbackImages, []);
    assert.deepEqual(plan.quoteImages, [quotedDesign]);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom herkent hetzelfde verzonden bericht na conversation grouping', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const owner = {
      id: 'sent:195',
      accountEmail: 'servecreusen7@gmail.com',
      messageId: '<sent-message@example.com>',
      folder: 'sent',
      body: '',
    };
    const groupedClone = { ...owner };
    const design = proxyImage('stable-owner-design', 'voorbeeld.nl preview');
    const html = loaded.module.renderThreadMessageBody({
      message: groupedClone,
      sent: true,
      body: 'Goedendag',
    }, {
      imageOwner: owner,
      fallbackImages: [design],
      imagesReady: true,
    }, {
      normalizeEmail: (value) => value,
      normalizeOptOutUrl: (value) => value,
      renderInlineImage: (image) => `<img data-alt="${image.alt}">`,
      renderParagraphs: () => '<p>Goedendag</p>',
    });
    assert.match(html, /stable-owner-design|voorbeeld\.nl preview/);
  } finally {
    loaded.restore();
  }
});
