import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import OrderForm from './OrderForm';
import Comanda, { stageLabels } from './Comanda';
import { addDays as strictAddDays, calculateOrder, formatMoney, localDateKey, validateOrder } from './domain';
import type { Order, OrderStatus } from './domain';
import { decode, encode, load, mergeOrders, persist } from './storage';
import type { SharedMode } from './shared';
import { estimate, requestToOrder } from './requests';
import type { OrderRequestRecord } from './requests';
import type { ShopSettings } from './settings';
import { Customers, Dashboard } from './Dashboard';
import ShopSettingsForm from './ShopSettings';
import { confirmationMessage, defaultSettings, whatsappLink } from './settings';
import { alertsEnabled, alertsSupported, enableAlerts } from './alerts';
import { groupOrders, orderGroupLabels } from './metrics';

/** Signed-in account controls, supplied by WorkspaceGate and drawn inside the app shell. */
export type AccountControls = { name: string; detail: string; sync: string; busy: boolean; loggingOut: boolean; onRefresh: () => void; onLogout: () => void; team?: ReactNode };

type Page = 'dashboard' | 'orders' | 'production' | 'requests' | 'customers' | 'settings' | 'team' | 'more';
const labels: Record<Page, string> = { dashboard: 'Painel', orders: 'Encomendas', production: 'Produção', requests: 'Pedidos do site', customers: 'Clientes', settings: 'Loja', team: 'Equipe', more: 'Mais' };
const shortLabels: Partial<Record<Page, string>> = { requests: 'Site' };
type IconName = 'calendar' | 'orders' | 'cake' | 'plus' | 'arrow' | 'back' | 'search' | 'inbox' | 'chart' | 'users' | 'store' | 'team' | 'more' | 'refresh' | 'logout' | 'edit' | 'print' | 'chat' | 'pin' | 'clock';
const pageIcons: Record<Page, IconName> = { dashboard: 'chart', orders: 'orders', production: 'cake', requests: 'inbox', customers: 'users', settings: 'store', team: 'team', more: 'more' };
const iconPaths: Record<IconName, string> = {
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  orders: 'M8 3H5v18h14V3h-3M8 2h8v4H8ZM8 11h8m-8 5h5',
  cake: 'M4 13h16v8H4ZM4 16c2 3 4-3 6 0s4-3 6 0 4 0 4 0M7 13V9h10v4M12 9V5m0-3v1',
  plus: 'M12 5v14M5 12h14', arrow: 'm9 5 7 7-7 7', back: 'M15 18l-6-6 6-6', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6Z', chart: 'M4 20h16M7 16v-5m5 5V6m5 10v-8',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM21 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  store: 'M3 9l1.5-5h15L21 9M3 9h18M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3m0 0c0 1.7 1.3 3 3 3s3-1.3 3-3m0 0c0 1.7 1.3 3 3 3s3-1.3 3-3M5 12v8h14v-8M10 20v-5h4v5',
  team: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1M19 8l1.5 1.5L23 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6', logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4', print: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7Z',
  chat: 'M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z', pin: 'M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
};
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}
// A free line (price 0) is valid inside an order but calculateOrder rejects it on its own.
const lineCents = (line: Order['lines'][number]) => line.unitPriceCents ? calculateOrder([line]).totalCents : 0;
const shortLine = (description: string) => description.replace(' · linha party', '');
function humanDate(key: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('pt-BR', options).format(new Date(`${key}T12:00:00`));
}
function addDays(key: string, amount: number) {
  try { return strictAddDays(key, amount); }
  catch { return key; }
}
function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readInitial() {
  try { return load(window.localStorage); }
  catch { return { orders: [] as Order[], raw: null, error: 'O armazenamento está bloqueado neste navegador. Permita dados locais e recarregue para cadastrar pedidos.' }; }
}
function depositState(order: Order) {
  const money = calculateOrder(order.lines, order.receivedCents);
  if (order.status === 'cancelled') return { tone: 'muted', text: 'Cancelada' };
  if (money.balanceCents === 0) return { tone: 'leaf', text: 'Pago' };
  if (money.depositDueCents > 0) return { tone: 'amber', text: `Sinal pendente ${formatMoney(money.depositDueCents)}` };
  return { tone: 'leaf', text: `Sinal anotado · falta ${formatMoney(money.balanceCents)}` };
}

export default function App({ shared, account }: { shared?: SharedMode; account?: AccountControls }) {
  const [initial] = useState(() => shared ? { orders: [] as Order[], raw: null, error: '' } : readInitial());
  const [localOrders, setOrders] = useState(initial.orders);
  const orders = useMemo(() => shared ? shared.records.map(record => record.order) : localOrders, [shared, localOrders]);
  const canEdit = !shared || shared.staff.role !== 'production';
  const isOwner = shared?.staff.role === 'owner';
  const busy = shared?.busy ?? false;
  const editRevision = useRef<number | null>(null);
  const converting = useRef<string | null>(null);
  const requests = shared && canEdit ? shared.requests : [];
  const shop = shared?.settings ?? defaultSettings;
  const pendingCount = requests.length;
  useEffect(() => {
    document.title = pendingCount ? `(${pendingCount}) Saint Cakes · Encomendas` : 'Saint Cakes · Encomendas';
  }, [pendingCount]);
  const raw = useRef(initial.raw);
  const [storageError, setStorageError] = useState(initial.error);
  const [recoveryExported, setRecoveryExported] = useState(false);
  // The owner starts on the Painel; whoever serves customers starts on the order list.
  const [page, setPage] = useState<Page>(isOwner || !shared ? 'dashboard' : 'orders');
  const [date, setDate] = useState(localDateKey());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'open' | 'all' | OrderStatus>('open');
  const [showPast, setShowPast] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Order | null | undefined>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const today = localDateKey();
  const selected = orders.find(order => order.id === selectedId) ?? null;

  function commit(next: Order[]) {
    if (storageError && !recoveryExported) throw new Error('Exporte os dados originais antes de restaurar um backup.');
    raw.current = persist(window.localStorage, next, raw.current);
    setOrders(next); setStorageError(''); setError('');
  }
  function beginEdit(order: Order | null) {
    if (busy) return;
    editRevision.current = order ? shared?.records.find(record => record.order.id === order.id)?.revision ?? null : null;
    setEditing(order); setError(''); window.scrollTo({ top: 0 });
  }
  async function save(order: Order) {
    if (shared) {
      const saved = await shared.save(order, editRevision.current);
      setEditing(undefined); setPage('orders'); setSelectedId(saved.id);
      setMessage(`Encomenda #${String(saved.number).padStart(3, '0')} salva para a equipe.`);
      const request = converting.current; converting.current = null;
      if (request) await shared.resolveRequest(request, 'converted').catch(() => setError('A encomenda foi salva, mas o pedido do site continua na lista. Descarte-o manualmente.'));
      return;
    }
    if (storageError) throw new Error(storageError);
    const number = order.number || Math.max(0, ...orders.map(o => o.number)) + 1;
    const checked = validateOrder({ ...order, number });
    const next = orders.some(o => o.id === checked.id) ? orders.map(o => o.id === checked.id ? checked : o) : [...orders, checked];
    commit(next); setEditing(undefined); setPage('orders'); setSelectedId(checked.id); setMessage(`Encomenda #${String(number).padStart(3, '0')} salva neste navegador.`);
  }
  async function updateStatus(order: Order, next: OrderStatus) {
    try {
      if (shared) {
        const revision = shared.records.find(record => record.order.id === order.id)?.revision;
        if (revision === undefined) throw new Error('Recarregue os pedidos antes de atualizar o andamento.');
        await shared.updateStatus(order, revision, next);
      } else commit(orders.map(o => o.id === order.id ? { ...o, status: next } : o));
      setMessage(`#${String(order.number).padStart(3, '0')} agora está ${stageLabels[next].toLocaleLowerCase('pt-BR')}.`);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
  }
  function exportBackup() {
    download(storageError && raw.current ? raw.current : encode(orders), `saint-cakes-backup-${localDateKey()}.json`);
    setRecoveryExported(true); setMessage('Cópia exportada. Guarde o arquivo em um lugar seguro.');
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]; event.target.value = '';
    if (!chosen) return;
    const startingRevision = raw.current;
    try {
      if (chosen.size > 5_000_000) throw new Error('O arquivo excede 5 MB.');
      const incoming = decode(await chosen.text());
      if (raw.current !== startingRevision) throw new Error('Os pedidos mudaram durante a leitura do backup. Selecione o arquivo novamente para preservar os novos registros.');
      const next = mergeOrders(orders, incoming);
      commit(next); setMessage(`Backup restaurado: ${next.length} encomenda(s) disponíveis. Nenhum pedido existente foi substituído.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível ler esse arquivo.'); }
  }
  function examples() {
    const sample: Order[] = [
      { customer: 'Marina · exemplo fictício', description: 'Bolo de chocolate · exemplo', time: '14:00', fulfillment: 'pickup', price: 18000, received: 9000, status: 'confirmed' },
      { customer: 'Rafael · exemplo fictício', description: 'Docinhos sortidos · exemplo', time: '16:30', fulfillment: 'delivery', price: 12000, received: 6000, status: 'preparing' },
      { customer: 'Bianca · exemplo fictício', description: 'Bolo personalizado · exemplo', time: '18:00', fulfillment: 'pickup', price: 22000, received: 0, status: 'pending' },
    ].map((s, i) => validateOrder({ id: crypto.randomUUID(), number: i + 1, customer: s.customer, phone: '', date: today, time: s.time, fulfillment: s.fulfillment, address: s.fulfillment === 'delivery' ? 'Endereço fictício para demonstração' : '', notes: 'Dado fictício. Valores e produtos ilustrativos, sem vínculo com o catálogo da Saint Cakes.', lines: [{ id: crypto.randomUUID(), description: s.description, quantity: 1, unit: 'un', unitPriceCents: s.price }], receivedCents: s.received, status: s.status, createdAt: new Date().toISOString() }));
    try { commit(sample); setMessage('Exemplos fictícios adicionados. Produtos e preços são ilustrativos.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar os exemplos.'); }
  }
  function navigate(next: Page) { if (busy) return; setPage(next); setEditing(undefined); setError(''); if (next !== 'orders') setSelectedId(null); window.scrollTo({ top: 0 }); }
  function openOrder(order: Order) { setPage('orders'); setEditing(undefined); setSelectedId(order.id); setQuery(''); setStatus('all'); setShowPast(order.date < today); }
  function statusOptions(order: Order) {
    if (canEdit) return Object.entries(stageLabels) as [OrderStatus, string][];
    const next = order.status === 'confirmed' ? 'preparing' : order.status === 'preparing' ? 'ready' : null;
    return (Object.entries(stageLabels) as [OrderStatus, string][]).filter(([key]) => key === order.status || key === next);
  }

  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const matching = orders.filter(o => (status === 'all' || (status === 'open' ? o.status !== 'delivered' && o.status !== 'cancelled' : o.status === status))
    && (!needle || `${o.customer} ${o.phone} ${o.phone.replace(/\D/g, '')} ${o.number} ${o.lines.map(l => l.description).join(' ')}`.toLocaleLowerCase('pt-BR').includes(needle)));
  const groups = groupOrders(matching, today).filter(group => group.orders.length && (group.id !== 'past' || showPast || needle));
  const pastCount = groupOrders(matching, today).find(group => group.id === 'past')?.orders.length ?? 0;
  const kitchen = orders.filter(o => o.date === date && ['confirmed', 'preparing', 'ready'].includes(o.status)).sort((a, b) => a.time.localeCompare(b.time));
  const prep = new Map<string, { description: string; unit: string; quantity: number }>();
  for (const order of kitchen.filter(o => o.status !== 'ready')) for (const line of order.lines) {
    const key = `${line.description.trim().toLocaleLowerCase('pt-BR')}|${line.unit}`;
    prep.set(key, { description: shortLine(line.description), unit: line.unit, quantity: (prep.get(key)?.quantity ?? 0) + line.quantity });
  }
  const todayOpen = orders.filter(o => o.date === today && o.status !== 'cancelled' && o.status !== 'delivered').length;

  const nav: Page[] = ['dashboard', 'orders', 'production', ...(shared && canEdit ? ['requests' as const] : []), 'customers', ...(isOwner && shared?.settings ? ['settings' as const] : []), ...(account?.team ? ['team' as const] : [])];
  const tabs: Page[] = ['dashboard', 'orders', 'production', ...(shared && canEdit ? ['requests' as const] : []), 'more'];
  const badge = (p: Page) => p === 'requests' && pendingCount ? pendingCount : p === 'orders' && todayOpen ? todayOpen : 0;
  const current = editing !== undefined ? 'orders' : page;
  const newOrder = canEdit ? <button className="sc-btn sc-btn-primary" disabled={!!storageError || busy} onClick={() => beginEdit(null)}><Icon name="plus" />Nova encomenda</button> : null;

  const accountBlock = account && <div className="sc-account">
    <div><strong>{account.name}</strong><span>{account.detail}</span><small aria-live="polite">{account.sync}</small></div>
    <div className="sc-account-actions">
      <button type="button" className="sc-icon-btn" onClick={account.onRefresh} disabled={account.busy} aria-label="Atualizar agora"><Icon name="refresh" /></button>
      <button type="button" className="sc-icon-btn" onClick={account.onLogout} disabled={account.loggingOut} aria-label="Sair"><Icon name="logout" /></button>
    </div>
  </div>;

  let content: ReactNode;
  if (editing !== undefined) {
    content = canEdit ? <OrderForm key={editing?.id ?? 'new'} order={editing} date={today} onSave={save} onCancel={() => { converting.current = null; setEditing(undefined); }} /> : null;
  } else if (page === 'dashboard') {
    content = <Dashboard orders={orders} today={today} requestCount={shared && canEdit ? requests.length : null} onOpen={openOrder} onRequests={() => navigate('requests')} />;
  } else if (page === 'customers') {
    content = <Customers orders={orders} today={today} onShowOrders={search => { navigate('orders'); setQuery(search); setStatus('all'); setShowPast(true); }} />;
  } else if (page === 'settings' && shared?.settings) {
    content = <ShopSettingsForm settings={shared.settings} onSave={shared.saveSettings} />;
  } else if (page === 'team' && account?.team) {
    content = account.team;
  } else if (page === 'requests' && shared) {
    content = <RequestInbox requests={requests} busy={busy} onConvert={record => { if (busy) return; converting.current = record.id; editRevision.current = null; setEditing(requestToOrder(record, new Date().toISOString())); setError(''); window.scrollTo({ top: 0 }); }} onDismiss={async record => { try { await shared.resolveRequest(record.id, 'dismissed'); setMessage('Pedido do site descartado.'); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível descartar.'); } }} />;
  } else if (page === 'more') {
    content = <section className="sc-page sc-more" aria-labelledby="more-title">
      <h1 id="more-title">Mais</h1>
      {accountBlock && <div className="sc-card sc-more-account">{accountBlock}</div>}
      <nav aria-label="Outras áreas" className="sc-card sc-more-links">{nav.filter(p => !tabs.includes(p)).map(p => <button key={p} type="button" onClick={() => navigate(p)}><Icon name={pageIcons[p]} />{labels[p]}<Icon name="arrow" size={16} /></button>)}</nav>
      <DataFooter />
    </section>;
  } else if (page === 'production') {
    content = <section className="sc-page" aria-labelledby="production-title">
      <div className="sc-page-head"><div><h1 id="production-title">Produção</h1><p>O que a cozinha tem para preparar no dia.</p></div>
        <div className="sc-day" role="group" aria-label="Dia da produção">
          <button type="button" className="sc-icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Dia anterior"><Icon name="back" /></button>
          <label><span className="sr-only">Data</span><input type="date" value={date} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.validity.valid) setDate(e.target.value); }} /></label>
          <button type="button" className="sc-icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Próximo dia"><Icon name="arrow" /></button>
          {date !== today && <button type="button" className="sc-btn sc-btn-quiet" onClick={() => setDate(today)}>Hoje</button>}
        </div></div>
      <p className="sc-day-title"><strong>{humanDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong> · {kitchen.length} {kitchen.length === 1 ? 'comanda' : 'comandas'}</p>
      {prep.size > 0 && <div className="sc-card sc-prep"><h2>A preparar</h2><ul>{[...prep.values()].map(item => <li key={`${item.description}|${item.unit}`}><span>{item.description}</span><strong className="sc-num">{Number(item.quantity.toFixed(3)).toLocaleString('pt-BR')} {item.unit}</strong></li>)}</ul><p>Soma das comandas confirmadas e em produção; as prontas ficam de fora.</p></div>}
      {kitchen.length ? <div className="sc-comandas">{kitchen.map(order => <Comanda key={order.id} order={order} busy={busy || !!storageError} onAdvance={next => void updateStatus(order, next)} />)}</div>
        : <Empty title="Cozinha em dia." text="Encomendas confirmadas para esta data aparecem aqui como comandas, com o que preparar." />}
    </section>;
  } else {
    content = <section className={`sc-orders ${selected ? 'has-detail' : ''}`} aria-label="Encomendas">
      <div className="sc-orders-list">
        <div className="sc-page-head sc-head-orders"><div><h1>Encomendas</h1><p>{todayOpen ? `${todayOpen} para hoje.` : 'Nada pendente para hoje.'} Abertas primeiro, por data e horário.</p></div>{newOrder}</div>
        <div className="sc-toolbar">
          <label className="sc-search"><Icon name="search" /><span className="sr-only">Buscar encomenda</span><input type="search" placeholder="Buscar pedido ou cliente" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <div className="sc-filters" role="group" aria-label="Filtrar por andamento">
            {([['open', 'Abertas'], ['pending', 'A confirmar'], ['confirmed', 'Confirmadas'], ['preparing', 'Em produção'], ['ready', 'Prontas'], ['delivered', 'Entregues'], ['cancelled', 'Canceladas'], ['all', 'Todas']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</button>)}
          </div>
        </div>
        {groups.length ? groups.map(group => <section key={group.id} className={`sc-group sc-group-${group.id}`} aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`}>{orderGroupLabels[group.id]}<span className="sc-num">{group.orders.length}</span></h2>
          <ul>{group.orders.map(order => { const money = calculateOrder(order.lines, order.receivedCents); const pay = depositState(order); return <li key={order.id}>
            <button type="button" className={`sc-row ${order.id === selectedId ? 'is-selected' : ''} ${order.status === 'cancelled' ? 'is-cancelled' : ''}`} aria-current={order.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(order.id)}>
              <span className="sc-row-when"><strong className="sc-num">{order.time}</strong><span>{group.id === 'today' ? (order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega') : humanDate(order.date, { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '')}</span></span>
              <span className="sc-row-main"><span className="sc-row-name">{order.customer}</span><span className="sc-row-items">{order.lines.map(l => `${l.quantity.toLocaleString('pt-BR')} ${l.unit} ${shortLine(l.description)}`).join(' · ')}</span>
                <span className="sc-row-tags"><span className={`sc-stage sc-stage-${order.status}`}>{stageLabels[order.status]}</span><span className={`sc-pay sc-pay-${pay.tone}`}>{pay.text}</span>{group.id !== 'today' && <span className="sc-row-kind">{order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</span>}</span></span>
              <span className="sc-row-money sc-money">{formatMoney(money.totalCents)}<small className="sc-num">#{String(order.number).padStart(3, '0')}</small></span>
            </button></li>; })}</ul>
        </section>) : <Empty title={needle || status !== 'open' ? 'Nenhuma encomenda encontrada.' : 'Nenhuma encomenda aberta.'} text={needle || status !== 'open' ? 'Tente outro nome, número ou filtro.' : 'Novas encomendas aparecem aqui por data e horário.'}>{!needle && status === 'open' && newOrder}{!shared && orders.length === 0 && !storageError && <button className="sc-btn sc-btn-quiet" onClick={examples}>Conhecer com exemplos fictícios</button>}</Empty>}
        {pastCount > 0 && !needle && <button type="button" className="sc-btn sc-btn-secondary sc-past-toggle" onClick={() => setShowPast(current => !current)}>{showPast ? 'Ocultar anteriores' : `Mostrar ${pastCount} anteriores`}</button>}
        <DataFooter />
      </div>
      {selected && <OrderDetail order={selected} shop={shop} canEdit={canEdit} busy={busy || !!storageError} statusOptions={statusOptions(selected)} onClose={() => setSelectedId(null)} onEdit={() => beginEdit(selected)} onStatus={next => void updateStatus(selected, next)} onPrint={() => { setPrintOrder(selected); setTimeout(() => window.print(), 100); }} />}
    </section>;
  }

  function DataFooter() {
    return <footer className="sc-data">{shared
      ? <><p>Pedidos compartilhados com a equipe, atualizados a cada 10 segundos. Recebimentos são anotações manuais.</p>{isOwner && <button className="sc-btn sc-btn-quiet" disabled={busy || !!shared.syncError || !shared.lastSynced} onClick={exportBackup}>Exportar backup</button>}</>
      : <><p><strong>Seus dados ficam neste navegador.</strong> Esta prévia não sincroniza entre aparelhos. Exporte uma cópia para guardar.</p><div><button className="sc-btn sc-btn-quiet" onClick={exportBackup}>{storageError ? 'Exportar dados originais' : 'Exportar backup'}</button><button className="sc-btn sc-btn-quiet" disabled={!!storageError && !recoveryExported} onClick={() => file.current?.click()}>Restaurar backup</button><input ref={file} tabIndex={-1} type="file" accept="application/json,.json" className="sr-only" aria-label="Arquivo de backup" onChange={importBackup} /></div></>}
    </footer>;
  }

  return <>
    <a className="skip" href="#main">Ir para o conteúdo</a>
    <div className={`sc-shell ${editing !== undefined ? 'is-editing' : ''}`}>
      <aside className="sc-rail" aria-label="Saint Cakes">
        <a className="sc-brand" href="#" onClick={e => { e.preventDefault(); navigate(isOwner || !shared ? 'dashboard' : 'orders'); }}><img src="/brand/saint-cakes.png" alt="" width="48" height="48" /><span>Saint Cakes<small>Encomendas</small></span></a>
        <nav aria-label="Navegação principal">{nav.map(p => <button key={p} type="button" aria-current={current === p ? 'page' : undefined} onClick={() => navigate(p)}><Icon name={pageIcons[p]} /><span><span className="sc-label-long">{labels[p]}</span><span className="sc-label-short" aria-hidden="true">{shortLabels[p] ?? labels[p]}</span></span>{badge(p) > 0 && <span className="sc-badge sc-num" aria-label={`${badge(p)} ${p === 'requests' ? 'novos' : 'para hoje'}`}>{badge(p)}</span>}</button>)}</nav>
        {accountBlock}
        {!shared && <p className="sc-rail-note">Prévia local · dados neste navegador</p>}
      </aside>
      <div className="sc-main">
        <header className="sc-topbar"><img src="/brand/saint-cakes.png" alt="" width="36" height="36" /><strong>{labels[current]}</strong>{current === 'orders' && editing === undefined && canEdit && <button type="button" className="sc-icon-btn" onClick={() => beginEdit(null)} disabled={!!storageError || busy} aria-label="Nova encomenda"><Icon name="plus" /></button>}{account && <button type="button" className="sc-icon-btn" onClick={account.onRefresh} disabled={account.busy} aria-label="Atualizar agora"><Icon name="refresh" /></button>}</header>
        <main id="main">
          {storageError && <div className="sc-alert" role="alert">{storageError}</div>}
          {error && <div className="sc-alert sc-flash" role="alert"><span>{error}</span><button className="sc-btn sc-btn-quiet" onClick={() => setError('')}>Fechar</button></div>}
          {message && <div className="sc-notice sc-flash" role="status"><span>{message}</span><button className="sc-btn sc-btn-quiet" onClick={() => setMessage('')}>Fechar</button></div>}
          {content}
        </main>
      </div>
      <nav className="sc-tabs" aria-label="Navegação">{tabs.map(p => <button key={p} type="button" aria-current={current === p || (p === 'more' && !tabs.includes(current)) ? 'page' : undefined} onClick={() => navigate(p)}><span className="sc-tab-icon"><Icon name={pageIcons[p]} />{badge(p) > 0 && <span className="sc-badge sc-num">{badge(p)}</span>}</span><span>{shortLabels[p] ?? labels[p]}</span></button>)}</nav>
    </div>
    {printOrder && <PrintSheet order={printOrder} />}
  </>;
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="sc-empty"><Icon name="orders" size={28} /><h2>{title}</h2><p>{text}</p>{children && <div>{children}</div>}</div>;
}

function OrderDetail({ order, shop, canEdit, busy, statusOptions, onClose, onEdit, onStatus, onPrint }: { order: Order; shop: Pick<ShopSettings, 'pixKey' | 'pixHolder'>; canEdit: boolean; busy: boolean; statusOptions: [OrderStatus, string][]; onClose: () => void; onEdit: () => void; onStatus: (next: OrderStatus) => void; onPrint: () => void }) {
  const money = calculateOrder(order.lines, order.receivedCents);
  const whatsapp = order.status === 'cancelled' ? null : whatsappLink(order.phone, confirmationMessage(order, shop));
  const pay = depositState(order);
  return <aside className="sc-detail" aria-labelledby="detail-title">
    <div className="sc-detail-bar"><button type="button" className="sc-btn sc-btn-quiet" onClick={onClose}><Icon name="back" />Voltar à lista</button><span className="sc-num">#{String(order.number).padStart(3, '0')}</span></div>
    <header><h2 id="detail-title">{order.customer}</h2><span className={`sc-stage sc-stage-${order.status}`}>{stageLabels[order.status]}</span></header>
    <ul className="sc-facts">
      <li><Icon name="clock" size={18} /><span><strong>{humanDate(order.date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong> às <strong className="sc-num">{order.time}</strong></span></li>
      <li><Icon name="pin" size={18} /><span>{order.fulfillment === 'pickup' ? 'Retirada na loja' : `Entrega · ${order.address}`}</span></li>
      {order.phone && <li><Icon name="chat" size={18} /><span className="sc-num">{order.phone}</span></li>}
    </ul>
    <div className="sc-detail-actions">
      {whatsapp && <a className="sc-btn sc-btn-leaf" href={whatsapp} target="_blank" rel="noreferrer" title="Abre o WhatsApp com a mensagem de confirmação pronta"><Icon name="chat" />Mensagem WhatsApp</a>}
      {canEdit && <button type="button" className="sc-btn sc-btn-secondary" disabled={busy} onClick={onEdit}><Icon name="edit" />Editar</button>}
      <button type="button" className="sc-btn sc-btn-secondary" onClick={onPrint}><Icon name="print" />Imprimir</button>
    </div>
    <label className="sc-field">Andamento<select value={order.status} disabled={busy || statusOptions.length < 2} onChange={e => onStatus(e.target.value as OrderStatus)}>{statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <section aria-labelledby="detail-items"><h3 id="detail-items">Itens</h3>
      <ul className="sc-lines">{order.lines.map(line => <li key={line.id}><span><strong className="sc-num">{line.quantity.toLocaleString('pt-BR')} {line.unit}</strong> {shortLine(line.description)}</span><span className="sc-num">{line.unitPriceCents ? formatMoney(lineCents(line)) : 'a orçar'}</span></li>)}</ul>
    </section>
    <dl className="sc-sums">
      <div><dt>Total</dt><dd className="sc-money">{formatMoney(money.totalCents)}</dd></div>
      <div><dt>Sinal de 50%</dt><dd className="sc-num">{formatMoney(money.depositCents)}</dd></div>
      <div><dt>Recebido (anotado)</dt><dd className="sc-num">{formatMoney(order.receivedCents)}</dd></div>
      <div className={`sc-sums-balance sc-pay-${pay.tone}`}><dt>Saldo</dt><dd className="sc-num">{formatMoney(money.balanceCents)}</dd></div>
    </dl>
    {order.notes && <section aria-labelledby="detail-notes"><h3 id="detail-notes">Observações</h3><p className="sc-notes">{order.notes}</p></section>}
    {!canEdit && <p className="sc-muted">Seu acesso consulta valores e atualiza a produção. Alterações e recebimentos ficam com o atendimento.</p>}
  </aside>;
}

function PrintSheet({ order }: { order: Order }) {
  const money = calculateOrder(order.lines, order.receivedCents);
  return <section className="print-sheet"><header><img src="/brand/saint-cakes.png" alt="Saint Cakes" /><div><h1>Ficha de encomenda #{String(order.number).padStart(3, '0')}</h1><p>{humanDate(order.date)} · {order.time} · {order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</p></div></header><h2>{order.customer}</h2>{order.phone && <p>Contato: {order.phone}</p>}{order.fulfillment === 'delivery' && <p>Endereço: {order.address}</p>}<p>Andamento: {stageLabels[order.status]}</p><table><thead><tr><th>Descrição</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{order.lines.map(l => <tr key={l.id}><td>{l.description}</td><td>{l.quantity.toLocaleString('pt-BR')} {l.unit}</td><td>{formatMoney(l.unitPriceCents)}</td><td>{formatMoney(lineCents(l))}</td></tr>)}</tbody></table><div className="print-totals"><p>Total <strong>{formatMoney(money.totalCents)}</strong></p><p>Sinal previsto (50%) <strong>{formatMoney(money.depositCents)}</strong></p><p>Recebido, anotado manualmente <strong>{formatMoney(order.receivedCents)}</strong></p><p>Saldo a receber <strong>{formatMoney(money.balanceCents)}</strong></p></div>{order.notes && <><h3>Observações</h3><p className="preserve-lines">{order.notes}</p></>}<p className="print-disclaimer">Ficha de organização de encomenda. Valores recebidos anotados manualmente; não é comprovante bancário ou documento fiscal.</p></section>;
}

function RequestInbox({ requests, busy, onConvert, onDismiss }: { requests: OrderRequestRecord[]; busy: boolean; onConvert: (record: OrderRequestRecord) => void; onDismiss: (record: OrderRequestRecord) => Promise<void> }) {
  const [alerts, setAlerts] = useState(alertsEnabled);
  return <section className="sc-page" aria-labelledby="requests-title">
    <div className="sc-page-head"><div><h1 id="requests-title">Pedidos do site</h1><p>Enviados pelos clientes. Confira, combine pelo WhatsApp e transforme em encomenda.</p></div>{alertsSupported() && (alerts ? <span className="sc-alerts-on">Avisos ativados neste aparelho</span> : <button className="sc-btn sc-btn-secondary" onClick={() => void enableAlerts().then(setAlerts)}>Ativar avisos neste aparelho</button>)}</div>
    {requests.length ? <ul className="sc-requests">{requests.map(record => { const r = record.request; const money = estimate(r.lines); const link = whatsappLink(r.phone); return <li key={record.id} className="sc-card sc-request">
      <header><div><h2>{r.customer}</h2><p className="sc-num">{humanDate(r.date, { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '')} · {r.time} · {r.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</p></div><span className="sc-money">{money.totalCents ? formatMoney(money.totalCents) : 'A orçar'}{money.quoted && money.totalCents ? <small> + orçamento</small> : null}</span></header>
      <ul className="sc-lines">{r.lines.map(line => <li key={line.id}><span><strong className="sc-num">{line.quantity.toLocaleString('pt-BR')} {line.unit}</strong> {shortLine(line.description)}</span><span className="sc-num">{line.unitPriceCents ? formatMoney(estimate([line]).totalCents) : 'a orçar'}</span></li>)}</ul>
      {r.fulfillment === 'delivery' && <p className="sc-request-note"><Icon name="pin" size={16} />{r.address}</p>}{r.notes && <p className="sc-notes">{r.notes}</p>}
      <footer><span className="sc-muted">Recebido em {new Date(record.createdAt).toLocaleString('pt-BR')}</span>
        <div>{link && <a className="sc-btn sc-btn-secondary" href={link} target="_blank" rel="noreferrer"><Icon name="chat" />WhatsApp</a>}<button className="sc-btn sc-btn-quiet" disabled={busy} onClick={() => { if (window.confirm(`Descartar o pedido de ${r.customer}?`)) void onDismiss(record); }}>Descartar</button><button className="sc-btn sc-btn-primary" disabled={busy} onClick={() => onConvert(record)}>Transformar em encomenda</button></div></footer>
    </li>; })}</ul> : <Empty title="Nenhum pedido novo do site." text="Quando um cliente enviar uma encomenda pelo link, ela aparece aqui para conferência." />}
  </section>;
}
