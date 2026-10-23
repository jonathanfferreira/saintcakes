import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, formatMoney } from './domain';
import type { Order } from './domain';
import { optInCsv, parseCustomerRecord } from './growth';
import type { CustomerRecord, GrowthApi } from './growth';
import { customers as orderStats } from './metrics';
import './Dashboard.css';
import './CustomersCentral.css';

type Filter = 'all' | 'optin' | 'first' | 'idle' | 'balance';
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' }, { id: 'optin', label: 'Aceitam novidades' }, { id: 'first', label: 'Primeira compra' },
  { id: 'idle', label: 'Sem pedido há 60 dias' }, { id: 'balance', label: 'Com saldo' },
];
const dateLabel = (key: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(key.length > 10 ? key : `${key}T12:00:00`)).replace(/\./g, '');
const whatsapp = (phone: string) => { const digits = phone.replace(/\D/g, ''); return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`; };
const last11 = (value: string) => value.replace(/\D/g, '').slice(-11);

function message(error: unknown) {
  const text = typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error ?? '');
  if (text.includes('ACCESS_DENIED')) return 'Seu acesso não permite ver ou alterar os clientes.';
  if (text.includes('ORDER_CONFLICT')) return 'Esse cliente mudou. Atualize a lista.';
  return 'Não foi possível concluir agora. Tente novamente.';
}

type Row = CustomerRecord & { orders: number; totalCents: number; balanceCents: number; lastDate: string; nextDate: string | null };

export default function CustomersCentral({ shopSlug, api, orders, today, isOwner, onShowOrders }: { shopSlug: string; api: GrowthApi; orders: Order[]; today: string; isOwner: boolean; onShowOrders: (search: string) => void }) {
  const [records, setRecords] = useState<CustomerRecord[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    api.call('read_customers').then(value => { if (!Array.isArray(value)) throw new Error('invalid'); setRecords(value.map(parseCustomerRecord)); }).catch(err => setError(message(err)));
  }, [api]);
  useEffect(load, [load]);

  const rows = useMemo<Row[]>(() => {
    const stats = new Map(orderStats(orders, today).filter(item => item.key.startsWith('tel:')).map(item => [item.key.slice(4), item]));
    return (records ?? []).map(record => {
      const stat = stats.get(last11(record.key));
      return { ...record, orders: stat?.orders ?? 0, totalCents: stat?.totalCents ?? 0, balanceCents: stat?.balanceCents ?? 0, lastDate: stat?.lastDate ?? '', nextDate: stat?.nextDate ?? null };
    });
  }, [records, orders, today]);

  const monthStart = `${today.slice(0, 7)}-01`;
  const idleBefore = addDays(today, -60);
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const list = rows.filter(row => {
    if (needle && !`${row.name} ${row.phone}`.toLocaleLowerCase('pt-BR').includes(needle)) return false;
    if (filter === 'optin') return row.marketingOptIn;
    if (filter === 'first') return row.orders <= 1;
    if (filter === 'idle') return row.lastDate !== '' && row.lastDate < idleBefore;
    if (filter === 'balance') return row.balanceCents > 0;
    return true;
  });
  const optIns = rows.filter(row => row.marketingOptIn).length;
  const fresh = rows.filter(row => row.firstSeen.slice(0, 10) >= monthStart).length;
  const open = rows.filter(row => row.balanceCents > 0).length;

  function exportCsv() {
    const blob = new Blob(['﻿', optInCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: `${shopSlug}-contatos-${today}.csv` });
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  const consent = (row: Row) => row.marketingOptIn
    ? <span className="cc-pill cc-pill-yes">Aceita novidades{row.optInAt ? ` · ${dateLabel(row.optInAt)}` : ''}</span>
    : <span className="cc-pill">Sem consentimento</span>;
  const toggle = (key: string) => setOpenKey(current => current === key ? null : key);
  const selected = list.find(row => row.key === openKey);
  const detail = (row: Row) => <Detail key={row.key} row={row} api={api} isOwner={isOwner}
    onSaved={saved => setRecords(current => (current ?? []).map(item => item.key === saved.key ? { ...item, ...saved } : item))}
    onDeleted={() => { setRecords(current => (current ?? []).filter(item => item.key !== row.key)); setOpenKey(null); }}
    onShowOrders={() => onShowOrders(row.key)} onConflict={load} />;

  return <section className="dash" aria-labelledby="cc-title">
    <header className="dash-head"><div><h1 id="cc-title">Central de clientes</h1><p>Cadastro de quem já pediu, guardado para avisar novidades com autorização.</p></div>
      {isOwner && <div className="cc-export"><button className="sc-btn sc-btn-secondary" disabled={!optIns} onClick={exportCsv}>Exportar contatos (CSV)</button><small>Inclui só quem aceitou receber novidades ({optIns}).</small></div>}
    </header>
    {error && <p className="sc-alert" role="alert">{error} <button className="sc-btn sc-btn-quiet" onClick={load}>Tentar de novo</button></p>}
    {!records && !error && <p className="empty" role="status">Carregando clientes…</p>}
    {records && <>
      <p className="dash-summary cust-summary"><span><strong className="sc-num">{rows.length}</strong> cliente{rows.length === 1 ? '' : 's'}</span><span><strong className="sc-num">{optIns}</strong> aceitam novidades</span><span><strong className="sc-num">{fresh}</strong> novos este mês</span><span><strong className="sc-num">{open}</strong> com saldo em aberto</span></p>
      <label className="sc-field cust-search"><span className="sr-only">Buscar cliente</span><input type="search" placeholder="Buscar por nome ou telefone" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="cc-chips" role="group" aria-label="Filtrar clientes">{filters.map(item => <button key={item.id} type="button" className="cc-chip" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      {selected && detail(selected)}
      {list.length ? <>
        <div className="sc-card table-wrap"><table className="customer-table cc-table">
          <thead><tr><th>Cliente</th><th>Origem</th><th>Consentimento</th><th>Pedidos</th><th>Total</th><th>Último</th></tr></thead>
          <tbody>{list.map(row => <tr key={row.key} className={openKey === row.key ? 'cc-selected' : ''}>
              <td><span className="customer-cell"><button type="button" className="cc-name" aria-expanded={openKey === row.key} onClick={() => toggle(row.key)}>{row.name}</button>{row.phone && <a href={whatsapp(row.phone)} target="_blank" rel="noreferrer">{row.phone}</a>}</span></td>
              <td>{row.source === 'site' ? 'Site' : 'Equipe'}</td><td>{consent(row)}</td><td className="sc-num">{row.orders}</td>
              <td className="sc-money">{formatMoney(row.totalCents)}</td><td>{row.lastDate ? dateLabel(row.lastDate) : '—'}</td>
            </tr>)}</tbody>
        </table></div>
        <ul className="cust-list">{list.map(row => <li key={row.key}>
          <button className="cust-row" aria-expanded={openKey === row.key} onClick={() => toggle(row.key)}>
            <span className="cust-main"><strong>{row.name}</strong>{row.phone && <span className="cust-phone">{row.phone}</span>}<small>{row.source === 'site' ? 'Site' : 'Equipe'} · {row.orders} pedido{row.orders === 1 ? '' : 's'} · último {row.lastDate ? dateLabel(row.lastDate) : '—'}</small>{consent(row)}</span>
            <span className="cust-money"><span className="sc-money">{formatMoney(row.totalCents)}</span></span>
          </button>
        </li>)}</ul>
      </> : <p className="empty">{rows.length ? 'Nenhum cliente neste filtro.' : 'Os clientes aparecem aqui quando alguém pedir pelo site ou a equipe salvar uma encomenda.'}</p>}
    </>}
  </section>;
}

function Detail({ row, api, isOwner, onSaved, onDeleted, onShowOrders, onConflict }: { row: Row; api: GrowthApi; isOwner: boolean; onSaved: (saved: CustomerRecord) => void; onDeleted: () => void; onShowOrders: () => void; onConflict: () => void }) {
  const [notes, setNotes] = useState(row.notes);
  const [optIn, setOptIn] = useState(row.marketingOptIn);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setNotes(row.notes); setOptIn(row.marketingOptIn); }, [row.revision, row.notes, row.marketingOptIn]);
  const dirty = notes !== row.notes || optIn !== row.marketingOptIn;

  async function run(action: () => Promise<void>) {
    setBusy(true); setFeedback(null);
    try { await action(); } catch (err) { const text = message(err); setFeedback({ ok: false, text }); if (text.startsWith('Esse cliente')) onConflict(); }
    finally { setBusy(false); }
  }
  const save = () => run(async () => {
    const saved = parseCustomerRecord(await api.call('patch_customer', { p_key: row.key, p_notes: notes.trim(), p_marketing_opt_in: optIn, p_expected_revision: row.revision }));
    onSaved(saved);
    setFeedback({ ok: true, text: 'Cadastro salvo.' });
  });
  const erase = () => run(async () => { await api.call('delete_customer', { p_key: row.key }); onDeleted(); });

  return <div className="cc-detail sc-card">
    <h2>{row.name}</h2>
    <label className="sc-field"><span>Anotações</span><textarea maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /><small>{notes.length}/1000</small></label>
    <label className="cc-switch"><input type="checkbox" role="switch" checked={optIn} onChange={event => setOptIn(event.target.checked)} /><span><strong>Aceita receber novidades</strong><small>Marque só se o cliente autorizou receber promoções.</small></span></label>
    {feedback && <p className={feedback.ok ? 'sc-notice' : 'sc-alert'} role={feedback.ok ? 'status' : 'alert'}>{feedback.text}</p>}
    <div className="cc-actions">
      <button className="sc-btn sc-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
      <button className="sc-btn sc-btn-secondary" onClick={onShowOrders}>Ver pedidos</button>
      {isOwner && !confirming && <button className="sc-btn sc-btn-danger" onClick={() => setConfirming(true)}>Apagar cadastro de marketing</button>}
    </div>
    {isOwner && confirming && <div className="sc-alert cc-confirm" role="alertdialog" aria-label="Confirmar exclusão"><p>Isso apaga o nome, o telefone, as anotações e o consentimento deste cadastro. Os pedidos continuam no histórico. Se a pessoa pedir de novo, o cadastro volta sem consentimento.</p>
      <div className="cc-actions"><button className="sc-btn sc-btn-danger" disabled={busy} onClick={erase}>Apagar cadastro</button><button className="sc-btn sc-btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button></div></div>}
  </div>;
}
