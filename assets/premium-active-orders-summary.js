(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SoftoraActiveOrdersSummary = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function classifyActiveOrderProductLine(order) {
        const hay = `${String(order?.title || '')} ${String(order?.description || '')}`.toLowerCase();
        if (!hay.trim()) return 'other';
        if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot|conversational\s*bot/.test(hay)) return 'chatbot';
        if (
            /voicesoftware|voice\s*software|voice_software|spraaksoftware|belsoftware|telefon(y|ie)|voice\s*agent|ai\s*voice|spraak\s*agent/.test(
                hay
            )
        ) {
            return 'voice';
        }
        if (/bedrijfssoftware|business\s*software|business_software|\bcrm\b|\berp\b/.test(hay)) {
            return 'business';
        }
        return 'other';
    }

    function summarize(orderIds, { orders, getCustomOrderById, resolveOrderUiState }) {
        const summary = { total: 0, business: 0, voice: 0, chatbot: 0 };
        orderIds.forEach((id) => {
            const runtime = orders[id];
            if (!runtime || resolveOrderUiState(runtime).isBuilt) return;
            summary.total += 1;
            const productLine = classifyActiveOrderProductLine(getCustomOrderById(id) || runtime);
            if (productLine !== 'other') summary[productLine] += 1;
        });
        return summary;
    }

    return Object.freeze({ summarize });
});
