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
        <div className="tb-following">Following {tracked.vehicleLabel} {tracked.vehicleId}</div>
        <div className="tb-stop" title={tracked.stopName}>{tracked.stopName}</div>
        <div className={'tb-time' + (bubble?.late ? ' late' : '')}>
          Route {tracked.route} · {bubble?.text ?? ''}{distTxt}
        </div>
      </span>
      {/* Follow stays visible: filled/active while following (tap re-centres), resumes after a pan */}
      <button
        className={'tb-follow' + (tracked.following ? ' is-active' : '')}
        onClick={() => engine.resumeFollow()}
      >
        Follow
      </button>
      <button onClick={() => engine.stopTracking()}>Exit</button>
    </div>
  );
}
