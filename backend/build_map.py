"""
Phase 1 + 2 — Draw Calgary's transit network AND plot live vehicles.

Downloads the static GTFS (stops + route shapes), optionally fetches one live
snapshot of vehicle positions, resolves each vehicle's trip_id -> route via the
static join, and writes a self-contained Leaflet map.html. Shapes and vehicles
are colored using the agency's own route_color. This is an exploration viewer;
the real app will use MapLibre later.

  python build_map.py                  # network + a live snapshot of vehicles
  python build_map.py --no-vehicles    # static network only
  python build_map.py --file gtfs.zip  # use a static zip you already have
  python build_map.py --max-shapes 80  # draw fewer shapes if it feels slow
"""

import argparse
import csv
import io
import json
import sys
import zipfile

import requests

from explore_feed import fetch_feed, FEED_URL

# "Calgary Transit Scheduling Data" (static GTFS), dataset npk7-z3bj, via the
# Socrata blob-download pattern. We try a couple of mime suffixes.
STATIC_GTFS_CANDIDATES = [
    "https://data.calgary.ca/download/npk7-z3bj/application%2Fzip",
    "https://data.calgary.ca/download/npk7-z3bj/application%2Foctet-stream",
]

ROUTE_TYPE = {"0": "tram/LRT", "1": "subway", "2": "rail",
              "3": "bus", "4": "ferry", "5": "cable", "6": "gondola", "7": "funicular"}


def get_gtfs_zip(url=None, file=None):
    """Return a ZipFile for the static GTFS, from a local file or download."""
    if file:
        return zipfile.ZipFile(file)
    urls = [url] if url else STATIC_GTFS_CANDIDATES
    last_err = None
    for u in urls:
        try:
            print(f"  downloading {u}")
            resp = requests.get(u, timeout=60,
                                headers={"User-Agent": "calgary-transit-tracker/0.1"})
            resp.raise_for_status()
            data = io.BytesIO(resp.content)
            if zipfile.is_zipfile(data):
                data.seek(0)
                return zipfile.ZipFile(data)
            print("    (not a zip — trying next candidate)")
        except Exception as exc:
            last_err = exc
            print(f"    failed: {exc}")
    raise RuntimeError(f"Could not fetch a valid GTFS zip. Last error: {last_err}")


def read_csv(zf, name):
    with zf.open(name) as fh:
        text = io.TextIOWrapper(fh, encoding="utf-8-sig")  # strip BOM if present
        return list(csv.DictReader(text))


def load_lookups(zf):
    """Static lookups: routes (id->info), trips (id->info), shape->route."""
    routes = {}
    for r in read_csv(zf, "routes.txt"):
        routes[r["route_id"]] = {
            "color": "#" + (r.get("route_color") or "888888").lstrip("#"),
            "short": r.get("route_short_name", ""),
            "type": ROUTE_TYPE.get(r.get("route_type", ""), "?"),
        }
    trips, shape_route = {}, {}
    for t in read_csv(zf, "trips.txt"):
        tid, sid, rid = t["trip_id"], t.get("shape_id"), t.get("route_id")
        trips[tid] = {"route_id": rid, "shape_id": sid,
                      "headsign": t.get("trip_headsign", "")}
        if sid and sid not in shape_route:
            shape_route[sid] = rid
    return routes, trips, shape_route


def build_shapes(zf, routes, shape_route, max_shapes=None):
    pts = {}
    for s in read_csv(zf, "shapes.txt"):
        pts.setdefault(s["shape_id"], []).append(
            (int(s["shape_pt_sequence"]),
             round(float(s["shape_pt_lat"]), 5),
             round(float(s["shape_pt_lon"]), 5)))
    shapes = []
    for sid, plist in pts.items():
        plist.sort()
        coords = [[lat, lon] for _, lat, lon in plist]
        color = routes.get(shape_route.get(sid), {}).get("color", "#888888")
        # shape_id lets the frontend look up a vehicle's road geometry for
        # snap-to-shape animation + the blue tracked-route highlight.
        shapes.append({"shape_id": sid, "coords": coords, "color": color})
    if max_shapes:
        shapes = shapes[:max_shapes]
    return shapes


def build_stops(zf):
    stops = []
    for st in read_csv(zf, "stops.txt"):
        try:
            # [lat, lon, name, stop_id] — stop_id is the key the frontend uses to
            # call /api/stop/<id>/eta. Appended last so s[0..2] stay unchanged.
            stops.append([round(float(st["stop_lat"]), 5),
                          round(float(st["stop_lon"]), 5),
                          st.get("stop_name", ""),
                          st["stop_id"]])
        except (KeyError, ValueError):
            continue
    return stops


def build_vehicles(feed, routes, trips):
    """Resolve each live vehicle's trip_id -> route info for plotting."""
    vehicles, matched = [], 0
    for e in feed.entity:
        if not e.HasField("vehicle"):
            continue
        v, p = e.vehicle, e.vehicle.position
        tid = v.trip.trip_id if v.trip.HasField("trip_id") else None
        trip = trips.get(tid) if tid else None
        if trip:
            matched += 1
            route = routes.get(trip["route_id"], {})
            short, color = route.get("short", "?"), route.get("color", "#888888")
            rtype, head = route.get("type", "?"), trip.get("headsign", "")
            sid = trip.get("shape_id") or ""
        else:
            short, color, rtype, head, sid = "?", "#888888", "unmatched", "", ""
        # [lat, lon, route_short, color, headsign, vehicle_id, type, trip_id, shape_id]
        # trip_id links a vehicle to a Trip-Updates arrival; shape_id links it to its
        # road geometry (snap-to-shape animation + blue tracked-route highlight).
        vehicles.append([round(p.latitude, 5), round(p.longitude, 5),
                         short, color, head, v.vehicle.id, rtype, tid or "", sid])
    return vehicles, matched


HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Calgary Transit — live snapshot</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}
.cap{position:absolute;z-index:1000;top:8px;left:50px;background:#fff;padding:4px 8px;
border-radius:4px;font:13px sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3)}</style></head>
<body><div id="map"></div><div class="cap" id="cap"></div><script>
const STOPS = __STOPS__;
const SHAPES = __SHAPES__;
const VEHICLES = __VEHICLES__;
const CAPTION = "__CAPTION__";
document.getElementById('cap').textContent = CAPTION;

const map = L.map('map', {preferCanvas: true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {maxZoom: 19, attribution: '&copy; OpenStreetMap'}).addTo(map);

const shapeLayer = L.layerGroup();
SHAPES.forEach(s => L.polyline(s.coords,
  {color: s.color, weight: 2, opacity: 0.5}).addTo(shapeLayer));

const stopLayer = L.layerGroup();
STOPS.forEach(s => L.circleMarker([s[0], s[1]],
  {radius: 2, color: '#1d4ed8', fillOpacity: 0.8, weight: 0})
  .bindPopup(s[2]).addTo(stopLayer));

const vehLayer = L.layerGroup();
VEHICLES.forEach(v => L.circleMarker([v[0], v[1]],
  {radius: 5, fillColor: v[3], color: '#fff', weight: 1.5, fillOpacity: 1})
  .bindPopup('<b>Route ' + v[2] + '</b> (' + v[6] + ')<br>' +
             (v[4] ? 'to ' + v[4] + '<br>' : '') + 'vehicle ' + v[5])
  .addTo(vehLayer));

shapeLayer.addTo(map);     // route network: on
vehLayer.addTo(map);       // live vehicles: on, drawn on top
// stops: registered but off by default to reduce clutter
L.control.layers(null, {
  ['Route shapes (' + SHAPES.length + ')']: shapeLayer,
  ['Live vehicles (' + VEHICLES.length + ')']: vehLayer,
  ['Stops (' + STOPS.length + ')']: stopLayer,
}).addTo(map);

const focus = VEHICLES.length ? VEHICLES.map(v => [v[0], v[1]])
                              : SHAPES.flatMap(s => s.coords);
map.fitBounds(focus.length ? focus : [[51.05, -114.07]]);
</script></body></html>
"""


def main():
    ap = argparse.ArgumentParser(description="Map Calgary's transit network + a live snapshot.")
    ap.add_argument("--url", help="override the static GTFS zip URL")
    ap.add_argument("--file", help="use a local static GTFS zip")
    ap.add_argument("--feed-url", default=FEED_URL, help="override the live feed URL")
    ap.add_argument("--no-vehicles", action="store_true", help="static network only")
    ap.add_argument("--out", default="map.html", help="output HTML file")
    ap.add_argument("--max-shapes", type=int, help="cap number of shapes drawn")
    args = ap.parse_args()

    print("Loading static GTFS...")
    try:
        zf = get_gtfs_zip(url=args.url, file=args.file)
    except Exception as exc:
        print(f"[!] {exc}", file=sys.stderr)
        print("    Tip: download the npk7-z3bj zip manually and pass --file.", file=sys.stderr)
        sys.exit(1)

    routes, trips, shape_route = load_lookups(zf)
    shapes = build_shapes(zf, routes, shape_route, max_shapes=args.max_shapes)
    stops = build_stops(zf)
    print(f"  {len(stops)} stops, {len(shapes)} route shapes")

    vehicles, caption = [], "Static network only"
    if not args.no_vehicles:
        print("Fetching live snapshot...")
        try:
            feed = fetch_feed(args.feed_url)
            vehicles, matched = build_vehicles(feed, routes, trips)
            print(f"  {len(vehicles)} vehicles ({matched} matched to a route)")
            caption = f"{len(vehicles)} live vehicles · {matched} route-matched"
        except Exception as exc:
            print(f"[!] live fetch failed ({exc}) — building static-only map", file=sys.stderr)

    html = (HTML
            .replace("__STOPS__", json.dumps(stops))
            .replace("__SHAPES__", json.dumps(shapes))
            .replace("__VEHICLES__", json.dumps(vehicles))
            .replace("__CAPTION__", caption))
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"Wrote {args.out} — open it in your browser.")


if __name__ == "__main__":
    main()