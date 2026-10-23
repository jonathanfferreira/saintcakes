import type { OrderLine } from './domain';

export type CatalogItem = { id: string; category: string; description: string; unit: OrderLine['unit']; unitPriceCents: number; page: number; details?: string; photo?: string };
// Partial transcription, visually checked against the PDF supplied on 2026-10-22.
// Prices remain editable; this is not a live or complete catalogue. Details are the PDF's own
// flavour text; photos are the shop's own catalogue photos, used only where the product is certain.
const cakes: [string, number, string?, string?][] = [
  ['Sensação', 8900, 'Brigadeiro meio amargo 50% cacau com morangos frescos e creme mineiro'],
  ['Sedução', 8900, 'Creme de chocolate com morangos frescos'],
  ['Brigadeiro', 8000, 'Brigadeiro meio amargo 50% cacau'],
  ['Mineira', 8500, 'Brigadeiro branco com abacaxi, nata, coco queimado e decorado com coco fresco'],
  ['Sonho de valsa', 8000, 'Recheio de chocolate meio amargo, creme de nata e sonho de valsa', '/products/bolo-sonho-de-valsa.webp'],
  ['Dois amores', 8000, 'Duas camadas: brigadeiro meio amargo e brigadeiro branco'],
  ['Morango Branco', 8900, 'Brigadeiro branco, nata, suspiro e morangos frescos'],
  ['Prestígio', 8600, 'Recheio cremoso de coco e creme de chocolate 50% cacau', '/products/bolo-prestigio.webp'],
  ['Maracujá com chocolate', 8800],
  ['Amor perfeito', 8900, 'Brigadeiro meio amargo e morango com brigadeiro branco e sonho de valsa'],
  ['Marta rocha', 9000, 'Geleia artesanal de damasco e ameixa com crocante de castanha e creme de nata'],
];
const savory: [string, number, string?][] = [
  ['Mini pão de queijo', 110], ['Mini hambúrguer', 350, '/products/mini-hamburguer.webp'], ['Mini cachorro-quente', 350],
  ['Mini sanduíche patê', 345, '/products/mini-sanduiche-pate.webp'], ['Mini pizza', 295, '/products/mini-pizza.webp'], ['Mini empada palmito', 380],
  ['Mini empada frango', 380], ['Mini folhado', 375, '/products/mini-folhado.webp'], ['Mini esfirra de carne', 280],
  ['Mini folhado chocolate', 360], ['Mini folhado ricota e bacon', 295],
  ['Mini folhado Romeu e Julieta', 295], ['Mini croissant', 495],
  // The catalogue's quiche photo does not say which filling it shows, so neither flavour claims it.
  ['Mini quiche alho-poró e bacon', 375], ['Mini quiche vegetais', 375],
];
export const catalog: CatalogItem[] = [
  ...cakes.map(([name, price, details, photo], i): CatalogItem => ({ id: `party-${i}`, category: 'Bolos · linha party', description: `Bolo ${name} · linha party`, unit: 'kg', unitPriceCents: price, page: 3, details, photo })),
  ...savory.map(([name, price, photo], i): CatalogItem => ({ id: `mini-${i}`, category: 'Mini salgados diversos', description: name, unit: 'un', unitPriceCents: price, page: 17, photo })),
];
