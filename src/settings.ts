import { calculateOrder, formatMoney, orderMoney } from './domain.ts';
import type { Order } from './domain';

export type DeliveryZone = { name: string; feeCents: number };
export type ShopSettings = { pixKey: string; pixHolder: string; minLeadDays: number; deliveryZones: DeliveryZone[] };
export type PublicSettings = Pick<ShopSettings, 'minLeadDays' | 'deliveryZones'>;
export const defaultSettings: ShopSettings = { pixKey: '', pixHolder: '', minLeadDays: 2, deliveryZones: [] };

// The 43 bairros of Joinville (SC), as named in the city's "Joinville Bairro a Bairro" index;
// "Joinville Cidade em Dados 2025" confirms 2 districts and 43 bairros (LC nº 54/1997).
export const joinvilleBairros = [
  'Adhemar Garcia', 'América', 'Anita Garibaldi', 'Atiradores', 'Aventureiro', 'Boa Vista', 'Boehmerwald', 'Bom Retiro',
  'Bucarein', 'Centro', 'Comasa', 'Costa e Silva', 'Dona Francisca', 'Espinheiros', 'Fátima', 'Floresta', 'Glória',
  'Guanabara', 'Iririú', 'Itaum', 'Itinga', 'Jardim Iririú', 'Jardim Paraíso', 'Jardim Sofia', 'Jarivatuba', 'João Costa',
  'Morro do Meio', 'Nova Brasília', 'Paranaguamirim', 'Parque Guarani', 'Petrópolis', 'Pirabeiraba Centro', 'Profipo',
  'Rio Bonito', 'Saguaçu', 'Santa Catarina', 'Santo Antônio', 'São Marcos', 'Ulysses Guimarães', 'Vila Cubatão',
  'Vila Nova', 'Zona Industrial Norte', 'Zona Industrial Tupy',
] as const;

function zones(value: unknown): DeliveryZone[] {
  if (!Array.isArray(value) || value.length > 60) throw new Error('Bairros inválidos.');
  return value.map(raw => {
    const zone = raw as Record<string, unknown>;
    if (!zone || typeof zone.name !== 'string' || !zone.name || !Number.isSafeInteger(zone.feeCents) || Number(zone.feeCents) < 0) throw new Error('Bairro inválido.');
    return { name: zone.name, feeCents: zone.feeCents as number };
  });
}
function lead(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 30) throw new Error('Antecedência inválida.');
  return value as number;
}
export function parsePublicSettings(value: unknown): PublicSettings {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') throw new Error('Configuração inválida.');
  return { minLeadDays: lead(v.minLeadDays), deliveryZones: zones(v.deliveryZones) };
}
export function parseSettings(value: unknown): ShopSettings {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || typeof v.pixKey !== 'string' || typeof v.pixHolder !== 'string') throw new Error('Configuração inválida.');
  return { pixKey: v.pixKey, pixHolder: v.pixHolder, ...parsePublicSettings(v) };
}

/** Client-side mirror of private.validate_settings; returns a message or null. */
export function settingsProblem(settings: ShopSettings): string | null {
  if (settings.pixKey.length > 140 || settings.pixHolder.length > 100) return 'Chave Pix ou titular longos demais.';
  if (!Number.isInteger(settings.minLeadDays) || settings.minLeadDays < 0 || settings.minLeadDays > 30) return 'A antecedência deve ser de 0 a 30 dias.';
  if (settings.deliveryZones.length > 60) return 'Cadastre até 60 bairros.';
  const names = new Set<string>();
  for (const zone of settings.deliveryZones) {
    if (!zone.name || zone.name !== zone.name.trim() || zone.name.length > 60) return 'Cada bairro precisa de um nome de até 60 caracteres.';
    if (names.has(zone.name.toLocaleLowerCase('pt-BR'))) return `O bairro ${zone.name} aparece duas vezes.`;
    if (!Number.isSafeInteger(zone.feeCents) || zone.feeCents < 0 || zone.feeCents > 100_000) return `Confira o frete de ${zone.name}.`;
    names.add(zone.name.toLocaleLowerCase('pt-BR'));
  }
  return null;
}

const weekday = (date: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(`${date}T12:00:00`));

/** Ready-to-send WhatsApp confirmation, adapted to what has already been paid. */
export function confirmationMessage(order: Order, settings: Pick<ShopSettings, 'pixKey' | 'pixHolder'>): string {
  const money = orderMoney(order);
  const first = order.customer.trim().split(/\s+/)[0];
  const lines = order.lines.map(line => `• ${line.quantity.toLocaleString('pt-BR')} ${line.unit} ${line.description}${line.unitPriceCents ? ` — ${formatMoney(calculateOrder([line]).totalCents)}` : ''}`);
  const where = order.fulfillment === 'pickup' ? 'retirada na loja' : `entrega em ${order.address.trim()}`;
  const pix = settings.pixKey.trim() ? `\nPix: ${settings.pixKey.trim()}${settings.pixHolder.trim() ? ` (${settings.pixHolder.trim()})` : ''}` : '';
  const payment = money.balanceCents === 0 ? 'Pagamento recebido. Obrigado!'
    : money.depositDueCents > 0 ? `Sinal de 50%: ${formatMoney(money.depositCents)}${order.receivedCents ? ` (recebido ${formatMoney(order.receivedCents)}, falta ${formatMoney(money.depositDueCents)})` : ''}${pix}\nA encomenda fica confirmada quando recebermos o sinal.`
    : `Sinal recebido. Saldo de ${formatMoney(money.balanceCents)} na ${order.fulfillment === 'pickup' ? 'retirada' : 'entrega'}.${pix}`;
  return [
    `Olá, ${first}! Aqui é da Saint Cakes.`,
    '',
    `Sua encomenda #${String(order.number).padStart(3, '0')} para ${weekday(order.date)} às ${order.time} (${where}):`,
    ...lines,
    '',
    ...(money.discountCents ? [`Subtotal: ${formatMoney(money.subtotalCents)}`, `Desconto${order.couponCode ? ` (cupom ${order.couponCode})` : ''}: − ${formatMoney(money.discountCents)}`] : []),
    `Total: ${formatMoney(money.totalCents)}`,
    payment,
  ].join('\n');
}

export function whatsappLink(phone: string, text?: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return null;
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
