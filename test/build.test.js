import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../scripts/build.js';

test('static build includes only deployable assets and replaces stale output', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mileage-build-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, 'site');
  await buildSite(output);
  await writeFile(path.join(output, 'Timeline.json'), '{"test":"must not be deployed"}');
  await buildSite(output);
  assert.deepEqual((await readdir(output)).sort(), [
    '.nojekyll', 'addresses.js', 'app.js', 'index.html', 'project.js', 'styles.css', 'timeline.js', 'trip-map.js', 'vendor',
  ]);
  assert.deepEqual((await readdir(path.join(output, 'vendor'))).sort(), [
    'images', 'leaflet.LICENSE', 'leaflet.css', 'leaflet.js',
  ]);
  assert.equal((await readdir(path.join(output, 'vendor', 'images'))).length, 5);
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  const base = new URL('https://example.github.io/kilometertool/');
  for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^https:/.test(reference)) continue;
    const resolved = new URL(reference, base);
    assert.ok(resolved.pathname.startsWith(base.pathname), `Asset escapes repository subpath: ${reference}`);
    await readFile(path.join(output, resolved.pathname.slice(base.pathname.length)));
  }
});
