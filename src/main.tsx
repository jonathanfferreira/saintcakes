import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicOrder from './PublicOrder';
import WorkspaceGate from './WorkspaceGate';
import { configuration } from './shared';
import './styles.css';
import './shared.css';

const config = configuration(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
// Customer-facing request form; everything else is the team workspace.
const publicOrder = /^\/pedido\/?$/.test(window.location.pathname);
if (publicOrder) document.title = 'Saint Cakes · Faça sua encomenda';
createRoot(document.getElementById('root')!).render(<StrictMode>{publicOrder ? <PublicOrder client={config.mode === 'shared' ? config.client : null} /> : config.mode === 'local' ? <App /> : config.mode === 'error' ? <main className="shared-login"><h1>Confira a configuração</h1><p role="alert">{config.error}</p></main> : <WorkspaceGate client={config.client} />}</StrictMode>);
