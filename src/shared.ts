import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, validateOrder } from './domain.ts';
import type { Order, OrderLine, OrderStatus } from './domain';
import type { OrderRequestRecord } from './requests';
import type { ShopSettings } from './settings';

export type Staff = { userId: string; displayName: string; role: 'owner' | 'attendant' | 'production'; canViewFinancial: boolean };
export type OrderRecord = { order: Order; revision: number };
export type ProductionOrder = Pick<Order, 'id' | 'number' | 'customer' | 'date' | 'time' | 'fulfillment' | 'notes' | 'status'> & { lines: Omit<OrderLine, 'unitPriceCents'>[] };
export type ProductionRecord = { order: ProductionOrder; revision: number };
export type StaffAccess = Staff & { active: boolean };
export type SharedMode = { staff: Staff; records: OrderRecord[]; requests: OrderRequestRecord[]; settings: ShopSettings | null; busy: boolean; syncError: string; lastSynced: string | null; save: (order: Order, revision: number | null) => Promise<Order>; updateStatus: (order: Order, revision: number, status: OrderStatus) => Promise<void>; resolveRequest: (id: string, status: 'converted' | 'dismissed') => Promise<void>; saveSettings: (settings: ShopSettings) => Promise<void>; refresh: () => Promise<void> };

export function configuration(url: string | undefined, key: string | undefined): { mode: 'local' } | { mode: 'error'; error: string } | { mode: 'shared'; client: SupabaseClient } {
  if (!url && !key) return { mode: 'local' };
  try {
    if (!url || !key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error();
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error();
    return { mode: 'shared', client: createClient(url, key, { auth: { detectSessionInUrl: false } }) };
  } catch { return { mode: 'error', error: 'A configuração de acesso compartilhado está incompleta ou inválida. Confira a URL e a chave pública do Supabase.' }; }
}

export function errorMessage(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  if (message.includes('ORDER_CONFLICT')) return 'Este pedido foi alterado por outra pessoa. Seu rascunho continua aberto. Copie suas alterações e reabra a versão atual do pedido antes de refazer a edição.';
  if (message.includes('ACCESS_DENIED')) return 'Seu acesso mudou ou não permite esta ação. Solicite à responsável a revisão da permissão.';
  if (message.includes('INVALID_ORDER') || message.includes('INVALID_REQUEST') || message.includes('INVALID_SETTINGS')) return 'Há dados inválidos no pedido. Confira os campos e tente salvar novamente.';
  if (message.includes('Aguarde a atualização')) return 'Aguarde a atualização em andamento e tente novamente.';
  if (message.includes('Seu acesso mudou. Entre novamente.')) return 'Seu acesso mudou. Entre novamente.';
  return 'Não foi possível concluir a operação. Confira a conexão e tente novamente.';
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta inválida.');
  return value as Record<string, unknown>;
}
export function parseStaff(value: unknown): Staff {
  const v = object(value);
  if (typeof v.userId !== 'string' || !v.userId || typeof v.displayName !== 'string' || !v.displayName || !['owner', 'attendant', 'production'].includes(String(v.role)) || typeof v.canViewFinancial !== 'boolean') throw new Error('Resposta inválida.');
  return { userId: v.userId, displayName: v.displayName, role: v.role as Staff['role'], canViewFinancial: v.canViewFinancial };
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Revisão inválida.');
  return value;
}
export function parseOrderRecord(value: unknown): OrderRecord {
  const v = object(value);
  return { order: validateOrder(v.order), revision: revision(v.revision) };
}
export function parseProductionRecord(value: unknown): ProductionRecord {
  const v = object(value), o = object(v.order);
  if (typeof o.id !== 'string' || !o.id || !Number.isSafeInteger(o.number) || Number(o.number) < 1 || typeof o.customer !== 'string' || o.customer.length < 2 || typeof o.date !== 'string' || typeof o.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(o.time) || !['pickup', 'delivery'].includes(String(o.fulfillment)) || typeof o.notes !== 'string' || !['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'].includes(String(o.status)) || !Array.isArray(o.lines) || !o.lines.length || o.lines.length > 100) throw new Error('Pedido de produção inválido.');
  addDays(o.date, 0);
  const lines = o.lines.map(raw => {
    const line = object(raw);
    if (typeof line.id !== 'string' || !line.id || line.id.length > 100 || typeof line.description !== 'string' || !line.description || line.description.length > 180 || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > 10_000 || !['un', 'kg', 'cento'].includes(String(line.unit)) || (line.unit === 'kg' ? Math.abs(line.quantity * 1000 - Math.round(line.quantity * 1000)) > 1e-7 : !Number.isInteger(line.quantity))) throw new Error('Item inválido.');
    return { id: line.id, description: line.description, quantity: line.quantity, unit: line.unit as OrderLine['unit'] };
  });
  if (new Set(lines.map(line => line.id)).size !== lines.length) throw new Error('Itens repetidos.');
  return { revision: revision(v.revision), order: { id: o.id, number: Number(o.number), customer: o.customer, date: o.date, time: o.time, fulfillment: o.fulfillment as Order['fulfillment'], notes: o.notes, status: o.status as OrderStatus, lines } };
}
export function parseList<T>(value: unknown, parser: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Lista inválida.');
  return value.map(parser);
}
export function parseStaffAccess(value: unknown): StaffAccess {
  const v = object(value);
  if (typeof v.active !== 'boolean') throw new Error('Acesso inválido.');
  return { ...parseStaff(v), active: v.active };
}
export async function rpc(client: SupabaseClient, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
export const roleLabels: Record<Staff['role'], string> = { owner: 'Responsável', attendant: 'Atendimento', production: 'Produção' };
