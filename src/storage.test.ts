import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, load, persist, STORAGE_KEY } from './storage.ts';

test('arquivo incompatível ou inválido não vira lista vazia válida', () => {
  for (const raw of ['{}', '{', '{"version":2,"orders":[]}', '{"version":1,"orders":[{}]}']) assert.throws(() => decode(raw));
});
test('falha ao carregar preserva o valor original', () => {
  const raw = '{invalid';
  const result = load({ getItem: () => raw, setItem: () => { throw Error('não escrever'); } });
  assert.equal(result.raw, raw);
  assert.ok(result.error);
});
test('salvar detecta outra aba antes de escrever', () => {
  let written = false;
  assert.throws(() => persist({ getItem: () => 'alterado', setItem: () => { written = true; } }, [], null), /outra aba/);
  assert.equal(written, false);
});
test('falha de quota não confirma salvamento', () => {
  assert.throws(() => persist({ getItem: () => null, setItem: () => { throw Error('quota'); } }, [], null), /Não foi possível salvar/);
});
test('envelope versionado roundtrip', () => {
  const data = new Map<string, string>();
  const raw = persist({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }, [], null);
  assert.deepEqual(decode(raw), []);
  assert.equal(data.get(STORAGE_KEY), raw);
});
