import test from 'node:test';
import assert from 'node:assert/strict';
import { customers, groupOrders, monthSummary, overdueBalances, pendingDeposits, revenueByMonth, shiftMonth, topProducts, upcoming } from './metrics.ts';
import type { Order } from './domain';

let sequence = 0;
function order(changes: Partial<Order>): Order {
  sequence += 1;
  return { id: `o-${sequence}`, number: sequence, customer: 'Cliente fictícia', phone: '', date: '2026-10-24', time: '14:00', fulfillment: 'pickup', address: '', notes: '',
    lines: [{ id: 'l', description: 'Bolo fictício', quantity: 1, unit: 'kg', unitPriceCents: 10001 }], receivedCents: 0, status: 'confirmed', createdAt: '2026-10-01T12:00:00.000Z', ...changes };
}

const today = '2026-10-22';
const orders = [
  order({ customer: 'Ana', phone: '(47) 90000-0001', receivedCents: 5001 }),
  order({ customer: 'Ana Souza', phone: '47900000001', date: '2026-10-02', status: 'delivered', receivedCents: 10001 }),
  order({ customer: 'Bia', date: '2026-10-30', status: 'cancelled' }),
  order({ customer: 'Caio', phone: '47 90000-0003', date: '2026-09-15', status: 'delivered', receivedCents: 2000 }),
  order({ customer: 'Dani', date: '2026-11-03', lines: [{ id: 'a', description: 'Mini fictício', quantity: 50, unit: 'un', unitPriceCents: 110 }, { id: 'b', description: 'Brinde', quantity: 1, unit: 'un', unitPriceCents: 0 }] }),
];

test('monthSummary sums live orders of the civil month and counts cancellations apart', () => {
  assert.deepEqual(monthSummary(orders, '2026-10'), { count: 2, cancelled: 1, totalCents: 20002, receivedCents: 15002, balanceCents: 5000, averageCents: 10001, pickup: 2, delivery: 0 });
  assert.equal(monthSummary(orders, '2026-12').averageCents, 0);
});

test('shiftMonth crosses year boundaries', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-10', -12), '2025-10');
});

test('revenueByMonth returns a fixed window ending at the given month', () => {
  assert.deepEqual(revenueByMonth(orders, '2026-11', 3).map(month => [month.month, month.totalCents]), [['2026-09', 10001], ['2026-10', 20002], ['2026-11', 5500]]);
});

test('pending deposits and overdue balances separate future and past money', () => {
  assert.deepEqual(pendingDeposits(orders, today).map(item => [item.order.customer, item.depositDueCents]), [['Dani', 2750]]);
  assert.deepEqual(overdueBalances(orders, today).map(item => [item.order.customer, item.balanceCents]), [['Caio', 8001]]);
  assert.deepEqual(upcoming(orders, today, 7).map(item => item.customer), ['Ana']);
  assert.deepEqual(upcoming(orders, today, 13).map(item => item.customer), ['Ana', 'Dani']);
});

test('topProducts ranks by revenue and tolerates free lines', () => {
  assert.deepEqual(topProducts(orders, '2026-11'), [{ description: 'Mini fictício', unit: 'un', quantity: 50, totalCents: 5500 }, { description: 'Brinde', unit: 'un', quantity: 1, totalCents: 0 }]);
});

test('customers groups by phone digits, names by latest order and ignores cancelled revenue', () => {
  const list = customers(orders, today);
  const ana = list.find(customer => customer.key === 'tel:47900000001')!;
  assert.equal(ana.orders, 2);
  assert.equal(ana.name, 'Ana');
  assert.equal(ana.totalCents, 20002);
  assert.equal(ana.balanceCents, 5000);
  assert.equal(ana.lastDate, '2026-10-02');
  assert.equal(ana.nextDate, '2026-10-24');
  const bia = list.find(customer => customer.name === 'Bia')!;
  assert.deepEqual([bia.orders, bia.cancelled, bia.totalCents, bia.nextDate], [0, 1, 0, null]);
  assert.equal(list[0].key, 'tel:47900000001');
});

test('groupOrders keeps open past orders as late and sorts finished ones newest first', () => {
  const list = [
    order({ customer: 'Hoje tarde', date: '2026-10-22', time: '16:00' }),
    order({ customer: 'Hoje cedo', date: '2026-10-22', time: '09:00' }),
    order({ customer: 'Atrasada', date: '2026-10-20', status: 'confirmed' }),
    order({ customer: 'Entregue antiga', date: '2026-10-10', status: 'delivered' }),
    order({ customer: 'Cancelada recente', date: '2026-10-21', status: 'cancelled' }),
    order({ customer: 'Amanhã', date: '2026-10-23' }),
    order({ customer: 'Semana fim', date: '2026-10-29' }),
    order({ customer: 'Depois', date: '2026-10-30' }),
  ];
  const groups = Object.fromEntries(groupOrders(list, today).map(group => [group.id, group.orders.map(item => item.customer)]));
  assert.deepEqual(groups, { late: ['Atrasada'], today: ['Hoje cedo', 'Hoje tarde'], tomorrow: ['Amanhã'], week: ['Semana fim'], later: ['Depois'], past: ['Cancelada recente', 'Entregue antiga'] });
});