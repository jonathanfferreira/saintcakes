import type { OrderLine } from './domain';

export type CatalogItem = { id: string; category: string; description: string; unit: OrderLine['unit']; unitPriceCents: number; page: number };
// Partial transcription, visually checked against the PDF supplied on 2026-10-22.
// Prices remain editable; this is not a live or complete catalogue.
const cakes: [string, number][] = [
  ['Sensação', 8900], ['Sedução', 8900], ['Brigadeiro', 8000], ['Mineira', 8500],
  ['Sonho de valsa', 8000], ['Dois amores', 8000], ['Morango Branco', 8900],
  ['Prestígio', 8600], ['Maracujá com chocolate', 8800], ['Amor perfeito', 8900], ['Marta rocha', 9000],
];
const savory: [string, number][] = [
  ['Mini pão de queijo', 110], ['Mini hambúrguer', 350], ['Mini cachorro-quente', 350],
  ['Mini sanduíche patê', 345], ['Mini pizza', 295], ['Mini empada palmito', 380],
  ['Mini empada frango', 380], ['Mini folhado', 375], ['Mini esfirra de carne', 280],
  ['Mini folhado chocolate', 360], ['Mini folhado ricota e bacon', 295],
  ['Mini folhado Romeu e Julieta', 295], ['Mini croissant', 495],
  ['Mini quiche alho-poró e bacon', 375], ['Mini quiche vegetais', 375],
];
export const catalog: CatalogItem[] = [
  ...cakes.map(([name, price], i): CatalogItem => ({ id: `party-${i}`, category: 'Bolos · linha party', description: `Bolo ${name} · linha party`, unit: 'kg', unitPriceCents: price, page: 3 })),
  ...savory.map(([name, price], i): CatalogItem => ({ id: `mini-${i}`, category: 'Mini salgados diversos', description: name, unit: 'un', unitPriceCents: price, page: 17 })),
];
