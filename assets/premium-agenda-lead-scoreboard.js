(function setupAgendaLeadScoreboard() {
    function normalizeAgendaLeadOwnerKey(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        if (raw === 'serve' || raw === 'servé' || raw.includes('serve creusen') || raw.includes('servé creusen')) return 'serve';
        if (raw === 'martijn' || raw.includes('martijn van de ven')) return 'martijn';
        return '';
    }

    function resolveAgendaLeadOwnerKey(apt) {
        if (!apt || typeof apt !== 'object') return '';
        return normalizeAgendaLeadOwnerKey(
            apt.manualLeadOwnerKey ||
            apt.leadOwnerKey ||
            apt.manualLeadOwnerName ||
            apt.leadOwnerName ||
            apt.leadOwnerFullName
        );
    }

    function refreshAgendaHeaderLeadOwnerScoreboard() {
        const ownerRows = Array.from(document.querySelectorAll('[data-agenda-owner]'));
        if (!ownerRows.length || !Array.isArray(appointments)) return;

        const counts = { serve: 0, martijn: 0 };
        appointments.forEach((apt) => {
            const ownerKey = resolveAgendaLeadOwnerKey(apt);
            if (!ownerKey || !Object.prototype.hasOwnProperty.call(counts, ownerKey)) return;
            counts[ownerKey] += 1;
        });

        const highestCount = Math.max(counts.serve, counts.martijn, 0);
        ownerRows
            .map((row, index) => ({ row, index, ownerKey: String(row.dataset.agendaOwner || '').trim().toLowerCase() }))
            .sort((a, b) => {
                const countDiff = Number(counts[b.ownerKey] || 0) - Number(counts[a.ownerKey] || 0);
                return countDiff || a.index - b.index;
            })
            .forEach((entry) => {
                const container = entry.row.parentElement;
                if (container) container.appendChild(entry.row);
            });

        ownerRows.forEach((row) => {
            const ownerKey = String(row.dataset.agendaOwner || '').trim().toLowerCase();
            const count = Number(counts[ownerKey] || 0);
            const countEl = row.querySelector('[data-agenda-owner-count]');
            const ownerName = row.querySelector('.agenda-header-owner-name')?.textContent?.trim() || ownerKey;
            if (countEl) countEl.textContent = String(count);
            row.classList.toggle('is-leading', highestCount > 0 && count === highestCount);
            row.setAttribute('aria-label', `${ownerName} ${count} leads`);
        });
    }

    const baseRenderCalendar = renderCalendar;
    renderCalendar = function renderCalendarWithLeadScoreboard() {
        baseRenderCalendar();
        refreshAgendaHeaderLeadOwnerScoreboard();
    };
})();
