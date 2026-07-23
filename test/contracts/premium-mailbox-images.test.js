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
