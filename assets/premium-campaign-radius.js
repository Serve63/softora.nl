(function (global) {
  "use strict";

  const ORIGIN_OISTERWIJK = { lat: 51.5792, lng: 5.1889 };
  const PLACE_COORDS = {
    oisterwijk: { lat: 51.5792, lng: 5.1889 },
    tilburg: { lat: 51.5555, lng: 5.0913 },
    breda: { lat: 51.5719, lng: 4.7683 },
    eindhoven: { lat: 51.4416, lng: 5.4697 },
    "den bosch": { lat: 51.6978, lng: 5.3037 },
    "s hertogenbosch": { lat: 51.6978, lng: 5.3037 },
    waalwijk: { lat: 51.6828, lng: 5.0707 },
    boxtel: { lat: 51.5908, lng: 5.3293 },
    udenhout: { lat: 51.6098, lng: 5.1436 },
    haaren: { lat: 51.6027, lng: 5.2222 },
    goirle: { lat: 51.5206, lng: 5.0667 },
    hilvarenbeek: { lat: 51.4858, lng: 5.1397 },
    chaam: { lat: 51.5069, lng: 4.8616 },
    alphen: { lat: 51.4817, lng: 4.9583 },
    ulvenhout: { lat: 51.5486, lng: 4.7967 },
    galder: { lat: 51.515, lng: 4.775 },
    strijbeek: { lat: 51.5006, lng: 4.7839 },
    bavel: { lat: 51.5653, lng: 4.8307 },
    gilze: { lat: 51.5442, lng: 4.9403 },
    "baarle-nassau": { lat: 51.4475, lng: 4.9292 },
    vught: { lat: 51.6533, lng: 5.2875 },
    best: { lat: 51.5075, lng: 5.3903 },
    oirschot: { lat: 51.505, lng: 5.3139 },
    helmond: { lat: 51.4793, lng: 5.657 },
    dongen: { lat: 51.6265, lng: 4.9383 },
    "etten-leur": { lat: 51.5706, lng: 4.6373 },
    roosendaal: { lat: 51.5308, lng: 4.4653 },
    "bergen op zoom": { lat: 51.4946, lng: 4.2872 },
    almkerk: { lat: 51.7714, lng: 4.9597 },
    werkendam: { lat: 51.8101, lng: 4.8944 },
    sleeuwijk: { lat: 51.815, lng: 4.952 },
    waalre: { lat: 51.3867, lng: 5.4447 },
    valkenswaard: { lat: 51.3513, lng: 5.4595 },
    veldhoven: { lat: 51.418, lng: 5.4024 },
    oss: { lat: 51.765, lng: 5.5181 },
    uden: { lat: 51.6608, lng: 5.6194 },
    veghel: { lat: 51.6167, lng: 5.5486 },
    schijndel: { lat: 51.6225, lng: 5.4319 },
    "sint-oedenrode": { lat: 51.5675, lng: 5.4597 }
  };

  function normalizeString(value) {
    return String(value || "").trim();
  }

  function normalizePlaceKey(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const PLACE_KEYS_BY_LENGTH = Object.keys(PLACE_COORDS).sort((left, right) => right.length - left.length);

  function tokenizePlaceKey(value) {
    return normalizePlaceKey(value).split(/\s+/).filter(Boolean);
  }

  function placeKeyMatchesHaystack(haystack, key) {
    const haystackTokens = tokenizePlaceKey(haystack);
    const keyTokens = tokenizePlaceKey(key);
    if (!haystackTokens.length || !keyTokens.length || keyTokens.length > haystackTokens.length) return false;
    for (let index = 0; index <= haystackTokens.length - keyTokens.length; index += 1) {
      if (keyTokens.every((token, offset) => haystackTokens[index + offset] === token)) return true;
    }
    return false;
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

  function resolveRowCoords(row) {
    const explicitLat = Number(row && (row.lat || row.latitude || row.latitudeNumber));
    const explicitLng = Number(row && (row.lng || row.lon || row.longitude || row.longitudeNumber));
    if (Number.isFinite(explicitLat) && Number.isFinite(explicitLng)) return { lat: explicitLat, lng: explicitLng };
    const haystack = normalizePlaceKey([
      row && row.stad,
      row && row.plaats,
      row && row.city,
      row && row.gemeente,
      row && row.adres,
      row && row.address,
      row && row.location
    ].filter(Boolean).join(" "));
    const placeKey = PLACE_KEYS_BY_LENGTH.find((key) => placeKeyMatchesHaystack(haystack, key));
    return placeKey ? PLACE_COORDS[placeKey] : null;
  }

  function getDistanceKm(row) {
    const existing = Number(row && (row.distanceKm || row.afstandKm));
    if (Number.isFinite(existing) && existing >= 0) return existing;
    const coords = resolveRowCoords(row);
    return coords ? haversineKm(ORIGIN_OISTERWIJK, coords) : NaN;
  }

  function isWithinRadius(row, radiusKm) {
    const distanceKm = getDistanceKm(row);
    if (!Number.isFinite(distanceKm)) return false;
    return distanceKm <= Number(radiusKm || 0);
  }

  global.SoftoraCampaignRadius = {
    getDistanceKm,
    isWithinRadius,
    normalizePlaceKey,
    placeKeyMatchesHaystack,
    resolveRowCoords
  };
})(window);
