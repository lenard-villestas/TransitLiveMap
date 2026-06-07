// Tunable constants + the vehicle-icon table + the basemap style URL.
// Ported from the Leaflet app's config.js (Phase 7).

export const API = '';                     // same-origin; the Vite dev proxy forwards /api → :8000
export const REFRESH_MS = 15000;           // how often we re-poll /api/vehicles

export const CLUSTER_MAX_ZOOM = 15;        // at/above 16, stops show individually (cluster splits)
export const LABEL_ZOOM = 16;              // route-number labels appear at/above this zoom
export const DUE_M = 50;                    // tracked bus within this many m (along route) → "due"
export const DEPART_M = 20;                 // ...and "departed" once it's this far PAST the stop
export const OFFROAD_M = 50;                // GPS fix farther than this from its shape → straight-lerp fallback
export const MAX_SPEED_MPS = 30;            // ~108 km/h: cap on plausible along-route travel between fixes
export const JUMP_SLACK_M = 250;            // extra slack added to the constrained-projection search window
export const RETURN_ZOOM = 16;              // zoom used when snapping back to a stop / locating the user

// Each icon image has a "forward" direction baked in; to point it along travel
// bearing B (0=N, clockwise) we rotate by (B - forward). MapLibre's icon-rotate
// is also clockwise-from-north, so the same math the Leaflet CSS used applies.
// `image` is the MapLibre image id the vehicles layer requests. The bus id is
// 'bus-default' (NOT 'bus') so it can't collide with the basemap sprite's own
// 'bus' glyph — see ICON_FILES + the registration in MapView.
export const ICONS: Record<string, { image: string; forward: number }> = {
  bus:   { image: 'bus-default', forward: 90 },   // head points east
  train: { image: 'train',       forward: 135 },  // head points south-east
};

// Images registered into the MapLibre style on load (image id → URL under /static).
export const ICON_FILES: Record<string, string> = {
  'bus-default': '/static/bus-default.png',
  train:         '/static/train.png',
  stop:          '/static/bus-stop.png',
};

// MapTiler vector basemap if a key is provided (VITE_MAPTILER_KEY in .env),
// otherwise fall back to the keyless OpenFreeMap "liberty" style so the app
// still runs out of the box. Light, transit-friendly basemaps either way.
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
export const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/dataviz/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/liberty';

export const CALGARY_VIEW = { longitude: -114.07, latitude: 51.05, zoom: 11 };
