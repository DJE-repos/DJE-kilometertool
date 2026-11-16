import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeline, mergeTrips, classifyTrip, summarizeDays, dailyCsv, tripsCsv,
  DEFAULT_SCHEDULE, validateSchedule, coordinates,
} from '../public/timeline.js';

function segment(overrides = {}, activity = {}) {
  return {
    startTime: '2026-11-09T08:30:00+01:00',
    endTime: '2026-11-09T09:00:00+01:00',
    activity: { distanceMeters: 12345, topCandidate: { type: 'IN_PASSENGER_VEHICLE' }, ...activity },
    ...overrides,
  };
}

test('modern export counts only car activities and reports invalid car records', () => {
  const result = parseTimeline({ semanticSegments: [
    segment(),
    segment({}, { topCandidate: { type: 'IN_BUS' } }),
    segment({}, { distanceMeters: undefined }),
    segment({}, { distanceMeters: '' }),
    segment({}, { distanceMeters: -1 }),
    segment({ startTime: 'bad' }),
    segment({ endTime: '2026-11-09T07:00:00+01:00' }),
    { visit: {} },
  ] });
  assert.equal(result.trips.length, 1);
  assert.equal(result.trips[0].km, 12.345);
  assert.equal(result.trips[0].date, '2026-11-09');
  assert.equal(result.trips[0].start, '08:30');
  assert.equal(result.skipped, 5);
  assert.equal(result.ignored, 1);
});

test('mobile array export accepts numeric distances, geo locations and zero kilometers', () => {
  const result = parseTimeline([segment({}, {
    distanceMeters: '0',
    start: { latLng: 'geo:51.0,4.0' },
  })]);
  assert.equal(result.trips[0].km, 0);
  assert.equal(result.trips[0].from, '51.0,4.0');
});

test('legacy Takeout supports ISO timestamps and millisecond strings', () => {
  const first = {
    activityType: 'IN_VEHICLE', distance: 5000,
    duration: { startTimestamp: '2026-11-09T08:00:00Z', endTimestamp: '2026-11-09T09:00:00Z' },
    startLocation: { latitudeE7: 510000000, longitudeE7: 40000000 },
    endLocation: { name: 'Office' },
  };
  const second = {
    ...first, distance: 7000,
    duration: { startTimestampMs: String(Date.parse('2026-11-09T16:00:00Z')), endTimestampMs: String(Date.parse('2026-11-09T17:00:00Z')) },
  };
  const { trips } = parseTimeline({ timelineObjects: [{ activitySegment: first }, { activitySegment: second }] });
  assert.equal(trips.length, 2);
  assert.equal(trips[0].from, '51.00000, 4.00000');
  assert.equal(trips[0].to, 'Office');
  assert.equal(trips[1].start, '16:00');
});

test('timezone offsets preserve local departure date and midnight trips are not duplicated', () => {
  const { trips } = parseTimeline({ semanticSegments: [
    segment({ startTime: '2026-11-08T23:30:00Z', endTime: '2026-11-09T00:00:00Z',
      startTimeTimezoneUtcOffsetMinutes: 120, endTimeTimezoneUtcOffsetMinutes: 120 }),
    segment({ startTime: '2026-11-09T23:30:00-05:00', endTime: '2026-11-10T00:30:00-05:00' }),
  ] });
  assert.equal(trips[0].date, '2026-11-09');
  assert.equal(trips[0].start, '01:30');
  assert.equal(trips[1].date, '2026-11-09');
  assert.equal(trips[1].endDate, '2026-11-10');
  const days = summarizeDays(trips, DEFAULT_SCHEDULE);
  assert.equal(days.length, 1);
  assert.equal(days[0].total, 24.69);
});

test('schedule uses departure time, weekdays, exclusive end, and manual overrides', () => {
  const trip = parseTimeline([segment()]).trips[0];
  assert.equal(classifyTrip(trip, DEFAULT_SCHEDULE), 'work');
  assert.equal(classifyTrip({ ...trip, start: '07:59' }, DEFAULT_SCHEDULE), 'private');
  assert.equal(classifyTrip({ ...trip, start: '08:00' }, DEFAULT_SCHEDULE), 'work');
  assert.equal(classifyTrip({ ...trip, start: '18:00' }, DEFAULT_SCHEDULE), 'private');
  assert.equal(classifyTrip({ ...trip, date: '2026-11-08' }, DEFAULT_SCHEDULE), 'private');
  assert.equal(classifyTrip(trip, DEFAULT_SCHEDULE, new Map([[trip.id, 'private']])), 'private');
  assert.equal(classifyTrip(trip, { ...DEFAULT_SCHEDULE, days: [] }), 'private');
});

test('overnight work hours use the weekday on which the shift starts', () => {
  const schedule = { days: [1], start: '22:00', end: '06:00' };
  const trip = { date: '2026-11-10', start: '02:00' };
  assert.equal(classifyTrip(trip, schedule), 'work');
  assert.equal(classifyTrip({ ...trip, date: '2026-11-09' }, schedule), 'private');
  assert.equal(classifyTrip({ ...trip, start: '06:00' }, schedule), 'private');
});

test('merging deduplicates overlapping imports and daily totals honor overrides', () => {
  const first = parseTimeline([segment()]).trips[0];
  const second = parseTimeline([segment({ startTime: '2026-11-09T19:00:00+01:00', endTime: '2026-11-09T19:30:00+01:00' })]).trips[0];
  const trips = mergeTrips([second, first, first]);
  assert.equal(trips.length, 2);
  assert.equal(trips[0].id, first.id);
  assert.deepEqual(summarizeDays(trips, DEFAULT_SCHEDULE), [
    { date: '2026-11-09', trips: 2, work: 12.345, commute: 0, private: 12.345, total: 24.69 },
  ]);
  const days = summarizeDays(trips, DEFAULT_SCHEDULE, new Map([[second.id, 'work']]));
  assert.equal(days[0].work, 24.69);
  assert.equal(days[0].private, 0);
});

test('edited trip kilometers are used in summaries and trip CSV exports', () => {
  const trip = parseTimeline([segment()]).trips[0];
  trip.km = 10.25;
  assert.deepEqual(summarizeDays([trip], DEFAULT_SCHEDULE), [
    { date: '2026-11-09', trips: 1, work: 10.25, commute: 0, private: 0, total: 10.25 },
  ]);
  assert.ok(tripsCsv([trip], DEFAULT_SCHEDULE, new Map()).includes(',10.250,work,schedule,'));
});

test('CSV exports have stable headers, numeric precision, BOM, escaping and safe spreadsheet cells', () => {
  const trip = { ...parseTimeline([segment()]).trips[0], from: '=HYPERLINK("bad")', to: 'Office,\nMain' };
  const overrides = new Map([[trip.id, 'private']]);
  const text = tripsCsv([trip], DEFAULT_SCHEDULE, overrides);
  assert.ok(text.startsWith('\uFEFFDate,Departure,Arrival date,Arrival,From,To,Kilometers,Category,Classification source,From address,To address,From coordinates,To coordinates\r\n'));
  assert.ok(text.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(text.includes('"Office,\nMain"'));
  assert.ok(text.includes(',12.345,private,manual,,,,\r\n'));
  assert.equal(dailyCsv(summarizeDays([trip], DEFAULT_SCHEDULE, overrides)),
    '\uFEFFDate,Car trips,Work km,Commute km,Private km,Total km\r\n2026-11-09,1,0.000,0.000,12.345,12.345\r\n');
});

test('commute overrides have separate totals and are included in trip CSV without double counting', () => {
  const base = parseTimeline([segment()]).trips[0];
  const trips = [base, { ...base, id: 'commuting', km: 5 }, { ...base, id: 'personal', km: 7 }];
  const overrides = new Map([['commuting', 'commute'], ['personal', 'private']]);
  const days = summarizeDays(trips, DEFAULT_SCHEDULE, overrides);
  assert.deepEqual(days, [
    { date: base.date, trips: 3, work: 12.345, commute: 5, private: 7, total: 24.345 },
  ]);
  assert.equal(days[0].work + days[0].commute + days[0].private, days[0].total);
  assert.ok(tripsCsv(trips, DEFAULT_SCHEDULE, overrides).includes(',5.000,commute,manual,'));
  overrides.delete('commuting');
  const reset = summarizeDays(trips, DEFAULT_SCHEDULE, overrides)[0];
  assert.equal(reset.commute, 0);
  assert.equal(reset.work, 17.345);
});

test('coordinates support modern and legacy formats without accepting invalid points', () => {
  assert.deepEqual(coordinates({ latLng: '51.25°, 4.5°' }), [51.25, 4.5]);
  assert.deepEqual(coordinates('geo:-20.25, 130.5'), [-20.25, 130.5]);
  assert.deepEqual(coordinates({ latE7: 512500000, lngE7: 45000000 }), [51.25, 4.5]);
  assert.equal(coordinates('91, 4'), null);
  assert.equal(coordinates('51, 181'), null);
  assert.equal(coordinates({}), null);
});

test('trip geometry retains only timestamped path points inside its interval and keeps addresses', () => {
  const { trips } = parseTimeline({ semanticSegments: [
    { timelinePath: [
      { point: '51.0°, 4.0°', time: '2026-11-09T08:29:00+01:00' },
      { point: '51.2°, 4.2°', time: '2026-11-09T08:45:00+01:00' },
      { point: '51.9°, 4.9°', time: '2026-11-09T09:01:00+01:00' },
    ] },
    segment({}, {
      start: { latLng: '51.1°, 4.1°', name: 'Office', address: 'Main Street 1' },
      end: { latLng: '51.3°, 4.3°' },
    }),
  ] });
  assert.deepEqual(trips[0].path, [[51.1, 4.1], [51.2, 4.2], [51.3, 4.3]]);
  assert.equal(trips[0].hasRecordedPath, true);
  assert.equal(trips[0].fromAddress, 'Main Street 1');
  assert.equal(trips[0].fromName, 'Office');
  const endpointOnly = parseTimeline([segment({}, {
    start: { latLng: '51.1°, 4.1°' }, end: { latLng: '51.3°, 4.3°' },
  })]).trips[0];
  assert.equal(endpointOnly.hasRecordedPath, false);
  assert.equal(endpointOnly.path.length, 2);
});

test('unsupported raw points and invalid schedules fail explicitly', () => {
  assert.throws(() => parseTimeline({ locations: [] }), /Unsupported export/);
  assert.throws(() => validateSchedule({ ...DEFAULT_SCHEDULE, start: '25:00' }), /valid workdays/);
  assert.throws(() => validateSchedule({ ...DEFAULT_SCHEDULE, days: [8] }), /valid workdays/);
  assert.throws(() => validateSchedule({ ...DEFAULT_SCHEDULE, end: '08:00' }), /different/);
});
