function createCustomersPageBootstrapService(deps = {}) {
  const {
    getUiStateValues = async () => null,
    normalizeString = (value) => String(value || '').trim(),
    customerScope = 'premium_customers_database',
    customerKey = 'softora_customers_premium_v1',
    orderScope = 'premium_active_orders',
    orderKey = 'softora_custom_orders_premium_v1',
  } = deps;

  function normalizeDate(value) {
    const raw = normalizeString(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }

  function normalizeActiveValue(value) {
    return normalizeString(value).toLowerCase() === 'nee' ? 'Nee' : 'Ja';
  }

  function normalizeOptionalAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount);
  }

  function normalizeCustomer(raw, fallbackId) {
    const legacyAmount = normalizeOptionalAmount(raw && raw.bedrag);
    const rawType = normalizeString(raw && raw.type);
    const type =
      rawType === 'Onderhoud' || rawType === 'Website + onderhoud' ? rawType : 'Website';
    const status = normalizeString(raw && raw.status) === 'Open' ? 'Open' : 'Betaald';
    const websiteAmountRaw = normalizeOptionalAmount(raw && raw.websiteBedrag);
    const maintenanceAmountRaw = normalizeOptionalAmount(raw && raw.onderhoudPerMaand);
    const websiteBedrag =
      websiteAmountRaw !== null
        ? websiteAmountRaw
        : type === 'Website' || type === 'Website + onderhoud'
          ? legacyAmount
          : null;
    const onderhoudPerMaand =
      maintenanceAmountRaw !== null
        ? maintenanceAmountRaw
        : type === 'Onderhoud'
          ? legacyAmount
          : null;
    const bedrag =
      legacyAmount !== null
        ? legacyAmount
        : websiteBedrag !== null
          ? websiteBedrag
          : onderhoudPerMaand !== null
            ? onderhoudPerMaand
            : 0;

    return {
      id: normalizeString(raw && raw.id) || fallbackId || '',
      naam: normalizeString(raw && raw.naam) || 'Onbekend',
      bedrijf: normalizeString(raw && raw.bedrijf) || '-',
      telefoon: normalizeString(raw && raw.telefoon) || '-',
      type,
      website: normalizeString(raw && raw.website) || '-',
      websiteBedrag,
      onderhoudPerMaand,
      bedrag,
      status,
      actief: normalizeActiveValue(raw && raw.actief),
      datum: normalizeDate(raw && raw.datum),
    };
  }

  function sortCustomers(list) {
    return list.slice().sort((a, b) => {
      const nameCompare = normalizeString(a?.naam).localeCompare(normalizeString(b?.naam), 'nl');
      if (nameCompare !== 0) return nameCompare;
      return normalizeString(a?.bedrijf).localeCompare(normalizeString(b?.bedrijf), 'nl');
    });
  }

  function parseCustomers(raw) {
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      if (!Array.isArray(parsed)) return [];
      return sortCustomers(
        parsed.map((item, index) => normalizeCustomer(item, `klant-import-${index}`))
      );
    } catch (_) {
      return [];
    }
  }

  function parseOrders(raw) {
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map((item) => {
          const id = Number(item && item.id);
          const amount = Number(item && item.amount);
          const clientName = normalizeString(item && item.clientName);
          if (!Number.isFinite(id) || id <= 0 || !clientName) return null;

          return {
            id,
            clientName,
            location: normalizeString(item && item.location),
            title: normalizeString(item && item.title) || 'Website opdracht',
            description: normalizeString(item && item.description),
            prompt: normalizeString(item && item.prompt),
            amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0,
            status: normalizeString(item && item.status).toLowerCase(),
            paidAt: normalizeString(item && item.paidAt),
          };
        })
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function inferTypeFromOrder(order) {
    const haystack = [order?.title, order?.description, order?.prompt].join(' ').toLowerCase();
    const maintenanceKeywords = [
      'onderhoud',
      'maintenance',
      'support',
      'beheer',
      'hosting',
      'servicecontract',
    ];
    return maintenanceKeywords.some((keyword) => haystack.includes(keyword))
      ? 'Website + onderhoud'
      : 'Website';
  }

  function deriveCustomersFromOrders(orders) {
    const seen = new Map();

    orders.forEach((order) => {
      const key = `${normalizeString(order?.clientName).toLowerCase()}|${normalizeString(order?.location).toLowerCase()}`;
      if (!key || seen.has(key)) return;

      const paidDate = normalizeString(order?.paidAt).slice(0, 10);
      const status = paidDate || normalizeString(order?.status) === 'betaald' ? 'Betaald' : 'Open';

      seen.set(
        key,
        normalizeCustomer({
          id: `seed-${order.id}`,
          naam: order.clientName,
          bedrijf: order.location || '-',
          telefoon: '-',
          type: inferTypeFromOrder(order),
          website: order.title || '-',
          bedrag: order.amount || 0,
          status,
          actief: 'Ja',
          datum: paidDate,
        })
      );
    });

    return sortCustomers(Array.from(seen.values()));
  }

  async function buildCustomersBootstrapPayload() {
    const remoteState = await getUiStateValues(customerScope);
    const remoteCustomers = parseCustomers(remoteState?.values?.[customerKey]);

    if (remoteCustomers.length) {
      return {
        ok: true,
        loadedAt: new Date().toISOString(),
        source: 'customers',
        customers: remoteCustomers,
      };
    }

    const orderState = await getUiStateValues(orderScope);
    const orders = parseOrders(orderState?.values?.[orderKey]);
    const customers = deriveCustomersFromOrders(orders);

    return {
      ok: true,
      loadedAt: new Date().toISOString(),
      source: customers.length ? 'orders' : 'empty',
      customers,
    };
  }

  return {
    buildCustomersBootstrapPayload,
  };
}

module.exports = {
  createCustomersPageBootstrapService,
};
