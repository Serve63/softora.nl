(function (global) {
  "use strict";

  const ORIGIN_OISTERWIJK = { lat: 51.5792, lng: 5.1889 };
  const PLACE_COORD_ENTRIES = [
    ["oisterwijk", 51.5792, 5.1889],
    ["moergestel", 51.5456, 5.1778],
    ["berkel-enschot", 51.6026, 5.1461],
    ["udenhout", 51.6098, 5.1436],
    ["haaren", 51.6027, 5.2222],
    ["tilburg", 51.5555, 5.0913],
    ["goirle", 51.5206, 5.0667],
    ["hilvarenbeek", 51.4858, 5.1397],
    ["diessen", 51.475, 5.175],
    ["middelbeers", 51.517, 5.095],
    ["vught", 51.6533, 5.2875],
    ["boxtel", 51.5908, 5.3293],
    ["schijndel", 51.6225, 5.4319],
    ["sint-michielsgestel", 51.6417, 5.3519],
    ["sint-oedenrode", 51.5675, 5.4597],
    ["liempde", 51.568, 5.375],
    ["best", 51.5075, 5.3903],
    ["oirschot", 51.505, 5.3139],
    ["eindhoven", 51.4416, 5.4697],
    ["nuenen", 51.473, 5.551],
    ["geldrop", 51.4217, 5.5578],
    ["son-en-breugel", 51.513, 5.494],
    ["veldhoven", 51.418, 5.4024],
    ["waalre", 51.3867, 5.4447],
    ["helmond", 51.4793, 5.657],
    ["deurne", 51.456, 5.79],
    ["gemert", 51.555, 5.698],
    ["veghel", 51.6167, 5.5486],
    ["zeeland", 51.697, 5.676],
    ["mill", 51.685, 5.78],
    ["cuijk", 51.727, 5.879],
    ["grave", 51.759, 5.741],
    ["nijmegen", 51.8426, 5.8598],
    ["oss", 51.765, 5.5181],
    ["uden", 51.6608, 5.6194],
    ["den bosch", 51.6978, 5.3037],
    ["den-bosch", 51.6978, 5.3037],
    ["s hertogenbosch", 51.6978, 5.3037],
    ["s-hertogenbosch", 51.6978, 5.3037],
    ["'s-hertogenbosch", 51.6978, 5.3037],
    ["rosmalen", 51.7167, 5.3681],
    ["waalwijk", 51.6828, 5.0707],
    ["drunen", 51.686, 5.059],
    ["kaatsheuvel", 51.6598, 5.0304],
    ["loon-op-zand", 51.6278, 5.0753],
    ["sprang-capelle", 51.671, 5.049],
    ["dongen", 51.6265, 4.9383],
    ["gilze", 51.5447, 4.9403],
    ["rijen", 51.5881, 4.9267],
    ["bavel", 51.555, 4.865],
    ["alphen", 51.483, 4.956],
    ["chaam", 51.505, 4.861],
    ["baarle-nassau", 51.445, 4.929],
    ["oosterhout", 51.6439, 4.8601],
    ["breda", 51.5719, 4.7683],
    ["etten-leur", 51.5706, 4.6373],
    ["rucphen", 51.532, 4.558],
    ["roosendaal", 51.5308, 4.4653],
    ["bergen op zoom", 51.4946, 4.2872],
    ["bergen-op-zoom", 51.4946, 4.2872],
    ["steenbergen", 51.585, 4.317],
    ["zevenbergen", 51.645, 4.606],
    ["almkerk", 51.7714, 4.9597],
    ["werkendam", 51.8101, 4.8944],
    ["sleeuwijk", 51.815, 4.952],
    ["gorinchem", 51.833, 4.974],
    ["zaltbommel", 51.81, 5.244],
    ["tiel", 51.886, 5.429],
    ["bladel", 51.368, 5.208],
    ["reusel", 51.36, 5.165],
    ["eersel", 51.357, 5.318],
    ["valkenswaard", 51.3513, 5.4595],
    ["leende", 51.35, 5.553],
    ["someren", 51.386, 5.711],
    ["asten", 51.404, 5.748],
    ["weert", 51.2517, 5.7067],
    ["roermond", 51.194, 6.002],
    ["venlo", 51.3703, 6.1724],
    ["venray", 51.525, 5.975],
    ["turnhout", 51.3225, 4.9447],
    ["geel", 51.161, 4.99],
    ["mol", 51.191, 5.115],
    ["hamont-achel", 51.251, 5.545],
    ["maastricht", 50.8514, 5.691],
    ["heerlen", 50.8837, 5.981],
    ["utrecht", 52.0907, 5.1214],
    ["amsterdam", 52.3676, 4.9041],
    ["rotterdam", 51.9244, 4.4777],
    ["den haag", 52.0705, 4.3007],
    ["den-haag", 52.0705, 4.3007],
    ["dordrecht", 51.8133, 4.6901]
  ];
  const PLACE_COORDS = Object.create(null);

  function normalizeString(value) {
    return String(value || "").trim();
  }

  function normalizePlaceKey(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b[1-9][0-9]{3}\s?[a-z]{2}\b/gi, " ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  PLACE_COORD_ENTRIES.forEach((entry) => {
    const name = entry[0];
    const lat = Number(entry[1]);
    const lng = Number(entry[2]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    PLACE_COORDS[normalizePlaceKey(name)] = { lat, lng };
  });

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

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function coordsForPlaceHint(value) {
    const normalized = normalizePlaceKey(value);
    if (!normalized) return null;
    if (PLACE_COORDS[normalized]) return PLACE_COORDS[normalized];
    const placeKey = Object.keys(PLACE_COORDS)
      .sort((left, right) => right.length - left.length)
      .find((key) => new RegExp("(^| )" + escapeRegExp(key) + "($| )").test(normalized));
    return placeKey ? PLACE_COORDS[placeKey] : null;
  }

  function collectLocationHints(row) {
    const source = row && typeof row === "object" ? row : {};
    const values = [
      source.stad,
      source.plaats,
      source.city,
      source.gemeente,
      source.regio,
      source.region,
      source.province,
      source.adres,
      source.address,
      source.location,
      source.formattedAddress,
      source.fullAddress
    ];
    const hints = [];
    values.filter(Boolean).forEach((value) => {
      const text = normalizeString(value).replace(/\s+/g, " ").trim();
      if (!text) return;
      hints.push(text);
      text.split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => hints.push(part));
      const postalTail = text.match(/\b[1-9][0-9]{3}\s?[A-Z]{2}\s+([^,]+)/i);
      if (postalTail && postalTail[1]) hints.push(postalTail[1]);
    });
    return hints;
  }

  function resolveRowCoords(row) {
    const explicitLat = Number(row && (row.lat || row.latitude || row.latitudeNumber));
    const explicitLng = Number(row && (row.lng || row.lon || row.longitude || row.longitudeNumber));
    if (Number.isFinite(explicitLat) && Number.isFinite(explicitLng)) return { lat: explicitLat, lng: explicitLng };
    const hints = collectLocationHints(row);
    for (const hint of hints) {
      const coords = coordsForPlaceHint(hint);
      if (coords) return coords;
    }
    return null;
  }

  function getDistanceKm(row) {
    const existing = Number(row && (row.distanceKm || row.afstandKm || row.radiusKm));
    if (Number.isFinite(existing) && existing >= 0) return existing;
    const coords = resolveRowCoords(row);
    return coords ? haversineKm(ORIGIN_OISTERWIJK, coords) : NaN;
  }

  function isWithinRadius(row, radiusKm) {
    const radius = Number.parseFloat(normalizeString(radiusKm).replace(",", "."));
    if (!Number.isFinite(radius) || radius <= 0) return true;
    const distanceKm = getDistanceKm(row);
    if (!Number.isFinite(distanceKm)) return false;
    return distanceKm <= radius;
  }

  global.SoftoraCampaignRadius = {
    coordsForPlaceHint,
    getDistanceKm,
    isWithinRadius,
    normalizePlaceKey,
    resolveRowCoords
  };
})(window);
