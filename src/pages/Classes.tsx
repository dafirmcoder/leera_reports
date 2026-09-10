import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'
import type { Assignment, ClassInfo, Profile } from '../lib/types'

export default function Classes() {
  const { classes, subjects, refresh } = useSchool()
  const { profile } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [newClass, setNewClass] = useState('')
  const [assignments, setAssignments] = useState<Record<string, Assignment[]>>({})
  const [form, setForm] = useState({ class_id: '', subject_id: '', teacher_id: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const isHos = can(profile?.role, 'manageClasses', profile?.additional_roles)
  const canAssign = can(profile?.role, 'assignTeachers', profile?.additional_roles)

  const teachers = people.filter((p) =>
    p.role === 'subject_teacher'
    || p.role === 'homeroom_teacher'
    || p.role === 'curriculum_coordinator'
    || p.additional_roles.includes('subject_teacher')
    || p.additional_roles.includes('homeroom_teacher')
  )

  useEffect(() => {
    api.listProfiles().then(setPeople).catch(() => {})
  }, [])

  useEffect(() => {
    classes.forEach((c) => {
      api.listAssignments(c.id).then((a) => setAssignments((prev) => ({ ...prev, [c.id]: a }))).catch(() => {})
    })
  }, [classes])

  const createClass = async () => {
    const name = newClass.trim()
    if (!name) return
    setError('')
    setBusy(true)
    try {
      await api.createClass(name)
      setNewClass('')
      refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const removeClass = async (c: ClassInfo) => {
    if (!confirm(`Delete class "${c.name}"? Its students, tests and scores will be removed.`)) return
    try {
      await api.deleteClass(c.id)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const setHomeroom = async (classId: string, teacherId: string) => {
    try {
      await api.setHomeroomTeacher(classId, teacherId || null)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const addAssignment = async () => {
    if (!form.class_id || !form.subject_id || !form.teacher_id) return
    setError('')
    setBusy(true)
    try {
      await api.assignTeacher(form.class_id, form.subject_id, form.teacher_id)
      setForm({ ...form, subject_id: '', teacher_id: '' })
      const a = await api.listAssignments(form.class_id)
      setAssignments((prev) => ({ ...prev, [form.class_id]: a }))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const removeAssignment = async (classId: string, id: string) => {
    try {
      await api.removeAssignment(id)
      const a = await api.listAssignments(classId)
      setAssignments((prev) => ({ ...prev, [classId]: a }))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const defaultClass = profile?.class_id ?? classes[0]?.id ?? ''

  return (
    <div className="page">
      <h2>Classes</h2>
      <p className="muted">
        {isHos
          ? 'Create classes, set homeroom teachers and assign subject teachers.'
          : can(profile?.role, 'viewAllClasses', profile?.additional_roles)
            ? 'Assign subject teachers across the school.'
            : 'Your class — assign subject teachers.'}
      </p>
      {error && <div className="notice notice-error">{error}</div>}

      {isHos && (
        <div className="card row">
          <input
            className="grow"
            placeholder="New class name (e.g. Year 10 - IGCSE)…"
            value={newClass}
            onChange={(e) => setNewClass(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createClass() } }}
          />
          <button className="btn btn-primary" disabled={busy} onClick={createClass}>{busy ? 'Adding…' : 'Add class'}</button>
        </div>
      )}

      {classes.map((c) => (
        <div key={c.id} className="card stack">
          <div className="list-row">
            <div className="list-main">
              <strong>{c.name}</strong>
              <span className="muted">Homeroom: {c.homeroom_teacher_name || '—'}</span>
            </div>
            {isHos && (
              <div className="list-actions">
                <button className="btn btn-small btn-danger" onClick={() => removeClass(c)}>Delete</button>
              </div>
            )}
          </div>

          {isHos && (
            <label className="field">
              <span>Homeroom teacher</span>
              <select
                value={c.homeroom_teacher_id ?? ''}
                onChange={(e) => setHomeroom(c.id, e.target.value)}
              >
                <option value="">— none —</option>
                {people.filter((p) => p.role === 'homeroom_teacher').map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </label>
          )}

          {canAssign && (
            <>
              <h3>Subject teachers</h3>
              <table className="table">
                <thead><tr><th>Subject</th><th>Teacher</th><th /></tr></thead>
                <tbody>
                  {(assignments[c.id] ?? []).map((a) => (
                    <tr key={a.id}>
                      <td>{a.subject_name}</td>
                      <td>{a.teacher_name}</td>
                      <td className="right">
                        <button className="btn btn-small btn-danger" onClick={() => removeAssignment(c.id, a.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                  {(assignments[c.id] ?? []).length === 0 && (
                    <tr><td colSpan={3} className="muted center">No subject teachers assigned yet.</td></tr>
                  )}
                </tbody>
              </table>

              <div className="row">
                <label className="field">
                  <span>Subject</span>
                  <select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value, class_id: c.id })}>
                    <option value="">Choose…</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Teacher</span>
                  <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value, class_id: c.id })}>
                    <option value="">Choose…</option>
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                  </select>
                </label>
                <button className="btn" disabled={busy || !form.subject_id || !form.teacher_id} onClick={addAssignment}>
                  {busy ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      {classes.length === 0 && <div className="card"><p className="muted center">{defaultClass ? '' : 'No classes yet.'}</p></div>}
    </div>
  )
}
