import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import '@fontsource/gloock/400.css';
import '@fontsource-variable/onest';
import { catalog } from './catalog';
import type { CatalogItem } from './catalog';
import { addDays, formatMoney, localDateKey } from './domain';
import type { Fulfillment, OrderLine } from './domain';
import { estimate, MAX_REQUEST_LINES, REQUEST_HORIZON_DAYS, requestProblem } from './requests';
import type { OrderRequestInput, RequestLine } from './requests';
import { rpc } from './shared';
import { parsePublicSettings } from './settings';
import type { PublicSettings } from './settings';
import './PublicOrder.css';

type Custom = { key: string; description: string; quantity: string; unit: OrderLine['unit'] };
type Section = { id: string; title: string; note: string; items: CatalogItem[] };
const sections: Section[] = [
  { id: 'bolos', title: 'Bolos', note: 'Linha party, vendidos por quilo.', items: catalog.filter(item => item.category.startsWith('Bolos')) },
  { id: 'salgados', title: 'Mini salgados', note: 'Preço por unidade. Os botões somam de 10 em 10; você pode digitar outra quantidade.', items: catalog.filter(item => item.category.startsWith('Mini')) },
];
const unitShort: Record<OrderLine['unit'], string> = { un: 'un', kg: 'kg', cento: 'cento' };
// Steps match how each line is sold: cakes by half kilo, party savouries by ten.
const step = (item: CatalogItem) => item.unit === 'kg' ? 0.5 : 10;
const firstAdd = (item: CatalogItem) => item.unit === 'kg' ? 1 : 10;
const shortName = (item: CatalogItem) => item.description.replace(' · linha party', '').replace(/^Bolo /, '');
const qtyText = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const parseQty = (value: string) => Number(value.trim().replace(',', '.'));

function Icon({ name }: { name: 'plus' | 'minus' | 'box' | 'back' | 'check' | 'chat' }) {
  const paths = {
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', back: 'M15 18l-6-6 6-6', check: 'M5 12.5l4.5 4.5L19 7',
    box: 'M3 8.5 12 4l9 4.5v9L12 22l-9-4.5v-9ZM3 8.5l9 4.5 9-4.5M12 13v9',
    chat: 'M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z',
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function Stepper({ item, value, onChange }: { item: CatalogItem; value: number; onChange: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = shortName(item);
  if (!value) return <button type="button" className="po-add" onClick={() => onChange(firstAdd(item))} aria-label={`Adicionar ${name}`}><Icon name="plus" />Adicionar</button>;
  return <div className="po-stepper" role="group" aria-label={`Quantidade de ${name}`}>
    <button type="button" onClick={() => onChange(Math.max(0, Math.round((value - step(item)) * 1000) / 1000))} aria-label={value - step(item) <= 0 ? `Remover ${name}` : `Diminuir ${name}`}><Icon name="minus" /></button>
    <label><span className="sr-only">Quantidade de {name} em {unitShort[item.unit]}</span>
      <input inputMode="decimal" value={draft ?? qtyText(value)} onFocus={event => { setDraft(qtyText(value)); event.target.select(); }}
        onChange={event => { if (/^\d{0,4}(?:[,.]\d{0,3})?$/.test(event.target.value)) setDraft(event.target.value); }}
        onBlur={() => { const next = parseQty(draft ?? ''); setDraft(null); if (Number.isFinite(next) && next >= 0 && next <= 1000) onChange(item.unit === 'kg' ? Math.round(next * 1000) / 1000 : Math.round(next)); }}
        onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
      <span aria-hidden="true">{unitShort[item.unit]}</span></label>
    <button type="button" onClick={() => onChange(Math.min(1000, Math.round((value + step(item)) * 1000) / 1000))} aria-label={`Aumentar ${name}`}><Icon name="plus" /></button>
  </div>;
}

function Thumb({ item }: { item?: CatalogItem }) {
  // Items without their own photo wear the shop's badge rather than an initial that reads like a glitch.
  if (item) return <img className="po-thumb" src={item.photo ?? '/brand/saint-cakes.png'} alt="" />;
  return <span className="po-thumb po-thumb-mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></svg></span>;
}

export default function PublicOrder({ client }: { client: SupabaseClient | null }) {
  const today = localDateKey();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [recent, setRecent] = useState<string | null>(null);
  const [custom, setCustom] = useState<Custom[]>([]);
  const [view, setView] = useState<'shop' | 'checkout'>('shop');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState(addDays(today, 2));
  const [time, setTime] = useState('14:00');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('pickup');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [trap, setTrap] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [active, setActive] = useState('bolos');
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Defaults match the catalogue rule; the server applies the owner's current values regardless.
  const [shop, setShop] = useState<PublicSettings>({ minLeadDays: 2, deliveryZones: [] });
  const [zone, setZone] = useState('');
  useEffect(() => {
    if (!client) return;
    let alive = true;
    rpc(client, 'public_settings').then(value => { if (alive) setShop(parsePublicSettings(value)); }).catch(() => { /* Keep defaults. */ });
    return () => { alive = false; };
  }, [client]);
  useEffect(() => {
    if (view !== 'shop' || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.po-section').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [view]);
  const fee = fulfillment === 'delivery' ? shop.deliveryZones.find(item => item.name === zone) : undefined;

  // The box lists items in the order the visitor picked them, so the phone bar shows the newest.
  const chosen = useMemo(() => added.map(id => catalog.find(item => item.id === id)).filter((item): item is CatalogItem => !!item && quantities[item.id] > 0), [added, quantities]);
  const lines = useMemo<RequestLine[]>(() => [
    ...chosen.map(item => ({ description: item.description, quantity: quantities[item.id], unit: item.unit, unitPriceCents: item.unitPriceCents })),
    ...custom.filter(line => line.description.trim()).map(line => ({ description: `${line.description.trim()} · sob orçamento`.slice(0, 180), quantity: parseQty(line.quantity), unit: line.unit, unitPriceCents: 0 })),
  ], [chosen, quantities, custom]);
  // The fee line is shown here but added by the server from the owner's table, never sent by the browser.
  const shown = useMemo(() => fee?.feeCents ? [...lines, { description: `Frete · ${fee.name}`, quantity: 1, unit: 'un' as const, unitPriceCents: fee.feeCents }] : lines, [lines, fee]);
  const money = useMemo(() => { try { return estimate(shown); } catch { return null; } }, [shown]);
  const quoted = lines.some(line => line.unitPriceCents === 0);
  const minDate = quoted ? addDays(today, shop.minLeadDays) : today;
  const count = lines.length;

  function setQuantity(item: CatalogItem, next: number) {
    setQuantities(current => ({ ...current, [item.id]: next }));
    if (next > 0 && !(quantities[item.id] > 0)) setAdded(current => [...current.filter(id => id !== item.id), item.id]);
    if (next > (quantities[item.id] ?? 0)) { setRecent(item.id); window.setTimeout(() => setRecent(current => current === item.id ? null : current), 700); }
    setError('');
  }
  function fail(message: string) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); }
  function openCheckout() { if (!count) return; setView('checkout'); setError(''); window.scrollTo({ top: 0 }); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    const input: OrderRequestInput = { customer, phone, date, time, fulfillment, address: fulfillment === 'delivery' ? address : '', deliveryZone: fulfillment === 'delivery' ? zone : '', notes, lines };
    const problem = requestProblem(input, today, shop);
    if (problem) return fail(problem);
    // Bots fill hidden fields; show the same confirmation without sending anything.
    if (trap) { setSent(true); return; }
    if (!client) return fail('Os pedidos pelo site estão indisponíveis no momento. Chame a Saint Cakes no WhatsApp.');
    setSending(true); setError('');
    try { await rpc(client, 'submit_order_request', { p_request: input }); setSent(true); window.scrollTo({ top: 0 }); }
    catch (failure) {
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '';
      fail(message.includes('REQUEST_LIMIT') ? 'Recebemos muitos pedidos agora. Tente novamente em alguns minutos ou chame a Saint Cakes no WhatsApp.'
        : message.includes('INVALID_REQUEST') ? 'Confira os dados do pedido: data, bairro e WhatsApp com DDD.'
        : 'Não foi possível enviar. Confira a conexão e tente novamente.');
    } finally { setSending(false); }
  }
  function restart() { setQuantities({}); setAdded([]); setCustom([]); setNotes(''); setSent(false); setError(''); setView('shop'); }

  const header = <header className="po-band"><div className="po-band-inner"><img src="/brand/saint-cakes.png" alt="Saint Cakes" width="56" height="56" /><span>Encomendas Saint Cakes</span></div></header>;

  if (sent) return <div className="po">{header}<main className="po-done">
    <span className="po-done-mark"><Icon name="check" /></span>
    <h1>Pedido enviado</h1>
    <p>Obrigado{customer.trim() ? `, ${customer.trim().split(/\s+/)[0]}` : ''}. A equipe vai conferir sua caixa e chamar você no WhatsApp para confirmar valores, detalhes e o sinal de 50%.</p>
    <p className="po-muted">A encomenda fica garantida depois dessa confirmação.</p>
    <button type="button" className="po-primary" onClick={restart}>Montar outra caixa</button>
  </main></div>;

  const boxSummary = <>
    <div className="po-box-thumbs" aria-hidden="true">
      {chosen.slice(-4).map(item => <span key={item.id} className={recent === item.id ? 'po-pop' : ''}><Thumb item={item} /></span>)}
      {custom.some(line => line.description.trim()) && <span><Thumb /></span>}
    </div>
    <div className="po-box-text"><strong>{count ? <><span className="po-box-label">Sua caixa · </span>{count} {count === 1 ? 'item' : 'itens'}</> : 'Sua caixa está vazia'}</strong>
      <span>{money && money.totalCents > 0 ? `${formatMoney(money.totalCents)}${money.quoted ? ' + orçamento' : ''}` : count ? 'Sob orçamento' : 'Toque em Adicionar'}</span></div>
  </>;

  if (view === 'checkout') return <div className="po">{header}
    <form className="po-checkout" onSubmit={event => void submit(event)} noValidate>
      <button type="button" className="po-back" onClick={() => { setView('shop'); setError(''); }}><Icon name="back" />Continuar escolhendo</button>
      <h1>Fechar pedido</h1>
      <div className="po-checkout-grid">
        <div className="po-checkout-main">
          <section aria-labelledby="po-box-title" className="po-panel">
            <h2 id="po-box-title">Sua caixa</h2>
            <ul className="po-review">
              {chosen.map(item => <li key={item.id}><Thumb item={item} /><div><strong>{shortName(item)}</strong><span>{formatMoney(item.unitPriceCents)}/{unitShort[item.unit]}</span></div><Stepper item={item} value={quantities[item.id]} onChange={next => setQuantity(item, next)} /></li>)}
              {custom.filter(line => line.description.trim()).map(line => <li key={line.key}><Thumb /><div><strong>{line.description.trim()}</strong><span>{line.quantity} {unitShort[line.unit]} · sob orçamento</span></div><button type="button" className="po-link" onClick={() => setCustom(current => current.filter(item => item.key !== line.key))}>Remover</button></li>)}
            </ul>
            {!count && <p className="po-muted">Sua caixa ficou vazia. <button type="button" className="po-link" onClick={() => setView('shop')}>Voltar aos produtos</button></p>}
          </section>
          <section aria-labelledby="po-when-title" className="po-panel">
            <h2 id="po-when-title">Quando e como</h2>
            <div className="po-choice" role="radiogroup" aria-label="Retirada ou entrega">
              {(['pickup', 'delivery'] as Fulfillment[]).map(option => <label key={option} className={fulfillment === option ? 'is-on' : ''}><input type="radio" name="fulfillment" checked={fulfillment === option} onChange={() => setFulfillment(option)} /><strong>{option === 'pickup' ? 'Retirar na loja' : 'Receber em casa'}</strong><span>{option === 'pickup' ? 'Sem custo de entrega' : 'Joinville e região'}</span></label>)}
            </div>
            <div className="po-row">
              <label className="po-field">Data<input type="date" required min={minDate} max={addDays(today, REQUEST_HORIZON_DAYS)} value={date} onChange={event => setDate(event.target.value)} /></label>
              <label className="po-field">Horário<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
            </div>
            {quoted && shop.minLeadDays > 0 && <p className="po-hint">Itens sob orçamento precisam de pelo menos {shop.minLeadDays} dia{shop.minLeadDays === 1 ? '' : 's'} de antecedência.</p>}
            {fulfillment === 'delivery' && shop.deliveryZones.length > 0 && <label className="po-field">Bairro<select required value={zone} onChange={event => setZone(event.target.value)}><option value="">Escolha o bairro</option>{[...shop.deliveryZones].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(item => <option key={item.name} value={item.name}>{item.name} · {item.feeCents ? formatMoney(item.feeCents) : 'frete grátis'}</option>)}</select><small>Não encontrou seu bairro? Chame a Saint Cakes no WhatsApp.</small></label>}
            {fulfillment === 'delivery' && <label className="po-field">Endereço<textarea rows={2} maxLength={300} value={address} onChange={event => setAddress(event.target.value)} placeholder="Rua, número e complemento" />{!shop.deliveryZones.length && <small>O valor do frete é informado pela equipe.</small>}</label>}
          </section>
          <section aria-labelledby="po-you-title" className="po-panel">
            <h2 id="po-you-title">Seus dados</h2>
            <div className="po-row">
              <label className="po-field">Nome<input autoComplete="name" required maxLength={100} value={customer} onChange={event => setCustomer(event.target.value)} /></label>
              <label className="po-field">WhatsApp com DDD<input type="tel" autoComplete="tel" required maxLength={30} placeholder="(47) 99999-9999" value={phone} onChange={event => setPhone(event.target.value)} /></label>
            </div>
            <label className="po-field">Observações<textarea rows={3} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Nome no bolo, decoração, alergias…" /></label>
            <label className="po-trap" aria-hidden="true">Site<input tabIndex={-1} autoComplete="off" value={trap} onChange={event => setTrap(event.target.value)} /></label>
          </section>
        </div>
        <aside className="po-total" aria-label="Total do pedido">
          <dl>
            {shown.map((line, index) => <div key={index}><dt>{qtyText(line.quantity)} {unitShort[line.unit]} · {line.description.replace(' · linha party', '').replace(/^Bolo /, '')}</dt><dd>{line.unitPriceCents ? formatMoney(estimate([line]).totalCents) : 'a orçar'}</dd></div>)}
          </dl>
          <div className="po-total-sum"><span>Total estimado</span><strong>{money && money.totalCents > 0 ? formatMoney(money.totalCents) : '—'}{money?.quoted && money.totalCents > 0 ? ' + orçamento' : ''}</strong></div>
          <div className="po-total-deposit"><span>Sinal de 50% para confirmar</span><strong>{money && money.depositCents > 0 ? formatMoney(money.depositCents) : '—'}</strong></div>
          <p className="po-muted">Valores do catálogo. Frete de bairros fora da lista, personalizados e o valor final são confirmados pela equipe no WhatsApp.</p>
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="po-error">{error}</p>}
          <button className="po-primary po-total-send" disabled={sending || !count}><Icon name="chat" />{sending ? 'Enviando…' : 'Enviar pedido'}</button>
        </aside>
      </div>
      {/* Phones keep the total and deposit in view for the whole form, as the shop's box bar does. */}
      <div className="po-checkout-bar">
        <div><strong>{money && money.totalCents > 0 ? formatMoney(money.totalCents) : 'Sob orçamento'}{money?.quoted && money.totalCents > 0 ? ' + orçamento' : ''}</strong>
          <span>{money && money.depositCents > 0 ? `Sinal de 50%: ${formatMoney(money.depositCents)}` : 'A equipe confirma o valor'}</span></div>
        <button className="po-primary" disabled={sending || !count}><Icon name="chat" />{sending ? 'Enviando…' : 'Enviar pedido'}</button>
      </div>
    </form>
  </div>;

  return <div className="po">{header}
    <main className="po-shop">
      <section className="po-hero">
        <div className="po-hero-text">
          <h1>Monte sua caixa</h1>
          <p>Escolha bolos e salgados, diga quando e como quer receber. A equipe confirma tudo com você pelo WhatsApp.</p>
          <ul className="po-facts"><li>Retirada na loja ou entrega em Joinville</li><li>Sinal de 50% para confirmar</li></ul>
        </div>
        <img className="po-hero-photo" src="/products/hero-bolo.webp" alt="Bolo de chocolate com morangos da Saint Cakes" width="1100" height="1467" fetchPriority="high" />
      </section>
      <nav className="po-tabs" aria-label="Categorias">
        {[...sections.map(section => ({ id: section.id, title: section.title })), { id: 'sob-medida', title: 'Sob medida' }].map(tab => <a key={tab.id} href={`#${tab.id}`} aria-current={active === tab.id ? 'true' : undefined}>{tab.title}</a>)}
      </nav>
      <div className="po-layout">
        <div className="po-catalog">
          {sections.map(section => {
            const featured = section.items.filter(item => item.photo);
            const rest = section.items.filter(item => !item.photo);
            return <section key={section.id} id={section.id} className="po-section" aria-labelledby={`${section.id}-title`}>
              <div className="po-section-head"><h2 id={`${section.id}-title`}>{section.title}</h2><p>{section.note}</p></div>
              <div className="po-featured">
                {featured.map(item => <article key={item.id} className={`po-card ${quantities[item.id] ? 'is-in' : ''}`}>
                  <img src={item.photo} alt={shortName(item)} loading="lazy" />
                  <div className="po-card-body"><h3>{shortName(item)}</h3>{item.details && <p>{item.details}</p>}
                    <div className="po-card-foot"><span className="po-price">{formatMoney(item.unitPriceCents)}<small>/{unitShort[item.unit]}</small></span><Stepper item={item} value={quantities[item.id] ?? 0} onChange={next => setQuantity(item, next)} /></div></div>
                </article>)}
              </div>
              <ul className="po-menu">
                {rest.map(item => <li key={item.id} className={quantities[item.id] ? 'is-in' : ''}>
                  <div><h3>{shortName(item)}</h3>{item.details && <p>{item.details}</p>}</div>
                  <span className="po-price">{formatMoney(item.unitPriceCents)}<small>/{unitShort[item.unit]}</small></span>
                  <Stepper item={item} value={quantities[item.id] ?? 0} onChange={next => setQuantity(item, next)} />
                </li>)}
              </ul>
            </section>;
          })}
          <section id="sob-medida" className="po-section" aria-labelledby="sob-medida-title">
            <div className="po-section-head"><h2 id="sob-medida-title">Sob medida</h2><p>Bolos personalizados, kits e o que não estiver no catálogo. A equipe faz o orçamento.{shop.minLeadDays ? ` Peça com pelo menos ${shop.minLeadDays} dia${shop.minLeadDays === 1 ? '' : 's'} de antecedência.` : ''}</p></div>
            <div className="po-custom-list">
              {custom.map(line => <div className="po-custom" key={line.key}>
                <label className="po-field po-custom-what">O que você imagina?<input value={line.description} maxLength={150} placeholder="Ex.: bolo tema safari, 2 kg, topo com nome" onChange={event => setCustom(current => current.map(item => item.key === line.key ? { ...item, description: event.target.value } : item))} /></label>
                <label className="po-field">Quantidade<input inputMode="decimal" value={line.quantity} onChange={event => setCustom(current => current.map(item => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></label>
                <label className="po-field">Unidade<select value={line.unit} onChange={event => setCustom(current => current.map(item => item.key === line.key ? { ...item, unit: event.target.value as OrderLine['unit'] } : item))}><option value="un">un</option><option value="kg">kg</option><option value="cento">cento</option></select></label>
                <button type="button" className="po-link" onClick={() => setCustom(current => current.filter(item => item.key !== line.key))}>Remover</button>
              </div>)}
              <button type="button" className="po-ghost" disabled={lines.length >= MAX_REQUEST_LINES} onClick={() => setCustom(current => [...current, { key: crypto.randomUUID(), description: '', quantity: '1', unit: 'un' }])}><Icon name="plus" />Pedir algo sob medida</button>
            </div>
          </section>
        </div>
        <aside className="po-box" aria-label="Sua caixa">
          <div className="po-box-summary">{boxSummary}</div>
          {count > 0 && <ul className="po-box-lines">{lines.map((line, index) => <li key={index}><span>{qtyText(line.quantity)} {unitShort[line.unit]}</span>{line.description.replace(' · linha party', '').replace(/^Bolo /, '')}</li>)}</ul>}
          {count > 0 && money && money.depositCents > 0 && <p className="po-box-deposit">Sinal de 50%: {formatMoney(money.depositCents)}</p>}
          <button type="button" className="po-primary" disabled={!count} onClick={openCheckout}><Icon name="box" />Fechar pedido</button>
        </aside>
      </div>
    </main>
  </div>;
}
