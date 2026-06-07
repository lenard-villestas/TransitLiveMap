// Leaflet divIcon builders. `L` is a global from the CDN <script>.

import { ICONS } from './config.js';
import { esc } from './format.js';

export function kindFor(type) {
  return /tram|lrt|rail|subway/i.test(type) ? 'train' : 'bus';
}

export function makeIcon(kind, short) {
  // route label is a sibling of <img> (only the img gets the rotation transform),
  // so it stays upright; hidden by CSS unless body.veh-labels (zoom ≥ 16).
  return L.divIcon({
    html: '<div class="veh-icon"><img src="' + ICONS[kind].url + '">' +
          '<span class="veh-route">' + esc(short) + '</span></div>',
    className: '', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14]
  });
}

// bus-stop.png is a downward map-pin → anchor at the bottom tip. divIcon (not
// L.icon) so we can toggle a .selected class to glow the tracked bus's stop.
export function stopDiv(selected) {
  return L.divIcon({
    html: '<div class="stop-icon' + (selected ? ' selected' : '') + '"><img src="/static/bus-stop.png"></div>',
    className: '', iconSize: [30, 38], iconAnchor: [15, 38], popupAnchor: [0, -34]
  });
}
