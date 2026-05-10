(function (root) {
    'use strict';

    const FILTER_STORAGE_PREFIX = 'softora_only_my_assignments_v1';
    const FILTER_SCOPE = 'premium_assignment_filters';
    const TOGGLE_SELECTOR = '[data-only-my-assignments-toggle]';
    const listeners = new Set();

    let cachedOwner = '';
    let cachedEnabled = false;
    let stateLoaded = false;
    let currentSessionPromise = null;
    let currentPreferencePromise = null;
    let storedPreferences = Object.create(null);

    function normalizeOwnerLabel(value) {
        const raw = String(value || '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
        if (words.includes('serve')) return 'Servé';
        if (words.includes('martijn')) return 'Martijn';
        return '';
    }

    function resolveOwnerFromSessionLike(sessionLike) {
        if (!sessionLike || typeof sessionLike !== 'object') return '';
        const candidates = [
            sessionLike.displayName,
            sessionLike.firstName,
            sessionLike.name,
            sessionLike.email,
            sessionLike.userId,
        ];
        for (const candidate of candidates) {
            const owner = normalizeOwnerLabel(candidate);
            if (owner) return owner;
        }
        return '';
    }

    function resolveOwnerFromDom() {
        const nameEl = root.document ? root.document.querySelector('[data-sidebar-user-name]') : null;
        return normalizeOwnerLabel(nameEl ? nameEl.textContent : '');
    }

    function parseJsonObject(value) {
        if (!value) return null;
        if (typeof value === 'object' && !Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(String(value || '').trim());
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function getUiStateReadUrls(scope) {
        const encodedScope = encodeURIComponent(String(scope || '').trim());
        return [
            `/api/ui-state-get?scope=${encodedScope}`,
            `/api/ui-state/${encodedScope}`
        ];
    }

    function getUiStateWriteUrls(scope) {
        const encodedScope = encodeURIComponent(String(scope || '').trim());
        return [
            `/api/ui-state-set?scope=${encodedScope}`,
            `/api/ui-state/${encodedScope}`
        ];
    }

    async function requestJsonWithFallback(urls, options, label) {
        let lastError = null;
        for (const url of urls) {
            try {
                const response = await root.fetch(url, options);
                if (!response.ok) throw new Error(`${label} mislukt (${response.status})`);
                return await response.json().catch(() => ({}));
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error(`${label} mislukt`);
    }

    async function loadSession() {
        if (currentSessionPromise) return currentSessionPromise;

        currentSessionPromise = (async () => {
            if (root.SoftoraPersonnelTheme && typeof root.SoftoraPersonnelTheme.refreshPremiumSession === 'function') {
                try {
                    const refreshed = await root.SoftoraPersonnelTheme.refreshPremiumSession();
                    if (refreshed && refreshed.authenticated) return refreshed;
                } catch (_) {
                    // fall through
                }
            }

            try {
                const response = await root.fetch('/api/auth/session', { method: 'GET', cache: 'no-store' });
                if (!response.ok) throw new Error(`Sessiestatus mislukt (${response.status})`);
                const payload = await response.json().catch(() => null);
                return payload && payload.authenticated ? payload : null;
            } catch (_) {
                return null;
            }
        })();

        try {
            return await currentSessionPromise;
        } finally {
            currentSessionPromise = null;
        }
    }

    async function ensureOwner(options = {}) {
        if (cachedOwner && !options.force) return cachedOwner;

        const fromDom = resolveOwnerFromDom();
        if (fromDom) {
            cachedOwner = fromDom;
            return cachedOwner;
        }

        const session = await loadSession();
        cachedOwner = resolveOwnerFromSessionLike(session);
        return cachedOwner;
    }

    function buildStorageKey(owner) {
        const normalizedOwner = normalizeOwnerLabel(owner);
        return `${FILTER_STORAGE_PREFIX}:${normalizedOwner || 'unknown'}`;
    }

    async function readStoredPreferences(options = {}) {
        if (currentPreferencePromise) return currentPreferencePromise;
        if (!options.force && Object.keys(storedPreferences).length) return storedPreferences;

        currentPreferencePromise = (async () => {
            try {
                const payload = await requestJsonWithFallback(
                    getUiStateReadUrls(FILTER_SCOPE),
                    { method: 'GET', cache: 'no-store' },
                    'Persoonlijke filter laden'
                );
                const values = payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object'
                    ? payload.values
                    : {};
                const rawMap = parseJsonObject(values[FILTER_STORAGE_PREFIX]) || {};
                const nextPreferences = Object.create(null);
                Object.entries(rawMap).forEach(([rawOwner, enabled]) => {
                    const owner = normalizeOwnerLabel(rawOwner);
                    if (owner) nextPreferences[owner] = Boolean(enabled);
                });
                storedPreferences = nextPreferences;
            } catch (_) {
                storedPreferences = storedPreferences && typeof storedPreferences === 'object'
                    ? storedPreferences
                    : Object.create(null);
            } finally {
                currentPreferencePromise = null;
            }
            return storedPreferences;
        })();

        return currentPreferencePromise;
    }

    async function readStoredEnabled(owner) {
        const normalizedOwner = normalizeOwnerLabel(owner);
        if (!normalizedOwner) return false;
        const preferences = await readStoredPreferences();
        return Boolean(preferences[normalizedOwner]);
    }

    async function writeStoredEnabled(owner, enabled) {
        const normalizedOwner = normalizeOwnerLabel(owner);
        if (!normalizedOwner) return false;
        const currentPreferences = await readStoredPreferences();
        const nextPreferences = {
            ...currentPreferences,
            [normalizedOwner]: Boolean(enabled)
        };
        storedPreferences = nextPreferences;
        try {
            await requestJsonWithFallback(
                getUiStateWriteUrls(FILTER_SCOPE),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        patch: {
                            [FILTER_STORAGE_PREFIX]: JSON.stringify(nextPreferences)
                        },
                        source: buildStorageKey(normalizedOwner),
                        actor: 'browser'
                    })
                },
                'Persoonlijke filter opslaan'
            );
            return true;
        } catch (_) {
            return false;
        }
    }

    function syncToggleElements() {
        const toggles = Array.from(root.document ? root.document.querySelectorAll(TOGGLE_SELECTOR) : []);
        toggles.forEach((toggle) => {
            toggle.checked = cachedEnabled;
            toggle.disabled = !cachedOwner;
            const wrap = toggle.closest('.personal-assignment-toggle');
            if (wrap) {
                wrap.dataset.assignmentFilterReady = cachedOwner ? '1' : '0';
                wrap.setAttribute(
                    'title',
                    cachedOwner
                        ? `Toon alleen opdrachten en leads voor ${cachedOwner}.`
                        : 'Persoonlijke toewijzingen worden geladen.'
                );
            }
        });
    }

    function notifyListeners() {
        const state = { enabled: cachedEnabled, owner: cachedOwner };
        listeners.forEach((listener) => {
            try {
                listener(state);
            } catch (_) {
                // ignore listener errors
            }
        });
        try {
            root.dispatchEvent(new CustomEvent('softora-assignment-filter-change', { detail: state }));
        } catch (_) {
            // ignore event errors
        }
    }

    async function getState(options = {}) {
        const owner = await ensureOwner(options);
        cachedEnabled = await readStoredEnabled(owner);
        stateLoaded = true;
        syncToggleElements();
        return { enabled: cachedEnabled, owner };
    }

    async function setEnabled(nextEnabled) {
        const owner = await ensureOwner();
        cachedEnabled = Boolean(nextEnabled) && Boolean(owner);
        await writeStoredEnabled(owner, cachedEnabled);
        stateLoaded = true;
        syncToggleElements();
        notifyListeners();
        return { enabled: cachedEnabled, owner };
    }

    function matchesOwner(value, owner) {
        const normalizedValue = normalizeOwnerLabel(value);
        const normalizedOwner = normalizeOwnerLabel(owner || cachedOwner);
        return Boolean(normalizedValue && normalizedOwner && normalizedValue === normalizedOwner);
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return function noop() {};
        listeners.add(listener);
        if (stateLoaded) {
            try {
                listener({ enabled: cachedEnabled, owner: cachedOwner });
            } catch (_) {
                // ignore listener errors
            }
        }
        return function unsubscribe() {
            listeners.delete(listener);
        };
    }

    function bindToggle(toggle) {
        if (!toggle || toggle.dataset.assignmentFilterBound === '1') return;
        toggle.dataset.assignmentFilterBound = '1';
        toggle.addEventListener('change', () => {
            void setEnabled(toggle.checked);
        });
    }

    function initToggleElements() {
        const toggles = Array.from(root.document ? root.document.querySelectorAll(TOGGLE_SELECTOR) : []);
        toggles.forEach(bindToggle);
        void getState().then(notifyListeners).catch(() => {
            syncToggleElements();
        });
    }

    if (root.document) {
        if (root.document.readyState === 'loading') {
            root.document.addEventListener('DOMContentLoaded', initToggleElements, { once: true });
        } else {
            initToggleElements();
        }
    }

    root.addEventListener('pageshow', () => {
        void getState({ force: true }).then(notifyListeners).catch(() => {
            syncToggleElements();
        });
    });

    root.SoftoraAssignmentFilter = Object.freeze({
        getState,
        setEnabled,
        matchesOwner,
        normalizeOwnerLabel,
        subscribe,
        getCachedState() {
            return { enabled: cachedEnabled, owner: cachedOwner };
        }
    });
})(typeof window !== 'undefined' ? window : globalThis);
