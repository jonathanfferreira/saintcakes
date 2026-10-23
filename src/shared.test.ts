import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, errorMessage, parseList, parseOrderRecord, parseProductionRecord, parseStaff, parseStaffAccess, publicShopSlug } from './shared.ts';

const publicKey = 'sb_publishable_example_for_local_tests';
const order = {
  id: '18a64144-0921-4bb3-ab56-6165097e762c', number: 1, customer: 'Cliente fictícia', phone: '000000000',
  date: '2026-10-22', time: '14:30', fulfillment: 'pickup', address: '', notes: 'Observação fictícia',
  lines: [{ id: 'line-1', description: 'Produto fictício', quantity: 2, unit: 'un', unitPriceCents: 3000 }],
  receivedCents: 2000, status: 'confirmed', createdAt: '2026-10-22T12:00:00.000Z',
};

test('unconfigured mode is local only when both values are absent', () => {
  assert.deepEqual(configuration(undefined, undefined), { mode: 'local' });
  assert.deepEqual(configuration('', ''), { mode: 'local' });
  assert.equal(configuration('https://example.supabase.co', undefined).mode, 'error');
  assert.equal(configuration(undefined, publicKey).mode, 'error');
});

test('configuration rejects secret keys, legacy JWTs, invalid and unsafe URLs', () => {
  for (const key of ['sb_secret_do_not_use', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake', 'public-key', ' ', 'sb_publishable_']) {
    const result = configuration('https://example.supabase.co', key);
    assert.equal(result.mode, 'error');
    assert.ok(!JSON.stringify(result).includes(key.trim()) || !key.trim());
  }
  for (const url of ['not a URL', 'javascript:alert(1)', 'ftp://example.com', 'http://example.com', 'https://user:password@example.com', 'https://example.com/private', 'https://example.com/?secret=value', 'https://example.com/#token']) {
    const result = configuration(url, publicKey);
    assert.equal(result.mode, 'error', url);
    assert.ok(!JSON.stringify(result).includes(url));
  }
});

test('production projection whitelists fields and strips financial and contact data', () => {
  const result = parseProductionRecord({ order, revision: 3, other: 'discard' });
  assert.deepEqual(Object.keys(result).sort(), ['order', 'revision']);
  assert.deepEqual(Object.keys(result.order).sort(), ['customer', 'date', 'fulfillment', 'id', 'lines', 'notes', 'number', 'status', 'time']);
  assert.deepEqual(result.order.lines, [{ id: 'line-1', description: 'Produto fictício', quantity: 2, unit: 'un' }]);
  assert.equal(result.revision, 3);
  const serialized = JSON.stringify(result);
  for (const key of ['unitPriceCents', 'receivedCents', 'phone', 'address', 'createdAt', 'other']) assert.ok(!serialized.includes(`"${key}"`));
});

test('production decoder rejects invalid dates, stages, quantities, units and revisions', () => {
  const invalidOrders = [null, {}, { ...order, date: '2026-02-30' }, { ...order, time: '25:00' }, { ...order, status: 'unknown' }, { ...order, fulfillment: 'unknown' }, { ...order, customer: 'A' }, { ...order, lines: [] }, { ...order, lines: [{ ...order.lines[0], quantity: 1.5 }] }, { ...order, lines: [{ ...order.lines[0], quantity: Number.NaN }] }, { ...order, lines: [{ ...order.lines[0], unit: 'box' }] }, { ...order, lines: [order.lines[0], order.lines[0]] }];
  for (const value of invalidOrders) assert.throws(() => parseProductionRecord({ order: value, revision: 1 }));
  for (const revision of [0, -1, 1.5, '1', null, Number.NaN]) assert.throws(() => parseProductionRecord({ order, revision }));
  assert.throws(() => parseProductionRecord(null));
});

test('full orders and staff are validated rather than trusted as RPC casts', () => {
  assert.deepEqual(parseOrderRecord({ order, revision: 1 }).order, order);
  assert.throws(() => parseOrderRecord({ order: { ...order, receivedCents: 9000 }, revision: 1 }));
  const staff = { userId: 'user-id', displayName: 'Pessoa fictícia', role: 'production', canViewFinancial: false };
  assert.deepEqual(parseStaff({ ...staff, app_metadata: { role: 'owner' } }), staff);
  assert.deepEqual(parseStaffAccess({ ...staff, active: true }), { ...staff, active: true });
  assert.throws(() => parseStaff({ ...staff, role: 'admin' }));
  assert.throws(() => parseStaff({ ...staff, canViewFinancial: 'true' }));
  assert.throws(() => parseStaffAccess({ ...staff, active: 1 }));
  assert.throws(() => parseList({ rows: [] }, parseStaff));
});

test('known operation errors explain validation, conflict and authorization without exposing raw details', () => {
  assert.match(errorMessage(new Error('INVALID_ORDER')), /Confira os campos/);
  assert.match(errorMessage({ message: 'ORDER_CONFLICT' }), /rascunho continua aberto/);
  assert.match(errorMessage(new Error('ACCESS_DENIED')), /permissão/);
  assert.match(errorMessage(new Error('Aguarde a atualização em andamento.')), /Aguarde/);
  assert.match(errorMessage(new Error('Seu acesso mudou. Entre novamente.')), /Entre novamente/);
  assert.equal(errorMessage(new Error('private database connection details')), errorMessage(undefined));
  assert.ok(!errorMessage(new Error('private database connection details')).includes('private'));
});

test('public order routes name the shop; bare /pedido keeps serving Saint Cakes', () => {
  assert.equal(publicShopSlug('/pedido'), 'saint-cakes');
  assert.equal(publicShopSlug('/pedido/'), 'saint-cakes');
  assert.equal(publicShopSlug('/pedido/doceria-exemplo'), 'doceria-exemplo');
  assert.equal(publicShopSlug('/pedido/doceria-exemplo/'), 'doceria-exemplo');
  for (const team of ['/', '/painel', '/pedidos', '/pedido/Doceria', '/pedido/-x-', '/pedido/a/b', '/pedido/x']) assert.equal(publicShopSlug(team), null, team);
});

test('the signed-in member carries a validated shop; listings may omit it', () => {
  const member = { userId: 'u1', displayName: 'Dona Exemplo', role: 'owner', canViewFinancial: true };
  assert.deepEqual(parseStaff({ ...member, shop: { id: 's1', slug: 'doceria-exemplo', name: 'Doceria Exemplo', status: 'trial' } }).shop, { id: 's1', slug: 'doceria-exemplo', name: 'Doceria Exemplo' });
  assert.equal(parseStaff(member).shop, undefined);
  assert.throws(() => parseStaff({ ...member, shop: { id: '', slug: 'x', name: 'y' } }));
  assert.throws(() => parseStaff({ ...member, shop: null }));
});