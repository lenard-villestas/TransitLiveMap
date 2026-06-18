// Reactive "chrome" state (zustand) — the encapsulated replacement for the old
// app singleton, but only for the parts React renders: caption, zoom readout,
// track bar, the floating bubble, and which ETA popup is open. The 60fps map
// mutation stays OUT of here, in the imperative engine (engine.ts).

import { create } from 'zustand';

export interface TrackedSummary {
  route: string; stopName: string; following: boolean;
  vehicleId: string; vehicleLabel: string;   // e.g. "8280", "Bus" / "CTrain" — the track-bar heading
}
export interface BubbleInfo { text: string; late: boolean; dist: number | null; }

export interface StopPopupState {
  kind: 'stop';
  lng: number; lat: number;
  stopId: string; name: string;
}
export interface VehiclePopupState {
  kind: 'vehicle';
  lng: number; lat: number;
  stopName: string; route: string; headsign: string;
  etaSeconds: number; canTrack: boolean;
}
export type PopupState = StopPopupState | VehiclePopupState | null;

interface AppState {
  caption: string;
  zoom: number;
  booting: boolean;                 // true until the first live snapshot arrives → drives the loading overlay
  serverStatus: string;             // header "Server: …" health (Good / Delayed / Stale / Down)
  tracked: TrackedSummary | null;   // drives the track bar (visibility + text)
  bubble: BubbleInfo | null;        // 1 Hz ETA/Late text for bubble + track bar
  trackedPos: [number, number] | null;  // ~5 Hz, anchors the floating bubble popup
  popup: PopupState;                // open ETA popup (stop or vehicle)
  arrivalNotice: string | null;     // one-shot "<vehicle> has arrived at <stop>" toast (X to close)
  set: (p: Partial<AppState>) => void;
}

export const useStore = create<AppState>((set) => ({
  caption: 'loading…',
  zoom: 11,
  booting: true,
  serverStatus: 'Connecting…',
  tracked: null,
  bubble: null,
  trackedPos: null,
  popup: null,
  arrivalNotice: null,
  set: (p) => set(p),
}));
