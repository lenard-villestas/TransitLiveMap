// Composition root: the map fills the screen; the caption, zoom readout, and
// track bar are absolutely-positioned chrome that re-render from the store.

import { useState } from 'react';
import { MapView } from './map/MapView';
import { TrackBar } from './ui/TrackBar';
import { AppBar } from './ui/AppBar';
import { ArrivalToast } from './ui/ArrivalToast';
import { LoadingOverlay } from './ui/LoadingOverlay';
import { useStore } from './store';
import { ATTRIBUTION } from './config';

export default function App() {
  const zoom = useStore((s) => s.zoom);
  const [showInfo, setShowInfo] = useState(false);
  return (
    <>
      <AppBar />
      <MapView />
      <LoadingOverlay />
      <ArrivalToast />
      {showInfo && (
        <div id="infopanel">
          <div className="attrib">{ATTRIBUTION}</div>
        </div>
      )}
      <button id="infobtn" title="Map attribution" onClick={() => setShowInfo((v) => !v)}>ⓘ</button>
      <div id="zoomcap">zoom {zoom}</div>
      <TrackBar />
    </>
  );
}
