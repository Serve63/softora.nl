(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoftoraPremiumApplicationNavigation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizePath(path) {
    const value = String(path || '/').trim().replace(/\/+$/, '').toLowerCase();
    return value || '/';
  }

  function createRouteMap(routes) {
    const entries = routes instanceof Map ? Array.from(routes.entries()) : Object.entries(routes || {});
    const routeMap = new Map();
    for (const [rawPath, rawRoute] of entries) {
      const path = normalizePath(rawPath);
      const moduleId = String(rawRoute && rawRoute.moduleId || '').trim();
      if (!moduleId || routeMap.has(path)) throw new TypeError(`Ongeldige of dubbele applicatieroute: ${path}`);
      routeMap.set(path, Object.freeze({ ...rawRoute, path, moduleId }));
    }
    return routeMap;
  }

  function isPlainHistoryState(state) {
    return Boolean(state && typeof state === 'object' && !Array.isArray(state));
  }

  function createPremiumApplicationNavigation(options) {
    const config = options || {};
    const runtime = config.runtime;
    const win = config.window || (typeof window !== 'undefined' ? window : null);
    const doc = config.document || (win && win.document);
    const routeMap = createRouteMap(config.routes);
    const onRouteChange = typeof config.onRouteChange === 'function' ? config.onRouteChange : () => {};
    const onError = typeof config.onError === 'function' ? config.onError : () => {};
    if (!runtime || typeof runtime.navigate !== 'function') throw new TypeError('De applicatieruntime ontbreekt.');
    if (!win || !doc || !win.history) throw new TypeError('Browser navigation APIs ontbreken.');

    let current = null;
    let started = false;
    let disposed = false;
    let sequence = 0;

    function routeFromUrl(rawUrl) {
      let url;
      try { url = new URL(String(rawUrl || win.location.href), win.location.origin); }
      catch (_) { return null; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.origin !== win.location.origin) return null;
      const definition = routeMap.get(normalizePath(url.pathname));
      if (!definition) return null;
      return {
        definition,
        url,
        context: {
          href: `${url.pathname}${url.search}${url.hash}`,
          pathname: url.pathname,
          search: url.search,
          hash: url.hash,
          query: new URLSearchParams(url.search),
        },
      };
    }

    function paintRoute(route) {
      if (!route) return;
      if (route.definition.title) doc.title = route.definition.title;
      if (route.definition.sidebarKey) {
        doc.querySelectorAll('.sidebar-link[data-sidebar-key]').forEach((link) => {
          const active = link.getAttribute('data-sidebar-key') === route.definition.sidebarKey;
          link.classList.toggle('active', active);
          if (active) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        });
      }
      try { onRouteChange({ href: route.context.href, ...route.definition }); }
      catch (error) { report(error, route.definition.moduleId, 'route-change'); }
    }

    function report(error, moduleId, stage) {
      try { onError({ error, moduleId, stage }); } catch (_) { /* observability mag de navigatie niet breken */ }
    }

    function setHistoryRoute(route, mode) {
      const previousState = isPlainHistoryState(win.history.state) ? win.history.state : {};
      const state = {
        ...previousState,
        softoraApplication: { moduleId: route.definition.moduleId },
      };
      if (mode === 'replace') win.history.replaceState(state, '', route.context.href);
      else win.history.pushState(state, '', route.context.href);
    }

    function isSuccessful(result) {
      return Boolean(result && ['mounted', 'updated'].includes(result.status));
    }

    async function navigate(rawUrl, mode) {
      if (disposed) return { status: 'disposed' };
      const target = routeFromUrl(rawUrl);
      if (!target) return { status: 'unregistered-route' };
      if (current && target.context.href === current.context.href) return { status: 'current' };
      const navSequence = ++sequence;
      let result;
      try {
        result = await runtime.navigate(target.definition.moduleId, target.context);
      } catch (error) {
        report(error, target.definition.moduleId, 'navigate');
        result = { status: 'error', error };
      }
      if (disposed || navSequence !== sequence) return { status: 'superseded' };
      if (!isSuccessful(result)) return result || { status: 'error' };

      current = target;
      if (mode === 'push' || mode === 'replace') setHistoryRoute(target, mode);
      paintRoute(target);
      return result;
    }

    function findAnchor(target) {
      if (!target || typeof target.closest !== 'function') return null;
      return target.closest('a[href]');
    }

    function shouldIntercept(event, anchor) {
      if (!anchor || event.defaultPrevented || (event.button != null && event.button !== 0) ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      if (anchor.hasAttribute('download')) return false;
      const target = String(anchor.getAttribute('target') || '').trim().toLowerCase();
      if (target && target !== '_self') return false;
      if (anchor.getAttribute('rel')?.split(/\s+/).includes('external')) return false;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return false;
      const resolved = routeFromUrl(anchor.href || href);
      if (!resolved) return false;
      if (!anchor.closest('.sidebar') && !anchor.hasAttribute('data-application-link')) return false;
      if (current && normalizePath(resolved.url.pathname) === normalizePath(current.url.pathname) &&
          resolved.url.search === current.url.search) return false;
      return true;
    }

    function handleClick(event) {
      const anchor = findAnchor(event.target);
      if (!shouldIntercept(event, anchor)) return;
      event.preventDefault();
      void navigate(anchor.href || anchor.getAttribute('href'), 'push');
    }

    function restoreCurrentHistoryEntry() {
      if (!current || disposed) return;
      try { setHistoryRoute(current, 'replace'); }
      catch (error) { report(error, current.definition.moduleId, 'history-restore'); }
    }

    async function handlePopState() {
      if (disposed) return;
      const target = routeFromUrl(win.location.href);
      if (!target) {
        if (win.history.state && win.history.state.softoraApplication) {
          restoreCurrentHistoryEntry();
          return;
        }
        return;
      }
      const result = await navigate(win.location.href, 'none');
      if (!isSuccessful(result) && result.status !== 'current') restoreCurrentHistoryEntry();
    }

    function start() {
      if (disposed) throw new Error('Applicatienavigatie is al opgeruimd.');
      if (started) return Boolean(current);
      const initialRoute = routeFromUrl(win.location.href);
      if (!initialRoute) return false;
      started = true;
      current = initialRoute;
      setHistoryRoute(initialRoute, 'replace');
      paintRoute(initialRoute);
      doc.addEventListener('click', handleClick);
      win.addEventListener('popstate', handlePopState);
      return true;
    }

    function stop() {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      if (started) {
        doc.removeEventListener('click', handleClick);
        win.removeEventListener('popstate', handlePopState);
      }
    }

    return Object.freeze({
      start,
      navigate,
      stop,
      getState: () => Object.freeze({
        currentHref: current ? current.context.href : '',
        moduleId: current ? current.definition.moduleId : '',
        started,
        disposed,
      }),
    });
  }

  return Object.freeze({ createPremiumApplicationNavigation });
});
