# Calgary Transit Live Tracker

A live web map that tracks Calgary Transit buses and CTrains in real time — built as
a GIS portfolio project with a **Python/FastAPI** backend and a **Leaflet** frontend
(vanilla ES modules). Vehicles snap to and glide along their route shapes, stops cluster
and show live ETAs, and you can track any bus to its next stop with a follow-cam and a
live ETA/Late countdown.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

python -m uvicorn server:app --reload --app-dir backend
# open http://localhost:8000
```

`--app-dir backend` puts the backend package on the path so `server.py` finds its
sibling modules. On first start it downloads Calgary's static GTFS (takes a few
seconds), then polls the live feeds every 15 s.

## Project layout

```
backend/    FastAPI app (server.py) + GTFS tools (build_map, explore_feed, verify_join)
frontend/   index.html + styles/app.css + scripts/ (ES modules) + static/ (icons)
docs/       code-reference.html  (technical reference)
            presentation.html    (illustrated "how it works" for learning)
```

## Learn how it works

- **`docs/presentation.html`** — an illustrated walkthrough of the stack, architecture,
  data, and the GIS techniques (snap-to-shape, clustering, interpolation). Open it in a
  browser.
- **`docs/code-reference.html`** — a technical reference of every endpoint, data
  contract, and frontend module.
- **`CLAUDE.md`** — the deep design brief and the empirical Calgary-feed findings.

## Exploration tools

```bash
python backend/explore_feed.py        # inspect one live feed snapshot + schema
python backend/build_map.py           # write a static map.html snapshot
python backend/verify_join.py         # trip_id → route join coverage check
```

## Data sources (Calgary Open Data, GTFS-realtime via Socrata)

| Feed | Dataset |
|------|---------|
| Vehicle positions | `am7c-qe3u` |
| Trip updates (ETA) | `gs4m-mdc2` |
| Service alerts | `jhgn-ynqj` |
| Static GTFS schedule | `npk7-z3bj` |

Download pattern: `https://data.calgary.ca/download/<dataset>/application%2Foctet-stream`
(static GTFS uses `.../application%2Fzip`). Info page:
https://data.calgary.ca/stories/s/u45n-7awa/
