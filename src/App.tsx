import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import OrderForm from './OrderForm';
import { addDays as strictAddDays, calculateOrder, formatMoney, localDateKey, validateOrder } from './domain';
import type { Order, OrderStatus } from './domain';
import { decode, encode, load, mergeOrders, persist } from './storage';
import type { SharedMode } from './shared';

const stages: Record<OrderStatus, string> = { pending: 'A confirmar', confirmed: 'Confirmado', preparing: 'Em produção', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' };
type Page = 'agenda' | 'orders' | 'production';
const labels: Record<Page, string> = { agenda: 'Agenda', orders: 'Encomendas', production: 'Produção' };
function Icon({ name, size = 20 }: { name: 'calendar' | 'orders' | 'cake' | 'plus' | 'arrow' | 'search'; size?: number }) {
  const paths = {
    calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    orders: 'M8 3H5v18h14V3h-3M8 2h8v4H8ZM8 11h8m-8 5h5',
    cake: 'M4 13h16v8H4ZM4 16c2 3 4-3 6 0s4-3 6 0 4 0 4 0M7 13V9h10v4M12 9V5m0-3v1',
    plus: 'M12 5v14M5 12h14', arrow: 'm9 5 7 7-7 7', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
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
export default function App({ shared }: { shared?: SharedMode }) {
  const [initial] = useState(() => shared ? { orders: [] as Order[], raw: null, error: '' } : readInitial());
  const [localOrders, setOrders] = useState(initial.orders);
  const orders = shared ? shared.records.map(record => record.order) : localOrders;
  const canEdit = !shared || shared.staff.role !== 'production';
  const busy = shared?.busy ?? false;
  const editRevision = useRef<number | null>(null);
  const raw = useRef(initial.raw);
  const [storageError, setStorageError] = useState(initial.error);
  const [recoveryExported, setRecoveryExported] = useState(false);
  const [page, setPage] = useState<Page>('agenda');
  const [date, setDate] = useState(localDateKey());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<Order | null | undefined>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const file = useRef<HTMLInputElement>(null);
  function commit(next: Order[]) {
    if (storageError && !recoveryExported) throw new Error('Exporte os dados originais antes de restaurar um backup.');
    raw.current = persist(window.localStorage, next, raw.current);
    setOrders(next); setStorageError(''); setError('');
  }
  function beginEdit(order: Order | null) {
    if (busy) return;
    editRevision.current = order ? shared?.records.find(record => record.order.id === order.id)?.revision ?? null : null;
    setEditing(order); setError('');
  }
  async function save(order: Order) {
    if (shared) {
      const saved = await shared.save(order, editRevision.current);
      setEditing(undefined); setDate(saved.date);
      setMessage(`Encomenda #${String(saved.number).padStart(3, '0')} salva para a equipe.`);
      return;
    }
    if (storageError) throw new Error(storageError);
    const number = order.number || Math.max(0, ...orders.map(o => o.number)) + 1;
    const checked = validateOrder({ ...order, number });
    const next = orders.some(o => o.id === checked.id) ? orders.map(o => o.id === checked.id ? checked : o) : [...orders, checked];
    commit(next); setEditing(undefined); setDate(checked.date); setMessage(`Encomenda #${String(number).padStart(3, '0')} salva neste navegador.`);
  }
  async function updateStatus(order: Order, next: OrderStatus) {
    try {
      if (shared) {
        const revision = shared.records.find(record => record.order.id === order.id)?.revision;
        if (revision === undefined) throw new Error('Recarregue os pedidos antes de atualizar o andamento.');
        await shared.updateStatus(order, revision, next);
      } else commit(orders.map(o => o.id === order.id ? { ...o, status: next } : o));
      setMessage('Andamento atualizado.');
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
  }
  function exportBackup() {
    download(storageError && raw.current ? raw.current : encode(orders), `saint-cakes-backup-${localDateKey()}.json`);
    setRecoveryExported(true); setMessage('Cópia exportada. Guarde o arquivo em um lugar seguro.');
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    const startingRevision = raw.current;
    try {
      if (selected.size > 5_000_000) throw new Error('O arquivo excede 5 MB.');
      const incoming = decode(await selected.text());
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
    ].map((s, i) => validateOrder({ id: crypto.randomUUID(), number: i + 1, customer: s.customer, phone: '', date, time: s.time, fulfillment: s.fulfillment, address: s.fulfillment === 'delivery' ? 'Endereço fictício para demonstração' : '', notes: 'Dado fictício. Valores e produtos ilustrativos, sem vínculo com o catálogo da Saint Cakes.', lines: [{ id: crypto.randomUUID(), description: s.description, quantity: 1, unit: 'un', unitPriceCents: s.price }], receivedCents: s.received, status: s.status, createdAt: new Date().toISOString() }));
    try { commit(sample); setMessage('Exemplos fictícios adicionados. Produtos e preços são ilustrativos.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar os exemplos.'); }
  }
  const dayOrders = orders.filter(o => o.date === date);
  const liveDay = dayOrders.filter(o => o.status !== 'cancelled');
  const source = page === 'orders' ? orders : dayOrders;
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const visible = source.filter(o => (status === 'all' || o.status === status) && (!needle || `${o.customer} ${o.phone} ${o.number} ${o.lines.map(l => l.description).join(' ')}`.toLocaleLowerCase('pt-BR').includes(needle))).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const kitchen = dayOrders.filter(o => ['confirmed', 'preparing', 'ready'].includes(o.status));
  const production = new Map<string, { description: string; unit: string; quantity: number }>();
  for (const order of kitchen) for (const line of order.lines) {
    const key = `${line.description.trim().toLocaleLowerCase('pt-BR')}|${line.unit}`;
    const item = production.get(key);
    production.set(key, { description: line.description, unit: line.unit, quantity: (item?.quantity ?? 0) + line.quantity });
  }
  const pendingBalance = liveDay.reduce((sum, o) => sum + calculateOrder(o.lines, o.receivedCents).balanceCents, 0);
  function navigate(next: Page) { if (busy) return; setPage(next); setEditing(undefined); setQuery(''); setStatus('all'); setError(''); }
  const actions: ReactNode = canEdit ? <button className="primary" disabled={!!storageError || busy} onClick={() => beginEdit(null)}><Icon name="plus" />Nova encomenda</button> : null;
  function statusOptions(order: Order) {
    if (canEdit) return Object.entries(stages);
    const next = order.status === 'confirmed' ? 'preparing' : order.status === 'preparing' ? 'ready' : null;
    return Object.entries(stages).filter(([key]) => key === order.status || key === next);
  }
  return <>
    <a className="skip" href="#main">Ir para o conteúdo</a>
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('agenda'); }} aria-label="Saint Cakes, ir para agenda"><img src="/brand/saint-cakes.png" alt="Saint Cakes — Fabiano Budal" /><span>Encomendas</span></a>
        <nav aria-label="Navegação principal">{(['agenda', 'orders', 'production'] as Page[]).map(p => <button key={p} aria-current={page === p && editing === undefined ? 'page' : undefined} onClick={() => navigate(p)}><Icon name={p === 'agenda' ? 'calendar' : p === 'orders' ? 'orders' : 'cake'} />{labels[p]}{p === 'orders' && <span className="nav-count">{orders.length}</span>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="small-seal">SC</div><p>Feito com cuidado.<br /><span>Do pedido à entrega.</span></p></div>
      </aside>
      <div className="workspace">
        <header className="topbar"><span>Saint Cakes <span className="divider">/</span> Padaria e Confeitaria</span><span className="local-tag">{shared ? "Equipe · ambiente de teste" : "Prévia local"}</span></header>
        <main id="main">
          {storageError && <div className="error" role="alert">{storageError}</div>}
          {error && <div className="error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>Fechar aviso</button></div>}
          {message && <div className="notice" role="status">{message}<button className="quiet" onClick={() => setMessage('')}>Fechar</button></div>}
          {editing !== undefined ? canEdit ? <OrderForm key={editing?.id ?? 'new'} order={editing} date={date} onSave={save} onCancel={() => setEditing(undefined)} /> : editing ? <OrderDetails order={editing} onClose={() => setEditing(undefined)} /> : null : <>
            <div className="page-heading"><div><h1>{page === 'agenda' ? 'Sua agenda, no ponto.' : page === 'production' ? 'O que preparar hoje?' : 'Cada pedido, bem cuidado.'}</h1><p className="muted">{page === 'agenda' ? 'Tudo organizado para cada encomenda sair com carinho.' : page === 'production' ? 'As quantidades do dia, reunidas para a cozinha.' : 'Consulte o histórico, confira os detalhes e acompanhe cada entrega.'}</p></div>{actions}</div>
            {page !== 'orders' && <section className="date-navigation" aria-label="Escolher data"><div className="date-title"><div><h2>{humanDate(date)}</h2><span className="muted">{humanDate(date, { weekday: 'long' })}</span></div><div className="date-controls"><button className="secondary" onClick={() => setDate(localDateKey())}>Hoje</button><label className="date-picker"><span className="sr-only">Data da agenda</span><input type="date" value={date} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.validity.valid) setDate(e.target.value); }} /></label></div></div><div className="week-strip"><button className="day-arrow" aria-label="Dia anterior" disabled={addDays(date, -1) === date} onClick={() => setDate(addDays(date, -1))}><span className="reverse"><Icon name="arrow" /></span></button>{[...new Set(Array.from({ length: 7 }, (_, i) => addDays(date, i - 3)))].map(d => <button key={d} className={`day ${d === date ? 'selected' : ''}`} aria-pressed={d === date} onClick={() => setDate(d)}><span>{humanDate(d, { weekday: 'short' }).replace('.', '')}</span><strong>{d.slice(-2)}</strong><span className="day-dot" data-active={orders.some(o => o.date === d && o.status !== 'cancelled')} /></button>)}<button className="day-arrow" aria-label="Próximo dia" disabled={addDays(date, 1) === date} onClick={() => setDate(addDays(date, 1))}><Icon name="arrow" /></button></div></section>}
            {page !== 'orders' && <div className="daily-line"><span><strong>{liveDay.length}</strong> encomenda{liveDay.length === 1 ? '' : 's'}</span><span>{liveDay.filter(o => o.fulfillment === 'pickup').length} para retirar</span><span>{liveDay.filter(o => o.fulfillment === 'delivery').length} para entregar</span><span className="daily-balance">Saldo a receber <strong>{formatMoney(pendingBalance)}</strong></span></div>}
            <div className={`content-grid ${page === 'orders' ? 'full-width' : ''}`}>
              <section className="order-board" aria-label={page === 'production' ? 'Lista de produção' : 'Lista de encomendas'}>
                {page === 'production' ? <><div className="section-heading"><h2>Lista da cozinha</h2><span>{kitchen.length} pedidos confirmados</span></div><p className="muted">Confirmados, em produção e prontos. Pedidos a confirmar, cancelados e entregues ficam de fora.</p>{production.size ? <ul className="production-list">{[...production.entries()].map(([key, item]) => <li key={key}><span>{item.description}</span><strong>{Number(item.quantity.toFixed(3)).toLocaleString('pt-BR')} <small>{item.unit}</small></strong></li>)}</ul> : <Empty title="A cozinha está em dia." text="As encomendas confirmadas para esta data aparecerão aqui, com as quantidades para preparar." />}</> : <>
                  <div className="section-heading"><h2>{page === 'orders' ? 'Todas as encomendas' : 'Encomendas do dia'}</h2><span>{visible.length} {visible.length === 1 ? 'pedido' : 'pedidos'}</span></div>
                  <div className="filters"><label className="search"><Icon name="search" /><span className="sr-only">Buscar encomenda</span><input type="search" placeholder="Buscar cliente, produto ou número" value={query} onChange={e => setQuery(e.target.value)} /></label><label><span className="sr-only">Filtrar andamento</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos os andamentos</option>{Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
                  {visible.length ? <div className="orders-list">{visible.map(order => { const money = calculateOrder(order.lines, order.receivedCents); return <article className={`order-row ${order.status === 'cancelled' ? 'cancelled' : ''}`} key={order.id}>
                    <div className="order-time"><strong>{order.time}</strong><span>{page === 'orders' ? humanDate(order.date, { day: '2-digit', month: 'short' }) : order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</span></div>
                    <div className="order-body"><div className="order-name"><button className="name-button" disabled={busy} onClick={() => beginEdit(order)}>{order.customer}</button><span className={`stage stage-${order.status}`}>{stages[order.status]}</span></div><p>{order.lines.map(l => `${l.quantity.toLocaleString('pt-BR')} ${l.unit} · ${l.description}`).join(' / ')}</p><div className="order-meta"><span>#{String(order.number).padStart(3, '0')}</span><span>{money.balanceCents === 0 ? 'Pagamento anotado' : money.depositDueCents > 0 ? `Sinal pendente ${formatMoney(money.depositDueCents)}` : 'Sinal anotado'}</span>{page === 'orders' && <span>{order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</span>}</div><div className="row-actions"><label><span className="sr-only">Andamento de {order.customer}</span><select aria-label={`Andamento de ${order.customer}`} disabled={!!storageError || busy || statusOptions(order).length < 2} value={order.status} onChange={e => updateStatus(order, e.target.value as OrderStatus)}>{statusOptions(order).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="quiet" disabled={busy} onClick={() => beginEdit(order)}>{canEdit ? "Ver / editar" : "Ver ficha"}</button><button className="quiet" onClick={() => { setPrintOrder(order); setTimeout(() => window.print(), 100); }}>Imprimir ficha</button></div></div>
                    <div className="order-price"><strong>{formatMoney(money.totalCents)}</strong><span>{money.balanceCents ? `Falta ${formatMoney(money.balanceCents)}` : 'Sem saldo pendente'}</span></div>
                  </article>; })}</div> : <Empty title={query || status !== 'all' ? 'Nenhuma encomenda encontrada.' : 'Um dia pronto para receber pedidos.'} text={query || status !== 'all' ? 'Experimente outro nome ou altere o filtro de andamento.' : 'Cadastre a primeira encomenda. Data, itens e pagamentos ficam juntos, do seu jeito.'}>{!query && status === 'all' && actions}{!shared && orders.length === 0 && !storageError && <button className="quiet example-button" onClick={examples}>Conhecer com exemplos fictícios</button>}</Empty>}
                </>}
              </section>
              {page !== 'orders' && <aside className="day-summary"><Icon name="cake" size={28} /><h2>Para preparar<br />com calma.</h2><p>O resumo da cozinha reúne os itens das encomendas confirmadas para este dia.</p>{production.size ? <ul>{[...production.entries()].slice(0, 6).map(([key, item]) => <li key={key}><span>{item.description}</span><strong>{Number(item.quantity.toFixed(3)).toLocaleString('pt-BR')} {item.unit}</strong></li>)}</ul> : <p className="summary-empty">Ainda não há itens confirmados nesta data.</p>}{page !== 'production' && <button className="summary-link" onClick={() => navigate('production')}>Abrir lista de produção <Icon name="arrow" size={16} /></button>}<div className="deposit-note"><strong>Um cuidado com os pagamentos</strong><p>O sinal previsto é de 50%. Os valores recebidos são anotados por você, após conferir o pagamento.</p></div></aside>}
            </div>
          </>}
          <footer className="data-footer">{shared ? <><p><strong>Pedidos compartilhados com a equipe.</strong>Atualização a cada 10 segundos enquanto a página estiver aberta. Recebimentos são anotações manuais.</p>{shared.staff.role === "owner" && <button className="quiet" disabled={busy || !!shared.syncError || !shared.lastSynced} onClick={exportBackup}>Exportar backup</button>}</> : <><p><strong>Seus dados ficam neste navegador.</strong> Esta prévia não sincroniza entre aparelhos. Exporte uma cópia para guardar.</p><div><button className="quiet" onClick={exportBackup}>{storageError ? 'Exportar dados originais' : 'Exportar backup'}</button><button className="quiet" disabled={!!storageError && !recoveryExported} onClick={() => file.current?.click()}>Restaurar backup</button><input ref={file} tabIndex={-1} type="file" accept="application/json,.json" className="sr-only" aria-label="Arquivo de backup" onChange={importBackup} /></div></>}</footer>
        </main>
      </div>
    </div>
    {printOrder && <PrintSheet order={printOrder} />}
  </>;
}
function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="orders" size={32} /></div><h3>{title}</h3><p>{text}</p><div className="empty-actions">{children}</div></div>;
}
function OrderDetails({ order, onClose }: { order: Order; onClose: () => void }) {
  const money = calculateOrder(order.lines, order.receivedCents);
  return <section className="order-details">
    <div className="page-heading"><div><h1>Encomenda #{order.number}</h1><p>{order.customer} · {humanDate(order.date)} · {order.time}</p></div><button className="secondary" onClick={onClose}>Voltar à agenda</button></div>
    <p>{order.fulfillment === 'delivery' ? `Entrega: ${order.address}` : 'Retirada na loja'}{order.phone && ` · ${order.phone}`}</p>
    <p>Andamento: {stages[order.status]}</p>
    <ul className="production-list">{order.lines.map(line => <li key={line.id}><span>{line.quantity.toLocaleString('pt-BR')} {line.unit} · {line.description}</span><strong>{formatMoney(calculateOrder([line]).totalCents)}</strong></li>)}</ul>
    <p>Total: <strong>{formatMoney(money.totalCents)}</strong> · Recebido, anotado manualmente: {formatMoney(order.receivedCents)} · Saldo: {formatMoney(money.balanceCents)}</p>
    {order.notes && <p className="preserve-lines">{order.notes}</p>}
    <p className="muted">Seu acesso permite consultar valores e atualizar a produção. Alterações do pedido e recebimentos ficam com o atendimento.</p>
  </section>;
}
function PrintSheet({ order }: { order: Order }) {
  const money = calculateOrder(order.lines, order.receivedCents);
  return <section className="print-sheet"><header><img src="/brand/saint-cakes.png" alt="Saint Cakes" /><div><h1>Ficha de encomenda #{String(order.number).padStart(3, '0')}</h1><p>{humanDate(order.date)} · {order.time} · {order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</p></div></header><h2>{order.customer}</h2>{order.phone && <p>Contato: {order.phone}</p>}{order.fulfillment === 'delivery' && <p>Endereço: {order.address}</p>}<p>Andamento: {stages[order.status]}</p><table><thead><tr><th>Descrição</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{order.lines.map(l => <tr key={l.id}><td>{l.description}</td><td>{l.quantity.toLocaleString('pt-BR')} {l.unit}</td><td>{formatMoney(l.unitPriceCents)}</td><td>{formatMoney(calculateOrder([l]).totalCents)}</td></tr>)}</tbody></table><div className="print-totals"><p>Total <strong>{formatMoney(money.totalCents)}</strong></p><p>Sinal previsto (50%) <strong>{formatMoney(money.depositCents)}</strong></p><p>Recebido, anotado manualmente <strong>{formatMoney(order.receivedCents)}</strong></p><p>Saldo a receber <strong>{formatMoney(money.balanceCents)}</strong></p></div>{order.notes && <><h3>Observações</h3><p className="preserve-lines">{order.notes}</p></>}<p className="print-disclaimer">Ficha de organização de encomenda. Valores recebidos anotados manualmente; não é comprovante bancário ou documento fiscal.</p></section>;
}
