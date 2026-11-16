import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, loadProject } from '../public/project.js';
import { parseTimeline, DEFAULT_SCHEDULE, classifyTrip } from '../public/timeline.js';

function fixture() {
  const data = {
    semanticSegments: [{
      startTime: '2026-11-09T08:30:00+01:00', endTime: '2026-11-09T09:00:00+01:00',
      activity: {
        distanceMeters: 12000, topCandidate: { type: 'IN_PASSENGER_VEHICLE' },
        start: { latLng: '51.0°, 4.0°' }, end: { latLng: '51.1°, 4.1°' },
      },
    }],
    rawSignals: [{ original: 'Preserve non-car source data too' }],
  };
  const trips = parseTimeline(data).trips;
  trips[0].fromAddress = 'Main Street 1';
  return { data, trips, sources: [{ name: 'Timeline.json', data }] };
}

test('project JSON round-trip preserves full source, schedule, manual classifications and addresses', () => {
  const { data, sources, trips } = fixture();
  trips[0].km = 10.25;
  const overrides = new Map([[trips[0].id, 'private']]);
  const project = createProject(sources, trips, DEFAULT_SCHEDULE, overrides);
  const restored = loadProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.sources[0].data, data);
  assert.deepEqual(restored.schedule, DEFAULT_SCHEDULE);
  assert.equal(restored.trips[0].fromAddress, 'Main Street 1');
  assert.equal(restored.trips[0].km, 10.25);
  assert.deepEqual(restored.trips[0].path, trips[0].path);
  assert.equal(classifyTrip(restored.trips[0], restored.schedule, restored.overrides), 'private');
  assert.equal(restored.overrides.get(trips[0].id), 'private');
});

test('older project assignments restore source distances and invalid edited distances are rejected', () => {
  const { sources, trips } = fixture();
  const project = createProject(sources, trips, DEFAULT_SCHEDULE, new Map());
  delete project.assignments[0].km;
  assert.equal(loadProject(project).trips[0].km, 12);
  for (const km of [-1, NaN, '12']) {
    const invalid = createProject(sources, trips, DEFAULT_SCHEDULE, new Map());
    invalid.assignments[0].km = km;
    assert.throws(() => loadProject(invalid), /Invalid project trip assignment/);
  }
});

test('commute assignments survive JSON round-trip and subsequent schedule changes', () => {
  const { sources, trips } = fixture();
  const project = createProject(sources, trips, DEFAULT_SCHEDULE, new Map([[trips[0].id, 'commute']]));
  const restored = loadProject(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.overrides.get(trips[0].id), 'commute');
  assert.equal(classifyTrip(restored.trips[0], { ...restored.schedule, days: [] }, restored.overrides), 'commute');
});

test('automatic assignments restore as automatic rather than freezing future schedule changes', () => {
  const { sources, trips } = fixture();
  const restored = loadProject(createProject(sources, trips, DEFAULT_SCHEDULE, new Map()));
  assert.equal(restored.overrides.size, 0);
  assert.equal(classifyTrip(restored.trips[0], { ...restored.schedule, days: [] }, restored.overrides), 'private');
});

test('invalid saved classifications fail instead of dropping or silently changing assignments', () => {
  const { sources, trips } = fixture();
  const fresh = () => createProject(sources, trips, DEFAULT_SCHEDULE, new Map());
  const missing = fresh();
  missing.assignments = [];
  assert.throws(() => loadProject(missing), /missing trip classifications/);
  const duplicate = fresh();
  duplicate.assignments.push(duplicate.assignments[0]);
  assert.throws(() => loadProject(duplicate), /Invalid project trip assignment/);
  const badCategory = fresh();
  badCategory.assignments[0].category = 'other';
  assert.throws(() => loadProject(badCategory), /Invalid project trip assignment/);
  const wrongSchedule = fresh();
  wrongSchedule.assignments[0].category = 'private';
  assert.throws(() => loadProject(wrongSchedule), /does not match/);
  assert.throws(() => loadProject({ ...fresh(), version: 2 }), /unsupported mileage project/);
});
