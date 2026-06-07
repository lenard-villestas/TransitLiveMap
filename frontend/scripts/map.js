// Creates the Leaflet map, basemap, route-shape layer, and the stop marker-cluster.
// `L` is a global from the CDN <script>. Importing this module builds the map
// (side effect) — the #map div must already exist (module scripts are deferred).

import { DISABLE_CLUSTER_ZOOM } from './config.js';

export const map = L.map('map').setView([51.05, -114.07], 11);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO'
}).addTo(map);

export const shapeLayer = L.layerGroup().addTo(map);

// stops clustered into themed red counted badges (replaces the old zoom-gate)
export const stopCluster = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 60,
  disableClusteringAtZoom: DISABLE_CLUSTER_ZOOM,   // tune to taste (watch #zoomcap)
  iconCreateFunction: cluster => {
    const n = cluster.getChildCount();
    const size = n < 10 ? 'sm' : n < 100 ? 'md' : 'lg';
    const px = size === 'lg' ? 50 : size === 'md' ? 40 : 32;
    return L.divIcon({
      html: '<div class="stop-cluster ' + size + '"><span>' + n + '</span></div>',
      className: '', iconSize: [px, px]   // square → anchor centres on the point
    });
  }
});
map.addLayer(stopCluster);                          // stops shown (clustered) by default
L.control.layers(null, { 'Route shapes': shapeLayer, 'Stops': stopCluster }).addTo(map);

// live zoom readout + toggle the body class that reveals route labels at zoom ≥ 16
export function updateZoomCap() {
  const z = map.getZoom();
  document.getElementById('zoomcap').textContent =
    'zoom ' + z + ' · cluster < ' + DISABLE_CLUSTER_ZOOM;
  document.body.classList.toggle('veh-labels', z >= 16);
}
