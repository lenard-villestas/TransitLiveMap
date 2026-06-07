// Geometry helpers, ported from geometry.js. Turf is now an npm import (typed).
// Turf uses [lng, lat]; we keep route lines in [lng, lat] from the start.

import * as turf from '@turf/turf';
import type { Feature, LineString } from 'geojson';

export type TurfLine = Feature<LineString>;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// planar bearing approx (fine for short hops); 0 = N, clockwise.
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = lat2 - lat1;
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

const KM = 1000;

// km along `line` of the point nearest [lat,lon] + how far off the line it is (m).
export function projectOnLine(line: TurfLine, lat: number, lon: number) {
  const snap = turf.nearestPointOnLine(line, turf.point([lon, lat]), { units: 'kilometers' });
  return { dist: snap.properties.location as number, offM: (snap.properties.dist as number) * KM };
}

export function pointAt(line: TurfLine, distKm: number) {
  const c = turf.along(line, distKm, { units: 'kilometers' }).geometry.coordinates;
  return { lat: c[1], lon: c[0] };
}

export function lineLengthKm(line: TurfLine): number {
  return turf.length(line, { units: 'kilometers' });
}

// Project [lat,lon] onto only the window of `line` within ±windowKm of `nearKm`
// (the vehicle's current along-distance). This defeats the linear-referencing
// ambiguity on self-overlapping shapes: the *near* pass is the only candidate, so
// the projection can't flip to a far-away segment that shares the same ground.
// nearKm == null (no prior position) → fall back to a whole-line projection.
export function projectNear(
  line: TurfLine, lat: number, lon: number,
  nearKm: number | null, windowKm: number, lenKm: number,
): { dist: number; offM: number } {
  if (nearKm == null || windowKm >= lenKm) return projectOnLine(line, lat, lon);
  const startKm = Math.max(0, nearKm - windowKm);
  const endKm = Math.min(lenKm, nearKm + windowKm);
  if (endKm - startKm < 1e-4) return projectOnLine(line, lat, lon);
  const slice = turf.lineSliceAlong(line, startKm, endKm, { units: 'kilometers' }) as TurfLine;
  const local = projectOnLine(slice, lat, lon);
  return { dist: startKm + local.dist, offM: local.offM };
}

export function shapeBearing(line: TurfLine, fromDist: number, toDist: number): number {
  const a = pointAt(line, fromDist);
  const b = (Math.abs(toDist - fromDist) < 1e-4)
    ? pointAt(line, fromDist + (toDist >= fromDist ? 0.01 : -0.01))
    : pointAt(line, toDist);
  return bearingDeg(a.lat, a.lon, b.lat, b.lon);
}

// Haversine distance in metres (replaces Leaflet's latlng.distanceTo).
export function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
