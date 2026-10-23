import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { catalog } from './catalog';
import { formatMoney, localDateKey, addDays } from './domain';
import type { Fulfillment, OrderLine } from './domain';
import { estimate, MAX_REQUEST_LINES, REQUEST_HORIZON_DAYS, requestProblem } from './requests';
import type { OrderRequestInput, RequestLine } from './requests';
import { rpc } from './shared';
import { parsePublicSettings } from './settings';
import type { PublicSettings } from './settings';
import './PublicOrder.css';

type Custom = { key: string; description: string; quantity: string; unit: OrderLine['unit'] };
const unitLabel: Record<OrderLine['unit'], string> = { un: 'unidade', kg: 'kg', cento: 'cento' };
const categories = [...new Set(catalog.map(item => item.category))];
const number = (value: string) => Number(value.trim().replace(',', '.'));

export default function PublicOrder({ client }: { client: SupabaseClient | null }) {
  const today = localDateKey();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Custom[]>([]);
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
  const fee = fulfillment === 'delivery' ? shop.deliveryZones.find(item => item.name === zone) : undefined;

  const lines = useMemo<RequestLine[]>(() => [
    ...catalog.flatMap(item => {
      const quantity = number(quantities[item.id] ?? '');
      return quantities[item.id]?.trim() && quantity > 0 ? [{ description: item.description, quantity, unit: item.unit, unitPriceCents: item.unitPriceCents }] : [];
    }),
    ...custom.filter(line => line.description.trim()).map(line => ({ description: `${line.description.trim()} · sob orçamento`.slice(0, 180), quantity: number(line.quantity), unit: line.unit, unitPriceCents: 0 })),
  ], [quantities, custom]);
  // The fee line is shown here but added by the server from the owner's table, never sent by the browser.
  const shown = useMemo(() => fee?.feeCents ? [...lines, { description: `Frete · ${fee.name}`, quantity: 1, unit: 'un' as const, unitPriceCents: fee.feeCents }] : lines, [lines, fee]);
  const money = useMemo(() => { try { return estimate(shown); } catch { return null; } }, [shown]);
  const quoted = lines.some(line => line.unitPriceCents === 0);
  const minDate = quoted ? addDays(today, shop.minLeadDays) : today;

  function fail(message: string) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); }
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
    try { await rpc(client, 'submit_order_request', { p_request: input }); setSent(true); window.scrollTo(0, 0); }
    catch (failure) {
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '';
      fail(message.includes('REQUEST_LIMIT') ? 'Recebemos muitos pedidos agora. Tente novamente em alguns minutos ou chame a Saint Cakes no WhatsApp.'
        : message.includes('INVALID_REQUEST') ? 'Confira os dados do pedido. A data precisa ser de hoje em diante e o WhatsApp precisa ter DDD.'
        : 'Não foi possível enviar. Confira a conexão e tente novamente.');
    } finally { setSending(false); }
  }
  function restart() {
    setQuantities({}); setCustom([]); setNotes(''); setSent(false); setError('');
  }

  if (sent) return <main className="public-order public-done"><img src="/brand/saint-cakes.png" alt="Saint Cakes" width="120" height="120" /><h1>Pedido enviado!</h1><p>Obrigado{customer.trim() ? `, ${customer.trim().split(/\s+/)[0]}` : ''}. A equipe da Saint Cakes vai conferir sua encomenda e falar com você pelo WhatsApp para confirmar valores, detalhes e o sinal de 50%.</p><p className="muted">A encomenda só fica garantida depois dessa confirmação.</p><button className="primary" onClick={restart}>Fazer outro pedido</button></main>;

  return <main className="public-order">
    <header className="public-hero"><img src="/brand/saint-cakes.png" alt="Saint Cakes" width="104" height="104" /><div><p className="public-eyebrow">Saint Cakes · Padaria e Confeitaria</p><h1>Faça sua encomenda</h1><p>Escolha os produtos, a data e como prefere receber. A equipe confirma tudo com você pelo WhatsApp.</p></div></header>
    <form onSubmit={event => void submit(event)} noValidate>
      <div className="public-layout">
        <div className="public-steps">
          <section aria-labelledby="step-products"><h2 id="step-products"><span>1</span>Escolha os produtos</h2>
            {categories.map(category => <fieldset key={category} className="public-category"><legend>{category}</legend>
              {catalog.filter(item => item.category === category).map(item => <label key={item.id} className={`public-item ${quantities[item.id]?.trim() ? 'chosen' : ''}`}>
                <span className="public-item-name">{item.description.replace(' · linha party', '')}<small>{formatMoney(item.unitPriceCents)} / {unitLabel[item.unit]}</small></span>
                <span className="public-qty"><input inputMode="decimal" placeholder="0" aria-label={`Quantidade de ${item.description} em ${unitLabel[item.unit]}`} value={quantities[item.id] ?? ''} onChange={event => { const value = event.target.value; if (/^\d{0,4}(?:[,.]\d{0,3})?$/.test(value)) setQuantities(current => ({ ...current, [item.id]: value })); }} /><small>{item.unit === 'kg' ? 'kg' : 'un'}</small></span>
              </label>)}
            </fieldset>)}
            <fieldset className="public-category"><legend>Personalizado ou fora do catálogo</legend>
              <p className="muted">Bolos personalizados, kits e outros pedidos são orçados pela equipe. {shop.minLeadDays ? `Esses itens precisam de pelo menos ${shop.minLeadDays} dia${shop.minLeadDays === 1 ? '' : 's'} de antecedência.` : ''}</p>
              {custom.map(line => <div className="public-custom" key={line.key}>
                <label>Descreva<input value={line.description} maxLength={150} placeholder="Ex.: bolo personalizado tema safari, 2 kg" onChange={event => setCustom(current => current.map(item => item.key === line.key ? { ...item, description: event.target.value } : item))} /></label>
                <label>Quantidade<input inputMode="decimal" value={line.quantity} onChange={event => setCustom(current => current.map(item => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></label>
                <label>Unidade<select value={line.unit} onChange={event => setCustom(current => current.map(item => item.key === line.key ? { ...item, unit: event.target.value as OrderLine['unit'] } : item))}><option value="un">un</option><option value="kg">kg</option><option value="cento">cento</option></select></label>
                <button type="button" className="quiet" onClick={() => setCustom(current => current.filter(item => item.key !== line.key))}>Remover</button>
              </div>)}
              <button type="button" className="secondary" disabled={lines.length >= MAX_REQUEST_LINES} onClick={() => setCustom(current => [...current, { key: crypto.randomUUID(), description: '', quantity: '1', unit: 'un' }])}>Adicionar item personalizado</button>
            </fieldset>
          </section>
          <section aria-labelledby="step-when"><h2 id="step-when"><span>2</span>Quando e como</h2>
            <div className="public-grid">
              <label>Data<input type="date" required min={minDate} max={addDays(today, REQUEST_HORIZON_DAYS)} value={date} onChange={event => setDate(event.target.value)} /></label>
              <label>Horário<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
            </div>
            <div className="public-choice" role="radiogroup" aria-label="Retirada ou entrega">
              {(['pickup', 'delivery'] as Fulfillment[]).map(option => <label key={option} className={fulfillment === option ? 'chosen' : ''}><input type="radio" name="fulfillment" checked={fulfillment === option} onChange={() => setFulfillment(option)} />{option === 'pickup' ? 'Retirar na loja' : 'Entrega em Joinville e região'}</label>)}
            </div>
            {fulfillment === 'delivery' && shop.deliveryZones.length > 0 && <label>Bairro<select required value={zone} onChange={event => setZone(event.target.value)}><option value="">Escolha o bairro</option>{shop.deliveryZones.map(item => <option key={item.name} value={item.name}>{item.name} · {item.feeCents ? formatMoney(item.feeCents) : 'frete grátis'}</option>)}</select><small className="muted">Não encontrou seu bairro? Chame a Saint Cakes no WhatsApp.</small></label>}
            {fulfillment === 'delivery' && <label>Endereço de entrega<textarea rows={2} maxLength={300} value={address} onChange={event => setAddress(event.target.value)} placeholder="Rua, número, bairro e complemento" />{!shop.deliveryZones.length && <small className="muted">O valor do frete é informado pela equipe.</small>}</label>}
          </section>
          <section aria-labelledby="step-you"><h2 id="step-you"><span>3</span>Seus dados</h2>
            <div className="public-grid">
              <label>Nome<input autoComplete="name" required maxLength={100} value={customer} onChange={event => setCustomer(event.target.value)} /></label>
              <label>WhatsApp com DDD<input type="tel" autoComplete="tel" required maxLength={30} placeholder="(47) 99999-9999" value={phone} onChange={event => setPhone(event.target.value)} /></label>
            </div>
            <label>Observações<textarea rows={3} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Sabores, decoração, nome no bolo, alergias…" /></label>
            <label className="public-trap" aria-hidden="true">Site<input tabIndex={-1} autoComplete="off" value={trap} onChange={event => setTrap(event.target.value)} /></label>
          </section>
        </div>
        <aside className="public-summary" aria-label="Resumo do pedido">
          <h2>Seu pedido</h2>
          {lines.length ? <ul>{shown.map((line, index) => <li key={index}><span>{Number.isFinite(line.quantity) ? line.quantity.toLocaleString('pt-BR') : '?'} {line.unit} · {line.description.replace(' · linha party', '')}</span></li>)}</ul> : <p className="muted">Nenhum item escolhido ainda.</p>}
          {money && money.totalCents > 0 && <dl><div><dt>Total estimado</dt><dd>{formatMoney(money.totalCents)}{money.quoted ? ' + orçamento' : ''}</dd></div><div><dt>Sinal de 50%</dt><dd>{formatMoney(money.depositCents)}{money.quoted ? ' + 50% do orçamento' : ''}</dd></div></dl>}
          <p className="public-note">Valores estimados pelo catálogo. Frete, personalizações e o valor final são confirmados pela equipe no WhatsApp.</p>
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="error">{error}</p>}
          <button className="primary" disabled={sending}>{sending ? 'Enviando…' : 'Enviar pedido'}</button>
        </aside>
      </div>
    </form>
  </main>;
}
