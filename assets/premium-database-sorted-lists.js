(function (global) {
    "use strict";

    function create(sortRows) {
        if (typeof sortRows !== "function") throw new TypeError("Een afstandssorteerder is vereist.");
        const sortedLists = new WeakSet();

        function sort(rows) {
            const result = sortRows(Array.isArray(rows) ? rows : []);
            if (!Array.isArray(result)) throw new TypeError("Afstandssortering gaf geen lijst terug.");
            sortedLists.add(result);
            return result;
        }

        function sorted(rows) {
            return Array.isArray(rows) && sortedLists.has(rows) ? rows : sort(rows);
        }

        function filter(rows, predicate) {
            const source = Array.isArray(rows) ? rows : [];
            const result = source.filter(predicate);
            if (sortedLists.has(source)) sortedLists.add(result);
            return result;
        }

        return Object.freeze({ sort, sorted, filter });
    }

    const api = Object.freeze({ create });
    global.SoftoraDatabaseSortedLists = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
