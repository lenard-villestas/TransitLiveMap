// Red app header: the title, plus a live local-time clock and the backend "Server: …"
// health (driven by the snapshot age the engine pushes into the store on each poll).

import { useEffect, useState } from 'react';
import { useStore } from '../store';

// e.g. "2026-06-08 3:11 PM MDT" — date in ISO-ish en-CA, time with the browser's tz abbrev.
function formatNow(): string {
  const d = new Date();
  const date = d.toLocaleDateString('en-CA');
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  });
  return `${date} ${time}`;
}

// status word → dot colour (text stays white for contrast on the red bar)
const STATUS_DOT: Record<string, string> = {
  Good: '#22c55e',
  Delayed: '#fbbf24',
  Stale: '#fbbf24',
};

export function AppBar() {
  const status = useStore((s) => s.serverStatus);
  const [now, setNow] = useState(formatNow);
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatNow()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header id="appbar">
      <div className="ab-title">Calgary Transit — Live Bus Map</div>
      <div className="ab-sub">
        {now} <span className="ab-sep">|</span> Server:{' '}
        <span className="ab-dot" style={{ background: STATUS_DOT[status] ?? '#e5e7eb' }} />
        {status}
      </div>
    </header>
  );
}
