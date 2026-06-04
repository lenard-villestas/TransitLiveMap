# Calgary Transit Tracker

A live map that tracks Calgary Transit vehicles, built as a GIS portfolio project.

## Phase 0 — Explore the data

Before building anything, see the shape of the real GTFS-realtime feed.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python explore_feed.py
```

`explore_feed.py` fetches one snapshot of the vehicle positions feed, prints a
summary (how many vehicles, which routes, sample coordinates), and dumps the
full schema of a VehiclePosition so you know every field available.

## Data sources (Calgary Transit GTFS-realtime)

| Feed | URL |
|------|-----|
| Vehicle positions | http://transitdata.calgary.ca/ctransit/vehiclepositions.pb |
| Trip updates      | http://transitdata.calgary.ca/ctransit/tripupdates.pb |
| Service alerts    | http://transitdata.calgary.ca/ctransit/alerts.pb |

Info page: https://data.calgary.ca/stories/s/u45n-7awa/
