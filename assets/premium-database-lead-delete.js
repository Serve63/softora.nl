(function (global) {
    "use strict";

    const STYLE_ID = "softora-database-lead-delete-style";
    const ACTION_PROPERTY = "__SoftoraDatabaseLeadDeleteActionV1";
    const BOUND_PROPERTY = "__SoftoraDatabaseLeadDeleteBoundV1";

    function normalizeString(value) {
        return String(value || "").trim();
    }

    function getErrorMessage(error) {
        return String(error && error.message || "onbekende fout");
    }

    function getCustomerLabel(customer) {
        return normalizeString(customer && (customer.bedrijf || customer.company || customer.naam || customer.name)) || "deze lead";
    }

    function defaultConfirmDelete(customer) {
        if (typeof global.confirm !== "function") return true;
        return global.confirm(getCustomerLabel(customer) + " helemaal verwijderen uit het mailsysteem?\n\nDe lead zelf wordt verwijderd, niet alleen het design.");
    }

    function isInstantlyCustomer(customer) {
        return normalizeString(customer && customer.lastColdmailProvider).toLowerCase() === "instantly" ||
            Boolean(normalizeString(customer && (customer.instantlyLeadId || customer.instantlyCampaignId)));
    }

    function defaultConfirmRemoveDesign(customer) {
        if (typeof global.confirm !== "function") return true;
        const label = getCustomerLabel(customer);
        return global.confirm("Alleen het design van " + label + " verwijderen?\n\nDe lead blijft bewaard en komt terug onder Beschikbaar." +
            (isInstantlyCustomer(customer) ? "\n\nLet op: " + label + " staat al in Instantly en de mail linkt naar dit design." : ""));
    }

    function ensureStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ".lead-delete-button{flex:0 0 18px;width:18px;height:34px;border:0;background:transparent;color:var(--crimson);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;opacity:.74}.lead-delete-button:hover,.lead-delete-button:focus-visible{color:#c0392b;opacity:1}.lead-delete-icon{width:12px;height:12px}";
        global.document.head.appendChild(style);
    }

    function createController(options) {
        const state = options.state;
        const deleteCustomerLead = typeof options.deleteCustomerLead === "function" ? options.deleteCustomerLead : null;
        const persistCustomerList = options.persistCustomerList;
        const persistCustomerPhotos = typeof options.persistCustomerPhotos === "function" ? options.persistCustomerPhotos : async function () { return { ok: true }; };
        const sortCustomers = typeof options.sortCustomers === "function" ? options.sortCustomers : function (customers) { return (customers || []).slice(); };
        const closePanel = typeof options.closePanel === "function" ? options.closePanel : function () {};
        const closeModal = typeof options.closeModal === "function" ? options.closeModal : function () {};
        const setStatusMessage = typeof options.setStatusMessage === "function" ? options.setStatusMessage : function () {};
        const renderPage = typeof options.renderPage === "function" ? options.renderPage : function () {};
        const toast = typeof options.toast === "function" ? options.toast : function () {};
        const confirmDeleteLead = typeof options.confirmDeleteLead === "function" ? options.confirmDeleteLead : defaultConfirmDelete;
        // Rows with a design: the × removes only the design, never the whole lead by surprise.
        const removeDesign = typeof options.removeCustomerDesign === "function" ? options.removeCustomerDesign : null;
        const hasCustomerDesign = typeof options.hasCustomerDesign === "function" ? options.hasCustomerDesign : function () { return false; };
        const confirmRemoveDesign = typeof options.confirmRemoveDesign === "function" ? options.confirmRemoveDesign : defaultConfirmRemoveDesign;
        const removingIds = new Set();

        ensureStyles();
        global[ACTION_PROPERTY] = removeCustomerLead;
        bindClickHandler();

        async function removeCustomerLead(customerId) {
            const normalizedId = normalizeString(customerId);
            if (!normalizedId || removingIds.has(normalizedId) || !state || !Array.isArray(state.klanten)) return;
            const existing = state.klanten.find(function (item) {
                return normalizeString(item && item.id) === normalizedId;
            });
            if (!existing) return;
            if (removeDesign && hasCustomerDesign(existing)) return removeCustomerDesign(normalizedId);
            if (!deleteCustomerLead && typeof persistCustomerList !== "function") {
                setStatusMessage("Lead verwijderen is tijdelijk niet beschikbaar.", "error");
                return;
            }
            if (!confirmDeleteLead(existing)) return;

            removingIds.add(normalizedId);
            const previousCustomers = state.klanten.slice();
            const previousSnapshotState = {
                mailReadySnapshotCustomers: Array.isArray(state.mailReadySnapshotCustomers) ? state.mailReadySnapshotCustomers.slice() : null,
                mailReadySnapshotTotal: state.mailReadySnapshotTotal,
                availableSnapshotCustomers: Array.isArray(state.availableSnapshotCustomers) ? state.availableSnapshotCustomers.slice() : null,
                availableSnapshotTotal: state.availableSnapshotTotal
            };
            function removeFromSnapshot(listKey, totalKey) {
                if (!Array.isArray(state[listKey])) return;
                const previousList = state[listKey];
                const nextList = previousList.filter(function (item) {
                    return normalizeString(item && item.id) !== normalizedId;
                });
                const removedCount = previousList.length - nextList.length;
                state[listKey] = nextList;
                if (removedCount && Number.isFinite(Number(state[totalKey]))) {
                    state[totalKey] = Math.max(nextList.length, Number(state[totalKey]) - removedCount);
                }
            }
            function restoreSnapshotState() {
                if (previousSnapshotState.mailReadySnapshotCustomers) state.mailReadySnapshotCustomers = previousSnapshotState.mailReadySnapshotCustomers;
                if (previousSnapshotState.availableSnapshotCustomers) state.availableSnapshotCustomers = previousSnapshotState.availableSnapshotCustomers;
                state.mailReadySnapshotTotal = previousSnapshotState.mailReadySnapshotTotal;
                state.availableSnapshotTotal = previousSnapshotState.availableSnapshotTotal;
            }
            state.klanten = sortCustomers(state.klanten.filter(function (item) {
                return normalizeString(item && item.id) !== normalizedId;
            }));
            removeFromSnapshot("mailReadySnapshotCustomers", "mailReadySnapshotTotal");
            removeFromSnapshot("availableSnapshotCustomers", "availableSnapshotTotal");
            if (state.openId === normalizedId) closePanel();
            if (state.modalEditId === normalizedId) closeModal();
            renderPage();

            if (deleteCustomerLead) {
                try {
                    const result = await deleteCustomerLead(normalizedId);
                    if (!result || !result.ok) throw result && result.error;
                    removingIds.delete(normalizedId);
                    toast("Lead verwijderd");
                    setStatusMessage("Lead verwijderd.", "success", true);
                    return;
                } catch (error) {
                    state.klanten = previousCustomers;
                    restoreSnapshotState();
                    renderPage();
                    setStatusMessage("Lead verwijderen mislukt: " + getErrorMessage(error), "error");
                    removingIds.delete(normalizedId);
                    return;
                }
            }

            try {
                const result = await persistCustomerList(state.klanten);
                if (!result || !result.ok) throw result && result.error;
            } catch (error) {
                state.klanten = previousCustomers;
                restoreSnapshotState();
                renderPage();
                setStatusMessage("Lead verwijderen mislukt: " + getErrorMessage(error), "error");
                removingIds.delete(normalizedId);
                return;
            }

            removingIds.delete(normalizedId);
            try {
                const photoResult = await persistCustomerPhotos(state.klanten, { removeCustomerIds: [normalizedId] });
                if (!photoResult || !photoResult.ok) throw photoResult && photoResult.error;
                toast("Lead verwijderd");
                setStatusMessage("Lead verwijderd.", "success", true);
                return;
            } catch (error) {
                setStatusMessage("Lead verwijderd, maar foto-opslag opruimen mislukte: " + getErrorMessage(error), "error");
            }
        }

        async function removeCustomerDesign(customerId) {
            const normalizedId = normalizeString(customerId);
            const existing = normalizedId && state && Array.isArray(state.klanten) ? state.klanten.find(function (item) {
                return normalizeString(item && item.id) === normalizedId;
            }) : null;
            if (!existing || !removeDesign || removingIds.has(normalizedId) || !confirmRemoveDesign(existing)) return;
            removingIds.add(normalizedId);
            try {
                await removeDesign(normalizedId);
            } finally {
                removingIds.delete(normalizedId);
            }
        }

        return {
            removeCustomerDesign: removeCustomerDesign,
            removeCustomerLead: removeCustomerLead
        };
    }

    function bindClickHandler() {
        if (!global.document || typeof global.document.addEventListener !== "function" || global.document[BOUND_PROPERTY]) return;
        global.document[BOUND_PROPERTY] = true;
        global.document.addEventListener("click", function (event) {
            const target = event && event.target;
            const button = target && typeof target.closest === "function" ? target.closest(".lead-delete-button") : null;
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            const action = global[ACTION_PROPERTY];
            if (typeof action === "function") void action(button.getAttribute("data-delete-lead-id"));
        }, true);
    }

    global.SoftoraDatabaseLeadDelete = {
        createController: createController
    };
})(window);
