// Per-bus tracking: follow-cam, flashing marker, anchored ETA/Late bubble + track
// bar, the blue bus→stop route, and the vehicle-click preview. `L`/`turf` are CDN
// globals. Imports wrapperOf/applyVehicleVisibility from vehicles (safe cycle).

import { API, DUE_M, DEPART_M, OFFROAD_M, RETURN_ZOOM } from './config.js';
import { map, stopCluster } from './map.js';
import { veh, vehByTrip, stopMarkers, shapesById, app } from './state.js';
import { esc, etaPhrase } from './format.js';
import { projectOnLine } from './geometry.js';
import { stopDiv } from './icons.js';
import { wrapperOf, applyVehicleVisibility } from './vehicles.js';

// Status for the tracked bus. "due"/"departed" are gated on real proximity (along
// the route when possible), not the drifty predicted-arrival clock.
function trackedBubble() {
  const t = app.tracked;
  const v = t && veh[t.id];
  const secs = t ? t.arrivalEpoch - Date.now() / 1000 : 0;
  let rem = null, dist = null;
  if (v) {
    if (t.stopDist != null && v.mode === 'shape' && v.curDist != null) {
      rem = (t.stopDist - v.curDist) * 1000;   // metres remaining along the route
      dist = Math.abs(rem);
    } else if (t.stopLatLng) {
      dist = v.marker.getLatLng().distanceTo(t.stopLatLng);
    }
  }
  // due window: along-route, from DUE_M before the stop to DEPART_M past it
  const due = rem != null ? (rem <= DUE_M && rem >= -DEPART_M) : (dist != null && dist <= DUE_M);
  if (due) { t.wasNear = true; return { state: 'due', text: 'due', late: false, dist, rem }; }
  const departed = t.wasNear &&
    ((rem != null && rem < -DEPART_M) || (rem == null && dist != null && dist > DEPART_M));
  if (departed) return { state: 'departed', text: 'departed', late: false, dist, rem };
  const p = etaPhrase(secs);   // ETA: N minutes, or Late: N minutes (counting up)
  return { state: p.late ? 'late' : 'eta', text: p.text, late: p.late, dist, rem };
}

// bubble HTML: target stop name on top, labeled timer below (red when late)
function bubbleHTML(b) {
  const nm = esc(app.tracked.stopName || '');
  return '<div class="bub-stop" title="' + nm + '">' + nm + '</div>' +
    '<div class="bub-time' + (b.late ? ' late' : '') + '">' + b.text + '</div>';
}

export function track(a, stopId) {
  untrack();                                // clear any previous target
  const id = vehByTrip[a.trip_id];
  if (!id || !veh[id]) return;              // bus not reporting live → can't follow
  const sm = stopMarkers.get(stopId);
  const stopLatLng = sm ? sm.getLatLng() : null;
  app.tracked = {
    // arrivalEpoch is the FIXED anchor for ETA/Late — captured now, never re-based
    // by later feed predictions (see refreshTrackedEta).
    id, tripId: a.trip_id, stopId, arrivalEpoch: a.arrival, route: a.route,
    stopLatLng, stopName: sm ? (sm.options.title || '') : '', following: true
  };
  // project the stop onto the bus's shape once → its along-route distance, so the
  // ETA can measure remaining distance ALONG the road (reaches ~0 at the stop).
  const line = veh[id].shapeId ? shapesById.get(veh[id].shapeId) : null;
  if (line && stopLatLng) {
    const sp = projectOnLine(line, stopLatLng.lat, stopLatLng.lng);
    if (sp.offM <= OFFROAD_M) { app.tracked.stopDist = sp.dist; }   // stop is on this shape
  }
  app.lastPan = null;
  // declutter: hide all other stops, show only this one as a standalone glowing pin
  app.clusterWasOn = map.hasLayer(stopCluster);
  if (app.clusterWasOn) map.removeLayer(stopCluster);
  if (app.tracked.stopLatLng) {
    app.selectedStopMarker = L.marker(app.tracked.stopLatLng, {
      icon: stopDiv(true), interactive: false, keyboard: false
    }).addTo(map);
  }
  const w = wrapperOf(id);
  if (w) w.classList.add('tracked');
  veh[id].marker.bindTooltip(bubbleHTML(trackedBubble()),
    { permanent: true, direction: 'top', offset: [0, -18], className: 'eta-bubble' }).openTooltip();
  map.closePopup();
  applyVehicleVisibility();                 // hide every other bus
  drawTrackedRoute();                       // blue path from the bus to the stop
  app.etaTimer = setInterval(updateBubble, 1000);
  updateTrackBar();
}

function clearTrackedRoute() {
  if (app.routeLine) { map.removeLayer(app.routeLine); app.routeLine = null; }
}

// Trim the blue route from the bus's CURRENT along-route position to the stop and
// update the polyline in place (called from the render loop so the tail follows
// the gliding bus instead of lagging the 15 s data refresh).
export function drawTrackedRoute() {
  const t = app.tracked;
  const v = t && veh[t.id];
  if (!v || t.stopDist == null) { clearTrackedRoute(); return; }
  const line = v.shapeId ? shapesById.get(v.shapeId) : null;
  if (!line) { clearTrackedRoute(); return; }
  const ll = v.marker.getLatLng();
  const from = (v.mode === 'shape' && v.curDist != null)
    ? v.curDist : projectOnLine(line, ll.lat, ll.lng).dist;
  if (from >= t.stopDist) { clearTrackedRoute(); return; }   // reached/passed stop
  try {
    const slice = turf.lineSliceAlong(line, from, t.stopDist, { units: 'kilometers' });
    const latlngs = slice.geometry.coordinates.map(c => [c[1], c[0]]);
    if (latlngs.length < 2) { clearTrackedRoute(); return; }
    if (app.routeLine) app.routeLine.setLatLngs(latlngs);
    else app.routeLine = L.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(map);
  } catch (e) { /* degenerate slice → leave last line */ }
}

// Full teardown. snapBack=true flies the camera back to the selected stop.
export function untrack(snapBack) {
  if (app.etaTimer) { clearInterval(app.etaTimer); app.etaTimer = null; }
  if (app.selectedStopMarker) { map.removeLayer(app.selectedStopMarker); app.selectedStopMarker = null; }
  if (app.clusterWasOn && !map.hasLayer(stopCluster)) map.addLayer(stopCluster);
  app.clusterWasOn = false;
  clearTrackedRoute();
  if (app.tracked) {
    if (veh[app.tracked.id]) {
      veh[app.tracked.id].marker.unbindTooltip();
      const w = wrapperOf(app.tracked.id);
      if (w) w.classList.remove('tracked');
    }
    if (snapBack && app.tracked.stopLatLng)
      map.setView(app.tracked.stopLatLng, Math.max(map.getZoom(), RETURN_ZOOM));
  }
  app.tracked = null;
  applyVehicleVisibility();                 // bring all the other buses back
  updateTrackBar();
}

// User dragged away → stop centring but keep the bus tracked (Follow resumes).
export function pauseFollow() {
  if (app.tracked && app.tracked.following) { app.tracked.following = false; updateTrackBar(); }
}
export function resumeFollow() {
  if (app.tracked) { app.tracked.following = true; app.lastPan = null; updateTrackBar(); }
}
export function stopTracking() { untrack(true); }   // the trackbar "stop" button

function updateBubble() {
  if (!app.tracked || !veh[app.tracked.id]) { untrack(true); return; }
  // re-assert the flash class — the marker's DOM is recreated on zoom and doesn't
  // exist until follow-cam pans an off-screen bus into view.
  const w = wrapperOf(app.tracked.id);
  if (w && !w.classList.contains('tracked')) w.classList.add('tracked');
  const b = trackedBubble();
  veh[app.tracked.id].marker.setTooltipContent(bubbleHTML(b));
  updateTrackBar(b);
  if (b.state === 'departed') setTimeout(() => untrack(true), 1500);
}

export async function refreshTrackedEta() {
  try {
    const data = await (await fetch(API + '/api/stop/' +
      encodeURIComponent(app.tracked.stopId) + '/eta')).json();
    // We do NOT re-base tracked.arrivalEpoch — it stays the prediction captured at
    // track start, so ETA counts down to it and "Late" counts up past it (anchored).
    const a = (data.arrivals || []).find(x => x.trip_id === app.tracked.tripId);
    if (!a) {                                 // trip dropped from feed (< now-30s)
      const b = trackedBubble();              // gone only if it has PASSED the stop
      const gone = b.rem != null ? b.rem < -DEPART_M : (b.dist != null && b.dist > DEPART_M);
      if (gone) {
        if (veh[app.tracked.id]) veh[app.tracked.id].marker.setTooltipContent('departed');
        setTimeout(() => untrack(true), 1500);
      }
      // else: late-but-still-approaching bus — keep counting up; arrives → "due"
    }
  } catch (e) { /* keep last known ETA on a transient error */ }
}

function updateTrackBar(b) {
  const bar = document.getElementById('trackbar');
  if (!app.tracked) { bar.style.display = 'none'; return; }
  b = b || trackedBubble();
  const nm = esc(app.tracked.stopName || '');
  const distTxt = b.dist != null ? ' · ' + Math.round(b.dist) + ' m' : '';
  document.getElementById('trackinfo').innerHTML =
    '<div class="tb-stop" title="' + nm + '">' + nm + '</div>' +
    '<div class="tb-time' + (b.late ? ' late' : '') + '">Route ' + esc(app.tracked.route) +
    ' · ' + b.text + distTxt + '</div>';
  document.getElementById('followbtn').style.display =
    app.tracked.following ? 'none' : 'inline-block';
  bar.style.display = 'flex';
}

// --- preview helpers + the popup Track handlers ---------------------------
export function clearPreview() {
  if (app.previewStopMarker) { map.removeLayer(app.previewStopMarker); app.previewStopMarker = null; }
  if (app.previewVehId && veh[app.previewVehId] && (!app.tracked || app.tracked.id !== app.previewVehId)) {
    const w = wrapperOf(app.previewVehId);
    if (w) w.classList.remove('tracked');
  }
  app.previewVehId = null; app.previewArrival = null; app.previewStopId = null;
}

// called from the stop popup's Track button (window.trackIdx, wired in main)
export function trackIdx(i) {
  const a = app.etaCtx.arrivals[i];
  if (a) track(a, app.etaCtx.stopId);
}

// called from the vehicle-click preview popup's Track button (window.trackVehiclePreview)
export function trackVehiclePreview() {
  const a = app.previewArrival, sid = app.previewStopId;
  clearPreview();
  if (a && sid) track(a, sid);
}
