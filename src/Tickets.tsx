import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMoney, lineTotalCents, orderMoney } from './domain';
import type { Order } from './domain';
import type { ComandaOrder } from './Comanda';
import type { ShopSettings } from './settings';
import { loadPrefs, loadPrinted, newlyConfirmed, prunePrinted, savePrefs, savePrinted, seedPrinted } from './printing';
import type { PaperWidth, PrintPrefs } from './printing';
import './Tickets.css';

export type KitchenOrder = ComandaOrder & { date: string };
export type Ticket = { kind: 'kitchen'; order: KitchenOrder } | { kind: 'receipt'; order: Order; shop: Pick<ShopSettings, 'pixKey' | 'pixHolder'> } | { kind: 'test' };

// One print job at a time, shared by every screen that offers printing.
let job: Ticket[] = [];
const listeners = new Set<() => void>();
export function printTickets(tickets: Ticket[]) {
  if (!tickets.length) return;
  job = tickets;
  listeners.forEach(listener => listener());
}

const longDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
const shortLine = (description: string) => description.replace(' · linha party', '');
const qty = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const stamp = () => new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function KitchenTicket({ order, name }: { order: KitchenOrder; name: string }) {
  return <section className="tk">
    <p className="tk-center tk-brand">{name} · COMANDA</p>
    <p className="tk-big tk-center">#{String(order.number).padStart(3, '0')}</p>
    <p className="tk-center tk-strong">{order.fulfillment === 'pickup' ? 'RETIRADA' : 'ENTREGA'} · {order.time}</p>
    <p className="tk-center">{longDate(order.date)}</p>
    <hr />
    <p className="tk-strong">{order.customer}</p>
    <hr />
    <ul className="tk-items">{order.lines.map(line => <li key={line.id}><strong>{qty(line.quantity)} {line.unit}</strong><span>{shortLine(line.description)}</span></li>)}</ul>
    {order.notes && <><hr /><p className="tk-label">OBSERVAÇÕES</p><p className="tk-notes">{order.notes}</p></>}
    <hr />
    <p className="tk-small tk-center">Impresso em {stamp()}</p>
  </section>;
}

function Receipt({ order, shop, name }: { name: string; order: Order; shop: Pick<ShopSettings, 'pixKey' | 'pixHolder'> }) {
  const money = orderMoney(order);
  return <section className="tk">
    <p className="tk-center tk-brand">{name}</p>
    <hr />
    <p className="tk-center tk-strong">COMPROVANTE DE ENCOMENDA #{String(order.number).padStart(3, '0')}</p>
    <p className="tk-center">{order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'} · {longDate(order.date)} · {order.time}</p>
    <hr />
    <p>Cliente: <strong>{order.customer}</strong></p>
    {order.phone && <p>WhatsApp: {order.phone}</p>}
    {order.fulfillment === 'delivery' && <p>Entrega: {order.address}</p>}
    <hr />
    <ul className="tk-items tk-priced">{order.lines.map(line => <li key={line.id}><span>{qty(line.quantity)} {line.unit} {shortLine(line.description)}</span><strong>{line.unitPriceCents ? formatMoney(lineTotalCents(line)) : 'a orçar'}</strong></li>)}</ul>
    <hr />
    <dl className="tk-sums">
      {money.discountCents > 0 && <><div><dt>Subtotal</dt><dd>{formatMoney(money.subtotalCents)}</dd></div><div><dt>Desconto{order.couponCode ? ` (${order.couponCode})` : ''}</dt><dd>− {formatMoney(money.discountCents)}</dd></div></>}
      <div className="tk-total"><dt>TOTAL</dt><dd>{formatMoney(money.totalCents)}</dd></div>
      <div><dt>Sinal (50%)</dt><dd>{formatMoney(money.depositCents)}</dd></div>
      <div><dt>Recebido</dt><dd>{formatMoney(order.receivedCents)}</dd></div>
      <div className="tk-strong"><dt>Saldo a pagar</dt><dd>{formatMoney(money.balanceCents)}</dd></div>
    </dl>
    {money.balanceCents > 0 && shop.pixKey.trim() && <><hr /><p className="tk-center">Pix: <strong>{shop.pixKey.trim()}</strong></p>{shop.pixHolder.trim() && <p className="tk-center tk-small">{shop.pixHolder.trim()}</p>}</>}
    {order.notes && <><hr /><p className="tk-label">OBSERVAÇÕES</p><p className="tk-notes">{order.notes}</p></>}
    <hr />
    <p className="tk-center tk-small">Documento sem valor fiscal. Valores recebidos anotados pela equipe.</p>
    <p className="tk-center tk-small">Obrigado pela preferência! · {stamp()}</p>
  </section>;
}

/** Renders the pending print job outside the app, then opens the browser's print. */
export function PrintHost({ name, scope }: { name: string; scope: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  useEffect(() => {
    const listener = () => setTickets([...job]);
    listeners.add(listener);
    const done = () => { job = []; setTickets([]); };
    window.addEventListener('afterprint', done);
    return () => { listeners.delete(listener); window.removeEventListener('afterprint', done); job = []; };
  }, []);
  useEffect(() => {
    if (!tickets.length) return;
    // Let the tickets paint before the print snapshot.
    const timer = window.setTimeout(() => window.print(), 120);
    return () => clearTimeout(timer);
  }, [tickets]);
  if (!tickets.length) return null;
  const width = loadPrefs(undefined, scope).paper;
  return createPortal(<div className={`sc-print-root tk-paper-${width}`}>
    <style>{`@page{size:${width}mm auto;margin:0}`}</style>
    {tickets.map((ticket, index) => ticket.kind === 'kitchen' ? <KitchenTicket name={name} key={index} order={ticket.order} />
      : ticket.kind === 'receipt' ? <Receipt name={name} key={index} order={ticket.order} shop={ticket.shop} />
      : <section key={index} className="tk"><p className="tk-center tk-brand">{name}</p><p className="tk-center tk-strong">TESTE DE IMPRESSÃO</p><hr /><p>Bobina de {width}mm. Se este texto saiu inteiro e legível, a impressora está pronta.</p><p className="tk-big tk-center">1234567890</p><hr /><p className="tk-center tk-small">{stamp()}</p></section>)}
  </div>, document.body);
}

/**
 * On the device that has the printer, prints a kitchen ticket for each order that becomes
 * confirmed, including those confirmed while the app was closed. Switching auto-print on
 * (PrinterPanel) marks the orders already confirmed, so they are never printed.
 */
export function useKitchenAutoPrint(orders: KitchenOrder[], enabled: boolean, scope: string) {
  useEffect(() => {
    if (!enabled) return;
    const now = new Date();
    const log = loadPrinted(undefined, scope);
    // Entries for orders still on screen survive pruning, so a far-off confirmed order is never reprinted.
    const printed = { ...prunePrinted(log, now), ...Object.fromEntries(orders.filter(order => log[order.id]).map(order => [order.id, log[order.id]])) };
    const fresh = newlyConfirmed(orders, printed);
    for (const order of fresh) printed[order.id] = now.toISOString();
    savePrinted(printed, undefined, scope);
    printTickets(fresh.map(order => ({ kind: 'kitchen', order })));
  }, [orders, enabled, scope]);
}

/** Per-device printer settings shown on the kitchen screens. */
export function PrinterPanel({ scope, prefs, orders, onChange }: { scope: string; prefs: PrintPrefs; orders: KitchenOrder[]; onChange: (prefs: PrintPrefs) => void }) {
  const [open, setOpen] = useState(false);
  function update(next: PrintPrefs) {
    if (next.autoKitchen && !prefs.autoKitchen) savePrinted(seedPrinted(orders, prunePrinted(loadPrinted(undefined, scope), new Date()), new Date()), undefined, scope);
    savePrefs(next, undefined, scope);
    onChange(next);
  }
  return <section className="sc-card tk-panel" aria-labelledby="printer-title">
    <div className="tk-panel-head">
      <div><h2 id="printer-title">Impressora de comandas</h2><p>{prefs.autoKitchen ? `Ligada neste aparelho · bobina ${prefs.paper}mm` : 'Impressão automática desligada neste aparelho'}</p></div>
      <button type="button" className="sc-btn sc-btn-secondary" aria-expanded={open} onClick={() => setOpen(current => !current)}>{open ? 'Fechar' : 'Configurar'}</button>
    </div>
    {open && <div className="tk-panel-body">
      <label className="tk-switch"><input type="checkbox" role="switch" checked={prefs.autoKitchen} onChange={event => update({ ...prefs, autoKitchen: event.target.checked })} /><span><strong>Imprimir comanda quando a encomenda for confirmada</strong><small>Ligue só no computador ou tablet onde a impressora está conectada. Encomendas já confirmadas não são reimpressas.</small></span></label>
      <fieldset className="tk-paper"><legend>Largura da bobina</legend>
        {(['80', '58'] as PaperWidth[]).map(width => <label key={width}><input type="radio" name="paper" checked={prefs.paper === width} onChange={() => update({ ...prefs, paper: width })} />{width}mm{width === '80' ? ' (mais comum)' : ''}</label>)}
      </fieldset>
      <button type="button" className="sc-btn sc-btn-secondary" onClick={() => printTickets([{ kind: 'test' }])}>Imprimir teste</button>
      <details className="tk-help"><summary>Como deixar a impressão sem perguntar nada</summary>
        <ol>
          <li>Instale a impressora térmica no Windows com o driver do fabricante e marque-a como <strong>impressora padrão</strong>.</li>
          <li>Crie um atalho do Google Chrome na área de trabalho e, em Propriedades → Destino, acrescente no final: <code>--kiosk-printing {window.location.origin}</code></li>
          <li>Abra o sistema por esse atalho, entre com a conta da cozinha e deixe a aba de Produção aberta. As comandas saem direto na impressora, sem janela.</li>
          <li>Sem o atalho, a impressão funciona igual, mas o Chrome mostra a janela de impressão e alguém precisa tocar em Imprimir.</li>
        </ol>
      </details>
    </div>}
  </section>;
}
