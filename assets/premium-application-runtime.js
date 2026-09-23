(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoftoraPremiumApplicationRuntime = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function toModuleMap(modules) {
    const entries = modules instanceof Map ? Array.from(modules.entries()) : Object.entries(modules || {});
    const result = new Map();
    for (const [rawId, module] of entries) {
      const id = String(rawId || '').trim();
      const budget = module && module.prepareBudget;
      if (!id || !module || typeof module !== 'object') throw new TypeError('Elke applicatiemodule heeft een id en definitie nodig.');
      for (const method of ['prepare', 'mount', 'ready', 'update', 'dispose']) {
        if (typeof module[method] !== 'function') throw new TypeError(`${id}: module mist ${method}().`);
      }
      if (!Array.isArray(module.reads) || module.reads.some((key) => typeof key !== 'string' || !key.trim())) {
        throw new TypeError(`${id}: declareer een lijst met toegestane reads.`);
      }
      if (new Set(module.reads).size !== module.reads.length) throw new TypeError(`${id}: reads mogen geen dubbelen bevatten.`);
      if (!budget || !Number.isInteger(budget.maxReads) || budget.maxReads < 0 ||
          !Number.isFinite(budget.maxBytes) || budget.maxBytes < 0 ||
          !Number.isFinite(budget.maxMs) || budget.maxMs <= 0) {
        throw new TypeError(`${id}: declareer maxReads, maxBytes en maxMs voor prepare.`);
      }
      if (!Number.isInteger(module.readyBudgetMs) || module.readyBudgetMs < 1 || module.readyBudgetMs > 3000) {
        throw new TypeError(`${id}: readyBudgetMs moet tussen 1 en 3000 ms liggen.`);
      }
      if (module.roles != null && !Array.isArray(module.roles)) throw new TypeError(`${id}: roles moet een lijst zijn.`);
      const roles = module.roles == null ? null : module.roles.map((role) => String(role));
      result.set(id, { ...module, id, reads: new Set(module.reads), roles });
    }
    return result;
  }

  function sessionSnapshot(raw) {
    const authenticated = Boolean(raw && raw.authenticated === true);
    const scope = authenticated ? String(raw.scope || raw.userId || raw.subject || '').trim() : '';
    if (authenticated && !scope) throw new TypeError('Een ingelogde sessie moet een stabiele, niet-geheime scope bevatten.');
    const role = authenticated ? String(raw.role || '').trim() : '';
    const generation = authenticated ? String(raw.generation || '').trim() : '';
    return Object.freeze({
      authenticated,
      scope,
      role,
      generation,
      key: JSON.stringify([authenticated, scope, role, generation]),
    });
  }

  function abort(controller, reason) {
    if (!controller || controller.signal.aborted) return;
    try { controller.abort(reason); } catch (_) { controller.abort(); }
  }

  function estimateBytes(value) {
    if (value === undefined) return 0;
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new TypeError('Read-resultaat is niet JSON-serialiseerbaar.');
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).byteLength : serialized.length * 2;
  }

  function createPremiumApplicationRuntime(options) {
    const config = options || {};
    const modules = toModuleMap(config.modules);
    const host = config.host || {};
    const dataClient = config.dataClient || {};
    const getSession = typeof config.getSession === 'function' ? config.getSession : () => null;
    const onError = typeof config.onError === 'function' ? config.onError : () => {};
    const onSessionChange = typeof config.onSessionChange === 'function' ? config.onSessionChange : () => {};
    if (typeof host.create !== 'function' || typeof host.activate !== 'function' || typeof host.clear !== 'function') {
      throw new TypeError('De shell-host moet create(), activate() en clear() aanbieden.');
    }
    if (typeof dataClient.clearSession !== 'function') {
      throw new TypeError('De gedeelde read-client moet clearSession() aanbieden.');
    }

    let active = null;
    let currentSession = sessionSnapshot(getSession());
    let sessionChangeTask = Promise.resolve();
    let pendingNavigation = null;
    let commitTask = null;
    let navigationVersion = 0;
    let destroyed = false;

    function report(error, moduleId, stage) {
      try { onError({ error, moduleId, stage }); } catch (_) { /* observability mag de shell niet breken */ }
    }

    async function release(entry, reason) {
      if (!entry) return;
      abort(entry.lifetime, reason);
      try {
        await entry.module.dispose({ root: entry.root, route: entry.route, session: entry.session, reason });
      } catch (error) {
        report(error, entry.moduleId, 'dispose');
      }
      try {
        if (typeof host.remove === 'function') await host.remove(entry.root);
        else if (entry.root && typeof entry.root.remove === 'function') entry.root.remove();
      } catch (error) {
        report(error, entry.moduleId, 'remove');
      }
    }

    function synchronizeSession(next) {
      if (next.key === currentSession.key) return sessionChangeTask;
      const previous = currentSession;
      currentSession = next;
      navigationVersion += 1;
      if (pendingNavigation) {
        abort(pendingNavigation.controller, 'session-changed');
        abort(pendingNavigation.lifetime, 'session-changed');
      }
      const previousEntry = active;
      active = null;
      sessionChangeTask = sessionChangeTask.catch(() => {}).then(async () => {
        let failure = null;
        const attempt = async (run) => {
          try { await run(); } catch (error) { failure ||= error; }
        };
        await attempt(() => host.clear());
        if (previousEntry) await release(previousEntry, 'session-changed');
        await attempt(() => dataClient.clearSession(previous.key, next.key));
        await attempt(() => onSessionChange({ previous: { ...previous }, current: { ...next } }));
        if (failure) throw failure;
      });
      return sessionChangeTask;
    }

    function isCurrent(version, controller) {
      return !destroyed && version === navigationVersion && !controller.signal.aborted;
    }

    function authorize(module, session) {
      if (module.requiresAuth !== false && !session.authenticated) return 'unauthenticated';
      if (module.roles && !module.roles.includes(session.role)) return 'forbidden';
      return '';
    }

    async function runPrepare(module, route, session, controller) {
      const startedAt = Date.now();
      let reads = 0;
      let bytes = 0;
      let open = true;
      const inFlight = new Set();
      const read = (key, params) => {
        const readKey = String(key || '').trim();
        if (!open) return Promise.reject(new Error(`${module.id}: prepare-read is na prepare() niet meer beschikbaar.`));
        if (!module.reads.has(readKey)) return Promise.reject(new Error(`${module.id}: read '${readKey}' staat niet geregistreerd.`));
        if (typeof dataClient.read !== 'function') return Promise.reject(new Error('De gedeelde read-client ontbreekt.'));
        if (controller.signal.aborted) return Promise.reject(new Error('Read afgebroken.'));
        reads += 1;
        if (reads > module.prepareBudget.maxReads) return Promise.reject(new Error(`${module.id}: prepare overschrijdt het read-budget.`));
        const request = Promise.resolve().then(() => dataClient.read(readKey, params, { signal: controller.signal, sessionKey: session.key }))
          .then((value) => {
            bytes += estimateBytes(value);
            if (bytes > module.prepareBudget.maxBytes) throw new Error(`${module.id}: prepare overschrijdt het byte-budget.`);
            if (Date.now() - startedAt > module.prepareBudget.maxMs) throw new Error(`${module.id}: prepare overschrijdt het tijd-budget.`);
            return value;
          });
        inFlight.add(request);
        request.finally(() => inFlight.delete(request)).catch(() => {});
        return request;
      };
      const work = Promise.resolve().then(() => module.prepare({ route, session, signal: controller.signal, read }));
      let timeout;
      let abortHandler;
      const aborted = new Promise((_, reject) => {
        abortHandler = () => reject(new Error(`${module.id}: prepare afgebroken.`));
        controller.signal.addEventListener('abort', abortHandler, { once: true });
      });
      try {
        const prepared = await Promise.race([
          work,
          aborted,
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              abort(controller, 'prepare-timeout');
              reject(new Error(`${module.id}: prepare overschrijdt het tijd-budget.`));
            }, module.prepareBudget.maxMs);
          }),
        ]);
        if (inFlight.size) {
          abort(controller, 'prepare-unawaited-read');
          throw new Error(`${module.id}: prepare moet alle geregistreerde reads afwachten.`);
        }
        return prepared;
      } finally {
        open = false;
        if (timeout) clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abortHandler);
      }
    }

    async function runReady(module, details, controller, lifetime) {
      let timeout;
      let abortHandler;
      const cancelled = new Promise((_, reject) => {
        abortHandler = () => reject(new Error(`${module.id}: gereedheidscontrole afgebroken.`));
        controller.signal.addEventListener('abort', abortHandler, { once: true });
      });
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => module.ready(details)),
          cancelled,
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              abort(lifetime, 'ready-timeout');
              reject(new Error(`${module.id}: scherm niet compleet binnen het gereedheidsbudget.`));
            }, module.readyBudgetMs);
          }),
        ]);
        if (result !== true) throw new Error(`${module.id}: scherm is nog niet compleet.`);
      } finally {
        if (timeout) clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abortHandler);
      }
    }

    async function navigate(moduleIdRaw, routeRaw) {
      if (destroyed) return { status: 'disposed' };
      if (commitTask) {
        try { await commitTask; } catch (_) { /* the committing navigation reports its own failure */ }
        if (destroyed) return { status: 'disposed' };
      }
      const moduleId = String(moduleIdRaw || '').trim();
      const module = modules.get(moduleId);
      if (!module) return { status: 'unknown-module' };
      const route = routeRaw && typeof routeRaw === 'object' ? routeRaw : {};
      const session = sessionSnapshot(getSession());
      try {
        await synchronizeSession(session);
      } catch (error) {
        report(error, moduleId, 'session-change');
        return { status: 'error', error };
      }
      if (destroyed) return { status: 'disposed' };

      const version = ++navigationVersion;
      if (pendingNavigation) {
        abort(pendingNavigation.controller, 'superseded');
        abort(pendingNavigation.lifetime, 'superseded');
      }
      const controller = new AbortController();
      const operation = { version, controller };
      pendingNavigation = operation;
      const finish = (result) => {
        if (pendingNavigation === operation) pendingNavigation = null;
        return result;
      };

      const denial = authorize(module, session);
      if (denial) return finish({ status: denial });
      if (typeof module.authorize === 'function') {
        try {
          if (await module.authorize({ route, session }) !== true) return finish({ status: 'forbidden' });
        } catch (error) {
          report(error, moduleId, 'authorize');
          return finish({ status: 'error', error });
        }
      }
      if (!isCurrent(version, controller)) return finish({ status: 'superseded' });

      const previous = active;
      if (previous && typeof previous.module.canLeave === 'function') {
        try {
          const canLeave = await previous.module.canLeave({ from: previous.route, to: route, session: previous.session });
          if (!isCurrent(version, controller)) return finish({ status: 'superseded' });
          if (canLeave === false) {
            return finish({ status: 'blocked' });
          }
        } catch (error) {
          report(error, previous.moduleId, 'can-leave');
          return finish({ status: 'error', error });
        }
        if (!isCurrent(version, controller)) return finish({ status: 'superseded' });
      }

      let prepared;
      try {
        prepared = await runPrepare(module, route, session, controller);
      } catch (error) {
        report(error, moduleId, 'prepare');
        return finish({ status: isCurrent(version, controller) ? 'error' : 'superseded', error });
      }
      if (!isCurrent(version, controller)) return finish({ status: 'superseded' });
      if (sessionSnapshot(getSession()).key !== session.key) {
        try { await synchronizeSession(sessionSnapshot(getSession())); }
        catch (error) { report(error, moduleId, 'session-change'); return finish({ status: 'error', error }); }
        return finish({ status: 'session-changed' });
      }

      if (previous && previous.moduleId === moduleId) {
        try {
          await module.update({ root: previous.root, route, prepared, session, signal: controller.signal, lifecycleSignal: previous.lifetime.signal });
          if (!isCurrent(version, controller)) return finish({ status: 'superseded' });
          previous.route = route;
          previous.session = session;
          return finish({ status: 'updated', moduleId });
        } catch (error) {
          report(error, moduleId, 'update');
          return finish({ status: isCurrent(version, controller) ? 'error' : 'superseded', error });
        }
      }

      let root;
      let lifetime;
      let stage = 'mount';
      try {
        root = await host.create({ moduleId, route });
        if (!root) throw new Error(`${moduleId}: shell-host gaf geen mount-root terug.`);
        lifetime = new AbortController();
        operation.lifetime = lifetime;
        await module.mount({ root, route, prepared, session, signal: lifetime.signal });
        if (!isCurrent(version, controller)) {
          await release({ moduleId, module, root, route, session, lifetime }, 'superseded');
          return finish({ status: 'superseded' });
        }
        if (sessionSnapshot(getSession()).key !== session.key) {
          await release({ moduleId, module, root, route, session, lifetime }, 'session-changed');
          try { await synchronizeSession(sessionSnapshot(getSession())); }
          catch (error) { report(error, moduleId, 'session-change'); return finish({ status: 'error', error }); }
          return finish({ status: 'session-changed' });
        }
        stage = 'ready';
        await runReady(module, { root, route, prepared, session, signal: lifetime.signal }, controller, lifetime);
        if (!isCurrent(version, controller)) {
          await release({ moduleId, module, root, route, session, lifetime }, 'superseded');
          return finish({ status: 'superseded' });
        }
        if (sessionSnapshot(getSession()).key !== session.key) {
          await release({ moduleId, module, root, route, session, lifetime }, 'session-changed');
          try { await synchronizeSession(sessionSnapshot(getSession())); }
          catch (error) { report(error, moduleId, 'session-change'); return finish({ status: 'error', error }); }
          return finish({ status: 'session-changed' });
        }
        stage = 'activate';
        const commit = (async () => {
          await host.activate(root, { moduleId, route, previousRoot: previous && previous.root });
          active = { moduleId, module, root, route, session, lifetime };
          if (previous) await release(previous, 'navigate');
        })();
        commitTask = commit;
        try { await commit; }
        finally { if (commitTask === commit) commitTask = null; }
      } catch (error) {
        if (root) await release({ moduleId, module, root, route, session, lifetime: lifetime || new AbortController() }, 'mount-failed');
        report(error, moduleId, stage);
        return finish({ status: isCurrent(version, controller) ? 'error' : 'superseded', error });
      }

      return finish({ status: 'mounted', moduleId });
    }

    async function dispose() {
      if (destroyed) return;
      destroyed = true;
      navigationVersion += 1;
      if (pendingNavigation) {
        abort(pendingNavigation.controller, 'runtime-disposed');
        abort(pendingNavigation.lifetime, 'runtime-disposed');
      }
      try { await sessionChangeTask; } catch (error) { report(error, '', 'session-change'); }
      if (commitTask) {
        try { await commitTask; } catch (_) { /* the navigation reports the failure */ }
      }
      const previous = active;
      active = null;
      try { await host.clear(); } catch (error) { report(error, '', 'clear'); }
      await release(previous, 'runtime-disposed');
    }

    return Object.freeze({
      navigate,
      dispose,
      getState: () => Object.freeze({
        activeModuleId: active ? active.moduleId : '',
        route: active ? active.route : null,
        sessionKey: currentSession.key,
        preparing: Boolean(pendingNavigation),
        disposed: destroyed,
      }),
    });
  }

  return Object.freeze({ createPremiumApplicationRuntime });
});
