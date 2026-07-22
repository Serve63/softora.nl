(function initDossierPage() {
    const REMOTE_SCOPE = 'premium_active_orders';
    const CUSTOM_ORDERS_KEY = 'softora_custom_orders_premium_v1';
    const ORDER_RUNTIME_KEY = 'softora_order_runtime_premium_v1';
    const DOSSIER_CACHE_KEY = 'softora_order_dossier_cache_v1';
    const DOSSIER_LAYOUT_SCHEMA_VERSION = '20260417a';
    const DOSSIER_INLINE_EDIT_VERSION = '20260629a';
    const DOSSIER_AUTOSAVE_DELAY_MS = 850;
    const DOSSIER_LOADING_TITLE = 'uitvoerdossier laden';
    const root = document.getElementById('dossierRoot');
    const editorState = {
        baseData: null,
        orderId: 0,
        dossierFingerprint: '',
        cacheRawValue: '',
        layoutResponse: null,
        layout: null,
        dirty: false,
        revision: 0,
        lastSavedRevision: 0,
        saveTimer: null,
        saveInFlight: false,
        saveQueued: false,
    };

    function esc(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getStateChunkMetaKey(baseKey) { return `${String(baseKey || '').trim()}_chunks_v1`; }
    function getStateChunkPrefix(baseKey) { return `${String(baseKey || '').trim()}_chunk_`; }
    function readChunkedStateValue(values, baseKey) { const stateValues = values && typeof values === 'object' ? values : {}; const normalizedKey = String(baseKey || '').trim(); const fallback = typeof stateValues[normalizedKey] === 'string' ? stateValues[normalizedKey] : ''; const metaRaw = String(stateValues[getStateChunkMetaKey(normalizedKey)] || '').trim(); if (!metaRaw) return fallback; try { const meta = JSON.parse(metaRaw); const count = Math.max(0, Math.min(200, Number(meta && meta.count) || 0)); if (!count) return fallback; const prefix = getStateChunkPrefix(normalizedKey); const chunks = []; for (let index = 0; index < count; index += 1) { const chunk = stateValues[prefix + index]; if (typeof chunk !== 'string') return fallback; chunks.push(chunk); } return chunks.join('') || fallback; } catch (_) { return fallback; } }
    function safeJsonParse(value, fallback) { try { const parsed = JSON.parse(String(value || '')); return parsed === null || parsed === undefined ? fallback : parsed; } catch (_) { return fallback; } }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function clipText(value, maxChars) {
        const text = String(value || '').trim();
        if (!text || !Number.isFinite(maxChars) || maxChars <= 0) return '';
        if (text.length <= maxChars) return text;
        return text.slice(0, Math.max(0, maxChars)).trim();
    }

    function formatDateTime(value) {
        const raw = String(value || '').trim();
        if (!raw) return '—';
        const asNumber = Number(raw);
        if (Number.isFinite(asNumber) && asNumber > 0) {
            const d = new Date(asNumber);
            return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('nl-NL');
        }
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('nl-NL');
    }
    function formatDateOnly(value) {
        const raw = String(value || '').trim();
        if (!raw) return new Date().toLocaleDateString('nl-NL');
        const asNumber = Number(raw);
        if (Number.isFinite(asNumber) && asNumber > 0) {
            const d = new Date(asNumber);
            return Number.isNaN(d.getTime()) ? new Date().toLocaleDateString('nl-NL') : d.toLocaleDateString('nl-NL');
        }
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? new Date().toLocaleDateString('nl-NL') : d.toLocaleDateString('nl-NL');
    }
    async function fetchUiStateValues(scope) {
        if (window.SoftoraUiStateClient?.get) {
            const data = await window.SoftoraUiStateClient.get(scope);
            return data?.ok !== false && data?.values && typeof data.values === 'object' ? data.values : {};
        }
        const encoded = encodeURIComponent(String(scope || ''));
        const endpoints = [
            `/api/ui-state-get?scope=${encoded}`,
            `/api/ui-state/${encoded}`
        ];
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, { cache: 'no-store' });
                if (!response.ok) continue;
                const data = await response.json().catch(() => ({}));
                if (data?.ok && data?.values && typeof data.values === 'object') {
                    return data.values;
                }
            } catch (_) {
                // try next endpoint
            }
        }
        return {};
    }
    async function fetchUiStateSetWithFallback(scope, body) {
        if (window.SoftoraUiStateClient?.set) return window.SoftoraUiStateClient.set(scope, body);
        const encoded = encodeURIComponent(String(scope || ''));
        const endpoints = [
            `/api/ui-state-set?scope=${encoded}`,
            `/api/ui-state/${encoded}`
        ];
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {})
                });
                if (!response.ok) continue;
                const data = await response.json().catch(() => ({}));
                if (data?.ok) return data;
            } catch (_) {
                // try next endpoint
            }
        }
        return null;
    }

    function getOrderIdFromQuery() {
        const params = new URLSearchParams(window.location.search || '');
        const id = Number(params.get('id'));
        return Number.isFinite(id) && id > 0 ? id : 0;
    }

    function shouldAutoPrint() {
        const params = new URLSearchParams(window.location.search || '');
        return /^(1|true|yes)$/i.test(String(params.get('autoprint') || ''));
    }

    function buildDossierCacheFingerprint(baseData) {
        return JSON.stringify({
            layoutVersion: DOSSIER_LAYOUT_SCHEMA_VERSION,
            title: String(baseData?.title || '').trim(),
            company: String(baseData?.company || '').trim(),
            contact: String(baseData?.contact || '').trim(),
            domainName: String(baseData?.domainName || '').trim(),
            deliveryTime: String(baseData?.deliveryTime || '').trim(),
            claimedBy: String(baseData?.claimedBy || '').trim(),
            claimedAt: String(baseData?.claimedAt || '').trim(),
            description: String(baseData?.description || '').trim(),
            transcript: String(baseData?.transcript || '').trim(),
            sourceAppointmentLabel: String(baseData?.sourceAppointmentLabel || '').trim(),
        });
    }

    function parseDossierCacheMap(rawValue) {
        const parsed = safeJsonParse(rawValue, {});
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }

    function getCachedDossierLayoutResponse(rawValue, orderId, fingerprint) {
        const cacheMap = parseDossierCacheMap(rawValue);
        const entry = cacheMap[String(orderId)];
        if (!entry || typeof entry !== 'object') return null;

        const layoutResponse = entry.layoutResponse;
        if (!layoutResponse || typeof layoutResponse !== 'object') return null;

        const expectedFingerprint = String(fingerprint || '').trim();
        const entryFingerprint = String(entry.fingerprint || '').trim();
        if (!entryFingerprint || !expectedFingerprint || entryFingerprint !== expectedFingerprint) {
            return null;
        }
        return layoutResponse;
    }

    function buildNextDossierCacheMap(rawValue, orderId, fingerprint, layoutResponse) {
        const current = parseDossierCacheMap(rawValue);
        const next = {
            ...current,
            [String(orderId)]: {
                fingerprint: String(fingerprint || '').trim(),
                updatedAt: new Date().toISOString(),
                layoutResponse,
            },
        };
        const orderedEntries = Object.entries(next)
            .sort((a, b) => {
                const left = Date.parse(String(a?.[1]?.updatedAt || '')) || 0;
                const right = Date.parse(String(b?.[1]?.updatedAt || '')) || 0;
                return right - left;
            })
            .slice(0, 40);
        return Object.fromEntries(orderedEntries);
    }

    async function persistDossierCache(rawValue, orderId, fingerprint, layoutResponse) {
        if (!orderId || !layoutResponse || typeof layoutResponse !== 'object') return null;
        const nextCacheMap = buildNextDossierCacheMap(rawValue, orderId, fingerprint, layoutResponse);
        const saved = await fetchUiStateSetWithFallback(REMOTE_SCOPE, {
            patch: {
                [DOSSIER_CACHE_KEY]: JSON.stringify(nextCacheMap),
            },
            source: 'premium-opdracht-dossier',
            actor: 'browser',
        });
        if (saved?.ok) {
            editorState.cacheRawValue = JSON.stringify(nextCacheMap);
        }
        return saved;
    }

    function renderError(message) {
        root.innerHTML = `<div class="error">${esc(message || 'Uitvoerdossier niet gevonden.')}</div>`;
    }

    function renderLoading(title, description) {
        root.innerHTML = `
            <div class="loading loading-shell">
                <div class="loading-inner">
                    <div class="loader-visual premium-boot-spinner" aria-hidden="true">
                        <span class="softora-dossier-loader__orbit--outer" aria-hidden="true"></span>
                        <span class="softora-dossier-loader__orbit--inner" aria-hidden="true"></span>
                        <span class="softora-dossier-loader__dot" aria-hidden="true"></span>
                    </div>
                    <div class="loading-eyebrow">Uitvoerdossier</div>
                    <div class="loading-title">${esc(title || DOSSIER_LOADING_TITLE)}</div>
                    ${description ? `<p class="loading-copy">${esc(description)}</p>` : ''}
                </div>
            </div>
        `;
    }

    function buildBaseOrderData(orderId, customOrder, runtimeOrder) {
        const order = customOrder || {};
        const runtime = runtimeOrder || {};
        return {
            orderId,
            title: String(order?.title || runtime?.type || `Opdracht #${orderId}`).trim(),
            company: String(order?.clientName || runtime?.name || 'Onbekend').trim(),
            contact: String(order?.location || '').trim(),
            domainName: String(order?.domainName || '').trim(),
            deliveryTime: String(order?.deliveryTime || '').trim(),
            claimedBy: String(order?.claimedBy || runtime?.claimedBy || '').trim(),
            claimedAt: String(order?.claimedAt || runtime?.claimedAt || '').trim(),
            description: normalizeText(order?.description || runtime?.description || ''),
            transcript: normalizeText(order?.transcript || runtime?.transcript || ''),
            sourceAppointmentLabel: String(order?.sourceAppointmentLabel || runtime?.sourceAppointmentLabel || '').trim(),
        };
    }

    function buildFallbackNarrative(baseData) {
        const chunks = [];
        if (baseData.description) chunks.push(baseData.description);
        if (baseData.transcript) {
            chunks.push(baseData.description ? `Aanvullende gespreksnotities: ${baseData.transcript}` : baseData.transcript);
        }
        const narrative = normalizeText(chunks.join('\n\n'));
        if (narrative) return clipText(narrative, 5000);
        return 'Nog geen uitgebreide klantwensen vastgelegd. Neem direct contact op met de klant om ontbrekende details te verzamelen.';
    }

    function extractWebsiteStyleHintFromBaseData(baseData) {
        const blob = [
            String(baseData?.description || '').trim(),
            String(baseData?.transcript || '').trim(),
            String(baseData?.title || '').trim(),
        ]
            .filter(Boolean)
            .join('\n')
            .toLowerCase();

        const hasBlue = /\bblauw(e|we)?\b/.test(blob) || /\bblue\b/.test(blob);
        const hasWhite = /\bwit(te)?\b/.test(blob) || /\bwhite\b/.test(blob);
        if (hasBlue && hasWhite) {
            return ' in een strak blauw-wit kleurenschema';
        }
        if (hasBlue) {
            return ' met blauw als hoofdkleur in een rustig, premium palet';
        }
        if (hasWhite) {
            return ' met een lichte, frisse witte basis en premium uitstraling';
        }
        return ' met hoogwaardige typografie en een strak, professioneel premium design';
    }

    function baseDataHasUsableDomain(baseData) {
        const raw = String(baseData?.domainName || '').trim();
        if (!raw) return false;
        if (/^[\u2014\-–—]+$/u.test(raw)) return false;
        const compact = raw.replace(/\s+/g, ' ').trim().toLowerCase();
        const noise = new Set(['—', '-', 'n/a', 'na', 'nog niet opgegeven', 'onbekend', 'tbd', 'todo']);
        if (noise.has(compact)) return false;
        return true;
    }

    function buildShortOpusPrompt(baseData) {
        const company = String(baseData?.company || '').trim();
        const label = company && company !== 'Onbekend' ? company : 'de klant';
        const domainPart = baseDataHasUsableDomain(baseData)
            ? ` voor ${String(baseData.domainName).trim()}`
            : '';
        const styleHint = extractWebsiteStyleHintFromBaseData(baseData);
        return `Bouw een premium, moderne en volledig responsieve website voor ${label}${domainPart}${styleHint}; gebruik dit dossier voor inhoud, structuur en contact en zet ontbrekende onderdelen netjes als placeholder.`;
    }

    function normalizeDossierBlockTitle(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function shouldHideLegacyDossierBlockTitle(value) {
        const normalized = normalizeDossierBlockTitle(value);
        if (!normalized) return false;
        return normalized === 'uitvoerplan' ||
            normalized === 'uitvoerfocus' ||
            normalized.startsWith('ontbrekende informatie') ||
            normalized.startsWith('praktische aandachtspunten');
    }

    function normalizeDossierPairLabel(value) {
        const label = String(value || '').replace(/\s+/g, ' ').trim();
        if (!label) return '';
        const normalized = label
            .toLowerCase()
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (normalized === 'accounthouder softora' || normalized === 'softora contactpersoon') return '';
        if (normalized === 'domein' || normalized === 'oplevertijd') return '';
        if (normalized === 'adres') return 'Locatie';
        return normalized === 'geclaimd door' ? 'Aangewezen aan' : label;
    }

    function buildDefaultStatusItemsForLayout(baseData) {
        const items = [];
        const apt = String(baseData?.sourceAppointmentLabel || '').trim();
        const claimed = String(baseData?.claimedAt || '').trim();
        if (apt) items.push(`Geplande afspraak: ${apt}`);
        if (claimed) items.push(`Opdracht geclaimd op ${formatDateTime(claimed)}`);
        if (!items.length) {
            items.push('Nog geen aanvullende status of afspraken vastgelegd.');
        }
        return items;
    }

    function buildFallbackLayout(baseData) {
        const narrative = buildFallbackNarrative(baseData);
        const prompt = buildShortOpusPrompt(baseData);

        return {
            documentTitle: baseData.title || `Opdracht #${baseData.orderId}`,
            subtitle: 'Dynamisch uitvoerdossier op basis van actuele opdrachtinformatie en klantwensen.',
            opusPrompt: clipText(prompt, 22000),
            blocks: [
                {
                    kind: 'meta',
                    title: 'Projectgegevens',
                    pairs: [
                        { label: 'Bedrijf', value: baseData.company || '—' },
                        { label: 'Aangewezen aan', value: baseData.claimedBy || '—' },
                        { label: 'Locatie', value: baseData.contact || '—' },
                    ],
                },
                {
                    kind: 'text',
                    title: 'Samenvatting klantgesprek',
                    text: narrative,
                },
                {
                    kind: 'bullets',
                    title: 'Status en afspraken',
                    items: buildDefaultStatusItemsForLayout(baseData),
                },
            ],
        };
    }

    function normalizePairs(pairs) {
        if (!Array.isArray(pairs)) return [];
        return pairs
            .map((pair) => ({
                label: clipText(normalizeDossierPairLabel(pair?.label || ''), 80),
                value: clipText(String(pair?.value || '').trim(), 260),
            }))
            .filter((pair) => pair.label && pair.value)
            .slice(0, 12);
    }

    function normalizeItems(items, maxItems = 12) {
        if (!Array.isArray(items)) return [];
        return items
            .map((item) => clipText(String(item || '').trim(), 380))
            .filter(Boolean)
            .slice(0, Math.max(1, Math.min(20, Number(maxItems) || 12)));
    }

    const DOSSIER_PROJECT_PAIR_ORDER = ['bedrijf', 'aangewezen aan', 'locatie'];

    function categorizeDossierBlockForCanonical(block) {
        const kind = String(block?.kind || '').trim().toLowerCase();
        const t = normalizeDossierBlockTitle(block?.title || '');
        if (kind === 'text' && (t.includes('bouwprompt') || t.includes('website-bouw'))) {
            return 'skip';
        }
        if (kind === 'meta' && (t === 'projectkern' || t === 'projectgegevens')) {
            return 'project';
        }
        if (kind === 'meta') return 'meta_other';
        if (kind === 'text') return 'text';
        if (kind === 'bullets' || kind === 'checklist' || kind === 'steps' || kind === 'timeline') {
            return 'list';
        }
        return 'skip';
    }

    /* Houd logica gelijk met server/services/order-dossier.js (canonicalizeOrderDossierBlocks). */
    function canonicalizeDossierBlocks(blocks) {
        if (!Array.isArray(blocks) || !blocks.length) return [];

        const projectPairMap = new Map();
        const summaryParts = [];
        const statusItems = [];
        const seenStatus = new Set();

        function pushStatus(line) {
            const clipped = clipText(String(line || '').trim(), 400);
            if (!clipped) return;
            const key = clipped.toLowerCase();
            if (seenStatus.has(key)) return;
            seenStatus.add(key);
            statusItems.push(clipped);
        }

        function absorbProjectPairs(pairs) {
            const normalized = normalizePairs(pairs || []);
            for (const pair of normalized) {
                const labelRaw = String(pair?.label || '').trim();
                const value = clipText(String(pair?.value || '').trim(), 260);
                if (!labelRaw || !value) continue;
                const ln = labelRaw.toLowerCase();
                if (ln === 'contactpersoon' || ln === 'geclaimd op') {
                    pushStatus(`${labelRaw}: ${value}`);
                    continue;
                }
                let displayLabel = labelRaw;
                if (ln === 'adres') displayLabel = 'Locatie';
                const lk = displayLabel.toLowerCase();
                if (!projectPairMap.has(lk)) {
                    projectPairMap.set(lk, { label: displayLabel, value });
                }
            }
        }

        function absorbOtherMetaPairs(pairs) {
            const normalized = normalizePairs(pairs || []);
            for (const pair of normalized) {
                const label = String(pair?.label || '').trim();
                const value = clipText(String(pair?.value || '').trim(), 260);
                if (!label || !value) continue;
                pushStatus(`${label}: ${value}`);
            }
        }

        for (const block of blocks) {
            const cat = categorizeDossierBlockForCanonical(block);
            if (cat === 'skip') continue;

            if (cat === 'project') {
                absorbProjectPairs(block?.pairs || block?.items || []);
                continue;
            }
            if (cat === 'meta_other') {
                absorbOtherMetaPairs(block?.pairs || block?.items || []);
                continue;
            }
            if (cat === 'text') {
                const text = clipText(String(block?.text || block?.content || '').trim(), 5500);
                if (text) summaryParts.push(text);
                continue;
            }
            if (cat === 'list') {
                const rawItems = block?.items || block?.steps || [];
                const items = normalizeItems(rawItems, 20);
                for (const item of items) pushStatus(item);
            }
        }

        const projectPairs = [];
        for (const key of DOSSIER_PROJECT_PAIR_ORDER) {
            if (projectPairMap.has(key)) projectPairs.push(projectPairMap.get(key));
        }
        for (const [k, pair] of projectPairMap) {
            if (DOSSIER_PROJECT_PAIR_ORDER.includes(k)) continue;
            pushStatus(`${pair.label}: ${pair.value}`);
        }

        const out = [];
        if (projectPairs.length) {
            out.push({ kind: 'meta', title: 'Projectgegevens', pairs: projectPairs });
        }
        const summary = summaryParts.join('\n\n').trim();
        if (summary) {
            out.push({ kind: 'text', title: 'Samenvatting klantgesprek', text: summary });
        }
        if (statusItems.length) {
            out.push({
                kind: 'bullets',
                title: 'Status en afspraken',
                items: statusItems.slice(0, 16),
            });
        }
        return out;
    }

    function normalizeLayoutPayload(rawLayout, baseData) {
        const fallback = buildFallbackLayout(baseData);
        if (!rawLayout || typeof rawLayout !== 'object') return fallback;

        const documentTitle =
            clipText(String(rawLayout.documentTitle || rawLayout.title || fallback.documentTitle).trim(), 220) ||
            fallback.documentTitle;
        const subtitle =
            clipText(String(rawLayout.subtitle || rawLayout.lead || fallback.subtitle).trim(), 320) ||
            fallback.subtitle;
        const opusFromLayout = clipText(String(rawLayout.opusPrompt || '').trim(), 22000);
        const opusPrompt = opusFromLayout || buildShortOpusPrompt(baseData);

        const preserveEditedBlocks = rawLayout.inlineEdited === true || rawLayout.preserveBlocks === true;
        const blocks = (Array.isArray(rawLayout.blocks) ? rawLayout.blocks : [])
            .map((block) => {
                const kind = String(block?.kind || block?.type || '').trim().toLowerCase();
                const title = clipText(String(block?.title || '').trim(), 120) || 'Sectie';
                if (shouldHideLegacyDossierBlockTitle(title)) return null;

                if (kind === 'meta') {
                    const pairs = normalizePairs(block?.pairs || block?.items || []);
                    if (!pairs.length) return null;
                    return { kind: 'meta', title, pairs };
                }

                if (kind === 'bullets' || kind === 'checklist') {
                    const items = normalizeItems(block?.items || [], 12);
                    if (!items.length) return null;
                    return { kind: 'bullets', title, items };
                }

                if (kind === 'steps' || kind === 'timeline') {
                    const items = normalizeItems(block?.items || block?.steps || [], 12);
                    if (!items.length) return null;
                    return { kind: 'steps', title, items };
                }

                const text = clipText(String(block?.text || block?.content || '').trim(), 5500);
                if (!text) return null;
                return { kind: 'text', title, text };
            })
            .filter(Boolean)
            .slice(0, 10);

        const canon = preserveEditedBlocks ? blocks : canonicalizeDossierBlocks(blocks);

        return {
            documentTitle,
            subtitle,
            opusPrompt,
            inlineEdited: preserveEditedBlocks,
            blocks: canon.length ? canon : fallback.blocks,
        };
    }

    async function fetchDynamicLayoutFromAi(baseData) {
        const payload = {
            orderId: baseData.orderId,
            title: baseData.title,
            company: baseData.company,
            contact: baseData.contact,
            domainName: baseData.domainName,
            deliveryTime: baseData.deliveryTime,
            claimedBy: baseData.claimedBy,
            claimedAt: baseData.claimedAt,
            description: baseData.description,
            transcript: baseData.transcript,
            sourceAppointmentLabel: baseData.sourceAppointmentLabel,
            language: 'nl',
        };

        const endpoints = ['/api/ai/order-dossier', '/api/ai-order-dossier'];
        let lastError = '';

        for (const endpoint of endpoints) {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 90000);
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data?.ok === false) {
                    lastError = String(data?.detail || data?.error || `Serverfout (${response.status})`);
                    continue;
                }
                return data || {};
            } catch (error) {
                lastError = error?.name === 'AbortError'
                    ? 'AI dossier generatie duurde te lang.'
                    : String(error?.message || 'AI dossier generatie mislukt.');
            } finally {
                window.clearTimeout(timeoutId);
            }
        }

        throw new Error(lastError || 'AI dossier generatie mislukt.');
    }

    function cloneDossierLayout(layout) {
        return safeJsonParse(JSON.stringify(layout || {}), {});
    }

    function cleanEditableText(value, options = {}) {
        const singleLine = options.singleLine === true;
        const maxChars = Number(options.maxChars) || 1000;
        let text = String(value || '').replace(/\u00a0/g, ' ').replace(/\r/g, '\n');
        text = singleLine
            ? text.replace(/\s+/g, ' ').trim()
            : text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
        return clipText(text, maxChars);
    }

    function editableAttrs(field, attrs = {}) {
        const dataAttrs = Object.entries({ ...attrs, 'dossier-editable': '1', 'edit-field': field })
            .map(([key, value]) => `data-${esc(key)}="${esc(value)}"`)
            .join(' ');
        return `contenteditable="plaintext-only" spellcheck="true" ${dataAttrs}`;
    }

    function normalizeEditableBlocksForSave(blocks) {
        if (!Array.isArray(blocks)) return [];
        return blocks
            .map((block) => {
                const kind = String(block?.kind || '').trim().toLowerCase();
                const title = clipText(String(block?.title || '').trim(), 120) || 'Sectie';
                if (kind === 'meta') {
                    const pairs = (Array.isArray(block.pairs) ? block.pairs : [])
                        .map((pair) => ({
                            label: clipText(String(pair?.label || '').trim(), 80) || 'Veld',
                            value: clipText(String(pair?.value || '').trim(), 260),
                        }))
                        .filter((pair) => pair.label && pair.value)
                        .slice(0, 12);
                    return pairs.length ? { kind: 'meta', title, pairs } : null;
                }
                if (kind === 'bullets' || kind === 'steps') {
                    const items = (Array.isArray(block.items) ? block.items : [])
                        .map((item) => clipText(String(item || '').trim(), 380))
                        .filter(Boolean)
                        .slice(0, 20);
                    return items.length ? { kind, title, items } : null;
                }
                const text = clipText(String(block?.text || '').trim(), 5500);
                return text ? { kind: 'text', title, text } : null;
            })
            .filter(Boolean)
            .slice(0, 12);
    }

    function buildEditableLayoutResponseForSave() {
        const current = editorState.layout && typeof editorState.layout === 'object' ? editorState.layout : {};
        const base = editorState.layoutResponse && typeof editorState.layoutResponse === 'object' ? editorState.layoutResponse : {};
        const layout = {
            documentTitle: clipText(String(current.documentTitle || '').trim(), 220) || `Opdracht #${editorState.orderId || ''}`.trim(),
            subtitle: clipText(String(current.subtitle || '').trim(), 320),
            opusPrompt: clipText(String(current.opusPrompt || '').trim(), 22000),
            inlineEdited: true,
            inlineEditVersion: DOSSIER_INLINE_EDIT_VERSION,
            blocks: normalizeEditableBlocksForSave(current.blocks),
        };
        return {
            ...base,
            source: String(base.source || '').trim() || 'premium-opdracht-dossier',
            layout,
            manualEdit: {
                version: DOSSIER_INLINE_EDIT_VERSION,
                source: 'premium-opdracht-dossier',
                editedAt: new Date().toISOString(),
            },
        };
    }

    function setDossierSaveStatus(message, status) {
        const statusEl = document.getElementById('dossierSaveStatus');
        if (!statusEl) return;
        statusEl.textContent = String(message || '');
        if (status) statusEl.dataset.status = status;
        else delete statusEl.dataset.status;
    }

    function scheduleDossierSave() {
        if (editorState.saveTimer) window.clearTimeout(editorState.saveTimer);
        editorState.saveTimer = window.setTimeout(() => {
            void persistCurrentDossierEdits();
        }, DOSSIER_AUTOSAVE_DELAY_MS);
    }

    function markDossierDirty() {
        editorState.dirty = true;
        editorState.revision += 1;
        setDossierSaveStatus('Wijzigingen opslaan...', 'saving');
        scheduleDossierSave();
    }

    async function persistCurrentDossierEdits(options = {}) {
        const force = options.force === true;
        if (editorState.saveTimer) {
            window.clearTimeout(editorState.saveTimer);
            editorState.saveTimer = null;
        }
        if (!editorState.baseData || !editorState.orderId || !editorState.dossierFingerprint) return false;
        if (editorState.saveInFlight) {
            editorState.saveQueued = true;
            return false;
        }
        if (!force && !editorState.dirty) return true;

        const savingRevision = editorState.revision;
        editorState.saveInFlight = true;
        setDossierSaveStatus('Opslaan...', 'saving');
        try {
            const latestValues = await fetchUiStateValues(REMOTE_SCOPE);
            const latestRawValue = readChunkedStateValue(latestValues, DOSSIER_CACHE_KEY) || editorState.cacheRawValue;
            const layoutResponse = buildEditableLayoutResponseForSave();
            const saved = await persistDossierCache(latestRawValue, editorState.orderId, editorState.dossierFingerprint, layoutResponse);
            if (!saved?.ok) throw new Error('Dossier opslaan mislukt.');
            editorState.layoutResponse = layoutResponse;
            editorState.lastSavedRevision = savingRevision;
            if (editorState.revision === savingRevision) {
                editorState.dirty = false;
                setDossierSaveStatus('Opgeslagen', 'saved');
            } else {
                editorState.saveQueued = true;
            }
            return true;
        } catch (error) {
            console.error('[PremiumOpdrachtDossier][SaveFailed]', error);
            setDossierSaveStatus('Opslaan mislukt', 'error');
            return false;
        } finally {
            editorState.saveInFlight = false;
            if (editorState.saveQueued) {
                editorState.saveQueued = false;
                scheduleDossierSave();
            }
        }
    }

    function applyEditableElementChange(element) {
        if (!element || !editorState.layout) return false;
        const field = String(element.dataset.editField || '').trim();
        const blockIndex = Number(element.dataset.blockIndex);
        const pairIndex = Number(element.dataset.pairIndex);
        const itemIndex = Number(element.dataset.itemIndex);
        const blocks = Array.isArray(editorState.layout.blocks) ? editorState.layout.blocks : [];
        const block = Number.isFinite(blockIndex) ? blocks[blockIndex] : null;
        const text = element.innerText || element.textContent;

        if (field === 'title') {
            editorState.layout.documentTitle = cleanEditableText(text, { singleLine: true, maxChars: 220 }) || editorState.layout.documentTitle;
            return true;
        }
        if (field === 'prompt') {
            editorState.layout.opusPrompt = cleanEditableText(text, { maxChars: 22000 });
            return true;
        }
        if (!block || typeof block !== 'object') return false;

        if (field === 'sectionTitle') {
            block.title = cleanEditableText(text, { singleLine: true, maxChars: 120 }) || block.title;
            return true;
        }
        if (field === 'text') {
            block.text = cleanEditableText(text, { maxChars: 5500 });
            return true;
        }
        if (field === 'metaLabel' || field === 'metaValue') {
            const pairs = Array.isArray(block.pairs) ? block.pairs : [];
            const pair = Number.isFinite(pairIndex) ? pairs[pairIndex] : null;
            if (!pair) return false;
            if (field === 'metaLabel') {
                pair.label = cleanEditableText(text, { singleLine: true, maxChars: 80 }) || pair.label;
            } else {
                pair.value = cleanEditableText(text, { singleLine: true, maxChars: 260 });
            }
            return true;
        }
        if (field === 'item') {
            const items = Array.isArray(block.items) ? block.items : [];
            if (!Number.isFinite(itemIndex) || itemIndex < 0 || itemIndex >= items.length) return false;
            items[itemIndex] = cleanEditableText(text, { singleLine: true, maxChars: 380 });
            return true;
        }
        return false;
    }

    function focusEditable(target) {
        if (!target || !target.field) return;
        const parts = [`[data-edit-field="${target.field}"]`];
        if (Number.isFinite(Number(target.blockIndex))) parts.push(`[data-block-index="${Number(target.blockIndex)}"]`);
        if (Number.isFinite(Number(target.pairIndex))) parts.push(`[data-pair-index="${Number(target.pairIndex)}"]`);
        if (Number.isFinite(Number(target.itemIndex))) parts.push(`[data-item-index="${Number(target.itemIndex)}"]`);
        const element = root.querySelector(parts.join(''));
        if (!element) return;
        element.focus({ preventScroll: true });
        if (target.select !== false) {
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges(); selection.addRange(range);
        }
    }

    function rerenderCurrentDossier(options = {}) {
        if (!editorState.baseData) return;
        const layoutResponse = buildEditableLayoutResponseForSave();
        renderDossier(editorState.baseData, layoutResponse, { preserveDirty: true, focus: options.focus || null });
    }

    function addTextBlock() {
        if (!editorState.layout) return;
        if (!Array.isArray(editorState.layout.blocks)) editorState.layout.blocks = [];
        const blockIndex = editorState.layout.blocks.length;
        editorState.layout.blocks.push({ kind: 'text', title: 'Extra notitie', text: 'Nieuwe tekst' });
        rerenderCurrentDossier({ focus: { field: 'text', blockIndex, select: true } });
        markDossierDirty();
    }

    function insertListItemAfter(element) {
        if (!element || !editorState.layout) return;
        applyEditableElementChange(element);
        const blockIndex = Number(element.dataset.blockIndex);
        const itemIndex = Number(element.dataset.itemIndex);
        const block = Array.isArray(editorState.layout.blocks) ? editorState.layout.blocks[blockIndex] : null;
        if (!block || !Array.isArray(block.items)) return;
        const nextIndex = Math.max(0, itemIndex + 1);
        block.items.splice(nextIndex, 0, 'Nieuw punt');
        rerenderCurrentDossier({ focus: { field: 'item', blockIndex, itemIndex: nextIndex, select: true } });
        markDossierDirty();
    }

    function removeEmptyListItem(element) {
        if (!element || !editorState.layout) return false;
        const blockIndex = Number(element.dataset.blockIndex);
        const itemIndex = Number(element.dataset.itemIndex);
        const block = Array.isArray(editorState.layout.blocks) ? editorState.layout.blocks[blockIndex] : null;
        if (!block || !Array.isArray(block.items) || block.items.length <= 1) return false;
        const text = cleanEditableText(element.innerText || element.textContent, { singleLine: true, maxChars: 380 });
        if (text) return false;
        block.items.splice(itemIndex, 1);
        const focusIndex = Math.max(0, itemIndex - 1);
        rerenderCurrentDossier({ focus: { field: 'item', blockIndex, itemIndex: focusIndex, select: false } });
        markDossierDirty();
        return true;
    }

    function handleEditableKeydown(event) {
        const editable = event.target.closest?.('[data-dossier-editable="1"]');
        if (!editable) return;
        const key = String(event.key || '');
        if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 's') {
            event.preventDefault();
            applyEditableElementChange(editable);
            markDossierDirty();
            void persistCurrentDossierEdits({ force: true });
            return;
        }
        const field = String(editable.dataset.editField || '');
        if (field === 'item' && key === 'Enter') {
            event.preventDefault();
            insertListItemAfter(editable);
            return;
        }
        if (field === 'item' && key === 'Backspace' && removeEmptyListItem(editable)) {
            event.preventDefault();
            return;
        }
        const singleLineFields = new Set(['title', 'sectionTitle', 'metaLabel', 'metaValue']);
        if (singleLineFields.has(field) && key === 'Enter') {
            event.preventDefault();
            editable.blur();
        }
    }

    function bindDossierEditorEvents() {
        const page = root.querySelector('.dossier-page');
        if (!page) return;

        page.addEventListener('input', (event) => {
            const editable = event.target.closest?.('[data-dossier-editable="1"]');
            if (!editable || !applyEditableElementChange(editable)) return;
            markDossierDirty();
            syncPaperScale();
        });
        page.addEventListener('focusout', (event) => {
            const editable = event.target.closest?.('[data-dossier-editable="1"]');
            if (!editable || !applyEditableElementChange(editable)) return;
            if (editorState.dirty) scheduleDossierSave();
        });
        page.addEventListener('paste', (event) => {
            const editable = event.target.closest?.('[data-dossier-editable="1"]');
            if (!editable) return;
            event.preventDefault();
            const text = event.clipboardData?.getData('text/plain') || '';
            document.execCommand('insertText', false, text);
        });
        page.addEventListener('keydown', handleEditableKeydown);

        const addBtn = document.getElementById('addTextBlockBtn');
        if (addBtn) addBtn.addEventListener('click', addTextBlock);

        const saveBtn = document.getElementById('saveDossierBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                void persistCurrentDossierEdits({ force: true });
            });
        }

        const printBtn = document.getElementById('printBtn');
        if (printBtn) printBtn.addEventListener('click', async () => {
            await persistCurrentDossierEdits({ force: true });
            window.print();
        });
    }

    function syncPaperScale() {
        const paperShell = document.getElementById('paperShell');
        const wrap = document.getElementById('dossierRoot');
        const main = document.querySelector('.dashboard-layout .main-content');
        if (!paperShell || !wrap || !main) return;

        const clearScale = () => {
            wrap.style.transform = '';
            wrap.style.transformOrigin = '';
            wrap.style.marginBottom = '';
            paperShell.style.setProperty('--paper-scale', '1');
        };

        if (wrap.querySelector(':scope > .loading.loading-shell')) {
            clearScale();
            return;
        }

        wrap.style.transform = '';
        wrap.style.transformOrigin = '';
        wrap.style.marginBottom = '';

        const cs = window.getComputedStyle(main);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        let availW = main.clientWidth - padX;
        let availH = main.clientHeight - padY;

        if ((!availH || availH < 160) && typeof window.innerHeight === 'number') {
            const rect = main.getBoundingClientRect();
            availH = Math.max(160, window.innerHeight - rect.top - 16);
        }

        const w = wrap.scrollWidth;
        const h = wrap.scrollHeight;
        if (!w || !h || availW <= 0 || availH <= 0) {
            clearScale();
            return;
        }

        const gutter = 12;
        let s = Math.min((availW - gutter) / w, (availH - gutter) / h, 1);
        s = Math.max(0.52, s);

        if (s >= 0.998) {
            clearScale();
            return;
        }

        paperShell.style.setProperty('--paper-scale', String(s));
        wrap.style.transform = `scale(${s})`;
        wrap.style.transformOrigin = 'top center';
        wrap.style.marginBottom = `${-h * (1 - s)}px`;
    }

    function renderLayoutBlock(block, blockIndex) {
        if (!block || typeof block !== 'object') return '';
        const title = esc(block.title || 'Sectie');
        const titleAttrs = editableAttrs('sectionTitle', { 'block-index': blockIndex });

        if (block.kind === 'meta') {
            const pairs = Array.isArray(block.pairs) ? block.pairs : [];
            if (!pairs.length) return '';
            const pairHtml = pairs
                .map((pair, pairIndex) => {
                    const label = esc(pair?.label || '');
                    const value = esc(pair?.value || '');
                    if (!label || !value) return '';
                    const labelAttrs = editableAttrs('metaLabel', { 'block-index': blockIndex, 'pair-index': pairIndex });
                    const valueAttrs = editableAttrs('metaValue', { 'block-index': blockIndex, 'pair-index': pairIndex });
                    return `<div class="meta-item"><div class="meta-label" ${labelAttrs}>${label}</div><div class="meta-value" ${valueAttrs}>${value}</div></div>`;
                })
                .filter(Boolean)
                .join('');
            if (!pairHtml) return '';
            return `
                <section class="layout-block">
                    <div class="layout-block-head"><h2 class="section-title" ${titleAttrs}>${title}</h2></div>
                    <div class="meta-grid">${pairHtml}</div>
                </section>
            `;
        }

        if (block.kind === 'bullets' || block.kind === 'steps') {
            const items = Array.isArray(block.items) ? block.items : [];
            if (!items.length) return '';
            const listTag = block.kind === 'steps' ? 'ol' : 'ul';
            const listHtml = items
                .map((item, itemIndex) => {
                    const itemAttrs = editableAttrs('item', { 'block-index': blockIndex, 'item-index': itemIndex });
                    return `<li ${itemAttrs}>${esc(item)}</li>`;
                })
                .join('');
            return `
                <section class="layout-block">
                    <div class="layout-block-head"><h2 class="section-title" ${titleAttrs}>${title}</h2></div>
                    <${listTag} class="block-list">${listHtml}</${listTag}>
                </section>
            `;
        }

        const text = esc(block.text || '');
        if (!text) return '';
        const textAttrs = editableAttrs('text', { 'block-index': blockIndex });
        return `
            <section class="layout-block">
                <div class="layout-block-head"><h2 class="section-title" ${titleAttrs}>${title}</h2></div>
                <p class="block-text" ${textAttrs}>${text}</p>
            </section>
        `;
    }

    function renderDossier(baseData, layoutResponse, options = {}) {
        const orderId = Number(baseData.orderId) || 0;
        const orderDateLabel = formatDateOnly(baseData.claimedAt || Date.now());
        const layout = normalizeLayoutPayload(layoutResponse?.layout || layoutResponse || {}, baseData);
        const warning = String(layoutResponse?.warning || '').trim();
        const opusPrompt = String(layout.opusPrompt || '').trim();
        const blocksHtml = (Array.isArray(layout.blocks) ? layout.blocks : [])
            .map((block, blockIndex) => renderLayoutBlock(block, blockIndex))
            .join('');

        editorState.baseData = baseData;
        editorState.orderId = orderId;
        editorState.layoutResponse = layoutResponse;
        editorState.layout = cloneDossierLayout(layout);
        if (!options.preserveDirty) {
            editorState.dirty = false;
            editorState.revision = 0;
            editorState.lastSavedRevision = 0;
            editorState.saveQueued = false;
            setDossierSaveStatus('', '');
        }

        document.title = `Softora | Uitvoerdossier #${orderId}`;

        root.innerHTML = `
            <div class="page-toolbar screen-only" id="pageToolbar">
                <div class="toolbar-meta">
                    <div class="toolbar-status" id="dossierSaveStatus" aria-live="polite"></div>
                </div>
                <div class="toolbar-actions">
                    <button type="button" class="btn" id="saveDossierBtn">Opslaan</button>
                    <button type="button" class="btn btn-primary" id="printBtn">Download PDF</button>
                </div>
            </div>

            <div class="paper-shell" id="paperShell">
                <div class="paper-stage">
                    <article class="dossier-page">
                        <header class="brand-bar">
                            <div>
                                <div class="brand-logo">SOFTORA.NL</div>
                            </div>
                            <div class="brand-meta">
                                <div>Order #${esc(orderId)}</div>
                                <div>${esc(orderDateLabel)}</div>
                            </div>
                        </header>

                        <div class="page-body">
                            <div class="top-row">
                                <div>
                                    <div class="eyebrow">Uitvoerdossier</div>
                                    <h1 class="title" ${editableAttrs('title')}>${esc(layout.documentTitle || `Opdracht #${orderId}`)}</h1>
                                </div>
                            </div>

                            ${warning ? `<div class="warning-note">${esc(warning)}</div>` : ''}
                            ${blocksHtml}

                            <section class="layout-block">
                                <div class="layout-block-head"><h2 class="section-title">Website-bouwprompt</h2></div>
                                <pre class="prompt-box" id="opusPromptDisplay" ${editableAttrs('prompt')}>${esc(opusPrompt)}</pre>
                            </section>
                            <div class="dossier-add-row screen-only">
                                <button type="button" class="dossier-add-button" id="addTextBlockBtn" title="Tekst toevoegen" aria-label="Tekst toevoegen">+</button>
                            </div>
                        </div>
                    </article>
                </div>
            </div>
        `;

        bindDossierEditorEvents();
        syncPaperScale();
        requestAnimationFrame(() => {
            syncPaperScale();
            if (options.focus) focusEditable(options.focus);
        });
    }

    async function start() {
        const orderId = getOrderIdFromQuery();
        if (!orderId) {
            renderError('Geen geldig order-ID meegegeven.');
            return;
        }

        renderLoading(DOSSIER_LOADING_TITLE);
        const values = await fetchUiStateValues(REMOTE_SCOPE);
        const customOrders = safeJsonParse(readChunkedStateValue(values, CUSTOM_ORDERS_KEY), []);
        const runtimeMap = safeJsonParse(readChunkedStateValue(values, ORDER_RUNTIME_KEY), {});
        const customOrder = Array.isArray(customOrders)
            ? customOrders.find((item) => Number(item?.id) === orderId)
            : null;
        const runtimeOrder = runtimeMap && typeof runtimeMap === 'object'
            ? runtimeMap[String(orderId)] || null
            : null;

        if (!customOrder && !runtimeOrder) {
            renderError(`Geen dossierdata gevonden voor opdracht #${orderId}.`);
            return;
        }

        const baseData = buildBaseOrderData(orderId, customOrder, runtimeOrder);
        const dossierFingerprint = buildDossierCacheFingerprint(baseData);
        const dossierCacheRawValue = readChunkedStateValue(values, DOSSIER_CACHE_KEY);
        editorState.orderId = orderId;
        editorState.dossierFingerprint = dossierFingerprint;
        editorState.cacheRawValue = dossierCacheRawValue;
        const cachedLayoutResponse = getCachedDossierLayoutResponse(
            dossierCacheRawValue,
            orderId,
            dossierFingerprint
        );
        if (cachedLayoutResponse) {
            renderDossier(baseData, cachedLayoutResponse);
            if (shouldAutoPrint()) {
                window.setTimeout(() => {
                    window.print();
                }, 420);
            }
            return;
        }
        renderLoading(DOSSIER_LOADING_TITLE);

        let layoutResponse = null;
        try {
            layoutResponse = await fetchDynamicLayoutFromAi(baseData);
        } catch (error) {
            layoutResponse = {
                source: 'template-fallback',
                warning: `OpenAI niet bereikbaar, fallback gebruikt: ${String(error?.message || 'onbekende fout')}`,
                layout: buildFallbackLayout(baseData),
            };
        }

        renderDossier(baseData, layoutResponse);
        void persistDossierCache(dossierCacheRawValue, orderId, dossierFingerprint, layoutResponse);

        if (shouldAutoPrint()) {
            window.setTimeout(() => {
                window.print();
            }, 420);
        }
    }

    window.addEventListener('resize', syncPaperScale);
    window.addEventListener('beforeunload', () => {
        if (editorState.dirty) void persistCurrentDossierEdits({ force: true });
    });
    void start();
})();
