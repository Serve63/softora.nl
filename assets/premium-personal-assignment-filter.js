(function (root) {
    'use strict';

    const FILTER_STORAGE_PREFIX = 'softora_only_my_assignments_v1';
    const SESSION_STORAGE_KEY = 'softora_premium_sidebar_session_v1';
    const TOGGLE_SELECTOR = '[data-only-my-assignments-toggle]';
    const listeners = new Set();

    let cachedOwner = '';
    let cachedEnabled = false;
    let stateLoaded = false;
    let currentSessionPromise = null;

    function normalizeOwnerLabel(value) {
        const raw = String(value || '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
        if (words.includes('serve')) return 'Servé';
        if (words.includes('martijn')) return 'Martijn';
        return '';
    }

    function readSidebarSessionSnapshot() {
        try {
            const raw = root.sessionStorage ? root.sessionStorage.getItem(SESSION_STORAGE_KEY) : '';
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
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

    async function loadSession() {
        if (currentSessionPromise) return currentSessionPromise;

        currentSessionPromise = (async () => {
            const cachedSession = readSidebarSessionSnapshot();
            if (cachedSession && cachedSession.authenticated) return cachedSession;

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

        const fromSession = resolveOwnerFromSessionLike(readSidebarSessionSnapshot());
        if (fromSession) {
            cachedOwner = fromSession;
            return cachedOwner;
        }

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

    function readStoredEnabled(owner) {
        const normalizedOwner = normalizeOwnerLabel(owner);
        if (!normalizedOwner) return false;
        try {
            return root.localStorage ? root.localStorage.getItem(buildStorageKey(normalizedOwner)) === '1' : false;
        } catch (_) {
            return false;
        }
    }

    function writeStoredEnabled(owner, enabled) {
        const normalizedOwner = normalizeOwnerLabel(owner);
        if (!normalizedOwner) return false;
        try {
            if (!root.localStorage) return false;
            root.localStorage.setItem(buildStorageKey(normalizedOwner), enabled ? '1' : '0');
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
        cachedEnabled = readStoredEnabled(owner);
        stateLoaded = true;
        syncToggleElements();
        return { enabled: cachedEnabled, owner };
    }

    async function setEnabled(nextEnabled) {
        const owner = await ensureOwner();
        cachedEnabled = Boolean(nextEnabled) && Boolean(owner);
        writeStoredEnabled(owner, cachedEnabled);
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
