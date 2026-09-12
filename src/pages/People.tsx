import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { can, ROLE_LABEL } from '../lib/permissions'
import type { Profile, Role } from '../lib/types'

const ROLES: Role[] = ['pending', 'admin', 'director', 'head_of_school', 'curriculum_coordinator', 'homeroom_teacher', 'subject_teacher']

export default function People() {
  const { profile } = useAuth()
  const { classes } = useSchool()
  const [people, setPeople] = useState<Profile[]>([])
  const [invite, setInvite] = useState({ email: '', full_name: '', role: 'subject_teacher' as Role, class_id: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const canManage = can(profile?.role, 'manageUsers', profile?.additional_roles)
  const canInvite = can(profile?.role, 'createAccounts', profile?.additional_roles)

  const reload = () => {
    api.listProfiles().then(setPeople).catch((e) => setError(e.message))
  }

  useEffect(reload, [])

  const changeRole = async (p: Profile, role: Role, classId: string | null) => {
    try {
      await api.setRole(p.id, role, classId, p.additional_roles)
      reload()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const toggleCoordinator = async (p: Profile, enabled: boolean) => {
    const additionalRoles = enabled ? ['curriculum_coordinator' as Role] : []
    try {
      await api.setRole(p.id, p.role, p.class_id, additionalRoles)
      reload()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const deleteTeacher = async (p: Profile) => {
    if (!confirm(`Delete teacher account for ${p.full_name || p.email}? Their assignments will be removed, but classes, students, tests and scores will remain.`)) return
    setError('')
    setInfo('')
    setBusy(true)
    try {
      await api.deleteTeacher(p.id)
      setInfo(`Teacher account deleted: ${p.email}`)
      reload()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitInvite = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      await api.inviteUser({
        email: invite.email.trim(),
        full_name: invite.full_name.trim(),
        role: invite.role,
        class_id: invite.class_id || null
      })
      setInfo(`Invitation sent to ${invite.email.trim()} (${ROLE_LABEL[invite.role]}).`)
      setInvite({ email: '', full_name: '', role: 'subject_teacher', class_id: '' })
      reload()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h2>People</h2>
      <p className="muted">Teachers and staff — assign roles here. Read-only for most roles.</p>

      {canInvite && (
        <form onSubmit={submitInvite} className="card stack">
          <h3>Add teacher account</h3>
          <div className="grid4">
            <label className="field"><span>Email *</span>
              <input type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="teacher@school.ac.tz" />
            </label>
            <label className="field"><span>Full name *</span>
              <input required value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} placeholder="Jane Teacher" />
            </label>
            <label className="field"><span>Role</span>
              <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}>
                {ROLES.filter((r) => r !== 'pending').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label className="field"><span>Class (homeroom only)</span>
              <select value={invite.class_id} onChange={(e) => setInvite({ ...invite, class_id: e.target.value })}>
                <option value="">—</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create teacher account'}</button>
          </div>
          <p className="muted note">
            Default PIN: <strong>00123456</strong>. Give the teacher their email and PIN, then ask them to change it after signing in.
          </p>
        </form>
      )}

      {error && <div className="notice notice-error">{error}</div>}
      {info && <div className="notice notice-ok">{info}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Class</th>{canInvite && <th className="right">Actions</th>}</tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const isSelf = p.id === profile?.id
              return (
                <tr key={p.id}>
                  <td>{p.full_name || '—'}{isSelf && <span className="muted"> (you)</span>}</td>
                  <td className="mono">{p.email || '—'}</td>
                  <td>
                    {canManage && !isSelf ? (
                      <select
                        className="role-select"
                        value={p.role}
                        onChange={(e) => changeRole(p, e.target.value as Role, p.role === 'homeroom_teacher' ? p.class_id : null)}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      ROLE_LABEL[p.role]
                    )}
                  </td>
                  <td>
                    {canManage && p.role === 'homeroom_teacher' ? (
                      <select
                        value={p.class_id ?? ''}
                        onChange={(e) => changeRole(p, 'homeroom_teacher', e.target.value || null)}
                      >
                        <option value="">—</option>
                        {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      classes.find((c) => c.id === p.class_id)?.name ?? '—'
                    )}
                  </td>
                  {canInvite && <td className="right">
                    {canManage && p.role === 'homeroom_teacher' && !isSelf && (
                      <label className="check"><input type="checkbox" checked={p.additional_roles.includes('curriculum_coordinator')} onChange={(e) => toggleCoordinator(p, e.target.checked)} /> Coordinator</label>
                    )}
                    {(p.role === 'homeroom_teacher' || p.role === 'subject_teacher') && !isSelf && (
                      <button className="btn btn-small btn-danger" disabled={busy} onClick={() => deleteTeacher(p)}>
                        Delete teacher
                      </button>
                    )}
                  </td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
