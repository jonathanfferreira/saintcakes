import { useMemo, useState } from 'react';
import { addDays, localDateKey } from './domain';
import type { OrderStatus } from './domain';
import type { ProductionRecord } from './shared';
import Comanda from './Comanda';
import { PrintHost, PrinterPanel, printTickets, useKitchenAutoPrint } from './Tickets';
import { loadPrefs } from './printing';
import type { Storefront } from './storefront';

export default function ProductionWorkspace({ storefront, scope, records, busy, updateStatus }: { storefront: Storefront; scope: string; records: ProductionRecord[]; busy: boolean; updateStatus: (record: ProductionRecord, status: OrderStatus) => Promise<void> }) {
  const [date, setDate] = useState(localDateKey);
  const [error, setError] = useState('');
  const [printPrefs, setPrintPrefs] = useState(() => loadPrefs(undefined, scope));
  const all = useMemo(() => records.map(record => record.order), [records]);
  useKitchenAutoPrint(all, printPrefs.autoKitchen, scope);
  const orders = records.filter(({ order }) => order.date === date && !['cancelled', 'delivered'].includes(order.status)).sort((a, b) => a.order.time.localeCompare(b.order.time));
  async function advance(record: ProductionRecord, status: OrderStatus) {
    setError('');
    try { await updateStatus(record, status); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o pedido.'); }
  }
  const today = localDateKey();
  const base = date || today;
  const heading = new Date(`${base}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return <main className="shared-production"><header className="shared-production-bar">{storefront.logoUrl && <img src={storefront.logoUrl} alt={storefront.name} width="56" height="56" />}<span>{storefront.name}</span><h1>Produção</h1>
    <div className="shared-day" role="group" aria-label="Data dos pedidos"><button type="button" className="sc-btn sc-btn-secondary" onClick={() => setDate(addDays(base, -1))}>Dia anterior</button><button type="button" className="sc-btn sc-btn-secondary" disabled={date === today} onClick={() => setDate(today)}>Hoje</button><button type="button" className="sc-btn sc-btn-secondary" onClick={() => setDate(addDays(base, 1))}>Próximo dia</button><label className="sc-field"><span className="shared-sr">Data dos pedidos</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div></header>
    <p className="shared-day-title" aria-live="polite">{heading}</p>
    <PrinterPanel scope={scope} prefs={printPrefs} orders={all} onChange={setPrintPrefs} />
    {error && <p role="alert" className="sc-alert">{error}</p>}
    {!orders.length && <p className="shared-empty">Nenhuma encomenda nesta data.</p>}
    {orders.length > 0 && <div className="sc-comandas">{orders.map(record => <Comanda key={record.order.id} order={record.order} busy={busy} onAdvance={next => void advance(record, next)} onPrint={() => printTickets([{ kind: 'kitchen', order: record.order }])} />)}</div>}
    <PrintHost name={storefront.name} scope={scope} />
  </main>;
}
