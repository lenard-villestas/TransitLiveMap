"""
Verify the GTFS join: live vehicle trip_id  ->  static route info.

This is a diagnostic script. It loads the static GTFS, pulls one live snapshot,
and checks whether each vehicle's trip_id can be resolved to a route. The print
statements are deliberately verbose so the output is enough to debug from:
  - which optional fields the live feed actually populates (HasField, not == 0)
  - how many live trip_ids successfully match the static data (coverage %)
  - side-by-side samples of live vs static trip_ids so format mismatches show up

  python verify_join.py                 # download static, fetch live, report
  python verify_join.py --file gtfs.zip # use a local static zip
  python verify_join.py --sample 12     # show more per-vehicle resolutions
"""

import argparse
import sys

from explore_feed import fetch_feed, FEED_URL
from build_map import get_gtfs_zip, read_csv

ROUTE_TYPE = {"0": "tram/LRT", "1": "subway", "2": "rail",
              "3": "bus", "4": "ferry", "5": "cable", "6": "gondola", "7": "funicular"}


def load_static(zf):
    """Build the two lookups the join needs: trips and routes."""
    routes = {}
    for r in read_csv(zf, "routes.txt"):
        routes[r["route_id"]] = {
            "short": r.get("route_short_name", ""),
            "long": r.get("route_long_name", ""),
            "color": "#" + (r.get("route_color") or "888888").lstrip("#"),
            "type": ROUTE_TYPE.get(r.get("route_type", ""), r.get("route_type", "?")),
        }
    trips = {}
    for t in read_csv(zf, "trips.txt"):
        trips[t["trip_id"]] = {
            "route_id": t.get("route_id"),
            "shape_id": t.get("shape_id"),
            "headsign": t.get("trip_headsign", ""),
        }
    return routes, trips


def audit_fields(vehicles):
    """Report which optional fields the live feed actually fills in."""
    n = len(vehicles) or 1
    checks = {
        "trip.trip_id":        sum(v.trip.HasField("trip_id") for v in vehicles),
        "trip.route_id":       sum(v.trip.HasField("route_id") for v in vehicles),
        "position.bearing":    sum(v.position.HasField("bearing") for v in vehicles),
        "position.speed":      sum(v.position.HasField("speed") for v in vehicles),
        "current_status":      sum(v.HasField("current_status") for v in vehicles),
        "stop_id":             sum(v.HasField("stop_id") for v in vehicles),
    }
    print("\n--- live field population (present via HasField, not just != 0) ---")
    for field, count in checks.items():
        print(f"  {field:<22} {count:>5}/{len(vehicles)}  ({100*count/n:5.1f}%)")


def main():
    ap = argparse.ArgumentParser(description="Verify the live trip_id -> static route join.")
    ap.add_argument("--url", help="override static GTFS zip URL")
    ap.add_argument("--file", help="use a local static GTFS zip")
    ap.add_argument("--feed-url", default=FEED_URL, help="override live feed URL")
    ap.add_argument("--sample", type=int, default=8, help="vehicles to resolve in detail")
    args = ap.parse_args()

    # 1. Static side
    print("Loading static GTFS...")
    zf = get_gtfs_zip(url=args.url, file=args.file)
    routes, trips = load_static(zf)
    print(f"  static: {len(routes)} routes, {len(trips)} trips")
    sample_static_ids = list(trips.keys())[:3]
    print(f"  sample static trip_ids: {sample_static_ids}")

    # 2. Live side
    print("\nFetching live feed...")
    feed = fetch_feed(args.feed_url)
    vehicles = [e.vehicle for e in feed.entity if e.HasField("vehicle")]
    age = "unknown"
    if feed.header.timestamp:
        import time
        age = f"{int(time.time() - feed.header.timestamp)}s old"
    print(f"  live: {len(vehicles)} vehicles, snapshot {age}")
    audit_fields(vehicles)

    live_trip_ids = [v.trip.trip_id for v in vehicles if v.trip.HasField("trip_id")]
    print(f"\n  sample live trip_ids:   {live_trip_ids[:3]}")
    print("  ^ compare the format of these two lists — they must match to join")

    # 3. Coverage: how many live trip_ids exist in the static data?
    if live_trip_ids:
        matched = [tid for tid in live_trip_ids if tid in trips]
        unmatched = [tid for tid in live_trip_ids if tid not in trips]
        pct = 100 * len(matched) / len(live_trip_ids)
        print(f"\n--- join coverage ---")
        print(f"  {len(matched)}/{len(live_trip_ids)} live trip_ids found in static ({pct:.1f}%)")
        if unmatched:
            print(f"  {len(unmatched)} unmatched — sample: {unmatched[:5]}")
            print("  (some unmatched is normal: added/unscheduled trips, or a stale static feed)")
    else:
        print("\n[!] No vehicle reported a trip_id — the join can't run. "
              "Re-check the feed or field names above.")

    # 4. Detailed per-vehicle resolution
    print(f"\n--- resolving {args.sample} sample vehicles ---")
    shown = 0
    for v in vehicles:
        if shown >= args.sample:
            break
        tid = v.trip.trip_id if v.trip.HasField("trip_id") else None
        if not tid:
            continue
        shown += 1
        trip = trips.get(tid)
        if not trip:
            print(f"  veh {v.vehicle.id:<8} trip {tid:<16} -> NOT FOUND in static")
            continue
        route = routes.get(trip["route_id"], {})
        print(f"  veh {v.vehicle.id:<8} trip {tid:<16} -> "
              f"route {route.get('short','?'):<5} "
              f"({route.get('type','?')})  "
              f"shape {trip.get('shape_id','?'):<10} "
              f"to {route.get('long') or trip.get('headsign','')}")


if __name__ == "__main__":
    main()
