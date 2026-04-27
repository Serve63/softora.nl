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

