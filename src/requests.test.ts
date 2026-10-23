import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrder } from './domain.ts';
import { estimate, parseRequestRecord, requestPayload, requestProblem, requestToOrder } from './requests.ts';
import type { OrderRequestInput } from './requests.ts';

const today = '2026-10-22';
const valid: OrderRequestInput = {
  customer: 'Cliente fictícia', phone: '(47) 90000-0000', date: '2026-10-24', time: '15:00', fulfillment: 'pickup', address: '', deliveryZone: '', notes: '',
  lines: [{ description: 'Bolo fictício', quantity: 1.5, unit: 'kg', unitPriceCents: 8900 }],
};

test('requestProblem accepts a complete request and rejects boundary violations', () => {
  assert.equal(requestProblem(valid, today), null);
  assert.equal(requestProblem({ ...valid, date: today }, today), null);
  assert.equal(requestProblem({ ...valid, date: '2027-04-20' }, today), null);
  assert.match(requestProblem({ ...valid, date: '2026-10-21' }, today)!, /data/);
  assert.match(requestProblem({ ...valid, date: '2027-04-21' }, today)!, /data/);
  assert.match(requestProblem({ ...valid, phone: '9999-9999' }, today)!, /WhatsApp/);
  assert.match(requestProblem({ ...valid, customer: ' A ' }, today)!, /nome/);
  assert.match(requestProblem({ ...valid, fulfillment: 'delivery', address: '  ' }, today)!, /endereço/);
  assert.match(requestProblem({ ...valid, lines: [] }, today)!, /item/);
  assert.match(requestProblem({ ...valid, lines: [{ ...valid.lines[0], quantity: 1.0005 }] }, today)!, /quantidade/);
  assert.match(requestProblem({ ...valid, lines: [{ ...valid.lines[0], unit: 'un', quantity: 1.5 }] }, today)!, /quantidade/);
  assert.match(requestProblem({ ...valid, lines: [{ ...valid.lines[0], quantity: Number.NaN }] }, today)!, /quantidade/);
  assert.match(requestProblem({ ...valid, lines: Array.from({ length: 31 }, () => valid.lines[0]) }, today)!, /30 itens/);
});

test('requestProblem applies delivery zones and minimum notice for quoted items', () => {
  const shop = { minLeadDays: 2, deliveryZones: [{ name: 'Centro', feeCents: 1000 }] };
  const delivery = { ...valid, fulfillment: 'delivery' as const, address: 'Rua fictícia, 1' };
  assert.match(requestProblem(delivery, today, shop)!, /bairro/);
  assert.equal(requestProblem({ ...delivery, deliveryZone: 'Centro' }, today, shop), null);
  assert.equal(requestProblem(delivery, today, { ...shop, deliveryZones: [] }), null);
  const quoted = { ...valid, lines: [{ description: 'Personalizado', quantity: 1, unit: 'un' as const, unitPriceCents: 0 }] };
  assert.match(requestProblem({ ...quoted, date: '2026-10-23' }, today, shop)!, /2 dias/);
  assert.equal(requestProblem({ ...quoted, date: '2026-10-24' }, today, shop), null);
  assert.equal(requestProblem({ ...valid, date: today }, today, shop), null);
});

test('estimate totals priced lines, rounds the deposit up and flags quoted items', () => {
  assert.deepEqual(estimate(valid.lines), { totalCents: 13350, depositCents: 6675, quoted: false });
  assert.deepEqual(estimate([{ description: 'Mini fictício', quantity: 3, unit: 'un', unitPriceCents: 295 }]), { totalCents: 885, depositCents: 443, quoted: false });
  assert.deepEqual(estimate([{ description: 'Personalizado', quantity: 1, unit: 'un', unitPriceCents: 0 }]), { totalCents: 0, depositCents: 0, quoted: true });
  assert.equal(estimate([...valid.lines, { description: 'Personalizado', quantity: 1, unit: 'un', unitPriceCents: 0 }]).quoted, true);
});

const record = {
  id: '5f0e8f1e-2d5b-4c8e-9b5e-000000000001', createdAt: '2026-10-22T15:00:00.000Z',
  request: { ...valid, notes: 'Sem lactose', lines: [{ id: 'a', description: 'Bolo fictício', quantity: 1.5, unit: 'kg', unitPriceCents: 8900 }, { id: 'b', description: 'Topo · sob orçamento', quantity: 1, unit: 'un', unitPriceCents: 0 }] },
};

test('parseRequestRecord accepts server rows and rejects malformed ones', () => {
  assert.equal(parseRequestRecord(record).request.lines.length, 2);
  assert.throws(() => parseRequestRecord({ ...record, request: { ...record.request, lines: [] } }));
  assert.throws(() => parseRequestRecord({ ...record, request: { ...record.request, fulfillment: 'drone' } }));
  assert.throws(() => parseRequestRecord({ ...record, request: { ...record.request, customer: 5 } }));
  assert.throws(() => parseRequestRecord(null));
});

test('requestToOrder drafts a pending order that validates once quoted items are priced', () => {
  const draft = requestToOrder(parseRequestRecord(record), '2026-10-22T16:00:00.000Z');
  assert.equal(draft.number, 0);
  assert.equal(draft.status, 'pending');
  assert.equal(draft.receivedCents, 0);
  assert.match(draft.notes, /Sem lactose/);
  assert.equal(draft.lines[0].id, 'a');
  const priced = { ...draft, number: 1, lines: draft.lines.map(line => ({ ...line, unitPriceCents: line.unitPriceCents || 3500 })) };
  assert.equal(validateOrder(priced).lines[1].unitPriceCents, 3500);
});

test('requestPayload sends showcase picks as lines and optional keys only when used', () => {
  const body = requestPayload({ ...valid, showcase: [{ showcaseId: 's-1', quantity: 2 }], couponCode: ' bemvindo10 ', marketingOptIn: true });
  assert.deepEqual(body.lines, [...valid.lines, { showcaseId: 's-1', quantity: 2 }]);
  assert.equal(body.couponCode, 'bemvindo10');
  assert.equal(body.marketingOptIn, true);
  assert.equal('showcase' in body, false);
  const plain = requestPayload(valid);
  assert.equal('couponCode' in plain, false);
  assert.equal('marketingOptIn' in plain, false);
  assert.match(requestProblem({ ...valid, lines: [], showcase: [{ showcaseId: 's-1', quantity: 0 }] }, today)!, /pronta entrega/);
  assert.equal(requestProblem({ ...valid, lines: [], showcase: [{ showcaseId: 's-1', quantity: 1 }] }, today), null);
});

test('a site request with a coupon becomes a discounted draft order', () => {
  const parsed = parseRequestRecord({ ...record, request: { ...record.request, couponCode: 'BEMVINDO10', discountCents: 1335, lines: [{ id: 'a', description: 'Bolo fictício', quantity: 1.5, unit: 'kg', unitPriceCents: 8900, showcaseId: 'x' }] } });
  assert.equal(parsed.request.discountCents, 1335);
  assert.equal('showcaseId' in parsed.request.lines[0], false);
  assert.deepEqual(parsed.reservedLineIds, ['a']);
  const draft = requestToOrder(parsed, '2026-10-23T12:00:00.000Z');
  assert.equal(draft.discountCents, 1335);
  assert.equal(draft.couponCode, 'BEMVINDO10');
  assert.match(draft.notes, /Cupom BEMVINDO10/);
  assert.equal('discountCents' in requestToOrder(parseRequestRecord(record), '2026-10-23T12:00:00.000Z'), false);
});
