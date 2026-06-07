// Tunable constants + the vehicle-icon table. No side effects.

export const API = location.origin;
export const REFRESH_MS = 15000;          // how often the frontend re-polls /api/vehicles

export const DISABLE_CLUSTER_ZOOM = 16;   // at/above this zoom, stops show individually
export const DUE_M = 50;                  // tracked bus within this many m (along route, before stop) → "due"
export const DEPART_M = 20;               // ...and "departed"/exit once it's this far PAST the stop
export const OFFROAD_M = 50;              // GPS fix farther than this from its shape → straight-lerp fallback
export const RETURN_ZOOM = 16;            // zoom used when snapping back to a stop / locating the user

// Each icon image has a "forward" direction baked in; to point it along travel
// bearing B (0=N, clockwise) we rotate by (B - forward).
export const ICONS = {
  bus:   { url: '/static/bus.png',   forward: 90 },   // head points east
  train: { url: '/static/train.png', forward: 135 },  // head points south-east
};
