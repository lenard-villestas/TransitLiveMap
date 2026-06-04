"""
Phase 0 — Explore the Calgary Transit realtime feed.

This is a throwaway exploration script. Its only job is to let you SEE the
shape of the live data before you build anything around it:
  1. Fetch the raw protobuf bytes over HTTP.
  2. Decode them with the official GTFS-realtime bindings.
  3. Print a human-readable summary of what's actually in there right now.
  4. Print the SCHEMA of a VehiclePosition so you know every field available.

Run it:   python explore_feed.py
"""

import sys
import time

import requests
from google.transit import gtfs_realtime_pb2
from google.protobuf.descriptor import FieldDescriptor

# Calgary Transit GTFS-realtime vehicle positions.
# If this 404s or times out, try the https:// variant, and check the City's
# info page: https://data.calgary.ca/stories/s/u45n-7awa/
FEED_URL = "http://transitdata.calgary.ca/ctransit/vehiclepositions.pb"


# --- Part 1 + 2: poll and decode -------------------------------------------

def fetch_feed(url=FEED_URL):
    """GET the protobuf bytes and parse them into a FeedMessage object."""
    resp = requests.get(url, timeout=15, headers={"User-Agent": "calgary-transit-tracker/0.1"})
    resp.raise_for_status()

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(resp.content)   # raw bytes -> structured object
    return feed


# --- Part 3: summarize the live snapshot ------------------------------------

def summarize(feed):
    """Print what's actually in the feed right now."""
    header = feed.header
    age = time.time() - header.timestamp if header.timestamp else float("nan")

    vehicles = [e.vehicle for e in feed.entity if e.HasField("vehicle")]
    routes = sorted({v.trip.route_id for v in vehicles if v.trip.route_id})

    print("=" * 64)
    print("LIVE SNAPSHOT")
    print("=" * 64)
    print(f"feed version     : {header.gtfs_realtime_version}")
    print(f"snapshot taken   : {int(age)}s ago (header timestamp {header.timestamp})")
    print(f"total entities   : {len(feed.entity)}")
    print(f"with a vehicle   : {len(vehicles)}")
    print(f"distinct routes  : {len(routes)}")
    print(f"sample routes    : {', '.join(routes[:15])}")
    print()
    print("First few vehicles:")
    print(f"  {'vehicle':<10}{'route':<8}{'trip':<14}{'lat':<11}{'lon':<12}{'bearing':<8}")
    for v in vehicles[:8]:
        p = v.position
        print(f"  {v.vehicle.id:<10}{v.trip.route_id:<8}{v.trip.trip_id:<14}"
              f"{p.latitude:<11.5f}{p.longitude:<12.5f}{p.bearing:<8.1f}")
    print()


# --- Part 4: print the schema of the data -----------------------------------

# Build readable names for protobuf's numeric type codes.
TYPE_NAMES = {getattr(FieldDescriptor, n): n[5:].lower()
              for n in dir(FieldDescriptor) if n.startswith("TYPE_")}


def field_label(f):
    """optional / required / repeated, robust across protobuf versions."""
    if getattr(f, "is_repeated", False):
        return "repeated"
    if getattr(f, "is_required", False):
        return "required"
    if hasattr(f, "label"):   # older protobuf still exposes numeric .label
        return {1: "optional", 2: "required", 3: "repeated"}.get(f.label, "optional")
    return "optional"


def print_schema(descriptor, indent=1, seen=None):
    """Recursively walk a protobuf message definition and print its fields."""
    seen = seen or set()
    pad = "  " * indent
    for f in descriptor.fields:
        label = field_label(f)
        if f.type == FieldDescriptor.TYPE_MESSAGE:
            print(f"{pad}{f.name:<24}{label:<9} {f.message_type.name}")
            if f.message_type.full_name not in seen:           # avoid cycles
                print_schema(f.message_type, indent + 1,
                             seen | {f.message_type.full_name})
        elif f.type == FieldDescriptor.TYPE_ENUM:
            options = ", ".join(v.name for v in f.enum_type.values[:4])
            print(f"{pad}{f.name:<24}{label:<9} enum [{options} ...]")
        else:
            print(f"{pad}{f.name:<24}{label:<9} {TYPE_NAMES.get(f.type, f.type)}")


def show_schema():
    print("=" * 64)
    print("SCHEMA — fields available on each VehiclePosition")
    print("=" * 64)
    print("VehiclePosition")
    print_schema(gtfs_realtime_pb2.VehiclePosition.DESCRIPTOR)
    print()


# --- main -------------------------------------------------------------------

def main():
    # The schema works offline (it's baked into the bindings), so print it
    # even if the network call fails.
    try:
        feed = fetch_feed()
        summarize(feed)
    except Exception as exc:
        print(f"[!] Could not fetch live feed: {exc}", file=sys.stderr)
        print("    (Schema below still works — it doesn't need the network.)\n")

    show_schema()


if __name__ == "__main__":
    main()
