# Mileage

A browser tool for turning Google Timeline JSON into daily work/commute/private car
kilometers, with manual trip classification, reloadable JSON saves, CSV exports,
and optional OSM maps/address lookup. Node.js 20+ is needed for local serving,
tests and builds; a published static site needs only a modern browser.

## Run

```powershell
npm install
npm start
```

Open http://127.0.0.1:3000 (localhost only). To use another port:

```powershell
$env:PORT = "3001"; npm start
```

## GitHub Pages

1. Put only the application code and dependency manifests in a GitHub repository.
   **Never commit Timeline exports, saved project JSON or CSV reports**, even to
   a private repository used to publish a site. The provided ignore rules cover
   `Timeline.json`, `mileage-*.json` saves and CSVs; protect exports with other
   filenames yourself.
2. Under **Settings > Pages > Build and deployment**, select **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually under **Actions**.
   If your default branch is different, update the workflow's branch filter.
4. The workflow installs dependencies, runs tests, builds the static assets, and
   publishes only `dist`. The resulting URL is normally
   `https://<owner>.github.io/<repository>/`.

To produce the same static site locally:

```powershell
npm ci
npm run build
```

The build replaces the generated `dist` directory and copies a fixed allowlist
of app files plus Leaflet, its images and license. It never copies Timeline
data, saved projects, reports, the Node server or the rest of the workspace.
Relative asset URLs support both repository subpaths and root/custom-domain
sites. No Node server or map API key is needed on Pages. Serve `dist` with a
static web server when previewing; do not open it through `file://`.

Security and referrer policies are embedded in the HTML for static hosting.
Localhost additionally retains the server-only headers, such as
`frame-ancestors` and `X-Content-Type-Options`, which Pages does not let this app
set. GitHub logs site visits/IP addresses; Timeline imports and analysis still
happen only in the visitor's browser. Optional OSM/Photon disclosures remain
the same. Schedule preferences are separate on the hosted origin; use saved
project JSON to transfer your editable work from localhost.

## Use

1. Choose or drop a Google Timeline JSON file. Select multiple files together to
   combine monthly exports; a new import replaces the previous one.
2. Set workdays and working hours, then choose **Apply schedule**.
   Defaults are Monday-Friday, 08:00-18:00. Trips are classified by departure
   time, including the start but excluding the end. Overnight work schedules
   are supported and belong to the weekday the shift starts.
3. Use **Review trips** on a day, or **Individual trips**, to change a trip to
   Work, Commute or Private. Choose **Auto** to restore schedule classification. Edit a
   trip's **Distance km** value directly to adjust its recorded kilometers.
4. Filter dates if desired. **Export CSV** always downloads individual trips,
   including overrides and classification source, even from the daily summary view.
   Choose **All dates** to remove a day's review filter.
5. **Save JSON** downloads a mileage project containing all original source
   exports (including non-car data), the schedule, every assigned category and
   distance, manual/automatic classification sources, and address labels. Date
   filters do not limit this save. Reopen this JSON alone using **Choose JSON
   files** to resume editing. It is an app project, not an import format for
   Google Timeline.
6. In **Individual trips**, select **Map / addresses**. Recorded timestamped path
   points within the trip are shown when available. Otherwise, a dashed
   endpoint connection is shown, explicitly not a road route. Missing coordinates
   are reported rather than inferred.
7. Addresses and coordinates are separate in the individual table and CSV.
   Exported address/place fields are shown when available. To fill missing
   addresses, enable the online services checkbox and click **Look up endpoint
   addresses** for the selected trip, or enter labels manually. Existing labels
   are not overwritten; clear a label to look it up again. Labels are reused
   for matching coordinates rounded to five decimal places.

Commute is a separate, manually assigned category for home-to-work trips. Its
kilometers appear separately from Work and Private in the overview and daily
table, and all three categories sum to the total driven. CSV reports `commute`
for these trips, and JSON saves preserve the category. The schedule still
automatically assigns only Work or Private; existing classifications are not
changed. No home or office location is inferred. A time-based rule cannot
establish the real purpose of a journey. Passenger rides, holidays and private
errands during work hours need review.

## Supported data and calculation

- On-device Timeline exports with `semanticSegments`.
- Mobile exports consisting of a segment array.
- Older Google Takeout `timelineObjects` with `activitySegment`.
- Car labels: `IN_PASSENGER_VEHICLE`, `IN_VEHICLE`, `IN_CAR`, `DRIVING`.
  Passenger vehicle labels cannot establish whether you were the driver.
- Recorded activity distances in meters are converted to kilometers. Walking,
  cycling, bus/train and unknown activities are excluded.
- Per-trip kilometer edits update daily totals and CSV exports. Save a project
  JSON to preserve them; the original imported source data remains unchanged.
- Missing/invalid car distances or timestamps are skipped with a visible warning;
  GPS points are not turned into speculative road distances.
- Duplicate trips with identical departure/arrival instants and distance are
  counted once across overlapping imports.
- Dates/times use explicit export offsets, or UTC when absent. A trip crossing
  midnight is counted entirely on its departure date. Only days with car trips
  appear. Raw location-point exports without activities are not supported;
  extract ZIP archives before importing.
- On-screen distances use two decimals; CSV uses three and unrounded values
  are used for totals. CSV is comma-separated UTF-8 with a BOM for Excel.

## Privacy and storage

When running locally, the server binds only to `127.0.0.1` and serves a fixed allowlist of app files.
Import processing happens entirely in the browser, with no uploads or analytics.
Leaflet is installed and served locally. The source JSON in the workspace is
not served by the app. Do not expose this server through a proxy or port-forward.

Online location services are off by default. Without enabling them, the map
shows geometry on a plain background and address labels can be entered manually.
Enabling services requests only the viewed map tiles from OpenStreetMap,
disclosing the viewed area and your IP address. Clicking address lookup sends
the selected endpoint coordinates to Photon/Komoot; no complete timeline, trip
classification or date/time is sent. OSM addresses may be approximate.

Lookup is on-demand, serialized to at most one request every 1.1 seconds per tab,
and successful results are cached in memory. There is no bulk geocoding or tile
prefetching. Photon is a public best-effort service: errors and missing results
are shown, not replaced with invented addresses. For large-scale use, host your
own service rather than repeatedly querying the public endpoint. See the
[Photon terms](https://photon.komoot.io/) and
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).
Map/address data is attributed to OpenStreetMap contributors (ODbL).

Only work schedule preferences are saved in browser local storage. Trips and
overrides exist in tab memory until a successful replacement import, clearing
data, or closing/reloading the tab. **Save JSON before leaving** to keep your
editable work; CSV is a report, not a restorable project.
Exported JSON/CSV files contain sensitive location information; store them securely.
This tool estimates mileage from Google's records, not an audited tax log.

## Test

```powershell
npm test
```
