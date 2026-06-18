# Calgary Transit Live Tracker

A live web map that tracks Calgary Transit buses and CTrains in real time — built as
a GIS portfolio project with a **Python/FastAPI** backend. Vehicles snap to and glide
along their route shapes (rotating to their travel bearing), stops and ETAs appear as you
zoom in, and you can track any bus to its next stop with a follow-cam and a live ETA/Late
countdown.

The frontend (**`frontend-react/`**) is a **React + TypeScript + MapLibre GL** app: a clean,
light Positron-style vector basemap with GPU layers, decluttered for an "Uber day" look
(stops at zoom ≥ 14, vehicles density-gated by zoom).

## Quick start

```bash
# 1) Backend (always)
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn server:app --reload --app-dir backend     # http://localhost:8000

# 2a) React frontend — DEV (hot reload), in a second terminal:
cd frontend-react
npm install
npm run dev                        # Vite on http://localhost:5173 (proxies /api → :8000)

# 2b) React frontend — PROD: build once; uvicorn then serves it at :8000
cd frontend-react && npm run build
```

The backend serves `frontend-react/dist/` once it's been built (override the location with
the `FRONTEND_DIR` env var); without a build it serves the API only, which is what the Vite
dev server above proxies to. On first start it downloads Calgary's static GTFS (a few
seconds), then polls the live feeds every 15 s.

Optional: put a free [MapTiler](https://www.maptiler.com/) key in `frontend-react/.env`
as `VITE_MAPTILER_KEY=…`. Left blank, the app uses the keyless OpenFreeMap basemap.

## Deploy

The app is **single-origin** — one FastAPI process serves both the `/api/*` JSON and the
built React bundle — so it deploys as a single container. The included multi-stage
[`Dockerfile`](Dockerfile) builds the frontend with Node and serves it with Python; it binds
`0.0.0.0:$PORT`, so it runs on any container host.

```bash
# build + run the production image locally
docker build -t transit .
docker run --rm -p 8000:8000 -e PORT=8000 transit   # → http://localhost:8000
```

**Render (free, auto-deploy from GitHub):** the repo ships a [`render.yaml`](render.yaml)
Blueprint. In the Render dashboard → **New → Blueprint** → connect this repo → **Apply**.
Render builds the Dockerfile and gives you a `https://…onrender.com` URL; every push to
`master` redeploys automatically. The free instance sleeps when idle, so the first visit
after a nap cold-starts (~30–60 s, re-downloading Calgary's static GTFS) before the live
map fills in. While that happens the app shows a loading overlay.

**Split deployment (frontend on Vercel, backend API on Render).** The frontend is a static
bundle and the backend a plain JSON API, so they can be hosted separately — recommended on a
free tier, since the CDN frontend loads instantly while only the data waits for the backend to
wake. Point the frontend at the backend with `VITE_API_BASE` (set on Vercel; root directory
`frontend-react`) and allow it through CORS with `ALLOWED_ORIGINS` (set on Render); both default
to single-origin behaviour when unset (see [`frontend-react/.env.example`](frontend-react/.env.example)).
Render keeps serving its own full copy of the app as a harmless fallback — just share the Vercel
URL. Full steps + cold-start mitigations: [`docs/documentation.html`](docs/documentation.html).

> **Deploy gotcha:** the Docker build runs `npm ci`, which fails unless
> `frontend-react/package-lock.json` is in sync with `package.json`. A local `npm run build`
> can pass with a stale lockfile; the build can't. Run `npm install` and commit the updated
> lockfile in the same change.

## Project layout

```
backend/         FastAPI app (server.py) + GTFS tools (build_map, explore_feed, verify_join)
frontend-react/  React + TS + MapLibre app (src/: config, store, lib/engine, map/, ui/)
docs/            documentation.html   (overview, architecture, API, deployment)
```

## Learn how it works

- **[`docs/documentation.html`](docs/documentation.html)** — overview, architecture, the API
  reference, deployment (single-origin and split), and the data sources. Open it in a browser.

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

## License

Released under the [MIT License](LICENSE). Transit data © Calgary Open Data; basemap data
© OpenStreetMap contributors (served via OpenFreeMap / MapTiler).
