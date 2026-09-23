const test = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumApplicationHost } = require('../../assets/premium-application-host');

function createFakeDom() {
  const outlet = { children: [], appendChild(element) { this.children.push(element); element.parentNode = this; } };
  const document = { createElement: () => ({
    dataset: {}, style: {}, attributes: {}, inert: false, parentNode: null,
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    remove() { if (!this.parentNode) return; this.parentNode.children = this.parentNode.children.filter((item) => item !== this); this.parentNode = null; },
  }) };
  return { outlet, document };
}

test('application host keeps the current module visible until its replacement is ready', () => {
  const { outlet, document } = createFakeDom();
  const host = createPremiumApplicationHost({ outlet, document });
  const dashboard = host.create({ moduleId: 'dashboard' });
  assert.equal(dashboard.style.visibility, 'hidden');
  assert.equal(dashboard.inert, true);
  host.activate(dashboard);
  assert.equal(dashboard.style.visibility, '');
  assert.equal(dashboard.inert, false);
  const orders = host.create({ moduleId: 'orders' });
  assert.equal(dashboard.style.visibility, '');
  assert.equal(orders.style.visibility, 'hidden');
  host.activate(orders, { previousRoot: dashboard });
  assert.equal(dashboard.style.visibility, 'hidden');
  assert.equal(dashboard.inert, true);
  assert.equal(orders.style.visibility, '');
  assert.equal(orders.inert, false);
  host.remove(dashboard);
  assert.deepEqual(outlet.children, [orders]);
  assert.equal(host.getActiveRoot(), orders);
});

test('failed replacement can be removed without touching the previous screen', () => {
  const { outlet, document } = createFakeDom();
  const host = createPremiumApplicationHost({ outlet, document });
  const dashboard = host.create({ moduleId: 'dashboard' });
  host.activate(dashboard);
  const failed = host.create({ moduleId: 'failed' });
  host.remove(failed);
  assert.deepEqual(outlet.children, [dashboard]);
  assert.equal(dashboard.inert, false);
  assert.equal(host.getActiveRoot(), dashboard);
  assert.throws(() => host.activate(failed, { previousRoot: dashboard }), /niet in de applicatiehost/);
  host.clear();
  assert.deepEqual(outlet.children, []);
  assert.equal(host.getActiveRoot(), null);
});
