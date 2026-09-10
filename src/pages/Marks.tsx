import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can, hasRole } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import type { Assignment, UnitTest } from '../lib/types'

export default function Marks() {
  const navigate = useNavigate()
  const { selectedClassId, classes, subjects } = useSchool()
  const { profile } = useAuth()
  const [tests, setTests] = useState<UnitTest[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ subject_id: '', title: '', test_date: today(), max_mark: '100' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const roleCanAdd = can(profile?.role, 'addMarks', profile?.additional_roles)
  const className = classes.find((c) => c.id === selectedClassId)?.name ?? ''

  const reload = () => {
    if (!selectedClassId) return
    api.listUnitTests(selectedClassId).then(setTests).catch((e) => setError(e.message))
    api.listAssignments(selectedClassId).then(setAssignments).catch(() => {})
  }

  useEffect(reload, [selectedClassId])

  // Subject teachers can only create tests for their assigned subjects.
  const isHomeroom = hasRole(profile?.role, 'homeroom_teacher', profile?.additional_roles)
  const isSubjectTeacher = hasRole(profile?.role, 'subject_teacher', profile?.additional_roles)
    || profile?.role === 'curriculum_coordinator'
  const myAssignments = assignments.filter((a) => a.teacher_id === profile?.id)
  const isOwnClass = isHomeroom && profile?.class_id === selectedClassId
  const mySubjects = isOwnClass
    ? subjects
    : isSubjectTeacher
      ? subjects.filter((s) => myAssignments.some((a) => a.subject_id === s.id))
      : subjects
  const canAdd = roleCanAdd && (
    isOwnClass
    || (isSubjectTeacher && mySubjects.length > 0)
  )

  const canEditTest = (test: UnitTest) => isHomeroom
    ? profile?.class_id === test.class_id || myAssignments.some((a) => a.class_id === test.class_id && a.subject_id === test.subject_id)
    : (isSubjectTeacher || profile?.role === 'head_of_school')
      && myAssignments.some((a) => a.class_id === test.class_id && a.subject_id === test.subject_id)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedClassId || !form.subject_id || !form.title.trim()) {
      setError('Choose a subject and enter a unit/topic.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const id = await api.createUnitTest(selectedClassId, {
        subject_id: form.subject_id,
        title: form.title.trim(),
        test_date: form.test_date,
        max_mark: Number(form.max_mark) || 100
      })
      setForm({ subject_id: '', title: '', test_date: today(), max_mark: '100' })
      setShowForm(false)
      reload()
      navigate(`/marks/${selectedClassId}/${id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: UnitTest) => {
    if (!confirm(`Delete "${t.subject_name} – ${t.title}"? All its scores will be removed.`)) return
    try {
      await api.deleteUnitTest(t.id)
      reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Unit Tests{className ? ` — ${className}` : ''}</h2>
          <p className="muted">{canAdd ? 'Every end-of-unit test you record, with its score sheet.' : 'Read-only view of recorded unit tests.'}</p>
        </div>
        <div className="row">
          <ClassPicker />
          {canAdd && (
            <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Close form' : '+ New unit test'}
            </button>
          )}
        </div>
      </div>

      {showForm && canAdd && (
        <form onSubmit={submit} className="card stack">
          <h3>New unit test</h3>
          <div className="grid4">
            <label className="field"><span>Subject *</span>
              <select required value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                <option value="">Choose…</option>
                {mySubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Unit / Topic *</span>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Fractions & Decimals" />
            </label>
            <label className="field"><span>Date</span>
              <input type="date" value={form.test_date} onChange={(e) => setForm({ ...form, test_date: e.target.value })} />
            </label>
            <label className="field"><span>Max mark</span>
              <input type="number" min={1} value={form.max_mark} onChange={(e) => setForm({ ...form, max_mark: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create test & enter scores'}</button>
          </div>
          {error && <div className="notice notice-error">{error}</div>}
        </form>
      )}

      <div className="card">
        {tests.length === 0 && <p className="muted center">No unit tests yet for this class.</p>}
        {tests.map((t) => (
          <div key={t.id} className="list-row">
            <div className="list-main">
              <strong>{t.subject_name} — {t.title}</strong>
              <span className="muted"> {fmtDate(t.test_date)} · Max {t.max_mark}</span>
            </div>
            <div className="list-actions">
              <Link to={`/marks/${t.class_id}/${t.id}`} className="btn btn-small">Enter scores</Link>{' '}
              {canEditTest(t) && <button className="btn btn-small btn-danger" onClick={() => remove(t)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
