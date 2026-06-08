// The map: a react-map-gl <Map> over a MapLibre vector basemap, with the route
// shapes, clustered stops, vehicles, tracked-route, and highlight sources declared
// declaratively. The 60fps vehicle motion + tracking is driven imperatively by the
// engine (engine.ts), which writes into the "vehicles"/"tracked-route"/"selstop"/
// "veh-halo" sources by id. Popups + the floating bubble are real React components.

import { useEffect, useRef, useState } from 'react';
import Map, {
  Source, Layer, Popup, GeolocateControl, NavigationControl,
  type MapEvent, type MapLayerMouseEvent, type ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import type { Map as MlMap, GeolocateControl as GeolocateControlInstance } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';

import { MAP_STYLE, CALGARY_VIEW, ICON_FILES, ICON_MAX_W, REFRESH_MS, API } from '../config';
import { engine } from '../lib/engine';
import { loadNetwork, type NetworkGeo } from '../lib/network';
import { useStore } from '../store';
import type { VehiclesResponse } from '../types';
import { StopPopup } from '../ui/StopPopup';
import { VehiclePopup } from '../ui/VehiclePopup';
import { TrackBubble } from '../ui/TrackBubble';
import * as layers from './layers';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

// Make a connected LIGHT background transparent: flood-fill inward from every border
// pixel, clearing near-white/light-grey pixels. Connectivity-based, so light areas
// *inside* the vehicle (windows, highlights) are preserved. No-op on art that already
// has a transparent border. Run at full res so edge halos shrink away on downscale.
function knockOutLightBg(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const T = 190;                              // a pixel counts as background if R,G,B all ≥ T
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const isBg = (p: number) => {
    const i = p * 4;
    return d[i + 3] > 0 && d[i] >= T && d[i + 1] >= T && d[i + 2] >= T;
  };
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    if (!isBg(p)) continue;
    d[p * 4 + 3] = 0;                          // clear alpha
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  ctx.putImageData(id, 0, 0);
}

// Prepare a loaded image for the style: knock out a light background, downscale to
// ICON_MAX_W (only shrinks), and optionally mirror it (the '-flip' variants).
function prepImage(
  img: CanvasImageSource & { width: number; height: number },
  flip: boolean,
): ImageData | null {
  const w0 = img.width, h0 = img.height;
  if (!w0 || !h0) return null;
  // 1) full-res pass: clear the connected light backdrop
  const full = document.createElement('canvas');
  full.width = w0; full.height = h0;
  const fctx = full.getContext('2d');
  if (!fctx) return null;
  fctx.drawImage(img, 0, 0);
  knockOutLightBg(fctx, w0, h0);
  // 2) downscale (cap the LARGER dimension, so tall/long art shrinks too) + optional mirror
  const scale = Math.min(1, ICON_MAX_W / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return null;
  if (flip) { octx.translate(w, 0); octx.scale(-1, 1); }
  octx.drawImage(full, 0, 0, w, h);
  return octx.getImageData(0, 0, w, h);
}

export function MapView() {
  const geoRef = useRef<GeolocateControlInstance>(null);
  const [net, setNet] = useState<NetworkGeo | null>(null);
  const [ready, setReady] = useState(false);

  const popup = useStore((s) => s.popup);

  // load the static network once
  useEffect(() => {
    loadNetwork().then(setNet).catch((e) => console.error('network load failed', e));
  }, []);

  // poll /api/vehicles every REFRESH_MS once the map + network are ready
  useEffect(() => {
    if (!ready || !net) return;
    const tick = async () => {
      try {
        const data = (await (await fetch(API + '/api/vehicles')).json()) as VehiclesResponse;
        engine.refresh(data);
      } catch {
        useStore.getState().set({ caption: 'fetch error' });
      }
    };
    tick();
    const timer = window.setInterval(tick, REFRESH_MS);
    return () => clearInterval(timer);
  }, [ready, net]);

  const onLoad = (e: MapEvent) => {
    const map = e.target as MlMap;
    // Register each icon, plus a mirrored '<id>-flip' variant for the vehicles.
    const ensureIcon = (id: string) => {
      if (map.hasImage(id)) return;
      const flip = id.endsWith('-flip');
      const url = ICON_FILES[flip ? id.slice(0, -5) : id];
      if (!url) return;
      map.loadImage(url)
        .then((img) => {
          if (!img || map.hasImage(id)) return;
          const raw = img.data as HTMLImageElement | ImageBitmap;
          const data = prepImage(raw, flip);
          if (data) map.addImage(id, data);
        })
        .catch(() => {});
    };
    ['bus-default', 'train', 'stop'].forEach(ensureIcon);
    map.on('styleimagemissing', (ev) => ensureIcon((ev as { id: string }).id));
    engine.attach(map);
    setReady(true);
    // start zoomed in (16) on the user, if they allow it
    setTimeout(() => geoRef.current?.trigger(), 400);
  };

  const onClickMap = (e: MapLayerMouseEvent) => {
    const f = e.features && e.features[0];
    if (!f) return;
    const id = f.layer.id;
    if (id === 'vehicles' || id === 'vehicles-overview') {
      engine.openVehicleNext(String((f.properties as Record<string, unknown>).id));
    } else if (id === 'stops') {
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const props = f.properties as Record<string, string>;
      useStore.getState().set({ popup: { kind: 'stop', lng, lat, stopId: props.stop_id, name: props.name } });
    }
  };

  const closePopup = () => { useStore.getState().set({ popup: null }); engine.previewClear(); };

  return (
    <>
    <Map
      initialViewState={CALGARY_VIEW}
      mapStyle={MAP_STYLE}
      attributionControl={false}
      style={{ position: 'fixed', inset: 0 }}
      onLoad={onLoad}
      onClick={onClickMap}
      onZoom={(e: ViewStateChangeEvent) => useStore.getState().set({ zoom: Math.round(e.target.getZoom()) })}
      onMouseDown={() => engine.pauseFollow()}
      onTouchStart={() => engine.pauseFollow()}
      onWheel={() => engine.pauseFollow()}
      interactiveLayerIds={['vehicles', 'vehicles-overview', 'stops']}
    >
      <GeolocateControl
        ref={geoRef}
        position="top-right"
        positionOptions={{ enableHighAccuracy: true }}
        fitBoundsOptions={{ maxZoom: 16 }}
        showUserLocation
        trackUserLocation={false}
      />
      <NavigationControl position="top-right" showCompass={false} />

      {net && (
        <Source id="stops" type="geojson" data={net.stopsFC}>
          <Layer {...layers.stopLayer} />
        </Source>
      )}

      <Source id="tracked-route" type="geojson" data={EMPTY}>
        <Layer {...layers.trackedRouteLayer} />
      </Source>
      <Source id="selstop" type="geojson" data={EMPTY}>
        <Layer {...layers.selStopHaloLayer} />
        <Layer {...layers.selStopPinLayer} />
      </Source>
      <Source id="veh-halo" type="geojson" data={EMPTY}>
        <Layer {...layers.vehHaloLayer} />
      </Source>
      <Source id="vehicles" type="geojson" data={EMPTY}>
        <Layer {...layers.vehicleOverviewLayer} />
        <Layer {...layers.vehicleLayer} />
        <Layer {...layers.vehicleLabelLayer} />
      </Source>

      {popup && popup.kind === 'stop' && (
        <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom" offset={34}
          closeOnClick={false} onClose={closePopup} maxWidth="260px" className="stop-popup">
          <StopPopup stopId={popup.stopId} name={popup.name} />
        </Popup>
      )}
      {popup && popup.kind === 'vehicle' && (
        <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom" offset={30}
          closeOnClick={false} onClose={closePopup} maxWidth="260px">
          <VehiclePopup p={popup} />
        </Popup>
      )}
      <TrackBubble />
    </Map>
    <button className="locate-fab" title="My location" onClick={() => geoRef.current?.trigger()}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
      </svg>
    </button>
    </>
  );
}
