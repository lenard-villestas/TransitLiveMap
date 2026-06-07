// The imperative core — ported from vehicles.js (the rAF snap-to-shape engine)
// and tracking.js (follow-cam, blue route, anchored ETA/Late bubble, preview).
//
// This deliberately lives OUTSIDE React render. It owns a Map<id, VehState> and,
// every animation frame, writes a GeoJSON FeatureCollection into the MapLibre
// "vehicles" source (instead of moving N DOM markers). Reactive chrome (caption,
// track bar, bubble text) is pushed into the zustand store at 1–5 Hz, never 60 Hz.

import * as turf from '@turf/turf';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import {
  REFRESH_MS, ICONS, OFFROAD_M, DUE_M, DEPART_M, RETURN_ZOOM, API,
} from '../config';
import type { VehiclesResponse, EtaArrival, StopEtaResponse, NextStopResponse } from '../types';
import { shapesById, stopById } from './network';
import {
  lerp, bearingDeg, projectOnLine, pointAt, shapeBearing, distM, type TurfLine,
} from './geometry';
import { etaPhrase } from './format';
import { useStore } from '../store';

const kindFor = (type: string) => (/tram|lrt|rail|subway/i.test(type) ? 'train' : 'bus');

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

interface VehState {
  id: string; short: string; type: string; head: string;
  kind: string; forward: number;
  shapeId: string | null; tripId: string | null;
  lng: number; lat: number;                 // current displayed position
  mode: 'shape' | 'line';
  line: TurfLine | null;
  fromDist: number; toDist: number; curDist: number | null;
  fromLat: number; fromLon: number; toLat: number; toLon: number;
  toLatRaw: number; toLonRaw: number;
  bearing: number; startT: number; dur: number; lastMove: number; settled: boolean;
}

interface Tracked {
  id: string; tripId: string; stopId: string; arrivalEpoch: number; route: string;
  stopLng?: number; stopLat?: number; stopName: string;
  stopDist?: number; following: boolean; wasNear: boolean;
}

interface PreviewArrival { trip_id: string; arrival: number; route: string; }

interface Bubble { state: string; text: string; late: boolean; dist: number | null; rem: number | null; }

class Engine {
  map: MlMap | null = null;
  veh = new Map<string, VehState>();
  vehByTrip: Record<string, string> = {};
  tracked: Tracked | null = null;

  private raf = 0;
  private lastPan: [number, number] | null = null;
  private lastRouteT = 0;
  private lastBubbleT = 0;
  private lastPosT = 0;
  private departing = false;
  private selStopActive = false;
  private vehHaloActive = false;

  // vehicle-click preview (highlight bus + its next stop before committing to track)
  previewVehId: string | null = null;
  previewArrival: PreviewArrival | null = null;
  previewStopId: string | null = null;

  private store() { return useStore.getState(); }
  private src(id: string) { return this.map?.getSource(id) as GeoJSONSource | undefined; }

  attach(map: MlMap) {
    this.map = map;
    this.raf = requestAnimationFrame(this.frame);
  }
  detach() { cancelAnimationFrame(this.raf); this.map = null; }

  // ---- data poll → per-vehicle state -------------------------------------
  refresh(data: VehiclesResponse) {
    const seen = new Set<string>();
    const now = performance.now();
    this.vehByTrip = {};

    for (const arr of data.vehicles) {
      const [lat, lon, short, color, head, id, type, tripId, shapeId] = arr;
      void color;
      seen.add(id);
      if (tripId) this.vehByTrip[tripId] = id;
      const kind = kindFor(type);
      const v = this.veh.get(id);
      if (!v) {
        this.veh.set(id, {
          id, short, type, head, kind, forward: ICONS[kind].forward,
          shapeId: shapeId || null, tripId: tripId || null,
          lng: lon, lat, mode: 'line', line: null,
          fromDist: 0, toDist: 0, curDist: null,
          fromLat: lat, fromLon: lon, toLat: lat, toLon: lon, toLatRaw: lat, toLonRaw: lon,
          bearing: ICONS[kind].forward, startT: now, dur: REFRESH_MS, lastMove: 0, settled: true,
        });
      } else {
        if (shapeId) v.shapeId = shapeId;
        if (tripId) v.tripId = tripId;
        if (lat !== v.toLatRaw || lon !== v.toLonRaw) this.setTarget(v, lat, lon, now);
      }
    }

    for (const id of [...this.veh.keys()]) {
      if (!seen.has(id)) {
        if (this.tracked && this.tracked.id === id) this.untrack(true);
        this.veh.delete(id);
      }
    }

    if (this.tracked) { this.refreshTrackedEta(); this.drawTrackedRoute(); }

    this.store().set({
      caption: `${data.vehicles.length} vehicles · snapshot ${data.age}s old · refreshed ${new Date().toLocaleTimeString()}`,
    });
    this.pushVehicles();
  }

  // Aim a vehicle at its new GPS fix: snap ALONG its shape if it's on it, else lerp.
  private setTarget(v: VehState, lat: number, lon: number, now: number) {
    v.toLatRaw = lat; v.toLonRaw = lon;
    const line = v.shapeId ? shapesById.get(v.shapeId) ?? null : null;
    let snapped = false;
    if (line) {
      const to = projectOnLine(line, lat, lon);
      if (to.offM <= OFFROAD_M) {
        const from = projectOnLine(line, v.lat, v.lng);
        v.mode = 'shape'; v.line = line;
        v.fromDist = from.dist; v.toDist = to.dist; v.curDist = from.dist;
        v.bearing = shapeBearing(line, from.dist, to.dist);
        snapped = true;
      }
    }
    if (!snapped) {
      v.mode = 'line';
      v.bearing = bearingDeg(v.lat, v.lng, lat, lon);
      v.fromLat = v.lat; v.fromLon = v.lng; v.toLat = lat; v.toLon = lon;
    }
    v.dur = v.lastMove ? Math.min(Math.max(now - v.lastMove, 12000), 40000) : REFRESH_MS;
    v.startT = now; v.lastMove = now; v.settled = false;
  }

  // ---- 60 fps render loop -------------------------------------------------
  private frame = () => {
    const now = performance.now();
    for (const v of this.veh.values()) {
      if (v.settled) continue;
      const t = v.dur ? Math.min((now - v.startT) / v.dur, 1) : 1;
      if (v.mode === 'shape' && v.line) {
        const d = lerp(v.fromDist, v.toDist, t);
        v.curDist = d;
        const p = pointAt(v.line, d);
        v.lng = p.lon; v.lat = p.lat;
      } else {
        v.lat = lerp(v.fromLat, v.toLat, t);
        v.lng = lerp(v.fromLon, v.toLon, t);
      }
      if (t >= 1) v.settled = true;
    }
    this.pushVehicles();

    const t = this.tracked;
    if (t && t.following && this.veh.has(t.id)) {
      const v = this.veh.get(t.id)!;
      if (!this.lastPan || this.lastPan[0] !== v.lng || this.lastPan[1] !== v.lat) {
        this.map!.jumpTo({ center: [v.lng, v.lat] });
        this.lastPan = [v.lng, v.lat];
      }
    }
    if (t && now - this.lastRouteT > 120) { this.drawTrackedRoute(); this.lastRouteT = now; }

    this.updateHalos(now);

    if (t && this.veh.has(t.id)) {
      const v = this.veh.get(t.id)!;
      if (now - this.lastPosT > 200) { this.store().set({ trackedPos: [v.lng, v.lat] }); this.lastPosT = now; }
      if (now - this.lastBubbleT > 1000) { this.updateBubble(); this.lastBubbleT = now; }
    }

    this.raf = requestAnimationFrame(this.frame);
  };

  private pushVehicles() {
    const src = this.src('vehicles');
    if (!src) return;
    const t = this.tracked;
    const feats: Feature<Point>[] = [];
    for (const v of this.veh.values()) {
      if (t && v.id !== t.id) continue;             // hide other buses while tracking
      // side-view icon: pick the mirrored variant when travelling west (bearing
      // 180–360) so the bus faces its direction of travel but stays upright.
      const img = v.kind + (v.bearing > 180 ? '-flip' : '');
      feats.push({
        type: 'Feature',
        properties: { id: v.id, short: v.short, img },
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      });
    }
    src.setData({ type: 'FeatureCollection', features: feats });
  }

  // ---- tracking lifecycle -------------------------------------------------
  track(a: EtaArrival | PreviewArrival, stopId: string) {
    this.untrack(false);
    if (!a.trip_id) return;
    const id = this.vehByTrip[a.trip_id];
    const v = id ? this.veh.get(id) : undefined;
    if (!v) return;                                  // bus not reporting live → can't follow
    const stop = stopById.get(stopId);
    this.tracked = {
      // arrivalEpoch is the FIXED anchor for ETA/Late — captured now, never re-based.
      id: v.id, tripId: a.trip_id, stopId, arrivalEpoch: a.arrival, route: a.route,
      stopLng: stop?.lng, stopLat: stop?.lat, stopName: stop?.name ?? '',
      following: true, wasNear: false,
    };
    const line = v.shapeId ? shapesById.get(v.shapeId) ?? null : null;
    if (line && stop) {
      const sp = projectOnLine(line, stop.lat, stop.lng);
      if (sp.offM <= OFFROAD_M) this.tracked.stopDist = sp.dist;  // stop is on this shape
    }
    this.lastPan = null;
    this.departing = false;
    this.setStopsVisible(false);                     // declutter: hide all other stops
    this.setSelStop(stop ?? null);                   // show only this one (glowing)
    this.previewVehId = null; this.previewArrival = null; this.previewStopId = null;
    this.drawTrackedRoute();
    this.store().set({
      tracked: { route: this.tracked.route, stopName: this.tracked.stopName, following: true },
      trackedPos: [v.lng, v.lat], popup: null,
    });
    this.updateBubble();
    this.pushVehicles();
  }

  untrack(snapBack: boolean) {
    this.setStopsVisible(true);
    this.clearSelStop();
    this.clearTrackedRoute();
    if (this.tracked && snapBack && this.tracked.stopLng != null && this.map) {
      this.map.easeTo({
        center: [this.tracked.stopLng, this.tracked.stopLat!],
        zoom: Math.max(this.map.getZoom(), RETURN_ZOOM),
      });
    }
    this.tracked = null;
    this.departing = false;
    this.setHalo(null);
    this.store().set({ tracked: null, bubble: null, trackedPos: null });
    this.pushVehicles();                             // bring the other buses back
  }

  pauseFollow() {
    if (this.tracked && this.tracked.following) {
      this.tracked.following = false;
      this.store().set({ tracked: { route: this.tracked.route, stopName: this.tracked.stopName, following: false } });
    }
  }
  resumeFollow() {
    if (this.tracked) {
      this.tracked.following = true; this.lastPan = null;
      this.store().set({ tracked: { route: this.tracked.route, stopName: this.tracked.stopName, following: true } });
    }
  }
  stopTracking() { this.untrack(true); }

  private trackedBubble(): Bubble {
    const t = this.tracked!;
    const v = this.veh.get(t.id);
    const secs = t.arrivalEpoch - Date.now() / 1000;
    let rem: number | null = null, dist: number | null = null;
    if (v) {
      if (t.stopDist != null && v.mode === 'shape' && v.curDist != null) {
        rem = (t.stopDist - v.curDist) * 1000;       // metres remaining along the route
        dist = Math.abs(rem);
      } else if (t.stopLat != null) {
        dist = distM(v.lat, v.lng, t.stopLat, t.stopLng!);
      }
    }
    const due = rem != null ? (rem <= DUE_M && rem >= -DEPART_M) : (dist != null && dist <= DUE_M);
    if (due) { t.wasNear = true; return { state: 'due', text: 'due', late: false, dist, rem }; }
    const departed = t.wasNear &&
      ((rem != null && rem < -DEPART_M) || (rem == null && dist != null && dist > DEPART_M));
    if (departed) return { state: 'departed', text: 'departed', late: false, dist, rem };
    const p = etaPhrase(secs);
    return { state: p.late ? 'late' : 'eta', text: p.text, late: p.late, dist, rem };
  }

  private updateBubble() {
    if (!this.tracked || !this.veh.has(this.tracked.id)) { this.untrack(true); return; }
    const b = this.trackedBubble();
    this.store().set({ bubble: { text: b.text, late: b.late, dist: b.dist } });
    if (b.state === 'departed' && !this.departing) {
      this.departing = true; setTimeout(() => this.untrack(true), 1500);
    }
  }

  private async refreshTrackedEta() {
    const t = this.tracked;
    if (!t) return;
    try {
      const data = (await (await fetch(API + '/api/stop/' + encodeURIComponent(t.stopId) + '/eta')).json()) as StopEtaResponse;
      // We do NOT re-base arrivalEpoch — it stays the prediction captured at track start.
      const a = (data.arrivals || []).find((x) => x.trip_id === t.tripId);
      if (!a) {
        const b = this.trackedBubble();              // gone only if it has PASSED the stop
        const gone = b.rem != null ? b.rem < -DEPART_M : (b.dist != null && b.dist > DEPART_M);
        if (gone && !this.departing) { this.departing = true; setTimeout(() => this.untrack(true), 1500); }
      }
    } catch { /* keep last known ETA on a transient error */ }
  }

  // Trim the blue route from the bus's CURRENT along-route position to the stop.
  drawTrackedRoute() {
    const t = this.tracked;
    const v = t ? this.veh.get(t.id) : undefined;
    if (!t || !v || t.stopDist == null) { this.clearTrackedRoute(); return; }
    const line = v.shapeId ? shapesById.get(v.shapeId) ?? null : null;
    if (!line) { this.clearTrackedRoute(); return; }
    const from = (v.mode === 'shape' && v.curDist != null)
      ? v.curDist : projectOnLine(line, v.lat, v.lng).dist;
    if (from >= t.stopDist) { this.clearTrackedRoute(); return; }  // reached/passed stop
    try {
      const slice = turf.lineSliceAlong(line, from, t.stopDist, { units: 'kilometers' });
      const coords = slice.geometry.coordinates;
      if (coords.length < 2) { this.clearTrackedRoute(); return; }
      const feat: Feature<LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
      this.src('tracked-route')?.setData(feat);
    } catch { /* degenerate slice → leave last line */ }
  }
  private clearTrackedRoute() { this.src('tracked-route')?.setData(EMPTY); }

  // ---- vehicle-click preview ----------------------------------------------
  async openVehicleNext(id: string) {
    this.previewClear();
    const v = this.veh.get(id);
    if (!v) return;
    if (!v.tripId) { this.basicVehiclePopup(v); return; }
    let data: NextStopResponse;
    try {
      data = (await (await fetch(API + '/api/trip/' + encodeURIComponent(v.tripId) + '/next-stop')).json()) as NextStopResponse;
    } catch { this.basicVehiclePopup(v); return; }
    const stop = data && data.stop_id ? stopById.get(data.stop_id) : undefined;
    if (!stop) { this.basicVehiclePopup(v); return; }
    this.previewVehId = id;
    this.previewArrival = { trip_id: v.tripId, arrival: data.arrival!, route: data.route! };
    this.previewStopId = data.stop_id!;
    this.setSelStop(stop);
    this.store().set({
      popup: {
        kind: 'vehicle', lng: stop.lng, lat: stop.lat,
        stopName: stop.name, route: data.route ?? '?', headsign: data.headsign ?? '',
        etaSeconds: data.eta_seconds ?? 0, canTrack: true,
      },
    });
  }

  private basicVehiclePopup(v: VehState) {
    this.store().set({
      popup: {
        kind: 'vehicle', lng: v.lng, lat: v.lat,
        stopName: '', route: v.short, headsign: v.head ?? '', etaSeconds: 0, canTrack: false,
      },
    });
  }

  previewClear() {
    if (this.previewVehId && (!this.tracked || this.tracked.id !== this.previewVehId)) {
      if (!this.tracked) this.setHalo(null);
    }
    if (!this.tracked) this.clearSelStop();
    this.previewVehId = null; this.previewArrival = null; this.previewStopId = null;
  }

  trackVehiclePreview() {
    const a = this.previewArrival, sid = this.previewStopId;
    this.previewVehId = null; this.previewArrival = null; this.previewStopId = null;
    this.store().set({ popup: null });
    if (a && sid) this.track(a, sid);
  }

  // ---- helper sources / layers -------------------------------------------
  private setStopsVisible(vis: boolean) {
    if (!this.map) return;
    for (const id of ['clusters', 'cluster-count', 'stops']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none');
    }
  }

  private setSelStop(stop: { lng: number; lat: number } | null) {
    if (!stop) { this.clearSelStop(); return; }
    const feat: Feature<Point> = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] } };
    this.src('selstop')?.setData({ type: 'FeatureCollection', features: [feat] });
    this.selStopActive = true;
  }
  private clearSelStop() { this.src('selstop')?.setData(EMPTY); this.selStopActive = false; }

  private setHalo(lngLat: [number, number] | null) {
    if (!lngLat) {
      if (this.vehHaloActive) { this.src('veh-halo')?.setData(EMPTY); this.vehHaloActive = false; }
      return;
    }
    const feat: Feature<Point> = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat } };
    this.src('veh-halo')?.setData({ type: 'FeatureCollection', features: [feat] });
    this.vehHaloActive = true;
  }

  private updateHalos(now: number) {
    if (!this.map) return;
    const pulse = 1 + 0.25 * Math.sin(now / 300);
    const haloVeh =
      (this.tracked && this.veh.get(this.tracked.id)) ||
      (this.previewVehId ? this.veh.get(this.previewVehId) : undefined);
    if (haloVeh) {
      this.setHalo([haloVeh.lng, haloVeh.lat]);
      if (this.map.getLayer('veh-halo')) this.map.setPaintProperty('veh-halo', 'circle-radius', 16 * pulse);
    } else {
      this.setHalo(null);
    }
    if (this.selStopActive && this.map.getLayer('selstop-halo')) {
      this.map.setPaintProperty('selstop-halo', 'circle-radius', 12 * pulse);
    }
  }
}

export const engine = new Engine();
