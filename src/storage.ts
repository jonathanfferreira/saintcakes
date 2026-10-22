import { validateOrder } from './domain.ts';
import type { Order } from './domain.ts';

export const STORAGE_KEY = 'saint-cakes.orders.v1';
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function encode(orders: Order[]): string {
  return JSON.stringify({ version: 1, orders });
}
export function decode(raw: string): Order[] {
  if (raw.length > 5_000_000) throw new Error('O backup excede o limite de 5 MB.');
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('orders' in data) || !Array.isArray(data.orders) || data.orders.length > 2000) {
    throw new Error('Backup incompatível. Use um arquivo exportado por este aplicativo.');
  }
  const orders = data.orders.map(validateOrder);
  if (new Set(orders.map(o => o.id)).size !== orders.length || new Set(orders.map(o => o.number)).size !== orders.length) throw new Error('O backup contém pedidos ou números repetidos.');
  return orders;
}
export function load(storage: StoragePort): { orders: Order[]; raw: string | null; error: string } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    return { orders: raw ? decode(raw) : [], raw, error: '' };
  } catch {
    return { orders: [], raw, error: 'Os dados locais não puderam ser lidos. Exporte uma cópia de segurança antes de restaurar um backup válido. Nenhum dado foi apagado.' };
  }
}
export function persist(storage: StoragePort, orders: Order[], expectedRaw: string | null): string {
  if (storage.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('Os pedidos mudaram em outra aba. Recarregue esta página antes de salvar para preservar as alterações.');
  const next = encode(orders);
  decode(next);
  try { storage.setItem(STORAGE_KEY, next); }
  catch { throw new Error('Não foi possível salvar neste navegador. Verifique o espaço disponível e exporte uma cópia de segurança.'); }
  return next;
}
export function mergeOrders(current: Order[], incoming: Order[]): Order[] {
  const result = [...current];
  let nextNumber = Math.max(0, ...current.map(o => o.number)) + 1;
  for (const order of incoming) {
    const existing = current.find(o => o.id === order.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(order)) throw new Error(`O pedido ${order.number} tem alterações diferentes. Nada foi importado; preserve os dois backups.`);
      continue;
    }
    const number = result.some(o => o.number === order.number) ? nextNumber++ : order.number;
    nextNumber = Math.max(nextNumber, number + 1);
    result.push({ ...order, number });
  }
  if (result.length > 2000) throw new Error('O limite desta versão local é de 2.000 encomendas.');
  return result;
}
