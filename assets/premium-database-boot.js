(function (global) {
    "use strict";

    async function run(options) {
        const { state, databaseHadBootstrapCustomers, databaseHasFastSnapshotBootstrap, loadMailReadySnapshot, bootstrapCustomers, loadCustomerPhotoMap, applyCustomerList, mergeCustomersWithPhotos, renderPage, webdesignActionController, getSortedCustomers, getFilteredCustomers, releaseDatabaseBootShell, databasePendingJobsPromise, databaseImportController } = options;
        const snapshotClient = options.snapshotClient || global.SoftoraDatabaseMailReadySnapshot;
        return (async function () {
            try {
                state.photoRestorePending = true; const mailReadySnapshotPromise = loadMailReadySnapshot(); if (databaseHadBootstrapCustomers && state.klanten.length && !databaseHasFastSnapshotBootstrap) { const canonicalCustomersPromise = bootstrapCustomers({ skipPhotoRestore: true }); await mailReadySnapshotPromise; await canonicalCustomersPromise; if (!(state.canonicalInventoryReady && state.mailReadySnapshotLoaded && state.availableSnapshotLoaded)) try { const photoMap = await loadCustomerPhotoMap(state.klanten, { force: true, failOnError: true, requireStateKey: true, failOnIncomplete: true }); applyCustomerList(snapshotClient.mergeAssetFlags(mergeCustomersWithPhotos(state.klanten, photoMap, state.klanten), state.mailReadySnapshotCustomers, state.availableSnapshotCustomers), false); } catch (error) { state.photoRestoreFailed = true; applyCustomerList(snapshotClient.mergeAssetFlags(state.klanten, state.mailReadySnapshotCustomers, state.availableSnapshotCustomers), false); console.warn("Databasefoto's laden voor boot tijdelijk overgeslagen:", error); } } else { const canonicalCustomersPromise = bootstrapCustomers({ skipPhotoRestore: true }); await mailReadySnapshotPromise; await canonicalCustomersPromise; }
                if (!snapshotClient.markCanonicalInventoryReady(state)) throw new Error("Volledige databasevoorraad is niet geladen."); renderPage(); await webdesignActionController.preloadPhotoImages(getSortedCustomers(getFilteredCustomers()), 16, 1200); state.photoRestorePending = false; renderPage(); releaseDatabaseBootShell(); void databasePendingJobsPromise.catch(function (error) { console.error("Websitefoto jobs hervatten mislukt:", error); });
                void databaseImportController.startAutoSync();
            } catch (error) { console.error("Database bootstrap mislukt:", error); state.photoRestoreFailed = true; state.photoRestorePending = false; if (!state.canonicalInventoryReady) { state.dataLoading = false; state.dataUnavailable = true; } renderPage(); } finally { releaseDatabaseBootShell(); }
        })();
    }

    const api = { run: run };
    global.SoftoraDatabaseBoot = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
