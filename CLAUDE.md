# Calgary Transit Live Tracker — Project Brief

GIS portfolio project: a live map that tracks Calgary Transit vehicles in
real time, built with Python/FastAPI backend + Leaflet frontend. Every
architectural decision here was made deliberately; read this before changing
anything so you don't undo a considered choice.

---

## Current state

Phases 0–7 are complete and working; Phase 8 (Docker + free cloud deploy) is in place. The
app shows the live fleet with **top-down bus/train icons that rotate to their travel bearing**
and **snap to / glide along the route polyline** (icons shrink further when zoomed out so the
glide reads); stops with live ETA popups; per-bus tracking (a **cinematic 2 s overview → 1 s
fly-in** intro, then follow-cam + glow + anchored ETA/Late bubble + blue bus→stop route line);
click-a-vehicle → its next stop + Track; route-number labels at zoom ≥ 16; a geolocation
"locate me" control; a **red app header** (title + live clock + "Server: …" health) and a
**"<vehicle> has arrived at <stop>" toast**. The React app is **mobile-hardened** (zoom-lock
viewport, safe-area insets, bigger tap targets, full-width track bar) and **deploys as a single
Docker container** (see Deployment below).

**There are now TWO frontends, same backend JSON contract:**
- **`frontend/`** — the original **Leaflet + vanilla ES-module** app (Phase 7.0). Still
  works; kept as the fallback during the migration. (Uses the older side-view CSS-rotated
  icons + marker-cluster stops — the React app's icon/stop model below has since diverged.)
- **`frontend-react/`** — the new **React + TypeScript + MapLibre GL** app (Phase 7).
  Clean light **Positron-style** vector basemap (MapTiler `dataviz` with a key, or the
  keyless OpenFreeMap `positron` fallback), GPU symbol layers (vehicles/stops as GeoJSON
  sources — no marker-cluster plugin), the snap-to-shape rAF engine ported into
  `lib/engine.ts`, and the chrome (track bar, popups, bubble, zoom readout, collapsible
  attribution) as React components driven by a zustand store. The map is decluttered for
  an "Uber day" look: **stops only at zoom ≥ 14** (no clustering), **vehicles density-gated
  by zoom** (a stable low-rank sample when zoomed out, every vehicle past z13), and
  route-number labels at zoom ≥ 16.

**Run it (from repo root):**
```bash
# Backend (both frontends use it):
python -m uvicorn server:app --reload --app-dir backend
#   → serves frontend-react/dist if it's been built, else the Leaflet frontend/, at :8000.
#   Force one with the FRONTEND_DIR env var.

# React app in DEV (hot reload) — run alongside uvicorn:
cd frontend-react && npm install && npm run dev      # Vite on :5173, proxies /api → :8000

# React app for PROD — build once, then uvicorn serves the bundle at :8000:
cd frontend-react && npm run build
```
`--app-dir backend` puts `backend/` on `sys.path` so `server.py` and its sibling tools
import each other unchanged. Standalone tools: `python backend/build_map.py`.
> ⚠️ On Windows (Microsoft Store Python), `uvicorn` is not on PATH.
> Always use `python -m uvicorn`. Don't fix this by editing PATH — it's a Store-Python
> sandbox issue. Use the python.org installer for a clean setup.
> Node/npm live at `C:\Program Files\nodejs` — prepend it to PATH in a shell that
> predates the install (`$env:Path = "C:\Program Files\nodejs;$env:Path"`).
> MapTiler key goes in `frontend-react/.env` as `VITE_MAPTILER_KEY=` (gitignored);
> blank → the keyless OpenFreeMap basemap.

---

## Repository layout

```
TransitLiveMap/
├── backend/                FastAPI app + GTFS tools (the "kitchen")
│   ├── server.py           app, poll loop, /api/* endpoints, serves ../frontend
│   ├── build_map.py        static-GTFS loaders + build_vehicles/build_stops/build_shapes
│   ├── explore_feed.py     Phase 0 feed explorer + fetch_feed(url) (shared)
│   └── verify_join.py       Phase 2 trip_id→route join coverage diagnostic
├── frontend/               LEGACY Leaflet app (Phase 7.0, vanilla ES modules)
│   ├── index.html          markup only; loads /styles/app.css + <script type=module>
│   ├── styles/app.css      all CSS
│   ├── scripts/            ES modules (see "Frontend modules" below)
│   └── static/             bus.png (nose EAST, +90°), train.png (SE, +135°), bus-stop.png (pin)
├── frontend-react/         NEW React + TS + MapLibre app (Phase 7)
│   ├── index.html, vite.config.ts (dev proxy /api→:8000), .env (VITE_MAPTILER_KEY)
│   ├── public/static/      bus_topdown.png (nose NORTH), train.png, bus-stop.png (registered as MapLibre images)
│   └── src/
│       ├── config.ts types.ts store.ts (zustand)   main.tsx App.tsx
│       ├── lib/    geometry.ts format.ts network.ts engine.ts (rAF snap-to-shape + tracking)
│       ├── map/    MapView.tsx (the <Map> + sources/layers + popups) · layers.ts
│       └── ui/     EtaRow · StopPopup · VehiclePopup · TrackBar · TrackBubble · AppBar · ArrivalToast
├── docs/                   code-reference.html + presentation.html (learning material)
├── Dockerfile              multi-stage: node builds frontend-react/dist → python serves it + the API
├── .dockerignore, render.yaml   container build context + Render free-tier Blueprint (Phase 8)
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

### React frontend (`frontend-react/src/`, the Phase 7 app)
Same behaviours, MapLibre instead of Leaflet. **Two layers, kept apart:** the imperative
60fps map work lives in **`lib/engine.ts`** (the singleton `engine`) — it owns the
`Map<id, VehState>`, ports `setTarget`/`animate`/the whole tracking lifecycle from the
old `vehicles.js`+`tracking.js`, and every frame writes a GeoJSON FeatureCollection into
the **`vehicles`** map source via `setData` (plus `tracked-route`, `selstop`, `veh-halo`).
**Never route the rAF loop through React state.** The reactive *chrome* lives in
**`store.ts`** (zustand: `caption`, `zoom`, `serverStatus`, `tracked`, `bubble`,
`trackedPos`, `popup`, `arrivalNotice`), updated at 1–5 Hz, and is rendered by small
components (`AppBar` (red header: title + live clock + `serverStatus`), `TrackBar`,
`ArrivalToast`, `EtaRow`, `StopPopup`, `VehiclePopup`, plus the bubble/popups inside
`MapView`). The tracked-bus ETA bubble is isolated in its own **`TrackBubble`** component so
the per-frame `trackedPos` updates only re-render it, not the whole chrome. The track-bar
heading (`"Following Bus 8280"`) comes from a single `engine.trackedSummary()` helper used at
every `set({ tracked })` site so the fields never diverge; the arrival toast fires once per
track session (`arrivalAnnounced`) when the bus first reaches `due`. `lib/network.ts` loads
`/api/network` → GeoJSON + the `shapesById`/`stopById` lookups the engine needs.
`map/layers.ts` holds the data-driven layer styles (stop `minzoom` declutter, the two
zoom-gated vehicle layers whose `icon-size` shrinks with zoom, label `minzoom`). The popup
Track buttons call `engine.*` **directly** — no `window.*` handlers, no HTML strings.

**Track intro animation:** `track()` runs a cancellable two-phase camera move via
`playTrackIntro()` — a 2 s `fitBounds` overview (bus + stop) then a 1 s `flyTo` into the bus
— gated by an `introPlaying` flag so the per-frame follow-cam can't fight it; `clearIntro()`
(called from `track()`/`untrack()`) cancels the timers on Exit/re-track. Stop clicks
`easeTo` with a vertical offset to centre the popup; vehicle clicks use popup-aware,
viewport-clamped `fitBounds` padding so the whole ETA popup stays on-screen.

**Vehicle icons are top-down art, so they ARE rotated to the travel bearing.** Each vehicle
feature carries `img` (the MapLibre image id — `'bus-default'` or `'train'`), `rotate`
(`(bearing − forward + 360) % 360`, applied via `icon-rotate` with
`icon-rotation-alignment: 'map'`), `size` (per-kind base scale), and a per-frame `bob`
offset. `forward` is the compass heading the art faces unrotated — **bus = 0 (nose north),
train = 135** — set in the `ICONS` table in `config.ts`; if you swap the art, update only
those. The bus image id is **`bus-default`**, not `bus`, so it can't collide with the
basemap sprite's own `bus` glyph. The engine recomputes `bearing` every frame from the
displacement between the last two rendered positions (Calgary gives no bearing), so the
nose follows the shape continuously rather than snapping once per fix. `MapView` registers
each PNG into the style at load, knocking out a connected light background (flood-fill) and
downscaling to `ICON_MAX_W`. (A mirrored `-flip` registration path still exists for the old
side-view scheme but is unused now that icons rotate.)

**Density-by-zoom:** each vehicle gets a stable `rank ∈ [0,1)` hashed from its id. Two
layers split by disjoint filters — `vehicles-overview` always draws the low-rank sample
(`rank < VEH_OVERVIEW_FRACTION`, ~18%) so zoomed-out views still show area activity, and
`vehicles` draws the rest only at/above `VEH_ALL_ZOOM` (13). At high zoom the two together
= every vehicle, no duplicates. Both layers scale `icon-size` down with zoom; bobbing stops
below `BOB_MIN_ZOOM` (12).

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
| 7 | **React + TS + MapLibre GL frontend** (`frontend-react/`): vector basemap, GPU GeoJSON layers, snap-to-shape rAF engine ported to `lib/engine.ts`, zustand chrome, React popups/track-bar; backend serves `dist/` when built (`FRONTEND_DIR` override). Same JSON contract. | `frontend-react/*`, `server.py` |
| 7.1 | **Clean "Uber day" redesign** of the React app: Positron/`dataviz` basemap, **stops-at-z14 declutter** (dropped clustering) + **density-by-zoom vehicles** (rank sample + zoom-gated full layer); **top-down icons rotated to a per-frame bearing** (continuity-constrained, no flip); track-zoom 18; selected-stop pin = bigger + slow float + vehicle-style glow; `TrackBubble` isolated for smooth follow; red stop-popup header; bottom-right locate FAB + collapsible attribution. | `config.ts`, `engine.ts`, `layers.ts`, `MapView.tsx`, `index.css`, `App.tsx` |
| 7.2 | **Mobile pass:** zoom-lock viewport + `viewport-fit=cover`, safe-area insets, bigger tap targets, overscroll/tap-flash hardening, phone-only layout (hide zoom control/`#zoomcap`, full-width track bar, lifted locate FAB). | `index.html`, `index.css` |
| 7.3 | **Camera + track-bar redesign:** stop-click `easeTo` centres the popup; vehicle-click popup-aware clamped `fitBounds`; **cinematic 2 s overview → 1 s fly-in track intro** (`introPlaying` gate, cancellable); track bar = `"Following Bus <id>"` heading + always-visible blue equal-width Follow/Exit; zoom-out `icon-size` shrink so the glide reads. | `engine.ts`, `store.ts`, `MapView.tsx`, `TrackBar.tsx`, `layers.ts`, `index.css` |
| 7.4 | **Red app header** (`AppBar`: title + 1 Hz live clock + `Server: <status>` from snapshot age) and **`ArrivalToast`** ("<Bus\|CTrain> <id> has arrived at <stop>", X to close); map dropped below the header via `--appbar-total` (incl. notch safe-area). | `AppBar.tsx`, `ArrivalToast.tsx`, `store.ts`, `engine.ts`, `App.tsx`, `index.css` |
| 8 | **Docker + free cloud deploy:** multi-stage `Dockerfile` (node builds `dist` → python serves bundle + API, binds `$PORT`), `.dockerignore`, `render.yaml` Blueprint (free Docker web service, auto-deploy on push). Single-origin → one container, no separate frontend host. | `Dockerfile`, `.dockerignore`, `render.yaml`, `README.md` |

Phase 5 implementation notes:
- **"Nearest vehicle" = soonest predicted arrival**, NOT geographically closest
  (wrong route/direction/already-past). Endpoint sorts by arrival epoch.
- `build_vehicles` now appends `trip_id`; `build_stops` now appends `stop_id`.
- ETA endpoint: `/api/stop/{stop_id}/eta` → `{arrivals:[{route,headsign,color,
  type,trip_id,vehicle_id,arrival,eta_seconds}], ...}` (top 3, past filtered).

---

## Next phases (planned)

> Phases 6 (snap-to-route) and **7 / 7.1 (React + MapLibre + clean redesign)** are **done**
> — see the animation-engine section and the "React frontend" section above. The backend
> JSON contract was unchanged by the rewrite (renderer is swappable without touching
> Python). Remaining Phase 7 polish if desired: code-split the 1 MB maplibre-gl chunk, then
> retire `frontend/` once the React app is signed off.

### Phase 8 — Docker + cloud deploy ✅ (single-container path done)
**Done:** because the app is **single-origin** (uvicorn serves the React `dist/` *and* the
`/api/*` JSON), it ships as **one container** — a multi-stage `Dockerfile` (node builds the
bundle → python serves it, binds `0.0.0.0:$PORT`) plus a `render.yaml` Blueprint for a free
Render Docker web service that **auto-deploys on push**. Local: `docker build -t transit . &&
docker run -p 8000:8000 -e PORT=8000 transit`. See the **Deployment** notes below + README.
> Free-tier caveat: the instance sleeps when idle; the first hit cold-starts (re-downloads
> static GTFS, restarts the 15 s poll) and fills in over a few seconds — the header's
> "Server: …" status surfaces this. ~512 MB RAM holds the in-memory GTFS; watch for OOM.

**Not done (future):** multi-service `docker compose` (separate web/PostGIS), PostGIS for
history/spatial queries, on-disk GTFS cache so restarts don't re-download.

### Phase 9 — Bigger cloud / data (optional, for the resume line)
Add managed **PostGIS** (Neon/Supabase) for vehicle history + spatial queries; optionally
re-deploy to **AWS (ECS + RDS)** once stable. A CDN-split frontend (Cloudflare Pages/Vercel)
would need a `VITE_API_BASE` + CORS tweak (today the frontend is same-origin, `API=''`).

---

## Deployment

- **Shape:** one always-on web service. `Dockerfile` stage 1 (`node:22-slim`) runs `npm ci &&
  npm run build`; stage 2 (`python:3.12-slim`) installs `requirements.txt`, copies `backend/`
  + the built `frontend-react/dist`, and runs
  `uvicorn server:app --app-dir backend --host 0.0.0.0 --port $PORT`. Image layout keeps
  `/app/backend` + `/app/frontend-react/dist` so `server.py`'s `ROOT`/`REACT_DIST` resolve.
- **Render:** `render.yaml` Blueprint (`type: web`, `runtime: docker`, `plan: free`,
  `healthCheckPath: /api/vehicles`, `autoDeploy: true`). Dashboard → New → Blueprint → connect
  repo → Apply. `dist/` is gitignored, so the **image builds it** — never commit `dist/`.
- **Basemap:** deployed build uses the **keyless OpenFreeMap** fallback (no `VITE_MAPTILER_KEY`
  → no build arg). To use MapTiler in prod, pass the key as a Docker build arg before
  `npm run build`.
- **Still `allow_origins=["*"]`** and **`Cache-Control: no-store` on every response** — both
  intentional/acceptable for now; tighten CORS and stop no-storing hashed assets if/when the
  app gets real traffic.

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
  without updating **all three**: `build_map.py` (build_vehicles), `frontend/scripts/vehicles.js`
  (the destructure), and `frontend-react/src/types.ts` (`VehicleTuple`) + its consumers in
  `lib/engine.ts`/`lib/network.ts`. They must stay in sync. Likewise the stops array
  `[lat,lon,name,stop_id]` and shapes `{shape_id,coords,color}` — both frontends parse them.
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
