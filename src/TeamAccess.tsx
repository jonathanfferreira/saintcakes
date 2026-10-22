import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage, parseList, parseStaffAccess, roleLabels, rpc } from './shared';
import type { StaffAccess, Staff } from './shared';

export default function TeamAccess({ client, staff, onChange }: { client: SupabaseClient; staff: Staff; onChange: () => Promise<void> }) {
  const [members, setMembers] = useState<StaffAccess[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setBusy(true);
    void rpc(client, 'list_staff').then(data => { if (generation.current === token) setMembers(parseList(data, parseStaffAccess)); }).catch(failure => { if (generation.current === token) setError(errorMessage(failure)); }).finally(() => { if (generation.current === token) setBusy(false); });
    return () => { generation.current += 1; };
  }, [client, staff.userId]);
  function change(userId: string, patch: Partial<StaffAccess>) { setNotice(''); setMembers(current => current.map(member => member.userId === userId ? { ...member, ...patch, ...(patch.role === 'owner' ? { canViewFinancial: true } : {}) } : member)); }
  async function save(member: StaffAccess) {
    if (locked.current || busy) return;
    const token = generation.current;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = parseStaffAccess(await rpc(client, 'set_staff_access', { p_user_id: member.userId, p_role: member.role, p_active: member.active, p_can_view_financial: member.canViewFinancial }));
      if (generation.current === token) { setMembers(current => current.map(item => item.userId === result.userId ? result : item)); setNotice(`Acesso de ${result.displayName} salvo.`); }
      await onChange();
    } catch (failure) { if (generation.current === token) setError(errorMessage(failure)); }
    finally { locked.current = false; if (generation.current === token) setBusy(false); }
  }
  return <section className="shared-team" aria-labelledby="team-heading"><h2 id="team-heading">Acesso da equipe</h2><p>Escolha o que cada pessoa pode fazer e se pode consultar valores. As alterações passam a valer após salvar.</p><p>As contas precisam estar cadastradas previamente pela responsável técnica.</p>{error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Aguarde…</p>}
    {members.map(member => <fieldset key={member.userId} disabled={busy || member.userId === staff.userId}><legend>{member.displayName}{member.userId === staff.userId ? ' (você)' : ''}</legend><label>Função<select value={member.role} onChange={event => change(member.userId, { role: event.target.value as Staff['role'] })}>{Object.entries(roleLabels).map(([role, label]) => <option value={role} key={role}>{label}</option>)}</select></label><label className="shared-check"><input type="checkbox" disabled={member.role === 'owner'} checked={member.canViewFinancial} onChange={event => change(member.userId, { canViewFinancial: event.target.checked })} />Pode consultar valores</label><label className="shared-check"><input type="checkbox" checked={member.active} onChange={event => change(member.userId, { active: event.target.checked })} />Acesso ativo</label>{member.userId !== staff.userId && <button className="primary" onClick={() => void save(member)}>Salvar acesso</button>}</fieldset>)}
  </section>;
}
