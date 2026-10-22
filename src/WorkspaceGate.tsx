import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import App from './App';
import ProductionWorkspace from './ProductionWorkspace';
import TeamAccess from './TeamAccess';
import { errorMessage, parseList, parseOrderRecord, parseProductionRecord, parseStaff, roleLabels, rpc } from './shared';
import type { OrderRecord, ProductionRecord, Staff } from './shared';
import type { Order, OrderStatus } from './domain';

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
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  const identity = useRef<string | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const currentStaff = useRef<Staff | null>(null);
  const closing = useRef(false);

  const clear = useCallback(() => {
    generation.current += 1; lock.current = false; currentStaff.current = null;
    setStaff(null); setRecords([]); setProduction([]); setLastSynced(null); setSyncError(''); setBusy(false); setShowTeam(false);
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
    if (before && (before.role !== nextStaff.role || before.canViewFinancial !== nextStaff.canViewFinancial)) { setRecords([]); setProduction([]); setShowTeam(false); }
    currentStaff.current = nextStaff; setStaff(nextStaff);
    const data = await rpc(client, nextStaff.canViewFinancial ? 'read_orders' : 'read_production_orders');
    if (generation.current !== token) return;
    if (nextStaff.canViewFinancial) { setRecords(parseList(data, parseOrderRecord)); setProduction([]); }
    else { setProduction(parseList(data, parseProductionRecord)); setRecords([]); }
    setLastSynced(new Date().toISOString()); setSyncError('');
  }, [client]);

  const handleFailure = useCallback((failure: unknown, token: number) => {
    if (generation.current !== token) return;
    setRecords([]); setProduction([]); setLastSynced(null); setSyncError(errorMessage(failure));
    if (typeof failure === 'object' && failure && 'message' in failure && String(failure.message).includes('ACCESS_DENIED')) { currentStaff.current = null; setStaff(null); setShowTeam(false); }
  }, []);

  const refresh = useCallback(async () => {
    if (!identity.current || lock.current) return;
    const token = generation.current;
    lock.current = true; setBusy(true);
    try { await load(token); } catch (failure) { handleFailure(failure, token); }
    finally { if (generation.current === token) { lock.current = false; setBusy(false); } }
  }, [load, handleFailure]);

  useEffect(() => {
    if (!session?.user.id) return;
    void refresh();
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
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
  async function save(order: Order, revision: number | null): Promise<Order> {
    return (await mutate('save_order', { p_order: { ...order, number: order.number || 1 }, p_expected_revision: revision }, true) as OrderRecord).order;
  }
  async function updateStatus(order: Order, revision: number, status: OrderStatus) {
    await mutate('set_order_status', { p_id: order.id, p_status: status, p_expected_revision: revision }, true);
  }
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

  if (!authReady) return <main className="shared-login"><p role="status">Verificando acesso…</p></main>;
  if (!session) return <main className="shared-login shared-auth-screen"><div className="shared-login-card"><img src="/brand/saint-cakes.png" alt="Saint Cakes" width="112" height="112" /><h1>Encomendas</h1><p>Entre com sua conta da equipe.</p><form onSubmit={event => void login(event)}><label>E-mail<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={authBusy} /></label><label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={authBusy} /></label>{authError && <p role="alert" className="error">{authError}</p>}<button className="primary" disabled={authBusy}>{authBusy ? 'Entrando…' : 'Entrar'}</button></form></div></main>;
  const viewKey = staff ? `${staff.userId}:${staff.role}:${staff.canViewFinancial}` : 'blocked';
  return <><div className="shared-account"><div><strong>{staff?.displayName ?? 'Conta da equipe'}</strong>{staff && <span>{roleLabels[staff.role]} · {staff.canViewFinancial ? 'Consulta de valores permitida' : 'Consulta de produção'}</span>}<small>{busy ? 'Atualizando…' : lastSynced ? `Atualizado às ${new Date(lastSynced).toLocaleTimeString('pt-BR')}` : 'Aguardando atualização'}</small></div><div><button onClick={() => void refresh()} disabled={busy || authBusy || exitFailed}>Atualizar</button>{staff?.role === 'owner' && <button onClick={() => setShowTeam(current => !current)} aria-expanded={showTeam}>{showTeam ? 'Voltar aos pedidos' : 'Equipe'}</button>}<button onClick={() => void logout()} disabled={authBusy}>{authBusy ? 'Saindo…' : 'Sair'}</button></div></div>{authError && <p role="alert" className="error">{authError}</p>}{syncError && <p role="alert" className="error shared-sync-error">{syncError}</p>}{!staff ? <main className="shared-login"><h1>Acesso da equipe</h1><p>{busy ? 'Carregando permissões…' : 'Não foi possível carregar seu acesso. Use Atualizar para tentar novamente ou solicite a revisão da sua conta.'}</p></main> : <div key={viewKey}>{showTeam && staff.role === 'owner' ? <TeamAccess client={client} staff={staff} onChange={refresh} /> : staff.canViewFinancial ? <App shared={{ staff, records, busy, syncError, lastSynced, save, updateStatus, refresh }} /> : <ProductionWorkspace records={production} busy={busy} updateStatus={async (record, status) => { await mutate('set_order_status', { p_id: record.order.id, p_status: status, p_expected_revision: record.revision }, false); }} />}</div>}</>;
}
