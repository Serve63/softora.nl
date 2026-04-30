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

  function normalizeSearchValue(value) {
    return normalizeString(value).toLowerCase();
  }

  function getChunkMetaKey(baseKey) {
    return `${normalizeString(baseKey)}_chunks_v1`;
  }

  function getChunkPrefix(baseKey) {
    return `${normalizeString(baseKey)}_chunk_`;
  }

  function readChunkedStateValue(values, baseKey) {
    const stateValues = values && typeof values === 'object' ? values : {};
    const normalizedKey = normalizeString(baseKey);
    const fallback =
      typeof stateValues[normalizedKey] === 'string' ? stateValues[normalizedKey] : '';
    const metaRaw = normalizeString(stateValues[getChunkMetaKey(normalizedKey)]);
    if (!metaRaw) return fallback;

    try {
      const meta = JSON.parse(metaRaw);
      const count = Math.max(0, Math.min(100, Number(meta && meta.count) || 0));
      if (!count) return fallback;

      const prefix = getChunkPrefix(normalizedKey);
      const chunks = [];
      for (let index = 0; index < count; index += 1) {
        const chunk = stateValues[prefix + index];
        if (typeof chunk !== 'string') return fallback;
        chunks.push(chunk);
      }

      return chunks.join('') || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function normalizeActiveValue(value) {
    return normalizeString(value).toLowerCase() === 'nee' ? 'Nee' : 'Ja';
  }

  function parseResponsibleValue(value) {
    const normalized = normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (normalized.includes('martijn')) return 'Martijn';
    if (normalized.includes('serve')) return 'Serve';
    return '';
  }

  function normalizeResponsibleValue(value) {
    return parseResponsibleValue(value) || 'Serve';
  }

  function setExplicitResponsibleMetadata(target, value) {
    if (!target || typeof target !== 'object') return target;
    Object.defineProperty(target, '__explicitResponsible', {
      value: parseResponsibleValue(value),
      enumerable: false,
      configurable: true,
      writable: false,
    });
    return target;
  }

  function getResponsibleSourceValue(raw) {
    if (!raw || typeof raw !== 'object') return '';
    return normalizeString(
      raw.verantwoordelijk ||
        raw.responsible ||
        raw.claimedBy ||
        raw.leadOwnerName ||
        raw.leadOwnerFullName ||
        raw.assignedToName ||
        raw.assignedToFullName ||
        ''
    );
  }

  function normalizeOptionalAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount);
  }

  function formatDashboardMoney(amount) {
    const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
    return `\u20ac${safeAmount.toLocaleString('nl-NL')}`;
  }

  function getDashboardDate(value, fallback = new Date()) {
    const normalized = normalizeDate(value);
    if (!normalized) return fallback;
    const date = new Date(`${normalized}T00:00:00`);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  function countInclusiveMonths(startDate, endDate) {
    if (!(startDate instanceof Date) || !(endDate instanceof Date)) return 0;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    if (start.getTime() > end.getTime()) return 0;
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  }

  const CUSTOMER_SERVICE_OPTIONS = ['website', 'bedrijfssoftware', 'voicesoftware', 'chatbot'];

  function normalizeCustomerService(raw) {
    const rawSvc = normalizeString(raw && raw.service).toLowerCase();
    if (CUSTOMER_SERVICE_OPTIONS.includes(rawSvc)) return rawSvc;
    return 'website';
  }

  function normalizeCustomerReview(raw) {
    return normalizeString(raw && raw.review).toLowerCase() === 'ja' ? 'Ja' : 'Nee';
  }

  const CUSTOMER_DATABASE_STATUSES = [
    'nieuw',
    'prospect',
    'benaderbaar',
    'gebeld',
    'geengehoor',
    'gemaild',
    'interesse',
    'afspraak',
    'klant',
    'afgehaakt',
    'geblokkeerd',
    'buiten',
  ];

  function normalizeCustomerDatabaseStatus(raw) {
    const value = normalizeString(raw && raw.databaseStatus).toLowerCase();
    const status = normalizeString(raw && raw.status).toLowerCase();
    if (CUSTOMER_DATABASE_STATUSES.includes(value)) return value;
    if (CUSTOMER_DATABASE_STATUSES.includes(status)) return status;
    if (status === 'betaald' || status === 'open') return 'klant';
    return 'klant';
  }

  function normalizeCustomer(raw, fallbackId) {
    const legacyAmount = normalizeOptionalAmount(raw && raw.bedrag);
    const rawType = normalizeString(raw && raw.type);
    const type =
      rawType === 'Onderhoud' || rawType === 'Website + onderhoud' ? rawType : 'Website';
    const databaseStatus = normalizeCustomerDatabaseStatus(raw);
    const rawStatus = normalizeString(raw && raw.status);
    const status =
      rawStatus === 'Open'
        ? 'Open'
        : rawStatus === 'Betaald' || databaseStatus === 'klant'
          ? 'Betaald'
          : rawStatus || 'Open';
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

    const service = normalizeCustomerService(raw);
    const review = normalizeCustomerReview(raw);

    return {
      id: normalizeString(raw && raw.id) || fallbackId || '',
      naam: normalizeString(raw && raw.naam) || 'Onbekend',
      bedrijf: normalizeString(raw && raw.bedrijf) || '-',
      telefoon: normalizeString(raw && raw.telefoon) || '-',
      type,
      service,
      website: normalizeString(raw && raw.website) || '-',
      websiteBedrag,
      onderhoudPerMaand,
      bedrag,
      status,
      databaseStatus,
      actief: normalizeActiveValue(raw && raw.actief),
      review,
      verantwoordelijk: normalizeResponsibleValue(getResponsibleSourceValue(raw)),
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
        parsed.map((item, index) =>
          setExplicitResponsibleMetadata(
            normalizeCustomer(item, `klant-import-${index}`),
            getResponsibleSourceValue(item)
          )
        )
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
          const companyName = normalizeString(item && item.companyName);
          const contactName = normalizeString(item && item.contactName);
          const contactPhone = normalizeString(item && item.contactPhone);
          const contactEmail = normalizeString(item && item.contactEmail);
          if (!Number.isFinite(id) || id <= 0 || (!companyName && !clientName)) return null;

          return {
            id,
            clientName,
            location: normalizeString(item && item.location),
            companyName,
            contactName,
            contactPhone,
            contactEmail,
            title: normalizeString(item && item.title) || 'Website opdracht',
            description: normalizeString(item && item.description),
            prompt: normalizeString(item && item.prompt),
            amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0,
            status: normalizeString(item && item.status).toLowerCase(),
            claimedBy: normalizeString(
              item && (item.claimedBy || item.leadOwnerName || item.leadOwnerFullName)
            ),
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

  function buildCustomerIdentityKey(raw) {
    return [
      normalizeSearchValue(raw?.bedrijf),
      normalizeSearchValue(raw?.naam),
      normalizeSearchValue(raw?.telefoon),
    ].join('|');
  }

  function buildDerivedCustomerSeedFromOrder(order) {
    const explicitCompany = normalizeString(order?.companyName);
    const explicitContact = normalizeString(order?.contactName);
    const explicitPhone = normalizeString(order?.contactPhone);
    const legacyClientName = normalizeString(order?.clientName);
    const legacyLocation = normalizeString(order?.location);
    const hasExplicitIdentity = Boolean(explicitCompany || explicitContact || explicitPhone);
    const customerName = hasExplicitIdentity
      ? explicitContact || legacyLocation || legacyClientName || 'Onbekend'
      : legacyClientName || 'Onbekend';
    const customerCompany = hasExplicitIdentity
      ? explicitCompany || legacyClientName || legacyLocation || '-'
      : legacyLocation || '-';
    const customerPhone = explicitPhone || '-';
    return {
      naam: customerName,
      bedrijf: customerCompany,
      telefoon: customerPhone,
      verantwoordelijk: normalizeResponsibleValue(order?.claimedBy),
    };
  }

  function deriveCustomersFromOrders(orders) {
    const seen = new Map();

    orders.forEach((order) => {
      const customerSeed = buildDerivedCustomerSeedFromOrder(order);
      const key = buildCustomerIdentityKey(customerSeed);
      if (!key || seen.has(key)) return;

      const paidDate = normalizeString(order?.paidAt).slice(0, 10);
      const status = paidDate || normalizeString(order?.status) === 'betaald' ? 'Betaald' : 'Open';

      seen.set(
        key,
        normalizeCustomer({
          id: `seed-${order.id}`,
          naam: customerSeed.naam,
          bedrijf: customerSeed.bedrijf,
          telefoon: customerSeed.telefoon,
          type: inferTypeFromOrder(order),
          website: order.title || '-',
          bedrag: order.amount || 0,
          status,
          actief: 'Ja',
          verantwoordelijk: customerSeed.verantwoordelijk,
          datum: paidDate,
        })
      );
    });

    return sortCustomers(Array.from(seen.values()));
  }

  function mergeCustomersWithResponsible(customers, orders) {
    if (!Array.isArray(customers) || !customers.length) return [];
    if (!Array.isArray(orders) || !orders.length) return sortCustomers(customers);

    const responsibleByCustomerKey = new Map();
    orders.forEach((order) => {
      const customerSeed = buildDerivedCustomerSeedFromOrder(order);
      const key = buildCustomerIdentityKey(customerSeed);
      const responsible = parseResponsibleValue(customerSeed.verantwoordelijk);
      if (!key || !responsible || responsibleByCustomerKey.has(key)) return;
      responsibleByCustomerKey.set(key, responsible);
    });

    return sortCustomers(
      customers.map((customer, index) => {
        const explicitResponsible =
          typeof customer?.__explicitResponsible === 'string' ? customer.__explicitResponsible : '';
        const normalizedCustomer = normalizeCustomer(customer, `klant-responsible-${index}`);
        const key = buildCustomerIdentityKey(normalizedCustomer);
        const matchedResponsible =
          explicitResponsible || responsibleByCustomerKey.get(key) || normalizedCustomer.verantwoordelijk;
        if (matchedResponsible === normalizedCustomer.verantwoordelijk) {
          return normalizedCustomer;
        }
        return {
          ...normalizedCustomer,
          verantwoordelijk: matchedResponsible,
        };
      })
    );
  }

  function buildDashboardMetricSummary(customers, nowDate = new Date()) {
    const normalizedCustomers = (Array.isArray(customers) ? customers : [])
      .map((customer, index) => normalizeCustomer(customer, `dashboard-customer-${index}`))
      .filter((customer) => customer.databaseStatus === 'klant');

    return normalizedCustomers.reduce(
      (summary, customer) => {
        if (customer.status !== 'Betaald') return summary;
        const paidAt = getDashboardDate(customer.datum, nowDate);
        const websiteAmount = Math.max(0, Number(customer.websiteBedrag) || 0);
        const maintenanceAmount = Math.max(0, Number(customer.onderhoudPerMaand) || 0);
        const maintenanceMonths = maintenanceAmount > 0 ? countInclusiveMonths(paidAt, nowDate) : 0;
        const maintenanceRevenue = maintenanceAmount * maintenanceMonths;

        return {
          totalCustomers: summary.totalCustomers,
          totalRevenue: summary.totalRevenue + websiteAmount + maintenanceRevenue,
          maintenanceRevenue: summary.maintenanceRevenue + maintenanceRevenue,
        };
      },
      {
        totalCustomers: normalizedCustomers.length,
        totalRevenue: 0,
        maintenanceRevenue: 0,
      }
    );
  }

  function buildDashboardHtmlReplacements(payload = {}) {
    const summary = buildDashboardMetricSummary(payload.customers);
    return {
      SOFTORA_DASHBOARD_TOTAL_REVENUE: formatDashboardMoney(summary.totalRevenue),
      SOFTORA_DASHBOARD_MAINTENANCE_REVENUE: formatDashboardMoney(summary.maintenanceRevenue),
      SOFTORA_DASHBOARD_TOTAL_CLIENTS: String(summary.totalCustomers),
    };
  }

  async function buildCustomersBootstrapPayload() {
    const remoteState = await getUiStateValues(customerScope);
    const remoteCustomers = parseCustomers(readChunkedStateValue(remoteState?.values, customerKey));
    const orderState = await getUiStateValues(orderScope);
    const orders = parseOrders(orderState?.values?.[orderKey]);

    if (remoteCustomers.length) {
      return {
        ok: true,
        loadedAt: new Date().toISOString(),
        source: 'customers',
        customers: mergeCustomersWithResponsible(remoteCustomers, orders),
      };
    }

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
    buildDashboardHtmlReplacements,
  };
}

module.exports = {
  createCustomersPageBootstrapService,
};
