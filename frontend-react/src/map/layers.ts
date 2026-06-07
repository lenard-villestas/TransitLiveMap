// MapLibre layer style objects for react-map-gl's <Layer>. Each replaces a chunk
// of the old imperative Leaflet rendering with declarative, data-driven styling.

import type { LayerProps } from 'react-map-gl/maplibre';
import { LABEL_ZOOM } from '../config';

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

// individual stop pins (only when not clustered)
export const stopLayer = {
  id: 'stops',
  type: 'symbol',
  filter: ['!', ['has', 'point_count']],
  layout: {
    'icon-image': 'stop',
    'icon-size': 0.9,
    'icon-anchor': 'bottom',
    'icon-allow-overlap': true,
  },
} as LayerProps;

// the one highlighted stop shown while tracking / previewing (own source)
export const selStopHaloLayer = {
  id: 'selstop-halo',
  type: 'circle',
  paint: {
    'circle-color': 'rgba(37,99,235,0.25)',
    'circle-radius': 14,            // animated by the engine
    'circle-stroke-color': '#2563eb',
    'circle-stroke-width': 2,
  },
} as LayerProps;

export const selStopPinLayer = {
  id: 'selstop-pin',
  type: 'symbol',
  layout: {
    'icon-image': 'stop',
    'icon-size': 0.95,
    'icon-anchor': 'bottom',
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
export const vehicleLayer = {
  id: 'vehicles',
  type: 'symbol',
  layout: {
    'icon-image': ['get', 'img'],
    'icon-size': 0.8,
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
    'text-anchor': 'bottom',
    'text-offset': [0, -1.3],
    'text-allow-overlap': false,
  },
  paint: {
    'text-color': '#dc2626',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.5,
  },
} as LayerProps;
