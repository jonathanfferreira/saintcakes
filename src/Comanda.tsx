import type { Fulfillment, OrderLine, OrderStatus } from './domain';
import './Comanda.css';

export const stageLabels: Record<OrderStatus, string> = { pending: 'A confirmar', confirmed: 'Confirmado', preparing: 'Em produção', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' };
export type ComandaOrder = { id: string; number: number; customer: string; time: string; fulfillment: Fulfillment; notes: string; status: OrderStatus; lines: Pick<OrderLine, 'id' | 'description' | 'quantity' | 'unit'>[] };
/** The kitchen's next step for an order, or null when the kitchen has nothing to do. */
export const kitchenNext = (status: OrderStatus): OrderStatus | null => status === 'confirmed' ? 'preparing' : status === 'preparing' ? 'ready' : null;

/** A kitchen ticket: time and customer up top, what to make in large type, one action to move it on. */
export default function Comanda({ order, busy, onAdvance, onPrint }: { order: ComandaOrder; busy: boolean; onAdvance?: (next: OrderStatus) => void; onPrint?: () => void }) {
  const next = kitchenNext(order.status);
  return <article className={`sc-comanda sc-comanda-${order.status}`} aria-label={`Comanda ${order.number}, ${order.customer}`}>
    <header><span className="sc-comanda-time sc-num">{order.time}</span><span className="sc-comanda-no sc-num">#{String(order.number).padStart(3, '0')}</span></header>
    <h3>{order.customer}</h3>
    <p className="sc-comanda-meta"><span className={`sc-stage sc-stage-${order.status}`}>{stageLabels[order.status]}</span><span>{order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</span></p>
    <ul>{order.lines.map(line => <li key={line.id}><strong className="sc-num">{line.quantity.toLocaleString('pt-BR')} {line.unit}</strong><span>{line.description.replace(' · linha party', '')}</span></li>)}</ul>
    {order.notes && <p className="sc-comanda-notes">{order.notes}</p>}
    {next && onAdvance && <button type="button" className={`sc-btn ${next === 'ready' ? 'sc-btn-leaf' : 'sc-btn-primary'}`} disabled={busy} onClick={() => onAdvance(next)}>{next === 'preparing' ? 'Começar a produzir' : 'Marcar como pronto'}</button>}
    {onPrint && <button type="button" className="sc-btn sc-btn-quiet sc-comanda-print" onClick={onPrint}>Imprimir comanda</button>}
  </article>;
}
