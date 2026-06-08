# Multi-stage build: Node compiles the React/MapLibre bundle, Python serves it + the API.
# The app is single-origin — uvicorn (backend/server.py) serves both /api/* and the built
# frontend-react/dist from one process, so this whole image is one web service.

# ---- stage 1: build the React frontend → frontend-react/dist ----------------
FROM node:22-slim AS build
WORKDIR /app/frontend-react

# install deps first (cached unless package*.json changes)
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci

# build (basemap is keyless OpenFreeMap → no VITE_MAPTILER_KEY needed)
COPY frontend-react/ ./
RUN npm run build

# ---- stage 2: python runtime that serves the API + the built bundle ---------
FROM python:3.12-slim
WORKDIR /app

# python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# backend code + the built frontend (server.py resolves ROOT=/app →
# REACT_DIST=/app/frontend-react/dist, so it serves React, not the Leaflet fallback)
COPY backend/ ./backend/
COPY --from=build /app/frontend-react/dist ./frontend-react/dist

# Render injects $PORT; shell form so it expands. --app-dir puts backend/ on sys.path.
CMD ["sh", "-c", "python -m uvicorn server:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
