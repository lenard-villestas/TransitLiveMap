// Tunable constants + the vehicle-icon table + the basemap style URL.
// Ported from the Leaflet app's config.js (Phase 7).

export const API = '';                     // same-origin; the Vite dev proxy forwards /api → :8000
export const REFRESH_MS = 15000;           // how often we re-poll /api/vehicles

export const CLUSTER_MAX_ZOOM = 15;        // (legacy) kept for reference; clustering removed for the clean look
export const STOP_MINZOOM = 14;            // stops (pins) only appear at/above this zoom (declutter; tunable)
export const VEH_OVERVIEW_FRACTION = 0.18; // fraction of vehicles shown when zoomed out (activity overview)
export const VEH_ALL_ZOOM = 13;            // at/above this zoom, ALL vehicles show (below: just the sample)
export const LABEL_ZOOM = 16;              // route-number labels appear at/above this zoom
export const DUE_M = 50;                    // tracked bus within this many m (along route) → "due"
export const DEPART_M = 20;                 // ...and "departed" once it's this far PAST the stop
export const OFFROAD_M = 50;                // GPS fix farther than this from its shape → straight-lerp fallback
export const MAX_SPEED_MPS = 30;            // ~108 km/h: cap on plausible along-route travel between fixes
export const JUMP_SLACK_M = 250;            // extra slack added to the constrained-projection search window
export const RETURN_ZOOM = 16;              // zoom used when snapping back to a stop / locating the user
export const TRACK_ZOOM = 18;               // zoom the camera snaps to when you start tracking a vehicle

// Each icon image has a "forward" direction baked in; to point it along travel
// bearing B (0=N, clockwise) we rotate by (B - forward). MapLibre's icon-rotate
// is also clockwise-from-north, so the same math the Leaflet CSS used applies.
// `image` is the MapLibre image id the vehicles layer requests. The bus id is
// 'bus-default' (NOT 'bus') so it can't collide with the basemap sprite's own
// 'bus' glyph — see ICON_FILES + the registration in MapView.
export const ICONS: Record<string, { image: string; forward: number; size: number }> = {
  bus:   { image: 'bus-default', forward: 0,   size: 0.48 },  // top-down art, nose NORTH
  train: { image: 'train',       forward: 135, size: 0.8 },   // head points south-east
};

// Images registered into the MapLibre style on load (image id → URL under /static).
// The bus id stays 'bus-default' (dodges the basemap sprite's own 'bus'); the art is
// now the 3D bus PNG (large → downscaled at registration; see ICON_MAX_W).
export const ICON_FILES: Record<string, string> = {
  'bus-default': '/static/bus_topdown.png',
  train:         '/static/train.png',
  stop:          '/static/bus-stop.png',
};

// Vehicle motion animation + icon sizing.
export const ICON_MAX_W = 72;              // downscale registered icons to this width (px) max
export const BOB_AMP_PX = 1.5;             // vertical bob amplitude while moving (px, ×icon-size)
export const BOB_PERIOD_MS = 500;          // ~2 bobs/sec
export const BOB_MIN_ZOOM = 12;            // below this zoom, vehicles stop bobbing

// Clean, minimal "Uber day" basemap: MapTiler `dataviz` (Positron-like) if a key
// is provided (VITE_MAPTILER_KEY in .env), otherwise the keyless OpenFreeMap
// `positron` style — light grey, muted roads, minimal labels, no POI icons.
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
export const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/dataviz/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/positron';

export const CALGARY_VIEW = { longitude: -114.07, latitude: 51.05, zoom: 11 };

// Basemap + data attribution (shown in the bottom-right info popover).
export const ATTRIBUTION = MAPTILER_KEY
  ? '© MapTiler · © OpenStreetMap contributors · Transit data © Calgary Open Data'
  : '© OpenStreetMap · OpenFreeMap · Transit data © Calgary Open Data';
