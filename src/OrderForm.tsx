import './OrderForm.css';
import { useRef, useState, type FormEvent } from 'react';
import { calculateOrder, formatMoney, parseMoney, validateOrder, type Order, type OrderLine } from './domain';
import { catalog } from './catalog';

type Props = {
  order: Order | null;
  date: string;
  onSave: (order: Order) => void | Promise<void>;
  onCancel: () => void;
};
type EditableLine = Omit<OrderLine, 'quantity' | 'unitPriceCents'> & { quantity: string; price: string };

const moneyInput = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
const newLine = (): EditableLine => ({ id: crypto.randomUUID(), description: '', quantity: '1', unit: 'un', price: '' });
const statuses: { value: Order['status']; label: string }[] = [
  { value: 'pending', label: 'A confirmar' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'preparing', label: 'Em produção' },
  { value: 'ready', label: 'Pronto' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'cancelled', label: 'Cancelado' },
];

export default function OrderForm({ order, date, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Order>(() => order ? { ...order, lines: order.lines.map(line => ({ ...line })) } : {
    id: crypto.randomUUID(), number: 0, customer: '', phone: '', date, time: '12:00',
    fulfillment: 'pickup', address: '', notes: '', lines: [], receivedCents: 0,
    status: 'pending', createdAt: new Date().toISOString(),
  });
  const [lines, setLines] = useState<EditableLine[]>(() => order ? order.lines.map(line => ({
    id: line.id, description: line.description, quantity: String(line.quantity).replace('.', ','),
    // A draft from a site request leaves unquoted items blank so the team must price them.
    unit: line.unit, price: order.number || line.unitPriceCents ? moneyInput(line.unitPriceCents) : '',
  })) : [newLine()]);
  const [received, setReceived] = useState(() => moneyInput(order?.receivedCents ?? 0));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  function change<K extends keyof Order>(field: K, value: Order[K]) {
    setDraft(current => ({ ...current, [field]: value }));
    setError('');
  }

  function changeLine(id: string, update: Partial<EditableLine>) {
    setLines(current => current.map(line => line.id === id ? { ...line, ...update } : line));
    setError('');
  }

  function readLines(): OrderLine[] {
    return lines.map((line, index) => {
      if (!/^\d+(?:[,.]\d{1,3})?$/.test(line.quantity.trim())) {
        throw new Error(`Item ${index + 1}: informe uma quantidade válida, com até três casas para kg.`);
      }
      let unitPriceCents: number;
      try {
        unitPriceCents = parseMoney(line.price);
      } catch {
        throw new Error(`Item ${index + 1}: informe o preço em reais, sem separador de milhar (ex.: 120,50).`);
      }
      return {
        id: line.id, description: line.description.trim(),
        quantity: Number(line.quantity.replace(',', '.')), unit: line.unit, unitPriceCents,
      };
    });
  }

  function readOrder(): Order {
    return {
      ...draft, customer: draft.customer.trim(), phone: draft.phone.trim(),
      address: draft.address.trim(), notes: draft.notes.trim(), lines: readLines(),
      receivedCents: parseMoney(received),
    };
  }

  let summary: ReturnType<typeof calculateOrder> | null = null;
  try {
    // Preview uses the same validation boundary as saving; incomplete inputs never crash the page.
    const candidate = readOrder();
    const preview = validateOrder({
      ...candidate, number: candidate.number || 1,
      customer: candidate.customer || 'Prévia',
      address: candidate.address || (candidate.fulfillment === 'delivery' ? 'Prévia' : ''),
    });
    summary = calculateOrder(preview.lines, preview.receivedCents);
  } catch {
    summary = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      const candidate = readOrder();
      const checked = validateOrder({ ...candidate, number: candidate.number || 1 });
      await onSave({ ...checked, number: candidate.number });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Confira os campos e tente novamente.');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  const money = (cents?: number) => summary && cents !== undefined ? formatMoney(cents) : '—';
  const receivedCents = summary ? summary.totalCents - summary.balanceCents : undefined;
  const fulfillmentOptions: { value: Order['fulfillment']; title: string; hint: string }[] = [
    { value: 'pickup', title: 'Retirada', hint: 'Cliente busca na loja' },
    { value: 'delivery', title: 'Entrega', hint: 'Leva até o endereço' },
  ];

  return (
    <section className="order-form" aria-labelledby="order-form-title">
      <div className="of-heading">
        <div>
          <h1 id="order-form-title">{order?.number ? `Editar encomenda #${order.number}` : 'Nova encomenda'}</h1>
          <p className="of-hint">Registre os detalhes combinados com o cliente.</p>
        </div>
        <button type="button" className="sc-btn sc-btn-secondary" disabled={saving} onClick={onCancel}>Voltar à lista</button>
      </div>
      <form onSubmit={submit} onInvalid={event => {
        const field = event.target as HTMLInputElement;
        setError(`${field.labels?.[0]?.textContent ?? 'Campo obrigatório'}: ${field.validationMessage}`);
      }} aria-describedby={error ? 'order-form-error' : undefined}>
        {error && <p className="sc-alert of-error" id="order-form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <fieldset className="save-fields" disabled={saving}>
        <div className="of-layout">
          <div className="of-main">
            <section className="sc-card of-section" aria-labelledby="order-customer-title">
              <h2 id="order-customer-title">Cliente</h2>
              <div className="of-grid">
                <div className="sc-field">
                  <label htmlFor="order-customer">Nome do cliente *</label>
                  <input id="order-customer" autoComplete="name" required minLength={2} maxLength={100} value={draft.customer} onChange={event => change('customer', event.target.value)} />
                </div>
                <div className="sc-field">
                  <label htmlFor="order-phone">Telefone / WhatsApp</label>
                  <input id="order-phone" type="tel" autoComplete="tel" maxLength={30} value={draft.phone} onChange={event => change('phone', event.target.value)} />
                </div>
              </div>
            </section>

            <section className="sc-card of-section" aria-labelledby="order-when-title">
              <h2 id="order-when-title">Quando e como</h2>
              <div className="of-grid">
                <div className="sc-field">
                  <label htmlFor="order-date">Data *</label>
                  <input id="order-date" type="date" required value={draft.date} onChange={event => change('date', event.target.value)} />
                </div>
                <div className="sc-field">
                  <label htmlFor="order-time">Horário *</label>
                  <input id="order-time" type="time" required value={draft.time} onChange={event => change('time', event.target.value)} />
                </div>
              </div>
              <fieldset className="of-choice-group">
                <legend>Como o pedido será recebido? *</legend>
                <div className="of-choice">
                  {fulfillmentOptions.map(option => <label key={option.value} className={draft.fulfillment === option.value ? 'is-on' : undefined}>
                    <input type="radio" name="order-fulfillment" id={`order-fulfillment-${option.value}`} value={option.value}
                      checked={draft.fulfillment === option.value} onChange={() => change('fulfillment', option.value)} />
                    <strong>{option.title}</strong><span>{option.hint}</span>
                  </label>)}
                </div>
              </fieldset>
              {draft.fulfillment === 'delivery' && <div className="sc-field">
                <label htmlFor="order-address">Endereço de entrega *</label>
                <input id="order-address" required autoComplete="street-address" maxLength={300} value={draft.address} onChange={event => change('address', event.target.value)} />
              </div>}
            </section>

            <section className="sc-card of-section" aria-labelledby="order-items-title">
              <h2 id="order-items-title">Itens</h2>
              <p className="of-hint">Informe o preço por unidade, kg ou cento. Quantidades em kg aceitam até três casas decimais.</p>
              <p className="of-hint">26 opções iniciais do catálogo enviado: bolos da linha party e mini salgados. Confira o preço combinado; outros produtos podem ser preenchidos manualmente.</p>
              {lines.map((line, index) => <fieldset className="of-item" key={line.id}>
                <legend className="of-item-label">Item {index + 1}</legend>
                <div className="sc-field of-catalog">
                  <label htmlFor={`catalog-${line.id}`}>Preencher pelo catálogo</label>
                  <select id={`catalog-${line.id}`} value="" onChange={event => {
                    const selected = catalog.find(item => item.id === event.target.value);
                    if (selected) changeLine(line.id, { description: selected.description, unit: selected.unit, price: moneyInput(selected.unitPriceCents) });
                  }}>
                    <option value="">Selecionar produto (opcional)</option>
                    {[...new Set(catalog.map(item => item.category))].map(category => <optgroup label={category} key={category}>{catalog.filter(item => item.category === category).map(item => <option value={item.id} key={item.id}>{item.description} · {formatMoney(item.unitPriceCents)}/{item.unit}</option>)}</optgroup>)}
                  </select>
                </div>
                <div className="sc-field of-description">
                  <label htmlFor={`description-${line.id}`}>Descrição *</label>
                  <input id={`description-${line.id}`} required maxLength={180} value={line.description} onChange={event => changeLine(line.id, { description: event.target.value })} />
                </div>
                <div className="sc-field">
                  <label htmlFor={`quantity-${line.id}`}>Quantidade *</label>
                  <input id={`quantity-${line.id}`} required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,3})?" value={line.quantity} onChange={event => changeLine(line.id, { quantity: event.target.value })} />
                </div>
                <div className="sc-field">
                  <label htmlFor={`unit-${line.id}`}>Unidade</label>
                  <select id={`unit-${line.id}`} value={line.unit} onChange={event => changeLine(line.id, { unit: event.target.value as OrderLine['unit'] })}>
                    <option value="un">Unidade</option><option value="kg">Kg</option><option value="cento">Cento</option>
                  </select>
                </div>
                <div className="sc-field of-price">
                  <label htmlFor={`price-${line.id}`}>Preço (R$) *</label>
                  <input id={`price-${line.id}`} required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" placeholder="0,00" value={line.price} onChange={event => changeLine(line.id, { price: event.target.value })} />
                </div>
                <button type="button" className="sc-btn sc-btn-quiet of-remove" disabled={lines.length === 1} aria-label={`Remover item ${index + 1}`} onClick={() => {
                  setLines(current => current.filter(item => item.id !== line.id)); setError('');
                }}>Remover</button>
              </fieldset>)}
              <button type="button" className="sc-btn sc-btn-secondary of-add" disabled={lines.length >= 100} onClick={() => {
                const line = newLine();
                setLines(current => [...current, line]); setError('');
                requestAnimationFrame(() => document.getElementById(`description-${line.id}`)?.focus());
              }}>Adicionar item</button>
            </section>

            <section className="sc-card of-section" aria-labelledby="order-payment-title">
              <h2 id="order-payment-title">Pagamento e andamento</h2>
              <div className="of-grid">
                <div className="sc-field">
                  <label htmlFor="order-received">Valor recebido — anotação manual (R$) *</label>
                  <input id="order-received" required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" value={received} aria-describedby="payment-note" onChange={event => { setReceived(event.target.value); setError(''); }} />
                  <small id="payment-note">Este registro não confirma Pix nem recebimento bancário. Confira o pagamento antes de anotá-lo.</small>
                </div>
                <div className="sc-field">
                  <label htmlFor="order-status">Andamento</label>
                  <select id="order-status" value={draft.status} onChange={event => change('status', event.target.value as Order['status'])}>
                    {statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                  <small>O andamento do pedido é independente do recebimento.</small>
                </div>
              </div>
              <dl className="of-figures of-pay-summary" aria-live="polite">
                <div><dt>Total</dt><dd className="sc-money">{money(summary?.totalCents)}</dd></div>
                <div><dt>Sinal de 50%</dt><dd className="sc-money">{money(summary?.depositCents)}</dd></div>
                <div><dt>Falta para o sinal</dt><dd className="sc-money">{money(summary?.depositDueCents)}</dd></div>
                <div><dt>Saldo a receber</dt><dd className="sc-money">{money(summary?.balanceCents)}</dd></div>
              </dl>
              {!summary && <p className="of-hint">Complete os itens e confira os valores para calcular o resumo. O recebido não pode superar o total.</p>}
              <p className="of-hint">Se houver centavo ímpar, o sinal de 50% será arredondado para cima.</p>
            </section>

            <section className="sc-card of-section" aria-labelledby="order-notes-title">
              <h2 id="order-notes-title">Observações</h2>
              <div className="sc-field">
                <label htmlFor="order-notes">Observações e personalização</label>
                <textarea id="order-notes" rows={4} maxLength={2000} value={draft.notes} onChange={event => change('notes', event.target.value)} />
                <small>Estas observações são visíveis à produção. Use o campo de recebimento para anotar pagamentos.</small>
              </div>
            </section>
            <p className="of-hint">* Campos obrigatórios.</p>
          </div>

          <aside className="of-aside" aria-label="Resumo e ações">
            <div className="sc-card of-aside-card">
              <div className="of-total">
                <span className="of-total-label">Total</span>
                <strong className="sc-money of-total-value">{money(summary?.totalCents)}</strong>
              </div>
              <dl className="of-figures of-aside-summary">
                <div><dt>Sinal de 50%</dt><dd className="sc-money">{money(summary?.depositCents)}</dd></div>
                <div><dt>Recebido</dt><dd className="sc-money">{money(receivedCents)}</dd></div>
                <div><dt>Saldo a receber</dt><dd className="sc-money">{money(summary?.balanceCents)}</dd></div>
              </dl>
              <div className="of-actions">
                <button type="button" className="sc-btn sc-btn-secondary of-cancel" onClick={onCancel}>Cancelar</button>
                <button type="submit" className="sc-btn sc-btn-primary of-save">{saving ? 'Salvando…' : 'Salvar encomenda'}</button>
              </div>
            </div>
          </aside>
        </div>
        </fieldset>
      </form>
    </section>
  );
}
