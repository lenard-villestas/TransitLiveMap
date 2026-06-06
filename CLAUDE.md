# Calgary Transit Live Tracker — Project Brief

GIS portfolio project: a live map that tracks Calgary Transit vehicles in
real time, built with Python/FastAPI backend + Leaflet frontend. Every
architectural decision here was made deliberately; read this before changing
anything so you don't undo a considered choice.

---

## Current state

Phases 0–4 are complete and working. The app runs locally and shows the
live fleet with rotating bus/train icons gliding across the CARTO light
basemap.

**Run the app:**
```bash
python -m uvicorn server:app --reload   # use -m, not bare uvicorn (Windows PATH quirk)
# open http://localhost:8000
```
> ⚠️ On Windows (Microsoft Store Python), `uvicorn` is not on PATH.
> Always use `python -m uvicorn`. Do not try to fix this by modifying PATH;
> it's a Store-Python sandbox issue. Use python.org installer for a clean setup.

---

## Repository layout

```
TransitLiveMap/
├── server.py          FastAPI backend (the "kitchen" — never let clients hit Calgary directly)
├── index.html         Leaflet frontend served by FastAPI at /
├── explore_feed.py    Phase 0 exploration tool (--watch, --vehicle, schema printer)
├── build_map.py       Phase 1 snapshot tool (static network + one-shot vehicle overlay)
├── verify_join.py     Phase 2 diagnostic (trip_id→route join coverage check)
├── requirements.txt
├── .gitignore
└── static/
    ├── bus.png        32×32 RGBA, icon head points EAST   (forward offset = 90°)
    └── train.png      32×32 RGBA, icon head points SE     (forward offset = 135°)
```

The exploration scripts (`explore_feed`, `build_map`, `verify_join`) are
**standalone throwaway tools** — do not import them into production code
beyond the current `server.py → build_map` imports that already exist.

---

## Architecture

```
Calgary Open Data          (GTFS-RT protobuf, ~30s publish cadence)
        │
        ▼  poll every 15s, dedupe on header.timestamp
  Python backend
  ├── load_network()      static GTFS loaded ONCE at startup into memory
  ├── poll_loop()         background daemon thread (not async — requests.get is blocking)
  ├── SNAPSHOT global     latest resolved vehicle list, replaced atomically
  ├── GET /api/network    shapes + stops (static, fetched once by frontend)
  ├── GET /api/vehicles   cached snapshot, instant (no network call)
  ├── GET /static/*       bus.png, train.png
  └── GET /               index.html
        │
        ▼  fetch every 15s
  Leaflet frontend
  ├── loadNetwork()       draws route polylines once, adds stops to toggle layer
  ├── requestAnimationFrame loop   60fps lerp animation, independent of data fetch
  └── refresh() / setInterval     updates glide targets, computes bearing, sets icon rotation
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
| `stop_id` | ❌ 0% | Not provided |

**Join coverage:** ~97.4% of live `trip_id`s resolve in static GTFS.
The ~2.6% misses are added/unscheduled trips — normal, not a bug.

**Feed URLs (Socrata download pattern):**
```
Live vehicle positions: https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream
Static GTFS schedule:   https://data.calgary.ca/download/npk7-z3bj/application%2Fzip
                        (fallback: .../application%2Foctet-stream)
Trip updates (ETA):     https://data.calgary.ca/download/<id>/...   ← needed for Phase 5
Service alerts:         https://data.calgary.ca/download/<id>/...
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

**Why interpolation, not extrapolation:** Calgary gives no speed/bearing,
so extrapolation would require deriving velocity from two fixes and predicting
ahead — overshoot artifacts + correction jitter with 30s-gap updates. We
interpolate (animate toward latest known position) and accept a small constant
lag in exchange for stable, artifact-free motion.

**Interpolation pattern (in index.html):**
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
the `ICONS` table in index.html — nothing else changes.

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

~3000 stops are in the static GTFS. They're loaded into `/api/network` (as
`stops` array) and drawn as small canvas-renderer circleMarkers in a toggleable
layer (off by default). Do NOT give stops individual PNG icons — 3000 DOM
image markers is a known perf cliff. If stop icons are wanted, zoom-gate them
(e.g., only render at zoom ≥ 14) so they only appear when the map is close
enough that count is manageable.

---

## Completed phases

| Phase | What was built | Key files |
|-------|---------------|-----------|
| 0 | Fetch + decode + inspect Calgary's live feed | `explore_feed.py` |
| 1 | Download static GTFS, render network map | `build_map.py` |
| 2 | Verify trip_id → route join on live data | `verify_join.py` |
| 3 | FastAPI backend + live Leaflet map (teleporting) | `server.py`, `index.html` |
| 4 | Rotating PNG icons + lerp animation + freeze mitigation | `index.html` |

---

## Next phases (planned)

### Phase 5 — Stop interaction + ETA
Click a stop → highlight the nearest vehicle serving that stop + show ETA.
- Use the **Trip Updates** GTFS-RT feed (separate from vehicle positions).
  Trip Updates contains `stop_time_update` entries with predicted arrival times
  per stop. This is separate from the vehicle positions feed — add a second
  poll in `server.py` for trip updates.
- "Nearest vehicle" means: among vehicles on trips that serve this stop,
  which has the soonest predicted arrival — NOT the geographically nearest bus.
  Straight-line distance is wrong (wrong route, wrong direction, already past).
- Backend: new `/api/stop/<stop_id>/eta` endpoint.
- Frontend: click handler on stop markers.

### Phase 6 — Snap-to-route interpolation (Tier 2 animation)
Instead of straight-line lerp, animate vehicles *along their route polyline*.
This requires:
- Backend: include `shape_id` in `/api/vehicles` response (already available
  from the join in `build_vehicles()`).
- Backend or frontend: send shape geometry per vehicle (or preload all shapes
  and look up client-side — shape data already in `/api/network`).
- Frontend: linear referencing — project old/new positions onto the polyline,
  interpolate progress along the line. Leaflet alone can't do this cleanly;
  consider Turf.js (`nearestPointOnLine`, `along`) for the geometry math.
  This is the "impressive GIS" piece: real linear referencing in the browser.

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
  `[lat, lon, route_short, color, headsign, vehicle_id, route_type_str]`

---

## Known issues / do-not-touch

- **Do not change the vehicle array format** `[lat,lon,short,color,head,id,type]`
  without updating both `server.py` (build_vehicles) and `index.html` (the
  destructuring `const [lat,lon,short,color,head,id,type] = arr`). They must stay in sync.
- **Do not add CORS restrictions yet** — the `allow_origins=["*"]` in
  `server.py` is intentional for local dev. Tighten this before cloud deploy.
- **Static GTFS is downloaded fresh on each server startup.** For production,
  cache it to disk and refresh on a daily schedule instead.
- The `test_gtfs.zip` file in the repo root is a synthetic fixture from
  development tests — safe to delete, not used in production.
