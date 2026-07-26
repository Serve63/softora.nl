(function (global) {
    "use strict";

    // V1 blijft bewust bestaan als compatibiliteitswaarde voor opgeslagen jobs
    // en server-side herstelpaden, maar is niet meer beschikbaar in de normale UI.
    const V1_VARIANT = "v1-prompt-only";
    const V2_VARIANT = "v2-visual-dna";

    function choose() {
        return Promise.resolve(V2_VARIANT);
    }

    global.SoftoraDatabaseWebdesignVariantPicker = {
        V1_VARIANT: V1_VARIANT,
        V2_VARIANT: V2_VARIANT,
        choose: choose
    };
})(typeof window !== "undefined" ? window : globalThis);
