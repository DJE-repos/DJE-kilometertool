import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressLookup } from '../public/addresses.js';

const response = properties => ({ ok: true, json: async () => ({ features: [{ properties }] }) });

test('address lookup formats OSM addresses, caches coordinates and spaces sequential requests', async () => {
  let time = 0;
  const calls = [];
  const lookup = createAddressLookup({
    now: () => time,
    wait: async delay => { time += delay; },
    fetcher: async url => {
      calls.push({ url, time });
      return response({ street: 'Main Street', housenumber: '1', postcode: '1000', city: 'Town', country: 'Country' });
    },
  });
  const addresses = await Promise.all([lookup([51, 4]), lookup([51, 4]), lookup([52, 5])]);
  assert.equal(addresses[0], 'Main Street 1, 1000 Town, Country');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].time - calls[0].time >= 1100);
  assert.equal(new URL(calls[0].url).searchParams.get('lat'), '51');
});

test('failed and empty lookups reject explicitly and do not poison the request queue', async () => {
  let count = 0;
  const lookup = createAddressLookup({
    interval: 0,
    fetcher: async () => {
      count++;
      if (count === 1) return { ok: false, status: 429 };
      if (count === 2) return { ok: true, json: async () => ({ features: [] }) };
      return response({ street: 'Main Street' });
    },
  });
  await assert.rejects(lookup([51, 4]), /HTTP 429/);
  await assert.rejects(lookup([51, 4]), /No address found/);
  assert.equal(await lookup([51, 4]), 'Main Street');
});

test('cancelled lookups never send coordinates', async () => {
  const controller = new AbortController();
  controller.abort();
  const lookup = createAddressLookup({ fetcher: async () => { throw new Error('Must not fetch'); } });
  await assert.rejects(lookup([51, 4], controller.signal), { name: 'AbortError' });
});
