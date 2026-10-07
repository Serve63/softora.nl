(function (global) {
    "use strict";

    global.SoftoraDatabaseWebdesignSourceSelection = {
        createController: function (options) {
            const getSortedCustomers = options.getSortedCustomers;
            const getFilteredCustomers = options.getFilteredCustomers;
            const isWebdesignPhotoEligible = options.isWebdesignPhotoEligible;
            const sourceFilter = options.sourceFilter;

            function getEligibleTargets() {
                return getSortedCustomers(getFilteredCustomers()).filter(isWebdesignPhotoEligible);
            }

            function filterTargets(targets, source) {
                if (source === "searcher") return targets.filter(sourceFilter.isSearcherTransferCustomer);
                if (source === "robot") return targets.filter(sourceFilter.isRobotTransferCustomer);
                return targets;
            }

            function showDeferredSources(excluded) {
                const banner = options.statusBanner;
                if (!banner || !global.document) return;
                let detail = global.document.getElementById("webdesignSourceDeferrals");
                if (detail) detail.remove();
                if (!excluded.length) return;
                detail = global.document.createElement("details");
                detail.id = "webdesignSourceDeferrals";
                detail.className = "status-banner is-visible";
                detail.dataset.tone = "info";
                const summary = global.document.createElement("summary");
                summary.textContent = excluded.length + " bedrijven tijdelijk overgeslagen vanwege een eerdere websitefout. Bekijk redenen en herprobeertijden.";
                detail.appendChild(summary);
                const list = global.document.createElement("ul");
                excluded.forEach(function (item) {
                    const line = global.document.createElement("li");
                    line.textContent = item.company + ": " + item.reason + " Opnieuw in bulk vanaf " + new Date(item.retryAt).toLocaleString("nl-NL") + ". Een aangepast websiteadres kan direct opnieuw mee.";
                    list.appendChild(line);
                });
                detail.appendChild(list);
                banner.insertAdjacentElement("afterend", detail);
            }

            async function getTargetsForBatch(limit, source) {
                const candidates = Array.isArray(limit) ? limit.filter(Boolean) : filterTargets(getEligibleTargets(), source);
                const parsedLimit = Math.floor(Number(limit));
                const wanted = !Array.isArray(limit) && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : candidates.length;
                const targets = [], excluded = [];
                const request = options.requestJson || async function (items) {
                    const response = await global.SoftoraDatabaseResilience.fetchJsonWithTimeout("/api/premium-database/webdesign-photo-source-selection", {
                        method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets: items })
                    }, 15000);
                    const payload = await response.json();
                    if (!response.ok || !payload.ok) throw new Error(payload.error || "Eerdere websitefouten controleren is mislukt. Er is geen batch gestart.");
                    return payload;
                };
                for (let offset = 0; offset < candidates.length && targets.length < wanted;) {
                    const part = candidates.slice(offset, offset + Math.min(250, wanted - targets.length));
                    offset += part.length;
                    const items = part.map(function (customer) { return { customerId: customer.id, websiteUrl: options.resolveCustomerWebsiteUrl(customer) }; });
                    const result = await request(items);
                    if (!Array.isArray(result.targets) || result.targets.length !== items.length || result.targets.some(function (item, index) {
                        return !item || item.customerId !== items[index].customerId || item.websiteUrl !== items[index].websiteUrl || typeof item.eligible !== "boolean" ||
                            (!item.eligible && (!item.reason || !Number.isFinite(item.retryAt)));
                    })) throw new Error("De controle van eerdere websitefouten is onvolledig. Er is geen batch gestart.");
                    result.targets.forEach(function (item, index) {
                        if (item.eligible) targets.push(part[index]);
                        else excluded.push(Object.assign({}, item, { company: part[index].bedrijf || part[index].naam || part[index].id }));
                    });
                }
                showDeferredSources(excluded);
                return { targets: targets, excluded: excluded };
            }

            return {
                getTargetsForBatch: getTargetsForBatch,
                getTargets: function (limit, source) {
                    const targets = filterTargets(getEligibleTargets(), source);
                    const parsedLimit = Math.floor(Number(limit));
                    return Number.isFinite(parsedLimit) && parsedLimit > 0
                        ? targets.slice(0, Math.min(parsedLimit, targets.length))
                        : targets;
                },
                getSourceCounts: function () {
                    const targets = getEligibleTargets();
                    return {
                        all: targets.length,
                        searcher: filterTargets(targets, "searcher").length,
                        robot: filterTargets(targets, "robot").length
                    };
                }
            };
        }
    };
})(window);
