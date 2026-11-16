let map;
let tiles;
let features;
let currentTrip;

export function clearTripMap() {
  currentTrip = undefined;
  if (map) map.remove();
  map = undefined;
  tiles = undefined;
  features = undefined;
  document.getElementById('trip-map').hidden = true;
  document.getElementById('map-error').hidden = true;
}

export function showTripMap(trip, online) {
  const container = document.getElementById('trip-map');
  const error = document.getElementById('map-error');
  if (!trip.path.length) {
    clearTripMap();
    return;
  }
  container.hidden = false;
  const L = globalThis.L;
  if (!L) throw new Error('Map library could not be loaded. Restart the server after npm install.');
  if (!map) {
    map = L.map(container, { scrollWheelZoom: false });
    features = L.featureGroup().addTo(map);
    map.attributionControl.addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>');
  }
  if (online && !tiles) {
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    tiles.on('tileerror', () => {
      error.textContent = 'Map tiles could not be loaded. Check your connection; recorded trip geometry is still shown.';
      error.hidden = false;
    });
    tiles.addTo(map);
  } else if (!online && tiles) {
    tiles.remove();
    tiles = undefined;
    error.hidden = true;
  }
  map.invalidateSize();
  if (currentTrip === trip.id) return;
  currentTrip = trip.id;
  features.clearLayers();
  if (trip.path.length > 1) {
    L.polyline(trip.path, {
      color: '#245c46', weight: 4, dashArray: trip.hasRecordedPath ? undefined : '8 8',
    }).addTo(features);
  }
  for (const [label, point, color] of [
    ['Start', trip.fromCoordinate, '#245c46'], ['End', trip.toCoordinate, '#b27831'],
  ]) {
    if (point) L.circleMarker(point, { radius: 7, color, fillOpacity: 1 })
      .bindTooltip(label, { permanent: true, direction: 'top' }).addTo(features);
  }
  map.fitBounds(features.getBounds().isValid() ? features.getBounds() : L.latLngBounds(trip.path),
    { padding: [35, 35], maxZoom: 15, animate: false });
}
