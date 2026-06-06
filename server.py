"""
Phase 3 backend — FastAPI.

Responsibilities (the 'kitchen' from our architecture diagram):
  - On startup: load the static GTFS ONCE into memory (routes/trips/shapes/stops).
  - In the background: poll the live feed every POLL_SECONDS, dedupe by the
    feed's header timestamp, resolve trip_id -> route, cache the result.
  - Serve clean JSON to the frontend, plus the frontend page itself.

Run it:   uvicorn server:app --reload      then open http://localhost:8000
"""

import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.protobuf.message import DecodeError

from explore_feed import fetch_feed, FEED_URL
from build_map import (get_gtfs_zip, load_lookups, build_shapes,
                       build_stops, build_vehicles)

POLL_SECONDS = 15  # a bit faster than Calgary's ~30s publish cadence

# Trip Updates GTFS-RT (dataset gs4m-mdc2) — predicted arrival times per stop.
# Separate feed from vehicle positions; same Socrata blob-download pattern.
TRIP_UPDATES_URL = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream"

# --- in-memory caches -------------------------------------------------------
# The whole point of the backend: do expensive work once / on a timer, then
# hand cheap cached data to every client. Clients NEVER hit Calgary directly.
NETWORK = {"shapes": [], "stops": []}            # static, set once at startup
SNAPSHOT = {"vehicles": [], "ts": 0, "matched": 0}  # latest live snapshot
TRIP_UPDATES = {"index": {}, "by_trip": {}, "ts": 0}  # stop_id->arrivals + trip_id->stops
LOOKUPS = {}                                      # routes + trips for the join


def load_network():
    """Load static GTFS once. STATIC_GTFS_FILE env var = use a local zip."""
    file = os.environ.get("STATIC_GTFS_FILE")
    zf = get_gtfs_zip(file=file) if file else get_gtfs_zip()
    routes, trips, shape_route = load_lookups(zf)
    LOOKUPS["routes"], LOOKUPS["trips"] = routes, trips
    NETWORK["shapes"] = build_shapes(zf, routes, shape_route)
    NETWORK["stops"] = build_stops(zf)
    print(f"[startup] network: {len(NETWORK['shapes'])} shapes, "
          f"{len(NETWORK['stops'])} stops, {len(trips)} trips")


def build_trip_index(feed):
    """Trip Updates feed -> two indexes:
      index   = {stop_id: [(arrival_epoch, trip_id, vehicle_id), ...]}   (stop ETA)
      by_trip = {trip_id: [(arrival_epoch, stop_id), ...]}              (a trip's stops)

    Calgary strips fields, so every optional is guarded with HasField — never
    trust protobuf defaults. Prefers arrival.time, falls back to departure.time.
    """
    index, by_trip = {}, {}
    for e in feed.entity:
        if not e.HasField("trip_update"):
            continue
        tu = e.trip_update
        tid = tu.trip.trip_id if tu.trip.HasField("trip_id") else None
        vid = tu.vehicle.id if tu.HasField("vehicle") and tu.vehicle.id else None
        for stu in tu.stop_time_update:
            sid = stu.stop_id if stu.HasField("stop_id") else None
            if not sid:
                continue
            t = None
            if stu.HasField("arrival") and stu.arrival.HasField("time"):
                t = stu.arrival.time
            elif stu.HasField("departure") and stu.departure.HasField("time"):
                t = stu.departure.time
            if t:
                index.setdefault(sid, []).append((t, tid, vid))
                if tid:
                    by_trip.setdefault(tid, []).append((t, sid))
    return index, by_trip


def poll_loop():
    """Background worker: fetch, dedupe, resolve, cache. Runs forever.

    Polls two feeds each tick — vehicle positions and trip updates — each with
    its own timestamp dedupe so we only rebuild when that feed actually changed.
    """
    global SNAPSHOT, TRIP_UPDATES
    last_ts = None
    last_tu_ts = None
    while True:
        try:
            feed = fetch_feed(FEED_URL)
            ts = feed.header.timestamp
            if ts != last_ts:           # only rebuild when the data is actually new
                last_ts = ts
                vehicles, matched = build_vehicles(feed, LOOKUPS["routes"],
                                                   LOOKUPS["trips"])
                SNAPSHOT = {"vehicles": vehicles, "ts": ts, "matched": matched}
                print(f"[poll] {len(vehicles)} vehicles, {matched} matched, ts={ts}")
            else:
                print("[poll] no new data (same timestamp) — skipping rebuild")
        except DecodeError:
            # Socrata sometimes returns a non-protobuf body (HTML/empty/throttle).
            # Transient — keep the last good snapshot and retry next tick.
            print("[poll] vehicles: non-protobuf response (transient) — keeping last data")
        except Exception as exc:
            print(f"[poll] vehicles failed: {exc}")

        try:
            tu_feed = fetch_feed(TRIP_UPDATES_URL)
            tu_ts = tu_feed.header.timestamp
            if tu_ts != last_tu_ts:
                last_tu_ts = tu_ts
                index, by_trip = build_trip_index(tu_feed)
                TRIP_UPDATES = {"index": index, "by_trip": by_trip, "ts": tu_ts}
                print(f"[poll] trip-updates: {len(index)} stops with arrivals, ts={tu_ts}")
        except DecodeError:
            print("[poll] trip-updates: non-protobuf response (transient) — keeping last data")
        except Exception as exc:
            print(f"[poll] trip-updates failed: {exc}")

        time.sleep(POLL_SECONDS)


@asynccontextmanager
async def lifespan(app):
    # startup: load network, then launch the poller in a daemon thread so the
    # blocking requests.get() never freezes the web server's event loop.
    load_network()
    threading.Thread(target=poll_loop, daemon=True).start()
    yield
    # (shutdown would go here)


app = FastAPI(lifespan=lifespan)

# Allow a separately-hosted frontend (e.g. Vite on :5173) to call us later.
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# Serve icon images (bus.png, train.png, ...) from ./static
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/api/network")
def network():
    """Static route shapes + stops. The frontend fetches this once."""
    return NETWORK


@app.get("/api/vehicles")
def vehicles():
    """Latest cached snapshot. Cheap — just returns memory, no network."""
    ts = SNAPSHOT["ts"]
    age = int(time.time() - ts) if ts else None
    return {**SNAPSHOT, "age": age}


@app.get("/api/stop/{stop_id}/eta")
def stop_eta(stop_id: str):
    """Next arrivals at a stop, soonest first (top 3).

    'Nearest vehicle serving this stop' = soonest predicted arrival, NOT the
    geographically closest bus. Each arrival's trip_id is resolved to route info
    via the same static join used for vehicles, and carries trip_id/vehicle_id
    so the frontend can link it to a live marker for tracking.
    """
    now = time.time()
    arrivals = TRIP_UPDATES["index"].get(stop_id, [])
    out = []
    for epoch, tid, vid in arrivals:
        if epoch < now - 30:            # drop arrivals already in the past
            continue
        trip = LOOKUPS["trips"].get(tid, {}) if tid else {}
        route = LOOKUPS["routes"].get(trip.get("route_id"), {})
        out.append({
            "route": route.get("short", "?"),
            "headsign": trip.get("headsign", ""),
            "color": route.get("color", "#888888"),
            "type": route.get("type", "?"),
            "trip_id": tid,
            "vehicle_id": vid,
            "arrival": epoch,
            "eta_seconds": int(epoch - now),
        })
    out.sort(key=lambda a: a["arrival"])
    return {"stop_id": stop_id, "arrivals": out[:3], "ts": TRIP_UPDATES["ts"]}


@app.get("/api/trip/{trip_id}/next-stop")
def trip_next_stop(trip_id: str):
    """The soonest upcoming stop for a trip (for vehicle-click → next stop + ETA).

    Scans this trip's stop_time_updates, picks the earliest still-future one, and
    joins route short/headsign. Returns {stop_id: null} if the trip isn't in the
    trip-updates feed (the frontend then shows a basic popup, no Track).
    """
    now = time.time()
    stops = TRIP_UPDATES["by_trip"].get(trip_id, [])
    upcoming = [(epoch, sid) for epoch, sid in stops if epoch >= now - 30]
    if not upcoming:
        return {"stop_id": None}
    epoch, sid = min(upcoming, key=lambda x: x[0])
    trip = LOOKUPS["trips"].get(trip_id, {})
    route = LOOKUPS["routes"].get(trip.get("route_id"), {})
    return {
        "stop_id": sid,
        "arrival": epoch,
        "eta_seconds": int(epoch - now),
        "route": route.get("short", "?"),
        "headsign": trip.get("headsign", ""),
        "ts": TRIP_UPDATES["ts"],
    }


@app.get("/")
def index():
    """Serve the frontend page from the same origin as the API.

    no-store so local edits (constants, tuning) always take effect on reload —
    the browser otherwise caches index.html and runs a stale copy.
    """
    return FileResponse(os.path.join(os.path.dirname(__file__), "index.html"),
                        headers={"Cache-Control": "no-store"})
