// One-shot "<vehicle> has arrived at <stop>" banner, shown when a tracked bus reaches its
// stop. The engine sets store.arrivalNotice; this renders it with an × to dismiss.

import { useStore } from '../store';

export function ArrivalToast() {
  const notice = useStore((s) => s.arrivalNotice);
  if (!notice) return null;
  return (
    <div id="arrival-toast" role="status">
      <span className="at-icon" aria-hidden="true">✓</span>
      <span className="at-text">{notice}</span>
      <button
        className="at-close"
        aria-label="Dismiss"
        onClick={() => useStore.getState().set({ arrivalNotice: null })}
      >
        ×
      </button>
    </div>
  );
}
