import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  calculateOrder,
  formatMoney,
  localDateKey,
  orderMoney,
  parseMoney,
  validateOrder,
  type Order,
  type OrderLine,
} from './domain.ts';

const sampleLine: OrderLine = {
  id: 'line-1',
  description: 'Bolo fictício',
  quantity: 1,
  unit: 'un',
  unitPriceCents: 101,
};

function sampleOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    number: 1,
    customer: 'Ana Silva',
    phone: '',
    date: '2024-02-29',
    time: '09:30',
    fulfillment: 'pickup',
    address: '',
    notes: '',
    lines: [sampleLine],
    receivedCents: 0,
    status: 'pending',
    createdAt: '2024-02-28T13:15:00.000Z',
    ...overrides,
  };
}

test('parseMoney aceita decimal brasileiro e decimal com ponto sem símbolo monetário', () => {
  assert.equal(parseMoney('12,50'), 1250);
  assert.equal(parseMoney('12.50'), 1250);
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney(' 0,5 '), 50);
});

test('identificadores de itens repetidos são rejeitados na importação', () => {
  assert.throws(() => validateOrder(sampleOrder({ lines: [sampleLine, { ...sampleLine }] })), /identificadores repetidos/);
});

test('arredondamento de kg deve ser reutilizado na ficha impressa', () => {
  assert.equal(calculateOrder([{ ...sampleLine, unit: 'kg', quantity: 0.036, unitPriceCents: 375 }]).totalCents, 14);
});

test('parseMoney rejeita valores ambíguos, negativos, exponenciais, não finitos e acima de duas casas', () => {
  for (const invalid of ['-1,00', '+1', '1e2', 'NaN', 'Infinity', '1,234', '1.234', '1,2.3', 'R$ 12,50', '']) {
    assert.throws(() => parseMoney(invalid), { name: 'RangeError' }, invalid);
  }
  assert.throws(() => parseMoney('1000000,01'), { name: 'RangeError' });
});

test('formatMoney apresenta centavos como moeda brasileira e valida os limites', () => {
  assert.match(formatMoney(1250), /12,50/);
  assert.match(formatMoney(0), /0,00/);
  assert.match(formatMoney(Number.MAX_SAFE_INTEGER), /90\.071\.992\.547\.409,91/);
  assert.throws(() => formatMoney(-1), { name: 'RangeError' });
  assert.throws(() => formatMoney(1.5), { name: 'RangeError' });
});

test('calculateOrder arredonda cada linha e cobra sinal de metade para cima em total ímpar', () => {
  assert.deepEqual(calculateOrder([sampleLine]), {
    subtotalCents: 101,
    discountCents: 0,
    totalCents: 101,
    depositCents: 51,
    balanceCents: 101,
    depositDueCents: 51,
  });
  assert.deepEqual(calculateOrder([{ ...sampleLine, quantity: 0.005, unit: 'kg', unitPriceCents: 101 }]), {
    subtotalCents: 1,
    discountCents: 0,
    totalCents: 1,
    depositCents: 1,
    balanceCents: 1,
    depositDueCents: 1,
  });
  assert.deepEqual(calculateOrder([sampleLine], 51), {
    subtotalCents: 101,
    discountCents: 0,
    totalCents: 101,
    depositCents: 51,
    balanceCents: 50,
    depositDueCents: 0,
  });
});

test('calculateOrder rejeita total zero, excesso de valor recebido e teto excedido', () => {
  assert.throws(() => calculateOrder([{ ...sampleLine, unitPriceCents: 0 }]), { name: 'RangeError' });
  assert.throws(() => calculateOrder([sampleLine], 102), { name: 'RangeError' });
  assert.throws(() => calculateOrder([{ ...sampleLine, unitPriceCents: 100_000_001 }]), { name: 'RangeError' });
});

test('calculateOrder valida quantidade, unidade, preço e número de itens antes de somar', () => {
  assert.throws(() => calculateOrder([{ ...sampleLine, quantity: -1 }]), /quantidade.*maior que zero/i);
  assert.throws(() => calculateOrder([{ ...sampleLine, unitPriceCents: -1 }]), /preço do item/i);
  assert.throws(() => calculateOrder([{ ...sampleLine, unit: 'box' as OrderLine['unit'] }]), /unidade do item/i);
  assert.throws(() => calculateOrder([{ ...sampleLine, unit: 'un', quantity: 1.25 }]), /deve ser inteira/i);
  assert.throws(() => calculateOrder([{ ...sampleLine, unit: 'kg', quantity: 1.2345 }]), /três casas/i);
  assert.throws(() => calculateOrder([]), /de 1 a 100 itens/i);
  assert.throws(() => calculateOrder(Array.from({ length: 101 }, (_, index) => ({ ...sampleLine, id: `line-${index}` }))), /de 1 a 100 itens/i);
  assert.equal(calculateOrder(Array.from({ length: 100 }, (_, index) => ({ ...sampleLine, id: `line-${index}` }))).totalCents, 10_100);
});

test('localDateKey usa a data civil local para instantes com offsets diferentes', () => {
  for (const instant of [
    new Date('2024-03-01T00:30:00+14:00'),
    new Date('2024-02-29T23:30:00-11:00'),
  ]) {
    const expected = `${String(instant.getFullYear()).padStart(4, '0')}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
    assert.equal(localDateKey(instant), expected);
  }
  assert.throws(() => localDateKey(new Date(Number.NaN)), { name: 'RangeError' });
});

test('addDays lida com ano bissexto, virada de mês/ano e rejeita datas civis inválidas', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2023-12-31', 1), '2024-01-01');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.throws(() => addDays('2023-02-29', 1), { name: 'RangeError' });
  assert.throws(() => addDays('2024-01-01', 1.5), { name: 'RangeError' });
});

test('validateOrder preserva pedido cancelado com anotação manual de pagamento', () => {
  const order = sampleOrder({ status: 'cancelled', receivedCents: 20 });
  assert.deepEqual(validateOrder(order), order);
});

test('validateOrder valida entrega, estados, hora, data e limite de valores', () => {
  assert.equal(validateOrder(sampleOrder({ fulfillment: 'delivery', address: 'Rua A, 10' })).fulfillment, 'delivery');
  for (const invalid of [
    sampleOrder({ fulfillment: 'delivery', address: '  ' }),
    sampleOrder({ time: '24:00' }),
    sampleOrder({ time: '9:30' }),
    sampleOrder({ date: '2023-02-29' }),
    sampleOrder({ receivedCents: 102 }),
    sampleOrder({ lines: [] }),
    sampleOrder({ number: 0 }),
  ]) {
    assert.throws(() => validateOrder(invalid), { name: 'TypeError' });
  }
});

test('validateOrder aplica regras de unidade e quantidade', () => {
  assert.equal(validateOrder(sampleOrder({ lines: [{ ...sampleLine, unit: 'kg', quantity: 1.234 }] })).lines[0].quantity, 1.234);
  for (const line of [
    { ...sampleLine, unit: 'un' as const, quantity: 1.1 },
    { ...sampleLine, unit: 'kg' as const, quantity: 1.2345 },
    { ...sampleLine, quantity: 0 },
    { ...sampleLine, quantity: 10_001 },
  ]) {
    assert.throws(() => validateOrder(sampleOrder({ lines: [line] })), { name: 'TypeError' });
  }
});

test('validateOrder não executa getters e rejeita estruturas malformadas', () => {
  const getterOrder = Object.defineProperty(sampleOrder(), 'customer', { get: () => 'Ana Silva' });
  assert.throws(() => validateOrder(getterOrder), { name: 'TypeError' });
  assert.throws(() => validateOrder(null), { name: 'TypeError' });
  assert.throws(() => validateOrder({ ...sampleOrder(), lines: [null] }), { name: 'TypeError' });
  const sparseLines = [sampleLine];
  delete sparseLines[0];
  assert.throws(() => validateOrder({ ...sampleOrder(), lines: sparseLines }), { name: 'TypeError' });
});

test('desconto de cupom reduz total e sinal, nunca zera o pedido e viaja com o código', () => {
  const big = { ...sampleLine, quantity: 1, unit: 'un' as const, unitPriceCents: 10000 };
  assert.deepEqual(calculateOrder([big], 0, 1000), { subtotalCents: 10000, discountCents: 1000, totalCents: 9000, depositCents: 4500, balanceCents: 9000, depositDueCents: 4500 });
  assert.throws(() => calculateOrder([big], 0, 10000), /zerar/);
  assert.throws(() => calculateOrder([big], 9001, 1000), /recebido/);
  assert.throws(() => calculateOrder([big], 0, -1), { name: 'RangeError' });
  const withCoupon = validateOrder(sampleOrder({ lines: [big], receivedCents: 9000, discountCents: 1000, couponCode: 'BEMVINDO10' }));
  assert.equal(orderMoney(withCoupon).balanceCents, 0);
  assert.equal(withCoupon.couponCode, 'BEMVINDO10');
  assert.equal('discountCents' in validateOrder(sampleOrder({ lines: [big] })), false);
  assert.throws(() => validateOrder(sampleOrder({ lines: [big], discountCents: 1000 })), /Desconto/);
});