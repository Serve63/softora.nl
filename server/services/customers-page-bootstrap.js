function createCustomersPageBootstrapService(deps = {}) {
  const {
    getUiStateValues = async () => null,
    normalizeString = (value) => String(value || '').trim(),
    customerScope = 'premium_customers_database',
    customerKey = 'softora_customers_premium_v1',
    orderScope = 'premium_active_orders',
    orderKey = 'softora_custom_orders_premium_v1',
    orderRuntimeKey = 'softora_order_runtime_premium_v1',
  } = deps;

  function normalizeDate(value) {
    const raw = normalizeString(value);
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
    return match ? match[1] : '';
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

  const DASHBOARD_MONTH_LABELS_SHORT = [
    'Jan',
    'Feb',
    'Mrt',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Okt',
    'Nov',
    'Dec',
  ];

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
    const phone = normalizeString(raw && (raw.telefoon || raw.tel || raw.phone || raw.contactPhone));
    const website = normalizeString(raw && (raw.website || raw.dom || raw.domain || raw.url)) || '-';

    return {
      id: normalizeString(raw && raw.id) || fallbackId || '',
      naam: normalizeString(raw && raw.naam) || 'Onbekend',
      bedrijf: normalizeString(raw && raw.bedrijf) || '-',
      telefoon: phone || '-',
      tel: phone || '-',
      email: normalizeString(raw && (raw.email || raw.contactEmail)),
      type,
      service,
      website,
      dom: normalizeString(raw && (raw.dom || raw.domain)) || website,
      stad: normalizeString(raw && (raw.stad || raw.adres || raw.location || raw.address || raw.plaats || raw.city)),
      branche: normalizeString(raw && raw.branche),
      nota: normalizeString(raw && raw.nota),
      updatedAt: normalizeDate(raw && (raw.updatedAt || raw.updated || raw.datum || raw.paidAt)),
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

  function parseOrderRuntime(raw) {
    try {
      const parsed = JSON.parse(String(raw || '{}'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function normalizeOrderStatus(value) {
    const key = normalizeString(value).toLowerCase();
    if (key === 'actief') return 'actief';
    if (key === 'bezig') return 'bezig';
    if (key === 'klaar') return 'klaar';
    if (key === 'betaald') return 'betaald';
    return 'wacht';
  }

  function isOrderBuilt(order, runtimeMap) {
    const runtime = runtimeMap && typeof runtimeMap === 'object' ? runtimeMap[String(order?.id)] || {} : {};
    const pct = Math.max(0, Math.min(100, Number(runtime?.progressPct ?? order?.progressPct) || 0));
    const fallback = pct >= 100 ? 'klaar' : pct > 0 ? 'bezig' : 'wacht';
    const status = normalizeOrderStatus(runtime?.statusKey || runtime?.status || order?.status || fallback);
    return status === 'klaar' || status === 'betaald' || pct >= 100;
  }

  function classifyActiveOrderProductLine(order) {
    const haystack = [order?.title, order?.description, order?.prompt].join(' ').toLowerCase();
    if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot|conversational\s*bot/.test(haystack)) {
      return 'chatbot';
    }
    if (/voice\s*software|voicesoftware|voicebot|spraakbot|belbot|telefonie\s*ai/.test(haystack)) {
      return 'voice';
    }
    if (/bedrijfssoftware|business\s*software|business_software|\bcrm\b|\berp\b/.test(haystack)) {
      return 'business';
    }
    return 'website';
  }

  function buildActiveOrdersBreakdown(activeOrdersState = {}) {
    const values = activeOrdersState && typeof activeOrdersState.values === 'object' ? activeOrdersState.values : {};
    const orders = parseOrders(readChunkedStateValue(values, orderKey));
    const runtimeMap = parseOrderRuntime(readChunkedStateValue(values, orderRuntimeKey));
    return orders
      .filter((order) => !isOrderBuilt(order, runtimeMap))
      .reduce(
        (counts, order) => {
          const productLine = classifyActiveOrderProductLine(order);
          if (productLine === 'business') counts.business += 1;
          else if (productLine === 'voice') counts.voice += 1;
          else if (productLine === 'chatbot') counts.chatbot += 1;
          else counts.website += 1;
          return counts;
        },
        { website: 0, business: 0, voice: 0, chatbot: 0 }
      );
  }

  function escapeInlineJson(value) {
    return JSON.stringify(value === undefined ? null : value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function buildDashboardActiveOrdersBootstrapScript(counts) {
    const safeCounts = {
      website: Math.max(0, Number(counts?.website) || 0),
      business: Math.max(0, Number(counts?.business) || 0),
      voice: Math.max(0, Number(counts?.voice) || 0),
      chatbot: Math.max(0, Number(counts?.chatbot) || 0),
    };
    return `<script>(function applyActiveOrders(){var counts=${escapeInlineJson(safeCounts)};var root=typeof document!=='undefined'?document.getElementById('kpiActiveOrders'):null;if(!root){if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('DOMContentLoaded',applyActiveOrders,{once:true});return;}var pairs=[['website','[data-kpi-active-website]'],['business','[data-kpi-active-business]'],['voice','[data-kpi-active-voice]'],['chatbot','[data-kpi-active-chatbot]']];pairs.forEach(function(pair){var el=root.querySelector(pair[1]);if(el)el.textContent=String(counts[pair[0]]||0);});root.setAttribute('aria-label','Website opdrachten: '+(counts.website||0)+', bedrijfssoftware: '+(counts.business||0)+', voicesoftware: '+(counts.voice||0)+', chatbots: '+(counts.chatbot||0));})();</script>`;
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

  function buildDashboardRevenueSeries(customers, nowDate = new Date()) {
    const currentYear = nowDate instanceof Date && !Number.isNaN(nowDate.getTime())
      ? nowDate.getFullYear()
      : new Date().getFullYear();
    const currentMonth = nowDate instanceof Date && !Number.isNaN(nowDate.getTime())
      ? nowDate.getMonth()
      : new Date().getMonth();
    const values = Array.from({ length: 12 }, () => 0);
    const normalizedCustomers = (Array.isArray(customers) ? customers : [])
      .map((customer, index) => normalizeCustomer(customer, `dashboard-chart-customer-${index}`))
      .filter((customer) => customer.databaseStatus === 'klant' && customer.status === 'Betaald');

    normalizedCustomers.forEach((customer) => {
      const paidAt = getDashboardDate(customer.datum, nowDate);
      if (paidAt.getFullYear() !== currentYear) return;
      const websiteAmount = Math.max(0, Number(customer.websiteBedrag) || 0);
      const maintenanceAmount = Math.max(0, Number(customer.onderhoudPerMaand) || 0);
      if (websiteAmount > 0) values[paidAt.getMonth()] += websiteAmount;
      if (maintenanceAmount <= 0 || paidAt.getMonth() > currentMonth) return;
      for (let month = paidAt.getMonth(); month <= currentMonth; month += 1) {
        values[month] += maintenanceAmount;
      }
    });

    return values;
  }

  function buildDashboardRevenueChartHtml(customers, nowDate = new Date()) {
    const values = buildDashboardRevenueSeries(customers, nowDate);
    const maxRevenue = Math.max(...values, 0);
    return DASHBOARD_MONTH_LABELS_SHORT.map((label, index) => {
      const amount = Math.max(0, Number(values[index]) || 0);
      const height = maxRevenue > 0 && amount > 0
        ? Math.max(14, Math.round((amount / maxRevenue) * 214))
        : 0;
      return [
        '<div class="chart-bar-group">',
        `<div class="chart-bar" data-chart-index="${index}" style="height: ${height}px;" title="${formatDashboardMoney(amount)}"></div>`,
        `<span class="chart-label">${label}</span>`,
        '</div>',
      ].join('');
    }).join('');
  }

  function buildDashboardHtmlReplacements(payload = {}) {
    const summary = buildDashboardMetricSummary(payload.customers);
    const activeOrdersBreakdown = buildActiveOrdersBreakdown(payload.activeOrdersState);
    return {
      SOFTORA_DASHBOARD_TOTAL_REVENUE: formatDashboardMoney(summary.totalRevenue),
      SOFTORA_DASHBOARD_MAINTENANCE_REVENUE: formatDashboardMoney(summary.maintenanceRevenue),
      SOFTORA_DASHBOARD_REVENUE_CHART: buildDashboardRevenueChartHtml(payload.customers),
      SOFTORA_DASHBOARD_TOTAL_CLIENTS:
        String(summary.totalCustomers) + buildDashboardActiveOrdersBootstrapScript(activeOrdersBreakdown),
    };
  }

  async function buildCustomersBootstrapPayload() {
    const remoteState = await getUiStateValues(customerScope);
    const remoteCustomers = parseCustomers(readChunkedStateValue(remoteState?.values, customerKey));
    const orderState = await getUiStateValues(orderScope);
    const orders = parseOrders(readChunkedStateValue(orderState?.values, orderKey));

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

  async function buildActiveOrdersPageBootstrapPayload() {
    const activeOrdersState = await getUiStateValues(orderScope);
    const values =
      activeOrdersState && activeOrdersState.values && typeof activeOrdersState.values === 'object'
        ? activeOrdersState.values
        : {};

    return {
      ok: true,
      loadedAt: new Date().toISOString(),
      activeOrdersState: {
        values,
        source: normalizeString(activeOrdersState && activeOrdersState.source),
        updatedAt: normalizeString(activeOrdersState && activeOrdersState.updatedAt) || null,
      },
    };
  }

  return {
    buildActiveOrdersPageBootstrapPayload,
    buildCustomersBootstrapPayload,
    buildDashboardHtmlReplacements,
  };
}

module.exports = {
  createCustomersPageBootstrapService,
};
