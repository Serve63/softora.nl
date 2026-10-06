const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDocument, DomUtils } = require('htmlparser2');
const copyApi = require('../../assets/premium-mailbox-copy');

// Adapt parsed HTML to the DOM reads used by the clipboard formatter, without
// a browser dependency in CI. Browser verification also uses the real page.
function documentOf(html) {
  const root = parseDocument(html), wrappers = new WeakMap();
  function matches(node, selector) {
    if (!node.name) return false;
    const parts = selector.trim().split(' > ');
    if (parts.length > 1) return matches(node, parts[1]) && matches(node.parent, parts[0]);
    if (selector.startsWith('.')) return (node.attribs.class || '').split(' ').includes(selector.slice(1));
    if (selector.startsWith('#')) return node.attribs.id === selector.slice(1);
    return node.name === selector;
  }
  function find(node, selector) {
    return DomUtils.findAll((child) => selector.split(',').some((part) => matches(child, part.trim())), node.children || []).map(wrap);
  }
  function wrap(node) {
    if (wrappers.has(node)) return wrappers.get(node);
    const value = {
      nodeType: node.type === 'text' ? 3 : node.name ? 1 : 9,
      tagName: node.name?.toUpperCase(),
      textContent: DomUtils.textContent(node),
      hidden: Object.hasOwn(node.attribs || {}, 'hidden'),
      dataset: { mailboxCommittedId: node.attribs?.['data-mailbox-committed-id'] },
      classList: { contains: (name) => (node.attribs?.class || '').split(' ').includes(name) },
      getAttribute: (name) => node.attribs?.[name],
      setAttribute: (name, text) => { node.attribs[name] = text; },
      hasAttribute: (name) => Object.hasOwn(node.attribs || {}, name),
      querySelector: (selector) => find(node, selector)[0] || null,
      querySelectorAll: (selector) => find(node, selector),
      getElementById: (id) => find(node, `#${id}`)[0] || null,
      get childNodes() { return (node.children || []).map(wrap); },
      get parentElement() { return node.parent ? wrap(node.parent) : null; },
    };
    wrappers.set(node, value);
    return value;
  }
  return wrap(root);
}

const routing = (sender, recipient) => `<div class="detail-routing">\n  <div><span>Van:</span><strong>${sender}</strong></div>\n  <div><span>Aan:</span><strong>${recipient}</strong></div>\n</div>`;
const card = (body, sender = 'Servé Creusen &lt;serve.creusen7@gmail.com&gt;', recipient = 'info@autospeciaalmandemakers.nl') =>
  `<section class="detail-mail-section">${routing(sender, recipient)}<div class="detail-mail-lines"><div class="detail-mail-line">${body}</div></div><div class="detail-footer"><button>Beantwoorden</button></div></section>`;
const html = (cards, header = '') => `<main id="mail-detail" data-mailbox-committed-id="root"><div class="detail-header"><div class="detail-subject">Mandemakers</div>${header}</div><div class="detail-body-text">${cards}</div></main>`;

test('copy preserves every message and exact routing, Unicode, contacts and link destinations, without action labels', () => {
  const doc = documentOf(html(card('Goedendag 😊<br>Een <a href="https://example.org/design">ontwerp</a>.') +
    card('Mooi ontwerp! 📍<div>Telefoon: 0612345678</div><div>Adres: Voorbeeldstraat 12<br>5062 ED Oisterwijk</div>', 'Klant &lt;info@autospeciaalmandemakers.nl&gt;', 'serve.creusen7@gmail.com') + card('Dankjewel!')));
  const text = copyApi.buildConversationText(doc.getElementById('mail-detail'));
  assert.match(text, /Van: Servé Creusen <serve\.creusen7@gmail\.com>\nAan: info@autospeciaalmandemakers\.nl/);
  assert.match(text, /Goedendag 😊\nEen ontwerp \(https:\/\/example\.org\/design\)\./);
  assert.match(text, /Van: Klant <info@autospeciaalmandemakers\.nl>\nAan: serve\.creusen7@gmail\.com/);
  assert.match(text, /5062 ED Oisterwijk/);
  assert.equal((text.match(/Van:/g) || []).length, 3);
  assert.doesNotMatch(text, /Beantwoorden/);
  assert.ok(text.indexOf('Goedendag') < text.indexOf('Mooi ontwerp') && text.indexOf('Mooi ontwerp') < text.indexOf('Dankjewel'));
});

test('root routing outside the body is retained, while incomplete content cannot be copied', () => {
  const doc = documentOf(html('<div>Eigen bericht</div>', routing('Afzender', 'Ontvanger')));
  assert.match(copyApi.buildConversationText(doc.getElementById('mail-detail')), /Van: Afzender\nAan: Ontvanger/);
  for (const className of ['detail-mail-loading', 'detail-mail-load-error']) {
    const pending = documentOf(html(`<div class="${className}">Laden</div>`));
    assert.throws(() => copyApi.buildConversationText(pending.getElementById('mail-detail')), /niet volledig geladen/);
  }
  const inert = documentOf(html(card('Geheugeninhoud')).replace('<main ', '<main inert '));
  assert.throws(() => copyApi.buildConversationText(inert.getElementById('mail-detail')), /niet volledig geladen/);
});

function harness(overrides = {}) {
  const mail = { id: 'root', body: 'Bericht', bodyLoaded: true, threadMessages: [], contactTimelineLoaded: true };
  const state = { activeId: 'root', scope: { folder: 'outreach', owner: 'serve' }, copies: [], toasts: [], opens: [], document: documentOf(html(card('Bericht'))) };
  const options = {
    document: { getElementById: (id) => state.document.getElementById(id), querySelectorAll: () => [] },
    getActiveId: () => state.activeId, getScope: () => state.scope, getMail: () => mail,
    openMail: async (_id, settings) => { state.opens.push(settings); state.document = documentOf(html([card(mail.body), ...mail.threadMessages.map((message) => card(message.body))].join(''))); },
    clipboard: { writeText: async (text) => { state.copies.push(text); } },
    toast: (message) => state.toasts.push(message),
    getIndex: () => ({ needsThreadBodyHydration: (message) => !message.bodyLoaded, needsThreadRoutingHydration: () => false }),
    ...overrides,
  };
  return { controller: copyApi.create(options), mail, state, options };
}

test('copy loads every history page and hydrates conversations longer than the normal 40-message batch', async () => {
  const batchSizes = [];
  const h = harness();
  h.mail.contactTimelineNextCursor = 'page-2';
  h.options.getDiscovery = () => ({ loadContactTimeline: async (mail, settings) => {
    assert.equal(settings.append, true);
    assert.equal(settings.deferRender, true);
    mail.threadMessages.push(...Array.from({ length: 45 }, (_, i) => ({ body: `Ouder bericht ${i}`, bodyLoaded: false })));
    mail.contactTimelineNextCursor = '';
    return true;
  } });
  h.options.getIndex = () => ({
    needsThreadBodyHydration: (message) => !message.bodyLoaded, needsThreadRoutingHydration: () => false,
    loadThreadBodies: async ({ targetMessages, isCurrent }) => {
      assert.equal(isCurrent(), true); batchSizes.push(targetMessages.length);
      targetMessages.forEach((message) => { message.bodyLoaded = true; });
    },
  });
  assert.equal(await h.controller.copy('root'), true);
  assert.deepEqual(batchSizes, [40, 5]);
  assert.equal((h.state.copies[0].match(/Van:/g) || []).length, 46);
  assert.match(h.state.copies[0], /Ouder bericht 44/);
  assert.ok(h.state.opens.every((settings) => settings.skipReadPersist));
  assert.deepEqual(h.state.toasts, ['Hele gesprek gekopieerd']);
});

test('copy never writes a partial conversation after a page failure, cursor cycle or failed hydration', async () => {
  for (const mode of ['page-failure', 'cursor-cycle', 'body-failure']) {
    const h = harness();
    h.mail.contactTimelineNextCursor = mode === 'body-failure' ? '' : 'same-page';
    h.options.getDiscovery = () => ({ loadContactTimeline: async () => mode !== 'page-failure' });
    if (mode === 'body-failure') {
      h.mail.threadMessages = [{ body: '', bodyLoaded: false }];
      h.options.getIndex = () => ({ needsThreadBodyHydration: (message) => !message.bodyLoaded, loadThreadBodies: async () => false });
    }
    assert.equal(await h.controller.copy('root'), false);
    assert.deepEqual(h.state.copies, []);
    assert.equal(h.state.toasts.length, 1);
  }
});

test('scope/selection changes and double-clicks cannot copy the wrong conversation', async () => {
  let release;
  const h = harness({ getPending: () => new Promise((resolve) => { release = resolve; }) });
  const first = h.controller.copy('root');
  assert.equal(await h.controller.copy('root'), false);
  h.state.scope = { folder: 'outreach', owner: 'martijn' };
  release();
  assert.equal(await first, false);
  assert.deepEqual(h.state.copies, []);
  assert.deepEqual(h.state.toasts, []);
});

test('clipboard rejection is reported without claiming that copying succeeded', async () => {
  const h = harness({ clipboard: { writeText: async () => { throw new Error('Kopiëren geweigerd'); } } });
  assert.equal(await h.controller.copy('root'), false);
  assert.deepEqual(h.state.copies, []);
  assert.deepEqual(h.state.toasts, ['Kopiëren geweigerd']);
});
