import {
  DEFAULT_SCHEDULE, parseTimeline, mergeTrips, validateSchedule,
  classifyTrip, summarizeDays, tripsCsv, coordinateKey,
} from './timeline.js';
import { PROJECT_FORMAT, createProject, loadProject } from './project.js';
import { createAddressLookup } from './addresses.js';
import { showTripMap, clearTripMap } from './trip-map.js';

const $ = id => document.getElementById(id);
let trips = [];
let overrides = new Map();
let schedule = structuredClone(DEFAULT_SCHEDULE);
let view = 'daily';
let importing = false;
let importSequence = 0;
let sources = [];
let selectedTripId;
let lookupController;
const lookupAddress = createAddressLookup();
const number = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PREFERENCES_KEY = 'mileage.schedule.v1';

function message(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function errorMessage(error) {
  console.error(error);
  message('error', error instanceof Error ? error.message : String(error));
}

try {
  const saved = localStorage.getItem(PREFERENCES_KEY);
  if (saved) schedule = validateSchedule(JSON.parse(saved));
} catch (error) {
  errorMessage(new Error(`Could not restore saved schedule: ${error.message}`));
}
function displaySchedule() {
  $('work-start').value = schedule.start;
  $('work-end').value = schedule.end;
  for (const input of document.querySelectorAll('input[name="day"]')) {
    input.checked = schedule.days.includes(Number(input.value));
  }
}
displaySchedule();

function visibleTrips() {
  const from = $('date-from').value;
  const to = $('date-to').value;
  return trips.filter(trip => (!from || trip.date >= from) && (!to || trip.date <= to));
}

function cell(row, text, className = '') {
  const td = document.createElement('td');
  td.textContent = text;
  td.className = className;
  row.append(td);
  return td;
}

function setView(next) {
  view = next;
  for (const name of ['daily', 'trips']) {
    $(`${name}-table`).hidden = name !== view;
    $(`${name}-tab`).classList.toggle('active', name === view);
    $(`${name}-tab`).setAttribute('aria-pressed', String(name === view));
  }
  render();
}

function cancelLookup() {
  lookupController?.abort();
  lookupController = undefined;
}

function renderSelection(visible) {
  const trip = view === 'trips' ? visible.find(item => item.id === selectedTripId) : undefined;
  $('trip-detail').hidden = !trip;
  if (!trip) {
    cancelLookup();
    clearTripMap();
    return;
  }
  $('selected-title').textContent = `${trip.date} / ${trip.start} - ${trip.end} / ${number.format(trip.km)} km`;
  for (const endpoint of ['from', 'to']) {
    $(`${endpoint}-address`).value = trip[`${endpoint}Address`];
    $(`${endpoint}-address`).readOnly = Boolean(lookupController);
    $(`${endpoint}-coordinates`).textContent = coordinateKey(trip[`${endpoint}Coordinate`]) || 'Coordinates not provided';
  }
  $('lookup-addresses').disabled = !$('online-services').checked || Boolean(lookupController)
    || (!trip.fromCoordinate && !trip.toCoordinate);
  $('lookup-addresses').textContent = lookupController ? 'Looking up addresses...' : 'Look up endpoint addresses';
  $('map-description').textContent = !trip.path.length ? 'No coordinates available to map this trip.'
    : trip.hasRecordedPath ? 'Recorded/exported GPS path. This is not a calculated road route.'
      : 'Only endpoints available: the dashed line is a straight connection, not the driven route.';
  try {
    showTripMap(trip, $('online-services').checked);
  } catch (error) {
    errorMessage(error);
  }
}

function render() {
  const invalidRange = $('date-from').value && $('date-to').value
    && $('date-from').value > $('date-to').value;
  $('date-to').setCustomValidity(invalidRange ? 'End date must be on or after start date.' : '');
  const visible = visibleTrips();
  const days = summarizeDays(visible, schedule, overrides);
  const totals = days.reduce((sum, day) => ({
    work: sum.work + day.work, commute: sum.commute + day.commute,
    private: sum.private + day.private, total: sum.total + day.total,
  }), { work: 0, commute: 0, private: 0, total: 0 });
  for (const key of ['total', 'work', 'commute', 'private']) {
    $(`${key}-km`).replaceChildren(document.createTextNode(`${number.format(totals[key])} `));
    const unit = document.createElement('small');
    unit.textContent = 'km';
    $(`${key}-km`).append(unit);
  }
  $('trip-count').textContent = `${visible.length.toLocaleString()} car trips across ${days.length.toLocaleString()} days`;
  $('row-count').textContent = `${days.length.toLocaleString()} days / ${visible.length.toLocaleString()} trips / ${visible.filter(trip => overrides.has(trip.id)).length} manual overrides`;
  $('export').disabled = visible.length === 0 || importing || Boolean(invalidRange);
  $('clear').disabled = trips.length === 0 && !importing;
  $('empty').hidden = visible.length > 0;
  if (!visible.length) {
    $('empty').querySelector('h3').textContent = trips.length ? 'No trips in this date range' : 'Your next journey starts here';
    $('empty').querySelector('p').textContent = trips.length ? 'Adjust the filters or choose All dates.' : 'Import a Timeline export to see your daily mileage.';
  }
  $('daily-body').replaceChildren();
  $('daily-foot').replaceChildren();
  $('trips-body').replaceChildren();
  if (view === 'daily') {
    const fragment = document.createDocumentFragment();
    for (const day of days) {
      const row = document.createElement('tr');
      cell(row, day.date);
      cell(row, day.trips, 'numeric');
      cell(row, number.format(day.work), 'numeric work-cell');
      cell(row, number.format(day.commute), 'numeric commute-cell');
      cell(row, number.format(day.private), 'numeric private-cell');
      cell(row, number.format(day.total), 'numeric');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = 'Review trips';
      button.setAttribute('aria-label', `Review trips for ${day.date}`);
      button.addEventListener('click', () => {
        $('date-from').value = day.date;
        $('date-to').value = day.date;
        setView('trips');
      });
      cell(row, '').append(button);
      fragment.append(row);
    }
    $('daily-body').append(fragment);
    if (days.length) {
      const row = document.createElement('tr');
      cell(row, 'Total');
      cell(row, visible.length, 'numeric');
      cell(row, number.format(totals.work), 'numeric work-cell');
      cell(row, number.format(totals.commute), 'numeric commute-cell');
      cell(row, number.format(totals.private), 'numeric private-cell');
      cell(row, number.format(totals.total), 'numeric');
      cell(row, '');
      $('daily-foot').append(row);
    }
  } else {
    const fragment = document.createDocumentFragment();
    for (const trip of visible) {
      const row = document.createElement('tr');
      cell(row, trip.date);
      const time = cell(row, `${trip.start} - ${trip.end}`, 'trip-time');
      if (trip.endDate !== trip.date) {
        const note = document.createElement('small');
        note.textContent = `Arrives ${trip.endDate}`;
        time.append(note);
      }
      const route = cell(row, '', 'route');
      for (const [prefix, endpoint] of [['From', 'from'], ['To', 'to']]) {
        const span = document.createElement('span');
        span.textContent = `${prefix}: ${trip[`${endpoint}Address`] || trip[`${endpoint}Name`] || 'Address not available'}`;
        const point = document.createElement('small');
        point.textContent = coordinateKey(trip[`${endpoint}Coordinate`]) || 'Coordinates not provided';
        route.append(span, point);
      }
      const distance = document.createElement('input');
      distance.type = 'number';
      distance.min = '0';
      distance.step = 'any';
      distance.value = String(trip.km);
      distance.className = 'trip-distance';
      distance.setAttribute('aria-label', `Kilometers for trip ${trip.date} ${trip.start}`);
      distance.addEventListener('change', () => {
        const km = distance.valueAsNumber;
        if (!Number.isFinite(km) || km < 0) {
          distance.setCustomValidity('Enter a non-negative distance in kilometers.');
          distance.reportValidity();
          distance.value = String(trip.km);
          distance.setCustomValidity('');
          return;
        }
        trip.km = km;
        render();
      });
      cell(row, '', 'numeric').append(distance);
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Category for ${trip.date} ${trip.start}`);
      for (const [value, label] of [
        ['auto', `Auto: ${classifyTrip(trip, schedule) === 'work' ? 'Work' : 'Private'}`],
        ['work', 'Work (manual)'], ['commute', 'Commute (manual)'], ['private', 'Private (manual)'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      select.value = overrides.get(trip.id) ?? 'auto';
      select.addEventListener('change', () => {
        if (select.value === 'auto') overrides.delete(trip.id);
        else overrides.set(trip.id, select.value);
        render();
      });
      cell(row, '', 'category').append(select);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = 'Map / addresses';
      button.setAttribute('aria-label', `Map and addresses for ${trip.date} ${trip.start}`);
      button.setAttribute('aria-pressed', String(selectedTripId === trip.id));
      button.addEventListener('click', () => {
        cancelLookup();
        selectedTripId = trip.id;
        message('address-status', '');
        render();
        $('trip-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      row.classList.toggle('selected-trip', selectedTripId === trip.id);
      cell(row, '').append(button);
      fragment.append(row);
    }
    $('trips-body').append(fragment);
  }
  renderSelection(visible);
  $('save-json').disabled = trips.length === 0 || importing || Boolean(lookupController);
}

async function importFiles(files) {
  if (!files.length) return;
  const sequence = ++importSequence;
  importing = true;
  cancelLookup();
  message('error', '');
  message('notice', '');
  $('file-status').textContent = `Reading ${files.length} file(s) locally...`;
  render();
  try {
    const imported = [];
    const newSources = [];
    let restored;
    let skipped = 0;
    let ignored = 0;
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.json')) {
        throw new Error(`"${file.name}" is not a JSON file. Extract ZIP exports first.`);
      }
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (error) {
        throw new Error(`Could not read "${file.name}" as JSON: ${error.message}`);
      }
      if (sequence !== importSequence) return;
      let result;
      try {
        if (data?.format === PROJECT_FORMAT) {
          if (files.length !== 1) throw new Error('Open a saved project on its own, without other files.');
          restored = loadProject(data);
          result = restored;
          newSources.push(...restored.sources);
        } else {
          result = parseTimeline(data);
          newSources.push({ name: file.name, data });
        }
      } catch (error) {
        throw new Error(`"${file.name}": ${error.message}`);
      }
      for (const trip of result.trips) imported.push(trip);
      skipped += result.skipped;
      ignored += result.ignored;
    }
    if (sequence !== importSequence) return;
    const merged = mergeTrips(imported);
    if (!merged.length) {
      throw new Error(`No usable car trips found. ${ignored} other/unknown activities excluded; ${skipped} car trips had missing/invalid distances or timestamps. Previous imported data was kept.`);
    }
    trips = merged;
    sources = newSources;
    overrides = restored?.overrides ?? new Map();
    if (restored) {
      schedule = restored.schedule;
      displaySchedule();
    }
    selectedTripId = undefined;
    clearTripMap();
    $('date-from').value = '';
    $('date-to').value = '';
    $('file-status').textContent = `${files.map(file => file.name).join(', ')} / ${trips.length.toLocaleString()} car trips loaded`;
    const notes = [`${ignored.toLocaleString()} non-car or unknown activities excluded. ${imported.length - trips.length} duplicate car trips removed.`];
    if (restored) notes.push('Saved schedule, classifications and address labels restored.');
    if (skipped) notes.push(`${skipped} car trips skipped: missing/invalid recorded distance or timestamps. Totals exclude these trips; review your source export.`);
    notes.push('Car detection includes Google vehicle/passenger-vehicle activities. Review passenger rides and mark commuting trips as Commute.');
    message('import-notice', notes.join('\n'));
  } catch (error) {
    if (sequence !== importSequence) return;
    errorMessage(error);
    $('file-status').textContent = trips.length ? 'Import failed. Previous data and overrides are unchanged.' : 'Import failed. Choose another Timeline JSON export.';
  } finally {
    if (sequence === importSequence) {
      importing = false;
      $('file-input').value = '';
      render();
    }
  }
}

$('file-input').addEventListener('change', event => importFiles([...event.target.files]));
for (const name of ['dragenter', 'dragover']) {
  $('drop-zone').addEventListener(name, event => {
    event.preventDefault();
    $('drop-zone').classList.add('dragging');
  });
}
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
$('drop-zone').addEventListener('drop', event => {
  event.preventDefault();
  $('drop-zone').classList.remove('dragging');
  importFiles([...event.dataTransfer.files]);
});
$('schedule-form').addEventListener('submit', event => {
  event.preventDefault();
  message('error', '');
  try {
    schedule = validateSchedule({
      days: [...document.querySelectorAll('input[name="day"]:checked')].map(input => Number(input.value)),
      start: $('work-start').value,
      end: $('work-end').value,
    });
    render();
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(schedule));
      message('notice', 'Schedule applied and saved in this browser. Manual overrides were kept.');
    } catch (error) {
      throw new Error(`Schedule applied for this tab, but could not be saved: ${error.message}`);
    }
  } catch (error) {
    errorMessage(error);
  }
});
for (const name of ['daily', 'trips']) $(`${name}-tab`).addEventListener('click', () => setView(name));
for (const id of ['date-from', 'date-to']) {
  $(id).addEventListener('change', () => {
    render();
    $('date-to').reportValidity();
  });
}
$('reset-dates').addEventListener('click', () => {
  $('date-from').value = '';
  $('date-to').value = '';
  $('date-to').setCustomValidity('');
  render();
});
$('clear').addEventListener('click', () => {
  importSequence++;
  importing = false;
  trips = [];
  sources = [];
  selectedTripId = undefined;
  cancelLookup();
  clearTripMap();
  overrides.clear();
  $('file-input').value = '';
  $('file-status').textContent = 'Imported data cleared. Nothing was stored on the server.';
  $('date-from').value = '';
  $('date-to').value = '';
  $('date-to').setCustomValidity('');
  message('notice', '');
  message('import-notice', '');
  message('error', '');
  render();
});
function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('save-json').addEventListener('click', () => {
  try {
    const project = createProject(sources, trips, schedule, overrides);
    download(JSON.stringify(project), 'application/json;charset=utf-8', 'mileage-classified.json');
    message('notice', 'Saved all imported data, classifications, schedule and addresses as project JSON. Date filters do not limit this save.');
  } catch (error) {
    errorMessage(error);
  }
});
$('online-services').addEventListener('change', () => {
  if (!$('online-services').checked) cancelLookup();
  render();
});
function applyAddress(trip, endpoint, address) {
  const key = coordinateKey(trip[`${endpoint}Coordinate`]);
  for (const item of trips) {
    for (const side of ['from', 'to']) {
      if ((item.id === trip.id && side === endpoint)
        || (key && coordinateKey(item[`${side}Coordinate`]) === key)) {
        item[`${side}Address`] = address;
      }
    }
  }
}
for (const endpoint of ['from', 'to']) {
  $(`${endpoint}-address`).addEventListener('change', () => {
    const trip = trips.find(item => item.id === selectedTripId);
    if (!trip) {
      errorMessage(new Error('Select a trip before editing an address.'));
      return;
    }
    applyAddress(trip, endpoint, $(`${endpoint}-address`).value.trim());
    render();
  });
}
$('lookup-addresses').addEventListener('click', async () => {
  const trip = trips.find(item => item.id === selectedTripId);
  if (!trip || !$('online-services').checked || lookupController) return;
  const controller = new AbortController();
  lookupController = controller;
  message('address-status', 'Looking up selected trip endpoints with Photon...');
  render();
  try {
    for (const endpoint of ['from', 'to']) {
      const point = trip[`${endpoint}Coordinate`];
      if (!point || trip[`${endpoint}Address`]) continue;
      const address = await lookupAddress(point, controller.signal);
      controller.signal.throwIfAborted();
      applyAddress(trip, endpoint, address);
    }
    message('address-status', 'Address labels updated. Check them against the recorded coordinates; nearby OSM addresses may be approximate. Save JSON to keep them.');
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
      message('address-status', `Address lookup failed: ${error.message}`);
    }
  } finally {
    if (lookupController === controller) {
      lookupController = undefined;
      render();
    }
  }
});
$('export').addEventListener('click', () => {
  try {
    const visible = visibleTrips();
    const content = tripsCsv(visible, schedule, overrides);
    download(content, 'text/csv;charset=utf-8',
      `mileage-trips-${visible[0].date}-to-${visible.at(-1).date}.csv`);
  } catch (error) {
    errorMessage(error);
  }
});
render();
