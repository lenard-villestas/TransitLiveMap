// Composition root: the map fills the screen; the caption, zoom readout, and
// track bar are absolutely-positioned chrome that re-render from the store.

import { MapView } from './map/MapView';
import { TrackBar } from './ui/TrackBar';
import { useStore } from './store';

export default function App() {
  const caption = useStore((s) => s.caption);
  const zoom = useStore((s) => s.zoom);
  return (
    <>
      <MapView />
      <div id="cap">{caption}</div>
      <div id="zoomcap">zoom {zoom}</div>
      <TrackBar />
    </>
  );
}
