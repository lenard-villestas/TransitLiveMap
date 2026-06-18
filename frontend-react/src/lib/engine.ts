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
  REFRESH_MS, ICONS, OFFROAD_M, MAX_SPEED_MPS, JUMP_SLACK_M, BOB_AMP_PX, BOB_PERIOD_MS, BOB_MIN_ZOOM,
  DUE_M, DEPART_M, RETURN_ZOOM, TRACK_ZOOM, API,
} from '../config';
import type { VehiclesResponse, EtaArrival, StopEtaResponse, NextStopResponse } from '../types';
import { shapesById, shapeLenById, stopById } from './network';
import {
  lerp, bearingDeg, projectOnLine, projectNear, lineLengthKm, pointAt, shapeBearing, distM, type TurfLine,
} from './geometry';
import { etaPhrase } from './format';
import { useStore } from '../store';

const kindFor = (type: string) => (/tram|lrt|rail|subway/i.test(type) ? 'train' : 'bus');

// stable per-vehicle sample rank in [0,1): same id always maps to the same value,
// so the zoomed-out "overview" sample doesn't flicker frame to frame.
const rankOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

interface VehState {
  id: string; short: string; type: string; head: string;
  kind: string; forward: number; rank: number;
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
  private introPlaying = false;            // true during the track() zoom-out→fly-in; gates the follow-cam
  private introTimers: number[] = [];      // pending setTimeouts for the intro sequence (cancellable)
  private lastPan: [number, number] | null = null;
  private lastRouteT = 0;
  private lastBubbleT = 0;
  private departing = false;
  private arrivalAnnounced = false;        // fire the "has arrived" toast once per track session
  private selStopActive = false;
  private selStop: [number, number] | null = null;   // coords of the highlighted stop (for the bob loop)
  private vehHaloActive = false;

  // vehicle-click preview (highlight bus + its next stop before committing to track)
  previewVehId: string | null = null;
  previewArrival: PreviewArrival | null = null;
  previewStopId: string | null = null;

  private store() { return useStore.getState(); }
  private src(id: string) { return this.map?.getSource(id) as GeoJSONSource | undefined; }

  // Build the reactive track-bar summary from the current tracked state + the live vehicle's
  // kind. Single source of truth so every set({ tracked }) call carries the same fields.
  private trackedSummary(following: boolean) {
    const t = this.tracked!;
    const kind = this.veh.get(t.id)?.kind;
    return {
      route: t.route, stopName: t.stopName, following,
      vehicleId: t.id, vehicleLabel: kind === 'train' ? 'CTrain' : 'Bus',
    };
  }

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
        // seed the along-distance once so the very first constrained projection
        // has a continuity anchor (avoids a possible first-fix flip).
        const line0 = shapeId ? shapesById.get(shapeId) ?? null : null;
        const curDist0 = line0 ? projectOnLine(line0, lat, lon).dist : null;
        this.veh.set(id, {
          id, short, type, head, kind, forward: ICONS[kind].forward, rank: rankOf(id),
          shapeId: shapeId || null, tripId: tripId || null,
          lng: lon, lat, mode: 'line', line: null,
          fromDist: 0, toDist: 0, curDist: curDist0,
          fromLat: lat, fromLon: lon, toLat: lat, toLon: lon, toLatRaw: lat, toLonRaw: lon,
          bearing: ICONS[kind].forward, startT: now, dur: REFRESH_MS, lastMove: 0, settled: true,
        });
      } else {
        // trip turnover → new shape: drop the stale along-distance so setTarget
        // re-seeds on the new line instead of carrying it across shapes.
        if (shapeId && shapeId !== v.shapeId) { v.shapeId = shapeId; v.curDist = null; }
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
      serverStatus: this.serverStatusFor(data.age),
      // a non-null age means the backend has produced at least one live snapshot →
      // it's awake and serving data, so drop the loading overlay.
      ...(data.age != null ? { booting: false } : {}),
    });
    this.pushVehicles();
  }

  // Map snapshot age → the header's "Server: …" health word.
  private serverStatusFor(age: number | null): string {
    if (age == null) return 'No data';
    if (age > 180) return 'Stale';
    if (age > 75) return 'Delayed';
    return 'Good';
  }

  // Aim a vehicle at its new GPS fix: snap ALONG its shape if it's on it, else lerp.
  private setTarget(v: VehState, lat: number, lon: number, now: number) {
    v.toLatRaw = lat; v.toLonRaw = lon;
    const line = v.shapeId ? shapesById.get(v.shapeId) ?? null : null;
    let snapped = false;
    if (line) {
      // continuity anchor: where the vehicle already is along the line.
      const prevDist = v.curDist != null ? v.curDist : projectOnLine(line, v.lat, v.lng).dist;
      // search only the reachable stretch (±max plausible travel) around prevDist, so
      // the projection can't flip to a far overlapping segment of the same shape.
      const dtSec = v.lastMove ? (now - v.lastMove) / 1000 : REFRESH_MS / 1000;
      const windowKm = (MAX_SPEED_MPS * dtSec + JUMP_SLACK_M) / 1000;
      const lenKm = shapeLenById.get(v.shapeId!) ?? lineLengthKm(line);
      const to = projectNear(line, lat, lon, prevDist, windowKm, lenKm);
      if (to.offM <= OFFROAD_M) {
        v.mode = 'shape'; v.line = line;
        v.fromDist = prevDist; v.toDist = to.dist; v.curDist = prevDist;
        v.bearing = shapeBearing(line, prevDist, to.dist);
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
      const pLat = v.lat, pLng = v.lng;             // position before this frame's update
      if (v.mode === 'shape' && v.line) {
        const d = lerp(v.fromDist, v.toDist, t);
        v.curDist = d;
        const p = pointAt(v.line, d);
        v.lng = p.lon; v.lat = p.lat;
      } else {
        v.lat = lerp(v.fromLat, v.toLat, t);
        v.lng = lerp(v.fromLon, v.toLon, t);
      }
      // heading = frame-to-frame travel direction (the path tangent) → nose follows the
      // road's curve continuously. Guard the zero-length case (would snap to north).
      if (distM(pLat, pLng, v.lat, v.lng) > 0.1) v.bearing = bearingDeg(pLat, pLng, v.lat, v.lng);
      if (t >= 1) v.settled = true;
    }
    this.pushVehicles();

    const t = this.tracked;
    if (t && t.following && !this.introPlaying && this.veh.has(t.id)) {
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
      // bubble anchor at 60 fps (only when it actually moves) so it tracks the bus smoothly
      const tp = this.store().trackedPos;
      if (!tp || tp[0] !== v.lng || tp[1] !== v.lat) this.store().set({ trackedPos: [v.lng, v.lat] });
      if (now - this.lastBubbleT > 1000) { this.updateBubble(); this.lastBubbleT = now; }
    }

    this.raf = requestAnimationFrame(this.frame);
  };

  private pushVehicles() {
    const src = this.src('vehicles');
    if (!src) return;
    const now = performance.now();
    const z = this.map?.getZoom() ?? 99;            // bobbing is suppressed when zoomed out
    const t = this.tracked;
    const feats: Feature<Point>[] = [];
    for (const v of this.veh.values()) {
      if (t && v.id !== t.id) continue;             // hide other buses while tracking
      // rotate the icon so its nose points along the travel bearing (forward = the
      // compass dir the top-down art faces at rest). ICONS[kind].image is the
      // registered image id (namespaced to dodge the basemap sprite's own 'bus' glyph).
      const img = ICONS[v.kind].image;
      const rotate = (v.bearing - ICONS[v.kind].forward + 360) % 360;
      // tracked bus → rank 0 so it's always in the overview sample (never vanishes zoomed out)
      const rank = t && v.id === t.id ? 0 : v.rank;
      // gentle vertical "bob" while gliding (per-vehicle phase via rank); off when settled
      // or zoomed out past BOB_MIN_ZOOM
      const bob = v.settled || z < BOB_MIN_ZOOM ? [0, 0]
        : [0, Math.sin(now / BOB_PERIOD_MS * Math.PI * 2 + v.rank * Math.PI * 2) * BOB_AMP_PX];
      feats.push({
        type: 'Feature',
        properties: { id: v.id, short: v.short, img, rank, bob, rotate, size: ICONS[v.kind].size },
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
    this.arrivalAnnounced = false;                   // re-arm the arrival toast for this session
    this.setStopsVisible(false);                     // declutter: hide all other stops
    this.setSelStop(stop ?? null);                   // show only this one (glowing)
    this.previewVehId = null; this.previewArrival = null; this.previewStopId = null;
    this.drawTrackedRoute();
    this.playTrackIntro(v, stop ?? null);            // 2s overview (bus + stop) → 1s fly into the bus
    this.store().set({
      tracked: this.trackedSummary(true),
      trackedPos: [v.lng, v.lat], popup: null, arrivalNotice: null,
    });
    this.updateBubble();
    this.pushVehicles();
  }

  // Cinematic track intro: frame the whole picture (bus + stop) for 2 s, then fly into the
  // bus over 1 s and hand off to the follow-cam. introPlaying gates the per-frame follow so
  // it can't fight the animation. Cancellable via clearIntro() (Exit / re-track mid-flight).
  private playTrackIntro(v: VehState, stop: { lng: number; lat: number } | null) {
    if (!this.map) return;
    this.clearIntro();
    this.introPlaying = true;
    if (stop) {
      const sw: [number, number] = [Math.min(v.lng, stop.lng), Math.min(v.lat, stop.lat)];
      const ne: [number, number] = [Math.max(v.lng, stop.lng), Math.max(v.lat, stop.lat)];
      this.map.fitBounds([sw, ne], {
        // extra bottom room so the bus clears the (mobile) full-width track bar
        padding: { top: 80, bottom: 120, left: 70, right: 70 },
        maxZoom: 15, duration: 2000, essential: true,
      });
    } else {
      this.map.easeTo({ center: [v.lng, v.lat], duration: 2000, essential: true });
    }
    // after the overview, fly into the bus (re-read its live position so it's current)
    this.introTimers.push(window.setTimeout(() => {
      const cur = this.tracked && this.veh.get(this.tracked.id);
      if (!cur || !this.map) { this.introPlaying = false; return; }
      this.map.flyTo({ center: [cur.lng, cur.lat], zoom: TRACK_ZOOM, duration: 1000, essential: true });
      // hand off to the follow-cam once the fly-in lands
      this.introTimers.push(window.setTimeout(() => {
        this.introPlaying = false; this.lastPan = null;
      }, 1000));
    }, 2000));
  }

  private clearIntro() {
    for (const id of this.introTimers) clearTimeout(id);
    this.introTimers = [];
    this.introPlaying = false;
  }

  untrack(snapBack: boolean) {
    this.clearIntro();                               // cancel any in-flight track intro
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
      this.store().set({ tracked: this.trackedSummary(false) });
    }
  }
  resumeFollow() {
    if (this.tracked) {
      this.tracked.following = true; this.lastPan = null;
      this.store().set({ tracked: this.trackedSummary(true) });
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
    // first time the bus reaches the stop → "<vehicle> has arrived at <stop>" toast (persists
    // past untrack until the user closes it, so it's still readable after the bus departs).
    if (b.state === 'due' && !this.arrivalAnnounced) {
      this.arrivalAnnounced = true;
      const label = this.veh.get(this.tracked.id)?.kind === 'train' ? 'CTrain' : 'Bus';
      this.store().set({
        arrivalNotice: `${label} ${this.tracked.id} has arrived at ${this.tracked.stopName || 'the stop'}`,
      });
    }
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
    // frame the camera so BOTH the bus and its next stop are visible, AND the whole ETA
    // popup stays on-screen. The popup anchors ABOVE the stop (bottom anchor), ~260px wide:
    // reserve a popup's height on top and a half-width on the sides. Clamp each pad to <38%
    // of the container so on a small screen we never pass padding larger than the viewport
    // (which makes fitBounds throw / over-zoom).
    const sw: [number, number] = [Math.min(v.lng, stop.lng), Math.min(v.lat, stop.lat)];
    const ne: [number, number] = [Math.max(v.lng, stop.lng), Math.max(v.lat, stop.lat)];
    const cont = this.map?.getContainer();
    const cw = cont?.clientWidth ?? 800, ch = cont?.clientHeight ?? 600;
    const padX = Math.min(150, cw * 0.38), padY = Math.min(200, ch * 0.38);
    this.map?.fitBounds([sw, ne], {
      padding: { top: padY, bottom: Math.min(80, ch * 0.38), left: padX, right: padX },
      maxZoom: 16, duration: 700, essential: true,
    });
    // open the SAME popup as clicking the stop directly (its next-3 arrivals + Track),
    // anchored at the vehicle's next stop. The clicked bus appears in that list.
    this.store().set({
      popup: { kind: 'stop', lng: stop.lng, lat: stop.lat, stopId: data.stop_id!, name: stop.name },
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
    this.selStop = [stop.lng, stop.lat];
    this.selStopActive = true;
    this.renderSelStop([0, 0]);
  }
  private clearSelStop() { this.src('selstop')?.setData(EMPTY); this.selStopActive = false; this.selStop = null; }

  // (re)write the selected-stop feature with the current bob offset (the pin bounces)
  private renderSelStop(bob: number[]) {
    if (!this.selStop) return;
    const feat: Feature<Point> = {
      type: 'Feature', properties: { bob },
      geometry: { type: 'Point', coordinates: this.selStop },
    };
    this.src('selstop')?.setData({ type: 'FeatureCollection', features: [feat] });
  }

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
    if (this.selStopActive) {
      if (this.map.getLayer('selstop-halo')) this.map.setPaintProperty('selstop-halo', 'circle-radius', 16 * pulse);
      // slow, gentle float (anchored at its base) — like it's hovering
      this.renderSelStop([0, Math.sin(now / 1600 * Math.PI * 2) * 2.5]);
    }
  }
}

export const engine = new Engine();
