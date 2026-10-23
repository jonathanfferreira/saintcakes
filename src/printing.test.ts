import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPrefs, newlyConfirmed, prunePrinted, savePrefs, seedPrinted } from './printing.ts';
import type { OrderStatus } from './domain';

const order = (id: string, status: OrderStatus, date = '2026-10-24', time = '15:00') => ({ id, status, date, time });

test('newlyConfirmed returns unprinted confirmed orders in time order', () => {
  const orders = [order('b', 'confirmed', '2026-10-24', '16:00'), order('a', 'confirmed', '2026-10-24', '09:00'), order('c', 'pending'), order('d', 'preparing'), order('e', 'confirmed')];
  assert.deepEqual(newlyConfirmed(orders, { e: '2026-10-23T10:00:00.000Z' }).map(item => item.id), ['a', 'b']);
});

test('seedPrinted marks everything past confirmation so enabling auto-print prints nothing old', () => {
  const now = new Date('2026-10-23T12:00:00.000Z');
  const seeded = seedPrinted([order('a', 'confirmed'), order('b', 'pending'), order('c', 'ready'), order('d', 'cancelled')], { z: '2026-10-20T00:00:00.000Z' }, now);
  assert.deepEqual(Object.keys(seeded).sort(), ['a', 'c', 'z']);
  assert.equal(seeded.z, '2026-10-20T00:00:00.000Z');
  assert.deepEqual(newlyConfirmed([order('a', 'confirmed'), order('n', 'confirmed')], seeded).map(item => item.id), ['n']);
});

test('prunePrinted keeps two weeks of history', () => {
  const now = new Date('2026-10-23T12:00:00.000Z');
  assert.deepEqual(prunePrinted({ old: '2026-10-08T11:59:00.000Z', edge: '2026-10-09T12:00:00.000Z', fresh: '2026-10-23T08:00:00.000Z' }, now), { edge: '2026-10-09T12:00:00.000Z', fresh: '2026-10-23T08:00:00.000Z' });
});

test('print preferences fall back safely and persist per device', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } } as unknown as Storage;
  assert.deepEqual(loadPrefs(storage), { paper: '80', autoKitchen: false });
  savePrefs({ paper: '58', autoKitchen: true }, storage);
  assert.deepEqual(loadPrefs(storage), { paper: '58', autoKitchen: true });
  data.set('sc-print-prefs', '{broken');
  assert.deepEqual(loadPrefs(storage), { paper: '80', autoKitchen: false });
  data.set('sc-print-prefs', '{"paper":"100","autoKitchen":"yes"}');
  assert.deepEqual(loadPrefs(storage), { paper: '80', autoKitchen: false });
});
