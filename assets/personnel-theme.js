(function () {
    const pathname = (window.location.pathname || "").toLowerCase();
    const isPremiumPersonnelContext = pathname.indexOf("/premium-") !== -1;
    const personnelStorageKey = isPremiumPersonnelContext
        ? "softora_premium_personnel_theme_mode"
        : "softora_software_personnel_theme_mode";
    const publicStorageKey = "softora_premium_public_theme_mode";
    const publicFallbackStorageKey = "softora_public_theme_mode";
    const sidebarCountCacheKey = "softora_sidebar_count_cache_v1";
    const sidebarCountPersistCookieKey = "softora_sidebar_counts_v1";
    const PREMIUM_SIDEBAR_SESSION_STORAGE_KEY = "softora_premium_sidebar_session_v1";
    const leadSuppressionCookieKey = "softora_hidden_leads_v1";
    const manualLeadSuppressionTtlMs = 1000 * 60 * 2;
    const completedLeadSuppressionTtlMs = 1000 * 60 * 60 * 24 * 30;
    const serverVisibleLeadSuppressionGraceMs = 1000 * 60 * 2;
    const sidebarCountCacheState = mergeSidebarCountState(
        readPersistedSidebarCountState(),
        (
            window[sidebarCountCacheKey] &&
            typeof window[sidebarCountCacheKey] === "object"
        ) ? window[sidebarCountCacheKey] : null
    );
    const SIDEBAR_COUNT_CACHE_TTL_MS = 1000 * 60 * 10;
    const root = document.documentElement;
    const themeButtons = document.querySelectorAll(".theme-switch-btn[data-theme-value]");
    let premiumSessionSnapshot = null;
    let premiumSessionPromise = null;
    let premiumInitialSessionFetched = false;
    let premiumProfileModalRef = null;
    let premiumSidebarProfileResolved = !isPremiumPersonnelContext;
    let sidebarLeadsRefreshRequestId = 0;
    let sidebarLeadsZeroSnapshotStreak = 0;
    window[sidebarCountCacheKey] = sidebarCountCacheState;

    try {
        if (isPremiumPersonnelContext) {
            const raw = sessionStorage.getItem(PREMIUM_SIDEBAR_SESSION_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && parsed.authenticated) {
                    premiumSessionSnapshot = parsed;
                }
            }
        }
    } catch (_) {
        /* ignore corrupt storage */
    }

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
        if (!premiumSidebarProfileResolved) return;
        loadingStateReleased = true;
        requestAnimationFrame(releaseLoadingState);
    }

    function markPremiumSidebarProfileResolved() {
        if (premiumSidebarProfileResolved) return;
        premiumSidebarProfileResolved = true;
        scheduleLoadingStateRelease();
    }

    if (document.readyState === "interactive" || document.readyState === "complete") {
        scheduleLoadingStateRelease();
    } else {
        document.addEventListener("DOMContentLoaded", scheduleLoadingStateRelease, { once: true });
    }

    window.addEventListener("load", scheduleLoadingStateRelease, { once: true });

    window.SoftoraPremiumBoot = window.SoftoraPremiumBoot || {};
    window.SoftoraPremiumBoot.setShellBooting = function setShellBooting(isBooting) {
        var main = document.querySelector("main.is-premium-boot-host");
        if (!main) {
            return;
        }
        var loader = main.querySelector(".premium-boot-loader");
        var shell = main.querySelector(".premium-boot-shell");
        if (shell) {
            shell.classList.toggle("is-booting", Boolean(isBooting));
            shell.setAttribute("aria-busy", isBooting ? "true" : "false");
        }
        if (loader) {
            loader.classList.toggle("is-hidden", !isBooting);
        }
    };

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

.softora-dialog-message--rich {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.98rem;
    line-height: 1.45;
}

.softora-dialog-message--rich p {
    margin: 0 0 0.65rem 0;
}

.softora-dialog-badge-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    margin: 0.15rem 0 0 0;
}

.softora-review-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    border-radius: 10px;
    overflow: hidden;
    line-height: 0;
    box-shadow: 0 1px 2px rgba(60, 64, 67, 0.28), 0 2px 6px rgba(60, 64, 67, 0.15);
    transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.softora-review-badge:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(60, 64, 67, 0.22), 0 4px 12px rgba(60, 64, 67, 0.12);
}

.softora-review-badge:active {
    transform: translateY(0);
    box-shadow: 0 1px 2px rgba(60, 64, 67, 0.24);
}

.softora-review-badge--google:hover {
    box-shadow: 0 2px 10px rgba(66, 133, 244, 0.22), 0 4px 14px rgba(0, 0, 0, 0.08);
}

.softora-review-badge--trustpilot:hover {
    box-shadow: 0 2px 12px rgba(0, 182, 122, 0.45), 0 4px 14px rgba(0, 0, 0, 0.08);
}

.softora-review-badge:focus-visible {
    outline: 2px solid rgba(139, 34, 82, 0.45);
    outline-offset: 2px;
}

.softora-review-badge svg {
    display: block;
    height: 38px;
    width: auto;
    shape-rendering: geometricPrecision;
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
            const bodyHtmlRaw = config && config.bodyHtml ? String(config.bodyHtml).trim() : "";
            const useRichBody = Boolean(bodyHtmlRaw);
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
                    const messageBlock = useRichBody
                        ? `<div class="softora-dialog-message softora-dialog-message--rich">${bodyHtmlRaw}</div>`
                        : `<p class="softora-dialog-message">${safeMessage}</p>`;
                    const safeDefaultValue = escapeHtml(defaultValue);
                    const safeConfirmText = escapeHtml(confirmText);
                    const safeCancelText = escapeHtml(cancelText);
                    layer.innerHTML = [
                        '<div class="softora-dialog-backdrop"></div>',
                        `<div class="softora-dialog-card" role="dialog" aria-modal="true" aria-label="${safeTitle}">`,
                        `  <h3 class="softora-dialog-title">${safeTitle}</h3>`,
                        `  ${messageBlock}`,
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
                    bodyHtml: opts.bodyHtml ? String(opts.bodyHtml) : "",
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

    function isLeadsPagePath(path) {
        const p = String(path || "").toLowerCase();
        return p.indexOf("/premium-leads") === 0 || p.indexOf("/premium-ai-coldmailing") === 0;
    }

    function getSidebarActiveKey(path) {
        const p = String(path || "").toLowerCase();
        const hashRaw =
            typeof window !== "undefined" && window.location && window.location.hash
                ? String(window.location.hash || "").replace(/^#/, "").toLowerCase()
                : "";
        if (p.indexOf("/premium-advertenties") === 0) {
            if (hashRaw === "facebook") return "ads_facebook";
            if (hashRaw === "pinterest") return "ads_pinterest";
            if (hashRaw === "linkedin") return "ads_linkedin";
            if (hashRaw === "trustoo") return "ads_trustoo";
            return "ads_google";
        }
        if (
            p.indexOf("/premium-actieve-opdrachten") === 0 ||
            p.indexOf("/premium-opdracht-preview") === 0 ||
            p.indexOf("/premium-opdracht-dossier") === 0
        ) {
            return "active_orders";
        }
        if (p.indexOf("/premium-personeel-agenda") === 0) return "agenda";
        if (isLeadsPagePath(p)) return "leads";
        if (p.indexOf("/premium-ai-lead-generator") === 0) return "coldcalling";
        if (p.indexOf("/premium-bevestigingsmails") === 0) return "coldmailing";
        if (p.indexOf("/premium-klanten") === 0) return "customers";
        if (p.indexOf("/premium-database") === 0) return "database";
        if (p.indexOf("/premium-mailbox") === 0) return "mailbox";
        if (p.indexOf("/premium-websitegenerator") === 0) return "websitegenerator";
        if (p.indexOf("/premium-seo") === 0 || p.indexOf("/premium-seo-crm-system") === 0) return "seo";
        if (p.indexOf("/premium-pakketten") === 0) return "packages";
        if (p.indexOf("/premium-pdfs") === 0) return "pdfs";
        if (p.indexOf("/premium-wachtwoordenregister") === 0) return "passwords";
        if (p.indexOf("/premium-instellingen") === 0) return "settings";
        if (p.indexOf("/premium-kladblok") === 0) return "notepad";
        if (p.indexOf("/premium-word") === 0) return "word";
        if (
            p.indexOf("/premium-financiele-kosten") === 0 ||
            p.indexOf("/premium-maandelijkse-kosten") === 0 ||
            p.indexOf("/premium-vaste-lasten") === 0
        ) {
            return "monthly_costs";
        }
        if (p.indexOf("/premium-boekhouding") === 0) return "bookkeeping";
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
        return `<a href="${link.href}" class="${classes}" data-sidebar-key="${link.key}">${link.icon}${labelHtml}${countBadgeHtml}</a>`;
    }

    function getCustomersSidebarLink() {
        return {
            key: "customers",
            href: "/premium-klanten",
            label: "Klanten",
            icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>',
        };
    }

    function getWebsitePreviewSidebarLink() {
        return {
            key: "websitegenerator",
            href: "/premium-websitegenerator",
            label: "Websitegenerator",
            icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3.75" y="4.5" width="16.5" height="10.5" rx="1.5"></rect><path stroke-linecap="round" stroke-linejoin="round" d="M9 19.5h6"></path><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 12 2.5-2.5 2.5 2.5 2.75-3 1.75 2"></path></svg>',
        };
    }

    function getDatabaseSidebarLink() {
        return {
            key: "database",
            href: "/premium-database",
            label: "Database",
            icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5.25" rx="6.75" ry="2.25"></ellipse><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25v6c0 1.243 3.022 2.25 6.75 2.25s6.75-1.007 6.75-2.25v-6"></path><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 11.25v6c0 1.243 3.022 2.25 6.75 2.25s6.75-1.007 6.75-2.25v-6"></path></svg>',
        };
    }

    /** Zijbalkitems die achter een toegangsslot / coming-soon scherm zitten */
    const PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set([
        "seo",
        "ads_google",
        "ads_facebook",
        "ads_pinterest",
        "ads_linkedin",
        "ads_trustoo",
    ]);

    /* Klassiek hangslot: U-beugel + afgeronde kast (herkenbaar op klein formaat) */
    const COMING_SOON_LOCK_SVG =
        '<svg class="sidebar-link-lock-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="5" y="11" width="14" height="11" rx="2" ry="2"/></svg>';

    function decorateComingSoonSidebarLinks() {
        const sidebar = document.querySelector(".sidebar");
        if (!sidebar) return;
        PREMIUM_SIDEBAR_COMING_SOON_KEYS.forEach(function (key) {
            const link = sidebar.querySelector('[data-sidebar-key="' + key + '"]');
            if (!link) return;
            link.classList.add("sidebar-link--coming-soon");
            link.setAttribute("aria-disabled", "true");
            link.setAttribute("tabindex", "-1");
            const directSvg = link.querySelector(":scope > svg");
            if (directSvg) {
                directSvg.remove();
            }
            if (!link.querySelector(".sidebar-link-lock")) {
                const lockWrap = document.createElement("span");
                lockWrap.className = "sidebar-link-lock";
                lockWrap.setAttribute("aria-hidden", "true");
                lockWrap.innerHTML = COMING_SOON_LOCK_SVG;
                link.insertBefore(lockWrap, link.firstChild);
            }
        });
    }

    const PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS = new Set(["passwords"]);

    function getPremiumSidebarAdminExtraLinks() {
        return [
            {
                key: "passwords",
                href: "/premium-wachtwoordenregister",
                label: "Wachtwoordenregister",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V7.875a4.5 4.5 0 1 0-9 0V10.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 10.5h10.5A1.5 1.5 0 0 1 18.75 12v7.5A1.5 1.5 0 0 1 17.25 21H6.75A1.5 1.5 0 0 1 5.25 19.5V12a1.5 1.5 0 0 1 1.5-1.5Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M12 15.75v1.5"></path></svg>',
            },
        ];
    }

    function isPremiumAdminSession(session) {
        return Boolean(
            session &&
            session.authenticated &&
            String(session.role || "").trim().toLowerCase() === "admin"
        );
    }

    function filterPremiumSidebarLinksForSession(links, session) {
        const allowAdminOnlyLinks = isPremiumAdminSession(session);
        return (Array.isArray(links) ? links : []).filter(function (link) {
            const key = String(link && link.key || "").trim();
            if (!PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS.has(key)) return true;
            return allowAdminOnlyLinks;
        });
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
                href: "/premium-leads",
                label: "Leads",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>',
            },
            {
                key: "coldcalling",
                href: "/premium-ai-lead-generator",
                label: "Coldcalling",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5.5 4.25h2.214c.498 0 .933.334 1.062.815l1.146 4.289a1.125 1.125 0 0 1-.418 1.171l-1.33.997a14.34 14.34 0 0 0 4.304 4.304l.997-1.33a1.125 1.125 0 0 1 1.171-.418l4.289 1.146c.481.129.815.564.815 1.062V18.5a1.75 1.75 0 0 1-1.75 1.75h-1C9.88 20.25 3.75 14.12 3.75 6.5v-.5A1.75 1.75 0 0 1 5.5 4.25Z"></path></svg>',
            },
            {
                key: "coldmailing",
                href: "/premium-bevestigingsmails",
                label: "Coldmailing",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="m3 8 9 6 9-6"></path></svg>',
            },
            getDatabaseSidebarLink(),
        ];

        const managementLinks = [
            getCustomersSidebarLink(),
            {
                key: "mailbox",
                href: "/premium-mailbox",
                label: "Mailbox",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="m3 8 9 6 9-6"></path></svg>',
            },
            getWebsitePreviewSidebarLink(),
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

        const adsPlatformIcon =
            '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z"></path></svg>';

        const adsLinks = [
            {
                key: "ads_google",
                href: "/premium-advertenties#google",
                label: "Google",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_facebook",
                href: "/premium-advertenties#facebook",
                label: "Facebook",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_pinterest",
                href: "/premium-advertenties#pinterest",
                label: "Pinterest",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_linkedin",
                href: "/premium-advertenties#linkedin",
                label: "LinkedIn",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_trustoo",
                href: "/premium-advertenties#trustoo",
                label: "Trustoo",
                icon: adsPlatformIcon,
            },
        ];

        const extraLinks = filterPremiumSidebarLinksForSession([
            {
                key: "monthly_costs",
                href: "/premium-vaste-lasten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3.75" y="4.5" width="16.5" height="15" rx="1.5"></rect><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 9h9M7.5 13h4.5"></path><circle cx="16.5" cy="13" r="1.25"></circle></svg>',
                label: "Terugkerende kosten",
            },
            {
                key: "bookkeeping",
                href: "/premium-boekhouding",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3.75" y="4.5" width="16.5" height="15" rx="1.5"></rect><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9M7.5 12h9M7.5 15.75h5.25"></path></svg>',
                label: "Boekhouding",
            },
            {
                key: "notepad",
                href: "/premium-kladblok",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h16.5v13.5H3.75z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M8 13.5h4m-4 2.5h6"></path></svg>',
                label: "Kladblok",
            },
            {
                key: "word",
                href: "/premium-word",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 3h6L19.5 9v10.5A1.5 1.5 0 0 1 18 21H7.5A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 3V9H19.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 12.75h2.25m1.12 0h2.25m-5.62 3.75h6m-6 3h4.5"></path></svg>',
                label: "Word",
            },
            {
                key: "settings",
                href: "/premium-instellingen",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h9m3 0h4M13 6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM4 12h3m3 0h10M7 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM4 18h11m3 0h2M15 18a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z"></path></svg>',
                label: "Instellingen",
            },
        ].concat(getPremiumSidebarAdminExtraLinks()), premiumSessionSnapshot);

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
            '    <div class="sidebar-section-label">Advertenties</div>',
            adsLinks.map(function (link) { return renderSidebarLink(link, activeKey); }).join(""),
            "  </div>",
            '  <div class="sidebar-section">',
            '    <div class="sidebar-section-label">Extra</div>',
            extraLinks.map(function (link) { return renderSidebarLink(link, activeKey); }).join(""),
            "  </div>",
            "</nav>",
            '<div class="sidebar-footer">',
            '  <div class="sidebar-user">',
            '    <div class="sidebar-user-trigger" role="group" aria-label="Gebruikersinfo">',
            '      <div class="sidebar-avatar" data-sidebar-avatar>SP</div>',
            '      <div class="sidebar-user-info">',
            '        <div class="sidebar-user-name" data-sidebar-user-name>Softora Premium</div>',
            '        <div class="sidebar-user-role" data-sidebar-user-role>Full Acces</div>',
            "      </div>",
            "    </div>",
            '    <a href="/premium-personeel-login?logout=1" class="logout-btn magnetic" title="Uitloggen" aria-label="Uitloggen">',
            '      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>',
            "    </a>",
            "  </div>",
            "</div>",
        ].join("");
    }

    function pruneDeprecatedSidebarLinks(sidebar) {
        if (!sidebar || typeof sidebar.querySelectorAll !== "function") return;
        const legacyAnalyticsLinks = sidebar.querySelectorAll(
            'a[data-sidebar-key="analytics"], a[href^="/premium-analytics"]'
        );
        legacyAnalyticsLinks.forEach(function (link) {
            if (link && link.parentNode) {
                link.parentNode.removeChild(link);
            }
        });
    }

    function ensureStaticSidebarLink(sidebar, sectionLabel, link, insertBeforeKeys) {
        if (!sidebar || !link || typeof sidebar.querySelector !== "function") return null;
        const sections = Array.from(sidebar.querySelectorAll(".sidebar-section"));
        const targetSection = sections.find(function (section) {
            const label = section.querySelector(".sidebar-section-label");
            return String(label && label.textContent || "").trim().toLowerCase() === String(sectionLabel || "").trim().toLowerCase();
        });
        if (!targetSection) return null;
        const existing = sidebar.querySelector(`[data-sidebar-key="${link.key}"]`);
        const beforeEl = Array.isArray(insertBeforeKeys)
            ? insertBeforeKeys
                .map(function (key) {
                    return targetSection.querySelector(`[data-sidebar-key="${String(key || "").trim()}"]`);
                })
                .find(Boolean)
            : null;
        if (existing) {
            if (existing.parentNode !== targetSection) {
                if (beforeEl && beforeEl !== existing && beforeEl.parentNode === targetSection) {
                    targetSection.insertBefore(existing, beforeEl);
                } else {
                    targetSection.appendChild(existing);
                }
            }
            return existing;
        }
        const template = document.createElement("template");
        template.innerHTML = renderSidebarLink(link, "");
        const nextLink = template.content.firstElementChild;
        if (!nextLink) return null;
        if (beforeEl && beforeEl.parentNode === targetSection) {
            targetSection.insertBefore(nextLink, beforeEl);
        } else {
            targetSection.appendChild(nextLink);
        }
        return nextLink;
    }

    function resetStaticSidebarLink(linkEl, link) {
        if (!linkEl || !link || !link.key) return null;
        linkEl.classList.add("sidebar-link", "magnetic");
        linkEl.setAttribute("data-sidebar-key", link.key);
        linkEl.setAttribute("href", link.href);
        linkEl.innerHTML = `${link.icon}<span class="sidebar-link-text">${link.label}</span>`;
        linkEl.removeAttribute("data-sidebar-nav-init");
        linkEl.removeAttribute("data-sidebar-href");
        return linkEl;
    }

    function removeSidebarLinkByKey(sidebar, key) {
        if (!sidebar || typeof sidebar.querySelectorAll !== "function") return;
        sidebar.querySelectorAll(`[data-sidebar-key="${String(key || "").trim()}"]`).forEach(function (link) {
            if (link && link.parentNode) {
                link.parentNode.removeChild(link);
            }
        });
    }

    function syncPremiumSidebarManagementLinks(sidebar, activeKey) {
        if (!sidebar || typeof sidebar.querySelectorAll !== "function") return;
        const sections = Array.from(sidebar.querySelectorAll(".sidebar-section"));
        const overviewSection = sections.find(function (section) {
            const label = section.querySelector(".sidebar-section-label");
            return String(label && label.textContent || "").trim().toLowerCase() === "overzicht";
        });
        const managementSection = sections.find(function (section) {
            const label = section.querySelector(".sidebar-section-label");
            return String(label && label.textContent || "").trim().toLowerCase() === "beheer";
        });
        if (!overviewSection && !managementSection) return;

        const legacyDatabaseLink = managementSection
            ? managementSection.querySelector('[data-sidebar-key="customers"]')
            : null;
        if (
            legacyDatabaseLink &&
            String(legacyDatabaseLink.textContent || "").trim().toLowerCase() === "database"
        ) {
            resetStaticSidebarLink(legacyDatabaseLink, getDatabaseSidebarLink());
        }

        const customerLink = managementSection
            ? managementSection.querySelector('[data-sidebar-key="customers"]')
            : null;
        if (customerLink) {
            resetStaticSidebarLink(customerLink, getCustomersSidebarLink());
        }

        if (managementSection) {
            ensureStaticSidebarLink(
                sidebar,
                "beheer",
                getCustomersSidebarLink(),
                ["mailbox", "websitegenerator", "seo", "packages", "pdfs"]
            );
        }

        if (overviewSection) {
            const overviewDatabaseLink = ensureStaticSidebarLink(
                sidebar,
                "overzicht",
                getDatabaseSidebarLink()
            );
            if (overviewDatabaseLink) {
                resetStaticSidebarLink(overviewDatabaseLink, getDatabaseSidebarLink());
            }
        }

        if (managementSection) {
            managementSection.querySelectorAll('[data-sidebar-key="database"]').forEach(function (link) {
                if (link && link.parentNode) {
                    link.parentNode.removeChild(link);
                }
            });
        }

        syncStaticSidebarActiveState(sidebar, activeKey);
    }

    function syncStaticSidebarActiveState(sidebar, activeKey) {
        if (!sidebar || typeof sidebar.querySelectorAll !== "function") return;
        sidebar.querySelectorAll(".sidebar-link[data-sidebar-key]").forEach(function (link) {
            const key = String(link.getAttribute("data-sidebar-key") || "").trim();
            link.classList.toggle("active", key === activeKey);
        });
    }

    function syncPremiumSidebarAdminLinks(sidebar, session, activeKey) {
        if (!sidebar) return;
        if (!premiumInitialSessionFetched && session == null) {
            syncStaticSidebarActiveState(sidebar, activeKey);
            return;
        }
        const allowAdminOnlyLinks = isPremiumAdminSession(session);
        const adminExtraLinks = getPremiumSidebarAdminExtraLinks();
        adminExtraLinks.forEach(function (link) {
            if (!link || !link.key) return;
            if (!allowAdminOnlyLinks) {
                removeSidebarLinkByKey(sidebar, link.key);
                return;
            }
            ensureStaticSidebarLink(
                sidebar,
                "extra",
                link,
                link.key === "passwords" ? ["monthly_costs", "bookkeeping", "notepad", "word", "settings"] : null
            );
        });
        syncStaticSidebarActiveState(sidebar, activeKey);
    }

    function refreshPremiumStaticSidebarActiveState() {
        if (!isPremiumPersonnelContext) return;
        const sidebar = document.querySelector(".sidebar");
        if (!sidebar) return;
        const path = String(window.location.pathname || "").toLowerCase();
        const activeKey = getSidebarActiveKey(path);
        if (sidebar.dataset.staticSidebar === "1") {
            sidebar.innerHTML = buildUnifiedPremiumSidebarHtml(activeKey);
            syncPremiumSidebarManagementLinks(sidebar, activeKey);
            syncPremiumSidebarAdminLinks(sidebar, premiumSessionSnapshot, activeKey);
            pruneDeprecatedSidebarLinks(sidebar);
            decorateComingSoonSidebarLinks();
            neutralizeSidebarAnchors();
            return;
        }
        if (path.indexOf("/premium-advertenties") === 0) {
            sidebar.innerHTML = buildUnifiedPremiumSidebarHtml(activeKey);
            syncPremiumSidebarManagementLinks(sidebar, activeKey);
            syncPremiumSidebarAdminLinks(sidebar, premiumSessionSnapshot, activeKey);
            pruneDeprecatedSidebarLinks(sidebar);
            decorateComingSoonSidebarLinks();
            neutralizeSidebarAnchors();
        }
    }

    function applyUnifiedPremiumSidebar() {
        if (!isPremiumPersonnelContext) return;
        const sidebar = document.querySelector(".sidebar");
        if (!sidebar) return;
        const activeKey = getSidebarActiveKey(pathname);
        if (sidebar.dataset.staticSidebar === "1") {
            sidebar.innerHTML = buildUnifiedPremiumSidebarHtml(activeKey);
            syncPremiumSidebarManagementLinks(sidebar, activeKey);
            syncPremiumSidebarAdminLinks(sidebar, premiumSessionSnapshot, activeKey);
            pruneDeprecatedSidebarLinks(sidebar);
            decorateComingSoonSidebarLinks();
            neutralizeSidebarAnchors();
            sidebar.dataset.sidebarReady = "true";
            return;
        }
        sidebar.classList.remove("sidebar-fit-compact", "sidebar-fit-tight");
        // Alleen legacy/lege sidebars nog opbouwen; statische sidebars blijven onaangeroerd.
        sidebar.innerHTML = buildUnifiedPremiumSidebarHtml(activeKey);
        syncPremiumSidebarManagementLinks(sidebar, activeKey);
        syncPremiumSidebarAdminLinks(sidebar, premiumSessionSnapshot, activeKey);
        pruneDeprecatedSidebarLinks(sidebar);
        decorateComingSoonSidebarLinks();
        neutralizeSidebarAnchors();
        sidebar.dataset.sidebarReady = "true";
    }

    function mergeSidebarCountState() {
        const merged = Object.create(null);
        Array.from(arguments).forEach(function (source) {
            if (!source || typeof source !== "object") return;
            Object.keys(source).forEach(function (key) {
                const entry = source[key];
                const count = Number(entry && entry.count);
                const expiresAt = Number(entry && entry.expiresAt);
                if (!Number.isFinite(count) || count < 0) return;
                if (!Number.isFinite(expiresAt) || expiresAt <= 0) return;
                const existingExpiresAt = Number(merged[key] && merged[key].expiresAt) || 0;
                if (existingExpiresAt > expiresAt) return;
                merged[key] = {
                    count: Math.max(0, Math.floor(count)),
                    expiresAt: expiresAt,
                };
            });
        });
        return merged;
    }

    function readCookieValueByName(name) {
        const needle = `${String(name || "").trim()}=`;
        if (!needle || typeof document === "undefined") return "";
        const parts = String(document.cookie || "").split(";");
        for (let i = 0; i < parts.length; i += 1) {
            const part = String(parts[i] || "").trim();
            if (!part || part.indexOf(needle) !== 0) continue;
            return part.slice(needle.length);
        }
        return "";
    }

    function writeCookieValue(name, value, maxAgeSeconds) {
        const safeName = String(name || "").trim();
        if (!safeName || typeof document === "undefined") return;
        const safeMaxAge = Math.max(0, Math.floor(Number(maxAgeSeconds) || 0));
        const encodedValue = safeMaxAge > 0 ? encodeURIComponent(String(value || "")) : "";
        document.cookie =
            `${safeName}=${encodedValue}; path=/; max-age=${safeMaxAge}; SameSite=Lax`;
    }

    function readPersistedSidebarCountState() {
        const raw = readCookieValueByName(sidebarCountPersistCookieKey);
        if (!raw) return Object.create(null);
        try {
            const parsed = JSON.parse(decodeURIComponent(raw));
            return parsed && typeof parsed === "object" ? parsed : Object.create(null);
        } catch (error) {
            return Object.create(null);
        }
    }

    function persistSidebarCountCache() {
        const payload = Object.create(null);
        const nowMs = Date.now();
        let maxExpiresAt = 0;
        Object.keys(sidebarCountCacheState).forEach(function (key) {
            const entry = sidebarCountCacheState[key];
            const count = Number(entry && entry.count);
            const expiresAt = Number(entry && entry.expiresAt);
            if (!Number.isFinite(count) || count < 0) return;
            if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return;
            payload[key] = {
                count: Math.max(0, Math.floor(count)),
                expiresAt: expiresAt,
            };
            if (expiresAt > maxExpiresAt) {
                maxExpiresAt = expiresAt;
            }
        });
        if (!Object.keys(payload).length) {
            writeCookieValue(sidebarCountPersistCookieKey, "", 0);
            return;
        }
        const maxAgeSeconds = Math.max(60, Math.ceil((maxExpiresAt - nowMs) / 1000));
        writeCookieValue(sidebarCountPersistCookieKey, JSON.stringify(payload), maxAgeSeconds);
    }

    function buildSidebarRoleLabel(role) {
        return String(role || "").toLowerCase() === "admin" ? "Full Acces" : "Medewerker";
    }

    function normalizeSidebarNavigationTarget(url) {
        const href = String(url || "").trim();
        if (!href) return "";
        if (href === "/premium-ai-coldmailing") return "/premium-leads";
        return href;
    }

    function openSidebarNavigationTarget(url, event) {
        const href = normalizeSidebarNavigationTarget(url);
        if (!href) return;
        const openInNewTab = Boolean(
            event &&
            (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
        );
        if (openInNewTab) {
            window.open(href, "_blank", "noopener,noreferrer");
            return;
        }
        window.location.assign(href);
    }

    function neutralizeSidebarAnchors() {
        if (!isPremiumPersonnelContext) return;
        let initializedCount = 0;
        document
            .querySelectorAll(".sidebar a.sidebar-logo, .sidebar a.sidebar-link, .sidebar-footer a.logout-btn")
            .forEach(function (anchor) {
                if (!anchor || anchor.dataset.sidebarNavInit === "1") return;
                const sidebarKey = String(anchor.getAttribute("data-sidebar-key") || "").trim();
                if (sidebarKey && PREMIUM_SIDEBAR_COMING_SOON_KEYS.has(sidebarKey)) {
                    anchor.dataset.sidebarNavInit = "1";
                    anchor.removeAttribute("href");
                    anchor.setAttribute("role", "link");
                    anchor.setAttribute("aria-disabled", "true");
                    anchor.setAttribute("tabindex", "-1");
                    return;
                }
                const href = String(anchor.getAttribute("href") || "").trim();
                if (!href) return;
                anchor.dataset.sidebarNavInit = "1";
                anchor.dataset.sidebarHref = normalizeSidebarNavigationTarget(href);
                anchor.removeAttribute("href");
                anchor.setAttribute("role", "link");
                anchor.setAttribute("tabindex", "0");
                anchor.addEventListener("click", function (event) {
                    event.preventDefault();
                    openSidebarNavigationTarget(anchor.dataset.sidebarHref, event);
                });
                anchor.addEventListener("auxclick", function (event) {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    openSidebarNavigationTarget(anchor.dataset.sidebarHref, event);
                });
                anchor.addEventListener("keydown", function (event) {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openSidebarNavigationTarget(anchor.dataset.sidebarHref, event);
                });
                initializedCount += 1;
            });
        if (initializedCount > 0) {
            document.body.setAttribute("data-sidebar-nav-ready", "1");
        }
    }

    function buildSidebarInitialsFromSession(session) {
        const displayName = String((session && (session.displayName || session.firstName || session.email)) || "").trim();
        if (!displayName) return "SP";
        const parts = displayName.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
        }
        const compact = displayName.replace(/[^a-z0-9]+/gi, "");
        return (compact.slice(0, 2) || "SP").toUpperCase();
    }

    function buildSidebarProfileRenderKey(session) {
        const displayName = String((session && session.displayName) || "Softora Premium").trim() || "Softora Premium";
        const role = String((session && session.role) || "admin").trim().toLowerCase() || "admin";
        const avatarDataUrl = String((session && session.avatarDataUrl) || "").trim();
        return [displayName, role, avatarDataUrl].join("\u0001");
    }

    function paintSidebarAvatar(avatarEl, session) {
        if (!avatarEl) return;
        const avatarDataUrl = String((session && session.avatarDataUrl) || "").trim();
        avatarEl.innerHTML = "";
        if (avatarDataUrl) {
            const img = document.createElement("img");
            img.src = avatarDataUrl;
            img.alt = String((session && session.displayName) || "Profielfoto");
            img.loading = "lazy";
            avatarEl.appendChild(img);
            return;
        }
        avatarEl.textContent = buildSidebarInitialsFromSession(session);
    }

    function applyPremiumSidebarProfile(session) {
        const nameEl = document.querySelector("[data-sidebar-user-name]");
        const roleEl = document.querySelector("[data-sidebar-user-role]");
        const avatarEl = document.querySelector("[data-sidebar-avatar]");
        const profileWrapEl = document.querySelector(".sidebar-user .sidebar-user-trigger");
        const sidebar = document.querySelector(".sidebar");
        const activeKey = getSidebarActiveKey(pathname);

        if (sidebar) {
            syncPremiumSidebarManagementLinks(sidebar, activeKey);
            syncPremiumSidebarAdminLinks(
                sidebar,
                session && session.authenticated ? session : null,
                activeKey
            );
            decorateComingSoonSidebarLinks();
            neutralizeSidebarAnchors();
        }

        if (!nameEl || !roleEl || !avatarEl) {
            markPremiumSidebarProfileResolved();
            return;
        }

        const resolvedSession = session && session.authenticated
            ? session
            : {
                displayName: "Softora Premium",
                role: "admin",
                avatarDataUrl: "",
                email: "",
            };
        const renderKey = buildSidebarProfileRenderKey(resolvedSession);
        if (sidebar && sidebar.dataset.sidebarProfileRenderKey === renderKey) {
            markPremiumSidebarProfileResolved();
            return;
        }

        nameEl.textContent = String(resolvedSession.displayName || "Softora Premium");
        roleEl.textContent = buildSidebarRoleLabel(resolvedSession.role);
        if (profileWrapEl) {
            profileWrapEl.setAttribute(
                "aria-label",
                `Ingelogd als ${String(resolvedSession.displayName || "Softora Premium")}`
            );
        }
        paintSidebarAvatar(avatarEl, resolvedSession);
        markPremiumSidebarProfileResolved();
        if (sidebar) {
            sidebar.dataset.sidebarProfileRenderKey = renderKey;
        }
    }

    async function requestJson(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options && options.headers ? options.headers : {}),
            },
        });
        const payload = await response.json().catch(function () {
            return {};
        });
        if (!response.ok || !payload || payload.ok === false) {
            throw new Error(String((payload && (payload.error || payload.detail)) || "Request mislukt"));
        }
        return payload;
    }

    function persistPremiumSidebarSessionSnapshot(session) {
        try {
            if (session && session.authenticated) {
                sessionStorage.setItem(PREMIUM_SIDEBAR_SESSION_STORAGE_KEY, JSON.stringify(session));
            } else {
                sessionStorage.removeItem(PREMIUM_SIDEBAR_SESSION_STORAGE_KEY);
            }
        } catch (_) {
            /* ignore quota / private mode */
        }
    }

    async function loadPremiumSession(options) {
        if (!isPremiumPersonnelContext) return null;
        const force = Boolean(options && options.force);
        if (premiumSessionPromise && !force) return premiumSessionPromise;
        premiumSessionPromise = (async function () {
            try {
                const payload = await fetchJsonNoStore("/api/auth/session");
                premiumInitialSessionFetched = true;
                premiumSessionSnapshot = payload && payload.authenticated ? payload : null;
                persistPremiumSidebarSessionSnapshot(premiumSessionSnapshot);
                applyPremiumSidebarProfile(premiumSessionSnapshot);
                return premiumSessionSnapshot;
            } catch (error) {
                premiumInitialSessionFetched = true;
                applyPremiumSidebarProfile(premiumSessionSnapshot);
                return premiumSessionSnapshot;
            } finally {
                premiumSessionPromise = null;
            }
        })();
        return premiumSessionPromise;
    }

    function setPremiumProfileFeedback(message, tone) {
        if (!premiumProfileModalRef || !premiumProfileModalRef.feedback) return;
        const feedbackEl = premiumProfileModalRef.feedback;
        const hasMessage = Boolean(String(message || "").trim());
        feedbackEl.hidden = !hasMessage;
        feedbackEl.textContent = hasMessage ? String(message) : "";
        feedbackEl.dataset.tone = hasMessage ? String(tone || "neutral") : "";
    }

    function paintPremiumProfilePreview(sessionLike) {
        if (!premiumProfileModalRef || !premiumProfileModalRef.preview) return;
        const previewEl = premiumProfileModalRef.preview;
        previewEl.innerHTML = "";
        const avatarDataUrl = String(
            (premiumProfileModalRef.pendingAvatarDataUrl !== null && premiumProfileModalRef.pendingAvatarDataUrl !== undefined)
                ? premiumProfileModalRef.pendingAvatarDataUrl
                : ((sessionLike && sessionLike.avatarDataUrl) || "")
        ).trim();

        if (avatarDataUrl) {
            const img = document.createElement("img");
            img.src = avatarDataUrl;
            img.alt = String((sessionLike && sessionLike.displayName) || "Profielfoto");
            previewEl.appendChild(img);
            return;
        }

        previewEl.textContent = buildSidebarInitialsFromSession(sessionLike || premiumSessionSnapshot || null);
    }

    function setPremiumProfileSavingState(isSaving) {
        if (!premiumProfileModalRef) return;
        premiumProfileModalRef.dialog.classList.toggle("is-saving", Boolean(isSaving));
        premiumProfileModalRef.saveBtn.disabled = Boolean(isSaving);
        premiumProfileModalRef.cancelBtn.disabled = Boolean(isSaving);
        premiumProfileModalRef.closeBtn.disabled = Boolean(isSaving);
        premiumProfileModalRef.uploadBtn.disabled = Boolean(isSaving);
        premiumProfileModalRef.removeBtn.disabled = Boolean(isSaving);
        premiumProfileModalRef.nameInput.disabled = Boolean(isSaving);
    }

    function closePremiumProfileModal() {
        if (!premiumProfileModalRef) return;
        premiumProfileModalRef.root.hidden = true;
        document.body.classList.remove("premium-profile-modal-open");
        setPremiumProfileFeedback("", "");
    }

    function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                resolve(String(reader.result || ""));
            };
            reader.onerror = function () {
                reject(new Error("Bestand lezen mislukt."));
            };
            reader.readAsDataURL(file);
        });
    }

    function loadImageElement(src) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error("Afbeelding laden mislukt.")); };
            img.src = src;
        });
    }

    async function buildResizedAvatarDataUrl(file) {
        if (!file) return "";
        if (!/^image\//i.test(String(file.type || ""))) {
            throw new Error("Kies een geldig afbeeldingsbestand.");
        }
        if (Number(file.size) > 5 * 1024 * 1024) {
            throw new Error("Profielfoto mag maximaal 5 MB zijn.");
        }

        const originalDataUrl = await fileToDataUrl(file);
        const image = await loadImageElement(originalDataUrl);
        const canvas = document.createElement("canvas");
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Canvas initialiseren mislukt.");
        }

        const sourceWidth = Number(image.naturalWidth || image.width || size);
        const sourceHeight = Number(image.naturalHeight || image.height || size);
        const squareSize = Math.min(sourceWidth, sourceHeight);
        const sourceX = Math.max(0, (sourceWidth - squareSize) / 2);
        const sourceY = Math.max(0, (sourceHeight - squareSize) / 2);

        context.drawImage(image, sourceX, sourceY, squareSize, squareSize, 0, 0, size, size);
        return canvas.toDataURL("image/jpeg", 0.86);
    }

    function populatePremiumProfileModal(session) {
        if (!premiumProfileModalRef) return;
        const currentSession = session || premiumSessionSnapshot || null;
        premiumProfileModalRef.pendingAvatarDataUrl = (currentSession && currentSession.avatarDataUrl) || "";
        premiumProfileModalRef.nameInput.value = String((currentSession && currentSession.displayName) || "").trim();
        premiumProfileModalRef.emailText.textContent = String((currentSession && currentSession.email) || "");
        premiumProfileModalRef.fileInput.value = "";
        paintPremiumProfilePreview(currentSession);
        setPremiumProfileFeedback("", "");
    }

    function ensurePremiumProfileModal() {
        if (premiumProfileModalRef) return premiumProfileModalRef;
        const rootEl = document.createElement("div");
        rootEl.className = "premium-profile-modal";
        rootEl.hidden = true;
        rootEl.innerHTML = [
            '<div class="premium-profile-backdrop" data-profile-close="1"></div>',
            '<div class="premium-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="premium-profile-title">',
            '  <button type="button" class="premium-profile-close" data-profile-close="1" aria-label="Sluiten">×</button>',
            '  <div class="premium-profile-header">',
            '    <p class="premium-profile-kicker">Profiel</p>',
            '    <h2 class="premium-profile-title" id="premium-profile-title">Persoonlijke instellingen</h2>',
            '  </div>',
            '  <form class="premium-profile-form" novalidate>',
            '    <div class="premium-profile-identity">',
            '      <div class="premium-profile-avatar-preview" data-profile-avatar-preview>SP</div>',
            '      <div class="premium-profile-identity-meta">',
            '        <div class="premium-profile-email" data-profile-email></div>',
            '        <div class="premium-profile-avatar-actions">',
            '          <input type="file" accept="image/*" class="premium-profile-file-input" data-profile-file-input />',
            '          <button type="button" class="premium-profile-secondary-btn" data-profile-upload-btn>Profielfoto uploaden</button>',
            '          <button type="button" class="premium-profile-secondary-btn" data-profile-remove-btn>Foto verwijderen</button>',
            '        </div>',
            '      </div>',
            '    </div>',
            '    <label class="premium-profile-field">',
            '      <span class="premium-profile-label">Naam</span>',
            '      <input type="text" class="premium-profile-input" data-profile-name maxlength="160" placeholder="Bijv. Servé Creusen" required />',
            '    </label>',
            '    <div class="premium-profile-feedback" data-profile-feedback hidden></div>',
            '    <div class="premium-profile-actions">',
            '      <button type="button" class="premium-profile-secondary-btn" data-profile-cancel>Annuleren</button>',
            '      <button type="submit" class="premium-profile-primary-btn" data-profile-save>Opslaan</button>',
            '    </div>',
            '  </form>',
            '</div>',
        ].join("");
        document.body.appendChild(rootEl);

        premiumProfileModalRef = {
            root: rootEl,
            dialog: rootEl.querySelector(".premium-profile-dialog"),
            closeBtn: rootEl.querySelector(".premium-profile-close"),
            cancelBtn: rootEl.querySelector("[data-profile-cancel]"),
            saveBtn: rootEl.querySelector("[data-profile-save]"),
            uploadBtn: rootEl.querySelector("[data-profile-upload-btn]"),
            removeBtn: rootEl.querySelector("[data-profile-remove-btn]"),
            fileInput: rootEl.querySelector("[data-profile-file-input]"),
            nameInput: rootEl.querySelector("[data-profile-name]"),
            emailText: rootEl.querySelector("[data-profile-email]"),
            preview: rootEl.querySelector("[data-profile-avatar-preview]"),
            feedback: rootEl.querySelector("[data-profile-feedback]"),
            form: rootEl.querySelector(".premium-profile-form"),
            pendingAvatarDataUrl: "",
        };

        rootEl.addEventListener("click", function (event) {
            const target = event.target;
            if (target && target.closest("[data-profile-close='1']")) {
                closePremiumProfileModal();
            }
        });

        rootEl.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                event.preventDefault();
                closePremiumProfileModal();
            }
        });

        premiumProfileModalRef.cancelBtn.addEventListener("click", function () {
            closePremiumProfileModal();
        });

        premiumProfileModalRef.uploadBtn.addEventListener("click", function () {
            premiumProfileModalRef.fileInput.click();
        });

        premiumProfileModalRef.removeBtn.addEventListener("click", function () {
            premiumProfileModalRef.pendingAvatarDataUrl = "";
            premiumProfileModalRef.fileInput.value = "";
            paintPremiumProfilePreview(premiumSessionSnapshot);
        });

        premiumProfileModalRef.fileInput.addEventListener("change", async function (event) {
            const file = event.target && event.target.files ? event.target.files[0] : null;
            if (!file) return;
            setPremiumProfileFeedback("", "");
            try {
                premiumProfileModalRef.pendingAvatarDataUrl = await buildResizedAvatarDataUrl(file);
                paintPremiumProfilePreview(premiumSessionSnapshot);
            } catch (error) {
                premiumProfileModalRef.fileInput.value = "";
                setPremiumProfileFeedback(
                    String((error && error.message) || "Profielfoto verwerken mislukt."),
                    "error"
                );
            }
        });

        premiumProfileModalRef.form.addEventListener("submit", async function (event) {
            event.preventDefault();
            const nameValue = String(premiumProfileModalRef.nameInput.value || "").trim();
            if (!nameValue) {
                setPremiumProfileFeedback("Voer een geldige naam in.", "error");
                premiumProfileModalRef.nameInput.focus();
                return;
            }

            setPremiumProfileSavingState(true);
            setPremiumProfileFeedback("", "");

            try {
                const payload = await requestJson("/api/auth/profile", {
                    method: "PATCH",
                    body: JSON.stringify({
                        displayName: nameValue,
                        avatarDataUrl: premiumProfileModalRef.pendingAvatarDataUrl || "",
                        removeAvatar: premiumProfileModalRef.pendingAvatarDataUrl ? false : true,
                    }),
                });
                premiumSessionSnapshot = payload && payload.session ? payload.session : premiumSessionSnapshot;
                persistPremiumSidebarSessionSnapshot(premiumSessionSnapshot);
                applyPremiumSidebarProfile(premiumSessionSnapshot);
                closePremiumProfileModal();
            } catch (error) {
                setPremiumProfileFeedback(
                    String((error && error.message) || "Profiel opslaan mislukt."),
                    "error"
                );
            } finally {
                setPremiumProfileSavingState(false);
            }
        });

        return premiumProfileModalRef;
    }

    async function openPremiumProfileModal() {
        const session = premiumSessionSnapshot || await loadPremiumSession({ force: true });
        if (!session || !session.authenticated) {
            if (window.SoftoraDialogs && typeof window.SoftoraDialogs.alert === "function") {
                window.SoftoraDialogs.alert({
                    title: "Niet ingelogd",
                    message: "Je sessie is verlopen. Log opnieuw in om je profiel te wijzigen.",
                });
            }
            return;
        }

        const modal = ensurePremiumProfileModal();
        populatePremiumProfileModal(session);
        modal.root.hidden = false;
        document.body.classList.add("premium-profile-modal-open");
        window.setTimeout(function () {
            modal.nameInput.focus();
            modal.nameInput.select();
        }, 20);
    }

    function initPremiumSidebarProfile() {
        if (!isPremiumPersonnelContext) return;
        if (document.documentElement.dataset.premiumSidebarProfileInit === "1") return;
        document.documentElement.dataset.premiumSidebarProfileInit = "1";
        const triggerEl = document.querySelector("[data-sidebar-profile-trigger]");
        if (triggerEl && String(triggerEl.tagName || "").toLowerCase() === "button") {
            if (triggerEl.dataset.profileInit !== "1") {
                triggerEl.dataset.profileInit = "1";
                triggerEl.addEventListener("click", function () {
                    openPremiumProfileModal();
                });
            }
        }
        loadPremiumSession();
    }

    function normalizeLeadFieldForCount(value) {
        return String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
    }

    function extractCallIdFromRecordingUrlForCount(value) {
        var raw = String(value || "").trim();
        if (!raw) return "";
        try {
            var parsed = new URL(raw, window.location.origin);
            return String(parsed.searchParams.get("callId") || "").trim();
        } catch (e) {
            var match = raw.match(/[?&]callId=([^&#]+)/i);
            if (!match) return "";
            try { return decodeURIComponent(String(match[1] || "").trim()); }
            catch (e2) { return String(match[1] || "").trim(); }
        }
    }

    function resolveLeadCallIdForCount(item) {
        if (!item) return "";
        return String(
            item.callId ||
            item.call_id ||
            item.sourceCallId ||
            extractCallIdFromRecordingUrlForCount(item.recordingUrl) ||
            extractCallIdFromRecordingUrlForCount(item.recording_url) ||
            extractCallIdFromRecordingUrlForCount(item.recordingUrlProxy) ||
            extractCallIdFromRecordingUrlForCount(item.audioUrl) ||
            extractCallIdFromRecordingUrlForCount(item.audio_url) ||
            ""
        ).trim();
    }

    function buildLeadVirtualSeedForCount(item) {
        const callId = resolveLeadCallIdForCount(item);
        if (callId) return `call:${callId}`;
        const phoneDigits = String((item && item.phone) || "").replace(/\D/g, "");
        if (phoneDigits) return `phone:${phoneDigits}`;
        const companyKey = normalizeLeadFieldForCount(item && item.company);
        const contactKey = normalizeLeadFieldForCount(item && item.contact);
        if (companyKey || contactKey) return `name:${companyKey}|${contactKey}`;
        return "";
    }

    function resolveLeadListIdForCount(item) {
        const explicitId = Number((item && item.id) || 0) || 0;
        if (explicitId > 0) return explicitId;
        const seed = buildLeadVirtualSeedForCount(item);
        if (!seed) return 0;
        let hash = 0;
        for (let i = 0; i < seed.length; i += 1) {
            hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
        }
        return -(Math.abs(hash || 1));
    }

    function normalizeLeadRowForCount(item) {
        return {
            id: resolveLeadListIdForCount(item),
            company: String((item && item.company) || "Onbekende lead").trim(),
            contact: String((item && item.contact) || "").trim(),
            phone: String((item && item.phone) || "").trim(),
            date: String((item && item.date) || "").trim(),
            time: String((item && item.time) || "").trim(),
            callId: resolveLeadCallIdForCount(item),
            createdAt: String((item && item.createdAt) || "").trim(),
            confirmationTaskCreatedAt: String((item && item.confirmationTaskCreatedAt) || "").trim(),
            updatedAt: String((item && item.updatedAt) || "").trim(),
        };
    }

    function readSuppressedLeadKeys() {
        const map = new Map();
        function isPersistedSuppressionKey(key) {
            const normalizedKey = String(key || "").trim();
            return normalizedKey.indexOf("id:") === 0 || normalizedKey.indexOf("call:") === 0;
        }
        function inferCreatedAt(expiresAt) {
            const safeExpiresAt = Number(expiresAt) || 0;
            if (safeExpiresAt <= 0) return 0;
            const remainingMs = Math.max(0, safeExpiresAt - Date.now());
            const assumedTtlMs = remainingMs > manualLeadSuppressionTtlMs
                ? completedLeadSuppressionTtlMs
                : manualLeadSuppressionTtlMs;
            return Math.max(0, safeExpiresAt - assumedTtlMs);
        }
        try {
            const cookiePairs = String(document.cookie || "").split(/;\s*/);
            const rawPair = cookiePairs.find(function (pair) {
                return pair.indexOf(leadSuppressionCookieKey + "=") === 0;
            });
            if (!rawPair) return map;
            const rawValue = rawPair.slice((leadSuppressionCookieKey + "=").length);
            const decodedValue = decodeURIComponent(rawValue || "");
            const parsed = decodedValue ? JSON.parse(decodedValue) : [];
            const nowMs = Date.now();
            if (Array.isArray(parsed)) {
                parsed.forEach(function (entry) {
                    if (!Array.isArray(entry) || entry.length < 2) return;
                    const key = String(entry[0] || "").trim();
                    const expiresAt = Number(entry[1]) || 0;
                    if (!key || !isPersistedSuppressionKey(key) || expiresAt <= nowMs) return;
                    map.set(key, {
                        expiresAt: expiresAt,
                        createdAt: Math.max(0, Math.min(Number(entry[2]) || inferCreatedAt(expiresAt), expiresAt)),
                    });
                });
            }
        } catch (_) {}
        return map;
    }

    function isLeadRowSuppressed(row, suppressedKeys, options) {
        const rowId = Number(row && row.id) || 0;
        const callId = String(row && row.callId || "").trim();
        let entry = null;
        if (rowId !== 0 && suppressedKeys.has("id:" + rowId)) {
            entry = suppressedKeys.get("id:" + rowId);
        }
        if (!entry && callId && suppressedKeys.has("call:" + callId)) {
            entry = suppressedKeys.get("call:" + callId);
        }
        if (!entry) return false;
        if (options && options.ignoreServerVisibleStaleSuppression) {
            const nowMs = Number(options.nowMs) || Date.now();
            const createdAt = Number(entry.createdAt) || 0;
            if (createdAt > 0 && nowMs - createdAt >= serverVisibleLeadSuppressionGraceMs) {
                return false;
            }
        }
        return true;
    }

    function dedupeLeadRowsForCount(rows) {
        const map = new Map();
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
            const rowId = Number(row && row.id) || 0;
            const callId = String((row && row.callId) || "").trim();
            const key = buildLeadMatchKeyForCount(row) || (
                callId
                    ? `call:${callId}`
                    : rowId > 0
                        ? `id:${rowId}`
                        : [
                            normalizeLeadFieldForCount(row && row.company),
                            normalizeLeadFieldForCount(row && row.contact),
                            normalizeLeadFieldForCount(row && row.phone),
                            normalizeLeadFieldForCount(row && row.date),
                            normalizeLeadFieldForCount(row && row.time),
                        ].join("|")
            );
            if (!map.has(key)) map.set(key, row);
        });
        return Array.from(map.values());
    }

    function normalizeLeadPhoneDigitsForCount(value) {
        const digits = String(value || "").replace(/\D/g, "");
        if (!digits) return "";
        if (digits.indexOf("0031") === 0) return `31${digits.slice(4)}`;
        if (digits.indexOf("31") === 0) return digits;
        if (digits.indexOf("0") === 0 && digits.length >= 10) return `31${digits.slice(1)}`;
        if (digits.indexOf("6") === 0 && digits.length === 9) return `31${digits}`;
        return digits;
    }

    function buildLeadMatchKeyForCount(item) {
        const phoneKey = normalizeLeadPhoneDigitsForCount(item && item.phone);
        if (phoneKey) return `phone:${phoneKey}`;
        const companyKey = normalizeLeadFieldForCount(item && item.company);
        const contactKey = normalizeLeadFieldForCount(item && item.contact);
        if (companyKey || contactKey) return `name:${companyKey}|${contactKey}`;
        return "";
    }

    function buildLeadRecencyTimestampForCount(item) {
        if (!item || typeof item !== "object") return 0;
        const preferred = Date.parse(
            String(item.confirmationTaskCreatedAt || item.createdAt || item.updatedAt || "").trim()
        );
        if (Number.isFinite(preferred) && preferred > 0) return preferred;

        const date = String(item.date || "").trim();
        const time = String(item.time || "").trim() || "09:00";
        const combined = date ? Date.parse(`${date}T${time}:00`) : 0;
        if (Number.isFinite(combined) && combined > 0) return combined;
        return 0;
    }

    function filterInterestedRowsForCount(interestedRows, existingRows) {
        const existingLatestTsByKey = new Map();
        (Array.isArray(existingRows) ? existingRows : []).forEach(function (row) {
            const key = buildLeadMatchKeyForCount(row);
            if (!key) return;
            existingLatestTsByKey.set(
                key,
                Math.max(Number(existingLatestTsByKey.get(key) || 0), buildLeadRecencyTimestampForCount(row))
            );
        });

        const seenKeys = new Set();
        const seenCallIds = new Set();
        return (Array.isArray(interestedRows) ? interestedRows : []).filter(function (row) {
            const callId = String((row && row.callId) || "").trim();
            const matchKey = buildLeadMatchKeyForCount(row);
            if (
                matchKey &&
                Number(existingLatestTsByKey.get(matchKey) || 0) >= buildLeadRecencyTimestampForCount(row)
            ) {
                return false;
            }
            if (matchKey && seenKeys.has(matchKey)) return false;
            if (callId && seenCallIds.has(callId)) return false;
            if (matchKey) seenKeys.add(matchKey);
            if (callId) seenCallIds.add(callId);
            return true;
        });
    }

    function buildLeadInterestSignalTextForCount(update, insight) {
        return normalizeLeadFieldForCount(
            [
                update && update.summary,
                update && update.transcriptSnippet,
                update && update.transcriptFull,
                update && update.status,
                update && update.endedReason,
                insight && insight.summary,
                insight && insight.followUpReason,
            ]
                .filter(Boolean)
                .join(" ")
        );
    }

    function hasNegativeInterestSignalForCount(text) {
        return /(geen duidelijke interesse|geen interesse|niet geinteresseerd|niet geïnteresseerd|geen behoefte|niet relevant|niet passend|niet meer bellen|bel( me)? niet|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst)/.test(
            normalizeLeadFieldForCount(text)
        );
    }

    function hasPositiveInterestSignalForCount(text) {
        return /(wel interesse|geinteresseerd|geïnteresseerd|interesse|afspraak|demo|offerte|stuur (de )?(mail|info)|mail .* (offerte|informatie)|terugbellen|callback|terugbel)/.test(
            normalizeLeadFieldForCount(text)
        );
    }

    function isInterestedLeadCandidateForCount(update, insight) {
        const direction = normalizeLeadFieldForCount(update && update.direction);
        const messageType = normalizeLeadFieldForCount(update && update.messageType);
        if (direction.indexOf("inbound") >= 0 || /twilio\.inbound\./.test(messageType)) return false;

        const statusText = normalizeLeadFieldForCount(
            `${(update && update.status) || ""} ${(update && update.endedReason) || ""}`
        );
        if (
            /(not[_ -]?connected|no[_ -]?answer|unanswered|failed|dial[_ -]?failed|busy|voicemail|initiated|queued|ringing|cancelled|canceled|rejected|error)/.test(
                statusText
            )
        ) {
            return false;
        }

        const signalText = buildLeadInterestSignalTextForCount(update, insight);
        if (!signalText || hasNegativeInterestSignalForCount(signalText)) return false;
        if (
            Boolean(
                (insight && (insight.appointmentBooked || insight.appointment_booked)) ||
                    (insight && (insight.followUpRequired || insight.follow_up_required))
            )
        ) {
            return true;
        }
        return hasPositiveInterestSignalForCount(signalText);
    }

    function buildInterestedLeadRowsForCount(callUpdates, insights, existingRows) {
        const existingKeys = new Set(
            dedupeLeadRowsForCount(existingRows).map(buildLeadMatchKeyForCount).filter(Boolean)
        );
        const seenKeys = new Set();
        const seenCallIds = new Set();
        const insightByCallId = new Map();
        const insightByPhoneKey = new Map();
        const insightByCompanyKey = new Map();

        (Array.isArray(insights) ? insights : []).forEach(function (insight) {
            const callId = String((insight && insight.callId) || "").trim();
            const phoneKey = normalizeLeadPhoneDigitsForCount(insight && insight.phone);
            const companyKey = normalizeLeadFieldForCount(
                (insight && (insight.company || insight.leadCompany)) || ""
            );
            if (callId && !insightByCallId.has(callId)) insightByCallId.set(callId, insight);
            if (phoneKey && !insightByPhoneKey.has(phoneKey)) insightByPhoneKey.set(phoneKey, insight);
            if (companyKey && !insightByCompanyKey.has(companyKey)) insightByCompanyKey.set(companyKey, insight);
        });

        const rows = [];
        (Array.isArray(callUpdates) ? callUpdates : []).forEach(function (update) {
            const callId = String((update && update.callId) || "").trim();
            const phoneKey = normalizeLeadPhoneDigitsForCount(update && update.phone);
            const companyKey = normalizeLeadFieldForCount((update && update.company) || "");
            const insight =
                insightByCallId.get(callId) ||
                insightByPhoneKey.get(phoneKey) ||
                insightByCompanyKey.get(companyKey) ||
                null;
            if (!isInterestedLeadCandidateForCount(update, insight)) return;

            const row = normalizeLeadRowForCount({
                company:
                    String(
                        (update && update.company) ||
                            (insight && (insight.company || insight.leadCompany)) ||
                            "Onbekende lead"
                    ).trim() || "Onbekende lead",
                contact: String(
                    (update && update.name) || (insight && (insight.contactName || insight.leadName)) || ""
                ).trim(),
                phone: String((update && update.phone) || (insight && insight.phone) || "").trim(),
            });
            const matchKey = buildLeadMatchKeyForCount(row);
            if (matchKey && existingKeys.has(matchKey)) return;
            if (matchKey && seenKeys.has(matchKey)) return;
            if (callId && seenCallIds.has(callId)) return;

            if (matchKey) seenKeys.add(matchKey);
            if (callId) seenCallIds.add(callId);
            rows.push(row);
        });

        return rows;
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

    async function fetchFirstJsonNoStore(urls) {
        for (let i = 0; i < urls.length; i += 1) {
            const data = await fetchJsonNoStore(urls[i]);
            if (data) return data;
        }
        return null;
    }

    function getSidebarCountBadge(countKey) {
        return document.querySelector(`[data-sidebar-count-key="${String(countKey || "").trim()}"]`);
    }

    function readSidebarCountCache() {
        const nowMs = Date.now();
        let changed = false;
        Object.keys(sidebarCountCacheState).forEach(function (key) {
            const expiresAt = Number(sidebarCountCacheState[key] && sidebarCountCacheState[key].expiresAt) || 0;
            if (expiresAt > nowMs) return;
            delete sidebarCountCacheState[key];
            changed = true;
        });
        if (changed) persistSidebarCountCache();
        return sidebarCountCacheState;
    }

    function writeSidebarCountCache(countKey, count) {
        const key = String(countKey || "").trim();
        if (!key) return;
        if (!Number.isFinite(count) || count < 0) {
            delete sidebarCountCacheState[key];
            persistSidebarCountCache();
            return;
        }
        sidebarCountCacheState[key] = {
            count: Math.max(0, Math.floor(Number(count) || 0)),
            expiresAt: Date.now() + SIDEBAR_COUNT_CACHE_TTL_MS,
        };
        persistSidebarCountCache();
        return;
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
    }

    async function refreshSidebarLeadsCount() {
        const badge = getSidebarCountBadge("leads");
        if (!badge) return;
        const requestId = ++sidebarLeadsRefreshRequestId;
        const suppressedKeys = readSuppressedLeadKeys();
        const pathName = String((window.location && window.location.pathname) || "").trim().toLowerCase();
        const isLiveLeadsPage = isLeadsPagePath(pathName);
        const liveLeadsPageCount = Number(window.__softoraLeadsPageCount);
        if (
            isLiveLeadsPage &&
            Number.isFinite(liveLeadsPageCount) &&
            liveLeadsPageCount >= 0
        ) {
            // On the live leads page the count already reflects suppression (renderList handles it)
            if (requestId !== sidebarLeadsRefreshRequestId) return;
            sidebarLeadsZeroSnapshotStreak = 0;
            paintSidebarCount("leads", Math.floor(liveLeadsPageCount), {
                singular: "open lead",
                plural: "open leads",
            });
            return;
        }

        const [tasksData, interestedLeadsData] = await Promise.all([
            fetchFirstJsonNoStore([
                "/api/agenda/confirmation-tasks?quick=1&limit=400",
                "/api/agenda/confirmation-tasks?fast=1&limit=400",
                "/api/agenda/confirmation-tasks?limit=400",
            ]),
            fetchJsonNoStore("/api/agenda/interested-leads?limit=500"),
        ]);
        if (requestId !== sidebarLeadsRefreshRequestId) return;

        if (!tasksData && !interestedLeadsData) {
            if (isLiveLeadsPage) {
                paintSidebarCount(
                    "leads",
                    Number.isFinite(liveLeadsPageCount) && liveLeadsPageCount >= 0
                        ? Math.floor(liveLeadsPageCount)
                        : null,
                    { singular: "open lead", plural: "open leads" }
                );
                return;
            }
            const cachedLeadCount = readCachedSidebarCount("leads");
            if (Number.isFinite(cachedLeadCount) && cachedLeadCount >= 0) {
                paintSidebarCount("leads", cachedLeadCount, { singular: "open lead", plural: "open leads" });
                return;
            }
            paintSidebarCount("leads", null);
            return;
        }

        const serverVisibleSuppressionOptions = {
            ignoreServerVisibleStaleSuppression: true,
            nowMs: Date.now(),
        };
        const pendingRows = (Array.isArray(tasksData && tasksData.tasks)
            ? tasksData.tasks.map(normalizeLeadRowForCount)
            : []).filter(function(r) { return !isLeadRowSuppressed(r, suppressedKeys, serverVisibleSuppressionOptions); });
        const interestedRowsRaw = (Array.isArray(interestedLeadsData && interestedLeadsData.leads)
            ? interestedLeadsData.leads.map(normalizeLeadRowForCount)
            : []).filter(function(r) { return !isLeadRowSuppressed(r, suppressedKeys, serverVisibleSuppressionOptions); });
        const interestedRows = filterInterestedRowsForCount(interestedRowsRaw, pendingRows);
        const total = dedupeLeadRowsForCount([].concat(pendingRows, interestedRows)).length;
        const cachedLeadCount = readCachedSidebarCount("leads");
        if (!isLiveLeadsPage && total <= 0 && Number.isFinite(cachedLeadCount) && cachedLeadCount > 0) {
            sidebarLeadsZeroSnapshotStreak += 1;
            if (sidebarLeadsZeroSnapshotStreak <= 2) {
                paintSidebarCount("leads", cachedLeadCount, { singular: "open lead", plural: "open leads" });
                return;
            }
        } else {
            sidebarLeadsZeroSnapshotStreak = 0;
        }
        paintSidebarCount("leads", total, { singular: "open lead", plural: "open leads" });
    }

    async function refreshSidebarAgendaCount() {
        const badge = getSidebarCountBadge("agenda");
        if (!badge) return;

        const appointmentsData = await fetchJsonNoStore("/api/agenda/appointments?limit=400");
        if (!appointmentsData) {
            const cachedAgendaCount = readCachedSidebarCount("agenda");
            if (Number.isFinite(cachedAgendaCount) && cachedAgendaCount >= 0) {
                paintSidebarCount("agenda", cachedAgendaCount, { singular: "afspraak", plural: "afspraken" });
                return;
            }
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

        const cachedActiveOrdersCount = readCachedSidebarCount("active_orders");
        if (Number.isFinite(cachedActiveOrdersCount) && cachedActiveOrdersCount >= 0) {
            paintSidebarCount("active_orders", cachedActiveOrdersCount, {
                singular: "actieve opdracht",
                plural: "actieve opdrachten",
            });
            return;
        }

        paintSidebarCount("active_orders", null);
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
        const pathName = String((window.location && window.location.pathname) || "").trim().toLowerCase();
        const isLiveLeadsPage = isLeadsPagePath(pathName);
        const cachedLeadCount = readCachedSidebarCount("leads");
        const cachedAgendaCount = readCachedSidebarCount("agenda");
        const cachedActiveOrdersCount = readCachedSidebarCount("active_orders");
        const paintedFromCacheKeys = [];
        if (Number.isFinite(cachedActiveOrdersCount) && cachedActiveOrdersCount >= 0) {
            paintSidebarCount("active_orders", cachedActiveOrdersCount, {
                singular: "actieve opdracht",
                plural: "actieve opdrachten",
            });
            paintedFromCacheKeys.push("active_orders");
        }
        if (Number.isFinite(cachedAgendaCount) && cachedAgendaCount >= 0) {
            paintSidebarCount("agenda", cachedAgendaCount, {
                singular: "afspraak",
                plural: "afspraken",
            });
            paintedFromCacheKeys.push("agenda");
        }
        if (Number.isFinite(cachedLeadCount) && cachedLeadCount >= 0) {
            paintSidebarCount("leads", cachedLeadCount, { singular: "open lead", plural: "open leads" });
            paintedFromCacheKeys.push("leads");
        }
        const sidebar = document.querySelector(".sidebar");
        refreshSidebarNotificationCounts();
        window.setInterval(refreshSidebarNotificationCounts, 45000);
        window.addEventListener("focus", refreshSidebarNotificationCounts);
        window.addEventListener("pageshow", refreshSidebarNotificationCounts);
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) return;
            refreshSidebarNotificationCounts();
        });
    }

    function forceLightTheme() {
        root.setAttribute("data-theme-mode", "light");
        root.setAttribute("data-theme", "light");
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
    window.SoftoraPersonnelTheme.refreshPremiumSession = function refreshPremiumSession() {
        return loadPremiumSession({ force: true });
    };

    initSoftoraDialogs();
    applyUnifiedPremiumSidebar();
    if (isPremiumPersonnelContext) {
        window.addEventListener("hashchange", refreshPremiumStaticSidebarActiveState);
    }
    neutralizeSidebarAnchors();
    if (isPremiumPersonnelContext && premiumSessionSnapshot) {
        applyPremiumSidebarProfile(premiumSessionSnapshot);
    }
    initPremiumSidebarProfile();
    initSidebarNotificationCounts();
    forceLightTheme();
    syncThemeButtonsToLight();
})();
