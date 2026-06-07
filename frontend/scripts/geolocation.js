// "Locate me" control + start the map on the user's position. `L` is a CDN global.
// Importing this module installs the control + handlers; call startLocate() to
// trigger the initial geolocation.

import { map } from './map.js';
import { RETURN_ZOOM } from './config.js';
import { app } from './state.js';

const LocateControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function () {
    const c = L.DomUtil.create('div', 'leaflet-bar');
    const b = L.DomUtil.create('a', 'locate-btn', c);
    b.href = '#'; b.title = 'My location'; b.innerHTML = '📍';
    L.DomEvent.on(b, 'click', L.DomEvent.stop)
      .on(b, 'click', () => map.locate({ setView: true, maxZoom: RETURN_ZOOM }));
    return c;
  }
});
map.addControl(new LocateControl());

map.on('locationfound', e => {
  if (app.hereMarker) { app.hereMarker.setLatLng(e.latlng); return; }
  app.hereMarker = L.marker(e.latlng, {
    icon: L.divIcon({ html: '<div class="here-dot"></div>', className: '', iconSize: [16, 16], iconAnchor: [8, 8] }),
    interactive: false, keyboard: false, zIndexOffset: 1000
  }).addTo(map);
});
map.on('locationerror', () => { /* denied / unavailable → keep Calgary default */ });

export function startLocate() {
  map.locate({ setView: true, maxZoom: 16 });   // start zoomed in (16) on the user, if allowed
}
