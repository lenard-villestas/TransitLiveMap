// Geometry helpers. `turf` is a global from the CDN <script>.
// turf uses [lng, lat]; our app data is [lat, lon] — convert at the boundary.

export const lerp = (a, b, t) => a + (b - a) * t;

// planar bearing approx (fine for short hops); 0 = N, clockwise.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const dy = lat2 - lat1;
  const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

const KM = 1000;

// km along `line` of the point nearest [lat,lon] + how far off the line it is (m).
export function projectOnLine(line, lat, lon) {
  const snap = turf.nearestPointOnLine(line, turf.point([lon, lat]), { units: 'kilometers' });
  return { dist: snap.properties.location, offM: snap.properties.dist * KM };
}

export function pointAt(line, distKm) {
  const c = turf.along(line, distKm, { units: 'kilometers' }).geometry.coordinates;
  return { lat: c[1], lon: c[0] };
}

export function shapeBearing(line, fromDist, toDist) {
  const a = pointAt(line, fromDist);
  const b = (Math.abs(toDist - fromDist) < 1e-4)
    ? pointAt(line, fromDist + (toDist >= fromDist ? 0.01 : -0.01))
    : pointAt(line, toDist);
  return bearingDeg(a.lat, a.lon, b.lat, b.lon);
}
