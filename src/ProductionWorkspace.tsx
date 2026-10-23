import { useState } from 'react';
import { addDays, localDateKey } from './domain';
import type { OrderStatus } from './domain';
import type { ProductionRecord } from './shared';
import Comanda from './Comanda';

export default function ProductionWorkspace({ records, busy, updateStatus }: { records: ProductionRecord[]; busy: boolean; updateStatus: (record: ProductionRecord, status: OrderStatus) => Promise<void> }) {
  const [date, setDate] = useState(localDateKey);
  const [error, setError] = useState('');
  const orders = records.filter(({ order }) => order.date === date && !['cancelled', 'delivered'].includes(order.status)).sort((a, b) => a.order.time.localeCompare(b.order.time));
  async function advance(record: ProductionRecord, status: OrderStatus) {
    setError('');
    try { await updateStatus(record, status); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o pedido.'); }
  }
  const today = localDateKey();
  const base = date || today;
  const heading = new Date(`${base}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return <main className="shared-production"><header className="shared-production-bar"><img src="/brand/saint-cakes.png" alt="Saint Cakes" width="56" height="56" /><h1>Produção</h1>
    <div className="shared-day" role="group" aria-label="Data dos pedidos"><button type="button" className="sc-btn sc-btn-secondary" onClick={() => setDate(addDays(base, -1))}>Dia anterior</button><button type="button" className="sc-btn sc-btn-secondary" disabled={date === today} onClick={() => setDate(today)}>Hoje</button><button type="button" className="sc-btn sc-btn-secondary" onClick={() => setDate(addDays(base, 1))}>Próximo dia</button><label className="sc-field"><span className="shared-sr">Data dos pedidos</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div></header>
    <p className="shared-day-title" aria-live="polite">{heading}</p>
    {error && <p role="alert" className="sc-alert">{error}</p>}
    {!orders.length && <p className="shared-empty">Nenhuma encomenda nesta data.</p>}
    {orders.length > 0 && <div className="sc-comandas">{orders.map(record => <Comanda key={record.order.id} order={record.order} busy={busy} onAdvance={next => void advance(record, next)} />)}</div>}
  </main>;
}
