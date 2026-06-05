const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const siteEngine = require('../../assets/premium-site-engine');

function buildGeneratedBundle() {
  return siteEngine.buildSiteBundle({
    orderId: 'conversion-test',
    meta: {
      id: 'conversion-test',
      clientName: 'Softora Conversie Test',
      title: 'Website voor meetbare aanvragen',
      description: 'Publieke demo met formulier en duidelijke vervolgstap.',
      industry: 'services',
    },
  });
}

test('premium site engine routes generated contact form submits to Martijn WhatsApp', () => {
  const bundle = buildGeneratedBundle();
  const contactHtml = bundle.files['contact.html'];
  const appJs = bundle.files['assets/app.js'];

  assert.match(contactHtml, /data-demo-form/);
  assert.match(contactHtml, /type="submit"[^>]*data-softora-conversion="generated-form-submit"/);
  assert.match(contactHtml, /data-softora-conversion-page="contact\.html"/);
  assert.match(contactHtml, /data-softora-conversion-target="whatsapp"/);
  assert.match(contactHtml, /data-softora-whatsapp-action="submit"/);
  assert.match(contactHtml, /data-softora-whatsapp-url="https:\/\/wa\.me\/31643262792"/);
  assert.match(contactHtml, /WhatsApp wordt geopend\. Je vraag staat klaar voor opvolging\./);

  const opened = [];
  const dispatched = [];
  let submitHandler = null;
  let prevented = false;
  let resetCalled = false;
  const feedback = { hidden: true };
  const submitButton = {
    getAttribute(name) {
      return {
        'data-softora-conversion': 'generated-form-submit',
        'data-softora-conversion-page': 'contact.html',
        'data-softora-conversion-target': 'whatsapp',
        'data-softora-whatsapp-action': 'submit',
        'data-softora-whatsapp-url': 'https://wa.me/31643262792',
      }[name] || '';
    },
  };
  const form = {
    addEventListener(type, handler) {
      if (type === 'submit') submitHandler = handler;
    },
    checkValidity() {
      return true;
    },
    querySelector(selector) {
      if (selector === '[data-softora-whatsapp-action="submit"]') return submitButton;
      if (selector === '.form-feedback') return feedback;
      return null;
    },
    reset() {
      resetCalled = true;
    },
  };
  const context = {
    Date,
    CustomEvent: function CustomEvent(type, options) {
      this.type = type;
      this.detail = options && options.detail;
    },
    IntersectionObserver: function IntersectionObserver() {
      this.observe = function observe() {};
    },
    document: {
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'form[data-demo-form]') return [form];
        return [];
      },
    },
    window: {
      location: { pathname: '/contact.html', search: '?utm=seo' },
      open(url, target, features) {
        opened.push({ url, target, features });
      },
      dispatchEvent(event) {
        dispatched.push(event);
      },
    },
  };
  context.window.window = context.window;
  context.window.document = context.document;

  vm.runInNewContext(appJs, context);
  submitHandler({
    submitter: submitButton,
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
  assert.deepEqual(opened, [{
    url: 'https://wa.me/31643262792',
    target: '_blank',
    features: 'noopener,noreferrer',
  }]);
  assert.equal(resetCalled, true);
  assert.equal(feedback.hidden, false);
  assert.equal(context.window.__softoraPublicConversionEvents.length, 1);
  assert.equal(context.window.__softoraPublicLastConversion.name, 'generated-form-submit');
  assert.equal(context.window.__softoraPublicLastConversion.target, 'whatsapp');
  assert.equal(context.window.__softoraPublicLastConversion.path, '/contact.html?utm=seo');
  assert.equal(dispatched[0].type, 'softora:public-conversion');
});
