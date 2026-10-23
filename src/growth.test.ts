import test from 'node:test';
import assert from 'node:assert/strict';
import { optInCsv, parseCustomerRecord, parseShowcaseItem } from './growth.ts';

const customer = { key: '47980000001', name: 'Cliente fictícia', phone: '+55 47 98000-0001', source: 'site', marketingOptIn: true, optInAt: '2026-10-23T12:00:00Z', optInSource: 'site', notes: '', firstSeen: '2026-10-23T12:00:00Z', lastSeen: '2026-10-23T12:00:00Z', revision: 2 };

test('customer contract preserves consent provenance and optimistic revision', () => {
  const parsed = parseCustomerRecord(customer);
  assert.equal(parsed.revision, 2);
  assert.equal(parsed.optInSource, 'site');
  assert.throws(() => parseCustomerRecord({ ...customer, revision: undefined }));
});

test('showcase contract preserves the exact timestamp including microseconds', () => {
  const item = { id: 'fixture', name: 'Fatia fictícia', description: '', unit: 'un', priceCents: 1500, stock: 2, photoPath: null, active: true, sort: 1, updatedAt: '2026-10-23T12:00:00.123456+00:00' };
  assert.equal(parseShowcaseItem(item).updatedAt, item.updatedAt);
  assert.throws(() => parseShowcaseItem({ ...item, updatedAt: undefined }));
});

test('CSV exports only consented contacts, escapes quotes and neutralizes spreadsheet formulas', () => {
  const rows = ['=HYPERLINK("example.invalid")', '+formula', '-formula', '@formula', '\tformula', '  =formula', 'Nome "fictício"'].map(name => parseCustomerRecord({ ...customer, name }));
  const csv = optInCsv([...rows, parseCustomerRecord({ ...customer, name: 'Sem autorização', marketingOptIn: false })]);
  assert.equal(csv.includes('Sem autorização'), false);
  assert.ok(csv.includes('"\'=HYPERLINK(""example.invalid"")"'));
  for (const name of ['+formula', '-formula', '@formula', '\tformula', '  =formula']) assert.ok(csv.includes(`"'${name}"`));
  assert.ok(csv.includes('"Nome ""fictício"""'));
  assert.ok(csv.includes('"\'+55 47 98000-0001"'));
  assert.ok(csv.includes('"2026-10-23T12:00:00Z","site"'));
});
