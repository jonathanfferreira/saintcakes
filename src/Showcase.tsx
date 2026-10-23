import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { formatMoney, parseMoney } from './domain';
import { parseShowcaseItem } from './growth';
import type { GrowthApi, ShowcaseDraft, ShowcaseItem } from './growth';
import './Dashboard.css';
import './Showcase.css';

type Unit = ShowcaseItem['unit'];
const unitLabel: Record<Unit, string> = { un: 'unidade', kg: 'kg', cento: 'cento' };
const unitShort: Record<Unit, string> = { un: 'un', kg: 'kg', cento: 'cento' };
const MAX_STOCK = 10000;
const MAX_SIDE = 1600;
const emptyDraft: ShowcaseDraft = { id: '', name: '', description: '', unit: 'un', priceCents: 0, stock: 0, photoPath: '', active: true, sort: 0, updatedAt: '' };
const moneyInput = (cents: number) => cents > 0 ? `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}` : '';
const stockText = (stock: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(stock);
const step = (unit: Unit) => unit === 'kg' ? 0.5 : 1;
const toDraft = (item: ShowcaseItem): ShowcaseDraft => ({ ...item, photoPath: item.photoPath ?? '' });

function errorText(error: unknown): string {
  return typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error ?? '');
}
function saveMessage(error: unknown): string {
  const message = errorText(error);
  if (message.includes('ORDER_CONFLICT')) return 'Este item mudou, talvez por uma reserva. Atualize a lista e reabra o item antes de salvar.';
  if (message.includes('INVALID_SHOWCASE')) return 'Confira os campos do item.';
  if (message.includes('ACCESS_DENIED')) return 'Você não tem permissão para alterar a pronta entrega.';
  return 'Não foi possível salvar. Tente novamente.';
}

/** Downscale to MAX_SIDE on the long side and encode as WebP (JPEG where unsupported). */
async function shrinkImage(file: File): Promise<{ blob: Blob; extension: 'webp' | 'jpg' }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('image')); img.src = url; });
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.82));
    const webp = await encode('image/webp');
    if (webp && webp.type === 'image/webp') return { blob: webp, extension: 'webp' };
    const jpeg = await encode('image/jpeg');
    if (!jpeg) throw new Error('encode');
    return { blob: jpeg, extension: 'jpg' };
  } finally { URL.revokeObjectURL(url); }
}

function Switch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="sh-switch" onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
}
const Minus = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>;
const Plus = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;

function ShowcaseForm({ initial, api, onSaved, onCancel }: { initial: ShowcaseDraft; api: GrowthApi; onSaved: (item: ShowcaseItem) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [price, setPrice] = useState(moneyInput(initial.priceCents));
  const [stock, setStock] = useState(initial.id ? String(initial.stock).replace('.', ',') : '');
  const [sort, setSort] = useState(String(initial.sort));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const patch = (next: Partial<ShowcaseDraft>) => setDraft(current => ({ ...current, ...next }));
  const preview = api.photoUrl(draft.photoPath || null);

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Escolha um arquivo de imagem.'); return; }
    setError(''); setUploading(true);
    try {
      const { blob, extension } = await shrinkImage(file);
      patch({ photoPath: await api.uploadPhoto(blob, extension) });
    } catch { setError('Não foi possível enviar a foto. Tente outra imagem.'); }
    finally { setUploading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || uploading) return;
    const name = draft.name.trim();
    if (name.length < 2 || name.length > 80) { setError('O nome precisa ter de 2 a 80 caracteres.'); return; }
    if (draft.description.trim().length > 300) { setError('A descrição pode ter até 300 caracteres.'); return; }
    let priceCents: number;
    try { priceCents = parseMoney(price); } catch { setError('Informe o preço em reais, por exemplo 12,50.'); return; }
    if (priceCents < 1 || priceCents > 10000000) { setError('Informe um preço maior que zero.'); return; }
    const stockValue = stock.trim() === '' ? 0 : Number(stock.replace(',', '.'));
    if (!Number.isFinite(stockValue) || stockValue < 0 || stockValue > MAX_STOCK) { setError('O estoque deve ficar entre 0 e 10.000.'); return; }
    if (draft.unit !== 'kg' && !Number.isInteger(stockValue)) { setError('Para unidade e cento o estoque é um número inteiro. Só kg aceita fração.'); return; }
    if (Math.abs(Math.round(stockValue * 1000) - stockValue * 1000) > 1e-6) { setError('Use até 3 casas decimais no estoque.'); return; }
    const sortValue = sort.trim() === '' ? 0 : Number(sort);
    if (!Number.isInteger(sortValue) || Math.abs(sortValue) > 1000000) { setError('A ordem deve ser um número inteiro.'); return; }
    setError(''); setSaving(true);
    const payload: ShowcaseDraft = { id: draft.id, name, description: draft.description.trim(), unit: draft.unit, priceCents, stock: stockValue, photoPath: draft.photoPath, active: draft.active, sort: sortValue, updatedAt: draft.updatedAt };
    try { onSaved(parseShowcaseItem(await api.call('save_showcase_item', { p_item: payload }))); }
    catch (e) { setError(saveMessage(e)); setSaving(false); }
  }

  return <form className="sc-card panel sh-form" onSubmit={event => void submit(event)} aria-label={draft.id ? 'Editar item' : 'Novo item'}>
    <h2>{draft.id ? 'Editar item' : 'Novo item'}</h2>
    <div className="sh-form-grid">
      <div className="sh-photo-pick">
        <div className="sh-photo sh-photo-lg">{preview ? <img src={preview} alt={`Foto de ${draft.name || 'item'}`} /> : <span>Sem foto</span>}</div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => void pickPhoto(event)} />
        <div className="sh-photo-actions">
          <button type="button" className="sc-btn sc-btn-secondary" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? 'Enviando…' : draft.photoPath ? 'Trocar foto' : 'Escolher foto'}</button>
          {draft.photoPath && !uploading && <button type="button" className="sc-btn sc-btn-quiet" onClick={() => patch({ photoPath: '' })}>Remover foto</button>}
        </div>
      </div>
      <div className="sh-fields">
        <label className="sc-field">Nome<input value={draft.name} maxLength={80} placeholder="Ex.: Brownie tradicional" onChange={event => patch({ name: event.target.value })} /></label>
        <label className="sc-field">Descrição, opcional<textarea value={draft.description} maxLength={300} rows={3} onChange={event => patch({ description: event.target.value })} /></label>
        <div className="sh-row">
          <label className="sc-field">Vendido por<select value={draft.unit} onChange={event => patch({ unit: event.target.value as Unit })}>{(['un', 'kg', 'cento'] as const).map(unit => <option key={unit} value={unit}>{unitLabel[unit]}</option>)}</select></label>
          <label className="sc-field">Preço (R$) por {unitShort[draft.unit]}<input value={price} inputMode="decimal" placeholder="0,00" onChange={event => setPrice(event.target.value)} /></label>
          <label className="sc-field">Estoque<input value={stock} inputMode="decimal" placeholder="0" onChange={event => setStock(event.target.value)} /></label>
          <label className="sc-field">Ordem<input type="number" step={1} inputMode="numeric" value={sort} onChange={event => setSort(event.target.value)} /><small>Menor aparece primeiro.</small></label>
        </div>
        <div className="sh-active"><span>Aparece no site (precisa de estoque)</span><Switch checked={draft.active} label="Item ativo" onChange={active => patch({ active })} /></div>
      </div>
    </div>
    {error && <p role="alert" className="sc-alert">{error}</p>}
    <div className="sh-actions"><button className="sc-btn sc-btn-primary" disabled={saving || uploading}>{saving ? 'Salvando…' : 'Salvar item'}</button><button type="button" className="sc-btn sc-btn-secondary" disabled={saving} onClick={onCancel}>Cancelar</button></div>
  </form>;
}

export default function Showcase({ api }: { api: GrowthApi }) {
  const [items, setItems] = useState<ShowcaseItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<ShowcaseDraft | null>(null);
  const [busyId, setBusyId] = useState('');
  const [rowError, setRowError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const rows = await api.call('read_showcase');
      if (!Array.isArray(rows)) throw new Error('Resposta inválida.');
      setItems(rows.map(parseShowcaseItem));
    } catch (e) { setLoadError(errorText(e).includes('ACCESS_DENIED') ? 'Você não tem permissão para ver a pronta entrega.' : 'Não foi possível carregar a pronta entrega.'); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const replace = (item: ShowcaseItem) => setItems(current => (current ?? []).map(other => other.id === item.id ? item : other));
  const saved = (item: ShowcaseItem) => {
    setItems(current => { const list = current ?? []; return (list.some(other => other.id === item.id) ? list.map(other => other.id === item.id ? item : other) : [...list, item]).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'pt-BR')); });
    setEditing(null);
  };

  async function quickSave(item: ShowcaseItem, change: Partial<ShowcaseDraft>) {
    if (busyId) return;
    setBusyId(item.id); setRowError('');
    try { replace(parseShowcaseItem(await api.call('save_showcase_item', { p_item: { ...toDraft(item), ...change } }))); }
    catch (e) { setRowError(saveMessage(e)); if (errorText(e).includes('ORDER_CONFLICT')) void load(); }
    finally { setBusyId(''); }
  }
  const nudge = (item: ShowcaseItem, direction: 1 | -1) => {
    const next = Math.round((item.stock + direction * step(item.unit)) * 1000) / 1000;
    if (next < 0 || next > MAX_STOCK) return;
    void quickSave(item, { stock: next });
  };

  return <section className="dash showcase" aria-labelledby="showcase-title">
    <header className="dash-head"><div><h1 id="showcase-title">Pronta entrega</h1><p>Itens prontos para retirar hoje; o site mostra só os ativos com estoque.</p></div>
      {!editing && <button type="button" className="sc-btn sc-btn-primary" onClick={() => { setEditing({ ...emptyDraft, sort: (items ?? []).reduce((max, item) => Math.max(max, item.sort), 0) + 1 }); setRowError(''); }}>Novo item</button>}</header>
    {editing && <ShowcaseForm key={editing.id || 'new'} initial={editing} api={api} onSaved={saved} onCancel={() => { setEditing(null); void load(); }} />}
    {rowError && <p role="alert" className="sc-alert">{rowError}</p>}
    {items === null && !loadError && <p role="status" className="hint">Carregando a pronta entrega…</p>}
    {loadError && <div className="sc-alert sh-retry" role="alert"><span>{loadError}</span><button type="button" className="sc-btn sc-btn-secondary" onClick={() => void load()}>Tentar de novo</button></div>}
    {items && items.length === 0 && !editing && <article className="sc-card panel sh-empty"><h2>Nenhum item na pronta entrega</h2>
      <p>Cadastre o que já está pronto para retirar hoje, com foto, preço e quantidade. O site de pedidos mostra só os itens ativos que ainda têm estoque.</p>
      <div><button type="button" className="sc-btn sc-btn-primary" onClick={() => setEditing({ ...emptyDraft })}>Cadastrar o primeiro item</button></div></article>}
    {items && items.length > 0 && <ul className="sh-grid">{items.map(item => {
      const photo = api.photoUrl(item.photoPath);
      const out = item.stock <= 0;
      const busy = busyId === item.id;
      return <li key={item.id} className={`sc-card sh-card${item.active ? '' : ' is-off'}`}>
        <div className="sh-photo">{photo ? <img src={photo} alt={`Foto de ${item.name}`} loading="lazy" /> : <span>Sem foto</span>}</div>
        <div className="sh-body">
          <div className="sh-title"><h2>{item.name}</h2>{out && <span className="sc-stage sc-stage-cancelled">Esgotado</span>}{!item.active && <span className="sc-stage">Oculto no site</span>}</div>
          <p className="sh-price"><span className="sc-money">{formatMoney(item.priceCents)}</span> <small>por {unitShort[item.unit]}</small></p>
          <div className="sh-stock" role="group" aria-label={`Estoque de ${item.name}`}>
            <button type="button" className="sc-btn sc-btn-secondary sh-step" aria-label={`Diminuir estoque de ${item.name}`} disabled={busyId !== '' || out} onClick={() => nudge(item, -1)}><Minus /></button>
            <span className="sh-qty sc-num" aria-live="polite"><strong>{stockText(item.stock)}</strong> <small>{unitShort[item.unit]} em estoque</small></span>
            <button type="button" className="sc-btn sc-btn-secondary sh-step" aria-label={`Aumentar estoque de ${item.name}`} disabled={busyId !== '' || item.stock >= MAX_STOCK} onClick={() => nudge(item, 1)}><Plus /></button>
          </div>
          <div className="sh-foot">
            <div className="sh-active"><span>{item.active ? 'Ativo' : 'Inativo'}</span><Switch checked={item.active} label={`${item.name} ativo`} disabled={busyId !== ''} onChange={active => void quickSave(item, { active })} /></div>
            <button type="button" className="sc-btn sc-btn-quiet" disabled={busy} aria-label={`Editar ${item.name}`} onClick={() => { setEditing(toDraft(item)); setRowError(''); }}>Editar</button>
          </div>
        </div>
      </li>;
    })}</ul>}
  </section>;
}
