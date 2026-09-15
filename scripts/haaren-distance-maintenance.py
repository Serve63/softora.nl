from pathlib import Path
import re

ALLOWED = {
    'assets/premium-database-distance.js',
    'premium-database.html',
    'server/services/coldmail-campaign.js',
    'server/services/instantly-outreach.js',
    'server/services/premium-database-mail-ready-snapshot.js',
    'server/services/premium-database-snapshot-cache.js',
}

def replace(text, old, new, count=1):
    assert text.count(old) == count, ('Unexpected anchor count', old[:100], text.count(old))
    return text.replace(old, new)

def section(text, start, end, new):
    assert text.count(start) == 1 and text.count(end) == 1, ('Unexpected section anchors', start, end)
    a, b = text.index(start), text.index(end)
    assert a < b
    return text[:a] + new + '\n\n' + text[b:]

def write(name, text):
    assert name in ALLOWED
    path = Path(name)
    old = path.read_text()
    assert old != text, ('No change', name)
    if len(old.splitlines()) > 1200:
        assert len(text.splitlines()) <= len(old.splitlines()), ('Oversized file growth', name)
    path.write_text(text)
    print(name, len(old.splitlines()), '->', len(text.splitlines()))

def add_import_without_growth(text, line):
    assert line not in text
    assert '\n\n' in text
    return line + '\n' + text.replace('\n\n', '\n', 1)

name = 'assets/premium-database-distance.js'
s = Path(name).read_text()
s = replace(s, 'const OISTERWIJK_COORDS = { lat: 51.5792, lng: 5.1889 };', 'const HAAREN_COORDS = Object.freeze({ lat: 51.6027, lng: 5.2222 });')
s = s.replace('haversineKm(OISTERWIJK_COORDS, coords)', 'haversineKm(HAAREN_COORDS, coords)')
s = replace(s, 'return normalizeText(customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam || customer.name));', 'return normalizeText(firstCustomerValue(customer, ["bedrijf", "company", "companyName", "company_name", "naam", "name"]));')
s = section(s, '  function resolveExplicitCoords(customer) {', '  function resolvePostalCoords(text) {', '''  function resolveExplicitCoords(customer) {
    const rawLat = firstCustomerValue(customer, ["lat", "latitude", "latitudeNumber"]);
    const rawLng = firstCustomerValue(customer, ["lng", "lon", "longitude", "longitudeNumber"]);
    if (rawLat === "" || rawLng === "" || typeof rawLat === "boolean" || typeof rawLng === "boolean") return null;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180
      ? { lat: lat, lng: lng } : null;
  }''')
s = section(s, '  function firstCustomerValue(customer, keys) {', '  function resolveExternalCustomerCoords(customer, text) {', '''  function firstCustomerValue(customer, keys) {
    if (!customer || typeof customer !== "object") return "";
    const sources = [customer, customer.payload];
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null && String(value).trim()) return value;
      }
    }
    return "";
  }

  // Keep only location fields when snapshot/UI normalization narrows a record.
  function getCustomerLocationFields(customer) {
    const fields = {
      lat: ["lat", "latitude", "latitudeNumber"],
      lng: ["lng", "lon", "longitude", "longitudeNumber"],
      plaats: ["plaats", "woonplaats", "city", "stad"],
      gemeente: ["gemeente", "municipality"],
      provincie: ["provincie", "province", "regio", "region"],
      adres: ["adres", "address", "location"],
    };
    const result = {};
    for (const key of Object.keys(fields)) {
      const value = firstCustomerValue(customer, fields[key]);
      if (value !== "") result[key] = value;
    }
    return result;
  }''')
s = section(s, '  function resolveCustomerCoords(customer) {', '  function compareCustomersByDistance(left, right) {', '''  function resolveCustomerCoords(customer) {
    const explicitCoords = resolveExplicitCoords(customer);
    if (explicitCoords) return explicitCoords;
    const fields = getCustomerLocationFields(customer);
    const place = fields.plaats || "";
    const text = [place, fields.gemeente, fields.adres].filter(Boolean).join(" ");
    return (place && (resolvePlaceCoords(place) || resolveExternalCustomerCoords(customer, place))) ||
      resolvePostalCoords(text) || resolvePlaceCoords(text) || resolveExternalCustomerCoords(customer, text);
  }

  function getDistanceKm(customer) {
    // Stored distanceKm/afstandKm may have another origin; always calculate from Haaren.
    const cacheKey = JSON.stringify(getCustomerLocationFields(customer));
    if (customerDistanceCache.has(cacheKey)) return customerDistanceCache.get(cacheKey);
    const coords = resolveCustomerCoords(customer);
    return rememberCachedValue(customerDistanceCache, cacheKey, coords ? haversineKm(HAAREN_COORDS, coords) : Infinity);
  }

  function getCustomerSortId(customer) {
    return String(firstCustomerValue(customer, ["id", "customerId", "customer_id", "databaseId", "email", "contactEmail"]));
  }''')
s = section(s, '  function compareCustomersByDistance(left, right) {', '  function getTargetParts(label) {', '''  function compareCustomerSortEntries(left, right) {
    if (Number.isFinite(left.distanceKm) && !Number.isFinite(right.distanceKm)) return -1;
    if (!Number.isFinite(left.distanceKm) && Number.isFinite(right.distanceKm)) return 1;
    if (left.distanceKm < right.distanceKm) return -1;
    if (left.distanceKm > right.distanceKm) return 1;
    return left.companyName.localeCompare(right.companyName, "nl") ||
      left.sortId.localeCompare(right.sortId, "nl") || left.index - right.index;
  }

  function buildCustomerSortEntry(row, index) {
    return {
      row: row,
      index: index,
      distanceKm: getDistanceKm(row),
      companyName: getCompanyName(row),
      sortId: getCustomerSortId(row),
    };
  }

  function compareCustomersByDistance(left, right) {
    return compareCustomerSortEntries(buildCustomerSortEntry(left, 0), buildCustomerSortEntry(right, 0));
  }

  // Original row indices are retained for guarded outbound updates after selection.
  function sortCustomerEntriesByDistance(customers) {
    return (Array.isArray(customers) ? customers : [])
      .map(buildCustomerSortEntry)
      .sort(compareCustomerSortEntries);
  }

  function sortCustomersByDistance(customers) {
    return sortCustomerEntriesByDistance(customers).map(function (entry) { return entry.row; });
  }''')
s = replace(s, '  function getTargetCoordSource() {\n', '  function getTargetCoordSource() {\n    if (typeof module === "object" && module.exports && typeof require === "function") return require("./premium-database-target-coords.js");\n')
s = replace(s, '  return Object.freeze({\n    compareCustomersByDistance,', '  return Object.freeze({\n    HAAREN_COORDS,\n    getCustomerLocationFields,\n    sortCustomerEntriesByDistance,\n    compareCustomersByDistance,')
write(name, s)

name = 'premium-database.html'
s = Path(name).read_text()
s = replace(s, 'return (state.activeStatus === "benaderd" || state.activeStatus === "instantly" || state.activeStatus === "instantly-ready" || state.activeStatus === "verstuurd") ? outreachController.sortByRecentOutreach(customers, parseDateValue, normalizeSearchValue) : (customers || []);', 'return sortCustomers(customers);')
s = replace(s, '            const hist = parsedHistory.length ? parsedHistory : buildFallbackHistory(status, updatedAt);\n\n            return {', '            const hist = parsedHistory.length ? parsedHistory : buildFallbackHistory(status, updatedAt);\n            return {\n                ...window.SoftoraPremiumDatabaseDistance.getCustomerLocationFields(raw),')
s, count = re.subn(r'(assets/premium-database-distance\.js)(?:\?[^"\s]*)?', r'\1?v=20260915-haaren-order-1', s)
assert count == 1, ('distance script references', count)
write(name, s)

name = 'server/services/coldmail-campaign.js'
s = Path(name).read_text()
s = add_import_without_growth(s, "const { compareCustomersByDistance, getDistanceKm: getHaarenDistanceKm } = require('../../assets/premium-database-distance');")
s = replace(s, '    const eligibleRows = rows\n      .map((row, index) => ({ row, index, id: getRowId(row, index) }))', '    const eligibleRows = rows\n      .map((row, index) => ({ row, index, id: getRowId(row, index) })).sort((left, right) => mode === \'mail\' ? compareCustomersByDistance(left.row, right.row) : left.index - right.index)')
s = replace(s, 'distanceKm: Number.isFinite(getRowDistanceKm(item.row)) ? Math.round(getRowDistanceKm(item.row) * 10) / 10 : null,', 'distanceKm: Number.isFinite(getHaarenDistanceKm(item.row)) ? Math.round(getHaarenDistanceKm(item.row) * 10) / 10 : null,')
write(name, s)

name = 'server/services/instantly-outreach.js'
s = Path(name).read_text()
s = add_import_without_growth(s, "const { sortCustomerEntriesByDistance } = require('../../assets/premium-database-distance');")
s = replace(s, '    for (let index = 0; index < rows.length && selectedRows.length < limit; index += 1) {\n      const row = rows[index];', '    for (const { row, index } of sortCustomerEntriesByDistance(rows)) {\n      if (selectedRows.length >= limit) break;')
write(name, s)

name = 'server/services/premium-database-mail-ready-snapshot.js'
s = Path(name).read_text()
s = add_import_without_growth(s, "const { sortCustomersByDistance, getCustomerLocationFields } = require('../../assets/premium-database-distance');")
s = replace(s, '    naam: getRowContactName(row),', '    ...getCustomerLocationFields(row),\n    naam: getRowContactName(row),')
s = replace(s, '    const customerRows = dedupeCustomerRows(rawCustomerRows);', '    const customerRows = sortCustomersByDistance(dedupeCustomerRows(rawCustomerRows));')
for prop, variable in [('customers', 'allCustomers'), ('availableCustomers', 'allAvailableCustomers'), ('instantlyReadyCustomers', 'allInstantlyReadyCustomers')]:
    s = replace(s, f'    const {variable} = Array.isArray(snapshotData.{prop}) ? snapshotData.{prop} : [];', f'    const {variable} = sortCustomersByDistance(snapshotData.{prop});')
write(name, s)

name = 'server/services/premium-database-snapshot-cache.js'
s = Path(name).read_text()
s = add_import_without_growth(s, "const { compareCustomersByDistance, sortCustomersByDistance } = require('../../assets/premium-database-distance');")
s = replace(s, '.filter((customer) => customer && typeof customer === \'object\' && normalizeString(customer.id))', '.filter((customer) => customer && typeof customer === \'object\' && normalizeString(customer.id)).sort(compareCustomersByDistance)', count=3)
for prop in ['customers', 'availableCustomers', 'instantlyReadyCustomers']:
    s = replace(s, f'(Array.isArray(data.{prop}) ? data.{prop} : []).slice(0, limit)', f'sortCustomersByDistance(data.{prop}).slice(0, limit)')
write(name, s)
