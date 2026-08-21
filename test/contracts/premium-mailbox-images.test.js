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
      this.naturalHeight = 0;
    }

    set src(_value) {
      this.complete = true;
      this.naturalWidth = 1200;
      this.naturalHeight = 675;
      queueMicrotask(() => this.onload?.());
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
      this.naturalHeight = 675;
      queueMicrotask(() => this.onload?.());
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
          folder: 'sent',
          originalCampaignOutbound: true,
          bodyImages: [proxyImage('1', 'Eerste echte bijlage')],
        }],
      },
      {
        folder: 'sent',
        originalCampaignOutbound: true,
        bodyImages: [proxyImage('2', 'Tweede echte bijlage')],
      },
      {
        folder: 'sent',
        originalCampaignOutbound: true,
        bodyImages: [proxyImage('3', 'Derde echte bijlage')],
      },
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

test('mailbox image loader bewaart afmetingen voor een detailbatch boven de cachelimiet', async () => {
  class FakeImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }

    set src(_value) {
      this.complete = true;
      this.naturalWidth = 1600;
      this.naturalHeight = 900;
    }
  }

  const loaded = loadModuleWithImage(FakeImage);
  try {
    const images = Array.from({ length: 25 }, (_unused, index) => (
      proxyImage(`batch-${index + 1}`, `Afbeelding ${index + 1}`)
    ));
    const lease = await loaded.module.prepareForCommit(images);
    assert.match(
      loaded.module.renderInlineImage(images[0], String),
      /width="1600" height="900"/
    );
    assert.match(
      loaded.module.renderInlineImage(images.at(-1), String),
      /width="1600" height="900"/
    );
    lease.release();
  } finally {
    loaded.restore();
  }
});

test('mailbox image loader herstelt een mislukte prewarm bij de detailcommit', async () => {
  let attempts = 0;
  class RetryImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }

    set src(_value) {
      attempts += 1;
      if (attempts === 1) {
        queueMicrotask(() => this.onerror?.());
        return;
      }
      this.complete = true;
      this.naturalWidth = 1280;
      this.naturalHeight = 720;
    }
  }

  const loaded = loadModuleWithImage(RetryImage);
  try {
    const image = proxyImage('retry', 'Hersteld beeld');
    await loaded.module.prepare([image]);
    assert.equal(loaded.module.renderInlineImage(image, String), '');

    const lease = await loaded.module.prepareForCommit([image]);
    assert.match(loaded.module.renderInlineImage(image, String), /width="1280" height="720"/);
    assert.equal(attempts, 2);
    lease.release();
  } finally {
    loaded.restore();
  }
});

test('mailbox image loader begrenst een decode die nooit afrondt', async () => {
  let deadline;
  class HangingDecodeImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }

    set src(_value) {
      this.complete = true;
      this.naturalWidth = 1440;
      this.naturalHeight = 810;
    }

    decode() {
      return new Promise(() => {});
    }
  }

  const modulePath = require.resolve('../../assets/premium-mailbox-images.js');
  delete require.cache[modulePath];
  const originalImage = global.Image;
  const originalInbox = global.SoftoraMailboxCampaignInbox;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.Image = HangingDecodeImage;
  global.setTimeout = (handler, delay) => {
    assert.equal(delay, 15_000);
    deadline = handler;
    return 1;
  };
  global.clearTimeout = () => {};
  global.SoftoraMailboxCampaignInbox = {
    isSafeImageSource: (source) => String(source || '').startsWith('/api/mailbox/message-image?'),
  };
  const api = require(modulePath);
  try {
    const image = proxyImage('decode-hang', 'Begrensde decode');
    const leasePending = api.prepareForCommit([image]);
    deadline();
    const lease = await leasePending;
    assert.match(api.renderInlineImage(image, String), /width="1440" height="810"/);
    lease.release();
  } finally {
    global.Image = originalImage;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.SoftoraMailboxCampaignInbox = originalInbox;
    delete global.SoftoraMailboxImages;
    delete require.cache[modulePath];
  }
});

test('mailbox afbeeldingseigendom leidt campagnebeelden nooit af uit losse conversatiemedia', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const sent = sentCampaignMessage();
    const design = proxyImage('design', 'voorbeeld.nl preview');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [sent],
    }, [design], true);
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, []);
    assert.deepEqual(plan.fallbackImages, []);
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom bewaart echte antwoordfoto en negeert los campagnebeeld', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const sent = sentCampaignMessage();
    const recipientPhoto = proxyImage('recipient-photo', 'Foto van de nieuwe winkel');
    const campaignDesign = proxyImage('campaign-design', 'Ontwerp', 'sent-campaign');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [sent],
    }, [recipientPhoto, campaignDesign], true);
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, [recipientPhoto]);
    assert.deepEqual(plan.fallbackImages, []);
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

test('mailbox afbeeldingseigendom negeert geciteerde campagnebeelden volledig', () => {
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
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom gebruikt placeholders nooit als MIME-bewijs', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const inlineDesign = proxyImage('inline-campaign-design', 'softora.nl preview', 'sent-campaign');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [],
    }, [inlineDesign], true);
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, []);
    assert.deepEqual(plan.fallbackImages, []);
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom gebruikt placeholders in eerdere mail nooit als MIME-bewijs', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const quotedDesign = proxyImage('quoted-inline-design', 'dirvenschoenen.nl preview', 'sent-campaign');
    const plan = loaded.module.createOwnershipPlan({
      threadMessages: [],
    }, [quotedDesign], true, { hasOwnQuotePlaceholders: true });
    assert.equal(plan.owner, null);
    assert.deepEqual(plan.mainImages, []);
    assert.deepEqual(plan.fallbackImages, []);
    assert.deepEqual(plan.quoteImages, []);
  } finally {
    loaded.restore();
  }
});

test('mailbox afbeeldingseigendom herkent hetzelfde verzonden bericht na conversation grouping', () => {
  const loaded = loadModuleWithImage(class FakeImage {});
  try {
    const design = proxyImage('stable-owner-design', 'voorbeeld.nl preview');
    const owner = {
      id: 'sent:195',
      accountEmail: 'servecreusen7@gmail.com',
      messageId: '<sent-message@example.com>',
      folder: 'sent',
      originalCampaignOutbound: true,
      bodyImages: [design],
      body: '',
    };
    const groupedClone = { ...owner };
    const html = loaded.module.renderThreadMessageBody({
      message: groupedClone,
      sent: true,
      body: 'Goedendag',
    }, {
      imageOwner: owner,
      fallbackImages: [],
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
