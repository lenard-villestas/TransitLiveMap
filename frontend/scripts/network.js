// Loads the static network (/api/network) once: draws route polylines, caches a
// turf line per shape_id (for snapping), and adds every stop to the cluster with a
// bind-once popup that fetches its ETA on open.

import { API } from './config.js';
import { map, shapeLayer, stopCluster } from './map.js';
import { stopMarkers, shapesById, vehByTrip, app } from './state.js';
import { stopDiv } from './icons.js';
import { esc, etaParts } from './format.js';

export async function loadNetwork() {
  const net = await (await fetch(API + '/api/network')).json();
  net.shapes.forEach(s => {
    L.polyline(s.coords, { color: s.color, weight: 1.5, opacity: 0.3 }).addTo(shapeLayer);
    // cache a turf line ([lng,lat]) per shape_id for snap-to-shape + route slicing
    if (s.shape_id && s.coords.length > 1)
      shapesById.set(s.shape_id, turf.lineString(s.coords.map(c => [c[1], c[0]])));
  });
  net.stops.forEach(s => {
    const [lat, lon, name, sid] = s;
    // Bind the popup ONCE and fill it on open — binding inside a click handler
    // double-wires Leaflet's toggle and the popup stops reopening.
    const m = L.marker([lat, lon], { icon: stopDiv(false), title: name })
      .bindPopup('<div class="eta-list eta-empty">loading…</div>');
    m.on('popupopen', () => fillStopEta(sid, name, m));
    stopMarkers.set(sid, m);
    stopCluster.addLayer(m);
  });
}

async function fillStopEta(sid, name, marker) {
  marker.setPopupContent('<div class="eta-list eta-empty">loading…</div>');
  try {
    const data = await (await fetch(API + '/api/stop/' + encodeURIComponent(sid) + '/eta')).json();
    marker.setPopupContent(renderEtaPopup(name, data));
  } catch (e) {
    marker.setPopupContent('<div class="eta-list eta-empty">ETA unavailable</div>');
  }
}

// Build the stop popup: title + up to 3 arrival rows. The Track button calls
// window.trackIdx(i) (wired in main) so this module needn't import tracking.
export function renderEtaPopup(name, data) {
  app.etaCtx = { stopId: data.stop_id, arrivals: data.arrivals || [] };
  const head = '<div class="eta-title">' + esc(name) + '</div>';
  if (!app.etaCtx.arrivals.length)
    return '<div class="eta-list">' + head + '<div class="eta-empty">No upcoming arrivals.</div></div>';
  const rows = app.etaCtx.arrivals.map((a, i) => {
    const live = vehByTrip[a.trip_id];   // is the serving bus reporting live?
    const btn = '<button class="eta-track" onclick="trackIdx(' + i + ')"' +
      (live ? '' : ' disabled title="vehicle not live yet"') + '>track</button>';
    const e = etaParts(a.eta_seconds);
    return '<div class="eta-row' + (i === 0 ? ' eta-soon' : '') + '">' +
      '<span class="eta-badge" style="background:' + esc(a.color) + '">' + esc(a.route) + '</span>' +
      '<span class="eta-head" title="' + esc(a.headsign) + '">' + esc(a.headsign) + '</span>' +
      '<span class="eta-min' + (e.late ? ' late' : '') + '">' + e.text + '</span>' + btn + '</div>';
  }).join('');
  return '<div class="eta-list">' + head + rows + '</div>';
}
