import type { OrderStatus } from './domain';

// Thermal printing is configured per device: the kitchen computer has the printer, phones do not.

export type PaperWidth = '80' | '58';
export type PrintPrefs = { paper: PaperWidth; autoKitchen: boolean };
/** Order ids already printed on this device, with the time they were printed. */
export type PrintedLog = Record<string, string>;

const PREFS_KEY = 'sc-print-prefs';
const LOG_KEY = 'sc-printed-comandas';
const KEEP_DAYS = 14;

function read<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try { const raw = storage?.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } as T : fallback; }
  catch { return fallback; }
}
function write(storage: Storage | undefined, key: string, value: unknown) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Private mode or full storage: printing still works manually. */ }
}

export function loadPrefs(storage: Storage | undefined = globalThis.localStorage): PrintPrefs {
  const prefs = read<PrintPrefs>(storage, PREFS_KEY, { paper: '80', autoKitchen: false });
  return { paper: prefs.paper === '58' ? '58' : '80', autoKitchen: prefs.autoKitchen === true };
}
export function savePrefs(prefs: PrintPrefs, storage: Storage | undefined = globalThis.localStorage) { write(storage, PREFS_KEY, prefs); }
export function loadPrinted(storage: Storage | undefined = globalThis.localStorage): PrintedLog { return read<PrintedLog>(storage, LOG_KEY, {}); }
export function savePrinted(log: PrintedLog, storage: Storage | undefined = globalThis.localStorage) { write(storage, LOG_KEY, log); }

/** Drops entries older than two weeks so the device log never grows without bound. */
export function prunePrinted(log: PrintedLog, now: Date): PrintedLog {
  const limit = now.getTime() - KEEP_DAYS * 86_400_000;
  return Object.fromEntries(Object.entries(log).filter(([, at]) => Date.parse(at) >= limit));
}

/** Confirmed orders this device has not printed yet, in time order: these become kitchen tickets. */
export function newlyConfirmed<T extends { id: string; status: OrderStatus; date: string; time: string }>(orders: T[], printed: PrintedLog): T[] {
  return orders.filter(order => order.status === 'confirmed' && !printed[order.id])
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

/** Marks every order already confirmed or beyond as printed: turning auto-print on never floods the printer. */
export function seedPrinted(orders: { id: string; status: OrderStatus }[], printed: PrintedLog, now: Date): PrintedLog {
  const at = now.toISOString();
  const next = { ...printed };
  for (const order of orders) if (order.status !== 'pending' && order.status !== 'cancelled' && !next[order.id]) next[order.id] = at;
  return next;
}
