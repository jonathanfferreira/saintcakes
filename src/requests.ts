import { addDays, calculateOrder } from './domain.ts';
import type { Fulfillment, Order, OrderLine } from './domain';
import type { PublicSettings } from './settings';

export type RequestLine = Omit<OrderLine, 'id'>;
/** A ready-to-go item; the server prices it from the showcase and reserves the stock. */
export type ShowcasePick = { showcaseId: string; quantity: number };
export type OrderRequestInput = { customer: string; phone: string; date: string; time: string; fulfillment: Fulfillment; address: string; deliveryZone: string; notes: string; lines: RequestLine[]; showcase?: ShowcasePick[]; couponCode?: string; marketingOptIn?: boolean };
export type OrderRequestRecord = { id: string; createdAt: string; reservedLineIds?: string[]; request: Omit<OrderRequestInput, 'lines' | 'deliveryZone' | 'showcase' | 'couponCode' | 'marketingOptIn'> & { lines: OrderLine[]; couponCode: string; discountCents: number } };

export const MAX_REQUEST_LINES = 30;
export const REQUEST_HORIZON_DAYS = 180;

/** Client-side mirror of private.submit_order_request; the server remains the authority. */
export function requestProblem(input: OrderRequestInput, today: string, shop: PublicSettings = { minLeadDays: 0, deliveryZones: [] }): string | null {
  const digits = input.phone.replace(/\D/g, '');
  const showcase = input.showcase ?? [];
  if (input.customer.trim().length < 2 || input.customer.trim().length > 100) return 'Informe seu nome.';
  if (digits.length < 10 || digits.length > 13 || input.phone.trim().length > 30) return 'Informe um WhatsApp com DDD.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < today || input.date > addDays(today, REQUEST_HORIZON_DAYS)) return `Escolha uma data entre hoje e os próximos ${REQUEST_HORIZON_DAYS} dias.`;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return 'Escolha um horário.';
  if (input.fulfillment === 'delivery' && !input.address.trim()) return 'Informe o endereço de entrega.';
  if (input.fulfillment === 'delivery' && shop.deliveryZones.length && !shop.deliveryZones.some(zone => zone.name === input.deliveryZone)) return 'Escolha o bairro da entrega.';
  if (input.lines.some(line => line.unitPriceCents === 0) && input.date < addDays(today, shop.minLeadDays)) return `Itens sob orçamento precisam de pelo menos ${shop.minLeadDays} dia${shop.minLeadDays === 1 ? '' : 's'} de antecedência.`;
  if (input.address.trim().length > 300 || input.notes.trim().length > 1000) return 'O texto ficou longo demais.';
  if (!input.lines.length && !showcase.length) return 'Adicione pelo menos um item.';
  if (input.lines.length + showcase.length > MAX_REQUEST_LINES) return `Envie até ${MAX_REQUEST_LINES} itens por pedido.`;
  if ((input.couponCode ?? '').trim().length > 24) return 'Confira o código do cupom.';
  for (const line of input.lines) {
    if (!line.description.trim() || line.description.trim().length > 180) return 'Descreva cada item.';
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > 1000
      || (line.unit === 'kg' ? Math.abs(line.quantity * 1000 - Math.round(line.quantity * 1000)) > 1e-7 : !Number.isInteger(line.quantity))) return `Confira a quantidade de ${line.description.trim()}.`;
  }
  if (showcase.some(pick => !Number.isFinite(pick.quantity) || pick.quantity <= 0)) return 'Confira as quantidades da pronta entrega.';
  return null;
}

/** The exact body `submit_order_request` expects: showcase picks travel as lines, optional keys only when used. */
export function requestPayload(input: OrderRequestInput): Record<string, unknown> {
  const { showcase = [], couponCode = '', marketingOptIn, ...base } = input;
  return { ...base, lines: [...base.lines, ...showcase], ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}), ...(marketingOptIn === undefined ? {} : { marketingOptIn }) };
}

/** Estimated total of priced lines; lines priced at zero are quoted later by the team. */
export function estimate(lines: RequestLine[]): { totalCents: number; depositCents: number; quoted: boolean } {
  const priced = lines.filter(line => line.unitPriceCents > 0);
  const quoted = priced.length !== lines.length;
  if (!priced.length) return { totalCents: 0, depositCents: 0, quoted };
  const { totalCents, depositCents } = calculateOrder(priced.map((line, index) => ({ ...line, id: String(index) })));
  return { totalCents, depositCents, quoted };
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Solicitação inválida.');
  return value;
}
export function parseRequestRecord(value: unknown): OrderRequestRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Solicitação inválida.');
  const v = value as Record<string, unknown>;
  const r = v.request as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.lines) || !r.lines.length || r.lines.length > MAX_REQUEST_LINES + 1 || !['pickup', 'delivery'].includes(String(r.fulfillment))) throw new Error('Solicitação inválida.');
  // Showcase ids stay in the database; the team's draft only needs the priced line.
  const lines = r.lines.map(raw => {
    const line = raw as Record<string, unknown>;
    if (!['un', 'kg', 'cento'].includes(String(line.unit)) || typeof line.quantity !== 'number' || !Number.isSafeInteger(line.unitPriceCents)) throw new Error('Item inválido.');
    return { id: text(line.id, 100), description: text(line.description, 180), quantity: line.quantity, unit: line.unit as OrderLine['unit'], unitPriceCents: line.unitPriceCents as number };
  });
  const discountCents = Number.isSafeInteger(r.discountCents) && (r.discountCents as number) > 0 ? r.discountCents as number : 0;
  return {
    id: text(v.id, 100), createdAt: text(v.createdAt, 40), reservedLineIds: r.lines.filter(raw => !!raw && typeof raw === 'object' && 'showcaseId' in raw).map(raw => text(raw.id, 100)),
    request: { customer: text(r.customer, 100), phone: text(r.phone, 30), date: text(r.date, 10), time: text(r.time, 5), fulfillment: r.fulfillment as Fulfillment, address: text(r.address, 300), notes: text(r.notes, 1000), lines,
      couponCode: discountCents ? text(r.couponCode, 24) : '', discountCents },
  };
}

/** Draft order for the team to review; unpriced lines must be priced before saving. */
export function requestToOrder(record: OrderRequestRecord, createdAt: string): Order {
  const { request } = record;
  const coupon = request.discountCents ? `Cupom ${request.couponCode} aplicado no site.` : '';
  const notes = [`Solicitação enviada pelo site em ${new Date(record.createdAt).toLocaleString('pt-BR')}.`, coupon, request.notes].filter(Boolean).join('\n');
  return { id: crypto.randomUUID(), number: 0, customer: request.customer, phone: request.phone, date: request.date, time: request.time, fulfillment: request.fulfillment, address: request.address, notes: notes.slice(0, 2000), lines: request.lines.map(line => ({ ...line })), receivedCents: 0, status: 'pending', createdAt,
    ...(request.discountCents ? { discountCents: request.discountCents, couponCode: request.couponCode } : {}) };
}
