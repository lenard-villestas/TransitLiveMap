// The floating ETA bubble above the tracked bus. Its own component so the 60 fps
// trackedPos updates (driven by the engine for smooth following) re-render only this
// little popup, not the whole MapView + layer tree. Must be rendered inside <Map>.

import { Popup } from 'react-map-gl/maplibre';
import { useStore } from '../store';

export function TrackBubble() {
  const tracked = useStore((s) => s.tracked);
  const trackedPos = useStore((s) => s.trackedPos);
  const bubble = useStore((s) => s.bubble);
  if (!tracked || !trackedPos || !bubble) return null;
  return (
    <Popup
      longitude={trackedPos[0]} latitude={trackedPos[1]}
      anchor="bottom" offset={20}
      closeButton={false} closeOnClick={false}
      className="eta-bubble" focusAfterOpen={false}
    >
      <div className="bub-stop" title={tracked.stopName}>{tracked.stopName}</div>
      <div className={'bub-time' + (bubble.late ? ' late' : '')}>{bubble.text}</div>
    </Popup>
  );
}
