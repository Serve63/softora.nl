(function () {
    const OPEN_LEAD_CACHE_MS = 45000;
    let openLeadOptions = [];
    let openLeadOptionsLoadedAt = 0;
    let openLeadOptionsPromise = null;

    function appendTextElement(parent, tagName, className, text) {
        const el = document.createElement(tagName);
        if (className) el.className = className;
        el.textContent = text;
        parent.appendChild(el);
        return el;
    }

    function formatAgendaLeadDateTimeLabel(dateValue, timeValue) {
        const date = String(dateValue || '').trim();
        const time = String(timeValue || '').trim() || '09:00';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
        const parsed = new Date(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '09:00'}:00`);
        if (Number.isNaN(parsed.getTime())) return `${date} ${time}`;
        return parsed.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function compareAgendaLeadOptions(a, b) {
        const aTs = Date.parse(`${String(a?.date || '1970-01-01')}T${String(a?.time || '00:00')}:00`) || 0;
        const bTs = Date.parse(`${String(b?.date || '1970-01-01')}T${String(b?.time || '00:00')}:00`) || 0;
        if (aTs === bTs) return Number(b?.id || 0) - Number(a?.id || 0);
        return bTs - aTs;
    }

    function normalizeLeadFollowUpStatus(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    }

    function resolveOpenLeadProductLine(item) {
        const hay = [
            item?.leadType,
            item?.title,
            item?.company,
            item?.summary,
            item?.conversationSummary,
            item?.coldcallingStack,
            item?.coldcallingStackLabel,
            item?.providerLabel,
            item?.source
        ].map((value) => String(value || '').toLowerCase()).join(' ');
        const isManualPrivate = /\bmanual-(?:overig|serve|martijn|both)\b|legenda:\s*manual-/.test(hay);
        if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot|conversational\s*bot/.test(hay)) return 'chatbot';
        if (/voicesoftware|voice\s*software|voice_software|spraaksoftware|belsoftware|telefon(y|ie)|voice\s*agent|ai\s*voice/.test(hay)) return 'voice';
        if (/bedrijfssoftware|business\s*software|business_software|\bcrm\b|\berp\b|legenda:\s*business/.test(hay)) return 'business';
        if (/website|webdesign|web\s*site|premium\s*web|legenda:\s*website/.test(hay)) return 'website';
        return isManualPrivate ? '' : 'website';
    }

    function isOpenLeadFollowUpTask(item) {
        const status = [item?.type, item?.taskType, item?.confirmationTaskType, item?.postCallStatus].map(normalizeLeadFollowUpStatus).join(' ');
        if (!status.includes('lead_follow_up')) return false;
        return Boolean(resolveOpenLeadProductLine(item));
    }

    function normalizeOpenLeadOption(item) {
        if (!item || typeof item !== 'object' || !isOpenLeadFollowUpTask(item)) return null;
        const id = Number(item?.appointmentId || item?.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const productLine = resolveOpenLeadProductLine(item);
        if (!productLine) return null;
        const date = String(item?.date || '').trim();
        const time = String(item?.time || '').trim();
        return {
            id,
            company: String(item?.company || 'Onbekende lead').trim() || 'Onbekende lead',
            contact: String(item?.contact || 'Onbekend').trim() || 'Onbekend',
            date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
            time: /^\d{2}:\d{2}$/.test(time) ? time : '09:00',
            summary: String(item?.summary || item?.conversationSummary || '').trim(),
            value: String(item?.value || '').trim(),
            leadOwnerName: String(item?.leadOwnerName || item?.leadOwnerFullName || '').trim(),
            productLine
        };
    }

    function getOpenLeadLineColor(productLine) {
        if (productLine === 'business') return '#3498db';
        if (productLine === 'voice') return '#f39c12';
        if (productLine === 'chatbot') return '#8B2252';
        return '#A62D65';
    }

    function getOpenLeadLineLabel(productLine) {
        if (productLine === 'business') return 'Bedrijfssoftware';
        if (productLine === 'voice') return 'Voicesoftware';
        if (productLine === 'chatbot') return 'Chatbot';
        return 'Website';
    }

    async function fetchOpenLeadOptions(force) {
        const now = Date.now();
        if (!force && openLeadOptions.length && (now - openLeadOptionsLoadedAt) < OPEN_LEAD_CACHE_MS) return openLeadOptions;
        if (openLeadOptionsPromise) return openLeadOptionsPromise;
        openLeadOptionsPromise = (async () => {
            try {
                const response = await fetch('/api/agenda/confirmation-tasks?limit=250&quick=1&fresh=1', { cache: 'no-store' });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result?.ok || !Array.isArray(result?.tasks)) throw new Error('Openstaande leads niet beschikbaar.');
                openLeadOptions = result.tasks.map(normalizeOpenLeadOption).filter(Boolean).sort(compareAgendaLeadOptions);
            } catch (_) {
                openLeadOptions = [];
            } finally {
                openLeadOptionsLoadedAt = Date.now();
            }
            return openLeadOptions;
        })().finally(() => {
            openLeadOptionsPromise = null;
        });
        return openLeadOptionsPromise;
    }

    function clearOpenLeadCards() {
        document.querySelectorAll('#ordersGrid [data-open-lead-card="1"]').forEach((card) => card.remove());
    }

    function createOpenLeadCardElement(lead) {
        const color = getOpenLeadLineColor(lead.productLine);
        const card = document.createElement('div');
        card.className = 'order-card open-lead-card';
        card.id = `open-lead-${lead.id}`;
        card.dataset.openLeadCard = '1';
        card.dataset.orderFilterGroup = 'open_leads';
        card.dataset.leadLine = lead.productLine;
        card.setAttribute('role', 'article');
        card.style.borderColor = color;

        const main = document.createElement('div');
        main.className = 'order-main';
        const info = document.createElement('div');
        info.className = 'order-info';
        const clientEl = appendTextElement(info, 'div', 'order-client', formatAgendaLeadDateTimeLabel(lead.date, lead.time) || 'Openstaande lead');
        clientEl.style.color = color;
        appendTextElement(info, 'div', 'order-title', lead.company);
        appendTextElement(info, 'div', 'order-desc', lead.summary || `${lead.contact} wacht op een vervolgstap.`);
        const delivery = document.createElement('div');
        delivery.className = 'order-delivery';
        appendTextElement(delivery, 'strong', '', 'Type');
        delivery.appendChild(document.createTextNode(getOpenLeadLineLabel(lead.productLine)));
        info.appendChild(delivery);

        const price = document.createElement('div');
        price.className = 'order-price';
        appendTextElement(price, 'div', 'order-price-label', 'Leadwaarde');
        appendTextElement(price, 'div', 'order-price-value', lead.value || '-');

        const actions = document.createElement('div');
        actions.className = 'order-actions';
        const status = appendTextElement(actions, 'div', 'order-title', 'Openstaande lead');
        status.style.color = color;
        status.style.fontSize = '0.92rem';
        const assignee = appendTextElement(actions, 'div', 'order-assignee', lead.leadOwnerName || 'Nog niet geclaimd');
        assignee.style.textAlign = 'center';

        main.append(info, price, actions);
        card.appendChild(main);
        return card;
    }

    function renderOpenLeadCards() {
        const grid = document.getElementById('ordersGrid');
        if (!grid) return;
        clearOpenLeadCards();
        openLeadOptions.forEach((lead) => grid.appendChild(createOpenLeadCardElement(lead)));
        if (typeof window.refreshOrderSummaryCards === 'function') window.refreshOrderSummaryCards();
    }

    async function loadOpenLeadCards(force) {
        await fetchOpenLeadOptions(force);
        renderOpenLeadCards();
    }

    window.SoftoraActiveOrderOpenLeads = { load: loadOpenLeadCards, normalizeOpenLeadOption, resolveOpenLeadProductLine };
    window.setTimeout(() => { void loadOpenLeadCards(true); }, 450);
})();
