"""
Phase 1 — Draw Calgary's transit network on a map.

Downloads the STATIC GTFS schedule data (stops + route shapes), then writes a
self-contained Leaflet HTML map you can open in a browser. Route shapes are
colored using the agency's own route_color, so CTrain / MAX / bus lines look
right. This is an exploration viewer (Leaflet = fastest way to *see* the data);
the real app will use MapLibre later.

  python build_map.py                 # download + build map.html
  python build_map.py --file gtfs.zip # use a zip you already downloaded
  python build_map.py --max-shapes 80 # draw fewer shapes if it feels slow
"""

import argparse
import csv
import io
import json
import sys
import zipfile

import requests

# "Calgary Transit Scheduling Data" (static GTFS) on Open Calgary, dataset
# npk7-z3bj, via the Socrata blob-download pattern. We try a couple of mime
# suffixes because that's the part that tends to vary.
STATIC_GTFS_CANDIDATES = [
    "https://data.calgary.ca/download/npk7-z3bj/application%2Fzip",
    "https://data.calgary.ca/download/npk7-z3bj/application%2Foctet-stream",
]


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
    """Read a GTFS .txt (CSV) file from the zip into a list of dict rows."""
    with zf.open(name) as fh:
        text = io.TextIOWrapper(fh, encoding="utf-8-sig")  # strip BOM if present
        return list(csv.DictReader(text))


def build_layers(zf, max_shapes=None):
    """Turn the GTFS tables into map-ready stops and colored shape polylines."""
    # routes.txt: route_id -> hex color (GTFS omits the leading '#')
    routes = {}
    for r in read_csv(zf, "routes.txt"):
        color = r.get("route_color") or "888888"
        routes[r["route_id"]] = "#" + color.lstrip("#")

    # trips.txt: shape_id -> route_id (first trip we see for that shape is fine)
    shape_route = {}
    for t in read_csv(zf, "trips.txt"):
        sid = t.get("shape_id")
        if sid and sid not in shape_route:
            shape_route[sid] = t.get("route_id")

    # shapes.txt: gather points per shape_id, then sort by sequence
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
        color = routes.get(shape_route.get(sid), "#888888")
        shapes.append({"coords": coords, "color": color})
    if max_shapes:
        shapes = shapes[:max_shapes]

    # stops.txt: [lat, lon, name]
    stops = []
    for st in read_csv(zf, "stops.txt"):
        try:
            stops.append([round(float(st["stop_lat"]), 5),
                          round(float(st["stop_lon"]), 5),
                          st.get("stop_name", "")])
        except (KeyError, ValueError):
            continue

    return stops, shapes


HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Calgary Transit Network</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}</style></head>
<body><div id="map"></div><script>
const STOPS = __STOPS__;
const SHAPES = __SHAPES__;
const map = L.map('map', {preferCanvas: true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {maxZoom: 19, attribution: '&copy; OpenStreetMap'}).addTo(map);

const shapeLayer = L.layerGroup();
SHAPES.forEach(s => L.polyline(s.coords, {color: s.color, weight: 2, opacity: 0.7}).addTo(shapeLayer));

const stopLayer = L.layerGroup();
STOPS.forEach(s => L.circleMarker([s[0], s[1]],
  {radius: 2, color: '#1d4ed8', fillOpacity: 0.8, weight: 0})
  .bindPopup(s[2]).addTo(stopLayer));

shapeLayer.addTo(map);
stopLayer.addTo(map);
L.control.layers(null, {'Route shapes': shapeLayer, 'Stops': stopLayer}).addTo(map);

const all = SHAPES.flatMap(s => s.coords).concat(STOPS.map(s => [s[0], s[1]]));
map.fitBounds(all.length ? all : [[51.05, -114.07]]);
</script></body></html>
"""


def main():
    ap = argparse.ArgumentParser(description="Build a Leaflet map of Calgary's transit network.")
    ap.add_argument("--url", help="override the static GTFS zip URL")
    ap.add_argument("--file", help="use a local GTFS zip instead of downloading")
    ap.add_argument("--out", default="map.html", help="output HTML file (default map.html)")
    ap.add_argument("--max-shapes", type=int, help="cap number of shapes drawn")
    args = ap.parse_args()

    print("Loading static GTFS...")
    try:
        zf = get_gtfs_zip(url=args.url, file=args.file)
    except Exception as exc:
        print(f"[!] {exc}", file=sys.stderr)
        print("    Tip: download the zip manually from the npk7-z3bj dataset and pass --file.",
              file=sys.stderr)
        sys.exit(1)

    stops, shapes = build_layers(zf, max_shapes=args.max_shapes)
    print(f"  {len(stops)} stops, {len(shapes)} route shapes")

    html = (HTML
            .replace("__STOPS__", json.dumps(stops))
            .replace("__SHAPES__", json.dumps(shapes)))
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"Wrote {args.out} — open it in your browser.")


if __name__ == "__main__":
    main()
