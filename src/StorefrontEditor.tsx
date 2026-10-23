import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CatalogItem } from './catalog';
import { parseMoney } from './domain';
import { storefrontProblem } from './storefront';
import type { Storefront } from './storefront';
import './Dashboard.css';
import './StorefrontEditor.css';

type ProductDraft = Omit<CatalogItem, 'unitPriceCents'> & { price: string };
type Props = { storefront: Storefront; onSave: (next: Storefront) => Promise<void>; slug: string };
const moneyInput = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;

export default function StorefrontEditor({ storefront, onSave, slug }: Props) {
  const [profile, setProfile] = useState(() => ({ ...storefront }));
  const [products, setProducts] = useState<ProductDraft[]>(() => storefront.catalog.map(({ unitPriceCents, ...item }) => ({ ...item, price: moneyInput(unitPriceCents) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const savingRef = useRef(false);

  function changeProfile<K extends keyof Storefront>(key: K, value: Storefront[K]) {
    setProfile(current => ({ ...current, [key]: value }));
    setMessage('');
  }

  function changeProduct(id: string, patch: Partial<ProductDraft>) {
    setProducts(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
    setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setError(''); setMessage('');
    let next: Storefront;
    try {
      next = {
        ...profile,
        name: profile.name.trim(), tagline: profile.tagline.trim(), whatsapp: profile.whatsapp.trim(),
        logoUrl: profile.logoUrl.trim(), heroUrl: profile.heroUrl.trim(),
        catalog: products.map(({ price, ...item }, index) => {
          let unitPriceCents: number;
          try { unitPriceCents = parseMoney(price); }
          catch { throw new Error(`Confira o preço de ${item.description.trim() || `produto ${index + 1}`}. Use um valor como 12,50.`); }
          return { ...item, description: item.description.trim(), category: item.category.trim(), details: item.details?.trim(), photo: item.photo?.trim(), unitPriceCents };
        }),
      };
      const problem = storefrontProblem(next);
      if (problem) throw new Error(problem);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Confira os campos antes de salvar.');
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
      await onSave(next);
      // Só a gravação confirmada avança a revisão; conflitos mantêm a base do rascunho.
      setProfile(current => ({ ...current, revision: next.revision + 1 }));
      setMessage('Identidade e catálogo salvos. Abra a página de pedidos para conferir.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Seu rascunho foi mantido; tente novamente.');
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }

  return <section className="dash storefront-editor" aria-labelledby="storefront-title">
    <header className="dash-head"><div><h1 id="storefront-title">Identidade e catálogo</h1><p>Personalize os dados da sua loja e os produtos da página de pedidos.</p></div>
      <a className="sc-btn sc-btn-secondary" href={`/pedido/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer">Abrir página de pedidos <span className="storefront-sr-only">em nova aba</span></a>
    </header>
    <form onSubmit={event => void submit(event)} aria-busy={saving}>
      <fieldset className="storefront-fields settings-form" disabled={saving}>
        <legend className="storefront-sr-only">Configurar identidade e catálogo</legend>
        <article className="sc-card panel"><h2>Dados da loja</h2>
          <div className="settings-grid">
            <label className="sc-field">Nome da loja<input required maxLength={100} value={profile.name} onChange={event => changeProfile('name', event.target.value)} autoComplete="organization" /></label>
            <label className="sc-field">WhatsApp<input inputMode="tel" type="tel" maxLength={30} value={profile.whatsapp} onChange={event => changeProfile('whatsapp', event.target.value)} placeholder="5547999999999" autoComplete="tel" /><small>Inclua o código do país e o DDD.</small></label>
            <label className="sc-field storefront-wide">Apresentação curta<input maxLength={180} value={profile.tagline} onChange={event => changeProfile('tagline', event.target.value)} /></label>
          </div>
        </article>
        <article className="sc-card panel"><h2>Aparência</h2>
          <p className="hint">Use links HTTPS de imagens da sua loja. As imagens são opcionais.</p>
          <div className="settings-grid">
            <label className="sc-field">Link do logo<input maxLength={1000} value={profile.logoUrl} onChange={event => changeProfile('logoUrl', event.target.value)} placeholder="https://…" autoCapitalize="none" spellCheck={false} /></label>
            <label className="sc-field">Link da imagem de capa<input maxLength={1000} value={profile.heroUrl} onChange={event => changeProfile('heroUrl', event.target.value)} placeholder="https://…" autoCapitalize="none" spellCheck={false} /></label>
            <label className="sc-field">Tema<select value={profile.theme} onChange={event => changeProfile('theme', event.target.value as Storefront['theme'])}><option value="chocolate">Chocolate</option><option value="forest">Verde floresta</option><option value="plum">Ameixa</option></select></label>
          </div>
        </article>
        <article className="sc-card panel"><h2>Catálogo <span className="count">{products.length}/100</span></h2>
          <p className="hint">Informe o preço para a unidade escolhida. As alterações entram na página ao salvar.</p>
          {products.length === 0 && <p className="empty">Seu catálogo está vazio. Adicione o primeiro produto para começar.</p>}
          <div className="storefront-products">{products.map((item, index) => <fieldset key={item.id} className="storefront-product">
            <legend>Produto {index + 1}{item.description ? ` · ${item.description}` : ''}</legend>
            <div className="settings-grid">
              <label className="sc-field">Nome do produto<input required maxLength={180} value={item.description} onChange={event => changeProduct(item.id, { description: event.target.value })} /></label>
              <label className="sc-field">Categoria<input required maxLength={80} value={item.category} onChange={event => changeProduct(item.id, { category: event.target.value })} /></label>
              <label className="sc-field">Unidade<select value={item.unit} onChange={event => changeProduct(item.id, { unit: event.target.value as CatalogItem['unit'] })}><option value="un">Unidade</option><option value="kg">Quilograma (kg)</option><option value="cento">Cento</option></select></label>
              <label className="sc-field">Preço (R$)<input required inputMode="decimal" maxLength={16} value={item.price} onChange={event => changeProduct(item.id, { price: event.target.value })} placeholder="0,00" /></label>
              <label className="sc-field storefront-wide">Descrição e detalhes<textarea maxLength={500} value={item.details ?? ''} onChange={event => changeProduct(item.id, { details: event.target.value })} /></label>
              <label className="sc-field storefront-wide">Link da foto (opcional)<input maxLength={1000} value={item.photo ?? ''} onChange={event => changeProduct(item.id, { photo: event.target.value })} placeholder="https://…" autoCapitalize="none" spellCheck={false} /></label>
            </div>
            <button type="button" className="sc-btn sc-btn-quiet" aria-label={`Remover ${item.description || `produto ${index + 1}`}`} onClick={() => { setProducts(current => current.filter(product => product.id !== item.id)); setMessage(''); }}>Remover produto</button>
          </fieldset>)}</div>
          <button type="button" className="sc-btn sc-btn-secondary" disabled={products.length >= 100} onClick={() => {
            setProducts(current => current.length >= 100 ? current : [...current, { id: crypto.randomUUID(), description: '', category: '', unit: 'un', price: '', page: 0 }]);
            setMessage('');
          }}>Adicionar produto</button>
          {products.length >= 100 && <p className="hint storefront-limit">Limite de 100 produtos atingido. Remova um produto para adicionar outro.</p>}
        </article>
        <div><button type="submit" className="sc-btn sc-btn-primary">{saving ? 'Salvando…' : 'Salvar identidade e catálogo'}</button></div>
      </fieldset>
      {error && <p role="alert" className="sc-alert">{error}</p>}
      {message && <p role="status" className="sc-notice">{message}</p>}
    </form>
  </section>;
}
