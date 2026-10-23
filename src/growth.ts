import type { OrderLine } from './domain';

// Contracts for coupons, the ready-to-go showcase and the customer central (migration 20261025120000).

export type CouponKind = 'percent' | 'fixed';
export type Coupon = { id: string; code: string; description: string; kind: CouponKind; value: number; firstOrderOnly: boolean; minOrderCents: number; startsOn: string; endsOn: string; maxUses: number | null; uses: number; active: boolean };
/** What `save_coupon` takes: an empty id creates, dates as AAAA-MM-DD or empty, maxUses empty for unlimited. */
export type CouponDraft = Omit<Coupon, 'uses' | 'maxUses'> & { maxUses: number | '' };
export type CouponQuote = { code: string; description: string; discountCents: number };

export type ShowcaseItem = { id: string; name: string; description: string; unit: OrderLine['unit']; priceCents: number; stock: number; photoPath: string | null; active: boolean; sort: number; updatedAt: string };
export type PublicShowcaseItem = Omit<ShowcaseItem, 'active' | 'sort' | 'updatedAt'>;
/** What `save_showcase_item` takes: an empty id creates, photoPath empty for none. */
export type ShowcaseDraft = Omit<ShowcaseItem, 'photoPath'> & { photoPath: string };

export type CustomerRecord = { key: string; name: string; phone: string; source: 'site' | 'equipe'; marketingOptIn: boolean; optInAt: string | null; optInSource: 'site' | 'equipe' | null; notes: string; firstSeen: string; lastSeen: string; revision: number };

export const SHOWCASE_BUCKET = 'vitrine';

/**
 * What team screens use to reach the database. `call` runs an RPC and rejects with the server's
 * error (message codes such as ACCESS_DENIED, INVALID_COUPON); `uploadPhoto` stores an image
 * already reduced by the caller and resolves to its bucket path.
 */
export type GrowthApi = {
  call: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  uploadPhoto: (file: Blob, extension: 'jpg' | 'png' | 'webp') => Promise<string>;
  photoUrl: (path: string | null) => string | null;
};

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} inválido.`);
  return value as Record<string, unknown>;
}
const text = (value: unknown, what: string) => { if (typeof value !== 'string') throw new Error(`${what} inválido.`); return value; };
const integer = (value: unknown, what: string) => { if (!Number.isSafeInteger(value)) throw new Error(`${what} inválido.`); return value as number; };
const unit = (value: unknown) => { if (value !== 'un' && value !== 'kg' && value !== 'cento') throw new Error('Unidade inválida.'); return value; };

export function parseCoupon(value: unknown): Coupon {
  const v = record(value, 'Cupom');
  if (v.kind !== 'percent' && v.kind !== 'fixed') throw new Error('Cupom inválido.');
  return { id: text(v.id, 'Cupom'), code: text(v.code, 'Cupom'), description: text(v.description, 'Cupom'), kind: v.kind, value: integer(v.value, 'Cupom'),
    firstOrderOnly: v.firstOrderOnly === true, minOrderCents: integer(v.minOrderCents, 'Cupom'), startsOn: typeof v.startsOn === 'string' ? v.startsOn : '',
    endsOn: typeof v.endsOn === 'string' ? v.endsOn : '', maxUses: v.maxUses === null ? null : integer(v.maxUses, 'Cupom'), uses: integer(v.uses, 'Cupom'), active: v.active === true };
}
export function parseCouponQuote(value: unknown): CouponQuote {
  const v = record(value, 'Cupom');
  return { code: text(v.code, 'Cupom'), description: text(v.description, 'Cupom'), discountCents: integer(v.discountCents, 'Cupom') };
}
export function parsePublicShowcaseItem(value: unknown): PublicShowcaseItem {
  const v = record(value, 'Item da vitrine');
  const stock = Number(v.stock);
  if (!Number.isFinite(stock) || stock < 0) throw new Error('Item da vitrine inválido.');
  return { id: text(v.id, 'Item'), name: text(v.name, 'Item'), description: text(v.description, 'Item'), unit: unit(v.unit), priceCents: integer(v.priceCents, 'Item'), stock, photoPath: typeof v.photoPath === 'string' ? v.photoPath : null };
}
export function parseShowcaseItem(value: unknown): ShowcaseItem {
  const v = record(value, 'Item da vitrine');
  return { ...parsePublicShowcaseItem(v), active: v.active === true, sort: integer(v.sort, 'Item'), updatedAt: text(v.updatedAt, 'Revisão do item') };
}
export function parseCustomerRecord(value: unknown): CustomerRecord {
  const v = record(value, 'Cliente');
  return { key: text(v.key, 'Cliente'), name: text(v.name, 'Cliente'), phone: text(v.phone, 'Cliente'), source: v.source === 'site' ? 'site' : 'equipe',
    marketingOptIn: v.marketingOptIn === true, optInAt: typeof v.optInAt === 'string' ? v.optInAt : null,
    optInSource: v.optInSource === 'site' || v.optInSource === 'equipe' ? v.optInSource : null, notes: text(v.notes, 'Cliente'),
    firstSeen: text(v.firstSeen, 'Cliente'), lastSeen: text(v.lastSeen, 'Cliente'), revision: integer(v.revision, 'Revisão do cliente') };
}

/** Public URL of a showcase photo in the Supabase bucket. */
export function showcasePhotoUrl(supabaseUrl: string, path: string | null): string | null {
  return path ? `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${SHOWCASE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}` : null;
}

/** Customer-facing explanation for a coupon error code from the server. */
export function couponMessage(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error ?? '');
  if (message.includes('COUPON_NOT_FOUND')) return 'Cupom não encontrado. Confira o código.';
  if (message.includes('COUPON_EXPIRED')) return 'Este cupom não está valendo nesta data.';
  if (message.includes('COUPON_EXHAUSTED')) return 'Este cupom já atingiu o limite de usos.';
  if (message.includes('COUPON_FIRST_ORDER')) return 'Este cupom vale só para o primeiro pedido deste WhatsApp.';
  if (message.includes('COUPON_MIN_ORDER')) return 'O pedido ainda não alcançou o valor mínimo deste cupom.';
  if (message.includes('SHOWCASE_STOCK')) return 'Um item da pronta entrega acabou de esgotar. Atualize a página e confira a vitrine.';
  return 'Não foi possível conferir o cupom agora. Tente novamente.';
}

/** Marketing export: only customers who said yes, as CSV for WhatsApp/e-mail tools. */
export function optInCsv(customers: CustomerRecord[]): string {
  // Spreadsheet programs evaluate formulas even inside quoted CSV cells.
  // eslint-disable-next-line no-control-regex -- CSV cells must also neutralize leading control characters.
  const cell = (value: string) => `"${(/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
  const rows = customers.filter(customer => customer.marketingOptIn).map(customer => [customer.name, customer.phone, customer.optInAt ?? '', customer.optInSource ?? ''].map(cell).join(','));
  return ['"nome","whatsapp","consentimento_em","origem"', ...rows].join('\n');
}
