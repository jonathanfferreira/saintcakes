import { useState } from 'react';
import { formatMoney } from './domain';
import type { Order } from './domain';
import { stageLabels } from './Comanda';
import { customers, monthSummary, overdueBalances, pendingDeposits, revenueByMonth, shiftMonth, topProducts, upcoming } from './metrics';
import './Dashboard.css';

const monthName = (month: string, options: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }) => {
  const text = new Intl.DateTimeFormat('pt-BR', options).format(new Date(`${month}-15T12:00:00`));
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
};
const shortDate = (key: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${key}T12:00:00`)).replace('.', '');
const whatsapp = (phone: string) => { const digits = phone.replace(/\D/g, ''); return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`; };

type Props = { orders: Order[]; today: string; requestCount: number | null; onOpen: (order: Order) => void; onRequests: () => void };

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={dir === 'left' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} /></svg>;
}

export function Dashboard({ orders, today, requestCount, onOpen, onRequests }: Props) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const summary = monthSummary(orders, month);
  const series = revenueByMonth(orders, month, 6);
  const peak = Math.max(1, ...series.map(item => item.totalCents));
  const products = topProducts(orders, month);
  const deposits = pendingDeposits(orders, today);
  const overdue = overdueBalances(orders, today);
  const next = upcoming(orders, today, 7);
  const receivedShare = summary.totalCents ? Math.min(100, Math.round(summary.receivedCents / summary.totalCents * 100)) : 0;
  return <section className="dash" aria-labelledby="dashboard-title">
    <header className="dash-head"><div><h1 id="dashboard-title">Painel</h1><p>Pedidos e valores pela data de entrega. Cancelados ficam fora dos totais.</p></div>
      <div className="month-switch" role="group" aria-label="Mês do painel"><button className="sc-btn sc-btn-secondary month-step" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}><Chevron dir="left" /></button><strong>{monthName(month)}</strong><button className="sc-btn sc-btn-secondary month-step" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}><Chevron dir="right" /></button>{month !== today.slice(0, 7) && <button className="sc-btn sc-btn-quiet" onClick={() => setMonth(today.slice(0, 7))}>Mês atual</button>}</div></header>

    <p className="dash-summary">
      <span>Faturamento previsto <strong className="sc-money">{formatMoney(summary.totalCents)}</strong><small>{summary.count} encomenda{summary.count === 1 ? '' : 's'}{summary.cancelled ? `, ${summary.cancelled} cancelada${summary.cancelled === 1 ? '' : 's'}` : ''}</small></span>
      <span>recebido <strong className="sc-money">{formatMoney(summary.receivedCents)}</strong>{summary.totalCents ? <small>({receivedShare}%)</small> : null}</span>
      <span>a receber <strong className="sc-money">{formatMoney(summary.balanceCents)}</strong></span>
      <span>ticket médio <strong className="sc-money">{formatMoney(summary.averageCents)}</strong></span>
      <span>{summary.pickup} retirada{summary.pickup === 1 ? '' : 's'}, {summary.delivery} entrega{summary.delivery === 1 ? '' : 's'}</span>
    </p>
    {requestCount !== null && requestCount > 0 && <div className="site-row"><span>Pedidos do site: <strong className="sc-num">{requestCount}</strong> aguardando</span><button className="sc-btn sc-btn-primary" onClick={onRequests}>Conferir agora</button></div>}

    <div className="dash-cols dash-cols-even">
      <article className="sc-card panel">
        <h2>Sinais pendentes <span className="count">{deposits.length}</span></h2>
        <p className="hint">Próximas encomendas sem os 50% anotados.</p>
        <MoneyList items={deposits.map(item => ({ order: item.order, cents: item.depositDueCents, label: 'falta de sinal' }))} onOpen={onOpen} empty="Todos os sinais das próximas encomendas estão anotados." />
      </article>
      <article className="sc-card panel">
        <h2>Saldos em aberto <span className="count">{overdue.length}</span></h2>
        <p className="hint">Encomendas entregues ou com data passada que ainda têm saldo.</p>
        <MoneyList items={overdue.map(item => ({ order: item.order, cents: item.balanceCents, label: 'a receber' }))} onOpen={onOpen} empty="Nenhum saldo atrasado." />
      </article>
    </div>

    <article className="sc-card panel">
      <h2>Próximos 7 dias <span className="count">{next.length}</span></h2>
      {next.length ? <ul className="next-list">{next.map(order => <li key={order.id}><time className="sc-num" dateTime={order.date}><b>{shortDate(order.date)}</b>{order.time}</time><button className="name-link" onClick={() => onOpen(order)}>{order.customer}</button><span className="next-items">{order.lines.map(line => line.description).join(', ')}</span><span className="next-tags"><span className={`sc-stage sc-stage-${order.status}`}>{stageLabels[order.status]}</span><span className="how">{order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</span></span></li>)}</ul> : <p className="empty">Nada agendado para a próxima semana.</p>}
    </article>

    <div className="dash-cols">
      <article className="sc-card panel">
        <h2>Faturamento por mês</h2>
        <div className="bars" role="img" aria-label={`Faturamento dos últimos 6 meses até ${monthName(month)}`}>
          {series.map(item => <div key={item.month} className={`bar ${item.month === month ? 'current' : ''}`} tabIndex={0} aria-label={`${monthName(item.month)}: ${formatMoney(item.totalCents)}, ${item.count} encomenda${item.count === 1 ? '' : 's'}`}>
            <span className="bar-tip">{formatMoney(item.totalCents)} · {item.count} pedido{item.count === 1 ? '' : 's'}</span>
            {item.month === month && <span className="bar-value">{formatMoney(item.totalCents)}</span>}
            <span className="bar-fill" style={{ height: `${item.totalCents ? Math.max(2, item.totalCents / peak * 100) : 0}%` }} />
            <span className="bar-label">{monthName(item.month, { month: 'short' }).replace('.', '')}</span>
          </div>)}
        </div>
        <table className="sr-only"><caption>Faturamento por mês</caption><thead><tr><th>Mês</th><th>Faturamento</th><th>Encomendas</th></tr></thead><tbody>{series.map(item => <tr key={item.month}><td>{monthName(item.month)}</td><td>{formatMoney(item.totalCents)}</td><td>{item.count}</td></tr>)}</tbody></table>
      </article>
      <article className="sc-card panel">
        <h2>Mais vendidos no mês</h2>
        {products.length ? <ol className="ranking">{products.map(item => <li key={`${item.description}|${item.unit}`}><span>{item.description}<small>{Number(item.quantity.toFixed(3)).toLocaleString('pt-BR')} {item.unit}</small></span><strong className="sc-money">{formatMoney(item.totalCents)}</strong></li>)}</ol> : <p className="empty">Nenhuma venda neste mês.</p>}
      </article>
    </div>
  </section>;
}

function MoneyList({ items, onOpen, empty }: { items: { order: Order; cents: number; label: string }[]; onOpen: (order: Order) => void; empty: string }) {
  if (!items.length) return <p className="empty">{empty}</p>;
  return <ul className="money-list">{items.slice(0, 8).map(({ order, cents, label }) => <li key={order.id}>
    <span><button className="name-link" onClick={() => onOpen(order)}>{order.customer}</button><small>#{String(order.number).padStart(3, '0')} · {shortDate(order.date)}{order.phone && <> · <a href={whatsapp(order.phone)} target="_blank" rel="noreferrer">WhatsApp</a></>}</small></span>
    <strong className="sc-money">{formatMoney(cents)}<small>{label}</small></strong>
  </li>)}{items.length > 8 && <li className="more">+{items.length - 8} outras</li>}</ul>;
}

export function Customers({ orders, today, onShowOrders }: { orders: Order[]; today: string; onShowOrders: (query: string) => void }) {
  const [query, setQuery] = useState('');
  const all = customers(orders, today);
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const list = all.filter(customer => !needle || `${customer.name} ${customer.phone}`.toLocaleLowerCase('pt-BR').includes(needle));
  const returning = all.filter(customer => customer.orders > 1).length;
  return <section className="dash" aria-labelledby="customers-title">
    <header className="dash-head"><div><h1 id="customers-title">Clientes</h1><p>Reunidos pelo telefone das encomendas (ou pelo nome, quando não há telefone).</p></div></header>
    <p className="dash-summary cust-summary"><span><strong className="sc-num">{all.length}</strong> cliente{all.length === 1 ? '' : 's'}</span><span><strong className="sc-num">{returning}</strong> voltaram a comprar</span><span><strong className="sc-num">{all.filter(customer => customer.balanceCents > 0).length}</strong> com saldo em aberto</span></p>
    <label className="sc-field cust-search"><span className="sr-only">Buscar cliente</span><input type="search" placeholder="Buscar por nome ou telefone" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {list.length ? <><div className="sc-card table-wrap"><table className="customer-table">
      <thead><tr><th>Cliente</th><th>Encomendas</th><th>Total comprado</th><th>Em aberto</th><th>Última</th><th>Próxima</th><th><span className="sr-only">Ações</span></th></tr></thead>
      <tbody>{list.map(customer => <tr key={customer.key}>
        <td data-label="Cliente"><span className="customer-cell"><strong>{customer.name}</strong>{customer.phone && <a href={whatsapp(customer.phone)} target="_blank" rel="noreferrer">{customer.phone}</a>}</span></td>
        <td data-label="Encomendas">{customer.orders}{customer.cancelled ? <small> +{customer.cancelled} cancel.</small> : null}</td>
        <td data-label="Total comprado">{formatMoney(customer.totalCents)}</td>
        <td data-label="Em aberto" className={customer.balanceCents ? 'due' : ''}>{customer.balanceCents ? formatMoney(customer.balanceCents) : '—'}</td>
        <td data-label="Última">{customer.lastDate ? shortDate(customer.lastDate) : '—'}</td>
        <td data-label="Próxima">{customer.nextDate ? shortDate(customer.nextDate) : '—'}</td>
        <td className="act"><button className="sc-btn sc-btn-quiet" onClick={() => onShowOrders(customer.phone.replace(/\D/g, '') || customer.name)}>Ver pedidos</button></td>
      </tr>)}</tbody>
    </table></div>
    <ul className="cust-list">{list.map(customer => <li key={customer.key}><button className="cust-row" onClick={() => onShowOrders(customer.phone.replace(/\D/g, '') || customer.name)}>
      <span className="cust-main"><strong>{customer.name}</strong>{customer.phone && <span className="cust-phone">{customer.phone}</span>}<small>última {customer.lastDate ? shortDate(customer.lastDate) : '—'} · próxima {customer.nextDate ? shortDate(customer.nextDate) : '—'}</small></span>
      <span className="cust-money">{customer.balanceCents ? <span className="due">{formatMoney(customer.balanceCents)} em aberto</span> : null}<span className="sc-money">{formatMoney(customer.totalCents)}</span></span>
    </button></li>)}</ul></> : <p className="empty">{all.length ? 'Nenhum cliente encontrado.' : 'Os clientes aparecem aqui conforme as encomendas forem cadastradas.'}</p>}
  </section>;
}
