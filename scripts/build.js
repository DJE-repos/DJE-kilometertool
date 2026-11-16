import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const appFiles = ['index.html', 'styles.css', 'app.js', 'timeline.js', 'project.js', 'addresses.js', 'trip-map.js'];
const leafletFiles = ['leaflet.js', 'leaflet.css'];
const leafletImages = ['layers.png', 'layers-2x.png', 'marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png'];

export async function buildSite(destination = path.join(root, 'dist')) {
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, '.mileage-build-'));
  try {
    await mkdir(path.join(staging, 'vendor', 'images'), { recursive: true });
    // Explicit file lists prevent Timeline exports or saved projects from being published.
    for (const file of appFiles) {
      await copyFile(path.join(root, 'public', file), path.join(staging, file));
    }
    for (const file of leafletFiles) {
      await copyFile(path.join(root, 'node_modules', 'leaflet', 'dist', file), path.join(staging, 'vendor', file));
    }
    for (const file of leafletImages) {
      await copyFile(path.join(root, 'node_modules', 'leaflet', 'dist', 'images', file),
        path.join(staging, 'vendor', 'images', file));
    }
    await copyFile(path.join(root, 'node_modules', 'leaflet', 'LICENSE'), path.join(staging, 'vendor', 'leaflet.LICENSE'));
    await writeFile(path.join(staging, '.nojekyll'), '');
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildSite();
  console.log('Static site built in dist. Only application assets and Leaflet are included.');
}
