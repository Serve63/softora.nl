(function () {
    const pathname = (window.location.pathname || "").toLowerCase();
    const isPremiumPersonnelContext = pathname.indexOf("/premium-") !== -1;
    const personnelStorageKey = isPremiumPersonnelContext
        ? "softora_premium_personnel_theme_mode"
        : "softora_software_personnel_theme_mode";
    const publicStorageKey = "softora_premium_public_theme_mode";
    const publicFallbackStorageKey = "softora_public_theme_mode";
    const sidebarCountCacheStorageKey = "softora_sidebar_count_cache_v1";
    const root = document.documentElement;
    const themeButtons = document.querySelectorAll(".theme-switch-btn[data-theme-value]");

    window.SoftoraAI = window.SoftoraAI || {};

    if (typeof window.SoftoraAI.summarizeText !== "function") {
        window.SoftoraAI.summarizeText = async function summarizeText(input, options) {
            const opts = (typeof input === "object" && input && !Array.isArray(input))
                ? { ...input }
                : { ...(options || {}), text: input };
            const response = await fetch("/api/ai/summarize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: String(opts.text || ""),
                    style: opts.style || "medium",
                    language: opts.language || "nl",
                    maxSentences: opts.maxSentences,
                    extraInstructions: opts.extraInstructions || "",
                }),
                signal: opts.signal,
            });

            const data = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || !data || data.ok === false) {
                throw new Error(String((data && (data.detail || data.error)) || "AI samenvatting mislukt"));
            }

            return data;
        };
    }

    function releaseLoadingState() {
        root.removeAttribute("data-personnel-loading");
    }

    let loadingStateReleased = false;
    function scheduleLoadingStateRelease() {
        if (loadingStateReleased) return;
        loadingStateReleased = true;
        requestAnimationFrame(releaseLoadingState);
    }

    if (document.readyState === "interactive" || document.readyState === "complete") {
        scheduleLoadingStateRelease();
    } else {
        document.addEventListener("DOMContentLoaded", scheduleLoadingStateRelease, { once: true });
    }

    window.addEventListener("load", scheduleLoadingStateRelease, { once: true });

    function initSoftoraDialogs() {
        if (window.SoftoraDialogs && typeof window.SoftoraDialogs.confirm === "function") {
            return;
        }

        let dialogQueue = Promise.resolve();
        const dialogRootId = "softora-dialog-root";
        const dialogStyleId = "softora-dialog-style";

        function ensureDialogStyles() {
            if (document.getElementById(dialogStyleId)) return;
            const styleEl = document.createElement("style");
            styleEl.id = dialogStyleId;
            styleEl.textContent = `
.softora-dialog-layer {
    position: fixed;
    inset: 0;
    z-index: 14000;
    display: grid;
    place-items: center;
    padding: 1rem;
}

.softora-dialog-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(11, 12, 20, 0.58);
    backdrop-filter: blur(2px);
}

.softora-dialog-card {
    position: relative;
    width: min(480px, 100%);
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.3);
    padding: 1rem;
    display: grid;
    gap: 0.85rem;
}

.softora-dialog-title {
    margin: 0;
    font-family: 'Oswald', sans-serif;
    font-size: 1.12rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.1;
}

.softora-dialog-message {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.98rem;
    line-height: 1.45;
    white-space: pre-wrap;
}

.softora-dialog-input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-primary);
    color: var(--text-primary);
    padding: 0.7rem 0.78rem;
    font-size: 0.98rem;
    line-height: 1.2;
    outline: none;
}

.softora-dialog-input:focus {
    border-color: rgba(139, 34, 82, 0.5);
    box-shadow: 0 0 0 2px rgba(139, 34, 82, 0.18);
}

.softora-dialog-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
}

.softora-dialog-btn {
    appearance: none;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-primary);
    min-height: 40px;
    padding: 0.55rem 0.9rem;
    font-family: 'Oswald', sans-serif;
    font-size: 0.88rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
}

.softora-dialog-btn:hover {
    border-color: rgba(139, 34, 82, 0.4);
    color: var(--text-primary);
}

.softora-dialog-btn.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
}

.softora-dialog-btn.primary:hover {
    background: var(--accent-dark);
}
`;
            document.head.appendChild(styleEl);
        }

        function ensureDialogRoot() {
            let rootEl = document.getElementById(dialogRootId);
            if (rootEl) return rootEl;
            rootEl = document.createElement("div");
            rootEl.id = dialogRootId;
            document.body.appendChild(rootEl);
            return rootEl;
        }

        function runDialogInQueue(run) {
            const next = dialogQueue
                .catch(function () {
                    /* ignore previous dialog errors */
                })
                .then(run);
            dialogQueue = next;
            return next;
        }

        function escapeHtml(value) {
            return String(value || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        function openDialog(config) {
            const mode = String(config && config.mode ? config.mode : "alert");
            const title = String(config && config.title ? config.title : "Melding");
            const message = String(config && config.message ? config.message : "");
            const confirmText = String(config && config.confirmText ? config.confirmText : "OK");
            const cancelText = String(config && config.cancelText ? config.cancelText : "Annuleren");
            const defaultValue = String(config && config.defaultValue ? config.defaultValue : "");
            const canCancel = mode !== "alert";
            const isPrompt = mode === "prompt";

            return runDialogInQueue(function () {
                return new Promise(function (resolve) {
                    ensureDialogStyles();
                    const rootEl = ensureDialogRoot();
                    const layer = document.createElement("div");
                    layer.className = "softora-dialog-layer";
                    const safeTitle = escapeHtml(title);
                    const safeMessage = escapeHtml(message);
                    const safeDefaultValue = escapeHtml(defaultValue);
                    const safeConfirmText = escapeHtml(confirmText);
                    const safeCancelText = escapeHtml(cancelText);
                    layer.innerHTML = [
                        '<div class="softora-dialog-backdrop"></div>',
                        `<div class="softora-dialog-card" role="dialog" aria-modal="true" aria-label="${safeTitle}">`,
                        `  <h3 class="softora-dialog-title">${safeTitle}</h3>`,
                        `  <p class="softora-dialog-message">${safeMessage}</p>`,
                        isPrompt ? `  <input class="softora-dialog-input" type="text" value="${safeDefaultValue}">` : "",
                        '  <div class="softora-dialog-actions">',
                        canCancel ? `    <button type="button" class="softora-dialog-btn" data-dialog-cancel>${safeCancelText}</button>` : "",
                        `    <button type="button" class="softora-dialog-btn primary" data-dialog-confirm>${safeConfirmText}</button>`,
                        "  </div>",
                        "</div>",
                    ].join("");
                    rootEl.appendChild(layer);

                    const backdrop = layer.querySelector(".softora-dialog-backdrop");
                    const confirmBtn = layer.querySelector("[data-dialog-confirm]");
                    const cancelBtn = layer.querySelector("[data-dialog-cancel]");
                    const inputEl = layer.querySelector(".softora-dialog-input");
                    const previouslyFocused = document.activeElement;
                    let closed = false;

                    function cleanup() {
                        document.removeEventListener("keydown", onKeyDown, true);
                        if (layer.parentNode) {
                            layer.parentNode.removeChild(layer);
                        }
                        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                            previouslyFocused.focus();
                        }
                    }

                    function closeWith(result) {
                        if (closed) return;
                        closed = true;
                        cleanup();
                        resolve(result);
                    }

                    function onKeyDown(event) {
                        if (event.key === "Escape" && canCancel) {
                            event.preventDefault();
                            closeWith(isPrompt ? null : false);
                            return;
                        }
                        if (event.key === "Enter" && isPrompt && document.activeElement === inputEl) {
                            event.preventDefault();
                            closeWith(String(inputEl.value || ""));
                        }
                    }

                    document.addEventListener("keydown", onKeyDown, true);
                    if (backdrop && canCancel) {
                        backdrop.addEventListener("click", function () {
                            closeWith(isPrompt ? null : false);
                        });
                    }
                    if (cancelBtn) {
                        cancelBtn.addEventListener("click", function () {
                            closeWith(isPrompt ? null : false);
                        });
                    }
                    if (confirmBtn) {
                        confirmBtn.addEventListener("click", function () {
                            if (isPrompt) {
                                closeWith(String(inputEl ? inputEl.value : ""));
                                return;
                            }
                            closeWith(true);
                        });
                    }

                    if (isPrompt && inputEl) {
                        requestAnimationFrame(function () {
                            inputEl.focus();
                            inputEl.select();
                        });
                    } else if (confirmBtn) {
                        requestAnimationFrame(function () {
                            confirmBtn.focus();
                        });
                    }
                });
            });
        }

        window.SoftoraDialogs = {
            alert: function alertDialog(message, options) {
                const opts = options && typeof options === "object" ? options : {};
                return openDialog({
                    mode: "alert",
                    title: opts.title || "Melding",
                    message: String(message || ""),
                    confirmText: opts.confirmText || "Sluiten",
                }).then(function () {
                    return undefined;
                });
            },
            confirm: function confirmDialog(message, options) {
                const opts = options && typeof options === "object" ? options : {};
                return openDialog({
                    mode: "confirm",
                    title: opts.title || "Bevestigen",
                    message: String(message || ""),
                    confirmText: opts.confirmText || "Ja",
                    cancelText: opts.cancelText || "Annuleren",
                }).then(function (result) {
                    return Boolean(result);
                });
            },
            prompt: function promptDialog(message, defaultValue, options) {
                const opts = options && typeof options === "object" ? options : {};
                return openDialog({
                    mode: "prompt",
                    title: opts.title || "Invoer",
                    message: String(message || ""),
                    defaultValue: String(defaultValue || ""),
                    confirmText: opts.confirmText || "Opslaan",
                    cancelText: opts.cancelText || "Annuleren",
                }).then(function (result) {
                    if (result === null) return null;
                    return String(result);
                });
            },
        };
    }

    function getSidebarActiveKey(path) {
        const p = String(path || "").toLowerCase();
        if (
            p.indexOf("/premium-actieve-opdrachten") === 0 ||
            p.indexOf("/premium-opdracht-preview") === 0 ||
            p.indexOf("/premium-opdracht-dossier") === 0
        ) {
            return "active_orders";
        }
        if (p.indexOf("/premium-personeel-agenda") === 0) return "agenda";
        if (p.indexOf("/premium-ai-coldmailing") === 0) return "leads";
        if (p.indexOf("/premium-ai-lead-generator") === 0) return "coldcalling";
        if (p.indexOf("/premium-klanten") === 0) return "customers";
        if (p.indexOf("/premium-seo") === 0 || p.indexOf("/premium-seo-crm-system") === 0) return "seo";
        if (p.indexOf("/premium-pakketten") === 0) return "packages";
        if (p.indexOf("/premium-pdfs") === 0) return "pdfs";
        if (p.indexOf("/premium-instellingen") === 0) return "settings";
        if (p.indexOf("/premium-financiele-kosten") === 0 || p.indexOf("/premium-maandelijkse-kosten") === 0) {
            return "monthly_costs";
        }
        if (p.indexOf("/premium-analytics") === 0) return "analytics";
        return "dashboard";
    }

    function renderSidebarLink(link, activeKey) {
        const isActive = link.key === activeKey;
        const classes = `sidebar-link magnetic${isActive ? " active" : ""}`;
        const labelHtml = `<span class="sidebar-link-text">${link.label}</span>`;
        const hasCountBadge = link.key === "leads";
        const countBadgeHtml = hasCountBadge
            ? `<span class="sidebar-notification-badge" data-sidebar-count-key="${link.key}" hidden>0</span>`
            : "";
        return `<a href="${link.href}" class="${classes}">${link.icon}${labelHtml}${countBadgeHtml}</a>`;
    }

    function buildUnifiedPremiumSidebarHtml(activeKey) {
        const overviewLinks = [
            {
                key: "dashboard",
                href: "/premium-personeel-dashboard",
                label: "Dashboard",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>',
            },
            {
                key: "active_orders",
                href: "/premium-actieve-opdrachten",
                label: "Actieve Opdrachten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6M9 16h6M9 8h6"></path><path stroke-linecap="round" stroke-linejoin="round" d="M7 20h10a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>',
            },
            {
                key: "agenda",
                href: "/premium-personeel-agenda",
                label: "Agenda",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 2v2m8-2v2M3 8h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"></path></svg>',
            },
            {
                key: "leads",
                href: "/premium-ai-coldmailing",
                label: "Leads",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2.8c.2 2.3-1 3.6-2.2 4.9-1.1 1.2-2.2 2.5-2.2 4.6a4.4 4.4 0 1 0 8.8 0c0-2.4-1.4-3.8-2.7-5.1-1.1-1.1-2.1-2.1-1.7-4.4Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M12 9.6c.1 1.2-.5 1.9-1.1 2.5-.5.6-1 1.1-1 2a2.1 2.1 0 1 0 4.2 0c0-1-.6-1.7-1.2-2.3-.5-.5-.9-1-.9-2.2Z"></path></svg>',
            },
            {
                key: "coldcalling",
                href: "/premium-ai-lead-generator",
                label: "Coldcalling",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5.5 4.25h2.214c.498 0 .933.334 1.062.815l1.146 4.289a1.125 1.125 0 0 1-.418 1.171l-1.33.997a14.34 14.34 0 0 0 4.304 4.304l.997-1.33a1.125 1.125 0 0 1 1.171-.418l4.289 1.146c.481.129.815.564.815 1.062V18.5a1.75 1.75 0 0 1-1.75 1.75h-1C9.88 20.25 3.75 14.12 3.75 6.5v-.5A1.75 1.75 0 0 1 5.5 4.25Z"></path></svg>',
            },
        ];

        const managementLinks = [
            {
                key: "customers",
                href: "/premium-klanten",
                label: "Klanten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>',
            },
            {
                key: "seo",
                href: "/premium-seo",
                label: "SEO",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"></circle><path stroke-linecap="round" stroke-linejoin="round" d="m20 20-3.5-3.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M8.5 11.5l1.7 1.7L13.6 9.8"></path></svg>',
            },
            {
                key: "packages",
                href: "/premium-pakketten",
                label: "Pakketten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5h13.5A1.5 1.5 0 0 1 20.25 9v6a1.5 1.5 0 0 1-1.5 1.5H5.25A1.5 1.5 0 0 1 3.75 15V9a1.5 1.5 0 0 1 1.5-1.5Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 12h2.25m4.5 0h2.25M9.75 9.75v4.5"></path></svg>',
            },
            {
                key: "pdfs",
                href: "/premium-pdfs",
                label: "PDF'S",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 3h6L19.5 9v10.5A1.5 1.5 0 0 1 18 21H7.5A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 3V9H19.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M9 13.5h6M9 16.5h6"></path></svg>',
            },
        ];

        const extraLinks = [
            {
                key: "monthly_costs",
                href: "/premium-maandelijkse-kosten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h16.5v13.5H3.75z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M8 13.5h4m-4 2.5h6"></path></svg>',
                label: "Maandelijkse kosten",
            },
            {
                key: "analytics",
                href: "/premium-analytics",
                label: "Google analytics",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 19.5h16"></path><rect x="6" y="11" width="2.5" height="6.5" rx="0.5"></rect><rect x="10.75" y="8" width="2.5" height="9.5" rx="0.5"></rect><rect x="15.5" y="5" width="2.5" height="12.5" rx="0.5"></rect></svg>',
            },
            {
                key: "settings",
                href: "/premium-instellingen",
                label: "Instellingen",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h9m3 0h4M13 6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM4 12h3m3 0h10M7 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM4 18h11m3 0h2M15 18a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z"></path></svg>',
            },
        ];

        return [
            '<a href="/premium-website" class="sidebar-logo magnetic">Softora.nl</a>',
            '<nav class="sidebar-nav">',
            '  <div class="sidebar-section sidebar-flow-section">',
            '    <div class="sidebar-section-label">Overzicht</div>',
            overviewLinks.map(function (link) { return renderSidebarLink(link, activeKey); }).join(""),
            "  </div>",
            '  <div class="sidebar-section">',
            '    <div class="sidebar-section-label">Beheer</div>',
            managementLinks.map(function (link) { return renderSidebarLink(link, activeKey); }).join(""),
            "  </div>",
            '  <div class="sidebar-section">',
            '    <div class="sidebar-section-label">Extra</div>',
            extraLinks.map(function (link) { return renderSidebarLink(link, activeKey); }).join(""),
            "  </div>",
            "</nav>",
            '<div class="sidebar-footer">',
            '  <div class="sidebar-user">',
            '    <div class="sidebar-avatar">SP</div>',
            '    <div class="sidebar-user-info">',
            '      <div class="sidebar-user-name">Softora Premium</div>',
            '      <div class="sidebar-user-role">Administrator</div>',
            "    </div>",
            '    <a href="/premium-personeel-login" class="logout-btn magnetic" title="Uitloggen" aria-label="Uitloggen">',
            '      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>',
            "    </a>",
            "  </div>",
            "</div>",
        ].join("");
    }

    function applyUnifiedPremiumSidebar() {
        if (!isPremiumPersonnelContext) return;
        const sidebar = document.querySelector(".sidebar");
        if (!sidebar) return;
        const activeKey = getSidebarActiveKey(pathname);
        sidebar.innerHTML = buildUnifiedPremiumSidebarHtml(activeKey);
        queueSidebarFitLayout();
    }

    function getSidebarViewportFitClass() {
        if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
            return "";
        }
        const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);
        if (viewportHeight > 0 && viewportHeight <= 820) return "sidebar-fit-tight";
        if (viewportHeight > 0 && viewportHeight <= 980) return "sidebar-fit-compact";
        return "";
    }

    function applySidebarFitLayout() {
        if (!isPremiumPersonnelContext) return;
        const sidebar = document.querySelector(".sidebar");
        if (!sidebar) return;

        sidebar.classList.remove("sidebar-fit-compact", "sidebar-fit-tight");
        const fitClass = getSidebarViewportFitClass();
        if (!fitClass) return;
        sidebar.classList.add(fitClass);
    }

    let sidebarFitRaf = 0;
    function queueSidebarFitLayout() {
        if (sidebarFitRaf) {
            cancelAnimationFrame(sidebarFitRaf);
        }
        sidebarFitRaf = requestAnimationFrame(function () {
            sidebarFitRaf = 0;
            applySidebarFitLayout();
        });
    }

    function normalizeLeadFieldForCount(value) {
        return String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
    }

    function normalizeLeadRowForCount(item) {
        return {
            company: String((item && item.company) || "Onbekende lead").trim(),
            contact: String((item && item.contact) || "").trim(),
            phone: String((item && item.phone) || "").trim(),
            date: String((item && item.date) || "").trim(),
            time: String((item && item.time) || "").trim(),
        };
    }

    function dedupeLeadRowsForCount(rows) {
        const map = new Map();
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
            const key = [
                normalizeLeadFieldForCount(row.company),
                normalizeLeadFieldForCount(row.contact),
                normalizeLeadFieldForCount(row.phone),
                normalizeLeadFieldForCount(row.date),
                normalizeLeadFieldForCount(row.time),
            ].join("|");
            if (!map.has(key)) map.set(key, row);
        });
        return Array.from(map.values());
    }

    async function fetchJsonNoStore(url) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) return null;
            return await response.json().catch(function () {
                return null;
            });
        } catch (error) {
            return null;
        }
    }

    function getSidebarCountBadge(countKey) {
        return document.querySelector(`[data-sidebar-count-key="${String(countKey || "").trim()}"]`);
    }

    function readSidebarCountCache() {
        try {
            const raw = localStorage.getItem(sidebarCountCacheStorageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
            return parsed;
        } catch (error) {
            return {};
        }
    }

    function writeSidebarCountCache(countKey, count) {
        if (!Number.isFinite(count) || count < 0) return;
        try {
            const cache = readSidebarCountCache();
            cache[String(countKey || "").trim()] = {
                count: Math.max(0, Math.floor(count)),
                updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(sidebarCountCacheStorageKey, JSON.stringify(cache));
        } catch (error) {
            /* ignore storage errors */
        }
    }

    function readCachedSidebarCount(countKey) {
        const key = String(countKey || "").trim();
        if (!key) return null;
        const cache = readSidebarCountCache();
        const entry = cache[key];
        const value = Number(entry && entry.count);
        if (!Number.isFinite(value) || value < 0) return null;
        return Math.floor(value);
    }

    function paintSidebarCount(countKey, count, labels) {
        const badge = getSidebarCountBadge(countKey);
        if (!badge) return;
        if (!Number.isFinite(count) || count < 0) {
            badge.hidden = true;
            return;
        }
        const hideWhenZero = !labels || labels.showZero !== true;
        if (count === 0 && hideWhenZero) {
            badge.hidden = true;
            badge.dataset.countZero = "1";
            badge.textContent = "0";
            writeSidebarCountCache(countKey, 0);
            queueSidebarFitLayout();
            return;
        }
        badge.hidden = false;
        badge.dataset.countZero = count === 0 ? "1" : "0";
        badge.textContent = count > 99 ? "99+" : String(count);
        const singular = String(labels && labels.singular ? labels.singular : "item");
        const plural = String(labels && labels.plural ? labels.plural : `${singular}s`);
        badge.title = `${count} ${count === 1 ? singular : plural}`;
        badge.setAttribute("aria-label", badge.title);
        writeSidebarCountCache(countKey, count);
        queueSidebarFitLayout();
    }

    async function refreshSidebarLeadsCount() {
        const badge = getSidebarCountBadge("leads");
        if (!badge) return;
        const cachedLeadCount = readCachedSidebarCount("leads");

        const quickCountData = await fetchJsonNoStore("/api/agenda/confirmation-tasks?quick=1&countOnly=1");
        const quickTotal = Number(quickCountData && quickCountData.count);
        if (Number.isFinite(quickTotal) && quickTotal > 0) {
            paintSidebarCount("leads", quickTotal, { singular: "open lead", plural: "open leads" });
            return;
        }

        const tasksData = await fetchJsonNoStore("/api/agenda/confirmation-tasks?limit=400");
        if (!tasksData) {
            if (Number.isFinite(cachedLeadCount) && cachedLeadCount >= 0) {
                paintSidebarCount("leads", cachedLeadCount, { singular: "open lead", plural: "open leads" });
                return;
            }
            paintSidebarCount("leads", null);
            return;
        }

        const pendingRows = Array.isArray(tasksData && tasksData.tasks)
            ? tasksData.tasks.map(normalizeLeadRowForCount)
            : [];
        const total = dedupeLeadRowsForCount(pendingRows).length;
        paintSidebarCount("leads", total, { singular: "open lead", plural: "open leads" });
    }

    async function refreshSidebarAgendaCount() {
        const badge = getSidebarCountBadge("agenda");
        if (!badge) return;

        const appointmentsData = await fetchJsonNoStore("/api/agenda/appointments?limit=400");
        if (!appointmentsData) {
            paintSidebarCount("agenda", null);
            return;
        }

        const rows = Array.isArray(appointmentsData && appointmentsData.appointments)
            ? appointmentsData.appointments.map(normalizeLeadRowForCount)
            : [];
        const total = dedupeLeadRowsForCount(rows).length;
        paintSidebarCount("agenda", total, { singular: "afspraak", plural: "afspraken" });
    }

    function parseJsonMaybe(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === "object") return value;
        const raw = String(value || "").trim();
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function getActiveOrdersCountFromUiValues(values) {
        const source = values && typeof values === "object" ? values : {};
        const customRaw = parseJsonMaybe(source.softora_custom_orders_premium_v1);
        const runtimeRaw = parseJsonMaybe(source.softora_order_runtime_premium_v1);
        const runtimeMap = runtimeRaw && typeof runtimeRaw === "object" && !Array.isArray(runtimeRaw)
            ? runtimeRaw
            : {};

        function normalizeOrderStatusForSidebar(value) {
            const key = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
            if (key === "actief" || key === "active" || key === "open" || key === "openstaand") return "actief";
            if (key === "bezig" || key === "inbehandeling" || key === "inprogress" || key === "progress") return "bezig";
            if (key === "klaar" || key === "gebouwd" || key === "done") return "klaar";
            if (key === "betaald" || key === "paid") return "betaald";
            return "wacht";
        }

        function resolveOrderUiForSidebar(orderLike) {
            const pct = Math.max(0, Math.min(100, Number(orderLike && orderLike.progressPct) || 0));
            const paidAt = String((orderLike && orderLike.paidAt) || "").trim();
            const fallbackStatus = pct >= 100 ? "klaar" : pct > 0 ? "bezig" : "wacht";
            const baseStatus = normalizeOrderStatusForSidebar(
                (orderLike && (orderLike.statusKey || orderLike.status)) || fallbackStatus
            );
            const isBuilt = baseStatus === "klaar" || baseStatus === "betaald" || pct >= 100;
            const isPaid = Boolean(paidAt) && isBuilt;
            const status = isPaid ? "betaald" : (isBuilt ? "klaar" : baseStatus);
            return {
                status: status,
                isPaid: isPaid,
            };
        }

        function isValidCustomOrderForSidebar(item) {
            const id = Number(item && item.id);
            const amount = Number(item && item.amount);
            const clientName = String((item && item.clientName) || "").trim();
            const title = String((item && item.title) || "").trim();
            const description = String((item && item.description) || "").trim();
            if (!Number.isFinite(id) || id <= 0) return false;
            if (!Number.isFinite(amount) || amount <= 0) return false;
            if (!clientName || !title || !description) return false;
            return true;
        }

        const validCustomOrders = Array.isArray(customRaw)
            ? customRaw.filter(isValidCustomOrderForSidebar)
            : [];

        return validCustomOrders.reduce(function (count, item) {
            const id = Number(item && item.id);
            const runtime = runtimeMap[String(id)] || {};
            const merged = {
                status: String(runtime.statusKey || (item && item.status) || "").trim(),
                statusKey: String(runtime.statusKey || (item && item.status) || "").trim(),
                progressPct: Number(runtime.progressPct),
                paidAt: String(runtime.paidAt || (item && item.paidAt) || "").trim(),
            };
            const ui = resolveOrderUiForSidebar(merged);
            return count + (ui.isPaid ? 0 : 1);
        }, 0);
    }

    async function fetchActiveOrdersUiValues() {
        const scope = "premium_active_orders";
        const encodedScope = encodeURIComponent(scope);
        const responses = await Promise.all([
            fetchJsonNoStore(`/api/ui-state-get?scope=${encodedScope}`),
            fetchJsonNoStore(`/api/ui-state/${encodedScope}`),
        ]);

        for (let i = 0; i < responses.length; i += 1) {
            const payload = responses[i];
            if (!payload || payload.ok === false || typeof payload !== "object") continue;
            if (payload.values && typeof payload.values === "object") return payload.values;
        }

        return null;
    }

    async function refreshSidebarActiveOrdersCount() {
        const badge = getSidebarCountBadge("active_orders");
        if (!badge) return;

        const remoteValues = await fetchActiveOrdersUiValues();
        if (remoteValues) {
            const total = getActiveOrdersCountFromUiValues(remoteValues);
            paintSidebarCount("active_orders", total, {
                singular: "actieve opdracht",
                plural: "actieve opdrachten",
            });
            return;
        }

        let localValues = null;
        try {
            localValues = {
                softora_custom_orders_premium_v1: localStorage.getItem("softora_custom_orders_premium_v1"),
                softora_order_runtime_premium_v1: localStorage.getItem("softora_order_runtime_premium_v1"),
            };
        } catch (error) {
            localValues = null;
        }

        if (!localValues) {
            paintSidebarCount("active_orders", null);
            return;
        }

        const total = getActiveOrdersCountFromUiValues(localValues);
        paintSidebarCount("active_orders", total, {
            singular: "actieve opdracht",
            plural: "actieve opdrachten",
        });
    }

    async function refreshSidebarNotificationCounts() {
        await Promise.all([
            refreshSidebarActiveOrdersCount(),
            refreshSidebarAgendaCount(),
            refreshSidebarLeadsCount(),
        ]);
    }

    function initSidebarNotificationCounts() {
        if (!isPremiumPersonnelContext) return;
        if (!document.querySelector("[data-sidebar-count-key]")) return;
        const cachedLeadCount = readCachedSidebarCount("leads");
        if (Number.isFinite(cachedLeadCount) && cachedLeadCount >= 0) {
            paintSidebarCount("leads", cachedLeadCount, { singular: "open lead", plural: "open leads" });
        }
        refreshSidebarNotificationCounts();
        window.setInterval(refreshSidebarNotificationCounts, 45000);
    }

    function forceLightTheme() {
        root.setAttribute("data-theme-mode", "light");
        root.setAttribute("data-theme", "light");

        try {
            localStorage.setItem(personnelStorageKey, "light");
        } catch (error) {
            /* ignore storage errors */
        }

        if (isPremiumPersonnelContext) {
            try {
                localStorage.setItem(publicStorageKey, "light");
                localStorage.setItem(publicFallbackStorageKey, "light");
            } catch (error) {
                /* ignore storage errors */
            }
        }
    }

    function syncThemeButtonsToLight() {
        themeButtons.forEach(function (button) {
            const value = String(button.dataset.themeValue || "").toLowerCase();
            if (value === "dark") {
                button.remove();
                return;
            }

            const isLight = value === "light";
            button.classList.toggle("is-active", isLight);
            button.setAttribute("aria-pressed", isLight ? "true" : "false");
            button.addEventListener("click", function () {
                forceLightTheme();
            });
        });
    }

    window.SoftoraPersonnelTheme = window.SoftoraPersonnelTheme || {};
    window.SoftoraPersonnelTheme.getMode = function getMode() {
        return "light";
    };

    window.SoftoraPersonnelTheme.applyMode = function applyMode() {
        forceLightTheme();
        return Promise.resolve(true);
    };
    window.SoftoraPersonnelTheme.refreshSidebarLeadsCount = refreshSidebarLeadsCount;
    window.SoftoraPersonnelTheme.refreshSidebarAgendaCount = refreshSidebarAgendaCount;
    window.SoftoraPersonnelTheme.refreshSidebarActiveOrdersCount = refreshSidebarActiveOrdersCount;
    window.SoftoraPersonnelTheme.refreshSidebarCounts = refreshSidebarNotificationCounts;

    initSoftoraDialogs();
    applyUnifiedPremiumSidebar();
    queueSidebarFitLayout();
    window.addEventListener("resize", queueSidebarFitLayout);
    window.addEventListener("load", queueSidebarFitLayout, { once: true });
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
        document.fonts.ready
            .then(function () {
                queueSidebarFitLayout();
            })
            .catch(function () {
                /* ignore font ready errors */
            });
    }
    initSidebarNotificationCounts();
    forceLightTheme();
    syncThemeButtonsToLight();
})();
