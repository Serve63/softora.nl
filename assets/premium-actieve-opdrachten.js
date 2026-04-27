const PREVIEW_HTML_PREFIX = 'softora_preview_html_premium_v4_';
const ORDER_STATE_KEY = 'softora_order_state_premium_v1';
const BUILD_MODE_KEY = 'softora_build_mode_premium_v1';
const CUSTOM_ORDERS_KEY = 'softora_custom_orders_premium_v1';
const ORDER_RUNTIME_KEY = 'softora_order_runtime_premium_v1';
const REMOTE_UI_STATE_SCOPE = 'premium_active_orders';
const CUSTOMER_DB_SCOPE = 'premium_customers_database';
const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
let remoteUiStateCache = {};
let remoteUiStateLoaded = false;
let remoteUiStateLoadPromise = null;
let remoteUiStateSaveTimer = null;
let remoteUiStateSaveInFlight = false;
let remoteUiStateSavePromise = null;
let remoteUiStatePendingPatch = {};

const orders = {
    1: { name: 'Kapsalon Mooi', type: 'Kapper Website', logs: [], progressPct: 0, previewHtml: null, artifact: null, updatedAt: null },
    2: { name: 'Restaurant De Harmonie', type: 'Restaurant Website', logs: [], progressPct: 0, previewHtml: null, artifact: null, updatedAt: null },
    3: { name: 'FitLife Gym', type: 'Sportschool Website', logs: [], progressPct: 0, previewHtml: null, artifact: null, updatedAt: null },
    4: { name: 'Van der Berg Interiors', type: 'Portfolio Website', logs: [], progressPct: 0, previewHtml: null, artifact: null, updatedAt: null },
    5: { name: 'Bakkerij Jansen', type: 'Bakkerij Website', logs: [], progressPct: 0, previewHtml: null, artifact: null, updatedAt: null }
};
let customOrders = [];
let agendaLeadOptions = [];
let agendaLeadOptionsLoadedAt = 0;
let agendaLeadOptionsPromise = null;
const AGENDA_LEAD_CACHE_MS = 90000;
const ORDER_ASSIGNEE_OPTIONS = Object.freeze(['Martijn', 'Servé']);

const quickBuildSteps = [
    { pct: 5, step: 1, msg: 'Opdracht ontvangen, klantgegevens analyseren...' },
    { pct: 12, step: 1, msg: 'Branche-analyse en concurrentie-onderzoek gestart' },
    { pct: 20, step: 1, msg: 'Sitemap en content-structuur opgesteld' },
    { pct: 28, step: 2, msg: 'Kleurenpalet en typografie geselecteerd' },
    { pct: 38, step: 2, msg: 'Wireframes voor alle pagina\'s aangemaakt' },
    { pct: 45, step: 2, msg: 'Visueel design finalized — responsive mockups klaar' },
    { pct: 55, step: 3, msg: 'HTML/CSS structuur gegenereerd' },
    { pct: 62, step: 3, msg: 'Interactieve elementen en animaties ingebouwd' },
    { pct: 72, step: 3, msg: 'Formulieren en functionaliteit geïmplementeerd' },
    { pct: 80, step: 4, msg: 'Cross-browser testing gestart' },
    { pct: 85, step: 4, msg: 'Mobile responsiveness gevalideerd' },
    { pct: 90, step: 4, msg: 'Performance optimalisatie — Lighthouse score 95+' },
    { pct: 95, step: 5, msg: 'Finale check afgerond, bestanden klaargezet' },
    { pct: 100, step: 5, msg: 'Website succesvol opgeleverd!' }
];

const premiumBuildSteps = [
    { pct: 4, step: 1, msg: 'Opdracht ontvangen, premium briefing analyseren...' },
    { pct: 10, step: 1, msg: 'Doelgroeppsychologie en positionering bepaald' },
    { pct: 18, step: 1, msg: 'Merktoon, hooks en storytelling-richting vastgesteld' },
    { pct: 26, step: 2, msg: '3 unieke creatieve concepten gegenereerd' },
    { pct: 34, step: 2, msg: 'Best presterende concept geselecteerd op conversie' },
    { pct: 42, step: 2, msg: 'High-end visuele richting en motion-stijl uitgewerkt' },
    { pct: 52, step: 3, msg: 'Volledige premium layout voor alle secties gebouwd' },
    { pct: 62, step: 3, msg: 'Copywriting en aanbodstructuur geoptimaliseerd' },
    { pct: 72, step: 3, msg: 'Interactie, formulieren en componenten afgerond' },
    { pct: 82, step: 4, msg: 'SEO-structuur, metadata en snelheid geoptimaliseerd' },
    { pct: 90, step: 4, msg: 'Cross-browser en mobile QA uitgevoerd' },
    { pct: 96, step: 5, msg: 'Final polish: hiërarchie, contrast en micro-copy' },
    { pct: 100, step: 5, msg: 'Premium website succesvol opgeleverd!' }
];

let currentModalId = null;
let currentClaimOrderId = null;
let buildMode = 'premium';
let activeOrderFilter = 'in_progress';
const activeProgressAnimations = {};
const apiCostEstimateRequests = {};
const progressSimulationPlans = {
    quick: [
        { ms: 0, pct: 2 },
        { ms: 12000, pct: 10 },
        { ms: 26000, pct: 20 },
        { ms: 42000, pct: 32 },
        { ms: 62000, pct: 46 },
        { ms: 86000, pct: 60 },
        { ms: 116000, pct: 73 },
        { ms: 154000, pct: 84 },
        { ms: 206000, pct: 92 },
        { ms: 250000, pct: 96 }
    ],
    premium: [
        { ms: 0, pct: 2 },
        { ms: 16000, pct: 9 },
        { ms: 34000, pct: 18 },
        { ms: 58000, pct: 30 },
        { ms: 90000, pct: 43 },
        { ms: 128000, pct: 57 },
        { ms: 172000, pct: 69 },
        { ms: 224000, pct: 80 },
        { ms: 288000, pct: 89 },
        { ms: 360000, pct: 94 },
        { ms: 420000, pct: 96 }
    ]
};

function getTime() {
    return new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function fetchUiStateGetWithFallback(scope) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    const urls = [
        `/api/ui-state-get?scope=${encodedScope}`,
        `/api/ui-state/${encodedScope}`
    ];
    let lastError = null;

    for (const url of urls) {
        try {
            const res = await fetch(url, {
                method: 'GET',
                cache: 'no-store'
            });
            if (!res.ok) {
                throw new Error(`UI-state GET mislukt (${res.status})`);
            }
            return await res.json().catch(() => ({}));
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('UI-state GET mislukt');
}

async function fetchUiStateSetWithFallback(scope, body) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    const urls = [
        `/api/ui-state-set?scope=${encodedScope}`,
        `/api/ui-state/${encodedScope}`
    ];
    let lastError = null;

    for (const url of urls) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {})
            });
            if (!res.ok) {
                throw new Error(`UI-state POST mislukt (${res.status})`);
            }
            return await res.json().catch(() => ({}));
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('UI-state POST mislukt');
}

async function loadRemoteUiState() {
    if (remoteUiStateLoaded) return true;
    if (remoteUiStateLoadPromise) return remoteUiStateLoadPromise;

    remoteUiStateLoadPromise = (async () => {
        try {
            const data = await fetchUiStateGetWithFallback(REMOTE_UI_STATE_SCOPE);
            if (data?.ok && data.values && typeof data.values === 'object') {
                const next = {};
                Object.entries(data.values).forEach(([k, v]) => {
                    next[String(k)] = String(v ?? '');
                });
                remoteUiStateCache = next;
            }
            remoteUiStateLoaded = true;
            return true;
        } catch (_) {
            remoteUiStateLoaded = true;
            return false;
        } finally {
            remoteUiStateLoadPromise = null;
        }
    })();

    return remoteUiStateLoadPromise;
}

function readStateValue(key) {
    return String(remoteUiStateCache[key] ?? '');
}

function queueRemoteUiStateSave() {
    if (remoteUiStateSaveTimer) clearTimeout(remoteUiStateSaveTimer);
    remoteUiStateSaveTimer = setTimeout(() => {
        remoteUiStateSaveTimer = null;
        void flushRemoteUiStateSave();
    }, 250);
}

async function flushRemoteUiStateSave() {
    if (remoteUiStateSaveTimer) {
        clearTimeout(remoteUiStateSaveTimer);
        remoteUiStateSaveTimer = null;
    }
    if (remoteUiStateSaveInFlight) {
        await (remoteUiStateSavePromise || Promise.resolve());
    }
    const patch = remoteUiStatePendingPatch;
    const keys = Object.keys(patch);
    if (!keys.length) return;

    remoteUiStatePendingPatch = {};
    remoteUiStateSaveInFlight = true;
    const currentSavePromise = (async () => {
        try {
            await fetchUiStateSetWithFallback(REMOTE_UI_STATE_SCOPE, {
                patch,
                source: 'premium-actieve-opdrachten',
                actor: 'browser'
            });
        } catch (_) {
            keys.forEach((key) => {
                remoteUiStatePendingPatch[key] = String(patch[key] ?? '');
            });
        } finally {
            remoteUiStateSaveInFlight = false;
            if (Object.keys(remoteUiStatePendingPatch).length) queueRemoteUiStateSave();
        }
    })();
    remoteUiStateSavePromise = currentSavePromise;
    try {
        await currentSavePromise;
    } finally {
        if (remoteUiStateSavePromise === currentSavePromise) {
            remoteUiStateSavePromise = null;
        }
    }
}

async function persistRequiredUiStateKeysOrThrow(requiredKeys, errorMessage) {
    await flushRemoteUiStateSave();
    if (remoteUiStateSaveTimer) {
        clearTimeout(remoteUiStateSaveTimer);
        remoteUiStateSaveTimer = null;
        await flushRemoteUiStateSave();
    }
    const keys = Array.isArray(requiredKeys) ? requiredKeys : [];
    const stillPending = keys.some((key) => Object.prototype.hasOwnProperty.call(remoteUiStatePendingPatch, key));
    if (remoteUiStateSaveInFlight || remoteUiStateSaveTimer || stillPending) {
        throw new Error(errorMessage || 'Remote UI-state kon niet volledig worden opgeslagen.');
    }
}

function writeStateValue(key, value) {
    remoteUiStateCache[key] = String(value ?? '');
    remoteUiStatePendingPatch[key] = String(value ?? '');
    queueRemoteUiStateSave();
}

function loadBuildMode() {
    const v = readStateValue(BUILD_MODE_KEY);
    if (v === 'quick' || v === 'premium') return v;
    return 'premium';
}

function saveBuildMode(mode) {
    writeStateValue(BUILD_MODE_KEY, mode);
}

function getBuildSteps() {
    return buildMode === 'premium' ? premiumBuildSteps : quickBuildSteps;
}

function setBuildMode(mode) {
    buildMode = mode === 'premium' ? 'premium' : 'quick';
    saveBuildMode(buildMode);

    document.querySelectorAll('.mode-btn[data-build-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-build-mode') === buildMode);
    });

    const hint = document.getElementById('buildModeHint');
    if (hint) {
        hint.textContent = buildMode === 'premium'
            ? 'Premium workflow'
            : 'Snelle workflow';
    }

    refreshEstimatedApiCostsForOrders();
}

function moneyToNumber(text) {
    const raw = String(text || '').replace(/[^0-9]/g, '');
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function parseNullableNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeOrderAssignee(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = normalized.split(/[^a-z]+/).filter(Boolean);
    if (words.includes('serve')) return 'Servé';
    if (words.includes('martijn')) return 'Martijn';
    return '';
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeDataUrlImage(value) {
    const raw = String(value || '').replace(/\s+/g, '').trim();
    if (!raw) return '';
    if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(raw)) return '';
    return raw;
}

function getDataUrlApproxBytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.max(0, Math.floor((base64.length * 3) / 4));
}

function getDataUrlMimeType(dataUrl) {
    const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpe?g|webp));base64,/i);
    return match ? String(match[1]).toLowerCase() : 'image/jpeg';
}

function normalizeReferenceImageList(input) {
    if (!Array.isArray(input)) return [];
    return input
        .map((item, index) => {
            const dataUrl = normalizeDataUrlImage(item?.dataUrl || item?.imageDataUrl || item?.url || '');
            if (!dataUrl) return null;
            const sizeBytes = getDataUrlApproxBytes(dataUrl);
            if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
            const name = String(item?.name || item?.fileName || `bijlage-${index + 1}`).trim().slice(0, 120);
            return {
                id: String(item?.id || `img_${index + 1}`),
                name: name || `bijlage-${index + 1}`,
                mimeType: getDataUrlMimeType(dataUrl),
                sizeBytes,
                dataUrl
            };
        })
        .filter(Boolean)
        .slice(0, 8);
}

function normalizeMatchValue(value) {
    return String(value || '').trim().toLowerCase();
}

function getOrderCustomerMatchKey(record) {
    const customerName = String(record?.naam || '').trim();
    const customerCompany = String(record?.bedrijf || '').trim();
    const customerPhone = String(record?.telefoon || '').trim();
    if (customerName || customerCompany || customerPhone) {
        if (!customerName && !customerCompany) return '';
        return `${normalizeMatchValue(customerCompany)}|${normalizeMatchValue(customerName)}|${normalizeMatchValue(customerPhone)}`;
    }

    const explicitCompany = String(record?.companyName || '').trim();
    const explicitContact = String(record?.contactName || '').trim();
    const explicitPhone = String(record?.contactPhone || '').trim();
    const legacyClientName = String(record?.clientName || '').trim();
    const legacyLocation = String(record?.location || '').trim();
    const hasExplicitIdentity = Boolean(explicitCompany || explicitContact || explicitPhone);
    const name = hasExplicitIdentity
        ? (explicitContact || legacyLocation || legacyClientName)
        : legacyClientName;
    const company = hasExplicitIdentity
        ? (explicitCompany || legacyClientName || legacyLocation)
        : legacyLocation;
    if (!name && !company) return '';
    return `${normalizeMatchValue(company)}|${normalizeMatchValue(name)}|${normalizeMatchValue(explicitPhone)}`;
}

function parseCustomerDatabase(raw) {
    try {
        const parsed = JSON.parse(String(raw || '[]'));
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter((item) => item && typeof item === 'object')
            .map((item, index) => {
                const legacyAmount = Math.round(Number(item?.bedrag) || 0);
                const type = String(item?.type || '').trim() || 'Website';
                const websiteBedrag = Number.isFinite(Number(item?.websiteBedrag))
                    ? Math.max(0, Math.round(Number(item?.websiteBedrag)))
                    : ((type === 'Website' || type === 'Website + onderhoud') && legacyAmount > 0 ? legacyAmount : null);
                const onderhoudPerMaand = Number.isFinite(Number(item?.onderhoudPerMaand))
                    ? Math.max(0, Math.round(Number(item?.onderhoudPerMaand)))
                    : (type === 'Onderhoud' && legacyAmount > 0 ? legacyAmount : null);
                return {
                    ...item,
                    id: String(item?.id || `klant-import-${index}`),
                    naam: String(item?.naam || '').trim() || 'Onbekend',
                    bedrijf: String(item?.bedrijf || '').trim() || '-',
                    telefoon: String(item?.telefoon || '').trim() || '-',
                    type,
                    website: String(item?.website || '').trim() || '-',
                    websiteBedrag,
                    onderhoudPerMaand,
                    bedrag: legacyAmount > 0
                        ? legacyAmount
                        : (websiteBedrag || onderhoudPerMaand || 0),
                    status: String(item?.status || '').trim() === 'Open' ? 'Open' : 'Betaald',
                    datum: String(item?.datum || '').trim()
                };
            });
    } catch (_) {
        return [];
    }
}

async function readCustomerDatabase() {
    try {
        const remoteState = await fetchUiStateGetWithFallback(CUSTOMER_DB_SCOPE);
        const remoteCustomers = parseCustomerDatabase(remoteState?.values?.[CUSTOMER_DB_KEY]);
        if (remoteCustomers.length) return remoteCustomers;
    } catch (_) {
        return [];
    }
}

async function persistCustomerDatabase(customers) {
    const serialized = JSON.stringify(Array.isArray(customers) ? customers : []);
    await fetchUiStateSetWithFallback(CUSTOMER_DB_SCOPE, {
        patch: {
            [CUSTOMER_DB_KEY]: serialized
        },
        source: 'premium-actieve-opdrachten',
        actor: 'browser'
    });
}

function removeGeneratedPreviewHtml(orderId) {
    writeStateValue(getPreviewStorageKey(orderId), '');
}

function syncLastActiveOrderAfterRemoval(removedId) {
    const nextId = Object.keys(orders)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0 && id !== Number(removedId))
        .sort((a, b) => {
            const updatedDiff = Number(orders[b]?.updatedAt || 0) - Number(orders[a]?.updatedAt || 0);
            return updatedDiff || a - b;
        })[0] || null;

    if (nextId) {
        setLastActiveOrder(nextId);
        return;
    }

    writeStateValue(ORDER_STATE_KEY, '');
}

async function syncCustomerDatabaseAfterOrderRemoval(record) {
    const customerKey = getOrderCustomerMatchKey(record);
    if (!customerKey) return;

    const hasRemainingOrder = customOrders.some((item) => {
        return Number(item?.id) !== Number(record?.id) && getOrderCustomerMatchKey(item) === customerKey;
    });
    if (hasRemainingOrder) return;

    const customers = await readCustomerDatabase();
    if (!customers.length) return;

    const nextCustomers = customers.filter((customer) => {
        return getOrderCustomerMatchKey(customer) !== customerKey;
    });

    if (nextCustomers.length === customers.length) return;
    await persistCustomerDatabase(nextCustomers);
}

function setModalDeleteButtonState(label, disabled) {
    const deleteBtn = document.getElementById('modalDeleteBtn');
    if (!deleteBtn) return;
    deleteBtn.textContent = label || 'Project uit systeem halen';
    deleteBtn.disabled = Boolean(disabled);
}

async function showActiveOrderAlert(message, options = {}) {
    if (window.SoftoraDialogs && typeof window.SoftoraDialogs.alert === 'function') {
        await window.SoftoraDialogs.alert(message, options);
        return true;
    }
    console.warn(String(message || 'Actieve opdrachten melding'));
    return false;
}

async function confirmActiveOrderAction(message, options = {}) {
    if (window.SoftoraDialogs && typeof window.SoftoraDialogs.confirm === 'function') {
        return window.SoftoraDialogs.confirm(message, options);
    }
    console.warn(String(message || 'Actieve opdrachten bevestiging'));
    return false;
}

function slugify(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function deriveFeatures(desc) {
    const d = String(desc || '').trim();
    if (!d) return [];

    let source = d;
    const m = /\bmet\s+(.+?)(?:\.|$)/i.exec(d);
    if (m && m[1]) source = m[1];

    source = source.replace(/\s+en\s+/gi, ', ');
    return source
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.replace(/\.$/, ''))
        .slice(0, 8);
}

function getOrderMeta(id) {
    const card = document.getElementById('order-' + id);
    if (!card) return null;

    const clientLine = (card.querySelector('.order-client')?.textContent || '').trim();
    const title = (card.querySelector('.order-title')?.textContent || '').trim();
    const description = (card.querySelector('.order-desc')?.textContent || '').trim();
    const priceText = (card.querySelector('.order-price-value')?.textContent || '').trim();
    const budget = moneyToNumber(priceText);
    const customOrder = getCustomOrderById(id);

    const parts = clientLine.split('—').map(s => s.trim()).filter(Boolean);
    const clientName = parts[0] || orders[id]?.name || 'Bedrijf';
    const location = parts[1] || '';
    const deliveryTime = String(customOrder?.deliveryTime || '').trim();
    const domainName = String(customOrder?.domainName || '').trim();
    const sourceAppointmentLabel = String(customOrder?.sourceAppointmentLabel || '').trim();
    const includeSampleDesign = Boolean(customOrder?.includeSampleDesign);

    const features = deriveFeatures(description);

    return {
        id: String(id),
        clientName,
        location,
        title: title || (orders[id]?.type || 'Project'),
        description,
        deliveryTime,
        domainName,
        sourceAppointmentLabel,
        includeSampleDesign,
        budget,
        features
    };
}

function formatBudget(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '—';
    return '€' + n.toLocaleString('nl-NL');
}

function formatApiCostAmount(amount) {
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (amount > 0 && amount < 0.01) return '< €0,01';
    return '€' + amount.toLocaleString('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function getApiCostRatesForModel(model) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;

    if (key.includes('claude-opus-4-6')) return { inputPer1mUsd: 5, outputPer1mUsd: 25 };
    if (key.includes('claude-opus')) return { inputPer1mUsd: 15, outputPer1mUsd: 75 };
    if (key.includes('claude-sonnet')) return { inputPer1mUsd: 3, outputPer1mUsd: 15 };
    if (key.includes('claude-haiku')) return { inputPer1mUsd: 0.8, outputPer1mUsd: 4 };
    if (key.includes('gpt-5-mini')) return { inputPer1mUsd: 0.25, outputPer1mUsd: 2.0 };
    if (key.includes('gpt-5-nano')) return { inputPer1mUsd: 0.05, outputPer1mUsd: 0.4 };
    if (key.includes('gpt-5')) return { inputPer1mUsd: 1.25, outputPer1mUsd: 10.0 };
    if (key.includes('gpt-4.1-mini')) return { inputPer1mUsd: 0.4, outputPer1mUsd: 1.6 };
    if (key.includes('gpt-4.1')) return { inputPer1mUsd: 2.0, outputPer1mUsd: 8.0 };
    if (key.includes('gpt-4o-mini')) return { inputPer1mUsd: 0.15, outputPer1mUsd: 0.6 };
    return null;
}

function estimateApiCostFromTokens(record) {
    const promptTokens = parseNullableNumber(record?.apiTokensInput);
    const completionTokens = parseNullableNumber(record?.apiTokensOutput);
    const rates = getApiCostRatesForModel(record?.apiModel);
    if (!rates) return null;
    if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;
    if (promptTokens < 0 || completionTokens < 0) return null;
    if (promptTokens === 0 && completionTokens === 0) return null;

    const usd = ((promptTokens / 1000000) * rates.inputPer1mUsd) + ((completionTokens / 1000000) * rates.outputPer1mUsd);
    const eur = usd * 0.92;
    return {
        apiCostUsd: Number(usd.toFixed(8)),
        apiCostEur: Number(eur.toFixed(8))
    };
}

function resolveApiCostRecord(record) {
    if (!record || typeof record !== 'object') return record;
    const amountEur = parseNullableNumber(record.apiCostEur);
    const amountUsd = parseNullableNumber(record.apiCostUsd);
    if (Number.isFinite(amountEur) && amountEur > 0) return record;
    if (Number.isFinite(amountUsd) && amountUsd > 0) return record;

    const estimated = estimateApiCostFromTokens(record);
    if (!estimated) return record;

    return {
        ...record,
        apiCostEur: estimated.apiCostEur,
        apiCostUsd: estimated.apiCostUsd
    };
}

function hasActualApiCost(record) {
    const amountEur = parseNullableNumber(record?.apiCostEur);
    const amountUsd = parseNullableNumber(record?.apiCostUsd);
    return (Number.isFinite(amountEur) && amountEur > 0) || (Number.isFinite(amountUsd) && amountUsd > 0);
}

function hasEstimatedApiCost(record) {
    const amountEur = parseNullableNumber(record?.estimatedApiCostEur);
    const amountUsd = parseNullableNumber(record?.estimatedApiCostUsd);
    return (Number.isFinite(amountEur) && amountEur > 0) || (Number.isFinite(amountUsd) && amountUsd > 0);
}

function formatApiCostLabel(record) {
    const resolvedRecord = resolveApiCostRecord(record);
    const amount = parseNullableNumber(resolvedRecord?.apiCostEur);
    const estimatedAmount = parseNullableNumber(resolvedRecord?.estimatedApiCostEur);
    const promptTokens = parseNullableNumber(resolvedRecord?.apiTokensInput);
    const completionTokens = parseNullableNumber(resolvedRecord?.apiTokensOutput);
    const hasTokenData = (Number.isFinite(promptTokens) && promptTokens > 0) || (Number.isFinite(completionTokens) && completionTokens > 0);
    if (Number.isFinite(amount) && amount > 0) {
        return formatApiCostAmount(amount) || 'Nog niet berekend';
    }
    if (Number.isFinite(estimatedAmount) && estimatedAmount > 0) {
        return `\u2248 ${formatApiCostAmount(estimatedAmount) || 'onbekend'}`;
    }
    if (amount === 0 && hasTokenData) return '< €0,01';
    return 'Kosten schatten...';
}

function getCustomOrderIndexById(id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return -1;
    return customOrders.findIndex((item) => Number(item?.id) === numericId);
}

function getCustomOrderById(id) {
    const idx = getCustomOrderIndexById(id);
    return idx >= 0 ? customOrders[idx] : null;
}

function resolveLinkedLeadOwnerNameForOrder(orderLike) {
    if (!orderLike || typeof orderLike !== 'object') return '';

    const sourceAppointmentId = Number(orderLike?.sourceAppointmentId);
    const sourceCallId = String(orderLike?.sourceCallId || '').trim();
    if ((!Number.isFinite(sourceAppointmentId) || sourceAppointmentId <= 0) && !sourceCallId) return '';

    const linkedLead = agendaLeadOptions.find((item) => {
        if (!item || typeof item !== 'object') return false;
        if (Number.isFinite(sourceAppointmentId) && sourceAppointmentId > 0 && Number(item?.id) === sourceAppointmentId) {
            return true;
        }
        return Boolean(sourceCallId) && String(item?.callId || '').trim() === sourceCallId;
    });

    return normalizeClaimEmployeeName(linkedLead?.leadOwnerName || linkedLead?.leadOwnerFullName || '');
}

function updateCustomOrderById(id, patch = {}) {
    const idx = getCustomOrderIndexById(id);
    if (idx < 0) return null;
    customOrders[idx] = {
        ...customOrders[idx],
        ...patch
    };
    persistCustomOrders();
    return customOrders[idx];
}

function updateApiCostLabel(id, record) {
    return;
}

function renderOrdersEmptyState() {
    const grid = document.getElementById('ordersGrid');
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.order-card'));
    const visibleCards = cards.filter((card) => !card.hidden);
    const hasCards = cards.length > 0;
    let empty = grid.querySelector('.orders-empty-state');

    if (!hasCards) {
        if (!empty) {
            empty = document.createElement('div');
            empty.className = 'orders-empty-state';
            empty.textContent = 'Nog geen actieve opdrachten.';
            grid.appendChild(empty);
        }
        return;
    }

    if (!visibleCards.length) {
        const emptyTextByFilter = {
            completed: 'Geen voltooide opdrachten.',
            in_progress: 'Geen openstaande opdrachten.'
        };
        if (!empty) {
            empty = document.createElement('div');
            empty.className = 'orders-empty-state';
            grid.appendChild(empty);
        }
        empty.textContent = emptyTextByFilter[activeOrderFilter] || 'Geen opdrachten gevonden.';
        return;
    }

    if (empty) empty.remove();
}

function getOrderFilterGroupForCard(card) {
    const id = Number(String(card?.id || '').replace('order-', ''));
    const order = orders[id];
    const ui = resolveOrderUiState(order);
    const claimInfo = getOrderClaimInfo(id);

    if (ui.isBuilt) {
        return 'completed';
    }
    if (claimInfo.isClaimed) {
        return 'in_progress';
    }
    if (ui.status.key === 'bezig') {
        return 'in_progress';
    }
    return 'in_progress';
}

function updateOrderFilterButtonState() {
    document.querySelectorAll('[data-order-filter]').forEach((btn) => {
        const key = String(btn.getAttribute('data-order-filter') || '');
        const isActive = activeOrderFilter === key;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function updateOrderFilterCounts(cards) {
    const counts = {
        completed: 0,
        in_progress: 0
    };

    cards.forEach((card) => {
        const group = getOrderFilterGroupForCard(card);
        counts[group] = (counts[group] || 0) + 1;
    });

    const completedEl = document.getElementById('filterCountCompleted');
    if (completedEl) completedEl.textContent = String(counts.completed);
    const progressEl = document.getElementById('filterCountProgress');
    if (progressEl) progressEl.textContent = String(counts.in_progress);
}

function applyOrderFilter() {
    const cards = Array.from(document.querySelectorAll('#ordersGrid .order-card'));
    cards.forEach((card) => {
        const group = getOrderFilterGroupForCard(card);
        const shouldHide = activeOrderFilter !== 'all' && group !== activeOrderFilter;
        card.hidden = shouldHide;
    });
    updateOrderFilterButtonState();
    renderOrdersEmptyState();
}

function setOrderFilter(nextFilter) {
    const normalized = String(nextFilter || '').trim().toLowerCase();
    activeOrderFilter = normalized === 'open' ? 'in_progress' : normalized || 'in_progress';
    applyOrderFilter();
}

function classifyActiveOrderProductLine(order) {
    const hay = `${String(order?.title || '')} ${String(order?.description || '')}`.toLowerCase();
    if (!hay.trim()) return 'other';
    if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot|conversational\s*bot/.test(hay)) return 'chatbot';
    if (
        /voicesoftware|voice\s*software|voice_software|spraaksoftware|belsoftware|telefon(y|ie)|voice\s*agent|ai\s*voice|spraak\s*agent/.test(
            hay
        )
    ) {
        return 'voice';
    }
    if (/bedrijfssoftware|business\s*software|business_software|\bcrm\b|\berp\b/.test(hay)) {
        return 'business';
    }
    return 'other';
}

function renderSumActiveBreakdown(total, business, voice, chatbot) {
    const root = document.getElementById('sumActive');
    if (!root) return;
    const totalEl = root.querySelector('[data-sum-active-total]');
    const businessEl = root.querySelector('[data-sum-active-business]');
    const voiceEl = root.querySelector('[data-sum-active-voice]');
    const chatbotEl = root.querySelector('[data-sum-active-chatbot]');
    if (totalEl && businessEl && voiceEl && chatbotEl) {
        totalEl.textContent = String(total);
        businessEl.textContent = String(business);
        voiceEl.textContent = String(voice);
        chatbotEl.textContent = String(chatbot);
        root.setAttribute(
            'aria-label',
            `Actieve opdrachten: ${total}, bedrijfssoftware: ${business}, voicesoftware: ${voice}, chatbot: ${chatbot}`
        );
    } else {
        root.textContent = String(total);
    }
}

function clearDemoOrdersOnLoad() {
    const grid = document.getElementById('ordersGrid');
    if (!grid) return;

    const removedIds = [];
    grid.querySelectorAll('.order-card').forEach((card) => {
        const id = Number(String(card.id || '').replace('order-', ''));
        if (Number.isFinite(id) && id > 0) removedIds.push(id);
        card.remove();
    });

    removedIds.forEach((id) => {
        delete orders[id];
    });

    renderSumActiveBreakdown(0, 0, 0, 0);
    const sumTotal = document.getElementById('sumTotal');
    if (sumTotal) sumTotal.textContent = '€0';
    const sumDelivered = document.getElementById('sumDelivered');
    if (sumDelivered) sumDelivered.textContent = '0';
    updateOrderFilterCounts([]);
}

function normalizeOrderStatus(value) {
    const key = String(value || '').toLowerCase().trim();
    if (key === 'actief') return { key: 'actief', text: 'Actief', className: 'actief' };
    if (key === 'bezig') return { key: 'bezig', text: 'Bezig', className: 'bezig' };
    if (key === 'betaald') return { key: 'betaald', text: 'Betaald', className: 'betaald' };
    if (key === 'klaar') return { key: 'klaar', text: 'Gebouwd', className: 'klaar' };
    return { key: 'wacht', text: 'Wachtend', className: 'wacht' };
}

function resolveOrderUiState(orderLike) {
    const pct = Math.max(0, Math.min(100, Number(orderLike?.progressPct) || 0));
    const fallback = pct >= 100 ? 'klaar' : pct > 0 ? 'bezig' : 'wacht';
    const baseStatus = normalizeOrderStatus(orderLike?.statusKey || orderLike?.status || fallback);
    const paidAt = String(orderLike?.paidAt || '').trim();
    const isBuilt = baseStatus.key === 'klaar' || baseStatus.key === 'betaald' || pct >= 100;
    const isPaid = Boolean(paidAt) && isBuilt;
    const status = isPaid
        ? normalizeOrderStatus('betaald')
        : isBuilt
            ? normalizeOrderStatus('klaar')
            : baseStatus;

    return {
        pct,
        paidAt: paidAt || null,
        isBuilt,
        isPaid,
        status
    };
}

function refreshOrderSummaryCards() {
    const cards = Array.from(document.querySelectorAll('#ordersGrid .order-card'));
    const activeOrders = cards.reduce((list, card) => {
        const id = Number(String(card?.id || '').replace('order-', ''));
        const order = orders[id];
        if (!order) return list;
        const ui = resolveOrderUiState(order);
        if (!ui.isBuilt) list.push(order);
        return list;
    }, []);
    let business = 0;
    let voice = 0;
    let chatbot = 0;
    activeOrders.forEach((o) => {
        const line = classifyActiveOrderProductLine(o);
        if (line === 'business') business += 1;
        else if (line === 'voice') voice += 1;
        else if (line === 'chatbot') chatbot += 1;
    });
    renderSumActiveBreakdown(activeOrders.length, business, voice, chatbot);
    const openValue = cards.reduce((sum, card) => {
        const id = Number(String(card?.id || '').replace('order-', ''));
        const order = orders[id];
        const ui = resolveOrderUiState(order);
        if (ui.isPaid) return sum;
        const amount = moneyToNumber(card.querySelector('.order-price-value')?.textContent || '');
        return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
    const completedCount = cards.reduce((count, card) => {
        const id = Number(String(card?.id || '').replace('order-', ''));
        const order = orders[id];
        const ui = resolveOrderUiState(order);
        return count + (ui.isBuilt ? 1 : 0);
    }, 0);

    const sumTotal = document.getElementById('sumTotal');
    if (sumTotal) sumTotal.textContent = '€' + openValue.toLocaleString('nl-NL');

    const sumDelivered = document.getElementById('sumDelivered');
    if (sumDelivered) sumDelivered.textContent = String(completedCount);

    updateOrderFilterCounts(cards);
    applyOrderFilter();
}

function getNextOrderId() {
    const ids = [
        ...Object.keys(orders).map((id) => Number(id)),
        ...Array.from(document.querySelectorAll('#ordersGrid .order-card')).map((card) => {
            return Number(String(card.id || '').replace('order-', ''));
        }),
        ...customOrders.map((item) => Number(item?.id))
    ].filter((n) => Number.isFinite(n) && n > 0);

    return (ids.length ? Math.max(...ids) : 0) + 1;
}

function readCustomOrdersFromStorage() {
    try {
        const raw = readStateValue(CUSTOM_ORDERS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((item) => {
                const id = Number(item?.id);
                const amount = Number(item?.amount);
                const clientName = String(item?.clientName || '').trim();
                const location = String(item?.location || '').trim();
                const companyName = String(item?.companyName || '').trim();
                const contactName = String(item?.contactName || '').trim();
                const contactPhone = String(item?.contactPhone || item?.phone || '').trim();
                const contactEmail = String(item?.contactEmail || item?.email || '').trim();
                const title = String(item?.title || '').trim();
                const description = String(item?.description || '').trim();
                const deliveryTime = String(item?.deliveryTime || '').trim();
                const domainName = String(item?.domainName || '').trim();
                const prompt = String(item?.prompt || '').trim();
                const transcript = String(item?.transcript || '').trim();
                const apiCostEur = parseNullableNumber(item?.apiCostEur);
                const apiCostUsd = parseNullableNumber(item?.apiCostUsd);
                const apiTokensInput = parseNullableNumber(item?.apiTokensInput);
                const apiTokensOutput = parseNullableNumber(item?.apiTokensOutput);
                const apiModel = String(item?.apiModel || '').trim();
                const estimatedApiCostEur = parseNullableNumber(item?.estimatedApiCostEur);
                const estimatedApiCostUsd = parseNullableNumber(item?.estimatedApiCostUsd);
                const estimatedApiTokensInput = parseNullableNumber(item?.estimatedApiTokensInput);
                const estimatedApiTokensOutput = parseNullableNumber(item?.estimatedApiTokensOutput);
                const estimatedApiModel = String(item?.estimatedApiModel || '').trim();
                const estimatedApiBuildMode = String(item?.estimatedApiBuildMode || '').trim();
                const estimatedApiGeneratedAt = String(item?.estimatedApiGeneratedAt || '').trim();
                const lastRunAt = String(item?.lastRunAt || '').trim();
                const paidAt = String(item?.paidAt || '').trim();
                const launchRepoUrl = String(item?.launchRepoUrl || '').trim();
                const launchDeploymentUrl = String(item?.launchDeploymentUrl || '').trim();
                const launchDomainStatus = String(item?.launchDomainStatus || '').trim();
                const launchDomainMessage = String(item?.launchDomainMessage || '').trim();
                const launchedAt = String(item?.launchedAt || '').trim();
                const claimedBy = String(item?.claimedBy || '').trim();
                const claimedAt = String(item?.claimedAt || '').trim();
                const includeSampleDesignRaw = item?.includeSampleDesign;
                const includeSampleDesign = includeSampleDesignRaw === true ||
                    ['true', '1', 'yes'].includes(String(includeSampleDesignRaw || '').trim().toLowerCase());
                const sourceAppointmentId = Number(item?.sourceAppointmentId);
                const sourceCallId = String(item?.sourceCallId || '').trim();
                const sourceAppointmentLabel = String(item?.sourceAppointmentLabel || '').trim();
                const referenceImages = normalizeReferenceImageList(item?.referenceImages || item?.attachments || []);
                if (!Number.isFinite(id) || id <= 0) return null;
                if ((!clientName && !companyName) || !title || !description) return null;
                if (!Number.isFinite(amount) || amount <= 0) return null;

                return resolveApiCostRecord({
                    id,
                    clientName,
                    location,
                    companyName,
                    contactName,
                    contactPhone,
                    contactEmail,
                    title,
                    description,
                    deliveryTime,
                    domainName,
                    amount: Math.round(amount),
                    status: normalizeOrderStatus(item?.status).key,
                    prompt,
                    transcript,
                    apiCostEur: Number.isFinite(apiCostEur) && apiCostEur >= 0 ? apiCostEur : null,
                    apiCostUsd: Number.isFinite(apiCostUsd) && apiCostUsd >= 0 ? apiCostUsd : null,
                    apiTokensInput: Number.isFinite(apiTokensInput) && apiTokensInput >= 0 ? apiTokensInput : null,
                    apiTokensOutput: Number.isFinite(apiTokensOutput) && apiTokensOutput >= 0 ? apiTokensOutput : null,
                    apiModel,
                    estimatedApiCostEur:
                        Number.isFinite(estimatedApiCostEur) && estimatedApiCostEur >= 0 ? estimatedApiCostEur : null,
                    estimatedApiCostUsd:
                        Number.isFinite(estimatedApiCostUsd) && estimatedApiCostUsd >= 0 ? estimatedApiCostUsd : null,
                    estimatedApiTokensInput:
                        Number.isFinite(estimatedApiTokensInput) && estimatedApiTokensInput >= 0 ? estimatedApiTokensInput : null,
                    estimatedApiTokensOutput:
                        Number.isFinite(estimatedApiTokensOutput) && estimatedApiTokensOutput >= 0 ? estimatedApiTokensOutput : null,
                    estimatedApiModel,
                    estimatedApiBuildMode: estimatedApiBuildMode || null,
                    estimatedApiGeneratedAt: estimatedApiGeneratedAt || null,
                    lastRunAt: lastRunAt || null,
                    paidAt: paidAt || null,
                    launchRepoUrl: launchRepoUrl || null,
                    launchDeploymentUrl: launchDeploymentUrl || null,
                    launchDomainStatus: launchDomainStatus || null,
                    launchDomainMessage: launchDomainMessage || null,
                    launchedAt: launchedAt || null,
                    claimedBy: claimedBy || null,
                    claimedAt: claimedAt || null,
                    includeSampleDesign,
                    referenceImages,
                    sourceAppointmentId: Number.isFinite(sourceAppointmentId) && sourceAppointmentId > 0 ? sourceAppointmentId : null,
                    sourceCallId: sourceCallId || null,
                    sourceAppointmentLabel: sourceAppointmentLabel || null
                });
            })
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function persistCustomOrders() {
    writeStateValue(CUSTOM_ORDERS_KEY, JSON.stringify(customOrders));
}

function ensureOrderRuntimeState(record) {
    const id = Number(record?.id);
    if (!id) return;
    const prev = orders[id] || {};
    orders[id] = {
        name: record.clientName || prev.name || 'Bedrijf',
        type: record.title || prev.type || 'Project',
        logs: Array.isArray(prev.logs) ? prev.logs : [],
        progressPct: Number(prev.progressPct) || 0,
        statusKey: normalizeOrderStatus(prev.statusKey || record.status || 'wacht').key,
        paidAt: String(record?.paidAt || prev.paidAt || '').trim() || null,
        claimedBy: String(record?.claimedBy || prev.claimedBy || '').trim() || null,
        claimedAt: String(record?.claimedAt || prev.claimedAt || '').trim() || null,
        previewHtml: prev.previewHtml || null,
        artifact: prev.artifact || null,
        updatedAt: prev.updatedAt || null
    };
}

function serializeOrdersRuntime() {
    const out = {};
    Object.entries(orders).forEach(([id, order]) => {
        const numericId = Number(id);
        if (!Number.isFinite(numericId) || numericId <= 0 || !order) return;
        out[String(numericId)] = {
            name: String(order.name || ''),
            type: String(order.type || ''),
            logs: Array.isArray(order.logs) ? order.logs.slice(-200).map((entry) => ({
                time: String(entry?.time || ''),
                msg: String(entry?.msg || ''),
                highlight: Boolean(entry?.highlight)
            })) : [],
            progressPct: Math.max(0, Math.min(100, Number(order.progressPct) || 0)),
            statusKey: normalizeOrderStatus(order.statusKey || '').key,
            paidAt: String(order.paidAt || '').trim() || null,
            claimedBy: String(order.claimedBy || '').trim() || null,
            claimedAt: String(order.claimedAt || '').trim() || null,
            updatedAt: Number(order.updatedAt) || null
        };
    });
    return out;
}

function persistOrdersRuntime() {
    writeStateValue(ORDER_RUNTIME_KEY, JSON.stringify(serializeOrdersRuntime()));
}

function cloneOrderRuntimeForRollback(order) {
    if (!order || typeof order !== 'object') return null;
    return {
        ...order,
        logs: Array.isArray(order.logs)
            ? order.logs.map((entry) => ({
                time: String(entry?.time || ''),
                msg: String(entry?.msg || ''),
                highlight: Boolean(entry?.highlight)
            }))
            : []
    };
}

function setOpenDossierButtonContent(btnEl) {
    if (!btnEl) return;

    const svgNs = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNs, 'svg');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', 'M3 7.5h18M5.25 7.5v10.5A1.5 1.5 0 0 0 6.75 19.5h10.5a1.5 1.5 0 0 0 1.5-1.5V7.5M9 7.5V6a3 3 0 1 1 6 0v1.5');
    icon.appendChild(path);

    btnEl.replaceChildren(icon, document.createTextNode(' Open dossier'));
}

function applyOrderUiStateToCard(id) {
    const order = orders[id];
    if (!order) return;

    const cardEl = document.getElementById(`order-${id}`);
    const progressEl = document.getElementById(`progress-${id}`);
    const barEl = document.getElementById(`bar-${id}`);
    const btnEl = document.getElementById(`btn-${id}`);
    const completeBtnEl = document.getElementById(`complete-btn-${id}`);
    const assigneeEl = document.getElementById(`assignee-${id}`);
    const ui = resolveOrderUiState(order);
    const pct = ui.pct;
    const status = ui.status;
    const isDelivered = ui.isBuilt;
    const claimInfo = getOrderClaimInfo(id);

    order.statusKey = status.key;

    if (cardEl) {
        cardEl.classList.toggle('delivered', isDelivered);
        cardEl.classList.toggle('paid', ui.isPaid);
        cardEl.setAttribute('role', 'button');
        cardEl.setAttribute('tabindex', '0');
    }

    if (progressEl) {
        progressEl.classList.toggle('show', pct > 0 && !isDelivered);
    }
    if (barEl) {
        barEl.style.width = pct + '%';
        barEl.classList.toggle('green', pct >= 100);
    }
    for (let s = 1; s <= 5; s += 1) {
        const stepEl = document.getElementById(`step-${id}-${s}`);
        if (!stepEl) continue;
        if (isDelivered) {
            stepEl.className = 'progress-step';
            continue;
        }
        if (pct >= 100) {
            stepEl.className = 'progress-step done';
        } else if (pct > 0) {
            const approxStep = Math.max(1, Math.min(5, Math.ceil(pct / 20)));
            if (s < approxStep) stepEl.className = 'progress-step done';
            else if (s === approxStep) stepEl.className = 'progress-step active';
            else stepEl.className = 'progress-step';
        } else {
            stepEl.className = 'progress-step';
        }
    }
    if (btnEl) {
        btnEl.style.display = 'flex';
        btnEl.classList.remove('running');
        btnEl.classList.remove('done');
        btnEl.disabled = false;
        if (claimInfo.isClaimed) {
            btnEl.classList.add('claimed');
        } else {
            btnEl.classList.remove('claimed');
        }
        setOpenDossierButtonContent(btnEl);
    }

    if (assigneeEl) {
        assigneeEl.textContent = claimInfo.by || 'Nog niet geclaimd';
    }

    if (completeBtnEl) {
        completeBtnEl.textContent = 'Factuur betaald';
        completeBtnEl.hidden = isDelivered;
        completeBtnEl.style.display = isDelivered ? 'none' : '';
        completeBtnEl.disabled = isDelivered || ui.isPaid;
        completeBtnEl.classList.toggle('done', ui.isPaid);
    }

    refreshOrderSummaryCards();
}

function reconcileOrdersRuntimeAfterRestore() {
    let changed = false;

    Object.keys(orders).forEach((idRaw) => {
        const id = Number(idRaw);
        const order = orders[id];
        if (!order) return;

        const pct = Math.max(0, Math.min(100, Number(order.progressPct) || 0));
        const status = normalizeOrderStatus(order.statusKey || '');
        const hasPreview = hasGeneratedPreviewHtml(id);
        let nextPct = pct;
        let nextStatus = status.key;
        let note = '';
        const paidAt = String(order.paidAt || '').trim();
        const isPaidOrder = Boolean(paidAt) || status.key === 'betaald';
        const claimInfo = getOrderClaimInfo(id);

        if (isPaidOrder) {
            nextStatus = 'betaald';
            if (nextPct >= 100 && !hasPreview) nextPct = 0;
        } else if (claimInfo.isClaimed && !hasPreview) {
            if (nextStatus !== 'betaald') nextStatus = 'bezig';
            if (nextPct >= 100) nextPct = 0;
        } else if (pct >= 100 && hasPreview) {
            nextPct = 100;
            nextStatus = paidAt ? 'betaald' : 'klaar';
        } else if (pct >= 100 && !hasPreview) {
            nextPct = 0;
            nextStatus = 'actief';
            note = 'Vorige run had geen opgeslagen preview en is teruggezet. Voer de opdracht opnieuw uit.';
        } else if (pct > 0) {
            nextPct = 0;
            nextStatus = 'actief';
            note = 'Vorige run was onderbroken na refresh/sluiten. Voer de opdracht opnieuw uit.';
        } else if (status.key === 'bezig') {
            nextStatus = 'actief';
            note = 'Vorige run stond nog op bezig maar draaide niet meer. Voer de opdracht opnieuw uit.';
        } else if (status.key === 'klaar' && !hasPreview) {
            nextStatus = 'actief';
            note = 'Opdracht stond op klaar zonder preview en is teruggezet.';
        }

        if (nextPct !== pct || nextStatus !== status.key) {
            order.progressPct = nextPct;
            order.statusKey = nextStatus;
            order.updatedAt = Date.now();
            changed = true;
        }

        if (note) {
            const lastLog = Array.isArray(order.logs) && order.logs.length ? String(order.logs[order.logs.length - 1]?.msg || '') : '';
            if (lastLog !== note) {
                appendOrderLog(id, note, true);
                changed = true;
            }
        }
    });

    if (changed) {
        persistOrdersRuntime();
    }
}

function restoreOrdersRuntimeFromState() {
    try {
        const raw = readStateValue(ORDER_RUNTIME_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

        Object.entries(parsed).forEach(([id, value]) => {
            const numericId = Number(id);
            if (!Number.isFinite(numericId) || numericId <= 0) return;
            const prev = orders[numericId] || {};
            orders[numericId] = {
                ...prev,
                name: String(value?.name || prev.name || ''),
                type: String(value?.type || prev.type || ''),
                logs: Array.isArray(value?.logs) ? value.logs.slice(-200) : (Array.isArray(prev.logs) ? prev.logs : []),
                progressPct: Math.max(0, Math.min(100, Number(value?.progressPct) || 0)),
                statusKey: normalizeOrderStatus(value?.statusKey || '').key,
                paidAt: String(value?.paidAt || prev.paidAt || '').trim() || null,
                claimedBy: String(value?.claimedBy || prev.claimedBy || '').trim() || null,
                claimedAt: String(value?.claimedAt || prev.claimedAt || '').trim() || null,
                updatedAt: Number(value?.updatedAt) || prev.updatedAt || null
            };
        });

        reconcileOrdersRuntimeAfterRestore();
        Object.keys(orders).forEach((id) => applyOrderUiStateToCard(Number(id)));
    } catch (_) {
        // ignore broken state
    }
}

function renderCustomOrderCardHtml(record) {
    const id = Number(record.id);
    const ui = resolveOrderUiState({
        status: record.status,
        paidAt: record.paidAt,
        progressPct: record.status === 'klaar' || record.status === 'betaald' ? 100 : 0
    });
    const isDelivered = ui.isBuilt;
    const isPaid = ui.isPaid;
    const clientLine = [record.clientName, record.location].filter(Boolean).join(' — ');
    const claimInfo = getOrderClaimInfo(id);
    const deliveryTime = String(record.deliveryTime || '').trim();
    const amountText = Math.max(1, Math.round(Number(record.amount) || 0)).toLocaleString('nl-NL');
    const deliveryLabel = deliveryTime || 'Nog niet opgegeven';
    const title = String(record.title || 'Opdracht').trim() || 'Opdracht';
    const description = String(record.description || 'Geen extra omschrijving.').trim() || 'Geen extra omschrijving.';
    const deliveryHtml = `<div class="order-delivery"><strong>Oplevertijd</strong>${escapeHtml(deliveryLabel)}</div>`;
    const paymentButtonHtml = ui.isBuilt
        ? ''
        : `
                            <button class="complete-btn magnetic" id="complete-btn-${id}" type="button" data-order-complete="${id}">
                                Factuur betaald
                            </button>`;

    return `
                <div class="order-card has-claim ${isDelivered ? 'delivered' : ''} ${isPaid ? 'paid' : ''}" id="order-${id}" role="button" tabindex="0" aria-label="Opdracht ${id}">
                    <div class="order-main">
                        <div class="order-info">
                            <div class="order-client">${escapeHtml(clientLine || 'Nieuwe opdracht')}</div>
                            <div class="order-title">${escapeHtml(title)}</div>
                            <div class="order-desc">${escapeHtml(description)}</div>
                            ${deliveryHtml}
                        </div>
                        <div class="order-price">
                            <div class="order-price-label">Bedrag</div>
                            <div class="order-price-value"><span class="currency">€</span>${amountText}</div>
                        </div>
                        <div class="order-actions">
                            <button class="execute-btn magnetic" id="btn-${id}" type="button" data-order="${id}">
                                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7.5h18M5.25 7.5v10.5A1.5 1.5 0 0 0 6.75 19.5h10.5a1.5 1.5 0 0 0 1.5-1.5V7.5M9 7.5V6a3 3 0 1 1 6 0v1.5"></path></svg>
                                Open dossier
                            </button>
                            ${paymentButtonHtml}
                            <div class="order-assignee" id="assignee-${id}">${escapeHtml(claimInfo.by || 'Nog niet geclaimd')}</div>
                        </div>
                    </div>
                    <div class="order-progress" id="progress-${id}">
                        <div class="progress-meta">
                            <span class="progress-label">Voortgang</span>
                            <span class="progress-percent" id="pct-${id}">${Math.round(ui.pct)}%</span>
                        </div>
                        <div class="progress-bar-bg"><div class="progress-bar-fill" id="bar-${id}"></div></div>
                        <div class="progress-steps">
                            <span class="progress-step" id="step-${id}-1">Analyse</span>
                            <span class="progress-step" id="step-${id}-2">Design</span>
                            <span class="progress-step" id="step-${id}-3">Development</span>
                            <span class="progress-step" id="step-${id}-4">Testing</span>
                            <span class="progress-step" id="step-${id}-5">Oplevering</span>
                        </div>
                    </div>
                </div>
            `;
}

function bindDynamicOrderCard(card) {
    if (!card) return;

    const id = Number(String(card.id || '').replace('order-', ''));
    if (!id) return;

    const executeBtn = card.querySelector('.execute-btn[data-order]');
    if (executeBtn && !executeBtn.dataset.boundExecute) {
        executeBtn.dataset.boundExecute = '1';
        executeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            executeOrder(id);
        });
    }

    const completeBtn = card.querySelector('.complete-btn[data-order-complete]');
    if (completeBtn && !completeBtn.dataset.boundComplete) {
        completeBtn.dataset.boundComplete = '1';
        completeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void handleOrderPaymentAction(id);
        });
    }

    if (!card.dataset.boundCardOpen) {
        card.dataset.boundCardOpen = '1';
        card.addEventListener('click', (e) => {
            if (e.target.closest('button,a')) return;
            openModal(id);
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openModal(id);
            }
        });
    }
}

function appendCustomOrderCard(record, options = {}) {
    const grid = document.getElementById('ordersGrid');
    if (!grid || !record) return null;

    const id = Number(record.id);
    if (!Number.isFinite(id) || id <= 0) return null;

    const existing = document.getElementById('order-' + id);
    if (existing) return existing;

    ensureOrderRuntimeState(record);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderCustomOrderCardHtml(record).trim();
    const card = wrapper.firstElementChild;
    if (!card) return null;

    grid.appendChild(card);
    bindDynamicOrderCard(card);
    refreshOrderSummaryCards();

    if (options.scrollIntoView) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return card;
}

function loadCustomOrderCards() {
    customOrders = readCustomOrdersFromStorage();
    customOrders.forEach((record) => {
        appendCustomOrderCard(record);
    });
    refreshEstimatedApiCostsForOrders();
    refreshOrderSummaryCards();
}

function setCreateOrderMessage(message, type) {
    const el = document.getElementById('createOrderMessage');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'create-order-message' + (type ? ' ' + type : '');
}

function setCreateOrderAgendaHint(message, type) {
    const el = document.getElementById('newOrderAgendaLeadHint');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'create-order-hint' + (type ? ' ' + type : '');
}

function formatAgendaLeadDateTimeLabel(dateValue, timeValue) {
    const date = String(dateValue || '').trim();
    const time = String(timeValue || '').trim() || '09:00';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    const parsed = new Date(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '09:00'}:00`);
    if (Number.isNaN(parsed.getTime())) return `${date} ${time}`;
    return parsed.toLocaleString('nl-NL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeAgendaLeadOption(item) {
    if (!item || typeof item !== 'object') return null;
    const id = Number(item?.id);
    if (!Number.isFinite(id) || id <= 0) return null;

    const date = String(item?.date || '').trim();
    const time = String(item?.time || '').trim();
    const callId = String(item?.callId || '').trim();

    return {
        id,
        company: String(item?.company || 'Onbekende lead').trim() || 'Onbekende lead',
        contact: String(item?.contact || 'Onbekend').trim() || 'Onbekend',
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
        time: /^\d{2}:\d{2}$/.test(time) ? time : '09:00',
        summary: String(item?.summary || '').trim(),
        value: String(item?.value || '').trim(),
        postCallPrompt: String(item?.postCallPrompt || '').trim(),
        postCallNotesTranscript: String(item?.postCallNotesTranscript || '').trim(),
        leadOwnerName: String(item?.leadOwnerName || item?.leadOwnerFullName || '').trim(),
        leadOwnerFullName: String(item?.leadOwnerFullName || item?.leadOwnerName || '').trim(),
        activeOrderId: Number(item?.activeOrderId) || null,
        callId: callId || null
    };
}

function compareAgendaLeadOptions(a, b) {
    const aTs = Date.parse(`${String(a?.date || '1970-01-01')}T${String(a?.time || '00:00')}:00`) || 0;
    const bTs = Date.parse(`${String(b?.date || '1970-01-01')}T${String(b?.time || '00:00')}:00`) || 0;
    if (aTs === bTs) return Number(b?.id || 0) - Number(a?.id || 0);
    return bTs - aTs;
}

async function fetchAgendaLeadOptions(force) {
    const shouldForce = Boolean(force);
    const now = Date.now();
    if (
        !shouldForce &&
        agendaLeadOptions.length &&
        (now - agendaLeadOptionsLoadedAt) < AGENDA_LEAD_CACHE_MS
    ) {
        return agendaLeadOptions;
    }

    if (agendaLeadOptionsPromise) return agendaLeadOptionsPromise;

    agendaLeadOptionsPromise = (async () => {
        const endpoint = '/api/agenda/appointments?limit=250';
        try {
            const response = await fetch(endpoint, { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result?.ok || !Array.isArray(result?.appointments)) {
                throw new Error('Agenda data niet beschikbaar.');
            }
            agendaLeadOptions = result.appointments
                .map(normalizeAgendaLeadOption)
                .filter(Boolean)
                .sort(compareAgendaLeadOptions);
            agendaLeadOptionsLoadedAt = Date.now();
            syncOrderClaimsFromAgendaOwners();
        } catch (_) {
            if (!agendaLeadOptions.length) {
                agendaLeadOptions = [];
                agendaLeadOptionsLoadedAt = Date.now();
            }
        }
        return agendaLeadOptions;
    })().finally(() => {
        agendaLeadOptionsPromise = null;
    });

    return agendaLeadOptionsPromise;
}

function getAgendaLeadById(id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;
    return agendaLeadOptions.find((item) => Number(item?.id) === numericId) || null;
}

function getAgendaLeadOptionLabel(lead) {
    if (!lead) return '';
    const dateLabel = formatAgendaLeadDateTimeLabel(lead.date, lead.time);
    const extras = [];
    if (dateLabel) extras.push(dateLabel);
    if (lead.activeOrderId) extras.push(`al gekoppeld #${lead.activeOrderId}`);
    const base = `${lead.company} - ${lead.contact}`;
    return extras.length ? `${base} · ${extras.join(' · ')}` : base;
}

function getAgendaLeadReferenceLabel(lead) {
    if (!lead) return '';
    const dateLabel = formatAgendaLeadDateTimeLabel(lead.date, lead.time);
    return `#${lead.id} · ${lead.company}${dateLabel ? ` · ${dateLabel}` : ''}`;
}

function syncOrderClaimsFromAgendaOwners() {
    if (!customOrders.length || !agendaLeadOptions.length) return;

    let changed = false;

    customOrders.forEach((record) => {
        if (!record || typeof record !== 'object') return;

        const linkedLeadOwnerName = resolveLinkedLeadOwnerNameForOrder(record);
        if (!linkedLeadOwnerName) return;

        const currentClaimedBy = normalizeClaimEmployeeName(record.claimedBy || '');
        if (!currentClaimedBy) {
            record.claimedBy = linkedLeadOwnerName;
            changed = true;
        }

        const activeId = Number(record.id);
        if (!Number.isFinite(activeId) || activeId <= 0) return;
        if (!orders[activeId]) return;

        const runtimeClaimedBy = normalizeClaimEmployeeName(orders[activeId].claimedBy || '');
        if (!runtimeClaimedBy) {
            orders[activeId].claimedBy = linkedLeadOwnerName;
            orders[activeId].updatedAt = Date.now();
            changed = true;
        }
    });

    if (!changed) return;

    persistCustomOrders();
    persistOrdersRuntime();
    Object.keys(orders).forEach((id) => applyOrderUiStateToCard(Number(id)));
}

function renderCreateOrderAgendaLeadOptions(selectedId) {
    const select = document.getElementById('newOrderAgendaLeadId');
    if (!select) return;

    const previous = Number(selectedId || select.value);
    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Geen koppeling';
    select.appendChild(defaultOption);

    agendaLeadOptions.forEach((lead) => {
        const option = document.createElement('option');
        option.value = String(lead.id);
        option.textContent = getAgendaLeadOptionLabel(lead);
        select.appendChild(option);
    });

    if (Number.isFinite(previous) && previous > 0) {
        select.value = String(previous);
    }
}

function hydrateCreateOrderFormFromLead(lead) {
    if (!lead) return;

    const companyInput = document.getElementById('newOrderCompany');
    const contactInput = document.getElementById('newOrderContact');
    const titleInput = document.getElementById('newOrderTitle');
    const descInput = document.getElementById('newOrderDesc');
    const deliveryInput = document.getElementById('newOrderDeliveryTime');
    const assigneeInput = document.getElementById('newOrderAssignee');
    const amountInput = document.getElementById('newOrderAmount');

    if (companyInput) {
        companyInput.value = lead.company;
        companyInput.dataset.agendaAutofill = '1';
    }
    if (contactInput) {
        contactInput.value = lead.contact || '';
        contactInput.dataset.agendaAutofill = '1';
    }
    if (titleInput) {
        if (!titleInput.value.trim() || titleInput.dataset.agendaAutofill === '1') {
            titleInput.value = `Website traject voor ${lead.company}`;
            titleInput.dataset.agendaAutofill = '1';
        }
    }
    if (descInput) {
        if (lead.summary && (!descInput.value.trim() || descInput.dataset.agendaAutofill === '1')) {
            descInput.value = lead.summary;
            descInput.dataset.agendaAutofill = '1';
        }
    }
    if (deliveryInput) {
        const deliveryLabel = formatAgendaLeadDateTimeLabel(lead.date, lead.time);
        if (deliveryLabel && (!deliveryInput.value.trim() || deliveryInput.dataset.agendaAutofill === '1')) {
            deliveryInput.value = `Volgens afspraak op ${deliveryLabel}`;
            deliveryInput.dataset.agendaAutofill = '1';
        }
    }
    if (assigneeInput) {
        const suggestedAssignee = normalizeOrderAssignee(lead.leadOwnerName || lead.leadOwnerFullName || '');
        if (suggestedAssignee && (!assigneeInput.value || assigneeInput.dataset.agendaAutofill === '1')) {
            assigneeInput.value = suggestedAssignee;
            assigneeInput.dataset.agendaAutofill = '1';
        }
    }
    if (amountInput) {
        const amount = moneyToNumber(lead.value);
        if (amount && (!String(amountInput.value || '').trim() || amountInput.dataset.agendaAutofill === '1')) {
            amountInput.value = String(amount);
            amountInput.dataset.agendaAutofill = '1';
        }
    }
}

function handleCreateOrderAgendaLeadChange() {
    const select = document.getElementById('newOrderAgendaLeadId');
    if (!select) return;
    const lead = getAgendaLeadById(select.value);
    if (!lead) {
        setCreateOrderAgendaHint('Koppel optioneel aan een bestaande agenda-afspraak of lead.', '');
        return;
    }

    hydrateCreateOrderFormFromLead(lead);
    const hasPrompt = Boolean(String(lead.postCallPrompt || '').trim());
    const hasTranscript = Boolean(String(lead.postCallNotesTranscript || '').trim());
    const parts = [`Gekoppeld: afspraak #${lead.id}`];
    const dateLabel = formatAgendaLeadDateTimeLabel(lead.date, lead.time);
    if (dateLabel) parts.push(dateLabel);
    if (hasPrompt) parts.push('prompt beschikbaar');
    if (hasTranscript) parts.push('transcript beschikbaar');
    if (lead.activeOrderId) parts.push(`staat al bij actieve opdracht #${lead.activeOrderId}`);
    setCreateOrderAgendaHint(parts.join(' · '), lead.activeOrderId ? 'warning' : '');
}

async function populateCreateOrderAgendaLeadOptions(force) {
    const select = document.getElementById('newOrderAgendaLeadId');
    if (!select) return;
    const selectedId = select.value;

    setCreateOrderAgendaHint('Agenda-leads laden...', '');
    await fetchAgendaLeadOptions(force);
    renderCreateOrderAgendaLeadOptions(selectedId);

    if (!agendaLeadOptions.length) {
        setCreateOrderAgendaHint('Geen agenda-afspraken gevonden om aan te koppelen.', '');
        return;
    }
    if (select.value) {
        handleCreateOrderAgendaLeadChange();
        return;
    }
    setCreateOrderAgendaHint('Koppel optioneel aan een bestaande agenda-afspraak of lead.', '');
}

async function openCreateOrderModal() {
    const modal = document.getElementById('createOrderModal');
    if (!modal) return;
    const form = document.getElementById('createOrderForm');
    if (form) form.reset();
    [
        'newOrderCompany',
        'newOrderContact',
        'newOrderTitle',
        'newOrderDesc',
        'newOrderDeliveryTime',
        'newOrderAssignee',
        'newOrderAmount'
    ].forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (field && field.dataset) {
            delete field.dataset.agendaAutofill;
        }
    });
    setCreateOrderMessage('', '');
    setCreateOrderAgendaHint('Agenda-leads laden...', '');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    void populateCreateOrderAgendaLeadOptions(false);
    window.setTimeout(() => {
        document.getElementById('newOrderAgendaLeadId')?.focus();
    }, 40);
}

function closeCreateOrderModal() {
    const modal = document.getElementById('createOrderModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    setCreateOrderMessage('', '');
}

function handleCreateOrderSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    const companyName = String(data.get('companyName') || '').trim();
    const contactPerson = String(data.get('contactPerson') || '').trim();
    const title = String(data.get('title') || '').trim();
    const description = String(data.get('description') || '').trim();
    const deliveryTime = String(data.get('deliveryTime') || '').trim();
    const domainName = String(data.get('domainName') || '').trim();
    const amount = Math.round(Number(data.get('amount')));
    const selectedAppointmentId = Number(data.get('agendaLeadId'));
    const includeSampleDesign = String(data.get('includeSampleDesign') || 'no').trim().toLowerCase() === 'yes';
    const linkedLead = Number.isFinite(selectedAppointmentId) && selectedAppointmentId > 0
        ? getAgendaLeadById(selectedAppointmentId)
        : null;
    const sourceAppointmentId = linkedLead
        ? Number(linkedLead.id)
        : (Number.isFinite(selectedAppointmentId) && selectedAppointmentId > 0 ? selectedAppointmentId : null);
    const sourceCallId = String(linkedLead?.callId || '').trim() || null;
    const sourceAppointmentLabel = linkedLead
        ? getAgendaLeadReferenceLabel(linkedLead)
        : null;
    const linkedPrompt = String(linkedLead?.postCallPrompt || '').trim();
    const linkedTranscript = String(linkedLead?.postCallNotesTranscript || '').trim();
    const linkedLeadOwnerName = normalizeClaimEmployeeName(linkedLead?.leadOwnerName || linkedLead?.leadOwnerFullName || '');
    const selectedAssignee = normalizeOrderAssignee(data.get('assignee') || linkedLeadOwnerName);
    const linkedContactPhone = String(linkedLead?.phone || '').trim();
    const linkedContactEmail = String(linkedLead?.contactEmail || linkedLead?.email || '').trim();
    const status = 'wacht';
    const claimedAtIso = selectedAssignee ? new Date().toISOString() : null;

    if (!companyName || !contactPerson || !title || !description || !deliveryTime) {
        setCreateOrderMessage('Vul alle velden in.', 'error');
        return;
    }
    if (!selectedAssignee || !ORDER_ASSIGNEE_OPTIONS.includes(selectedAssignee)) {
        setCreateOrderMessage('Kies wie deze opdracht krijgt toegewezen.', 'error');
        return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        setCreateOrderMessage('Vul een geldig bedrag in.', 'error');
        return;
    }

    const record = {
        id: getNextOrderId(),
        clientName: companyName,
        location: contactPerson,
        companyName,
        contactName: contactPerson,
        contactPhone: linkedContactPhone,
        contactEmail: linkedContactEmail,
        title,
        description,
        deliveryTime,
        domainName,
        amount,
        status,
        prompt: linkedPrompt,
        transcript: linkedTranscript,
        includeSampleDesign,
        apiCostEur: null,
        apiCostUsd: null,
        apiTokensInput: null,
        apiTokensOutput: null,
        apiModel: '',
        estimatedApiCostEur: null,
        estimatedApiCostUsd: null,
        estimatedApiTokensInput: null,
        estimatedApiTokensOutput: null,
        estimatedApiModel: '',
        estimatedApiBuildMode: null,
        estimatedApiGeneratedAt: null,
        lastRunAt: null,
        paidAt: null,
        launchRepoUrl: null,
        launchDeploymentUrl: null,
        launchDomainStatus: null,
        launchDomainMessage: null,
        launchedAt: null,
        claimedBy: selectedAssignee || null,
        claimedAt: claimedAtIso,
        referenceImages: [],
        sourceAppointmentId,
        sourceCallId,
        sourceAppointmentLabel
    };

    customOrders.push(record);
    persistCustomOrders();
    appendCustomOrderCard(record, { scrollIntoView: true });
    persistOrdersRuntime();
    form.reset();
    closeCreateOrderModal();
}

function setLastActiveOrder(orderId) {
    writeStateValue(ORDER_STATE_KEY, JSON.stringify({
        lastOrderId: String(orderId),
        updatedAt: new Date().toISOString()
    }));
}

function selectActiveOrderId(explicitId) {
    if (explicitId && orders[explicitId]) return Number(explicitId);

    try {
        const raw = readStateValue(ORDER_STATE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const lastId = Number(parsed?.lastOrderId);
            if (lastId && orders[lastId]) return lastId;
        }
    } catch (_) {
        // ignore
    }

    const byUpdated = Object.entries(orders)
        .map(([id, o]) => ({ id: Number(id), ts: Number(o.updatedAt || 0) }))
        .filter(x => Number.isFinite(x.ts) && x.ts > 0)
        .sort((a, b) => b.ts - a.ts);
    if (byUpdated.length) return byUpdated[0].id;

    const first = Object.keys(orders).map(Number).sort((a, b) => a - b)[0];
    return first || 1;
}

function getPreviewStorageKey(orderId) {
    return PREVIEW_HTML_PREFIX + String(orderId);
}

function saveGeneratedPreviewHtml(orderId, html) {
    const key = getPreviewStorageKey(orderId);
    const content = String(html || '');
    writeStateValue(key, content);
    return true;
}

function hasGeneratedPreviewHtml(orderId) {
    return Boolean(readStateValue(getPreviewStorageKey(orderId)));
}

function getPreviewUrl(id) {
    const activeId = selectActiveOrderId(id);
    return `/premium-opdracht-preview?id=${encodeURIComponent(String(activeId))}`;
}

function openPreview(id, options = {}) {
    const previewUrl = getPreviewUrl(id);
    try {
        const anchor = document.createElement('a');
        anchor.href = previewUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return true;
    } catch (_) {
        // Fall through to window.open if the anchor strategy fails.
    }

    const w = window.open(previewUrl, '_blank', 'noopener,noreferrer');
    if (w) {
        try {
            w.focus();
        } catch (_) {
            // ignore focus errors
        }
        return true;
    }

    return false;
}

function getOrderDossierUrl(id, options = {}) {
    const activeId = selectActiveOrderId(id);
    const params = new URLSearchParams();
    params.set('id', String(activeId));
    if (options && options.autoPrint) {
        params.set('autoprint', '1');
    }
    return `/premium-opdracht-dossier?${params.toString()}`;
}

function openOrderDossier(id, options = {}) {
    const url = getOrderDossierUrl(id, options);
    if (options && options.newTab) {
        try {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            return true;
        } catch (_) {
            // Fall through to window.open if the anchor strategy fails.
        }

        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (opened) {
            try {
                opened.focus();
            } catch (_) {
                // ignore focus errors
            }
            return true;
        }

        return false;
    }
    window.location.assign(url);
    return true;
}

function normalizeClaimEmployeeName(value) {
    const canonicalAssignee = normalizeOrderAssignee(value);
    if (canonicalAssignee) return canonicalAssignee;
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function getOrderClaimInfo(id) {
    const activeId = selectActiveOrderId(id);
    const runtime = orders[activeId] || {};
    const customOrder = getCustomOrderById(activeId) || {};
    const linkedLeadOwnerName = resolveLinkedLeadOwnerNameForOrder(customOrder);
    const claimedBy = normalizeClaimEmployeeName(customOrder.claimedBy || runtime.claimedBy || linkedLeadOwnerName || '');
    const claimedAtRaw = String(customOrder.claimedAt || runtime.claimedAt || '').trim();
    const claimedAt = claimedAtRaw || null;
    return {
        by: claimedBy || '',
        at: claimedAt,
        isClaimed: Boolean(claimedBy)
    };
}

async function markOrderAsPaid(id, options = {}) {
    const order = orders[id];
    if (!order) return false;

    const ui = resolveOrderUiState(order);
    if (ui.isPaid) return true;

    const requiresConfirmation = options.confirm === true && !ui.isBuilt;
    if (requiresConfirmation) {
        const invoicePaidReviewReminder =
            'Vergeet niet om de klant op een vriendelijk en natuurlijk moment te vragen of hij of zij een review wil achterlaten over de ervaring!';
        const reviewBadgeGoogleUrl = 'https://www.google.com/maps';
        const reviewBadgeTrustpilotUrl = 'https://www.trustpilot.com';
        const invoicePaidConfirmBodyHtml = [
            '<p class="softora-dialog-review-lead" style="margin:0 0 0.65rem 0">',
            invoicePaidReviewReminder,
            '</p>',
            '<div class="softora-dialog-badge-row">',
            '<a class="softora-review-badge softora-review-badge--google" href="',
            reviewBadgeGoogleUrl,
            '" target="_blank" rel="noopener noreferrer" aria-label="Google Reviews">',
            '<svg xmlns="http://www.w3.org/2000/svg" width="142" height="38" viewBox="0 0 142 38" aria-hidden="true" role="img">',
            '<rect width="142" height="38" rx="9" fill="#fff" stroke="#dadce0" stroke-width="1"/>',
            '<g transform="translate(8 7) scale(0.833333)">',
            '<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>',
            '<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>',
            '<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>',
            '<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>',
            '</g>',
            '<text x="44" y="24" font-family="system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="#202124">Google Reviews</text>',
            '</svg></a>',
            '<a class="softora-review-badge softora-review-badge--trustpilot" href="',
            reviewBadgeTrustpilotUrl,
            '" target="_blank" rel="noopener noreferrer" aria-label="Trustpilot">',
            '<svg xmlns="http://www.w3.org/2000/svg" width="148" height="38" viewBox="0 0 148 38" aria-hidden="true" role="img">',
            '<rect width="148" height="38" rx="9" fill="#00b67a"/>',
            '<path fill="#fff" d="M19.2 11.2l2.35 7.15h7.6l-6.15 5.6 2.35 7.15-6.15-4.48-6.15 4.48 2.35-7.15-6.15-5.6h7.6l2.35-7.15z"/>',
            '<text x="40" y="24" font-family="system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif" font-size="12" font-weight="700" fill="#fff" letter-spacing="0.04em">Trustpilot</text>',
            '</svg></a>',
            '</div>',
        ].join('');
        const confirmed = await confirmActiveOrderAction(invoicePaidReviewReminder, {
            title: 'Factuur betaald bevestigen',
            confirmText: 'Bevestigen',
            cancelText: 'Annuleren',
            bodyHtml: invoicePaidConfirmBodyHtml,
        });
        if (!confirmed) return false;
    }

    const previousOrder = cloneOrderRuntimeForRollback(order);
    const previousCustomOrders = customOrders.slice();
    const completeBtnEl = document.getElementById(`complete-btn-${id}`);
    if (completeBtnEl) {
        completeBtnEl.disabled = true;
        completeBtnEl.textContent = 'Opslaan...';
    }

    const nowIso = new Date().toISOString();
    try {
        order.progressPct = 100;
        order.paidAt = nowIso;
        order.statusKey = 'betaald';
        order.updatedAt = Date.now();

        updateCustomOrderById(id, {
            status: 'betaald',
            paidAt: nowIso
        });

        appendOrderLog(
            id,
            ui.isBuilt
                ? 'Klant heeft betaald. Opdracht is volledig afgerond.'
                : 'Factuur bevestigd als betaald. Opdracht is afgerond en verplaatst naar voltooide opdrachten.',
            true
        );
        persistOrdersRuntime();
        await persistRequiredUiStateKeysOrThrow(
            [CUSTOM_ORDERS_KEY, ORDER_RUNTIME_KEY],
            'Remote opdrachtstatus kon niet worden opgeslagen.'
        );
        applyOrderUiStateToCard(id);
        setOrderFilter('completed');
        return true;
    } catch (error) {
        console.error('Factuurstatus opslaan mislukt:', error);
        customOrders = previousCustomOrders;
        persistCustomOrders();
        if (previousOrder) {
            orders[id] = previousOrder;
        }
        persistOrdersRuntime();
        try {
            await flushRemoteUiStateSave();
        } catch (_) {
            // ignore rollback flush errors
        }
        applyOrderUiStateToCard(id);
        await showActiveOrderAlert('Factuurstatus opslaan mislukt. Probeer het opnieuw.', {
            title: 'Opslaan mislukt',
            confirmText: 'Sluiten',
        });
        return false;
    }
}

function markOrderAsCompleted(id) {
    const order = orders[id];
    if (!order) return;

    const ui = resolveOrderUiState(order);
    if (ui.isBuilt) return;

    order.progressPct = 100;
    order.statusKey = 'klaar';
    order.updatedAt = Date.now();
    order.paidAt = null;

    updateCustomOrderById(id, {
        status: 'klaar',
        paidAt: null
    });

    appendOrderLog(id, 'Opdracht handmatig als opgeleverd gemarkeerd.', true);
    persistOrdersRuntime();
    applyOrderUiStateToCard(id);
    setOrderFilter('completed');
}

async function handleOrderPaymentAction(id) {
    const order = orders[id];
    if (!order) return false;
    const ui = resolveOrderUiState(order);
    if (ui.isPaid || ui.isBuilt) return false;
    return markOrderAsPaid(id, { confirm: true });
}

function buildFallbackSitePrompt(meta, customOrder) {
    const company = String(meta?.clientName || customOrder?.clientName || 'bedrijf').trim();
    const title = String(meta?.title || customOrder?.title || 'website').trim();
    const description = String(meta?.description || customOrder?.description || '').trim();
    const deliveryTime = String(meta?.deliveryTime || customOrder?.deliveryTime || '').trim();
    const domainName = String(meta?.domainName || customOrder?.domainName || '').trim();
    const sourceAppointmentLabel = String(meta?.sourceAppointmentLabel || customOrder?.sourceAppointmentLabel || '').trim();
    const includeSampleDesign = Boolean(meta?.includeSampleDesign || customOrder?.includeSampleDesign);
    const referenceImages = normalizeReferenceImageList(customOrder?.referenceImages || []);
    return [
        `Bouw een premium maatwerk HTML website voor ${company}.`,
        `Projecttitel: ${title}.`,
        description ? `Context: ${description}` : '',
        deliveryTime ? `Gewenste oplevertermijn: ${deliveryTime}.` : '',
        domainName ? `Gewenst domein: ${domainName}.` : '',
        sourceAppointmentLabel ? `Gekoppelde agenda-afspraak: ${sourceAppointmentLabel}.` : '',
        referenceImages.length ? `Er zijn ${referenceImages.length} referentiebeeld(en) toegevoegd; gebruik die als visuele richting.` : '',
        includeSampleDesign
            ? 'Gebruik het voorbeelddesign als basis voor de echte websitebouw. Behoud richting, sfeer en structuur, en werk het door naar een productieklare site.'
            : '',
        'Doel: maak een website die voelt als high-end maatwerk en niet als een template.',
        'Werk als creative director, UX designer, copywriter en senior front-end developer in één.',
        'Begin met een sterke merkhoek en heldere waardepropositie, en bouw daarna een logisch verhaal van hero naar aanbod, vertrouwen en contact.',
        'Gebruik een onderscheidende maar kloppende stijl met sterke typografie, consistente spacing, duidelijke sectiehiërarchie en overtuigende CTA’s.',
        'Als details ontbreken mag je logisch branche-aanbod afleiden, maar verzin geen nep-awards, nep-reviews, nep-adressen of onrealistische claims.',
        'Lever één volledig HTML-bestand met inline CSS en alleen indien echt nodig inline JavaScript.',
        'Technische eisen: volledig responsive, mobiel sterk, semantische HTML, goede contrasten, nette containers, geen overlap, geen losse blokken en geen slordige layout.',
        'Structuur: hero, aanbod/diensten, onderscheidend vermogen, vertrouwen, over ons, contact/boek CTA en footer in één logisch premium geheel.',
        'Taal van de website: Nederlands.',
        'Output: alleen geldige HTML code zonder markdown.'
    ].filter(Boolean).join('\n');
}

function appendSampleDesignInstruction(promptText, customOrder) {
    const basePrompt = String(promptText || '').trim();
    if (!basePrompt) return '';
    if (!customOrder?.includeSampleDesign) return basePrompt;

    const lower = basePrompt.toLowerCase();
    if (lower.includes('voorbeelddesign') || lower.includes('voorbeeld design')) {
        return basePrompt;
    }

    return [
        basePrompt,
        'BELANGRIJK: gebruik het voorbeelddesign als basis voor de definitieve build en behoud visuele richting + componentstructuur waar logisch.'
    ].join('\n');
}

function getOrderBuildRequestPayload(id) {
    const activeId = selectActiveOrderId(id);
    const meta = getOrderMeta(activeId) || {
        id: String(activeId),
        clientName: orders[id]?.name || 'Bedrijf',
        title: orders[id]?.type || 'Project',
        description: '',
        deliveryTime: String(getCustomOrderById(activeId)?.deliveryTime || '').trim(),
        domainName: String(getCustomOrderById(activeId)?.domainName || '').trim(),
        sourceAppointmentLabel: String(getCustomOrderById(activeId)?.sourceAppointmentLabel || '').trim(),
        includeSampleDesign: Boolean(getCustomOrderById(activeId)?.includeSampleDesign),
        referenceImages: normalizeReferenceImageList(getCustomOrderById(activeId)?.referenceImages || [])
    };
    const customOrder = getCustomOrderById(activeId);
    const basePrompt = String(customOrder?.prompt || '').trim() || buildFallbackSitePrompt(meta, customOrder);
    const prompt = appendSampleDesignInstruction(basePrompt, customOrder);

    return {
        orderId: activeId,
        company: meta.clientName,
        title: meta.title,
        description: meta.description,
        deliveryTime: meta.deliveryTime,
        domainName: String(customOrder?.domainName || meta?.domainName || '').trim(),
        prompt,
        buildMode,
        language: 'nl',
        sourceAppointmentId: Number(customOrder?.sourceAppointmentId) || null,
        sourceCallId: String(customOrder?.sourceCallId || '').trim() || null,
        includeSampleDesign: Boolean(customOrder?.includeSampleDesign),
        referenceImages: normalizeReferenceImageList(customOrder?.referenceImages || [])
    };
}

async function postEstimateSiteCostRequest(payload) {
    return postActiveOrderJsonWithFallback(
        [
            '/api/active-order-estimate-site-cost',
            '/api/active-orders/estimate-site-cost'
        ],
        payload,
        {
            timeoutMs: 30000,
            statusMessage: 'Kostenschatting mislukt',
            timeoutMessage: 'Timeout: AI kostenschatting duurde te lang.',
            fallbackMessage: 'AI kostenschatting mislukt.'
        }
    );
}

async function postActiveOrderJsonWithFallback(endpoints, payload, options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    const statusMessage = String(options.statusMessage || 'Actieve opdracht verzoek mislukt').trim();
    const timeoutMessage = String(options.timeoutMessage || `Timeout: ${statusMessage} duurde te lang.`).trim();
    const fallbackMessage = String(options.fallbackMessage || statusMessage || 'Actieve opdracht verzoek mislukt.').trim();
    let lastError = null;
    const endpointList = Array.isArray(endpoints) ? endpoints : [];

    for (let i = 0; i < endpointList.length; i++) {
        const endpoint = endpointList[i];
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
                signal: controller.signal,
                cache: 'no-store'
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (_) {
                data = {};
            }
            if (!res.ok || !data?.ok) {
                const message = String(
                    data?.detail ||
                    data?.error ||
                    raw ||
                    `${statusMessage} (${res.status})`
                ).trim();
                const error = new Error(message || `${statusMessage} (${res.status})`);
                error.status = Number(res.status) || 0;
                const canTryNextEndpoint =
                    i < endpointList.length - 1 &&
                    (error.status === 404 || error.status === 405 || error.status >= 500);
                if (canTryNextEndpoint) {
                    lastError = error;
                    continue;
                }
                throw error;
            }
            return data;
        } catch (error) {
            if (String(error?.name || '') === 'AbortError') {
                lastError = new Error(timeoutMessage);
            } else if (
                Number(error?.status) >= 400 &&
                Number(error?.status) < 500 &&
                Number(error?.status) !== 404 &&
                Number(error?.status) !== 405
            ) {
                throw error;
            } else {
                lastError = error;
            }
        } finally {
            window.clearTimeout(timer);
        }
    }

    throw lastError || new Error(fallbackMessage);
}

async function refreshEstimatedApiCost(id) {
    const activeId = selectActiveOrderId(id);
    const record = getCustomOrderById(activeId);
    if (!record || hasActualApiCost(record)) return null;
    if (
        hasEstimatedApiCost(record) &&
        String(record?.estimatedApiBuildMode || '').trim() === buildMode
    ) {
        updateApiCostLabel(activeId, record);
        return record;
    }

    const requestKey = `${activeId}:${buildMode}`;
    if (apiCostEstimateRequests[requestKey]) return apiCostEstimateRequests[requestKey];

    const request = postEstimateSiteCostRequest(getOrderBuildRequestPayload(activeId))
        .then((result) => {
            const apiCost = result?.apiCost || {};
            const patch = {
                estimatedApiCostEur: parseNullableNumber(apiCost?.eur),
                estimatedApiCostUsd: parseNullableNumber(apiCost?.usd),
                estimatedApiTokensInput: parseNullableNumber(apiCost?.promptTokens),
                estimatedApiTokensOutput: parseNullableNumber(apiCost?.completionTokens),
                estimatedApiModel: String(result?.model || apiCost?.model || '').trim(),
                estimatedApiBuildMode: buildMode,
                estimatedApiGeneratedAt: new Date().toISOString(),
            };
            const updated = updateCustomOrderById(activeId, patch);
            updateApiCostLabel(activeId, updated || { ...record, ...patch });
            return updated || { ...record, ...patch };
        })
        .catch(() => {
            updateApiCostLabel(activeId, record);
            return null;
        })
        .finally(() => {
            delete apiCostEstimateRequests[requestKey];
        });

    apiCostEstimateRequests[requestKey] = request;
    return request;
}

function refreshEstimatedApiCostsForOrders() {
    return;
}

function getProgressStepForPct(pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const steps = getBuildSteps();
    let currentStep = 1;
    steps.forEach((item) => {
        if (clamped >= Number(item?.pct || 0)) currentStep = Number(item?.step || currentStep);
    });
    return Math.max(1, Math.min(5, currentStep));
}

function refreshOpenModalOverview(id) {
    if (Number(currentModalId) !== Number(id)) return;
    const overview = document.getElementById('modalOverview');
    if (overview) {
        overview.innerHTML = renderModalOverviewHtml(id);
    }
}

function setOrderProgress(id, pct, step, options = {}) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const resolvedStep = Math.max(1, Math.min(5, Number(step) || getProgressStepForPct(clamped)));
    const bar = document.getElementById(`bar-${id}`);
    const pctEl = document.getElementById(`pct-${id}`);
    if (bar) {
        bar.style.width = clamped + '%';
        bar.classList.toggle('green', clamped >= 100);
    }
    if (pctEl) {
        pctEl.textContent = `${Math.round(clamped)}%`;
    }
    for (let s = 1; s <= 5; s += 1) {
        const el = document.getElementById(`step-${id}-${s}`);
        if (!el) continue;
        if (clamped >= 100) {
            el.className = 'progress-step done';
            continue;
        }
        if (s < resolvedStep) el.className = 'progress-step done';
        else if (s === resolvedStep) el.className = 'progress-step active';
        else el.className = 'progress-step';
    }
    orders[id].progressPct = clamped;
    orders[id].updatedAt = Date.now();
    refreshOpenModalOverview(id);
    if (options.persist !== false) persistOrdersRuntime();
}

function appendOrderLog(id, msg, highlight = false) {
    if (!orders[id]) return;
    const entry = {
        time: getTime(),
        msg: String(msg || ''),
        highlight: Boolean(highlight)
    };
    orders[id].logs.push(entry);
    orders[id].updatedAt = Date.now();
    refreshOpenModalOverview(id);
    persistOrdersRuntime();
}

function stopOrderProgressSimulation(id) {
    const state = activeProgressAnimations[id];
    if (!state) return;
    window.clearInterval(state.intervalId);
    delete activeProgressAnimations[id];
}

function buildProgressSimulationPlan(mode, startPct) {
    const ceiling = 96;
    const current = Math.max(0, Math.min(ceiling, Number(startPct) || 0));
    const basePlan = progressSimulationPlans[mode === 'quick' ? 'quick' : 'premium'] || progressSimulationPlans.premium;
    const points = [{ ms: 0, pct: current }];

    basePlan.forEach((point) => {
        const pointPct = Math.max(current, Math.min(ceiling, Number(point?.pct) || current));
        const pointMs = Math.max(0, Number(point?.ms) || 0);
        if (pointPct <= current) return;
        points.push({ ms: pointMs, pct: pointPct });
    });

    if (points.length === 1) {
        points.push({ ms: 300000, pct: ceiling });
    }

    return points;
}

function getInterpolatedProgressPct(points, elapsedMs) {
    if (!Array.isArray(points) || !points.length) return 0;
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    if (points.length === 1) return Number(points[0].pct) || 0;

    for (let i = 1; i < points.length; i += 1) {
        const previous = points[i - 1];
        const current = points[i];
        const endMs = Math.max(Number(previous.ms) || 0, Number(current.ms) || 0);
        if (elapsed > endMs) continue;

        const startMs = Math.max(0, Number(previous.ms) || 0);
        const span = Math.max(1, endMs - startMs);
        const ratio = Math.max(0, Math.min(1, (elapsed - startMs) / span));
        const startPct = Number(previous.pct) || 0;
        const endPct = Number(current.pct) || startPct;
        return startPct + (endPct - startPct) * ratio;
    }

    return Number(points[points.length - 1].pct) || 0;
}

function startOrderProgressSimulation(id) {
    stopOrderProgressSimulation(id);
    const milestones = getBuildSteps().filter((item) => Number(item?.pct || 0) > 0 && Number(item?.pct || 0) < 100);
    const startPct = Math.max(0, Math.min(96, Number(orders[id]?.progressPct) || 0));
    const simulationMode = buildMode === 'quick' ? 'quick' : 'premium';
    const state = {
        mode: simulationMode,
        startedAtMs: Date.now(),
        progressPlan: buildProgressSimulationPlan(simulationMode, startPct),
        nextMilestoneIndex: milestones.findIndex((item) => Number(item.pct) > (Number(orders[id]?.progressPct) || 0)),
        intervalId: null,
    };
    if (state.nextMilestoneIndex < 0) state.nextMilestoneIndex = milestones.length;

    state.intervalId = window.setInterval(() => {
        if (!orders[id]) {
            stopOrderProgressSimulation(id);
            return;
        }

        const current = Math.max(0, Math.min(100, Number(orders[id].progressPct) || 0));
        const ceiling = 96;
        if (current >= ceiling) return;

        const elapsedMs = Date.now() - state.startedAtMs;
        const targetPct = Math.max(startPct, getInterpolatedProgressPct(state.progressPlan, elapsedMs));
        const nextPct = Math.max(current, Math.min(ceiling, targetPct));
        setOrderProgress(id, nextPct, getProgressStepForPct(nextPct), { persist: false });

        while (state.nextMilestoneIndex < milestones.length && nextPct >= Number(milestones[state.nextMilestoneIndex].pct)) {
            appendOrderLog(id, milestones[state.nextMilestoneIndex].msg);
            state.nextMilestoneIndex += 1;
        }
    }, 120);

    activeProgressAnimations[id] = state;
}

async function postGenerateSiteRequest(payload) {
    return postActiveOrderJsonWithFallback(
        [
            '/api/active-order-generate-site',
            '/api/active-orders/generate-site'
        ],
        payload,
        {
            timeoutMs: 480000,
            statusMessage: 'Website generatie mislukt',
            timeoutMessage: 'Timeout: AI website generatie duurde te lang.',
            fallbackMessage: 'Website generatie mislukt.'
        }
    );
}

async function postLaunchSiteRequest(payload) {
    return postActiveOrderJsonWithFallback(
        [
            '/api/active-order-launch-site',
            '/api/active-orders/launch-site'
        ],
        payload,
        {
            timeoutMs: 600000,
            statusMessage: 'Launch pipeline mislukt',
            timeoutMessage: 'Timeout: launch pipeline duurde te lang.',
            fallbackMessage: 'Launch pipeline mislukt.'
        }
    );
}

function setClaimOrderMessage(message, type) {
    const el = document.getElementById('claimOrderMessage');
    if (!el) return;
    el.textContent = String(message || '');
    el.className = 'claim-order-message' + (type ? ` ${type}` : '');
}

function renderClaimOrderSummary(id) {
    const activeId = selectActiveOrderId(id);
    const customOrder = getCustomOrderById(activeId);
    const runtime = orders[activeId] || {};
    const title = String(customOrder?.title || runtime?.type || 'Opdracht').trim() || 'Opdracht';
    const company = String(customOrder?.clientName || runtime?.name || 'Onbekend').trim() || 'Onbekend';
    const deliveryTime = String(customOrder?.deliveryTime || '').trim();
    const domainName = String(customOrder?.domainName || '').trim();

    const rows = [
        `<div class="claim-order-summary-title">Opdracht</div><div class="claim-order-summary-value">${escapeHtml(title)}</div>`,
        `<div class="claim-order-summary-title">Klant</div><div class="claim-order-summary-value">${escapeHtml(company)}</div>`
    ];
    if (deliveryTime) {
        rows.push(`<div class="claim-order-summary-title">Oplevertijd</div><div class="claim-order-summary-value">${escapeHtml(deliveryTime)}</div>`);
    }
    if (domainName) {
        rows.push(`<div class="claim-order-summary-title">Domein</div><div class="claim-order-summary-value">${escapeHtml(domainName)}</div>`);
    }
    return rows.join('');
}

function openClaimOrderModal(id) {
    const activeId = selectActiveOrderId(id);
    const modal = document.getElementById('claimOrderModal');
    const summaryEl = document.getElementById('claimOrderSummary');
    const input = document.getElementById('claimEmployeeName');
    if (!modal || !summaryEl || !input || !orders[activeId]) return;

    currentClaimOrderId = activeId;
    summaryEl.innerHTML = renderClaimOrderSummary(activeId);
    input.value = '';
    setClaimOrderMessage('', '');

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => {
        input.focus();
        input.select();
    }, 40);
}

function closeClaimOrderModal() {
    const modal = document.getElementById('claimOrderModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    currentClaimOrderId = null;
    setClaimOrderMessage('', '');
}

function handleClaimOrderSubmit(event) {
    event.preventDefault();
    const orderId = Number(currentClaimOrderId) || 0;
    if (!orderId || !orders[orderId]) {
        setClaimOrderMessage('Deze opdracht bestaat niet meer.', 'error');
        return;
    }

    const input = document.getElementById('claimEmployeeName');
    const employeeName = normalizeClaimEmployeeName(input?.value || '');
    if (employeeName.length < 2) {
        setClaimOrderMessage('Vul je naam in om te claimen.', 'error');
        input?.focus();
        return;
    }

    const claimInfo = getOrderClaimInfo(orderId);
    if (claimInfo.isClaimed && claimInfo.by !== employeeName) {
        setClaimOrderMessage(`Deze opdracht is al geclaimd door ${claimInfo.by}.`, 'error');
        return;
    }

    const nowIso = new Date().toISOString();
    orders[orderId].claimedBy = employeeName;
    orders[orderId].claimedAt = nowIso;
    orders[orderId].statusKey = 'bezig';
    orders[orderId].updatedAt = Date.now();
    setLastActiveOrder(orderId);

    updateCustomOrderById(orderId, {
        claimedBy: employeeName,
        claimedAt: nowIso,
        status: 'bezig'
    });

    appendOrderLog(orderId, `Opdracht geclaimd door ${employeeName}. Uitvoerdossier geopend.`, true);
    applyOrderUiStateToCard(orderId);
    closeClaimOrderModal();
    openOrderDossier(orderId, { autoPrint: true });
}

function executeOrder(id) {
    const activeId = selectActiveOrderId(id);
    if (!activeId || !orders[activeId]) return;
    const claimInfo = getOrderClaimInfo(activeId);
    if (claimInfo.isClaimed) {
        openOrderDossier(activeId, { newTab: true });
        return;
    }
    openClaimOrderModal(activeId);
}

function formatModalDateTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '—';

    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
        const d = new Date(asNumber);
        if (!Number.isNaN(d.getTime())) {
            return d.toLocaleString('nl-NL');
        }
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('nl-NL');
}

function renderModalOverviewHtml(id) {
    const runtimeOrder = orders[id] || {};
    const customOrder = getCustomOrderById(id);
    const ui = resolveOrderUiState({
        status: customOrder?.status || runtimeOrder?.statusKey || 'wacht',
        paidAt: customOrder?.paidAt || runtimeOrder?.paidAt || null,
        progressPct: Number(runtimeOrder?.progressPct) || 0
    });

    const description = String(customOrder?.description || '').trim();
    const transcript = String(customOrder?.transcript || '').trim();
    const prompt = String(customOrder?.prompt || '').trim();
    const sourceLabel = String(customOrder?.sourceAppointmentLabel || '').trim();
    const domainName = String(customOrder?.domainName || '').trim();
    const deliveryTime = String(customOrder?.deliveryTime || '').trim();
    const includeSampleDesign = Boolean(customOrder?.includeSampleDesign);
    const claimInfo = getOrderClaimInfo(id);
    const launchDeploymentUrl = String(customOrder?.launchDeploymentUrl || '').trim();
    const launchRepoUrl = String(customOrder?.launchRepoUrl || '').trim();
    const launchDomainStatus = String(customOrder?.launchDomainStatus || '').trim();
    const launchDomainMessage = String(customOrder?.launchDomainMessage || '').trim();
    const lastRunAt = String(customOrder?.lastRunAt || '').trim();
    const launchedAt = String(customOrder?.launchedAt || '').trim();
    const referenceImages = normalizeReferenceImageList(customOrder?.referenceImages || []);
    const amount = Number(customOrder?.amount);
    const amountLabel = Number.isFinite(amount) && amount > 0
        ? `€${Math.round(amount).toLocaleString('nl-NL')}`
        : '—';

    const infoItems = [
        { label: 'Bedrijfsnaam', value: customOrder?.clientName || runtimeOrder?.name || '—' },
        { label: 'Contactpersoon', value: customOrder?.location || '—' },
        { label: 'Status', value: ui.status?.text || '—' },
        { label: 'Voortgang', value: `${Math.round(Math.max(0, Math.min(100, Number(runtimeOrder?.progressPct) || 0)))}%` },
        { label: 'Bedrag', value: amountLabel },
        { label: 'Oplevertijd', value: deliveryTime || '—' },
        { label: 'Domein', value: domainName || '—' },
        { label: 'Agenda-koppeling', value: sourceLabel || '—' },
        { label: 'Geclaimd door', value: claimInfo.by || 'Nog niet geclaimd' },
        { label: 'Geclaimd op', value: formatModalDateTime(claimInfo.at) },
        { label: 'Voorbeelddesign', value: includeSampleDesign ? 'Ja, meenemen als basis' : 'Nee' },
        { label: 'Foto-bijlagen', value: referenceImages.length ? String(referenceImages.length) : '0' },
        { label: 'Laatste build run', value: formatModalDateTime(lastRunAt) },
        { label: 'Launch afgerond', value: formatModalDateTime(launchedAt) },
        {
            label: 'Live URL',
            value: launchDeploymentUrl
                ? `<a href="${escapeHtml(launchDeploymentUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(launchDeploymentUrl)}</a>`
                : '—',
            raw: true
        },
        {
            label: 'GitHub repo',
            value: launchRepoUrl
                ? `<a href="${escapeHtml(launchRepoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(launchRepoUrl)}</a>`
                : '—',
            raw: true
        },
        { label: 'Domeinstatus', value: launchDomainStatus || '—' },
        { label: 'Domeinmelding', value: launchDomainMessage || '—' }
    ];

    const itemsHtml = infoItems
        .map((item) => `
            <div class="modal-overview-item">
                <div class="modal-overview-label">${escapeHtml(item.label)}</div>
                <div class="modal-overview-value">${item.raw ? String(item.value || '') : escapeHtml(item.value || '—')}</div>
            </div>
        `)
        .join('');

    const attachmentsHtml = referenceImages.length
        ? `
            <div class="modal-attachments-grid">
                ${referenceImages.map((img) => `
                    <div class="modal-attachment-thumb">
                        <img src="${escapeHtml(img.dataUrl)}" alt="${escapeHtml(img.name || 'Bijlage')}">
                    </div>
                `).join('')}
            </div>
        `
        : `<div class="modal-overview-value">Geen foto-bijlagen gekoppeld.</div>`;

    return `
        <div class="modal-overview-grid">
            ${itemsHtml}
            <div class="modal-overview-item full">
                <div class="modal-overview-label">Omschrijving opdracht</div>
                <div class="modal-overview-value modal-overview-block">${escapeHtml(description || '—')}</div>
            </div>
            <div class="modal-overview-item full">
                <div class="modal-overview-label">Meeting notities</div>
                <div class="modal-overview-value modal-overview-block">${escapeHtml(transcript || '—')}</div>
            </div>
            <div class="modal-overview-item full">
                <div class="modal-overview-label">AI bouwprompt</div>
                <div class="modal-overview-value modal-overview-block">${escapeHtml(prompt || '—')}</div>
            </div>
            <div class="modal-overview-item full">
                <div class="modal-overview-label">Foto-bijlagen preview</div>
                ${attachmentsHtml}
            </div>
        </div>
    `;
}

function openModal(id) {
    const modal = document.getElementById('modal');
    const overview = document.getElementById('modalOverview');
    const title = document.getElementById('modalTitle');
    const subtitle = document.getElementById('modalSubtitle');
    const primaryBtn = document.getElementById('modalBtn');
    const deleteBtn = document.getElementById('modalDeleteBtn');
    const isCustomOrder = Boolean(getCustomOrderById(id));

    currentModalId = id;

    title.textContent = orders[id]?.type || 'Opdracht';
    subtitle.textContent = orders[id]?.name || '';
    if (overview) {
        overview.innerHTML = '';
        overview.scrollTop = 0;
        overview.hidden = true;
    }

    const pctValue = Number(orders[id]?.progressPct) || 0;
    if (pctValue === 100 && hasGeneratedPreviewHtml(id)) {
        primaryBtn.style.display = 'block';
        primaryBtn.onclick = () => {
            openPreview(id);
            closeModal();
        };
    } else {
        primaryBtn.style.display = 'none';
        primaryBtn.onclick = null;
    }

    if (deleteBtn) {
        if (isCustomOrder) {
            setModalDeleteButtonState('Project uit systeem halen', false);
            deleteBtn.style.display = 'block';
            deleteBtn.onclick = () => {
                void removeProjectFromSystem(id);
            };
        } else {
            deleteBtn.style.display = 'none';
            deleteBtn.onclick = null;
        }
    }

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
    const modal = document.getElementById('modal');
    const deleteBtn = document.getElementById('modalDeleteBtn');
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    currentModalId = null;
    if (deleteBtn) {
        deleteBtn.style.display = 'none';
        deleteBtn.onclick = null;
        setModalDeleteButtonState('Project uit systeem halen', false);
    }
}

async function removeProjectFromSystem(id) {
    const numericId = Number(id);
    const record = getCustomOrderById(numericId);
    if (!record) {
        await showActiveOrderAlert('Dit project kan hier niet verwijderd worden.', {
            title: 'Actieve opdrachten',
            confirmText: 'Sluiten',
        });
        return;
    }

    const projectLabel = String(record.title || record.clientName || 'dit project').trim();
    const confirmed = await confirmActiveOrderAction(
        `Project "${projectLabel}" volledig uit het systeem halen? Dit verwijdert het ook uit het klantenbestand en dashboard.`,
        {
            title: 'Project verwijderen',
            confirmText: 'Verwijderen',
            cancelText: 'Annuleren',
        }
    );
    if (!confirmed) return;

    const previousCustomOrders = customOrders.slice();
    const previousOrder = orders[numericId]
        ? {
            ...orders[numericId],
            logs: Array.isArray(orders[numericId].logs) ? orders[numericId].logs.slice() : []
        }
        : null;
    const previousOrderStateValue = readStateValue(ORDER_STATE_KEY);
    const previousPreviewHtml = readStateValue(getPreviewStorageKey(numericId));

    setModalDeleteButtonState('Project wordt verwijderd...', true);

    try {
        stopOrderProgressSimulation(numericId);
        customOrders = customOrders.filter((item) => Number(item?.id) !== numericId);
        persistCustomOrders();
        delete orders[numericId];
        persistOrdersRuntime();
        syncLastActiveOrderAfterRemoval(numericId);
        await flushRemoteUiStateSave();
        const activeStateStillPending = [
            CUSTOM_ORDERS_KEY,
            ORDER_RUNTIME_KEY,
            ORDER_STATE_KEY
        ].some((key) => Object.prototype.hasOwnProperty.call(remoteUiStatePendingPatch, key));
        if (activeStateStillPending) {
            throw new Error('Remote opdrachtstatus kon niet worden opgeslagen.');
        }
        removeGeneratedPreviewHtml(numericId);

        const card = document.getElementById(`order-${numericId}`);
        if (card) card.remove();

        await syncCustomerDatabaseAfterOrderRemoval(record);
        refreshOrderSummaryCards();
        closeModal();
    } catch (error) {
        console.error('Project verwijderen mislukt:', error);
        customOrders = previousCustomOrders;
        persistCustomOrders();
        if (previousOrder) {
            orders[numericId] = previousOrder;
        }
        persistOrdersRuntime();
        writeStateValue(ORDER_STATE_KEY, previousOrderStateValue);
        if (previousPreviewHtml !== null) {
            writeStateValue(getPreviewStorageKey(numericId), previousPreviewHtml);
        }
        await flushRemoteUiStateSave();
        if (previousOrder) applyOrderUiStateToCard(numericId);
        setModalDeleteButtonState('Project uit systeem halen', false);
        await showActiveOrderAlert('Project verwijderen mislukt. Probeer het opnieuw.', {
            title: 'Fout bij verwijderen',
            confirmText: 'Sluiten',
        });
    }
}

function bindActiveOrdersPageUi() {
    document.querySelectorAll('.mode-btn[data-build-mode]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setBuildMode(btn.getAttribute('data-build-mode'));
        });
    });

    document.querySelectorAll('[data-order-filter]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setOrderFilter(btn.getAttribute('data-order-filter'));
        });
    });

    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('modalSecondaryBtn').addEventListener('click', closeModal);
    document.getElementById('createOrderBtn')?.addEventListener('click', openCreateOrderModal);
    document.getElementById('createOrderCloseBtn')?.addEventListener('click', closeCreateOrderModal);
    document.getElementById('createOrderCancelBtn')?.addEventListener('click', closeCreateOrderModal);
    document.getElementById('createOrderForm')?.addEventListener('submit', handleCreateOrderSubmit);
    document.getElementById('createOrderModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeCreateOrderModal();
    });
    document.getElementById('claimOrderCloseBtn')?.addEventListener('click', closeClaimOrderModal);
    document.getElementById('claimOrderCancelBtn')?.addEventListener('click', closeClaimOrderModal);
    document.getElementById('claimOrderForm')?.addEventListener('submit', handleClaimOrderSubmit);
    document.getElementById('claimOrderModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeClaimOrderModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeCreateOrderModal();
            closeClaimOrderModal();
        }
    });

    document.querySelectorAll('#ordersGrid .order-card').forEach(bindDynamicOrderCard);
}

async function initializeActiveOrdersPageState() {
    await loadRemoteUiState();
    buildMode = loadBuildMode();
    setBuildMode(buildMode);
    clearDemoOrdersOnLoad();
    loadCustomOrderCards();
    restoreOrdersRuntimeFromState();
    refreshOrderSummaryCards();
    void fetchAgendaLeadOptions().catch(() => {});
}

async function bootActiveOrdersPage() {
    bindActiveOrdersPageUi();
    try {
        await initializeActiveOrdersPageState();
    } finally {
        if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === 'function') {
            window.SoftoraPremiumBoot.setShellBooting(false);
        }
    }
}

function initActiveOrdersCursor() {
    const cursor = document.querySelector('.cursor');
    const cursorDot = document.querySelector('.cursor-dot');
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const enablePointerFx = false && hasFinePointer && !prefersReducedMotion;

    function disable() {
        document.body.style.cursor = 'auto';
        if (cursor) cursor.style.display = 'none';
        if (cursorDot) cursorDot.style.display = 'none';
    }

    if (!cursor || !cursorDot || !enablePointerFx) {
        disable();
        return;
    }

    let mouseX = 0;
    let mouseY = 0;
    let cursorX = 0;
    let cursorY = 0;
    let dotX = 0;
    let dotY = 0;
    let cursorRafId = null;
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }, { passive: true });

    function animateCursor() {
        cursorX += (mouseX - cursorX) * 1;
        cursorY += (mouseY - cursorY) * 1;
        cursor.style.left = cursorX + 'px';
        cursor.style.top = cursorY + 'px';
        dotX += (mouseX - dotX) * 1;
        dotY += (mouseY - dotY) * 1;
        cursorDot.style.left = dotX + 'px';
        cursorDot.style.top = dotY + 'px';
        cursorRafId = requestAnimationFrame(animateCursor);
    }
    cursorRafId = requestAnimationFrame(animateCursor);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (cursorRafId) cancelAnimationFrame(cursorRafId);
            cursorRafId = null;
        } else if (!cursorRafId) {
            cursorRafId = requestAnimationFrame(animateCursor);
        }
    });

    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('.magnetic')) cursor.classList.add('hover');
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('.magnetic')) cursor.classList.remove('hover');
    });

    window.addEventListener('error', disable);
}

void bootActiveOrdersPage();
initActiveOrdersCursor();

window.addEventListener('pagehide', () => {
    void flushRemoteUiStateSave();
});
