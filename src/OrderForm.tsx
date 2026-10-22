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
    unit: line.unit, price: moneyInput(line.unitPriceCents),
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

  return (
    <section className="order-form" aria-labelledby="order-form-title">
      <div className="page-heading">
        <div>
          <h1 id="order-form-title">{order ? `Editar encomenda #${order.number}` : 'Nova encomenda'}</h1>
          <p className="muted">Registre os detalhes combinados com o cliente.</p>
        </div>
        <button type="button" className="secondary" disabled={saving} onClick={onCancel}>Voltar à agenda</button>
      </div>
      <form onSubmit={submit} onInvalid={event => {
        const field = event.target as HTMLInputElement;
        setError(`${field.labels?.[0]?.textContent ?? 'Campo obrigatório'}: ${field.validationMessage}`);
      }} aria-describedby={error ? 'order-form-error' : undefined}>
        {error && <p className="error" id="order-form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <fieldset className="save-fields" disabled={saving}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="order-customer">Nome do cliente *</label>
            <input id="order-customer" autoComplete="name" required minLength={2} maxLength={100} value={draft.customer} onChange={event => change('customer', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="order-phone">Telefone / WhatsApp</label>
            <input id="order-phone" type="tel" autoComplete="tel" maxLength={30} value={draft.phone} onChange={event => change('phone', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="order-date">Data *</label>
            <input id="order-date" type="date" required value={draft.date} onChange={event => change('date', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="order-time">Horário *</label>
            <input id="order-time" type="time" required value={draft.time} onChange={event => change('time', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="order-fulfillment">Como o pedido será recebido? *</label>
            <select id="order-fulfillment" value={draft.fulfillment} onChange={event => change('fulfillment', event.target.value as Order['fulfillment'])}>
              <option value="pickup">Retirada</option><option value="delivery">Entrega</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="order-status">Andamento</label>
            <select id="order-status" value={draft.status} onChange={event => change('status', event.target.value as Order['status'])}>
              {statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </div>
          {draft.fulfillment === 'delivery' && <div className="field wide">
            <label htmlFor="order-address">Endereço de entrega *</label>
            <input id="order-address" required autoComplete="street-address" maxLength={300} value={draft.address} onChange={event => change('address', event.target.value)} />
          </div>}
        </div>

        <section className="item-editor" aria-labelledby="order-items-title">
          <h2 id="order-items-title">Itens da encomenda</h2>
          <p className="muted">Informe o preço por unidade, kg ou cento. Quantidades em kg aceitam até três casas decimais.</p>
          <p className="muted">26 opções iniciais do catálogo enviado: bolos da linha party e mini salgados. Confira o preço combinado; outros produtos podem ser preenchidos manualmente.</p>
          {lines.map((line, index) => <fieldset className="item-row" key={line.id}>
            <legend className="item-label">Item {index + 1}</legend>
            <div className="field catalog-picker">
              <label htmlFor={`catalog-${line.id}`}>Preencher pelo catálogo</label>
              <select id={`catalog-${line.id}`} value="" onChange={event => {
                const selected = catalog.find(item => item.id === event.target.value);
                if (selected) changeLine(line.id, { description: selected.description, unit: selected.unit, price: moneyInput(selected.unitPriceCents) });
              }}>
                <option value="">Selecionar produto (opcional)</option>
                {[...new Set(catalog.map(item => item.category))].map(category => <optgroup label={category} key={category}>{catalog.filter(item => item.category === category).map(item => <option value={item.id} key={item.id}>{item.description} · {formatMoney(item.unitPriceCents)}/{item.unit}</option>)}</optgroup>)}
              </select>
            </div>
            <div className="field item-description">
              <label htmlFor={`description-${line.id}`}>Descrição *</label>
              <input id={`description-${line.id}`} required maxLength={180} value={line.description} onChange={event => changeLine(line.id, { description: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`quantity-${line.id}`}>Quantidade *</label>
              <input id={`quantity-${line.id}`} required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,3})?" value={line.quantity} onChange={event => changeLine(line.id, { quantity: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`unit-${line.id}`}>Unidade</label>
              <select id={`unit-${line.id}`} value={line.unit} onChange={event => changeLine(line.id, { unit: event.target.value as OrderLine['unit'] })}>
                <option value="un">Unidade</option><option value="kg">Kg</option><option value="cento">Cento</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`price-${line.id}`}>Preço (R$) *</label>
              <input id={`price-${line.id}`} required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" placeholder="0,00" value={line.price} onChange={event => changeLine(line.id, { price: event.target.value })} />
            </div>
            <button type="button" className="quiet" disabled={lines.length === 1} aria-label={`Remover item ${index + 1}`} onClick={() => {
              setLines(current => current.filter(item => item.id !== line.id)); setError('');
            }}>Remover</button>
          </fieldset>)}
          <button type="button" className="secondary" disabled={lines.length >= 100} onClick={() => {
            const line = newLine();
            setLines(current => [...current, line]); setError('');
            requestAnimationFrame(() => document.getElementById(`description-${line.id}`)?.focus());
          }}>Adicionar item</button>
        </section>

        <section aria-labelledby="order-payment-title">
          <h2 id="order-payment-title">Valores e recebimento</h2>
          <div className="field">
            <label htmlFor="order-received">Valor recebido — anotação manual (R$) *</label>
            <input id="order-received" required inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" value={received} aria-describedby="payment-note" onChange={event => { setReceived(event.target.value); setError(''); }} />
            <p className="muted" id="payment-note">Este registro não confirma Pix nem recebimento bancário. Confira o pagamento antes de anotá-lo.</p>
          </div>
          <dl className="money-summary" aria-live="polite">
            <div><dt>Total</dt><dd>{summary ? formatMoney(summary.totalCents) : '—'}</dd></div>
            <div><dt>Sinal de 50%</dt><dd>{summary ? formatMoney(summary.depositCents) : '—'}</dd></div>
            <div><dt>Falta para o sinal</dt><dd>{summary ? formatMoney(summary.depositDueCents) : '—'}</dd></div>
            <div><dt>Saldo a receber</dt><dd>{summary ? formatMoney(summary.balanceCents) : '—'}</dd></div>
          </dl>
          {!summary && <p className="muted">Complete os itens e confira os valores para calcular o resumo. O recebido não pode superar o total.</p>}
          <p className="muted">Se houver centavo ímpar, o sinal de 50% será arredondado para cima.</p>
        </section>

        <div className="field">
          <label htmlFor="order-notes">Observações e personalização</label>
          <textarea id="order-notes" rows={4} maxLength={2000} value={draft.notes} onChange={event => change('notes', event.target.value)} />
          <p className="muted">Estas observações são visíveis à produção. Use o campo de recebimento para anotar pagamentos.</p>
        </div>
        <p className="muted">* Campos obrigatórios. O andamento do pedido é independente do recebimento.</p>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="primary">{saving ? 'Salvando…' : 'Salvar encomenda'}</button>
        </div>
        </fieldset>
      </form>
    </section>
  );
}
