// Shared mutable state, as module singletons (the encapsulated stand-in for the
// globals the old inline script used). Collections are mutated in place; the
// reassignable scalars live on `app` so other modules can update them via app.x.

export const veh = {};            // vehicle_id -> render/animation state
export const vehByTrip = {};      // trip_id -> vehicle_id (rebuilt each refresh)
export const stopMarkers = new Map();   // stop_id -> L.marker (all stops, in the cluster)
export const shapesById = new Map();    // shape_id -> turf LineString ([lng,lat]) for snapping

export const app = {
  tracked: null,            // { id, tripId, stopId, arrivalEpoch, route, stopLatLng, stopName, stopDist?, following, wasNear? }
  etaCtx: { stopId: null, arrivals: [] },  // arrivals in the currently open stop popup
  etaTimer: null,           // 1 s bubble countdown interval
  lastPan: null,            // last latlng the follow-cam panned to
  hereMarker: null,         // "you are here" dot
  selectedStopMarker: null, // standalone glowing pin shown while tracking
  clusterWasOn: false,      // was the stop cluster on the map before tracking?
  routeLine: null,          // blue bus→stop polyline while tracking
  lastRouteT: 0,            // last time the blue route was trimmed (throttle)
  // vehicle-click "preview" (highlight bus + its next stop before committing to track)
  previewStopMarker: null,
  previewVehId: null,
  previewArrival: null,
  previewStopId: null,
};
