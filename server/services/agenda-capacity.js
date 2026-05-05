function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function createAgendaCapacityService(deps = {}) {
  const {
    normalizeString = defaultNormalizeString,
    normalizeDateYyyyMmDd = (value) => normalizeString(value),
    normalizeTimeHhMm = (value) => normalizeString(value),
    now = () => new Date(),
  } = deps;

  function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
  }

  function clamp(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  }

  function hhMmToMinutes(value, fallback = -1) {
    const normalized = normalizeTimeHhMm(value);
    const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return fallback;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
    return hours * 60 + minutes;
  }

  function minutesToHhMm(totalMinutes) {
    const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, toInt(totalMinutes, 0)));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function addDaysToDate(dateYmd, daysToAdd) {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    if (!normalizedDate) return '';
    const [yearRaw, monthRaw, dayRaw] = normalizedDate.split('-');
    const date = new Date(Date.UTC(toInt(yearRaw, 0), toInt(monthRaw, 1) - 1, toInt(dayRaw, 1), 12));
    date.setUTCDate(date.getUTCDate() + toInt(daysToAdd, 0));
    return date.toISOString().slice(0, 10);
  }

  function getCurrentLocalDateTime(timeZone = 'Europe/Amsterdam') {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: normalizeString(timeZone) || 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now());
    const partByType = Object.create(null);
    parts.forEach((part) => {
      if (part?.type) partByType[part.type] = part.value;
    });
    const hour = normalizeString(partByType.hour || '') === '24' ? '00' : normalizeString(partByType.hour || '');
    return {
      date: `${partByType.year}-${partByType.month}-${partByType.day}`,
      time: `${hour}:${partByType.minute}`,
    };
  }

  function isBusinessWeekday(dateYmd) {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    if (!normalizedDate) return false;
    const [yearRaw, monthRaw, dayRaw] = normalizedDate.split('-');
    const date = new Date(Date.UTC(toInt(yearRaw, 0), toInt(monthRaw, 1) - 1, toInt(dayRaw, 1), 12));
    const day = date.getUTCDay();
    return day >= 1 && day <= 5;
  }

  function buildCandidateTimes(slotMinutes, businessHoursStart, businessHoursEnd) {
    const safeSlotMinutes = clamp(slotMinutes, 15, 240, 60);
    const startMinutes = hhMmToMinutes(businessHoursStart, 9 * 60);
    const endMinutes = hhMmToMinutes(businessHoursEnd, 17 * 60);
    const safeEndMinutes = endMinutes > startMinutes ? endMinutes : 17 * 60;
    const lastStartMinutes = Math.max(startMinutes, safeEndMinutes - safeSlotMinutes);
    const candidates = [];

    for (let minutes = startMinutes; minutes <= lastStartMinutes; minutes += safeSlotMinutes) {
      candidates.push(minutesToHhMm(minutes));
    }

    return candidates;
  }

  function resolveAppointmentEndMinutes(appointment, startMinutes, fallbackSlotMinutes) {
    const directEnd = hhMmToMinutes(
      appointment?.manualAvailableAgain ||
        appointment?.travelReadyAt ||
        appointment?.availableAgain ||
        appointment?.available_after ||
        ''
    );
    if (directEnd > startMinutes) return directEnd;

    const summary = normalizeString(appointment?.summary || '');
    const match =
      summary.match(/weer beschikbaar[^:\n]*:\s*(\d{1,2}:\d{2})/i) ||
      summary.match(/\bbeschikbaar[^:\n]*:\s*(\d{1,2}:\d{2})/i);
    const summaryEnd = hhMmToMinutes(match?.[1] || '');
    if (summaryEnd > startMinutes) return summaryEnd;

    return startMinutes + clamp(fallbackSlotMinutes, 15, 240, 60);
  }

  function collectBlockedSlotsForDate(dateYmd, appointments, options = {}) {
    const candidateTimes = Array.isArray(options.candidateTimes) ? options.candidateTimes : [];
    const slotMinutes = clamp(options.slotMinutes, 15, 240, 60);
    const blocked = new Set();

    (Array.isArray(appointments) ? appointments : []).forEach((appointment) => {
      if (normalizeDateYyyyMmDd(appointment?.date || '') !== dateYmd) return;

      if (appointment?.manualAllDayUnavailable || appointment?.allDayUnavailable) {
        candidateTimes.forEach((time) => blocked.add(time));
        return;
      }

      const appointmentStart = hhMmToMinutes(appointment?.time || '');
      if (appointmentStart < 0) return;
      const appointmentEnd = resolveAppointmentEndMinutes(appointment, appointmentStart, slotMinutes);

      candidateTimes.forEach((time) => {
        const slotStart = hhMmToMinutes(time);
        if (slotStart < 0) return;
        const slotEnd = slotStart + slotMinutes;
        if (slotStart < appointmentEnd && slotEnd > appointmentStart) {
          blocked.add(time);
        }
      });
    });

    return blocked;
  }

  function getFirstCapacityDate(nowLocal, businessHoursEnd) {
    const endMinutes = hhMmToMinutes(businessHoursEnd, 17 * 60);
    const nowMinutes = hhMmToMinutes(nowLocal.time, 0);
    if (!isBusinessWeekday(nowLocal.date) || nowMinutes >= endMinutes) {
      let date = nowLocal.date;
      do {
        date = addDaysToDate(date, 1);
      } while (date && !isBusinessWeekday(date));
      return date;
    }
    return nowLocal.date;
  }

  function getUpcomingBusinessDates(startDate, workdayCount) {
    const dates = [];
    let date = normalizeDateYyyyMmDd(startDate);
    let guard = 0;
    while (date && dates.length < workdayCount && guard < 45) {
      if (isBusinessWeekday(date)) dates.push(date);
      date = addDaysToDate(date, 1);
      guard += 1;
    }
    return dates;
  }

  function assessUpcomingWorkdayCapacity(options = {}) {
    const timeZone = normalizeString(options.timeZone || 'Europe/Amsterdam') || 'Europe/Amsterdam';
    const workdayCount = clamp(options.workdayCount, 1, 31, 10);
    const slotMinutes = clamp(options.slotMinutes, 15, 240, 60);
    const businessHoursStart = normalizeTimeHhMm(options.businessHoursStart || '') || '09:00';
    const businessHoursEnd = normalizeTimeHhMm(options.businessHoursEnd || '') || '17:00';
    const candidateTimes = buildCandidateTimes(slotMinutes, businessHoursStart, businessHoursEnd);
    const nowLocal = getCurrentLocalDateTime(timeZone);
    const startDate = getFirstCapacityDate(nowLocal, businessHoursEnd);
    const rawAppointments = Array.isArray(options.appointments) ? options.appointments : [];
    const isAppointmentVisible =
      typeof options.isAppointmentVisible === 'function' ? options.isAppointmentVisible : () => true;
    const appointments = rawAppointments.filter((appointment) => isAppointmentVisible(appointment));
    const dates = getUpcomingBusinessDates(startDate, workdayCount);
    let totalSlots = 0;
    let blockedSlots = 0;
    let firstAvailableSlot = null;

    const workdays = dates.map((date) => {
      const blocked = collectBlockedSlotsForDate(date, appointments, { candidateTimes, slotMinutes });
      const minTime =
        date === nowLocal.date && hhMmToMinutes(nowLocal.time) >= hhMmToMinutes(businessHoursStart)
          ? nowLocal.time
          : '';
      const available = candidateTimes.filter((time) => {
        if (minTime && time <= minTime) return false;
        return !blocked.has(time);
      });
      const dayTotal = candidateTimes.filter((time) => !minTime || time > minTime).length;
      const dayBlocked = Math.max(0, dayTotal - available.length);

      totalSlots += dayTotal;
      blockedSlots += dayBlocked;
      if (!firstAvailableSlot && available.length > 0) {
        firstAvailableSlot = { date, time: available[0] };
      }

      return {
        date,
        totalSlots: dayTotal,
        blockedSlots: dayBlocked,
        availableSlots: available.length,
      };
    });

    const availableSlots = Math.max(0, totalSlots - blockedSlots);

    return {
      full: totalSlots > 0 && availableSlots === 0,
      workdayCount: dates.length,
      totalSlots,
      blockedSlots,
      availableSlots,
      firstAvailableSlot,
      workdays,
      constraints: {
        timeZone,
        businessHoursStart,
        businessHoursEnd,
        slotMinutes,
      },
    };
  }

  return {
    assessUpcomingWorkdayCapacity,
  };
}

module.exports = {
  createAgendaCapacityService,
};
