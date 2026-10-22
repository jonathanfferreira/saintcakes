import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import WorkspaceGate from './WorkspaceGate';
import { configuration } from './shared';
import './styles.css';
import './shared.css';

const config = configuration(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
createRoot(document.getElementById('root')!).render(<StrictMode>{config.mode === 'local' ? <App /> : config.mode === 'error' ? <main className="shared-login"><h1>Confira a configuração</h1><p role="alert">{config.error}</p></main> : <WorkspaceGate client={config.client} />}</StrictMode>);
