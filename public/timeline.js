const CAR_TYPES = new Set(['IN_PASSENGER_VEHICLE', 'IN_VEHICLE', 'IN_CAR', 'DRIVING']);
export const DEFAULT_SCHEDULE = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };

function timestamp(value, offsetMinutes) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    throw new Error('Missing or invalid trip timestamp.');
  }
  // An explicit numeric offset in newer exports also applies to timestamps written in UTC.
  const suffix = value.match(/([+-])(\d{2}):(\d{2})$/);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || (!suffix && !value.endsWith('Z'))) {
    throw new Error('Trip timestamps must include a timezone.');
  }
  const offset = Number.isFinite(offsetMinutes) ? offsetMinutes
    : suffix ? (suffix[1] === '-' ? -1 : 1) * (Number(suffix[2]) * 60 + Number(suffix[3])) : 0;
  const local = new Date(epoch + offset * 60_000).toISOString();
  return { epoch, date: local.slice(0, 10), time: local.slice(11, 16) };
}

function legacyTime(duration, key) {
  if (duration?.[`${key}Timestamp`]) return duration[`${key}Timestamp`];
  const milliseconds = duration?.[`${key}TimestampMs`];
  if (milliseconds === undefined || milliseconds === null || milliseconds === '') return undefined;
  const date = new Date(Number(milliseconds));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function placeLabel(place) {
  if (!place) return '';
  if (typeof place.name === 'string' && place.name) return place.name;
  if (typeof place.address === 'string' && place.address) return place.address;
  const coordinate = place.latLng ?? place.point;
  if (typeof coordinate === 'string') return coordinate.replace(/^geo:/, '');
  if (Number.isFinite(place.latitudeE7) && Number.isFinite(place.longitudeE7)) {
    return `${(place.latitudeE7 / 1e7).toFixed(5)}, ${(place.longitudeE7 / 1e7).toFixed(5)}`;
  }
  return '';
}

export function coordinates(place) {
  let lat;
  let lng;
  if (typeof place === 'string') {
    const match = place.match(/^(?:geo:)?\s*(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)\s*°?\s*$/);
    if (!match) return null;
    lat = Number(match[1]);
    lng = Number(match[2]);
  } else if (place && typeof place === 'object') {
    const text = place.latLng ?? place.point;
    if (typeof text === 'string') return coordinates(text);
    lat = (place.latitudeE7 ?? place.latE7) / 1e7;
    lng = (place.longitudeE7 ?? place.lngE7) / 1e7;
  }
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? [lat, lng] : null;
}

export function coordinateKey(point) {
  return point ? point.map(value => value.toFixed(5)).join(', ') : '';
}

function firstPointAt(points, epoch) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].epoch < epoch) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function parseTimeline(data) {
  const modern = Array.isArray(data?.semanticSegments) || Array.isArray(data);
  const segments = Array.isArray(data) ? data : modern ? data.semanticSegments : data?.timelineObjects;
  if (!Array.isArray(segments)) {
    throw new Error('Unsupported export. Choose a Timeline JSON containing semanticSegments or timelineObjects. Raw location-history points alone cannot identify car trips.');
  }
  const trips = [];
  let skipped = 0;
  let ignored = 0;
  let activities = 0;
  const pathPoints = [];
  for (const segment of segments) {
    for (const entry of Array.isArray(segment?.timelinePath) ? segment.timelinePath : []) {
      const point = coordinates(entry);
      const epoch = typeof entry.time === 'string' ? Date.parse(entry.time) : NaN;
      if (point && Number.isFinite(epoch)) pathPoints.push({ point, epoch });
    }
  }
  pathPoints.sort((a, b) => a.epoch - b.epoch);
  for (const segment of segments) {
    const activity = modern ? segment?.activity : segment?.activitySegment;
    if (!activity) continue;
    activities++;
    const type = modern ? activity.topCandidate?.type ?? activity.type : activity.activityType;
    if (!CAR_TYPES.has(type)) {
      ignored++;
      continue;
    }
    const rawDistance = modern ? activity.distanceMeters : activity.distance;
    const meters = typeof rawDistance === 'number' ? rawDistance
      : typeof rawDistance === 'string' && rawDistance.trim() ? Number(rawDistance) : NaN;
    if (!Number.isFinite(meters) || meters < 0) {
      skipped++;
      continue;
    }
    let start;
    let end;
    try {
      start = timestamp(modern ? segment.startTime : legacyTime(activity.duration, 'start'),
        segment.startTimeTimezoneUtcOffsetMinutes);
      end = timestamp(modern ? segment.endTime : legacyTime(activity.duration, 'end'),
        segment.endTimeTimezoneUtcOffsetMinutes);
      if (end.epoch < start.epoch) throw new Error('Trip ends before it starts.');
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      skipped++;
      continue;
    }
    const from = modern ? activity.start : activity.startLocation;
    const to = modern ? activity.end : activity.endLocation;
    const fromCoordinate = coordinates(from);
    const toCoordinate = coordinates(to);
    const path = [];
    for (let index = firstPointAt(pathPoints, start.epoch);
      index < pathPoints.length && pathPoints[index].epoch <= end.epoch; index++) {
      path.push(pathPoints[index].point);
    }
    if (!path.length) {
      const waypoints = activity.waypointPath?.waypoints ?? activity.simplifiedRawPath?.points;
      if (Array.isArray(waypoints)) {
        for (const waypoint of waypoints) {
          const point = coordinates(waypoint);
          if (point) path.push(point);
        }
      }
    }
    const hasRecordedPath = path.length > 0;
    if (fromCoordinate) path.unshift(fromCoordinate);
    if (toCoordinate) path.push(toCoordinate);
    trips.push({
      id: `${start.epoch}:${end.epoch}:${meters}`,
      startEpoch: start.epoch,
      endEpoch: end.epoch,
      date: start.date,
      start: start.time,
      endDate: end.date,
      end: end.time,
      km: meters / 1000,
      type,
      from: placeLabel(from),
      to: placeLabel(to),
      fromCoordinate,
      toCoordinate,
      fromAddress: typeof from?.address === 'string' ? from.address : '',
      toAddress: typeof to?.address === 'string' ? to.address : '',
      fromName: typeof from?.name === 'string' ? from.name : '',
      toName: typeof to?.name === 'string' ? to.name : '',
      path,
      hasRecordedPath,
    });
  }
  return { trips, skipped, ignored, activities };
}

export function mergeTrips(trips) {
  return [...new Map(trips.map(trip => [trip.id, trip])).values()]
    .sort((a, b) => a.startEpoch - b.startEpoch || a.id.localeCompare(b.id));
}

function minutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function validateSchedule(schedule) {
  if (!schedule || !Array.isArray(schedule.days)
    || !schedule.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    || ![schedule.start, schedule.end].every(time => typeof time === 'string'
      && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error('Choose valid workdays and working hours.');
  }
  if (schedule.start === schedule.end) throw new Error('Work start and end times must be different.');
  return schedule;
}

export function classifyTrip(trip, schedule, overrides = new Map()) {
  if (overrides.has(trip.id)) return overrides.get(trip.id);
  const day = new Date(`${trip.date}T00:00:00Z`).getUTCDay();
  const time = minutes(trip.start);
  const start = minutes(schedule.start);
  const end = minutes(schedule.end);
  const work = start < end
    ? schedule.days.includes(day) && time >= start && time < end
    : (schedule.days.includes(day) && time >= start)
      || (schedule.days.includes((day + 6) % 7) && time < end);
  return work ? 'work' : 'private';
}

export function summarizeDays(trips, schedule, overrides) {
  const days = new Map();
  for (const trip of trips) {
    if (!days.has(trip.date)) {
      days.set(trip.date, { date: trip.date, trips: 0, work: 0, commute: 0, private: 0, total: 0 });
    }
    const day = days.get(trip.date);
    day.trips++;
    day[classifyTrip(trip, schedule, overrides)] += trip.km;
    day.total += trip.km;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function csvCell(value) {
  let text = String(value ?? '');
  // Place names are untrusted input; do not allow spreadsheet formula execution.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function dailyCsv(days) {
  return csv([
    ['Date', 'Car trips', 'Work km', 'Commute km', 'Private km', 'Total km'],
    ...days.map(day => [day.date, day.trips, day.work.toFixed(3), day.commute.toFixed(3), day.private.toFixed(3), day.total.toFixed(3)]),
  ]);
}

export function tripsCsv(trips, schedule, overrides) {
  return csv([
    ['Date', 'Departure', 'Arrival date', 'Arrival', 'From', 'To', 'Kilometers', 'Category', 'Classification source', 'From address', 'To address', 'From coordinates', 'To coordinates'],
    ...trips.map(trip => [
      trip.date, trip.start, trip.endDate, trip.end, trip.from, trip.to, trip.km.toFixed(3),
      classifyTrip(trip, schedule, overrides), overrides.has(trip.id) ? 'manual' : 'schedule',
      trip.fromAddress, trip.toAddress, coordinateKey(trip.fromCoordinate), coordinateKey(trip.toCoordinate),
    ]),
  ]);
}
