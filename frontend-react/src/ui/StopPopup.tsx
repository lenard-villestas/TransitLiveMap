// Stop ETA popup: fetches /api/stop/{id}/eta on open and lists the next 3 arrivals.
// Each Track button calls engine.track(arrival, stopId) directly — no window globals.

import { useEffect, useState } from 'react';
import { API } from '../config';
import { etaParts } from '../lib/format';
import { engine } from '../lib/engine';
import type { StopEtaResponse, EtaArrival } from '../types';
import { EtaRow } from './EtaRow';

export function StopPopup({ stopId, name }: { stopId: string; name: string }) {
  const [status, setStatus] = useState<'loading' | 'error' | 'ok'>('loading');
  const [arrivals, setArrivals] = useState<EtaArrival[]>([]);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    fetch(API + '/api/stop/' + encodeURIComponent(stopId) + '/eta')
      .then((r) => r.json())
      .then((d: StopEtaResponse) => { if (!alive) return; setArrivals(d.arrivals || []); setStatus('ok'); })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [stopId]);

  return (
    <div className="eta-list">
      <div className="eta-title">{name}</div>
      {status === 'loading' && <div className="eta-empty">loading…</div>}
      {status === 'error' && <div className="eta-empty">ETA unavailable</div>}
      {status === 'ok' && arrivals.length === 0 && <div className="eta-empty">No upcoming arrivals.</div>}
      {status === 'ok' && arrivals.map((a, i) => {
        const live = a.trip_id ? !!engine.vehByTrip[a.trip_id] : false;
        return (
          <EtaRow
            key={i}
            route={a.route}
            color={a.color}
            headsign={a.headsign}
            eta={etaParts(a.eta_seconds)}
            soon={i === 0}
            onTrack={() => engine.track(a, stopId)}
            trackDisabled={!live}
          />
        );
      })}
    </div>
  );
}
