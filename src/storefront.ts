import { catalog } from './catalog.ts';
import type { CatalogItem } from './catalog';

export type Storefront = { name: string; tagline: string; whatsapp: string; logoUrl: string; heroUrl: string; theme: 'chocolate' | 'forest' | 'plum'; catalog: CatalogItem[]; revision: number };
// A demonstração local continua sendo da Saint Cakes; lojas compartilhadas nunca usam este fallback.
export const saintStorefront: Storefront = { name: 'Saint Cakes', tagline: 'Escolha bolos e salgados, diga quando e como quer receber. A equipe confirma tudo com você pelo WhatsApp.', whatsapp: '47991409940', logoUrl: '/brand/saint-cakes.png', heroUrl: '/products/hero-bolo.webp', theme: 'chocolate', catalog, revision: 1 };

export function safeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  if (!value || value === '/brand/saint-cakes.png' || /^\/products\/[a-z0-9-]+\.webp$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
export function storefrontProblem(value: Storefront): string | null {
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) return 'Informe o nome da loja, com até 100 caracteres.';
  if (typeof value.tagline !== 'string' || value.tagline.length > 180) return 'Use até 180 caracteres na apresentação.';
  if (typeof value.whatsapp !== 'string' || (value.whatsapp !== '' && !/^\d{10,13}$/.test(value.whatsapp))) return 'Informe o WhatsApp com DDD, somente números, ou deixe vazio.';
  if (!['chocolate', 'forest', 'plum'].includes(value.theme)) return 'Escolha uma das paletas disponíveis.';
  if (!safeImageUrl(value.logoUrl) || !safeImageUrl(value.heroUrl)) return 'As imagens precisam de um endereço HTTPS válido.';
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) return 'Recarregue as configurações antes de salvar.';
  if (!Array.isArray(value.catalog) || value.catalog.length > 100) return 'Cadastre até 100 produtos.';
  const ids = new Set<string>();
  for (const item of value.catalog) {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) return 'Os produtos precisam de identificadores únicos.';
    ids.add(item.id);
    if (typeof item.category !== 'string' || !item.category.trim() || item.category.length > 80 || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 180) return 'Preencha o nome e a categoria de cada produto.';
    if (!['un', 'kg', 'cento'].includes(item.unit) || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents <= 0 || item.unitPriceCents > 100_000_000) return 'Confira a unidade e o preço dos produtos.';
    if (!Number.isSafeInteger(item.page) || item.page < 0 || item.page > 1000 || (item.details !== undefined && (typeof item.details !== 'string' || item.details.length > 500)) || (item.photo !== undefined && !safeImageUrl(item.photo))) return 'Confira a descrição e a imagem dos produtos.';
  }
  return null;
}
export function parseStorefront(value: unknown): Storefront {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuração da loja inválida.');
  const result = value as Storefront;
  const problem = storefrontProblem(result);
  if (problem) throw new Error(problem);
  return result;
}
