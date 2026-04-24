(function () {
    const customSelectInstances = new Map();
    const serviceLockOptionValues = new Set(["voice_software", "business_software", "ai_chatbots"]);
    const serviceLockMarkup =
        '<span class="sidebar-link-lock" aria-hidden="true">' +
        '<svg class="sidebar-link-lock-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
        '<rect x="5" y="11" width="14" height="11" rx="2" ry="2"/>' +
        '</svg></span>';

    function escapeCssIdentifier(value) {
        return String(value || "").replace(/([^\w-])/g, "\\$1");
    }

    function parsePixelValue(value, fallback) {
        const parsed = Number.parseFloat(String(value || "").trim());
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function formatPixels(value, fallback) {
        const parsed = parsePixelValue(value, fallback);
        return Number.isFinite(parsed) ? `${parsed}px` : `${fallback}px`;
    }

    function resolveFirstNonEmpty(values, fallback) {
        for (const candidate of values) {
            const normalized = String(candidate || "").trim();
            if (normalized && normalized !== "transparent" && normalized !== "rgba(0, 0, 0, 0)") {
                return normalized;
            }
        }
        return fallback;
    }

    function collectSelects(root, result) {
        if (!root || !result) {
            return;
        }

        if (root instanceof HTMLSelectElement) {
            result.add(root);
            return;
        }

        if (root.querySelectorAll) {
            root.querySelectorAll("select").forEach((select) => result.add(select));
        }
    }

    function isEnhanceableSelect(select) {
        if (!(select instanceof HTMLSelectElement)) {
            return false;
        }
        if (!select.isConnected) {
            return false;
        }
        if (select.multiple || Number(select.size) > 1) {
            return false;
        }
        if (String(select.dataset.nativeSelect || "").trim() === "true") {
            return false;
        }
        return Boolean(String(select.dataset.selectVariant || "").trim() || String(select.dataset.customSelect || "").trim() === "true");
    }

    function closeAllCustomSelects(exceptWrapper = null) {
        customSelectInstances.forEach((instance, select) => {
            if (!select.isConnected || !instance.wrapper.isConnected) {
                customSelectInstances.delete(select);
                return;
            }
            if (instance.wrapper !== exceptWrapper) {
                instance.close(false);
            }
        });
    }

    function initCustomFormSelect(select) {
        if (!isEnhanceableSelect(select)) {
            return null;
        }

        const existingInstance = customSelectInstances.get(select);
        if (existingInstance) {
            existingInstance.refresh();
            return existingInstance;
        }

        const existingWrapper = select.parentElement && select.parentElement.classList.contains("site-select")
            ? select.parentElement
            : null;

        if (
            select.dataset.customUiReady === "1" &&
            existingWrapper &&
            typeof select.__softoraSyncCustomFormSelect === "function" &&
            !existingWrapper.__softoraCustomSelectInstance
        ) {
            select.__softoraSyncCustomFormSelect();
            return null;
        }

        if (existingWrapper && existingWrapper.__softoraCustomSelectInstance) {
            existingWrapper.__softoraCustomSelectInstance.refresh();
            return existingWrapper.__softoraCustomSelectInstance;
        }

        select.dataset.customUiReady = "1";

        const wrapper = document.createElement("div");
        wrapper.className = "site-select";

        const selectVariant = String(select.dataset.selectVariant || "").trim().toLowerCase();
        if (selectVariant === "pill") {
            wrapper.classList.add("site-select--pill");
        }

        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "site-select-trigger";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        if (select.classList.contains("magnetic")) {
            trigger.classList.add("magnetic");
        }

        const valueEl = document.createElement("span");
        valueEl.className = "site-select-value";
        trigger.appendChild(valueEl);

        const menu = document.createElement("div");
        menu.className = "site-select-menu";
        menu.setAttribute("role", "listbox");

        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);
        wrapper.appendChild(trigger);
        wrapper.appendChild(menu);
        wrapper.__softoraCustomSelectInstance = null;
        select.classList.add("site-select-native");
        select.tabIndex = -1;
        select.setAttribute("aria-hidden", "true");

        const optionButtons = [];

        function close(returnFocus) {
            wrapper.classList.remove("is-open");
            trigger.setAttribute("aria-expanded", "false");
            if (returnFocus) {
                trigger.focus();
            }
        }

        function open() {
            if (trigger.disabled) {
                return;
            }

            closeAllCustomSelects(wrapper);
            wrapper.classList.add("is-open");
            trigger.setAttribute("aria-expanded", "true");

            const selectedButton = optionButtons.find((button) => button.classList.contains("is-selected") && !button.disabled);
            const firstEnabled = optionButtons.find((button) => !button.disabled);
            const focusTarget = selectedButton || firstEnabled;

            window.requestAnimationFrame(() => {
                if (focusTarget) {
                    focusTarget.focus();
                    focusTarget.scrollIntoView({ block: "nearest" });
                }
            });
        }

        function syncPresentationFromSelect() {
            const styles = window.getComputedStyle(select);
            const isPillVariant = wrapper.classList.contains("site-select--pill");

            wrapper.style.setProperty(
                "--site-select-focus-color",
                resolveFirstNonEmpty(
                    [
                        styles.getPropertyValue("--accent-light"),
                        styles.getPropertyValue("--accent-color"),
                        styles.borderColor,
                        styles.color,
                    ],
                    "#a62d65"
                )
            );
            wrapper.style.setProperty(
                "--site-select-menu-bg",
                resolveFirstNonEmpty(
                    [
                        styles.getPropertyValue("--bg-secondary"),
                        styles.getPropertyValue("--card"),
                        styles.backgroundColor,
                    ],
                    "#111"
                )
            );
            wrapper.style.setProperty("--site-select-menu-color", resolveFirstNonEmpty([styles.color], "inherit"));
            wrapper.style.setProperty(
                "--site-select-menu-border-color",
                resolveFirstNonEmpty(
                    [
                        styles.getPropertyValue("--accent-light"),
                        styles.getPropertyValue("--accent-color"),
                        styles.borderColor,
                    ],
                    "rgba(139, 34, 82, 0.24)"
                )
            );
            wrapper.style.setProperty(
                "--site-select-selected-color",
                resolveFirstNonEmpty(
                    [
                        styles.getPropertyValue("--accent-light"),
                        styles.getPropertyValue("--accent-color"),
                        styles.color,
                    ],
                    "#a62d65"
                )
            );

            if (isPillVariant) {
                wrapper.style.display = "inline-flex";
                wrapper.style.width = "auto";
                wrapper.style.minWidth = "";
                wrapper.style.maxWidth = "";
                trigger.disabled = Boolean(select.disabled);
                wrapper.classList.toggle("is-disabled", Boolean(select.disabled));
                return;
            }

            const display = String(styles.display || "").trim();
            const inlineLike = display === "inline" || display === "inline-block" || display === "inline-flex";
            wrapper.style.display = inlineLike ? "inline-block" : "block";
            wrapper.style.width = inlineLike ? styles.width : "100%";
            wrapper.style.minWidth = styles.minWidth && styles.minWidth !== "0px" ? styles.minWidth : "";
            wrapper.style.maxWidth = styles.maxWidth && styles.maxWidth !== "none" ? styles.maxWidth : "";

            trigger.style.fontFamily = styles.fontFamily;
            trigger.style.fontSize = styles.fontSize;
            trigger.style.fontWeight = styles.fontWeight;
            trigger.style.lineHeight = styles.lineHeight;
            trigger.style.letterSpacing = styles.letterSpacing;
            trigger.style.textTransform = styles.textTransform;
            trigger.style.color = styles.color;
            trigger.style.backgroundColor = resolveFirstNonEmpty(
                [
                    styles.backgroundColor,
                    styles.getPropertyValue("--field-bg"),
                    styles.getPropertyValue("--input-bg"),
                    styles.getPropertyValue("--bg-secondary"),
                ],
                "rgba(255, 255, 255, 0.03)"
            );
            trigger.style.borderColor = resolveFirstNonEmpty([styles.borderColor], "rgba(255, 255, 255, 0.08)");
            trigger.style.borderWidth = styles.borderWidth;
            trigger.style.borderStyle = styles.borderStyle;
            trigger.style.borderRadius = styles.borderRadius;
            trigger.style.minHeight = styles.height && styles.height !== "auto" ? styles.height : "";
            trigger.style.paddingTop = styles.paddingTop;
            trigger.style.paddingBottom = styles.paddingBottom;
            trigger.style.paddingLeft = styles.paddingLeft;
            trigger.style.paddingRight = formatPixels(Math.max(parsePixelValue(styles.paddingRight, 14), 40), 40);
            trigger.style.boxShadow = styles.boxShadow !== "none" ? styles.boxShadow : "";
            trigger.style.cursor = styles.cursor || "pointer";
            trigger.disabled = Boolean(select.disabled);

            wrapper.classList.toggle("is-disabled", Boolean(select.disabled));
            menu.style.borderRadius = styles.borderRadius;
            optionButtons.forEach((button) => {
                button.style.fontFamily = styles.fontFamily;
                button.style.fontSize = styles.fontSize;
                button.style.fontWeight = styles.fontWeight;
                button.style.letterSpacing = styles.letterSpacing;
                button.style.textTransform = styles.textTransform;
                button.style.cursor = styles.cursor || "pointer";
            });
        }

        function syncFromSelect() {
            const selectedOption = select.options[select.selectedIndex] || select.options[0] || null;
            valueEl.textContent = selectedOption ? selectedOption.textContent : "";

            const activeDotColor = String(
                (selectedOption && selectedOption.dataset && selectedOption.dataset.dotColor) ||
                select.dataset.dotColor ||
                ""
            ).trim().toLowerCase();

            if (activeDotColor) {
                wrapper.dataset.dotColor = activeDotColor;
            } else {
                delete wrapper.dataset.dotColor;
            }

            optionButtons.forEach((button) => {
                const isSelected = button.dataset.value === select.value;
                button.classList.toggle("is-selected", isSelected);
                button.setAttribute("aria-selected", isSelected ? "true" : "false");
            });

            syncPresentationFromSelect();
        }

        function renderOptions() {
            menu.innerHTML = "";
            optionButtons.length = 0;

            Array.from(select.options).forEach((option) => {
                const optionButton = document.createElement("button");
                optionButton.type = "button";
                optionButton.className = "site-select-option";
                optionButton.dataset.value = option.value;
                optionButton.setAttribute("role", "option");
                optionButton.disabled = option.disabled;
                optionButton.tabIndex = -1;

                const rawLabel = String(option.textContent || "")
                    .trim()
                    .replace(/^\uD83D\uDD12\s*/u, "")
                    .replace(/^🔒\s*/u, "")
                    .trim();
                const useServiceLockSvg =
                    option.disabled &&
                    wrapper.classList.contains("site-select--pill") &&
                    serviceLockOptionValues.has(String(option.value || "").trim());

                if (useServiceLockSvg) {
                    optionButton.classList.add("site-select-option--locked");
                    optionButton.innerHTML = `${serviceLockMarkup}<span class="site-select-option-label"></span>`;
                    optionButton.querySelector(".site-select-option-label").textContent = rawLabel;
                } else {
                    optionButton.textContent = String(option.textContent || "").trim();
                }

                if (!option.disabled) {
                    optionButton.addEventListener("click", () => {
                        const forceChangeValue = String(select.dataset.forceChangeValue || "").trim();
                        const shouldForceChange = forceChangeValue && option.value === forceChangeValue;

                        if (select.value !== option.value) {
                            select.value = option.value;
                            select.dispatchEvent(new Event("change", { bubbles: true }));
                        } else if (shouldForceChange) {
                            select.dispatchEvent(new Event("change", { bubbles: true }));
                        }

                        syncFromSelect();
                        close(true);
                    });
                }

                menu.appendChild(optionButton);
                optionButtons.push(optionButton);
            });

            syncPresentationFromSelect();
        }

        function bindLinkedLabels() {
            if (!select.id) {
                return;
            }

            document
                .querySelectorAll(`label[for="${escapeCssIdentifier(select.id)}"]`)
                .forEach((label) => {
                    if (label.dataset.customSelectBound === select.id) {
                        return;
                    }
                    label.dataset.customSelectBound = select.id;
                    label.addEventListener("click", (event) => {
                        if (trigger.disabled) {
                            return;
                        }
                        event.preventDefault();
                        trigger.focus();
                        open();
                    });
                });
        }

        if (select.id === "regio") {
            const regioTip = document.getElementById("campaignRegioTip");
            if (regioTip) {
                trigger.appendChild(regioTip);
                ["mousedown", "click"].forEach((eventName) => {
                    regioTip.addEventListener(eventName, (event) => {
                        event.stopPropagation();
                    });
                });
                regioTip.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                    }
                });
            }
        }

        trigger.addEventListener("click", () => {
            if (wrapper.classList.contains("is-open")) {
                close(false);
            } else {
                open();
            }
        });

        trigger.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                open();
            }

            if (event.key === "Escape") {
                event.preventDefault();
                close(false);
            }
        });

        menu.addEventListener("keydown", (event) => {
            const enabledButtons = optionButtons.filter((button) => !button.disabled);
            const currentIndex = enabledButtons.indexOf(document.activeElement);

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!enabledButtons.length) {
                    return;
                }
                const direction = event.key === "ArrowDown" ? 1 : -1;
                const nextIndex = currentIndex < 0
                    ? 0
                    : (currentIndex + direction + enabledButtons.length) % enabledButtons.length;
                enabledButtons[nextIndex].focus();
                return;
            }

            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (document.activeElement && menu.contains(document.activeElement)) {
                    document.activeElement.click();
                }
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                close(true);
                return;
            }

            if (event.key === "Tab") {
                close(false);
            }
        });

        select.addEventListener("change", syncFromSelect);
        select.addEventListener("focus", () => {
            trigger.focus();
        });
        if (select.form) {
            select.form.addEventListener("reset", () => {
                window.setTimeout(syncFromSelect, 0);
            });
        }

        renderOptions();
        bindLinkedLabels();
        syncFromSelect();

        const instance = {
            select,
            wrapper,
            trigger,
            menu,
            close,
            open,
            refresh() {
                renderOptions();
                bindLinkedLabels();
                syncFromSelect();
            },
        };

        wrapper.__softoraCustomSelectInstance = instance;
        select.__softoraSyncCustomFormSelect = syncFromSelect;
        select.__softoraRefreshCustomFormSelect = instance.refresh;
        customSelectInstances.set(select, instance);
        return instance;
    }

    function initCustomFormSelects(root = document) {
        const selects = new Set();
        collectSelects(root, selects);

        selects.forEach((select) => {
            if (!isEnhanceableSelect(select)) {
                return;
            }
            const existingInstance = customSelectInstances.get(select);
            if (existingInstance) {
                existingInstance.refresh();
                return;
            }
            if (select.dataset.customUiReady === "1" && typeof select.__softoraRefreshCustomFormSelect === "function") {
                select.__softoraRefreshCustomFormSelect();
                return;
            }
            if (select.dataset.customUiReady === "1" && typeof select.__softoraSyncCustomFormSelect === "function") {
                select.__softoraSyncCustomFormSelect();
                return;
            }
            initCustomFormSelect(select);
        });
    }

    function refreshCustomFormSelects() {
        customSelectInstances.forEach((instance, select) => {
            if (!select.isConnected || !instance.wrapper.isConnected) {
                customSelectInstances.delete(select);
                return;
            }
            instance.refresh();
        });
    }

    document.addEventListener("click", (event) => {
        customSelectInstances.forEach((instance) => {
            if (!instance.wrapper.contains(event.target)) {
                instance.close(false);
            }
        });
    });

    window.addEventListener("resize", () => {
        refreshCustomFormSelects();
    });

    if (typeof MutationObserver === "function") {
        const observer = new MutationObserver((mutations) => {
            const selectsToInit = new Set();
            const selectsToRefresh = new Set();

            mutations.forEach((mutation) => {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach((node) => {
                        collectSelects(node, selectsToInit);
                    });

                    if (mutation.target instanceof HTMLSelectElement) {
                        selectsToRefresh.add(mutation.target);
                    } else if (mutation.target && mutation.target.closest) {
                        const targetSelect = mutation.target.closest("select");
                        if (targetSelect) {
                            selectsToRefresh.add(targetSelect);
                        }
                    }
                    return;
                }

                if (mutation.type === "attributes") {
                    if (mutation.target instanceof HTMLSelectElement) {
                        selectsToRefresh.add(mutation.target);
                        return;
                    }
                    if (mutation.target instanceof HTMLOptionElement && mutation.target.parentElement instanceof HTMLSelectElement) {
                        selectsToRefresh.add(mutation.target.parentElement);
                    }
                }
            });

            selectsToInit.forEach((select) => initCustomFormSelect(select));
            selectsToRefresh.forEach((select) => {
                const instance = customSelectInstances.get(select);
                if (instance) {
                    instance.refresh();
                } else {
                    initCustomFormSelect(select);
                }
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["disabled", "label", "selected", "data-dot-color"],
        });
    }

    window.initCustomFormSelects = initCustomFormSelects;
    window.refreshCustomFormSelects = refreshCustomFormSelects;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            initCustomFormSelects(document);
        }, { once: true });
    } else {
        initCustomFormSelects(document);
    }
})();
