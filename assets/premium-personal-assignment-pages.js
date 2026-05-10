(function (root) {
    'use strict';

    const doc = root.document;
    if (!doc) return;

    const ORDERS_EMPTY_CLASS = 'personal-assignment-empty-state';
    let currentState = { enabled: false, owner: '' };
    let activeOrdersObserver = null;
    let leadsObserver = null;
    let createOrderObserver = null;
    let syncScheduled = false;
    let agendaLeadOwnersPromise = null;
    let agendaLeadOwnersById = new Map();

    function normalizeOwner(value) {
        const filterApi = root.SoftoraAssignmentFilter;
        if (filterApi && typeof filterApi.normalizeOwnerLabel === 'function') {
            return filterApi.normalizeOwnerLabel(value);
        }
        const raw = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (raw.includes('serve')) return 'Servé';
        if (raw.includes('martijn')) return 'Martijn';
        return '';
    }

    function matchesCurrentOwner(value) {
        if (!currentState.enabled || !currentState.owner) return true;
        const filterApi = root.SoftoraAssignmentFilter;
        if (filterApi && typeof filterApi.matchesOwner === 'function') {
            return filterApi.matchesOwner(value, currentState.owner);
        }
        return normalizeOwner(value) === normalizeOwner(currentState.owner);
    }

    function parseEuroAmount(value) {
        const digits = String(value || '').replace(/[^0-9]/g, '');
        const amount = Number(digits);
        return Number.isFinite(amount) ? amount : 0;
    }

    function classifyOrderProductLine(card) {
        const title = String(card.querySelector('.order-title')?.textContent || '').trim();
        const description = String(card.querySelector('.order-desc')?.textContent || '').trim();
        const hay = `${title} ${description}`.toLowerCase();
        if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot|conversational\s*bot/.test(hay)) return 'chatbot';
        if (/voicesoftware|voice\s*software|spraaksoftware|belsoftware|voice\s*agent|ai\s*voice|spraak\s*agent/.test(hay)) return 'voice';
        if (/bedrijfssoftware|business\s*software|\bcrm\b|\berp\b/.test(hay)) return 'business';
        return 'other';
    }

    function getActiveOrderFilterKey() {
        return String(doc.querySelector('[data-order-filter].active')?.getAttribute('data-order-filter') || 'in_progress');
    }

    function isCompletedOrderCard(card) {
        return card.classList.contains('delivered') || card.classList.contains('paid');
    }

    function applyActiveOrdersEmptyState(cards) {
        const grid = doc.getElementById('ordersGrid');
        if (!grid) return;

        let empty = grid.querySelector(`.${ORDERS_EMPTY_CLASS}`);
        const visibleCards = cards.filter((card) => !card.hidden && card.dataset.personalAssignmentHidden !== '1');
        if (!currentState.enabled || !cards.length || visibleCards.length) {
            if (empty) empty.remove();
            return;
        }

        const activeFilter = getActiveOrderFilterKey();
        const textByFilter = {
            completed: 'Geen voltooide opdrachten aan jou toegewezen.',
            in_progress: 'Geen openstaande opdrachten aan jou toegewezen.',
        };
        if (!empty) {
            empty = doc.createElement('div');
            empty.className = `orders-empty-state ${ORDERS_EMPTY_CLASS}`;
            grid.appendChild(empty);
        }
        empty.textContent = textByFilter[activeFilter] || 'Geen opdrachten aan jou toegewezen.';
    }

    function applyActiveOrdersSummary(cards) {
        const eligibleCards = currentState.enabled
            ? cards.filter((card) => matchesCurrentOwner(card.querySelector('.order-assignee')?.textContent || ''))
            : cards.slice();

        let activeCount = 0;
        let business = 0;
        let voice = 0;
        let chatbot = 0;
        let openValue = 0;
        let deliveredCount = 0;

        eligibleCards.forEach((card) => {
            const completed = isCompletedOrderCard(card);
            if (!completed) {
                activeCount += 1;
                const line = classifyOrderProductLine(card);
                if (line === 'business') business += 1;
                else if (line === 'voice') voice += 1;
                else if (line === 'chatbot') chatbot += 1;
            } else {
                deliveredCount += 1;
            }

            if (!card.classList.contains('paid')) {
                openValue += parseEuroAmount(card.querySelector('.order-price-value')?.textContent || '');
            }
        });

        const sumActive = doc.getElementById('sumActive');
        const totalEl = sumActive?.querySelector('[data-sum-active-total]');
        const businessEl = sumActive?.querySelector('[data-sum-active-business]');
        const voiceEl = sumActive?.querySelector('[data-sum-active-voice]');
        const chatbotEl = sumActive?.querySelector('[data-sum-active-chatbot]');
        if (sumActive && totalEl && businessEl && voiceEl && chatbotEl) {
            totalEl.textContent = String(activeCount);
            businessEl.textContent = String(business);
            voiceEl.textContent = String(voice);
            chatbotEl.textContent = String(chatbot);
            sumActive.setAttribute(
                'aria-label',
                `Actieve opdrachten: ${activeCount}, bedrijfssoftware: ${business}, voicesoftware: ${voice}, chatbot: ${chatbot}`
            );
        }

        const sumTotal = doc.getElementById('sumTotal');
        if (sumTotal) sumTotal.textContent = `€${openValue.toLocaleString('nl-NL')}`;

        const sumDelivered = doc.getElementById('sumDelivered');
        if (sumDelivered) sumDelivered.textContent = String(deliveredCount);

        const progressCount = doc.getElementById('filterCountProgress');
        const completedCount = doc.getElementById('filterCountCompleted');
        if (progressCount) progressCount.textContent = String(eligibleCards.filter((card) => !isCompletedOrderCard(card)).length);
        if (completedCount) completedCount.textContent = String(eligibleCards.filter((card) => isCompletedOrderCard(card)).length);
    }

    async function ensureAgendaLeadOwnersLoaded() {
        if (agendaLeadOwnersById.size) return agendaLeadOwnersById;
        if (agendaLeadOwnersPromise) return agendaLeadOwnersPromise;

        agendaLeadOwnersPromise = (async () => {
            try {
                const response = await root.fetch('/api/agenda/appointments?limit=250', { cache: 'no-store' });
                const payload = await response.json().catch(() => ({}));
                const next = new Map();
                if (response.ok && payload?.ok && Array.isArray(payload.appointments)) {
                    payload.appointments.forEach((item) => {
                        const id = Number(item?.id);
                        if (!Number.isFinite(id) || id <= 0) return;
                        const owner = String(item?.leadOwnerFullName || item?.leadOwnerName || '').trim();
                        next.set(String(id), owner);
                    });
                }
                agendaLeadOwnersById = next;
            } catch (_) {
                agendaLeadOwnersById = new Map();
            } finally {
                agendaLeadOwnersPromise = null;
            }
            return agendaLeadOwnersById;
        })();

        return agendaLeadOwnersPromise;
    }

    async function syncCreateOrderAgendaOptions() {
        const modal = doc.getElementById('createOrderModal');
        const select = doc.getElementById('newOrderAgendaLeadId');
        const hint = doc.getElementById('newOrderAgendaLeadHint');
        if (!modal || !select) return;

        await ensureAgendaLeadOwnersLoaded();

        const options = Array.from(select.options || []);
        let visibleAgendaOptions = 0;
        options.forEach((option) => {
            if (!option.value) {
                option.hidden = false;
                return;
            }
            const ownerValue = agendaLeadOwnersById.get(String(option.value)) || '';
            const hidden = currentState.enabled && !matchesCurrentOwner(ownerValue);
            option.hidden = hidden;
            option.disabled = hidden;
            if (!hidden) visibleAgendaOptions += 1;
        });

        if (select.value) {
            const selectedOption = options.find((option) => option.value === select.value);
            if (selectedOption?.hidden) {
                select.value = '';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        if (
            hint &&
            modal.classList.contains('show') &&
            currentState.enabled &&
            options.some((option) => option.value) &&
            visibleAgendaOptions === 0
        ) {
            hint.textContent = 'Geen agenda-afspraken aan jou toegewezen om aan te koppelen.';
            hint.className = 'create-order-hint warning';
        }
    }

    function syncActiveOrdersPage() {
        const grid = doc.getElementById('ordersGrid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.order-card'));
        cards.forEach((card) => {
            const shouldHide = currentState.enabled && !matchesCurrentOwner(card.querySelector('.order-assignee')?.textContent || '');
            card.dataset.personalAssignmentHidden = shouldHide ? '1' : '0';
            card.style.display = shouldHide ? 'none' : '';
        });
        applyActiveOrdersSummary(cards);
        applyActiveOrdersEmptyState(cards);
        void syncCreateOrderAgendaOptions();
    }

    function paintSidebarLeadsBadge(count) {
        const badge = doc.querySelector('[data-sidebar-count-key="leads"]');
        if (!badge) return;
        const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
        if (safeCount <= 0) {
            badge.hidden = true;
            badge.dataset.countZero = '1';
            badge.textContent = '0';
            return;
        }
        badge.hidden = false;
        badge.dataset.countZero = '0';
        badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
        badge.title = `${safeCount} ${safeCount === 1 ? 'open lead' : 'open leads'}`;
        badge.setAttribute('aria-label', badge.title);
    }

    function syncLeadsEmptyState(items) {
        const list = doc.getElementById('leadList');
        if (!list) return;

        let empty = list.querySelector(`.${ORDERS_EMPTY_CLASS}`);
        const visibleItems = items.filter((item) => item.style.display !== 'none');
        if (!currentState.enabled || !items.length || visibleItems.length) {
            if (empty) empty.remove();
            return;
        }

        if (!empty) {
            empty = doc.createElement('div');
            empty.className = `lead-empty ${ORDERS_EMPTY_CLASS}`;
            list.appendChild(empty);
        }
        empty.textContent = 'Nog geen leads aan jou toegewezen.';
    }

    function syncLeadsPage() {
        const list = doc.getElementById('leadList');
        if (!list) return;
        const items = Array.from(list.querySelectorAll('.lead-item'));
        items.forEach((item) => {
            const chipText = item.querySelector('.lead-chip')?.textContent || '';
            const shouldHide = currentState.enabled && !matchesCurrentOwner(chipText);
            item.style.display = shouldHide ? 'none' : '';
        });
        const visibleCount = items.filter((item) => item.style.display !== 'none').length;
        root.__softoraLeadsPageCount = visibleCount;
        paintSidebarLeadsBadge(visibleCount);
        syncLeadsEmptyState(items);
    }

    function runSync() {
        syncScheduled = false;
        syncActiveOrdersPage();
        syncLeadsPage();
    }

    function scheduleSync() {
        if (syncScheduled) return;
        syncScheduled = true;
        root.requestAnimationFrame(runSync);
    }

    function initActiveOrdersObserver() {
        const grid = doc.getElementById('ordersGrid');
        if (!grid || activeOrdersObserver) return;
        activeOrdersObserver = new MutationObserver(() => {
            scheduleSync();
        });
        activeOrdersObserver.observe(grid, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['hidden', 'class']
        });

        const filterBar = doc.querySelector('.orders-filter-bar');
        if (filterBar) {
            activeOrdersObserver.observe(filterBar, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }

        const createOrderModal = doc.getElementById('createOrderModal');
        if (createOrderModal && !createOrderObserver) {
            createOrderObserver = new MutationObserver(() => {
                scheduleSync();
            });
            createOrderObserver.observe(createOrderModal, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }
    }

    function initLeadsObserver() {
        const list = doc.getElementById('leadList');
        if (!list || leadsObserver) return;
        leadsObserver = new MutationObserver(() => {
            scheduleSync();
        });
        leadsObserver.observe(list, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }

    function syncState(nextState) {
        currentState = {
            enabled: Boolean(nextState?.enabled),
            owner: String(nextState?.owner || '').trim()
        };
        scheduleSync();
    }

    function initPageFilter() {
        initActiveOrdersObserver();
        initLeadsObserver();
        const filterApi = root.SoftoraAssignmentFilter;
        if (filterApi && typeof filterApi.subscribe === 'function') {
            filterApi.subscribe(syncState);
        }
        if (filterApi && typeof filterApi.getState === 'function') {
            Promise.resolve(filterApi.getState()).then(syncState).catch(() => {
                syncState(filterApi.getCachedState ? filterApi.getCachedState() : {});
            });
        } else {
            scheduleSync();
        }
    }

    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', initPageFilter, { once: true });
    } else {
        initPageFilter();
    }

    root.addEventListener('pageshow', () => {
        scheduleSync();
    });
})(typeof window !== 'undefined' ? window : globalThis);
