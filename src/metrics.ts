import { addDays, calculateOrder, orderMoney } from './domain.ts';
import type { Order } from './domain';

// Orders count toward the month of their civil delivery date. Cancelled orders never count as revenue.
const live = (order: Order) => order.status !== 'cancelled';

export type MonthSummary = { count: number; cancelled: number; totalCents: number; receivedCents: number; balanceCents: number; averageCents: number; pickup: number; delivery: number };
export function monthSummary(orders: Order[], month: string): MonthSummary {
  const inMonth = orders.filter(order => order.date.startsWith(`${month}-`));
  const valid = inMonth.filter(live);
  let totalCents = 0, receivedCents = 0;
  for (const order of valid) { totalCents += orderMoney(order).totalCents; receivedCents += order.receivedCents; }
  return {
    count: valid.length, cancelled: inMonth.length - valid.length, totalCents, receivedCents, balanceCents: totalCents - receivedCents,
    averageCents: valid.length ? Math.round(totalCents / valid.length) : 0,
    pickup: valid.filter(order => order.fulfillment === 'pickup').length, delivery: valid.filter(order => order.fulfillment === 'delivery').length,
  };
}

export function shiftMonth(month: string, amount: number): string {
  const [year, value] = month.split('-').map(Number);
  const index = year * 12 + (value - 1) + amount;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}

export function revenueByMonth(orders: Order[], lastMonth: string, months = 6): { month: string; totalCents: number; count: number }[] {
  return Array.from({ length: months }, (_, index) => {
    const month = shiftMonth(lastMonth, index - months + 1);
    const summary = monthSummary(orders, month);
    return { month, totalCents: summary.totalCents, count: summary.count };
  });
}

/** Upcoming live orders whose 50% deposit is still not noted, soonest first. */
export function pendingDeposits(orders: Order[], today: string) {
  return orders.filter(order => live(order) && order.status !== 'delivered' && order.date >= today)
    .map(order => ({ order, ...orderMoney(order) }))
    .filter(item => item.depositDueCents > 0)
    .sort((a, b) => `${a.order.date}${a.order.time}`.localeCompare(`${b.order.date}${b.order.time}`));
}

/** Delivered or past orders that still have a balance to collect. */
export function overdueBalances(orders: Order[], today: string) {
  return orders.filter(order => live(order) && (order.status === 'delivered' || order.date < today))
    .map(order => ({ order, ...orderMoney(order) }))
    .filter(item => item.balanceCents > 0)
    .sort((a, b) => `${a.order.date}${a.order.time}`.localeCompare(`${b.order.date}${b.order.time}`));
}

export function upcoming(orders: Order[], today: string, days = 7): Order[] {
  const end = addDays(today, days - 1);
  return orders.filter(order => live(order) && order.status !== 'delivered' && order.date >= today && order.date <= end)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

export function topProducts(orders: Order[], month: string, limit = 5) {
  const products = new Map<string, { description: string; unit: string; quantity: number; totalCents: number }>();
  for (const order of orders) {
    if (!live(order) || !order.date.startsWith(`${month}-`)) continue;
    for (const line of order.lines) {
      const key = `${line.description.trim().toLocaleLowerCase('pt-BR')}|${line.unit}`;
      const current = products.get(key) ?? { description: line.description.trim(), unit: line.unit, quantity: 0, totalCents: 0 };
      current.quantity += line.quantity;
      // A single free line (price 0) is valid inside an order but rejected alone by calculateOrder.
      current.totalCents += line.unitPriceCents ? calculateOrder([line]).totalCents : 0;
      products.set(key, current);
    }
  }
  return [...products.values()].sort((a, b) => b.totalCents - a.totalCents || b.quantity - a.quantity).slice(0, limit);
}

export type OrderGroupId = 'late' | 'today' | 'tomorrow' | 'week' | 'later' | 'past';
export const orderGroupLabels: Record<OrderGroupId, string> = { late: 'Atrasadas', today: 'Hoje', tomorrow: 'Amanhã', week: 'Esta semana', later: 'Mais adiante', past: 'Anteriores' };
/**
 * The team's working list: open orders from earlier days stay visible as late until delivered
 * or cancelled; finished past orders move to "Anteriores". Each group is sorted by date and time.
 */
export function groupOrders(orders: Order[], today: string): { id: OrderGroupId; orders: Order[] }[] {
  const tomorrow = addDays(today, 1), weekEnd = addDays(today, 7);
  const groups: Record<OrderGroupId, Order[]> = { late: [], today: [], tomorrow: [], week: [], later: [], past: [] };
  for (const order of orders) {
    const done = order.status === 'delivered' || order.status === 'cancelled';
    const id: OrderGroupId = order.date < today ? (done ? 'past' : 'late') : order.date === today ? 'today' : order.date === tomorrow ? 'tomorrow' : order.date <= weekEnd ? 'week' : 'later';
    groups[id].push(order);
  }
  const byTime = (a: Order, b: Order) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
  return (Object.keys(groups) as OrderGroupId[]).map(id => ({ id, orders: groups[id].sort(id === 'past' ? (a, b) => byTime(b, a) : byTime) }));
}

export type Customer = { key: string; name: string; phone: string; orders: number; cancelled: number; totalCents: number; balanceCents: number; firstDate: string; lastDate: string; nextDate: string | null };
/** Group orders by phone digits, or by name when no phone was recorded. The most recent order names the customer. */
export function customers(orders: Order[], today: string): Customer[] {
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const digits = order.phone.replace(/\D/g, '');
    const key = digits.length >= 8 ? `tel:${digits.slice(-11)}` : `nome:${order.customer.trim().toLocaleLowerCase('pt-BR')}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    const valid = sorted.filter(live);
    let totalCents = 0, balanceCents = 0;
    for (const order of valid) { const money = orderMoney(order); totalCents += money.totalCents; balanceCents += money.balanceCents; }
    const latest = sorted[sorted.length - 1];
    const past = valid.filter(order => order.date <= today);
    return {
      key, name: latest.customer, phone: [...sorted].reverse().find(order => order.phone)?.phone ?? '',
      orders: valid.length, cancelled: sorted.length - valid.length, totalCents, balanceCents,
      firstDate: sorted[0].date, lastDate: past.length ? past[past.length - 1].date : '',
      nextDate: valid.find(order => order.date > today && order.status !== 'delivered')?.date ?? null,
    };
  }).sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, 'pt-BR'));
}
