// Loading overlay shown while the backend is starting up / waking from sleep.
// Renders over the (already-visible) basemap until the first live snapshot arrives,
// at which point the engine clears `booting` in the store and this unmounts.
//
// On a free hosting tier the backend sleeps when idle, so the first request after a
// nap can take ~30–60 s (re-downloading Calgary's static GTFS, restarting the poll).
// A component-local timer reveals a reassuring "waking up" line once we've waited a
// few seconds, and a failed poll (serverStatus 'Down') swaps in a retry message.

import { useEffect, useState } from 'react';
import { useStore } from '../store';

export function LoadingOverlay() {
  const booting = useStore((s) => s.booting);
  const status = useStore((s) => s.serverStatus);
  const [slow, setSlow] = useState(false);

  // after a short wait, surface the "free tier is waking up" explanation
  useEffect(() => {
    if (!booting) return;
    const id = window.setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(id);
  }, [booting]);

  if (!booting) return null;

  const down = status === 'Down';
  const hint = down
    ? 'Server unavailable — retrying…'
    : slow
      ? 'The server is waking up — this can take up to a minute on the free tier.'
      : 'Fetching the live fleet…';

  return (
    <div id="loading-overlay" role="status" aria-live="polite">
      <div className="lo-card">
        <div className="lo-spinner" aria-hidden="true" />
        <div className="lo-title">Connecting to the live server</div>
        <div className="lo-hint">{hint}</div>
      </div>
    </div>
  );
}
