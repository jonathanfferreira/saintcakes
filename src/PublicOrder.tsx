import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import '@fontsource/gloock/400.css';
import '@fontsource-variable/onest';
import { parseStorefront, saintStorefront } from './storefront';
import type { Storefront } from './storefront';
import { useStorefrontTheme } from './useStorefrontTheme';
import { whatsappLink } from './settings';
import type { CatalogItem } from './catalog';
import { addDays, formatMoney, localDateKey } from './domain';
import type { Fulfillment, OrderLine } from './domain';
import { estimate, MAX_REQUEST_LINES, REQUEST_HORIZON_DAYS, requestPayload, requestProblem } from './requests';
import type { OrderRequestInput, RequestLine } from './requests';
import { couponMessage, parseCouponQuote, parsePublicShowcaseItem, showcasePhotoUrl } from './growth';
import type { PublicShowcaseItem } from './growth';
import { rpc } from './shared';
import { parsePublicSettings } from './settings';
import type { PublicSettings } from './settings';
import './PublicOrder.css';

type Custom = { key: string; description: string; quantity: string; unit: OrderLine['unit'] };
type Section = { id: string; title: string; note: string; items: CatalogItem[] };
function catalogSections(catalog: CatalogItem[]): Section[] {
  return [...new Set(catalog.map(item => item.category))].map((category, index) => ({ id: category === 'Bolos · linha party' ? 'bolos' : category === 'Mini salgados diversos' ? 'salgados' : `categoria-${index}`, title: category, note: '', items: catalog.filter(item => item.category === category) }));
}
const unitShort: Record<OrderLine['unit'], string> = { un: 'un', kg: 'kg', cento: 'cento' };
// Steps match how each line is sold: cakes by half kilo, party savouries by ten.
const step = (item: CatalogItem) => item.unit === 'kg' ? 0.5 : item.unit === 'un' && /^mini-\d+$/.test(item.id) && item.category === 'Mini salgados diversos' ? 10 : 1;
const firstAdd = (item: CatalogItem) => item.unit === 'kg' ? 1 : step(item);
const shortName = (item: CatalogItem) => item.category === 'Bolos · linha party' && /^party-\d+$/.test(item.id) ? item.description.replace(' · linha party', '').replace(/^Bolo /, '') : item.description;
const qtyText = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const parseQty = (value: string) => Number(value.trim().replace(',', '.'));
const catalogStep = (item: CatalogItem) => ({ name: shortName(item), unit: item.unit, stepBy: step(item), first: firstAdd(item) });
// Ready-to-go items sell by one (kg by half) and never past the stock on the shelf.
const showcaseStep = (item: PublicShowcaseItem) => ({ name: item.name, unit: item.unit, stepBy: item.unit === 'kg' ? 0.5 : 1, first: Math.min(1, item.stock), max: item.stock });
const showcasePhoto = (item: PublicShowcaseItem) => showcasePhotoUrl(String(import.meta.env.VITE_SUPABASE_URL ?? ''), item.photoPath);
const stockText = (item: PublicShowcaseItem) => `${qtyText(item.stock)} ${item.stock === 1 ? 'disponível' : 'disponíveis'}`;

function Icon({ name }: { name: 'plus' | 'minus' | 'box' | 'back' | 'check' | 'chat' }) {
  const paths = {
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', back: 'M15 18l-6-6 6-6', check: 'M5 12.5l4.5 4.5L19 7',
    box: 'M3 8.5 12 4l9 4.5v9L12 22l-9-4.5v-9ZM3 8.5l9 4.5 9-4.5M12 13v9',
    chat: 'M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z',
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

type StepProps = { name: string; unit: OrderLine['unit']; stepBy: number; first: number; max?: number };
function Stepper({ name, unit, stepBy, first, max = 1000, value, onChange }: StepProps & { value: number; onChange: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const round = (next: number) => unit === 'kg' ? Math.round(next * 1000) / 1000 : Math.round(next);
  if (!value) return <button type="button" className="po-add" onClick={() => onChange(Math.min(first, max))} aria-label={`Adicionar ${name}`}><Icon name="plus" />Adicionar</button>;
  return <div className="po-stepper" role="group" aria-label={`Quantidade de ${name}`}>
    <button type="button" onClick={() => onChange(Math.max(0, Math.round((value - stepBy) * 1000) / 1000))} aria-label={value - stepBy <= 0 ? `Remover ${name}` : `Diminuir ${name}`}><Icon name="minus" /></button>
    <label><span className="sr-only">Quantidade de {name} em {unitShort[unit]}</span>
      <input inputMode="decimal" value={draft ?? qtyText(value)} onFocus={event => { setDraft(qtyText(value)); event.target.select(); }}
        onChange={event => { if (/^\d{0,4}(?:[,.]\d{0,3})?$/.test(event.target.value)) setDraft(event.target.value); }}
        onBlur={() => { const next = parseQty(draft ?? ''); setDraft(null); if (Number.isFinite(next) && next >= 0 && next <= 1000) onChange(Math.min(round(next), max)); }}
        onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
      <span aria-hidden="true">{unitShort[unit]}</span></label>
    <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, Math.round((value + stepBy) * 1000) / 1000))} aria-label={`Aumentar ${name}`}><Icon name="plus" /></button>
  </div>;
}

function Thumb({ item, src, badge = '' }: { item?: CatalogItem; src?: string; badge?: string }) {
  // Items without their own photo wear the shop's badge rather than an initial that reads like a glitch.
  if (src) return <img className="po-thumb" src={src} alt="" />;
  if (item?.photo || badge) return <img className="po-thumb" src={item?.photo || badge} alt="" />;
  return <span className="po-thumb po-thumb-mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></svg></span>;
}

export default function PublicOrder({ client, shop: shopSlug }: { client: SupabaseClient | null; shop: string }) {
  const [storeState, setStoreState] = useState<'loading' | 'ready' | 'notFound' | 'error'>(() => !shopSlug ? 'notFound' : client ? 'loading' : shopSlug === 'saint-cakes' ? 'ready' : 'notFound');
  const [storeRetry, setStoreRetry] = useState(0);
  const [storefront, setStorefront] = useState<Storefront | null>(() => !client && shopSlug === 'saint-cakes' ? saintStorefront : null);
  useStorefrontTheme(storefront);
  const catalog = storefront?.catalog ?? [];
  const sections = catalogSections(catalog);
  const badge = storefront?.logoUrl ?? '';
  const shopName = storefront?.name ?? 'Loja';
  const shopWhatsapp = storefront?.whatsapp ? whatsappLink(storefront.whatsapp) : null;
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
  const [marketing, setMarketing] = useState(false);
  const [showcase, setShowcase] = useState<PublicShowcaseItem[]>([]);
  const [showcaseError, setShowcaseError] = useState('');
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [showcaseNeedsRefresh, setShowcaseNeedsRefresh] = useState(false);
  const showcaseToken = useRef(0);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponNote, setCouponNote] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [discount, setDiscount] = useState(0);
  const couponToken = useRef(0);
  const couponChecked = useRef('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Defaults match the catalogue rule; the server applies the owner's current values regardless.
  const [shop, setShop] = useState<PublicSettings>({ minLeadDays: 2, deliveryZones: [] });
  const [zone, setZone] = useState('');
  useEffect(() => {
    if (!client || !shopSlug) return;
    let alive = true;
    // Sem confirmar a loja no servidor, não mostramos um catálogo de outra empresa como fallback.
    setStoreState('loading');
    Promise.all([rpc(client, 'public_settings', { p_shop: shopSlug }), rpc(client, 'public_storefront', { p_shop: shopSlug })]).then(([value, profile]) => {
      if (!alive) return;
      const next = parseStorefront(profile);
      setShop(parsePublicSettings(value)); setStorefront(next); setActive(catalogSections(next.catalog)[0]?.id ?? 'sob-medida'); setStoreState('ready');
    }).catch(failure => {
      if (!alive) return;
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '';
      setStoreState(message.includes('SHOP_NOT_FOUND') ? 'notFound' : 'error');
    });
    return () => { alive = false; };
  }, [client, shopSlug, storeRetry]);
  useEffect(() => { document.title = storeState === 'ready' && storefront ? `${storefront.name} · Faça sua encomenda` : 'Encomendas'; }, [storeState, storefront]);
  // The showcase is optional: a failed call just hides the section. Picks are clamped to what is still on the shelf.
  function loadShowcase() {
    if (!client || !shopSlug) return;
    const token = ++showcaseToken.current;
    setShowcaseBusy(true);
    rpc(client, 'public_showcase', { p_shop: shopSlug }).then(value => {
      if (token !== showcaseToken.current) return;
      const items = (Array.isArray(value) ? value : []).flatMap(raw => { try { const item = parsePublicShowcaseItem(raw); return item.stock > 0 ? [item] : []; } catch { return []; } });
      setShowcase(items);
      setPicks(current => Object.fromEntries(Object.entries(current).flatMap(([id, quantity]) => { const item = items.find(entry => entry.id === id); return item ? [[id, Math.min(quantity, item.stock)]] : []; })));
      setShowcaseError(''); setShowcaseNeedsRefresh(false);
    }).catch(() => { if (token === showcaseToken.current) setShowcaseError('Não foi possível atualizar a pronta entrega. Sua seleção foi mantida.'); })
      .finally(() => { if (token === showcaseToken.current) setShowcaseBusy(false); });
  }
  useEffect(() => { loadShowcase(); return () => { showcaseToken.current++; }; }, [client, shopSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (storeState !== 'ready' || view !== 'shop' || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.po-section').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [view, showcase.length, storeState]);
  const fee = fulfillment === 'delivery' ? shop.deliveryZones.find(item => item.name === zone) : undefined;

  // The box lists items in the order the visitor picked them, so the phone bar shows the newest.
  const chosen = useMemo(() => added.map(id => catalog.find(item => item.id === id)).filter((item): item is CatalogItem => !!item && quantities[item.id] > 0), [added, quantities, catalog]);
  const pickedShowcase = useMemo(() => showcase.filter(item => picks[item.id] > 0), [showcase, picks]);
  const showcaseLines = useMemo<RequestLine[]>(() => pickedShowcase.map(item => ({ description: item.name, quantity: picks[item.id], unit: item.unit, unitPriceCents: item.priceCents })), [pickedShowcase, picks]);
  const lines = useMemo<RequestLine[]>(() => [
    ...chosen.map(item => ({ catalogItemId: item.id, description: item.description, quantity: quantities[item.id], unit: item.unit, unitPriceCents: item.unitPriceCents })),
    ...custom.filter(line => line.description.trim()).map(line => ({ description: `${line.description.trim()} · sob orçamento`.slice(0, 180), quantity: parseQty(line.quantity), unit: line.unit, unitPriceCents: 0 })),
  ], [chosen, quantities, custom]);
  // The fee line is shown here but added by the server from the owner's table, never sent by the browser.
  const boxLines = useMemo(() => [...showcaseLines, ...lines], [showcaseLines, lines]);
  const shown = useMemo(() => fee?.feeCents ? [...boxLines, { description: `Frete · ${fee.name}`, quantity: 1, unit: 'un' as const, unitPriceCents: fee.feeCents }] : boxLines, [boxLines, fee]);
  const gross = useMemo(() => { try { return estimate(shown); } catch { return null; } }, [shown]);
  // What a coupon applies to: priced catalogue and showcase lines, never quoted items or the delivery fee.
  const subtotalCents = useMemo(() => { try { return estimate(boxLines).totalCents; } catch { return 0; } }, [boxLines]);
  const money = useMemo(() => {
    if (!gross || !coupon) return gross;
    const totalCents = Math.max(0, gross.totalCents - coupon.discountCents);
    return { ...gross, totalCents, depositCents: Math.ceil(totalCents / 2) };
  }, [gross, coupon]);
  const quoted = lines.some(line => line.unitPriceCents === 0);
  const minDate = quoted ? addDays(today, shop.minLeadDays) : today;
  const count = boxLines.length;
  const phoneDigits = phone.replace(/\D/g, '').length;
  const couponCode = coupon?.code ?? '';
  useEffect(() => { couponToken.current++; setCouponBusy(false); }, [phone, subtotalCents]);

  async function askCoupon(code: string) {
    return parseCouponQuote(await rpc(client as SupabaseClient, 'check_coupon', { p_shop: shopSlug, p_code: code, p_phone: phone, p_subtotal_cents: subtotalCents }));
  }
  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return setCouponNote('Digite o código do cupom.');
    if (phoneDigits < 10) return setCouponNote('Preencha seu WhatsApp com DDD antes de aplicar o cupom.');
    if (!subtotalCents) return setCouponNote('Adicione itens com preço para usar um cupom.');
    if (!client) return setCouponNote('Não foi possível conferir o cupom agora. Tente novamente.');
    const token = ++couponToken.current;
    setCouponBusy(true); setCouponNote('');
    try {
      const quote = await askCoupon(code);
      if (token !== couponToken.current) return;
      couponChecked.current = `${quote.code}|${phone}|${subtotalCents}`;
      setCoupon({ code: quote.code, discountCents: quote.discountCents }); setCouponInput('');
    } catch (failure) { if (token === couponToken.current) setCouponNote(couponMessage(failure)); }
    finally { setCouponBusy(false); }
  }
  // A coupon depends on the phone (first order) and the subtotal: confirm again, after a pause, when either changes.
  useEffect(() => {
    if (!couponCode || !client || couponChecked.current === `${couponCode}|${phone}|${subtotalCents}`) return;
    const timer = window.setTimeout(() => {
      const token = ++couponToken.current;
      const drop = (note: string) => { setCoupon(null); setCouponNote(note); };
      if (phoneDigits < 10) return drop('Informe seu WhatsApp com DDD para conferir o cupom.');
      if (!subtotalCents) return drop('O cupom saiu porque a caixa não tem itens com preço.');
      askCoupon(couponCode).then(quote => {
        if (token !== couponToken.current) return;
        couponChecked.current = `${couponCode}|${phone}|${subtotalCents}`;
        setCoupon(current => current && current.code === couponCode ? { code: current.code, discountCents: quote.discountCents } : current);
      }).catch(failure => { if (token === couponToken.current) drop(couponMessage(failure)); });
    }, 700);
    return () => { window.clearTimeout(timer); couponToken.current++; };
  }, [couponCode, phone, subtotalCents, client]); // eslint-disable-line react-hooks/exhaustive-deps

  function setQuantity(item: CatalogItem, next: number) {
    setQuantities(current => ({ ...current, [item.id]: next }));
    if (next > 0 && !(quantities[item.id] > 0)) setAdded(current => [...current.filter(id => id !== item.id), item.id]);
    if (next > (quantities[item.id] ?? 0)) { setRecent(item.id); window.setTimeout(() => setRecent(current => current === item.id ? null : current), 700); }
    setError('');
  }
  function setPick(item: PublicShowcaseItem, next: number) {
    const quantity = Math.min(next, item.stock);
    if (quantity > (picks[item.id] ?? 0)) { setRecent(item.id); window.setTimeout(() => setRecent(current => current === item.id ? null : current), 700); }
    setPicks(current => ({ ...current, [item.id]: quantity }));
    setError('');
  }
  function fail(message: string) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); }
  function openCheckout() { if (!count) return; setView('checkout'); setError(''); window.scrollTo({ top: 0 }); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (showcaseNeedsRefresh || showcaseBusy) return fail('Atualize a pronta entrega e confira sua caixa antes de enviar.');
    const input: OrderRequestInput = { customer, phone, date, time, fulfillment, address: fulfillment === 'delivery' ? address : '', deliveryZone: fulfillment === 'delivery' ? zone : '', notes, lines,
      showcase: pickedShowcase.map(item => ({ showcaseId: item.id, quantity: picks[item.id] })), ...(coupon ? { couponCode: coupon.code } : {}), marketingOptIn: marketing };
    const problem = requestProblem(input, today, shop);
    if (problem) return fail(problem);
    // Bots fill hidden fields; show the same confirmation without sending anything.
    if (trap) { setSent(true); return; }
    if (!client) return fail('Os pedidos pelo site estão indisponíveis no momento. Entre em contato com a loja.');
    setSending(true); setError('');
    try {
      const result = await rpc(client, 'submit_order_request', { p_shop: shopSlug, p_request: { ...requestPayload(input), storefrontRevision: storefront?.revision } });
      const cents = typeof result === 'object' && result && 'discountCents' in result ? Number(result.discountCents) : 0;
      setDiscount(Number.isSafeInteger(cents) && cents > 0 ? cents : 0);
      setSent(true); window.scrollTo({ top: 0 });
    } catch (failure) {
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '';
      if (message.includes('STOREFRONT_CONFLICT')) return fail('O catálogo foi atualizado pela loja. Recarregue esta página e confira os produtos e preços antes de enviar.');
      if (message.includes('SHOWCASE_STOCK')) { setShowcaseNeedsRefresh(true); loadShowcase(); return fail('O estoque da pronta entrega mudou. Aguarde a atualização, confira as quantidades da caixa e envie de novo.'); }
      if (message.includes('COUPON_')) { setCoupon(null); setCouponNote(couponMessage(failure)); return fail(`${couponMessage(failure)} Tiramos o cupom: você pode enviar o pedido sem ele.`); }
      fail(message.includes('REQUEST_LIMIT') ? 'Recebemos muitos pedidos agora. Tente novamente em alguns minutos ou entre em contato com a loja.'
        : message.includes('INVALID_REQUEST') ? 'Confira os dados do pedido: data, bairro e WhatsApp com DDD.'
        : 'Não foi possível enviar. Confira a conexão e tente novamente.');
    } finally { setSending(false); }
  }
  function restart() { setQuantities({}); setAdded([]); setCustom([]); setPicks({}); setCoupon(null); setCouponInput(''); setCouponNote(''); setDiscount(0); setNotes(''); loadShowcase(); setSent(false); setError(''); setView('shop'); }

  if (storeState !== 'ready') return <div className="po"><main className="po-done">
    <h1>{storeState === 'loading' ? 'Carregando loja…' : storeState === 'notFound' ? 'Loja indisponível' : 'Não foi possível abrir a loja'}</h1>
    <p role={storeState === 'loading' ? 'status' : 'alert'}>{storeState === 'loading' ? 'Estamos conferindo o endereço da loja.' : storeState === 'notFound' ? 'Este endereço não existe ou a loja está temporariamente indisponível. Confira o link com a loja.' : 'Confira sua conexão e tente novamente. Sua seleção foi mantida.'}</p>
    {storeState === 'error' && <button type="button" className="po-primary" onClick={() => setStoreRetry(value => value + 1)}>Tentar novamente</button>}
  </main></div>;

  const header = <><header className="po-band"><div className="po-band-inner">{badge && <img src={badge} alt={shopName} width="56" height="56" />}<span>Encomendas {shopName}</span></div></header>{showcaseError && <div role="alert" className="po-error">{showcaseError} <button type="button" className="po-link" disabled={showcaseBusy} onClick={loadShowcase}>{showcaseBusy ? 'Atualizando…' : 'Atualizar pronta entrega'}</button></div>}</>;

  if (sent) return <div className="po">{header}<main className="po-done">
    <span className="po-done-mark"><Icon name="check" /></span>
    <h1>Pedido enviado</h1>
    <p>Obrigado{customer.trim() ? `, ${customer.trim().split(/\s+/)[0]}` : ''}. A equipe vai conferir sua caixa e chamar você no WhatsApp para confirmar valores, detalhes e o sinal de 50%.</p>
    {discount > 0 && <p className="po-done-discount">Cupom aplicado: desconto de {formatMoney(discount)}. O valor final e o sinal serão confirmados no WhatsApp.</p>}
    <p className="po-muted">A encomenda fica garantida depois dessa confirmação.</p>
    <button type="button" className="po-primary" onClick={restart}>Montar outra caixa</button>
  </main></div>;

  const boxSummary = <>
    <div className="po-box-thumbs" aria-hidden="true">
      {[...chosen.map(item => ({ id: item.id, thumb: <Thumb item={item} badge={badge} /> })), ...pickedShowcase.map(item => ({ id: item.id, thumb: <Thumb src={showcasePhoto(item) ?? badge} /> }))].slice(-4).map(entry => <span key={entry.id} className={recent === entry.id ? 'po-pop' : ''}>{entry.thumb}</span>)}
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
              {pickedShowcase.map(item => <li key={item.id}><Thumb src={showcasePhoto(item) ?? badge} /><div><strong>{item.name}</strong><span>{formatMoney(item.priceCents)}/{unitShort[item.unit]} · pronta entrega</span></div><Stepper {...showcaseStep(item)} value={picks[item.id]} onChange={next => setPick(item, next)} /></li>)}
              {chosen.map(item => <li key={item.id}><Thumb item={item} badge={badge} /><div><strong>{shortName(item)}</strong><span>{formatMoney(item.unitPriceCents)}/{unitShort[item.unit]}</span></div><Stepper {...catalogStep(item)} value={quantities[item.id]} onChange={next => setQuantity(item, next)} /></li>)}
              {custom.filter(line => line.description.trim()).map(line => <li key={line.key}><Thumb /><div><strong>{line.description.trim()}</strong><span>{line.quantity} {unitShort[line.unit]} · sob orçamento</span></div><button type="button" className="po-link" onClick={() => setCustom(current => current.filter(item => item.key !== line.key))}>Remover</button></li>)}
            </ul>
            {!count && <p className="po-muted">Sua caixa ficou vazia. <button type="button" className="po-link" onClick={() => setView('shop')}>Voltar aos produtos</button></p>}
          </section>
          <section aria-labelledby="po-when-title" className="po-panel">
            <h2 id="po-when-title">Quando e como</h2>
            <div className="po-choice" role="radiogroup" aria-label="Retirada ou entrega">
              {(['pickup', 'delivery'] as Fulfillment[]).map(option => <label key={option} className={fulfillment === option ? 'is-on' : ''}><input type="radio" name="fulfillment" checked={fulfillment === option} onChange={() => setFulfillment(option)} /><strong>{option === 'pickup' ? 'Retirar na loja' : 'Receber em casa'}</strong><span>{option === 'pickup' ? 'Sem custo de entrega' : 'Consulte as regiões atendidas'}</span></label>)}
            </div>
            <div className="po-row">
              <label className="po-field">Data<input type="date" required min={minDate} max={addDays(today, REQUEST_HORIZON_DAYS)} value={date} onChange={event => setDate(event.target.value)} /></label>
              <label className="po-field">Horário<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
            </div>
            {quoted && shop.minLeadDays > 0 && <p className="po-hint">Itens sob orçamento precisam de pelo menos {shop.minLeadDays} dia{shop.minLeadDays === 1 ? '' : 's'} de antecedência.</p>}
            {fulfillment === 'delivery' && shop.deliveryZones.length > 0 && <label className="po-field">Bairro<select required value={zone} onChange={event => setZone(event.target.value)}><option value="">Escolha o bairro</option>{[...shop.deliveryZones].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(item => <option key={item.name} value={item.name}>{item.name} · {item.feeCents ? formatMoney(item.feeCents) : 'frete grátis'}</option>)}</select><small>Não encontrou seu bairro? Entre em contato com a loja.</small></label>}
            {fulfillment === 'delivery' && <label className="po-field">Endereço<textarea rows={2} maxLength={300} value={address} onChange={event => setAddress(event.target.value)} placeholder="Rua, número e complemento" />{!shop.deliveryZones.length && <small>O valor do frete é informado pela equipe.</small>}</label>}
          </section>
          <section aria-labelledby="po-you-title" className="po-panel">
            <h2 id="po-you-title">Seus dados</h2>
            <div className="po-row">
              <label className="po-field">Nome<input autoComplete="name" required maxLength={100} value={customer} onChange={event => setCustomer(event.target.value)} /></label>
              <label className="po-field">WhatsApp com DDD<input type="tel" autoComplete="tel" required maxLength={30} placeholder="(47) 99999-9999" value={phone} onChange={event => setPhone(event.target.value)} /></label>
            </div>
            <label className="po-field">Observações<textarea rows={3} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Nome no bolo, decoração, alergias…" /></label>
            <label className="po-check"><input type="checkbox" checked={marketing} onChange={event => setMarketing(event.target.checked)} /><span>Quero receber novidades e promoções da {shopName} pelo WhatsApp.</span></label>
            <label className="po-trap" aria-hidden="true">Site<input tabIndex={-1} autoComplete="off" value={trap} onChange={event => setTrap(event.target.value)} /></label>
          </section>
        </div>
        <aside className="po-total" aria-label="Total do pedido">
          <dl>
            {shown.map((line, index) => <div key={index}><dt>{qtyText(line.quantity)} {unitShort[line.unit]} · {line.description.replace(' · linha party', '')}</dt><dd>{line.unitPriceCents ? formatMoney(estimate([line]).totalCents) : 'a orçar'}</dd></div>)}
          </dl>
          <div className="po-coupon">
            {coupon ? <div className="po-coupon-on"><p className="po-coupon-ok" role="status">Cupom {coupon.code}: − {formatMoney(coupon.discountCents)}</p><button type="button" className="po-link" onClick={() => { couponToken.current++; setCoupon(null); setCouponNote(''); }}>Remover cupom</button></div>
              : <div className="po-field"><label htmlFor="po-coupon-input">Tenho um cupom</label>
                <div className="po-coupon-row"><input id="po-coupon-input" autoComplete="off" autoCapitalize="characters" maxLength={24} value={couponInput} onChange={event => { setCouponInput(event.target.value); setCouponNote(''); }}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void applyCoupon(); } }} />
                  <button type="button" className="po-ghost" disabled={couponBusy || !couponInput.trim()} onClick={() => void applyCoupon()}>{couponBusy ? 'Conferindo…' : 'Aplicar'}</button></div>
                {phoneDigits < 10 && <small>Preencha o WhatsApp em Seus dados para aplicar.</small>}</div>}
            {couponNote && <p className="po-coupon-err" role="status">{couponNote}</p>}
          </div>
          <div className="po-total-sum"><span>Total estimado</span><strong>{money && money.totalCents > 0 ? formatMoney(money.totalCents) : '—'}{money?.quoted && money.totalCents > 0 ? ' + orçamento' : ''}</strong></div>
          <div className="po-total-deposit"><span>Sinal de 50% para confirmar</span><strong>{money && money.depositCents > 0 ? formatMoney(money.depositCents) : '—'}</strong></div>
          <p className="po-muted">Valores do catálogo. Frete de bairros fora da lista, personalizados e o valor final são confirmados pela equipe no WhatsApp.</p>
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="po-error">{error}</p>}
          <button className="po-primary po-total-send" disabled={sending || !count || showcaseNeedsRefresh || showcaseBusy}><Icon name="chat" />{sending ? 'Enviando…' : 'Enviar pedido'}</button>
        </aside>
      </div>
      {/* Phones keep the total and deposit in view for the whole form, as the shop's box bar does. */}
      <div className="po-checkout-bar">
        <div><strong>{money && money.totalCents > 0 ? formatMoney(money.totalCents) : 'Sob orçamento'}{money?.quoted && money.totalCents > 0 ? ' + orçamento' : ''}</strong>
          <span>{money && money.depositCents > 0 ? `Sinal de 50%: ${formatMoney(money.depositCents)}` : 'A equipe confirma o valor'}</span></div>
        <button className="po-primary" disabled={sending || !count || showcaseNeedsRefresh || showcaseBusy}><Icon name="chat" />{sending ? 'Enviando…' : 'Enviar pedido'}</button>
      </div>
    </form>
  </div>;

  return <div className="po">{header}
    <main className="po-shop">
      <section className={`po-hero ${storefront?.heroUrl ? '' : 'po-hero-without-image'}`}>
        <div className="po-hero-text">
          <h1>Monte sua caixa</h1>
          <p>{storefront?.tagline || 'Escolha seus produtos. A equipe confirma sua encomenda pelo WhatsApp.'}</p>{shopWhatsapp && <a className="po-link" href={shopWhatsapp} target="_blank" rel="noopener noreferrer">Falar com {shopName} no WhatsApp</a>}
          <ul className="po-facts"><li>Retirada na loja ou entrega a combinar</li><li>Sinal de 50% para confirmar</li></ul>
        </div>
        {storefront?.heroUrl && <img className="po-hero-photo" src={storefront.heroUrl} alt={`Produtos de ${shopName}`} width="1100" height="1467" fetchPriority="high" />}
      </section>
      <nav className="po-tabs" aria-label="Categorias">
        {[...(showcase.length ? [{ id: 'pronta-entrega', title: 'Pronta entrega' }] : []), ...sections.map(section => ({ id: section.id, title: section.title })), { id: 'sob-medida', title: 'Sob medida' }].map(tab => <a key={tab.id} href={`#${tab.id}`} aria-current={active === tab.id ? 'true' : undefined}>{tab.title}</a>)}
      </nav>
      <div className="po-layout">
        <div className="po-catalog">
          {!catalog.length && !showcase.length && <p role="status">A loja ainda não publicou produtos no catálogo. Você pode solicitar um orçamento abaixo.</p>}
          {showcase.length > 0 && <section id="pronta-entrega" className="po-section" aria-labelledby="pronta-entrega-title">
            <div className="po-section-head"><h2 id="pronta-entrega-title">Pronta entrega</h2><p>O que já está pronto agora, com a quantidade disponível.</p></div>
            <div className="po-featured">
              {showcase.map(item => <article key={item.id} className={`po-card ${picks[item.id] ? 'is-in' : ''}`}>
                {(showcasePhoto(item) || badge) && <img className={showcasePhoto(item) ? '' : 'po-card-badge'} src={showcasePhoto(item) ?? badge} alt={showcasePhoto(item) ? item.name : ''} loading="lazy" />}
                <div className="po-card-body"><h3>{item.name}</h3>{item.description && <p>{item.description}</p>}
                  <p className="po-stock">{stockText(item)}</p>
                  <div className="po-card-foot"><span className="po-price">{formatMoney(item.priceCents)}<small>/{unitShort[item.unit]}</small></span><Stepper {...showcaseStep(item)} value={picks[item.id] ?? 0} onChange={next => setPick(item, next)} /></div></div>
              </article>)}
            </div>
            <p className="po-showcase-note">Itens prontos: reservamos para você assim que o pedido é enviado.</p>
          </section>}
          {sections.map(section => {
            const featured = section.items.filter(item => item.photo);
            const rest = section.items.filter(item => !item.photo);
            return <section key={section.id} id={section.id} className="po-section" aria-labelledby={`${section.id}-title`}>
              <div className="po-section-head"><h2 id={`${section.id}-title`}>{section.title}</h2><p>{section.note}</p></div>
              <div className="po-featured">
                {featured.map(item => <article key={item.id} className={`po-card ${quantities[item.id] ? 'is-in' : ''}`}>
                  <img src={item.photo} alt={shortName(item)} loading="lazy" />
                  <div className="po-card-body"><h3>{shortName(item)}</h3>{item.details && <p>{item.details}</p>}
                    <div className="po-card-foot"><span className="po-price">{formatMoney(item.unitPriceCents)}<small>/{unitShort[item.unit]}</small></span><Stepper {...catalogStep(item)} value={quantities[item.id] ?? 0} onChange={next => setQuantity(item, next)} /></div></div>
                </article>)}
              </div>
              <ul className="po-menu">
                {rest.map(item => <li key={item.id} className={quantities[item.id] ? 'is-in' : ''}>
                  <div><h3>{shortName(item)}</h3>{item.details && <p>{item.details}</p>}</div>
                  <span className="po-price">{formatMoney(item.unitPriceCents)}<small>/{unitShort[item.unit]}</small></span>
                  <Stepper {...catalogStep(item)} value={quantities[item.id] ?? 0} onChange={next => setQuantity(item, next)} />
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
              <button type="button" className="po-ghost" disabled={count >= MAX_REQUEST_LINES} onClick={() => setCustom(current => [...current, { key: crypto.randomUUID(), description: '', quantity: '1', unit: 'un' }])}><Icon name="plus" />Pedir algo sob medida</button>
            </div>
          </section>
        </div>
        <aside className="po-box" aria-label="Sua caixa">
          <div className="po-box-summary">{boxSummary}</div>
          {count > 0 && <ul className="po-box-lines">{boxLines.map((line, index) => <li key={index}><span>{qtyText(line.quantity)} {unitShort[line.unit]}</span>{line.description.replace(' · linha party', '')}</li>)}</ul>}
          {count > 0 && money && money.depositCents > 0 && <p className="po-box-deposit">Sinal de 50%: {formatMoney(money.depositCents)}</p>}
          <button type="button" className="po-primary" disabled={!count} onClick={openCheckout}><Icon name="box" />Fechar pedido</button>
        </aside>
      </div>
    </main>
  </div>;
}
