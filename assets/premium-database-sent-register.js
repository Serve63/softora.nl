(function (root) {
    let snapshot = null;
    let failed = false;
    const clean = value => String(value == null ? '' : value).trim();
    const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const normalize = value => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    function accept(register) {
        if (!register || register.source !== 'central-outbound-recipient-guard' || !Array.isArray(register.recipients)
            || register.total !== register.recipients.length || new Set(register.recipients.map(row => row.key)).size !== register.total) throw new Error('Onvolledig verzendregister');
        snapshot = register;
        failed = false;
    }
    function rows(customers, query) {
        const byEmail = new Map(), byId = new Map();
        (customers || []).forEach(customer => {
            if (clean(customer.email)) byEmail.set(clean(customer.email).toLowerCase(), customer);
            if (clean(customer.id)) byId.set(clean(customer.id), customer);
        });
        return (snapshot ? snapshot.recipients : []).map(recipient => {
            const customer = byEmail.get(clean(recipient.email).toLowerCase()) || byId.get(recipient.customerId) || {};
            return { ...recipient, company: recipient.company || customer.bedrijf || recipient.email,
                address: customer.stad || '', website: customer.website || customer.dom || '' };
        }).filter(row => !normalize(query) || normalize([row.company, row.address, row.email, row.senderEmail, row.website].join(' ')).includes(normalize(query)))
            .sort((a, b) => (Date.parse(b.sentAt) || 0) - (Date.parse(a.sentAt) || 0) || a.key.localeCompare(b.key));
    }
    function render(options) {
        const { state, nodes, setBody, updateLoadMore, formatDate, normalizeUrl } = options;
        if (state.activeStatus !== 'verstuurd') return false;
        const doc = root.document, table = doc.getElementById('databaseTable');
        table.classList.add('sent-list-mode', 'outreach-action-mode');
        ['statusHeader', 'photoHeader', 'daysHeader', 'outreachActionHeader'].forEach(id => { doc.getElementById(id).hidden = true; });
        doc.getElementById('outreachActionHeader').textContent = '';
        nodes.topSub.textContent = failed ? 'Verzendregister bijwerken mislukt. De laatst geladen stand blijft zichtbaar.' : 'De AI koppelt alle data slim aan elkaar.';
        if (!snapshot) {
            setBody('<tr><td colspan="8"><div class="tbl-empty">' + (failed ? 'Verzendregister tijdelijk niet beschikbaar. Probeer het opnieuw.' : 'Verzendregister laden...') + '</div></td></tr>');
            updateLoadMore(0, 0);
            return true;
        }
        const all = rows(state.klanten, state.query), visible = all.slice(0, Math.max(25, state.visibleLimit || 25));
        setBody(visible.length ? visible.map(row => {
            const href = normalizeUrl(row.website);
            const website = href ? '<a class="website-link" href="' + escape(href) + '" target="_blank" rel="noopener" aria-label="Website openen: ' + escape(row.website) + '"><svg class="website-open-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg></a>' : '—';
            return '<tr><td><div class="company-cell"><div><div class="c-naam">' + escape(row.company) + '</div><div class="outreach-line">Verstuurd vanaf ' + escape(row.senderEmail) + (row.sentAt ? ' · ' + escape(formatDate(row.sentAt)) : '') + '</div></div></div></td><td class="c-mid">' + escape(row.address || '—') + '</td><td class="c-mid">' + escape(row.email) + '</td><td class="c-mid website-cell">' + website + '</td></tr>';
        }).join('') : '<tr><td colspan="8"><div class="tbl-empty">Geen verzonden mails gevonden.</div></td></tr>');
        updateLoadMore(all.length, visible.length);
        return true;
    }
    root.SoftoraDatabaseSentRegister = { accept, rows, render, markFailed: function () { failed = true; } };
}(typeof window !== 'undefined' ? window : globalThis));
