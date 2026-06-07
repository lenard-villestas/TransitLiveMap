// Entry point: wires the modules together, exposes the popup-button handlers on
// window (the popups are built as HTML strings with inline onclick=), and kicks
// off the animation loop, the network load, and the 15 s vehicle poll.

import { REFRESH_MS } from './config.js';
import { map, updateZoomCap } from './map.js';
import { loadNetwork } from './network.js';
import { refresh, animate } from './vehicles.js';
import { resumeFollow, stopTracking, trackIdx, trackVehiclePreview, pauseFollow } from './tracking.js';
import { startLocate } from './geolocation.js';

// Inline onclick handlers in string-built popup HTML + the track-bar buttons.
window.resumeFollow = resumeFollow;
window.stopTracking = stopTracking;
window.trackIdx = trackIdx;
window.trackVehiclePreview = trackVehiclePreview;

// map wiring
map.on('zoomend', updateZoomCap);
updateZoomCap();
map.on('dragstart', pauseFollow);   // user explores → pause centring, keep tracking

// go
requestAnimationFrame(animate);
startLocate();
loadNetwork();
refresh();
setInterval(refresh, REFRESH_MS);
