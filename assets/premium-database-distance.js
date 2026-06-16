(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SoftoraPremiumDatabaseDistance = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const OISTERWIJK_COORDS = { lat: 51.5792, lng: 5.1889 };
  const PLACE_COORD_ENTRIES = [
    ["oisterwijk", 51.5792, 5.1889],
    ["moergestel", 51.5456, 5.1778],
    ["heukelom", 51.585, 5.164],
    ["berkel-enschot", 51.6026, 5.1461],
    ["tilburg", 51.5555, 5.0913],
    ["haaren", 51.6027, 5.2222],
    ["udenhout", 51.6098, 5.1436],
    ["biezenmortel", 51.625, 5.178],
    ["goirle", 51.5206, 5.0667],
    ["riel", 51.523, 5.023],
    ["hilvarenbeek", 51.4858, 5.1397],
    ["biest-houtakker", 51.506, 5.156],
    ["diessen", 51.4762, 5.1751],
    ["esbeek", 51.4619, 5.1372],
    ["haghorst", 51.4959, 5.2063],
    ["middelbeers", 51.517, 5.095],
    ["oost-west-en-middelbeers", 51.47, 5.25],
    ["vught", 51.6533, 5.2875],
    ["cromvoirt", 51.662, 5.233],
    ["helvoirt", 51.6336, 5.2291],
    ["boxtel", 51.5891, 5.3158],
    ["esch", 51.6118, 5.2915],
    ["sint-michielsgestel", 51.6417, 5.3519],
    ["schijndel", 51.6225, 5.4319],
    ["sint-oedenrode", 51.5675, 5.4597],
    ["liempde", 51.5705, 5.3713],
    ["best", 51.5075, 5.3903],
    ["oirschot", 51.505, 5.3139],
    ["eindhoven", 51.4416, 5.4697],
    ["nuenen", 51.473, 5.551],
    ["geldrop", 51.4217, 5.5578],
    ["son-en-breugel", 51.513, 5.494],
    ["veldhoven", 51.418, 5.4024],
    ["waalre", 51.3867, 5.4447],
    ["dongen", 51.6265, 4.9383],
    ["s-gravenmoer", 51.654, 4.94],
    ["gilze", 51.5442, 4.9403],
    ["hulten", 51.573, 4.958],
    ["molenschot", 51.571, 4.881],
    ["rijen", 51.5881, 4.9267],
    ["bavel", 51.5653, 4.8307],
    ["ulvenhout", 51.5486, 4.7967],
    ["galder", 51.515, 4.775],
    ["strijbeek", 51.5006, 4.7839],
    ["breda", 51.5719, 4.7683],
    ["chaam", 51.5069, 4.8616],
    ["alphen", 51.4817, 4.9583],
    ["alphen-aan-den-rijn", 52.1292, 4.6555],
    ["baarle-nassau", 51.4475, 4.9292],
    ["oosterhout", 51.6439, 4.8601],
    ["etten-leur", 51.5706, 4.6373],
    ["zevenbergen", 51.645, 4.606],
    ["rucphen", 51.532, 4.558],
    ["roosendaal", 51.5308, 4.4653],
    ["steenbergen", 51.585, 4.317],
    ["bergen-op-zoom", 51.4946, 4.2872],
    ["altena", 51.79, 4.94],
    ["almkerk", 51.7714, 4.9597],
    ["andel", 51.785, 5.058],
    ["babylonienbroek", 51.742, 5.007],
    ["drongelen", 51.712, 5.054],
    ["dussen", 51.73, 4.964],
    ["eethen", 51.735, 5.049],
    ["genderen", 51.734, 5.087],
    ["giessen", 51.789, 5.03],
    ["hank", 51.734, 4.894],
    ["meeuwen", 51.73, 5.016],
    ["nieuwendijk", 51.777, 4.923],
    ["rijswijk", 51.795, 5.025],
    ["werkendam", 51.8101, 4.8944],
    ["sleeuwijk", 51.815, 4.952],
    ["uitwijk", 51.788, 5.006],
    ["veen", 51.777, 5.107],
    ["waardhuizen", 51.777, 5.0],
    ["wijk-en-aalburg", 51.755, 5.132],
    ["woudrichem", 51.815, 5.002],
    ["gorinchem", 51.833, 4.974],
    ["zaltbommel", 51.81, 5.244],
    ["waalwijk", 51.6828, 5.0707],
    ["drunen", 51.686, 5.059],
    ["kaatsheuvel", 51.6598, 5.0304],
    ["loon-op-zand", 51.6278, 5.0753],
    ["sprang-capelle", 51.671, 5.049],
    ["den-bosch", 51.6978, 5.3037],
    ["s-hertogenbosch", 51.6978, 5.3037],
    ["rosmalen", 51.7167, 5.3681],
    ["oss", 51.765, 5.5181],
    ["uden", 51.6608, 5.6194],
    ["veghel", 51.6167, 5.5486],
    ["helmond", 51.4793, 5.657],
    ["gemert", 51.555, 5.698],
    ["deurne", 51.456, 5.79],
    ["valkenswaard", 51.3513, 5.4595],
    ["eersel", 51.357, 5.318],
    ["bladel", 51.368, 5.208],
    ["reusel", 51.36, 5.165],
    ["someren", 51.386, 5.711],
    ["asten", 51.404, 5.748],
    ["turnhout", 51.3225, 4.9447],
    ["geel", 51.161, 4.99],
    ["mol", 51.191, 5.115],
    ["hamont-achel", 51.251, 5.545],
    ["leende", 51.35, 5.553],
    ["nijmegen", 51.8426, 5.8598],
    ["tiel", 51.886, 5.429],
    ["weert", 51.2517, 5.7067],
    ["roermond", 51.194, 6.002],
    ["venlo", 51.3703, 6.1724],
    ["venray", 51.525, 5.975],
    ["maastricht", 50.8514, 5.691],
    ["heerlen", 50.8837, 5.981],
  ];
  const POSTAL_PREFIX_COORDS = {
    "4281": { lat: 51.7835, lng: 5.0585 },
    "4286": { lat: 51.7714, lng: 4.9597 },
    "4851": { lat: 51.5486, lng: 4.7967 },
    "4855": { lat: 51.515, lng: 4.775 },
    "4856": { lat: 51.5006, lng: 4.7839 },
    "4858": { lat: 51.5486, lng: 4.7967 },
    "4859": { lat: 51.5653, lng: 4.8307 },
    "4861": { lat: 51.5069, lng: 4.8616 },
    "5061": { lat: 51.5792, lng: 5.1889 },
    "5062": { lat: 51.5792, lng: 5.1889 },
    "5066": { lat: 51.5456, lng: 5.1778 },
    "5071": { lat: 51.5206, lng: 5.0667 },
    "5074": { lat: 51.625, lng: 5.178 },
    "5081": { lat: 51.4858, lng: 5.1397 },
    "5084": { lat: 51.506, lng: 5.156 },
    "5085": { lat: 51.4619, lng: 5.1372 },
    "5087": { lat: 51.4762, lng: 5.1751 },
    "5089": { lat: 51.4959, lng: 5.2063 },
    "5131": { lat: 51.4817, lng: 4.9583 },
    "5268": { lat: 51.6336, lng: 5.2291 },
    "5281": { lat: 51.5891, lng: 5.3158 },
    "5282": { lat: 51.5891, lng: 5.3158 },
    "5283": { lat: 51.5891, lng: 5.3158 },
    "5296": { lat: 51.6118, lng: 5.2915 },
    "5298": { lat: 51.5705, lng: 5.3713 },
  };
  const PLACE_COORDS = PLACE_COORD_ENTRIES.reduce(function (coords, entry) {
    coords[entry[0]] = { lat: entry[1], lng: entry[2] };
    return coords;
  }, Object.create(null));
  const PLACE_KEYS_BY_LENGTH = Object.keys(PLACE_COORDS).sort(function (left, right) {
    return right.length - left.length;
  });
  const DISTANCE_CACHE_LIMIT = 12000;
  const customerDistanceCache = new Map();
  const targetDistanceCache = new Map();

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['\u2019]/g, "")
      .replace(/\((?:n\.?\s*br|nb|noord\s*brabant)\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getCompanyName(customer) {
    return normalizeText(customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam || customer.name));
  }

  function rememberCachedValue(cache, key, value) {
    if (!key) return value;
    if (cache.size >= DISTANCE_CACHE_LIMIT) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, value);
    return value;
  }

  function haversineKm(left, right) {
    const toRad = (value) => (Number(value) * Math.PI) / 180;
    const dLat = toRad(right.lat - left.lat);
    const dLng = toRad(right.lng - left.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function resolveExplicitCoords(customer) {
    const lat = Number(customer && (customer.lat || customer.latitude || customer.latitudeNumber));
    const lng = Number(customer && (customer.lng || customer.lon || customer.longitude || customer.longitudeNumber));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function resolvePostalCoords(text) {
    const match = String(text || "").match(/\b([1-9][0-9]{3})\s?[A-Za-z]{2}\b/);
    return match ? POSTAL_PREFIX_COORDS[match[1]] || null : null;
  }

  function resolvePlaceCoords(value) {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    for (let index = 0; index < PLACE_KEYS_BY_LENGTH.length; index += 1) {
      const key = PLACE_KEYS_BY_LENGTH[index];
      const searchableKey = normalizeText(key);
      const pattern = new RegExp("(^|\\s)" + searchableKey.replace(/\s+/g, "\\s+") + "(\\s|$)");
      if (pattern.test(normalized)) return PLACE_COORDS[key];
    }
    return null;
  }

  function firstCustomerValue(customer, keys) {
    if (!customer) return "";
    for (let index = 0; index < keys.length; index += 1) {
      const value = customer[keys[index]];
      if (value !== undefined && value !== null && String(value).trim()) return value;
    }
    return "";
  }

  function resolveExternalCustomerCoords(customer, text) {
    const source = getTargetCoordSource();
    if (!source) return null;
    const province = firstCustomerValue(customer, ["provincie", "province", "regio", "region"]);
    const municipality = firstCustomerValue(customer, ["gemeente", "municipality"]);
    const place = firstCustomerValue(customer, ["plaats", "woonplaats", "city", "stad"]);
    const structuredCoords = place && typeof source.getTargetCoords === "function"
      ? source.getTargetCoords({ province: province, municipality: municipality, place: place })
      : null;
    if (structuredCoords) return structuredCoords;
    return typeof source.resolveTextCoords === "function"
      ? source.resolveTextCoords(text, { province: province, municipality: municipality })
      : null;
  }

  function resolveCustomerCoords(customer) {
    const explicitCoords = resolveExplicitCoords(customer);
    if (explicitCoords) return explicitCoords;
    const text = [
      customer && customer.stad,
      customer && customer.plaats,
      customer && customer.city,
      customer && customer.gemeente,
      customer && customer.adres,
      customer && customer.address,
      customer && customer.location,
    ].filter(Boolean).join(" ");
    return resolvePostalCoords(text) || resolvePlaceCoords(text) || resolveExternalCustomerCoords(customer, text);
  }

  function buildCustomerDistanceCacheKey(customer) {
    if (!customer || typeof customer !== "object") return "";
    const text = [
      customer.stad,
      customer.plaats,
      customer.city,
      customer.gemeente,
      customer.adres,
      customer.address,
      customer.location,
    ].filter(Boolean).join(" ");
    return [
      normalizeText(text),
      normalizeText(firstCustomerValue(customer, ["provincie", "province", "regio", "region"])),
      normalizeText(firstCustomerValue(customer, ["gemeente", "municipality"])),
      normalizeText(firstCustomerValue(customer, ["plaats", "woonplaats", "city", "stad"]))
    ].join("|");
  }

  function getDistanceKm(customer) {
    const existing = Number(customer && (customer.distanceKm || customer.afstandKm));
    if (Number.isFinite(existing) && existing >= 0) return existing;
    const cacheKey = buildCustomerDistanceCacheKey(customer);
    if (cacheKey && customerDistanceCache.has(cacheKey)) return customerDistanceCache.get(cacheKey);
    const coords = resolveCustomerCoords(customer);
    return rememberCachedValue(customerDistanceCache, cacheKey, coords ? haversineKm(OISTERWIJK_COORDS, coords) : Infinity);
  }

  function compareCustomersByDistance(left, right) {
    const leftDistance = getDistanceKm(left);
    const rightDistance = getDistanceKm(right);
    if (Number.isFinite(leftDistance) && !Number.isFinite(rightDistance)) return -1;
    if (!Number.isFinite(leftDistance) && Number.isFinite(rightDistance)) return 1;
    if (leftDistance < rightDistance) return -1;
    if (leftDistance > rightDistance) return 1;
    return getCompanyName(left).localeCompare(getCompanyName(right), "nl");
  }

  function compareCustomerSortEntries(left, right) {
    if (Number.isFinite(left.distanceKm) && !Number.isFinite(right.distanceKm)) return -1;
    if (!Number.isFinite(left.distanceKm) && Number.isFinite(right.distanceKm)) return 1;
    if (left.distanceKm < right.distanceKm) return -1;
    if (left.distanceKm > right.distanceKm) return 1;
    const nameComparison = left.companyName.localeCompare(right.companyName, "nl");
    return nameComparison || left.index - right.index;
  }

  function sortCustomersByDistance(customers) {
    return (Array.isArray(customers) ? customers : [])
      .map(function (customer, index) {
        return {
          customer: customer,
          index: index,
          distanceKm: getDistanceKm(customer),
          companyName: getCompanyName(customer),
        };
      })
      .sort(compareCustomerSortEntries)
      .map(function (entry) {
        return entry.customer;
      });
  }

  function getTargetParts(label) {
    return String(label || "")
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function getTargetCoordSource() {
    const root = typeof window !== "undefined" ? window : globalThis;
    return root && root.SoftoraPremiumDatabaseTargetCoords &&
      typeof root.SoftoraPremiumDatabaseTargetCoords.getTargetCoords === "function"
      ? root.SoftoraPremiumDatabaseTargetCoords
      : null;
  }

  function resolveExternalTargetCoords(parts) {
    const source = getTargetCoordSource();
    if (!source) return null;
    return source.getTargetCoords({
      country: parts[0] || "",
      province: parts[1] || "",
      municipality: parts.length > 3 ? parts[2] : "",
      place: parts.length ? parts[parts.length - 1] : "",
    });
  }

  function resolveTargetCoords(label) {
    const parts = getTargetParts(label);
    const externalCoords = resolveExternalTargetCoords(parts);
    if (externalCoords) return externalCoords;
    const place = parts.length ? parts[parts.length - 1] : "";
    const municipality = parts.length > 2 ? parts[parts.length - 2] : "";
    return resolvePlaceCoords(place) || resolvePlaceCoords(municipality) || resolvePlaceCoords(label);
  }

  function getTargetDistanceKm(label) {
    const cacheKey = normalizeText(label);
    if (cacheKey && targetDistanceCache.has(cacheKey)) return targetDistanceCache.get(cacheKey);
    const coords = resolveTargetCoords(label);
    return rememberCachedValue(targetDistanceCache, cacheKey, coords ? haversineKm(OISTERWIJK_COORDS, coords) : Infinity);
  }

  function compareTargetLabelsByDistance(left, right) {
    const leftDistance = getTargetDistanceKm(left);
    const rightDistance = getTargetDistanceKm(right);
    if (Number.isFinite(leftDistance) && !Number.isFinite(rightDistance)) return -1;
    if (!Number.isFinite(leftDistance) && Number.isFinite(rightDistance)) return 1;
    if (leftDistance < rightDistance) return -1;
    if (leftDistance > rightDistance) return 1;
    return normalizeText(left).localeCompare(normalizeText(right), "nl");
  }

  function sortTargetLabelsByDistance(labels) {
    return (Array.isArray(labels) ? labels : []).slice().sort(compareTargetLabelsByDistance);
  }

  return Object.freeze({
    compareCustomersByDistance,
    compareTargetLabelsByDistance,
    getDistanceKm,
    getTargetDistanceKm,
    normalizeText,
    resolveCustomerCoords,
    resolvePlaceCoords,
    resolveTargetCoords,
    sortCustomersByDistance,
    sortTargetLabelsByDistance,
  });
});
