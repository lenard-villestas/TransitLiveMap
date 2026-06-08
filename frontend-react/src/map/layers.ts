// MapLibre layer style objects for react-map-gl's <Layer>. Each replaces a chunk
// of the old imperative Leaflet rendering with declarative, data-driven styling.

import type { LayerProps } from 'react-map-gl/maplibre';
import { LABEL_ZOOM, STOP_MINZOOM, VEH_OVERVIEW_FRACTION, VEH_ALL_ZOOM } from '../config';

// route polylines — colour comes from each feature's `color` property
export const shapeLineLayer = {
  id: 'shapes',
  type: 'line',
  paint: {
    'line-color': ['get', 'color'],
    'line-width': 1.5,
    'line-opacity': 0.3,
  },
} as LayerProps;

// themed red counted badges (native GeoJSON clustering replaces markercluster)
export const clusterCircleLayer = {
  id: 'clusters',
  type: 'circle',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': 'rgba(220,38,38,0.85)',
    'circle-stroke-color': '#fff',
    'circle-stroke-width': 2,
    'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 100, 26],
  },
} as LayerProps;

export const clusterCountLayer = {
  id: 'cluster-count',
  type: 'symbol',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    'text-font': ['Noto Sans Bold'],
    'text-size': 13,
  },
  paint: { 'text-color': '#fff' },
} as LayerProps;

// stop pins, only once zoomed in (clean "Uber" look — no city-wide blanket of pins)
export const stopLayer = {
  id: 'stops',
  type: 'symbol',
  minzoom: STOP_MINZOOM,
  layout: {
    'icon-image': 'stop',
    'icon-size': 0.4,                 // 'stop' art is downscaled to ~72px native (ICON_MAX_W)
    'icon-anchor': 'bottom',
    'icon-allow-overlap': true,
  },
} as LayerProps;

// the one highlighted stop shown while tracking / previewing (own source) — same soft
// pulsing glow the tracked vehicle uses (radius animated by the engine)
export const selStopHaloLayer = {
  id: 'selstop-halo',
  type: 'circle',
  paint: {
    'circle-color': 'rgba(37,99,235,0.35)',
    'circle-radius': 16,            // animated by the engine
    'circle-blur': 0.4,
  },
} as LayerProps;

// bigger than the normal stop pin (≈ +50%) and bobs via the per-frame `bob` offset
export const selStopPinLayer = {
  id: 'selstop-pin',
  type: 'symbol',
  layout: {
    'icon-image': 'stop',
    'icon-size': 0.6,                 // ≈ +50% vs the normal stop pin (0.4)
    'icon-anchor': 'bottom',
    'icon-offset': ['get', 'bob'],
    'icon-allow-overlap': true,
  },
} as LayerProps;

// blue bus→stop route while tracking (trimmed on the render loop)
export const trackedRouteLayer = {
  id: 'tracked-route',
  type: 'line',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#2563eb', 'line-width': 5, 'line-opacity': 0.85 },
} as LayerProps;

// pulsing glow under the tracked / previewed bus (own source)
export const vehHaloLayer = {
  id: 'veh-halo',
  type: 'circle',
  paint: {
    'circle-color': 'rgba(37,99,235,0.35)',
    'circle-radius': 16,            // animated by the engine
    'circle-blur': 0.4,
  },
} as LayerProps;

// the vehicles themselves: side-view art, so we DON'T rotate (that tips the wheels
// over). The `img` property is the icon name already chosen by travel direction —
// e.g. 'bus' (faces east) or 'bus-flip' (mirrored, faces west) — kept upright.
//
// Density-by-zoom: each vehicle carries a stable `rank` ∈ [0,1). The OVERVIEW layer
// always draws the low-rank sample (an activity overview when zoomed out); the FULL
// layer draws the rest only once zoomed past VEH_ALL_ZOOM. Disjoint filters → at high
// zoom both together = every vehicle, with no duplicates.
export const vehicleOverviewLayer = {
  id: 'vehicles-overview',
  type: 'symbol',
  filter: ['<', ['get', 'rank'], VEH_OVERVIEW_FRACTION],
  layout: {
    'icon-image': ['get', 'img'],
    'icon-size': ['interpolate', ['linear'], ['zoom'],
      9, ['*', ['get', 'size'], 0.2],       // far out → much smaller so the glide between fixes reads
      12, ['*', ['get', 'size'], 0.4],      // mid zoom → still compact
      14, ['get', 'size']],                 // z14+ → full per-kind size
    'icon-offset': ['get', 'bob'],
    'icon-rotate': ['get', 'rotate'],
    'icon-rotation-alignment': 'map',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  },
} as LayerProps;

export const vehicleLayer = {
  id: 'vehicles',
  type: 'symbol',
  minzoom: VEH_ALL_ZOOM,
  filter: ['>=', ['get', 'rank'], VEH_OVERVIEW_FRACTION],
  layout: {
    'icon-image': ['get', 'img'],
    'icon-size': ['interpolate', ['linear'], ['zoom'],
      9, ['*', ['get', 'size'], 0.2],       // far out → much smaller so the glide between fixes reads
      12, ['*', ['get', 'size'], 0.4],      // mid zoom → still compact
      14, ['get', 'size']],                 // z14+ → full per-kind size
    'icon-offset': ['get', 'bob'],
    'icon-rotate': ['get', 'rotate'],
    'icon-rotation-alignment': 'map',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  },
} as LayerProps;

// route-number labels — native declutter, only at/above LABEL_ZOOM
export const vehicleLabelLayer = {
  id: 'vehicle-labels',
  type: 'symbol',
  minzoom: LABEL_ZOOM,
  layout: {
    'text-field': ['get', 'short'],
    'text-font': ['Noto Sans Bold'],
    'text-size': 11,
    'text-anchor': 'left',
    'text-offset': [1.2, 0],
    'text-allow-overlap': false,
  },
  paint: {
    'text-color': '#dc2626',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.5,
  },
} as LayerProps;
