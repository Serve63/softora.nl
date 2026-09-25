(function (global) {
    "use strict";

    // V2 is de enige webdesigngenerator; de server voert ook oude V1-jobs als V2 uit.
    const V2_VARIANT = "v2-visual-dna";

    function choose() {
        return Promise.resolve(V2_VARIANT);
    }

    global.SoftoraDatabaseWebdesignVariantPicker = {
        V2_VARIANT: V2_VARIANT,
        choose: choose
    };
})(typeof window !== "undefined" ? window : globalThis);
