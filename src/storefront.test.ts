import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStorefront, saintStorefront, storefrontProblem } from './storefront.ts';
import { loadPrefs, loadPrinted, savePrefs, savePrinted } from './printing.ts';

test('a new shop can have an empty catalog and no Saint assets', () => {
  const shop = parseStorefront({ name: 'Padaria Fictícia', tagline: '', whatsapp: '', logoUrl: '', heroUrl: '', theme: 'forest', catalog: [], revision: 1 });
  assert.deepEqual(shop.catalog, []);
  assert.equal(shop.logoUrl, '');
  assert.equal(JSON.stringify(shop).includes('Saint'), false);
  assert.equal(saintStorefront.catalog.length, 26);
});
test('malformed storefront data and unsafe image schemes fail closed', () => {
  for (const value of [null, [], {}, { ...saintStorefront, catalog: [null] }, { ...saintStorefront, theme: 'unknown' }, { ...saintStorefront, logoUrl: 'javascript:alert(1)' }, { ...saintStorefront, heroUrl: 'https://user:secret@example.com/image.jpg' }, { ...saintStorefront, revision: 1.5 }, { ...saintStorefront, catalog: [saintStorefront.catalog[0], saintStorefront.catalog[0]] }]) assert.throws(() => parseStorefront(value));
  assert.equal(storefrontProblem({ ...saintStorefront, logoUrl: 'https://example.com/logo.png' }), null);
});
test('printer preferences and printed-order logs never transfer between shops', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } as unknown as Storage;
  savePrefs({ paper: '58', autoKitchen: true }, storage, 'saint-cakes');
  savePrinted({ order: '2026-10-23T12:00:00Z' }, storage, 'saint-cakes');
  assert.deepEqual(loadPrefs(storage, 'padaria-ficticia'), { paper: '80', autoKitchen: false });
  assert.deepEqual(loadPrinted(storage, 'padaria-ficticia'), {});
  assert.deepEqual(loadPrefs(storage, 'local-demo'), { paper: '80', autoKitchen: false });
  savePrefs({ paper: '80', autoKitchen: false }, storage, 'padaria-ficticia');
  assert.equal(loadPrefs(storage, 'saint-cakes').autoKitchen, true);
  assert.deepEqual(loadPrinted(storage, 'saint-cakes'), { order: '2026-10-23T12:00:00Z' });
});
