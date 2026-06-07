// The "stop tracking" bar (bottom-centre). Reads the reactive tracked summary +
// 1 Hz bubble info from the store; buttons drive the imperative engine.

import { useStore } from '../store';
import { engine } from '../lib/engine';

export function TrackBar() {
  const tracked = useStore((s) => s.tracked);
  const bubble = useStore((s) => s.bubble);
  if (!tracked) return null;

  const distTxt = bubble?.dist != null ? ' · ' + Math.round(bubble.dist) + ' m' : '';
  return (
    <div id="trackbar" style={{ display: 'flex' }}>
      <span id="trackinfo">
        <div className="tb-stop" title={tracked.stopName}>{tracked.stopName}</div>
        <div className={'tb-time' + (bubble?.late ? ' late' : '')}>
          Route {tracked.route} · {bubble?.text ?? ''}{distTxt}
        </div>
      </span>
      {!tracked.following && <button onClick={() => engine.resumeFollow()}>follow</button>}
      <button onClick={() => engine.stopTracking()}>stop</button>
    </div>
  );
}
