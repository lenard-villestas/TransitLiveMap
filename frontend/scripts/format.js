// Text helpers: HTML-escaping and ETA/Late phrasing.

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "ETA: 5 minutes" / "Late: 2 minutes" (late = counting up past the predicted time).
export function etaPhrase(secs) {
  const m = Math.round(Math.abs(secs) / 60);
  const unit = m === 1 ? 'minute' : 'minutes';
  if (secs < 0) return { text: 'Late: ' + m + ' ' + unit, late: true };
  return { text: 'ETA: ' + (m === 0 ? '<1 minute' : m + ' ' + unit), late: false };
}

// For stop-popup rows (time only): a small "due" window, else ETA:/Late:.
export function etaParts(secs) {
  if (secs <= 30 && secs >= -30) return { text: 'due', late: false };
  return etaPhrase(secs);
}
