import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { buildRollNo, formatRollNo, formatStudentNo, nextStudentNo } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import type { Student } from '../lib/types'

const empty = { student_no: '', roll_no: '', full_name: '', gender: '' }

export default function Students() {
  const { selectedClassId, classes, school } = useSchool()
  const { profile } = useAuth()
  const [students, setStudents] = useState<Student[]>([])
  const [nextRollNo, setNextRollNo] = useState('')
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Homeroom teachers manage only their own roster, not other assigned classes.
  const canAdd = can(profile?.role, 'addStudents', profile?.additional_roles)
    && !!selectedClassId && selectedClassId === profile?.class_id
  const className = classes.find((c) => c.id === selectedClassId)?.name ?? ''

  const reload = () => {
    if (!selectedClassId) return
    api.listStudents(selectedClassId).then(setStudents).catch((e) => setError(e.message))
  }

  useEffect(reload, [selectedClassId])

  useEffect(() => {
    if (!canAdd || !selectedClassId) {
      setNextRollNo('')
      return
    }
    api.nextRollNo(selectedClassId).then(setNextRollNo).catch(() => {
      const seq = students.length + 1
      setNextRollNo(buildRollNo(className, seq, school?.academic_year))
    })
  }, [canAdd, editingId, selectedClassId, className, school?.academic_year, students.length])

  const suggestedNo = useMemo(() => nextStudentNo(students.map((s) => s.student_no)), [students])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedClassId || !form.full_name.trim()) return
    setError('')
    setBusy(true)
    try {
      const studentNo = editingId
        ? (students.find((s) => s.id === editingId)?.student_no || form.student_no)
        : suggestedNo
      const rawRoll = form.roll_no.trim() || (editingId ? '' : nextRollNo)
      const rollNo = formatRollNo(rawRoll)
      if (!rollNo) {
        setError('A unique roll number is required.')
        return
      }
      if (!/^LIS-[0-9]{3}\/[0-9]+[A-Z]?\/[0-9]{2}$/i.test(rollNo)) {
        setError('Invalid Roll No format. Expected format like LIS-001/9P/26.')
        return
      }
      const payload = {
        student_no: formatStudentNo(studentNo),
        roll_no: rollNo,
        admission_no: rollNo,
        full_name: form.full_name.trim(),
        gender: form.gender
      }
      if (editingId) {
        await api.updateStudent({ id: editingId, class_id: selectedClassId, ...payload })
      } else {
        await api.addStudent(selectedClassId, payload)
      }
      setForm(empty)
      setEditingId(null)
      reload()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (s: Student) => {
    setEditingId(s.id)
    setForm({
      student_no: formatStudentNo(s.student_no),
      roll_no: formatRollNo(s.roll_no || s.admission_no),
      full_name: s.full_name,
      gender: s.gender
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (s: Student) => {
    if (!confirm(`Delete ${s.full_name}? Their marks will also be removed.`)) return
    setError('')
    try {
      await api.deleteStudent(s.id)
      if (editingId === s.id) { setEditingId(null); setForm(empty) }
      reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Students{className ? ` — ${className}` : ''}</h2>
          <p className="muted">{canAdd ? 'Your class roster. Add students here before entering marks.' : 'Read-only view of the class roster.'}</p>
        </div>
        <ClassPicker />
      </div>

      {canAdd && (
        <form onSubmit={submit} className="card stack">
          <h3>{editingId ? 'Edit student' : 'Add student'}</h3>
          <div className="grid4">
            <label className="field"><span>Class S/N</span>
              <input
                value={editingId ? form.student_no : suggestedNo}
                readOnly
                disabled
                tabIndex={-1}
                style={{ background: '#f8fafc', cursor: 'not-allowed', color: '#475569', fontWeight: 600 }}
              />
              <small className="muted">
                {editingId ? 'Serial numbers are permanent and cannot be modified.' : 'Auto-assigned sequential serial number 1,2,3 per class.'}
              </small>
            </label>
            <label className="field"><span>Roll No. (LIS-001/9P/26)</span>
              <input
                value={form.roll_no}
                placeholder={nextRollNo}
                onChange={(e) => setForm({ ...form, roll_no: e.target.value })}
              />
              {nextRollNo && <small className="muted">Next roll number: {nextRollNo}</small>}
            </label>
            <label className="field"><span>Full name *</span>
              <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </label>
            <label className="field"><span>Gender</span>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option><option value="M">M</option><option value="F">F</option>
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{editingId ? 'Save changes' : 'Add student'}</button>
            {editingId && <button type="button" className="btn btn-ghost" onClick={() => { setEditingId(null); setForm(empty) }}>Cancel</button>}
          </div>
          {error && <div className="notice notice-error">{error}</div>}
        </form>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Class S/N</th><th>Roll No.</th><th>Full name</th><th>Gender</th>{canAdd && <th className="right">Actions</th>}</tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr><td colSpan={5} className="muted center">No students in this class yet.</td></tr>
            )}
            {students.map((s) => (
              <tr key={s.id}>
                <td className="mono">{formatStudentNo(s.student_no)}</td>
                <td className="mono">{formatRollNo(s.roll_no || s.admission_no)}</td>
                <td>{s.full_name}</td>
                <td>{s.gender || '—'}</td>
                {canAdd && (
                  <td className="right">
                    <button className="btn btn-small" onClick={() => startEdit(s)}>Edit</button>{' '}
                    <button className="btn btn-small btn-danger" onClick={() => remove(s)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
