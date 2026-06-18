import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// No <StrictMode>: it double-mounts in dev, which would create the MapLibre map
// twice and start two rAF engine loops. The map owns one long-lived imperative
// instance, so a single mount is what we want.
createRoot(document.getElementById('root')!).render(<App />);

// Drop the pre-JS splash now that React has mounted (the LoadingOverlay takes over).
document.getElementById('boot-splash')?.remove();
