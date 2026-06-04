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

from explore_feed import fetch_feed, FEED_URL
from build_map import (get_gtfs_zip, load_lookups, build_shapes,
                       build_stops, build_vehicles)

POLL_SECONDS = 15  # a bit faster than Calgary's ~30s publish cadence

# --- in-memory caches -------------------------------------------------------
# The whole point of the backend: do expensive work once / on a timer, then
# hand cheap cached data to every client. Clients NEVER hit Calgary directly.
NETWORK = {"shapes": [], "stops": []}            # static, set once at startup
SNAPSHOT = {"vehicles": [], "ts": 0, "matched": 0}  # latest live snapshot
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


def poll_loop():
    """Background worker: fetch, dedupe, resolve, cache. Runs forever."""
    global SNAPSHOT
    last_ts = None
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
        except Exception as exc:
            print(f"[poll] failed: {exc}")
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


@app.get("/")
def index():
    """Serve the frontend page from the same origin as the API."""
    return FileResponse(os.path.join(os.path.dirname(__file__), "index.html"))
