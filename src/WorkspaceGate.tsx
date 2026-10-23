import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import App from './App';
import ProductionWorkspace from './ProductionWorkspace';
import TeamAccess from './TeamAccess';
import { errorMessage, parseList, parseOrderRecord, parseProductionRecord, parseStaff, roleLabels, rpc } from './shared';
import type { OrderRecord, ProductionRecord, Staff } from './shared';
import { parseRequestRecord } from './requests';
import type { OrderRequestRecord } from './requests';
import type { Order, OrderStatus } from './domain';
import { parseSettings } from './settings';
import { SHOWCASE_BUCKET, showcasePhotoUrl } from './growth';
import type { GrowthApi } from './growth';
import type { ShopSettings } from './settings';
import { announceRequests } from './alerts';

export default function WorkspaceGate({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [exitFailed, setExitFailed] = useState(false);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [records, setRecords] = useState<OrderRecord[]>([]);
  const [production, setProduction] = useState<ProductionRecord[]>([]);
  const [requests, setRequests] = useState<OrderRequestRecord[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const knownRequests = useRef<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  // Background reads only show 'Atualizando…'; actions are locked (busy) only while something is being saved.
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const identity = useRef<string | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const currentStaff = useRef<Staff | null>(null);
  const closing = useRef(false);

  const clear = useCallback(() => {
    generation.current += 1; lock.current = false; currentStaff.current = null;
    setStaff(null); setRecords([]); setProduction([]); setRequests([]); setSettings(null); knownRequests.current = null; setLastSynced(null); setSyncError(''); setBusy(false); setSyncing(false);
  }, []);

  useEffect(() => {
    let alive = true, authVersion = 0;
    const accept = (next: Session | null) => {
      if (!alive) return;
      if (closing.current && next) return;
      const userId = next?.user.id ?? null;
      if (identity.current !== userId) { clear(); identity.current = userId; }
      setSession(next); setAuthReady(true);
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => { authVersion += 1; accept(next); });
    const version = authVersion;
    void client.auth.getSession().then(({ data, error }) => {
      if (!alive || version !== authVersion) return;
      if (error) { setAuthError('Não foi possível recuperar o acesso. Entre novamente.'); accept(null); }
      else accept(data.session);
    }).catch(() => { if (alive && version === authVersion) { setAuthError('Não foi possível recuperar o acesso. Entre novamente.'); accept(null); } });
    return () => { alive = false; subscription.unsubscribe(); generation.current += 1; lock.current = false; };
  }, [client, clear]);

  const load = useCallback(async (token: number) => {
    const nextStaff = parseStaff(await rpc(client, 'current_staff'));
    if (generation.current !== token || nextStaff.userId !== identity.current) throw new Error('ACCESS_DENIED');
    const before = currentStaff.current;
    // Revoke cached data before the next read if permissions have changed.
    if (before && (before.role !== nextStaff.role || before.canViewFinancial !== nextStaff.canViewFinancial)) { setRecords([]); setProduction([]); setRequests([]); }
    currentStaff.current = nextStaff; setStaff(nextStaff);
    const data = await rpc(client, nextStaff.canViewFinancial ? 'read_orders' : 'read_production_orders');
    if (generation.current !== token) return;
    // Only people who can create orders review public requests.
    const inbox = nextStaff.role !== 'production' && nextStaff.canViewFinancial ? parseList(await rpc(client, 'read_order_requests'), parseRequestRecord) : [];
    const shop = nextStaff.canViewFinancial ? parseSettings(await rpc(client, 'read_settings')) : null;
    if (generation.current !== token) return;
    // Announce requests that arrived since the previous read, never the backlog found at login.
    const ids = new Set(inbox.map(item => item.id));
    const fresh = knownRequests.current ? inbox.filter(item => !knownRequests.current!.has(item.id)).length : 0;
    knownRequests.current = ids;
    if (fresh) announceRequests(fresh);
    setRequests(inbox); setSettings(shop);
    if (nextStaff.canViewFinancial) { setRecords(parseList(data, parseOrderRecord)); setProduction([]); }
    else { setProduction(parseList(data, parseProductionRecord)); setRecords([]); }
    setLastSynced(new Date().toISOString()); setSyncError('');
  }, [client]);

  const handleFailure = useCallback((failure: unknown, token: number) => {
    if (generation.current !== token) return;
    setRecords([]); setProduction([]); setRequests([]); setSettings(null); setLastSynced(null); setSyncError(errorMessage(failure));
    if (typeof failure === 'object' && failure && 'message' in failure && String(failure.message).includes('ACCESS_DENIED')) { currentStaff.current = null; setStaff(null); }
  }, []);

  const refresh = useCallback(async () => {
    if (!identity.current || lock.current) return;
    const token = generation.current;
    lock.current = true; setSyncing(true);
    try { await load(token); } catch (failure) { handleFailure(failure, token); }
    finally { if (generation.current === token) { lock.current = false; setSyncing(false); } }
  }, [load, handleFailure]);

  useEffect(() => {
    if (!session?.user.id) return;
    void refresh();
    // Hidden tabs keep checking at a slower pace so new site requests can still be announced.
    let ticks = 0;
    const tick = () => { ticks += 1; if (document.visibilityState === 'visible' || ticks % 3 === 0) void refresh(); };
    const timer = window.setInterval(tick, 10_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [session?.user.id, refresh]);

  async function mutate(name: string, args: Record<string, unknown>, full: boolean): Promise<OrderRecord | ProductionRecord> {
    if (lock.current || !identity.current) throw new Error('Aguarde a atualização em andamento.');
    lock.current = true; setBusy(true);
    const token = generation.current;
    try {
      const raw = await rpc(client, name, args);
      if (generation.current !== token) throw new Error('Seu acesso mudou. Entre novamente.');
      const result = full ? parseOrderRecord(raw) : parseProductionRecord(raw);
      // A complete read rechecks membership after the write and cannot race an older read.
      try { await load(token); } catch (failure) { handleFailure(failure, token); }
      return result;
    } catch (failure) {
      // On a conflict the editor remains mounted, preserving its draft.
      if (generation.current === token) {
        setSyncError(errorMessage(failure));
        if (!String((failure as { message?: unknown })?.message).includes('ORDER_CONFLICT')) handleFailure(failure, token);
      }
      throw new Error(errorMessage(failure));
    } finally { if (generation.current === token) { lock.current = false; setBusy(false); } }
  }
  async function save(order: Order, revision: number | null, requestId?: string): Promise<Order> {
    const p_order = { ...order, number: order.number || 1 };
    return (await mutate(requestId ? 'convert_order_request' : 'save_order', requestId ? { p_id: requestId, p_order } : { p_order, p_expected_revision: revision }, true) as OrderRecord).order;
  }
  async function updateStatus(order: Order, revision: number, status: OrderStatus) {
    await mutate('set_order_status', { p_id: order.id, p_status: status, p_expected_revision: revision }, true);
  }
  async function resolveRequest(id: string, status: 'converted' | 'dismissed') {
    try { await rpc(client, 'resolve_order_request', { p_id: id, p_status: status }); }
    catch (failure) { throw new Error(errorMessage(failure)); }
    finally { void refresh(); }
  }
  async function saveSettings(next: ShopSettings) {
    try { setSettings(parseSettings(await rpc(client, 'save_settings', { p_settings: next }))); }
    catch (failure) { throw new Error(errorMessage(failure)); }
  }
  const growth: GrowthApi = useMemo(() => ({
    call: (name, args) => rpc(client, name, args),
    uploadPhoto: async (file, extension) => {
      const path = `showcase/${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from(SHOWCASE_BUCKET).upload(path, file, { contentType: file.type || `image/${extension === 'jpg' ? 'jpeg' : extension}`, upsert: false });
      if (error) throw error;
      return path;
    },
    photoUrl: path => showcasePhotoUrl(import.meta.env.VITE_SUPABASE_URL ?? '', path),
  }), [client]);
  async function login(event: FormEvent) {
    event.preventDefault(); if (authBusy) return;
    closing.current = false; setAuthBusy(true); setAuthError(''); setExitFailed(false);
    try { const { error } = await client.auth.signInWithPassword({ email: email.trim(), password }); if (error) setAuthError('Não foi possível entrar. Confira e-mail e senha.'); else setPassword(''); }
    catch { setAuthError('Não foi possível entrar. Confira a conexão e tente novamente.'); }
    finally { setAuthBusy(false); }
  }
  async function logout() {
    if (authBusy) return;
    closing.current = true; clear(); identity.current = null; setAuthBusy(true); setAuthError(''); setExitFailed(false);
    try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; setSession(null); identity.current = null; closing.current = false; }
    catch { setExitFailed(true); setAuthError('Não foi possível encerrar a sessão. Os dados foram ocultados. Use Sair para tentar novamente.'); }
    finally { setAuthBusy(false); }
  }

  if (!authReady) return <main className="shared-login shared-auth-screen"><p role="status" className="shared-login-wait">Verificando acesso…</p></main>;
  if (!session) return <main className="shared-login shared-auth-screen"><div className="shared-login-card"><img src="/brand/saint-cakes.png" alt="Saint Cakes" width="112" height="112" /><h1>Encomendas</h1><p>Entre com sua conta da equipe.</p><form onSubmit={event => void login(event)}><label className="sc-field">E-mail<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={authBusy} /></label><label className="sc-field">Senha<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={authBusy} /></label>{authError && <p role="alert" className="sc-alert">{authError}</p>}<button type="submit" className="sc-btn sc-btn-primary" disabled={authBusy}>{authBusy ? 'Entrando…' : 'Entrar'}</button></form></div></main>;
  const viewKey = staff ? `${staff.userId}:${staff.role}:${staff.canViewFinancial}` : 'blocked';
  const sync = busy || syncing ? 'Atualizando…' : lastSynced ? `Atualizado às ${new Date(lastSynced).toLocaleTimeString('pt-BR')}` : 'Aguardando atualização';
  const account = staff ? { name: staff.displayName, detail: `${roleLabels[staff.role]} · ${staff.canViewFinancial ? 'consulta valores' : 'produção'}`, sync, busy: busy || syncing || authBusy || exitFailed, loggingOut: authBusy, onRefresh: () => void refresh(), onLogout: () => void logout(), team: staff.role === 'owner' ? <TeamAccess client={client} staff={staff} onChange={refresh} /> : undefined } : null;
  const alerts = <>{authError && <p role="alert" className="sc-alert sc-gate-alert">{authError}</p>}{syncError && <p role="alert" className="sc-alert sc-gate-alert shared-sync-error">{syncError}</p>}</>;
  // People with financial access get the full app, whose shell carries the account controls.
  if (staff?.canViewFinancial && account) return <>{alerts}<div key={viewKey}><App account={account} shared={{ staff, records, requests, settings, busy, syncError, lastSynced, save, updateStatus, resolveRequest, saveSettings, growth, refresh }} /></div></>;
  return <><div className="sc-account-bar"><img src="/brand/saint-cakes.png" alt="" width="36" height="36" /><div><strong>{staff?.displayName ?? 'Conta da equipe'}</strong><small aria-live="polite">{staff ? `${roleLabels[staff.role]} · ${sync}` : sync}</small></div><button type="button" className="sc-btn sc-btn-secondary" onClick={() => void refresh()} disabled={busy || syncing || authBusy || exitFailed}>Atualizar</button><button type="button" className="sc-btn sc-btn-quiet" onClick={() => void logout()} disabled={authBusy}>{authBusy ? 'Saindo…' : 'Sair'}</button></div>{alerts}{!staff ? <main className="shared-blocked"><h1>Acesso da equipe</h1><p>{busy || syncing ? 'Carregando permissões…' : 'Não foi possível carregar seu acesso. Use Atualizar para tentar novamente ou solicite a revisão da sua conta.'}</p></main> : <div key={viewKey}><ProductionWorkspace records={production} busy={busy} updateStatus={async (record, status) => { await mutate('set_order_status', { p_id: record.order.id, p_status: status, p_expected_revision: record.revision }, false); }} /></div>}</>;
}
