import { useState } from 'react';
import { localDateKey } from './domain';
import type { OrderStatus } from './domain';
import type { ProductionRecord } from './shared';

export default function ProductionWorkspace({ records, busy, updateStatus }: { records: ProductionRecord[]; busy: boolean; updateStatus: (record: ProductionRecord, status: OrderStatus) => Promise<void> }) {
  const [date, setDate] = useState(localDateKey);
  const [error, setError] = useState('');
  const orders = records.filter(({ order }) => order.date === date && !['cancelled', 'delivered'].includes(order.status)).sort((a, b) => a.order.time.localeCompare(b.order.time));
  async function advance(record: ProductionRecord, status: OrderStatus) {
    setError('');
    try { await updateStatus(record, status); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o pedido.'); }
  }
  return <main className="shared-production"><header><img src="/brand/saint-cakes.png" alt="Saint Cakes" width="80" height="80" /><div><h1>Produção</h1><p>Encomendas e preparo do dia</p></div></header>
    <label>Data dos pedidos<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    {error && <p role="alert" className="error">{error}</p>}
    {!orders.length && <p className="shared-empty">Nenhuma encomenda nesta data.</p>}
    {orders.map(record => { const order = record.order; const next = order.status === 'confirmed' ? 'preparing' : order.status === 'preparing' ? 'ready' : null; return <article className="production-card" key={order.id}><h2>{order.time} · {order.customer}</h2><p>Pedido #{order.number} · {order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'} · {{ pending: 'A confirmar', confirmed: 'Confirmado', preparing: 'Em produção', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' }[order.status]}</p><ul>{order.lines.map(line => <li key={line.id}><strong>{line.quantity} {line.unit}</strong> — {line.description}</li>)}</ul>{order.notes && <p className="production-notes">{order.notes}</p>}{next && <button className="primary" disabled={busy} onClick={() => void advance(record, next)}>{next === 'preparing' ? 'Iniciar produção' : 'Marcar como pronto'}</button>}</article>; })}
  </main>;
}
