// Base styles first, so each screen's own stylesheet can refine the shared primitives.
import '@fontsource/gloock/400.css';
import '@fontsource-variable/onest';
import './theme.css';
import './styles.css';
import './shared.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import WorkspaceGate from './WorkspaceGate';
import { configuration, publicShopSlug } from './shared';

// The public page and its fonts load only on /pedido, never in the team app.
const PublicOrder = lazy(() => import('./PublicOrder'));
const config = configuration(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
// Customer-facing request form; everything else is the team workspace.
const shopSlug = publicShopSlug(window.location.pathname);
if (shopSlug) document.title = 'Saint Cakes · Faça sua encomenda';
createRoot(document.getElementById('root')!).render(<StrictMode>{shopSlug ? <Suspense fallback={null}><PublicOrder client={config.mode === 'shared' ? config.client : null} shop={shopSlug} /></Suspense> : config.mode === 'local' ? <App /> : config.mode === 'error' ? <main className="shared-login"><h1>Confira a configuração</h1><p role="alert">{config.error}</p></main> : <WorkspaceGate client={config.client} />}</StrictMode>);
// Installable app and request alerts; skipped in development so Vite reloads stay simple.
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => { /* The app works without it. */ }); });
