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

            return {
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
