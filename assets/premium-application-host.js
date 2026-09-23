(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoftoraPremiumApplicationHost = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createPremiumApplicationHost({ outlet, document } = {}) {
    const doc = document || outlet?.ownerDocument;
    if (!outlet || !doc || typeof doc.createElement !== 'function' || typeof outlet.appendChild !== 'function') {
      throw new TypeError('De applicatiehost heeft een DOM-outlet nodig.');
    }
    const roots = new Set();
    let active = null;

    function remove(element) {
      if (!roots.has(element)) return;
      roots.delete(element);
      if (active === element) active = null;
      element.remove();
    }

    function create({ moduleId } = {}) {
      const id = String(moduleId || '').trim();
      if (!id) throw new TypeError('De module heeft een id nodig.');
      const element = doc.createElement('section');
      element.dataset.softoraModuleRoot = id;
      element.setAttribute('aria-hidden', 'true');
      element.inert = true;
      element.style.position = 'absolute';
      element.style.visibility = 'hidden';
      element.style.pointerEvents = 'none';
      element.style.width = '100%';
      outlet.appendChild(element);
      roots.add(element);
      return element;
    }

    function activate(element, { previousRoot } = {}) {
      if (!roots.has(element) || element.parentNode !== outlet) {
        throw new Error('De module staat niet in de applicatiehost.');
      }
      if (previousRoot && previousRoot !== active) {
        throw new Error('De vorige module is niet meer actueel.');
      }
      if (previousRoot && previousRoot !== element) {
        previousRoot.inert = true;
        previousRoot.setAttribute('aria-hidden', 'true');
        previousRoot.style.visibility = 'hidden';
      }
      element.style.position = '';
      element.style.visibility = '';
      element.style.pointerEvents = '';
      element.style.width = '';
      element.inert = false;
      element.removeAttribute('aria-hidden');
      active = element;
    }

    function clear() {
      for (const element of Array.from(roots)) remove(element);
    }

    return Object.freeze({ create, activate, remove, clear, getActiveRoot: () => active });
  }

  return Object.freeze({ createPremiumApplicationHost });
});
