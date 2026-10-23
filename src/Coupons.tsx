import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { formatMoney, parseMoney } from './domain';
import { parseCoupon } from './growth';
import type { Coupon, CouponDraft, CouponKind, GrowthApi } from './growth';
import './Dashboard.css';
import './Coupons.css';

const emptyDraft: CouponDraft = { id: '', code: '', description: '', kind: 'percent', value: 0, firstOrderOnly: false, minOrderCents: 0, startsOn: '', endsOn: '', maxUses: '', active: true };
const moneyInput = (cents: number) => cents > 0 ? `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}` : '';
const shortDate = (iso: string) => { const [y, m, d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };
const toDraft = (c: Coupon, active = c.active): CouponDraft => ({ id: c.id, code: c.code, description: c.description, kind: c.kind, value: c.value, firstOrderOnly: c.firstOrderOnly, minOrderCents: c.minOrderCents, startsOn: c.startsOn, endsOn: c.endsOn, maxUses: c.maxUses ?? '', active });

function ruleSummary(c: Coupon): string {
  const parts = [c.kind === 'percent' ? `${c.value}% de desconto` : `${formatMoney(c.value)} de desconto`];
  if (c.firstOrderOnly) parts.push('só no primeiro pedido');
  if (c.minOrderCents > 0) parts.push(`pedido mínimo ${formatMoney(c.minOrderCents)}`);
  if (c.startsOn && c.endsOn) parts.push(`de ${shortDate(c.startsOn)} a ${shortDate(c.endsOn)}`);
  else if (c.startsOn) parts.push(`a partir de ${shortDate(c.startsOn)}`);
  else if (c.endsOn) parts.push(`até ${shortDate(c.endsOn)}`);
  parts.push(c.maxUses === null ? `${c.uses} ${c.uses === 1 ? 'uso' : 'usos'}` : `${c.uses} de ${c.maxUses} usos`);
  return parts.join(' · ');
}

function errorText(error: unknown): string {
  return typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error ?? '');
}
function saveMessage(error: unknown): string {
  const message = errorText(error);
  if (message.includes('COUPON_CODE_TAKEN')) return 'Já existe um cupom com esse código.';
  if (message.includes('INVALID_COUPON')) return 'Confira os campos do cupom.';
  if (message.includes('ACCESS_DENIED')) return 'Só o dono pode gerenciar cupons.';
  return 'Não foi possível salvar o cupom. Tente novamente.';
}

/** Client-side mirror of the server limits; returns the payload or a message. */
function buildPayload(draft: CouponDraft, valueText: string, minText: string, maxUsesText: string): { payload: CouponDraft } | { error: string } {
  const code = draft.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return { error: 'O código precisa ter de 3 a 24 caracteres: letras de A a Z, números, _ ou -.' };
  if (draft.description.trim().length > 140) return { error: 'A descrição pode ter até 140 caracteres.' };
  let value: number;
  try { value = draft.kind === 'percent' ? (/^\d{1,3}$/.test(valueText.trim()) ? Number(valueText.trim()) : NaN) : parseMoney(valueText); } catch { return { error: 'Informe o valor do desconto.' }; }
  if (draft.kind === 'percent') {
    if (!Number.isInteger(value) || value < 1 || value > 90) return { error: 'O desconto percentual deve ser um número inteiro de 1 a 90.' };
  } else if (value < 1 || value > 10000000) return { error: 'Informe o valor do desconto em reais.' };
  let minOrderCents = 0;
  if (minText.trim()) { try { minOrderCents = parseMoney(minText); } catch { return { error: 'Confira o pedido mínimo.' }; } }
  if (minOrderCents > 100000000) return { error: 'Pedido mínimo alto demais.' };
  if (draft.startsOn && draft.endsOn && draft.startsOn > draft.endsOn) return { error: 'O início não pode ser depois do fim.' };
  let maxUses: number | '' = '';
  if (maxUsesText.trim()) {
    maxUses = Number(maxUsesText);
    if (!Number.isInteger(maxUses) || maxUses < 1) return { error: 'O limite de usos deve ser um número inteiro maior que zero.' };
  }
  return { payload: { id: draft.id, code, description: draft.description.trim(), kind: draft.kind, value, firstOrderOnly: draft.firstOrderOnly, minOrderCents, startsOn: draft.startsOn, endsOn: draft.endsOn, maxUses, active: draft.active } };
}

function Switch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="cp-switch" onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
}

function CouponForm({ initial, uses, api, onSaved, onCancel }: { initial: CouponDraft; uses: number; api: GrowthApi; onSaved: (coupon: Coupon) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [value, setValue] = useState(initial.kind === 'percent' ? (initial.value ? String(initial.value) : '') : moneyInput(initial.value));
  const [min, setMin] = useState(moneyInput(initial.minOrderCents));
  const [maxUses, setMaxUses] = useState(String(initial.maxUses));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const patch = (next: Partial<CouponDraft>) => setDraft(current => ({ ...current, ...next }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const built = buildPayload(draft, value, min, maxUses);
    if ('error' in built) { setError(built.error); return; }
    setError(''); setSaving(true);
    try { onSaved(parseCoupon(await api.call('save_coupon', { p_coupon: built.payload }))); }
    catch (e) { setError(saveMessage(e)); setSaving(false); }
  }
  const pick = (kind: CouponKind) => { if (kind !== draft.kind) { patch({ kind }); setValue(''); } };

  return <form className="sc-card panel cp-form" onSubmit={event => void submit(event)} aria-label={draft.id ? 'Editar cupom' : 'Novo cupom'}>
    <h2>{draft.id ? 'Editar cupom' : 'Novo cupom'}</h2>
    <div className="cp-grid">
      <label className="sc-field">Código<input value={draft.code} maxLength={24} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="BEMVINDO10" onChange={event => patch({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} /><small>De 3 a 24 caracteres: A–Z, 0–9, _ e -.</small></label>
      <label className="sc-field">Descrição<input value={draft.description} maxLength={140} placeholder="Ex.: 10% de boas-vindas" onChange={event => patch({ description: event.target.value })} /></label>
    </div>
    <fieldset className="cp-kinds"><legend>Tipo de desconto</legend>
      <label className="cp-tile"><input type="radio" name="kind" checked={draft.kind === 'percent'} onChange={() => pick('percent')} /><span><strong>Percentual</strong><small>Ex.: 10% do pedido</small></span></label>
      <label className="cp-tile"><input type="radio" name="kind" checked={draft.kind === 'fixed'} onChange={() => pick('fixed')} /><span><strong>Valor fixo</strong><small>Ex.: R$ 15,00 de desconto</small></span></label>
    </fieldset>
    <div className="cp-grid">
      <label className="sc-field">{draft.kind === 'percent' ? 'Valor (%)' : 'Valor (R$)'}<input value={value} inputMode={draft.kind === 'percent' ? 'numeric' : 'decimal'} placeholder={draft.kind === 'percent' ? '10' : '15,00'} onChange={event => setValue(event.target.value)} /><small>{draft.kind === 'percent' ? 'De 1 a 90.' : 'Descontado do total do pedido.'}</small></label>
      <label className="sc-field">Pedido mínimo (R$), opcional<input value={min} inputMode="decimal" placeholder="0,00" onChange={event => setMin(event.target.value)} /></label>
      <label className="sc-field">Início, opcional<input type="date" value={draft.startsOn} onChange={event => patch({ startsOn: event.target.value })} /></label>
      <label className="sc-field">Fim, opcional<input type="date" value={draft.endsOn} onChange={event => patch({ endsOn: event.target.value })} /></label>
      <label className="sc-field">Limite de usos, opcional<input type="number" min={1} step={1} inputMode="numeric" value={maxUses} placeholder="Sem limite" onChange={event => setMaxUses(event.target.value)} />{uses > 0 && <small>Já usado {uses} {uses === 1 ? 'vez' : 'vezes'}.</small>}</label>
    </div>
    <label className="cp-check"><input type="checkbox" checked={draft.firstOrderOnly} onChange={event => patch({ firstOrderOnly: event.target.checked })} /><span>Só no primeiro pedido do cliente (pelo WhatsApp)</span></label>
    <div className="cp-active"><span>Cupom ativo</span><Switch checked={draft.active} label="Cupom ativo" onChange={active => patch({ active })} /></div>
    <p className="hint cp-note">O cliente digita o código no site de pedidos; a equipe confirma o valor final antes de fechar o pedido.</p>
    {error && <p role="alert" className="sc-alert">{error}</p>}
    <div className="cp-actions"><button className="sc-btn sc-btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar cupom'}</button><button type="button" className="sc-btn sc-btn-secondary" disabled={saving} onClick={onCancel}>Cancelar</button></div>
  </form>;
}

export default function Coupons({ api }: { api: GrowthApi }) {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<{ draft: CouponDraft; uses: number } | null>(null);
  const [busyId, setBusyId] = useState('');
  const [rowError, setRowError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const rows = await api.call('read_coupons');
      if (!Array.isArray(rows)) throw new Error('Resposta inválida.');
      setCoupons(rows.map(parseCoupon));
    } catch (e) { setLoadError(errorText(e).includes('ACCESS_DENIED') ? 'Só o dono pode gerenciar cupons.' : 'Não foi possível carregar os cupons.'); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const create = (code = '', firstOrderOnly = false, value = 0) => { setEditing({ draft: { ...emptyDraft, code, firstOrderOnly, value }, uses: 0 }); setRowError(''); };
  const saved = (coupon: Coupon) => { setCoupons(current => { const list = current ?? []; return list.some(item => item.id === coupon.id) ? list.map(item => item.id === coupon.id ? coupon : item) : [coupon, ...list]; }); setEditing(null); };

  async function toggle(c: Coupon) {
    if (busyId) return;
    setBusyId(c.id); setRowError('');
    try {
      const next = parseCoupon(await api.call('save_coupon', { p_coupon: toDraft(c, !c.active) }));
      setCoupons(current => (current ?? []).map(item => item.id === next.id ? next : item));
    } catch (e) { setRowError(saveMessage(e)); } finally { setBusyId(''); }
  }

  return <section className="dash coupons" aria-labelledby="coupons-title">
    <header className="dash-head"><div><h1 id="coupons-title">Cupons</h1><p>Descontos que o cliente digita no site de pedidos. A equipe confirma o valor final.</p></div>
      {!editing && <button type="button" className="sc-btn sc-btn-primary" onClick={() => create()}>Novo cupom</button>}</header>
    {editing && <CouponForm key={editing.draft.id || 'new'} initial={editing.draft} uses={editing.uses} api={api} onSaved={saved} onCancel={() => setEditing(null)} />}
    {rowError && <p role="alert" className="sc-alert">{rowError}</p>}
    {coupons === null && !loadError && <p role="status" className="hint">Carregando cupons…</p>}
    {loadError && <div className="sc-alert cp-retry" role="alert"><span>{loadError}</span><button type="button" className="sc-btn sc-btn-secondary" onClick={() => void load()}>Tentar de novo</button></div>}
    {coupons && coupons.length === 0 && !editing && <article className="sc-card panel cp-empty"><h2>Nenhum cupom ainda</h2>
      <p>Um cupom de primeiro pedido vale só para quem ainda não comprou: o site confere o WhatsApp do cliente e recusa o código se ele já tiver pedido antes. É um jeito simples de trazer clientes novos.</p>
      <div><button type="button" className="sc-btn sc-btn-primary" onClick={() => create('BEMVINDO10', true, 10)}>Criar BEMVINDO10</button></div></article>}
    {coupons && coupons.length > 0 && <ul className="cp-list">{coupons.map(c => <li key={c.id} className={`sc-card cp-row${c.active ? '' : ' is-off'}`}>
      <div className="cp-main"><div className="cp-top"><strong className="cp-code">{c.code}</strong><span className={`sc-stage ${c.active ? 'sc-stage-ready' : ''}`}>{c.active ? 'Ativo' : 'Inativo'}</span></div>
        {c.description && <p className="cp-desc">{c.description}</p>}<p className="cp-rule sc-num">{ruleSummary(c)}</p></div>
      <div className="cp-tools"><div className="cp-active"><span>{c.active ? 'Ativo' : 'Inativo'}</span><Switch checked={c.active} label={`${c.code} ativo`} disabled={busyId !== ''} onChange={() => void toggle(c)} /></div>
        <button type="button" className="sc-btn sc-btn-secondary" onClick={() => { setEditing({ draft: toDraft(c), uses: c.uses }); setRowError(''); }} aria-label={`Editar ${c.code}`}>Editar</button></div>
    </li>)}</ul>}
  </section>;
}
