# Calgary Transit Live Tracker — Project Brief

GIS portfolio project: a live map that tracks Calgary Transit vehicles in
real time, built with Python/FastAPI backend + Leaflet frontend. Every
architectural decision here was made deliberately; read this before changing
anything so you don't undo a considered choice.

---

## Current state

Phases 0–6 are complete and working. The app shows the live fleet with rotating
bus/train icons that **snap to and glide along the route polyline** across the CARTO
basemap; clustered stops with live ETA popups; per-bus tracking (follow-cam + flash +
anchored ETA/Late bubble + blue bus→stop route line); click-a-vehicle → its next stop +
Track; route-number labels at zoom ≥ 16; and a geolocation "locate me" control.
The frontend was refactored into **ES modules** (Phase 7.0); MapLibre is still the
planned renderer swap (Phase 7).

**Run the app (from repo root):**
```bash
python -m uvicorn server:app --reload --app-dir backend
# open http://localhost:8000
```
`--app-dir backend` puts `backend/` on `sys.path` so `server.py` and its sibling tools
import each other unchanged. Standalone tools: `python backend/build_map.py`.
> ⚠️ On Windows (Microsoft Store Python), `uvicorn` is not on PATH.
> Always use `python -m uvicorn`. Don't fix this by editing PATH — it's a Store-Python
> sandbox issue. Use the python.org installer for a clean setup.

---

## Repository layout

```
TransitLiveMap/
├── backend/                FastAPI app + GTFS tools (the "kitchen")
│   ├── server.py           app, poll loop, /api/* endpoints, serves ../frontend
│   ├── build_map.py        static-GTFS loaders + build_vehicles/build_stops/build_shapes
│   ├── explore_feed.py     Phase 0 feed explorer + fetch_feed(url) (shared)
│   └── verify_join.py       Phase 2 trip_id→route join coverage diagnostic
├── frontend/
│   ├── index.html          markup only; loads /styles/app.css + <script type=module>
│   ├── styles/app.css      all CSS
│   ├── scripts/            ES modules (see "Frontend modules" below)
│   └── static/             bus.png (nose EAST, +90°), train.png (SE, +135°), bus-stop.png (pin)
├── docs/                   code-reference.html + presentation.html (learning material)
├── requirements.txt, CLAUDE.md, README.md, .gitignore
```

The exploration scripts (`explore_feed`, `build_map`, `verify_join`) are
**standalone tools** — don't import them into production beyond the existing
`server.py → build_map`/`explore_feed` imports.

### Frontend modules (`frontend/scripts/`, true ES modules)
`config` (constants/ICONS) · `state` (shared singletons: `veh`, `vehByTrip`,
`stopMarkers`, `shapesById`, and the `app` object for reassignable fields — the
encapsulated replacement for globals) · `format` (esc, ETA/Late phrasing) ·
`geometry` (bearing + turf projection/along/slice helpers) · `icons` (divIcons) ·
`map` (Leaflet map, layers, cluster, zoom readout) · `network` (loadNetwork + stop
ETA popup) · `vehicles` (refresh + the rAF animation/snapping engine + vehicle-click) ·
`tracking` (track/untrack, bubble, blue route, preview) · `geolocation` · `main`
(wires everything, exposes popup-button handlers on `window`). The `vehicles↔tracking`
import cycle is intentional and safe (cross-calls only happen inside functions).
CDN libs (`L`, markercluster, `turf`) load as classic `<script>` and are used as globals.

---

## Architecture

```
Calgary Open Data          (GTFS-RT protobuf, ~30s publish cadence)
        │
        ▼  poll every 15s, dedupe on header.timestamp
  Python backend
  ├── load_network()      static GTFS loaded ONCE at startup into memory
  ├── poll_loop()         background daemon thread (not async — requests.get is blocking)
  │                       polls BOTH feeds: vehicle positions + trip updates (each dedupes)
  ├── SNAPSHOT global     latest resolved vehicle list, replaced atomically
  ├── TRIP_UPDATES global stop_id → [(arrival_epoch, trip_id, vehicle_id)] index
  ├── TRIP_UPDATES global stop_id→arrivals  +  by_trip: trip_id→[(arrival,stop_id)]
  ├── GET /api/network    shapes (+shape_id) + stops (static, fetched once)
  ├── GET /api/vehicles   cached snapshot, instant (no network call)
  ├── GET /api/stop/{id}/eta       next 3 arrivals at a stop, trip→route joined
  ├── GET /api/trip/{id}/next-stop soonest upcoming stop for a trip (vehicle-click)
  └── mount("/", frontend) index.html at /, plus /styles /scripts /static
        │                  (a no-store middleware keeps dev assets fresh)
        ▼  fetch every 15s
  ES-module frontend (frontend/scripts/*)
  ├── loadNetwork()       polylines once; stops → marker-cluster; cache turf line/shape
  ├── requestAnimationFrame loop   60fps glide ALONG the shape (snap) + follow-cam
  ├── stop/vehicle click  → ETA popup; "track" follows a live bus (blue route + bubble)
  └── refresh() / setInterval     new fixes → re-project onto shape, recompute bearing
```

**Why a backend at all:** clients should never hit Calgary's feed directly.
The backend decodes protobuf (gtfs-realtime-bindings), does the GTFS join,
caches results, and serves clean JSON. Without it you can't do spatial queries,
can't dedupe, and every client hammers Calgary.

**Why a thread, not async:** `requests.get()` blocks. Running it in the
FastAPI event loop would freeze all HTTP responses during each poll. A daemon
thread keeps the server responsive.

---

## Calgary GTFS-RT data — critical findings

These were discovered empirically during development. Do not assume the feed
behaves like the GTFS-RT spec says it *can*.

| Field | Populated? | Notes |
|-------|-----------|-------|
| `trip.trip_id` | ✅ 100% | The only reliable vehicle→route link |
| `trip.route_id` | ❌ 0% | Always empty — join via trip_id instead |
| `position.bearing` | ❌ 0% | Compute from consecutive positions |
| `position.speed` | ❌ 0% | Not provided — no dead-reckoning possible |
| `current_status` | ❌ 0% | Not provided |
| `stop_id` (vehicle positions) | ❌ 0% | Not provided in the *positions* feed |

**Join coverage:** ~97.4% of live `trip_id`s resolve in static GTFS.
The ~2.6% misses are added/unscheduled trips — normal, not a bug.

**Trip Updates feed findings (empirical, Phase 5):**
- `stop_time_update.stop_id` is populated and matches static `stops.txt` **100%**
  (4923/4923 in a sample) — clean join, unlike the positions feed.
- `stop_time_update.arrival.time` is populated (absolute epoch); use it,
  fall back to `departure.time`.
- `trip_update.vehicle.id` is **empty** — so you CANNOT link an arrival to a live
  vehicle by vehicle id. Link by **`trip_id`** instead (this is why `trip_id` was
  appended to the vehicle array). Only ~57% of soonest arrivals have a live vehicle
  broadcasting a position; the rest are predicted-but-not-yet-reporting (Track
  button disables for those).

**Feed URLs (Socrata download pattern):**
```
Live vehicle positions: https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream
Static GTFS schedule:   https://data.calgary.ca/download/npk7-z3bj/application%2Fzip
                        (fallback: .../application%2Foctet-stream)
Trip updates (ETA):     https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream
Service alerts:         https://data.calgary.ca/download/jhgn-ynqj/application%2Foctet-stream
```
> The transitdata.calgary.ca/ctransit/*.pb URLs timeout — use the data.calgary.ca
> Socrata endpoints above.

**Route types in Calgary (the full set — only two):**
- `0` → tram/LRT (CTrain)
- `3` → bus (all routes including MAX BRT)

No subway, rail, ferry, or other types exist in Calgary's GTFS.

**Publish cadence:** ~30 seconds per snapshot. Polling faster than that yields
duplicate data (same header timestamp → dedupe skips rebuild). Poll at 15s for
low latency; the server dedupes so no wasted work.

---

## Frontend animation engine

Lives in `frontend/scripts/vehicles.js` (`refresh` + `animate` + `setTarget`) with
geometry in `geometry.js`. **Snap-to-shape (Phase 6):** instead of a straight lerp
between two 30s-apart GPS fixes (which cuts across blocks — "flying"), each fix is
projected onto the vehicle's GTFS route polyline (`turf.nearestPointOnLine`), and the
marker interpolates **along the line** (`turf.along`) so it rides the road. The GTFS
`shapes.txt` already traces the road — no OSM map-matching. A vehicle whose fix is
>`OFFROAD_M` (50 m) off its shape falls back to straight-line lerp; so do unmatched
vehicles (no `shape_id`). Per-vehicle `mode` is `'shape'` or `'line'`.

**Why interpolation, not extrapolation:** Calgary gives no speed/bearing,
so extrapolation would require deriving velocity from two fixes and predicting
ahead — overshoot artifacts + correction jitter with 30s-gap updates. We
interpolate (animate toward latest known position) and accept a small constant
lag in exchange for stable, artifact-free motion.

**Interpolation pattern (straight-line / `line` mode fallback):**
```
per-vehicle state: { fromLat, fromLon, toLat, toLon, bearing, forward,
                     startT, dur, settled, lastMove }

- render loop (rAF, 60fps):  lerp from→to over dur, skip if settled
- data loop (15s):           on position change → update from/to, recompute bearing,
                             set CSS rotation, unsettle, record lastMove timestamp
- dur = clamp(now - lastMove, 12000, 40000)  ← self-tuning, spans the real update gap
- from = marker.getLatLng()  ← current displayed pos, not last target (continuity)
```

**Icon rotation:**
```
bearing = bearingDeg(fromLat, fromLon, toLat, toLon)   // planar approx, fine for short hops
cssRotation = bearing - iconForward                    // iconForward: bus=90, train=135
img.style.transform = `rotate(${cssRotation}deg)`
```
The `forward` values are the compass direction each icon's nose points in its
natural (unrotated) state. If icons are replaced, update these two constants in
the `ICONS` table in `config.js` — nothing else changes. (In `shape` mode the
bearing comes from two points along the polyline; in `line` mode from the two fixes.)

**"Everything freezes" — root causes:**
1. **Normal data gap:** between Calgary's ~30s publishes all positions are
   unchanged → markers settle → visible pause. Expected and largely mitigated
   by the adaptive glide duration. Cannot be fully eliminated without
   extrapolation.
2. **Background tab:** browsers pause rAF when tab is not focused. Normal.
3. **Feed failure:** check `[poll] failed` in uvicorn terminal; `snapshot Xs old`
   caption grows without resetting if the backend isn't getting fresh data.

---

## Stops layer

~6000 stops are in the static GTFS, loaded into `/api/network` as the `stops`
array `[lat, lon, name, stop_id]`.

**Rendering (Phase 5.1):** stops are added to a **Leaflet.markercluster** group
(`leaflet.markercluster@1.5.3`, loaded from unpkg). When zoomed out they collapse
into themed red counted badges; zooming in splits them into individual
`bus-stop.png` pins. Each pin's click opens the ETA popup.

> ⚠️ The original perf rule still holds — **never render all ~6000 stops as raw
> DOM image markers at once** (known perf cliff). Clustering is how we satisfy it:
> the plugin keeps the live DOM marker count near viewport size. This **replaced**
> the earlier zoom-gate (`STOP_ZOOM`, render-only-in-viewport) approach; don't
> reintroduce raw per-stop markers. The plugin must stay, or restore zoom-gating.

---

## Completed phases

| Phase | What was built | Key files |
|-------|---------------|-----------|
| 0 | Fetch + decode + inspect Calgary's live feed | `explore_feed.py` |
| 1 | Download static GTFS, render network map | `build_map.py` |
| 2 | Verify trip_id → route join on live data | `verify_join.py` |
| 3 | FastAPI backend + live Leaflet map (teleporting) | `server.py`, `index.html` |
| 4 | Rotating PNG icons + lerp animation + freeze mitigation | `index.html` |
| 5 | Trip Updates poll + stop-click ETA popup (next 3 arrivals) + per-bus tracking (follow-cam, flash, countdown bubble) | `server.py`, `build_map.py`, `index.html` |
| 5.1 | Stop marker-clustering (replaced zoom-gate) + selected-stop highlight + pause/resume-follow + snap-back-to-stop + geolocation locate control | `index.html` |
| 5.2–5.3 | Tunable cluster zoom + `#zoomcap` readout; declutter on track; distance-gated due/depart; blue tracked-route; route-number labels; "ETA:/Late:" labels + red Late + anchored timer | `index.html` |
| 6 | **Snap-to-shape animation** (ride the road via `shape_id` + Turf.js) + blue bus→stop route that trims on the render loop; `/api/trip/{id}/next-stop` (vehicle-click → next stop + Track); `Cache-Control: no-store` | `build_map.py`, `server.py`, `index.html` |
| 7.0 | Restructure → `backend/` + `frontend/` (HTML/CSS/ES-module split); server serves the frontend folder; `docs/` learning material | all |

Phase 5 implementation notes:
- **"Nearest vehicle" = soonest predicted arrival**, NOT geographically closest
  (wrong route/direction/already-past). Endpoint sorts by arrival epoch.
- `build_vehicles` now appends `trip_id`; `build_stops` now appends `stop_id`.
- ETA endpoint: `/api/stop/{stop_id}/eta` → `{arrivals:[{route,headsign,color,
  type,trip_id,vehicle_id,arrival,eta_seconds}], ...}` (top 3, past filtered).

---

## Next phases (planned)

> Phase 6 (snap-to-route) is **done** — see the animation-engine section above.

### Phase 7 — React + MapLibre frontend
Swap the Leaflet page for a proper React app with MapLibre GL JS.
- The backend JSON contract (`/api/network`, `/api/vehicles`) stays identical —
  the renderer is swappable without touching Python.
- MapLibre uses vector tiles; needs a tile source (MapTiler free tier,
  or self-hosted with OpenStreetMap data).
- Vite dev server (hot reload) + `uvicorn --reload` = full live-reload stack.

### Phase 8 — Docker + docker-compose
Containerize backend (Python/FastAPI), frontend (Nginx or Vite build),
PostGIS (for future spatial queries + history). Local dev via `docker compose up`.
Same containers deploy to cloud (Fly.io / Render / AWS ECS).

### Phase 9 — Cloud deployment
Deploy the Docker stack. Recommended starting point: Fly.io or Render for
the backend container, Cloudflare Pages for the static frontend, Neon/Supabase
for managed PostGIS. Add AWS (ECS + RDS) as a re-deployment to get the resume
line, once the app is stable.

---

## GTFS-RT shared code conventions

- `fetch_feed(url)` — in `explore_feed.py`. Always use `HasField()` to check
  optional fields; never rely on `== ""` or `== 0` (protobuf returns defaults
  for absent optional fields, indistinguishable from zero without HasField).
- `load_lookups(zf)` — in `build_map.py`. Returns `(routes, trips, shape_route)`.
  Import this into server.py for the startup join; do not duplicate.
- `build_vehicles(feed, routes, trips)` — in `build_map.py`. Returns
  `(vehicles_list, matched_count)` where each vehicle is:
  `[lat, lon, route_short, color, headsign, vehicle_id, route_type_str, trip_id, shape_id]`
- `build_shapes(zf, routes, shape_route)` — in `build_map.py`. Each shape is
  `{shape_id, coords, color}` (shape_id added in Phase 6 for the frontend lookup).
- `build_stops(zf)` — in `build_map.py`. Returns `[lat, lon, name, stop_id]` rows.
- `build_trip_index(feed)` — in `server.py`. Returns **two** indexes:
  `index = {stop_id: [(arrival, trip_id, vehicle_id)]}` and
  `by_trip = {trip_id: [(arrival, stop_id)]}` (the latter powers `/api/trip/{id}/next-stop`).
  Guards every optional with `HasField`; prefers `arrival.time` over `departure.time`.

---

## Known issues / do-not-touch

- **Do not change the vehicle array format** `[lat,lon,short,color,head,id,type,trip_id,shape_id]`
  without updating both `build_map.py` (build_vehicles) and `frontend/scripts/vehicles.js`
  (the destructure `const [lat,lon,short,color,head,id,type,tripId,shapeId] = arr`).
  They must stay in sync. Likewise the stops array `[lat,lon,name,stop_id]` and shapes
  `{shape_id,coords,color}`.
- **Frontend is ES modules** (`frontend/scripts/`). Shared mutable state lives in
  `state.js` (`app.*` + the `veh`/`stopMarkers`/… collections), NOT window globals —
  the only `window.*` are the four popup-button handlers wired in `main.js`. The
  `vehicles↔tracking` import cycle is intentional (function-level use only).
- **Stops use the marker-cluster plugin, not raw markers.** See the Stops layer
  section — don't swap clustering for per-stop DOM markers (perf cliff).
- **Do not add CORS restrictions yet** — the `allow_origins=["*"]` in
  `server.py` is intentional for local dev. Tighten this before cloud deploy.
- **Static GTFS is downloaded fresh on each server startup.** For production,
  cache it to disk and refresh on a daily schedule instead.
- The `test_gtfs.zip` file in the repo root is a synthetic fixture from
  development tests — safe to delete, not used in production.
