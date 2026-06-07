// Loads the static network (/api/network) once and turns it into GeoJSON sources:
//  - shapesFC: route polylines (line layer)         + shapesById turf lines for snapping
//  - stopsFC:  all ~6000 stops (clustered source)   + stopById lookup for tracking
// Replaces network.js; the per-stop Leaflet markers are gone (MapLibre draws the
// whole stops source on the GPU, so no marker-cluster plugin and no perf cliff).

import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { API } from '../config';
import type { NetworkResponse } from '../types';
import type { TurfLine } from './geometry';

export const shapesById = new Map<string, TurfLine>();
export const stopById = new Map<string, { lng: number; lat: number; name: string }>();

export interface NetworkGeo {
  shapesFC: FeatureCollection<LineString>;
  stopsFC: FeatureCollection<Point>;
}

export async function loadNetwork(): Promise<NetworkGeo> {
  const net = (await (await fetch(API + '/api/network')).json()) as NetworkResponse;

  const shapeFeatures: Feature<LineString>[] = [];
  net.shapes.forEach((s) => {
    if (!s.coords || s.coords.length < 2) return;
    const lngLat = s.coords.map((c) => [c[1], c[0]] as [number, number]);
    shapeFeatures.push({
      type: 'Feature',
      properties: { color: s.color || '#888888' },
      geometry: { type: 'LineString', coordinates: lngLat },
    });
    // cache a turf line ([lng,lat]) per shape_id for snap-to-shape + route slicing
    if (s.shape_id) shapesById.set(s.shape_id, turf.lineString(lngLat));
  });

  const stopFeatures: Feature<Point>[] = net.stops.map(([lat, lon, name, sid]) => {
    stopById.set(sid, { lng: lon, lat, name });
    return {
      type: 'Feature',
      properties: { name, stop_id: sid },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    };
  });

  return {
    shapesFC: { type: 'FeatureCollection', features: shapeFeatures },
    stopsFC: { type: 'FeatureCollection', features: stopFeatures },
  };
}
