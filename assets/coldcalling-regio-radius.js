(function (global) {
  "use strict";

  const OISTERWIJK_CAMPAIGN_CENTER = { lat: 51.5791, lng: 5.1889 };
  const DEFAULT_MAX_CAMPAIGN_REGIO_KM = 250;
  const REGIO_PLACE_COORD_ENTRIES = [
    ['oisterwijk', 51.5791, 5.1889],
    ['moergestel', 51.5456, 5.1778],
    ['berkel-enschot', 51.6026, 5.1461],
    ['uden', 51.6589, 5.6168],
    ['tilburg', 51.5555, 5.0913],
    ['goirle', 51.5208, 5.0707],
    ['hilvarenbeek', 51.4853, 5.1361],
    ['diessen', 51.475, 5.175],
    ['middelbeers', 51.517, 5.095],
    ['haaren', 51.602, 5.222],
    ['vught', 51.6533, 5.2947],
    ['boxtel', 51.5908, 5.3293],
    ['schijndel', 51.6222, 5.4319],
    ['sint-michielsgestel', 51.6417, 5.3519],
    ['sint-oedenrode', 51.564, 5.4736],
    ['liempde', 51.568, 5.375],
    ['best', 51.5103, 5.3947],
    ['eindhoven', 51.4416, 5.4697],
    ['nuenen', 51.473, 5.551],
    ['geldrop', 51.4217, 5.5578],
    ['son-en-breugel', 51.513, 5.494],
    ['veldhoven', 51.4181, 5.4028],
    ['waalre', 51.3858, 5.4447],
    ['oirschot', 51.5056, 5.3089],
    ['dongen', 51.6267, 4.9383],
    ['gilze', 51.5447, 4.9403],
    ['rijen', 51.5881, 4.9267],
    ['bavel', 51.555, 4.865],
    ['alphen', 51.483, 4.956],
    ['chaam', 51.505, 4.861],
    ['baarle-nassau', 51.445, 4.929],
    ['bladel', 51.368, 5.208],
    ['reusel', 51.36, 5.165],
    ['hooge-mierlo', 51.439, 5.618],
    ['helmond', 51.4811, 5.6559],
    ['deurne', 51.456, 5.79],
    ['gemert', 51.555, 5.698],
    ['veghel', 51.6167, 5.5486],
    ['zeeland', 51.697, 5.676],
    ['mill', 51.685, 5.78],
    ['cuijk', 51.727, 5.879],
    ['grave', 51.759, 5.741],
    ['nijmegen', 51.8426, 5.8598],
    ['oss', 51.765, 5.5181],
    ['den-bosch', 51.6978, 5.3037],
    ['s-hertogenbosch', 51.6978, 5.3037],
    ['rosmalen', 51.7167, 5.3681],
    ['waalwijk', 51.6828, 5.0717],
    ['drunen', 51.686, 5.059],
    ['kaatsheuvel', 51.6598, 5.0304],
    ['loon-op-zand', 51.6278, 5.0753],
    ['sprang-capelle', 51.671, 5.049],
    ['oosterhout', 51.6439, 4.8601],
    ['breda', 51.5719, 4.7683],
    ['etten-leur', 51.5706, 4.636],
    ['rucphen', 51.532, 4.558],
    ['roosendaal', 51.5308, 4.4654],
    ['bergen-op-zoom', 51.495, 4.292],
    ['steenbergen', 51.585, 4.317],
    ['zevenbergen', 51.645, 4.606],
    ['gorinchem', 51.833, 4.974],
    ['zaltbommel', 51.81, 5.244],
    ['tiel', 51.886, 5.429],
    ['weert', 51.2517, 5.7067],
    ['roermond', 51.194, 6.002],
    ['venlo', 51.3703, 6.1724],
    ['venray', 51.525, 5.975],
    ['valkenswaard', 51.35, 5.459],
    ['eersel', 51.357, 5.318],
    ['someren', 51.386, 5.711],
    ['asten', 51.404, 5.748],
    ['turnhout', 51.3225, 4.9447],
    ['geel', 51.161, 4.99],
    ['mol', 51.191, 5.115],
    ['hamont-achel', 51.251, 5.545],
    ['leende', 51.35, 5.553],
    ['maastricht', 50.8514, 5.691],
    ['heerlen', 50.8837, 5.981],
  ];
  const REGIO_PLACE_COORDS = Object.create(null);

  REGIO_PLACE_COORD_ENTRIES.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 3) return;
    const [name, lat, lng] = entry;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    REGIO_PLACE_COORDS[String(name)] = { lat, lng };
  });

  function normalizeDutchPlaceKey(raw) {
    return String(raw || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['\u2019]/g, '')
      .replace(/^\d{4}\s*[a-z]{0,2}\s+/i, '')
      .trim();
  }

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function coordsForPlaceHint(raw) {
    const s = normalizeDutchPlaceKey(raw);
    if (!s) return null;
    if (REGIO_PLACE_COORDS[s]) return REGIO_PLACE_COORDS[s];
    const hyphenated = s.replace(/\s+/g, '-');
    if (REGIO_PLACE_COORDS[hyphenated]) return REGIO_PLACE_COORDS[hyphenated];
    const tokens = s.split(/[\s,/]+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      let token = tokens[i];
      token = token.replace(/^gemeente-?/i, '');
      if (REGIO_PLACE_COORDS[token]) return REGIO_PLACE_COORDS[token];
      const hy = token.replace(/\s+/g, '-');
      if (REGIO_PLACE_COORDS[hy]) return REGIO_PLACE_COORDS[hy];
    }
    return null;
  }

  function minAirDistanceKmFromOisterwijkForLead(lead) {
    const hints = [];
    if (lead && lead.region) hints.push(lead.region);
    if (lead && lead.address) {
      const tail = String(lead.address)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .pop();
      if (tail) hints.push(tail);
    }
    let best = null;
    hints.forEach((hint) => {
      const coords = coordsForPlaceHint(hint);
      if (!coords) return;
      const distance = haversineKm(OISTERWIJK_CAMPAIGN_CENTER, coords);
      if (!Number.isFinite(distance)) return;
      if (best === null || distance < best) best = distance;
    });
    return best;
  }

  function countDialableLeadsWithinCampaignRegioRadius(leads, radiusKm) {
    if (!Array.isArray(leads) || !leads.length) return 0;
    if (!Number.isFinite(radiusKm) || radiusKm === Infinity) return leads.length;
    const roadishFactor = 1.15;
    const limit = Math.max(0, radiusKm) * roadishFactor;
    let total = 0;
    leads.forEach((lead) => {
      const distance = minAirDistanceKmFromOisterwijkForLead(lead);
      if (distance !== null && distance <= limit) total += 1;
    });
    return total;
  }

  function resolveAutomaticCampaignRegioKm(leads, options = {}) {
    if (!Array.isArray(leads) || !leads.length) return 10;
    const cap = Number.isFinite(Number(options.maxKm))
      ? Math.max(10, Math.round(Number(options.maxKm)))
      : DEFAULT_MAX_CAMPAIGN_REGIO_KM;
    const maxReach = countDialableLeadsWithinCampaignRegioRadius(leads, cap);
    if (maxReach <= 0) return 10;
    for (let km = 10; km <= cap; km += 10) {
      if (countDialableLeadsWithinCampaignRegioRadius(leads, km) >= maxReach) {
        return km;
      }
    }
    return cap;
  }

  global.SoftoraColdcallingRegioRadius = {
    coordsForPlaceHint,
    countDialableLeadsWithinCampaignRegioRadius,
    haversineKm,
    minAirDistanceKmFromOisterwijkForLead,
    normalizeDutchPlaceKey,
    resolveAutomaticCampaignRegioKm,
  };
})(window);
