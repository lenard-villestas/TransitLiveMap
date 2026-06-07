// ONE reusable arrival row — replaces the three hand-built HTML-string versions
// from the Leaflet app (stop popup, vehicle popup, would-be bubble). React escapes
// all text, so there's no esc() and no window.* onclick plumbing.

import type { EtaText } from '../lib/format';

export function EtaRow({ route, color, headsign, eta, soon, onTrack, trackDisabled }: {
  route: string;
  color: string;
  headsign: string;
  eta: EtaText;
  soon?: boolean;
  onTrack?: () => void;
  trackDisabled?: boolean;
}) {
  return (
    <div className={'eta-row' + (soon ? ' eta-soon' : '')}>
      <span className="eta-badge" style={{ background: color }}>{route}</span>
      <span className="eta-head" title={headsign}>{headsign}</span>
      <span className={'eta-min' + (eta.late ? ' late' : '')}>{eta.text}</span>
      {onTrack && (
        <button
          className="eta-track"
          onClick={onTrack}
          disabled={trackDisabled}
          title={trackDisabled ? 'vehicle not live yet' : undefined}
        >
          track
        </button>
      )}
    </div>
  );
}
