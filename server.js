import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/timeline.js', ['timeline.js', 'text/javascript; charset=utf-8']],
  ['/project.js', ['project.js', 'text/javascript; charset=utf-8']],
  ['/addresses.js', ['addresses.js', 'text/javascript; charset=utf-8']],
  ['/trip-map.js', ['trip-map.js', 'text/javascript; charset=utf-8']],
  ['/vendor/leaflet.js', ['..\\node_modules\\leaflet\\dist\\leaflet.js', 'text/javascript; charset=utf-8']],
  ['/vendor/leaflet.css', ['..\\node_modules\\leaflet\\dist\\leaflet.css', 'text/css; charset=utf-8']],
  ['/vendor/leaflet.LICENSE', ['..\\node_modules\\leaflet\\LICENSE', 'text/plain; charset=utf-8']],
]);
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy',
    "default-src 'self'; connect-src https://photon.komoot.io; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  const route = routes.get(request.url);
  if (!route) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(path.join(publicDirectory, route[0]));
    response.writeHead(200, { 'Content-Type': route[1] });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error('Unable to serve application file:', error);
    response.writeHead(500).end('Unable to load application');
  }
});

server.on('error', (error) => {
  console.error('Unable to start local server:', error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Mileage tool ready at http://127.0.0.1:${port}`);
  console.log('Timeline files are processed in your browser, never uploaded to this server.');
});
