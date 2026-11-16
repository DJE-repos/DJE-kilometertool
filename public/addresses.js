import { coordinateKey } from './timeline.js';

export function formatAddress(properties) {
  const text = key => typeof properties?.[key] === 'string' ? properties[key].trim() : '';
  const street = [text('street'), text('housenumber')].filter(Boolean).join(' ');
  const locality = [text('postcode'), text('city') || text('town') || text('village')].filter(Boolean).join(' ');
  return [...new Set([text('name'), street, locality, text('state'), text('country')].filter(Boolean))].join(', ');
}

export function createAddressLookup({
  fetcher = globalThis.fetch,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  interval = 1100,
} = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let lastRequest = -Infinity;
  return (point, signal) => {
    const key = coordinateKey(point);
    if (!key) return Promise.reject(new Error('This trip endpoint has no coordinates.'));
    const task = queue.then(async () => {
      signal?.throwIfAborted();
      if (cache.has(key)) return cache.get(key);
      await wait(Math.max(0, lastRequest + interval - now()));
      signal?.throwIfAborted();
      lastRequest = now();
      const url = new URL('https://photon.komoot.io/reverse');
      url.search = new URLSearchParams({ lat: String(point[0]), lon: String(point[1]), limit: '1' });
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetcher(url.href, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        credentials: 'omit',
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      if (!response.ok) throw new Error(`Address service returned HTTP ${response.status}. Try later or enter the address manually.`);
      const data = await response.json();
      if (!Array.isArray(data.features)) throw new Error('Address service returned an invalid response.');
      const address = formatAddress(data.features[0]?.properties);
      if (!address) throw new Error('No address found near this endpoint. Enter it manually.');
      cache.set(key, address);
      return address;
    });
    // Keep the queue usable after failure; the caller still receives the rejected task.
    queue = task.then(() => undefined, () => undefined);
    return task;
  };
}
