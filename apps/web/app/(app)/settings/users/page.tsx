'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { useStepUp } from '@/components/step-up';
import { ErrorBanner, Field, Loading, Modal, PageHeader } from '@/components/ui';

export default function Users() {
  const { can } = useSession();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<any[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<any[]>('/roles') });
  const perms = useQuery({ queryKey: ['perms'], queryFn: () => get<any[]>('/permissions') });
  const [invite, setInvite] = useState<any>(null);
  const [editRoles, setEditRoles] = useState<any>(null);
  const [role, setRole] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const step = useStepUp();
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await step.run(fn); qc.invalidateQueries(); return true; } catch (e) { setErr(e); return false; } };
  if (!users.data || !roles.data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Users & roles" actions={can('user.manage') && <button className="btn btn-primary" onClick={() => setInvite({ email: '', fullName: '', initialPassword: '', roleIds: [] })}>+ Add user</button>} />
      <ErrorBanner error={err} />
      <div className="panel overflow-x-auto">
        <table className="grid text-sm">
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>2FA</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id} style={{ opacity: u.member_active ? 1 : 0.5 }}>
                <td>{u.full_name}</td><td>{u.email}</td><td>{u.roles.map((r: any) => r.name).join(', ')}</td><td>{u.mfa_enabled ? '✔' : '—'}</td><td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</td>
                <td className="flex gap-1 justify-end">
                  {can('role.manage') && <button className="btn btn-sm" onClick={() => setEditRoles({ id: u.id, name: u.full_name, roleIds: u.roles.map((r: any) => r.id) })}>Roles</button>}
                  {can('user.manage') && <button className="btn btn-sm" onClick={() => act(() => post(`/users/${u.id}/force-logout`, {}))}>Force logout</button>}
                  {can('user.manage') && u.member_active && <button className="btn btn-sm btn-danger" onClick={() => act(() => del(`/users/${u.id}`))}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel overflow-x-auto">
        <div className="p-3 flex justify-between"><b>Roles</b>{can('role.manage') && <button className="btn btn-sm" onClick={() => setRole({ name: '', description: '', requires2fa: false, approvalLimit: '', permissions: [] })}>+ New role</button>}</div>
        <table className="grid text-sm"><thead><tr><th>Role</th><th>2FA</th><th>Approval limit</th><th>Permissions</th><th /></tr></thead>
          <tbody>{roles.data.map((r) => <tr key={r.id}><td>{r.name}<div className="muted text-xs">{r.description}</div></td><td>{r.requires_2fa ? 'required' : ''}</td><td>{r.approval_limit ?? 'no limit'}</td><td>{r.permissions.length}</td><td>{can('role.manage') && <button className="btn btn-sm" onClick={() => setRole({ id: r.id, name: r.name, description: r.description ?? '', requires2fa: r.requires_2fa, approvalLimit: r.approval_limit ?? '', permissions: r.permissions })}>Edit</button>}</td></tr>)}</tbody></table>
      </div>
      <Modal open={!!invite} onClose={() => setInvite(null)} title="Add user to this company">
        {invite && <div className="space-y-3">
          <Field label="Email"><input className="input" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
          <Field label="Full name"><input className="input" value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} /></Field>
          <Field label="Initial password (new users only — they must change it)"><input className="input" type="password" value={invite.initialPassword} onChange={(e) => setInvite({ ...invite, initialPassword: e.target.value })} /></Field>
          <Field label="Roles">{roles.data.map((r) => <label key={r.id} className="flex gap-2 text-sm"><input type="checkbox" checked={invite.roleIds.includes(r.id)} onChange={(e) => setInvite({ ...invite, roleIds: e.target.checked ? [...invite.roleIds, r.id] : invite.roleIds.filter((x: string) => x !== r.id) })} />{r.name}</label>)}</Field>
          <button className="btn btn-primary" onClick={async () => { if (await act(() => post('/users', { ...invite, initialPassword: invite.initialPassword || undefined }))) setInvite(null); }}>Add user</button>
        </div>}
      </Modal>
      <Modal open={!!editRoles} onClose={() => setEditRoles(null)} title={`Roles for ${editRoles?.name}`}>
        {editRoles && <div className="space-y-2">
          {roles.data.map((r) => <label key={r.id} className="flex gap-2 text-sm"><input type="checkbox" checked={editRoles.roleIds.includes(r.id)} onChange={(e) => setEditRoles({ ...editRoles, roleIds: e.target.checked ? [...editRoles.roleIds, r.id] : editRoles.roleIds.filter((x: string) => x !== r.id) })} />{r.name}</label>)}
          <button className="btn btn-primary" onClick={async () => { if (await act(() => patch(`/users/${editRoles.id}/roles`, { roleIds: editRoles.roleIds }))) setEditRoles(null); }}>Save</button>
        </div>}
      </Modal>
      <Modal open={!!role} onClose={() => setRole(null)} title={role?.id ? 'Edit role' : 'New role'} wide>
        {role && <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Name"><input className="input" value={role.name} onChange={(e) => setRole({ ...role, name: e.target.value })} /></Field>
            <Field label="Approval limit (blank = none)"><input className="input num" value={role.approvalLimit} onChange={(e) => setRole({ ...role, approvalLimit: e.target.value })} /></Field>
            <label className="flex gap-2 text-sm items-center mt-5"><input type="checkbox" checked={role.requires2fa} onChange={(e) => setRole({ ...role, requires2fa: e.target.checked })} /> Requires 2FA</label>
          </div>
          <div className="grid sm:grid-cols-3 gap-1 max-h-96 overflow-auto text-xs">
            {(perms.data ?? []).map((p) => <label key={p.code} className="flex gap-2"><input type="checkbox" checked={role.permissions.includes(p.code)} onChange={(e) => setRole({ ...role, permissions: e.target.checked ? [...role.permissions, p.code] : role.permissions.filter((x: string) => x !== p.code) })} />{p.code}</label>)}
          </div>
          <button className="btn btn-primary" onClick={async () => { const body = { name: role.name, description: role.description || null, requires2fa: role.requires2fa, approvalLimit: role.approvalLimit || null, permissions: role.permissions }; if (await act(() => (role.id ? patch(`/roles/${role.id}`, body) : post('/roles', body)))) setRole(null); }}>Save role</button>
        </div>}
      </Modal>
      {step.modal}
    </div>
  );
}
