// Vehicle rendering + the requestAnimationFrame engine: creates/updates markers
// from /api/vehicles, snaps motion to the route shape (or straight-line fallback),
// runs the 60 fps animation loop, and the vehicle-click → next-stop preview.
//
// Imports a few functions from tracking.js; the vehicles↔tracking cycle is fine
// because every cross-call happens inside a function (runtime), never at load.

import { API, REFRESH_MS, ICONS, OFFROAD_M } from './config.js';
import { map } from './map.js';
import { veh, vehByTrip, stopMarkers, shapesById, app } from './state.js';
import { kindFor, makeIcon, stopDiv } from './icons.js';
import { bearingDeg, projectOnLine, pointAt, shapeBearing, lerp } from './geometry.js';
import { esc, etaParts } from './format.js';
import { untrack, refreshTrackedEta, drawTrackedRoute, clearPreview } from './tracking.js';

export function wrapperOf(id) {
  const el = veh[id] && veh[id].marker.getElement();
  return el ? el.querySelector('.veh-icon') : null;
}

function setRotation(v) {
  const el = v.marker.getElement();
  if (!el) return;
  const img = el.querySelector('img');
  if (img) img.style.transform = 'rotate(' + (v.bearing - v.forward) + 'deg)';
}

// Aim a vehicle at its new GPS fix. If it sits on its route shape, interpolate
// ALONG the polyline (rides the road); otherwise straight-line lerp (fallback).
function setTarget(v, lat, lon, now) {
  const cur = v.marker.getLatLng();
  v.toLatRaw = lat; v.toLonRaw = lon;
  const line = v.shapeId ? shapesById.get(v.shapeId) : null;
  let snapped = false;
  if (line) {
    const to = projectOnLine(line, lat, lon);
    if (to.offM <= OFFROAD_M) {                   // on/near its route → snap
      const from = projectOnLine(line, cur.lat, cur.lng);
      v.mode = 'shape'; v.line = line;
      v.fromDist = from.dist; v.toDist = to.dist; v.curDist = from.dist;
      v.bearing = shapeBearing(line, from.dist, to.dist);
      snapped = true;
    }
  }
  if (!snapped) {                                 // off-route / no shape → straight
    v.mode = 'line';
    v.bearing = bearingDeg(cur.lat, cur.lng, lat, lon);
    v.fromLat = cur.lat; v.fromLon = cur.lng; v.toLat = lat; v.toLon = lon;
  }
  setRotation(v);
  v.dur = v.lastMove ? Math.min(Math.max(now - v.lastMove, 12000), 40000) : REFRESH_MS;
  v.startT = now; v.lastMove = now; v.settled = false;
}

// hide every vehicle except the tracked one while tracking; restore otherwise
export function applyVehicleVisibility() {
  for (const id in veh) {
    const show = !app.tracked || id === app.tracked.id;
    const onMap = map.hasLayer(veh[id].marker);
    if (show && !onMap) veh[id].marker.addTo(map);
    else if (!show && onMap) map.removeLayer(veh[id].marker);
  }
}

export function animate() {
  const now = performance.now();
  for (const id in veh) {
    const v = veh[id];
    if (v.settled) continue;
    const t = v.dur ? Math.min((now - v.startT) / v.dur, 1) : 1;
    if (v.mode === 'shape' && v.line) {
      const d = lerp(v.fromDist, v.toDist, t);
      v.curDist = d;
      const p = pointAt(v.line, d);
      v.marker.setLatLng([p.lat, p.lon]);
    } else {
      v.marker.setLatLng([lerp(v.fromLat, v.toLat, t), lerp(v.fromLon, v.toLon, t)]);
    }
    if (t >= 1) v.settled = true;
  }
  // follow-cam: keep the tracked bus centred, every frame (the stop cluster is
  // removed while tracking, so per-frame panning is cheap — no 5 Hz lurch)
  if (app.tracked && app.tracked.following && veh[app.tracked.id]) {
    const ll = veh[app.tracked.id].marker.getLatLng();
    if (!app.lastPan || app.lastPan.lat !== ll.lat || app.lastPan.lng !== ll.lng) {
      map.panTo(ll, { animate: false, noMoveStart: true });
      app.lastPan = ll;
    }
  }
  // trim the blue route to the bus's current position (throttled ~8 Hz)
  if (app.tracked && now - app.lastRouteT > 120) { drawTrackedRoute(); app.lastRouteT = now; }
  requestAnimationFrame(animate);
}

export async function refresh() {
  try {
    const data = await (await fetch(API + '/api/vehicles')).json();
    const seen = new Set();
    const now = performance.now();
    for (const k in vehByTrip) delete vehByTrip[k];   // rebuilt below

    data.vehicles.forEach(arr => {
      const [lat, lon, short, color, head, id, type, tripId, shapeId] = arr;
      seen.add(id);
      if (tripId) vehByTrip[tripId] = id;
      const kind = kindFor(type);
      let v = veh[id];

      if (!v) {
        const marker = L.marker([lat, lon], { icon: makeIcon(kind, short) })
          .on('click', () => openVehicleNext(id));      // → next stop + Track preview
        if (!app.tracked || id === app.tracked.id) marker.addTo(map);   // visibility gate
        veh[id] = {
          marker, forward: ICONS[kind].forward, bearing: ICONS[kind].forward,
          shapeId: shapeId || null, tripId: tripId || null, short, type, head, mode: 'line',
          fromLat: lat, fromLon: lon, toLat: lat, toLon: lon, toLatRaw: lat, toLonRaw: lon,
          startT: now, dur: REFRESH_MS, settled: true
        };
      } else {
        if (shapeId) v.shapeId = shapeId;
        if (tripId) v.tripId = tripId;
        if (lat !== v.toLatRaw || lon !== v.toLonRaw) setTarget(v, lat, lon, now);
      }
    });

    for (const id in veh) {
      if (!seen.has(id)) {
        if (app.tracked && app.tracked.id === id) untrack(true);   // tracked bus left the feed
        map.removeLayer(veh[id].marker); delete veh[id];
      }
    }

    applyVehicleVisibility();           // keep only the tracked bus while tracking
    if (app.tracked) { refreshTrackedEta(); drawTrackedRoute(); }   // ETA + blue route

    document.getElementById('cap').textContent =
      data.vehicles.length + ' vehicles · snapshot ' + data.age +
      's old · refreshed ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('cap').textContent = 'fetch error: ' + e;
  }
}

// --- click a vehicle → its next stop + Track ------------------------------
function basicVehiclePopup(v) {
  L.popup({ offset: [0, -14] }).setLatLng(v.marker.getLatLng()).setContent(
    '<b>Route ' + esc(v.short) + '</b> (' + esc(v.type) + ')<br>' +
    (v.head ? 'to ' + esc(v.head) + '<br>' : '') + 'next stop unknown').openOn(map);
}

async function openVehicleNext(id) {
  clearPreview();
  const v = veh[id];
  if (!v) return;
  if (!v.tripId) { basicVehiclePopup(v); return; }
  let data;
  try {
    data = await (await fetch(API + '/api/trip/' + encodeURIComponent(v.tripId) + '/next-stop')).json();
  } catch (e) { basicVehiclePopup(v); return; }
  const sm = data && data.stop_id ? stopMarkers.get(data.stop_id) : null;
  if (!sm) { basicVehiclePopup(v); return; }
  const stopLatLng = sm.getLatLng();
  const stopName = sm.options.title || 'Stop';
  // preview-highlight: glow the bus + a standalone glowing pin at the next stop
  app.previewVehId = id;
  const w = wrapperOf(id); if (w) w.classList.add('tracked');
  app.previewStopMarker = L.marker(stopLatLng, { icon: stopDiv(true), interactive: false, keyboard: false }).addTo(map);
  app.previewArrival = { trip_id: v.tripId, arrival: data.arrival, route: data.route };
  app.previewStopId = data.stop_id;
  const e = etaParts(data.eta_seconds);
  const html = '<div class="eta-list"><div class="eta-title">' + esc(stopName) + '</div>' +
    '<div class="eta-row"><span class="eta-badge" style="background:#2563eb">' + esc(data.route) + '</span>' +
    '<span class="eta-head" title="' + esc(data.headsign) + '">' + esc(data.headsign) + '</span>' +
    '<span class="eta-min' + (e.late ? ' late' : '') + '">' + e.text + '</span>' +
    '<button class="eta-track" onclick="trackVehiclePreview()">track</button></div></div>';
  L.popup({ offset: [0, -30] }).setLatLng(stopLatLng).setContent(html).openOn(map)
    .on('remove', clearPreview);   // closing without tracking drops the highlights
}
