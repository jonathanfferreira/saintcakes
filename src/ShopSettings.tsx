import { useState } from 'react';
import type { FormEvent } from 'react';
import { formatMoney, parseMoney } from './domain';
import { joinvilleBairros, settingsProblem } from './settings';
import type { ShopSettings } from './settings';

type ZoneDraft = { key: string; name: string; fee: string };
const moneyInput = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;

export default function ShopSettingsForm({ settings, onSave }: { settings: ShopSettings; onSave: (settings: ShopSettings) => Promise<void> }) {
  const [pixKey, setPixKey] = useState(settings.pixKey);
  const [pixHolder, setPixHolder] = useState(settings.pixHolder);
  const [minLeadDays, setMinLeadDays] = useState(String(settings.minLeadDays));
  const [zones, setZones] = useState<ZoneDraft[]>(() => settings.deliveryZones.map(zone => ({ key: crypto.randomUUID(), name: zone.name, fee: moneyInput(zone.feeCents) })));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const present = new Set(zones.map(zone => zone.name.trim().toLocaleLowerCase('pt-BR')));
  const missing = joinvilleBairros.filter(name => !present.has(name.toLocaleLowerCase('pt-BR')));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(''); setMessage('');
    let next: ShopSettings;
    try {
      next = { pixKey: pixKey.trim(), pixHolder: pixHolder.trim(), minLeadDays: Number(minLeadDays),
        deliveryZones: zones.filter(zone => zone.name.trim() || zone.fee.trim()).map(zone => {
          if (!zone.name.trim()) throw new Error('Informe o nome de cada bairro.');
          // A blank fee must never become free delivery by accident.
          if (!zone.fee.trim()) throw new Error(`Informe o frete de ${zone.name.trim()} (use 0,00 para entrega grátis) ou remova o bairro.`);
          try { return { name: zone.name.trim(), feeCents: parseMoney(zone.fee) }; }
          catch { throw new Error(`Confira o frete de ${zone.name.trim()}.`); }
        }) };
    } catch (e) { setError(e instanceof Error ? e.message : 'Confira os campos.'); return; }
    const problem = settingsProblem(next);
    if (problem) { setError(problem); return; }
    setSaving(true);
    try { await onSave(next); setMessage('Configurações salvas. O site de pedidos já usa os novos valores.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }

  return <section className="dashboard shop-settings" aria-labelledby="settings-title">
    <div className="page-heading"><div><h1 id="settings-title">Loja</h1><p className="muted">Dados usados nas mensagens de WhatsApp e no site de pedidos.</p></div></div>
    <form onSubmit={event => void submit(event)} className="settings-form">
      <article className="panel"><h2>Pix para o sinal</h2>
        <p className="muted">Aparece na mensagem de confirmação enviada ao cliente. Deixe em branco para não incluir.</p>
        <div className="settings-grid"><label>Chave Pix<input value={pixKey} maxLength={140} onChange={event => setPixKey(event.target.value)} placeholder="CNPJ, e-mail, telefone ou chave aleatória" /></label>
          <label>Titular<input value={pixHolder} maxLength={100} onChange={event => setPixHolder(event.target.value)} placeholder="Nome que aparece no Pix" /></label></div>
      </article>
      <article className="panel"><h2>Personalizados</h2>
        <label className="settings-lead">Antecedência mínima (dias)<input type="number" min={0} max={30} step={1} inputMode="numeric" value={minLeadDays} onChange={event => setMinLeadDays(event.target.value)} /></label>
        <p className="muted">No site, itens sob orçamento só podem ser pedidos com essa antecedência. O catálogo diz pelo menos dois dias.</p>
      </article>
      <article className="panel"><h2>Frete por bairro</h2>
        <p className="muted">Com bairros cadastrados, o cliente escolhe o bairro no site e o frete entra no pedido. Sem bairros, a equipe informa o frete. Use R$ 0,00 para entrega grátis.</p>
        {zones.length > 0 && <div className="zones">{zones.map(zone => <div className="zone-row" key={zone.key}>
          <label>Bairro<input value={zone.name} maxLength={60} onChange={event => setZones(current => current.map(item => item.key === zone.key ? { ...item, name: event.target.value } : item))} /></label>
          <label>Frete (R$)<input inputMode="decimal" value={zone.fee} placeholder="0,00" onChange={event => setZones(current => current.map(item => item.key === zone.key ? { ...item, fee: event.target.value } : item))} /></label>
          <button type="button" className="quiet" onClick={() => setZones(current => current.filter(item => item.key !== zone.key))}>Remover</button>
        </div>)}</div>}
        <div className="zone-actions">
          <button type="button" className="secondary" disabled={zones.length >= 60} onClick={() => setZones(current => [...current, { key: crypto.randomUUID(), name: '', fee: '' }])}>Adicionar bairro</button>
          <button type="button" className="secondary" disabled={missing.length === 0} onClick={() => { setZones(current => [...current, ...missing.map(name => ({ key: crypto.randomUUID(), name, fee: '' }))]); setError(''); setMessage(`${missing.length} bairros de Joinville adicionados. Preencha o frete de cada um (0,00 para grátis) ou remova os que vocês não atendem.`); }}>{missing.length === 0 ? 'Bairros de Joinville já carregados' : `Carregar ${missing.length === joinvilleBairros.length ? 'os 43' : `${missing.length} restantes dos`} bairros de Joinville`}</button>
        </div>
        {settings.deliveryZones.length > 0 && <p className="muted">Hoje: {settings.deliveryZones.map(zone => `${zone.name} ${formatMoney(zone.feeCents)}`).join(' · ')}</p>}
      </article>
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status" className="notice">{message}</p>}
      <div><button className="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar configurações'}</button></div>
    </form>
  </section>;
}
