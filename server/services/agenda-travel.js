const { fetchJsonWithTimeout: defaultFetchJsonWithTimeout } = require('./runtime-fetch');

function createAgendaTravelService(deps = {}) {
  const {
    env = process.env,
    fetchJsonWithTimeout = defaultFetchJsonWithTimeout,
    normalizeString = (value) => String(value ?? '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value ?? '').trim(),
    normalizeTimeHhMm = (value) => String(value ?? '').trim(),
    sanitizeAppointmentLocation = (value) => String(value ?? '').trim(),
  } = deps;

  function clamp(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  }

  function hhMmToMinutes(value, fallback = -1) {
    const normalized = normalizeTimeHhMm(value);
    if (!normalized) return fallback;
    const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return fallback;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
    return hours * 60 + minutes;
  }

  function minutesToHhMm(totalMinutes) {
    const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, Number(totalMinutes) || 0));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function addMinutesToTime(value, minutesToAdd, fallback = '') {
    const current = hhMmToMinutes(value, -1);
    if (current < 0) return fallback;
    return minutesToHhMm(current + clamp(minutesToAdd, 0, 24 * 60, 0));
  }

  function parseCoordinate(value) {
    if (value === undefined || value === null || value === '') return null;
    const raw = normalizeString(String(value).replace(',', '.'));
    if (!raw) return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return Number(numeric.toFixed(6));
  }

  function normalizePlannerKey(value) {
    const raw = normalizeString(value).toLowerCase();
    if (!raw) return '';
    if (raw === 'servé' || raw === 'serve') return 'serve';
    if (raw === 'martijn') return 'martijn';
    if (raw === 'both' || raw === 'allebei' || raw === 'beide' || raw === 'serve-martijn') return 'both';
    return raw;
  }

  function resolveAppointmentPlannerKey(appointment) {
    return normalizePlannerKey(
      appointment?.manualPlannerWho ||
        appointment?.manualWho ||
        appointment?.planner ||
        appointment?.assignedPlanner ||
        appointment?.assignedTo ||
        ''
    );
  }

  function appointmentBlocksPlanner(appointment, plannerKey) {
    const normalizedPlanner = normalizePlannerKey(plannerKey);
    if (!normalizedPlanner) return true;
    const appointmentPlanner = resolveAppointmentPlannerKey(appointment);
    if (!appointmentPlanner) return true;
    if (appointmentPlanner === 'both') return normalizedPlanner === 'serve' || normalizedPlanner === 'martijn' || normalizedPlanner === 'both';
    return appointmentPlanner === normalizedPlanner;
  }

  function normalizeLocationInput(raw = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { location: raw };
    const label = sanitizeAppointmentLocation(
      source.location ||
        source.appointmentLocation ||
        source.address ||
        source.label ||
        source.formattedAddress ||
        ''
    );
    const placeId = normalizeString(
      source.locationPlaceId ||
        source.appointmentLocationPlaceId ||
        source.placeId ||
        source.place_id ||
        ''
    );
    const lat = parseCoordinate(source.locationLat || source.appointmentLocationLat || source.lat || source.latitude);
    const lng = parseCoordinate(
      source.locationLng || source.appointmentLocationLng || source.lng || source.longitude
    );

    return {
      label,
      normalizedLabel: label.toLowerCase(),
      placeId,
      lat,
      lng,
      hasAnyLocation: Boolean(label || placeId || (lat !== null && lng !== null)),
    };
  }

  function extractTravelReadyAtFromSummary(summary) {
    const normalizedSummary = normalizeString(summary);
    const match =
      normalizedSummary.match(/weer beschikbaar[^:\n]*:\s*(\d{1,2}:\d{2})/i) ||
      normalizedSummary.match(/\bbeschikbaar[^:\n]*:\s*(\d{1,2}:\d{2})/i);
    return normalizeTimeHhMm(match?.[1] || '');
  }

  function resolveAppointmentTravelReadyAt(appointment, fallbackSlotMinutes = 60) {
    const direct = normalizeTimeHhMm(
      appointment?.travelReadyAt || appointment?.availableAgain || appointment?.available_after || ''
    );
    if (direct) return direct;

    const fromSummary = extractTravelReadyAtFromSummary(appointment?.summary || '');
    if (fromSummary) return fromSummary;

    const appointmentTime = normalizeTimeHhMm(appointment?.time || '');
    if (!appointmentTime) return '';
    return addMinutesToTime(appointmentTime, clamp(fallbackSlotMinutes, 15, 240, 60), '');
  }

  function getGoogleMapsServerApiKey() {
    return normalizeString(env.GOOGLE_MAPS_SERVER_API_KEY || env.GOOGLE_MAPS_API_KEY || '');
  }

  function parseTimeZoneOffsetMinutes(timeZoneName) {
    const raw = normalizeString(timeZoneName);
    const match = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
    return sign * (hours * 60 + minutes);
  }

  function getOffsetMinutesForLocalDate(timeZone, dateYmd) {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    if (!normalizedDate) return 0;
    const [yearRaw, monthRaw, dayRaw] = normalizedDate.split('-');
    const sampleDate = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw), 12, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeString(timeZone || 'Europe/Amsterdam') || 'Europe/Amsterdam',
      timeZoneName: 'shortOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(sampleDate);
    const tzPart = parts.find((part) => part.type === 'timeZoneName');
    return parseTimeZoneOffsetMinutes(tzPart?.value || '');
  }

  function buildDepartureTimeIso(dateYmd, timeHm, timeZone = 'Europe/Amsterdam') {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    const normalizedTime = normalizeTimeHhMm(timeHm);
    if (!normalizedDate || !normalizedTime) return null;
    const [yearRaw, monthRaw, dayRaw] = normalizedDate.split('-');
    const [hoursRaw, minsRaw] = normalizedTime.split(':');
    const offsetMinutes = getOffsetMinutesForLocalDate(timeZone, normalizedDate);
    const utcMs =
      Date.UTC(
        Number(yearRaw),
        Number(monthRaw) - 1,
        Number(dayRaw),
        Number(hoursRaw),
        Number(minsRaw),
        0,
        0
      ) -
      offsetMinutes * 60 * 1000;
    return new Date(utcMs).toISOString();
  }

  function sameCoordinates(left, right) {
    if (!left || !right) return false;
    if (left.lat === null || left.lng === null || right.lat === null || right.lng === null) return false;
    const latDiff = Math.abs(left.lat - right.lat);
    const lngDiff = Math.abs(left.lng - right.lng);
    return latDiff < 0.0005 && lngDiff < 0.0005;
  }

  function isSameLocation(left, right) {
    if (!left || !right) return false;
    if (left.placeId && right.placeId && left.placeId === right.placeId) return true;
    if (sameCoordinates(left, right)) return true;
    return Boolean(left.normalizedLabel && right.normalizedLabel && left.normalizedLabel === right.normalizedLabel);
  }

  function haversineDistanceKm(left, right) {
    if (!left || !right) return null;
    if (left.lat === null || left.lng === null || right.lat === null || right.lng === null) return null;

    const toRadians = (value) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRadians(right.lat - left.lat);
    const dLng = toRadians(right.lng - left.lng);
    const lat1 = toRadians(left.lat);
    const lat2 = toRadians(right.lat);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  function estimateTravelMinutesFromCoordinates(origin, destination) {
    const distanceKm = haversineDistanceKm(origin, destination);
    if (distanceKm === null) return null;
    if (distanceKm < 0.5) return 0;
    const estimatedRoadKm = distanceKm * 1.28;
    return Math.max(10, Math.ceil((estimatedRoadKm / 65) * 60));
  }

  function parseGoogleDurationToMinutes(value) {
    const raw = normalizeString(value);
    const match = raw.match(/^(\d+(?:\.\d+)?)s$/);
    if (!match) return null;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.max(0, Math.ceil(seconds / 60));
  }

  async function geocodeLocation(location, memo = new Map()) {
    const normalizedLocation = normalizeLocationInput(location);
    if (!normalizedLocation.hasAnyLocation) {
      return {
        ...normalizedLocation,
        resolved: false,
        source: 'missing',
      };
    }

    if (normalizedLocation.lat !== null && normalizedLocation.lng !== null) {
      return {
        ...normalizedLocation,
        resolved: true,
        source: normalizedLocation.placeId ? 'provided_place_and_coordinates' : 'provided_coordinates',
      };
    }

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) {
      return {
        ...normalizedLocation,
        resolved: false,
        source: 'missing_api_key',
      };
    }

    const cacheKey = `geocode:${normalizedLocation.placeId || normalizedLocation.normalizedLabel}`;
    if (memo.has(cacheKey)) return memo.get(cacheKey);

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('language', 'nl');
    url.searchParams.set('region', 'nl');
    if (normalizedLocation.placeId) {
      url.searchParams.set('place_id', normalizedLocation.placeId);
    } else {
      url.searchParams.set('address', normalizedLocation.label);
    }

    const pending = (async () => {
      try {
        const { response, data } = await fetchJsonWithTimeout(
          url.toString(),
          {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          },
          3500
        );

        if (!response?.ok || !Array.isArray(data?.results) || data.results.length === 0) {
          return {
            ...normalizedLocation,
            resolved: false,
            source: 'geocode_lookup_failed',
          };
        }

        const first = data.results[0] || {};
        const lat = parseCoordinate(first?.geometry?.location?.lat);
        const lng = parseCoordinate(first?.geometry?.location?.lng);
        return {
          ...normalizedLocation,
          label:
            sanitizeAppointmentLocation(first?.formatted_address || normalizedLocation.label || '') ||
            normalizedLocation.label,
          normalizedLabel:
            sanitizeAppointmentLocation(first?.formatted_address || normalizedLocation.label || '').toLowerCase() ||
            normalizedLocation.normalizedLabel,
          placeId: normalizeString(first?.place_id || normalizedLocation.placeId || ''),
          lat,
          lng,
          resolved: lat !== null && lng !== null,
          source: normalizedLocation.placeId ? 'google_geocode_place_id' : 'google_geocode_address',
        };
      } catch {
        return {
          ...normalizedLocation,
          resolved: false,
          source: 'geocode_lookup_failed',
        };
      }
    })();

    memo.set(cacheKey, pending);
    return pending;
  }

  async function estimateTravelDuration(origin, destination, options = {}) {
    const routeMemo = options.routeMemo instanceof Map ? options.routeMemo : new Map();
    const geocodeMemo = options.geocodeMemo instanceof Map ? options.geocodeMemo : new Map();
    const resolvedOrigin = await geocodeLocation(origin, geocodeMemo);
    const resolvedDestination = await geocodeLocation(destination, geocodeMemo);

    if (isSameLocation(resolvedOrigin, resolvedDestination)) {
      return {
        ok: true,
        minutes: 0,
        source: 'same_location',
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };
    }

    const fallbackMinutes = estimateTravelMinutesFromCoordinates(resolvedOrigin, resolvedDestination);
    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey || resolvedOrigin.lat === null || resolvedOrigin.lng === null) {
      if (fallbackMinutes !== null) {
        return {
          ok: true,
          minutes: fallbackMinutes,
          source: 'coordinate_estimate',
          origin: resolvedOrigin,
          destination: resolvedDestination,
        };
      }
      return {
        ok: false,
        minutes: null,
        source: !apiKey ? 'missing_api_key' : 'origin_unresolved',
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };
    }
    if (resolvedDestination.lat === null || resolvedDestination.lng === null) {
      if (fallbackMinutes !== null) {
        return {
          ok: true,
          minutes: fallbackMinutes,
          source: 'coordinate_estimate',
          origin: resolvedOrigin,
          destination: resolvedDestination,
        };
      }
      return {
        ok: false,
        minutes: null,
        source: 'destination_unresolved',
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };
    }

    const departureDate = normalizeDateYyyyMmDd(options.departureDate || '');
    const departureTime = normalizeTimeHhMm(options.departureTime || '');
    const routingPreference = normalizeString(options.routingPreference || 'TRAFFIC_AWARE') || 'TRAFFIC_AWARE';
    const cacheKey = [
      'route',
      resolvedOrigin.lat,
      resolvedOrigin.lng,
      resolvedDestination.lat,
      resolvedDestination.lng,
      departureDate,
      departureTime,
      routingPreference,
    ].join(':');
    if (routeMemo.has(cacheKey)) return routeMemo.get(cacheKey);

    const pending = (async () => {
      try {
        const body = {
          origin: {
            location: {
              latLng: {
                latitude: resolvedOrigin.lat,
                longitude: resolvedOrigin.lng,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: resolvedDestination.lat,
                longitude: resolvedDestination.lng,
              },
            },
          },
          travelMode: 'DRIVE',
          routingPreference,
          units: 'METRIC',
        };
        const departureIso = buildDepartureTimeIso(
          departureDate,
          departureTime,
          normalizeString(options.timeZone || 'Europe/Amsterdam') || 'Europe/Amsterdam'
        );
        if (departureIso) body.departureTime = departureIso;

        const { response, data } = await fetchJsonWithTimeout(
          'https://routes.googleapis.com/directions/v2:computeRoutes',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': apiKey,
              'x-goog-fieldmask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
            },
            cache: 'no-store',
            body: JSON.stringify(body),
          },
          4500
        );

        const route = Array.isArray(data?.routes) ? data.routes[0] : null;
        const minutes = parseGoogleDurationToMinutes(route?.duration || '');
        if (response?.ok && route && minutes !== null) {
          return {
            ok: true,
            minutes,
            staticMinutes: parseGoogleDurationToMinutes(route?.staticDuration || ''),
            distanceMeters: Number(route?.distanceMeters || 0) || 0,
            source: 'google_routes',
            origin: resolvedOrigin,
            destination: resolvedDestination,
          };
        }
      } catch {
        // fall through to fallback below
      }

      if (fallbackMinutes !== null) {
        return {
          ok: true,
          minutes: fallbackMinutes,
          source: 'coordinate_estimate',
          origin: resolvedOrigin,
          destination: resolvedDestination,
        };
      }

      return {
        ok: false,
        minutes: null,
        source: 'route_lookup_failed',
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };
    })();

    routeMemo.set(cacheKey, pending);
    return pending;
  }

  function buildAppointmentTravelDescriptor(appointment) {
    const location = normalizeLocationInput(appointment);
    return {
      date: normalizeDateYyyyMmDd(appointment?.date || '') || null,
      time: normalizeTimeHhMm(appointment?.time || '') || null,
      location: location.label || null,
      planner: resolveAppointmentPlannerKey(appointment) || null,
      travelReadyAt: resolveAppointmentTravelReadyAt(appointment) || null,
      label:
        normalizeDateYyyyMmDd(appointment?.date || '') && normalizeTimeHhMm(appointment?.time || '')
          ? `${normalizeDateYyyyMmDd(appointment?.date || '')} ${normalizeTimeHhMm(appointment?.time || '')}`
          : null,
    };
  }

  async function evaluateSlotTravelFeasibility(options = {}) {
    const requestedDate = normalizeDateYyyyMmDd(options.requestedDate || '');
    const requestedTime = normalizeTimeHhMm(options.requestedTime || '');
    if (!requestedDate || !requestedTime) {
      return {
        available: false,
        reason: 'invalid',
        details: null,
      };
    }

    const requestedLocation = normalizeLocationInput(options.requestedLocation || {});
    if (!requestedLocation.hasAnyLocation) {
      return {
        available: true,
        reason: 'travel_skipped_no_location',
        details: {
          checked: false,
          reason: 'no_requested_location',
        },
      };
    }

    const plannerKey = normalizePlannerKey(options.planner || '');
    const sameDayAppointments = (Array.isArray(options.appointments) ? options.appointments : [])
      .filter((appointment) => normalizeDateYyyyMmDd(appointment?.date || '') === requestedDate)
      .filter((appointment) => {
        const ignoreCallId = normalizeString(options.ignoreCallId || '');
        if (ignoreCallId && normalizeString(appointment?.callId || '') === ignoreCallId) return false;
        const ignoreAppointmentId = Number(options.ignoreAppointmentId || 0) || 0;
        if (ignoreAppointmentId > 0 && Number(appointment?.id || 0) === ignoreAppointmentId) return false;
        return appointmentBlocksPlanner(appointment, plannerKey);
      })
      .slice()
      .sort((left, right) =>
        `${normalizeDateYyyyMmDd(left?.date || '')}T${normalizeTimeHhMm(left?.time || '')}`.localeCompare(
          `${normalizeDateYyyyMmDd(right?.date || '')}T${normalizeTimeHhMm(right?.time || '')}`
        )
      );

    const requestedStartMinutes = hhMmToMinutes(requestedTime, -1);
    const slotMinutes = clamp(options.slotMinutes, 15, 240, 60);
    const requestedTravelReadyAt = addMinutesToTime(requestedTime, slotMinutes, requestedTime);
    const requestedReadyMinutes = hhMmToMinutes(requestedTravelReadyAt, requestedStartMinutes + slotMinutes);
    const travelBufferMinutes = clamp(options.travelBufferMinutes, 0, 180, 15);
    const geocodeMemo = options.geocodeMemo instanceof Map ? options.geocodeMemo : new Map();
    const routeMemo = options.routeMemo instanceof Map ? options.routeMemo : new Map();

    const previousAppointment = sameDayAppointments
      .filter((appointment) => hhMmToMinutes(appointment?.time || '', -1) < requestedStartMinutes)
      .pop();
    const nextAppointment =
      sameDayAppointments.find((appointment) => hhMmToMinutes(appointment?.time || '', -1) > requestedStartMinutes) ||
      null;

    if (previousAppointment) {
      const previousTravelReadyAt = resolveAppointmentTravelReadyAt(previousAppointment, slotMinutes);
      const previousTravelReadyMinutes = hhMmToMinutes(previousTravelReadyAt, -1);
      const previousLocation = normalizeLocationInput(previousAppointment);
      const travelFromPrevious = await estimateTravelDuration(previousLocation, requestedLocation, {
        departureDate: requestedDate,
        departureTime: previousTravelReadyAt,
        timeZone: options.timeZone,
        geocodeMemo,
        routeMemo,
      });
      const extraBuffer = Number(travelFromPrevious?.minutes || 0) > 0 ? travelBufferMinutes : 0;
      const earliestArrivalMinutes =
        (previousTravelReadyMinutes >= 0 ? previousTravelReadyMinutes : requestedStartMinutes) +
        Math.max(0, Number(travelFromPrevious?.minutes || 0) || 0) +
        extraBuffer;

      if (!travelFromPrevious.ok) {
        return {
          available: false,
          reason: 'travel_unknown',
          details: {
            checked: true,
            conflictType: 'previous',
            source: travelFromPrevious.source,
            appointment: buildAppointmentTravelDescriptor(previousAppointment),
            requestedLocation: requestedLocation.label || null,
          },
        };
      }

      if (earliestArrivalMinutes > requestedStartMinutes) {
        return {
          available: false,
          reason: 'travel_from_previous',
          details: {
            checked: true,
            conflictType: 'previous',
            source: travelFromPrevious.source,
            appointment: buildAppointmentTravelDescriptor(previousAppointment),
            estimatedTravelMinutes: travelFromPrevious.minutes,
            bufferMinutes: extraBuffer,
            departureTime: previousTravelReadyAt || null,
            requiredArrivalTime: minutesToHhMm(earliestArrivalMinutes),
            requestedLocation: travelFromPrevious.destination?.label || requestedLocation.label || null,
          },
        };
      }
    }

    if (nextAppointment) {
      const nextLocation = normalizeLocationInput(nextAppointment);
      const nextStartMinutes = hhMmToMinutes(nextAppointment?.time || '', -1);
      const travelToNext = await estimateTravelDuration(requestedLocation, nextLocation, {
        departureDate: requestedDate,
        departureTime: requestedTravelReadyAt,
        timeZone: options.timeZone,
        geocodeMemo,
        routeMemo,
      });
      const extraBuffer = Number(travelToNext?.minutes || 0) > 0 ? travelBufferMinutes : 0;
      const arrivalAtNextMinutes =
        requestedReadyMinutes + Math.max(0, Number(travelToNext?.minutes || 0) || 0) + extraBuffer;

      if (!travelToNext.ok) {
        return {
          available: false,
          reason: 'travel_unknown',
          details: {
            checked: true,
            conflictType: 'next',
            source: travelToNext.source,
            appointment: buildAppointmentTravelDescriptor(nextAppointment),
            requestedLocation: requestedLocation.label || null,
          },
        };
      }

      if (arrivalAtNextMinutes > nextStartMinutes) {
        return {
          available: false,
          reason: 'travel_to_next',
          details: {
            checked: true,
            conflictType: 'next',
            source: travelToNext.source,
            appointment: buildAppointmentTravelDescriptor(nextAppointment),
            estimatedTravelMinutes: travelToNext.minutes,
            bufferMinutes: extraBuffer,
            departureTime: requestedTravelReadyAt,
            requiredArrivalTime: minutesToHhMm(arrivalAtNextMinutes),
            requestedLocation: travelToNext.origin?.label || requestedLocation.label || null,
          },
        };
      }
    }

    return {
      available: true,
      reason: 'available',
      details: {
        checked: true,
        planner: plannerKey || null,
      },
    };
  }

  return {
    addMinutesToTime,
    appointmentBlocksPlanner,
    buildAppointmentTravelDescriptor,
    buildDepartureTimeIso,
    estimateTravelDuration,
    evaluateSlotTravelFeasibility,
    geocodeLocation,
    normalizeLocationInput,
    normalizePlannerKey,
    resolveAppointmentPlannerKey,
    resolveAppointmentTravelReadyAt,
  };
}

module.exports = {
  createAgendaTravelService,
};
