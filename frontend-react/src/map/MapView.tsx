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
import type { Map as MlMap, GeoJSONSource, GeolocateControl as GeolocateControlInstance } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';

import { MAP_STYLE, CALGARY_VIEW, ICON_FILES, REFRESH_MS, API, CLUSTER_MAX_ZOOM } from '../config';
import { engine } from '../lib/engine';
import { loadNetwork, type NetworkGeo } from '../lib/network';
import { useStore } from '../store';
import type { VehiclesResponse } from '../types';
import { StopPopup } from '../ui/StopPopup';
import { VehiclePopup } from '../ui/VehiclePopup';
import * as layers from './layers';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

// Horizontally-mirror a loaded image (for the '-flip' vehicle variants).
function mirror(img: CanvasImageSource & { width: number; height: number }): ImageData | null {
  const { width: w, height: h } = img;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

export function MapView() {
  const geoRef = useRef<GeolocateControlInstance>(null);
  const [net, setNet] = useState<NetworkGeo | null>(null);
  const [ready, setReady] = useState(false);

  const popup = useStore((s) => s.popup);
  const trackedPos = useStore((s) => s.trackedPos);
  const tracked = useStore((s) => s.tracked);
  const bubble = useStore((s) => s.bubble);

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
          const data = flip ? mirror(raw) : raw;
          if (data) map.addImage(id, data);
        })
        .catch(() => {});
    };
    ['bus', 'train', 'stop', 'bus-flip', 'train-flip'].forEach(ensureIcon);
    map.on('styleimagemissing', (ev) => ensureIcon((ev as { id: string }).id));
    engine.attach(map);
    setReady(true);
    // start zoomed in (16) on the user, if they allow it
    setTimeout(() => geoRef.current?.trigger(), 400);
  };

  const onClickMap = async (e: MapLayerMouseEvent) => {
    const f = e.features && e.features[0];
    if (!f) return;
    const map = e.target as MlMap;
    const id = f.layer.id;
    if (id === 'vehicles') {
      engine.openVehicleNext(String((f.properties as Record<string, unknown>).id));
    } else if (id === 'stops') {
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const props = f.properties as Record<string, string>;
      useStore.getState().set({ popup: { kind: 'stop', lng, lat, stopId: props.stop_id, name: props.name } });
    } else if (id === 'clusters') {
      const src = map.getSource('stops') as GeoJSONSource;
      const clusterId = (f.properties as Record<string, number>).cluster_id;
      try {
        const zoom = await src.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      } catch { /* ignore */ }
    }
  };

  const closePopup = () => { useStore.getState().set({ popup: null }); engine.previewClear(); };

  return (
    <Map
      initialViewState={CALGARY_VIEW}
      mapStyle={MAP_STYLE}
      style={{ position: 'fixed', inset: 0 }}
      onLoad={onLoad}
      onClick={onClickMap}
      onZoom={(e: ViewStateChangeEvent) => useStore.getState().set({ zoom: Math.round(e.target.getZoom()) })}
      onDragStart={() => engine.pauseFollow()}
      interactiveLayerIds={['vehicles', 'stops', 'clusters']}
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
        <Source id="shapes" type="geojson" data={net.shapesFC}>
          <Layer {...layers.shapeLineLayer} />
        </Source>
      )}
      {net && (
        <Source id="stops" type="geojson" data={net.stopsFC} cluster clusterMaxZoom={CLUSTER_MAX_ZOOM} clusterRadius={60}>
          <Layer {...layers.clusterCircleLayer} />
          <Layer {...layers.clusterCountLayer} />
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
        <Layer {...layers.vehicleLayer} />
        <Layer {...layers.vehicleLabelLayer} />
      </Source>

      {popup && popup.kind === 'stop' && (
        <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom" offset={34}
          closeOnClick={false} onClose={closePopup} maxWidth="260px">
          <StopPopup stopId={popup.stopId} name={popup.name} />
        </Popup>
      )}
      {popup && popup.kind === 'vehicle' && (
        <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom" offset={30}
          closeOnClick={false} onClose={closePopup} maxWidth="260px">
          <VehiclePopup p={popup} />
        </Popup>
      )}
      {tracked && trackedPos && bubble && (
        <Popup longitude={trackedPos[0]} latitude={trackedPos[1]} anchor="bottom" offset={20}
          closeButton={false} closeOnClick={false} className="eta-bubble" focusAfterOpen={false}>
          <div className="bub-stop" title={tracked.stopName}>{tracked.stopName}</div>
          <div className={'bub-time' + (bubble.late ? ' late' : '')}>{bubble.text}</div>
        </Popup>
      )}
    </Map>
  );
}
