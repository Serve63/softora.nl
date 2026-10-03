const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createReadModelStore } = require('../../assets/premium-readmodel-store');
const source = fs.readFileSync(path.join(__dirname, '../../assets/personnel-appearance.js'), 'utf8');

function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i],
    getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

function openPage(localStorage, owner = 'serve', hasDate = true) {
  const rootAttributes = {}, events = {}, classes = new Set();
  let button;
  const host = { classList: { add: value => classes.add(value) }, insertAdjacentElement(where, element) {
    assert.equal(where, 'afterend'); button = element;
  } };
  const doc = {
    documentElement: { setAttribute: (key, value) => { rootAttributes[key] = value; } },
    currentScript: { getAttribute: () => owner }, readyState: 'loading',
    getElementById: id => hasDate && id === 'currentDate' ? { parentElement: host, closest: () => host } : null,
    querySelector: () => button || null,
    querySelectorAll: selector => selector === '[data-personnel-theme-toggle]' && button ? [button] : [],
    addEventListener: (key, callback) => { events[key] = callback; },
    createElement: () => ({ attrs: {}, events: {}, setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(key, callback) { this.events[key] = callback; } }),
  };
  const window = { document: doc, SoftoraReadModelStore: createReadModelStore({ localStorage }),
    addEventListener: (key, callback) => { events[key] = callback; } };
  vm.runInNewContext(source, { window });
  return { window, rootAttributes, events, classes, get button() { return button; } };
}

test('date icon toggles both modes, has an accessible state and survives personnel navigation before paint', () => {
  const local = storage();
  const page = openPage(local);
  assert.equal(page.rootAttributes['data-theme'], 'light');
  page.events.DOMContentLoaded();
  assert.equal(page.button.type, 'button');
  assert.equal(page.button.attrs['aria-label'], 'Donkere modus inschakelen');
  page.button.events.click();
  assert.equal(page.rootAttributes['data-theme'], 'dark');
  assert.equal(page.button.attrs['aria-pressed'], 'true');
  assert.equal(page.button.attrs['aria-label'], 'Lichte modus inschakelen');
  const next = openPage(local, 'serve', false);
  assert.equal(next.rootAttributes['data-theme'], 'dark', 'saved mode applies before DOMContentLoaded');
  next.events.DOMContentLoaded();
  assert.equal(next.button, undefined);
  page.button.events.click();
  assert.equal(openPage(local).rootAttributes['data-theme'], 'light');
});

test('appearance is scoped to the signed-in user and synchronizes across tabs and embedded modules', () => {
  const local = storage();
  const first = openPage(local);
  first.window.SoftoraPersonnelAppearance.applyMode('dark');
  const otherTab = openPage(local);
  first.window.SoftoraPersonnelAppearance.applyMode('light');
  otherTab.events.storage({ key: 'softora-readmodel-sync:personnel-appearance:v1' });
  assert.equal(otherTab.rootAttributes['data-theme'], 'light');
  first.window.SoftoraPersonnelAppearance.applyMode('dark');
  assert.equal(openPage(local, 'other-user').rootAttributes['data-theme'], 'light');
});

test('blocked storage still permits switching, and absent owner never reads or writes saved data', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const page = openPage(blocked);
  page.window.SoftoraPersonnelAppearance.applyMode('dark');
  assert.equal(page.rootAttributes['data-theme-mode'], 'dark');
  const noOwner = openPage({ getItem() { assert.fail('no identity must not read'); }, setItem() { assert.fail('no identity must not write'); } }, '');
  noOwner.window.SoftoraPersonnelAppearance.applyMode('dark');
  assert.equal(noOwner.rootAttributes['data-theme'], 'dark');
});
