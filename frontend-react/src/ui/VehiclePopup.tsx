// Vehicle-click popup: its next stop + a Track button (data already fetched into
// the store by engine.openVehicleNext). Falls back to a basic card when the trip
// isn't in the trip-updates feed (no next stop / not trackable).

import { etaParts } from '../lib/format';
import { engine } from '../lib/engine';
import { EtaRow } from './EtaRow';
import type { VehiclePopupState } from '../store';

export function VehiclePopup({ p }: { p: VehiclePopupState }) {
  if (!p.canTrack) {
    return (
      <div className="eta-list">
        <div className="eta-title">Route {p.route}</div>
        {p.headsign && <div className="eta-empty">to {p.headsign}</div>}
        <div className="eta-empty">next stop unknown</div>
      </div>
    );
  }
  return (
    <div className="eta-list">
      <div className="eta-title">{p.stopName}</div>
      <EtaRow
        route={p.route}
        color="#2563eb"
        headsign={p.headsign}
        eta={etaParts(p.etaSeconds)}
        onTrack={() => engine.trackVehiclePreview()}
      />
    </div>
  );
}
