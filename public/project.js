import { parseTimeline, mergeTrips, validateSchedule, classifyTrip } from './timeline.js';

export const PROJECT_FORMAT = 'mileage-project';

export function createProject(sources, trips, schedule, overrides) {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    sources,
    schedule,
    assignments: trips.map(trip => ({
      id: trip.id,
      category: classifyTrip(trip, schedule, overrides),
      source: overrides.has(trip.id) ? 'manual' : 'schedule',
      km: trip.km,
      fromAddress: trip.fromAddress,
      toAddress: trip.toAddress,
    })),
  };
}

export function loadProject(data) {
  if (data?.format !== PROJECT_FORMAT || data.version !== 1
    || !Array.isArray(data.sources) || !data.sources.length || !Array.isArray(data.assignments)) {
    throw new Error('Invalid or unsupported mileage project JSON.');
  }
  const schedule = validateSchedule(data.schedule);
  const imported = [];
  let skipped = 0;
  let ignored = 0;
  for (const source of data.sources) {
    if (!source || typeof source.name !== 'string') throw new Error('Invalid project source file.');
    const result = parseTimeline(source.data);
    for (const trip of result.trips) imported.push(trip);
    skipped += result.skipped;
    ignored += result.ignored;
  }
  const trips = mergeTrips(imported);
  const byId = new Map(trips.map(trip => [trip.id, trip]));
  const overrides = new Map();
  const seen = new Set();
  for (const entry of data.assignments) {
    const trip = byId.get(entry?.id);
    if (!trip || seen.has(entry.id) || !['work', 'commute', 'private'].includes(entry.category)
      || !['manual', 'schedule'].includes(entry.source)
      || (entry.km !== undefined && (typeof entry.km !== 'number' || !Number.isFinite(entry.km) || entry.km < 0))
      || typeof entry.fromAddress !== 'string' || typeof entry.toAddress !== 'string') {
      throw new Error('Invalid project trip assignment or address. Previous data was kept.');
    }
    if (entry.source === 'schedule' && classifyTrip(trip, schedule) !== entry.category) {
      throw new Error('Saved classification does not match the saved schedule.');
    }
    seen.add(entry.id);
    if (entry.source === 'manual') overrides.set(entry.id, entry.category);
    trip.fromAddress = entry.fromAddress;
    trip.toAddress = entry.toAddress;
    if (entry.km !== undefined) trip.km = entry.km;
  }
  if (seen.size !== trips.length) throw new Error('Project is missing trip classifications.');
  return { sources: data.sources, trips, schedule, overrides, skipped, ignored };
}
