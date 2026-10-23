import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationMessage, parsePublicSettings, parseSettings, settingsProblem, whatsappLink } from './settings.ts';
import type { Order } from './domain';

const settings = { pixKey: 'chave-ficticia@example.invalid', pixHolder: 'Loja fictícia', minLeadDays: 2, deliveryZones: [{ name: 'Centro', feeCents: 1000 }] };
const order: Order = {
  id: 'o-1', number: 7, customer: '  Ana Souza ', phone: '(47) 90000-0001', date: '2026-10-24', time: '15:00', fulfillment: 'pickup', address: '', notes: '',
  lines: [{ id: 'a', description: 'Bolo fictício', quantity: 1.5, unit: 'kg', unitPriceCents: 8900 }, { id: 'b', description: 'Brinde', quantity: 1, unit: 'un', unitPriceCents: 0 }],
  receivedCents: 0, status: 'pending', createdAt: '2026-10-22T12:00:00.000Z',
};

test('parseSettings accepts server data and rejects malformed values', () => {
  assert.deepEqual(parseSettings(settings), settings);
  assert.deepEqual(parsePublicSettings({ minLeadDays: 0, deliveryZones: [] }), { minLeadDays: 0, deliveryZones: [] });
  assert.throws(() => parseSettings({ ...settings, pixKey: 1 }));
  assert.throws(() => parsePublicSettings({ minLeadDays: 31, deliveryZones: [] }));
  assert.throws(() => parsePublicSettings({ minLeadDays: 2, deliveryZones: [{ name: 'X', feeCents: 1.5 }] }));
});

test('settingsProblem mirrors the server limits', () => {
  assert.equal(settingsProblem(settings), null);
  assert.match(settingsProblem({ ...settings, minLeadDays: 31 })!, /antecedência/);
  assert.match(settingsProblem({ ...settings, deliveryZones: [{ name: 'Centro', feeCents: 1 }, { name: 'centro', feeCents: 2 }] })!, /duas vezes/);
  assert.match(settingsProblem({ ...settings, deliveryZones: [{ name: ' Centro', feeCents: 1 }] })!, /nome/);
  assert.match(settingsProblem({ ...settings, deliveryZones: [{ name: 'Centro', feeCents: 100_001 }] })!, /frete/);
});

test('confirmationMessage asks for the deposit with Pix when nothing was paid', () => {
  const text = confirmationMessage(order, settings);
  assert.match(text, /^Olá, Ana! Aqui é da Saint Cakes\./);
  assert.match(text, /#007 para sábado, 24\/10 às 15:00 \(retirada na loja\)/);
  assert.match(text, /• 1,5 kg Bolo fictício — R\$\s133,50/);
  assert.match(text, /• 1 un Brinde\n/);
  assert.match(text, /Sinal de 50%: R\$\s66,75\nPix: chave-ficticia@example\.invalid \(Loja fictícia\)/);
});

test('confirmationMessage adapts to partial, deposit and full payment', () => {
  assert.match(confirmationMessage({ ...order, receivedCents: 5000 }, settings), /recebido R\$\s50,00, falta R\$\s16,75/);
  assert.match(confirmationMessage({ ...order, receivedCents: 6675, fulfillment: 'delivery', address: 'Rua fictícia, 1' }, settings), /entrega em Rua fictícia, 1[\s\S]*Saldo de R\$\s66,75 na entrega/);
  assert.match(confirmationMessage({ ...order, receivedCents: 13350 }, { pixKey: '', pixHolder: '' }), /Pagamento recebido/);
  assert.doesNotMatch(confirmationMessage(order, { pixKey: '', pixHolder: '' }), /Pix:/);
});

test('whatsappLink adds Brazil code and encodes text', () => {
  assert.equal(whatsappLink('(47) 90000-0001'), 'https://wa.me/5547900000001');
  assert.equal(whatsappLink('+55 47 90000-0001', 'Olá & até'), 'https://wa.me/5547900000001?text=Ol%C3%A1%20%26%20at%C3%A9');
  assert.equal(whatsappLink('1234'), null);
});
