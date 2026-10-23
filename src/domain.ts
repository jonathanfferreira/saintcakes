export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type Fulfillment = 'pickup' | 'delivery';

export type OrderLine = {
  id: string;
  description: string;
  quantity: number;
  unit: 'un' | 'kg' | 'cento';
  unitPriceCents: number;
};

export type Order = {
  id: string;
  number: number;
  customer: string;
  phone: string;
  date: string;
  time: string;
  fulfillment: Fulfillment;
  address: string;
  notes: string;
  lines: OrderLine[];
  receivedCents: number;
  status: OrderStatus;
  createdAt: string;
  /** Coupon discount; present together with couponCode, absent on orders saved before coupons. */
  discountCents?: number;
  couponCode?: string;
};

const MAX_MONEY_CENTS = 100_000_000;

function assertMoneyCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_CENTS) {
    throw new RangeError(`${name} deve ser um valor inteiro entre 0 e 100000000 centavos.`);
  }
}

function assertDisplayCents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('O valor deve ser um número inteiro seguro de centavos não negativo.');
  }
}

export function lineTotalCents(line: OrderLine): number {
  const quantityMilli = Math.round(line.quantity * 1000);
  const product = quantityMilli * line.unitPriceCents;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError('O valor do item excede o limite seguro.');
  }
  // Round each line to the nearest cent, with exact half-cent ties upward.
  return Math.floor((product + 500) / 1000);
}

export function calculateOrder(
  lines: OrderLine[],
  receivedCents = 0,
  discountCents = 0,
): { subtotalCents: number; discountCents: number; totalCents: number; depositCents: number; balanceCents: number; depositDueCents: number } {
  assertMoneyCents(receivedCents, 'O valor recebido');
  assertMoneyCents(discountCents, 'O desconto');
  if (!Array.isArray(lines)) throw new TypeError('Itens do pedido inválidos.');
  if (lines.length < 1 || lines.length > 100) {
    throw new RangeError('O pedido deve conter de 1 a 100 itens.');
  }

  let totalCents = 0;
  for (const line of lines) {
    if (!line || typeof line !== 'object') throw new TypeError('Item do pedido inválido.');
    const quantity = ownDataValue(line, 'quantity');
    const unit = ownDataValue(line, 'unit');
    const unitPriceCents = ownDataValue(line, 'unitPriceCents');
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) {
      throw new RangeError('A quantidade do item deve ser maior que zero e no máximo 10000.');
    }
    if (unit !== 'un' && unit !== 'kg' && unit !== 'cento') {
      throw new TypeError('A unidade do item deve ser un, kg ou cento.');
    }
    if (unit === 'kg'
      ? Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7
      : !Number.isInteger(quantity)) {
      throw new RangeError(unit === 'kg'
        ? 'A quantidade em kg deve ter até três casas decimais.'
        : 'A quantidade em un e cento deve ser inteira.');
    }
    if (typeof unitPriceCents !== 'number'
      || !Number.isSafeInteger(unitPriceCents)
      || unitPriceCents < 0
      || unitPriceCents > MAX_MONEY_CENTS) {
      throw new RangeError('O preço do item deve ser um inteiro entre 0 e 100000000 centavos.');
    }
    if (!validateOrderLine(line)) {
      throw new TypeError('O item precisa ter identificador e descrição válidos.');
    }
    const lineTotal = lineTotalCents(line);
    totalCents += lineTotal;
    if (!Number.isSafeInteger(totalCents) || totalCents > MAX_MONEY_CENTS) {
      throw new RangeError('O total do pedido excede 100000000 centavos.');
    }
  }
  if (totalCents <= 0) throw new RangeError('O total do pedido deve ser maior que zero.');
  const subtotalCents = totalCents;
  // A coupon reduces the total but never makes an order free.
  if (discountCents >= subtotalCents) throw new RangeError('O desconto não pode zerar o pedido.');
  totalCents = subtotalCents - discountCents;
  if (receivedCents > totalCents) throw new RangeError('O valor recebido não pode superar o total.');

  const depositCents = Math.ceil(totalCents / 2);
  return {
    subtotalCents,
    discountCents,
    totalCents,
    depositCents,
    balanceCents: totalCents - receivedCents,
    depositDueCents: Math.max(0, depositCents - receivedCents),
  };
}

/** Money summary of a saved order, including its coupon discount when it has one. */
export function orderMoney(order: Pick<Order, 'lines' | 'receivedCents' | 'discountCents'>) {
  return calculateOrder(order.lines, order.receivedCents, order.discountCents ?? 0);
}

/** Parse a plain Brazilian or dot-decimal amount into integer cents. */
export function parseMoney(value: string): number {
  if (typeof value !== 'string') throw new TypeError('Informe um valor como texto.');
  const input = value.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(input)) {
    throw new RangeError('Use um valor não negativo com até duas casas decimais.');
  }
  const normalized = input.replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assertMoneyCents(cents, 'O valor');
  return cents;
}

export function formatMoney(cents: number): string {
  assertDisplayCents(cents);
  const totalCents = BigInt(cents);
  const wholeReais = totalCents / 100n;
  const fraction = String(totalCents % 100n).padStart(2, '0');
  const integerParts = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(wholeReais);
  let lastIntegerIndex = -1;
  integerParts.forEach((part, index) => {
    if (part.type === 'integer') lastIntegerIndex = index;
  });
  const decimalSeparator = new Intl.NumberFormat('pt-BR').formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value ?? ',';
  const parts = [...integerParts];
  parts.splice(lastIntegerIndex + 1, 0,
    { type: 'decimal', value: decimalSeparator },
    { type: 'fraction', value: fraction });
  return parts.map((part) => part.value).join('');
}

export function localDateKey(date = new Date()): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError('Data inválida.');
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

function parseDateKey(dateKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new RangeError('Data deve estar no formato AAAA-MM-DD.');
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError('Data civil inválida.');
  }
  return date;
}

export function addDays(dateKey: string, amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('A quantidade de dias deve ser um inteiro seguro.');
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) throw new RangeError('Data fora do intervalo suportado.');
  return `${String(year).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

function validDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseDateKey(value);
    return true;
  } catch {
    return false;
  }
}

function validCreatedAt(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function readArrayItems(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !Number.isSafeInteger(lengthDescriptor.value)) return null;
  const length = lengthDescriptor.value;
  if (length < 1 || length > 100) return null;
  const items: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) return null;
    items.push(descriptor.value);
  }
  return items;
}

function validateOrderLine(value: unknown): OrderLine | null {
  if (!isRecord(value)) return null;
  const id = ownDataValue(value, 'id');
  const description = ownDataValue(value, 'description');
  const quantity = ownDataValue(value, 'quantity');
  const unit = ownDataValue(value, 'unit');
  const unitPriceCents = ownDataValue(value, 'unitPriceCents');
  const validUnit = unit === 'un' || unit === 'kg' || unit === 'cento';
  if (!boundedString(id, 1, 100)
    || !boundedString(description, 1, 180)
    || typeof quantity !== 'number'
    || !Number.isFinite(quantity)
    || quantity <= 0
    || quantity > 10_000
    || !validUnit
    || (unit === 'kg' ? Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7 : !Number.isInteger(quantity))) {
    return null;
  }
  try {
    if (typeof unitPriceCents !== 'number') return null;
    assertMoneyCents(unitPriceCents, 'O preço do item');
    const line: OrderLine = { id, description, quantity, unit, unitPriceCents };
    const total = lineTotalCents(line);
    if (total > MAX_MONEY_CENTS) return null;
    return line;
  } catch {
    return null;
  }
}

/** Validate untrusted imported or persisted data and return a fresh, typed order. */
export function validateOrder(value: unknown): Order {
  try {
    if (!isRecord(value)) throw new TypeError('Pedido inválido.');
    const id = ownDataValue(value, 'id');
    const number = ownDataValue(value, 'number');
    const customer = ownDataValue(value, 'customer');
    const phone = ownDataValue(value, 'phone');
    const date = ownDataValue(value, 'date');
    const time = ownDataValue(value, 'time');
    const fulfillment = ownDataValue(value, 'fulfillment');
    const address = ownDataValue(value, 'address');
    const notes = ownDataValue(value, 'notes');
    const receivedCents = ownDataValue(value, 'receivedCents');
    const status = ownDataValue(value, 'status');
    const createdAt = ownDataValue(value, 'createdAt');
    const rawLines = readArrayItems(ownDataValue(value, 'lines'));
    const validStatus = status === 'pending'
      || status === 'confirmed'
      || status === 'preparing'
      || status === 'ready'
      || status === 'delivered'
      || status === 'cancelled';
    if (!boundedString(id, 1, 100)
      || !positiveSafeInteger(number)
      || !boundedString(customer, 2, 100)
      || !boundedString(phone, 0, 30)
      || !validDateKey(date)
      || typeof time !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
      || (fulfillment !== 'pickup' && fulfillment !== 'delivery')
      || !boundedString(address, 0, 300)
      || (fulfillment === 'delivery' && address.trim().length === 0)
      || !boundedString(notes, 0, 2000)
      || !Number.isSafeInteger(receivedCents)
      || typeof receivedCents !== 'number'
      || receivedCents < 0
      || receivedCents > MAX_MONEY_CENTS
      || !validStatus
      || !validCreatedAt(createdAt)
      || rawLines === null) {
      throw new TypeError('Pedido inválido ou contém campos fora dos limites permitidos.');
    }
    const lines = rawLines.map(validateOrderLine);
    if (lines.some((line) => line === null)) throw new TypeError('Um ou mais itens do pedido são inválidos.');
    const validLines = lines.filter((line): line is OrderLine => line !== null);
    if (new Set(validLines.map(line => line.id)).size !== validLines.length) throw new TypeError('O pedido contém itens com identificadores repetidos.');
    const discountCents = ownDataValue(value, 'discountCents');
    const couponCode = ownDataValue(value, 'couponCode');
    // Discount and code travel together, exactly as the server stores them.
    const hasCoupon = discountCents !== undefined || couponCode !== undefined;
    if (hasCoupon && (!Number.isSafeInteger(discountCents) || typeof discountCents !== 'number' || discountCents < 0 || !boundedString(couponCode, 0, 24))) {
      throw new TypeError('Desconto do pedido inválido.');
    }
    calculateOrder(validLines, receivedCents, hasCoupon ? discountCents as number : 0);
    return {
      id,
      number,
      customer,
      phone,
      date,
      time,
      fulfillment,
      address,
      notes,
      lines: validLines,
      receivedCents,
      status,
      createdAt,
      ...(hasCoupon ? { discountCents: discountCents as number, couponCode: couponCode as string } : {}),
    };
  } catch (error) {
    if (error instanceof Error) throw new TypeError(error.message);
    throw new TypeError('Pedido inválido ou contém dados malformados.');
  }
}
